import type { OperationLesson, OperationsView } from './operations-contracts'
import { ServiceError } from '../services/scoped-rpc'

/** 시간표 원본을 읽기 전용으로 표시한다. 일반 일정으로 복사하거나 학생 권한을 만들지 않는다. */
export interface TimetableCalendarItem {
  id: string; sourceModule: 'timetable'; lessonId: string; version: number; readOnly: true
  title: string; startDate: string; endDate: string; startTime: string; endTime: string
  startsAt: string; endsAt: string; state: OperationLesson['state']; teacherNames: string[]; groupNames: string[]; location: string
}
export function timetableLocalDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  return ['year', 'month', 'day'].map(kind => parts.find(part => part.type === kind)!.value).join('-')
}
export function timetableClock(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
}
export function timetableDateOffset(date: string, days: number): string {
  const instant = new Date(date + 'T00:00:00.000Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date || !Number.isInteger(days)) throw new ServiceError('INVALID_INPUT')
  instant.setUTCDate(instant.getUTCDate() + days)
  return instant.toISOString().slice(0, 10)
}
export function timetableWeekStart(date: string): string {
  timetableDateOffset(date, 0)
  return timetableDateOffset(date, -((new Date(date + 'T00:00:00.000Z').getUTCDay() + 6) % 7))
}
export function projectTimetableCalendar(view: OperationsView, memberId: string): TimetableCalendarItem[] {
  // 취소 회차도 원본 상태를 보존한다. 소비 화면이 숨길 수 있지만 예정 수업으로 되살리지 않는다.
  return view.lessons.filter(lesson => lesson.teachers.some(teacher => teacher.id === memberId)).map(lesson => ({
    id: 'timetable:' + lesson.id, sourceModule: 'timetable' as const, lessonId: lesson.id, version: lesson.version, readOnly: true as const,
    title: lesson.label, startDate: timetableLocalDate(lesson.time.startsAt, view.timeZone), endDate: timetableLocalDate(lesson.time.endsAt, view.timeZone),
    startTime: timetableClock(lesson.time.startsAt, view.timeZone), endTime: timetableClock(lesson.time.endsAt, view.timeZone), ...lesson.time,
    state: lesson.state, teacherNames: lesson.teachers.map(teacher => teacher.name), groupNames: [...lesson.groupNames], location: lesson.roomNames.join(' · '),
  })).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
}
