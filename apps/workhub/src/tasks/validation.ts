import { TaskError, type PersonalTask, type TaskInput, type TaskStatus } from './contracts'

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'waiting', 'done', 'cancelled']
export interface TaskScope { memberId: string; schoolId: string }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = (message: string): never => { throw new TaskError('INVALID_INPUT', message) }
const invalidResponse = (): never => { throw new TaskError('QUERY_FAILED', '업무 응답을 확인할 수 없습니다. 학교 연결을 다시 확인해 주세요.') }
// PostgreSQL JSONB에 담을 수 없는 NUL과 짝이 없는 UTF-16 서로게이트는 전송 전에 거부한다.
const storableText = (value: string): boolean => !value.includes('\0') && !Array.from(value).some(point => point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff)

function text(value: unknown, label: string, max: number, required = false): string {
  // 서버의 length(text)와 같은 코드포인트 수로 원문을 검사한 뒤 정규화한다.
  if (typeof value !== 'string' || !storableText(value) || Array.from(value).length > max) return invalid(`${label}은(는) ${max}자 이내의 올바른 문자로 입력해 주세요.`)
  const normalized = value.trim()
  if (required && !normalized) return invalid(`${label}을(를) 입력해 주세요.`)
  return normalized
}

export function normalizeTaskInput(value: unknown): TaskInput {
  if (!record(value) || Object.keys(value).some(key => !['title', 'notes', 'dueDate'].includes(key))) return invalid('업무 입력 형식을 확인해 주세요.')
  if (typeof value.dueDate !== 'string' || (value.dueDate !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) || value.dueDate.startsWith('0000-') || Number.isNaN(Date.parse(`${value.dueDate}T00:00:00Z`)) || new Date(`${value.dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== value.dueDate))) return invalid('기한은 올바른 날짜로 입력하거나 비워 두세요.')
  return { title: text(value.title, '제목', 120, true), notes: text(value.notes, '메모', 2000), dueDate: value.dueDate }
}

export function taskIdentifier(value: unknown, label = '업무 식별자'): string {
  if (typeof value !== 'string' || !value || !storableText(value) || value !== value.trim() || Array.from(value).length > 200) return invalid(`${label}을(를) 확인해 주세요.`)
  return value
}
export function taskRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || !storableText(value) || Array.from(value).length > 200) return invalid('저장 요청 번호를 확인해 주세요.')
  return value
}
export function taskVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return invalid('확인한 업무 버전이 필요합니다.')
  return value
}
export function taskStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value as TaskStatus)) return invalid('업무 상태를 확인해 주세요.')
  return value as TaskStatus
}

/** 응답은 허용 필드만 반환한다. 서버 원문에 섞인 타인 업무나 추가 필드를 UI에 전달하지 않는다. */
export function taskResponse(value: unknown, scope: TaskScope, expectedTaskId?: string): PersonalTask {
  try {
    if (!record(value) || value.schoolId !== scope.schoolId || value.ownerMemberId !== scope.memberId || (expectedTaskId !== undefined && value.id !== expectedTaskId)) return invalidResponse()
    const input = normalizeTaskInput({ title: value.title, notes: value.notes, dueDate: value.dueDate })
    if (input.title !== value.title || input.notes !== value.notes) return invalidResponse()
    return { ...input, id: taskIdentifier(value.id), schoolId: scope.schoolId, ownerMemberId: scope.memberId, status: taskStatus(value.status), version: taskVersion(value.version) }
  } catch { return invalidResponse() }
}

export function taskListResponse(value: unknown, scope: TaskScope): PersonalTask[] {
  if (!Array.isArray(value)) return invalidResponse()
  const tasks = value.map(item => taskResponse(item, scope))
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) return invalidResponse()
  return tasks
}
