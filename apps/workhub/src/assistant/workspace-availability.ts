import type { AssistantWorkspaceActions } from './workspace-model'
import type { WorkspaceCommand } from './workspace-commands'
import { specialistWorkflow } from './specialist-workflows'

// 화면의 기존 허용 범위만 설명한다. 서버 권한을 대신하거나 넓히지 않는다.
export function unavailableWorkspaceCommand(command: WorkspaceCommand | null, actions?: AssistantWorkspaceActions): string | undefined {
  if (!command || !actions) return
  const pages = actions.availablePages, kinds = actions.availableSearchKinds
  if (command.kind === 'search' && kinds && !command.kinds.some(kind => kinds.includes(kind)))
    return '현재 계정에는 이 자료 조회 메뉴가 열려 있지 않습니다. 입력은 유지했습니다.'
  const target = command.kind === 'navigate' ? command.page
    : command.kind === 'specialist' ? specialistWorkflow(command.task)?.page
      : command.kind === 'daily' ? command.view === 'notifications' ? 'messages' : command.view === 'lessons' ? 'timetable' : 'home'
        : command.kind === 'evaluation' ? 'documents' : undefined
  if (pages && target && !pages.includes(target)) return command.kind === 'daily' && command.view === 'overview'
    ? '현재 시험 계정에서는 오늘 업무 요약 대신 내 할 일·일정·알림을 각각 확인할 수 있습니다.'
    : '현재 계정에는 이 업무 메뉴가 열려 있지 않습니다. 입력은 유지했습니다.'
}
