import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RelationsPanel } from '../../apps/workhub/src/teaching/RelationsPanel'
import { TeachingWorkspace } from '../../apps/workhub/src/teaching/TeachingWorkspace'
import { createTeachingRelationsAdapter } from '../../apps/workhub/src/teaching/relations-adapter'
import { relationCanonical } from '../../apps/workhub/src/teaching/relations-validation'
import { csvHash } from '../../apps/workhub/src/teaching/csv'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import { member, env, snapshot, makePreview, makeReceipt } from '../helpers/teaching-relations-fixture.mjs'
import styles from '../../apps/workhub/src/style.css?inline'

// 실제 패널·어댑터를 사용하고 서버 원장과 RPC 응답만 합성한다.
const w: any = window, clone = (value: any) => structuredClone(value)
w.member = clone(member); w.snapshot = snapshot(); w.pending = createPendingRequests(); w.memory = createEditDrafts()
w.calls = []; w.results = []; w.listeners = []; w.receipts = {}; w.applied = 0; w.saved = 0; w.identityRole = 'teacher'
w.ui = { mounted: true, date: '2026-10-16', service: 0, listener: 'original', revision: 0, blocked: '' }
const course = { id: 'course-a', schoolId: 'school-a', version: 8, label: '도덕', termId: 'term-a', subjectId: 'subject-a', assignmentId: 'assignment-a', validFrom: '2026-08-13', validThrough: '2027-02-28', canRecord: true, canCounsel: true, canManageRoster: true }
const student = { id: 'student-a', schoolId: 'school-a', version: 1, schoolStudentKey: 'school-student-a', name: '합성 학생', grade: 1, classLabel: '1', seatNumber: 1, enrollmentId: 'enrollment-a', courseMembershipId: 'membership-a', validFrom: '2026-08-13', validThrough: '2027-02-28' }
const oldEnv = () => ({ ...env(), contractVersion: 'teaching.v1' })
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: w.member.schoolId }], basisDate: w.ui.date }),
  getIdentity: async () => ({ userId: w.member.userId, approved: true, profile: { id: w.member.userId, name: w.member.name, email: 'synthetic@example.invalid', role: w.identityRole, is_active: true, extra_permissions: [], department_id: null } }),
  async rpcVerified(name: string, args: any) {
    w.calls.push(clone({ name, args }))
    if (name === 'workhub_teaching_catalog') return { ...oldEnv(), courses: [course], terms: [{ id: 'term-a', schoolId: 'school-a', version: 1, label: '2학기', firstDay: '2026-08-13', lastDay: '2027-02-28' }], subjects: [{ id: 'subject-a', label: '도덕' }], approvedTeachers: [{ id: 'member-a', label: '현재 교사' }], canManageCourses: true }
    if (name === 'workhub_teaching_course') return clone({ ...oldEnv(), course, students: [student], rubrics: [], imports: [] })
    if (name === 'workhub_teaching_student') return { ...oldEnv(), courseId: 'course-a', studentId: 'student-a', observations: [], assessments: [], nextCursor: null }
    if (name === 'workhub_teaching_relations') {
      if (w.failSnapshot) throw Error('합성 조회 실패')
      if (w.unavailable) return { ...env(), ok: false, code: 'UNAVAILABLE' }
      return clone({ ...w.snapshot, basisDate: w.ui.date })
    }
    if (name === 'workhub_teaching_relation_preview') {
      const preview = makePreview(args.p_intent), rows = [...w.snapshot.assignments, ...w.snapshot.students.flatMap((s: any) => [s.membership, s.enrollment])]
      for (const change of preview.changes) { const row = rows.find((r: any) => r.id === change.id); if (row) { change.version = row.version; change.effectiveThrough = row.effectiveThrough } }
      if (w.omitImpact) preview.changes = preview.changes.filter((r: any) => r.kind === 'enrollment')
      if (w.holdPreview) { w.holdPreview = false; await new Promise(resolve => w.releasePreview = resolve) }
      return preview
    }
    if (name !== 'workhub_teaching_relation_commit') throw Error('예상하지 않은 RPC: ' + name)
    const command = args.p_command, key = args.p_request_key
    if (w.reject) return { ...env(), ok: false, code: w.reject, requestKey: key, commandHash: await csvHash(relationCanonical(command)) }
    if (w.failBefore) { w.failBefore = false; throw Error('적용 전 응답 유실') }
    let receipt = w.receipts[key] ? { ...clone(w.receipts[key]), outcome: 'replayed' } : makeReceipt(command, key)
    if (!w.receipts[key]) {
      w.receipts[key] = clone(receipt); w.applied++
      const rows = [...w.snapshot.assignments, ...w.snapshot.students.flatMap((s: any) => [s.membership, s.enrollment])]
      for (const changed of command.expectedChanges) { const row = rows.find((r: any) => r.id === changed.id); if (row) { row.version++; row.effectiveThrough = row.validFrom > command.intent.lastDay ? null : command.intent.lastDay } }
      w.snapshot.courseVersion++
    }
    if (w.holdCommit) { w.holdCommit = false; await new Promise(resolve => w.releaseCommit = resolve) }
    if (w.failAfter) { w.failAfter = false; throw Error('적용 후 응답 유실') }
    if (w.badReceipt) receipt = { ...receipt, ...clone(w.badReceipt) }
    return receipt
  },
}
function Harness() {
  const [ui, setUi] = useState(w.ui)
  const update = (patch: any) => { w.ui = { ...w.ui, ...patch }; setUi(w.ui) }
  w.replaceAdapter = () => update({ service: ui.service + 1 })
  w.changeDate = () => update({ date: '2026-10-17' })
  w.changeListener = () => update({ listener: 'replacement' })
  w.refresh = () => update({ revision: ui.revision + 1 })
  w.setBlocked = (blocked: string) => update({ blocked })
  w.unmount = () => update({ mounted: false })
  w.remount = () => update({ mounted: true })
  w.switchMember = () => { w.member = { ...w.member, id: 'member-other', userId: 'user-other' }; update({ revision: ui.revision + 1 }) }
  const service = useMemo(() => ({ ...connection }), [ui.service])
  const adapter = useMemo(() => createTeachingRelationsAdapter(service), [service])
  const listener = ui.listener
  const onResult = (result: any) => { w.results.push(clone(result)); w.listeners.push(listener); if (w.resultThrows) throw Error('합성 결과 콜백 오류') }
  const workspace = new URLSearchParams(location.search).has('workspace')
  return <EditDraftsProvider store={w.memory}><PendingRequestsProvider store={w.pending}><style>{styles}</style><main>{ui.mounted && (workspace
    ? <TeachingWorkspace connection={service} member={w.member} date={ui.date} revision={ui.revision} onWorkflowResult={onResult} />
    : <RelationsPanel adapter={adapter} member={w.member} courseId="course-a" date={ui.date} revision={ui.revision} blockedReason={ui.blocked || undefined}
      onWorkflowResult={onResult} onClose={() => w.didClose = true} onSaved={() => { w.saved++; if (w.savedThrows) throw Error('합성 후속 화면 오류') }} />)}</main></PendingRequestsProvider></EditDraftsProvider>
}
w.scope = () => recoveryScope(w.member)
w.pendingRow = () => clone(w.pending.get(w.scope(), 'teachingRelations'))
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>)
