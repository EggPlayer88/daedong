import type { OperationLesson, OperationLessonChange } from './operations-contracts'
import { useId, useState } from 'react'

export function operationDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  return ['year', 'month', 'day'].map(kind => parts.find(part => part.type === kind)?.value).join('-')
}
export function operationClock(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
}
export function dateOffset(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return ''
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const stateLabel = { scheduled: '예정', performed: '진행 완료', cancelled: '취소' }
export function OperationLessonLabel({ lesson, timeZone }: { lesson: OperationLesson; timeZone: string }) {
  const first = operationDate(lesson.time.startsAt, timeZone), last = operationDate(lesson.time.endsAt, timeZone)
  return <div className="ttops-lesson">
    <strong>{lesson.label}</strong>
    <p><time dateTime={lesson.time.startsAt}>{first} {operationClock(lesson.time.startsAt, timeZone)}</time>–<time dateTime={lesson.time.endsAt}>{last !== first ? `${last} ` : ''}{operationClock(lesson.time.endsAt, timeZone)}</time></p>
    <p>{lesson.teachers.map(row => row.name).join(' · ') || '교사 표시 없음'} / {lesson.groupNames.join(' · ') || '학급 표시 없음'}</p>
    {lesson.roomNames.length > 0 && <p>{lesson.roomNames.join(' · ')}</p>}
    <small>{stateLabel[lesson.state]} · {lesson.version}판</small>
  </div>
}
export function OperationChangeList({ changes, timeZone }: { changes: OperationLessonChange[]; timeZone: string }) {
  const id = useId(), [limit, setLimit] = useState(20)
  if (!changes.length) return <p className="ttops-muted">바뀌는 수업이 없습니다.</p>
  return <div>
    <p className="ttops-muted" id={id}>변경 수업 {changes.length}건 · {timeZone} 기준 실제 시각</p>
    <ol className="ttops-changes" aria-describedby={id}>
      {changes.slice(0, limit).map((change, index) => <li key={`${change.after.id}-${index}`}>
        <div><span className="ttops-eyebrow">변경 전</span>{change.before ? <OperationLessonLabel lesson={change.before} timeZone={timeZone} /> : <p>새로 편성하는 수업</p>}</div>
        <div><span className="ttops-eyebrow">변경 후</span><OperationLessonLabel lesson={change.after} timeZone={timeZone} /></div>
      </li>)}
    </ol>
    {changes.length > limit && <button type="button" className="secondary" onClick={() => setLimit(value => value + 20)}>변경 수업 20건 더 보기 ({limit}/{changes.length})</button>}
  </div>
}
