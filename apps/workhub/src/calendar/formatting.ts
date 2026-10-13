import type { EventDraft } from '../contracts'

// 일정 카드·검색·편집기가 같은 표시 규칙을 쓰되 React나 저장 상태에는 의존하지 않는다.
export const visibilityLabels = { school: '학교 교사 전체', audience: '관련 대상만', private: '나만 보기' }
export function dateLabel(date: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) }
export function eventTime(event: Pick<EventDraft, 'allDay' | 'startTime' | 'endTime'>) { return event.allDay ? '종일' : `${event.startTime}–${event.endTime}` }
