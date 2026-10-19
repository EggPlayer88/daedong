import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableWorkspace } from '../../apps/workhub/src/timetable/TimetableWorkspace'
import { executionRecordCommandHash } from '../../apps/workhub/src/timetable/execution-records'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import appStyles from '../../apps/workhub/src/style.css?inline'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import styles from '../../apps/workhub/src/timetable/execution-records.css?inline'
const w: any = window, copy = (v: any) => structuredClone(v)
w.member = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.date = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
w.source = { asOf: new Date().toISOString(), timeZone: 'Asia/Seoul', lesson: { id: 'lesson', version: 1, label: '국어 1반', startsAt: w.date + 'T00:00:00.000Z', endsAt: w.date + 'T00:45:00.000Z', state: 'scheduled', teacherIds: ['member'] }, allowedOutcomes: ['completed', 'not_performed', 'needs_review'], current: null, history: [], nextCursor: null }
w.lesson = { id: 'lesson', version: 1, label: '국어 1반', time: { startsAt: w.source.lesson.startsAt, endsAt: w.source.lesson.endsAt }, teachers: [{ id: 'member', name: '합성 교사' }], groupNames: ['1반'], roomNames: ['1반 교실'], state: 'scheduled', canRequest: false, allowedTargets: [] }
w.calls = []; w.receipts = {}; w.commands = {}; w.changed = []; w.writes = 0; w.drafts = createEditDrafts(); w.pending = createPendingRequests(); w.locked = false
const envelope = (data: any) => ({ contract: 'timetable.execution-records.v1', schoolId: 'school', memberId: 'member', data }), failure = (code: string) => ({ contract: 'timetable.execution-records.v1', schoolId: 'school', memberId: 'member', error: { code } })
w.apply = async (command: any, key: string) => {
  const record = { id: w.source.current?.id ?? 'record', version: command.expectedRecordVersion + 1, lessonId: command.lessonId, lessonVersion: command.expectedLessonVersion, outcome: command.outcome, note: command.note, correctionReason: command.correctionReason, recordedBy: { id: 'member', name: '합성 교사' }, recordedAt: w.source.asOf }
  w.receipts[key] = { requestKey: key, commandHash: await executionRecordCommandHash(command), record }; w.commands[key] = copy(command); w.source.current = record; w.source.history.unshift(copy(record)); w.writes++; return w.receipts[key]
}
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: 'school' }, { id: 'other' }], basisDate: w.date }), getIdentity: async () => ({ userId: w.member.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args: copy(args) })
    const envelopeFor = (contract: string, data: any) => ({ contract, schoolId: 'school', memberId: 'member', data })
    if (name === 'workhub_timetable_readiness') return envelopeFor('timetable.v1', { available: false, reason: 'basis_missing' })
    if (name === 'workhub_timetable_operations_readiness') { if (w.failOperations) throw Error('운영조회 연결 실패'); return envelopeFor('timetable-operations.v1', { available: true }) }
    if (name === 'workhub_timetable_operations_get') { if (w.failOperations) throw Error('운영조회 연결 실패'); return envelopeFor('timetable-operations.v1', { asOf: w.source.asOf, timeZone: w.source.timeZone, from: args.p_from, until: args.p_until, canPublish: true, canRequest: false, drafts: [], lessons: [w.lesson, { ...w.lesson, id: 'lesson2', label: '영어 1반', time: { startsAt: w.date + 'T01:00:00.000Z', endsAt: w.date + 'T01:45:00.000Z' } }], requests: [], publications: [] }) }
    if (name === 'workhub_timetable_operations_references') return envelopeFor('timetable-operations.next.v1', { asOf: args.p_source_as_of, from: args.p_from, until: args.p_until, lessons: ['lesson', 'lesson2'].map(lessonId => ({ lessonId, version: 1, groups: [{ id: 'group', name: '1반' }], rooms: [{ id: 'room', name: '1반 교실' }] })) })
    if (!name.startsWith('workhub_timetable_execution_')) throw { code: 'PGRST202' }
    if (name.endsWith('_get')) { if (w.missing) throw { code: 'PGRST202' }; if (w.failGet) throw Error('offline'); return envelope(copy(w.source)) }
    if (name.endsWith('_history')) return envelope(copy(w.older))
    if (w.holdWrite) await new Promise<void>(resolve => w.releaseWrite = () => { w.holdWrite = false; resolve() })
    const command = args.p_command, key = args.p_request_key
    if (w.commands[key] && JSON.stringify(command) !== JSON.stringify(w.commands[key])) return failure('IDEMPOTENCY_CONFLICT')
    if (w.receipts[key]) return envelope(copy(w.receipts[key]))
    if (args.p_recover_only) return failure('NOT_FOUND')
    if (w.dropBefore) { w.dropBefore = false; throw Error('before') }
    if (command.expectedLessonVersion !== w.source.lesson.version || command.expectedRecordVersion !== (w.source.current?.version ?? 0)) return failure('CONFLICT')
    if (!w.source.allowedOutcomes.includes(command.outcome)) return failure('FORBIDDEN')
    const receipt = await w.apply(command, key)
    if (w.failAfter) w.failGet = true
    if (w.dropOnce) { w.dropOnce = false; throw Error('after') }
    return envelope(copy(receipt))
  },
}
function Harness() {
  const [revision, setRevision] = useState(0); w.refresh = () => setRevision(value => value + 1)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{appStyles + baseStyles + styles}</style><main><TimetableWorkspace connection={connection} member={w.member} date={w.date} revision={revision} onNavigationLockChange={value => w.locked = value} /></main></PendingRequestsProvider></EditDraftsProvider>
}
w.mount = () => { w.root = createRoot(document.getElementById('root')); w.root.render(<Harness />) }; w.mount()
