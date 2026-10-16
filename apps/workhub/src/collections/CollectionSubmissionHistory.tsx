import { useState } from 'react'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { CollectionDetail, CollectionFileParent } from './contracts'
import type { FileReference } from '../files/contracts'
import type { CollectionUnit, Submission } from '../workflows/types'
import { formatCollectionRecordedTime, summarizeCollectionSubmission, type CollectionSubmissionSummary } from './submission-summary'
import styles from './submission-history.css?inline'

interface Props {
  detail: CollectionDetail; unit: CollectionUnit; date: string
  onDownload: (parent: CollectionFileParent, file: FileReference) => void
  disabled?: boolean
  members?: readonly Membership[]
}
const stateLabels = { unsubmitted: '미제출', pending: '검토 대기', changes_requested: '보완 요청', accepted: '검토 완료', complete: '검토 없이 완료', unavailable: '제출 상태 확인 필요' }
function RecordedTime({ value }: { value: string }) { return <time dateTime={value}>{formatCollectionRecordedTime(value)}</time> }
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const fileRows = (value: Submission['files']): FileReference[] => Array.isArray(value) ? value.filter(file => file && typeof file.id === 'string' && typeof file.name === 'string' && Number.isFinite(file.bytes) && file.bytes >= 0) : []

export function CollectionSubmissionHistory({ detail, unit, date, onDownload, disabled = false, members }: Props) {
  const summary = summarizeCollectionSubmission(detail, unit, date)
  const [open, setOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(20)
  return <section className="cs-submission-history" aria-label={`${text(unit?.label, '제출 단위')} 제출 현황과 이력`}>
    <style>{styles}</style>
    <dl className="csh-overview">
      <div><dt>현재 제출</dt><dd>{summary.current ? `v${summary.current.revision} · ${stateLabels[summary.reviewState]}` : stateLabels[summary.reviewState]}</dd></div>
      <div><dt>완료본</dt><dd>{summary.effective ? `v${summary.effective.revision}` : '없음'}</dd></div>
    </dl>
    {summary.effective && summary.effective.id !== summary.current?.id && <p className="csh-muted">새 제출의 검토가 끝나기 전에는 완료본 v{summary.effective.revision}이 유지됩니다.</p>}
    {summary.pendingSupplements.length > 0 && <p className="csh-pending">남은 보완 요청 {summary.pendingSupplements.length}건 · 가장 빠른 기한 <time dateTime={summary.pendingSupplements[0].dueDate}>{summary.pendingSupplements[0].dueDate}</time>{summary.supplementOverdue ? ' · 보완 기한 초과' : ''}</p>}
    {text(unit?.correctionUntil) && <p className="csh-muted">정정·철회 허용 기간: <time dateTime={unit.correctionUntil}>{unit.correctionUntil}</time>까지{summary.correctionExpired ? ' · 종료됨' : summary.correctionOpen ? ' · 현재 기간 내' : ''}{text(unit.correctionReason) && <> · 사유: {unit.correctionReason}</>}</p>}
    {summary.history.length > 0 ? <details className="csh-details" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>제출 이력 · {summary.history.length}판</summary>
      {open && <><p className="csh-muted">제출판 최신순 · 시각은 한국 표준시(Asia/Seoul)입니다. 기한과 접수일은 서버에서 받은 날짜입니다.</p>
        <CollectionSubmissionHistoryEntries detail={detail} unit={unit} date={date} onDownload={onDownload} disabled={disabled} members={members} summary={summary} visibleCount={visibleCount} />
        {visibleCount < summary.history.length && <button type="button" className="csh-more" onClick={() => setVisibleCount(value => value + 20)}>이전 제출 이력 더 보기 · {Math.min(visibleCount, summary.history.length)}/{summary.history.length}판 표시</button>}
      </>}
    </details> : <p className="csh-muted">{summary.reviewState === 'unavailable' ? '제출 이력을 확인할 수 없습니다. 다시 조회해 주세요.' : '서버에 접수된 제출 이력이 없습니다.'}</p>}
  </section>
}

// 열린 이력만 나누어 렌더한다. 서버 재조회나 보이지 않는 초안 조회를 하지 않는다.
export function CollectionSubmissionHistoryEntries({ detail, unit, date, onDownload, disabled = false, members, summary, visibleCount = 20 }: Props & { summary: CollectionSubmissionSummary; visibleCount?: number }) {
  const snapshotMembers = Array.isArray(unit?.members) ? unit.members : []
  const schoolMembers = (Array.isArray(members) ? members : []).filter(member => member && member.schoolId === unit.schoolId && activeAt(member, date))
  // 제출 단위의 기록된 이름을 우선하고, 없는 검토자만 현재 학교의 공개된 활성 명부에서 찾는다.
  const actor = (id: string) => text(snapshotMembers.find(member => member && member.id === id)?.name) || text(schoolMembers.find(member => member.id === id)?.name) || '교사 이름 확인 불가'
  return <ol>{summary.history.slice(0, visibleCount).map(submission => {
        const withdrawn = summary.withdrawnSubmissionIds.includes(submission.id)
        const reviews = summary.reviews.filter(value => value.submissionId === submission.id)
        const supplements = summary.supplements.filter(value => value.submissionId === submission.id)
        const withdrawals = summary.withdrawals.filter(value => value.submissionId === submission.id)
        const files = fileRows(submission.files)
        return <li key={submission.id}>
          <h5>제출 v{submission.revision}{summary.current?.id === submission.id ? ' · 현재 제출' : ''}{summary.effective?.id === submission.id ? ' · 완료본' : ''}{withdrawn ? ' · 철회됨' : ''}</h5>
          <p className="csh-muted">제출자 {actor(submission.submittedBy)} · <RecordedTime value={submission.receiptAt} /></p>
          <p className="csh-muted">접수일 {text(submission.receiptDate)} · 제출 당시 마감 {text(submission.dueSnapshot)}{submission.initiallyLate ? ' · 최초 제출 지연' : ''}</p>
          {text(submission.correctionReason) && <p className="csh-text">재제출 사유: {submission.correctionReason}</p>}
          {text(detail.request.textLabel) && <p className="csh-text"><strong>{detail.request.textLabel}</strong>: {text(submission.text) || '미입력'}</p>}
          {text(detail.request.numberLabel) && <p><strong>{detail.request.numberLabel}</strong>: {typeof submission.number === 'number' && Number.isFinite(submission.number) ? submission.number : '미입력'}</p>}
          {files.length > 0 && <ul className="csh-files" aria-label={`제출 v${submission.revision} 파일`}>{files.map(file => <li key={file.id}>
            <span>{file.name}<small>{new Intl.NumberFormat('ko-KR').format(file.bytes)}바이트</small></span>
            {withdrawn ? <span className="csh-muted">철회된 제출 파일</span> : <button type="button" disabled={disabled} aria-label={`제출 v${submission.revision} ${file.name} 내려받기`} onClick={() => onDownload({ kind: 'submission', requestId: detail.request.id, unitId: unit.id, submissionId: submission.id }, file)}>내려받기</button>}
          </li>)}</ul>}
          {withdrawn && files.length > 0 && <p className="csh-muted">철회된 제출 파일의 내려받기는 제공하지 않습니다.</p>}
          {reviews.map(review => <div key={review.id} className="csh-event">
            <strong>{review.decision === 'accepted' ? '검토 완료' : '보완 요청'}</strong>
            <p className="csh-muted">검토자 {actor(review.reviewerMemberId)} · <RecordedTime value={review.recordedAt} /></p>
            <p className="csh-text">{text(review.note) || '별도 검토 의견 없음'}</p>
          </div>)}
          {supplements.map(supplement => {
            const response = summary.history.find(value => value.id === supplement.fulfilledSubmissionId)
            return <p key={supplement.id} className="csh-text">보완 기한 <time dateTime={supplement.dueDate}>{supplement.dueDate}</time> · {response ? <>보완 응답 v{response.revision} 제출{supplement.fulfilledAt && <> · <RecordedTime value={supplement.fulfilledAt} /></>} · 검토 결과는 해당 제출판을 확인해 주세요.</> : <>응답 대기{supplement.dueDate < date ? ' · 기한 초과' : ''}</>}</p>
          })}
          {withdrawals.map(withdrawal => <div key={withdrawal.id} className="csh-event"><strong>제출 철회</strong><p className="csh-muted">처리자 {actor(withdrawal.actorMemberId)} · <RecordedTime value={withdrawal.recordedAt} /></p><p className="csh-text">{text(withdrawal.reason) || '철회 사유 확인 필요'}</p></div>)}
        </li>
      })}</ol>
}
