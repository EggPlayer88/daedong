import { MessagingError, type InboxNotice, type Message, type MessageCommand, type MessagePage, type MessageReceipt, type MessagingFailureCode, type MessagingReadiness, type MessagingScope, type Page, type Recipient, type ThreadSummary } from './contracts'

const bad = (): never => { throw new MessagingError('INVALID_RESPONSE') }
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return bad()
  return value as Record<string, unknown>
}
export function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const v = object(value)
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key))) return bad()
  return v
}
export function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return bad()
  return value
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) return bad()
  return value
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return bad()
  return value
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return bad(); return value }
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return bad()
  return value
}
export function cursor(value: unknown): string | null { return value === null ? null : text(value, 2048) }
function array<T>(value: unknown, parse: (item: unknown) => T, max = 100): T[] {
  if (!Array.isArray(value) || value.length > max) return bad()
  return value.map(parse)
}
function unique<T>(items: T[], key: (item: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) return bad()
  return items
}
export function envelope(value: unknown, scope: MessagingScope): unknown {
  const v = object(value)
  if (v.contractVersion !== 1 || v.schoolId !== scope.schoolId || v.memberId !== scope.memberId || v.userId !== scope.userId) return bad()
  if (v.ok === false) {
    exact(v, ['contractVersion', 'schoolId', 'memberId', 'userId', 'ok', 'error'])
    const error = exact(v.error, ['code'])
    const allowed = ['NOT_READY', 'INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT']
    if (!allowed.includes(String(error.code))) return bad()
    throw new MessagingError(error.code as MessagingFailureCode)
  }
  exact(v, ['contractVersion', 'schoolId', 'memberId', 'userId', 'ok', 'data'])
  if (v.ok !== true) return bad()
  return v.data
}
export function readiness(value: unknown): MessagingReadiness {
  const v = exact(value, ['available', 'reason', 'limits', 'attachments'])
  if (!['ready', 'database_missing', 'policy_missing', 'disabled'].includes(String(v.reason)) || !['not_configured', 'hwpx_basic_v1'].includes(String(v.attachments))) return bad()
  if (v.available !== (v.reason === 'ready')) return bad()
  const limits = v.limits === null ? null : exact(v.limits, ['bodyCharacters', 'titleCharacters', 'recipients'])
  if (v.available && !limits) return bad()
  return { available: bool(v.available), reason: v.reason as MessagingReadiness['reason'], limits: limits && { bodyCharacters: integer(limits.bodyCharacters, 1, 50000), titleCharacters: integer(limits.titleCharacters, 1, 1000), recipients: integer(limits.recipients, 1, 500) }, attachments: v.attachments as MessagingReadiness['attachments'] }
}
export function recipient(value: unknown, scope: MessagingScope): Recipient {
  const v = exact(value, ['memberId', 'schoolId', 'name', 'department', 'version'])
  if (v.schoolId !== scope.schoolId) return bad()
  return { memberId: identifier(v.memberId), schoolId: scope.schoolId, name: text(v.name, 200), department: text(v.department, 200, true), version: integer(v.version, 1) }
}
export function page<T>(value: unknown, parse: (item: unknown) => T, key: (item: T) => string): Page<T> {
  const v = exact(value, ['items', 'nextCursor'])
  const items = unique(array(v.items, parse), key), nextCursor = cursor(v.nextCursor)
  if (!items.length && nextCursor !== null) return bad()
  return { items, nextCursor }
}
export function thread(value: unknown, scope: MessagingScope, expectedId?: string): ThreadSummary {
  const v = exact(value, ['id', 'schoolId', 'kind', 'title', 'participants', 'version', 'latestSequence', 'readSequence', 'unreadCount', 'updatedAt', 'canSend'])
  if (v.schoolId !== scope.schoolId || (expectedId !== undefined && v.id !== expectedId) || !['direct', 'group'].includes(String(v.kind))) return bad()
  const participants = unique(array(v.participants, item => recipient(item, scope), 501), item => item.memberId)
  if (!participants.some(item => item.memberId === scope.memberId) || participants.length < 2 || (v.kind === 'direct' && participants.length !== 2) || (v.kind === 'group' && participants.length < 3)) return bad()
  const latestSequence = integer(v.latestSequence), readSequence = integer(v.readSequence, 0, latestSequence)
  return { id: identifier(v.id), schoolId: scope.schoolId, kind: v.kind as ThreadSummary['kind'], title: text(v.title, 1000, true), participants, version: integer(v.version, 1), latestSequence, readSequence, unreadCount: integer(v.unreadCount, 0, latestSequence - readSequence), updatedAt: timestamp(v.updatedAt), canSend: bool(v.canSend) }
}
function message(value: unknown, scope: MessagingScope, context: ThreadSummary): Message {
  const v = exact(value, ['id', 'schoolId', 'threadId', 'senderMemberId', 'senderName', 'sequence', 'body', 'createdAt', 'attachments'])
  if (v.schoolId !== scope.schoolId || v.threadId !== context.id || !context.participants.some(item => item.memberId === v.senderMemberId)) return bad()
  const attachments = unique(array(v.attachments, item => {
    const file = exact(item, ['id', 'name', 'bytes', 'sha256', 'profile'])
    if (file.profile !== 'hwpx_basic_v1' || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !/\.hwpx$/i.test(String(file.name)) || /[\\/\u202a-\u202e\u2066-\u2069]/u.test(String(file.name))) return bad()
    return { id: identifier(file.id), name: text(file.name, 255), bytes: integer(file.bytes, 1, 30 * 1024 * 1024), sha256: file.sha256, profile: 'hwpx_basic_v1' as const }
  }, 20), item => item.id)
  const body = text(v.body, 50000, true)
  if (!body.trim() && !attachments.length) return bad()
  return { id: identifier(v.id), schoolId: scope.schoolId, threadId: context.id, senderMemberId: identifier(v.senderMemberId), senderName: text(v.senderName, 200), sequence: integer(v.sequence, 1, context.latestSequence), body, createdAt: timestamp(v.createdAt), attachments }
}
export function messages(value: unknown, scope: MessagingScope, threadId: string): MessagePage {
  const v = exact(value, ['thread', 'items', 'nextCursor']), context = thread(v.thread, scope, threadId)
  const result = page({ items: v.items, nextCursor: v.nextCursor }, item => message(item, scope, context), item => item.id)
  if (result.items.some((item, index) => index > 0 && item.sequence <= result.items[index - 1].sequence)) return bad()
  return { ...result, thread: context }
}
export function notice(value: unknown, scope: MessagingScope): InboxNotice {
  const v = exact(value, ['id', 'schoolId', 'ownerMemberId', 'title', 'body', 'createdAt', 'readAt', 'version', 'source'])
  if (v.schoolId !== scope.schoolId || v.ownerMemberId !== scope.memberId) return bad()
  let source: InboxNotice['source'] = null
  if (v.source !== null) {
    const raw = exact(v.source, ['module', 'id'])
    if (!['calendar', 'tasks', 'collections', 'messages', 'students', 'knowledge', 'cooperation'].includes(String(raw.module))) return bad()
    source = { module: raw.module as NonNullable<InboxNotice['source']>['module'], id: identifier(raw.id) }
  }
  return { id: identifier(v.id), schoolId: scope.schoolId, ownerMemberId: scope.memberId, title: text(v.title, 300), body: text(v.body, 4000, true), createdAt: timestamp(v.createdAt), readAt: v.readAt === null ? null : timestamp(v.readAt), version: integer(v.version, 1), source }
}
export function command(value: unknown, ownMemberId: string): MessageCommand {
  try {
    const v = object(value)
    if (v.kind === 'start') {
      exact(v, ['kind', 'mode', 'recipients', 'title', 'body', 'attachmentIds'])
      if (!['direct', 'group', 'individual'].includes(String(v.mode))) return bad()
      const recipients = unique(array(v.recipients, item => { const r = exact(item, ['memberId', 'expectedVersion']); return { memberId: identifier(r.memberId), expectedVersion: integer(r.expectedVersion, 1) } }, 500), item => item.memberId)
      if (!recipients.length || recipients.some(item => item.memberId === ownMemberId) || (v.mode === 'direct' && recipients.length !== 1) || (v.mode === 'group' && recipients.length < 2)) return bad()
      const attachmentIds = unique(array(v.attachmentIds, identifier, 20), item => item)
      const title = text(v.title, 1000, true).trim()
      if (v.mode === 'group' && !title) return bad()
      const body = text(v.body, 50000, true).trim()
      if (!body && !attachmentIds.length) return bad()
      return { kind: 'start', mode: v.mode as 'direct' | 'group' | 'individual', recipients: recipients.sort((a, b) => a.memberId.localeCompare(b.memberId)), title, body, attachmentIds }
    }
    if (v.kind === 'reply') {
      exact(v, ['kind', 'threadId', 'expectedVersion', 'recipientMemberIds', 'body', 'attachmentIds'])
      const attachmentIds = unique(array(v.attachmentIds, identifier, 20), item => item)
      const recipientMemberIds = unique(array(v.recipientMemberIds, identifier, 500), item => item).sort()
      if (!recipientMemberIds.length || recipientMemberIds.includes(ownMemberId)) return bad()
      const body = text(v.body, 50000, true).trim()
      if (!body && !attachmentIds.length) return bad()
      return { kind: 'reply', threadId: identifier(v.threadId), expectedVersion: integer(v.expectedVersion, 1), recipientMemberIds, body, attachmentIds }
    }
    if (v.kind === 'read_thread') { exact(v, ['kind', 'threadId', 'throughSequence']); return { kind: 'read_thread', threadId: identifier(v.threadId), throughSequence: integer(v.throughSequence) } }
    if (v.kind === 'read_notice') { exact(v, ['kind', 'noticeId', 'expectedVersion']); return { kind: 'read_notice', noticeId: identifier(v.noticeId), expectedVersion: integer(v.expectedVersion, 1) } }
    return bad()
  } catch { throw new MessagingError('INVALID_INPUT') }
}
export function receipt(value: unknown, sent: MessageCommand, key: string, self: string): MessageReceipt {
  const v = exact(value, ['requestKey', 'kind', 'recordedAt', 'deliveries', 'threadId', 'throughSequence', 'noticeId', 'version'])
  if (v.requestKey !== key || v.kind !== sent.kind) return bad()
  const deliveries = unique(array(v.deliveries, item => {
    const d = exact(item, ['threadId', 'messageId', 'recipientMemberIds', 'sequence'])
    const recipients = unique(array(d.recipientMemberIds, identifier, 500), item => item)
    if (!recipients.length || recipients.includes(self)) return bad()
    return { threadId: identifier(d.threadId), messageId: identifier(d.messageId), recipientMemberIds: recipients, sequence: integer(d.sequence, 1) }
  }, 500), item => item.threadId)
  if (new Set(deliveries.map(item => item.messageId)).size !== deliveries.length) return bad()
  if (sent.kind === 'start') {
    if (v.threadId !== null || v.throughSequence !== null || v.noticeId !== null || v.version !== null) return bad()
    const expected = sent.recipients.map(item => item.memberId).sort()
    const actual = deliveries.flatMap(item => item.recipientMemberIds).sort()
    if (JSON.stringify(expected) !== JSON.stringify(actual) || (sent.mode === 'individual' ? deliveries.length !== expected.length || deliveries.some(item => item.recipientMemberIds.length !== 1) : deliveries.length !== 1)) return bad()
  } else if (sent.kind === 'reply') {
    if (deliveries.length !== 1 || deliveries[0].threadId !== sent.threadId || v.threadId !== sent.threadId || v.throughSequence !== null || v.noticeId !== null || v.version !== null || JSON.stringify(deliveries[0].recipientMemberIds.slice().sort()) !== JSON.stringify(sent.recipientMemberIds.slice().sort())) return bad()
  } else if (sent.kind === 'read_thread') {
    if (deliveries.length || v.threadId !== sent.threadId || v.throughSequence !== sent.throughSequence || v.noticeId !== null || v.version !== null) return bad()
  } else if (deliveries.length || v.noticeId !== sent.noticeId || v.threadId !== null || v.throughSequence !== null || integer(v.version, sent.expectedVersion) < sent.expectedVersion) return bad()
  return { requestKey: key, kind: sent.kind, recordedAt: timestamp(v.recordedAt), deliveries, threadId: v.threadId === null ? null : identifier(v.threadId), throughSequence: v.throughSequence === null ? null : integer(v.throughSequence), noticeId: v.noticeId === null ? null : identifier(v.noticeId), version: v.version === null ? null : integer(v.version, 1) }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
