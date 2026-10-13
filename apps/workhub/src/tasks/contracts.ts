import type { PersonalTask, TaskInput, TaskStatus } from '../workflows/types'

export type { PersonalTask, TaskInput, TaskStatus } from '../workflows/types'
export type TaskFailureCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'QUERY_FAILED' | 'SAVE_FAILED' | 'CANCELLED'

export class TaskError extends Error {
  constructor(public code: TaskFailureCode, message: string, public current?: PersonalTask) {
    super(message)
    this.name = 'TaskError'
  }
}

export type TaskCommand =
  | { kind: 'create'; input: TaskInput }
  | { kind: 'update'; taskId: string; input: TaskInput; expectedVersion: number }
  | { kind: 'status'; taskId: string; status: TaskStatus; expectedVersion: number }

export interface TaskAdapter {
  list(memberId: string): Promise<PersonalTask[]>
  get(memberId: string, taskId: string): Promise<PersonalTask>
  create(memberId: string, input: TaskInput, requestKey: string): Promise<PersonalTask>
  update(memberId: string, taskId: string, input: TaskInput, expectedVersion: number, requestKey: string): Promise<PersonalTask>
  setStatus(memberId: string, taskId: string, status: TaskStatus, expectedVersion: number, requestKey: string): Promise<PersonalTask>
}
