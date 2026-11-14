import './reset-fixture-checkpoint'
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableExecutionRecordsPanel } from '../../apps/workhub/src/timetable/TimetableExecutionRecordsPanel'
import { createTimetableExecutionRecordsServer } from '../../apps/workhub/src/timetable/execution-records-server'
import { executionRecordCommandHash } from '../../apps/workhub/src/timetable/execution-records'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'

// 실제 화면·실시 기록 파서를 실행한다. 계정과 RPC만 합성 자료이며 메모를 결과로 복제하지 않는다.
const w: any = window, copy = structuredClone, date = '2026-11-12', stamp = date + 'T03:00:00.000Z'
const member = { ...fixtureData.memberships[0], id: 'member', userId: 'user', name: '합성 담당교사', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31' }
const lessons = ['lesson-one', 'lesson-two'].map((id, index) => ({ id, version: 1, label: index ? '합성 영어' : '합성 국어',
  time: { startsAt: date + `T0${index}:00:00.000Z`, endsAt: date + `T0${index}:45:00.000Z` },
  teachers: [{ id: member.id, name: member.name }], groupNames: ['합성 학급'], roomNames: [], state: 'scheduled', canRequest: false, allowedTargets: [] }))
w.member = member; w.date = date; w.calls = []; w.results = []; w.listeners = []; w.changed = []; w.receipts = {}; w.writes = 0
w.pending = createPendingRequests(); w.drafts = createEditDrafts()
w.sources = Object.fromEntries(lessons.map(lesson => [lesson.id, { asOf: stamp, timeZone: 'Asia/Seoul',
  lesson: { id: lesson.id, version: lesson.version, label: lesson.label, startsAt: lesson.time.startsAt, endsAt: lesson.time.endsAt, state: lesson.state, teacherIds: [member.id] },
  allowedOutcomes: ['completed', 'not_performed', 'needs_review'], current: null, history: [], nextCursor: null }]))
const context = { schools: fixtureData.schools, memberships: [member], basisDate: date, schoolLabels: Object.fromEntries(fixtureData.schools.map(s => [s.id, relationLabels])) }
w.apply = async (command: any, key: string, actor = member.id) => {
  if (!w.receipts[key]) {
    const source = w.sources[command.lessonId]
    const record = { id: source.current?.id ?? 'record-' + command.lessonId, version: command.expectedRecordVersion + 1, lessonId: command.lessonId,
      lessonVersion: command.expectedLessonVersion, outcome: command.outcome, note: command.note, correctionReason: command.correctionReason,
      recordedBy: { id: actor, name: '결과에 복제하지 않을 교사' }, recordedAt: stamp }
    w.receipts[key] = { requestKey: key, commandHash: await executionRecordCommandHash(command), record }
    source.current = copy(record); source.history.unshift(copy(record)); w.writes++
  }
  return copy(w.receipts[key])
}
async function rpc(name: string, args: any) {
  w.calls.push({ name, args: copy(args) })
  const envelope = (contract: string, data: any) => ({ contract, schoolId: member.schoolId, memberId: args.p_member_id ?? member.id, data: copy(data) })
  const failure = (contract: string, code: string) => ({ contract, schoolId: member.schoolId, memberId: args.p_member_id ?? member.id, error: { code } })
  if (name === 'workhub_context') return context
  if (name === 'workhub_calendar_list' || name === 'workhub_task_list') return []
  if (name === 'workhub_timetable_operations_readiness') return envelope('timetable-operations.v1', { available: true })
  if (name === 'workhub_timetable_operations_get') return envelope('timetable-operations.v1', { asOf: stamp, timeZone: 'Asia/Seoul', from: args.p_from, until: args.p_until,
    canPublish: false, canRequest: false, drafts: [], lessons, requests: [], publications: [] })
  if (name === 'workhub_timetable_operations_references') return envelope('timetable-operations.next.v1', { asOf: args.p_source_as_of, from: args.p_from, until: args.p_until,
    lessons: lessons.map(lesson => ({ lessonId: lesson.id, version: 1, groups: [{ id: 'group', name: '합성 학급' }], rooms: [] })) })
  if (name === 'workhub_timetable_execution_get') {
    if (w.failGet) throw Error('합성 후속 조회 실패')
    return envelope('timetable.execution-records.v1', w.sources[args.p_lesson_id])
  }
  if (name === 'workhub_timetable_execution_history') return envelope('timetable.execution-records.v1', w.older)
  if (name === 'workhub_timetable_operations_abandon') {
    const received = w.receipts[args.p_request_key] ?? (w.lateApplyOnClose ? await w.apply(args.p_command, args.p_request_key) : null)
    const result = { kind: 'execution', requestKey: args.p_request_key, commandHash: await executionRecordCommandHash(args.p_command),
      outcome: received ? 'applied' : 'abandoned', receipt: received, decidedAt: stamp }
    if (w.closeDrop) { w.closeDrop = false; throw Error('닫기 응답 유실') }
    if (w.holdWrite) await new Promise(resolve => { w.releaseWrite = resolve })
    return envelope('timetable-operations.abandon.v1', result)
  }
  if (name === 'workhub_timetable_execution_record') {
    const command = args.p_command, key = args.p_request_key, contract = 'timetable.execution-records.v1'
    let result = w.receipts[key] ? copy(w.receipts[key]) : undefined
    if (!result) {
      if (args.p_recover_only) return failure(contract, 'NOT_FOUND')
      if (w.reject) return failure(contract, w.reject)
      if (w.dropBefore) { w.dropBefore = false; throw Error('접수 전 응답 유실') }
      const source = w.sources[command.lessonId]
      if (source.lesson.version !== command.expectedLessonVersion || (source.current?.version ?? 0) !== command.expectedRecordVersion) return failure(contract, 'CONFLICT')
      result = await w.apply(command, key, args.p_member_id)
    }
    if (w.failAfter) w.failGet = true
    if (w.dropOnce) { w.dropOnce = false; throw Error('접수 후 응답 유실') }
    if (w.badReceipt) Object.assign(result, copy(w.badReceipt))
    if (w.badRecord) Object.assign(result.record, copy(w.badRecord))
    if (w.holdWrite) await new Promise(resolve => { w.releaseWrite = resolve })
    return envelope(contract, result)
  }
  throw { code: 'PGRST202' }
}
const makeConnection = () => ({ info: () => ({ memberships: [{ ...w.member, role: w.changedRole ?? w.member.role }], schools: fixtureData.schools, basisDate: w.date }),
  getIdentity: async () => ({ userId: w.member.userId, approved: true }), rpcVerified: rpc })
function Harness() {
  const [epoch, setEpoch] = useState(0), [date, setDate] = useState(w.date), [self, setMember] = useState(member), [selected, setSelected] = useState('lesson-one')
  const [mounted, setMounted] = useState(true), [listener, setListener] = useState('original')
  const server = useMemo(() => createTimetableExecutionRecordsServer(makeConnection() as any), [epoch])
  w.ui = { epoch, date, memberId: self.id, selected, mounted, listener }
  w.replaceConnection = () => setEpoch(v => v + 1); w.changeDate = () => { w.date = '2026-11-13'; setDate(w.date) }
  w.switchAccount = () => { w.member = { ...member, id: 'other-member', userId: 'other-user' }; setMember(w.member) }
  w.changeSource = () => setSelected('lesson-two'); w.restoreSource = () => setSelected('lesson-one')
  w.changeListener = () => setListener('new'); w.unmount = () => setMounted(false); w.remount = () => setMounted(true)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>{mounted && <TimetableExecutionRecordsPanel
    member={self as any} date={date} lesson={lessons.find(lesson => lesson.id === selected) as any} server={server} onLockChange={value => { w.locked = value }}
    onRecorded={receipt => { w.changed.push(copy(receipt)); if (w.changedThrows) throw Error('후속 화면 갱신 실패') }} onWorkflowResult={result => {
      w.results.push(copy(result)); w.listeners.push(listener); if (w.resultThrows) throw Error('보조 표시 실패')
    }} />}</PendingRequestsProvider></EditDraftsProvider>
}
const services: any = { getSession: async () => ({ user: { id: member.userId } }), fetchMyProfile: async () => ({ id: member.userId, name: member.name, email: 'synthetic@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: true }),
  onAuthStateChange() { return () => {} }, async signOut() {}, async signInWithGoogle() {}, async rpc(name: string, args: any) { try { return { data: await rpc(name, args), error: null } } catch (error) { return { data: null, error } } } }
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('connected')
  ? <ConnectedWorkspace expectedUserId={member.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)} /> : <Harness />)
