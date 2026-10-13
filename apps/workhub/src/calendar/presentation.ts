import type { CalendarEvent, Membership } from '../contracts'
import { canRead, homeItems, recommendationReason } from '../domain'

export type CalendarView = 'list' | 'week' | 'month'
export type CalendarRelation = 'all' | 'related'
export interface DateRange { start: string; end: string }
const weekdays = ['일', '월', '화', '수', '목', '금', '토']

function parse(date: string): Date {
  const value = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error('올바른 기준일이 필요합니다.')
  return value
}
const iso = (date: Date) => date.toISOString().slice(0, 10)

// 시간대·일광절약시간과 관계없이 학교 기준일의 날짜만 계산한다.
export function addDays(date: string, days: number): string {
  const value = parse(date); value.setUTCDate(value.getUTCDate() + days); return iso(value)
}
export function monthRange(date: string): DateRange {
  const value = parse(date); value.setUTCDate(1)
  const start = iso(value); value.setUTCMonth(value.getUTCMonth() + 1); value.setUTCDate(0)
  return { start, end: iso(value) }
}
export function weekRange(date: string): DateRange {
  const start = addDays(date, -((parse(date).getUTCDay() + 6) % 7))
  return { start, end: addDays(start, 6) }
}
export function shiftPeriod(date: string, view: CalendarView, direction: -1 | 1): string {
  if (view === 'week') return addDays(date, direction * 7)
  const value = parse(date), day = value.getUTCDate()
  value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + direction)
  const range = monthRange(iso(value))
  return `${range.start.slice(0, 8)}${String(Math.min(day, Number(range.end.slice(8)))).padStart(2, '0')}`
}
export function dateRange(view: CalendarView, date: string): DateRange { return view === 'week' ? weekRange(date) : monthRange(date) }
export function daysInRange(range: DateRange): string[] {
  const days: string[] = []
  for (let day = range.start; day <= range.end && days.length < 42; day = addDays(day, 1)) days.push(day)
  return days
}
export function monthGrid(date: string): Array<{ date: string; inMonth: boolean }> {
  const range = monthRange(date)
  return daysInRange({ start: weekRange(range.start).start, end: weekRange(range.end).end }).map(day => ({ date: day, inMonth: day >= range.start && day <= range.end }))
}
export function dayLabel(date: string): string { const value = parse(date); return `${value.getUTCMonth() + 1}월 ${value.getUTCDate()}일 (${weekdays[value.getUTCDay()]})` }
export function rangeLabel(range: DateRange, view: CalendarView): string {
  return view === 'week' ? `${dayLabel(range.start)} ~ ${dayLabel(range.end)}` : `${Number(range.start.slice(0, 4))}년 ${Number(range.start.slice(5, 7))}월`
}
export function overlaps(event: CalendarEvent, range: DateRange): boolean {
  // 현재 일정 계약은 종일·시간 지정 모두 종료일을 포함한다. 기간을 가로지르는 일정도 한 원본으로 반환한다.
  return event.startDate <= range.end && event.endDate >= range.start
}
export function filterCalendarEvents(events: CalendarEvent[], member: Membership, today: string, filters: { search: string; relation: CalendarRelation; range?: DateRange }): CalendarEvent[] {
  const search = filters.search.trim().toLocaleLowerCase()
  return (Array.isArray(events) ? events : []).filter(event => canRead(event, member, today)
    && (!filters.range || overlaps(event, filters.range))
    && (filters.relation !== 'related' || recommendationReason(event, member, today) !== null)
    && `${event.title} ${event.location} ${event.description}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || Number(b.allDay) - Number(a.allDay) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id))
}
export function upcomingPreview(events: CalendarEvent[], member: Membership, today: string, limit = 4) {
  const range = { start: addDays(today, 1), end: addDays(today, 7) }
  const upcoming = homeItems(events, member, today).upcoming.filter(({ event }) => overlaps(event, range))
  return { range, total: upcoming.length, items: upcoming.slice(0, Math.max(0, limit)) }
}
