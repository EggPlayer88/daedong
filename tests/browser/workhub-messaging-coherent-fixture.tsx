import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceShell } from '../../apps/workhub/src/app/WorkspaceShell'
import { MessagingWorkspace } from '../../apps/workhub/src/messaging/MessagingWorkspace'
import { MessagingError, type MessagingServer, type Recipient, type ThreadSummary, type MessageCommand, type MessageReceipt } from '../../apps/workhub/src/messaging/contracts'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'
import type { Membership } from '../../apps/workhub/src/contracts'
import base from '../../apps/workhub/src/style.css?inline'

const w = window as any
const member: Membership = { id: 'my-member', userId: 'my-user', schoolId: 'school-one', name: '김서연', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const people: Recipient[] = [{ memberId: 'peer-kim', schoolId: member.schoolId, name: '김민준', department: '교무부', version: 2 }, { memberId: 'peer-lee', schoolId: member.schoolId, name: '이소연', department: '교육연구부', version: 1 }, { memberId: 'peer-park', schoolId: member.schoolId, name: '박지훈', department: '학생안전부', version: 3 }]
const self: Recipient = { memberId: member.id, schoolId: member.schoolId, name: member.name, department: '교무부', version: 1 }
const time = '2026-11-25T03:20:00.000Z'
const threads: ThreadSummary[] = [{ id: 'thread-planning', schoolId: member.schoolId, kind: 'group', title: '학년 협의회 준비', participants: [self, ...people.slice(0, 2)], version: 3, latestSequence: 2, readSequence: 0, unreadCount: 2, updatedAt: time, canSend: true }, { id: 'thread-safety', schoolId: member.schoolId, kind: 'direct', title: '', participants: [self, people[2]], version: 1, latestSequence: 1, readSequence: 1, unreadCount: 0, updatedAt: time, canSend: true }]
w.qa = { writes: [], applied: 0, unknown: false, recipientFailure: false, pending: createPendingRequests(), drafts: createEditDrafts() }
const receipts = new Map<string, MessageReceipt>()
function receipt(command: MessageCommand, key: string): MessageReceipt {
  const ids = command.kind === 'start' ? command.recipients.map(person => person.memberId) : command.kind === 'reply' ? command.recipientMemberIds : []
  return { requestKey: key, kind: command.kind, recordedAt: time, deliveries: command.kind === 'start' ? command.mode === 'individual' ? ids.map(id => ({ threadId: 'sent-' + id, messageId: 'message-' + id, recipientMemberIds: [id], sequence: 1 })) : [{ threadId: 'sent-group', messageId: 'message-group', recipientMemberIds: ids, sequence: 1 }] : command.kind === 'reply' ? [{ threadId: command.threadId, messageId: 'message-reply', recipientMemberIds: ids, sequence: 3 }] : [], threadId: command.kind === 'reply' || command.kind === 'read_thread' ? command.threadId : null, throughSequence: command.kind === 'read_thread' ? command.throughSequence : null, noticeId: command.kind === 'read_notice' ? command.noticeId : null, version: command.kind === 'read_notice' ? command.expectedVersion + 1 : null }
}
const server: MessagingServer = {
  readiness: async () => ({ available: true, reason: 'ready', attachments: 'not_configured', limits: { bodyCharacters: 2000, titleCharacters: 100, recipients: 30 } }),
  recipients: async (_, query) => { if (w.qa.recipientFailure) throw new MessagingError('QUERY_FAILED'); return { items: structuredClone(people.filter(person => (person.name + person.department).includes(query))), nextCursor: null } },
  threads: async (_, query) => ({ items: structuredClone(threads.filter(thread => (thread.title + thread.participants.map(person => person.name).join(' ')).includes(query))), nextCursor: null }),
  messages: async (_, id) => ({ thread: structuredClone(threads.find(thread => thread.id === id) ?? threads[0]), items: [
    { id: 'message-1', schoolId: member.schoolId, threadId: id, senderMemberId: people[0].memberId, senderName: people[0].name, sequence: 1, body: '다음 주 학년 협의회 자료를 공유합니다.\n담당하신 내용을 확인하고 금요일까지 의견을 부탁드립니다.', createdAt: time, attachments: [] },
    { id: 'message-2', schoolId: member.schoolId, threadId: id, senderMemberId: member.id, senderName: member.name, sequence: 2, body: '자료 확인했습니다. 학급별 준비 사항을 정리해서 공유하겠습니다.', createdAt: time, attachments: [] },
  ], nextCursor: null }),
  inbox: async () => ({ items: [], nextCursor: null }),
  mutate: async (_, command, key) => {
    w.qa.writes.push(structuredClone({ command, key }))
    if (receipts.has(key)) return structuredClone(receipts.get(key)!)
    const result = receipt(command, key); receipts.set(key, result); w.qa.applied++
    if (w.qa.unknown) { w.qa.unknown = false; throw new MessagingError('RESULT_UNKNOWN') }
    return structuredClone(result)
  },
}
function App() {
  const [visible, setVisible] = useState(true)
  w.qa.setVisible = setVisible
  return <EditDraftsProvider store={w.qa.drafts}><PendingRequestsProvider store={w.qa.pending}><style>{base}</style><WorkspaceShell page="messages" mode="connected" schoolName="가온중학교 · 합성 자료" memberName={member.name} onNavigate={() => {}}><main className="main-content"><header className="page-header"><div><h1>메시지와 알림</h1><p>동료 교사와 메시지를 주고받고 업무 알림을 확인합니다.</p></div></header>{visible && <MessagingWorkspace connection={{} as any} server={server} member={member} date="2026-11-25" onNavigationLockChange={value => { w.qa.locked = value }} />}</main></WorkspaceShell></PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
