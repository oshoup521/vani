import { useState } from 'react'
import ChatWindow from './components/ChatWindow.jsx'
import ChatInput from './components/ChatInput.jsx'

// The backend URL comes from the VITE_API_URL environment variable.
// In local dev, set this in frontend/.env (copy from .env.example).
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Header component — displays the app name and tagline
function Header() {
  return (
    <header className="header">
      <span className="header__title">Vani</span>
      <span className="header__tagline">Speak. Ask. Know.</span>
    </header>
  )
}

// Root App component — owns all shared state and the sendMessage logic
export default function App() {
  // messages: array of { role: "user" | "assistant", content: string, isError?: bool }
  const [messages, setMessages] = useState([])

  // isLoading: true while awaiting a response from the backend
  const [isLoading, setIsLoading] = useState(false)

  // isWakingUp: true if the backend hasn't responded within 5 seconds
  // (Render free tier cold start can take 10–30s)
  const [isWakingUp, setIsWakingUp] = useState(false)

  // lastUserMessage: kept so the retry button can re-send after an error
  const [lastUserMessage, setLastUserMessage] = useState(null)

  /**
   * sendMessage — sends the full conversation history to the backend
   * and appends the assistant's reply to the messages state.
   *
   * @param {string} userText - the new user message text
   */
  async function sendMessage(userText) {
    const userMsg = { role: 'user', content: userText }
    const nextMessages = [...messages, userMsg]

    setMessages(nextMessages)
    setLastUserMessage(userText)
    setIsLoading(true)
    setIsWakingUp(false)

    // If backend hasn't responded in 5s, show the waking-up banner
    const wakeupTimer = setTimeout(() => setIsWakingUp(true), 5000)

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })

      clearTimeout(wakeupTimer)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Server error: ${response.status}`)
      }

      const data = await response.json()
      const assistantMsg = {
        role: 'assistant',
        content: data.reply,
        modelUsed: data.model_used || null,
      }
      setMessages([...nextMessages, assistantMsg])
    } catch (err) {
      clearTimeout(wakeupTimer)
      // Append an error bubble so the user can see what went wrong and retry
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

      fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })
        .then(async (res) => {
          clearTimeout(wakeupTimer)
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}))
            throw new Error(errorData.detail || `Server error: ${res.status}`)
          }
          return res.json()
        })
        .then((data) => {
          setMessages([...nextMessages, {
            role: 'assistant',
            content: data.reply,
            modelUsed: data.model_used || null,
          }])
        })
        .catch((err) => {
          clearTimeout(wakeupTimer)
          setMessages([
            ...nextMessages,
            { role: 'assistant', content: `Something went wrong: ${err.message}`, isError: true },
          ])
        })
        .finally(() => {
          setIsLoading(false)
          setIsWakingUp(false)
        })

      return nextMessages // keep state consistent during the async call
    })
  }

  return (
    <div className="app">
      <Header />
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
