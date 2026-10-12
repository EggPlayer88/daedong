import type { Membership } from '../contracts'
import type { WorkflowStore } from './store'

export type CollectionHomeCategory = 'submit' | 'contribute' | 'review' | 'waiting'
export type CollectionHomeRole = 'submitter' | 'contributor' | 'reviewer'
export interface CollectionHomeCard {
  requestId: string; unitId: string; title: string; unitLabel: string
  category: CollectionHomeCategory; roles: CollectionHomeRole[]
  actionLabel: string; statusLabel: string; dueDate: string; overdue: boolean
  currentRevision?: number; effectiveRevision?: number; hasPendingSupplement: boolean; pendingSupplementCount: number
}
export interface CollectionHomeSummary {
  cards: CollectionHomeCard[]
  counts: Record<CollectionHomeCategory, number>
  actionCount: number; waitingCount: number
}
type CollectionReader = Pick<WorkflowStore, 'listCollections' | 'listUnits' | 'unitSummary'>
export const collectionCategoryLabels: Record<CollectionHomeCategory, string> = {
  submit: '내 제출 필요', contribute: '공동작성 참여', review: '내 검토할 일', waiting: '제출 후 검토 대기',
}
export const collectionRoleLabels: Record<CollectionHomeRole, string> = {
  submitter: '제출 책임자', contributor: '공동 작성자', reviewer: '지정 검토자',
}
const priority: Record<CollectionHomeCategory, number> = { submit: 0, review: 1, contribute: 2, waiting: 3 }

// 원본 조회의 현재 권한을 통과한 단위만 조합한다. 저장 스냅샷과 초안 본문은 읽지 않는다.
export function collectionHomeSummary(store: CollectionReader, member: Membership, _date: string): CollectionHomeSummary {
  const cards: CollectionHomeCard[] = []
  const seen = new Set<string>()
  for (const request of store.listCollections(member.id)) {
    if (request.status !== 'published' || request.schoolId !== member.schoolId) continue
    for (const unit of store.listUnits(member.id, request.id)) {
      if (unit.schoolId !== member.schoolId || unit.requestId !== request.id || seen.has(unit.id)) continue
      seen.add(unit.id)
      const responsible = unit.responsibleMemberId === member.id
      const contributor = !responsible && unit.members.some(value => value.id === member.id)
      // 실제 review 명령과 같은 조건이다. 작성 책임자는 자신의 제출을 검토하지 않는다.
      const reviewer = request.reviewMode === 'required' && request.reviewerMemberId === member.id && !responsible
      if (!responsible && !contributor && !reviewer) continue
      const summary = store.unitSummary(member.id, unit.id)
      const needsResponse = !summary.current || summary.reviewState === 'changes_requested' || summary.pendingSupplements.length > 0
      const pendingReview = Boolean(summary.current) && summary.reviewState === 'pending'
      const category: CollectionHomeCategory | undefined = responsible && needsResponse ? 'submit'
        : reviewer && pendingReview ? 'review'
        : contributor && needsResponse ? 'contribute'
        : (responsible || contributor) && pendingReview ? 'waiting' : undefined
      if (!category) continue
      const roles: CollectionHomeRole[] = []
      if (responsible) roles.push('submitter')
      if (contributor) roles.push('contributor')
      if (reviewer) roles.push('reviewer')
      const hasPendingSupplement = summary.pendingSupplements.length > 0
      const dueDate = hasPendingSupplement ? summary.pendingSupplements[0].dueDate : request.dueDate
      cards.push({ requestId: request.id, unitId: unit.id, title: request.title, unitLabel: unit.label, category, roles,
        actionLabel: category === 'submit' ? hasPendingSupplement ? '보완 제출하기' : '응답 작성·제출하기'
          : category === 'review' ? '제출판 검토하기' : category === 'contribute' ? '공동 초안 작성하기' : '접수 상태 확인',
        statusLabel: category === 'waiting' ? '제출 완료 · 지정 교사의 검토를 기다립니다'
          : category === 'review' ? '현재 제출판 검토 필요'
          : hasPendingSupplement ? '완료본과 별개로 보완 응답이 필요합니다'
          : category === 'contribute' ? '초안 작성에 참여 · 최종 제출은 책임자가 합니다' : '아직 유효한 제출이 없습니다',
        // 연체는 저장소가 현재 맥락으로 판정한 사실을 사용한다. 화면의 오래된 날짜로 되돌리지 않는다.
        dueDate, overdue: category !== 'waiting' && category !== 'review' && (hasPendingSupplement ? summary.supplementOverdue : summary.currentlyOverdue),
        currentRevision: summary.current?.revision, effectiveRevision: summary.effective?.revision, hasPendingSupplement, pendingSupplementCount: summary.pendingSupplements.length,
      })
    }
  }
  cards.sort((a, b) => priority[a.category] - priority[b.category] || Number(b.overdue) - Number(a.overdue)
    || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title) || a.unitId.localeCompare(b.unitId))
  const counts: CollectionHomeSummary['counts'] = { submit: 0, contribute: 0, review: 0, waiting: 0 }
  for (const card of cards) counts[card.category]++
  return { cards, counts, actionCount: cards.length - counts.waiting, waitingCount: counts.waiting }
}
