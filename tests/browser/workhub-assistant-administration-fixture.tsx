// 실제 학교 관리·인계 서비스와 화면을 사용하고 DB 응답만 합성한다.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SchoolAdministration } from '../../apps/workhub/src/administration/SchoolAdministration'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'

const w = window as any
const member = { id: 'm', schoolId: 's', userId: 'u', name: '시험 관리자', role: 'school_admin', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.calls = []; w.mode = 'ok'; w.applied = 0; w.resourceVersion = 3; w.failRead = false; w.canManageYear = true; w.ready = true
w.drafts = createEditDrafts(); w.pending = createPendingRequests(); const receipts = new Map()
w.school = { version: 3, asOfDate: '2026-11-11', availableYears: [2026], configuration: { draftId: 'y26', schoolName: '합성 중학교', schoolCode: 'synthetic', schoolType: 'middle', gradeCount: '3', schoolYear: '2026', startsOn: '2026-03-01', lastDay: '2027-02-28', terms: [{ id: 't1', termNo: '1', name: '1학기', startsOn: '2026-03-01', lastDay: '2026-08-12' }, { id: 't2', termNo: '2', name: '2학기', startsOn: '2026-08-13', lastDay: '2027-02-28' }], departments: [{ id: 'dept', name: '교무부' }], classes: [{ id: 'class', grade: '1', classNo: '1', name: '1학년 1반', kind: 'regular' }] }, subjects: [{ id: 'subject', name: '국어' }], memberships: [{ id: 'm', name: '시험 관리자', status: 'active', startsOn: '2026-03-01', lastDay: '2027-02-28', version: 1 }], assignments: [], capabilities: { configuration: true, memberships: true, assignments: true } }
const transitionEnvelope = (data: unknown) => ({ contract: 'school-transitions.v1', schoolId: 's', memberId: 'm', data })
const schoolEnvelope = (data: unknown) => ({ kind: 'workhub-school-admin', schemaVersion: 1, schoolId: 's', memberId: 'm', data })
const connection: any = {
  info: () => ({ memberships: [member], schools: [{ id: 's' }], basisDate: '2026-11-11' }),
  getIdentity: async () => ({ userId: 'u', approved: true }),
  subscribeInvalidation: () => () => {},
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args: structuredClone(args) })
    if (name === 'workhub_school_admin_readiness') return schoolEnvelope(w.ready ? { available: true } : { available: false, reason: 'not_installed' })
    if (name === 'workhub_school_admin_get') return schoolEnvelope(structuredClone(w.school))
    if (name === 'workhub_school_transition_list') {
      if (w.failRead) throw Error('합성 조회 실패')
      return transitionEnvelope({ canManageYear: w.canManageYear, dutyApproval: 'admin_review_v1', years: [{ id: 'y26', year: 2026, label: '2026학년도' }], recipients: [{ memberId: 'next', name: '인수 교사', version: 2 }], resources: [{ kind: 'collection', id: 'c1', version: w.resourceVersion, label: '평가 자료' }], records: [{ id: 'incoming', kind: 'handover', title: '받은 인계', version: 1, state: 'pending', canAccept: true, canCancel: false, summary: ['수합 1건'], requesterMemberId: 'sender', requiresAdminReview: false, canAdminReview: false, adminReview: null }], nextCursor: null })
    }
    if (name === 'workhub_school_transition_preview') return transitionEnvelope({ fingerprint: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', summary: ['평가 자료 1건을 인수 교사에게 인계'], excluded: ['개인 상담과 학생 자료'], affectedCount: 1 })
    if (!name.endsWith('_mutate')) throw Error('예상하지 않은 RPC: ' + name)
    const command = args.p_command, key = args.p_request_key
    if (receipts.has(key)) return structuredClone(receipts.get(key))
    if (w.mode === 'deferred') await new Promise(resolve => { w.release = resolve })
    let response
    if (name === 'workhub_school_admin_mutate') {
      w.school.configuration = structuredClone(command.configuration); w.school.subjects = structuredClone(command.subjects); w.school.version++
      response = schoolEnvelope({ requestKey: key, kind: command.kind, version: w.school.version, schoolYear: 2026, recordedAt: '2026-11-11T01:00:00Z' })
    } else response = transitionEnvelope({ requestKey: key, recordId: command.recordId ?? 'new', version: command.expectedVersion ? command.expectedVersion + 1 : 1, state: command.kind === 'apply' ? command.plan.kind === 'handover' ? 'pending' : 'completed' : command.kind === 'accept' ? 'accepted' : 'rejected', recordedAt: '2026-11-11T01:00:00Z' })
    receipts.set(key, structuredClone(response)); w.applied++
    if (w.mode === 'lost_after_save') throw Error('합성 응답 유실')
    return response
  },
}
function App() {
  const [revision, setRevision] = useState(0), [section, setSection] = useState(w.initialSection ?? 'transitions'), [talking, setTalking] = useState(false), [epoch, setEpoch] = useState(0)
  w.refresh = () => setRevision(x => x + 1); w.setSection = setSection; w.setTalking = setTalking; w.remount = () => setEpoch(x => x + 1)
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>
    <button onClick={() => setTalking(!talking)}>{talking ? '작성하던 학교 업무 보기' : '대화 화면 보기'}</button>
    {talking && <p>질문 입력 화면</p>}
    <div hidden={talking}><SchoolAdministration key={epoch} connection={connection} member={member as any} date="2026-11-11" presentation="assistant" initialSection={section} transitionOpen={w.openRequest} revision={revision} onNavigationLockChange={value => { w.locked = value }} /></div>
  </PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
