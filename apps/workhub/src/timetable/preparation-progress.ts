import type { TimetableResource } from '../../../../packages/timetable/src/types'
import limits from '../../../../packages/timetable/_assets/browser-policy.json'
import { identifier } from '../services/service-values'
import { preparationDraft, preparationSource, type PreparationDraft, type PreparationSource } from './preparation'

export type PreparationProgressFilter = 'all' | 'hours' | 'activities' | 'slots' | 'resources' | 'ready'
export interface PreparationCourseProgress {
  courseId: string; label: string; resourceLabels: string[]
  weeklyPeriods: number | null; activityPeriods: number | null; activityCount: number
  needsHours: boolean; needsActivities: boolean; needsSlots: boolean; needsResources: boolean
  ready: boolean; notes: string[]
}
export interface PreparationResourceLoad {
  id: string; label: string; kind: TimetableResource['kind']; courseIds: string[]
  weeklyPeriods: number; unknownCourses: number
}
export interface PreparationProgress {
  available: boolean; structuralProblem: boolean; unexpectedPlans: number
  courses: PreparationCourseProgress[]; resources: PreparationResourceLoad[]
  counts: Record<PreparationProgressFilter, number>
}
const validId = (value: unknown): boolean => { try { identifier(value); return true } catch { return false } }
const emptyCounts = (): PreparationProgress['counts'] => ({ all: 0, hours: 0, activities: 0, slots: 0, resources: 0, ready: 0 })
const whole = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max

/** 입력 누락을 찾는 편의 요약이다. 편성 가능 여부는 compilePreparation과 서버가 별도로 판정한다. */
export function preparationProgress(source: PreparationSource, draft: PreparationDraft): PreparationProgress {
  let checked: PreparationSource
  try { checked = preparationSource(source, source?.schoolId) } catch { return { available: false, structuralProblem: true, unexpectedPlans: 0, courses: [], resources: [], counts: emptyCounts() } }
  let structuralProblem = false, slotsValid = true
  try { preparationDraft(draft, checked) } catch { structuralProblem = true }
  try { preparationDraft({ title: '일과 점검', slots: draft?.slots, plans: [] }) } catch { slotsValid = false }
  const plans = Array.isArray(draft?.plans) ? draft.plans : []
  const slots = new Map((Array.isArray(draft?.slots) ? draft.slots : []).filter(slot => slot && typeof slot.id === 'string').map(slot => [slot.id, slot]))
  const resources = new Map(checked.resources.map(resource => [resource.id, resource]))
  const planCount = new Map<string, number>(), blockCount = new Map<string, number>(), byCourse = new Map<string, PreparationDraft['plans'][number]>()
  for (const plan of plans) {
    if (!plan || typeof plan.courseId !== 'string') continue
    planCount.set(plan.courseId, (planCount.get(plan.courseId) ?? 0) + 1)
    if (!byCourse.has(plan.courseId)) byCourse.set(plan.courseId, plan)
    for (const block of Array.isArray(plan.blocks) ? plan.blocks : []) if (block && typeof block.id === 'string') blockCount.set(block.id, (blockCount.get(block.id) ?? 0) + 1)
  }
  const courses = checked.courses.map(course => {
    const plan = byCourse.get(course.id), blocks = Array.isArray(plan?.blocks) ? plan.blocks : []
    const weeklyPeriods = whole(plan?.weeklyPeriods, 1, limits.maxCoursePeriods) ? plan.weeklyPeriods : null
    const blocksValid = !!plan && Array.isArray(plan.blocks) && blocks.length <= limits.maxCoursePeriods && blocks.every(block => block && validId(block.id) && whole(block.periods, 1, limits.maxPeriods) && blockCount.get(block.id) === 1)
    const activityPeriods = blocksValid ? blocks.reduce((sum, block) => sum + block.periods, 0) : null
    const needsHours = weeklyPeriods === null || course.requiredPeriods !== null && course.requiredPeriods !== weeklyPeriods
    const needsActivities = !blocksValid || planCount.get(course.id) !== 1 || !blocks.length || activityPeriods !== weeklyPeriods
    const needsSlots = !slotsValid || !slots.size || blocks.some(block => !block || !Array.isArray(block.allowedSlotIds) || !block.allowedSlotIds.length || block.allowedSlotIds.length > limits.maxSlots || new Set(block.allowedSlotIds).size !== block.allowedSlotIds.length || block.allowedSlotIds.some(id => !slots.has(id) || slots.get(id)!.periods !== block.periods))
    const selectedResources = [...new Set(course.resourceIds)].map(id => resources.get(id)!).filter(Boolean)
    const hasTeacher = selectedResources.some(resource => resource.kind === 'teacher'), hasStudents = selectedResources.some(resource => resource.kind === 'class' || resource.kind === 'student_group')
    const needsResources = !hasTeacher || !hasStudents
    const notes: string[] = []
    if (weeklyPeriods === null) notes.push('주당 시수 입력 필요')
    else if (needsHours) notes.push(`공식 시수 ${course.requiredPeriods}차시와 입력 ${weeklyPeriods}차시가 다릅니다`)
    if (!plan || planCount.get(course.id) !== 1) notes.push('수업 계획이 없거나 중복됩니다')
    if (!blocksValid) notes.push('활동 구성 또는 활동 ID 확인 필요')
    else if (!blocks.length) notes.push('수업 활동 구성 필요')
    else if (activityPeriods !== weeklyPeriods) notes.push(`활동 합계 ${activityPeriods}차시 · 주당 시수 ${weeklyPeriods ?? '미입력'}`)
    if (needsSlots) notes.push('일과 또는 활동별 허용 시간대 확인 필요')
    if (!hasTeacher) notes.push('공식 담당 교사 배정 필요')
    if (!hasStudents) notes.push('학급 또는 수강 집단 연결 필요')
    return { courseId: course.id, label: course.label, resourceLabels: selectedResources.map(resource => `${resource.label || '이름 없음'} [${resource.id}]`), weeklyPeriods, activityPeriods, activityCount: blocks.length, needsHours, needsActivities, needsSlots, needsResources, ready: !needsHours && !needsActivities && !needsSlots && !needsResources, notes }
  })
  const courseIds = new Set(checked.courses.map(course => course.id))
  const loads = new Map(checked.resources.filter(resource => ['teacher', 'class', 'student_group'].includes(resource.kind)).map(resource => [resource.id, { id: resource.id, label: resource.label, kind: resource.kind, courseIds: [], weeklyPeriods: 0, unknownCourses: 0 } as PreparationResourceLoad]))
  for (const [index, course] of checked.courses.entries()) {
    const row = courses[index]
    for (const id of new Set(course.resourceIds)) {
      const load = loads.get(id)
      if (!load) continue
      load.courseIds.push(course.id)
      if (row.weeklyPeriods === null || row.needsHours) load.unknownCourses++
      else load.weeklyPeriods += row.weeklyPeriods
    }
  }
  const counts = emptyCounts()
  counts.all = courses.length
  for (const row of courses) {
    if (row.needsHours) counts.hours++
    if (row.needsActivities) counts.activities++
    if (row.needsSlots) counts.slots++
    if (row.needsResources) counts.resources++
    if (row.ready) counts.ready++
  }
  return { available: true, structuralProblem, unexpectedPlans: plans.filter(plan => !plan || !courseIds.has(plan.courseId)).length, courses, resources: [...loads.values()], counts }
}

export function filterPreparationProgress(rows: PreparationCourseProgress[], filter: PreparationProgressFilter = 'all', query = ''): PreparationCourseProgress[] {
  const needle = query.trim().toLocaleLowerCase('ko-KR')
  return rows.filter(row => {
    const matches = filter === 'all' || (filter === 'ready' ? row.ready : filter === 'hours' ? row.needsHours : filter === 'activities' ? row.needsActivities : filter === 'slots' ? row.needsSlots : row.needsResources)
    return matches && (!needle || [row.courseId, row.label, ...row.resourceLabels].some(value => value.toLocaleLowerCase('ko-KR').includes(needle)))
  })
}
