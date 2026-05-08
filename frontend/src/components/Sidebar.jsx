import { useState } from 'react'

// Format a timestamp relative to now for the session list
function formatRelativeDate(ts) {
  const now = new Date()
  const date = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday - 86400000)
  const startOfWeek = new Date(startOfToday - 6 * 86400000)

  if (date >= startOfToday) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  if (date >= startOfYesterday) return 'Yesterday'
  if (date >= startOfWeek) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

export default function Sidebar({
  sessions,
  activeSessionId,
  isOpen,
  onNewChat,
  onSwitch,
  onDelete,
  onRename,
  onClose,
}) {
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  function startEdit(session) {
    setEditingId(session.id)
    setEditDraft(session.name)
  }

  function commitEdit(id) {
    onRename(id, editDraft)
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
  }

  return (
    <aside
      className={`sidebar${isOpen ? ' sidebar--open' : ''}`}
      aria-label="Chat sessions"
    >
      <div className="sidebar__header">
        <span className="sidebar__title">Chats</span>
        <button
          className="sidebar__new-btn"
          type="button"
          onClick={onNewChat}
          title="New chat"
        >
          + New chat
        </button>
      </div>

      <ul className="sidebar__list" role="list">
        {sorted.map((session) => (
          <li
            key={session.id}
            className={`sidebar__item${session.id === activeSessionId ? ' sidebar__item--active' : ''}`}
          >
            {editingId === session.id ? (
              <input
                className="sidebar__rename-input"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => commitEdit(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(session.id)
                  if (e.key === 'Escape') cancelEdit()
                }}
                maxLength={60}
                autoFocus
              />
            ) : (
              <button
                className="sidebar__item-btn"
                type="button"
                onClick={() => onSwitch(session.id)}
                aria-current={session.id === activeSessionId ? 'page' : undefined}
              >
                <span className="sidebar__item-name">{session.name}</span>
                <span className="sidebar__item-date">{formatRelativeDate(session.updatedAt)}</span>
              </button>
            )}

            <div className="sidebar__item-actions">
              <button
                className="sidebar__action-btn"
                type="button"
                onClick={() => startEdit(session)}
                aria-label={`Rename "${session.name}"`}
                title="Rename"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                className="sidebar__action-btn sidebar__action-btn--danger"
                type="button"
                onClick={() => onDelete(session.id)}
                aria-label={`Delete "${session.name}"`}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
