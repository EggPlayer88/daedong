import React from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableExecutionRecordsPanel } from '../../apps/workhub/src/timetable/TimetableExecutionRecordsPanel'
import { createTimetableExecutionRecordsServer } from '../../apps/workhub/src/timetable/execution-records-server'
import { executionRecordCommandHash } from '../../apps/workhub/src/timetable/execution-records'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import appStyles from '../../apps/workhub/src/style.css?inline'
import baseStyles from '../../apps/workhub/src/timetable/timetable.css?inline'
import styles from '../../apps/workhub/src/timetable/execution-records.css?inline'
const w: any = window, copy = (v: any) => structuredClone(v)
w.member = { id: 'member', schoolId: 'school', userId: 'user', name: '합성 교사', role: 'teacher', active: true, validFrom: '2026-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.source = { asOf: '2026-10-19T09:00:00.000Z', timeZone: 'Asia/Seoul', lesson: { id: 'lesson', version: 1, label: '국어 1반', startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-10-19T00:45:00.000Z', state: 'scheduled', teacherIds: ['member'] }, allowedOutcomes: ['completed', 'not_performed', 'needs_review'], current: null, history: [], nextCursor: null }
w.lesson = { id: 'lesson', version: 1, label: '국어 1반', time: { startsAt: w.source.lesson.startsAt, endsAt: w.source.lesson.endsAt }, teachers: [{ id: 'member', name: '합성 교사' }], groupNames: ['1반'], roomNames: ['1반 교실'], state: 'scheduled', canRequest: false, allowedTargets: [] }
w.calls = []; w.receipts = {}; w.commands = {}; w.changed = []; w.writes = 0; w.drafts = createEditDrafts(); w.pending = createPendingRequests(); w.locked = false
const envelope = (data: any) => ({ contract: 'timetable.execution-records.v1', schoolId: 'school', memberId: 'member', data }), failure = (code: string) => ({ contract: 'timetable.execution-records.v1', schoolId: 'school', memberId: 'member', error: { code } })
w.apply = async (command: any, key: string) => {
  const record = { id: w.source.current?.id ?? 'record', version: command.expectedRecordVersion + 1, lessonId: command.lessonId, lessonVersion: command.expectedLessonVersion, outcome: command.outcome, note: command.note, correctionReason: command.correctionReason, recordedBy: { id: 'member', name: '합성 교사' }, recordedAt: w.source.asOf }
  w.receipts[key] = { requestKey: key, commandHash: await executionRecordCommandHash(command), record }; w.commands[key] = copy(command); w.source.current = record; w.source.history.unshift(copy(record)); w.writes++; return w.receipts[key]
}
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: 'school' }, { id: 'other' }], basisDate: '2026-10-19' }), getIdentity: async () => ({ userId: w.member.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args: copy(args) })
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
w.server = createTimetableExecutionRecordsServer(connection, { now: () => Date.parse('2026-10-19T10:00:00.000Z') })
w.render = () => w.root.render(<EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{appStyles + baseStyles + styles}</style><main><TimetableExecutionRecordsPanel member={w.member} lesson={w.noLesson ? undefined : w.lesson} server={w.noServer ? undefined : w.server} disabled={Boolean(w.disabled)} refreshKey={w.refreshKey ?? 0} onLockChange={value => w.locked = value} onRecorded={receipt => w.changed.push(copy(receipt))} /><button type="button">기존 시간표 메뉴</button></main></PendingRequestsProvider></EditDraftsProvider>)
w.mount = () => { w.root = createRoot(document.getElementById('root')); w.render() }; w.mount()
