import { useId, useMemo } from 'react'
import type { TimetableBasis, Placement } from './contracts'
const days=['월','화','수','목','금','토','일']
const timetableClock=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`
export function TimetableBoard({ basis, placements, filterResourceId = '', selectedLessonId = '', disabled = false, onSelect }: { basis: TimetableBasis; placements: Placement[]; filterResourceId?: string; selectedLessonId?: string; disabled?: boolean; onSelect: (lessonId: string) => void }) {
  const id = useId()
  const prepared = useMemo(() => {
    const lessons = new Map(basis.lessons.map(lesson => [lesson.id, lesson])), resources = new Map(basis.resources.map(resource => [resource.id, resource.label]))
    const visibleLessons = new Set(basis.lessons.filter(lesson => !filterResourceId || lesson.resourceIds.includes(filterResourceId)).map(lesson => lesson.id))
    const visibleSlots = new Set(basis.lessons.filter(lesson => visibleLessons.has(lesson.id)).flatMap(lesson => lesson.allowedSlotIds))
    const slots = new Map(basis.slots.filter(slot => visibleSlots.has(slot.id)).map(slot => [slot.id, slot]))
    const rowKey = (slot: TimetableBasis['slots'][number]) => `${slot.startMinute}-${slot.endMinute}-${slot.label}`
    const rows = [...new Map([...slots.values()].map(slot => [rowKey(slot), slot])).values()].sort((a,b) => a.startMinute-b.startMinute || a.endMinute-b.endMinute || a.label.localeCompare(b.label))
    const presentDays = [...new Set([...slots.values()].map(slot => slot.day))].sort((a,b) => a-b)
    const cells = new Map<string, {lesson:TimetableBasis['lessons'][number];slot:TimetableBasis['slots'][number]}[]>()
    for (const placement of placements) {
      const lesson=lessons.get(placement.lessonId),slot=slots.get(placement.slotId)
      if (!lesson || !slot || !visibleLessons.has(lesson.id)) continue
      const key=`${slot.day}:${rowKey(slot)}`,items=cells.get(key)??[];items.push({lesson,slot});cells.set(key,items)
    }
    return {rows,presentDays,cells,resources,rowKey}
  }, [basis, placements, filterResourceId])
  return <div className="timetable-board" role="region" aria-labelledby={`${id}-caption`} tabIndex={0}><p className="timetable-scroll-help">표를 좌우로 밀어 다른 요일을 확인하세요.</p><table><caption id={`${id}-caption`}>편성 초안 · 수업을 누르면 이동할 시간을 선택할 수 있습니다</caption><thead><tr><th scope="col">시간</th>{prepared.presentDays.map(day => <th scope="col" key={day}>{days[day-1]}요일</th>)}</tr></thead><tbody>{prepared.rows.map(row => <tr key={prepared.rowKey(row)}><th scope="row">{row.label}<br />{timetableClock(row.startMinute)}–{timetableClock(row.endMinute)}</th>{prepared.presentDays.map(day => <td key={day}>{(prepared.cells.get(`${day}:${prepared.rowKey(row)}`)??[]).map(({lesson,slot}) => <button key={lesson.id} type="button" className="timetable-lesson" aria-pressed={selectedLessonId===lesson.id} disabled={disabled} aria-label={`${lesson.label} · ${days[slot.day-1]} ${slot.label} · ${timetableClock(slot.startMinute)}–${timetableClock(slot.endMinute)} · 이동할 수업 선택`} onClick={() => onSelect(lesson.id)}><span>{lesson.label}</span><small>{lesson.resourceIds.map(resourceId => prepared.resources.get(resourceId)).filter(Boolean).join(' · ')}</small></button>)}</td>)}</tr>)}</tbody></table></div>
}
