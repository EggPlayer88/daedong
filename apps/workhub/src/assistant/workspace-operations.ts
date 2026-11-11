import { ContractError, type CalendarEvent, type Membership, type SaveCommand } from '../contracts'
import { activeAt, normalizeDraft } from '../domain'
import type { CalendarAdapter } from '../calendar/contracts'
import { validateAssistantCalendarDraftRequest, type AssistantCalendarDraftRequest } from '../calendar/assistant-draft'
import { eventResponse } from '../connection/validation'
import { canonical, isoDate, object } from '../services/service-values'
import { TaskError, type PersonalTask, type TaskAdapter } from '../tasks/contracts'
import { taskIdentifier, taskRequestKey, taskResponse, taskVersion } from '../tasks/validation'
import { changedTaskMessage, reviewAssistantTaskChange, verifyTaskChangeReceipt, type AssistantTaskChangeRequest, type TaskChangeReview } from '../tasks/assistant-change'

interface OperationContext {
  key: string
  schoolId: string
  memberId: string
  userId: string
  basisDate: string
  authorName: string
  title: string
}
export type WorkspaceOperationReview =
  | OperationContext & { kind: 'taskChange'; request: AssistantTaskChangeRequest; task: TaskChangeReview }
  | OperationContext & { kind: 'calendarCreate'; request: AssistantCalendarDraftRequest; command: SaveCommand }
export type WorkspaceOperationReceipt =
  | { kind: 'taskChange'; key: string; id: string; title: string; version: number; result: PersonalTask }
  | { kind: 'calendarCreate'; key: string; id: string; title: string; version: number; result: CalendarEvent }
export type WorkspaceOperationStatus = 'review' | 'saving' | 'pending' | 'saved' | 'error'
export interface WorkspaceOperationAdapters { task: TaskAdapter; calendar: CalendarAdapter }

// 전송 전 실패와 접수 여부를 모르는 실패를 분리해야 원키 복구를 안전하게 유지할 수 있다.
export class WorkspaceOperationError extends Error {
  constructor(public code: string, message: string, public outcome: 'not_saved' | 'unknown') {
    super(message)
    this.name = 'WorkspaceOperationError'
  }
}
function invalid(message = '검토할 작업의 내용을 다시 확인해 주세요.'): never {
  throw new WorkspaceOperationError('INVALID_INPUT', message, 'not_saved')
}
function mappedFailure(error: unknown, outcome: WorkspaceOperationError['outcome']) {
  const code = error instanceof TaskError || error instanceof ContractError || error instanceof WorkspaceOperationError ? error.code : 'QUERY_FAILED'
  return new WorkspaceOperationError(code, error instanceof Error ? error.message : '작업 결과를 확인하지 못했습니다.', outcome)
}
function activeMember(member: Membership, date: string) {
  isoDate(date)
  if (!activeAt(member, date)) throw new WorkspaceOperationError('INACTIVE_MEMBERSHIP', '현재 학교 소속을 다시 확인해 주세요.', 'not_saved')
  taskIdentifier(member.id); taskIdentifier(member.schoolId); taskIdentifier(member.userId)
}
function context(key: string, title: string, member: Membership, date: string): OperationContext {
  return { key, title, schoolId: member.schoolId, memberId: member.id, userId: member.userId, basisDate: date, authorName: member.name }
}
function taskRequest(raw: unknown): AssistantTaskChangeRequest {
  if (!object(raw) || !object(raw.change)) invalid()
  const change = raw.change
  if (change.kind === 'complete') {
    if (Object.keys(change).length !== 1) invalid()
  } else if ((change.kind !== 'notes' && change.kind !== 'dueDate') || typeof change.value !== 'string' || Object.keys(change).length !== 2) invalid()
  taskRequestKey(raw.key); taskIdentifier(raw.taskId); taskIdentifier(raw.schoolId); taskIdentifier(raw.memberId); taskVersion(raw.expectedVersion); isoDate(raw.basisDate)
  if (typeof raw.title !== 'string') invalid()
  return structuredClone(raw) as unknown as AssistantTaskChangeRequest
}
function taskReview(request: AssistantTaskChangeRequest, raw: unknown, member: Membership, date: string): WorkspaceOperationReview {
  const original = taskResponse(raw, { memberId: member.id, schoolId: member.schoolId }, request.taskId)
  const task = reviewAssistantTaskChange(request, original, member, date)
  return { ...context(request.key, original.title, member, date), kind: 'taskChange', request: structuredClone(request), task }
}

export async function prepareTaskOperation(adapter: TaskAdapter, raw: AssistantTaskChangeRequest, member: Membership, date: string): Promise<WorkspaceOperationReview> {
  try {
    activeMember(member, date)
    const request = taskRequest(raw)
    if (request.schoolId !== member.schoolId || request.memberId !== member.id || request.basisDate !== date) invalid('선택한 학교·소속·기준일을 다시 확인해 주세요.')
    return taskReview(request, await adapter.get(member.id, request.taskId), member, date)
  } catch (error) { throw mappedFailure(error, 'not_saved') }
}

export function prepareCalendarOperation(raw: AssistantCalendarDraftRequest, member: Membership, date: string): WorkspaceOperationReview {
  try {
    activeMember(member, date)
    const request = validateAssistantCalendarDraftRequest(raw, member, date)
    if (!request.draft.allDay && (!request.draft.startTime || !request.draft.endTime)) {
      throw new WorkspaceOperationError('EDITOR_REQUIRED', '시작·종료 시간을 일정 편집 화면에서 확인해 주세요.', 'not_saved')
    }
    const draft = normalizeDraft(request.draft, member, [member])
    // 기존 대화 명령이 만든 개인 일정만 여기서 저장한다. 시간 누락은 편집기로 돌려보낸다.
    return { ...context(request.id, draft.title, member, date), kind: 'calendarCreate', request: { ...request, draft }, command: { draft: structuredClone(draft), idempotencyKey: request.id } }
  } catch (error) { throw mappedFailure(error, 'not_saved') }
}

// 현재 탭에 보관한 요청도 원문·원키를 바꾸지 않고 재검사한다.
export function validateWorkspaceOperation(raw: unknown, member: Membership, date: string, retry = false): WorkspaceOperationReview {
  activeMember(member, date)
  if (!object(raw) || raw.schoolId !== member.schoolId || raw.memberId !== member.id || raw.userId !== member.userId) invalid('현재 학교·계정과 다른 작업은 실행할 수 없습니다.')
  isoDate(raw.basisDate)
  if (!retry && raw.basisDate !== date) invalid('기준일이 바뀌었습니다. 현재 날짜로 작업을 다시 검토해 주세요.')
  let rebuilt: WorkspaceOperationReview
  if (raw.kind === 'taskChange') {
    const request = taskRequest(raw.request)
    if (!object(raw.task)) invalid()
    rebuilt = taskReview(request, raw.task.original, member, raw.basisDate as string)
  } else if (raw.kind === 'calendarCreate') {
    rebuilt = prepareCalendarOperation(raw.request as AssistantCalendarDraftRequest, member, date)
    rebuilt.basisDate = raw.basisDate as string
  } else return invalid()
  // 표시 이름 변경은 계정 변경이 아니다. 검토 당시 이름을 보존한다.
  if (typeof raw.authorName !== 'string') invalid()
  rebuilt.authorName = raw.authorName
  if (canonical(rebuilt) !== canonical(raw)) invalid('검토 이후 작업 내용이 달라졌습니다. 원래 요청을 다시 확인해 주세요.')
  return rebuilt
}

export async function executeWorkspaceOperation(review: WorkspaceOperationReview, adapters: WorkspaceOperationAdapters, member: Membership, date: string, options: { retry?: boolean; isCurrent?: () => boolean } = {}): Promise<WorkspaceOperationReceipt> {
  const retry = options.retry === true
  const checkCurrent = () => {
    if (options.isCurrent?.() === false) throw new WorkspaceOperationError('CANCELLED', '학교 또는 계정이 바뀌어 작업을 멈췄습니다.', 'not_saved')
  }
  let checked: WorkspaceOperationReview
  try {
    checkCurrent()
    checked = validateWorkspaceOperation(review, member, date, retry)
    if (checked.kind === 'taskChange' && !retry) {
      const latest = taskResponse(await adapters.task.get(member.id, checked.task.original.id), { memberId: member.id, schoolId: member.schoolId }, checked.task.original.id)
      if (canonical(latest) !== canonical(checked.task.original)) throw new WorkspaceOperationError('CONFLICT', changedTaskMessage, 'not_saved')
    }
    checkCurrent()
  } catch (error) { throw mappedFailure(error, retry ? 'unknown' : 'not_saved') }
  let raw: unknown
  try {
    if (checked.kind === 'calendarCreate') raw = await adapters.calendar.save(member.id, structuredClone(checked.command))
    else {
      const command = checked.task.command
      raw = command.kind === 'update'
        ? await adapters.task.update(member.id, command.taskId, structuredClone(command.input), command.expectedVersion, checked.key)
        : await adapters.task.setStatus(member.id, command.taskId, command.status, command.expectedVersion, checked.key)
    }
  } catch (error) {
    const knownRejection = (error instanceof TaskError || error instanceof ContractError) && ['INVALID_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CONFLICT'].includes(error.code)
    throw mappedFailure(error, knownRejection && !retry ? 'not_saved' : 'unknown')
  }
  try {
    checkCurrent()
    if (checked.kind === 'taskChange') {
      const result = taskResponse(raw, { memberId: member.id, schoolId: member.schoolId }, checked.task.original.id)
      verifyTaskChangeReceipt(checked.task.command, checked.task.original, result)
      return { kind: checked.kind, key: checked.key, id: result.id, title: result.title, version: result.version, result }
    }
    const result = eventResponse(raw, member.schoolId, [member])
    const draft = checked.command.draft
    if (result.authorMemberId !== member.id || result.version !== 1 || Object.keys(draft).some(field => canonical(result[field as keyof typeof draft]) !== canonical(draft[field as keyof typeof draft]))) {
      throw new ContractError('SAVE_FAILED', '검토한 일정과 저장 결과가 다릅니다. 같은 요청으로 결과를 확인해 주세요.')
    }
    return { kind: checked.kind, key: checked.key, id: result.id, title: result.title, version: result.version, result }
  } catch (error) {
    // 응답 검증 실패도 저장됐을 수 있다. 새 요청 번호로 다시 실행하지 않는다.
    throw mappedFailure(error, 'unknown')
  }
}
