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
 *   onStop      {Function} — called when the user clicks the Stop button mid-stream
 */
export default function ChatWindow({ messages, isLoading, isWakingUp, onRetry, onStop }) {
  const bottomRef = useRef(null)

  // Auto-scroll to the bottom whenever messages change or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // During a streaming turn, an empty assistant bubble is appended immediately
  // and fills as tokens arrive. We show the standalone typing indicator only
  // when there's no such placeholder yet (e.g. between turns or right at start).
  const last = messages[messages.length - 1]
  const hasStreamingPlaceholder =
    last && last.role === 'assistant' && !last.isError
  const showTypingIndicator = isLoading && !hasStreamingPlaceholder

  return (
    <div className="chat-window">
      {/* Empty state — shown before the first message */}
      {messages.length === 0 && !isLoading && (
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true">
            <span />
          </div>
          <h1 className="empty-state__title">Start a conversation</h1>
          <div className="empty-state__text">Ask Vani anything to get a clear, focused answer.</div>
        </div>
      )}

      {/* Render each message bubble. The last assistant bubble during a
          loading turn is the streaming target; flag it so the bubble can
          disable streaming-incompatible features (like text-to-speech). */}
      {messages.map((msg, index) => {
        const isStreaming =
          isLoading &&
          index === messages.length - 1 &&
          msg.role === 'assistant' &&
          !msg.isError
        return (
          <MessageBubble
            key={index}
            role={msg.role}
            content={msg.content}
            isError={msg.isError}
            modelUsed={msg.modelUsed}
            isStreaming={isStreaming}
            onRetry={msg.isError ? onRetry : undefined}
          />
        )
      })}

      {/* Typing indicator — shown until the streaming bubble appears */}
      {showTypingIndicator && (
        <div className="message message--assistant">
          <span className="message__label">AI</span>
          <div className="typing-indicator">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      {/* Stop button — visible only while a turn is in flight. Sits centered
          below the streaming content so it's reachable without leaving the
          reading area. */}
      {isLoading && onStop && (
        <div className="stop-row">
          <button
            type="button"
            className="stop-btn"
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop generating"
          >
            <span className="stop-btn__icon" aria-hidden="true" />
            Stop generating
          </button>
        </div>
      )}

      {/* Invisible anchor element to scroll into view */}
      <div ref={bottomRef} />
    </div>
  )
}
