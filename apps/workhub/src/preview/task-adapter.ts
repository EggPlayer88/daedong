import type { WorkflowStore } from '../workflows/store'
import { WorkflowError } from '../workflows/types'
import { TaskError, type TaskAdapter, type TaskFailureCode } from '../tasks/contracts'

// 미리보기와 실제 연결이 같은 화면을 사용하되 저장소와 계정은 섞지 않는다.
export function createPreviewTaskAdapter(store: WorkflowStore): TaskAdapter {
  async function execute<T>(memberId: string, operation: () => T, taskId?: string): Promise<T> {
    try { return operation() }
    catch (error) {
      if (!(error instanceof WorkflowError)) throw new TaskError('QUERY_FAILED', '합성 업무 자료를 확인하지 못했습니다.')
      const code: TaskFailureCode = error.code === 'VERSION_CONFLICT' ? 'CONFLICT'
        : error.code === 'STORAGE_FAILED' ? 'SAVE_FAILED'
        : error.code === 'INVALID_STATE' ? 'INVALID_INPUT' : error.code
      let current
      if (code === 'CONFLICT' && taskId) {
        try { current = store.listTasks(memberId).find(task => task.id === taskId) } catch { /* 현재 소속으로 읽을 수 없는 원본은 전달하지 않는다. */ }
      }
      throw new TaskError(code, error.message, current)
    }
  }
  return {
    list: memberId => execute(memberId, () => store.listTasks(memberId)),
    get: (memberId, taskId) => execute(memberId, () => {
      const task = store.listTasks(memberId).find(value => value.id === taskId)
      if (!task) throw new WorkflowError('NOT_FOUND', '현재 학교에서 확인할 수 없는 할 일입니다.')
      return task
    }, taskId),
    create: (memberId, input, requestKey) => execute(memberId, () => store.createTask(memberId, input, requestKey)),
    update: (memberId, taskId, input, expectedVersion, requestKey) => execute(memberId, () => store.updateTask(memberId, taskId, input, expectedVersion, requestKey), taskId),
    setStatus: (memberId, taskId, status, expectedVersion, requestKey) => execute(memberId, () => store.setTaskStatus(memberId, taskId, status, expectedVersion, requestKey), taskId),
  }
}
