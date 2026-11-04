import type { Membership } from '../contracts'
import type { TaskChange } from '../assistant/task-change-command'
import { TaskError, type PersonalTask, type TaskCommand } from './contracts'
import { normalizeTaskInput } from './validation'
import { taskStatusLabels } from './presentation'

export interface AssistantTaskChangeRequest {
  key: string
  schoolId: string
  memberId: string
  basisDate: string
  taskId: string
  title: string
  expectedVersion: number
  change: TaskChange
}
export interface TaskChangeReview {
  key: string
  basisDate: string
  original: PersonalTask
  before: string
  after: string
  field: string
  command: Exclude<TaskCommand, {kind:'create'}>
}
export const changedTaskMessage = '선택한 업무가 변경되어 저장하지 않았습니다. 대화에서 최신 업무를 다시 선택해 주세요.'

export function reviewAssistantTaskChange(request: AssistantTaskChangeRequest, original: PersonalTask, member: Membership, date: string): TaskChangeReview {
  if (request.memberId !== member.id || request.schoolId !== member.schoolId || request.basisDate !== date
    || original.schoolId !== member.schoolId || original.ownerMemberId !== member.id || original.id !== request.taskId) {
    throw new Error('선택한 업무와 현재 학교·소속을 다시 확인해 주세요.')
  }
  if (request.expectedVersion !== original.version || request.title !== original.title) throw new Error(changedTaskMessage)
  const context = { key: request.key, basisDate: date, original }
  const target = { taskId: original.id, expectedVersion: original.version }
  const change = request.change
  if (change.kind === 'complete') {
    if (original.status === 'done') throw new Error('이미 완료한 할 일입니다. 추가로 저장할 변경이 없습니다.')
    if (original.status === 'cancelled') throw new Error('취소된 할 일입니다. 먼저 내 업무에서 상태를 확인해 주세요.')
    return { ...context, field: '상태', before: taskStatusLabels[original.status], after: taskStatusLabels.done,
      command: { kind: 'status', ...target, status: 'done' } }
  }
  const { title, notes, dueDate } = original
  const input = normalizeTaskInput({ title, notes, dueDate, [change.kind]: change.value })
  if (input[change.kind] === original[change.kind]) throw new Error('이미 같은 내용입니다. 추가로 저장할 변경이 없습니다.')
  return { ...context, field: change.kind === 'notes' ? '메모' : '기한', before: original[change.kind], after: input[change.kind],
    command: { kind: 'update', ...target, input } }
}

// 같은 번호를 재전송할 때도 확인한 변경을 반영한 판의 접수 결과여야 한다.
export function verifyTaskChangeReceipt(command: TaskCommand, original: PersonalTask | undefined, result: PersonalTask) {
  if (command.kind === 'create' || !original || command.taskId !== original.id || result.id !== original.id
    || result.version !== command.expectedVersion + 1) throw new TaskError('SAVE_FAILED', '요청한 업무 변경의 결과를 확인할 수 없습니다.')
  const expected = command.kind === 'update' ? { ...original, ...command.input } : { ...original, status: command.status }
  if (result.title !== expected.title || result.notes !== expected.notes || result.dueDate !== expected.dueDate || result.status !== expected.status)
    throw new TaskError('SAVE_FAILED', '확인한 변경과 다릅니다. 같은 요청으로 결과를 확인해 주세요.')
}
