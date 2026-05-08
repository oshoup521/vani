import { useEffect, useRef, useState } from 'react'
import ChatWindow from './components/ChatWindow.jsx'
import ChatInput from './components/ChatInput.jsx'

// The backend URL comes from the VITE_API_URL environment variable.
// In local dev, set this in frontend/.env (copy from .env.example).
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const MESSAGES_STORAGE_KEY = 'vani-messages'
const MAX_STORED_MESSAGES = 500
const MAX_STORED_BYTES = 4 * 1024 * 1024 // 4 MB

function getInitialTheme() {
  const savedTheme = localStorage.getItem('vani-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// Validate a single message shape so a corrupted entry can't poison rendering.
function isValidMessage(m) {
  return (
    m &&
    typeof m === 'object' &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  )
}

// Read messages from localStorage on mount. Returns [] for missing or
// malformed data — never throws — so a bad payload can't block the app.
function getInitialMessages() {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidMessage)
  } catch {
    return []
  }
}

// Trim history to the cap (last N messages, then under the byte budget).
// Drops oldest first; returns the JSON string ready for storage, or null
// if even a single message exceeds the budget.
function serializeForStorage(messages) {
  let trimmed =
    messages.length > MAX_STORED_MESSAGES
      ? messages.slice(-MAX_STORED_MESSAGES)
      : messages
  let serialized = JSON.stringify(trimmed)
  while (serialized.length > MAX_STORED_BYTES && trimmed.length > 1) {
    trimmed = trimmed.slice(1)
    serialized = JSON.stringify(trimmed)
  }
  return serialized.length > MAX_STORED_BYTES ? null : serialized
}

// Header component - displays the app name, tagline, and theme switcher
function Header({ theme, onToggleTheme }) {
  const isDark = theme === 'dark'

  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__mark" aria-hidden="true">V</span>
        <div>
          <span className="header__title">Vani</span>
          <span className="header__tagline">Speak. Ask. Know.</span>
        </div>
      </div>

      <button
        className="theme-toggle"
        type="button"
        onClick={onToggleTheme}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      >
        <span className="theme-toggle__track" aria-hidden="true">
          <span className="theme-toggle__thumb">
            {isDark ? (
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path d="M20 15.3A8.3 8.3 0 0 1 8.7 4a7 7 0 1 0 11.3 11.3Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0-5 1.1 3h-2.2L12 2Zm0 20-1.1-3h2.2L12 22ZM2 12l3-1.1v2.2L2 12Zm20 0-3 1.1v-2.2L22 12ZM4.2 4.2l2.9 1.3-1.6 1.6-1.3-2.9Zm15.6 15.6-2.9-1.3 1.6-1.6 1.3 2.9Zm0-15.6-1.3 2.9-1.6-1.6 2.9-1.3ZM4.2 19.8l1.3-2.9 1.6 1.6-2.9 1.3Z" />
              </svg>
            )}
          </span>
        </span>
      </button>
    </header>
  )
}

// Root App component — owns all shared state and the sendMessage logic
export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)

  // messages: array of { role: "user" | "assistant", content: string, isError?: bool }
  // Hydrated from localStorage on mount; persisted (debounced) on every change.
  const [messages, setMessages] = useState(getInitialMessages)

  // isLoading: true while awaiting a response from the backend
  const [isLoading, setIsLoading] = useState(false)

  // isWakingUp: true if the backend hasn't responded within 5 seconds
  // (Render free tier cold start can take 10–30s)
  const [isWakingUp, setIsWakingUp] = useState(false)

  // lastUserMessage: kept so the retry button can re-send after an error
  const [lastUserMessage, setLastUserMessage] = useState(null)

  // abortRef: holds the AbortController for the in-flight streaming turn so
  // the Stop button can cancel it. Cleared in the finally block.
  const abortRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('vani-theme', theme)
  }, [theme])

  // Persist messages to localStorage, debounced 500ms so we don't write on
  // every streamed token. Skips bubbles flagged as transient errors and any
  // empty assistant placeholder still being filled.
  const persistTimerRef = useRef(null)
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      const persistable = messages.filter(
        (m) => !m.isError && !(m.role === 'assistant' && m.content === ''),
      )
      try {
        if (persistable.length === 0) {
          localStorage.removeItem(MESSAGES_STORAGE_KEY)
          return
        }
        const serialized = serializeForStorage(persistable)
        if (serialized) localStorage.setItem(MESSAGES_STORAGE_KEY, serialized)
      } catch {
        // QuotaExceeded or storage unavailable — drop silently rather than
        // breaking the chat. Next successful write will catch up.
      }
    }, 500)
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [messages])

  function toggleTheme() {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }

  /**
   * streamChat — opens an SSE stream against /chat/stream and invokes
   * `onEvent` for each parsed event ({type: "model"|"delta"|"done"|"error", ...}).
   * Resolves when the stream ends; throws on transport errors or terminal
   * `error` events that arrive *before* any tokens.
   */
  async function streamChat(payload, onEvent, signal) {
    const response = await fetch(`${API_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Server error: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let receivedAny = false

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by a blank line. Each event has one or more
      // `data: ...` lines we need to concatenate before JSON-parsing.
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)

        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
        if (dataLines.length === 0) continue

        let parsed
        try {
          parsed = JSON.parse(dataLines.join('\n'))
        } catch {
          continue
        }

        if (parsed.type === 'error' && !receivedAny) {
          throw new Error(parsed.message || 'Stream error')
        }
        if (parsed.type === 'delta') receivedAny = true
        onEvent(parsed)
      }
    }
  }

  /**
   * runStreamingTurn — shared flow for both first-send and retry. Appends an
   * empty assistant placeholder, then mutates it in place as SSE deltas arrive.
   */
  async function runStreamingTurn(history) {
    setIsLoading(true)
    setIsWakingUp(false)

    // One AbortController per turn. The Stop button calls .abort() on this.
    const controller = new AbortController()
    abortRef.current = controller

    // If backend hasn't started streaming in 5s, show the waking-up banner
    const wakeupTimer = setTimeout(() => setIsWakingUp(true), 5000)

    // Append an empty assistant bubble we'll fill as tokens arrive. Tracking
    // by index works because nothing else mutates messages during a turn.
    const assistantIndex = history.length
    setMessages([...history, { role: 'assistant', content: '', modelUsed: null }])

    const updateAssistant = (patch) => {
      setMessages((prev) => {
        const next = [...prev]
        next[assistantIndex] = { ...next[assistantIndex], ...patch }
        return next
      })
    }

    // Coalesce streaming tokens with requestAnimationFrame so we render at
    // most once per frame (~60 fps) instead of once per token (which on
    // Groq is 30–80 tokens/sec). Without this, ReactMarkdown + KaTeX +
    // SyntaxHighlighter re-parse the full message on every token, causing
    // visible layout jitter.
    let pendingChunk = ''
    let flushScheduled = false

    const flushPending = () => {
      flushScheduled = false
      if (!pendingChunk) return
      const chunk = pendingChunk
      pendingChunk = ''
      setMessages((prev) => {
        const next = [...prev]
        const current = next[assistantIndex]
        next[assistantIndex] = { ...current, content: current.content + chunk }
        return next
      })
    }

    const appendDelta = (chunk) => {
      pendingChunk += chunk
      if (!flushScheduled) {
        flushScheduled = true
        requestAnimationFrame(flushPending)
      }
    }

    // Force a final flush after the stream completes so the last few tokens
    // (which may arrive too late for an rAF tick) actually render.
    const finalFlush = () => {
      if (pendingChunk) flushPending()
    }

    let firstTokenSeen = false
    let midStreamError = null

    try {
      // Transparent retry only applies before the first token. Once tokens
      // start flowing we keep whatever we got rather than restarting.
      const attempt = () =>
        streamChat({ messages: history }, (event) => {
          if (event.type === 'model') {
            updateAssistant({ modelUsed: event.model })
          } else if (event.type === 'delta') {
            if (!firstTokenSeen) {
              firstTokenSeen = true
              clearTimeout(wakeupTimer)
              setIsWakingUp(false)
            }
            appendDelta(event.content)
          } else if (event.type === 'error') {
            // Only reachable mid-stream — pre-token errors throw inside streamChat.
            midStreamError = event.message
          }
        }, controller.signal)

      try {
        await attempt()
      } catch (firstErr) {
        // Don't auto-retry a user-initiated abort.
        if (controller.signal.aborted) throw firstErr
        if (firstTokenSeen) throw firstErr
        await new Promise((r) => setTimeout(r, 800))
        await attempt()
      }

      if (midStreamError) {
        // Stream cut off after partial output — append a note rather than
        // wiping what the user already saw.
        appendDelta(`\n\n_(stream interrupted: ${midStreamError})_`)
      }
    } catch (err) {
      // User clicked Stop. Keep whatever partial reply we have; just append
      // a small marker so it's clear the response was cut short. If no token
      // ever arrived, replace the empty placeholder with a neutral note
      // rather than an error bubble (this wasn't a failure).
      if (controller.signal.aborted || err.name === 'AbortError') {
        if (firstTokenSeen) {
          appendDelta('\n\n_(stopped)_')
        } else {
          setMessages((prev) => {
            const next = [...prev]
            next[assistantIndex] = {
              role: 'assistant',
              content: '_(stopped before any reply)_',
            }
            return next
          })
        }
      } else {
        // No tokens ever arrived — replace the empty placeholder with an error bubble.
        setMessages((prev) => {
          const next = [...prev]
          next[assistantIndex] = {
            role: 'assistant',
            content: `Something went wrong: ${err.message}`,
            isError: true,
          }
          return next
        })
      }
    } finally {
      // Flush any tokens that were buffered between the last rAF tick and
      // stream end, so the final words actually appear. Safe even after
      // abort: flushPending no-ops on empty pendingChunk and setMessages
      // simply re-renders the bubble we already have.
      finalFlush()
      clearTimeout(wakeupTimer)
      abortRef.current = null
      setIsLoading(false)
      setIsWakingUp(false)
    }
  }

  // stopGeneration — invoked by the Stop button in ChatWindow. Aborts the
  // in-flight fetch; runStreamingTurn's catch block keeps the partial reply.
  function stopGeneration() {
    abortRef.current?.abort()
  }

  async function sendMessage(userText) {
    const userMsg = { role: 'user', content: userText }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLastUserMessage(userText)
    await runStreamingTurn(nextMessages)
  }

  /**
   * handleRetry — strips the trailing error bubble (and its triggering user
   * message) and re-runs the turn with the last user text.
   */
  function handleRetry() {
    if (!lastUserMessage) return
    setMessages((prev) => {
      // Drop trailing error bubble + the user message that produced it
      let trimmed = prev
      if (trimmed.length && trimmed[trimmed.length - 1].isError) {
        trimmed = trimmed.slice(0, -1)
      }
      if (trimmed.length && trimmed[trimmed.length - 1].role === 'user') {
        trimmed = trimmed.slice(0, -1)
      }
      const nextMessages = [...trimmed, { role: 'user', content: lastUserMessage }]
      // Kick off the streaming turn after state settles
      runStreamingTurn(nextMessages)
      return nextMessages
    })
  }

  return (
    <div className="app">
      <Header theme={theme} onToggleTheme={toggleTheme} />
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        isWakingUp={isWakingUp}
        onRetry={handleRetry}
        onStop={stopGeneration}
      />
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  )
}
