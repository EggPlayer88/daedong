import { overlaps, validateBasis, validatePlacements } from '../../../../packages/timetable/src/validate'
import type { Placement, TimetableBasis, TimetableIssue, TimetableSlot } from '../../../../packages/timetable/src/types'

export interface FoundationCourse {
  id: string; label: string; required: number | null; assigned: number; teacherLabels: string[]; groupLabels: string[]; lessonCount: number
}
export interface FoundationResource {
  id: string; label: string; kind: string; assigned: number; availableUpperBound: number
  days: { day: number; availablePeriods: number; firstMinute: number | null; lastMinute: number | null }[]
}
export interface FoundationReview {
  ready: boolean; issues: TimetableIssue[]; courses: FoundationCourse[]; resources: FoundationResource[]; requiredPeriods: number; assignedPeriods: number
}

// 같은 시각의 여러 학년 교시와 연속 블록을 단순히 더하지 않는다.
// 가능한 구간의 최대 시수는 필요조건일 뿐, 전체 편성의 존재를 증명하지 않는다.
export function intervalPeriodCapacity(slots: TimetableSlot[]): number {
  const sorted = [...slots].sort((a, b) => a.endMinute - b.endMinute || a.startMinute - b.startMinute)
  const best = [0]
  for (let i = 0; i < sorted.length; i++) {
    let lo = 0, hi = i
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (sorted[mid - 1].endMinute <= sorted[i].startMinute) lo = mid; else hi = mid - 1 }
    best.push(Math.max(best[i], sorted[i].periods + best[lo]))
  }
  return best[sorted.length]
}

export function reviewTimetableFoundation(value: unknown): FoundationReview {
  const checked = validateBasis(value)
  const empty = { ready: false, issues: checked.issues, courses: [], resources: [], requiredPeriods: 0, assignedPeriods: 0 }
  // 깨진 응답도 요약 패널을 무너뜨리지 않고 원래 검증 문제를 표시한다.
  if (!checked.valid) return empty
  const basis = value as TimetableBasis, issues: TimetableIssue[] = []
  const resourcesById = new Map(basis.resources.map(row => [row.id, row]))
  const courseLessons = new Map<string, TimetableBasis['lessons']>()
  const resourceLessons = new Map<string, TimetableBasis['lessons']>()
  for (const lesson of basis.lessons) {
    const courses = courseLessons.get(lesson.courseId) ?? []; courses.push(lesson); courseLessons.set(lesson.courseId, courses)
    for (const id of lesson.resourceIds) { const rows = resourceLessons.get(id) ?? []; rows.push(lesson); resourceLessons.set(id, rows) }
  }
  const courses: FoundationCourse[] = basis.courseLoads.map(load => {
    const rows = courseLessons.get(load.courseId) ?? [], ids = [...new Set(rows.flatMap(row => row.resourceIds))]
    return { id: load.courseId, label: rows[0]?.label ?? load.courseId, required: load.periods, assigned: rows.reduce((sum, row) => sum + row.periods, 0), lessonCount: rows.length,
      teacherLabels: ids.filter(id => resourcesById.get(id)?.kind === 'teacher').map(id => resourcesById.get(id)!.label),
      groupLabels: ids.filter(id => ['class', 'student_group'].includes(resourcesById.get(id)?.kind ?? '')).map(id => resourcesById.get(id)!.label) }
  })
  const resources: FoundationResource[] = basis.resources.filter(row => ['teacher', 'class', 'student_group'].includes(row.kind)).map(resource => {
    const lessons = resourceLessons.get(resource.id) ?? [], allowed = new Set(lessons.flatMap(lesson => lesson.allowedSlotIds))
    const unavailable = basis.unavailable.filter(row => row.resourceId === resource.id)
    const usable = basis.slots.filter(slot => allowed.has(slot.id) && !unavailable.some(row => overlaps(row, slot)))
    const days = [...new Set(basis.slots.map(slot => slot.day))].sort((a, b) => a - b).map(day => {
      const rows = usable.filter(slot => slot.day === day)
      return { day, availablePeriods: intervalPeriodCapacity(rows), firstMinute: rows.length ? Math.min(...rows.map(row => row.startMinute)) : null, lastMinute: rows.length ? Math.max(...rows.map(row => row.endMinute)) : null }
    })
    const assigned = lessons.reduce((sum, lesson) => sum + lesson.periods, 0), availableUpperBound = days.reduce((sum, day) => sum + day.availablePeriods, 0)
    if (assigned > availableUpperBound) issues.push({ code: 'RESOURCE_PERIOD_SHORTAGE', message: `${resource.label}: 배정 ${assigned}차시를 넣을 수 있는 시간은 최대 ${availableUpperBound}차시입니다. 배정 또는 사용 가능 시간을 확인해 주세요.`, path: `resources.${resource.id}` })
    return { id: resource.id, label: resource.label, kind: resource.kind, assigned, availableUpperBound, days }
  })
  for (const feature of basis.unsupportedFeatures) issues.push({ code: 'UNSUPPORTED_FEATURE', message: `아직 검사할 수 없는 조건: ${feature}`, path: 'basis.unsupportedFeatures' })
  return { ready: !issues.length, issues, courses, resources, requiredPeriods: basis.courseLoads.reduce((sum, row) => sum + row.periods, 0), assignedPeriods: basis.lessons.reduce((sum, row) => sum + row.periods, 0) }
}

/** 작업자 고정과 부분 재계산 고정은 학교의 원래 필수조건을 덮어쓰지 않는다. */
export function prepareScopedSolve(basis: TimetableBasis, placements: Placement[] | null, lockedLessonIds: string[] = [], scopeResourceId = ''): { basis: TimetableBasis | null; issues: TimetableIssue[]; kept: number; moving: number } {
  const input = validateBasis(basis)
  if (!input.valid) return { basis: null, issues: input.issues, kept: 0, moving: 0 }
  const issue = (message: string) => ({ basis: null, issues: [{ code: 'INVALID_WORKING_LOCK', message, path: 'workingLocks' }], kept: 0, moving: 0 })
  if (scopeResourceId && !basis.resources.some(row => row.id === scopeResourceId)) return issue('부분 재계산할 대상을 다시 선택해 주세요.')
  const byLesson = new Map((placements ?? []).map(row => [row.lessonId, row.slotId])), lessons = new Map(basis.lessons.map(row => [row.id, row]))
  const locks = new Set(lockedLessonIds)
  if (locks.size !== lockedLessonIds.length || [...locks].some(id => !lessons.has(id) || !byLesson.has(id))) return issue('고정할 수업의 현재 배치를 다시 확인해 주세요.')
  if (scopeResourceId && (!placements || !validatePlacements(basis, placements).valid)) return issue('부분 재계산은 전체 필수조건을 통과한 배치에서 시작해 주세요.')
  if (scopeResourceId) for (const lesson of basis.lessons) if (!lesson.resourceIds.includes(scopeResourceId)) locks.add(lesson.id)
  const fixed = new Map(basis.fixed.map(row => [row.lessonId, row.slotId]))
  for (const id of locks) {
    const slotId = byLesson.get(id)!
    if (fixed.has(id) && fixed.get(id) !== slotId) return issue('현재 배치가 학교의 필수 고정조건과 다릅니다. 학교 조건을 먼저 확인해 주세요.')
    fixed.set(id, slotId)
  }
  const next = { ...basis, fixed: [...fixed].map(([lessonId, slotId]) => ({ lessonId, slotId })) }, valid = validateBasis(next)
  return { basis: valid.valid ? next : null, issues: valid.issues, kept: fixed.size, moving: basis.lessons.length - fixed.size }
}
