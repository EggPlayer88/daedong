import type { Placement, TimetableBasis } from './contracts'
import type { PreviousTimetable } from '../../../../packages/timetable/src/quality'
import { validatePlacements } from '../../../../packages/timetable/src/validate'

export interface CandidateLessonDetail {
  lessonId: string; label: string; courseId: string; periods: number
  resources: TimetableBasis['resources']; slot: TimetableBasis['slots'][number]
}
export interface CandidateChange {
  lessonId: string; before: CandidateLessonDetail | null; after: CandidateLessonDetail | null
  added: boolean; removed: boolean; moved: boolean; reassigned: boolean
}
/** 수업 ID로 대응하고 실제 시각과 배정을 비교한다. 이름이나 교시 ID 변경만으로 이동을 만들지 않는다. */
export function reviewCandidate(basis: TimetableBasis, placements: Placement[], previous?: PreviousTimetable) {
  if (!validatePlacements(basis, placements).valid || previous && (
    previous.basis.schoolId !== basis.schoolId || previous.basis.termId !== basis.termId || !validatePlacements(previous.basis, previous.placements).valid
  )) throw new Error('후보 비교에는 같은 학교·학기의 검증된 배치가 필요합니다.')
  const details = (source: TimetableBasis, rows: Placement[]): CandidateLessonDetail[] => {
    const slots = new Map(source.slots.map(slot => [slot.id, slot])), resources = new Map(source.resources.map(resource => [resource.id, resource]))
    const locations = new Map(rows.map(row => [row.lessonId, row.slotId]))
    return source.lessons.map(lesson => ({ lessonId: lesson.id, label: lesson.label, courseId: lesson.courseId, periods: lesson.periods,
      resources: lesson.resourceIds.map(id => resources.get(id)!), slot: slots.get(locations.get(lesson.id)!)! }))
  }
  const rows = details(basis, placements), oldRows = previous ? details(previous.basis, previous.placements) : []
  const changes: CandidateChange[] = [], old = new Map(oldRows.map(row => [row.lessonId, row])), current = new Set(rows.map(row => row.lessonId))
  const ids = (row: CandidateLessonDetail) => JSON.stringify(row.resources.map(resource => resource.id).sort())
  if (previous) {
    for (const after of rows) {
      const before = old.get(after.lessonId) ?? null
      const moved = Boolean(before && (before.slot.day !== after.slot.day || before.slot.startMinute !== after.slot.startMinute || before.slot.endMinute !== after.slot.endMinute))
      const reassigned = Boolean(before && (before.courseId !== after.courseId || before.periods !== after.periods || ids(before) !== ids(after)))
      if (!before || moved || reassigned) changes.push({ lessonId: after.lessonId, before, after, added: !before, removed: false, moved, reassigned })
    }
    for (const before of oldRows) if (!current.has(before.lessonId)) changes.push({ lessonId: before.lessonId, before, after: null, added: false, removed: true, moved: false, reassigned: false })
  }
  return { rows, changes, compared: Boolean(previous), counts: {
    added: changes.filter(row => row.added).length, removed: changes.filter(row => row.removed).length,
    moved: changes.filter(row => row.moved).length, reassigned: changes.filter(row => row.reassigned).length,
  } }
}
