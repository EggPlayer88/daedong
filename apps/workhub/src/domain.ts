import { ContractError, type Audience, type CalendarEvent, type EventDraft, type HomeItem, type Membership } from './contracts'

export function activeAt(member: Membership, date: string): boolean {
  return member.active && member.validFrom <= date && member.validThrough >= date
}

export function matchesAudience(audience: Audience, member: Membership, date: string): boolean {
  if (!activeAt(member, date) || audience.excludeMemberIds.includes(member.id)) return false
  if (audience.all || audience.includeMemberIds.includes(member.id)) return true
  return audience.groups.some(group => {
    const fields = ['departmentIds', 'gradeIds', 'subjectIds'] as const
    return fields.some(field => group[field].length > 0) && fields.every(field =>
      group[field].length === 0 || group[field].some(value => member[field].includes(value)))
  })
}

export function canRead(event: CalendarEvent, member: Membership, today: string): boolean {
  if (event.schoolId !== member.schoolId || !activeAt(member, today)) return false
  if (event.authorMemberId === member.id) return true
  if (event.visibility === 'private') return false
  return event.visibility === 'school' || matchesAudience(event.audience, member, today)
}

export function canEdit(event: CalendarEvent, member: Membership, today: string): boolean {
  return canRead(event, member, today) && (event.authorMemberId === member.id || (member.role === 'calendar_manager' && event.visibility !== 'private'))
}

export function recommendationReason(event: CalendarEvent, member: Membership, today: string): string | null {
  if (event.authorMemberId === member.id) return '내가 등록한 일정'
  if (!matchesAudience(event.audience, member, event.startDate > today ? event.startDate : today)) return null
  if (event.audience.all) return '모든 교사에게 해당'
  if (event.audience.includeMemberIds.includes(member.id)) return '관련 대상에 직접 포함'
  return '내 업무·학년·교과에 해당'
}

export function homeItems(events: CalendarEvent[], member: Membership, today: string): { today: HomeItem[]; upcoming: HomeItem[] } {
  const relevant = events.filter(event => canRead(event, member, today) && event.endDate >= today)
    .map(event => ({ event, reason: recommendationReason(event, member, today) }))
    .filter((item): item is HomeItem => item.reason !== null)
    .sort((a, b) => a.event.startDate.localeCompare(b.event.startDate) || a.event.startTime.localeCompare(b.event.startTime) || a.event.id.localeCompare(b.event.id))
  return { today: relevant.filter(({ event }) => event.startDate <= today), upcoming: relevant.filter(({ event }) => event.startDate > today) }
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export function normalizeDraft(draft: EventDraft, member: Membership, members: Membership[]): EventDraft {
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
  const audience = draft?.audience
  if (!draft || typeof draft !== 'object' || ['title', 'description', 'location', 'startDate', 'endDate', 'startTime', 'endTime', 'visibility'].some(field => typeof (draft as unknown as Record<string, unknown>)[field] !== 'string') || typeof draft.allDay !== 'boolean' || !audience || typeof audience !== 'object' || typeof audience.all !== 'boolean' || !Array.isArray(audience.groups) || !strings(audience.includeMemberIds) || !strings(audience.excludeMemberIds) || audience.groups.some(group => !group || typeof group !== 'object' || !strings(group.departmentIds) || !strings(group.gradeIds) || !strings(group.subjectIds))) {
    throw new ContractError('INVALID_INPUT', '입력 형식이 올바르지 않습니다. 필수 항목과 관련 대상 조건을 확인해 주세요.')
  }
  if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.trim().length > 100) throw new ContractError('INVALID_INPUT', '제목은 1~100자로 입력해 주세요.')
  if (!validDate(draft.startDate) || !validDate(draft.endDate) || draft.startDate > draft.endDate) throw new ContractError('INVALID_INPUT', '종료일은 시작일 이후여야 합니다.')
  if (!draft.allDay && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime) || (draft.startDate === draft.endDate && draft.startTime >= draft.endTime))) throw new ContractError('INVALID_INPUT', '시작·종료 시간을 확인해 주세요.')
  if (!['school', 'audience', 'private'].includes(draft.visibility)) throw new ContractError('INVALID_INPUT', '열람 범위를 선택해 주세요.')
  if (draft.description.length > 2000 || draft.location.length > 100) throw new ContractError('INVALID_INPUT', '설명은 2,000자, 장소는 100자까지 입력할 수 있습니다.')
  const permitted = new Set(members.filter(item => item.schoolId === member.schoolId).map(item => item.id))
  if ([...draft.audience.includeMemberIds, ...draft.audience.excludeMemberIds].some(id => !permitted.has(id))) throw new ContractError('INVALID_INPUT', '다른 학교의 교사를 관련 대상으로 지정할 수 없습니다.')
  if (!draft.audience.all && !draft.audience.groups.some(group => group.departmentIds.length + group.gradeIds.length + group.subjectIds.length > 0) && !draft.audience.includeMemberIds.length && draft.visibility !== 'private') throw new ContractError('INVALID_INPUT', '관련 대상 조건 또는 직접 포함할 교사를 선택해 주세요.')
  return { ...structuredClone(draft), title: draft.title.trim(), description: draft.description.trim(), location: draft.location.trim(), startTime: draft.allDay ? '' : draft.startTime, endTime: draft.allDay ? '' : draft.endTime }
}
