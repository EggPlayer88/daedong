import { useEffect, useRef } from 'react'
import { taskChangeConfirmLabel, type TaskChangeReview } from './assistant-change'

export function TaskChangeConfirmation({ review, disabled, onConfirm, onCancel }: {
  review: TaskChangeReview; disabled: boolean; onConfirm: () => void; onCancel: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [review])
  return <section className="task-conflict" aria-label="할 일 변경 확인">
    <h3 ref={heading} tabIndex={-1}>할 일 변경 확인</h3>
    <p><strong>{review.original.title}</strong> · v{review.original.version} · {review.field}</p>
    <div className="task-comparison">
      <div><h4>변경 전</h4><p className="task-notes">{review.before || '없음'}</p></div>
      <div><h4>변경 후</h4><p className="task-notes">{review.after || '없음'}</p></div>
    </div>
    <div className="task-actions">
      <button type="button" className="task-primary" disabled={disabled} onClick={onConfirm}>{taskChangeConfirmLabel(review)}</button>
      <button type="button" className="task-secondary" onClick={onCancel}>변경 취소</button>
    </div>
  </section>
}
