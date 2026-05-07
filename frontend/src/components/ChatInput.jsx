import { useState, useRef, useEffect } from 'react'

// The Web Speech API is namespaced differently across browsers. Pick whatever
// the current one has, or null if unsupported (notably Firefox).
const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

/**
 * ChatInput — the fixed bottom input bar with an auto-expanding textarea,
 * a mic button (where supported), and a send button.
 *
 * Props:
 *   onSend   {Function} — called with the trimmed message string when the user sends
 *   disabled {boolean}  — disables input and button while waiting for a response
 */
export default function ChatInput({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const textareaRef = useRef(null)
  const recognitionRef = useRef(null)
  // Tracks the text that was in the textarea when recording started, so we
  // can append the live transcript to it instead of overwriting.
  const baseTextRef = useRef('')

  // Auto-resize the textarea height as the user types (up to 4 lines via CSS max-height)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  // Cleanup: stop recognition if the component unmounts mid-session
  useEffect(() => {
    return () => recognitionRef.current?.abort?.()
  }, [])

  /**
   * startRecording — initializes a SpeechRecognition session that streams
   * interim transcripts into the textarea as the user speaks. Continues
   * until the user clicks the mic button again or auto-stops on silence.
   */
  function startRecording() {
    if (!SpeechRecognitionImpl || isRecording || disabled) return

    const recognition = new SpeechRecognitionImpl()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'

    baseTextRef.current = value ? value + (value.endsWith(' ') ? '' : ' ') : ''

    recognition.onresult = (event) => {
      // Concatenate every result chunk since the session started. Final
      // results stay; interim ones get replaced on subsequent events.
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setValue(baseTextRef.current + transcript)
    }

    recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' are normal lifecycle events, not real errors
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('Speech recognition error:', event.error)
      }
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      setIsRecording(true)
    } catch (err) {
      console.warn('Failed to start speech recognition:', err)
      setIsRecording(false)
    }
  }

  function stopRecording() {
    recognitionRef.current?.stop?.()
    setIsRecording(false)
  }

  function toggleRecording() {
    if (isRecording) stopRecording()
    else startRecording()
  }

  /**
   * handleSend — validates that there's non-empty text, calls onSend,
   * and clears the input.
   */
  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (isRecording) stopRecording()
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

  const showMic = !!SpeechRecognitionImpl

  return (
    <div className="chat-input-bar">
      <div className="chat-input-inner">
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          rows={1}
          placeholder={isRecording ? 'Listening...' : 'Type a message...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />

        {/* Mic button — only rendered if the browser supports speech recognition */}
        {showMic && (
          <button
            className={`mic-btn ${isRecording ? 'mic-btn--recording' : ''}`}
            onClick={toggleRecording}
            disabled={disabled}
            aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
            title={isRecording ? 'Stop recording' : 'Speak your message'}
            type="button"
          >
            {isRecording ? (
              // Solid square = stop
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              // Microphone icon
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
              </svg>
            )}
          </button>
        )}

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
