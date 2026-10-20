import type { CollectionDetail } from './contracts'
import { summarizeCollectionSubmission } from './submission-summary'

export const UNIT_FILTERS = ['all', 'unsubmitted', 'changes_requested', 'pending', 'complete', 'unavailable', 'mine'] as const
export type UnitFilter = typeof UNIT_FILTERS[number]
export const unitFilterLabels: Record<UnitFilter, string> = { all: '전체', unsubmitted: '미제출', changes_requested: '보완 필요', pending: '검토 대기', complete: '완료', unavailable: '상태 확인 필요', mine: '내가 참여' }

// 서버가 열람을 허용한 단위만 다룬다. 과거 완료본으로 최신 보완·검토 상태를 덮지 않는다.
export function collectionUnitRows(detail: CollectionDetail, memberId: string, date: string) {
  return detail.units.map(unit => {
    const summary = summarizeCollectionSubmission(detail, unit, date)
    const status: Exclude<UnitFilter, 'all' | 'mine'> = summary.reviewState === 'unavailable' ? 'unavailable'
      : summary.pendingSupplements.length || summary.reviewState === 'changes_requested' ? 'changes_requested'
      : summary.reviewState === 'accepted' || summary.reviewState === 'complete' ? 'complete' : summary.reviewState
    const mine = unit.responsibleMemberId === memberId || unit.members.some(member => member.id === memberId)
    const search = [unit.label, unit.id, unit.responsibleMemberId, ...unit.members.flatMap(member => [member.name, member.id])].join(' ').normalize('NFKC').toLocaleLowerCase('ko-KR')
    return { unit, summary, status, mine, search }
  })
}
export function filterCollectionUnits(rows: ReturnType<typeof collectionUnitRows>, filter: UnitFilter, query: string) {
  const words = query.normalize('NFKC').toLocaleLowerCase('ko-KR').trim().split(/\s+/).filter(Boolean)
  return rows.filter(row => (filter === 'all' || (filter === 'mine' ? row.mine : row.status === filter)) && words.every(word => row.search.includes(word)))
}
