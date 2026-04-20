# AGENTS.md — Vani AI Chatbot Project Spec

This file is the single source of truth for Codex to generate the full project.
Read this entire file before writing any code.

---

## Project Overview

A full-stack conversational AI chatbot with:
- **Frontend**: React + Vite — deployed on Vercel
- **Backend**: Python FastAPI — deployed on Render
- **LLM Provider**: OpenRouter (free models, no paid API key needed)
- **Structure**: Monorepo — both frontend and backend live in the same root folder

---

## Folder Structure

Generate exactly this structure:

```
/
├── AGENTS.md
├── README.md
├── backend/
│   ├── main.py
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

## Backend — FastAPI (`/backend`)

### Stack
- Python 3.11+
- FastAPI
- uvicorn
- httpx (async HTTP client to call OpenRouter)
- python-dotenv
- CORS middleware enabled

### `requirements.txt`
```
fastapi
uvicorn
httpx
python-dotenv
```

### `.env.example`
```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### `main.py` — Full Spec

- Load `OPENROUTER_API_KEY` from environment using `dotenv`
- Enable CORS for all origins (`*`) — needed for Vercel frontend to call Render backend
- Single route: `POST /chat`
- Request body schema (Pydantic):
  ```json
  {
    "messages": [
      { "role": "user", "content": "Hello" },
      { "role": "assistant", "content": "Hi! How can I help?" },
      { "role": "user", "content": "What is Python?" }
    ]
  }
  ```
- Forward the full `messages` array to OpenRouter
- OpenRouter endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Model to use: `meta-llama/llama-3.1-8b-instruct:free`
- Headers to send to OpenRouter:
  ```
  Authorization: Bearer <OPENROUTER_API_KEY>
  Content-Type: application/json
  HTTP-Referer: http://localhost:5173
  X-Title: Vani
  ```
- Return only the assistant's reply text as:
  ```json
  { "reply": "..." }
  ```
- Handle errors gracefully — if OpenRouter fails, return HTTP 500 with a clear message
- Add a `GET /health` route that returns `{ "status": "ok" }` — useful for Render health checks and waking up detection on frontend

### Render Deployment Notes (add as comments in main.py)
- Start command: `uvicorn main:app --host 0.0.0.0 --port 8000`
- Set `OPENROUTER_API_KEY` as an environment variable in Render dashboard
- Free tier spins down after inactivity — frontend handles the wake-up state

---

## Frontend — React + Vite (`/frontend`)

### Stack
- React 18
- Vite
- No CSS framework — use plain CSS with CSS variables for theming
- No extra UI libraries

### `.env.example`
```
VITE_API_URL=https://your-backend.onrender.com
```

### Design — Dark Minimal Theme

Follow these design rules strictly:

**Color Palette (define as CSS variables in `index.css`):**
```css
:root {
  --bg-primary: #0f0f0f;
  --bg-secondary: #1a1a1a;
  --bg-input: #242424;
  --border: #2e2e2e;
  --text-primary: #f0f0f0;
  --text-secondary: #888888;
  --accent: #7c6ef7;
  --accent-hover: #6a5ee0;
  --user-bubble: #1e1b3a;
  --assistant-bubble: #1a1a1a;
  --error: #e05c5c;
}
```

**Typography:**
- Font: `Inter` from Google Fonts (import in `index.css`)
- Base size: 14px
- Line height: 1.6

**Layout:**
- Full viewport height chat layout
- Header bar at top: app name "Vani" on left, subtle tagline "Speak. Ask. Know." on right
- Chat window: scrollable, takes remaining height
- Input bar: fixed at bottom, always visible

**Message Bubbles:**
- User messages: right-aligned, `--user-bubble` background, `--accent` left border
- Assistant messages: left-aligned, `--assistant-bubble` background
- Each bubble has a small label: "You" / "AI" above it in `--text-secondary`
- Rounded corners, subtle padding, max-width 75% of chat window

**Input Area:**
- Textarea (not input) — auto-expands up to 4 lines
- Send button with an arrow icon (use a unicode arrow → or SVG)
- `Enter` sends message, `Shift+Enter` adds new line
- Disabled while waiting for response

**Loading State:**
- Show a typing indicator (three animated dots) as an assistant bubble while waiting
- If backend is waking up (request takes >5s), show a small banner: "Backend is waking up on Render, please wait..."

**Error State:**
- If request fails, show an error message bubble in `--error` color
- Add a "Retry" option

### Component Breakdown

**`App.jsx`**
- Holds `messages` state as array: `[{ role, content }]`
- Holds `isLoading` boolean state
- Holds `isWakingUp` boolean state (true if response takes >5s)
- `sendMessage(userText)` function:
  1. Append `{ role: "user", content: userText }` to messages
  2. Set `isLoading = true`
  3. Start a 5s timer — if no response yet, set `isWakingUp = true`
  4. POST full messages array to `${import.meta.env.VITE_API_URL}/chat`
  5. On success: append `{ role: "assistant", content: reply }`, clear loading states
  6. On error: append an error message bubble, clear loading states
- Renders: `<Header />`, `<ChatWindow />`, `<ChatInput />`

**`ChatWindow.jsx`**
- Receives `messages`, `isLoading`, `isWakingUp` as props
- Renders list of `<MessageBubble />` for each message
- Renders typing indicator bubble when `isLoading` is true
- Renders wake-up banner when `isWakingUp` is true
- Auto-scrolls to bottom whenever messages change (use `useEffect` + `useRef`)

**`MessageBubble.jsx`**
- Receives `role` (`"user"` or `"assistant"`) and `content` as props
- Renders appropriate styling based on role

**`ChatInput.jsx`**
- Receives `onSend(text)` callback and `disabled` boolean as props
- Manages local textarea value state
- Handles Enter vs Shift+Enter
- Clears input after sending

---

## README.md

Generate a clean README with:
- Project description
- Tech stack
- Local development instructions for both backend and frontend
- Environment variable setup steps
- Deployment instructions for Render (backend) and Vercel (frontend)
- Note about OpenRouter free model and rate limits

---

## General Rules for Codex

- Do not use any paid LLM API. Only OpenRouter with the free model specified above.
- Do not install Tailwind, Bootstrap, or any CSS framework. Plain CSS only.
- Do not use TypeScript. Plain JavaScript (.jsx, .js) only.
- Do not add authentication, database, or any persistence layer.
- Keep the backend stateless — all conversation history is managed on the frontend.
- All environment variables must be read from `.env` files. Never hardcode keys.
- Write clean, well-commented code. Add a comment above every major function explaining what it does.
- After generating all files, print a summary of what was created.
