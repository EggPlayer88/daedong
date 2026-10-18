import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { OperationLesson, OperationsView } from './operations-contracts'
import type { OperationReferenceView } from './operations-next-contracts'
import { OperationLessonLabel } from './OperationChangeList'
import { PublishedTimetableExport } from './PublishedTimetableExport'
import { timetableDateOffset, timetableLocalDate, timetableWeekStart } from './operations-calendar'
import { filterBoardTargets } from './board-targets'
import styles from './operations-board.css?inline'
import usabilityStyles from './published-board-usability.css?inline'
import limits from './operations-next-limits.json'

function distinctLabels(rows: [string, string][]) {
  const counts = new Map<string, number>(); for (const [, name] of rows) counts.set(name, (counts.get(name) ?? 0) + 1)
  return new Map(rows.map(([id, name]) => [id, name + ((counts.get(name) ?? 0) > 1 ? ` [${id}]` : '')]))
}
interface Props {
  view: OperationsView; memberId: string; date: string; initialDate?: string; locked: boolean; references?: OperationReferenceView
  onRequest: (lesson: OperationLesson) => void; onOpenLesson?: (lessonId: string, date: string) => void
  onRangeChange: (from: string, selectedDate: string) => void; initialLessonId?: string
  initialFilter?: { teacher: string; group: string }; onFilterChange?: (filter: { teacher: string; group: string }) => void
  initialMode?: 'week' | 'day'; onModeChange?: (mode: 'week' | 'day') => void
}
export function PublishedTimetableBoard({ view, memberId, date, initialDate, locked, references, onRequest, onOpenLesson, onRangeChange, initialLessonId, initialFilter, onFilterChange, initialMode, onModeChange }: Props) {
  const id = useId(), [teacher, setTeacher] = useState(initialFilter?.teacher ?? memberId), [group, setGroup] = useState(initialFilter?.group ?? ''), [selectedDate, setSelectedDate] = useState(initialDate ?? date)
  const [mode, setMode] = useState<'week' | 'day'>(() => initialMode ?? (typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches ? 'day' : 'week')), [selectedId, setSelectedId] = useState(initialLessonId ?? ''), [limit, setLimit] = useState(30)
  const [teacherQuery, setTeacherQuery] = useState(''), [groupQuery, setGroupQuery] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null), detailRef = useRef<HTMLElement>(null), selectionButton = useRef<HTMLButtonElement | null>(null), focusSelection = useRef(false)
  const weekStart = timetableWeekStart(selectedDate), weekDays = Array.from({ length: 7 }, (_, index) => timetableDateOffset(weekStart, index))
  const teachers = useMemo(() => [...new Map(view.lessons.flatMap(lesson => lesson.teachers.map(teacher => [teacher.id, teacher.name] as const)))].sort((a, b) => a[1].localeCompare(b[1], 'ko', { numeric: true }) || a[0].localeCompare(b[0])), [view])
  const validReferences = references?.asOf === view.asOf && references.from === view.from && references.until === view.until ? references : undefined
  const groups = useMemo(() => [...new Map((validReferences?.lessons ?? []).flatMap(lesson => lesson.groups.map(group => [group.id, group.name] as const)))].sort((a, b) => a[1].localeCompare(b[1], 'ko', { numeric: true }) || a[0].localeCompare(b[0])), [validReferences])
  const teacherLabels = useMemo(() => distinctLabels(teachers), [teachers]), groupLabels = useMemo(() => distinctLabels(groups), [groups])
  const teacherOptions = useMemo(() => filterBoardTargets(teachers.filter(([key]) => key !== memberId), teacherQuery, teacher), [teachers, teacherQuery, teacher, memberId])
  const groupOptions = useMemo(() => filterBoardTargets(groups, groupQuery, group), [groups, groupQuery, group])
  const unresolvedGroup = Boolean(group && (!validReferences || !groups.some(([key]) => key === group)))
  const unresolvedTeacher = Boolean(teacher && teacher !== memberId && !teachers.some(([key]) => key === teacher))
  const unresolvedTarget = unresolvedGroup || unresolvedTeacher
  const referenceMap = useMemo(() => new Map(validReferences?.lessons.map(row => [row.lessonId, row]) ?? []), [validReferences])
  const filtered = useMemo(() => view.lessons.filter(lesson => (!teacher || lesson.teachers.some(item => item.id === teacher)) && (!group || referenceMap.get(lesson.id)?.version === lesson.version && referenceMap.get(lesson.id)!.groups.some(item => item.id === group))).sort((a, b) => a.time.startsAt.localeCompare(b.time.startsAt) || a.id.localeCompare(b.id)), [view, teacher, group, referenceMap])
  const positions = useMemo(() => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: view.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: view.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    return new Map(view.lessons.map(lesson => {
      const parts = day.formatToParts(new Date(lesson.time.startsAt)), date = ['year', 'month', 'day'].map(kind => parts.find(part => part.type === kind)!.value).join('-')
      const endParts = day.formatToParts(new Date(lesson.time.endsAt)), endDate = ['year', 'month', 'day'].map(kind => endParts.find(part => part.type === kind)!.value).join('-')
      const fullStart = clock.format(new Date(lesson.time.startsAt)), fullEnd = clock.format(new Date(lesson.time.endsAt))
      const start = fullStart.replace(/:00$/, ''), end = fullEnd.replace(/:00$/, '')
      return [lesson.id, { date, endDate, start, end, interval: start + '–' + end, order: fullStart + '|' + fullEnd }] as const
    }))
  }, [view])
  const inWeek = filtered.filter(lesson => { const day = positions.get(lesson.id)!.date; return day >= weekStart && day < timetableDateOffset(weekStart, 7) })
  const crowdedWeek = inWeek.length > limits.boardLessons
  const selected = view.lessons.find(lesson => lesson.id === selectedId)
  const selectedOutsideFilter = Boolean(selected && !filtered.some(lesson => lesson.id === selected.id))
  const outsideDay = selectedDate < view.from || selectedDate >= view.until
  const partialWeek = weekStart < view.from || timetableDateOffset(weekStart, 7) > view.until
  const dayLessons = filtered.filter(lesson => positions.get(lesson.id)!.date === selectedDate)
  // 생략한 :00 표시로 정렬하면 09:00:30이 09:00보다 앞선다. 정렬은 원래 초까지 비교한다.
  const intervals = [...new Map(inWeek.map(lesson => { const position = positions.get(lesson.id)!; return [position.interval, position] as const })).values()].sort((a, b) => a.order.localeCompare(b.order) || a.interval.localeCompare(b.interval)).map(position => position.interval)
  const cells = new Map<string, OperationLesson[]>()
  for (const lesson of inWeek) { const position = positions.get(lesson.id)!, key = position.date + '|' + position.interval; if (!cells.has(key)) cells.set(key, []); cells.get(key)!.push(lesson) }
  const weekdays = ['월', '화', '수', '목', '금', '토', '일']
  useEffect(() => { if (initialLessonId) setSelectedId(initialLessonId) }, [initialLessonId])
  useEffect(() => { if (focusSelection.current && selected) { focusSelection.current = false; detailRef.current?.focus() } }, [selectedId, selected])
  useEffect(() => { setLimit(30) }, [selectedDate, teacher, group])
  useEffect(() => { const query = window.matchMedia('(max-width: 650px)'), change = (event: MediaQueryListEvent) => { if (event.matches) { setMode('day'); onModeChange?.('day') } }; query.addEventListener('change', change); return () => query.removeEventListener('change', change) }, [onModeChange])
  function chooseMode(next: 'week' | 'day') { setMode(next); onModeChange?.(next) }
  function chooseTarget(nextTeacher: string, nextGroup: string) { setTeacher(nextTeacher); setGroup(nextGroup); setSelectedId(''); onFilterChange?.({ teacher: nextTeacher, group: nextGroup }) }
  function returnToMine() { setTeacherQuery(''); setGroupQuery(''); chooseTarget(memberId, '') }
  function closeSelection() { setSelectedId(''); focusSelection.current = false; if (selectionButton.current?.isConnected) selectionButton.current.focus(); else headingRef.current?.focus() }
  function changeDate(next: string) {
    try { timetableDateOffset(next, 0) } catch { return }
    setSelectedDate(next); setSelectedId('')
    onRangeChange(timetableWeekStart(next), next)
  }
  function item(lesson: OperationLesson) {
    return <button type="button" key={lesson.id} className={'ttboard-lesson ' + (lesson.state === 'cancelled' ? 'ttboard-cancelled' : '')} aria-pressed={selectedId === lesson.id} aria-controls={selectedId === lesson.id ? id + '-detail' : undefined} onClick={event => { selectionButton.current = event.currentTarget; if (selectedId === lesson.id) { focusSelection.current = false; detailRef.current?.focus() } else { focusSelection.current = true; setSelectedId(lesson.id) } }}>
      <strong>{lesson.label}</strong><span>{lesson.groupNames.join(' · ')}</span><span>{lesson.teachers.map(item => item.name).join(' · ')}</span>
      <small>{positions.get(lesson.id)!.date} {positions.get(lesson.id)!.start}–{positions.get(lesson.id)!.endDate !== positions.get(lesson.id)!.date ? positions.get(lesson.id)!.endDate + ' ' : ''}{positions.get(lesson.id)!.end}</small>
      {lesson.state !== 'scheduled' && <span className="ttboard-status">{lesson.state === 'performed' ? '진행 완료' : '취소'}</span>}
    </button>
  }
  return <section className="ttboard" aria-labelledby={id + '-title'}><style>{styles}{usabilityStyles}</style>
    <div className="ttboard-heading"><div><h3 ref={headingRef} tabIndex={-1} id={id + '-title'}>학교가 확정한 수업</h3><p className="ttops-muted">{group ? groupLabels.get(group) ?? '선택한 학급' : teacher === memberId ? '내 시간표' : teacher ? teacherLabels.get(teacher) ?? '선택한 교사' : '허용된 전체 수업'}</p></div><div className="ttboard-mode" aria-label="시간표 보기 방식"><button type="button" className="secondary" aria-pressed={mode === 'week'} onClick={() => chooseMode('week')}>주간표</button><button type="button" className="secondary" aria-pressed={mode === 'day'} onClick={() => chooseMode('day')}>하루 목록</button></div></div>
    <div className="ttboard-shortcuts">{(teacher !== memberId || group || teacherQuery || groupQuery) && <button type="button" className="secondary" onClick={returnToMine}>내 시간표로 돌아가기</button>}</div>
    <details className="ttboard-filters"><summary>교사·학급·날짜 선택</summary><div className="ttboard-targets">
      <div className="ttboard-target-search"><label>교사 찾기<input type="search" aria-label="교사 찾기" value={teacherQuery} placeholder="이름으로 찾기" onChange={event => setTeacherQuery(event.target.value)} aria-describedby={id + '-teacher-search'} /></label>
        <label>교사로 보기<select aria-label="교사로 보기" value={teacher} onChange={event => chooseTarget(event.target.value, '')}><option value={memberId}>내 시간표</option><option value="">허용된 전체 교사</option>{unresolvedTeacher && <option value={teacher}>선택한 교사 · 현재 조회에서 확인되지 않음</option>}{teacherOptions.rows.map(([key, name]) => <option key={key} value={key}>{teacherLabels.get(key) ?? name}</option>)}</select></label>
        <p id={id + '-teacher-search'} className="ttboard-search-result" role="status">{teacherQuery.trim() ? `다른 교사 검색 결과 ${teacherOptions.matches}명 · 선택은 유지됩니다.` : '현재 조회된 수업의 교사만 표시합니다.'}</p></div>
      <div className="ttboard-target-search"><label>학급 찾기<input type="search" aria-label="학급 찾기" value={groupQuery} placeholder="학년·반으로 찾기" disabled={!validReferences} onChange={event => setGroupQuery(event.target.value)} aria-describedby={id + '-group-search'} /></label>
        <label>학급으로 보기<select aria-label="학급으로 보기" value={group} disabled={!validReferences} onChange={event => chooseTarget('', event.target.value)}><option value="">학급 선택</option>{unresolvedGroup && <option value={group}>선택한 학급 · 연결 재확인</option>}{groupOptions.rows.map(([key, name]) => <option key={key} value={key}>{groupLabels.get(key) ?? name}</option>)}</select></label>
        <p id={id + '-group-search'} className="ttboard-search-result" role="status">{groupQuery.trim() ? `학급 검색 결과 ${groupOptions.matches}개 · 선택은 유지됩니다.` : '같은 이름은 식별 번호로 구분합니다.'}</p></div>
      </div><div className="ttops-form-row ttboard-filter-date"><label>조회 시작일<input aria-label="조회 시작일" type="date" value={selectedDate} disabled={locked} onChange={event => changeDate(event.target.value)} /></label></div>
    {!validReferences && <p className="ttops-muted">학급별 조회는 학급 식별 정보 연결 후 사용할 수 있습니다. 같은 이름의 학급을 임의로 합치지 않습니다.</p>}
    <p className="ttops-muted">{view.timeZone} 기준 실제 시각입니다. 검색만으로 선택한 시간표가 바뀌지 않습니다.</p></details>
    <div className="ttboard-navigation"><button type="button" className="secondary" disabled={locked} onClick={() => changeDate(timetableDateOffset(selectedDate, mode === 'week' ? -7 : -1))}>이전 {mode === 'week' ? '주' : '날'}</button><strong>{mode === 'week' ? weekStart + ' ~ ' + weekDays[6] : selectedDate}</strong><button type="button" className="secondary" disabled={locked} onClick={() => changeDate(timetableDateOffset(selectedDate, mode === 'week' ? 7 : 1))}>다음 {mode === 'week' ? '주' : '날'}</button><button type="button" className="secondary" disabled={locked} onClick={() => changeDate(date)}>오늘</button></div>
    <p className="ttboard-range">불러온 기간 {view.from} ~ {timetableDateOffset(view.until, -1)} · 이 기간에 공유된 수업을 보여 줍니다.</p>
    {unresolvedGroup && <p role="status">선택한 학급의 연결을 다시 확인해야 합니다. 수업이 없는 것으로 판단하지 않습니다.</p>}
    {unresolvedTeacher && <p role="status">선택한 교사는 현재 불러온 수업에서 확인되지 않습니다. 배정이나 공강 여부를 판단하지 않습니다. 교사를 다시 선택하거나 내 시간표로 돌아가 주세요.</p>}
    {!unresolvedTarget && mode === 'week' && partialWeek && <p className="ttboard-selection-note" role="status">이 주의 일부 날짜는 아직 불러오지 않았습니다. 조회 범위 밖의 빈칸은 공강을 뜻하지 않습니다.</p>}
    {!unresolvedTarget && mode === 'week' && crowdedWeek && <p role="status">이 주에 수업 {inWeek.length.toLocaleString('ko-KR')}건이 있습니다. 교사나 학급을 선택하면 한눈에 볼 수 있습니다. 일부 수업만 표시하지 않습니다.</p>}
    {!unresolvedTarget && !crowdedWeek && mode === 'week' && <div className="ttboard-week" role="region" aria-label="주간 시간표" tabIndex={0}><table><caption>{teacher === memberId ? '내 ' : ''}주간 시간표 · 실제 시작·종료 시각</caption><thead><tr><th scope="col">시간</th>{weekDays.map((day, index) => <th key={day} scope="col" className={day === date ? 'ttboard-today' : ''}>{weekdays[index]}<span>{day.slice(5)}</span></th>)}</tr></thead><tbody>{intervals.map(interval => <tr key={interval}><th scope="row">{interval}</th>{weekDays.map(day => <td key={day}>{day < view.from || day >= view.until ? <small>조회 범위 밖</small> : (cells.get(day + '|' + interval) ?? []).map(item)}</td>)}</tr>)}</tbody></table>{!inWeek.length && <p className="ttops-empty">{partialWeek ? '불러온 기간에서 이 주의 수업을 찾지 못했습니다.' : '이 주에 확인할 수 있는 수업이 없습니다.'}</p>}</div>}
    {!unresolvedTarget && mode === 'day' && <div className="ttboard-days"><h4>{selectedDate}{outsideDay ? ' · 조회 범위 밖' : ` 수업 ${dayLessons.length}건`}</h4>{outsideDay ? <p className="ttboard-selection-note" role="status">이 날짜는 아직 불러오지 않았습니다. 수업이 없는 것으로 판단하지 않습니다.</p> : dayLessons.length ? <ol>{dayLessons.slice(0, limit).map(lesson => <li key={lesson.id}>{item(lesson)}</li>)}</ol> : <p className="ttops-empty">이 날짜에 확인할 수 있는 수업이 없습니다.</p>}{dayLessons.length > limit && <button type="button" className="secondary" onClick={() => setLimit(value => value + 30)}>수업 더 보기</button>}</div>}
    {selectedId && !selected && <p className="ttboard-selection-note" role="status">연결한 수업을 현재 조회에서 찾지 못했습니다. 날짜와 조회 기간을 확인해 주세요. 수업이 취소되거나 삭제됐다고 판단하지 않습니다.</p>}
    {selected && <section ref={detailRef} id={id + '-detail'} tabIndex={-1} className="ttboard-detail" aria-labelledby={id + '-detail-title'} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSelection() } }}><div className="ttboard-heading"><h4 id={id + '-detail-title'}>선택한 수업</h4><button type="button" className="secondary" onClick={closeSelection}>수업 상세 닫기</button></div>{selectedOutsideFilter && <p className="ttboard-selection-note">연결해 연 수업입니다. 현재 교사·학급 필터와 관계없이 이 수업의 상세를 표시합니다.</p>}<OperationLessonLabel lesson={selected} timeZone={view.timeZone} /><div className="ttboard-actions"><button type="button" disabled={locked || !view.canRequest || !selected.canRequest || selected.state !== 'scheduled' || Date.parse(selected.time.startsAt) <= Date.now()} onClick={() => onRequest(selected)}>이 수업 변경 요청</button>{onOpenLesson && <button type="button" className="secondary" onClick={() => onOpenLesson(selected.id, timetableLocalDate(selected.time.startsAt, view.timeZone))}>수업 연결 열기</button>}</div></section>}
    <PublishedTimetableExport view={view} references={validReferences} memberId={memberId} teacherId={teacher} groupId={group} date={selectedDate} mode={mode} locked={locked} />
  </section>
}
