import type { CollectionDetail } from './contracts'
import type { CollectionUnit, ReviewRecord, Submission, Supplement, Withdrawal } from '../workflows/types'

export type CollectionReviewState = 'unsubmitted' | 'pending' | 'changes_requested' | 'accepted' | 'complete' | 'unavailable'
export interface CollectionSubmissionSummary {
  current: Submission | null; effective: Submission | null; history: Submission[]
  reviews: ReviewRecord[]; supplements: Supplement[]; withdrawals: Withdrawal[]
  pendingSupplements: Supplement[]; withdrawnSubmissionIds: string[]
  reviewState: CollectionReviewState; correctionOpen: boolean; correctionExpired: boolean; supplementOverdue: boolean
}
const rows = <T,>(value: readonly T[]): T[] => Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object') : []
const emptySummary = (): CollectionSubmissionSummary => ({ current: null, effective: null, history: [], reviews: [], supplements: [], withdrawals: [], pendingSupplements: [], withdrawnSubmissionIds: [], reviewState: 'unavailable', correctionOpen: false, correctionExpired: false, supplementOverdue: false })
const dateValid = (value: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

// 서버가 공개한 DTO만 요약한다. 제출·철회 허용 여부와 최종 권한은 서버가 다시 판정한다.
export function summarizeCollectionSubmission(detail: CollectionDetail, unit: CollectionUnit, date: string): CollectionSubmissionSummary {
  if (!detail?.request || !unit?.id || unit.requestId !== detail.request.id || unit.schoolId !== detail.request.schoolId || !rows(detail.units).some(value => value.id === unit.id && value.requestId === unit.requestId && value.schoolId === unit.schoolId)) return emptySummary()
  const history = rows(detail.submissions).filter(value => value.unitId === unit.id && typeof value.id === 'string' && Number.isSafeInteger(value.revision) && value.revision > 0).sort((a, b) => b.revision - a.revision || a.id.localeCompare(b.id))
  const byId = new Map(history.map(value => [value.id, value]))
  const linked = (value: ReviewRecord | Supplement | Withdrawal) => value.unitId === unit.id && typeof value.id === 'string' && byId.has(value.submissionId)
  const reviews = rows(detail.reviews).filter(value => linked(value) && ['accepted', 'changes_requested'].includes(value.decision) && typeof value.recordedAt === 'string').sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))
  const supplements = rows(detail.supplements).filter(value => linked(value) && dateValid(value.dueDate) && (value.fulfilledSubmissionId === null || byId.has(value.fulfilledSubmissionId))).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
  const withdrawals = rows(detail.withdrawals).filter(value => linked(value) && typeof value.recordedAt === 'string').sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))
  const withdrawnSubmissionIds = [...new Set((Array.isArray(unit.withdrawnSubmissionIds) ? unit.withdrawnSubmissionIds : []).filter(id => typeof id === 'string' && byId.has(id)))]
  const current = byId.get(unit.currentSubmissionId ?? '') ?? null, effective = byId.get(unit.effectiveSubmissionId ?? '') ?? null
  const pendingSupplements = supplements.filter(value => value.fulfilledSubmissionId === null)
  const pointersMissing = (unit.currentSubmissionId !== null && !current) || (unit.effectiveSubmissionId !== null && !effective)
  const pointersWithdrawn = Boolean((current && withdrawnSubmissionIds.includes(current.id)) || (effective && withdrawnSubmissionIds.includes(effective.id)))
  const currentReview = current ? reviews.find(value => value.submissionId === current.id) : undefined
  const reviewState: CollectionReviewState = pointersMissing || pointersWithdrawn ? 'unavailable' : !current ? 'unsubmitted' : current.reviewMode === 'none' ? 'complete' : effective?.id === current.id ? 'accepted' : currentReview?.decision === 'changes_requested' ? 'changes_requested' : 'pending'
  const correctionValid = dateValid(unit.correctionUntil) && dateValid(date)
  return { current, effective, history, reviews, supplements, withdrawals, pendingSupplements, withdrawnSubmissionIds, reviewState,
    correctionOpen: correctionValid && unit.correctionUntil >= date,
    correctionExpired: correctionValid && unit.correctionUntil < date,
    supplementOverdue: dateValid(date) && pendingSupplements.some(value => value.dueDate < date) }
}

// 학교 시간대는 DTO에 없으므로 화면에 표시 기준을 명시한 한국 표준시를 사용한다.
export function formatCollectionRecordedTime(value: string): string {
  const date = new Date(value)
  if (typeof value !== 'string' || !value || Number.isNaN(date.getTime())) return '시각 확인 필요'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
