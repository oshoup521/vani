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
import logging
import os
from logging.handlers import RotatingFileHandler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Union
import litellm
from litellm import acompletion
from dotenv import load_dotenv

load_dotenv()

# Rotating error log — written to errors.log next to main.py so it can be
# git-committed and inspected across deploys. Rotates at 1 MB, keeps 5 backups.
_log_path = os.path.join(os.path.dirname(__file__), "errors.log")
_handler = RotatingFileHandler(_log_path, maxBytes=1_000_000, backupCount=5, encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S"))
error_log = logging.getLogger("vani.errors")
error_log.setLevel(logging.WARNING)
error_log.addHandler(_handler)
error_log.propagate = False  # don't double-print to uvicorn's root logger

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

# Vision-capable free models, tried in order when the request contains images.
# Verified against https://openrouter.ai/api/v1/models on 2026-05-08.
# Free vision model availability changes frequently — re-verify if you see 404s.
# To refresh: GET https://openrouter.ai/api/v1/models, filter context_length > 0
# and modalities includes "image".
VISION_MODEL_POOL = [
    # Gemma 4 supports image + text — same model used in text pool, so it's
    # already proven to be up. Best first choice.
    "openrouter/google/gemma-4-31b-it:free",
    # Gemma 4 26B MoE variant — lighter, good fallback
    "openrouter/google/gemma-4-26b-a4b-it:free",
    # NVIDIA Nemotron Omni — multimodal (image, audio, video)
    "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    # Baidu OCR — fast, purpose-built for image/text extraction
    "openrouter/baidu/qianfan-ocr-fast:free",
    # Gemini via direct API key if GEMINI_API_KEY is set in env
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
    # content is either a plain string or an OpenAI-style multipart list:
    # [{"type": "text", "text": "..."}, {"type": "image_url", "image_url": {"url": "data:..."}}]
    content: Union[str, list]


class ChatRequest(BaseModel):
    messages: List[Message]


def estimate_tokens(content: Union[str, list]) -> int:
    """Rough token count. Text: ~4 chars/token. Each image part costs a fixed
    1000-token estimate — conservative but avoids pulling in a tokenizer dep."""
    if isinstance(content, str):
        return max(1, len(content) // 4)
    total = 0
    for part in content:
        if part.get("type") == "text":
            total += max(1, len(part.get("text", "")) // 4)
        elif part.get("type") == "image_url":
            total += 1000  # conservative per-image budget
    return total or 1


def has_image(content: Union[str, list]) -> bool:
    """Return True if this message content contains at least one image part."""
    if isinstance(content, list):
        return any(p.get("type") == "image_url" for p in content)
    return False


def payload_has_images(messages: List[dict]) -> bool:
    """Return True if any message in the payload contains an image."""
    return any(has_image(m.get("content", "")) for m in messages)


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


def build_payload(messages: List[Message]) -> tuple[List[dict], bool]:
    """System prompt + windowed history. Returns (payload, needs_vision).
    needs_vision is True when any message contains an image part — callers
    should route to VISION_MODEL_POOL instead of MODEL_POOL."""
    history = trim_history(messages)
    payload = [{"role": "system", "content": SYSTEM_PROMPT}] + history
    return payload, payload_has_images(history)


@app.api_route("/health", methods=["GET", "HEAD"])
async def health_check():
    return {"status": "ok"}


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Walks MODEL_POOL (or VISION_MODEL_POOL for image requests) in order.
    LiteLLM translates the call to the right provider's API. On rate limit /
    auth / transient error we move to the next model. If all fail, return 503.
    """
    messages_payload, needs_vision = build_payload(request.messages)
    pool = VISION_MODEL_POOL if needs_vision else MODEL_POOL

    last_error = None
    for model in pool:
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
            error_log.warning("model=%s err=%s: %s", model, type(e).__name__, e)
            last_error = e
            continue

    detail = f"All {len(pool)} models failed. Last error: {last_error}"
    error_log.error("POOL_EXHAUSTED pool_size=%d last_err=%s", len(pool), last_error)
    raise HTTPException(status_code=503, detail=detail)


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
    messages_payload, needs_vision = build_payload(request.messages)
    pool = VISION_MODEL_POOL if needs_vision else MODEL_POOL

    async def event_generator():
        last_error = None
        for model in pool:
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
                error_log.warning("stream model=%s err=%s: %s", model, type(e).__name__, e)
                last_error = e
                # Only fall through if we never committed. If we did commit,
                # the exception happened mid-stream — re-raise as an SSE error
                # so the client keeps whatever tokens it already rendered.
                if committed:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    return
                continue

        msg = f"All {len(pool)} models failed. Last error: {last_error}"
        error_log.error("STREAM_POOL_EXHAUSTED pool_size=%d last_err=%s", len(pool), last_error)
        yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering on Render/nginx
        },
    )
