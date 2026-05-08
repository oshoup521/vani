import { useEffect, useRef, useState } from 'react'
import ChatWindow from './components/ChatWindow.jsx'
import ChatInput from './components/ChatInput.jsx'
import Sidebar from './components/Sidebar.jsx'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const SESSIONS_KEY = 'vani-sessions'
const ACTIVE_KEY = 'vani-active-id'
const MAX_SESSIONS = 20
const MAX_LLM_MESSAGES = 20
const MAX_STORED_MESSAGES = 500
const MAX_STORED_BYTES = 4 * 1024 * 1024

function getInitialTheme() {
  const saved = localStorage.getItem('vani-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function generateSessionName(messages) {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return 'New chat'
  const text = Array.isArray(first.content)
    ? (first.content.find((p) => p.type === 'text')?.text ?? '')
    : first.content
  return text.trim().slice(0, 30) || 'New chat'
}

function isValidMessage(m) {
  return (
    m &&
    typeof m === 'object' &&
    (m.role === 'user' || m.role === 'assistant') &&
    (typeof m.content === 'string' || Array.isArray(m.content))
  )
}

function makeSession(overrides = {}) {
  return {
    id: generateId(),
    name: 'New chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// Reads sessions from localStorage, migrating the old 'vani-messages' key if needed.
// Always returns { sessions: [...], activeId: string }.
function getInitialSessions() {
  try {
    const newRaw = localStorage.getItem(SESSIONS_KEY)

    // One-time migration from the single-session schema
    if (!newRaw) {
      const oldRaw = localStorage.getItem('vani-messages')
      if (oldRaw) {
        const oldMessages = JSON.parse(oldRaw)
        if (Array.isArray(oldMessages)) {
          const session = makeSession({
            name: 'Previous chat',
            messages: oldMessages.filter(isValidMessage),
          })
          localStorage.setItem(SESSIONS_KEY, JSON.stringify([session]))
          localStorage.setItem(ACTIVE_KEY, session.id)
          localStorage.removeItem('vani-messages')
          return { sessions: [session], activeId: session.id }
        }
      }
      // Brand new user
      const session = makeSession()
      return { sessions: [session], activeId: session.id }
    }

    const parsed = JSON.parse(newRaw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const session = makeSession()
      return { sessions: [session], activeId: session.id }
    }

    const valid = parsed.filter(
      (s) => s && typeof s.id === 'string' && Array.isArray(s.messages),
    )
    if (valid.length === 0) {
      const session = makeSession()
      return { sessions: [session], activeId: session.id }
    }

    const savedActiveId = localStorage.getItem(ACTIVE_KEY)
    const activeId = valid.find((s) => s.id === savedActiveId)
      ? savedActiveId
      : valid[valid.length - 1].id

    return { sessions: valid, activeId }
  } catch {
    const session = makeSession()
    return { sessions: [session], activeId: session.id }
  }
}

function serializeSessionsForStorage(sessions) {
  let trimmed = sessions.length > MAX_SESSIONS ? sessions.slice(-MAX_SESSIONS) : sessions

  trimmed = trimmed.map((s) => ({
    ...s,
    messages: s.messages.length > MAX_STORED_MESSAGES
      ? s.messages.slice(-MAX_STORED_MESSAGES)
      : s.messages,
  }))

  let serialized = JSON.stringify(trimmed)

  // If over byte budget, drop the oldest message from the largest session, repeat
  while (serialized.length > MAX_STORED_BYTES && trimmed.some((s) => s.messages.length > 1)) {
    const maxIdx = trimmed.reduce(
      (best, s, i) => (s.messages.length > trimmed[best].messages.length ? i : best),
      0,
    )
    trimmed = trimmed.map((s, i) =>
      i === maxIdx ? { ...s, messages: s.messages.slice(1) } : s,
    )
    serialized = JSON.stringify(trimmed)
  }

  return serialized.length > MAX_STORED_BYTES ? null : serialized
}

// Trim history sent to the LLM to the last MAX_LLM_MESSAGES messages.
// Full history is always kept locally; only the API payload is trimmed.
// A leading system message (if any) is always preserved.
function trimForLLM(messages) {
  if (messages.length <= MAX_LLM_MESSAGES) return messages
  const hasSystem = messages[0]?.role === 'system'
  if (!hasSystem) return messages.slice(-MAX_LLM_MESSAGES)
  const sys = messages[0]
  const tail = messages.slice(-(MAX_LLM_MESSAGES - 1))
  return [sys, ...tail]
}

// Header component
function Header({ theme, onToggleTheme, onNewChat, hasMessages, onMenuToggle }) {
  const isDark = theme === 'dark'

  return (
    <header className="header">
      <div className="header__brand">
        <button
          className="sidebar-toggle-btn"
          type="button"
          onClick={onMenuToggle}
          aria-label="Toggle chat sessions"
          title="Chat sessions"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="header__mark" aria-hidden="true">V</span>
        <div>
          <span className="header__title">Vani</span>
          <span className="header__tagline">Speak. Ask. Know.</span>
        </div>
      </div>

      <div className="header__actions">
        {hasMessages && (
          <button
            className="new-chat-btn"
            type="button"
            onClick={onNewChat}
            aria-label="Start new chat"
            title="Start new chat"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New chat
          </button>
        )}

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
      </div>
    </header>
  )
}

// Initialise session data once at module level to avoid double-invocation
// from React's StrictMode double-rendering of useState initialisers.
const _init = getInitialSessions()

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)

  const [sessions, setSessions] = useState(_init.sessions)
  const [activeSessionId, setActiveSessionId] = useState(_init.activeId)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [isWakingUp, setIsWakingUp] = useState(false)
  const [lastUserMessage, setLastUserMessage] = useState(null)
  const [droppedFiles, setDroppedFiles] = useState(null)

  const abortRef = useRef(null)
  const persistTimerRef = useRef(null)

  // Derive the active session's messages — not a separate state slice
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]
  const messages = activeSession?.messages ?? []

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('vani-theme', theme)
  }, [theme])

  // Debounced persist: filter transient bubbles, then serialise all sessions
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      try {
        const persistable = sessions.map((s) => ({
          ...s,
          messages: s.messages.filter(
            (m) => !m.isError && !(m.role === 'assistant' && m.content === ''),
          ),
        }))
        if (persistable.every((s) => s.messages.length === 0)) {
          // Keep at least the session shells so the sidebar doesn't lose history
          localStorage.setItem(SESSIONS_KEY, JSON.stringify(persistable))
        } else {
          const serialized = serializeSessionsForStorage(persistable)
          if (serialized) localStorage.setItem(SESSIONS_KEY, serialized)
        }
        localStorage.setItem(ACTIVE_KEY, activeSessionId)
      } catch {
        // QuotaExceeded — drop silently
      }
    }, 500)
    return () => clearTimeout(persistTimerRef.current)
  }, [sessions, activeSessionId])

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  // Update the messages of a specific session by ID.
  // Using a captured session ID (not the live activeSessionId) prevents
  // abort-cleanup from writing to the wrong session after a mid-stream switch.
  function updateThisSession(updaterFn, sessionId) {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s
        const newMessages =
          typeof updaterFn === 'function' ? updaterFn(s.messages) : updaterFn
        return { ...s, messages: newMessages, updatedAt: Date.now() }
      }),
    )
  }

  // Auto-name a session from its first user message once, immediately after send.
  function maybeAutoName(sessionId, msgs) {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId && s.name === 'New chat'
          ? { ...s, name: generateSessionName(msgs) }
          : s,
      ),
    )
  }

  function newChat() {
    abortRef.current?.abort()
    const session = makeSession()
    setSessions((prev) => {
      const next = [...prev, session]
      return next.length > MAX_SESSIONS ? next.slice(1) : next
    })
    setActiveSessionId(session.id)
    setLastUserMessage(null)
    setIsLoading(false)
    setIsWakingUp(false)
    setDroppedFiles(null)
    setSidebarOpen(false)
  }

  function switchSession(id) {
    if (id === activeSessionId) {
      setSidebarOpen(false)
      return
    }
    abortRef.current?.abort()
    setIsLoading(false)
    setIsWakingUp(false)
    setLastUserMessage(null)
    setDroppedFiles(null)
    setActiveSessionId(id)
    setSidebarOpen(false)
  }

  function deleteSession(id) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (id === activeSessionId) {
        if (next.length > 0) {
          setActiveSessionId(next[next.length - 1].id)
          return next
        }
        const fresh = makeSession()
        setActiveSessionId(fresh.id)
        return [fresh]
      }
      if (next.length === 0) {
        const fresh = makeSession()
        setActiveSessionId(fresh.id)
        return [fresh]
      }
      return next
    })
  }

  function renameSession(id, name) {
    const trimmed = name.trim().slice(0, 60)
    if (!trimmed) return
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, name: trimmed, updatedAt: Date.now() } : s,
      ),
    )
  }

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

  async function runStreamingTurn(history) {
    // Capture the session this turn belongs to so abort cleanup writes to
    // the correct session even if the user switches away mid-stream.
    const sessionIdForThisTurn = activeSessionId

    setIsLoading(true)
    setIsWakingUp(false)

    const controller = new AbortController()
    abortRef.current = controller

    const wakeupTimer = setTimeout(() => setIsWakingUp(true), 5000)

    const assistantIndex = history.length
    updateThisSession(
      [...history, { role: 'assistant', content: '', modelUsed: null }],
      sessionIdForThisTurn,
    )

    const updateAssistant = (patch) => {
      updateThisSession((prev) => {
        const next = [...prev]
        next[assistantIndex] = { ...next[assistantIndex], ...patch }
        return next
      }, sessionIdForThisTurn)
    }

    let pendingChunk = ''
    let flushScheduled = false

    const flushPending = () => {
      flushScheduled = false
      if (!pendingChunk) return
      const chunk = pendingChunk
      pendingChunk = ''
      updateThisSession((prev) => {
        const next = [...prev]
        const current = next[assistantIndex]
        next[assistantIndex] = { ...current, content: current.content + chunk }
        return next
      }, sessionIdForThisTurn)
    }

    const appendDelta = (chunk) => {
      pendingChunk += chunk
      if (!flushScheduled) {
        flushScheduled = true
        requestAnimationFrame(flushPending)
      }
    }

    const finalFlush = () => {
      if (pendingChunk) flushPending()
    }

    let firstTokenSeen = false
    let midStreamError = null

    try {
      // Only the LLM payload is trimmed — the full history is kept locally
      const attempt = () =>
        streamChat({ messages: trimForLLM(history) }, (event) => {
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
            midStreamError = event.message
          }
        }, controller.signal)

      try {
        await attempt()
      } catch (firstErr) {
        if (controller.signal.aborted) throw firstErr
        if (firstTokenSeen) throw firstErr
        await new Promise((r) => setTimeout(r, 800))
        await attempt()
      }

      if (midStreamError) {
        appendDelta(`\n\n_(stream interrupted: ${midStreamError})_`)
      }
    } catch (err) {
      if (controller.signal.aborted || err.name === 'AbortError') {
        if (firstTokenSeen) {
          appendDelta('\n\n_(stopped)_')
        } else {
          updateThisSession((prev) => {
            const next = [...prev]
            next[assistantIndex] = {
              role: 'assistant',
              content: '_(stopped before any reply)_',
            }
            return next
          }, sessionIdForThisTurn)
        }
      } else {
        updateThisSession((prev) => {
          const next = [...prev]
          next[assistantIndex] = {
            role: 'assistant',
            content: `Something went wrong: ${err.message}`,
            isError: true,
          }
          return next
        }, sessionIdForThisTurn)
      }
    } finally {
      finalFlush()
      clearTimeout(wakeupTimer)
      abortRef.current = null
      setIsLoading(false)
      setIsWakingUp(false)
    }
  }

  function stopGeneration() {
    abortRef.current?.abort()
  }

  function buildUserContent(text, images) {
    if (!images || images.length === 0) return text
    const parts = []
    if (text) parts.push({ type: 'text', text })
    for (const img of images) {
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
    }
    return parts
  }

  async function sendMessage(userText, images = []) {
    const content = buildUserContent(userText, images)
    const userMsg = { role: 'user', content, images }
    const nextMessages = [...messages, userMsg]
    updateThisSession(nextMessages, activeSessionId)
    setLastUserMessage(userText)
    // Auto-name from first user message
    if (!messages.some((m) => m.role === 'user')) {
      maybeAutoName(activeSessionId, nextMessages)
    }
    await runStreamingTurn(nextMessages)
  }

  function regenerate() {
    const capturedId = activeSessionId
    const currentMsgs = sessions.find((s) => s.id === capturedId)?.messages ?? []
    let trimmed = [...currentMsgs]
    if (trimmed.length && trimmed[trimmed.length - 1].role === 'assistant') {
      trimmed = trimmed.slice(0, -1)
    }
    updateThisSession(trimmed, capturedId)
    runStreamingTurn(trimmed)
  }

  async function editAndResend(index, newText) {
    const sliced = messages.slice(0, index)
    const editedMsg = { role: 'user', content: newText }
    const nextMessages = [...sliced, editedMsg]
    updateThisSession(nextMessages, activeSessionId)
    setLastUserMessage(newText)
    await runStreamingTurn(nextMessages)
  }

  function handleRetry() {
    if (!lastUserMessage) return
    const capturedId = activeSessionId
    const currentMsgs = sessions.find((s) => s.id === capturedId)?.messages ?? []
    let trimmed = [...currentMsgs]
    if (trimmed.length && trimmed[trimmed.length - 1].isError) {
      trimmed = trimmed.slice(0, -1)
    }
    if (trimmed.length && trimmed[trimmed.length - 1].role === 'user') {
      trimmed = trimmed.slice(0, -1)
    }
    const nextMessages = [...trimmed, { role: 'user', content: lastUserMessage }]
    updateThisSession(nextMessages, capturedId)
    runStreamingTurn(nextMessages)
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isOpen={sidebarOpen}
        onNewChat={newChat}
        onSwitch={switchSession}
        onDelete={deleteSession}
        onRename={renameSession}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="app">
        <Header
          theme={theme}
          onToggleTheme={toggleTheme}
          onNewChat={newChat}
          hasMessages={messages.length > 0}
          onMenuToggle={() => setSidebarOpen((v) => !v)}
        />
        <ChatWindow
          key={activeSessionId}
          messages={messages}
          isLoading={isLoading}
          isWakingUp={isWakingUp}
          onRetry={handleRetry}
          onStop={stopGeneration}
          onEditAndResend={editAndResend}
          onRegenerate={regenerate}
          onDropFiles={setDroppedFiles}
        />
        <ChatInput
          onSend={sendMessage}
          disabled={isLoading}
          droppedFiles={droppedFiles}
          onDropConsumed={() => setDroppedFiles(null)}
        />
      </div>
    </div>
  )
}
