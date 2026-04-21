import { useEffect, useState } from 'react'
import ChatWindow from './components/ChatWindow.jsx'
import ChatInput from './components/ChatInput.jsx'

// The backend URL comes from the VITE_API_URL environment variable.
// In local dev, set this in frontend/.env (copy from .env.example).
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function getInitialTheme() {
  const savedTheme = localStorage.getItem('vani-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
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
  const [messages, setMessages] = useState([])

  // isLoading: true while awaiting a response from the backend
  const [isLoading, setIsLoading] = useState(false)

  // isWakingUp: true if the backend hasn't responded within 5 seconds
  // (Render free tier cold start can take 10–30s)
  const [isWakingUp, setIsWakingUp] = useState(false)

  // lastUserMessage: kept so the retry button can re-send after an error
  const [lastUserMessage, setLastUserMessage] = useState(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('vani-theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
  }

  /**
   * sendMessage — sends the full conversation history to the backend
   * and appends the assistant's reply to the messages state.
   *
   * @param {string} userText - the new user message text
   */
  async function postChat(payload) {
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Server error: ${response.status}`)
    }
    return response.json()
  }

  async function sendMessage(userText) {
    const userMsg = { role: 'user', content: userText }
    const nextMessages = [...messages, userMsg]

    setMessages(nextMessages)
    setLastUserMessage(userText)
    setIsLoading(true)
    setIsWakingUp(false)

    // If backend hasn't responded in 5s, show the waking-up banner
    const wakeupTimer = setTimeout(() => setIsWakingUp(true), 5000)

    // Transparent retry: Render free tier cold-starts and the first model in
    // the pool occasionally times out. One silent retry turns a user-visible
    // error into a slightly longer wait.
    let data
    try {
      try {
        data = await postChat({ messages: nextMessages })
      } catch (firstErr) {
        await new Promise((r) => setTimeout(r, 800))
        data = await postChat({ messages: nextMessages })
      }

      clearTimeout(wakeupTimer)
      const assistantMsg = {
        role: 'assistant',
        content: data.reply,
        modelUsed: data.model_used || null,
      }
      setMessages([...nextMessages, assistantMsg])
    } catch (err) {
      clearTimeout(wakeupTimer)
      const errorMsg = {
        role: 'assistant',
        content: `Something went wrong: ${err.message}`,
        isError: true,
      }
      setMessages([...nextMessages, errorMsg])
    } finally {
      setIsLoading(false)
      setIsWakingUp(false)
    }
  }

  /**
   * handleRetry — removes the last error bubble and re-sends the last user message.
   */
  function handleRetry() {
    if (!lastUserMessage) return
    // Strip the trailing error bubble before retrying
    setMessages((prev) => {
      const withoutError = prev.filter((_, i) => {
        // Remove the last message if it was an error
        if (i === prev.length - 1 && prev[i].isError) return false
        return true
      })
      return withoutError
    })
    // Re-send using the messages without the last user message
    // (sendMessage will re-append it)
    setMessages((prev) => {
      const withoutLastUser = prev.slice(0, -1) // remove last user msg too
      // We call sendMessage after state update via a small trick:
      // use the trimmed history directly
      const history = withoutLastUser
      const userMsg = { role: 'user', content: lastUserMessage }
      const nextMessages = [...history, userMsg]

      setMessages(nextMessages)
      setIsLoading(true)
      setIsWakingUp(false)

      const wakeupTimer = setTimeout(() => setIsWakingUp(true), 5000)

      ;(async () => {
        try {
          let data
          try {
            data = await postChat({ messages: nextMessages })
          } catch (firstErr) {
            await new Promise((r) => setTimeout(r, 800))
            data = await postChat({ messages: nextMessages })
          }
          clearTimeout(wakeupTimer)
          setMessages([...nextMessages, {
            role: 'assistant',
            content: data.reply,
            modelUsed: data.model_used || null,
          }])
        } catch (err) {
          clearTimeout(wakeupTimer)
          setMessages([
            ...nextMessages,
            { role: 'assistant', content: `Something went wrong: ${err.message}`, isError: true },
          ])
        } finally {
          setIsLoading(false)
          setIsWakingUp(false)
        }
      })()

      return nextMessages // keep state consistent during the async call
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
      />
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  )
}
