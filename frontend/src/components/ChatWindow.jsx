import { useCallback, useEffect, useRef, useState } from 'react'
import MessageBubble from './MessageBubble.jsx'

/**
 * ChatWindow — renders the scrollable list of messages, typing indicator,
 * and the "backend is waking up" banner.
 *
 * Props:
 *   messages         {Array}    — array of { role, content, isError? } objects
 *   isLoading        {boolean}  — whether we're waiting for a response
 *   isWakingUp       {boolean}  — whether the 5s wakeup threshold was crossed
 *   onRetry          {Function} — called when the user clicks "Retry" on an error bubble
 *   onStop           {Function} — called when the user clicks the Stop button mid-stream
 *   onEditAndResend  {Function} — called with (index, newText) to splice + re-run a turn
 *   onDropFiles      {Function} — called with a FileList when images are dropped on the chat area
 */
export default function ChatWindow({ messages, isLoading, isWakingUp, onRetry, onStop, onEditAndResend, onDropFiles }) {
  const bottomRef = useRef(null)

  // editingIndex: which message is currently open in the inline editor (null = none)
  const [editingIndex, setEditingIndex] = useState(null)

  // dragOver: true while an image is being dragged over the chat window area
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleWindowDragEnter = useCallback((e) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1) setDragOver(true)
  }, [])

  const handleWindowDragLeave = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) setDragOver(false)
  }, [])

  const handleWindowDragOver = useCallback((e) => { e.preventDefault() }, [])

  const handleWindowDrop = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length && onDropFiles) onDropFiles(files)
  }, [onDropFiles])

  // Auto-scroll to the bottom whenever messages change or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // If a new turn starts (isLoading flips on), close any open editor so the
  // in-progress bubble is visible without an orphaned textarea above it.
  useEffect(() => {
    if (isLoading) setEditingIndex(null)
  }, [isLoading])

  // Find the index of the last user message — only that one gets an Edit button.
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIndex = i; break }
  }

  // During a streaming turn, an empty assistant bubble is appended immediately
  // and fills as tokens arrive. We show the standalone typing indicator only
  // when there's no such placeholder yet (e.g. between turns or right at start).
  const last = messages[messages.length - 1]
  const hasStreamingPlaceholder =
    last && last.role === 'assistant' && !last.isError
  const showTypingIndicator = isLoading && !hasStreamingPlaceholder

  function handleEditSave(index, newText) {
    setEditingIndex(null)
    onEditAndResend(index, newText)
  }

  function handleEditCancel() {
    setEditingIndex(null)
  }

  return (
    <div
      className={`chat-window${dragOver ? ' chat-window--drag-over' : ''}`}
      onDragEnter={handleWindowDragEnter}
      onDragLeave={handleWindowDragLeave}
      onDragOver={handleWindowDragOver}
      onDrop={handleWindowDrop}
    >
      {dragOver && (
        <div className="chat-drop-overlay" aria-hidden="true">
          <span>Drop image to attach</span>
        </div>
      )}

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
        // Only the last user message gets an Edit button, and not while loading.
        const isEditable = !isLoading && index === lastUserIndex && msg.role === 'user'
        const isEditing = editingIndex === index
        return (
          <MessageBubble
            key={index}
            role={msg.role}
            content={msg.content}
            images={msg.images}
            isError={msg.isError}
            modelUsed={msg.modelUsed}
            isStreaming={isStreaming}
            isEditable={isEditable}
            isEditing={isEditing}
            onEditStart={() => setEditingIndex(index)}
            onEditSave={(newText) => handleEditSave(index, newText)}
            onEditCancel={handleEditCancel}
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
