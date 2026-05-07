# Vani — Future Scope

A roadmap of enhancements ordered roughly by **effort vs. payoff**. Items in each tier can mostly be implemented independently. Each entry includes:

- **What it is** — plain description
- **Why it matters** — what problem it solves or what it enables
- **Effort** — rough size (XS / S / M / L / XL)
- **Caveats** — what to watch out for; honest tradeoffs

Effort scale (rough):

- **XS** — under an hour, single file edit
- **S** — half a day, 1–2 files, no new deps
- **M** — 1–2 days, may need a new lib or backend route
- **L** — 3–5 days, new infrastructure or significant refactor
- **XL** — week+, architectural changes (DB, auth, multi-tenant, etc.)

---

## Tier 1 — Quick wins (XS–S)

Low risk, high polish. Most of these are 1-2 hour jobs.

### 1.1 Conversation persistence in `localStorage`

**What:** Save the message history to `localStorage` so refreshing the page doesn't wipe the conversation.

**Why:** Current behavior loses everything on refresh. Users who accidentally hit refresh or close a tab lose their context. Free, immediate UX win.

**Effort:** XS (~30 min). Add a `useEffect` in `App.jsx` that reads on mount and writes on every `messages` change.

**Caveats:**

- localStorage caps at ~5 MB per origin — long conversations will eventually overflow. Add a cap (keep last 500 messages or trim by size).
- Don't persist `isLoading`, `isWakingUp`, etc — only the messages array.
- Privacy implication: anyone with physical device access can read the conversation. Worth noting in a settings panel ("Conversations are stored locally on your device").

### 1.2 "New chat" button to clear history

**What:** A button in the header (or via a dropdown menu) that clears `messages` and starts fresh.

**Why:** Once we add persistence, users need a way out. Also useful right now if a conversation has gone off the rails.

**Effort:** XS (~15 min).

**Caveats:** Add a confirm dialog so accidental taps don't nuke a long conversation.

### 1.3 Stop generation button

**What:** A "Stop" button that appears next to the streaming indicator while a reply is being generated. Click → aborts the in-flight `fetch` via `AbortController` and stops the stream.

**Why:** When the model goes off on a tangent or you realize you asked the wrong question, you currently have to wait it out. ChatGPT and Claude both have this; users expect it.

**Effort:** S (~1 hour). Wire `AbortController` into `streamChat`, expose an abort handler from `runStreamingTurn`, render the button in `ChatWindow`.

**Caveats:** Backend-side, the streaming generator will keep running until it tries to yield to a closed connection — so partial billing/rate-limit cost still happens. That's fine for free tiers.

### 1.4 Edit your last user message

**What:** Hover a user message → small pencil icon → click to edit. On save, the assistant reply below it is removed and a new turn starts with the edited message.

**Why:** Typo in your question? Currently you have to send a follow-up "I meant X" message. Editing is faster and keeps history clean.

**Effort:** S (~2 hours). Add `editing` state to `App`, render a textarea-in-place inside `MessageBubble` for user messages, on save splice the messages array and re-run the turn.

**Caveats:** Only allow editing the *last* user message — editing earlier messages would invalidate all subsequent assistant replies, which gets confusing.

### 1.5 Regenerate response

**What:** Small "↻" button on assistant messages → regenerates that reply with the same input.

**Why:** Free models give variable-quality output. Sometimes you just want a different attempt without rephrasing.

**Effort:** S (~1 hour). Reuse `runStreamingTurn` with the message history truncated to before the assistant reply, replace the reply when streaming completes.

**Caveats:** Replaces the existing reply by default, which loses the original. Optional UX upgrade: keep both and let user A/B them.

### 1.6 Better error recovery UI

**What:** Today errors show as `"Something went wrong: <raw provider error>"`. Replace with a friendly inline panel: short message + Retry button + Details expander for the raw error.

**Why:** Free providers throw cryptic errors (`429 Provider returned error`). Users don't know what to do. Better UX explains the situation and offers an action.

**Effort:** S (~2 hours). New `ErrorBubble` component, error normalization helper that maps provider error patterns to user-friendly text.

**Caveats:** Don't hide the raw error entirely — keep it accessible behind a "Details" toggle so power users can debug.

### 1.7 Markdown export of a conversation

**What:** "Export as Markdown" option in the menu — downloads the current conversation as a `.md` file with `## You` / `## Vani` sections.

**Why:** Useful for sharing notable conversations, archiving research, or pasting into docs.

**Effort:** XS (~30 min). String concatenation + `Blob` download. No backend involvement.

**Caveats:** None substantial.

### 1.8 Voice picker dropdown

**What:** Small dropdown next to the "Listen" button (or in a settings panel) listing all installed voices. User picks; choice persists in `localStorage`.

**Why:** Right now we auto-pick the most Indian-sounding voice but users may prefer a specific one. Some platforms have multiple Indian voices and our scoring picks one arbitrarily.

**Effort:** S (~2 hours). Read `speechSynthesis.getVoices()`, render select element, persist selection.

**Caveats:** Voice list reloads asynchronously in Chrome. Need to listen for `voiceschanged` event to repopulate the dropdown.

### 1.9 Keyboard shortcuts

**What:** `Ctrl/Cmd+K` to focus the input, `Ctrl/Cmd+Shift+L` to toggle theme, `Esc` to stop generation, `Ctrl/Cmd+/` to open a shortcut help dialog.

**Why:** Power users expect this. Especially useful on desktop where the mouse is overhead.

**Effort:** S (~2 hours). Single `useEffect` with `keydown` listener + a help modal.

**Caveats:** Don't override browser shortcuts users rely on (Cmd+T, Cmd+W, etc).

---

## Tier 2 — Substantial features (M)

1–2 day items. Real feature additions that change the app's character.

### 2.1 Conversation summarization for long histories

**What:** When `messages` exceeds the sliding window threshold (currently ~6,000 tokens), summarize the oldest half via a fast LLM call. Replace those messages with a single synthetic system message: `"Earlier in this conversation: <summary>"`. Cache the summary so we don't re-summarize the same span on every turn.

**Why:** Sliding window discards old context permanently. Summarization preserves the gist indefinitely, letting users reference earlier parts of long conversations.

**Effort:** M (~1.5 days). New backend endpoint or inline summarization logic. Frontend stores the summary as a special-role message and sends it on subsequent requests.

**Caveats:**

- Costs an extra LLM call per compaction event — under heavy use this can paradoxically *worsen* the rate-limit situation since the summarization call also counts against Groq's token bucket.
- Quality degrades across multiple compactions (summary-of-summary problem). After ~5 compactions, fine details from early on are gone.
- Adds 1–3s latency to one turn out of every N (the one that triggers compaction).
- Best done after persistent storage exists, since unbounded conversations are mostly a problem when they outlive a single browser session.

### 2.2 Light/dark theme aware syntax highlighting refinement

**What:** Today we use One Dark / One Light. Add a third "Solarized" or "GitHub" preference, picker in settings.

**Why:** Personal preference. No-cost UX improvement once the infrastructure is there.

**Effort:** M (~1 day). Each theme is one import; the picker lives in a settings panel that doesn't yet exist (so this drags in a "settings panel" sub-task).

**Caveats:** Doesn't matter unless users care about code aesthetics. Skip if there's no signal.

### 2.3 File / image upload with multimodal LLM

**What:** Drag-and-drop or paste images into the chat → send them to a vision-capable model (Gemini 2.0 Flash, Llama 4 with vision, etc.) → model describes/analyzes the image.

**Why:** "Take a picture of this diagram and ask about it" is one of the highest-value features in modern chat apps. Massive UX leap.

**Effort:** M (~2 days). Frontend: file input + paste handler + image preview in the message bubble. Backend: detect image content in `messages`, route to a vision-capable model in the pool, encode as base64 or upload to blob storage.

**Caveats:**

- Most free vision models have stricter daily limits than text-only.
- Image bytes inflate the request size dramatically — adjust the streaming buffer + sliding window accordingly.
- Need to handle EXIF orientation, max dimensions, format conversion (HEIC → JPEG for iPhone uploads).
- Privacy: images are sent to free providers (Gemini, OpenRouter). Worth disclosing.

### 2.4 RAG over a small personal knowledge base

**What:** Upload `.txt`, `.md`, `.pdf` files. Chunk + embed them. On each user message, retrieve top-K relevant chunks and prepend to the system prompt as context.

**Why:** Turns Vani into a "chat with my notes" tool. Real differentiator vs generic chat apps.

**Effort:** L (~4 days). Need an embedding model (sentence-transformers locally, or Voyage/Gemini API), a vector store (sqlite + sqlite-vss, or hosted like Pinecone free tier, or an in-memory FAISS), chunking logic, retrieval at query time.

**Caveats:**

- Embedding costs add up if user uploads big PDFs.
- Vector store choice matters: in-memory FAISS is free but doesn't persist across server restarts; sqlite-vss persists but Render's free tier has ephemeral disk; hosted (Pinecone, Qdrant Cloud) costs money beyond free tier.
- Quality of retrieval depends heavily on chunk size and overlap — tuning needed.
- A "delete document" UX adds complexity (need to remove vectors, not just files).

### 2.5 Streaming markdown polish

**What:** Today the message re-renders on every animation frame as tokens stream in. Instead, **buffer math expressions and code blocks until they're complete** before sending them through KaTeX/SyntaxHighlighter — only render plain markdown live.

**Why:** Math currently renders as raw `$$...$$` text until the closing delimiter arrives, then snaps to formatted. Code blocks similarly re-tokenize on every chunk. With buffering, the user sees prose stream in real-time and complete formatted blocks appear all at once when they're ready.

**Effort:** M (~1 day). Introduce a streaming markdown parser that emits "stable" segments (closed code blocks, complete math) and "in-progress" tail (last unclosed block).

**Caveats:**

- Adds ~500ms perceived latency for blocks (user waits until block is complete to see it formatted) — but eliminates flicker, which is usually preferred.
- Complex to get right; edge cases around nested code fences or math inside blockquotes.

### 2.6 Per-conversation system prompt override

**What:** A "Customize" panel where the user can set a custom system prompt for this conversation only. E.g. "You are a Python tutor focused on type hints" or "Reply only in Hindi."

**Why:** The default Vani persona is one-size-fits-all. Power users want to specialize.

**Effort:** M (~1 day). UI to edit; thread the override through to `messages` array as a `system` role message; send to backend.

**Caveats:**

- Need to combine with the default system prompt without conflict — easiest is "default prompt + custom append."
- Make sure the override is per-conversation, not global, otherwise you'll forget you set it weeks ago and wonder why responses are weird.

---

## Tier 3 — Architectural upgrades (L)

Multi-day projects that change how Vani works underneath.

### 3.1 Auth + per-user persistence

**What:** Sign in with Google/email. Conversations stored in a real database keyed by user ID. Same conversations available across devices.

**Why:** Multi-device sync is one of the top requested features in any chat app. localStorage is fine until users have a phone AND a laptop.

**Effort:** L (~5 days). Need:

- Auth provider (Clerk free tier, Auth.js, or Supabase Auth).
- Database (Supabase free Postgres, Neon, or Render's Postgres free tier — note Render's free Postgres expires after 90 days).
- Backend routes: `GET /conversations`, `GET /conversations/:id`, `POST /conversations`, `DELETE /conversations/:id`.
- Frontend: conversation list sidebar, login/logout flow.

**Caveats:**

- Adds a real cost dimension (DB beyond free tier).
- Auth introduces compliance considerations (TOS, privacy policy, data deletion).
- Conversation history grows unbounded — needs pagination or auto-archival.

### 3.2 Server-side conversation summarization + chat memory

**What:** Combines 2.1 (summarization) with 3.1 (persistence). Once conversations live in a DB, we can store the summary alongside the raw history and only ever load the recent + summary into model context. Plus: a "long-term memory" facts table the model can pull from.

**Why:** Real chat-as-a-companion experiences (Replika, Pi, etc.) work because they remember things across sessions. "What did I tell you about my dog last month?" should work.

**Effort:** L+ (~5–7 days, depends on memory sophistication).

**Caveats:**

- Memory extraction is its own LLM problem ("what's worth remembering from this conversation?"). Naive approaches over-extract (every trivial detail) or under-extract.
- Privacy implications get serious. Memory is stored permanently; users need a way to view, edit, and delete remembered facts.
- The memory retrieval algorithm matters a lot — needs to be fast at chat time.

### 3.3 Real streaming Markdown renderer

**What:** Today, every token causes ReactMarkdown to re-parse the entire growing string. This is wasteful at long lengths. Replace with a *streaming-aware* markdown parser that emits incremental updates and React reconciles only the changed nodes.

**Why:** Performance. Current approach scales poorly past ~5,000 character replies. On lower-end phones it visibly stutters even with our rAF coalescing.

**Effort:** L (~3 days, needs research and benchmarking).

**Caveats:**

- No mature off-the-shelf solution exists for streaming markdown in React. You'd be building the parser logic.
- The current approach is "good enough" for replies under ~10k chars. Don't optimize unless you see real problems.

### 3.4 Voice mode (continuous conversation)

**What:** A "voice mode" toggle that puts Vani into a hands-free flow: STT runs continuously, on each silence-detected utterance the message sends, the reply is read aloud automatically with the chosen voice, then STT resumes. Like ChatGPT's Advanced Voice Mode.

**Why:** Walking, driving, cooking — situations where typing is impossible. Massive UX leap and aligns with the "Speak. Ask. Know." tagline more authentically.

**Effort:** L (~4 days). Need:

- Continuous STT with proper end-of-speech detection (`SpeechRecognition` is event-based; we'd add silence detection or use the API's built-in `onspeechend`).
- Auto-send on silence.
- Auto-play TTS on reply complete.
- Visual state machine: idle / listening / processing / speaking.

**Caveats:**

- Browser-based STT is genuinely fragile. Edge cases (background noise, accents, code-switching between languages) cause wrong transcriptions. Users will need an "edit before send" option.
- TTS interrupting STT (the bot speaking is heard by the mic) — need echo cancellation or pause-mic-during-tts.
- Doesn't reach OpenAI Advanced Voice Mode quality, which uses a unified speech-to-speech model. Vani's version is STT → text-LLM → TTS, which has higher latency and weaker tone matching.

### 3.5 Stripe-powered "Vani Pro" with paid models

**What:** Subscription that unlocks GPT-4o / Claude Sonnet / Gemini Pro through your own API keys, removes free-tier rate limits, adds features (long memory, file uploads, etc).

**Why:** Sustainable. If Vani gets users, free tier alone won't scale (you eat the cost; they hit walls). Pro tier funds the infrastructure.

**Effort:** XL (~1.5 weeks). Stripe integration + entitlement checking on backend + feature gating on frontend + billing portal + webhook handling for subscription state changes + cost monitoring.

**Caveats:**

- Don't go here unless you have a real user base. Premature monetization kills adoption.
- Tax/compliance: charging money introduces VAT/GST registration requirements depending on jurisdiction.
- Refund handling, failed payments, plan changes — each is its own UX problem.

---

## Tier 4 — Ambitious / experimental (XL)

Probably-won't-do-next items, included for completeness.

### 4.1 Self-hosted local LLM fallback (Ollama)

**What:** When all cloud providers fail, fall back to a local Ollama instance running Llama / Mistral / similar. Backend detects Ollama at `localhost:11434` and adds it to the model pool.

**Why:** Resilience. Free providers go down or rate-limit; local is always available (if you have a beefy enough machine).

**Effort:** XL (mostly setup/infrastructure overhead).

**Caveats:**

- Only works on the developer's machine, not Render's free tier (no GPU). So really it's a "dev convenience" feature.
- Quality drop is significant for small local models.
- Not actually useful in production unless you self-host the whole stack.

### 4.2 Multi-user shared conversations / collaboration

**What:** Send a shareable link to a conversation; recipient can read and continue from that point.

**Why:** "Look at what Vani said about X" is a real share use case. Currently impossible without screenshotting.

**Effort:** L (~5 days). Read-only share is easier; collaborative editing is much harder.

**Caveats:**

- Privacy implications of sharing chat history (PII risks).
- Identity model gets complicated: anonymous viewers vs logged-in collaborators vs the owner.

### 4.3 Plugin / tool-calling system

**What:** Vani can use tools — calculator, web search, code interpreter, calendar lookup. User asks "what's the weather in Pune?" → Vani calls a weather tool → returns an answer with real data.

**Why:** Massive capability expansion. Models are knowledge-cutoff bound; tools fix that.

**Effort:** XL (~2 weeks). Tool definitions, function-calling-aware prompting, sandboxed execution for code-interpreter, error handling for tool failures.

**Caveats:**

- Free models have weaker tool-calling than GPT-4 / Claude. You'll see hallucinated tool calls and malformed JSON.
- Web search introduces costs (Brave Search API, Google CSE).
- Code interpreter is a security minefield — sandboxing user-generated code is hard.

### 4.4 Native mobile app (Expo / React Native)

**What:** Real iOS + Android apps instead of just a PWA. Push notifications, background tasks, native voice integration, App Store presence.

**Why:** PWAs on iOS are second-class citizens. Real apps get visibility, native features, and don't suffer from Safari's service-worker quirks.

**Effort:** XL (~3+ weeks). Reuse most logic via Expo / React Native; rewrite UI components for native primitives; handle App Store and Play Store submission.

**Caveats:**

- Apple Developer account = $99/year.
- Review process can reject the app (many AI chat apps face scrutiny).
- Maintenance burden doubles — you're now shipping web + iOS + Android.

### 4.5 Browser extension that summons Vani anywhere

**What:** Highlight text on any webpage → keyboard shortcut → Vani opens with that text as context. "Explain this," "translate this," "rewrite this."

**Why:** Embedding Vani into the browsing flow makes it 10× more useful than a standalone tab.

**Effort:** L (~5 days). Manifest V3 extension + content scripts + iframe with Vani UI.

**Caveats:**

- Cross-browser extension stores have different review processes.
- Extension permissions are scary to users — "this extension can read all your data on every site" is hard to explain.

---

## What I'd actually do next, in order

If you asked me to pick the top 5 to work on next, ordered by ROI:

1. **1.1 Conversation persistence** (XS, huge UX win, no risk)
2. **1.3 Stop generation** (S, expected feature, easy)
3. **1.4 Edit last message** (S, expected feature, fixes typo frustration)
4. **2.3 File / image upload with multimodal** (M, the single biggest capability leap)
5. **3.4 Voice mode** (L, finally delivers on "Speak. Ask. Know." tagline as a real interaction mode)

Skip prematurely: auth, monetization, RAG. Those depend on Vani having an audience that asks for them.

---

## Things explicitly NOT recommended

A few features that look attractive but I'd push back on:

- **Custom-trained model fine-tuning.** Free tier providers don't allow it. You'd need OpenAI/Anthropic paid access; costs spiral fast for marginal personality gain.
- **End-to-end encryption.** Sounds responsible but the model provider sees plaintext anyway. Fake security, real complexity.
- **Anonymous mode / no-logs guarantee.** You can't actually guarantee this when forwarding to OpenRouter/Groq, who do log. Don't make claims you can't keep.
- **Building your own LLM.** Just don't. The compute alone is millions of dollars.

---

_Last updated: 2026-05-07. Adjust as the product evolves._
