import { overlaps, timetablePolicy, validateBasis } from '../../../../packages/timetable/src/validate'
import type { TimetableBasis, TimetableConditions } from './contracts'
import { canonical } from '../services/scoped-rpc'
import { timetableConditions } from './server'
import { reviewTimetablePreflight } from './preflight'
import { conditionTargetLabels, strongerPreferenceWeight } from './condition-policy'

export interface ConditionTimeBatchAction { kind: 'unavailable' | 'preferences'; resourceIds: string[]; days: number[]; startMinute: number; endMinute: number; weight: number }
export interface ConditionSlotBatchAction { kind: 'unavailable' | 'preferences'; resourceIds: string[]; slotIds: string[]; weight: number }
export type ConditionBatchAction = ConditionTimeBatchAction | ConditionSlotBatchAction
export interface ConditionBatchPreview { sourceKey: string; action: ConditionBatchAction; conditions: TimetableConditions; rows: string[]; skipped: number; affectedLessons: number; warnings: string[] }
export interface ConditionBatchState { kind: ConditionBatchAction['kind']; resourceIds: string[]; days: number[]; start: string; end: string; weight: string; search: string; resourceKind: string; inputMode?: 'range' | 'slots'; slotIds?: string[]; preview?: ConditionBatchPreview; confirmed: boolean }
export const initialConditionBatch = (): ConditionBatchState => ({ kind: 'unavailable', resourceIds: [], days: [], start: '', end: '', weight: '3', search: '', resourceKind: 'teacher', confirmed: false })
export const hasConditionBatchInput = (state?: ConditionBatchState) => !!state && Boolean(state.resourceIds.length || state.days.length || state.start || state.end || state.kind !== 'unavailable' || state.weight !== '3' || state.slotIds?.length || state.preview)
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
  if (!action || !['unavailable', 'preferences'].includes(action.kind)) fail('지원하는 일괄 조건 형식을 확인해 주세요.')
  const slotMode = 'slotIds' in action
  if (Object.keys(action).sort().join() !== (slotMode ? 'kind,resourceIds,slotIds,weight' : 'days,endMinute,kind,resourceIds,startMinute,weight')) fail('지원하는 일괄 조건 형식을 확인해 주세요.')
  const ids = action.resourceIds, resourceMap = new Map(basis.resources.map(row => [row.id, row])), slots = new Map(basis.slots.map(slot => [slot.id, slot]))
  if (!Array.isArray(ids) || !ids.length || ids.length > timetablePolicy.maxResources || new Set(ids).size !== ids.length || ids.some(id => !resourceMap.has(id))) fail('조건을 적용할 대상을 한 명 이상 선택해 주세요. 삭제되거나 중복된 대상은 사용할 수 없습니다.')
  const windows: { day: number; startMinute: number; endMinute: number }[] = []
  let normalizedAction: ConditionBatchAction
  if ('slotIds' in action) {
    if (!Array.isArray(action.slotIds) || !action.slotIds.length || action.slotIds.length > timetablePolicy.maxSlots || new Set(action.slotIds).size !== action.slotIds.length || action.slotIds.some(id => !slots.has(id))) fail('실제 시간대에서 한 곳 이상 선택해 주세요. 삭제되거나 중복된 시간대는 사용할 수 없습니다.')
    const selectedSlots = action.slotIds.map(id => slots.get(id)!).sort((a, b) => a.day - b.day || a.startMinute - b.startMinute || a.endMinute - b.endMinute || compare(a.id, b.id))
    // 같은 실제 시각을 가진 학년별 시간대는 한 조건으로 다룬다. 교시 이름으로 시간을 추측하지 않는다.
    const seen = new Set<string>()
    for (const slot of selectedSlots) { const key = canonical([slot.day, slot.startMinute, slot.endMinute]); if (!seen.has(key)) { seen.add(key); windows.push({ day: slot.day, startMinute: slot.startMinute, endMinute: slot.endMinute }) } }
    normalizedAction = { ...structuredClone(action), resourceIds: [...ids].sort(compare), slotIds: [...action.slotIds].sort(compare) }
  } else {
    const days = action.days
    if (!Array.isArray(days) || !days.length || days.length > 7 || new Set(days).size !== days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) fail('적용 요일을 한 개 이상 선택해 주세요.')
    if (!Number.isInteger(action.startMinute) || !Number.isInteger(action.endMinute) || action.startMinute < 0 || action.endMinute > 1440 || action.startMinute >= action.endMinute) fail('시작·종료 시각을 확인해 주세요. 자정을 넘는 조건은 요일별로 나누어 입력합니다.')
    const sortedDays = [...days].sort((a, b) => a - b)
    windows.push(...sortedDays.map(day => ({ day, startMinute: action.startMinute, endMinute: action.endMinute })))
    normalizedAction = { ...structuredClone(action), resourceIds: [...ids].sort(compare), days: sortedDays }
  }
  const windowsByDay = new Map<number, { day: number; startMinute: number; endMinute: number }[]>()
  for (const window of windows) { const rows = windowsByDay.get(window.day) ?? []; rows.push({ ...window }); windowsByDay.set(window.day, rows) }
  for (const [day, rows] of windowsByDay) { rows.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute); const merged: typeof rows = []; for (const row of rows) { const last = merged[merged.length - 1]; if (last && last.endMinute >= row.startMinute) last.endMinute = Math.max(last.endMinute, row.endMinute); else merged.push(row) }; windowsByDay.set(day, merged) }
  const selectedAt = (slot: { day: number; startMinute: number; endMinute: number }) => { const rows = windowsByDay.get(slot.day) ?? []; let low = 0, high = rows.length; while (low < high) { const middle = (low + high) >>> 1; if (rows[middle].endMinute <= slot.startMinute) low = middle + 1; else high = middle }; return low < rows.length && overlaps(slot, rows[low]) }
  if (!Number.isSafeInteger(action.weight) || action.weight < 1 || action.weight > timetablePolicy.maxWeight) fail(`피하고 싶은 정도는 1~${timetablePolicy.maxWeight}의 정수로 입력해 주세요.`)
  const selected = new Set(ids), rows: string[] = [], lessons = basis.lessons.filter(lesson => lesson.resourceIds.some(id => selected.has(id))).sort((a, b) => compare(a.id, b.id))
  const resources = ids.map(id => resourceMap.get(id)!).sort((a, b) => a.label.localeCompare(b.label, 'ko') || compare(a.id, b.id))
  const targetLabels = conditionTargetLabels(basis.resources), lessonLabels = conditionTargetLabels(basis.lessons)
  let skipped = 0
  if (action.kind === 'unavailable') {
    const indexed = new Map<string, TimetableConditions['unavailable']>()
    for (const row of conditions.unavailable) { const key = canonical([row.resourceId, row.day]); const list = indexed.get(key) ?? []; list.push(row); indexed.set(key, list) }
    for (const resource of resources) for (const window of windows) {
      const key = canonical([resource.id, window.day]), existing = indexed.get(key) ?? []
      if (covered(existing, window.startMinute, window.endMinute)) { skipped++; continue }
      const row = { resourceId: resource.id, ...window }
      conditions.unavailable.push(row); existing.push(row); indexed.set(key, existing)
      rows.push(`${targetLabels.get(resource.id)} · ${weekdays[window.day - 1]} ${conditionBatchClock(window.startMinute)}–${conditionBatchClock(window.endMinute)} · 필수 불가 추가`)
      if (conditions.unavailable.length > timetablePolicy.maxConditions) fail('일괄 조건이 편성 한도를 넘습니다. 대상이나 시간대를 좁혀 주세요. 일부만 반영하지 않았습니다.')
    }
  } else {
    const pairs = new Map(conditions.preferences.map((row, index) => [canonical([row.lessonId, row.slotId]), index]))
    for (const lesson of lessons) for (const slotId of [...lesson.allowedSlotIds].sort(compare)) {
      const slot = slots.get(slotId)!
      if (!selectedAt(slot)) continue
      const key = canonical([lesson.id, slotId]), index = pairs.get(key), old = index === undefined ? undefined : conditions.preferences[index]
      const weight = strongerPreferenceWeight(old?.weight, action.weight)
      if (old && old.weight === weight) { skipped++; continue }
      if (index === undefined) { pairs.set(key, conditions.preferences.length); conditions.preferences.push({ lessonId: lesson.id, slotId, weight }) }
      else conditions.preferences[index] = { lessonId: lesson.id, slotId, weight }
      rows.push(`${lessonLabels.get(lesson.id)} · ${weekdays[slot.day - 1]} ${slot.label} ${conditionBatchClock(slot.startMinute)}–${conditionBatchClock(slot.endMinute)} · 피하기 ${old ? `${old.weight} → ` : ''}${weight}`)
      if (conditions.preferences.length > timetablePolicy.maxConditions) fail('일괄 조건이 편성 한도를 넘습니다. 대상이나 요일·시간을 좁혀 주세요. 일부만 반영하지 않았습니다.')
    }
  }
  if (!validateBasis({ ...basis, ...conditions }).valid) fail('일괄 조건이 현재 편성 한도를 넘거나 입력과 맞지 않습니다. 일부만 반영하지 않았습니다.')
  const proof = reviewTimetablePreflight({ ...basis, ...conditions })
  return { sourceKey: conditionBatchSourceKey(basis, current), action: normalizedAction, conditions, rows, skipped, affectedLessons: lessons.length, warnings: proof.cards.map(card => `${card.title} · ${card.message}`) }
}
export function applyConditionBatch(basis: TimetableBasis, current: TimetableConditions, preview: ConditionBatchPreview): TimetableConditions {
  if (conditionBatchSourceKey(basis, current) !== preview.sourceKey) return fail('기초 자료나 현재 조건이 바뀌었습니다. 입력을 보관했으니 다시 미리보기해 주세요.')
  const next = previewConditionBatch(basis, current, preview.action)
  if (canonical(next) !== canonical(preview)) return fail('미리보기 내용이 달라졌습니다. 다시 확인해 주세요.')
  if (!next.rows.length) return fail('추가할 조건이 없습니다. 선택한 시간과 기존 조건을 확인해 주세요.')
  return next.conditions
}
