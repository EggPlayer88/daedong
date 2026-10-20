import type { OperationLesson, OperationLessonChange, OperationTeacher } from './operations-contracts'
import { timetableLocalDate } from './operations-calendar'

export const operationChangeKinds = { all: '전체 변경', added: '새 편성', cancelled: '수업 취소', moved: '시각 변경', updated: '그 밖의 변경' } as const
export type OperationChangeFilter = keyof typeof operationChangeKinds
export function operationChangeKind(change: OperationLessonChange): Exclude<OperationChangeFilter, 'all'> {
  if (!change.before) return 'added'
  if (change.after.state === 'cancelled' && change.before.state !== 'cancelled') return 'cancelled'
  if (change.before.time.startsAt !== change.after.time.startsAt || change.before.time.endsAt !== change.after.time.endsAt) return 'moved'
  return 'updated'
}
const words = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').trim().split(/\s+/u).filter(Boolean)
export function operationTeacherLabels(people: OperationTeacher[]): Map<string, string> {
  const unique = [...new Map(people.map(person => [person.id, person])).values()]
  const counts = new Map<string, number>()
  for (const person of unique) counts.set(person.name, (counts.get(person.name) ?? 0) + 1)
  return new Map(unique.map(person => [person.id, person.name + (counts.get(person.name)! > 1 ? ` [${person.id}]` : '')]))
}
function lessonSearch(lesson: OperationLesson, timeZone: string): string {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return [lesson.id, lesson.label, ...lesson.groupNames, ...lesson.roomNames, ...lesson.teachers.flatMap(person => [person.id, person.name]), timetableLocalDate(lesson.time.startsAt, timeZone), timetableLocalDate(lesson.time.endsAt, timeZone), clock.format(new Date(lesson.time.startsAt)), clock.format(new Date(lesson.time.endsAt))].join(' ').normalize('NFKC').toLocaleLowerCase('ko-KR')
}
export function selectOperationLessons(lessons: OperationLesson[], query: string, selectedId: string, timeZone: string) {
  const terms = words(query), matches = terms.length ? lessons.filter(lesson => { const text = lessonSearch(lesson, timeZone); return terms.every(word => text.includes(word)) }) : lessons
  // 검색은 선택·승인 내용을 바꾸지 않는다. 검색 밖의 현재 선택만 별도로 유지한다.
  const selected = lessons.find(lesson => lesson.id === selectedId), pinned = selected && !matches.some(lesson => lesson.id === selected.id) ? selected : undefined
  return { rows: pinned ? [pinned, ...matches] : matches, matches: matches.length, pinned: Boolean(pinned) }
}
export function selectOperationChanges(changes: OperationLessonChange[], filter: OperationChangeFilter, query: string, timeZone: string) {
  const terms = words(query)
  return changes.filter(change => {
    if (filter !== 'all' && operationChangeKind(change) !== filter) return false
    if (!terms.length) return true
    const text = [change.before ? lessonSearch(change.before, timeZone) : '', lessonSearch(change.after, timeZone)].join(' ')
    return terms.every(word => text.includes(word))
  })
}
export function operationChangeSummary(changes: OperationLessonChange[], timeZone: string) {
  const counts = { added: 0, cancelled: 0, moved: 0, updated: 0 }, dates = new Set<string>(), teachers = new Map<string, OperationTeacher>()
  for (const change of changes) {
    counts[operationChangeKind(change)]++
    for (const lesson of [change.before, change.after]) if (lesson) {
      dates.add(timetableLocalDate(lesson.time.startsAt, timeZone))
      for (const person of lesson.teachers) teachers.set(person.id, person)
    }
  }
  return { total: changes.length, counts, dates: [...dates].sort(), teachers: [...teachers.values()] }
}
