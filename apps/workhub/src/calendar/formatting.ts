import type { EventDraft } from '../contracts'

// 일정 카드·검색·편집기가 같은 표시 규칙을 쓰되 React나 저장 상태에는 의존하지 않는다.
export const visibilityLabels = { school: '학교 교사 전체', audience: '관련 대상만', private: '나만 보기' }
export function dateLabel(date: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) }
export function eventTime(event: Pick<EventDraft, 'allDay' | 'startTime' | 'endTime'>) { return event.allDay ? '종일' : `${event.startTime}–${event.endTime}` }

// 여러 날 일정은 하나의 시작·종료 구간이다. 매일 같은 시간에 반복되는 일정으로 표시하지 않는다.
export function eventTiming(event: Pick<EventDraft, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>, shownDate?: string) {
  const multipleDays = event.startDate !== event.endDate
  const description = multipleDays
    ? event.allDay ? `${event.startDate} ~ ${event.endDate} · 종일` : `${event.startDate} ${event.startTime} 시작 · ${event.endDate} ${event.endTime} 종료`
    : eventTime(event)
  if (event.allDay) return { primary: '종일', secondary: '', description }
  if (!multipleDays) return { primary: event.startTime, secondary: event.endTime, description }
  if (shownDate === event.startDate) return { primary: event.startTime, secondary: '시작', description }
  if (shownDate === event.endDate) return { primary: event.endTime, secondary: '종료', description }
  return { primary: '진행', secondary: '중', description }
}
