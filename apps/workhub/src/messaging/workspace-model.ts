import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { MessagingError, type MessagingServer, type NotificationSource } from './contracts'
import { type MessageAttempt, type MessageDraft } from './composer'
import { type MessageFileServer } from './files'
export interface MessageComposeRequest {
  id: string
  schoolId: string
  memberId: string
  body: string
}
export interface MessagingWorkspaceProps {
  openRequest?: { key: string; id: string }
  onReturnToSource?: () => void
  composeRequest?: MessageComposeRequest
  onComposeRequestConsumed?: () => void
  connection: SupabaseConnection
  member: Membership
  date: string
  revision?: number
  onNavigationLockChange?: (locked: boolean) => void
  onUpdated?: () => void
  onOpenSource?: (source: NotificationSource) => void | Promise<void>
  canOpenSource?: (source: NotificationSource) => boolean
  /** 시험과 상위 모듈 조합에만 사용한다. 기본 연결은 기존 공용 로그인이다. */
  server?: MessagingServer
  fileServer?: MessageFileServer
}
export type DraftMemory = {
  draft: MessageDraft
  composing: boolean
  pending: MessageAttempt | null
  folded?: boolean
}
export const errorOf = (error: unknown) =>
  error instanceof MessagingError ? error : new MessagingError('QUERY_FAILED')
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
export const sourceLabels = {
  calendar: '일정',
  tasks: '업무',
  collections: '문서 수합',
  messages: '메시지',
  students: '학생',
  knowledge: '학교 자료',
  cooperation: '협업 요청',
  timetable: '시간표 변경 요청',
  transitions: '업무 인계',
}
export function mergePage<T>(before: T[], after: T[], key: (item: T) => string): T[] {
  const result = new Map(before.map((item) => [key(item), item]))
  for (const item of after) result.set(key(item), item)
  return [...result.values()]
}
