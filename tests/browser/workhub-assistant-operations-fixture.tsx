import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AssistantPanel } from '../../apps/workhub/src/assistant/AssistantPanel'
import { AssistantError, type AssistantServer } from '../../apps/workhub/src/assistant/contracts'
import { prepareTaskOperation, prepareCalendarOperation, executeWorkspaceOperation } from '../../apps/workhub/src/assistant/workspace-operations'
import type { AssistantWorkspaceActions } from '../../apps/workhub/src/assistant/workspace-model'
import { buildAssistantCalendarDraft } from '../../apps/workhub/src/calendar/assistant-draft'
import { TaskError } from '../../apps/workhub/src/tasks/contracts'
import { ContractError, type Membership } from '../../apps/workhub/src/contracts'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'

const w = window as any
let member: Membership = { id: 'member-one', userId: 'user-one', schoolId: 'school-one', name: '합성 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.epoch = 0; w.calls = []; w.opened = []; w.aiCalls = 0; w.applied = 0; w.unknown = false; w.deferGet = false
w.pending = createPendingRequests(); w.memory = createEditDrafts()
w.task = { id: 'task-one', schoolId: member.schoolId, ownerMemberId: member.id, title: '제출 자료 확인', notes: '기존 메모', dueDate: '2026-11-18', status: 'doing', version: 2 }
const receipts = new Map<string, any>()
function mutateTask(kind: 'update' | 'status', memberId: string, taskId: string, input: any, expectedVersion: number, key: string) {
  w.calls.push({ kind, memberId, taskId, input: structuredClone(input), expectedVersion, key })
  if (receipts.has(key)) return structuredClone(receipts.get(key))
  if (w.task.id !== taskId || w.task.version !== expectedVersion) throw new TaskError('CONFLICT', '원본이 변경되었습니다.')
  w.task = { ...w.task, ...(kind === 'update' ? input : { status: input }), version: expectedVersion + 1 }
  receipts.set(key, structuredClone(w.task)); w.applied++
  if (w.unknown) { w.unknown = false; throw new TaskError('SAVE_FAILED', '저장 응답을 확인하지 못했습니다.') }
  return structuredClone(w.task)
}
const adapters: any = {
  task: {
    async get(memberId: string, taskId: string) {
      w.calls.push({ kind: 'get', memberId, taskId })
      if (w.deferGet) await new Promise<void>(resolve => { w.releaseGet = resolve })
      return structuredClone(w.task)
    },
    async update(memberId: string, taskId: string, input: any, expectedVersion: number, key: string) { return mutateTask('update', memberId, taskId, input, expectedVersion, key) },
    async setStatus(memberId: string, taskId: string, status: string, expectedVersion: number, key: string) { return mutateTask('status', memberId, taskId, status, expectedVersion, key) },
  },
  calendar: {
    async save(memberId: string, command: any) {
      w.calls.push({ kind: 'calendar', memberId, command: structuredClone(command) })
      if (receipts.has(command.idempotencyKey)) return structuredClone(receipts.get(command.idempotencyKey))
      const result = { ...structuredClone(command.draft), id: 'event-one', schoolId: member.schoolId, authorMemberId: memberId, version: 1, updatedAt: '2026-11-11T01:00:00Z' }
      receipts.set(command.idempotencyKey, result); w.applied++
      if (w.unknown) { w.unknown = false; throw new ContractError('SAVE_FAILED', '일정 저장 응답을 확인하지 못했습니다.') }
      return structuredClone(result)
    },
  },
}
const connection: any = { info: () => ({ schools: [{ id: member.schoolId }], memberships: [member], basisDate: '2026-11-11' }), getIdentity: async () => ({ userId: member.userId, approved: true }) }
const server: AssistantServer = {
  readiness: async () => ({ available: true }),
  list: async () => ({ items: [], nextCursor: null }),
  get: async () => { throw new AssistantError('NOT_FOUND') },
  ask: async () => { w.aiCalls++; throw new AssistantError('NOT_READY') },
  confirmTask: async () => { throw new AssistantError('NOT_READY') },
}
const settingsServer: any = { status: async () => { throw new AssistantError('NOT_READY') } }
function App() {
  const [show, setShow] = useState(true), [date, setDate] = useState('2026-11-11'), [revision, setRevision] = useState(0)
  w.setShow = setShow; w.advanceDate = () => setDate('2026-11-12')
  w.switchAccount = () => { w.epoch++; member = { ...member, id: 'member-two', userId: 'user-two', schoolId: 'school-two' }; setRevision(value => value + 1) }
  const actions: AssistantWorkspaceActions = {
    navigate: () => true,
    open: item => { w.opened.push(structuredClone(item)); return true },
    calendar: () => true,
    search: async query => ({ items: w.task.title.includes(query) ? [{ kind: 'task', id: w.task.id, title: w.task.title, description: w.task.notes, meta: '나만 보는 업무', version: w.task.version, date: w.task.dueDate }] : [], coverage: ['현재 소속 본인의 개인 업무'], hasMore: false }),
    operations: {
      prepareTask: (command, item) => prepareTaskOperation(adapters.task, { key: crypto.randomUUID(), schoolId: member.schoolId, memberId: member.id, basisDate: date, taskId: item.id, title: item.title, expectedVersion: item.version!, change: command.change }, member, date),
      prepareCalendar: async command => prepareCalendarOperation({ id: crypto.randomUUID(), schoolId: member.schoolId, memberId: member.id, draft: buildAssistantCalendarDraft(command, member, date) }, member, date),
      execute: (review, retry) => {
        const epoch = w.epoch
        return executeWorkspaceOperation(review, adapters, member, date, { retry, isCurrent: () => epoch === w.epoch })
      },
    },
  }
  return <EditDraftsProvider store={w.memory}><PendingRequestsProvider store={w.pending}>
    {show && <AssistantPanel connection={connection} member={member} date={date} revision={revision} server={server} settingsServer={settingsServer} workspaceActions={actions} onNavigationLockChange={locked => { w.locked = locked }} />}
  </PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
