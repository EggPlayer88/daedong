import { overlaps } from '../../../../packages/timetable/src/validate'
import { canonical } from '../services/scoped-rpc'
import type { TimetableBasis, TimetableConditions } from './contracts'
import { conditionTargetLabels } from './condition-policy'
import { reviewTimetablePreflight } from './preflight'
import { timetableConditions } from './server'

export interface ConditionReviewRow {
  key: string; kind: keyof TimetableConditions; index: number; label: string; targetIds: string[]
  details: string; search: string; inherited: boolean; protected: boolean; issueIds: string[]
}
export interface ConditionReviewIssue { id: string; title: string; message: string; nextStep: string; conditionKeys: string[] }
export interface ConditionReview { rows: ConditionReviewRow[]; issues: ConditionReviewIssue[] }
const days = ['월', '화', '수', '목', '금', '토', '일']
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export const conditionReviewSearch = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s/g, '')
/** 원본 행 번호를 유지하여 검색·쪽 이동 뒤에도 다른 조건을 삭제하지 않는다. 충돌은 자동 완화하지 않는다. */
export function reviewConditions(basis: TimetableBasis, input: TimetableConditions): ConditionReview {
  const conditions = timetableConditions(input, basis), resourceNames = conditionTargetLabels(basis.resources), lessonNames = conditionTargetLabels(basis.lessons)
  const lessons = new Map(basis.lessons.map(row => [row.id, row])), slots = new Map(basis.slots.map(row => [row.id, row]))
  const rows: ConditionReviewRow[] = [], byLesson = new Map<string, ConditionReviewRow[]>(), byResource = new Map<string, ConditionReviewRow[]>()
  for (const kind of ['fixed', 'unavailable', 'preferences'] as const) {
    const inheritedKeys = new Set(basis[kind].map(row => canonical(row)))
    conditions[kind].forEach((row, index) => {
      const inherited = inheritedKeys.has(canonical(row)), slot = 'slotId' in row ? slots.get(row.slotId)! : undefined
      const lesson = 'lessonId' in row ? lessons.get(row.lessonId)! : undefined
      const label = 'resourceId' in row ? `${resourceNames.get(row.resourceId)} · ${days[row.day - 1]} ${clock(row.startMinute)}–${clock(row.endMinute)}` : `${lessonNames.get(row.lessonId)} · ${days[slot!.day - 1]} ${slot!.label} · ${clock(slot!.startMinute)}–${clock(slot!.endMinute)}${'weight' in row ? ` · 피하기 ${row.weight}` : ''}`
      const targetIds = 'resourceId' in row ? [row.resourceId] : [row.lessonId, ...lesson!.resourceIds, row.slotId]
      const details = lesson ? lesson.resourceIds.map(id => `${resourceNames.get(id)} [${id}]`).join(' · ') : `대상 ID: ${targetIds[0]}`
      const entry: ConditionReviewRow = { key: `${kind}:${index}`, kind, index, label, targetIds, details, search: conditionReviewSearch(`${label} ${details} ${targetIds.join(' ')}`), inherited, protected: inherited && kind !== 'preferences', issueIds: [] }
      rows.push(entry)
      const map = kind === 'unavailable' ? byResource : byLesson, id = 'resourceId' in row ? row.resourceId : row.lessonId, list = map.get(id) ?? []; list.push(entry); map.set(id, list)
    })
  }
  const proof = reviewTimetablePreflight({ ...basis, ...conditions })
  const issues: ConditionReviewIssue[] = proof.cards.map(card => {
    const candidates = new Map<string, ConditionReviewRow>()
    for (const lesson of card.lessons) for (const row of byLesson.get(lesson.id) ?? []) if (row.kind === 'fixed') candidates.set(row.key, row)
    if (card.code !== 'FIXED_RESOURCE_COLLISION') for (const resource of card.resources) for (const row of byResource.get(resource.id) ?? []) {
      const unavailable = conditions.unavailable[row.index]
      if (card.code === 'RESOURCE_PERIOD_SHORTAGE' || card.slots.some(slot => overlaps(slot, unavailable))) candidates.set(row.key, row)
    }
    for (const row of candidates.values()) row.issueIds.push(card.id)
    const ids = [...new Set([...card.resources.map(row => row.id), ...card.lessons.map(row => row.id)])]
    return { id: card.id, title: `${card.title} [${card.resourceId ?? card.lessons[0]?.id ?? card.id}]`, message: `${card.message} 대상 ID: ${ids.join(', ')}`, nextStep: card.nextStep, conditionKeys: [...candidates.keys()] }
  })
  return { rows, issues }
}
