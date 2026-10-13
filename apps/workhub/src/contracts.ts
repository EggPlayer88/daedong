export type Visibility = 'school' | 'audience' | 'private'
export interface School { id: string; name: string }
export interface Membership {
  id: string; schoolId: string; userId: string; name: string
  role: 'teacher' | 'calendar_manager'; active: boolean
  validFrom: string; validThrough: string; departmentIds: string[]; gradeIds: string[]; subjectIds: string[]
}
export interface AudienceGroup { departmentIds: string[]; gradeIds: string[]; subjectIds: string[] }
export interface Audience { all: boolean; groups: AudienceGroup[]; includeMemberIds: string[]; excludeMemberIds: string[] }
export interface EventDraft {
  title: string; description: string; location: string
  startDate: string; endDate: string; allDay: boolean; startTime: string; endTime: string
  visibility: Visibility; audience: Audience
}
export interface CalendarEvent extends EventDraft {
  id: string; schoolId: string; authorMemberId: string; version: number; updatedAt: string
}
export interface PreviewData { schools: School[]; memberships: Membership[]; events: CalendarEvent[]; basisDate: string }
export interface HomeItem { event: CalendarEvent; reason: string }
export interface SaveCommand { draft: EventDraft; id?: string; expectedVersion?: number; idempotencyKey: string }
export type FailureCode = 'INACTIVE_MEMBERSHIP' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'CONFLICT' | 'QUERY_FAILED' | 'SAVE_FAILED' | 'IDEMPOTENCY_CONFLICT' | 'CANCELLED'
export class ContractError extends Error {
  constructor(public code: FailureCode, message: string, public current?: CalendarEvent) { super(message); this.name = 'ContractError' }
}
