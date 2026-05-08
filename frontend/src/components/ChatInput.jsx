import { useState, useRef, useEffect, useCallback } from 'react'

const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

// MIME types we accept. HEIC/HEIF is intentionally excluded — vision models
// don't accept it and browser support for decoding it is absent. We show a
// clear message rather than silently failing.
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const ACCEPTED_ATTR = 'image/jpeg,image/png,image/gif,image/webp'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB per image
const MAX_IMAGES = 4

/**
 * readAsDataURL — wraps FileReader in a Promise so we can await it.
 */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * validateAndReadFiles — filter, validate, and convert a FileList/array to
 * data-URL objects. Returns { valid: [{name, dataUrl, mimeType}], errors: [string] }.
 */
async function validateAndReadFiles(files, existingCount) {
  const valid = []
  const errors = []
  const remaining = MAX_IMAGES - existingCount

  for (const file of Array.from(files)) {
    if (valid.length >= remaining) {
      errors.push(`Max ${MAX_IMAGES} images per message.`)
      break
    }
    if (file.type === 'image/heic' || file.type === 'image/heif' ||
        file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      errors.push(`HEIC/HEIF images aren't supported — export as JPEG or PNG from Photos first.`)
      continue
    }
    if (!ACCEPTED_MIME.has(file.type)) {
      errors.push(`"${file.name}" isn't a supported image type (JPEG, PNG, GIF, WebP only).`)
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`"${file.name}" is over 5 MB — please resize it first.`)
      continue
    }
    try {
      const dataUrl = await readAsDataURL(file)
      valid.push({ name: file.name, dataUrl, mimeType: file.type })
    } catch {
      errors.push(`Couldn't read "${file.name}".`)
    }
  }
  return { valid, errors }
}

/**
 * ChatInput — the fixed bottom input bar.
 *
 * Props:
 *   onSend        {Function}  — called with (trimmedText, images[]) where images is
 *                               an array of {name, dataUrl, mimeType} objects
 *   disabled      {boolean}   — disables input and buttons while loading
 *   droppedFiles  {File[]|null} — files dropped on the chat window; ChatInput
 *                                 processes them once and the parent must reset
 *                                 this to null after each drop via onDropConsumed
 *   onDropConsumed {Function} — called after droppedFiles are processed so the
 *                               parent can clear the prop
 */
export default function ChatInput({ onSend, disabled, droppedFiles, onDropConsumed }) {
  const [value, setValue] = useState('')
  const [images, setImages] = useState([])      // [{name, dataUrl, mimeType}]
  const [imageError, setImageError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const recognitionRef = useRef(null)
  const baseTextRef = useRef('')
  const dragCounterRef = useRef(0) // track nested dragenter/dragleave pairs

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  useEffect(() => {
    return () => recognitionRef.current?.abort?.()
  }, [])

  // Clear the transient image error after 4 seconds
  useEffect(() => {
    if (!imageError) return
    const t = setTimeout(() => setImageError(null), 4000)
    return () => clearTimeout(t)
  }, [imageError])

  // Process files dropped from the chat window (passed down via prop)
  useEffect(() => {
    if (!droppedFiles || droppedFiles.length === 0) return
    addFiles(droppedFiles).then(() => onDropConsumed?.())
  }, [droppedFiles]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files) {
    const { valid, errors } = await validateAndReadFiles(files, images.length)
    if (errors.length) setImageError(errors[0])
    if (valid.length) setImages((prev) => [...prev, ...valid])
  }

  function removeImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  // Paste handler — picks image items out of the clipboard
  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItems = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (!imageItems.length) return
    e.preventDefault()
    await addFiles(imageItems.map((i) => i.getAsFile()))
  }

  // Drag-and-drop on the entire input bar area
  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) await addFiles(files)
  }, [images.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function startRecording() {
    if (!SpeechRecognitionImpl || isRecording || disabled) return
    const recognition = new SpeechRecognitionImpl()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'
    baseTextRef.current = value ? value + (value.endsWith(' ') ? '' : ' ') : ''
    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setValue(baseTextRef.current + transcript)
    }
    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('Speech recognition error:', event.error)
      }
      setIsRecording(false)
    }
    recognition.onend = () => setIsRecording(false)
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

  function handleSend() {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || disabled) return
    if (isRecording) stopRecording()
    onSend(trimmed, images)
    setValue('')
    setImages([])
    setImageError(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const showMic = !!SpeechRecognitionImpl
  const canSend = (value.trim().length > 0 || images.length > 0) && !disabled

  return (
    <div
      className={`chat-input-bar ${isDragging ? 'chat-input-bar--dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="drop-overlay" aria-hidden="true">
          <span>Drop image to attach</span>
        </div>
      )}

      {/* Image preview strip — shown when images are staged */}
      {images.length > 0 && (
        <div className="image-preview-strip">
          {images.map((img, i) => (
            <div key={i} className="image-preview-item">
              <img src={img.dataUrl} alt={img.name} className="image-preview-thumb" />
              <button
                type="button"
                className="image-preview-remove"
                onClick={() => removeImage(i)}
                aria-label={`Remove image ${img.name}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Transient error banner for invalid files */}
      {imageError && (
        <div className="image-error-banner" role="alert">
          {imageError}
        </div>
      )}

      <div className="chat-input-inner">
        {/* Hidden file input — triggered by the paperclip button */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_ATTR}
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            await addFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {/* Paperclip / attach button */}
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || images.length >= MAX_IMAGES}
          aria-label="Attach image"
          title="Attach image (JPEG, PNG, GIF, WebP · max 5 MB each)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M21.4 11.6 12 21a7 7 0 0 1-9.9-9.9l9.4-9.4a4.7 4.7 0 0 1 6.6 6.6L8.7 17.7a2.3 2.3 0 0 1-3.3-3.3L14.5 5" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          rows={1}
          placeholder={isRecording ? 'Listening...' : images.length ? 'Add a message or send…' : 'Type a message…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
        />

        {showMic && (
          <button
            className={`mic-btn ${isRecording ? 'mic-btn--recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={disabled}
            aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
            title={isRecording ? 'Stop recording' : 'Speak your message'}
            type="button"
          >
            {isRecording ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
              </svg>
            )}
          </button>
        )}

        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!canSend}
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
