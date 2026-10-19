import type { PersonalTask, TaskStatus } from './contracts'
import { TASK_STATUSES } from './validation'
import { isOpenTask, taskNoteExcerpt, taskStatusLabels } from './presentation'

interface Props {
  id: string
  task: PersonalTask
  date: string
  compact: boolean
  highlighted: boolean
  locked: boolean
  editing: boolean
  onStatusChange: (status: TaskStatus) => void
  onEdit: (trigger: HTMLButtonElement) => void
}

// 카드는 표시와 조작 의도만 전달한다. 저장 요청·버전 검증은 상위 화면이 맡는다.
export function TaskCard({ id, task, date, compact, highlighted, locked, editing, onStatusChange, onEdit }: Props) {
  return <article className={`task-card task-status-${task.status}${highlighted ? ' task-card-highlighted' : ''}`} data-task-id={task.id} tabIndex={-1} aria-label={task.title}>
    <div className="task-card-content">
      <h3 id={`${id}-task-${task.id}`}>{task.title}</h3>
      <div className="task-meta">
        <span className="task-status-badge">{taskStatusLabels[task.status]}</span>
        <span className={task.dueDate && task.dueDate < date && isOpenTask(task) ? 'task-overdue' : ''}>{task.dueDate ? `${task.dueDate}까지${task.dueDate < date && isOpenTask(task) ? ' · 기한 지남' : ''}` : '기한 없음'}</span>
        {!compact && <small>v{task.version}</small>}
      </div>
      {task.notes && <p className="task-notes">{compact ? taskNoteExcerpt(task.notes) : task.notes}</p>}
    </div>
    <div className="task-card-actions">
      <button type="button" className="task-secondary" aria-describedby={`${id}-task-${task.id}`} disabled={locked} onClick={() => onStatusChange(task.status === 'done' || task.status === 'cancelled' ? 'todo' : 'done')}>{task.status === 'done' || task.status === 'cancelled' ? '다시 시작' : '완료'}</button>
      {!compact && <>
        <select aria-label={`${task.title} 상태`} value={task.status} disabled={locked} onChange={event => onStatusChange(event.target.value as TaskStatus)}>
          {TASK_STATUSES.map(status => <option value={status} key={status}>{taskStatusLabels[status]}</option>)}
        </select>
        <button type="button" className="task-text-button" aria-describedby={`${id}-task-${task.id}`} disabled={locked || editing} onClick={event => onEdit(event.currentTarget)}>수정</button>
      </>}
    </div>
  </article>
}
