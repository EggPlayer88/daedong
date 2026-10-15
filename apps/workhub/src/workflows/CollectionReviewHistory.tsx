import type { Membership } from '../contracts'
import type { Submission } from './types'
import { collectionReviewHistory, type CollectionUnitSummary, type ReviewView } from './collection-review-history'
import styles from './collection-review-history.css?inline'

interface Props { summary: CollectionUnitSummary; submissions: readonly Submission[]; members: readonly Membership[]; date: string }
const decisionLabels = { accepted: '검토 완료', changes_requested: '보완 요청' }
function RecordedTime({ at }: { at: string }) {
  return <time dateTime={at}>{at.replace('T', ' ')}</time>
}
function ReviewNote({ review }: { review: ReviewView }) {
  return <><p className="wf-review-meta">검토자 {review.actor} · <RecordedTime at={review.at} /></p><p className="wf-review-body">{review.note || '별도 검토 의견 없음'}</p></>
}

export function CollectionReviewHistory({ summary, submissions, members, date }: Props) {
  const view = collectionReviewHistory(summary, submissions, members, date)
  if (!view.currentRevision && !view.pending.length && !view.history.length) return null
  const currentLabel = view.currentState === 'pending' ? '검토 대기' : view.currentState === 'not_required' ? '검토 없이 응답 완료'
    : view.currentState === 'none' ? '없음' : decisionLabels[view.currentState]
  return <section className="wf-review-records" aria-label="제출판 검토 안내">
    <style>{styles}</style>
    <section className="wf-current-review" aria-label="현재 제출판 검토 결과">
      <h5>{view.currentRevision ? `현재 제출 v${view.currentRevision} · ${currentLabel}` : '현재 유효한 제출판이 없습니다'}</h5>
      {view.currentReview ? <ReviewNote review={view.currentReview} /> : view.currentState === 'pending' && <p className="wf-review-meta">이 제출판에는 아직 검토 의견이 없습니다.</p>}
      {view.effectiveRevision && view.effectiveRevision !== view.currentRevision && <p className="wf-review-meta">완료본 v{view.effectiveRevision}은 별도로 유지됩니다.</p>}
    </section>
    {view.pending.length > 0 && <section className="wf-pending-reviews" aria-label="남은 보완 요청">
      <h5>{`보완 제출 기한: ${view.pending[0].dueDate}${view.pending.length > 1 ? ' · 가장 빠른 기한' : ''}`}</h5>
      <p className="wf-review-meta">남은 보완 요청 {view.pending.length}건 · 기한이 빠른 순서</p>
      <ul>{view.pending.map(item => <li key={item.id}>
        <strong>v{item.revision}에 대한 보완 요청</strong><p className="wf-review-due"><time dateTime={item.dueDate}>{item.dueDate}까지</time>{item.overdue && <span> · 보완 기한 초과</span>}</p>
        {item.review ? <ReviewNote review={item.review} /> : <p className="wf-review-meta">이 제출판의 보완 사유를 확인할 수 없습니다.</p>}
      </li>)}</ul>
    </section>}
    {view.history.length > 0 && <details className="wf-review-history">
      <summary>검토·보완·철회 이력 · {view.history.length}건</summary>
      <p className="wf-review-meta">제출판 최신순입니다. 보완 응답 제출과 검토 완료는 구분합니다.</p>
      <ol>{view.history.map(item => <li key={item.id}>
        <strong>{item.kind === 'review' ? `v${item.revision} · ${decisionLabels[item.decision!]}` : item.kind === 'withdrawal' ? `v${item.revision} · 제출 철회` : `v${item.revision} 보완에 v${item.fulfilledRevision} 제출`}</strong>
        <p className="wf-review-meta">{item.kind === 'review' ? '검토자' : '제출 책임자'} {item.actor} · <RecordedTime at={item.at} /></p>
        {item.kind === 'supplement_fulfilled' ? <p className="wf-review-meta">보완 기한 {item.dueDate} · 보완 응답을 제출한 기록입니다. 해당 제출판의 검토 결과는 별도입니다.</p> : <p className="wf-review-body">{item.note || '별도 검토 의견 없음'}</p>}
      </li>)}</ol>
    </details>}
  </section>
}
