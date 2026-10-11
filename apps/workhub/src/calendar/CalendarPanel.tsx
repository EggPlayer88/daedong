import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import { activeAt, canEdit, homeItems } from '../domain'
import { dateLabel, EventEditor, eventTime, visibilityLabels, type Adapter } from './EventEditor'
import type { RelationOptions } from './contracts'
import { addDays, dateRange, dayLabel, daysInRange, filterCalendarEvents, monthGrid, overlaps, rangeLabel, shiftPeriod, upcomingPreview, type CalendarRelation, type CalendarView } from './presentation'
import calendarStyles from './calendar-views.css?inline'
const Icon = ({ name }: { name: 'arrow' | 'plus' }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={name === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14m-5-5 5 5-5 5'} /></svg>

export function CalendarPanel({ member, members, schoolName, date, adapter, revision, page, onPageChange, relationOptions, demo = false, homeExtras, storageLabel, onNavigationLockChange }: { member: Membership; members: Membership[]; schoolName: string; date: string; adapter: Adapter; revision: number; page: 'home' | 'calendar'; onPageChange: (page: 'home' | 'calendar') => void; relationOptions?: RelationOptions; demo?: boolean; homeExtras?: ReactNode; storageLabel?: string; onNavigationLockChange?: (locked: boolean) => void }) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<CalendarView>('list')
  const [anchor, setAnchor] = useState(date)
  const [relation, setRelation] = useState<CalendarRelation>('all')
  const [allDates, setAllDates] = useState(false)
  const [editor, setEditor] = useState<{ original?: CalendarEvent }>()
  const [detail, setDetail] = useState<string>()
  const [message, setMessage] = useState('')
  const listGeneration = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const monthRef = useRef<HTMLDivElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    onNavigationLockChange?.(!!editor)
    return () => { onNavigationLockChange?.(false) }
  }, [!!editor, onNavigationLockChange])
  useEffect(() => {
    if (!editor) return
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeLeave)
    return () => window.removeEventListener('beforeunload', beforeLeave)
  }, [!!editor])
  useEffect(() => {
    const generation = ++listGeneration.current
    setLoading(true); setError(''); setEvents([])
    adapter.list(member.id).then(result => { if (generation === listGeneration.current) setEvents(result) }).catch(() => { if (generation === listGeneration.current) setError('일정 목록을 불러오지 못했습니다. 일정이 없는 것으로 처리하지 않습니다.') }).finally(() => { if (generation === listGeneration.current) setLoading(false) })
    return () => { listGeneration.current += 1 }
  }, [adapter, member.id, revision, reload])
  const cards = homeItems(events, member, date)
  const upcoming = upcomingPreview(events, member, date)
  const period = dateRange(view, anchor)
  const activeRange = view === 'list' && allDates ? undefined : period
  const filtered = filterCalendarEvents(events, member, date, { search, relation, range: activeRange })
  const monthEvents = filterCalendarEvents(events, member, date, { search, relation })
  const selectedEvents = monthEvents.filter(event => overlaps(event, { start: anchor, end: anchor }))
  function changePage(next: 'home' | 'calendar') { onPageChange(next); setMessage(''); requestAnimationFrame(() => heading.current?.focus()) }
  function showAllRelated() { setView('list'); setAllDates(true); setRelation('related'); setSearch(''); changePage('calendar') }
  function clearFilters() { setSearch(''); setRelation('all') }
  function move(direction: -1 | 1) { setAnchor(current => shiftPeriod(current, view, direction)) }
  function monthKeyboard(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    let next: string | undefined
    if (event.key in offsets) next = addDays(day, offsets[event.key])
    if (event.key === 'Home') next = dateRange('week', day).start
    if (event.key === 'End') next = dateRange('week', day).end
    if (event.key === 'PageUp' || event.key === 'PageDown') next = shiftPeriod(day, 'month', event.key === 'PageUp' ? -1 : 1)
    if (!next) return
    event.preventDefault(); setAnchor(next)
    requestAnimationFrame(() => monthRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-day="${next}"]`)?.focus())
  }
  return <><style>{calendarStyles}</style><main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{schoolName} · {dateLabel(date)}</p><h1 ref={heading} tabIndex={-1}>{page === 'home' ? `${member.name.split(' ')[0]} 선생님, 좋은 하루예요.` : '학교 일정'}</h1><p>{page === 'home' ? '내게 필요한 일정부터, 오늘을 차분하게 시작하세요.' : '학교의 일정을 함께 보고, 필요한 일을 함께 준비해요.'}</p></div><button className="primary" disabled={!activeAt(member, date)} onClick={() => { setEditor({}); setMessage('') }}><Icon name="plus" />일정 등록</button></header>
    <div className="basis-strip"><span className="small-tag">{demo ? '합성 기준일' : '한국 시간'}</span><span><strong>{date}</strong> 기준입니다. 종일 일정의 종료일을 포함합니다.</span></div>
    {message && <div className="success-box" role="status">{message}</div>}
    {page === 'home' && homeExtras}
    {page === 'calendar' && <section className="cv-controls" aria-label="일정 보기 설정">
      <div className="cv-toolbar"><div className="cv-switch" role="group" aria-label="일정 보기 방식">{(['list', 'week', 'month'] as const).map(mode => <button type="button" key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{({ list: '목록', week: '주', month: '월' })[mode]}</button>)}</div><div className="cv-period"><h2 id={`${id}-period`} aria-live="polite">{activeRange ? rangeLabel(period, view) : '모든 날짜'}</h2><div className="cv-period-buttons"><button type="button" className="secondary" aria-label={view === 'week' ? '이전 주' : '이전 달'} disabled={!activeRange} onClick={() => move(-1)}>←</button><button type="button" className="secondary" onClick={() => { setAnchor(date); setAllDates(false) }}>오늘로</button><button type="button" className="secondary" aria-label={view === 'week' ? '다음 주' : '다음 달'} disabled={!activeRange} onClick={() => move(1)}>→</button></div></div></div>
      <div className="cv-filters"><label className="search-field" htmlFor={`${id}-search`}>일정 검색<input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="제목·장소·안내 내용 검색" /></label><label htmlFor={`${id}-relation`}>표시할 일정<select aria-label="표시할 일정" id={`${id}-relation`} value={relation} onChange={event => setRelation(event.target.value as CalendarRelation)}><option value="all">열람 가능한 전체</option><option value="related">나와 관련된 일정</option></select></label>{view === 'list' ? <label htmlFor={`${id}-range`}>조회 기간<select aria-label="조회 기간" id={`${id}-range`} value={allDates ? 'all' : 'month'} onChange={event => setAllDates(event.target.value === 'all')}><option value="month">선택한 달</option><option value="all">모든 날짜</option></select></label> : <p className="hint">{view === 'week' ? '월요일부터 일요일까지' : '날짜를 선택하면 아래에 원본 표시'}</p>}</div>
      <div className="cv-filter-summary"><p role="status">{loading ? '일정 확인 중' : error ? '조회 실패 · 건수 확인 안 됨' : `${activeRange ? '선택 기간' : '모든 날짜'} · 원본 ${filtered.length}개`}</p>{(search || relation !== 'all') && <button type="button" className="text-button" onClick={clearFilters}>검색·관련 필터 지우기</button>}</div><p className="hint list-hint">관련 여부는 홈 추천 조건입니다. 전체 보기에서도 현재 소속으로 열람 가능한 원본만 표시합니다. 여러 날 일정은 날짜마다 표시되며 원본 개수에는 한 번만 셉니다.</p>
    </section>}
    {loading ? <section className="loading-state" role="status" aria-live="polite"><div className="skeleton" /><div className="skeleton" /><p>현재 소속의 일정을 불러오는 중…</p></section> : error ? <section className="error-state" role="alert"><span className="state-symbol">!</span><h2>일정을 확인할 수 없어요</h2><p>{error}</p><button className="secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></section> : page === 'home' ? <>
      <div className="overview-grid"><section className="day-summary"><p>오늘 내게 필요한 일정</p><div><strong>{cards.today.length}</strong><span>개의 일정이 있어요</span></div><span className="summary-line">{cards.today.length ? '일정을 누르면 원본과 안내를 확인할 수 있어요.' : '새 일정이 생기면 이곳에서 함께 확인해요.'}</span></section><section className="quiet-card"><span className="sun-mark" aria-hidden="true">◒</span><div><strong>한 번 등록하면, 필요한 곳에.</strong><p>같은 원본이 학교 일정과 나의 오늘에 연결됩니다.</p><button className="text-button" onClick={() => { setAllDates(false); setAnchor(date); clearFilters(); changePage('calendar') }}>학교 전체 일정 살펴보기 <Icon name="arrow" /></button></div></section></div>
      <div className="home-columns"><section><div className="section-heading"><div><span className="section-index">01</span><h2>오늘의 일정</h2></div><span className="count">{cards.today.length}</span></div><p className="section-description">오늘 시작하거나 진행 중인 관련 일정</p><div className="event-list">{cards.today.length ? cards.today.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} />) : <Empty title="오늘 필요한 일정이 없어요" text="학교 전체 일정에서 다른 업무도 살펴볼 수 있어요." />}</div></section><section><div className="section-heading"><div><span className="section-index">02</span><h2>다가오는 7일</h2></div><span className="count">{upcoming.total}</span></div><p className="section-description">내일 {dayLabel(upcoming.range.start)}부터 {dayLabel(upcoming.range.end)}까지 시작하는 관련 일정</p><div className="event-list">{upcoming.items.length ? upcoming.items.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} compact />) : <Empty title="다음 7일에 시작하는 관련 일정이 없어요" text="진행 중인 일정은 오늘의 일정에서 확인하세요." />}</div>{upcoming.total > upcoming.items.length && <p className="cv-home-count">{upcoming.total}개 중 먼저 {upcoming.items.length}개 표시</p>}<button type="button" className="text-button cv-home-more" onClick={showAllRelated}>전체 관련 일정 보기 <Icon name="arrow" /></button></section></div>
    </> : <section className="calendar-section cv-results" aria-labelledby={`${id}-period`}>
      {view === 'month' ? <><div className="cv-month"><div className="cv-weekdays" aria-hidden="true">{['월', '화', '수', '목', '금', '토', '일'].map(day => <span key={day}>{day}</span>)}</div><div className="cv-month-grid" ref={monthRef} role="group" aria-label="월간 일정 날짜">{monthGrid(anchor).map(day => {
        const dayEvents = monthEvents.filter(event => overlaps(event, { start: day.date, end: day.date }))
        return <button type="button" key={day.date} className={`cv-month-day${day.inMonth ? '' : ' is-outside'}`} data-calendar-day={day.date} aria-pressed={anchor === day.date} aria-controls={`${id}-day`} tabIndex={anchor === day.date ? 0 : -1} aria-label={`${day.date} ${dayLabel(day.date)}${day.date === date ? ' 오늘' : ''} · 일정 ${dayEvents.length}개`} onClick={() => setAnchor(day.date)} onKeyDown={event => monthKeyboard(event, day.date)}><span className="cv-day-top"><strong>{Number(day.date.slice(8))}</strong>{day.date === date && <span className="cv-today-label">오늘</span>}</span><span className="cv-day-count">{dayEvents.length ? `${dayEvents.length}개` : '없음'}</span>{dayEvents[0] && <span className="cv-day-sample" aria-hidden="true">{dayEvents[0].title}{dayEvents.length > 1 ? ` 외 ${dayEvents.length - 1}` : ''}</span>}</button>
      })}</div><p className="cv-month-keyboard">날짜를 눌러 일정을 확인하세요. 키보드 방향키로 날짜, Page Up/Down으로 달을 이동합니다. 옅은 날짜는 앞뒤 달입니다.</p></div><section className="cv-selected-day" id={`${id}-day`} aria-label="선택 날짜의 일정"><h3>{dayLabel(anchor)} · {selectedEvents.length}개</h3><p className="hint">여러 날 일정은 진행 중인 날짜에도 표시합니다.</p><div className="calendar-list">{selectedEvents.length ? selectedEvents.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} />) : <Empty title="선택한 날짜에 표시할 일정이 없어요" text={search || relation !== 'all' ? '검색·관련 필터를 지우거나 다른 날짜를 선택해 보세요.' : '다른 날짜를 선택하거나 일정을 등록해 보세요.'} />}</div></section></> : view === 'week' ? <div className="cv-week">{daysInRange(period).map(day => { const dayEvents = filtered.filter(event => overlaps(event, { start: day, end: day })); return <section className={`cv-week-day${day === date ? ' is-today' : ''}`} key={day} aria-label={`${day} 일정`}><h3>{dayLabel(day)}{day === date && ' · 오늘'}<span>{dayEvents.length}개</span></h3>{dayEvents.length ? dayEvents.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} compact />) : <p className="cv-no-events">표시할 일정 없음</p>}</section> })}</div> : <div className="calendar-list">{filtered.length ? filtered.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} />) : <Empty title={events.length ? '현재 기간·필터에 맞는 일정이 없어요' : '아직 등록된 일정이 없어요'} text={events.length ? '다른 기간을 선택하거나 검색·관련 필터를 지워 보세요.' : '첫 일정을 등록해 학교와 공유해 보세요.'} />}</div>}
      {filtered.length === 0 && view !== 'month' && <div className="cv-empty-actions">{(search || relation !== 'all') && <button type="button" className="secondary" onClick={clearFilters}>필터 지우기</button>}{activeRange && <button type="button" className="secondary" onClick={() => { setView('list'); setAllDates(true) }}>모든 날짜에서 찾기</button>}</div>}
    </section>}
    <footer className="workspace-footer">{storageLabel ?? (demo ? '합성 자료 · 개발 저장소' : '학교 일정 · 기존 로그인 연결')} <span>업무혁신시스템</span></footer>
  </main>{detail && <EventDetail key={detail} id={detail} member={member} date={date} adapter={adapter} onClose={() => setDetail(undefined)} onEdit={event => { setDetail(undefined); setEditor({ original: event }) }} />}{editor && <EventEditor relationLabels={relationOptions} demo={demo} storageLabel={storageLabel} original={editor.original} member={member} members={members} date={date} adapter={adapter} onClose={() => setEditor(undefined)} onSaved={event => { setEditor(undefined); setMessage(`‘${event.title}’ ${event.version === 1 ? '등록' : '수정'} 완료 · 원본 v${event.version}. 관련 일정은 오늘 홈에도 반영됩니다.`); setReload(value => value + 1) }} />}</>
}
function EventCard({ event, reason, onOpen, compact = false }: { event: CalendarEvent; reason?: string; onOpen: (id: string) => void; compact?: boolean }) {
  const date = new Date(`${event.startDate}T00:00:00Z`)
  return <button className={`event-card${compact ? ' compact' : ''}`} onClick={() => onOpen(event.id)} aria-label={`${event.title} · 원본 v${event.version} 보기`}><span className="date-tile"><small>{date.getUTCMonth() + 1}월</small><strong>{date.getUTCDate()}</strong></span><span className="event-body"><span className="event-meta">{eventTime(event)}{event.startDate !== event.endDate ? ` · ${event.startDate.slice(5)} ~ ${event.endDate.slice(5)}` : ''}</span><strong className="event-title">{event.title}</strong><span className="event-location">{event.location || '장소 미지정'}</span><span className="event-badges"><span className="reason-tag">{reason ?? visibilityLabels[event.visibility]}</span><span className="version-tag">원본 v{event.version}</span></span></span><span className="card-arrow" aria-hidden="true">↗</span></button>
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span aria-hidden="true">○</span><h3>{title}</h3><p>{text}</p></div> }

function EventDetail({ id, member, date, adapter, onClose, onEdit }: { id: string; member: Membership; date: string; adapter: Adapter; onClose: () => void; onEdit: (event: CalendarEvent) => void }) {
  const [event, setEvent] = useState<CalendarEvent>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const element = dialog.current; element?.showModal(); return () => { element?.close(); if (previous?.isConnected) previous.focus() } }, [])
  useEffect(() => { let active = true; setLoading(true); setEvent(undefined); setError(''); adapter.get(member.id, id).then(result => { if (active) setEvent(result) }).catch(failure => { if (active) setError(failure.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [adapter, id, member.id, member.active, attempt])
  return <dialog ref={dialog} className="detail-dialog" aria-labelledby="detail-title" onCancel={event => { event.preventDefault(); onClose() }}><header className="dialog-header"><div><p className="eyebrow">학교 일정 · 원본 보기</p><h2 id="detail-title">{event?.title ?? '일정 상세'}</h2></div><button className="icon-button" aria-label="일정 상세 닫기" onClick={onClose}>✕</button></header><div className="dialog-body">{loading ? <p role="status">원본을 불러오는 중…</p> : error ? <div role="alert" className="error-box"><p>{error}</p><button className="secondary" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div> : event && <><div className="detail-tags"><span className="reason-tag">{visibilityLabels[event.visibility]}</span><span className="version-tag">원본 v{event.version}</span></div><dl className="event-detail"><div><dt>일정</dt><dd>{dateLabel(event.startDate)}{event.endDate !== event.startDate ? ` ~ ${dateLabel(event.endDate)}` : ''}<br />{eventTime(event)}</dd></div><div><dt>장소</dt><dd>{event.location || '장소 미지정'}</dd></div><div><dt>안내</dt><dd className="description">{event.description || '등록된 안내가 없습니다.'}</dd></div><div><dt>원본 식별자</dt><dd className="mono">{event.id}</dd></div></dl><p className="subtle-note">학교 일정과 홈은 이 원본을 함께 봅니다. 수정 시 원본 버전이 올라가고 추천 대상도 다시 계산됩니다.</p></>}</div><footer className="dialog-footer"><button className="secondary" onClick={onClose}>닫기</button>{event && canEdit(event, member, date) && <button className="primary" onClick={() => onEdit(event)}>일정 수정</button>}</footer></dialog>
}
