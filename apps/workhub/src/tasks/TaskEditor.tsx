import { TASK_INPUT_LIMITS } from './validation'
import type { FormEvent, RefObject } from 'react'
import type { PersonalTask, TaskInput } from './contracts'

interface Props {
  id: string
  original?: PersonalTask
  input: TaskInput
  locked: boolean
  saving: boolean
  errorId?: string
  titleRef: RefObject<HTMLInputElement>
  onTitleChange: (value: string) => void
  onDueDateChange: (value: string) => void
  onNotesChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}

// 입력값·저장·복구·초점 이동의 상태는 상위 화면이 관리한다.
export function TaskEditor({
  id, original, input, locked, saving, errorId, titleRef,
  onTitleChange, onDueDateChange, onNotesChange, onSubmit, onCancel,
}: Props) {
  return <form className="task-editor" onSubmit={onSubmit} aria-describedby={errorId} aria-label={original ? '내 업무 수정' : '내 업무 등록'}>
    <h3>{original ? '업무 내용 수정' : '새 할 일'}</h3>
    <fieldset disabled={locked}>
      <legend className="task-sr-only">업무 입력</legend>
      <div className="task-form-row">
        <label className="task-title-field" htmlFor={`${id}-title`}>해야 할 일
          <input ref={titleRef} id={`${id}-title`} aria-describedby={`${id}-title-hint`} name="task-title" aria-label="해야 할 일" required value={input.title} onChange={event => onTitleChange(event.target.value)} placeholder="예: 체험학습 안내 내용 확인" />
          <small id={`${id}-title-hint`}>필수 · {Array.from(input.title).length}/{TASK_INPUT_LIMITS.titleChars}자</small>
        </label>
        <label htmlFor={`${id}-due`}>기한 (선택)
          <input id={`${id}-due`} name="task-due" aria-label="기한 (선택)" type="date" value={input.dueDate} onChange={event => onDueDateChange(event.target.value)} />
        </label>
      </div>
      <label htmlFor={`${id}-notes`}>나만 보는 메모
        <textarea id={`${id}-notes`} aria-describedby={`${id}-notes-hint`} name="task-notes" aria-label="나만 보는 메모" rows={3} value={input.notes} onChange={event => onNotesChange(event.target.value)} />
        <small id={`${id}-notes-hint`}>선택 · {Array.from(input.notes).length.toLocaleString()}/{TASK_INPUT_LIMITS.notesChars.toLocaleString()}자</small>
      </label>
    </fieldset>
    <div className="task-actions">
      <button type="submit" className="task-primary" disabled={locked}>{saving ? '저장 중…' : original ? '수정 저장' : '내 업무에 추가'}</button>
      <button type="button" className="task-secondary" disabled={locked} onClick={onCancel}>편집 취소</button>
      {original && <small>확인한 원본 v{original.version}</small>}
    </div>
  </form>
}
