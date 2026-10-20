import type { CourseSnapshot } from './contracts'
import { TeachingError } from './contracts'
import { compareRosterImport, rosterReviewBasis, type RosterImportReviewInput } from './roster-import'

export interface RosterCorrectionTarget {
  kind: 'student' | 'enrollment' | 'membership'
  schoolId: string; memberId: string; ownerUserId: string; courseId: string
  studentId: string; schoolStudentKey: string; enrollmentId: string; courseMembershipId: string
}
export interface RosterView { filter: string; page: number }
export const rosterCorrectionLabels = { student: '학생 정보 정정', enrollment: '학년·반·번호 정정', membership: '수강 기간 확인' }
/** 이름이나 좌석으로 대상을 짐작하지 않고 현재 수업의 공식 번호와 관계 ID를 함께 고정한다. */
export function rosterCorrectionTargets(input: RosterImportReviewInput, course: CourseSnapshot, studentKey: string): RosterCorrectionTarget[] {
  if (!course.course.canManageRoster || input.expectedVersion !== course.course.version || input.rosterBasis !== rosterReviewBasis(course)) return []
  const comparison = compareRosterImport(input.roster, course, input.validFrom, input.validThrough)
  const row = comparison.rows.find(row => row.row.schoolStudentKey === studentKey), existing = row?.existing
  if (!row || row.state !== 'correction' || !existing) return []
  const kinds: RosterCorrectionTarget['kind'][] = []
  if (row.row.name !== existing.name) kinds.push('student')
  if (row.row.grade !== existing.grade || row.row.classLabel !== existing.classLabel || row.row.seatNumber !== existing.seatNumber) kinds.push('enrollment')
  if (input.validFrom !== existing.validFrom || input.validThrough !== existing.validThrough) kinds.push('membership')
  return kinds.map(kind => ({ kind, schoolId: course.schoolId, memberId: course.memberId, ownerUserId: course.ownerUserId, courseId: course.course.id,
    studentId: existing.id, schoolStudentKey: existing.schoolStudentKey, enrollmentId: existing.enrollmentId, courseMembershipId: existing.courseMembershipId }))
}
export function assertRosterCorrectionTarget(target: RosterCorrectionTarget, input: RosterImportReviewInput, course: CourseSnapshot): void {
  if (!rosterCorrectionTargets(input, course, target.schoolStudentKey).some(current => Object.keys(current).every(key => current[key as keyof RosterCorrectionTarget] === target[key as keyof RosterCorrectionTarget]))) {
    throw new TeachingError('CONFLICT', '명부나 학생 연결이 바뀌었습니다. 입력을 유지하고 최신 명부와 다시 비교해 주세요.')
  }
}
