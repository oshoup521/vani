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

# Fallback chain — tried in order until one succeeds.
# Chosen for quality + low traffic (less rate-limit pressure).
FALLBACK_MODELS = [
    "google/gemma-4-31b-it:free",            # 1st choice: newest Gemma 4, 262K ctx
    "nvidia/nemotron-3-super-120b-a12b:free", # 2nd: large MoE, underused
    "qwen/qwen3-next-80b-a3b-instruct:free",  # 3rd: Qwen3 quality, MoE efficient
    "z-ai/glm-4.5-air:free",                  # 4th: obscure provider, almost no traffic
]


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

@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Sends the full conversation to OpenRouter with a ranked list of models.
    OpenRouter handles fallback server-side: if the first model is rate-limited
    or down, it reroutes internally to the next one before replying — so the
    whole fallback chain costs us one network round-trip instead of N.
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

    body = {
        "models": FALLBACK_MODELS,
        "messages": messages_payload,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(OPENROUTER_API_URL, headers=headers, json=body)
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Failed to reach OpenRouter: {str(e)}")

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code if response.status_code < 600 else 500,
            detail=f"OpenRouter error {response.status_code}: {response.text}",
        )

    data = response.json()

    # OpenRouter can return 200 with an error body when every model in the list failed
    if "error" in data:
        raise HTTPException(
            status_code=503,
            detail=f"All fallback models failed: {data['error']}",
        )

    try:
        reply = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise HTTPException(status_code=500, detail=f"Unexpected OpenRouter response: {data}")

    # OpenRouter tells us which model actually served the request
    return {"reply": reply, "model_used": data.get("model")}
