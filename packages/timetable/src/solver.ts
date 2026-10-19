import policy from '../_assets/browser-policy.json'
import type { Placement, SolveOptions, SolveResult, TimetableBasis, TimetableIssue, TimetableLesson, TimetableSlot } from './types'
import { validateBasis, validatePlacements } from './validate'
export type { Placement, SolveOptions, SolveResult, TimetableBasis } from './types'

const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now()
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** 한정 탐색으로 첫 유효안을 만든다. 품질 최적성이나 전국 학교 지원을 주장하지 않는다. */
export function solveTimetable(value: unknown, options: SolveOptions = {}): SolveResult {
  const started = clock()
  let nodes = 0, cutoff = false
  const result = (status: SolveResult['status'], placements: Placement[] = [], issues: TimetableIssue[] = [], score: number | null = null, exhausted = false): SolveResult => ({
    status, placements, issues, score, stats: { nodes, elapsedMs: Math.max(0, clock() - started), exhausted }, optimal: false,
  })
  const checked = validateBasis(value)
  if (!checked.valid) return result('invalid', [], checked.issues)
  if ((value as TimetableBasis).unsupportedFeatures.length) return result('unsupported', [], (value as TimetableBasis).unsupportedFeatures.map(feature => ({ code: 'UNSUPPORTED_FEATURE', message: `이 편성에서 아직 처리할 수 없는 조건: ${feature}`, path: 'basis.unsupportedFeatures' })))
  const rawOptions: unknown = options
  if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions) || Object.keys(rawOptions).some(k => !['maxNodes', 'maxMs'].includes(k))) {
    return result('invalid', [], [{ code: 'INVALID_OPTIONS', message: '지원하는 탐색 한도만 지정해 주세요.', path: 'options' }])
  }
  const maxNodes = options.maxNodes ?? policy.defaultMaxNodes, maxMs = options.maxMs ?? policy.defaultMaxMs
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > policy.maximumMaxNodes || typeof maxMs !== 'number' || !Number.isFinite(maxMs) || maxMs <= 0 || maxMs > policy.maximumMaxMs) {
    return result('invalid', [], [{ code: 'INVALID_OPTIONS', message: '브라우저 탐색 시간·횟수 한도를 확인해 주세요.', path: 'options' }])
  }
  const basis = value as TimetableBasis, deadline = started + maxMs
  const timedOut = () => { if (clock() >= deadline) cutoff = true; return cutoff }
  const slots = new Map(basis.slots.map(s => [s.id, s])), resources = new Map(basis.resources.map(r => [r.id, r]))
  const fixed = new Map(basis.fixed.map(f => [f.lessonId, f.slotId]))
  const weights = new Map<string, Map<string, number>>()
  for (const preference of basis.preferences) { const row = weights.get(preference.lessonId) ?? new Map<string, number>(); row.set(preference.slotId, preference.weight); weights.set(preference.lessonId, row) }
  const penalty = (lessonId: string, slotId: string) => weights.get(lessonId)?.get(slotId) ?? 0
  const lessons = [...basis.lessons].sort((a, b) => order(a.id, b.id))
  const domains = new Map<string, TimetableSlot[]>()
  const unavailable = new Map<string, TimetableBasis['unavailable']>(), availability = new Map<string, Map<string, boolean>>()
  for (const row of basis.unavailable) { const rows = unavailable.get(row.resourceId) ?? []; rows.push(row); unavailable.set(row.resourceId, rows) }
  for (const lesson of lessons) {
    if (timedOut()) return result('unknown', [], [{ code: 'SEARCH_LIMIT', message: '탐색 시간 안에 결론을 내리지 못했습니다.', path: 'options' }])
    const allowed: TimetableSlot[] = []
    for (const slotId of lesson.allowedSlotIds) {
      if (timedOut()) return result('unknown', [], [{ code: 'SEARCH_LIMIT', message: '탐색 시간 안에 결론을 내리지 못했습니다.', path: 'options' }])
      if (fixed.has(lesson.id) && fixed.get(lesson.id) !== slotId) continue
      const slot = slots.get(slotId)!
      let available = true
      for (const resourceId of lesson.resourceIds) {
        if (timedOut()) return result('unknown', [], [{ code: 'SEARCH_LIMIT', message: '탐색 시간 안에 결론을 내리지 못했습니다.', path: 'options' }])
        const cache = availability.get(resourceId) ?? new Map<string, boolean>()
        if (!cache.has(slotId)) { cache.set(slotId, !(unavailable.get(resourceId) ?? []).some(u => u.day === slot.day && u.startMinute < slot.endMinute && slot.startMinute < u.endMinute)); availability.set(resourceId, cache) }
        if (!cache.get(slotId)) { available = false; break }
      }
      if (available) allowed.push(slot)
    }
    allowed.sort((a, b) => penalty(lesson.id, a.id) - penalty(lesson.id, b.id) || a.day - b.day || a.startMinute - b.startMinute || a.endMinute - b.endMinute || order(a.id, b.id))
    if (!allowed.length) return result('infeasible', [], [{ code: 'NO_LEGAL_SLOT', message: `${lesson.label}: 고정·불가 시간을 지키는 배치가 없습니다.`, path: `lessons.${lesson.id}` }], null, true)
    domains.set(lesson.id, allowed)
  }
  const assigned = new Map<string, TimetableSlot>(), occupied = new Map<string, TimetableSlot[]>()
  // 후보 검사에는 탐색용 점유만 사용한다. 최종 검증기는 배치 전체를 별도로 재집계한다.
  const fits = (lesson: TimetableLesson, slot: TimetableSlot): boolean => {
    for (const id of lesson.resourceIds) {
      const capacity = resources.get(id)!.capacity
      const shared = (occupied.get(id) ?? []).filter(s => s.day === slot.day && s.startMinute < slot.endMinute && slot.startMinute < s.endMinute)
      if (capacity === 1 && shared.length) return false
      if (shared.length >= capacity) {
        const edges = shared.flatMap(s => [{ time: Math.max(slot.startMinute, s.startMinute), delta: 1 }, { time: Math.min(slot.endMinute, s.endMinute), delta: -1 }])
        edges.sort((a, b) => a.time - b.time || a.delta - b.delta)
        let count = 1
        for (const edge of edges) { count += edge.delta; if (count > capacity) return false }
      }
    }
    return true
  }
  const visit = (): boolean => {
    if (assigned.size === lessons.length) return true
    if (timedOut()) return false
    let chosen: TimetableLesson | undefined, choices: TimetableSlot[] = []
    for (const lesson of lessons) {
      if (assigned.has(lesson.id)) continue
      const possible: TimetableSlot[] = []
      for (const slot of domains.get(lesson.id)!) {
        if (timedOut()) return false
        if (fits(lesson, slot)) possible.push(slot)
      }
      if (!possible.length) return false
      if (!chosen || possible.length < choices.length) { chosen = lesson; choices = possible; if (choices.length === 1) break }
    }
    if (!chosen) return false
    for (const slot of choices) {
      if (nodes >= maxNodes || timedOut()) { cutoff = true; return false }
      nodes += 1
      assigned.set(chosen.id, slot)
      for (const id of chosen.resourceIds) { const row = occupied.get(id) ?? []; row.push(slot); occupied.set(id, row) }
      if (visit()) return true
      for (const id of chosen.resourceIds) occupied.get(id)!.pop()
      assigned.delete(chosen.id)
      if (cutoff) return false
    }
    return false
  }
  if (!visit()) return cutoff
    ? result('unknown', [], [{ code: 'SEARCH_LIMIT', message: '탐색 한도 안에 유효안을 찾지 못했습니다. 편성 불가능으로 확정하지 않습니다.', path: 'options' }])
    : result('infeasible', [], [{ code: 'SEARCH_EXHAUSTED', message: '입력된 모든 허용 배치를 확인했지만 조건을 함께 만족하는 안이 없습니다.', path: 'basis' }], null, true)
  const placements = lessons.map(l => ({ lessonId: l.id, slotId: assigned.get(l.id)!.id }))
  const validated = validatePlacements(basis, placements)
  if (!validated.valid) return result('invalid', [], [{ code: 'INTERNAL_VALIDATION_FAILED', message: '계산 결과의 독립 검증에 실패했습니다. 이 후보는 사용할 수 없습니다.', path: 'placements' }, ...validated.issues])
  return result('feasible', placements, [], placements.reduce((sum, p) => sum + penalty(p.lessonId, p.slotId), 0))
}
