import policy from './_assets/candidate-library-policy.json'
import type { Placement, TimetableBasis } from './contracts'
import { canonicalTimetableJson } from '../../../../packages/timetable/src/cpSat'
import { validatePlacements } from '../../../../packages/timetable/src/validate'
import { evaluateTimetableQuality } from '../../../../packages/timetable/src/quality'
import { reviewCandidate, type CandidateChange } from './candidate-review'
export { policy as candidateLibraryPolicy }

/** 현재 탭의 비교 자료다. 서버 초안 번호나 계산기의 최적성 주장을 보관하지 않는다. */
export interface SavedCandidate {
  id: string; title: string; capturedAt: string; basis: TimetableBasis; placements: Placement[]
}
const own = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const fail = (message: string): never => { throw new Error(message) }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s/gu, '')
export const candidateBasisKey = (basis: TimetableBasis) => canonicalTimetableJson(basis)
const placementKey = (placements: Placement[]) => canonicalTimetableJson([...placements].sort((a, b) => a.lessonId.localeCompare(b.lessonId)))

/** 표시값과 벌점도 입력으로 믿지 않고 원래 기초판과 배치를 독립 검사한다. */
export function validateSavedCandidate(value: unknown): value is SavedCandidate {
  if (!own(value) || Object.keys(value).length !== 5 || !['id', 'title', 'capturedAt', 'basis', 'placements'].every(key => Object.hasOwn(value, key))) return false
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > policy.titleLength || /[\u0000-\u001f\u0085\uD800-\uDFFF]/u.test(value.title)) return false
  if (typeof value.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt)) || new Date(value.capturedAt).toISOString() !== value.capturedAt) return false
  return validatePlacements(value.basis as TimetableBasis, value.placements).valid
}
export function createSavedCandidate(basis: TimetableBasis, placements: Placement[], title: string, id: string, capturedAt: string): SavedCandidate {
  const candidate = { id, title: title.trim(), capturedAt, basis, placements }
  if (!validateSavedCandidate(candidate)) fail('전체 필수 조건을 통과한 배치와 올바른 후보 이름만 보관할 수 있습니다.')
  if (bytes(candidate) > policy.maximumBytes) fail('후보 한 개가 탭 보관 용량을 넘습니다. 기존 서버 초안 저장을 이용해 주세요.')
  return structuredClone(candidate)
}
export function readCandidateLibrary(raw: unknown, basis: TimetableBasis): SavedCandidate[] {
  if (!Array.isArray(raw)) return fail('보관 후보는 배열이어야 합니다. 현재 작업은 그대로 두고 후보 보관함만 비워 주세요.')
  if (raw.length > policy.maxCandidates || raw.some(value => !validateSavedCandidate(value)) || new Set(raw.map(row => row.id)).size !== raw.length || bytes(raw) > policy.maximumBytes) fail('보관 후보를 검증하지 못했습니다. 현재 작업은 그대로 두고 후보 보관함만 비워 주세요.')
  if (raw.some(row => row.basis.schoolId !== basis.schoolId || row.basis.termId !== basis.termId)) fail('다른 학교·학기의 후보는 열 수 없습니다.')
  return structuredClone(raw) as SavedCandidate[]
}
export function appendCandidate(entries: SavedCandidate[], candidate: SavedCandidate): SavedCandidate[] {
  const previous = readCandidateLibrary(entries, candidate.basis)
  if (!validateSavedCandidate(candidate)) fail('검증되지 않은 후보를 보관할 수 없습니다.')
  if (previous.some(row => row.id === candidate.id)) fail('후보 번호가 중복되었습니다. 다시 보관해 주세요.')
  const basisKey = candidateBasisKey(candidate.basis), placements = placementKey(candidate.placements)
  if (previous.some(row => candidateBasisKey(row.basis) === basisKey && placementKey(row.placements) === placements)) fail('같은 기준과 배치를 이미 보관했습니다. 기존 후보를 선택해 주세요.')
  if (previous.length >= policy.maxCandidates) fail(`후보는 최대 ${policy.maxCandidates}개입니다. 필요 없는 후보를 명시적으로 지운 뒤 다시 보관해 주세요.`)
  const next = [...previous, structuredClone(candidate)]
  if (bytes(next) > policy.maximumBytes) fail('탭 후보 보관 용량을 넘습니다. 필요 없는 후보를 지우거나 서버 초안에 저장해 주세요.')
  return next
}
export function candidateMatchesBasis(candidate: SavedCandidate, basis: TimetableBasis): boolean {
  return validateSavedCandidate(candidate) && candidateBasisKey(candidate.basis) === candidateBasisKey(basis)
}
export function adoptSavedCandidate(candidate: SavedCandidate, basis: TimetableBasis): Placement[] {
  if (!candidateMatchesBasis(candidate, basis)) fail('기초 자료 또는 조건이 바뀐 후보는 채택할 수 없습니다. 현재 조건으로 다시 계산해 주세요.')
  if (!validatePlacements(basis, candidate.placements).valid) fail('현재 조건에서 후보의 필수 조건을 다시 확인하지 못했습니다.')
  return structuredClone(candidate.placements)
}
export function compareSavedCandidates(before: SavedCandidate, after: SavedCandidate) {
  if (!validateSavedCandidate(before) || !validateSavedCandidate(after)) fail('검증되지 않은 후보는 비교할 수 없습니다.')
  const reviewed = reviewCandidate(after.basis, after.placements, { basis: before.basis, placements: before.placements })
  const comparable = candidateBasisKey(before.basis) === candidateBasisKey(after.basis)
  const first = evaluateTimetableQuality(before.basis, before.placements), second = evaluateTimetableQuality(after.basis, after.placements)
  if (!first.valid || !second.valid) return fail('후보 품질을 독립 검증하지 못했습니다.')
  return { ...reviewed, comparable, scores: comparable ? {
    beforePenalty: first.preferencePenalty, afterPenalty: second.preferencePenalty,
    beforePeak: Math.max(0, ...first.teacherLoads.map(row => row.maxDailyPeriods)), afterPeak: Math.max(0, ...second.teacherLoads.map(row => row.maxDailyPeriods)),
  } : null }
}
/** 옛 담당자와 새 담당자 양쪽을 검색한다. 동명이인은 ID 선택으로 구별한다. */
export function filterCandidateChanges(changes: CandidateChange[], query: string, resourceId: string): CandidateChange[] {
  const text = normalized(query)
  return changes.filter(row => {
    const sides = [row.before, row.after].filter(value => value !== null)
    const matchesResource = !resourceId || sides.some(side => side.resources.some(resource => resource.id === resourceId))
    const matchesQuery = !text || normalized([row.lessonId, ...sides.flatMap(side => [side.label, side.courseId, ...side.resources.flatMap(resource => [resource.id, resource.label])])].join(' ')).includes(text)
    return matchesResource && matchesQuery
  })
}
