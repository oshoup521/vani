# Vani — TODO

Actionable checklist derived from [FUTURE_SCOPE.md](FUTURE_SCOPE.md). Each item is something you can pick up and finish.

Format conventions:

- `[ ]` = not started
- `[~]` = in progress
- `[x]` = done
- Effort tags: `XS` (under 1h) · `S` (half day) · `M` (1-2 days) · `L` (3-5 days) · `XL` (week+)
- Items are roughly ordered by recommended sequence within each section, but mostly independent.

---

## Now — recommended next 5 (in order)

The highest-ROI work, ordered by what should happen next.

- [x] **Conversation persistence in localStorage** `XS` — done 2026-05-08
  - [x] Read `messages` from localStorage on App mount — done 2026-05-08
  - [x] Write to localStorage on every messages change (debounce 500ms) — done 2026-05-08
  - [x] Cap stored history at last 500 messages OR 4 MB, whichever is smaller — done 2026-05-08
  - [x] Add migration guard for missing/malformed stored data — done 2026-05-08
- [x] **Stop generation button** `S` — done 2026-05-08
  - [x] Wire `AbortController` into `streamChat` — done 2026-05-08
  - [x] Expose abort function from `runStreamingTurn` — done 2026-05-08
  - [x] Render Stop button in ChatWindow while `isLoading` is true — done 2026-05-08
  - [x] On abort: keep the partial reply (don't wipe it) — done 2026-05-08
  - [x] Test: aborting mid-token doesn't crash the rAF coalescer — done 2026-05-08
- [ ] **Edit last user message** `S`
  - [ ] Add edit (pencil) icon on hover for user messages
  - [ ] Only enable for the *last* user message
  - [ ] Inline textarea replaces the bubble while editing
  - [ ] On save: splice messages array to that point, re-run `runStreamingTurn`
  - [ ] On cancel: restore original
- [ ] **File / image upload (multimodal)** `M`
  - [ ] Add file input + paste handler to ChatInput
  - [ ] Show image preview in the user message bubble
  - [ ] Backend: detect image content, route to vision-capable model in pool
  - [ ] Handle EXIF rotation, max dimensions, HEIC→JPEG
  - [ ] Update sliding-window logic to account for image bytes
  - [ ] Surface "model doesn't support images" gracefully when fallback chain has no vision model available
- [ ] **Voice mode (continuous conversation)** `L`
  - [ ] Toggle in header to enter voice mode
  - [ ] Continuous STT with end-of-speech detection
  - [ ] Auto-send on silence
  - [ ] Auto-play TTS on reply complete
  - [ ] Pause STT during TTS playback (avoid mic feedback loop)
  - [ ] Visual state machine: idle / listening / processing / speaking
  - [ ] Edit-before-send fallback for misrecognitions

---

## Tier 1 — Quick wins (XS-S)

- [ ] **"New chat" button** `XS`
  - [ ] Header button or menu item
  - [ ] Confirm dialog before clearing
  - [ ] Resets messages, lastUserMessage, error state
- [ ] **Regenerate response** `S`
  - [ ] "↻" button on assistant messages
  - [ ] Truncate messages to before the reply, re-run turn
  - [ ] Replaces existing reply (don't keep both — for now)
- [ ] **Better error recovery UI** `S`
  - [ ] New ErrorBubble component
  - [ ] Provider-error-pattern → friendly-message mapper
  - [ ] Details expander preserves the raw error
  - [ ] Retry button reuses existing handleRetry path
- [ ] **Markdown export of conversation** `XS`
  - [ ] "Export as Markdown" menu item
  - [ ] Format: `## You` / `## Vani` sections, code blocks preserved
  - [ ] Trigger Blob download with timestamped filename
- [ ] **Voice picker dropdown** `S`
  - [ ] Settings panel (creates a "settings panel" sub-task — see Tier 2)
  - [ ] Populate from `speechSynthesis.getVoices()`, group by lang
  - [ ] Listen for `voiceschanged` to repopulate
  - [ ] Persist choice in localStorage
  - [ ] Use chosen voice in SpeakButton if set, else fall through to auto-pick
- [ ] **Keyboard shortcuts** `S`
  - [ ] Cmd/Ctrl+K → focus input
  - [ ] Cmd/Ctrl+Shift+L → toggle theme
  - [ ] Esc → stop generation (after Stop button is built)
  - [ ] Cmd/Ctrl+/ → open shortcut help modal
  - [ ] Help modal lists all shortcuts
- [ ] **Settings panel scaffold** `S`
  - [ ] Triggered by gear icon in header
  - [ ] Modal or slide-out drawer
  - [ ] Currently empty container — populated by other Tier 1 features (voice picker, theme picker, etc)

---

## Tier 2 — Substantial features (M)

- [ ] **Conversation summarization for long histories** `M`
  - [ ] Decide threshold (token count vs message count)
  - [ ] Summarization prompt (preserve names, decisions, facts, unresolved Qs)
  - [ ] Cache summary so we don't re-run on every turn
  - [ ] Frontend stores summary as special-role message
  - [ ] Folding: subsequent compactions absorb older summary
  - [ ] Decide: do this BEFORE or AFTER persistence (recommend after — see Tier 3)
- [ ] **Syntax highlighting theme picker** `M`
  - [ ] Add 1-2 alternative themes (GitHub, Solarized, etc)
  - [ ] Picker in settings panel
  - [ ] Persist choice
  - [ ] Skip if no user signal it matters
- [ ] **RAG over personal knowledge base** `L` (placed here for grouping)
  - [ ] Pick embedding model (sentence-transformers local vs Voyage/Gemini API)
  - [ ] Pick vector store (sqlite-vss vs Pinecone free vs in-memory FAISS)
  - [ ] File upload UI (txt, md, pdf)
  - [ ] Chunking strategy (size + overlap)
  - [ ] Retrieval at query time, prepend top-K to system prompt
  - [ ] Document deletion (must remove vectors)
  - [ ] Tune chunk size for quality
- [ ] **Streaming markdown polish** `M`
  - [ ] Streaming-aware parser that emits stable + in-progress segments
  - [ ] Buffer math expressions until closing `$$`
  - [ ] Buffer fenced code blocks until closing ` ``` `
  - [ ] Render only stable segments through KaTeX/SyntaxHighlighter
  - [ ] Live-render plain prose tail
  - [ ] Verify: no flicker on long mixed replies
- [ ] **Per-conversation system prompt override** `M`
  - [ ] UI to edit (in settings panel or per-chat)
  - [ ] Combine with default prompt: default + custom append
  - [ ] Per-conversation, not global
  - [ ] Persist with conversation
  - [ ] Indicator when override is active (so users remember they set it)

---

## Tier 3 — Architectural upgrades (L)

- [ ] **Auth + per-user persistence** `L`
  - [ ] Pick auth provider (Clerk free, Auth.js, Supabase Auth)
  - [ ] Pick database (Supabase Postgres, Neon, Render Postgres-with-90d-caveat)
  - [ ] Backend routes:
    - [ ] `GET /conversations`
    - [ ] `GET /conversations/:id`
    - [ ] `POST /conversations`
    - [ ] `DELETE /conversations/:id`
  - [ ] Frontend: conversation list sidebar
  - [ ] Login / logout flow
  - [ ] Pagination on history list
  - [ ] Migrate localStorage history to DB on first sign-in
  - [ ] Privacy policy + TOS update
- [ ] **Server-side summarization + chat memory** `L+`
  - [ ] Depends on auth + DB being live
  - [ ] Schema: messages table + summaries table + facts table
  - [ ] Memory extraction prompt (what's worth remembering?)
  - [ ] Memory retrieval algorithm (relevance + recency)
  - [ ] User-facing memory viewer
  - [ ] Memory editing
  - [ ] Memory deletion (single + bulk)
  - [ ] "Forget everything about X" command
- [ ] **Real streaming markdown renderer** `L`
  - [ ] Research: any usable libs since last check?
  - [ ] Benchmark current renderer on 5k / 10k / 20k char replies
  - [ ] Build incremental parser only if benchmarks show real problem
- [ ] **Stripe-powered Vani Pro tier** `XL`
  - [ ] Don't start until Vani has actual users asking
  - [ ] Stripe integration
  - [ ] Backend entitlement checks
  - [ ] Frontend feature gating
  - [ ] Billing portal (Stripe-hosted)
  - [ ] Webhook handling: subscription created, updated, canceled, payment failed
  - [ ] Tax / VAT / GST registration check for jurisdiction
  - [ ] Refund + dispute handling docs

---

## Tier 4 — Ambitious / experimental (XL)

These probably wait until much later. Listed for completeness; do not pull forward without strong reason.

- [ ] **Self-hosted Ollama fallback** `XL`
  - [ ] Detect Ollama at localhost:11434
  - [ ] Add to model pool conditionally
  - [ ] Only useful for self-hosted setups
- [ ] **Multi-user shared conversations** `L`
  - [ ] Read-only share link (easier first step)
  - [ ] Identity model: anonymous viewer vs collaborator vs owner
  - [ ] Privacy/PII redaction options
  - [ ] Optional: collaborative editing
- [ ] **Plugin / tool-calling system** `XL`
  - [ ] Tool definition schema
  - [ ] Function-calling-aware system prompt
  - [ ] Sandbox for code interpreter (security minefield)
  - [ ] Built-in tools: calculator, web search, calendar
  - [ ] Tool failure handling
  - [ ] Decide on free model tool-call quality acceptance
- [ ] **Native mobile app (Expo / React Native)** `XL`
  - [ ] Reuse logic via Expo
  - [ ] Native primitives for UI
  - [ ] Apple Developer account ($99/yr)
  - [ ] App Store + Play Store submission
  - [ ] Maintenance burden: now shipping web + iOS + Android
- [ ] **Browser extension** `L`
  - [ ] Manifest V3 setup
  - [ ] Highlight-to-summon shortcut
  - [ ] Iframe-embedded Vani UI
  - [ ] Per-browser store submission

---

## Bug fixes & technical debt

Backlog of small problems found during development. Triage as they come up.

- [ ] Math expressions during streaming render as raw `$$...$$` until closing delimiter arrives
  - Fix path: covered by Tier 2 "Streaming markdown polish"
- [ ] Voice quality on stock iPhones is robotic; users must manually download Premium voices
  - Fix path: better in-app guidance or the voice picker (Tier 1.8)
- [ ] Free OpenRouter pool routinely 429s due to shared upstream limits
  - Fix path: add OpenRouter $5 credit balance OR rely on Groq as primary (current setup)
- [ ] HF tokenizer download warning on every fresh deploy (Render cold start)
  - Fix path: harmless, ignore. If logs get noisy, set `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`
- [ ] Service worker cache staleness on iOS Safari after deploys
  - Fix status: addressed via `skipWaiting + clientsClaim`. Monitor in production.
- [ ] OpenRouter free model IDs change ~weekly; the pool needs manual pruning
  - Fix path: add startup-time fetch of `/api/v1/models` and build pool dynamically
- [ ] No analytics — can't tell what features get used
  - Fix path: lightweight privacy-friendly analytics (Plausible, Umami) when there's a real user base
- [ ] No automated tests anywhere
  - Fix path: add Vitest for frontend logic, Pytest for backend, on the parts that matter (streaming, fallback chain, sliding window)

---

## Decision log — things explicitly NOT planned

These look attractive but are intentionally off the roadmap. Document the reasoning so they don't keep getting re-suggested.

- ~~Custom-trained model fine-tuning~~ — costs spiral fast for marginal gain
- ~~End-to-end encryption~~ — fake security; the model provider sees plaintext anyway
- ~~"No-logs" guarantee~~ — can't enforce when forwarding to OpenRouter / Groq
- ~~Building our own LLM~~ — millions of dollars in compute

---

## Workflow notes

- Pull from "Now" first; finish before starting from lower tiers.
- Cross-tier dependencies are flagged in-line (e.g. "depends on auth + DB being live").
- When picking up an item, change `[ ]` to `[~]`. Mark `[x]` only when shipped + tested.
- **When ticking a task as done (`[x]`), append the completion timestamp inline** — e.g. `[x] **Stop generation button** `S` — done 2026-05-07 14:30`. Sub-tasks the same way. This gives you a real history of what shipped when, instead of an undated checklist.
- Also bump the `_Last updated_` date at the bottom of the file whenever you mark anything done, add new items, or move items between tiers.
- Add new items to the appropriate tier as they emerge. Don't let the doc go stale — update on every release.
- When an item moves between tiers (e.g. Tier 4 → Tier 1 because a user asked for it), note the date and reason inline.

_Last updated: 2026-05-08_
