import { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble.jsx'

/**
 * ChatWindow — renders the scrollable list of messages, typing indicator,
 * and the "backend is waking up" banner.
 *
 * Props:
 *   messages    {Array}   — array of { role, content, isError? } objects
 *   isLoading   {boolean} — whether we're waiting for a response
 *   isWakingUp  {boolean} — whether the 5s wakeup threshold was crossed
 *   onRetry     {Function} — called when the user clicks "Retry" on an error bubble
 */
export default function ChatWindow({ messages, isLoading, isWakingUp, onRetry }) {
  const bottomRef = useRef(null)

  // Auto-scroll to the bottom whenever messages change or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="chat-window">
      {/* Empty state — shown before the first message */}
      {messages.length === 0 && !isLoading && (
        <div className="empty-state">
          <div className="empty-state__icon">💬</div>
          <div className="empty-state__text">Ask me anything to get started</div>
        </div>
      )}

      {/* Render each message bubble */}
      {messages.map((msg, index) => (
        <MessageBubble
          key={index}
          role={msg.role}
          content={msg.content}
          isError={msg.isError}
          modelUsed={msg.modelUsed}
          onRetry={msg.isError ? onRetry : undefined}
        />
      ))}

      {/* Typing indicator — shown while waiting for the backend response */}
      {isLoading && (
        <div className="message message--assistant">
          <span className="message__label">AI</span>
          <div className="typing-indicator">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {/* Wake-up banner — shown if backend hasn't responded in 5 seconds */}
      {isWakingUp && (
        <div className="wakeup-banner">
          Backend is waking up on Render, please wait...
        </div>
      )}

      {/* Invisible anchor element to scroll into view */}
      <div ref={bottomRef} />
    </div>
  )
}
