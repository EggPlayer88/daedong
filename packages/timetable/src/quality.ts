import type { Placement, TimetableBasis } from './types'
import { validatePlacements } from './validate'

/** 이전 배치는 반드시 당시의 기초판과 함께 보관한다. 현재 교사 배정으로 과거를 재해석하지 않는다. */
export interface PreviousTimetable { basis: TimetableBasis; placements: Placement[] }
export interface TimetableChanges { added: number; removed: number; moved: number; reassigned: number; unchanged: number }
export interface TeacherLoad {
  resourceId: string; label: string; totalPeriods: number; maxDailyPeriods: number; minTeachingDayPeriods: number
  days: { day: number; periods: number; lessons: number; idleMinutes: number }[]
}

/** 시각·참여자·교과·시수의 실질 변경을 비교한다. 이름/배열 순서 변경은 재배정으로 세지 않는다. */
export function compareTimetables(basis: TimetableBasis, placements: Placement[], previous: PreviousTimetable): TimetableChanges {
  if (basis.schoolId !== previous.basis.schoolId || basis.termId !== previous.basis.termId || !validatePlacements(basis, placements).valid || !validatePlacements(previous.basis, previous.placements).valid) throw new Error('변경 비교에는 같은 학교·학기의 유효한 원본 시간표 두 개가 필요합니다.')
  const oldLessons = new Map(previous.basis.lessons.map(l => [l.id, l])), oldPlaces = new Map(previous.placements.map(p => [p.lessonId, p.slotId]))
  const oldSlots = new Map(previous.basis.slots.map(s => [s.id, s])), slots = new Map(basis.slots.map(s => [s.id, s])), currentPlaces = new Map(placements.map(p => [p.lessonId, p.slotId]))
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  const result: TimetableChanges = { added: 0, removed: 0, moved: 0, reassigned: 0, unchanged: 0 }
  for (const lesson of basis.lessons) {
    const old = oldLessons.get(lesson.id)
    if (!old) { result.added++; continue }
    const before = oldSlots.get(oldPlaces.get(lesson.id)!)!, after = slots.get(currentPlaces.get(lesson.id)!)!
    const moved = before.day !== after.day || before.startMinute !== after.startMinute || before.endMinute !== after.endMinute
    const reassigned = old.courseId !== lesson.courseId || old.periods !== lesson.periods || !same(old.resourceIds, lesson.resourceIds)
    if (moved) result.moved++
    if (reassigned) result.reassigned++
    if (!moved && !reassigned) result.unchanged++
  }
  const current = new Set(basis.lessons.map(l => l.id))
  result.removed = previous.basis.lessons.filter(l => !current.has(l.id)).length
  return result
}

/** 불완전한 초안에 품질 점수를 붙이지 않는다. idleMinutes는 점심·휴식까지 포함한 수업 사이 분이다. */
export function evaluateTimetableQuality(basis: TimetableBasis, placements: Placement[], previous?: PreviousTimetable) {
  const checked = validatePlacements(basis, placements)
  if (!checked.valid) return { valid: false as const, issues: checked.issues, preferencePenalty: null, requiredPeriods: basis.courseLoads.reduce((s, l) => s + l.periods, 0), scheduledPeriods: null, teacherLoads: [] as TeacherLoad[], changes: null }
  const lessons = new Map(basis.lessons.map(l => [l.id, l])), slots = new Map(basis.slots.map(s => [s.id, s]))
  const days = [...new Set(basis.slots.map(s => s.day))].sort((a, b) => a - b)
  const teacherLoads: TeacherLoad[] = basis.resources.filter(r => r.kind === 'teacher').map(resource => {
    const daily = days.map(day => {
      const rows = placements.filter(p => lessons.get(p.lessonId)!.resourceIds.includes(resource.id) && slots.get(p.slotId)!.day === day).map(p => ({ lesson: lessons.get(p.lessonId)!, slot: slots.get(p.slotId)! })).sort((a, b) => a.slot.startMinute - b.slot.startMinute)
      return { day, periods: rows.reduce((sum, row) => sum + row.lesson.periods, 0), lessons: rows.length, idleMinutes: rows.slice(1).reduce((sum, row, i) => sum + Math.max(0, row.slot.startMinute - rows[i].slot.endMinute), 0) }
    })
    const teaching = daily.filter(d => d.periods > 0).map(d => d.periods)
    return { resourceId: resource.id, label: resource.label, days: daily, totalPeriods: daily.reduce((s, d) => s + d.periods, 0), maxDailyPeriods: Math.max(0, ...daily.map(d => d.periods)), minTeachingDayPeriods: teaching.length ? Math.min(...teaching) : 0 }
  })
  const preference = new Map(basis.preferences.map(p => [JSON.stringify([p.lessonId, p.slotId]), p.weight]))
  return { valid: true as const, issues: [], preferencePenalty: placements.reduce((s, p) => s + (preference.get(JSON.stringify([p.lessonId, p.slotId])) ?? 0), 0), requiredPeriods: basis.courseLoads.reduce((s, l) => s + l.periods, 0), scheduledPeriods: basis.lessons.reduce((s, l) => s + l.periods, 0), teacherLoads, changes: previous ? compareTimetables(basis, placements, previous) : null }
}
