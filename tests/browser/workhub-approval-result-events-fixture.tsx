import React, {useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {SchoolAdministration} from '../../apps/workhub/src/administration/SchoolAdministration'
import {TimetableInterventionsPanel} from '../../apps/workhub/src/timetable/TimetableInterventionsPanel'
import {createTimetableInterventionsServer} from '../../apps/workhub/src/timetable/interventions-server'
import {interventionHash} from '../../apps/workhub/src/timetable/interventions-domain'
import {createEditDrafts, EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests, PendingRequestsProvider, recoveryScope} from '../../apps/workhub/src/app/pending-requests'

// React와 기존 응답 검증 어댑터는 실제 코드다. 접수 원장·학교 자료만 합성한다.
const w: any = window, copy = (value: any) => structuredClone(value), stamp = () => new Date().toISOString()
const person = (id = 'teacher') => ({id, name: id === 'teacher' ? '원담당 교사' : id === 'substitute' ? '대강 교사' : '승인 교사'})
w.date = new Date().toISOString().slice(0, 10)
w.future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
const time = {startsAt: w.future + 'T01:00:00.000Z', endsAt: w.future + 'T01:45:00.000Z'}
w.member = {...person('manager'), userId: 'user', schoolId: 'school', role: 'admin', active: true, validFrom: '2020-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: []}
w.calls = []; w.results = []; w.receipts = new Map(); w.writes = 0; w.pending = createPendingRequests(); w.drafts = createEditDrafts(); w.approved = true
w.formal = true; w.transitionState = 'pending'; w.transitionVersion = 2
Object.assign(w, w.fixtureOptions ?? {})
const contract = () => w.kind === 'intervention' ? 'timetable-interventions.v1' : 'school-transitions.v1'
const envelope = (data: any) => ({contract: contract(), schoolId: w.member.schoolId, memberId: w.member.id, data})
const fault = (code: string) => ({contract: contract(), schoolId: w.member.schoolId, memberId: w.member.id, error: {code}})
function seedRequest(kind = 'substitute', state = 'awaiting_approval') {
  const before: any = {id: 'lesson', version: 1, label: '국어 1회', time, teachers: [person()], groupNames: ['1-1'], roomNames: ['1-1'], state: ['makeup', 'reopen'].includes(kind) ? 'cancelled' : 'scheduled', canRequest: false, allowedTargets: []}
  const after = {...copy(before), version: 2}
  if (kind === 'substitute') after.teachers = [person('substitute')]
  if (kind === 'cancel') after.state = 'cancelled'
  if (kind === 'makeup') { after.id = 'makeup-lesson'; after.version = 1; after.state = 'scheduled' }
  if (kind === 'reopen') after.state = 'scheduled'
  const input = kind === 'reopen' ? {kind, schoolDayChangeId: 'closure', reason: '확인한 변경 사유'} : {kind, lessonId: 'lesson', expectedVersion: 1, reason: '확인한 변경 사유', ...(kind === 'substitute' ? {substituteTeacherId: 'substitute'} : kind === 'makeup' ? {target: time} : {})}
  const changed = {before: kind === 'makeup' ? null : before, after}
  const participants = [...new Map([...(changed.before?.teachers ?? []), ...after.teachers].map((row: any) => [row.id, row])).values()].map((row: any) => ({...row, response: 'accepted', respondedAt: stamp()}))
  w.lesson = copy(before); w.closures = kind === 'reopen' ? [{id: 'closure', date: w.future, reason: '휴업', lessonIds: ['lesson'], reopened: false}] : []
  w.requests = [{id: 'request', version: 3, proposalHash: 'a'.repeat(64), state, kind, input, requester: person(), requesterIsViewer: false, createdAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), reason: input.reason, changes: [changed], participants, actions: state === 'awaiting_approval' ? ['approve', 'rejectApproval'] : []}]
  w.refresh?.()
}
seedRequest(w.operationKind ?? 'substitute')
w.seedRequest = seedRequest
function catalog() {
  const waiting = w.transitionState === 'awaiting_admin', pending = w.transitionState === 'pending'
  return {canManageYear: true, dutyApproval: 'admin_review_v1', years: [{id: 'year', year: 2026, label: '2026학년도'}], recipients: [{memberId: 'next', name: '인수 교사', version: 1}], resources: [{kind: w.formal ? 'duty' : 'collection', id: 'resource', version: 1, label: '공식 담당'}], records: w.omitRecords ? [] : [{id: 'handover', kind: 'handover', title: '확인할 인계', version: w.transitionVersion, state: w.transitionState, canAccept: pending, canCancel: waiting || pending, summary: ['선택한 업무 1건'], requesterMemberId: 'sender', requiresAdminReview: w.formal, canAdminReview: waiting, adminReview: w.formal && !waiting ? {memberId: 'reviewer', name: '관리자', decision: 'confirmed', reason: '현재 담당 확인', recordedAt: '2026-10-16T01:00:00Z'} : null}], nextCursor: null}
}
const connection: any = {
  info: () => ({memberships: [w.member], schools: [{id: w.member.schoolId}], basisDate: w.date}),
  getIdentity: async () => ({userId: w.member.userId, approved: w.approved}),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({name, args: copy(args)})
    if (name.endsWith('_readiness')) return envelope({available: true, reason: null})
    if (name.endsWith('_get')) return envelope({asOf: stamp(), timeZone: 'Asia/Seoul', from: args.p_from, until: args.p_until, lessons: [copy(w.lesson)], teachers: [person(), person('substitute')], closures: copy(w.closures), requests: w.omitRecords ? [] : copy(w.requests)})
    if (name.endsWith('_list')) { if (w.failRead) throw Error('합성 조회 실패'); return envelope(catalog()) }
    if (name.endsWith('_preview')) {
      if (w.holdPreview) await new Promise(resolve => { w.releasePreview = resolve })
      w.previewDelivered = true
      return envelope({fingerprint: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', summary: ['확인한 대상 1건'], excluded: ['개인 상담과 학생 자료'], affectedCount: 1})
    }
    const command = args.p_command, key = args.p_request_key
    if (name.endsWith('_close')) return envelope({requestKey: key, commandHash: await interventionHash(command), decidedAt: stamp(), outcome: w.receipts.has(key) ? 'applied' : 'closed', receipt: copy(w.receipts.get(key) ?? null)})
    if (!name.endsWith('_execute') && !name.endsWith('_mutate')) throw Error('정의하지 않은 RPC ' + name)
    if (w.denied) return fault('FORBIDDEN')
    if (w.receipts.has(key)) return envelope(copy(w.receipts.get(key)))
    if (args.p_recover_only) return fault('NOT_FOUND')
    if (w.dropBefore) { w.dropBefore = false; throw Error('접수 전 응답 유실') }
    let receipt: any
    if (w.kind === 'intervention') {
      const row = w.requests.find((item: any) => item.id === command.requestId)
      row.version++; row.state = command.action === 'approve' ? w.resultState ?? 'applied' : 'rejected'; row.actions = []
      if (row.state === 'applied') w.lesson = copy(row.changes[0].after)
      receipt = {requestKey: key, commandHash: await interventionHash(command), kind: command.kind, entityId: row.id, version: row.version, status: row.state, recordedAt: stamp(), changedLessons: row.state === 'applied' ? [{id: w.lesson.id, version: w.lesson.version}] : []}
    } else receipt = {requestKey: key, recordId: command.recordId ?? 'new-handover', version: command.expectedVersion ? command.expectedVersion + 1 : 1, state: command.kind === 'apply' ? command.plan.kind === 'new_year' ? 'completed' : w.formal && !w.legacyReceipt ? 'awaiting_admin' : 'pending' : ({admin_confirm: 'pending', admin_reject: 'rejected', accept: 'accepted', reject: 'rejected', cancel: 'cancelled'} as any)[command.kind], recordedAt: '2026-10-16T01:23:45.000Z'}
    w.receipts.set(key, copy(receipt)); w.writes++
    if (w.hold) await new Promise(resolve => { w.release = resolve })
    if (w.dropAfter) { w.dropAfter = false; throw Error('접수 후 응답 유실') }
    if (w.wrongReceipt) receipt.requestKey = 'unrelated-key'
    return envelope(receipt)
  },
}
function Harness() {
  const [revision, setRevision] = useState(0), [connectionEpoch, setConnectionEpoch] = useState(0)
  const activeConnection = useMemo(() => ({...connection}), [connectionEpoch])
  const server = useMemo(() => createTimetableInterventionsServer(activeConnection), [activeConnection])
  w.refresh = () => setRevision(value => value + 1); w.replaceConnection = () => setConnectionEpoch(value => value + 1)
  const onResult = (result: any) => { w.results.push(copy(result)); if (w.resultThrows) throw Error('합성 표시 오류') }
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>
    {w.kind === 'intervention' ? <TimetableInterventionsPanel server={server} member={w.member} date={w.date} revision={revision} onWorkflowResult={onResult} /> :
      <SchoolAdministration connection={activeConnection} member={w.member} date={w.date} revision={revision} presentation="assistant" initialSection="transitions" onWorkflowResult={onResult} />}
  </PendingRequestsProvider></EditDraftsProvider>
}
w.pendingRow = () => copy(w.pending.get(recoveryScope(w.member), w.kind === 'intervention' ? 'timetableInterventions' : 'handover'))
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.root.render(<Harness />) }
w.mount()
