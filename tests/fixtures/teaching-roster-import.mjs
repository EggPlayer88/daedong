export function teachingRosterFixture() {
  const students = [
    { id: 'student-a', schoolId: 'school-a', version: 1, schoolStudentKey: '001001', name: '합성 학생 가', grade: 1, classLabel: '1', seatNumber: 1, enrollmentId: 'enrollment-a', courseMembershipId: 'membership-a', validFrom: '2026-03-03', validThrough: '2026-07-16' },
    { id: 'student-b', schoolId: 'school-a', version: 1, schoolStudentKey: '001002', name: '합성 학생 나', grade: 1, classLabel: '1', seatNumber: 2, enrollmentId: 'enrollment-b', courseMembershipId: 'membership-b', validFrom: '2026-03-03', validThrough: '2026-07-16' },
  ]
  const course = { contractVersion: 'teaching.v1', schoolId: 'school-a', memberId: 'member-a', ownerUserId: 'user-a',
    course: { id: 'course-a', schoolId: 'school-a', version: 3, label: '1학년 1반 국어', termId: 'term-a', subjectId: 'subject-a', assignmentId: null, validFrom: '2026-03-03', validThrough: '2026-07-16', canRecord: true, canCounsel: false, canManageRoster: true }, students, rubrics: [], imports: [] }
  const row = { schoolStudentKey: '001003', name: '합성 학생 다', grade: 1, classLabel: '1', seatNumber: 3 }
  const draft = { mode: 'roster', kind: 'dilemmas', rawCsv: '', roster: [], activity: null, validFrom: course.course.validFrom, validThrough: course.course.validThrough, expectedVersion: course.course.version, confirmed: false }
  return { course, row, draft }
}
