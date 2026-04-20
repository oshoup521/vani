"""
Vani AI Chatbot — FastAPI Backend

Deployment (Render):
  - Start command: uvicorn main:app --host 0.0.0.0 --port 8000
  - Set OPENROUTER_API_KEY as an environment variable in the Render dashboard
  - Free tier spins down after inactivity — frontend handles the wake-up state
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import httpx
from dotenv import load_dotenv

# Load environment variables from .env file (local dev)
load_dotenv()

app = FastAPI(title="Vani Backend")

# Enable CORS for all origins — required for Vercel frontend to call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenRouter configuration
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Full pool of free models, ordered by quality + low traffic (less rate-limit pressure).
# We chunk this into groups of 3 because OpenRouter's `models` array is capped at 3.
# On each request, we try group 1 (server-side fallback inside OpenRouter).
# If all 3 are rate-limited, we fall back to group 2, and so on.
MODEL_POOL = [
    "google/gemma-4-31b-it:free",              # Gemma 4, 262K ctx
    "nvidia/nemotron-3-super-120b-a12b:free",  # Nemotron 3, large MoE
    "qwen/qwen3-next-80b-a3b-instruct:free",   # Qwen3, MoE efficient
    "z-ai/glm-4.5-air:free",                   # GLM 4.5 Air
    "deepseek/deepseek-chat-v3.1:free",        # DeepSeek V3
    "meta-llama/llama-3.3-70b-instruct:free",  # Llama 3.3 70B
    "mistralai/mistral-small-3.2-24b-instruct:free",  # Mistral Small 3.2
    "google/gemma-3-27b-it:free",              # Gemma 3 fallback
    "meta-llama/llama-3.1-8b-instruct:free",   # Llama 3.1 8B (last resort — spec default)
]

# OpenRouter caps the server-side `models` array at 3 per request
MODELS_PER_REQUEST = 3


# --- Pydantic Models ---

class Message(BaseModel):
    """A single chat message with a role and text content."""
    role: str       # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    """Request body for POST /chat — contains the full conversation history."""
    messages: List[Message]


# --- Health Check Route ---

@app.get("/health")
async def health_check():
    """
    Simple health check endpoint.
    Used by Render for uptime checks and by the frontend to detect
    when the backend has woken up from a cold start.
    """
    return {"status": "ok"}


# --- Free Models Route ---

@app.get("/models/free")
async def list_free_models():
    """
    Fetches all available models from OpenRouter and filters to only
    the free ones (i.e. models whose pricing is $0 for both prompt and completion).
    Returns a sorted list of model IDs and their context lengths.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set on the server."
        )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
            response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=500,
            detail=f"OpenRouter returned an error: {e.response.status_code} — {e.response.text}"
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reach OpenRouter: {str(e)}"
        )

    data = response.json()
    all_models = data.get("data", [])

    # A model is "free" if both prompt and completion pricing are "0"
    free_models = [
        {
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "context_length": m.get("context_length"),
            "prompt_price": m.get("pricing", {}).get("prompt", "?"),
            "completion_price": m.get("pricing", {}).get("completion", "?"),
        }
        for m in all_models
        if str(m.get("pricing", {}).get("prompt", "1")) == "0"
        and str(m.get("pricing", {}).get("completion", "1")) == "0"
    ]

    # Sort alphabetically by model id
    free_models.sort(key=lambda x: x["id"])

    return {"count": len(free_models), "models": free_models}


# --- Chat Route ---

async def try_models_batch(client: httpx.AsyncClient, models: list, messages_payload: list, headers: dict):
    """
    Sends one request to OpenRouter with a ranked `models` list (max 3).
    OpenRouter handles fallback server-side across those 3. Returns
    (reply, model_used) on success, or None if every model in this batch failed.
    """
    body = {"models": models, "messages": messages_payload}

    try:
        response = await client.post(OPENROUTER_API_URL, headers=headers, json=body)
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to reach OpenRouter: {str(e)}")

    # Retryable across batches: 429 (rate limit), 503 (unavailable)
    if response.status_code in (429, 503):
        print(f"[fallback] batch {models} returned {response.status_code}, trying next batch...")
        return None

    if response.status_code >= 400:
        print(f"[fallback] batch {models} returned {response.status_code}: {response.text}")
        return None

    data = response.json()
    if "error" in data:
        print(f"[fallback] batch {models} responded with error body: {data['error']}")
        return None

    try:
        return data["choices"][0]["message"]["content"], data.get("model")
    except (KeyError, IndexError):
        print(f"[fallback] batch {models} returned unexpected format: {data}")
        return None


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Tries the model pool in batches of 3 (OpenRouter's server-side fallback
    limit). Each batch is one round-trip; inside it OpenRouter handles the
    3-way fallback internally. If a whole batch is rate-limited, we try the
    next batch. This gives us a deep pool without paying N round-trips.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not set on the server.")

    messages_payload = [{"role": msg.role, "content": msg.content} for msg in request.messages]

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Vani",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        for i in range(0, len(MODEL_POOL), MODELS_PER_REQUEST):
            batch = MODEL_POOL[i : i + MODELS_PER_REQUEST]
            result = await try_models_batch(client, batch, messages_payload, headers)
            if result is not None:
                reply, model_used = result
                return {"reply": reply, "model_used": model_used}

    raise HTTPException(
        status_code=503,
        detail=f"All {len(MODEL_POOL)} models are rate-limited or unavailable right now.",
    )
