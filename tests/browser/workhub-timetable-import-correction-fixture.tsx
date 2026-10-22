import React from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableWorkspace } from '../../apps/workhub/src/timetable/TimetableWorkspace'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import theme from '../../apps/workhub/src/style.css?inline'
import timetable from '../../apps/workhub/src/timetable/timetable.css?inline'
import teaching from '../../apps/workhub/src/teaching/teaching.css?inline'
import { schoolBatchFixture } from '../fixtures/school-configuration-batch.mjs'

const w: any = window, copy = (value: any) => structuredClone(value)
w.member = { id: 'manager', schoolId: 'school', userId: 'user-manager', name: '합성 담당자', role: 'school_admin', active: true, validFrom: '2020-01-01', validThrough: '2100-12-31', departmentIds: [], gradeIds: [], subjectIds: [] }
w.source = {
  schoolId: 'school', schoolLevel: 'middle', termId: 'term', termLabel: '2027학년도 1학기', firstDay: '2027-03-01', lastDay: '2027-08-12', sourceRevision: 1, sourceFingerprint: 'a'.repeat(64),
  canEdit: true, canConfirm: true, resources: [
    { id: 'teacher-a', kind: 'teacher', label: '기존 교사', capacity: 1 }, { id: 'teacher-b', kind: 'teacher', label: '정정 교사', capacity: 1 },
    { id: 'class-a', kind: 'class', label: '1학년 1반', capacity: 1 }, { id: 'room-a', kind: 'room', label: '1반 교실', capacity: 1 },
  ],
  courses: [{ id: 'course-a', label: '국어 원자료', requiredPeriods: 1, resourceIds: ['teacher-a', 'class-a', 'room-a'] }], unsupportedFeatures: [], savedDraft: null,
}
w.courses = [
  { id: 'course-a', version: 1, state: 'active', fields: { label: '국어 원자료', validFrom: '2027-03-01', validThrough: '2027-08-12' }, teacherMemberIds: ['teacher-a'] },
  { id: 'course-other', version: 1, state: 'active', fields: { label: '다른 수업', validFrom: '2027-03-01', validThrough: '2027-08-12' }, teacherMemberIds: ['teacher-a'] },
]
w.teachers = [{ id: 'teacher-a', label: '기존 교사', validFrom: '2020-01-01', validThrough: null }, { id: 'teacher-b', label: '정정 교사', validFrom: '2020-01-01', validThrough: null }]
w.pending = createPendingRequests()
w.drafts = createEditDrafts(true)
w.scope = () => recoveryScope(w.member)
w.drafts.activate(w.scope())
w.calls = []; w.importWrites = 0; w.correctionWrites = 0; w.externalOpen = []; w.previews = {}; w.receipts = {}; w.closed = {}; w.commands = {}
w.locked = false
w.school = { version: 1, asOfDate: '2026-10-21', availableYears: [2026], ...schoolBatchFixture(), memberships: [], assignments: [], capabilities: { configuration: true, memberships: true, assignments: true } }
w.schoolWrites = 0; w.setupWrites = 0
w.setup = { termId: 'term', termLabel: '2027학년도 1학기', firstDay: '2027-03-01', lastDay: '2027-08-12', referenceDay: '2027-03-01', sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), canEdit: true,
  spaces: [{ id: 'room-a', kind: 'room', label: '1반 교실', capacity: 1, version: 1 }], classes: [{ id: 'class-a', label: '1학년 1반', grade: 1 }],
  courses: [{ id: 'course-a', label: '국어 원자료', inTimetable: true, teacherLabels: ['기존 교사'], studentCount: 0, link: { version: 1, studentGroup: false, classIds: ['class-a'], spaceIds: ['room-a'] } }], findings: [] }
const relationEnvelope = (member: any) => ({ contractVersion: 'teaching-relations.v1', schoolId: member.schoolId, memberId: member.id, ownerUserId: member.userId })
function relationSnapshot(member: any, courseId: string) {
  const course = w.courses.find((row: any) => row.id === courseId)
  return { ...relationEnvelope(member), courseId, courseVersion: course.version, courseLabel: course.fields.label, basisDate: '2026-10-21',
    capabilities: { manageAssignments: true, endMemberships: false, transferStudents: false },
    assignments: [{ id: 'assignment-' + courseId, schoolId: member.schoolId, version: 1, kind: 'assignment', courseId, courseLabel: course.fields.label, memberId: 'teacher-a', studentId: null, enrollmentId: null, label: '기존 교사', validFrom: course.fields.validFrom, validThrough: course.fields.validThrough, effectiveThrough: course.fields.validThrough }],
    students: [], approvedTeachers: w.teachers.map((row: any) => ({ memberId: row.id, label: row.label, validFrom: row.validFrom, validThrough: row.validThrough ?? '2100-12-31' })) }
}
const envelope = (contract: string, member: any, data: any) => ({ contract, schoolId: member.schoolId, memberId: member.id, data })
const failure = (contract: string, member: any, code: string) => ({ contract, schoolId: member.schoolId, memberId: member.id, error: { code } })
async function rpcVerified(name: string, args: any) {
  const member = copy(w.member)
  w.calls.push({ name, args: copy(args) })
  if (name === 'workhub_teaching_relations') return relationSnapshot(member, args.p_course_id)
  if (name === 'workhub_teaching_relation_commit') {
    const command = args.p_command, key = args.p_request_key
    if (JSON.stringify(command) !== JSON.stringify(w.commands[key])) throw Error('관계 원 요청 변경')
    if (!w.receipts[key]) throw Error('합성 기존 접수증 없음')
    return copy(w.receipts[key])
  }
  if (name.startsWith('workhub_school_admin_')) {
    const wrap = (data: any) => ({ kind: 'workhub-school-admin', schemaVersion: 1, schoolId: member.schoolId, memberId: member.id, data })
    if (name.endsWith('_readiness')) return wrap({ available: true })
    if (name.endsWith('_get')) return wrap(copy(w.school))
    const key = args.p_request_key, command = args.p_command
    if (w.commands[key] && JSON.stringify(w.commands[key]) !== JSON.stringify(command)) throw Error('원 요청 변경')
    w.commands[key] = copy(command)
    if (w.receipts[key]) return wrap(copy(w.receipts[key]))
    if (command.kind !== 'save_configuration' || command.expectedVersion !== w.school.version) throw Error('예상하지 않은 학교 구성 변경')
    w.school.version++; w.school.configuration = copy(command.configuration); w.school.subjects = copy(command.subjects); w.schoolWrites++
    w.receipts[key] = { requestKey: key, kind: command.kind, version: w.school.version, schoolYear: Number(command.configuration.schoolYear), recordedAt: new Date().toISOString() }
    if (w.dropSchoolAfter) { w.dropSchoolAfter = false; throw Error('합성 학교 구성 반영 후 단절') }
    return wrap(copy(w.receipts[key]))
  }
  if (name.startsWith('workhub_timetable_setup_')) {
    const contract = 'timetable.setup.v1'
    if (name.endsWith('_get')) return envelope(contract, member, copy(w.setup))
    const key = args.p_request_key, command = args.p_command
    if (w.commands[key] && JSON.stringify(w.commands[key]) !== JSON.stringify(command)) return failure(contract, member, 'IDEMPOTENCY_CONFLICT')
    w.commands[key] = copy(command)
    if (w.receipts[key]) return envelope(contract, member, copy(w.receipts[key]))
    if (args.p_recover_only) return failure(contract, member, 'NOT_FOUND')
    if (command.kind !== 'space_save') throw Error('예상하지 않은 공간 명령')
    const space = w.setup.spaces.find((row: any) => row.id === command.spaceId)
    if (!space || space.version !== command.expectedVersion) return failure(contract, member, 'CONFLICT')
    Object.assign(space, copy(command.input), { version: space.version + 1 })
    w.setup.sourceRevision++; w.setup.sourceFingerprint = 'e'.repeat(64); w.setupWrites++
    const resource = w.source.resources.find((row: any) => row.id === space.id)
    Object.assign(resource, { label: space.label, capacity: space.capacity })
    w.source.sourceRevision++; w.source.sourceFingerprint = w.setup.sourceFingerprint
    w.receipts[key] = { requestKey: key, kind: command.kind, targetId: space.id, version: space.version, sourceFingerprint: w.setup.sourceFingerprint }
    if (w.dropSetupAfter) { w.dropSetupAfter = false; throw Error('합성 공간 반영 후 단절') }
    return envelope(contract, member, copy(w.receipts[key]))
  }
  if (name.startsWith('workhub_timetable_import_')) {
    const contract = 'timetable-import.v1'
    if (name.endsWith('_get')) {
      const value = copy(w.source)
      if (w.holdImportGet) await new Promise(resolve => { w.releaseImportGet = resolve })
      if (w.failImportGet) throw Error('합성 원자료 조회 실패')
      return envelope(contract, member, value)
    }
    if (name.endsWith('_preview')) {
      const result = { previewId: 'import-preview-' + w.calls.length, fingerprint: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), input: copy(args.p_input), termId: 'term', courseCount: 1, lessonCount: 1, existingPublicationsPreserved: true }
      if (w.holdImportPreview) await new Promise(resolve => { w.releaseImportPreview = resolve })
      return envelope(contract, member, result)
    }
    const key = args.p_request_key, command = args.p_command
    if (w.commands[key] && JSON.stringify(w.commands[key]) !== JSON.stringify(command)) return failure(contract, member, 'IDEMPOTENCY_CONFLICT')
    w.commands[key] = copy(command)
    if (name.endsWith('_close')) {
      if (!w.receipts[key]) w.closed[key] = true
      return envelope(contract, member, { requestKey: key, outcome: w.receipts[key] ? 'applied' : 'closed', receipt: copy(w.receipts[key] ?? null) })
    }
    if (w.receipts[key]) return envelope(contract, member, copy(w.receipts[key]))
    if (w.closed[key]) return failure(contract, member, 'CONFLICT')
    if (w.dropImportBefore) { w.dropImportBefore = false; throw Error('합성 가져오기 처리 전 단절') }
    w.importWrites++
    w.receipts[key] = { requestKey: key, previewId: command.previewId, termId: 'term', basisId: 'basis', basisRevision: w.source.sourceRevision, draftId: 'draft', draftVersion: 1, lessonCount: 1, recordedAt: new Date().toISOString(), published: false }
    return envelope(contract, member, copy(w.receipts[key]))
  }
  if (name.startsWith('workhub_school_data_')) {
    const contract = 'school-data-maintenance.v1'
    if (name.endsWith('_get')) {
      if (w.failCorrectionGet) throw Error('합성 정정 자료 조회 실패')
      const course = w.courses.find((row: any) => row.id === (w.wrongCorrectionCourse ? 'course-other' : args.p_course_id))
      const value = { available: true, reason: null, courses: w.courses.map((row: any) => ({ id: row.id, version: row.version, label: row.fields.label, state: row.state })), course: copy(course ?? null), students: [], teachers: copy(w.teachers) }
      if (w.holdCorrectionGet) await new Promise(resolve => { w.releaseCorrectionGet = resolve })
      return envelope(contract, member, value)
    }
    if (name.endsWith('_preview')) {
      const intent = copy(args.p_intent), course = w.courses.find((row: any) => row.id === intent.courseId)
      const before = intent.kind === 'course_teacher_correct' ? { teacherMemberIds: copy(course.teacherMemberIds) } : copy(course.fields)
      const result = { previewId: 'correction-preview-' + w.calls.length, fingerprint: 'c'.repeat(64), intent, expiresAt: new Date(Date.now() + 600000).toISOString(), allowed: true, blockers: [],
        impact: { assignments: 1, courseMemberships: 0, enrollments: 0, records: 0, timetableLinks: 0, publishedLessons: 0, futureLessons: 0 }, before, after: copy(intent.changes) }
      w.previews[result.previewId] = copy(result)
      return envelope(contract, member, result)
    }
    const key = args.p_request_key, command = args.p_command
    if (w.commands[key] && JSON.stringify(w.commands[key]) !== JSON.stringify(command)) return failure(contract, member, 'IDEMPOTENCY_CONFLICT')
    w.commands[key] = copy(command)
    if (name.endsWith('_close')) {
      if (!w.receipts[key]) w.closed[key] = true
      return envelope(contract, member, { requestKey: key, outcome: w.receipts[key] ? 'applied' : 'closed', receipt: copy(w.receipts[key] ?? null) })
    }
    if (w.receipts[key]) return envelope(contract, member, copy(w.receipts[key]))
    if (w.closed[key]) return failure(contract, member, 'CONFLICT')
    if (w.dropCorrectionBefore) { w.dropCorrectionBefore = false; throw Error('합성 정정 처리 전 단절') }
    const intent = command.intent, course = w.courses.find((row: any) => row.id === intent.courseId)
    if (intent.expectedVersion !== course.version) return failure(contract, member, 'CONFLICT')
    course.version++
    if (intent.kind === 'course_correct') course.fields = copy(intent.changes)
    if (intent.kind === 'course_teacher_correct') course.teacherMemberIds = copy(intent.changes.teacherMemberIds)
    const sourceCourse = w.source.courses.find((row: any) => row.id === course.id)
    if (sourceCourse) {
      sourceCourse.label = course.fields.label
      sourceCourse.resourceIds = [...course.teacherMemberIds, 'class-a', 'room-a']
      w.source.sourceRevision++; w.source.sourceFingerprint = 'd'.repeat(64)
    }
    w.correctionWrites++
    w.receipts[key] = { requestKey: key, kind: intent.kind, entityId: intent.entityId, version: course.version, recordedAt: new Date().toISOString() }
    if (w.dropCorrectionAfter) { w.dropCorrectionAfter = false; throw Error('합성 정정 처리 후 단절') }
    return envelope(contract, member, copy(w.receipts[key]))
  }
  throw Error('예상하지 않은 RPC: ' + name)
}
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: w.member.schoolId }], basisDate: '2026-10-21' }),
  getIdentity: async () => ({ userId: w.member.userId, approved: !w.revoked, profile: { id: w.member.userId, is_active: !w.revoked, role: 'superadmin', department_id: null, extra_permissions: [] } }),
  rpcVerified,
}
w.seedOtherDraft = () => w.drafts.bind(w.scope(), 'school-data-maintenance').save({ courseId: 'course-other', intent: { kind: 'course_correct', courseId: 'course-other', entityId: 'course-other', expectedVersion: 1, changes: copy(w.courses[1].fields), reason: '다른 수업에서 보관한 정정 입력' } }, true)
w.seedOtherRelation = () => {
  const key = 'existing-relation-request', command = { previewId: 'original-relation-preview', previewFingerprint: 'f'.repeat(64),
    intent: { kind: 'assignment_end', courseId: 'course-other', expectedCourseVersion: 1, relationId: 'assignment-course-other', expectedRelationVersion: 1, studentId: null, enrollmentId: null, lastDay: '2027-03-01', replacementMemberId: null, reason: '다른 수업에서 이미 보낸 담당 종료' },
    expectedChanges: [{ kind: 'assignment', id: 'assignment-course-other', version: 1 }] }
  w.commands[key] = copy(command)
  w.receipts[key] = { ...relationEnvelope(w.member), previewId: command.previewId, previewFingerprint: command.previewFingerprint, requestKey: key, intentKind: command.intent.kind,
    changes: command.expectedChanges.map(row => ({ ...row, version: row.version + 1 })), replacementAssignmentId: null, outcome: 'replayed', appliedAt: new Date().toISOString() }
  w.pending.put(w.scope(), 'teachingRelations', { command, key })
  return copy({ command, key })
}
w.switchMember = () => {
  w.member = { ...w.member, id: 'other-manager', schoolId: 'other-school', userId: 'other-user' }
  w.source = { ...w.source, schoolId: 'other-school', termLabel: '다른 학교의 새 학기' }
  w.pending.retainScopes([w.scope()]); w.drafts.activate(w.scope()); w.render()
}
w.render = () => w.root.render(<EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}>
  <style>{theme + timetable + teaching}</style>
  <main className="timetable-workspace"><TimetableWorkspace connection={connection} member={w.member} date="2026-10-21" initialPreparationStep="import"
    onNavigationLockChange={value => w.locked = value} onOpenSchoolAdmin={() => w.externalOpen.push('schoolAdmin')} onOpenTeaching={() => w.externalOpen.push('teaching')} /></main>
</PendingRequestsProvider></EditDraftsProvider>)
w.mount = () => { w.root = createRoot(document.getElementById('root')!); w.render() }
w.mount()
