import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SchoolDataMaintenancePanel } from '../../apps/workhub/src/teaching/SchoolDataMaintenancePanel'
import { createSchoolDataMaintenanceServer } from '../../apps/workhub/src/teaching/school-data-maintenance-server'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import { createEditDrafts, EditDraftsProvider } from '../../apps/workhub/src/app/edit-drafts'
import styles from '../../apps/workhub/src/style.css?inline'
const w: any = window, copy = (v: any) => structuredClone(v)
w.member = { id: 'manager', schoolId: 'school', userId: 'user-manager', name: '관리 교사', role: 'admin', active: true, validFrom: '2020-01-01', validThrough: '2099-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.course = { id: 'course-one', version: 1, state: 'active', fields: { label: '1반 국어', validFrom: '2027-03-01', validThrough: '2027-08-12' }, teacherMemberIds: ['teacher-a'] }
w.student = { id: 'student-one', version: 1, state: 'active', fields: { name: '학생 가', schoolStudentKey: '2027-001' }, enrollment: { id: 'enrollment-one', version: 1, fields: { grade: 1, classLabel: '1', seatNumber: 1 } } }
w.teachers = [{ id: 'teacher-a', label: '기존 교사', validFrom: '2020-01-01', validThrough: null }, { id: 'teacher-b', label: '새 교사', validFrom: '2027-03-01', validThrough: '2027-12-31' }]
w.pending = createPendingRequests(); w.drafts = createEditDrafts(); w.calls = []; w.writes = 0; w.previews = {}; w.receipts = {}; w.closes = {}; w.didClose = false
const envelope = (data: any) => ({ contract: 'school-data-maintenance.v1', schoolId: w.member.schoolId, memberId: w.member.id, data })
const error = (code: string) => ({ contract: 'school-data-maintenance.v1', schoolId: w.member.schoolId, memberId: w.member.id, error: { code } })
const before = (kind: string) => kind.startsWith('student_') ? w.student.fields : kind === 'enrollment_correct' ? w.student.enrollment.fields : kind === 'course_teacher_correct' ? { teacherMemberIds: w.course.teacherMemberIds } : w.course.fields
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: w.member.schoolId }], basisDate: '2026-10-20' }),
  getIdentity: async () => ({ userId: w.member.userId, approved: true }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args: copy(args) })
    if (name === 'workhub_school_data_get') {
      if (w.failGet) throw Error('조회 실패')
      const snapshot = w.notReady ? { available: false, reason: 'not_configured', courses: [], course: null, students: [], teachers: [] } :
        { available: true, reason: null, courses: [{ id: w.course.id, version: w.course.version, label: w.course.fields.label, state: w.course.state }], course: copy(w.course), students: [copy(w.student)], teachers: copy(w.teachers) }
      if (w.holdGet) await new Promise(resolve => w.releaseGet = resolve)
      return envelope(snapshot)
    }
    if (name === 'workhub_school_data_preview') {
      const intent = copy(args.p_intent), prior = copy(before(intent.kind)), after = Object.keys(intent.changes).length ? copy(intent.changes) : prior
      const preview = { previewId: 'preview-' + w.calls.length, fingerprint: 'a'.repeat(64), intent, expiresAt: new Date(Date.now() + 600000).toISOString(), allowed: !w.blocked, blockers: w.blocked ? [w.blocked] : [],
        impact: { assignments: 1, courseMemberships: 1, enrollments: 1, records: 0, timetableLinks: 0, publishedLessons: 0, futureLessons: 0 }, before: prior, after }
      w.previews[preview.previewId] = copy(preview)
      if (w.holdPreview) await new Promise(resolve => w.releasePreview = resolve)
      return envelope(preview)
    }
    const key = args.p_request_key, command = args.p_command, intent = command.intent
    if (name === 'workhub_school_data_close') {
      if (!w.closes[key]) w.closes[key] = { requestKey: key, outcome: w.receipts[key] ? 'applied' : 'closed', receipt: w.receipts[key] ?? null }
      if (w.dropClose) { w.dropClose = false; throw Error('닫기 응답 유실') }
      return envelope(copy(w.closes[key]))
    }
    if (name !== 'workhub_school_data_commit') throw Error('예상하지 않은 RPC: ' + name)
    if (w.closes[key]?.outcome === 'closed') return error('CONFLICT')
    if (w.receipts[key]) return envelope(copy(w.receipts[key]))
    if (w.conflict) return error('CONFLICT')
    if (w.dropBefore) { w.dropBefore = false; throw Error('처리 전 단절') }
    const entity = intent.kind.startsWith('student_') ? w.student : intent.kind === 'enrollment_correct' ? w.student.enrollment : w.course
    if (entity.version !== intent.expectedVersion) return error('CONFLICT')
    entity.version++
    if (['course_correct', 'student_correct', 'enrollment_correct'].includes(intent.kind)) entity.fields = copy(intent.changes)
    if (intent.kind === 'course_teacher_correct') w.course.teacherMemberIds = copy(intent.changes.teacherMemberIds)
    if (intent.kind === 'course_archive') w.course.state = 'archived'
    if (intent.kind === 'course_restore') w.course.state = 'active'
    if (intent.kind === 'course_cancel') w.course.state = 'cancelled'
    if (intent.kind === 'student_void') w.student.state = 'voided'
    if (intent.kind === 'student_restore') w.student.state = 'active'
    w.receipts[key] = { requestKey: key, kind: intent.kind, entityId: intent.entityId, version: entity.version, recordedAt: new Date().toISOString() }; w.writes++
    if (w.dropAfter) { w.dropAfter = false; throw Error('처리 후 단절') }
    return envelope(copy(w.receipts[key]))
  },
}
const server = createSchoolDataMaintenanceServer(connection)
function Harness() {
  const [revision, change] = useState(0); w.revision = revision; w.refresh = () => change(n => n + 1)
  w.switchMember = () => { w.member = { ...w.member, id: 'other-manager', userId: 'user-other' }; change(n => n + 1) }
  return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style><main><SchoolDataMaintenancePanel server={server} member={w.member} courseId="course-one" onClose={() => w.didClose = true} onSaved={() => w.saved = true} /></main></PendingRequestsProvider></EditDraftsProvider>
}
w.scope = () => recoveryScope(w.member); w.pendingRow = () => copy(w.pending.get(w.scope(), 'schoolDataMaintenance'))
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.root.render(<Harness />) }; w.mount()
