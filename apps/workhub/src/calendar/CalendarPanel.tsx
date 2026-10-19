import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import { activeAt, canEdit, homeItems } from '../domain'
import { dateLabel, EventEditor, eventTime, visibilityLabels, type Adapter } from './EventEditor'
import type { RelationOptions } from './contracts'
import { addDays, dateRange, dayLabel, daysInRange, filterCalendarEvents, monthGrid, overlaps, rangeLabel, shiftPeriod, upcomingPreview, type CalendarRelation, type CalendarView } from './presentation'
import calendarStyles from './calendar-views.css?inline'
import homeStyles from './home-dashboard.css?inline'
import type { ResourceOpenRequest } from '../search/contracts'
import { CalendarImport } from './CalendarImport'
import { PendingRequestsProvider, useRecoveryStore, usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
interface CalendarSession { editor?: { original?: CalendarEvent }; importing: boolean; importedCount: number }
interface CalendarBrowseState { search: string; view: CalendarView; anchor: string; relation: CalendarRelation; allDates: boolean }
const Icon = ({ name }: { name: 'arrow' | 'plus' }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={name === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14m-5-5 5 5-5 5'} /></svg>

export function CalendarPanel(props: Parameters<typeof CalendarPanelScope>[0]) {
  const recovery = useRecoveryStore()
  return <PendingRequestsProvider store={recovery}><CalendarPanelScope {...props} /></PendingRequestsProvider>
}

function CalendarPanelScope({ member, members, schoolName, date, adapter, revision, page, onPageChange, relationOptions, demo = false, homeExtras, homeFollowUp, storageLabel, onNavigationLockChange, openRequest, onOpenBatchImport, renderLessonAgenda }: { member: Membership; members: Membership[]; schoolName: string; date: string; adapter: Adapter; revision: number; page: 'home' | 'calendar'; onPageChange: (page: 'home' | 'calendar') => void; relationOptions?: RelationOptions; demo?: boolean; homeExtras?: ReactNode; homeFollowUp?: ReactNode; storageLabel?: string; onNavigationLockChange?: (locked: boolean) => void; openRequest?: ResourceOpenRequest; onOpenBatchImport?: () => void; renderLessonAgenda?: (date: string) => ReactNode }) {
  const recovery = usePendingRequest(member, 'calendar')
  const draft = useEditDraft<CalendarSession>(member, 'calendar-panel')
  const browse = useEditDraft<CalendarBrowseState>(member, 'calendar-browse')
  const [session, setSession] = useState<CalendarSession>(() => draft.initial ?? { importing: false, importedCount: 0 })
  const sessionRef = useRef(session)
  const { editor, importing, importedCount } = session
  // 입력창을 여는 즉시 기록해 연결 오류로 자식이 사라져도 같은 작업으로 돌아온다.
  function updateSession(patch: Partial<CalendarSession>) {
    const next = { ...sessionRef.current, ...patch }
    sessionRef.current = next; setSession(next)
    if (next.editor || next.importing) draft.save(next, false)
    else draft.remove()
  }
  const setEditor = (value: CalendarSession['editor']) => updateSession({ editor: value })
  function discardEditor() {
    // 거부 안내는 현재 창에 남기되 다음 연결에서 과거 원본을 다시 열지 않는다.
    sessionRef.current = { ...sessionRef.current, editor: undefined }
    draft.remove()
  }
  const setImporting = (value: boolean) => updateSession({ importing: value })
  const setImportedCount = (value: number | ((current: number) => number)) => updateSession({ importedCount: typeof value === 'function' ? value(sessionRef.current.importedCount) : value })
  const [editorLocked, setEditorLocked] = useState(false)
  const [importLocked, setImportLocked] = useState(false)
  const navigationLocked = editorLocked || importLocked
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState(browse.initial?.search ?? '')
  const [todayExpanded, setTodayExpanded] = useState(false)
  const [view, setView] = useState<CalendarView>(browse.initial?.view ?? 'list')
  const [anchor, setAnchor] = useState(browse.initial?.anchor ?? date)
  const [relation, setRelation] = useState<CalendarRelation>(browse.initial?.relation ?? 'all')
  const [allDates, setAllDates] = useState(browse.initial?.allDates ?? false)
  const [detail, setDetail] = useState<string>()
  const [message, setMessage] = useState('')
  const listGeneration = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const successMessage = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const monthRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const recoveryMessage = useRef<HTMLElement>(null)
  const focusRecovery = useRef(false)
  // 시간표 등 다른 메뉴에 다녀와도 보던 날짜·필터로 돌아온다. 현재 탭·소속 안에서만 기억하며 미저장 입력으로 세지 않는다.
  useLayoutEffect(() => { browse.save({ search, view, anchor, relation, allDates }, false) }, [browse, search, view, anchor, relation, allDates])
  useLayoutEffect(() => {
    if (focusRecovery.current && !editor && recovery.request && recoveryMessage.current) {
      recoveryMessage.current.focus(); focusRecovery.current = false
    }
  }, [editor, recovery.request])
  const previousPage = useRef(page)
  const openedRequest = useRef('')
  // 저장 뒤 목록을 다시 읽으면 이전 일정 버튼이 사라질 수 있어 완료 안내로 잇는다.
  useEffect(() => { if (message) successMessage.current?.focus() }, [message])
  useEffect(() => {
    if (previousPage.current !== page) setDetail(undefined)
    previousPage.current = page
  }, [page])
  useEffect(() => {
    if (!openRequest || openedRequest.current === openRequest.key || editor || importing || page !== 'calendar') return
    openedRequest.current = openRequest.key
    setDetail(openRequest.id)
    setMessage('')
  }, [openRequest, editor, importing, page])
  useLayoutEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => { onNavigationLockChange?.(false) }
  }, [navigationLocked, onNavigationLockChange])
  useEffect(() => {
    if (!navigationLocked && !recovery.request) return
    const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeLeave)
    return () => window.removeEventListener('beforeunload', beforeLeave)
  }, [navigationLocked, Boolean(recovery.request)])
  useEffect(() => {
    const generation = ++listGeneration.current
    setLoading(true); setError(''); setEvents([])
    adapter.list(member.id).then(result => { if (generation === listGeneration.current) setEvents(result) }).catch(() => { if (generation === listGeneration.current) setError('일정 목록을 불러오지 못했습니다. 일정이 없는 것으로 처리하지 않습니다.') }).finally(() => { if (generation === listGeneration.current) setLoading(false) })
    return () => { listGeneration.current += 1 }
  }, [adapter, member.id, revision, reload])
  const cards = homeItems(events, member, date)
  const upcoming = upcomingPreview(events, member, date, 3)
  const shownToday = todayExpanded ? cards.today : cards.today.slice(0, 3)
  useEffect(() => { setTodayExpanded(false) }, [member.id, date, page])
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
  return <><style>{calendarStyles}{homeStyles}</style><main id="main-content" className={page === 'home' ? 'main-content ui-home-main' : 'main-content'}><header className="page-header"><div><p className="eyebrow">{schoolName} · {dateLabel(date)}{demo && <span className="home-basis-label"> · 합성 기준일</span>}</p><h1 ref={heading} tabIndex={-1}>{page === 'home' ? '오늘' : '학교 일정'}</h1>{page === 'calendar' && <p>학교의 일정을 함께 보고, 필요한 일을 함께 준비해요.</p>}</div><div className="button-row"><button className="primary" disabled={!activeAt(member, date) || Boolean(recovery.request)} onClick={() => { setEditor({}); setMessage('') }}><Icon name="plus" />일정 등록</button>{page === 'calendar' && <button type="button" className="secondary" disabled={!activeAt(member, date) || Boolean(recovery.request) || loading || Boolean(error)} onClick={() => { if (onOpenBatchImport) onOpenBatchImport(); else { setImportedCount(0); setImporting(true); setMessage('') } }}>시트에서 가져오기</button>}</div></header>
    {page === 'calendar' && <div className="basis-strip"><span className="small-tag">{demo ? '합성 기준일' : '한국 시간'}</span><span><strong>{date}</strong> 기준입니다. 종일 일정의 종료일을 포함합니다.</span></div>}
    {recovery.request && !editor && !importing && <section ref={recoveryMessage} tabIndex={-1} className="notice-box" aria-label="보관한 일정 저장 요청"><h2>확인이 필요한 일정 저장이 있습니다</h2><p>이전 요청은 현재 탭에 보관되어 있습니다. 새로 등록하기 전에 같은 요청으로 저장 결과를 확인하세요.</p><button type="button" className="secondary" onClick={() => setEditor({ original: recovery.request?.original })}>보관한 일정 확인</button></section>}
    {message && <div ref={successMessage} className="success-box" role="status" tabIndex={-1}>{message}</div>}
    {page === 'calendar' && <section className="cv-controls" aria-label="일정 보기 설정">
      <div className="cv-toolbar"><div className="cv-switch" role="group" aria-label="일정 보기 방식">{(['list', 'week', 'month'] as const).map(mode => <button type="button" key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{({ list: '목록', week: '주', month: '월' })[mode]}</button>)}</div><div className="cv-period"><h2 id={`${id}-period`} aria-live="polite">{activeRange ? rangeLabel(period, view) : '모든 날짜'}</h2><div className="cv-period-buttons"><button type="button" className="secondary" aria-label={view === 'week' ? '이전 주' : '이전 달'} disabled={!activeRange} onClick={() => move(-1)}>←</button><button type="button" className="secondary" onClick={() => { setAnchor(date); setAllDates(false) }}>오늘로</button><button type="button" className="secondary" aria-label={view === 'week' ? '다음 주' : '다음 달'} disabled={!activeRange} onClick={() => move(1)}>→</button></div></div></div>
      <div className="cv-filters"><label className="search-field" htmlFor={`${id}-search`}>일정 검색<input ref={searchInput} id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="제목·장소·안내 내용 검색" /></label><label htmlFor={`${id}-relation`}>표시할 일정<select aria-label="표시할 일정" id={`${id}-relation`} value={relation} onChange={event => setRelation(event.target.value as CalendarRelation)}><option value="all">열람 가능한 전체</option><option value="related">나와 관련된 일정</option></select></label>{view === 'list' ? <label htmlFor={`${id}-range`}>조회 기간<select aria-label="조회 기간" id={`${id}-range`} value={allDates ? 'all' : 'month'} onChange={event => setAllDates(event.target.value === 'all')}><option value="month">선택한 달</option><option value="all">모든 날짜</option></select></label> : <p className="hint">{view === 'week' ? '월요일부터 일요일까지' : '날짜를 선택하면 아래에 원본 표시'}</p>}</div>
      <div className="cv-filter-summary"><p role="status">{loading ? '일정 확인 중' : error ? '조회 실패 · 건수 확인 안 됨' : `${activeRange ? '선택 기간' : '모든 날짜'} · 원본 ${filtered.length}개`}</p>{(search || relation !== 'all') && <button type="button" className="text-button" onClick={() => { clearFilters(); searchInput.current?.focus() }}>검색·관련 필터 지우기</button>}</div><p className="hint list-hint">관련 여부는 홈 추천 조건입니다. 전체 보기에서도 현재 소속으로 열람 가능한 원본만 표시합니다. 여러 날 일정은 날짜마다 표시되며 원본 개수에는 한 번만 셉니다.</p>
    </section>}
    {page === 'calendar' && renderLessonAgenda?.(anchor)}
    {page === 'home' ? <div className="home-dashboard">
      <section className="home-calendar-section home-today" aria-labelledby={id + '-today'}>
        <div className="section-heading home-calendar-heading"><div><h2 id={id + '-today'}>오늘의 일정</h2>{!loading && !error && <span className="count" aria-label={'오늘 관련 일정 ' + cards.today.length + '개'}>{cards.today.length}</span>}</div><button type="button" className="text-button" onClick={() => { setAllDates(false); setAnchor(date); clearFilters(); changePage('calendar') }}>학교 전체 일정 살펴보기 <Icon name="arrow" /></button></div>
        {loading ? <section className="loading-state" role="status" aria-live="polite"><div className="skeleton" /><div className="skeleton" /><p>현재 소속의 일정을 불러오는 중…</p></section> : error ? <section className="error-state" role="alert"><span className="state-symbol">!</span><h2>일정을 확인할 수 없어요</h2><p>{error}</p><button className="secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></section> : <><div className="event-list" id={id + '-today-list'}>{shownToday.length ? shownToday.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} summary />) : <p className="home-empty">오늘 나와 관련된 일정이 없습니다.</p>}</div>{cards.today.length > 3 && <button type="button" className="text-button cv-home-more" aria-expanded={todayExpanded} aria-controls={id + '-today-list'} onClick={() => setTodayExpanded(value => !value)}>{todayExpanded ? '오늘 일정 접기' : '오늘 일정 ' + cards.today.length + '개 모두 보기'}</button>}</>}
      </section>
      {renderLessonAgenda && <div className="home-timetable-section">{renderLessonAgenda(date)}</div>}
      {homeExtras && <div className="home-work-column">{homeExtras}</div>}
      {homeFollowUp && <div className="home-follow-up">{homeFollowUp}</div>}
      {!loading && !error && <section className="home-calendar-section home-upcoming" aria-labelledby={id + '-upcoming'}>
        <div className="section-heading home-calendar-heading"><div><h2 id={id + '-upcoming'}>다가오는 7일</h2><span className="count">{upcoming.total}</span></div></div><p className="section-description">{dayLabel(upcoming.range.start)} ~ {dayLabel(upcoming.range.end)}</p>
        <div className="event-list">{upcoming.items.length ? upcoming.items.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} compact summary />) : <p className="home-empty">다음 7일에 시작하는 관련 일정이 없습니다.</p>}</div>
        {upcoming.total > upcoming.items.length && <p className="cv-home-count">{upcoming.total}개 중 먼저 {upcoming.items.length}개 표시</p>}<button type="button" className="text-button cv-home-more" onClick={showAllRelated}>전체 관련 일정 보기 <Icon name="arrow" /></button>
      </section>}
    </div> : loading ? <section className="loading-state" role="status" aria-live="polite"><div className="skeleton" /><div className="skeleton" /><p>현재 소속의 일정을 불러오는 중…</p></section> : error ? <section className="error-state" role="alert"><span className="state-symbol">!</span><h2>일정을 확인할 수 없어요</h2><p>{error}</p><button className="secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></section> : <section className="calendar-section cv-results" aria-labelledby={`${id}-period`}>
      {view === 'month' ? <><div className="cv-month"><div className="cv-weekdays" aria-hidden="true">{['월', '화', '수', '목', '금', '토', '일'].map(day => <span key={day}>{day}</span>)}</div><div className="cv-month-grid" ref={monthRef} role="group" aria-label="월간 일정 날짜">{monthGrid(anchor).map(day => {
        const dayEvents = monthEvents.filter(event => overlaps(event, { start: day.date, end: day.date }))
        return <button type="button" key={day.date} className={`cv-month-day${day.inMonth ? '' : ' is-outside'}`} data-calendar-day={day.date} aria-pressed={anchor === day.date} aria-controls={`${id}-day`} tabIndex={anchor === day.date ? 0 : -1} aria-label={`${day.date} ${dayLabel(day.date)}${day.date === date ? ' 오늘' : ''} · 일정 ${dayEvents.length}개`} onClick={() => setAnchor(day.date)} onKeyDown={event => monthKeyboard(event, day.date)}><span className="cv-day-top"><strong>{Number(day.date.slice(8))}</strong>{day.date === date && <span className="cv-today-label">오늘</span>}</span><span className="cv-day-count">{dayEvents.length ? `${dayEvents.length}개` : '없음'}</span>{dayEvents[0] && <span className="cv-day-sample" aria-hidden="true">{dayEvents[0].title}{dayEvents.length > 1 ? ` 외 ${dayEvents.length - 1}` : ''}</span>}</button>
      })}</div><p className="cv-month-keyboard">날짜를 눌러 일정을 확인하세요. 키보드 방향키로 날짜, Page Up/Down으로 달을 이동합니다. 옅은 날짜는 앞뒤 달입니다.</p></div><section className="cv-selected-day" id={`${id}-day`} aria-label="선택 날짜의 일정"><h3>{dayLabel(anchor)} · {selectedEvents.length}개</h3><p className="hint">여러 날 일정은 진행 중인 날짜에도 표시합니다.</p><div className="calendar-list">{selectedEvents.length ? selectedEvents.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} />) : <Empty title="선택한 날짜에 표시할 일정이 없어요" text={search || relation !== 'all' ? '검색·관련 필터를 지우거나 다른 날짜를 선택해 보세요.' : '다른 날짜를 선택하거나 일정을 등록해 보세요.'} />}</div></section></> : view === 'week' ? <div className="cv-week">{daysInRange(period).map(day => { const dayEvents = filtered.filter(event => overlaps(event, { start: day, end: day })); return <section className={`cv-week-day${day === date ? ' is-today' : ''}`} key={day} aria-label={`${day} 일정`}><h3>{dayLabel(day)}{day === date && ' · 오늘'}<span>{dayEvents.length}개</span></h3>{dayEvents.length ? dayEvents.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} compact />) : <p className="cv-no-events">표시할 일정 없음</p>}</section> })}</div> : <div className="calendar-list">{filtered.length ? filtered.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} />) : <Empty title={events.length ? '현재 기간·필터에 맞는 일정이 없어요' : '아직 등록된 일정이 없어요'} text={events.length ? '다른 기간을 선택하거나 검색·관련 필터를 지워 보세요.' : '첫 일정을 등록해 학교와 공유해 보세요.'} />}</div>}
      {filtered.length === 0 && view !== 'month' && <div className="cv-empty-actions">{(search || relation !== 'all') && <button type="button" className="secondary" onClick={() => { clearFilters(); searchInput.current?.focus() }}>필터 지우기</button>}{activeRange && <button type="button" className="secondary" onClick={() => { setView('list'); setAllDates(true); searchInput.current?.focus() }}>모든 날짜에서 찾기</button>}</div>}
    </section>}
    {page === 'home' && <details className="home-display-help"><summary>일정 표시 기준</summary><p>{demo ? '합성 기준일' : '한국 시간'} {date} 기준으로 내 업무·학년·교과와 관련된 일정을 표시합니다. 종일 일정은 종료일까지 포함하며, 진행 중인 일정은 오늘에 표시합니다. 전체 일정에서는 현재 소속으로 열람 가능한 다른 일정도 확인할 수 있습니다.</p></details>}
    <footer className="workspace-footer">{storageLabel ?? (demo ? '합성 자료 · 개발 저장소' : '학교 일정 · 기존 로그인 연결')} <span>업무혁신시스템</span></footer>
  </main>{importing && activeAt(member, date) && <CalendarImport key={`${member.schoolId}:${member.id}:${member.userId}`} member={member} members={members} date={date} adapter={adapter} onNavigationLockChange={setImportLocked} relationOptions={relationOptions} demo={demo} storageLabel={storageLabel} onClose={() => { setImporting(false); if (importedCount) setMessage(`시트에서 확인한 일정 ${importedCount}개를 등록했습니다. 등록한 원본은 학교 일정에서 확인할 수 있습니다.`) }} onSaved={() => { setImportedCount(value => value + 1); setReload(value => value + 1) }} />}{detail && <EventDetail key={detail} id={detail} member={member} date={date} adapter={adapter} editingBlocked={Boolean(recovery.request)} onClose={() => setDetail(undefined)} onEdit={event => { if (recovery.request) return; setDetail(undefined); setEditor({ original: event }) }} />}{editor && <EventEditor relationLabels={relationOptions} demo={demo} storageLabel={storageLabel} original={editor.original} member={member} members={members} date={date} adapter={adapter} onNavigationLockChange={setEditorLocked} onDiscard={discardEditor} onSuspend={() => { focusRecovery.current = true; setEditor(undefined) }} onClose={() => setEditor(undefined)} onSaved={event => { setEditor(undefined); setMessage(`‘${event.title}’ ${event.version === 1 ? '등록' : '수정'} 완료 · 원본 v${event.version}. 관련 일정은 오늘 홈에도 반영됩니다.`); setReload(value => value + 1) }} />}</>
}
function EventCard({ event, reason, onOpen, compact = false, summary = false }: { event: CalendarEvent; reason?: string; onOpen: (id: string) => void; compact?: boolean; summary?: boolean }) {
  const date = new Date(event.startDate + 'T00:00:00Z')
  const time = eventTime(event) + (event.startDate !== event.endDate ? ' · ' + event.startDate.slice(5) + ' ~ ' + event.endDate.slice(5) : '')
  return <button className={'event-card' + (compact ? ' compact' : '') + (summary ? ' home-event-card' : '')} onClick={() => onOpen(event.id)} aria-label={event.title + ' · 원본 v' + event.version + ' 보기'}><span className="date-tile"><small>{date.getUTCMonth() + 1}월</small><strong>{date.getUTCDate()}</strong></span><span className="event-body">
    {summary ? <><strong className="event-title">{event.title}</strong><span className="event-meta">{time}{event.location && ' · ' + event.location}</span>{event.visibility === 'private' && <span className="event-badges"><span className="reason-tag">나만 보는 일정</span></span>}</> : <><span className="event-meta">{time}</span><strong className="event-title">{event.title}</strong><span className="event-location">{event.location || '장소 미지정'}</span><span className="event-badges"><span className="reason-tag">{reason ?? visibilityLabels[event.visibility]}</span><span className="version-tag">원본 v{event.version}</span></span></>}
  </span><span className="card-arrow" aria-hidden="true">↗</span></button>
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span aria-hidden="true">○</span><h3>{title}</h3><p>{text}</p></div> }

function EventDetail({ id, member, date, adapter, onClose, onEdit, editingBlocked = false }: { id: string; member: Membership; date: string; adapter: Adapter; onClose: () => void; onEdit: (event: CalendarEvent) => void; editingBlocked?: boolean }) {
  const [event, setEvent] = useState<CalendarEvent>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; const root = element?.getRootNode(); const previous = (root instanceof ShadowRoot ? root.activeElement : document.activeElement) as HTMLElement | null; element?.showModal(); return () => { element?.close(); if (previous?.isConnected) previous.focus() } }, [])
  useEffect(() => { let active = true; setLoading(true); setEvent(undefined); setError(''); adapter.get(member.id, id).then(result => { if (active) setEvent(result) }).catch(failure => { if (active) setError(failure.message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [adapter, id, member.id, member.active, attempt])
  return <dialog ref={dialog} className="detail-dialog" aria-labelledby="detail-title" onCancel={event => { event.preventDefault(); onClose() }}><header className="dialog-header"><div><p className="eyebrow">학교 일정 · 원본 보기</p><h2 id="detail-title">{event?.title ?? '일정 상세'}</h2></div><button className="icon-button" aria-label="일정 상세 닫기" onClick={onClose}>✕</button></header><div className="dialog-body">{loading ? <p role="status">원본을 불러오는 중…</p> : error ? <div role="alert" className="error-box"><p>{error}</p><button className="secondary" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div> : event && <><div className="detail-tags"><span className="reason-tag">{visibilityLabels[event.visibility]}</span><span className="version-tag">원본 v{event.version}</span></div><dl className="event-detail"><div><dt>일정</dt><dd>{dateLabel(event.startDate)}{event.endDate !== event.startDate ? ` ~ ${dateLabel(event.endDate)}` : ''}<br />{eventTime(event)}</dd></div><div><dt>장소</dt><dd>{event.location || '장소 미지정'}</dd></div><div><dt>안내</dt><dd className="description">{event.description || '등록된 안내가 없습니다.'}</dd></div><div><dt>원본 식별자</dt><dd className="mono">{event.id}</dd></div></dl><p className="subtle-note">학교 일정과 홈은 이 원본을 함께 봅니다. 수정 시 원본 버전이 올라가고 추천 대상도 다시 계산됩니다.</p></>}</div><footer className="dialog-footer">{editingBlocked && <p className="hint">보관한 일정의 저장 결과를 확인한 뒤 수정할 수 있습니다.</p>}<button className="secondary" onClick={onClose}>닫기</button>{event && canEdit(event, member, date) && <button className="primary" disabled={editingBlocked} onClick={() => onEdit(event)}>일정 수정</button>}</footer></dialog>
}
