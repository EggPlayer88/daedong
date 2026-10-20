import { MessagingError, type MessageCommand, type MessageReceipt } from './contracts'
import type { MessageAttempt } from './composer'
import * as validate from './validation'

export interface DeliveryPerson { memberId: string; name: string; department: string }
export interface SentDeliveryRecord {
  scope: string
  mode: 'direct' | 'group' | 'individual' | 'reply'
  title: string
  recipients: DeliveryPerson[]
  receipt: MessageReceipt
}

export function recipientLabel(person: DeliveryPerson, peers: readonly DeliveryPerson[] = []): string {
  const label = `${person.name}${person.department ? ` · ${person.department}` : ''}`
  return peers.some(other => other.memberId !== person.memberId && other.name === person.name)
    ? `${label} [${person.memberId}]` : label
}

/** 접수 순서는 받는 사람 선택 순서와 다를 수 있으므로 이름은 소속 번호로만 연결한다. */
export function sentDeliveryRecord(attempt: MessageAttempt, result: MessageReceipt, scope: string, self: string): SentDeliveryRecord {
  const sent = attempt.command
  if (sent.kind !== 'start' && sent.kind !== 'reply') throw new MessagingError('INVALID_INPUT')
  const receipt = validate.receipt(result, sent, attempt.key, self)
  const ids = sent.kind === 'start' ? sent.recipients.map(item => item.memberId) : sent.recipientMemberIds
  const people = new Map((attempt.recipientSnapshots ?? []).map(person => [person.memberId, person]))
  return {
    scope, mode: sent.kind === 'start' ? sent.mode : 'reply', title: sent.kind === 'start' ? sent.title : '', receipt,
    recipients: ids.map(memberId => {
      const known = people.get(memberId)
      return known ? { memberId, name: known.name, department: known.department } : { memberId, name: '이름 확인 필요', department: '' }
    }),
  }
}

/** 본문·첨부를 복제하지 않은 탭 메모리만 복원한다. 잘못된 범위나 접수증은 표시하지 않는다. */
export function restoreSentDelivery(value: unknown, scope: string, self: string): SentDeliveryRecord | null {
  if (value === undefined || value === null) return null
  try {
    const v = validate.exact(value, ['scope', 'mode', 'title', 'recipients', 'receipt'])
    if (v.scope !== scope || !['direct', 'group', 'individual', 'reply'].includes(String(v.mode))) return null
    if (!Array.isArray(v.recipients) || v.recipients.length > 500) return null
    const recipients = v.recipients.map(item => {
      const person = validate.exact(item, ['memberId', 'name', 'department'])
      return { memberId: validate.identifier(person.memberId), name: validate.text(person.name, 200), department: validate.text(person.department, 200, true) }
    })
    if (new Set(recipients.map(person => person.memberId)).size !== recipients.length) return null
    const raw = validate.object(v.receipt), title = validate.text(v.title, 1000, true)
    const sent: MessageCommand = v.mode === 'reply'
      ? { kind: 'reply', threadId: validate.identifier(raw.threadId), expectedVersion: 1, recipientMemberIds: recipients.map(person => person.memberId), body: '접수 확인', attachmentIds: [] }
      : { kind: 'start', mode: v.mode as 'direct' | 'group' | 'individual', recipients: recipients.map(person => ({ memberId: person.memberId, expectedVersion: 1 })), title, body: '접수 확인', attachmentIds: [] }
    const command = validate.command(sent, self)
    return { scope, mode: v.mode as SentDeliveryRecord['mode'], title, recipients, receipt: validate.receipt(v.receipt, command, validate.identifier(raw.requestKey), self) }
  } catch { return null }
}
