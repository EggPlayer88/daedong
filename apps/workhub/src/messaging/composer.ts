import { MessagingError, type MessageAttachment, type MessageCommand, type NewMessageMode, type Recipient, type ThreadSummary } from './contracts'
import { command } from './validation'

export interface MessageDraft { mode: NewMessageMode; recipients: Recipient[]; title: string; body: string; thread: ThreadSummary | null; attachments: MessageAttachment[] }
export interface MessageAttempt { key: string; command: MessageCommand; recipientNames: string[]; attachments?: MessageAttachment[] }
export const blankMessageDraft = (): MessageDraft => ({ mode: 'direct', recipients: [], title: '', body: '', thread: null, attachments: [] })
export function messageAttempt(draft: MessageDraft, memberId: string, key: string): MessageAttempt {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new MessagingError('INVALID_INPUT')
  const sent = draft.thread
    ? command({ kind: 'reply', threadId: draft.thread.id, expectedVersion: draft.thread.version, recipientMemberIds: draft.thread.participants.filter(item => item.memberId !== memberId).map(item => item.memberId), body: draft.body, attachmentIds: draft.attachments.map(item => item.id) }, memberId)
    : command({ kind: 'start', mode: draft.mode, recipients: draft.recipients.map(item => ({ memberId: item.memberId, expectedVersion: item.version })), title: draft.title, body: draft.body, attachmentIds: draft.attachments.map(item => item.id) }, memberId)
  return structuredClone({ key, command: sent, recipientNames: (draft.thread ? draft.thread.participants.filter(item => item.memberId !== memberId) : draft.recipients).map(item => item.name), attachments: draft.attachments })
}
export function newMessageKey(): string {
  if (!globalThis.crypto?.randomUUID) throw new MessagingError('INVALID_INPUT')
  return `message-${globalThis.crypto.randomUUID()}`
}
export function isMessageDraftDirty(draft: MessageDraft): boolean { return Boolean(draft.body || draft.title || draft.recipients.length || draft.attachments.length) }

/** 불명확한 전송은 내용을 바꾸거나 새 요청으로 대체할 수 없다. */
export function retryMessageAttempt(attempt: MessageAttempt): MessageAttempt { return structuredClone(attempt) }
