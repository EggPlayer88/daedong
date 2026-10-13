import type { ReactNode } from 'react'
import type { PageId } from '../modules'

type IconName = PageId | 'assistant' | 'appearance' | 'school' | 'search'
const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1m-8 3h1" /></>,
  tasks: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m7 9 1.5 1.5L11 8m2 1h4M7 15h10" /></>,
  collections: <><path d="M3 7h7l2 2h9v11H3Z" /><path d="M3 7V4h8l2 3h7v2m-8 3v5m-2-2 2 2 2-2" /></>,
  students: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 4v3" /></>,
  assistant: <><path d="M21 14a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-2-3V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4Z" /><path d="M7 9h9m-9 4h6" /></>,
  appearance: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.4 1.4 0 0 1 1-2.3h3a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><path d="M7 9h.01M10 6h.01M15 7h.01M17 11h.01" strokeWidth="3" /></>,
  school: <><path d="m3 9 9-6 9 6M5 8v13h14V8M9 21v-6h6v6" /><path d="M9 10h.01M15 10h.01" strokeWidth="2.5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
}

export function WorkspaceIcon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
