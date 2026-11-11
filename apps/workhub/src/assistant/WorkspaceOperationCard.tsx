import { useEffect, useId, useRef } from 'react'
import type { WorkspaceOperationReceipt, WorkspaceOperationReview, WorkspaceOperationStatus } from './workspace-operations'
import operationStyles from './workspace-operations.css?inline'

export interface WorkspaceOperationCardProps {
  review: WorkspaceOperationReview
  status: WorkspaceOperationStatus
  receipt?: WorkspaceOperationReceipt
  error?: string
  onConfirm: () => void
  onCancel: () => void
  onRetry: () => void
  onOpenResult?: () => void
  onOpenEditor?: () => void
}

export function WorkspaceOperationCard(props: WorkspaceOperationCardProps) {
  const { review } = props
  if (!review || typeof review !== 'object' || typeof review.key !== 'string' || typeof review.title !== 'string' || typeof review.authorName !== 'string'
    || (review.kind === 'taskChange' ? !review.task?.original || !Number.isSafeInteger(review.task.original.version) || !review.task.command || ['before', 'after', 'field'].some(field => typeof review.task[field as 'before'] !== 'string')
      : review.kind !== 'calendarCreate' || !review.command?.draft || ['startDate', 'startTime', 'endTime', 'location', 'description'].some(field => typeof review.command.draft[field as 'startDate'] !== 'string'))) {
    return <section className="workspace-operation" role="alert">검토할 작업을 불러오지 못했습니다. 대화에서 다시 선택해 주세요.</section>
  }
  return <WorkspaceOperationCardContent {...props} />
}

function WorkspaceOperationCardContent({ review, status, receipt, error, onConfirm, onCancel, onRetry, onOpenResult, onOpenEditor }: WorkspaceOperationCardProps) {
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [review.key, status])
  const task = review.kind === 'taskChange' ? review.task : undefined
  const draft = review.kind === 'calendarCreate' ? review.command.draft : undefined
  const saved = status === 'saved' && receipt?.key === review.key && receipt.kind === review.kind
  const headingText = saved ? '저장을 확인했습니다' : status === 'pending' ? '저장 결과 확인이 필요합니다' : task ? '할 일 변경을 검토해 주세요' : '새 일정을 검토해 주세요'
  return <section className="workspace-operation" aria-labelledby={`${id}-title`} data-operation-kind={review.kind} data-operation-status={status}>
    <style>{operationStyles}</style>
    <header className="workspace-operation-header"><p>{task ? '내 할 일 · 변경 1건' : '내 일정 · 신규 1건'}</p><h3 id={`${id}-title`} ref={heading} tabIndex={-1}>{headingText}</h3></header>
    <p className="workspace-operation-target"><strong>{review.title}</strong></p>
    <dl className="workspace-operation-context"><div><dt>{task ? '소유자' : '작성자'}</dt><dd>{review.authorName} · 나</dd></div><div><dt>공개 범위</dt><dd>나만 보기</dd></div><div><dt>대상</dt><dd>{task ? `선택한 개인 할 일 1건 · 원본 v${task.original.version}` : '내 일정 1건 새로 등록'}</dd></div></dl>
    {task && <div className="workspace-operation-comparison"><div><h4>변경 전 · {task.field}</h4><p>{task.before || '없음'}</p></div><div><h4>변경 후 · {task.field}</h4><p>{task.after || '없음'}</p></div></div>}
    {draft && <dl className="workspace-operation-details"><div><dt>날짜</dt><dd>{draft.startDate}</dd></div><div><dt>시간</dt><dd>{draft.allDay ? '종일' : `${draft.startTime}–${draft.endTime}`}</dd></div>{draft.location && <div><dt>장소</dt><dd>{draft.location}</dd></div>}{draft.description && <div><dt>안내</dt><dd>{draft.description}</dd></div>}</dl>}
    {error && <p className="workspace-operation-error" role="alert">{error}</p>}
    {status === 'review' && <p className="workspace-operation-note">위 내용을 확인한 뒤 저장해 주세요.</p>}
    {status === 'saving' && <p className="workspace-operation-note" role="status">검토한 내용을 저장하고 있습니다…</p>}
    {status === 'pending' && <p className="workspace-operation-note" role="status">저장이 처리된 뒤 응답만 끊겼을 수 있습니다. 같은 내용과 요청 번호로 결과를 확인합니다. 확인 전에는 새 작업을 저장하지 않습니다.</p>}
    {saved && <p className="workspace-operation-note" role="status">{receipt.title} · 저장된 원본 v{receipt.version}</p>}
    <div className="workspace-operation-actions">
      {status === 'review' && <button type="button" className="workspace-operation-primary" onClick={onConfirm}>{task?.command.kind === 'status' ? '확인한 할 일 완료' : task ? '확인한 변경 저장' : '확인한 일정 등록'}</button>}
      {status === 'pending' && <button type="button" className="workspace-operation-primary" onClick={onRetry}>같은 요청으로 저장 결과 확인</button>}
      {saved && onOpenResult && <button type="button" className="workspace-operation-primary" onClick={onOpenResult}>저장된 원본 보기</button>}
      {status === 'review' && onOpenEditor && <button type="button" className="workspace-operation-secondary" onClick={onOpenEditor}>편집 화면에서 계속</button>}
      {(status === 'review' || status === 'error' || saved) && <button type="button" className="workspace-operation-secondary" onClick={onCancel}>{saved ? '확인' : status === 'error' ? '닫기' : '취소'}</button>}
    </div>
  </section>
}
