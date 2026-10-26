import type { ReactNode } from 'react'
import type { PageId } from '../modules'

type IconName = PageId | 'assistant' | 'appearance' | 'school' | 'search'
const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
  timetable: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M15 9v12M3 15h18" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1m-8 3h1" /></>,
  tasks: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m7 9 1.5 1.5L11 8m2 1h4M7 15h10" /></>,
  collections: <><path d="M3 7h7l2 2h9v11H3Z" /><path d="M3 7V4h8l2 3h7v2m-8 3v5m-2-2 2 2 2-2" /></>,
  students: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 4v3" /></>,
  knowledge: <><path d="M4 3h16v18H4Z M8 7h8M8 11h8M8 15h5" /></>,
  messages: <><path d="M3 4h18v13H8l-5 4Z M7 8h10M7 12h6" /></>,
  documents: <><path d="M5 3h10l4 4v14H5Z M14 3v5h5M9 12h6M9 16h6" /></>,
  cooperation: <><path d="M3 7h13l-3-3m3 3-3 3M21 17H8l3 3m-3-3 3-3" /></>,
  schoolAdmin: <><path d="M4 4h16v16H4Z M8 8h8M8 12h8M8 16h5" /></>,
  assistant: <><path d="M21 14a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-2-3V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4Z" /><path d="M7 9h9m-9 4h6" /></>,
  appearance: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.4 1.4 0 0 1 1-2.3h3a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><path d="M7 9h.01M10 6h.01M15 7h.01M17 11h.01" strokeWidth="3" /></>,
  school: <><path d="m3 9 9-6 9 6M5 8v13h14V8M9 21v-6h6v6" /><path d="M9 10h.01M15 10h.01" strokeWidth="2.5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
}

const emoji: Partial<Record<IconName, string>> = { home: '🏠', timetable: '🗓', calendar: '📅', tasks: '📋', collections: '📥', documents: '📁', knowledge: '📚', students: '📖', messages: '💬', cooperation: '🔄', schoolAdmin: '⚙', assistant: '✨', appearance: '🎨', school: '🏡' }

export function WorkspaceIcon({ name }: { name: IconName }) {
  if (emoji[name]) return <span className="ws-tossface" aria-hidden="true">{emoji[name]}</span>
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
