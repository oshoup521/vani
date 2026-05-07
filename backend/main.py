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

import json
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
    # Groq first — currently the most reliable free tier in the pool.
    "groq/llama-3.3-70b-versatile",
    # OpenRouter free tier — IDs verified live against /api/v1/models.
    # Free model IDs churn often; if you see repeated 404s here, refresh from
    # https://openrouter.ai/api/v1/models (filter for ":free" suffix).
    # OpenRouter's free pool is shared across all users and routinely 429s
    # upstream, so we treat it as a fallback rather than primary.
    "openrouter/google/gemma-4-31b-it:free",
    "openrouter/qwen/qwen3-next-80b-a3b-instruct:free",
    "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    "openrouter/openai/gpt-oss-120b:free",
    "openrouter/z-ai/glm-4.5-air:free",
    "openrouter/meta-llama/llama-3.2-3b-instruct:free",
    # Other free-tier providers — only hit if their API key is set in env.
    "cerebras/llama3.1-8b",
    "gemini/gemini-2.0-flash",
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
    "- Code → always in fenced code blocks with the language tag (```python, ```js, etc.).\n"
    "- Use **bold** for key terms and *italics* for emphasis or definitions, not for decoration.\n"
    "- Tables (GFM pipe syntax) when comparing 3+ items across attributes.\n"
    "- Math: inline as $E = mc^2$, display as $$...$$ on its own line. Always use LaTeX, never raw text.\n"
    "- Hyperlinks in [text](url) form when referencing external sources.\n"
    "- Task lists (- [x] / - [ ]) for checklists and progress.\n"
    "- Strikethrough (~~text~~) when correcting yourself or showing replaced approaches — e.g. '~~v1 endpoint~~ → v2 endpoint' or 'I said ~~Tuesday~~ Wednesday'. Use it; don't avoid it.\n"
    "- Nested lists for hierarchical info (indent sub-items with 2 spaces).\n"
    "- Blockquotes (>) for citing sources or highlighting key statements.\n"
    "- Horizontal rules (---) to separate major sections in long responses.\n\n"
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
    "max_tokens": 4096,
    "presence_penalty": 0.3,
    "frequency_penalty": 0.3,
}

# Sliding-window context budget. We send at most this many tokens of *history*
# (system prompt is added on top and not counted here). 6000 leaves headroom
# for the system prompt + the model's reply within an 8k-context model and
# stays well under Groq's 12k-tokens-per-minute bucket.
MAX_HISTORY_TOKENS = 6000

# Cap on number of historical turns regardless of token count, as a safety net
# in case our char-based token estimate underestimates badly (e.g. CJK text).
MAX_HISTORY_TURNS = 40


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]


def estimate_tokens(text: str) -> int:
    """Rough token count without a tokenizer dependency. ~4 chars/token is a
    standard heuristic for English; over-estimates slightly for code, which
    is the safe direction for budget calculations."""
    return max(1, len(text) // 4)


def trim_history(messages: List[Message]) -> List[dict]:
    """
    Returns a windowed copy of `messages` that fits within MAX_HISTORY_TOKENS
    and MAX_HISTORY_TURNS. Walks newest→oldest, keeps messages until we'd
    exceed the budget, then stops. Drops user/assistant in pairs at the boundary
    so we never keep an assistant reply without its triggering user message.

    The most recent user message is always preserved even if it alone exceeds
    the budget — otherwise we'd have nothing to send.
    """
    if not messages:
        return []

    msgs = [{"role": m.role, "content": m.content} for m in messages]

    # Always keep the most recent message (the new user turn). Walk backwards
    # from the second-to-last, accumulating until we hit a limit.
    kept_reversed = [msgs[-1]]
    budget = estimate_tokens(msgs[-1]["content"])

    for msg in reversed(msgs[:-1]):
        cost = estimate_tokens(msg["content"])
        if budget + cost > MAX_HISTORY_TOKENS:
            break
        if len(kept_reversed) >= MAX_HISTORY_TURNS:
            break
        kept_reversed.append(msg)
        budget += cost

    kept = list(reversed(kept_reversed))

    # Don't start the window with an orphan assistant message — the model would
    # see a reply with no question. If the oldest kept message is an assistant
    # turn, drop it.
    if kept and kept[0]["role"] == "assistant":
        kept = kept[1:]

    return kept


def build_payload(messages: List[Message]) -> List[dict]:
    """System prompt + windowed history. Used by both /chat and /chat/stream."""
    return [{"role": "system", "content": SYSTEM_PROMPT}] + trim_history(messages)


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
    messages_payload = build_payload(request.messages)

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


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Streaming variant of /chat. Walks MODEL_POOL and, for each model, opens a
    streaming completion. Fallback only applies *before* the first token —
    once a model has emitted any content we commit to it. Errors after that
    point are surfaced as a final SSE `error` event so the client can show
    them inline rather than swapping providers mid-reply.

    Wire format: Server-Sent Events. Each line is `data: <json>\\n\\n` where
    json is one of:
      { "type": "model", "model": "<model id>" }   — sent once, before tokens
      { "type": "delta", "content": "<chunk>" }    — token chunk
      { "type": "done" }                            — normal end of stream
      { "type": "error", "message": "<msg>" }       — terminal error
    """
    messages_payload = build_payload(request.messages)

    async def event_generator():
        last_error = None
        for model in MODEL_POOL:
            kwargs = {
                "model": model,
                "messages": messages_payload,
                "timeout": 12,
                "stream": True,
                **SAMPLING_PARAMS,
            }
            if model.startswith("openrouter/"):
                kwargs["extra_headers"] = OPENROUTER_EXTRA_HEADERS

            committed = False
            try:
                stream = await acompletion(**kwargs)
                async for chunk in stream:
                    delta = (
                        chunk["choices"][0].get("delta", {}).get("content")
                        if chunk.get("choices")
                        else None
                    )
                    if not delta:
                        continue
                    if not committed:
                        committed = True
                        yield f"data: {json.dumps({'type': 'model', 'model': model})}\n\n"
                    yield f"data: {json.dumps({'type': 'delta', 'content': delta})}\n\n"

                if not committed:
                    # Stream ended without producing anything — treat as failure
                    # and try the next model.
                    raise ValueError("empty stream")

                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return
            except Exception as e:
                print(f"[fallback] {model} stream failed: {type(e).__name__}: {e}")
                last_error = e
                # Only fall through if we never committed. If we did commit,
                # the exception happened mid-stream — re-raise as an SSE error
                # so the client keeps whatever tokens it already rendered.
                if committed:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    return
                continue

        msg = f"All {len(MODEL_POOL)} models failed. Last error: {last_error}"
        yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering on Render/nginx
        },
    )
