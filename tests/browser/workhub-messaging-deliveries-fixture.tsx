import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MessagingWorkspace } from '../../apps/workhub/src/messaging/MessagingWorkspace'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'

// 실제 React와 Supabase 어댑터를 사용하고, RPC 왕복만 합성 응답으로 대신한다.
const qa: any = { calls: [], writes: 0, saved: new Map(), unknown: false, defer: false, denied: false, drafts: createEditDrafts(), pending: createPendingRequests() }
;(window as any).qa = qa
const now = '2026-10-21T00:00:00.000Z', date = '2026-10-21'
let current = { id: 'self', userId: 'user', schoolId: 'school', name: '나', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const person = (id: string) => ({ memberId: id, schoolId: current.schoolId, name: id === 'self' ? '나' : '김교사', department: id === 'self' ? '' : '교무부', version: 1 })
const envelope = (data: unknown) => ({ contractVersion: 1, schoolId: current.schoolId, memberId: current.id, userId: current.userId, ok: true, data })
const failure = (code: string) => ({ contractVersion: 1, schoolId: current.schoolId, memberId: current.id, userId: current.userId, ok: false, error: { code } })
const threads = new Map<string, any>(), messages = new Map<string, any[]>()
function receipt(command: any, key: string) {
  const ids = command.kind === 'start' ? command.recipients.map((r: any) => r.memberId) : command.recipientMemberIds
  const deliveries = command.kind === 'start' ? command.mode === 'individual'
    ? ids.slice().reverse().map((id: string) => ({ threadId: `thread-${id}`, messageId: `message-${key}-${id}`, recipientMemberIds: [id], sequence: 1 }))
    : [{ threadId: command.mode === 'group' ? 'thread-group' : `thread-${ids[0]}`, messageId: `message-${key}`, recipientMemberIds: ids, sequence: 1 }]
    : command.kind === 'reply' ? [{ threadId: command.threadId, messageId: `message-${key}`, recipientMemberIds: ids, sequence: 2 }] : []
  for (const delivery of deliveries) {
    threads.set(delivery.threadId, { id: delivery.threadId, schoolId: current.schoolId, kind: delivery.recipientMemberIds.length > 1 ? 'group' : 'direct', title: command.title || '', participants: [person('self'), ...delivery.recipientMemberIds.map(person)], version: 1, latestSequence: delivery.sequence, readSequence: 0, unreadCount: 0, updatedAt: now, canSend: true })
    messages.set(delivery.threadId, [{ id: delivery.messageId, schoolId: current.schoolId, threadId: delivery.threadId, senderMemberId: current.id, senderName: current.name, sequence: delivery.sequence, body: `${command.body} (${delivery.threadId})`, createdAt: now, attachments: [] }])
  }
  return { requestKey: key, kind: command.kind, recordedAt: now, deliveries, threadId: ['reply', 'read_thread'].includes(command.kind) ? command.threadId : null, throughSequence: command.kind === 'read_thread' ? command.throughSequence : null, noticeId: command.kind === 'read_notice' ? command.noticeId : null, version: command.kind === 'read_notice' ? command.expectedVersion + 1 : null }
}
const connection: any = {
  info: () => ({ memberships: [structuredClone(current)], schools: [{ id: current.schoolId, name: '연습 학교' }], basisDate: date }),
  getIdentity: async () => ({ userId: current.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    qa.calls.push({ name, args: structuredClone(args) })
    if (name === 'workhub_messaging_readiness') return envelope({ available: true, reason: 'ready', limits: { bodyCharacters: 2000, titleCharacters: 100, recipients: 50 }, attachments: 'not_configured' })
    if (name === 'workhub_message_recipients') return envelope({ items: ['recipient-a', 'recipient-b'].map(person), nextCursor: null })
    if (name === 'workhub_message_threads' || name === 'workhub_inbox_list') return envelope({ items: [], nextCursor: null })
    if (name === 'workhub_message_get') {
      if (qa.denied) return failure('FORBIDDEN')
      const thread = threads.get(args.p_thread_id)
      if (!thread) return failure('NOT_FOUND')
      return envelope({ thread: structuredClone(thread), items: structuredClone(messages.get(thread.id)), nextCursor: null })
    }
    if (name === 'workhub_message_mutate') {
      if (qa.saved.has(args.p_request_key)) return envelope(structuredClone(qa.saved.get(args.p_request_key)))
      const result = receipt(args.p_command, args.p_request_key)
      qa.saved.set(args.p_request_key, structuredClone(result)); qa.writes++
      if (qa.unknown) { qa.unknown = false; throw new Error('응답 유실') }
      if (qa.defer) { qa.defer = false; await new Promise(resolve => { qa.release = resolve }) }
      return envelope(result)
    }
    throw new Error(`예상하지 않은 RPC: ${name}`)
  },
}
function App() {
  const [member, setMember] = useState(current), [mounted, setMounted] = useState(true), [activeConnection, setConnection] = useState(connection)
  qa.unmount = () => setMounted(false); qa.remount = () => setMounted(true)
  qa.replaceConnection = () => setConnection({ ...connection })
  qa.changeScope = () => { current = { ...current, id: 'other-self', userId: 'other-user', schoolId: 'other-school' }; setMember(current) }
  return <EditDraftsProvider store={qa.drafts}><PendingRequestsProvider store={qa.pending}>{mounted && <MessagingWorkspace connection={activeConnection} member={member as any} date={date} onNavigationLockChange={value => { qa.locked = value }} />}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
