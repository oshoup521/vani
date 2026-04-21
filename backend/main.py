"""
Vani AI Chatbot — FastAPI Backend (LiteLLM edition)

Uses LiteLLM as a provider-agnostic gateway. Instead of hardcoding OpenRouter,
we define a ranked pool of models across multiple providers (OpenRouter, Groq,
Together, Gemini, etc.) and let LiteLLM handle the routing + fallback.

Deployment (Render):
  - Start command: uvicorn main:app --host 0.0.0.0 --port 8000
  - Set provider API keys as environment variables in the Render dashboard.
    At minimum set OPENROUTER_API_KEY. Optionally add GROQ_API_KEY,
    TOGETHER_API_KEY, GEMINI_API_KEY for broader fallback coverage.
  - Free tier spins down after inactivity — frontend handles the wake-up state
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import litellm
from litellm import acompletion
from dotenv import load_dotenv

load_dotenv()

# Keep LiteLLM quiet in logs unless we need debug output
litellm.suppress_debug_info = True
litellm.drop_params = True  # silently drop params a provider doesn't support

app = FastAPI(title="Vani Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ranked model pool across providers. LiteLLM routes each entry to the right
# provider based on the prefix (openrouter/, groq/, together_ai/, gemini/).
# Order = priority. First one that responds wins.
MODEL_POOL = [
    "openrouter/google/gemma-3-27b-it:free",
    "openrouter/deepseek/deepseek-chat-v3.1:free",
    "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    "openrouter/qwen/qwen-2.5-72b-instruct:free",
    "openrouter/mistralai/mistral-small-3.2-24b-instruct:free",
    "openrouter/meta-llama/llama-3.1-8b-instruct:free",
    # Optional free-tier providers — only hit if their API key is set in env.
    # LiteLLM raises AuthenticationError if the key is missing, which we treat
    # as a skip (same as a rate-limit) and move on to the next model.
    "groq/llama-3.3-70b-versatile",
    "gemini/gemini-2.0-flash",
    "cerebras/llama-3.3-70b",
]

# HTTP-Referer / X-Title headers OpenRouter expects for attribution
OPENROUTER_EXTRA_HEADERS = {
    "HTTP-Referer": "http://localhost:5173",
    "X-Title": "Vani",
}

# Shared system prompt — normalizes tone/format across the model pool so the
# user gets a consistent voice even when fallback switches providers mid-chat.
SYSTEM_PROMPT = (
    "You are Vani — a friendly, curious, and genuinely helpful AI companion. "
    "Your tagline is 'Speak. Ask. Know.' Think of yourself as a knowledgeable "
    "friend who's easy to talk to, not a formal assistant.\n\n"
    "Voice & tone:\n"
    "- Warm and conversational, like texting a smart friend. Use natural language, contractions (you're, it's, let's).\n"
    "- Skip robotic openers ('Certainly!', 'Of course!', 'As an AI...'). Just answer.\n"
    "- Show a little personality — light humor when it fits, genuine enthusiasm for interesting topics.\n"
    "- Match the user's energy: casual when they're casual, focused when they're working.\n\n"
    "Interactivity:\n"
    "- When a question is ambiguous, ask one quick clarifying question instead of guessing.\n"
    "- End longer answers with a gentle nudge when useful — 'Want me to go deeper on X?' or 'Should I show an example?'.\n"
    "- For step-by-step tasks, check in: 'Ready for the next step?' rather than dumping everything at once.\n"
    "- Acknowledge what the user said before diving in ('Good catch —', 'Ah, that makes sense —') when it feels natural, not forced.\n\n"
    "Format:\n"
    "- Short questions → short answers (1–3 sentences). Don't pad.\n"
    "- Complex topics → structured with headings, bullets, or numbered steps.\n"
    "- Code → always in fenced code blocks with the language tag.\n"
    "- Use **bold** for key terms, not for decoration.\n\n"
    "Honesty:\n"
    "- If you don't know, say 'I'm not sure, but here's my best guess...' or 'I'd double-check this one.'\n"
    "- Never mention which underlying model you are. You are simply Vani."
)

# Sampling defaults applied to every provider. Slightly higher temperature
# than pure-deterministic so replies feel alive without drifting wildly
# between models. LiteLLM forwards these params; drop_params silently ignores
# ones a given provider doesn't support.
SAMPLING_PARAMS = {
    "temperature": 0.6,
    "top_p": 0.9,
    "max_tokens": 1024,
    "presence_penalty": 0.3,
    "frequency_penalty": 0.3,
}


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]


@app.api_route("/health", methods=["GET", "HEAD"])
async def health_check():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Walks MODEL_POOL in order. For each model, LiteLLM translates the call to
    the right provider's API. On rate limit / auth / transient error we move
    to the next model. If all fail, return 503.
    """
    # Prepend the shared system prompt so every model answers in the same voice.
    # If the client ever sends its own system message, we keep ours first and
    # let theirs follow — most providers concatenate them.
    messages_payload = [{"role": "system", "content": SYSTEM_PROMPT}] + [
        {"role": m.role, "content": m.content} for m in request.messages
    ]

    last_error = None
    for model in MODEL_POOL:
        kwargs = {
            "model": model,
            "messages": messages_payload,
            "timeout": 12,
            **SAMPLING_PARAMS,
        }
        if model.startswith("openrouter/"):
            kwargs["extra_headers"] = OPENROUTER_EXTRA_HEADERS

        try:
            response = await acompletion(**kwargs)
            reply = response["choices"][0]["message"]["content"]
            # Some free providers return HTTP 200 with empty content when
            # throttled. Treat that as a failure and fall through.
            if not reply or not reply.strip():
                raise ValueError("empty reply")
            return {"reply": reply, "model_used": model}
        except Exception as e:
            # Skip on any failure (rate limit, missing key, provider down, etc.)
            print(f"[fallback] {model} failed: {type(e).__name__}: {e}")
            last_error = e
            continue

    raise HTTPException(
        status_code=503,
        detail=f"All {len(MODEL_POOL)} models failed. Last error: {last_error}",
    )
