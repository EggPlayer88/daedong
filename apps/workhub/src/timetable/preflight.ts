import { validateBasis } from '../../../../packages/timetable/src/validate'
import type { TimetableBasis, TimetableIssue, TimetableLesson, TimetableResource, TimetableSlot } from '../../../../packages/timetable/src/types'
import { intervalPeriodCapacity } from './foundation'

export type PreflightCode = 'FIXED_RESOURCE_COLLISION' | 'NO_AVAILABLE_SLOT' | 'RESOURCE_PERIOD_SHORTAGE'
export interface PreflightCard {
  id: string; code: PreflightCode; title: string; message: string; nextStep: string
  resources: Pick<TimetableResource, 'id' | 'label' | 'kind'>[]
  lessons: Pick<TimetableLesson, 'id' | 'label' | 'periods'>[]
  slots: TimetableSlot[]
  resourceId?: string; requiredPeriods?: number; availableUpperBound?: number
}
export interface TimetablePreflightReport {
  status: 'invalid' | 'unsupported' | 'blocked' | 'undetermined'
  canCalculate: boolean; cards: PreflightCard[]; inputIssues: TimetableIssue[]; unsupportedFeatures: string[]; issues: TimetableIssue[]
}

const compareId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const compareSlot = (a: TimetableSlot, b: TimetableSlot) => a.day - b.day || a.startMinute - b.startMinute || a.endMinute - b.endMinute || compareId(a, b)
const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
type Interval = { startMinute: number; endMinute: number }

// 같은 자원·요일의 불가 시간을 합쳐, 허용 시간마다 모든 원본 조건을 다시 훑지 않는다.
function unavailableIndex(basis: TimetableBasis): Map<string, Map<number, Interval[]>> {
  const result = new Map<string, Map<number, Interval[]>>()
  for (const row of basis.unavailable) {
    const byDay = result.get(row.resourceId) ?? new Map<number, Interval[]>(), rows = byDay.get(row.day) ?? []
    rows.push({ startMinute: row.startMinute, endMinute: row.endMinute }); byDay.set(row.day, rows); result.set(row.resourceId, byDay)
  }
  for (const byDay of result.values()) for (const [day, rows] of byDay) {
    rows.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)
    const merged: Interval[] = []
    for (const row of rows) {
      const last = merged[merged.length - 1]
      if (last && last.endMinute >= row.startMinute) last.endMinute = Math.max(last.endMinute, row.endMinute)
      else merged.push({ ...row })
    }
    byDay.set(day, merged)
  }
  return result
}

function unavailableAt(rows: Interval[], slot: TimetableSlot): boolean {
  let lo = 0, hi = rows.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].endMinute <= slot.startMinute) lo = mid + 1; else hi = mid }
  return lo < rows.length && rows[lo].startMinute < slot.endMinute
}

/**
 * 확실한 필요조건 위반만 설명한다. 이 결과로 해의 존재·최적성·전체 필수조건 통과를 판정하지 않는다.
 * 입력을 고치거나 조건을 완화하지 않으며, 계산 결과는 별도의 validatePlacements로 검사해야 한다.
 */
export function reviewTimetablePreflight(value: unknown): TimetablePreflightReport {
  const checked = validateBasis(value)
  if (!checked.valid) return { status: 'invalid', canCalculate: false, cards: [], inputIssues: checked.issues, unsupportedFeatures: [], issues: checked.issues }
  const basis = value as TimetableBasis
  if (basis.unsupportedFeatures.length) {
    const unsupportedFeatures = [...basis.unsupportedFeatures].sort()
    return { status: 'unsupported', canCalculate: false, cards: [], inputIssues: [], unsupportedFeatures,
      issues: unsupportedFeatures.map(feature => ({ code: 'UNSUPPORTED_FEATURE', message: `아직 검사할 수 없는 조건: ${feature}`, path: 'basis.unsupportedFeatures' })) }
  }
  const resources = [...basis.resources].sort(compareId), lessons = [...basis.lessons].sort(compareId)
  const resourcesById = new Map(resources.map(row => [row.id, row])), lessonsById = new Map(lessons.map(row => [row.id, row]))
  const slotsById = new Map(basis.slots.map(row => [row.id, row])), fixedByLesson = new Map(basis.fixed.map(row => [row.lessonId, row.slotId]))
  const cards: PreflightCard[] = [], unavailable = unavailableIndex(basis)
  const relate = (rows: TimetableLesson[], slots: TimetableSlot[], resourceIds = rows.flatMap(row => row.resourceIds)) => ({
    resources: [...new Set(resourceIds)].sort().map(id => { const row = resourcesById.get(id)!; return { id: row.id, label: row.label, kind: row.kind } }),
    lessons: [...rows].sort(compareId).map(row => ({ id: row.id, label: row.label, periods: row.periods })),
    slots: [...new Map(slots.map(row => [row.id, row])).values()].sort(compareSlot).map(row => ({ ...row })),
  })

  // 이름이 다른 교시도 실제 시각으로 비교하고, 종료와 시작이 같은 경계는 겹침에서 제외한다.
  // 자원·요일마다 첫 위반 구간의 증거만 남긴다. 수용량 2인 공간의 수업 두 개를 충돌로 오인하지 않는다.
  type FixedEvent = { time: number; delta: -1 | 1; lessonId: string }
  const eventsByResource = new Map<string, Map<number, FixedEvent[]>>()
  for (const fixed of basis.fixed) {
    const lesson = lessonsById.get(fixed.lessonId)!, slot = slotsById.get(fixed.slotId)!
    for (const id of lesson.resourceIds) {
      const byDay = eventsByResource.get(id) ?? new Map<number, FixedEvent[]>(), events = byDay.get(slot.day) ?? []
      events.push({ time: slot.startMinute, delta: 1, lessonId: lesson.id }, { time: slot.endMinute, delta: -1, lessonId: lesson.id })
      byDay.set(slot.day, events); eventsByResource.set(id, byDay)
    }
  }
  for (const resource of resources) for (const [day, events] of [...(eventsByResource.get(resource.id) ?? [])].sort(([a], [b]) => a - b)) {
    events.sort((a, b) => a.time - b.time || a.delta - b.delta || compareId({ id: a.lessonId }, { id: b.lessonId }))
    const active = new Set<string>()
    for (const event of events) {
      if (event.delta < 0) active.delete(event.lessonId); else active.add(event.lessonId)
      if (active.size <= resource.capacity) continue
      const witness = [...active].sort().map(id => lessonsById.get(id)!), slots = witness.map(lesson => slotsById.get(fixedByLesson.get(lesson.id)!)!)
      const end = Math.min(...slots.map(slot => slot.endMinute))
      cards.push({ id: `fixed:${resource.id}:${day}`, code: 'FIXED_RESOURCE_COLLISION', resourceId: resource.id,
        title: `${resource.label}의 고정 수업이 겹칩니다`,
        message: `${days[day - 1]} ${clock(event.time)}–${clock(end)}에 고정 수업 ${witness.length}개가 겹칩니다. 이 대상의 동시 수용 한도는 ${resource.capacity}개입니다.`,
        nextStep: '관련 수업의 고정 시간을 확인해 주세요. 학교 확정 조건은 기초 자료에서, 초안에 추가한 조건은 조건 정리에서 수정해야 합니다.',
        ...relate(witness, slots) })
      break
    }
  }

  const usableByLesson = new Map<string, TimetableSlot[]>(), lessonsByResource = new Map<string, TimetableLesson[]>()
  // 불가 조건이 있는 자원만 검사한다. 같은 자원·시간의 판정은 여러 수업에서 재사용한다.
  const blockedByResource = new Map<string, Map<string, boolean>>()
  const isBlocked = (resourceId: string, slot: TimetableSlot) => {
    const cached = blockedByResource.get(resourceId) ?? new Map<string, boolean>()
    if (!cached.has(slot.id)) cached.set(slot.id, unavailableAt(unavailable.get(resourceId)?.get(slot.day) ?? [], slot))
    blockedByResource.set(resourceId, cached); return cached.get(slot.id)!
  }
  for (const lesson of lessons) {
    const fixedSlotId = fixedByLesson.get(lesson.id)
    const allowed = (fixedSlotId ? [fixedSlotId] : lesson.allowedSlotIds).map(id => slotsById.get(id)!).sort(compareSlot)
    const limitedResources = lesson.resourceIds.filter(id => unavailable.has(id)).sort(), blockers = new Set<string>()
    const usable = allowed.filter(slot => {
      let blocked = false
      for (const id of limitedResources) if (isBlocked(id, slot)) { blockers.add(id); blocked = true }
      return !blocked
    })
    usableByLesson.set(lesson.id, usable)
    for (const id of lesson.resourceIds) { const rows = lessonsByResource.get(id) ?? []; rows.push(lesson); lessonsByResource.set(id, rows) }
    if (!usable.length) {
      const blockedNames = [...blockers].sort().map(id => resourcesById.get(id)!.label)
      cards.push({ id: `domain:${lesson.id}`, code: 'NO_AVAILABLE_SLOT', title: `${lesson.label} · 배치할 시간 없음`,
        message: `${fixedSlotId ? '고정한 시간이' : `허용 시간 ${allowed.length}곳이 모두`} 참여자·자원의 사용 불가 조건과 겹칩니다. 관련 대상: ${blockedNames.join(' · ')}.`,
        nextStep: '수업의 허용 시간, 고정 시간, 관련 대상의 불가 시간을 함께 확인해 주세요. 선호 조건을 바꾸는 것만으로는 해결되지 않습니다.',
        ...relate([lesson], allowed) })
    }
  }

  for (const resource of resources) {
    const rows = lessonsByResource.get(resource.id) ?? []
    if (!rows.length) continue
    const allowed = [...new Map(rows.flatMap(lesson => usableByLesson.get(lesson.id)!).map(slot => [slot.id, slot])).values()].sort(compareSlot)
    let singleCapacity = 0
    for (let day = 1; day <= 7; day++) singleCapacity += intervalPeriodCapacity(allowed.filter(slot => slot.day === day))
    // 수용량 c인 구간 배치는 c개의 겹치지 않는 열로 나눌 수 있다. 각 열의 최대 시수×c는 안전한 상한이다.
    // 같은 시간대 중복이나 긴 블록을 합산하지 않는다. 상한 이하는 편성 가능하다는 뜻이 아니다.
    const availableUpperBound = singleCapacity * resource.capacity, requiredPeriods = rows.reduce((sum, lesson) => sum + lesson.periods, 0)
    if (requiredPeriods > availableUpperBound) cards.push({ id: `capacity:${resource.id}`, code: 'RESOURCE_PERIOD_SHORTAGE', resourceId: resource.id,
      title: `${resource.label}의 수업을 넣을 시간이 부족합니다`,
      message: `필요한 ${requiredPeriods}차시에 비해 배치 가능 상한은 ${availableUpperBound}차시입니다. 실제 시각의 겹침과 ${resource.capacity}개 동시 수용 한도를 반영한 상한보다도 시수가 많습니다.`,
      nextStep: '관련 수업의 시수·허용 시간·고정·불가 조건을 확인해 주세요. 상한을 늘려도 다른 조건 때문에 편성이 안 될 수 있습니다.',
      requiredPeriods, availableUpperBound, ...relate(rows, allowed) })
  }
  return { status: cards.length ? 'blocked' : 'undetermined', canCalculate: !cards.length, cards, inputIssues: [], unsupportedFeatures: [],
    issues: cards.map(card => ({ code: card.code, message: `${card.title}. ${card.message}`, path: card.resourceId ? `resources.${card.resourceId}` : `lessons.${card.lessons[0].id}` })) }
}
