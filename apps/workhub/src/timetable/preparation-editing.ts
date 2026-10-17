import type { TimetableSlot } from '../../../../packages/timetable/src/types'
import { canonical, identifier } from '../services/scoped-rpc'
import { preparationDraft, type PreparationDraft, type PreparationSource } from './preparation'
import limits from '../../../../packages/timetable/_assets/browser-policy.json'

export type PreparationEditingAction =
  | { kind: 'edit_slot'; slotId: string; label: string; startMinute: number; endMinute: number }
  | { kind: 'copy_day'; sourceDay: number; targetDays: number[]; slotIds: string[] }
  | { kind: 'single_blocks'; courseIds: string[]; mode: 'preserve' | 'replace'; allowedSlotIds: string[] }
export interface PreparationEditingPreview {
  sourceKey: string; action: PreparationEditingAction; nextDraft: PreparationDraft
  title: string; changes: string[]; warnings: string[]; blockers: string[]
  changedSlots: number; changedCourses: number; createdBlocks: number; keptCourses: number
  references: { courseId: string; label: string; blockId: string; blockIndex: number; allowedCount: number }[]
}
export interface PreparationEditingState {
  mode: 'edit_slot' | 'copy_day' | 'single_blocks'; editSlotId: string; editLabel: string; editStart: string; editEnd: string
  sourceDay: string; targetDays: number[]; copySlotIds: string[]; courseIds: string[]; blockMode: 'preserve' | 'replace'
  allowedSlotIds: string[]; search: string; preview?: PreparationEditingPreview; confirmed: boolean
}
export const initialPreparationEditing = (): PreparationEditingState => ({ mode: 'edit_slot', editSlotId: '', editLabel: '', editStart: '', editEnd: '', sourceDay: '1', targetDays: [], copySlotIds: [], courseIds: [], blockMode: 'preserve', allowedSlotIds: [], search: '', confirmed: false })
export function hasPreparationEditingInput(state: PreparationEditingState): boolean { return Boolean(state.editSlotId || state.targetDays.length || state.copySlotIds.length || state.courseIds.length || state.allowedSlotIds.length || state.preview) }
export const preparationEditingKey = (source: PreparationSource, draft: PreparationDraft): string => canonical([source.schoolId, source.termId, source.sourceRevision, source.sourceFingerprint, draft])
export const preparationClock = (value: number): string => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
export function preparationMinute(value: string): number { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : value === '24:00' ? 1440 : NaN }
const dayLabel = (day: number) => ['월', '화', '수', '목', '금', '토', '일'][day - 1]
const slotLabel = (slot: TimetableSlot) => `${dayLabel(slot.day)} ${slot.label} ${preparationClock(slot.startMinute)}–${preparationClock(slot.endMinute)} (${slot.periods}차시)`
const sameSlot = (a: TimetableSlot, b: TimetableSlot) => a.day === b.day && a.label === b.label && a.startMinute === b.startMinute && a.endMinute === b.endMinute && a.periods === b.periods
const overlap = (a: TimetableSlot, b: TimetableSlot) => a.day === b.day && a.startMinute < b.endMinute && b.startMinute < a.endMinute
const sameSet = (values: string[]) => new Set(values).size === values.length

/** 미리보기에서만 새 식별자를 만들고, 적용은 보관한 후보 자체를 사용한다. */
export function previewPreparationEditing(source: PreparationSource, draft: PreparationDraft, action: PreparationEditingAction, createId: () => string = () => crypto.randomUUID()): PreparationEditingPreview {
  const result: PreparationEditingPreview = { sourceKey: preparationEditingKey(source, draft), action: structuredClone(action), nextDraft: structuredClone(draft), title: '', changes: [], warnings: [], blockers: [], changedSlots: 0, changedCourses: 0, createdBlocks: 0, keptCourses: 0, references: [] }
  try { preparationDraft(draft, source) } catch { result.blockers.push('현재 준비 자료의 시수·시간대·수업 연결부터 확인해 주세요.'); return result }
  if (!source.canEdit) { result.blockers.push('현재 공식 자료의 편집 권한을 확인해 주세요.'); return result }
  const usedIds = new Set([...draft.slots.map(row => row.id), ...draft.plans.flatMap(plan => plan.blocks.map(block => block.id))])
  const nextId = () => { const id = identifier(createId()); if (usedIds.has(id)) throw new Error('ID_COLLISION'); usedIds.add(id); return id }
  try {
    if (action.kind === 'edit_slot') {
      result.title = '기존 시간대 변경 검토'
      const before = draft.slots.find(slot => slot.id === action.slotId)
      if (!before) { result.blockers.push('편집할 시간대를 다시 선택해 주세요.'); return result }
      const after = { ...before, label: action.label.trim(), startMinute: action.startMinute, endMinute: action.endMinute }
      result.nextDraft.slots = draft.slots.map(slot => slot.id === before.id ? after : structuredClone(slot))
      if (sameSlot(before, after)) { result.warnings.push('이름과 시각이 이전과 같습니다.'); return result }
      result.changedSlots = 1; result.changes.push(`${slotLabel(before)} → ${slotLabel(after)}`)
      for (const plan of draft.plans) plan.blocks.forEach((block, index) => { if (block.allowedSlotIds.includes(before.id)) result.references.push({ courseId: plan.courseId, label: source.courses.find(course => course.id === plan.courseId)!.label, blockId: block.id, blockIndex: index + 1, allowedCount: block.allowedSlotIds.length }) })
      result.warnings.push(`시간대 ID·요일·차시 수와 허용 목록은 유지합니다. 이 시간대를 허용한 수업 활동 ${result.references.length}개가 새 시각을 사용하게 됩니다.`)
      if (draft.slots.some(slot => slot.id !== before.id && sameSlot(slot, after))) result.blockers.push('같은 요일·이름·시각·차시의 시간대가 이미 있습니다. 기존 시간대를 합치거나 삭제하지 않았습니다.')
      if (draft.slots.some(slot => slot.id !== before.id && overlap(slot, after))) result.warnings.push('다른 시간대와 시각이 겹칩니다. 학년별 일과인지 확인해 주세요. 실제 교사·학생 중복은 기준판과 배치 검사에서 다시 확인합니다.')
    } else if (action.kind === 'copy_day') {
      result.title = '요일 일과 복사 검토'
      if (!Number.isInteger(action.sourceDay) || action.sourceDay < 1 || action.sourceDay > 7 || !action.targetDays.length || new Set(action.targetDays).size !== action.targetDays.length || action.targetDays.some(day => !Number.isInteger(day) || day < 1 || day > 7 || day === action.sourceDay) || !action.slotIds.length || !sameSet(action.slotIds)) { result.blockers.push('원본 요일·복사할 시간대·다른 대상 요일을 선택해 주세요.'); return result }
      const selected = action.slotIds.map(id => draft.slots.find(slot => slot.id === id && slot.day === action.sourceDay))
      if (selected.some(slot => !slot)) { result.blockers.push('원본 요일의 시간대가 바뀌었습니다. 다시 선택해 주세요.'); return result }
      let skipped = 0, overlaps = 0
      for (const day of [...action.targetDays].sort()) for (const original of selected as TimetableSlot[]) {
        const candidate = { ...original, day }
        if (result.nextDraft.slots.some(slot => sameSlot(slot, candidate))) { skipped++; continue }
        if (result.nextDraft.slots.some(slot => slot.day === day && slot.label === candidate.label && slot.periods === candidate.periods && (slot.startMinute !== candidate.startMinute || slot.endMinute !== candidate.endMinute))) { result.blockers.push(`${dayLabel(day)} ${candidate.label}: 같은 이름·차시의 기존 시간대와 시각이 다릅니다. 기존 일과를 먼저 확인해 주세요.`); continue }
        if (result.nextDraft.slots.length >= limits.maxSlots) { result.blockers.push(`시간대 전체 한도 ${limits.maxSlots}개를 넘습니다. 복사할 대상 범위를 줄여 주세요.`); continue }
        if (result.nextDraft.slots.some(slot => overlap(slot, candidate))) overlaps++
        const copied = { ...candidate, id: nextId() }; result.nextDraft.slots.push(copied); result.changedSlots++; result.changes.push(`추가 ${slotLabel(copied)}`)
      }
      if (skipped) result.warnings.push(`같은 요일·이름·시각·차시의 시간대 ${skipped}개는 중복 생성하지 않습니다.`)
      if (overlaps) result.warnings.push(`추가 시간대 ${overlaps}개가 다른 시간대와 겹칩니다. 학년별로 이름이 다른 시간대는 별개로 보존하며, 실제 배치의 교사·학생 충돌은 별도로 검사합니다.`)
      result.warnings.push('기존 시간대와 수업 활동의 허용 목록은 그대로입니다. 복사한 시간대를 수업에 허용하려면 별도로 선택해 주세요.')
    } else if (action.kind === 'single_blocks') {
      result.title = '1차시 수업 일괄 구성 검토'
      if (!action.courseIds.length || !sameSet(action.courseIds) || !sameSet(action.allowedSlotIds) || !['preserve', 'replace'].includes(action.mode)) { result.blockers.push('구성할 수업과 처리 방식을 다시 선택해 주세요.'); return result }
      const selected = action.courseIds.map(id => draft.plans.find(plan => plan.courseId === id))
      if (selected.some(plan => !plan)) { result.blockers.push('선택한 공식 수업의 준비 계획이 없습니다. 자료를 다시 확인해 주세요.'); return result }
      if (action.allowedSlotIds.some(id => !draft.slots.some(slot => slot.id === id && slot.periods === 1))) { result.blockers.push('허용 시간대는 현재 자료에 있는 1차시 시간대로 선택해 주세요.'); return result }
      const replaced = (selected as PreparationDraft['plans']).filter(plan => !plan.blocks.length || action.mode === 'replace')
      const projectedBlocks = draft.plans.reduce((sum, plan) => sum + plan.blocks.length, 0) + replaced.reduce((sum, plan) => sum + plan.weeklyPeriods - plan.blocks.length, 0)
      const projectedDomains = draft.plans.reduce((sum, plan) => sum + plan.blocks.reduce((total, block) => total + block.allowedSlotIds.length, 0), 0) + replaced.reduce((sum, plan) => sum + plan.weeklyPeriods * action.allowedSlotIds.length - plan.blocks.reduce((total, block) => total + block.allowedSlotIds.length, 0), 0)
      if (projectedBlocks > limits.maxLessons || projectedDomains > limits.maxDomainEntries) { result.blockers.push(`전체 수업 활동 ${limits.maxLessons}개 또는 허용 시간 연결 ${limits.maxDomainEntries}개 한도를 넘습니다. 선택 범위를 줄여 주세요.`); return result }
      const selectedIds = new Set(action.courseIds)
      for (const plan of selected as PreparationDraft['plans']) {
        const course = source.courses.find(row => row.id === plan.courseId)!, total = plan.blocks.reduce((sum, block) => sum + block.periods, 0)
        if (!Number.isSafeInteger(plan.weeklyPeriods) || plan.weeklyPeriods < 1 || plan.weeklyPeriods > limits.maxCoursePeriods || course.requiredPeriods !== null && plan.weeklyPeriods !== course.requiredPeriods) result.blockers.push(`${course.label}: 공식 시수 또는 입력한 주간 기준 시수를 먼저 확인해 주세요.`)
        if (plan.blocks.length && total !== plan.weeklyPeriods) result.blockers.push(`${course.label}: 기존 활동 ${total}차시와 기준 ${plan.weeklyPeriods}차시가 다릅니다. 먼저 불일치를 정리해 주세요.`)
        if (plan.blocks.length && action.mode === 'preserve') { result.keptCourses++; result.warnings.push(`${course.label}: 기존 활동 ${plan.blocks.length}개와 허용 목록을 그대로 보존합니다.`); continue }
        if (!action.allowedSlotIds.length) { result.blockers.push(`${course.label}: 새 활동에 허용할 1차시 시간대를 선택해 주세요.`); continue }
        if (plan.blocks.length) result.warnings.push(`${course.label}: 기존 활동 ${plan.blocks.length}개를 새 활동 ${plan.weeklyPeriods}개로 대체합니다. 기존 활동 ID·연속수업·개별 허용 목록이 새 초안에서 교체됩니다.`)
        const next = result.nextDraft.plans.find(row => row.courseId === plan.courseId)!
        next.blocks = Array.from({ length: plan.weeklyPeriods }, () => ({ id: nextId(), periods: 1, allowedSlotIds: [...action.allowedSlotIds].sort() }))
        result.changedCourses++; result.createdBlocks += next.blocks.length; result.changes.push(`${course.label}: ${plan.blocks.length}개 활동 → 1차시 활동 ${next.blocks.length}개 · 허용 시간대 ${action.allowedSlotIds.length}개씩`)
      }
      if (result.nextDraft.plans.some((plan, index) => !selectedIds.has(plan.courseId) && canonical(plan) !== canonical(draft.plans[index]))) throw new Error('OUTSIDE_SELECTION')
    } else { result.blockers.push('지원하지 않는 준비 작업입니다.'); return result }
    preparationDraft(result.nextDraft, source)
  } catch { result.blockers.push('시간대 이름·실제 시각·전체 활동 수와 식별자를 확인해 주세요. 잘못된 후보는 반영하지 않습니다.') }
  result.warnings.push('이미 만든 편성 기준판·조건·배치는 바뀌지 않습니다. 새 기준판을 만든 뒤 고정·불가·선호 조건과 배치를 다시 검토해 주세요.')
  result.blockers = [...new Set(result.blockers)]
  return result
}

export function applyPreparationEditing(source: PreparationSource, draft: PreparationDraft, preview: PreparationEditingPreview): PreparationDraft {
  if (!source.canEdit || preview.sourceKey !== preparationEditingKey(source, draft)) throw new Error('공식 자료 또는 현재 초안이 바뀌었습니다. 변경 내용을 다시 확인해 주세요.')
  if (preview.blockers.length || !preview.changedSlots && !preview.changedCourses) throw new Error('반영할 변경이 없거나 먼저 해결할 항목이 있습니다.')
  // 보관한 후보의 ID를 재사용해 같은 입력으로 검산하며, 검토 밖의 수업 변경을 받지 않는다.
  const oldSlotIds = new Set(draft.slots.map(slot => slot.id))
  const ids = preview.action.kind === 'copy_day' ? preview.nextDraft.slots.filter(slot => !oldSlotIds.has(slot.id)).map(slot => slot.id) : preview.action.kind === 'single_blocks' ? preview.action.courseIds.flatMap(courseId => {
    const original = draft.plans.find(plan => plan.courseId === courseId)
    return original?.blocks.length && preview.action.kind === 'single_blocks' && preview.action.mode === 'preserve' ? [] : preview.nextDraft.plans.find(plan => plan.courseId === courseId)?.blocks.map(block => block.id) ?? []
  }) : []
  const checked = previewPreparationEditing(source, draft, preview.action, () => ids.shift()!)
  if (ids.length || canonical(checked) !== canonical(preview)) throw new Error('미리보기의 변경 내용이 달라졌습니다. 다시 검토해 주세요.')
  return preparationDraft(structuredClone(preview.nextDraft), source)
}
