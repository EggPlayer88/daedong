export const MESSAGING_CONTRACT = 1 as const
export interface MessagingScope { schoolId: string; memberId: string; userId: string }
export interface MessagingReadiness {
  available: boolean
  reason: 'ready' | 'database_missing' | 'policy_missing' | 'disabled'
  limits: { bodyCharacters: number; titleCharacters: number; recipients: number } | null
  attachments: 'not_configured' | 'hwpx_basic_v1'
}
export interface Recipient { memberId: string; schoolId: string; name: string; department: string; version: number }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface ThreadSummary {
  id: string; schoolId: string; kind: 'direct' | 'group'; title: string
  participants: Recipient[]; version: number; latestSequence: number; readSequence: number
  unreadCount: number; updatedAt: string; canSend: boolean
}
export interface MessageAttachment { id: string; name: string; bytes: number; sha256: string; profile: 'hwpx_basic_v1' }
export interface Message {
  id: string; schoolId: string; threadId: string; senderMemberId: string; senderName: string
  sequence: number; body: string; createdAt: string; attachments: MessageAttachment[]
}
export interface MessagePage extends Page<Message> { thread: ThreadSummary }
export type NotificationSource = { module: 'calendar' | 'tasks' | 'collections' | 'messages' | 'students' | 'knowledge' | 'cooperation' | 'timetable'; id: string }
export interface InboxNotice {
  id: string; schoolId: string; ownerMemberId: string; title: string; body: string
  createdAt: string; readAt: string | null; version: number; source: NotificationSource | null
}
export type NewMessageMode = 'direct' | 'group' | 'individual'
export type MessageCommand =
  | { kind: 'start'; mode: NewMessageMode; recipients: { memberId: string; expectedVersion: number }[]; title: string; body: string; attachmentIds: string[] }
  | { kind: 'reply'; threadId: string; expectedVersion: number; recipientMemberIds: string[]; body: string; attachmentIds: string[] }
  | { kind: 'read_thread'; threadId: string; throughSequence: number }
  | { kind: 'read_notice'; noticeId: string; expectedVersion: number }
export interface MessageReceipt {
  requestKey: string; kind: MessageCommand['kind']; recordedAt: string
  deliveries: { threadId: string; messageId: string; recipientMemberIds: string[]; sequence: number }[]
  threadId: string | null; throughSequence: number | null; noticeId: string | null; version: number | null
}
export type MessagingFailureCode = 'NOT_READY' | 'INVALID_INPUT' | 'INVALID_RESPONSE' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'QUERY_FAILED' | 'RESULT_UNKNOWN' | 'CANCELLED'
const errorMessages: Record<MessagingFailureCode, string> = {
  NOT_READY: '메시지와 알림의 서버 연결이 아직 준비되지 않았습니다.',
  INVALID_INPUT: '받는 사람과 메시지 내용을 확인해 주세요.',
  INVALID_RESPONSE: '서버 응답을 확인하지 못했습니다. 다시 조회해 주세요.',
  FORBIDDEN: '현재 계정으로 이 대화를 열 수 없습니다.',
  INACTIVE_MEMBERSHIP: '현재 이용 가능한 학교 소속이 아닙니다.',
  NOT_FOUND: '대화가 없거나 현재 소속으로 열 수 없습니다.',
  CONFLICT: '대화 참여자나 받는 사람 정보가 변경되었습니다. 최신 정보를 확인한 뒤 다시 보내 주세요.',
  IDEMPOTENCY_CONFLICT: '같은 요청 번호에 다른 내용이 포함되었습니다. 이전 요청의 확인을 먼저 마쳐 주세요.',
  QUERY_FAILED: '서버에 연결하지 못했습니다. 잠시 뒤 다시 확인해 주세요.',
  RESULT_UNKNOWN: '전송 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다. 같은 요청으로 다시 확인해 주세요.',
  CANCELLED: '계정이나 학교 연결이 바뀌어 이전 요청 결과를 표시하지 않습니다.',
}
export class MessagingError extends Error {
  constructor(readonly code: MessagingFailureCode) { super(errorMessages[code]); this.name = 'MessagingError' }
}
export interface MessagingServer {
  readiness(memberId: string): Promise<MessagingReadiness>
  recipients(memberId: string, query: string, cursor?: string): Promise<Page<Recipient>>
  threads(memberId: string, query: string, unreadOnly: boolean, cursor?: string): Promise<Page<ThreadSummary>>
  messages(memberId: string, threadId: string, beforeCursor?: string): Promise<MessagePage>
  inbox(memberId: string, unreadOnly: boolean, cursor?: string): Promise<Page<InboxNotice>>
  mutate(memberId: string, command: MessageCommand, requestKey: string, options?: { recovering?: boolean; replayOnly?: boolean }): Promise<MessageReceipt>
}
