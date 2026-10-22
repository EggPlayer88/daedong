import type { CourseSnapshot, Student, TeachingAdapter, TeachingScope } from './contracts'
import { TeachingError } from './contracts'
import { studentResponse } from './validation'
import limits from './record-export-policy.json'

export interface SourceFollowup {
  studentId: string
  recordId: string
  occurredOn: string
  cursor: string | null
}

// 목록에는 기록 본문을 보관하지 않는다. 선택한 수업의 관찰만 확인하고 상담은 조회하지 않는다.
export async function findSourceFollowup(
  adapter: TeachingAdapter, scope: TeachingScope, course: CourseSnapshot, student: Student,
  isCurrent: () => boolean = () => true,
): Promise<SourceFollowup | null> {
  const guard = () => {
    if (!isCurrent()) throw new TeachingError('CANCELLED', '수업 또는 조회 상태가 바뀌었습니다.')
  }
  guard()
  if (course.schoolId !== scope.schoolId || course.memberId !== scope.memberId ||
      course.ownerUserId !== scope.ownerUserId || !course.students.some(s => s.id === student.id))
    throw new TeachingError('FORBIDDEN', '현재 수업 명부에서 학생을 확인할 수 없습니다.')
  let cursor: string | null = null, count = 0
  const seen = new Set<string>(), records = new Set<string>()
  for (let pageNo = 0; pageNo < limits.limits.pages; pageNo++) {
    guard()
    const raw = await adapter.student(scope.memberId, course.course.id, student.id, cursor)
    guard()
    const page = studentResponse(raw, scope, course.course.id, student.id)
    for (const record of page.observations) {
      if (records.has(record.id)) throw new TeachingError('QUERY_FAILED', '조회 중 기록이 달라졌습니다. 다시 확인해 주세요.')
      records.add(record.id)
      if (++count > limits.limits.records) throw new TeachingError('QUERY_FAILED', '기록이 많아 확인을 마치지 못했습니다. 학생 기록에서 직접 확인해 주세요.')
    }
    const target = page.observations.find(r => r.state === 'active' && r.sourceReviewRequired)
    if (target) return { studentId: student.id, recordId: target.id, occurredOn: target.occurredOn, cursor }
    if (page.nextCursor === null) return null
    if (seen.has(page.nextCursor)) throw new TeachingError('QUERY_FAILED', '기록 페이지를 확인하지 못했습니다. 다시 확인해 주세요.')
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new TeachingError('QUERY_FAILED', '기록이 많아 확인을 마치지 못했습니다. 학생 기록에서 직접 확인해 주세요.')
}
