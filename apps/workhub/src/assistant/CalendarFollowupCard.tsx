import { calendarQuestion } from './calendar-conversation'
import type { CalendarWorkspaceCommand } from './workspace-model'

export function CalendarFollowupCard({ command, disabled, onCancel }: {
  command: CalendarWorkspaceCommand; disabled: boolean; onCancel: () => void
}) {
  const time = command.allDay ? '종일' : [command.startTime || '시작 미정', command.endTime || '종료 미정'].join(' ~ ')
  return <section className="assistant-workspace-result" aria-label="작성 중인 일정">
    <p className="assistant-command-question">{command.prompt}</p>
    <div className="assistant-workspace-result-heading"><h3>작성 중인 일정</h3><span>미저장</span></div>
    <p>{[command.title, command.date, time].filter(Boolean).join(' · ')}</p>
    <p role="status">{calendarQuestion(command)}</p>
    <button className="assistant-quiet" type="button" disabled={disabled} onClick={onCancel}>일정 대화 취소</button>
  </section>
}
