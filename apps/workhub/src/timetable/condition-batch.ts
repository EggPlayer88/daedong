import { overlaps, timetablePolicy, validateBasis } from '../../../../packages/timetable/src/validate'
import type { TimetableBasis, TimetableConditions } from './contracts'
import { canonical } from '../services/scoped-rpc'
import { timetableConditions } from './server'
import { reviewTimetablePreflight } from './preflight'
import { conditionTargetLabels, strongerPreferenceWeight } from './condition-policy'

export interface ConditionBatchAction { kind: 'unavailable' | 'preferences'; resourceIds: string[]; days: number[]; startMinute: number; endMinute: number; weight: number }
export interface ConditionBatchPreview { sourceKey: string; action: ConditionBatchAction; conditions: TimetableConditions; rows: string[]; skipped: number; affectedLessons: number; warnings: string[] }
export interface ConditionBatchState { kind: ConditionBatchAction['kind']; resourceIds: string[]; days: number[]; start: string; end: string; weight: string; search: string; resourceKind: string; preview?: ConditionBatchPreview; confirmed: boolean }
export const initialConditionBatch = (): ConditionBatchState => ({ kind: 'unavailable', resourceIds: [], days: [], start: '', end: '', weight: '3', search: '', resourceKind: 'teacher', confirmed: false })
export const hasConditionBatchInput = (state?: ConditionBatchState) => !!state && Boolean(state.resourceIds.length || state.days.length || state.start || state.end || state.kind !== 'unavailable' || state.weight !== '3' || state.preview)
export const conditionBatchSourceKey = (basis: TimetableBasis, conditions: TimetableConditions) => canonical([basis, conditions])
export const conditionBatchMinute = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : value === '24:00' ? 1440 : NaN
export const conditionBatchClock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const weekdays = ['월', '화', '수', '목', '금', '토', '일']
const fail = (message: string): never => { throw new Error(message) }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
function covered(rows: TimetableConditions['unavailable'], start: number, end: number) {
  let through = start
  for (const row of [...rows].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)) { if (row.startMinute > through) break; through = Math.max(through, row.endMinute); if (through >= end) return true }
  return false
}
/** 선택한 대상의 주간 조건만 추가한다. 공식 필수조건이나 기존의 더 강한 선호는 덮어쓰지 않는다. */
export function previewConditionBatch(basis: TimetableBasis, current: TimetableConditions, action: ConditionBatchAction): ConditionBatchPreview {
  if (!validateBasis(basis).valid) fail('기초 자료를 먼저 확인해 주세요.')
  let conditions: TimetableConditions
  try { conditions = timetableConditions(current, basis) } catch { return fail('현재 조건이 학교 기준자료와 일치하지 않습니다. 다시 확인해 주세요.') }
  if (!action || !['unavailable', 'preferences'].includes(action.kind) || Object.keys(action).sort().join() !== 'days,endMinute,kind,resourceIds,startMinute,weight') fail('지원하는 일괄 조건 형식을 확인해 주세요.')
  const ids = action.resourceIds, days = action.days, resourceMap = new Map(basis.resources.map(row => [row.id, row]))
  if (!Array.isArray(ids) || !ids.length || ids.length > timetablePolicy.maxResources || new Set(ids).size !== ids.length || ids.some(id => !resourceMap.has(id))) fail('조건을 적용할 대상을 한 명 이상 선택해 주세요. 삭제되거나 중복된 대상은 사용할 수 없습니다.')
  if (!Array.isArray(days) || !days.length || days.length > 7 || new Set(days).size !== days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) fail('적용 요일을 한 개 이상 선택해 주세요.')
  if (!Number.isInteger(action.startMinute) || !Number.isInteger(action.endMinute) || action.startMinute < 0 || action.endMinute > 1440 || action.startMinute >= action.endMinute) fail('시작·종료 시각을 확인해 주세요. 자정을 넘는 조건은 요일별로 나누어 입력합니다.')
  if (!Number.isSafeInteger(action.weight) || action.weight < 1 || action.weight > timetablePolicy.maxWeight) fail(`피하고 싶은 정도는 1~${timetablePolicy.maxWeight}의 정수로 입력해 주세요.`)
  const selected = new Set(ids), daySet = new Set(days), rows: string[] = [], lessons = basis.lessons.filter(lesson => lesson.resourceIds.some(id => selected.has(id))).sort((a, b) => compare(a.id, b.id))
  const sortedDays = [...days].sort((a, b) => a - b), resources = ids.map(id => resourceMap.get(id)!).sort((a, b) => a.label.localeCompare(b.label, 'ko') || compare(a.id, b.id)), slots = new Map(basis.slots.map(slot => [slot.id, slot]))
  const targetLabels = conditionTargetLabels(basis.resources)
  let skipped = 0
  if (action.kind === 'unavailable') {
    const indexed = new Map<string, TimetableConditions['unavailable']>()
    for (const row of conditions.unavailable) { const key = canonical([row.resourceId, row.day]); const list = indexed.get(key) ?? []; list.push(row); indexed.set(key, list) }
    for (const resource of resources) for (const day of sortedDays) {
      if (covered(indexed.get(canonical([resource.id, day])) ?? [], action.startMinute, action.endMinute)) { skipped++; continue }
      conditions.unavailable.push({ resourceId: resource.id, day, startMinute: action.startMinute, endMinute: action.endMinute })
      rows.push(`${targetLabels.get(resource.id)} · ${weekdays[day - 1]} ${conditionBatchClock(action.startMinute)}–${conditionBatchClock(action.endMinute)} · 필수 불가 추가`)
    }
  } else {
    const pairs = new Map(conditions.preferences.map((row, index) => [canonical([row.lessonId, row.slotId]), index]))
    for (const lesson of lessons) for (const slotId of [...lesson.allowedSlotIds].sort(compare)) {
      const slot = slots.get(slotId)!
      if (!daySet.has(slot.day) || !overlaps(slot, { day: slot.day, startMinute: action.startMinute, endMinute: action.endMinute })) continue
      const key = canonical([lesson.id, slotId]), index = pairs.get(key), old = index === undefined ? undefined : conditions.preferences[index]
      const weight = strongerPreferenceWeight(old?.weight, action.weight)
      if (old && old.weight === weight) { skipped++; continue }
      if (index === undefined) { pairs.set(key, conditions.preferences.length); conditions.preferences.push({ lessonId: lesson.id, slotId, weight }) }
      else conditions.preferences[index] = { lessonId: lesson.id, slotId, weight }
      rows.push(`${lesson.label} · ${weekdays[slot.day - 1]} ${slot.label} ${conditionBatchClock(slot.startMinute)}–${conditionBatchClock(slot.endMinute)} · 피하기 ${old ? `${old.weight} → ` : ''}${weight}`)
      if (conditions.preferences.length > timetablePolicy.maxConditions) fail('일괄 조건이 편성 한도를 넘습니다. 대상이나 요일·시간을 좁혀 주세요. 일부만 반영하지 않았습니다.')
    }
  }
  if (!validateBasis({ ...basis, ...conditions }).valid) fail('일괄 조건이 현재 편성 한도를 넘거나 입력과 맞지 않습니다. 일부만 반영하지 않았습니다.')
  const proof = reviewTimetablePreflight({ ...basis, ...conditions })
  return { sourceKey: conditionBatchSourceKey(basis, current), action: { ...structuredClone(action), resourceIds: [...ids].sort(compare), days: sortedDays }, conditions, rows, skipped, affectedLessons: lessons.length, warnings: proof.cards.map(card => `${card.title} · ${card.message}`) }
}
export function applyConditionBatch(basis: TimetableBasis, current: TimetableConditions, preview: ConditionBatchPreview): TimetableConditions {
  if (conditionBatchSourceKey(basis, current) !== preview.sourceKey) return fail('기초 자료나 현재 조건이 바뀌었습니다. 입력을 보관했으니 다시 미리보기해 주세요.')
  const next = previewConditionBatch(basis, current, preview.action)
  if (canonical(next) !== canonical(preview)) return fail('미리보기 내용이 달라졌습니다. 다시 확인해 주세요.')
  if (!next.rows.length) return fail('추가할 조건이 없습니다. 선택한 시간과 기존 조건을 확인해 주세요.')
  return next.conditions
}
