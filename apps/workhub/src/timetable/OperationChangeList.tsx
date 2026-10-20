import type { OperationLesson, OperationLessonChange } from './operations-contracts'
import { useId, useMemo, useState } from 'react'
import { operationChangeKinds, operationChangeKind, operationChangeSummary, operationTeacherLabels, selectOperationChanges, type OperationChangeFilter } from './operation-review'
import reviewStyles from './operation-review.css?inline'

export function operationDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  return ['year', 'month', 'day'].map(kind => parts.find(part => part.type === kind)?.value).join('-')
}
export function operationClock(instant: string, timeZone: string): string {
  // 분 단위 수업은 간결하게, 실제 초가 있는 수업은 상세·변경 비교에서도 그대로 보여 준다.
  return new Intl.DateTimeFormat('ko-KR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(instant)).replace(/:00$/, '')
}
export function dateOffset(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return ''
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const stateLabel = { scheduled: '예정', performed: '진행 완료', cancelled: '취소' }
export function OperationLessonLabel({ lesson, timeZone, teacherLabels }: { lesson: OperationLesson; timeZone: string; teacherLabels?: Map<string, string> }) {
  const first = operationDate(lesson.time.startsAt, timeZone), last = operationDate(lesson.time.endsAt, timeZone)
  return <div className="ttops-lesson">
    <strong>{lesson.label}</strong>
    <p><time dateTime={lesson.time.startsAt}>{first} {operationClock(lesson.time.startsAt, timeZone)}</time>–<time dateTime={lesson.time.endsAt}>{last !== first ? `${last} ` : ''}{operationClock(lesson.time.endsAt, timeZone)}</time></p>
    <p>{lesson.teachers.map(row => teacherLabels?.get(row.id) ?? row.name).join(' · ') || '교사 표시 없음'} / {lesson.groupNames.join(' · ') || '학급 표시 없음'}</p>
    {lesson.roomNames.length > 0 && <p>{lesson.roomNames.join(' · ')}</p>}
    <small>{stateLabel[lesson.state]} · {lesson.version}판</small>
  </div>
}
export function OperationChangeList({ changes, timeZone }: { changes: OperationLessonChange[]; timeZone: string }) {
  const id = useId(), [limit, setLimit] = useState(20), [query, setQuery] = useState(''), [filter, setFilter] = useState<OperationChangeFilter>('all')
  const summary = useMemo(() => operationChangeSummary(changes, timeZone), [changes, timeZone])
  const labels = useMemo(() => operationTeacherLabels(summary.teachers), [summary])
  const shown = useMemo(() => selectOperationChanges(changes, filter, query, timeZone), [changes, filter, query, timeZone])
  if (!changes.length) return <p className="ttops-muted">바뀌는 수업이 없습니다.</p>
  function reset() { setQuery(''); setFilter('all'); setLimit(20) }
  return <div className="ttops-review"><style>{reviewStyles}</style>
    <p className="ttops-muted" id={id}>변경 수업 {changes.length}건 · {timeZone} 기준 실제 시각</p>
    <div className="ttops-review-summary" aria-label="변경 목록 요약"><span>이 목록 {summary.total}건</span>{Object.entries(summary.counts).filter(([, count]) => count > 0).map(([kind, count]) => <span key={kind}>{operationChangeKinds[kind as OperationChangeFilter]} {count}건</span>)}<span>표시된 교사 {summary.teachers.length}명</span><span>수업 시작일 {summary.dates.length}일{summary.dates.length > 0 ? ` · ${summary.dates[0]}${summary.dates.length > 1 ? ' ~ ' + summary.dates.at(-1) : ''}` : ''}</span></div>
    {(changes.length > 2 || query || filter !== 'all') && <details><summary>이 목록에서 변경 수업 찾기</summary><div className="ttops-review-search"><label htmlFor={id + '-filter'}>변경 종류<select aria-label="변경 종류" id={id + '-filter'} value={filter} onChange={event => { setFilter(event.target.value as OperationChangeFilter); setLimit(20) }}>{Object.entries(operationChangeKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label htmlFor={id + '-search'}>변경 수업 검색<input aria-label="변경 수업 검색" id={id + '-search'} type="search" value={query} placeholder="교사·학급·수업·날짜·식별 번호" onChange={event => { setQuery(event.target.value); setLimit(20) }} /></label></div><p className="ttops-muted">검색은 표시만 바꿉니다. 최종 확인과 반영 대상은 원래 전체 변경입니다. 분할 조회에서는 현재 상세 쪽만 검색합니다.</p>{(query || filter !== 'all') && <button type="button" className="secondary" onClick={reset}>변경 목록 검색 초기화</button>}</details>}
    <p className="ttops-review-result" role="status">검색 결과 {shown.length}건 · 현재 {Math.min(shown.length, limit)}건 표시 / 이 목록 전체 {changes.length}건</p>
    {!shown.length && <p className="ttops-muted">조건에 맞는 변경 수업이 없습니다. 검색을 초기화해 전체 변경을 확인해 주세요.</p>}
    <ol className="ttops-changes" aria-describedby={id}>
      {shown.slice(0, limit).map((change, index) => <li key={`${change.after.id}-${index}`}>
        <div><span className="ttops-eyebrow">변경 전</span>{change.before ? <OperationLessonLabel lesson={change.before} timeZone={timeZone} teacherLabels={labels} /> : <p>새로 편성하는 수업</p>}</div>
        <div><span className="ttops-eyebrow">변경 후 · {operationChangeKinds[operationChangeKind(change)]}</span><OperationLessonLabel lesson={change.after} timeZone={timeZone} teacherLabels={labels} /><small className="ttops-change-id">수업 식별 번호 {change.after.id}</small></div>
      </li>)}
    </ol>
    {shown.length > limit && <button type="button" className="secondary" onClick={() => setLimit(value => value + 20)}>변경 수업 20건 더 보기 ({limit}/{shown.length})</button>}
  </div>
}
