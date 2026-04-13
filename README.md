# Vani — Conversational AI Chatbot

> **Speak. Ask. Know.**

Vani is a full-stack conversational AI chatbot powered by a free LLM via OpenRouter.  
It features a clean dark-themed React frontend and a lightweight FastAPI backend.

---

## Tech Stack

| Layer     | Technology                                    |
|-----------|-----------------------------------------------|
| Frontend  | React 18 + Vite, plain CSS (no framework)     |
| Backend   | Python FastAPI + uvicorn                      |
| LLM       | OpenRouter — `meta-llama/llama-3.1-8b-instruct:free` |
| Hosting   | Frontend → Vercel · Backend → Render          |

---

## Project Structure

```
/
├── CLAUDE.md
├── README.md
├── backend/
│   ├── main.py              # FastAPI app
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    ├── .env.example
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        └── components/
            ├── ChatWindow.jsx
            ├── MessageBubble.jsx
            └── ChatInput.jsx
```

---

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- An [OpenRouter](https://openrouter.ai) account (free — no credit card required)

---

### 1. Backend Setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env and paste your OpenRouter API key
```

**Get your free OpenRouter key:**  
Sign up at https://openrouter.ai → Dashboard → Keys → Create key

```bash
# Start the backend (runs on http://localhost:8000)
uvicorn main:app --reload
```

Verify it's running: http://localhost:8000/health → `{"status":"ok"}`

---

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env — set VITE_API_URL=http://localhost:8000 for local dev
```

```bash
# Start the dev server (runs on http://localhost:5173)
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable             | Description                          |
|----------------------|--------------------------------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (required)   |

### Frontend (`frontend/.env`)

| Variable        | Description                                        |
|-----------------|----------------------------------------------------|
| `VITE_API_URL`  | Full URL of the backend (no trailing slash)        |

---

## Deployment

### Backend → Render

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → New → Web Service → connect your repo.
3. Set **Root Directory** to `backend`.
4. Set **Build Command**: `pip install -r requirements.txt`
5. Set **Start Command**: `uvicorn main:app --host 0.0.0.0 --port 8000`
6. Add environment variable: `OPENROUTER_API_KEY` = your key.
7. Deploy. Note the service URL (e.g., `https://vani-backend.onrender.com`).

> **Note:** Render free tier spins down after 15 minutes of inactivity.  
> The frontend shows a "Backend is waking up…" banner while the cold start completes (can take 10–30s).

---

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → import your repo.
2. Set **Root Directory** to `frontend`.
3. Add environment variable: `VITE_API_URL` = your Render backend URL.
4. Deploy.

---

## OpenRouter Free Model

Vani uses `meta-llama/llama-3.1-8b-instruct:free`.

- No credit card required.
- Subject to OpenRouter's rate limits on free models (typically 20 req/min).
- If you hit rate limits, wait a moment and retry — the frontend has a built-in retry button on errors.
- You can swap the model in `backend/main.py` (`MODEL` constant) for any other free model listed at https://openrouter.ai/models.

---

## Architecture Notes

- **Stateless backend** — conversation history is managed entirely on the frontend and sent with every request. The backend holds no session state.
- **No database, no auth** — intentionally simple for demo/personal use.
- **CORS** — the backend allows all origins (`*`) so the Vercel frontend can communicate freely with the Render backend.
