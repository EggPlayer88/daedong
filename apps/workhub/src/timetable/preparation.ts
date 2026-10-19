import type { TimetableBasis, TimetableResource, TimetableSlot, TimetableIssue } from '../../../../packages/timetable/src/types'
import { validateBasis } from '../../../../packages/timetable/src/validate'
import { canonical, exact, identifier, isoDate, text, version, ServiceError } from '../services/scoped-rpc'
import limits from '../../../../packages/timetable/_assets/browser-policy.json'
import { reviewTimetableFoundation } from './foundation'

export const PREPARATION_CONTRACT = 'timetable.preparation.v1'
export interface PreparationCourse { id: string; label: string; requiredPeriods: number | null; resourceIds: string[] }
export interface PreparationDraft {
  title: string; slots: TimetableSlot[]
  plans: { courseId: string; weeklyPeriods: number; blocks: { id: string; periods: number; allowedSlotIds: string[] }[] }[]
}
export interface PreparationSource {
  sourceRevision: number; sourceFingerprint: string; schoolId: string; schoolLevel: TimetableBasis['schoolLevel']
  termId: string; termLabel: string; firstDay: string; lastDay: string; canEdit: boolean; canConfirm: boolean
  resources: TimetableResource[]; courses: PreparationCourse[]; unsupportedFeatures: string[]
  savedDraft: { id: string; revision: number; sourceFingerprint: string; draft: PreparationDraft } | null
}
export interface PreparationInput { kind: 'save' | 'confirm'; sourceRevision: number; sourceFingerprint: string; termId: string; draftId: string | null; expectedDraftRevision: number | null; draft: PreparationDraft }
export interface PreparationReceipt { requestKey: string; kind: PreparationInput['kind']; draftId: string; draftRevision: number; sourceFingerprint: string; basis: TimetableBasis | null }
export interface PreparationServer {
  get(memberId: string): Promise<PreparationSource>
  execute(memberId: string, input: PreparationInput, key: string): Promise<PreparationReceipt>
  recover(memberId: string, input: PreparationInput, key: string, originalSource?: PreparationSource): Promise<PreparationReceipt>
}
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const number = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fail()
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : fail()
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail()
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length ? rows : fail()
const references = (value: unknown, max: number) => unique(list(value, max).map(identifier), id => id)
const bool = (value: unknown) => typeof value === 'boolean' ? value : fail()

/** 미완성 초안은 허용하지만 구조와 참조는 저장 전에도 검사한다. */
export function preparationDraft(value: unknown, source?: PreparationSource): PreparationDraft {
  exact(value, ['title', 'slots', 'plans']); text(value.title, 120, true)
  const slots = unique(list(value.slots, limits.maxSlots).map(item => {
    exact(item, ['id', 'day', 'label', 'startMinute', 'endMinute', 'periods']); identifier(item.id); text(item.label, 100, true)
    const day = number(item.day, 1, 7), startMinute = number(item.startMinute, 0, 1439), endMinute = number(item.endMinute, 1, 1440), periods = number(item.periods, 1, limits.maxPeriods)
    if (startMinute >= endMinute) fail()
    return { id: item.id as string, label: item.label as string, day, startMinute, endMinute, periods }
  }), row => row.id)
  const bySlot = new Map(slots.map(slot => [slot.id, slot])), blockIds = new Set<string>()
  const plans = unique(list(value.plans, limits.maxLessons).map(item => {
    exact(item, ['courseId', 'weeklyPeriods', 'blocks']); const courseId = identifier(item.courseId), weeklyPeriods = number(item.weeklyPeriods, 0, limits.maxCoursePeriods)
    const course = source?.courses.find(row => row.id === courseId)
    if (source && (!course || course.requiredPeriods !== null && course.requiredPeriods !== weeklyPeriods)) fail()
    const blocks = list(item.blocks, limits.maxCoursePeriods).map(block => {
      exact(block, ['id', 'periods', 'allowedSlotIds']); const id = identifier(block.id), periods = number(block.periods, 1, limits.maxPeriods), allowedSlotIds = references(block.allowedSlotIds, limits.maxSlots)
      if (blockIds.has(id) || allowedSlotIds.some(slot => !bySlot.has(slot) || bySlot.get(slot)!.periods !== periods)) fail()
      blockIds.add(id); return { id, periods, allowedSlotIds }
    })
    return { courseId, weeklyPeriods, blocks }
  }), row => row.courseId)
  if (blockIds.size > limits.maxLessons || source && (plans.length !== source.courses.length || source.courses.some(course => !plans.some(plan => plan.courseId === course.id)))) fail()
  return { title: value.title as string, slots, plans }
}

export function preparationSource(value: unknown, schoolId: string): PreparationSource {
  exact(value, ['sourceRevision', 'sourceFingerprint', 'schoolId', 'schoolLevel', 'termId', 'termLabel', 'firstDay', 'lastDay', 'canEdit', 'canConfirm', 'resources', 'courses', 'unsupportedFeatures', 'savedDraft'])
  version(value.sourceRevision); hash(value.sourceFingerprint); identifier(value.schoolId); identifier(value.termId); text(value.termLabel, 120, true)
  isoDate(value.firstDay); isoDate(value.lastDay)
  const canEdit = bool(value.canEdit), canConfirm = bool(value.canConfirm)
  if (value.schoolId !== schoolId || (value.firstDay as string) > (value.lastDay as string) || !['primary', 'middle', 'high', 'other'].includes(String(value.schoolLevel)) || canConfirm && !canEdit) fail()
  const resources = unique(list(value.resources, limits.maxResources).map(row => {
    exact(row, ['id', 'kind', 'label', 'capacity']); identifier(row.id); text(row.label, 200, true); number(row.capacity, 1, limits.maxCapacity)
    if (!['teacher', 'class', 'student_group', 'room', 'equipment'].includes(String(row.kind)) || ['teacher', 'class', 'student_group'].includes(String(row.kind)) && row.capacity !== 1) fail()
    return row as unknown as TimetableResource
  }), row => row.id)
  const resourceIds = new Set(resources.map(row => row.id))
  const courses = unique(list(value.courses, limits.maxLessons).map(row => {
    exact(row, ['id', 'label', 'requiredPeriods', 'resourceIds']); identifier(row.id); text(row.label, 160, true)
    const requiredPeriods = row.requiredPeriods === null ? null : number(row.requiredPeriods, 1, limits.maxCoursePeriods), refs = references(row.resourceIds, limits.maxResources)
    if (refs.some(id => !resourceIds.has(id))) fail()
    return { id: row.id as string, label: row.label as string, requiredPeriods, resourceIds: refs }
  }), row => row.id)
  const unsupportedFeatures = list(value.unsupportedFeatures, 100).map(feature => text(feature, 200, true))
  const source = { ...value, canEdit, canConfirm, resources, courses, unsupportedFeatures, savedDraft: null } as unknown as PreparationSource
  if (value.savedDraft !== null) {
    exact(value.savedDraft, ['id', 'revision', 'sourceFingerprint', 'draft']); identifier(value.savedDraft.id); version(value.savedDraft.revision); hash(value.savedDraft.sourceFingerprint)
    source.savedDraft = { id: value.savedDraft.id as string, revision: value.savedDraft.revision as number, sourceFingerprint: value.savedDraft.sourceFingerprint as string, draft: preparationDraft(value.savedDraft.draft, value.savedDraft.sourceFingerprint === source.sourceFingerprint ? source : undefined) }
  }
  return structuredClone(source)
}

export function initialPreparationDraft(source: PreparationSource): PreparationDraft {
  return { title: `${source.termLabel} 편성 기준`, slots: [], plans: source.courses.map(course => ({ courseId: course.id, weeklyPeriods: course.requiredPeriods ?? 0, blocks: [] })) }
}
export function compilePreparation(source: PreparationSource, draft: PreparationDraft, basisId = 'preparation-preview', revision = 1): { basis: TimetableBasis | null; issues: TimetableIssue[] } {
  try { preparationDraft(draft, source) } catch { return { basis: null, issues: [{ code: 'INVALID_PREPARATION', message: '기초자료의 시수·시간대·수업 구성을 확인해 주세요.', path: 'draft' }] } }
  const resources = new Map(source.resources.map(row => [row.id, row])), issues: TimetableIssue[] = []
  for (const plan of draft.plans) {
    const course = source.courses.find(row => row.id === plan.courseId)!
    if (!plan.weeklyPeriods || plan.blocks.reduce((sum, block) => sum + block.periods, 0) !== plan.weeklyPeriods) issues.push({ code: 'COURSE_LOAD_MISMATCH', message: `${course.label}: 기준 ${plan.weeklyPeriods}차시와 구성한 수업 활동의 시수가 다릅니다.`, path: `plans.${course.id}` })
    if (!course.resourceIds.some(id => resources.get(id)?.kind === 'teacher')) issues.push({ code: 'MISSING_TEACHER', message: `${course.label}: 공식 담당 교사를 먼저 배정해 주세요.`, path: `courses.${course.id}` })
    if (!course.resourceIds.some(id => ['class', 'student_group'].includes(resources.get(id)?.kind ?? ''))) issues.push({ code: 'MISSING_STUDENTS', message: `${course.label}: 공식 학급 또는 수강 집단이 필요합니다.`, path: `courses.${course.id}` })
  }
  const basis: TimetableBasis = { schemaVersion: 1, id: basisId, revision, schoolId: source.schoolId, termId: source.termId, sourceFingerprint: source.sourceFingerprint, schoolLevel: source.schoolLevel, unsupportedFeatures: structuredClone(source.unsupportedFeatures), resources: structuredClone(source.resources), slots: structuredClone(draft.slots), courseLoads: draft.plans.map(plan => ({ courseId: plan.courseId, periods: plan.weeklyPeriods })), lessons: draft.plans.flatMap(plan => {
    const course = source.courses.find(row => row.id === plan.courseId)!
    return plan.blocks.map((block, index) => ({ id: block.id, courseId: course.id, label: `${course.label} ${index + 1}회`, periods: block.periods, resourceIds: [...course.resourceIds], allowedSlotIds: [...block.allowedSlotIds] }))
  }), fixed: [], unavailable: [], preferences: [] }
  if (issues.length) return { basis: null, issues }
  const checked = validateBasis(basis)
  if (!checked.valid) return { basis: null, issues: checked.issues }
  const review = reviewTimetableFoundation(basis)
  return { basis: review.ready ? basis : null, issues: review.issues }
}

export function preparationInput(value: unknown, source?: PreparationSource): PreparationInput {
  exact(value, ['kind', 'sourceRevision', 'sourceFingerprint', 'termId', 'draftId', 'expectedDraftRevision', 'draft'])
  if (!['save', 'confirm'].includes(String(value.kind))) fail()
  version(value.sourceRevision); hash(value.sourceFingerprint); identifier(value.termId)
  if ((value.draftId === null) !== (value.expectedDraftRevision === null)) fail()
  if (value.draftId !== null) { identifier(value.draftId); version(value.expectedDraftRevision) }
  if (source && (value.sourceRevision !== source.sourceRevision || value.sourceFingerprint !== source.sourceFingerprint || value.termId !== source.termId)) throw new ServiceError('CONFLICT')
  const draft = preparationDraft(value.draft, source)
  if (source && value.kind === 'confirm' && !compilePreparation(source, draft).basis) throw new ServiceError('INVALID_INPUT')
  return { ...value, draft } as unknown as PreparationInput
}
export function preparationReceipt(value: unknown, input: PreparationInput, key: string, source?: PreparationSource): PreparationReceipt {
  exact(value, ['requestKey', 'kind', 'draftId', 'draftRevision', 'sourceFingerprint', 'basis'])
  identifier(value.draftId); version(value.draftRevision)
  if (value.requestKey !== key || value.kind !== input.kind || value.sourceFingerprint !== input.sourceFingerprint || (input.draftId !== null && value.draftId !== input.draftId) || value.draftRevision !== (input.expectedDraftRevision ?? 0) + 1) fail()
  if (input.kind === 'save' ? value.basis !== null : !validateBasis(value.basis).valid) fail()
  if (input.kind === 'confirm') {
    const basis = value.basis as TimetableBasis
    if (basis.termId !== input.termId || basis.sourceFingerprint !== input.sourceFingerprint) fail()
    if (source) { const compiled = compilePreparation(source, input.draft, basis.id, basis.revision); if (!compiled.basis || canonical(compiled.basis) !== canonical(basis)) fail() }
  }
  return structuredClone(value) as unknown as PreparationReceipt
}
