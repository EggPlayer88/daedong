import { ContractError, type EventDraft, type Membership } from '../contracts'
import { activeAt } from '../domain'

export interface AssistantCalendarDraftRequest {
  id: string
  schoolId: string
  memberId: string
  draft: EventDraft
}

export interface AssistantCalendarInput {
  title: string
  date: string | null
  startTime: string | null
  endTime: string | null
  allDay: boolean
}

function invalid(message: string): never { throw new ContractError('INVALID_INPUT', message) }
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function safeText(value: unknown, limit: number, multiline = false): value is string {
  return typeof value === 'string' && Array.from(value).length <= limit &&
    !(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF]/u : /[\u0000-\u001F\u007F-\u009F\uD800-\uDFFF]/u).test(value)
}
function partialTime(value: unknown): value is string { return typeof value === 'string' && (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) }

// 대화에서는 공유 대상을 추정하지 않는다. 비어 있는 시간은 기존 일정 편집기에서 직접 채운다.
export function buildAssistantCalendarDraft(input: AssistantCalendarInput, member: Membership, baseDate: string): EventDraft {
  if (!validDate(baseDate) || !activeAt(member, baseDate)) throw new ContractError('INACTIVE_MEMBERSHIP', '현재 학교 소속을 다시 확인해 주세요.')
  if (!input || !safeText(input.title, 100) || !input.title.trim()) invalid('일정 제목을 1~100자로 입력해 주세요.')
  if (!validDate(input.date)) invalid('일정 날짜를 함께 알려 주세요. 예: 내일 오후 3시 회의 일정 초안')
  if (typeof input.allDay !== 'boolean') invalid('종일 일정 여부를 확인해 주세요.')
  if (input.startTime !== null && !partialTime(input.startTime) || input.endTime !== null && !partialTime(input.endTime)) invalid('일정 시작·종료 시간을 확인해 주세요.')
  if (!input.allDay && input.startTime && input.endTime && input.startTime >= input.endTime) invalid('종료 시간은 시작 시간 이후로 입력해 주세요.')
  return {
    title: input.title.trim(), description: '', location: '', startDate: input.date, endDate: input.date,
    allDay: input.allDay, startTime: input.allDay ? '' : input.startTime ?? '', endTime: input.allDay ? '' : input.endTime ?? '',
    visibility: 'private', audience: { all: false, groups: [], includeMemberIds: [member.id], excludeMemberIds: [] },
  }
}

// 편집 화면으로 넘어오는 값도 다시 점검한다. 저장은 기존 편집기·서버의 검증을 거쳐야 한다.
export function validateAssistantCalendarDraftRequest(raw: unknown, member: Membership, date: string): AssistantCalendarDraftRequest {
  if (!validDate(date) || !activeAt(member, date)) throw new ContractError('INACTIVE_MEMBERSHIP', '현재 학교 소속을 다시 확인해 주세요.')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('일정 초안 연결을 다시 시도해 주세요.')
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) invalid('일정 초안 번호를 확인해 주세요.')
  if (value.schoolId !== member.schoolId || value.memberId !== member.id) throw new ContractError('FORBIDDEN', '다른 학교·소속의 일정 초안은 열 수 없습니다.')
  if (!value.draft || typeof value.draft !== 'object' || Array.isArray(value.draft)) invalid('일정 초안 형식을 확인해 주세요.')
  const draft = value.draft as EventDraft
  if (!safeText(draft.title, 100) || !draft.title.trim() || !safeText(draft.description, 2000, true) || !safeText(draft.location, 100)) invalid('일정 초안의 제목·내용을 확인해 주세요.')
  if (!validDate(draft.startDate) || !validDate(draft.endDate) || draft.startDate !== draft.endDate || typeof draft.allDay !== 'boolean' || !partialTime(draft.startTime) || !partialTime(draft.endTime)) invalid('일정 초안의 날짜·시간을 확인해 주세요.')
  if (draft.allDay && (draft.startTime !== '' || draft.endTime !== '') || !draft.allDay && draft.startTime && draft.endTime && draft.startTime >= draft.endTime) invalid('일정 초안의 시작·종료 시간을 확인해 주세요.')
  const audience = draft.audience
  if (draft.visibility !== 'private' || !audience || audience.all !== false || !Array.isArray(audience.groups) || audience.groups.length || !Array.isArray(audience.includeMemberIds) || audience.includeMemberIds.length !== 1 || audience.includeMemberIds[0] !== member.id || !Array.isArray(audience.excludeMemberIds) || audience.excludeMemberIds.length) invalid('대화의 일정 초안은 나만 보기로 시작합니다. 공유는 편집 화면에서 확인해 주세요.')
  return { id: value.id, schoolId: member.schoolId, memberId: member.id, draft: structuredClone(draft) }
}
