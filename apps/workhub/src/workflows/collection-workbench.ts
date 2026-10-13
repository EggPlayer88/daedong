import type { Membership } from '../contracts'
import type { WorkflowStore } from './store'
import type { CollectionRequest } from './types'

export type CollectionRequestFilter = 'all' | CollectionRequest['status']
export type CollectionUnitState = 'missing' | 'pending' | 'changes' | 'complete' | 'revising'
export const collectionUnitStateLabels: Record<CollectionUnitState, string> = {
  missing: '미제출', pending: '검토 대기', changes: '보완 필요', complete: '완료', revising: '완료본 · 새 판 처리 중',
}
export const collectionUnitStates: CollectionUnitState[] = ['missing', 'pending', 'changes', 'complete', 'revising']
export interface CollectionUnitRow {
  id: string; label: string; responsibleName: string; state: CollectionUnitState; nextStep: string
  dueDate: string; overdue: boolean; initiallyLate: boolean; currentRevision?: number; effectiveRevision?: number; pendingSupplementCount: number
}
export interface CollectionWorkbench {
  rows: CollectionUnitRow[]; counts: Record<CollectionUnitState, number>; overdueCount: number
}
const normalized = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR').trim().replace(/\s+/g, ' ')
const matches = (text: string, query: string) => normalized(query).split(' ').every(token => normalized(text).includes(token))

export function filterCollectionRequests(requests: readonly CollectionRequest[], query: string, status: CollectionRequestFilter): CollectionRequest[] {
  if (!Array.isArray(requests)) return []
  return requests.filter(request => request && typeof request.title === 'string' && (status === 'all' || request.status === status) && matches(request.title, query))
}

type WorkbenchReader = Pick<WorkflowStore, 'listUnits' | 'unitSummary'>
// 화면용 메타데이터만 반환한다. 초안·제출 본문, 검토 의견, 숫자 응답은 표의 검색 자료에 포함하지 않는다.
export function collectionWorkbench(store: WorkbenchReader, member: Membership, request: CollectionRequest): CollectionWorkbench {
  const counts: CollectionWorkbench['counts'] = { missing: 0, pending: 0, changes: 0, complete: 0, revising: 0 }
  if (request.schoolId !== member.schoolId) throw new Error('현재 학교의 수합만 확인할 수 있습니다.')
  const units = store.listUnits(member.id, request.id)
  if (!Array.isArray(units)) throw new Error('제출 단위 현황을 읽지 못했습니다. 다시 확인해 주세요.')
  const rows = units.map(unit => {
    if (unit.schoolId !== member.schoolId || unit.requestId !== request.id) throw new Error('수합의 제출 단위가 일치하지 않습니다.')
    const summary = store.unitSummary(member.id, unit.id)
    const supplements = summary.pendingSupplements
    const needsChanges = supplements.length > 0 || summary.reviewState === 'changes_requested'
    const state: CollectionUnitState = needsChanges ? 'changes'
      : summary.effective && summary.current?.id !== summary.effective.id ? 'revising'
      : summary.effective ? 'complete' : summary.current ? 'pending' : 'missing'
    counts[state]++
    return { id: unit.id, label: unit.label, responsibleName: unit.members.find(value => value.id === unit.responsibleMemberId)?.name ?? '책임자 확인 필요', state,
      nextStep: needsChanges ? '보완 응답 필요' : state === 'revising' ? '새 판 검토 대기' : state === 'pending' ? '지정 교사 검토 필요' : state === 'missing' ? '책임자 제출 필요' : request.reviewMode === 'none' ? '검토 없이 응답 완료' : '검토 완료',
      dueDate: supplements[0]?.dueDate ?? request.dueDate,
      overdue: supplements.length > 0 ? summary.supplementOverdue : summary.currentlyOverdue,
      initiallyLate: summary.initiallyLate,
      currentRevision: summary.current?.revision, effectiveRevision: summary.effective?.revision, pendingSupplementCount: supplements.length,
    }
  })
  return { rows, counts, overdueCount: rows.filter(row => row.overdue).length }
}

export function filterCollectionUnits(rows: readonly CollectionUnitRow[], query: string, state: 'all' | CollectionUnitState, overdueOnly: boolean): CollectionUnitRow[] {
  if (!Array.isArray(rows)) return []
  return rows.filter(row => row && typeof row.label === 'string' && typeof row.responsibleName === 'string'
    && (state === 'all' || row.state === state) && (!overdueOnly || row.overdue) && matches(`${row.label} ${row.responsibleName}`, query))
}
