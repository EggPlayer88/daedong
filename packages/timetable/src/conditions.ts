import type { TimetableBasis, TimetableIssue } from './types'
import { validateBasis, timetablePolicy } from './validate'

/** AI·엑셀은 이 목록 안의 구조화 제안만 만든다. 지원하지 않는 조건을 일반 메모로 낮추지 않는다. */
export const timetableConditionRegistry = [
  { kind: 'fixed', strength: 'hard', label: '수업 시간 고정' },
  { kind: 'unavailable', strength: 'hard', label: '교사·학급·공간 사용 불가' },
  { kind: 'allowed_slots', strength: 'hard', label: '수업 허용 시간 제한' },
  { kind: 'slot_penalty', strength: 'soft', label: '가급적 피할 수업 시간' },
] as const
export type TimetableCondition =
  | { id: string; kind: 'fixed'; lessonId: string; slotId: string }
  | { id: string; kind: 'unavailable'; resourceId: string; day: number; startMinute: number; endMinute: number }
  | { id: string; kind: 'allowed_slots'; lessonId: string; slotIds: string[] }
  | { id: string; kind: 'slot_penalty'; lessonId: string; slotId: string; weight: number }
export type CompiledConditions = { valid: true; basis: TimetableBasis; appliedIds: string[]; issues: [] } | { valid: false; basis: null; appliedIds: []; issues: TimetableIssue[] }

/** 확인된 제안을 원본 복사본에만 적용한다. 한 건이라도 잘못되면 어떤 조건도 적용하지 않는다. */
export function compileTimetableConditions(basis: TimetableBasis, value: unknown): CompiledConditions {
  const invalid = (issues: TimetableIssue[]): CompiledConditions => ({ valid: false, basis: null, appliedIds: [], issues })
  const checked = validateBasis(basis)
  if (!checked.valid) return invalid(checked.issues)
  if (!Array.isArray(value) || value.length > timetablePolicy.maxConditions) return invalid([{ code: 'INVALID_CONDITIONS', message: '조건 배열과 입력 한도를 확인해 주세요.', path: 'conditions' }])
  const result = structuredClone(basis), seen = new Set<string>(), issues: TimetableIssue[] = []
  const keys = { fixed: ['id', 'kind', 'lessonId', 'slotId'], unavailable: ['id', 'kind', 'resourceId', 'day', 'startMinute', 'endMinute'], allowed_slots: ['id', 'kind', 'lessonId', 'slotIds'], slot_penalty: ['id', 'kind', 'lessonId', 'slotId', 'weight'] }
  for (let i = 0; i < value.length; i++) {
    const r = value[i], path = `conditions[${i}]`
    const add = (code: string, message: string) => { if (issues.length < timetablePolicy.maxIssues) issues.push({ code, message, path }) }
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.kind !== 'string' || !Object.hasOwn(keys, r.kind)) { add('UNSUPPORTED_CONDITION', '이 조건 종류는 아직 지원하지 않습니다. 다른 조건으로 바꾸어 적용하지 않습니다.'); continue }
    const allowed = keys[r.kind as keyof typeof keys]
    if (Object.keys(r).length !== allowed.length || !allowed.every(k => Object.hasOwn(r, k)) || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(r.id) || seen.has(r.id)) { add('INVALID_CONDITION', '조건 항목·식별자·중복을 확인해 주세요.'); continue }
    seen.add(r.id)
    if (r.kind === 'fixed') {
      const existing = result.fixed.find(f => f.lessonId === r.lessonId)
      if (existing && existing.slotId !== r.slotId) add('FIXED_CONFLICT', '이미 고정한 수업과 충돌합니다. 원래 고정을 먼저 검토해 주세요.')
      else if (!existing) result.fixed.push({ lessonId: r.lessonId, slotId: r.slotId })
    } else if (r.kind === 'unavailable') result.unavailable.push({ resourceId: r.resourceId, day: r.day, startMinute: r.startMinute, endMinute: r.endMinute })
    else if (r.kind === 'allowed_slots') {
      const lesson = result.lessons.find(l => l.id === r.lessonId)
      if (!lesson || !Array.isArray(r.slotIds) || !r.slotIds.length || r.slotIds.some((s: unknown) => typeof s !== 'string' || !lesson.allowedSlotIds.includes(s)) || new Set(r.slotIds).size !== r.slotIds.length) add('INVALID_ALLOWED_SLOTS', '기존 허용 시간 안에서 중복 없이 제한해 주세요.')
      else lesson.allowedSlotIds = lesson.allowedSlotIds.filter(s => r.slotIds.includes(s))
    } else {
      if (!Number.isSafeInteger(r.weight) || r.weight < 0 || r.weight > timetablePolicy.maxWeight) { add('INVALID_WEIGHT', '선호 벌점 범위를 확인해 주세요.'); continue }
      const old = result.preferences.find(p => p.lessonId === r.lessonId && p.slotId === r.slotId)
      if (old) old.weight += r.weight
      else result.preferences.push({ lessonId: r.lessonId, slotId: r.slotId, weight: r.weight })
    }
  }
  if (issues.length) return invalid(issues)
  const final = validateBasis(result)
  return final.valid ? { valid: true, basis: result, appliedIds: [...seen], issues: [] } : invalid(final.issues)
}
