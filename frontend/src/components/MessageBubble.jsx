import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
// PrismAsyncLight lazy-loads each language as a separate chunk on first use,
// keeping our initial bundle small.
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Plugin arrays defined at module scope so React doesn't see "new" plugin
// references on every render (which would re-init the markdown processor).
const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

// Register the languages we expect to actually encounter in chat. Each is
// loaded as a dynamic import so it only ships when actually used. If a model
// emits code in an unregistered language, SyntaxHighlighter falls back to no
// tokenization (the code still renders, just without colors).
const LANGUAGE_IMPORTS = {
  javascript: () => import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
  jsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
  typescript: () => import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
  tsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
  python: () => import('react-syntax-highlighter/dist/esm/languages/prism/python'),
  bash: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
  shell: () => import('react-syntax-highlighter/dist/esm/languages/prism/shell-session'),
  json: () => import('react-syntax-highlighter/dist/esm/languages/prism/json'),
  yaml: () => import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
  markdown: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
  css: () => import('react-syntax-highlighter/dist/esm/languages/prism/css'),
  scss: () => import('react-syntax-highlighter/dist/esm/languages/prism/scss'),
  html: () => import('react-syntax-highlighter/dist/esm/languages/prism/markup'),
  sql: () => import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
  go: () => import('react-syntax-highlighter/dist/esm/languages/prism/go'),
  rust: () => import('react-syntax-highlighter/dist/esm/languages/prism/rust'),
  java: () => import('react-syntax-highlighter/dist/esm/languages/prism/java'),
  kotlin: () => import('react-syntax-highlighter/dist/esm/languages/prism/kotlin'),
  swift: () => import('react-syntax-highlighter/dist/esm/languages/prism/swift'),
  c: () => import('react-syntax-highlighter/dist/esm/languages/prism/c'),
  cpp: () => import('react-syntax-highlighter/dist/esm/languages/prism/cpp'),
  csharp: () => import('react-syntax-highlighter/dist/esm/languages/prism/csharp'),
  ruby: () => import('react-syntax-highlighter/dist/esm/languages/prism/ruby'),
  php: () => import('react-syntax-highlighter/dist/esm/languages/prism/php'),
  docker: () => import('react-syntax-highlighter/dist/esm/languages/prism/docker'),
}

// Aliases that map to the same Prism module. These keep us robust when a model
// emits ```js or ```py instead of the full name.
const LANGUAGE_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
  'c++': 'cpp',
  rs: 'rust',
  kt: 'kotlin',
  dockerfile: 'docker',
}

const registered = new Set()

function registerLanguage(lang) {
  const canonical = LANGUAGE_ALIASES[lang] || lang
  if (registered.has(canonical) || !LANGUAGE_IMPORTS[canonical]) return canonical
  registered.add(canonical)
  // Fire-and-forget — the highlighter will pick up tokenization once the
  // module finishes loading and React re-renders the next time props change.
  LANGUAGE_IMPORTS[canonical]().then((mod) => {
    SyntaxHighlighter.registerLanguage(canonical, mod.default)
  })
  return canonical
}

/**
 * useTheme — returns 'dark' or 'light' based on <html data-theme>, kept in
 * sync with theme toggles via a MutationObserver. The dataset is set in
 * App.jsx whenever the user flips the theme.
 */
function useTheme() {
  const read = () => document.documentElement.dataset.theme || 'dark'
  const [theme, setTheme] = useState(read)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return theme
}

/**
 * Friendlier display names for common language tags. Anything not in this
 * map falls back to the raw tag (e.g. "rust" stays "rust").
 */
const LANGUAGE_LABELS = {
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Shell',
  yml: 'YAML',
  yaml: 'YAML',
  md: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  sql: 'SQL',
  go: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
}

// Web Speech API for text-to-speech. Available in all modern browsers
// including Firefox; uses the OS's installed voices.
const SpeechSynthesisImpl =
  typeof window !== 'undefined' ? window.speechSynthesis : null

// Chrome populates getVoices() asynchronously — calling it once at module
// load triggers the population, and the voiceschanged event fires when the
// list is ready. Without this, the very first speak after page load can
// miss the voices array entirely.
if (SpeechSynthesisImpl) {
  SpeechSynthesisImpl.getVoices()
}

/**
 * pickPreferredVoice — chooses the most appropriate installed voice for
 * Vani's audience. Prefers Indian English (en-IN), then any Indian-region
 * voice, then any English voice. Returns null if nothing usable is found,
 * which lets the browser pick its own default.
 *
 * Voice availability depends on the OS: macOS/iOS ship Veena/Rishi by
 * default, Android ships Google en-IN, Windows requires the en-IN language
 * pack to be installed for Heera/Ravi to appear.
 */
function pickPreferredVoice() {
  if (!SpeechSynthesisImpl) return null
  const voices = SpeechSynthesisImpl.getVoices()
  if (!voices.length) return null

  // Score voices in two passes:
  //   1) Language match — prefer en-IN over hi-IN over other-IN over generic en.
  //   2) Quality hint — Apple's "Enhanced/Premium/Siri" voices, Google's neural
  //      voices, and "Natural/Online" voice variants are far less robotic than
  //      the default compact ones. Names give us the only signal we have.
  // The quality bonus is intentionally large so an "Enhanced en-IN" beats a
  // "compact en-IN" even though both match the same language.
  const score = (v) => {
    let s = 0
    // Language scoring
    if (v.lang === 'en-IN') s += 100
    else if (v.lang?.startsWith('en-IN')) s += 90
    else if (v.lang === 'hi-IN') s += 70
    else if (v.lang?.endsWith('-IN')) s += 50
    else if (v.lang?.startsWith('en')) s += 10

    // Quality hints encoded in the voice name
    const name = (v.name || '').toLowerCase()
    if (/siri/.test(name)) s += 40           // Apple's best-tier voices
    if (/premium/.test(name)) s += 30        // Apple's downloadable Premium tier
    if (/enhanced/.test(name)) s += 25       // Apple's downloadable Enhanced tier
    if (/neural|natural/.test(name)) s += 20
    if (/online/.test(name)) s += 15         // Apple's online (Eloquence-replacing) voices
    if (/google/.test(name)) s += 10         // Chrome's cloud neural voices

    // Penalize voices that appear to be the lowest-quality compact tier.
    // iOS marks these with no quality tag in the name — we infer by absence
    // of any quality keyword and very short names like 'Veena' or 'Rishi'.
    // Don't over-penalize: it's a tiebreaker, not a disqualifier.

    return s
  }

  return voices.slice().sort((a, b) => score(b) - score(a))[0] || null
}

/**
 * stripMarkdownForSpeech — strip syntax characters that would otherwise be
 * spoken literally ("asterisk asterisk bold asterisk asterisk"). Code blocks
 * are replaced with a short placeholder since reading code aloud is rarely
 * useful and slows things down.
 */
function stripMarkdownForSpeech(text) {
  return text
    // Drop fenced code blocks entirely — they're useless when spoken.
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    // Inline code → just the contents without backticks.
    .replace(/`([^`]+)`/g, '$1')
    // Bold / italic / strikethrough markers.
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // Headers / blockquotes / list markers at line starts.
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Links: keep the text, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Horizontal rules and table separators.
    .replace(/^---+$/gm, '')
    .replace(/\|/g, ' ')
    // Collapse runs of whitespace.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * SpeakButton — uses the browser's speechSynthesis to read assistant replies
 * aloud. Click to play; click again to stop. Auto-resets when speech ends.
 *
 * Voice selection: prefers Indian English. The voice list loads
 * asynchronously in Chrome, so we re-resolve it lazily at speak time
 * rather than caching once at mount.
 */
function SpeakButton({ text, disabled }) {
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    return () => {
      if (speaking) SpeechSynthesisImpl?.cancel()
    }
  }, [speaking])

  function handleToggle() {
    if (!SpeechSynthesisImpl) return
    if (speaking) {
      SpeechSynthesisImpl.cancel()
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text))
    utterance.rate = 1.0
    utterance.pitch = 1.0
    const voice = pickPreferredVoice()
    if (voice) {
      utterance.voice = voice
      // Match utterance lang to the chosen voice; prevents Chrome from
      // sometimes overriding back to the system default.
      utterance.lang = voice.lang
    }
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    SpeechSynthesisImpl.cancel()
    SpeechSynthesisImpl.speak(utterance)
    setSpeaking(true)
  }

  return (
    <button
      type="button"
      className={`message-copy-btn ${speaking ? 'message-copy-btn--copied' : ''}`}
      onClick={handleToggle}
      disabled={disabled}
      aria-label={speaking ? 'Stop speaking' : 'Read aloud'}
      title={speaking ? 'Stop' : 'Read aloud'}
    >
      {speaking ? 'Stop' : 'Listen'}
    </button>
  )
}

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
 * Pre — replaces ReactMarkdown's default <pre> renderer. Renders the fenced
 * code block with Prism syntax highlighting and a header bar showing the
 * language name + a copy button. The language tag comes from the markdown
 * fence (```python → className "language-python") which react-markdown
 * passes through to the <code> child.
 */
function Pre({ children }) {
  const theme = useTheme()

  // Pull the language tag and raw text from the inner <code> element.
  const codeEl = Array.isArray(children) ? children[0] : children
  const codeClass = codeEl?.props?.className || ''
  const langMatch = codeClass.match(/language-([\w+-]+)/)
  const rawLang = langMatch ? langMatch[1].toLowerCase() : ''

  const codeText = String(codeEl?.props?.children ?? '').replace(/\n$/, '')
  const displayLang = LANGUAGE_LABELS[rawLang] || rawLang || 'code'

  // Trigger lazy-load of the language module if we recognize it. Returns the
  // canonical name (e.g. 'js' → 'javascript') for the highlighter prop.
  const language = rawLang ? registerLanguage(rawLang) : 'text'

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__lang">{displayLang}</span>
        <CopyButton text={codeText} className="code-block__copy" label="Copy" />
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={theme === 'dark' ? oneDark : oneLight}
        // PreTag lets us style the outer container ourselves; matches our
        // existing .code-block__pre styling and keeps the scroll container
        // identifiable for the CSS we already have.
        PreTag="pre"
        className="code-block__pre"
        // Strip the library's default inline styles that conflict with our
        // own (margin, border-radius, padding) — we want the header attached.
        customStyle={{
          margin: 0,
          borderRadius: 0,
          padding: '12px 14px',
          fontSize: '12.5px',
        }}
        codeTagProps={{ style: { fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace" } }}
      >
        {codeText}
      </SyntaxHighlighter>
    </div>
  )
}

/**
 * InlineEditor — replaces the user bubble content while editing is active.
 * Auto-focuses, auto-sizes, and handles Save (Enter / button) and Cancel (Escape / button).
 */
function InlineEditor({ initialText, onSave, onCancel }) {
  const [draft, setDraft] = useState(initialText)
  const textareaRef = useRef(null)

  // Focus and place cursor at end on mount
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // Auto-resize as the user types
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = draft.trim()
      if (trimmed) onSave(trimmed)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const canSave = draft.trim().length > 0 && draft.trim() !== initialText.trim()

  return (
    <div className="inline-editor">
      <textarea
        ref={textareaRef}
        className="inline-editor__textarea"
        value={draft}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Edit message"
      />
      <div className="inline-editor__actions">
        <button
          type="button"
          className="inline-editor__btn inline-editor__btn--save"
          onClick={() => { const t = draft.trim(); if (t) onSave(t) }}
          disabled={!canSave}
        >
          Save &amp; send
        </button>
        <button
          type="button"
          className="inline-editor__btn inline-editor__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * MessageBubble — renders a single chat message.
 * Assistant messages are rendered as Markdown; user messages are plain text.
 *
 * Props:
 *   role         {string}   — "user" or "assistant"
 *   content      {string}   — the message text (may contain markdown for assistant)
 *   isError      {boolean}  — if true, renders with error styling
 *   modelUsed    {string}   — model ID that generated this reply (assistant only)
 *   isStreaming  {boolean}  — true while the assistant is streaming tokens
 *   isEditable   {boolean}  — true for the last user message when not loading
 *   isEditing    {boolean}  — true when the inline editor is open for this bubble
 *   onEditStart  {Function} — called when the user clicks the Edit button
 *   onEditSave   {Function} — called with newText when the user saves an edit
 *   onEditCancel {Function} — called when the user cancels an edit
 *   onRetry      {Function} — optional callback for error retry button
 */
function MessageBubble({
  role, content, isError, modelUsed, isStreaming,
  isEditable, isEditing, onEditStart, onEditSave, onEditCancel,
  onRetry,
}) {
  const roleClass = role === 'user' ? 'message--user' : 'message--assistant'
  const errorClass = isError ? 'message--error' : ''
  const label = role === 'user' ? 'You' : 'AI'

  // Strip the ":free" suffix for cleaner display — e.g. "google/gemma-4-31b-it"
  const modelLabel = modelUsed ? modelUsed.replace(':free', '') : null

  // Show the message-level copy button only on assistant replies that have
  // actual content (not the streaming placeholder, not error bubbles).
  const showMessageCopy = role === 'assistant' && !isError && !!content
  // Speech synthesis only when content is settled — reading a half-streamed
  // reply gets cut off when the next chunk arrives.
  const showSpeak =
    role === 'assistant' && !isError && !!content && !isStreaming && !!SpeechSynthesisImpl

  return (
    <div className={`message ${roleClass} ${errorClass}`}>
      {/* Small label above each bubble */}
      <span className="message__label">{label}</span>

      {/* Bubble with the message text, or the inline editor when editing */}
      {isEditing ? (
        <InlineEditor
          initialText={content}
          onSave={onEditSave}
          onCancel={onEditCancel}
        />
      ) : (
        <div className="message__bubble">
          {role === 'assistant' ? (
            content ? (
              <div className="markdown">
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  rehypePlugins={REHYPE_PLUGINS}
                  components={{ code: InlineCode, pre: Pre }}
                >
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
      )}

      {/* Footer row: edit button for last user msg; model + copy + speak for assistant */}
      {!isEditing && role === 'user' && isEditable && (
        <div className="message__footer">
          <button
            type="button"
            className="message-edit-btn"
            onClick={onEditStart}
            aria-label="Edit message"
            title="Edit message"
          >
            Edit
          </button>
        </div>
      )}
      {role === 'assistant' && (modelLabel || showMessageCopy || showSpeak) && (
        <div className="message__footer">
          {modelLabel && <span className="message__model">via {modelLabel}</span>}
          {showMessageCopy && (
            <CopyButton text={content} className="message-copy-btn" label="Copy" />
          )}
          {showSpeak && <SpeakButton text={content} />}
        </div>
      )}
    </div>
  )
}

// memo with default shallow compare. content/role/isError/modelUsed are all
// primitives; onRetry is undefined for non-error bubbles. So a streaming
// turn that mutates only the last bubble's `content` won't cause earlier
// bubbles to re-run their (expensive) markdown/syntax-highlight render.
export default memo(MessageBubble)
