import type { Membership } from '../contracts'
import type { WorkflowStore } from './store'
import type { ReviewRecord, Submission, Supplement, Withdrawal } from './types'

export type CollectionUnitSummary = ReturnType<WorkflowStore['unitSummary']>
export interface ReviewView { id: string; decision: ReviewRecord['decision']; note: string; at: string; actor: string }
export interface PendingReviewView { id: string; revision: number; dueDate: string; overdue: boolean; review: ReviewView | null }
export interface ReviewHistoryEntry {
  id: string; kind: 'review' | 'withdrawal' | 'supplement_fulfilled'; revision: number; at: string
  note: string; actor: string; decision?: ReviewRecord['decision']; fulfilledRevision?: number; dueDate?: string
}
export interface CollectionReviewHistoryView {
  currentRevision: number | null; effectiveRevision: number | null
  currentState: 'none' | 'pending' | 'not_required' | 'accepted' | 'changes_requested'
  currentReview: ReviewView | null; pending: PendingReviewView[]; history: ReviewHistoryEntry[]
}
const rows = <T,>(value: readonly T[]): T[] => Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object') : []
const emptyView = (): CollectionReviewHistoryView => ({ currentRevision: null, effectiveRevision: null, currentState: 'none', currentReview: null, pending: [], history: [] })

// 이미 권한을 확인한 원본만 전달받는다. 다른 단위의 기록이나 연결할 수 없는 판을 섞지 않는다.
export function collectionReviewHistory(summary: CollectionUnitSummary, submissions: readonly Submission[], members: readonly Membership[], date: string): CollectionReviewHistoryView {
  const unit = summary?.unit, request = summary?.request
  if (!unit?.id || !request || unit.requestId !== request.id || unit.schoolId !== request.schoolId) return emptyView()
  const versions = new Map(rows(submissions).filter(value => value.unitId === unit.id && typeof value.id === 'string' && Number.isSafeInteger(value.revision) && value.revision > 0).map(value => [value.id, value]))
  const current = versions.get(unit.currentSubmissionId ?? ''), effective = versions.get(unit.effectiveSubmissionId ?? '')
  const names = new Map(rows(members).filter(value => value.schoolId === unit.schoolId && typeof value.name === 'string').map(value => [value.id, value.name]))
  const actor = (id: string) => names.get(id) ?? '교사 이름 확인 불가'
  const linked = (value: ReviewRecord | Supplement | Withdrawal) => value.unitId === unit.id && versions.has(value.submissionId) && typeof value.id === 'string'
  const reviews = rows(summary.reviews).filter(value => linked(value) && ['accepted', 'changes_requested'].includes(value.decision) && typeof value.note === 'string' && typeof value.recordedAt === 'string')
  const reviewView = (value: ReviewRecord): ReviewView => ({ id: value.id, decision: value.decision, note: value.note, at: value.recordedAt, actor: actor(value.reviewerMemberId) })
  // 한 판의 검토는 한 번이지만, 입력 순서에 의존해 다른 판의 마지막 의견을 고르지 않는다.
  const reviewFor = (id: string, decision?: ReviewRecord['decision']) => reviews.filter(value => value.submissionId === id && (!decision || value.decision === decision)).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))[0]
  const currentRecord = current ? reviewFor(current.id) : undefined
  const pending = rows(summary.pendingSupplements).filter(value => linked(value) && !value.fulfilledSubmissionId && typeof value.dueDate === 'string').map(value => {
    const review = reviewFor(value.submissionId, 'changes_requested')
    return { id: value.id, revision: versions.get(value.submissionId)!.revision, dueDate: value.dueDate, overdue: value.dueDate < date, review: review ? reviewView(review) : null }
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.revision - b.revision || a.id.localeCompare(b.id))
  const history: ReviewHistoryEntry[] = reviews.map(value => ({ ...reviewView(value), id: `review:${value.id}`, kind: 'review', revision: versions.get(value.submissionId)!.revision }))
  for (const value of rows(summary.withdrawals)) {
    if (!linked(value) || typeof value.reason !== 'string' || typeof value.recordedAt !== 'string') continue
    history.push({ id: `withdrawal:${value.id}`, kind: 'withdrawal', revision: versions.get(value.submissionId)!.revision, at: value.recordedAt, note: value.reason, actor: actor(value.actorMemberId) })
  }
  for (const value of rows(summary.supplements)) {
    if (!linked(value) || !value.fulfilledSubmissionId || typeof value.fulfilledAt !== 'string') continue
    const fulfilled = versions.get(value.fulfilledSubmissionId)
    if (!fulfilled) continue
    history.push({ id: `supplement:${value.id}`, kind: 'supplement_fulfilled', revision: versions.get(value.submissionId)!.revision, at: value.fulfilledAt, note: '', actor: actor(fulfilled.submittedBy), fulfilledRevision: fulfilled.revision, dueDate: value.dueDate })
  }
  history.sort((a, b) => b.revision - a.revision || b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
  return { currentRevision: current?.revision ?? null, effectiveRevision: effective?.revision ?? null,
    currentState: !current ? 'none' : current.reviewMode === 'none' ? 'not_required' : currentRecord?.decision ?? 'pending',
    currentReview: currentRecord ? reviewView(currentRecord) : null, pending, history }
}
