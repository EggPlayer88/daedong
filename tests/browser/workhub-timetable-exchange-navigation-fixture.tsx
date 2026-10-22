import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableExchangePanel } from '../../apps/workhub/src/timetable/TimetableExchangePanel'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import operationStyles from '../../apps/workhub/src/timetable/operations.css?inline'
const w: any = window, copy = (value: any) => structuredClone(value)
const now = Date.now(), future = new Date(now + 3 * 86400000).toISOString().slice(0, 10)
const time = (hour: number) => ({ startsAt: future + `T0${hour}:00:00.000Z`, endsAt: future + `T0${hour}:45:00.000Z` })
const member = { id: 'me', schoolId: 's', userId: 'u', name: '내 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const people = [{ id: 'me', name: '내 교사' }, { id: 'other', name: '상대 교사' }]
const lesson = (id: string, hour: number, teacher: any) => ({ id, version: 1, label: '국어', time: time(hour), teachers: [teacher], groupNames: ['1학년 1반'], roomNames: ['1반'], state: 'scheduled', canRequest: id === 'one', allowedTargets: [time(0), time(1)] })
const one = lesson('one', 0, people[0]), two = lesson('two', 1, people[1])
const changes = [{ before: one, after: { ...copy(one), time: time(1), version: 2 } }, { before: two, after: { ...copy(two), time: time(0), version: 2 } }]
const makeRequest = (id: string) => ({ id, version: 1, proposalHash: 'a'.repeat(64), state: 'awaiting_consent', kind: 'swap', requester: people[1], requesterIsViewer: false, createdAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 600000).toISOString(), reason: '교내 연수 ' + id, changes: copy(changes), participants: people.map(person => ({ ...person, response: person.id === 'me' ? 'pending' : 'accepted', respondedAt: person.id === 'me' ? null : new Date(now - 30000).toISOString() })), actions: ['accept', 'reject'] })
w.view = { asOf: new Date(now).toISOString(), timeZone: 'Asia/Seoul', from: new Date(now).toISOString().slice(0, 10), until: new Date(now + 28 * 86400000).toISOString().slice(0, 10), canPublish: false, canRequest: true, drafts: [], lessons: [one, two], requests: Array.from({ length: 25 }, (_, i) => makeRequest('req-' + String(i).padStart(2, '0'))), publications: [] }
w.view.requests[1] = { ...w.view.requests[1], state: 'applied', actions: [], participants: people.map(person => ({ ...person, response: 'accepted', respondedAt: new Date(now - 10000).toISOString() })) }
w.commands = []; w.consumed = 0; w.drafts = createEditDrafts(); w.locked = false; w.loading = false; w.previewCalls = 0
const server: any = { previewExchange: async (_: string, input: any) => { w.previewCalls++; return { input: copy(input), previewId: 'preview', previewHash: 'a'.repeat(64), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), changes: copy(changes), participants: people, blockers: [], complete: true } } }
const extensions: any = { recommendations: async () => ({ candidates: [], explanations: [], status: 'none_found' }) }
function Harness() {
  const [revision, refresh] = useState(0), [selection, select] = useState<any>()
  w.refresh = () => refresh(x => x + 1); w.openRequest = (requestId: string, token = Date.now()) => select({ requestId, token })
  const onCommand = async (command: any) => { w.commands.push(copy(command)); return { kind: command.kind, requestKey: 'request-key', commandHash: 'b'.repeat(64), entityId: command.requestId ?? 'new', version: 2, status: 'awaiting_approval', recordedAt: new Date().toISOString(), changedLessons: [] } as any }
  return <EditDraftsProvider store={w.drafts}><section className="timetable-operations"><style>{baseStyles}{operationStyles}</style><TimetableExchangePanel server={server} extensions={extensions} member={member as any} view={copy(w.view)} loading={w.loading} locked={w.locked} onCommand={onCommand} onDirtyChange={value => { w.dirty = value }} onReload={w.refresh} revision={revision} requestSelection={selection} onRequestSelectionConsumed={() => { w.consumed++ }} /></section></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<Harness />)
