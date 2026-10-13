import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { TaskError, type PersonalTask, type TaskAdapter, type TaskCommand, type TaskFailureCode, type TaskInput, type TaskStatus } from './contracts'
import { normalizeTaskInput, taskIdentifier, taskListResponse, taskRequestKey, taskResponse, taskStatus, taskVersion, type TaskScope } from './validation'

type Scope = TaskScope & { userId: string }
const messages: Record<TaskFailureCode, string> = {
  INVALID_INPUT: '업무 입력과 확인한 버전을 다시 확인해 주세요.',
  NOT_FOUND: '업무가 없거나 현재 소속으로 열람할 수 없습니다.',
  FORBIDDEN: '현재 계정으로 이 업무를 처리할 수 없습니다.',
  INACTIVE_MEMBERSHIP: '현재 이용 가능한 학교 소속이 아닙니다.',
  CONFLICT: '다른 곳에서 먼저 수정했습니다. 최신 업무와 내 입력을 비교해 주세요.',
  IDEMPOTENCY_CONFLICT: '같은 저장 요청 번호에 다른 내용이 포함되었습니다.',
  QUERY_FAILED: '업무를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.',
  SAVE_FAILED: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.',
  CANCELLED: '계정이나 학교 연결이 바뀌어 이전 요청 결과를 취소했습니다.',
}

/** 기존 rpcVerified를 재사용한다. 서버의 본인·학교 권한 검증과 별도로 응답 범위만 보호한다. */
export function createSupabaseTaskAdapter(connection: SupabaseConnection): TaskAdapter {
  function scopeFor(memberId: string): Scope {
    taskIdentifier(memberId, '학교 소속')
    try {
      const context = connection.info()
      const member = context.memberships.find(value => value.id === memberId)
      if (!member || !context.schools.some(school => school.id === member.schoolId)) throw new TaskError('QUERY_FAILED', '학교 연결을 새로 불러와 주세요.')
      if (!activeAt(member, context.basisDate)) throw new TaskError('INACTIVE_MEMBERSHIP', messages.INACTIVE_MEMBERSHIP)
      return { memberId: member.id, schoolId: member.schoolId, userId: member.userId }
    } catch (error) {
      if (error instanceof TaskError) throw error
      throw new TaskError('QUERY_FAILED', messages.QUERY_FAILED)
    }
  }
  function currentScope(scope: Scope): Scope {
    try {
      const current = scopeFor(scope.memberId)
      if (current.schoolId !== scope.schoolId || current.userId !== scope.userId) throw new Error('변경된 소속')
      return current
    } catch { throw new TaskError('CANCELLED', messages.CANCELLED) }
  }
  function failure(error: unknown, writing: boolean, scope: Scope, taskId?: string): TaskError {
    const fallback: TaskFailureCode = writing ? 'SAVE_FAILED' : 'QUERY_FAILED'
    if (error instanceof TaskError) {
      return new TaskError(error.code === 'QUERY_FAILED' && writing ? 'SAVE_FAILED' : error.code, messages[error.code === 'QUERY_FAILED' && writing ? 'SAVE_FAILED' : error.code])
    }
    if (!(error instanceof ContractError)) return new TaskError(fallback, messages[fallback])
    const code: TaskFailureCode = error.code === 'QUERY_FAILED' && writing ? 'SAVE_FAILED' : Object.hasOwn(messages, error.code) ? error.code : fallback
    let current: PersonalTask | undefined
    if (code === 'CONFLICT') {
      // 조회가 끝난 사이 소속이 바뀌었다면 충돌 본문도 폐기한다. 과거 컨텍스트로 우회하지 않는다.
      currentScope(scope)
      if (error.current !== undefined && taskId !== undefined) {
        try { current = taskResponse(error.current as unknown, scope, taskId) }
        catch { /* 손상되거나 다른 학교·작성자·업무의 충돌 본문을 전달하지 않는다. */ }
      }
    }
    return new TaskError(code, messages[code], current)
  }
  async function mutate(memberId: string, command: TaskCommand, requestKey: string): Promise<PersonalTask> {
    const key = taskRequestKey(requestKey)
    const scope = scopeFor(memberId)
    const taskId = command.kind === 'create' ? undefined : command.taskId
    try {
      const raw = await connection.rpcVerified('workhub_task_mutate', { p_member_id: memberId, p_command: command, p_request_key: key })
      currentScope(scope)
      return taskResponse(raw, scope, taskId)
    } catch (error) { throw failure(error, true, scope, taskId) }
  }
  return {
    async list(memberId: string): Promise<PersonalTask[]> {
      const scope = scopeFor(memberId)
      try {
        const raw = await connection.rpcVerified('workhub_task_list', { p_member_id: memberId })
        currentScope(scope)
        return taskListResponse(raw, scope)
      } catch (error) { throw failure(error, false, scope) }
    },
    async get(memberId: string, taskId: string): Promise<PersonalTask> {
      const id = taskIdentifier(taskId)
      const scope = scopeFor(memberId)
      try {
        const raw = await connection.rpcVerified('workhub_task_get', { p_member_id: memberId, p_task_id: id })
        currentScope(scope)
        return taskResponse(raw, scope, id)
      } catch (error) { throw failure(error, false, scope, id) }
    },
    async create(memberId: string, input: TaskInput, requestKey: string) {
      return mutate(memberId, { kind: 'create', input: normalizeTaskInput(input) }, requestKey)
    },
    async update(memberId: string, taskId: string, input: TaskInput, expectedVersion: number, requestKey: string) {
      return mutate(memberId, { kind: 'update', taskId: taskIdentifier(taskId), input: normalizeTaskInput(input), expectedVersion: taskVersion(expectedVersion) }, requestKey)
    },
    async setStatus(memberId: string, taskId: string, status: TaskStatus, expectedVersion: number, requestKey: string) {
      return mutate(memberId, { kind: 'status', taskId: taskIdentifier(taskId), status: taskStatus(status), expectedVersion: taskVersion(expectedVersion) }, requestKey)
    },
  }
}
