import { useState } from 'react'
import ReactMarkdown from 'react-markdown'

/**
 * CopyButton — small button that copies `text` to the clipboard and briefly
 * flips its label to "Copied" before resetting.
 */
function CopyButton({ text, className = 'copy-btn', label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail on insecure contexts (http://) or when the
      // user denies permission. Fall back to the legacy execCommand path.
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } catch {
        // Give up silently — the button just won't change state.
      } finally {
        document.body.removeChild(textarea)
      }
    }
  }

  return (
    <button
      type="button"
      className={`${className} ${copied ? `${className}--copied` : ''}`}
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : label}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

/**
 * Inline code (single backticks) — renders unchanged. Fenced blocks are
 * handled by the Pre component below, which wraps the <pre> with a copy
 * button. Splitting like this keeps inline `code` valid HTML and lets us
 * own the fenced-block container layout.
 */
function InlineCode({ className, children, ...props }) {
  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

/**
 * Pre — replaces ReactMarkdown's default <pre> renderer. Wraps the fenced
 * code block in a relative container so we can absolutely-position the
 * copy button. Extracts the raw text from the child <code> element so the
 * button copies exactly what's rendered (without the trailing newline that
 * ReactMarkdown emits).
 */
function Pre({ children, ...props }) {
  // children is the <code> element. Pull its text out for the copy target.
  const codeText = (() => {
    const codeEl = Array.isArray(children) ? children[0] : children
    const inner = codeEl?.props?.children
    return String(inner ?? '').replace(/\n$/, '')
  })()

  return (
    <div className="code-block">
      <CopyButton text={codeText} className="code-block__copy" label="Copy" />
      <pre {...props}>{children}</pre>
    </div>
  )
}

/**
 * MessageBubble — renders a single chat message.
 * Assistant messages are rendered as Markdown; user messages are plain text.
 *
 * Props:
 *   role       {string}   — "user" or "assistant"
 *   content    {string}   — the message text (may contain markdown for assistant)
 *   isError    {boolean}  — if true, renders with error styling
 *   modelUsed  {string}   — model ID that generated this reply (assistant only)
 *   onRetry    {Function} — optional callback for error retry button
 */
export default function MessageBubble({ role, content, isError, modelUsed, onRetry }) {
  const roleClass = role === 'user' ? 'message--user' : 'message--assistant'
  const errorClass = isError ? 'message--error' : ''
  const label = role === 'user' ? 'You' : 'AI'

  // Strip the ":free" suffix for cleaner display — e.g. "google/gemma-4-31b-it"
  const modelLabel = modelUsed ? modelUsed.replace(':free', '') : null

  // Show the message-level copy button only on assistant replies that have
  // actual content (not the streaming placeholder, not error bubbles).
  const showMessageCopy = role === 'assistant' && !isError && !!content

  return (
    <div className={`message ${roleClass} ${errorClass}`}>
      {/* Small label above each bubble */}
      <span className="message__label">{label}</span>

      {/* Bubble with the message text */}
      <div className="message__bubble">
        {role === 'assistant' ? (
          content ? (
            <div className="markdown">
              <ReactMarkdown components={{ code: InlineCode, pre: Pre }}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            // Streaming placeholder — first token hasn't arrived yet
            <div className="typing-indicator">
              <span />
              <span />
              <span />
            </div>
          )
        ) : (
          content
        )}

        {/* Retry button — only shown on error bubbles */}
        {isError && onRetry && (
          <div>
            <button className="retry-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Footer row: model attribution + copy button (assistant only) */}
      {role === 'assistant' && (modelLabel || showMessageCopy) && (
        <div className="message__footer">
          {modelLabel && <span className="message__model">via {modelLabel}</span>}
          {showMessageCopy && (
            <CopyButton text={content} className="message-copy-btn" label="Copy" />
          )}
        </div>
      )}
    </div>
  )
}
