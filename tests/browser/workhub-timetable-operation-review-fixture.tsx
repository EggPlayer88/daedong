import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { OperationChangeList } from '../../apps/workhub/src/timetable/OperationChangeList'
import { TimetableOperationsPanel } from '../../apps/workhub/src/timetable/TimetableOperationsWorkspace'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import style from '../../apps/workhub/src/timetable/operations.css?inline'
const w: any = window, params = new URLSearchParams(location.search), mode = params.get('mode') ?? 'review'
const member = { id: 'm', schoolId: 's', userId: 'u', name: '합성 교사', role: 'admin' as const, active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.drafts = createEditDrafts(); w.pending = createPendingRequests(); w.calls = []
const base = { id: 'one', version: 1, label: '국어', time: { startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-01T00:45:00.000Z' }, teachers: [{ id: 'm', name: '김교사' }], groupNames: ['1학년 1반'], roomNames: ['교실'], state: 'scheduled' as const, canRequest: true, allowedTargets: [] }
w.changes = Array.from({ length: 45 }, (_, index) => ({ before: null, after: { ...base, id: 'lesson-' + index, label: index === 44 ? '마지막 체육' : '국어', teachers: [{ id: index === 44 ? 'other' : 'm', name: '김교사' }], groupNames: [index === 44 ? '3학년 2반' : '1학년 1반'] } }))
w.view = { asOf: new Date().toISOString(), timeZone: 'Asia/Seoul', from: '2026-10-19', until: '2026-11-16', canPublish: mode !== 'forbidden', canRequest: true, drafts: [{ id: 'draft-a', version: mode === 'stale' ? 3 : 2, title: '저장한 초안' }], lessons: [], requests: [], publications: [] }
w.link = { id: 'draft-a', version: 2 }
const source = { readiness: async () => { w.calls.push('readiness'); return { available: true as const } }, get: async (_member: string, from: string, until: string) => { w.calls.push('get'); return { ...w.view, from, until } }, previewPublish: async () => { w.calls.push('preview'); throw Error('자동 미리보기 금지') }, execute: async () => { w.calls.push('execute'); throw Error('자동 확정 금지') } }
if (mode === 'draft') w.drafts.bind(recoveryScope(member), 'timetable-publish').save({ draftId: 'existing', draftVersion: 1, from: '2026-10-30', lastDay: '2026-11-30', dirty: true })
if (mode === 'pending') w.pending.put(recoveryScope(member), 'timetableOperations', { key: 'original-key', command: { kind: 'action', requestId: 'request-existing', expectedVersion: 1, proposalHash: 'a'.repeat(64), action: 'accept' } })
function Harness() { const [revision, setRevision] = useState(0); w.refresh = () => setRevision(value => value + 1); return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{style}</style>{mode === 'review' ? <OperationChangeList changes={w.changes} timeZone="Asia/Seoul" /> : <TimetableOperationsPanel member={member} server={source as any} date="2026-10-19" revision={revision} initialDraftId={w.link.id} initialDraftVersion={w.link.version} onInitialDraftConsumed={() => { w.consumed = (w.consumed ?? 0) + 1; w.link = {} }} />}</PendingRequestsProvider></EditDraftsProvider> }
createRoot(document.getElementById('root')!).render(<Harness />)
