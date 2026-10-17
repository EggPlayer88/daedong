import policy from '../_assets/engine-policy.json'
import type { Placement, TimetableBasis, TimetableIssue } from './types'
import { validateBasis, validatePlacements } from './validate'
import { evaluateTimetableQuality, type PreviousTimetable } from './quality'

export interface CpSatOptions { maxSeconds: number; maxCandidates: number; seed: number; minimizeChanges: boolean; improveTeacherBalance: boolean; spreadCourses: boolean }
export interface CpSatRequest { contract: 'timetable.solve.v1'; requestId: string; inputHash: string; basis: TimetableBasis; previous: PreviousTimetable | null; options: CpSatOptions }
export interface CpSatObjective { changedLessons: number; movedLessons: number; preferencePenalty: number; teacherPeakPeriods: number; courseRepeats: number }
export interface CpSatCandidate { placements: Placement[]; objective: CpSatObjective; optimal: boolean }
export interface CpSatResponse { contract: 'timetable.solve.v1'; requestId: string; inputHash: string; engineVersion: string; status: 'feasible' | 'infeasible' | 'unknown' | 'invalid' | 'unsupported' | 'error'; candidates: CpSatCandidate[]; issues: TimetableIssue[]; stats: { elapsedMs: number; branches: number; stoppedByLimit: boolean } }
const own = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => own(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
/** JSON 키 순서에만 무관하다. 원본 배열·이전 판·실행 옵션까지 지문에 묶는다. */
export function canonicalTimetableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalTimetableJson).join(',')}]`
  if (own(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalTimetableJson(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
async function digest(value: unknown): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalTimetableJson(value))))].map(v => v.toString(16).padStart(2, '0')).join('') }

export async function buildCpSatRequest(basis: TimetableBasis, requestId: string, previous: PreviousTimetable | null = null, options: Partial<CpSatOptions> = {}): Promise<CpSatRequest> {
  if (!validateBasis(basis).valid || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new Error('계산 요청의 기초판과 요청 번호를 확인해 주세요.')
  if (basis.lessons.reduce((n, l) => n + l.allowedSlotIds.length, 0) > policy.maximumModelChoices || basis.lessons.reduce((n, l) => n + l.allowedSlotIds.length * l.resourceIds.length, 0) > policy.maximumResourceChoices) throw new Error('계산 모델 크기 한도를 넘었습니다. 수업별 허용 시간과 수강 집단을 검토해 주세요.')
  if (previous !== null && (!exact(previous, ['basis', 'placements']) || !validatePlacements(previous.basis, previous.placements).valid || previous.basis.schoolId !== basis.schoolId || previous.basis.termId !== basis.termId)) throw new Error('이전 시간표는 같은 학교·학기의 당시 기초판과 유효 배치를 함께 전달해야 합니다.')
  if (!own(options) || Object.keys(options).some(k => !['maxSeconds', 'maxCandidates', 'seed', 'minimizeChanges', 'improveTeacherBalance', 'spreadCourses'].includes(k))) throw new Error('지원하지 않는 계산 옵션입니다.')
  const merged: CpSatOptions = { maxSeconds: policy.defaultMaxSeconds, maxCandidates: 1, seed: policy.defaultSeed, minimizeChanges: true, improveTeacherBalance: true, spreadCourses: true, ...options }
  if (!integer(merged.maxSeconds, 1, policy.maximumMaxSeconds) || !integer(merged.maxCandidates, 1, policy.maximumCandidates) || !integer(merged.seed, 0, 2147483647) || ['minimizeChanges', 'improveTeacherBalance', 'spreadCourses'].some(k => typeof merged[k as keyof CpSatOptions] !== 'boolean')) throw new Error('계산 시간·후보 수·최적화 설정을 확인해 주세요.')
  const payload = structuredClone({ contract: policy.contract as 'timetable.solve.v1', requestId, basis, previous, options: merged })
  if (new TextEncoder().encode(canonicalTimetableJson(payload)).length + 100 > policy.maximumRequestBytes) throw new Error('계산 요청 파일 크기 한도를 넘었습니다.')
  return { ...payload, inputHash: await digest(payload) }
}

export function evaluateCpSatObjective(basis: TimetableBasis, placements: Placement[], previous: PreviousTimetable | null): CpSatObjective {
  const quality = evaluateTimetableQuality(basis, placements)
  if (!quality.valid) throw new Error('유효하지 않은 배치는 평가할 수 없습니다.')
  const slots = new Map(basis.slots.map(s => [s.id, s])), lessons = new Map(basis.lessons.map(l => [l.id, l]))
  const courseDays = new Map<string, number>()
  for (const p of placements) { const key = JSON.stringify([lessons.get(p.lessonId)!.courseId, slots.get(p.slotId)!.day]); courseDays.set(key, (courseDays.get(key) ?? 0) + 1) }
  let changedLessons = 0, movedLessons = 0
  if (previous) {
    const oldLessons = new Map(previous.basis.lessons.map(l => [l.id, l])), oldPlaces = new Map(previous.placements.map(p => [p.lessonId, p.slotId])), oldSlots = new Map(previous.basis.slots.map(s => [s.id, s]))
    for (const p of placements) {
      const l = lessons.get(p.lessonId)!, old = oldLessons.get(p.lessonId), s = slots.get(p.slotId)!, oldSlot = old ? oldSlots.get(oldPlaces.get(p.lessonId)!) : undefined
      if (!old || !oldSlot || old.courseId !== l.courseId || old.periods !== l.periods || JSON.stringify([...old.resourceIds].sort()) !== JSON.stringify([...l.resourceIds].sort()) || oldSlot.day !== s.day || oldSlot.startMinute !== s.startMinute || oldSlot.endMinute !== s.endMinute) changedLessons++
      if (oldSlot && (oldSlot.day !== s.day || oldSlot.startMinute !== s.startMinute || oldSlot.endMinute !== s.endMinute)) movedLessons++
    }
    changedLessons += previous.basis.lessons.filter(l => !lessons.has(l.id)).length
  }
  return { changedLessons, movedLessons, preferencePenalty: quality.preferencePenalty!, teacherPeakPeriods: Math.max(0, ...quality.teacherLoads.map(t => t.maxDailyPeriods)), courseRepeats: [...courseDays.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0) }
}

/** 원래 요청 지문과 모든 후보를 다시 확인한다. 서버의 optimal 표시는 엔진 증명 보고이며 앱이 증명한 값은 아니다. */
export async function parseCpSatResponse(request: CpSatRequest, value: unknown): Promise<CpSatResponse> {
  const fail = () => { throw new Error('계산 결과가 원래 요청 또는 독립 검증과 일치하지 않습니다.') }
  const { inputHash, ...payload } = request
  const rebuilt = await buildCpSatRequest(request.basis, request.requestId, request.previous, request.options)
  if (inputHash !== rebuilt.inputHash || await digest(payload) !== inputHash) fail()
  if (!exact(value, ['contract', 'requestId', 'inputHash', 'engineVersion', 'status', 'candidates', 'issues', 'stats'])) return fail()
  if (value.contract !== policy.contract || value.requestId !== request.requestId || value.inputHash !== inputHash || value.engineVersion !== policy.engineVersion || !['feasible', 'infeasible', 'unknown', 'invalid', 'unsupported', 'error'].includes(value.status as string)) fail()
  if (!exact(value.stats, ['elapsedMs', 'branches', 'stoppedByLimit']) || typeof value.stats.elapsedMs !== 'number' || !Number.isFinite(value.stats.elapsedMs) || value.stats.elapsedMs < 0 || !integer(value.stats.branches, 0) || typeof value.stats.stoppedByLimit !== 'boolean') fail()
  if (!Array.isArray(value.candidates) || value.candidates.length > request.options.maxCandidates || !Array.isArray(value.issues) || value.issues.length > 101) return fail()
  for (const i of value.issues) if (!exact(i, ['code', 'message', 'path']) || typeof i.code !== 'string' || !/^[A-Z_]{1,100}$/.test(i.code) || typeof i.message !== 'string' || !i.message.trim() || i.message.length > 2000 || typeof i.path !== 'string' || i.path.length > 500) fail()
  const seen = new Set<string>()
  for (const c of value.candidates) {
    if (!exact(c, ['placements', 'objective', 'optimal']) || typeof c.optimal !== 'boolean' || !validatePlacements(request.basis, c.placements).valid || !exact(c.objective, ['changedLessons', 'movedLessons', 'preferencePenalty', 'teacherPeakPeriods', 'courseRepeats'])) return fail()
    const expected = evaluateCpSatObjective(request.basis, c.placements as Placement[], request.previous)
    for (const key of Object.keys(expected) as (keyof CpSatObjective)[]) if (expected[key] !== c.objective[key]) fail()
    const key = canonicalTimetableJson([...(c.placements as Placement[])].sort((a, b) => a.lessonId.localeCompare(b.lessonId)))
    if (seen.has(key)) fail(); seen.add(key)
  }
  if ((value.status === 'feasible') !== (value.candidates.length > 0) || (value.status === 'feasible' ? value.issues.length !== 0 : value.issues.length === 0)) fail()
  if (value.status === 'unsupported' && !request.basis.unsupportedFeatures.length || value.status === 'infeasible' && (value.stats as CpSatResponse['stats']).stoppedByLimit || ['feasible', 'infeasible', 'unknown'].includes(value.status as string) && request.basis.unsupportedFeatures.length > 0 || value.status === 'unknown' && !(value.stats as CpSatResponse['stats']).stoppedByLimit) fail()
  return structuredClone(value) as unknown as CpSatResponse
}
