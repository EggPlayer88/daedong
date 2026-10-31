import { validateBasis, validatePlacements, timetablePolicy } from '../../../../packages/timetable/src/validate'
import type { TimetableIssue } from '../../../../packages/timetable/src/types'
import type { Placement, TimetableBasis } from './contracts'
import { canonical } from '../services/service-values'
import limits from './adjustments-limits.json'

export type AdjustmentCommand = { kind: 'move' | 'assign'; lessonId: string; slotId: string } | { kind: 'swap'; lessonId: string; otherLessonId: string }
export interface PartialPlacementReview { valid: boolean; complete: boolean; issues: TimetableIssue[]; missingLessonIds: string[] }
export interface AdjustmentReview extends PartialPlacementReview {
  sourceKey: string; command: AdjustmentCommand; placements: Placement[]
  changes: { lessonId: string; beforeSlotId: string | null; afterSlotId: string }[]
}
const issue = (code: string, message: string, path = 'placements'): TimetableIssue => ({ code, message, path })
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function placementShape(basis: TimetableBasis, raw: unknown): raw is Placement[] {
  if (!Array.isArray(raw) || raw.length > timetablePolicy.maxLessons) return false
  const lessonIds = new Set(basis.lessons.map(row => row.id)), slotIds = new Set(basis.slots.map(row => row.id)), seen = new Set<string>()
  for (const row of raw) {
    if (!isObject(row) || Object.keys(row).length !== 2 || typeof row.lessonId !== 'string' || typeof row.slotId !== 'string' || !lessonIds.has(row.lessonId) || !slotIds.has(row.slotId) || seen.has(row.lessonId)) return false
    seen.add(row.lessonId)
  }
  return true
}

/** 미배정만 허용한다. 원본의 시수·관계·필수조건 검증을 통과한 뒤 배정된 부분을 독립 검사한다. */
export function reviewPartialPlacements(basis: TimetableBasis, raw: unknown): PartialPlacementReview {
  const checked = validateBasis(basis)
  if (!checked.valid) return { ...checked, complete: false, missingLessonIds: [] }
  if (basis.unsupportedFeatures.length) return { ...validatePlacements(basis, raw), complete: false, missingLessonIds: [] }
  if (!placementShape(basis, raw)) return { ...validatePlacements(basis, raw), valid: false, complete: false, missingLessonIds: [] }
  const assigned = new Set(raw.map(row => row.lessonId)), missingLessonIds = basis.lessons.filter(row => !assigned.has(row.id)).map(row => row.id)
  if (!raw.length) return { valid: true, complete: false, issues: [], missingLessonIds }
  const lessons = basis.lessons.filter(row => assigned.has(row.id)), loads = new Map<string, number>()
  lessons.forEach(row => loads.set(row.courseId, (loads.get(row.courseId) ?? 0) + row.periods))
  // 누락 issue 100개가 뒤쪽 자원 충돌을 가리지 않도록 현재 배정된 수업만 재검사한다.
  // 자원·불가시간·용량·수업별 허용시각은 원본 그대로다. 미배정 고정 조건은 배치 시 다시 적용한다.
  const partial = { ...basis, lessons, courseLoads: [...loads].map(([courseId, periods]) => ({ courseId, periods })), fixed: basis.fixed.filter(row => assigned.has(row.lessonId)), preferences: basis.preferences.filter(row => assigned.has(row.lessonId)) }
  const result = validatePlacements(partial, raw)
  return { ...result, complete: result.valid && missingLessonIds.length === 0, missingLessonIds }
}
export const adjustmentSourceKey = (basis: TimetableBasis, placements: Placement[], lockedLessonIds: string[]) => canonical([basis, placements, Array.isArray(lockedLessonIds) ? [...lockedLessonIds].sort() : lockedLessonIds])

/** 작업 고정은 현재 위치를 지키는 추가 필수조건이다. 학교·사용자 필수조건을 해제하지 않는다. */
export function protectedAdjustmentBasis(basis: TimetableBasis, placements: Placement[], lockedLessonIds: string[]): { basis?: TimetableBasis; issues: TimetableIssue[] } {
  const checked = validateBasis(basis)
  if (!checked.valid) return { issues: checked.issues }
  if (!placementShape(basis, placements)) return { issues: [issue('INVALID_PLACEMENTS', '수업·시간대가 정확하고 중복 없는 배치가 필요합니다.')] }
  if (!Array.isArray(lockedLessonIds) || new Set(lockedLessonIds).size !== lockedLessonIds.length || lockedLessonIds.length > basis.lessons.length) return { issues: [issue('INVALID_WORKING_LOCK', '작업 고정 목록을 다시 확인해 주세요.')] }
  const fixed = structuredClone(basis.fixed)
  const currentByLesson = new Map(placements.map(row => [row.lessonId, row])), fixedByLesson = new Map(fixed.map(row => [row.lessonId, row]))
  for (const id of lockedLessonIds) {
    const current = currentByLesson.get(id), required = fixedByLesson.get(id)
    if (!current || required && required.slotId !== current.slotId) return { issues: [issue('INVALID_WORKING_LOCK', '작업 고정의 수업과 현재 위치가 필수 조건에 맞지 않습니다.')] }
    if (!required) fixed.push(structuredClone(current))
  }
  return { basis: { ...basis, fixed }, issues: [] }
}

export function reviewProtectedPlacements(basis: TimetableBasis, current: Placement[], next: Placement[], lockedLessonIds: string[]): PartialPlacementReview {
  const protectedBasis = protectedAdjustmentBasis(basis, current, lockedLessonIds)
  if (!protectedBasis.basis) return { valid: false, complete: false, issues: protectedBasis.issues, missingLessonIds: [] }
  const result = reviewPartialPlacements(protectedBasis.basis, next)
  if (!placementShape(basis, next)) return result
  const currentIds = new Set(current.map(row => row.lessonId)), nextByLesson = new Map(next.map(row => [row.lessonId, row.slotId]))
  for (const fixed of protectedBasis.basis.fixed) if (currentIds.has(fixed.lessonId) && nextByLesson.get(fixed.lessonId) !== fixed.slotId) result.issues.push(issue('FIXED_VIOLATION', '고정한 수업 시간이 바뀌었습니다.'))
  return { ...result, valid: !result.issues.length, complete: !result.issues.length && !result.missingLessonIds.length }
}

export function reviewAdjustment(basis: TimetableBasis, placements: Placement[], lockedLessonIds: string[], command: AdjustmentCommand): AdjustmentReview {
  const sourceKey = adjustmentSourceKey(basis, placements, lockedLessonIds)
  const rejected = (issues: TimetableIssue[]): AdjustmentReview => ({ sourceKey, command, placements: [], changes: [], valid: false, complete: false, issues, missingLessonIds: [] })
  const protectedBasis = protectedAdjustmentBasis(basis, placements, lockedLessonIds)
  if (!protectedBasis.basis) return rejected(protectedBasis.issues)
  const keys = isObject(command) ? Object.keys(command).sort().join(',') : ''
  if (!isObject(command) || !['assign', 'move', 'swap'].includes(command.kind as string) || keys !== (command.kind === 'swap' ? 'kind,lessonId,otherLessonId' : 'kind,lessonId,slotId')) return rejected([issue('INVALID_ADJUSTMENT', '이동·배치·맞교환 명령을 확인해 주세요.')])
  const original = placements.find(row => row.lessonId === command.lessonId), lesson = basis.lessons.find(row => row.id === command.lessonId)
  if (!lesson) return rejected([issue('UNKNOWN_LESSON', '선택한 수업을 찾을 수 없습니다.')])
  const changes: AdjustmentReview['changes'] = []
  let next = structuredClone(placements)
  if (command.kind === 'swap') {
    const other = placements.find(row => row.lessonId === command.otherLessonId)
    if (!original || !other || original.lessonId === other.lessonId || original.slotId === other.slotId) return rejected([issue('INVALID_SWAP', '서로 다른 시간에 배치된 두 수업을 선택해 주세요.')])
    next = next.map(row => row.lessonId === original.lessonId ? { ...row, slotId: other.slotId } : row.lessonId === other.lessonId ? { ...row, slotId: original.slotId } : row)
    changes.push({ lessonId: original.lessonId, beforeSlotId: original.slotId, afterSlotId: other.slotId }, { lessonId: other.lessonId, beforeSlotId: other.slotId, afterSlotId: original.slotId })
  } else {
    if (command.kind === 'assign' ? original : !original) return rejected([issue('INVALID_ADJUSTMENT', '현재 배정 상태가 바뀌었습니다. 수업을 다시 선택해 주세요.')])
    if (original?.slotId === command.slotId) return rejected([issue('NO_CHANGE', '현재 위치와 다른 시간을 선택해 주세요.')])
    changes.push({ lessonId: lesson.id, beforeSlotId: original?.slotId ?? null, afterSlotId: command.slotId })
    next = original ? next.map(row => row.lessonId === lesson.id ? { lessonId: lesson.id, slotId: command.slotId } : row) : [...next, { lessonId: lesson.id, slotId: command.slotId }]
  }
  const result = reviewPartialPlacements(protectedBasis.basis, next)
  return { ...result, sourceKey, command: structuredClone(command), placements: next, changes }
}

export function findSwapCandidates(basis: TimetableBasis, placements: Placement[], lockedLessonIds: string[], lessonId: string, query: string) {
  const normalized = query.trim().slice(0, limits.searchLength).toLocaleLowerCase(), assigned = new Set(placements.map(row => row.lessonId))
  const resources = new Map(basis.resources.map(row => [row.id, row]))
  const available = basis.lessons.filter(row => row.id !== lessonId && assigned.has(row.id) && (!normalized || [row.label, ...row.resourceIds.map(id => resources.get(id)?.label ?? '')].join(' ').toLocaleLowerCase().includes(normalized)))
  const candidates: { lessonId: string; review: AdjustmentReview }[] = []
  let scanned = 0
  const started = performance.now()
  for (const row of available) {
    // 큰 학교에서도 한 번의 후보 검색이 화면을 오래 막지 않도록 다음 후보 전 중단한다.
    if (scanned >= limits.candidateChecks || candidates.length >= limits.candidateResults || scanned > 0 && performance.now() - started >= limits.candidateBudgetMs) break
    const review = reviewAdjustment(basis, placements, lockedLessonIds, { kind: 'swap', lessonId, otherLessonId: row.id }); scanned++
    if (review.valid) candidates.push({ lessonId: row.id, review })
  }
  return { candidates, scanned, total: available.length, limited: scanned < available.length }
}
