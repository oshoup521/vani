import { useState, useRef, useEffect } from 'react'

/**
 * ChatInput — the fixed bottom input bar with an auto-expanding textarea
 * and a send button.
 *
 * Props:
 *   onSend   {Function} — called with the trimmed message string when the user sends
 *   disabled {boolean}  — disables input and button while waiting for a response
 */
export default function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  // Auto-resize the textarea height as the user types (up to 4 lines via CSS max-height)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  /**
   * handleSend — validates that there's non-empty text, calls onSend,
   * and clears the input.
   */
  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    // Reset textarea height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  /**
   * handleKeyDown — Enter sends the message; Shift+Enter inserts a newline.
   */
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-input-bar">
      <div className="chat-input-inner">
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          rows={1}
          placeholder="Type a message..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />

        {/* Send button — uses a unicode arrow as the icon */}
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 12 20 4l-5 16-3.2-6.8L4 12Zm8.8-.9 1.2 2.5 1.8-5.4-5.6 2.8 2.6.1Z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
