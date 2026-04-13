import ReactMarkdown from 'react-markdown'

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

  return (
    <div className={`message ${roleClass} ${errorClass}`}>
      {/* Small label above each bubble */}
      <span className="message__label">{label}</span>

      {/* Bubble with the message text */}
      <div className="message__bubble">
        {role === 'assistant' ? (
          <div className="markdown">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
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

      {/* Model attribution — shown below assistant bubbles only */}
      {role === 'assistant' && modelLabel && (
        <span className="message__model">via {modelLabel}</span>
      )}
    </div>
  )
}
