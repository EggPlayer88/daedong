import { isoDate } from '../services/service-values'
import type { Published } from './published'

// 날짜별 실시 기록을 만들지 않는다. 계정에 연결된 기본 배치만 참고 자료로 투영한다.
export function personalRosterDay(data: Published) {
  isoDate(data.date)
  const day = new Date(`${data.date}T12:00:00Z`).getUTCDay() || 7
  if (!data.available) return []
  return data.plans.filter(p => p.from <= data.date && data.date < p.until).flatMap(p => {
    const courses = new Map(p.courses.map(c => [c.id, c])), slots = new Map(p.slots.map(s => [s.id, s]))
    return p.lessons.flatMap(l => {
      const c = courses.get(l.courseId)!, s = slots.get(l.slotId)!
      if (s.day !== day || !data.myTeacherIds.includes(c.teacherId)) return []
      return [{ id: `${p.id}:${l.id}`, planId: p.id, date: data.date, subject: c.subject, className: p.classes.find(x => x.id === c.classId)!.name, period: s.period, start: s.start, end: s.end }]
    })
  }).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
}
