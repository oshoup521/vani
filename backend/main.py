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


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Walks MODEL_POOL in order. For each model, LiteLLM translates the call to
    the right provider's API. On rate limit / auth / transient error we move
    to the next model. If all fail, return 503.
    """
    messages_payload = [{"role": m.role, "content": m.content} for m in request.messages]

    last_error = None
    for model in MODEL_POOL:
        kwargs = {
            "model": model,
            "messages": messages_payload,
            "timeout": 30,
        }
        if model.startswith("openrouter/"):
            kwargs["extra_headers"] = OPENROUTER_EXTRA_HEADERS

        try:
            response = await acompletion(**kwargs)
            reply = response["choices"][0]["message"]["content"]
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
