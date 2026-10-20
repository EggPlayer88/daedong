import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CollectionServerPanel } from '../../apps/workhub/src/collections/CollectionServerPanel'
import { createSupabaseCollectionServer } from '../../apps/workhub/src/collections/supabase-collections'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider } from '../../apps/workhub/src/app/pending-requests'

const now = '2026-10-21T00:00:00.000Z', date = '2026-10-21', policy = { extensions: ['hwpx'], maxFileBytes: 1048576, maxFiles: 3 }
const member = { id: 'reviewer', userId: 'reviewer-user', schoolId: 'school', name: '검토 담당', role: 'calendar_manager', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
const members = [member, ...Array.from({ length: 45 }, (_, i) => ({ ...member, id: `member-${i + 1}`, userId: `user-${i + 1}`, name: i < 2 ? '김교사' : `교사 ${i + 1}` }))]
const qa: any = { calls: [], writes: 0, saved: new Map(), unknown: false, reject: false, denyDetail: false, memory: createEditDrafts(), pending: createPendingRequests() }
;(window as any).qa = qa
const state: any = {
  request: { id: 'request-one', schoolId: 'school', managerMemberId: member.id, status: 'published', version: 1, publishedAt: now, title: '45개 단위 운영 자료', instructions: '합성 자료로 제출 상태와 검토 동선을 확인합니다.', dueDate: '2026-10-31', reviewMode: 'required', reviewerMemberId: member.id, textLabel: '업무 메모', textRequired: false, numberLabel: '', numberRequired: false, units: [] },
  units: [], submissions: [], reviews: [], supplements: [], withdrawals: [],
}
const submission = (unit: any, revision: number, previousSubmissionId: string | null) => ({ id: `submission-${unit.id}-${revision}`, unitId: unit.id, revision, submittedBy: unit.responsibleMemberId, receiptAt: now, receiptDate: date, dueSnapshot: '2026-10-31', initiallyLate: false, correctionReason: revision > 1 ? '다시 제출한 합성 자료' : '', previousSubmissionId, reviewMode: 'required', requestKey: `seed-key-${unit.id}-${revision}`, text: '합성 업무 메모', number: null, files: [] })
for (let i = 0; i < 45; i++) {
  const person = members[i + 1], unit: any = { id: `unit-${i + 1}`, requestId: state.request.id, schoolId: 'school', label: `${i + 1}번 제출 단위`, responsibleMemberId: person.id, members: [{ id: person.id, userId: person.userId, name: person.name }], version: 1, currentSubmissionId: null, effectiveSubmissionId: null, withdrawnSubmissionIds: [], correctionUntil: '', correctionReason: '' }
  state.request.units.push({ label: unit.label, responsibleMemberId: person.id, contributorMemberIds: [] })
  if (i % 5 !== 0) {
    const first = submission(unit, 1, null); state.submissions.push(first); unit.currentSubmissionId = first.id
    if (i % 5 >= 2) {
      const decision = i % 5 === 2 ? 'changes_requested' : 'accepted'
      state.reviews.push({ id: `review-${unit.id}`, unitId: unit.id, submissionId: first.id, reviewerMemberId: member.id, decision, note: decision === 'changes_requested' ? '자료 보완이 필요합니다.' : '', recordedAt: now })
      if (decision === 'accepted') unit.effectiveSubmissionId = first.id
      else state.supplements.push({ id: `supplement-${unit.id}`, unitId: unit.id, submissionId: first.id, dueDate: '2026-10-31', fulfilledSubmissionId: null, fulfilledAt: null })
      if (i % 5 === 4) { const second = submission(unit, 2, first.id); state.submissions.push(second); unit.currentSubmissionId = second.id }
    }
  }
  state.units.push(unit)
}
qa.state = state
const envelope = (data: unknown) => ({ contractVersion: 1, schoolId: 'school', memberId: member.id, data })
const rejection = (code: string) => ({ contractVersion: 1, schoolId: 'school', memberId: member.id, error: { code } })
const connection: any = {
  info: () => ({ memberships: members, schools: [{ id: 'school', name: '합성 학교' }], basisDate: date }),
  getIdentity: async () => ({ userId: member.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    qa.calls.push({ name, args: structuredClone(args) })
    if (name === 'workhub_collection_basic_readiness') return envelope({ available: true, reason: 'ready', policy })
    if (name === 'workhub_collection_list') return envelope({ items: [structuredClone(state.request)], nextCursor: null })
    if (name === 'workhub_collection_get') return qa.denyDetail ? rejection('FORBIDDEN') : envelope(structuredClone(state))
    if (name === 'workhub_collection_draft_get') return envelope(null)
    if (name === 'workhub_collection_mutate') {
      if (qa.saved.has(args.p_request_key)) return envelope(structuredClone(qa.saved.get(args.p_request_key)))
      if (qa.reject) return rejection('INVALID_INPUT')
      const command = args.p_command, unit = state.units.find((value: any) => value.id === command.unitId)
      if (command.kind !== 'review' || !unit || command.expectedVersion !== unit.version || command.submissionId !== unit.currentSubmissionId) return rejection('CONFLICT')
      state.reviews.push({ id: `review-${args.p_request_key}`, unitId: unit.id, submissionId: command.submissionId, reviewerMemberId: member.id, decision: command.decision, note: command.note, recordedAt: now }); unit.version++
      if (command.decision === 'accepted') unit.effectiveSubmissionId = command.submissionId
      else state.supplements.push({ id: `supplement-${args.p_request_key}`, unitId: unit.id, submissionId: command.submissionId, dueDate: command.dueDate, fulfilledSubmissionId: null, fulfilledAt: null })
      const receipt = { requestId: state.request.id, resourceId: unit.id, resourceVersion: unit.version, recordedAt: now, requestKey: args.p_request_key }
      qa.saved.set(args.p_request_key, structuredClone(receipt)); qa.writes++
      if (qa.unknown) { qa.unknown = false; throw new Error('응답 유실') }
      return envelope(receipt)
    }
    throw new Error(`예상하지 않은 RPC: ${name}`)
  },
}
const server = createSupabaseCollectionServer(connection)
function App() {
  const [revision, setRevision] = useState(0), [visible, setVisible] = useState(true)
  qa.refresh = () => setRevision(value => value + 1); qa.unmount = () => setVisible(false); qa.remount = () => setVisible(true)
  return <EditDraftsProvider store={qa.memory}><PendingRequestsProvider store={qa.pending}>{visible && <CollectionServerPanel server={server} member={member as any} members={members as any} date={date} revision={revision} onNavigationLockChange={value => { qa.locked = value }} />}</PendingRequestsProvider></EditDraftsProvider>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
