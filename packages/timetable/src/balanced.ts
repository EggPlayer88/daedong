import policy from '../_assets/balanced-policy.json'
import type { Placement, TimetableBasis } from './types'
import { validatePlacements } from './validate'

export interface BalancedQuality {
  totalPenalty: number; preferencePenalty: number; teacherDailyExcess: number; teacherWorstExcess: number
  courseDailyPairs: number; courseAdjacency: number; teacherGapMinutes: number
}
type QualityOptions = { improveTeacherBalance?: boolean; spreadCourses?: boolean }
const key = (value: unknown) => JSON.stringify(value)
const sorted = (values: string[]) => [...values].sort()

function merge(intervals: number[][]): number[][] {
  const result: number[][] = []
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else result.push([start, end])
  }
  return result
}

/** 고정·부분 동결로 품질 기준을 다시 좁히지 않는다. 실제 불가시간은 제외한다. */
export function balancedContext(basis: TimetableBasis) {
  const slots = new Map(basis.slots.map(s => [s.id, s])), resources = new Map(basis.resources.map(r => [r.id, r]))
  const calendars = new Map<string, number[][]>(), totals = new Map<string, number>()
  for (const lesson of basis.lessons) {
    const legal = lesson.allowedSlotIds.map(id => slots.get(id)!).filter(s => !basis.unavailable.some(u => lesson.resourceIds.includes(u.resourceId) && s.day === u.day && s.startMinute < u.endMinute && u.startMinute < s.endMinute))
    for (const rid of lesson.resourceIds.filter(id => resources.get(id)!.kind === 'teacher')) {
      totals.set(rid, (totals.get(rid) ?? 0) + lesson.periods)
      for (const s of legal) { const k = key([rid, s.day]), row = calendars.get(k) ?? []; row.push([s.startMinute, s.endMinute]); calendars.set(k, row) }
    }
  }
  for (const [k, ranges] of calendars) calendars.set(k, merge(ranges))
  const targets = new Map([...totals].map(([rid, total]) => [rid, Math.ceil(total / Math.max(1, [...calendars.keys()].filter(k => JSON.parse(k)[0] === rid).length))]))
  return { calendars, targets }
}

/** 만족도 점수로 환산하지 않고, 독립적으로 정의한 비음수 정수 손실을 집계한다. */
export function evaluateBalancedQuality(basis: TimetableBasis, placements: Placement[], options: QualityOptions = {}): BalancedQuality {
  if (!validatePlacements(basis, placements).valid) throw new Error('유효한 전체 배치만 품질을 평가할 수 있습니다.')
  const context = balancedContext(basis), lessons = new Map(basis.lessons.map(l => [l.id, l])), slots = new Map(basis.slots.map(s => [s.id, s]))
  const resources = new Map(basis.resources.map(r => [r.id, r])), weights = new Map(basis.preferences.map(p => [key([p.lessonId, p.slotId]), p.weight]))
  const days = new Map<string, { periods: number; ranges: number[][] }>(), courses = new Map<string, Map<number, number>>()
  const result: BalancedQuality = { totalPenalty: 0, preferencePenalty: 0, teacherDailyExcess: 0, teacherWorstExcess: 0, courseDailyPairs: 0, courseAdjacency: 0, teacherGapMinutes: 0 }
  for (const p of placements) {
    const lesson = lessons.get(p.lessonId)!, s = slots.get(p.slotId)!
    result.preferencePenalty += weights.get(key([p.lessonId, p.slotId])) ?? 0
    const course = key([lesson.courseId, sorted(lesson.resourceIds.filter(id => ['class', 'student_group'].includes(resources.get(id)!.kind)))])
    const counts = courses.get(course) ?? new Map<number, number>(); counts.set(s.day, (counts.get(s.day) ?? 0) + 1); courses.set(course, counts)
    for (const rid of lesson.resourceIds.filter(id => resources.get(id)!.kind === 'teacher')) {
      const k = key([rid, s.day]), row = days.get(k) ?? { periods: 0, ranges: [] }
      row.periods += lesson.periods; row.ranges.push([s.startMinute, s.endMinute]); days.set(k, row)
    }
  }
  const burden = new Map<string, number>()
  for (const [k, row] of days) {
    const [rid] = JSON.parse(k), excess = Math.max(0, row.periods - context.targets.get(rid)!) ** 2
    result.teacherDailyExcess += excess; burden.set(rid, (burden.get(rid) ?? 0) + excess)
    const first = Math.min(...row.ranges.map(r => r[0])), last = Math.max(...row.ranges.map(r => r[1]))
    const available = (context.calendars.get(k) ?? []).reduce((n, [a, b]) => n + Math.max(0, Math.min(last, b) - Math.max(first, a)), 0)
    result.teacherGapMinutes += available - row.ranges.reduce((n, [a, b]) => n + b - a, 0)
  }
  result.teacherWorstExcess = Math.max(0, ...burden.values())
  for (const counts of courses.values()) {
    for (const [day, count] of counts) { result.courseDailyPairs += count * (count - 1) / 2; if (counts.has(day + 1)) result.courseAdjacency++ }
  }
  for (const metric of Object.keys(policy.weights) as (keyof typeof policy.weights)[]) {
    const enabled = metric.startsWith('teacher') ? options.improveTeacherBalance !== false : metric.startsWith('course') ? options.spreadCourses !== false : true
    result.totalPenalty += result[metric] * (enabled ? policy.weights[metric] : 0)
  }
  return result
}

/** 카드·슬롯 ID와 블록 경계 대신 같은 입력의 실제 시간 구간별 수업 내용을 비교한다. */
export function actualTimetableCells(basis: TimetableBasis, placements: Placement[]): Map<string, number> {
  const bounds = new Map<number, number[]>()
  for (const s of basis.slots) bounds.set(s.day, [...(bounds.get(s.day) ?? []), s.startMinute, s.endMinute])
  for (const [day, times] of bounds) bounds.set(day, [...new Set(times)].sort((a, b) => a - b))
  const lessons = new Map(basis.lessons.map(l => [l.id, l])), slots = new Map(basis.slots.map(s => [s.id, s])), cells = new Map<string, number>()
  for (const p of placements) {
    const l = lessons.get(p.lessonId)!, s = slots.get(p.slotId)!, times = bounds.get(s.day)!
    for (let i = 0; i + 1 < times.length; i++) if (times[i] >= s.startMinute && times[i + 1] <= s.endMinute) cells.set(key([s.day, times[i], times[i + 1], l.courseId, sorted(l.resourceIds)]), times[i + 1] - times[i])
  }
  return cells
}
export function actualTimetableFingerprint(basis: TimetableBasis, placements: Placement[]): string { return key([...actualTimetableCells(basis, placements).keys()].sort()) }
export function timetableDifferenceMinutes(basis: TimetableBasis, a: Placement[], b: Placement[]): number {
  const left = actualTimetableCells(basis, a), right = actualTimetableCells(basis, b)
  // 실제 내용이 사라지거나 추가된 점유 중 큰 쪽. 수업 시수는 같아도 블록 실시간 길이는 다를 수 있다.
  return Math.max([...left].reduce((n, [k, minutes]) => n + (right.has(k) ? 0 : minutes), 0), [...right].reduce((n, [k, minutes]) => n + (left.has(k) ? 0 : minutes), 0))
}
