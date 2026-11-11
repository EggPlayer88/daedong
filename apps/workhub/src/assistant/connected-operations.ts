import type { Membership } from '../contracts'
import type { CalendarAdapter } from '../calendar/contracts'
import type { TaskAdapter } from '../tasks/contracts'
import { buildAssistantCalendarDraft } from '../calendar/assistant-draft'
import type { AssistantWorkspaceActions } from './workspace-model'
import { prepareCalendarOperation, prepareTaskOperation, executeWorkspaceOperation, WorkspaceOperationError } from './workspace-operations'

export interface OperationBinding { member: Membership; date: string; isCurrent: () => boolean }

// 기존 업무 어댑터를 공유하므로 AI 대화에서도 동일한 서버 권한·판·접수증 검증을 거친다.
export function createConnectedAssistantOperations(task: TaskAdapter, calendar: CalendarAdapter,
  bind: (kind: 'taskChange' | 'calendarCreate', preparing: boolean) => OperationBinding): NonNullable<AssistantWorkspaceActions['operations']> {
  return {
    async prepareTask(command, item) {
      const current = bind('taskChange', true)
      if (item.kind !== 'task' || !Number.isSafeInteger(item.version) || (item.version ?? 0) < 1)
        throw new WorkspaceOperationError('INVALID_INPUT', '변경할 개인 할 일을 다시 선택해 주세요.', 'not_saved')
      const review = await prepareTaskOperation(task, { key: crypto.randomUUID(), schoolId: current.member.schoolId,
        memberId: current.member.id, basisDate: current.date, taskId: item.id, title: item.title,
        expectedVersion: item.version!, change: command.change }, current.member, current.date)
      if (!current.isCurrent()) throw new WorkspaceOperationError('CANCELLED', '학교 연결이 바뀌었습니다. 대화에서 최신 업무를 다시 선택해 주세요.', 'not_saved')
      return review
    },
    async prepareCalendar(command) {
      const current = bind('calendarCreate', true)
      return prepareCalendarOperation({ id: crypto.randomUUID(), schoolId: current.member.schoolId, memberId: current.member.id,
        draft: buildAssistantCalendarDraft(command, current.member, current.date) }, current.member, current.date)
    },
    async execute(review, retry) {
      // 복구 시작 전 연결 실패도 이미 저장된 원요청을 취소했다는 증거는 아니다.
      let current: OperationBinding
      try { current = bind(review.kind, false) }
      catch (error) { throw new WorkspaceOperationError('NOT_READY', error instanceof Error ? error.message : '학교 연결을 확인해 주세요.', retry ? 'unknown' : 'not_saved') }
      return executeWorkspaceOperation(review, { task, calendar }, current.member, current.date, { retry, isCurrent: current.isCurrent })
    },
  }
}
