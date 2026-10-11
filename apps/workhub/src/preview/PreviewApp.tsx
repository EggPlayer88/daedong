import { useEffect, useRef, useState } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import { activeAt, canEdit, homeItems } from '../domain'
import { fixtureData } from './fixtures'
import { createMemoryAdapter } from './memory-adapter'
import { dateLabel, EventEditor, eventTime, visibilityLabels, type Adapter } from './EventEditor'

const adapter = createMemoryAdapter(fixtureData)
const Icon = ({ name }: { name: 'home' | 'calendar' | 'arrow' | 'plus' }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{name === 'home' ? <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></> : name === 'calendar' ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2" /></> : name === 'arrow' ? <path d="M5 12h14m-5-5 5 5-5 5" /> : <path d="M12 5v14M5 12h14" />}</svg>

export function PreviewApp() {
  const [info, setInfo] = useState(adapter.info)
  const [memberId, setMemberId] = useState(info.memberships[0].id)
  const [revision, setRevision] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const [empty, setEmpty] = useState(false)
  const member = info.memberships.find(item => item.id === memberId)!
  const school = info.schools.find(item => item.id === member.schoolId)!
  function reloadInfo() { setInfo(adapter.info()); setRevision(value => value + 1) }
  return <><a className="skip-link" href="#main-content">본문으로 건너뛰기</a><div className="preview-banner"><strong>로컬 개발 미리보기</strong><span>모두 합성 자료입니다 · 새로고침 시 초기화 · 실제 서비스 연결 없음</span></div><div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">學</span><div><strong>하루를 잇는 학교</strong><span>업무혁신시스템</span></div></div><div className="school-tag"><span className="status-dot" />{school.name}<span className="small-tag">가상</span></div>
      <div className="sidebar-intro"><p>오늘의 일을 가볍게,<br /><strong>함께하는 일을 선명하게.</strong></p></div>
      <div className="sidebar-bottom"><span className="avatar">{member.name[0]}</span><div><strong>{member.name} 선생님</strong><small>{member.role === 'calendar_manager' ? '가상 일정 담당자' : '가상 교사'}{!member.active ? ' · 소속 종료' : ''}</small></div></div>
    </aside>
    <div className="workspace-wrap"><Workspace key={`${memberId}:${resetKey}`} member={member} members={info.memberships} schoolName={school.name} date={info.basisDate} adapter={adapter} revision={revision} />
      <details className="developer-panel"><summary>개발 시험 도구 <span>학교·계정 전환 / 실패 상황</span></summary><p>아래 선택은 개발용 계약 시뮬레이션입니다. 실제 로그인·권한 검증을 구현한 것이 아닙니다.</p><div className="developer-grid"><label>가상 학교<select value={member.schoolId} onChange={event => { const next = info.memberships.find(item => item.schoolId === event.target.value && item.userId === member.userId) ?? info.memberships.find(item => item.schoolId === event.target.value)!; setMemberId(next.id) }} >{info.schools.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>가상 소속 계정<select value={memberId} onChange={event => setMemberId(event.target.value)}>{info.memberships.filter(item => item.schoolId === member.schoolId).map(item => <option value={item.id} key={item.id}>{item.name} · {item.role === 'calendar_manager' ? '일정 담당' : '교사'}{!item.active ? ' (종료)' : ''}</option>)}</select></label></div><div className="button-row"><button className="secondary small" onClick={() => { adapter.failNextQuery(); setRevision(value => value + 1) }}>다음 조회 실패</button><button className="secondary small" onClick={() => { adapter.failNextSave(); setRevision(value => value + 1) }}>다음 저장 실패</button><button className="secondary small" aria-pressed={empty} onClick={() => { adapter.setEmpty(!empty); setEmpty(!empty); setRevision(value => value + 1) }}>{empty ? '자료 다시 표시' : '빈 목록 시험'}</button><button className="secondary small" disabled={!member.active} onClick={() => { adapter.endMembership(member.id); reloadInfo() }}>현재 소속 종료</button><button className="secondary small" onClick={() => { adapter.reset(); setEmpty(false); setInfo(adapter.info()); setResetKey(value => value + 1); setRevision(value => value + 1) }}>합성 자료 초기화</button></div><p className="hint">초기화·학교/계정 전환은 열린 편집 창을 닫습니다. 저장 중 응답은 이전 화면으로 돌아오지 않습니다. 일반 빌드에서는 이 도구와 업무 화면이 제외됩니다.</p></details>
    </div>
  </div></>
}

function Workspace({ member, members, schoolName, date, adapter, revision }: { member: Membership; members: Membership[]; schoolName: string; date: string; adapter: Adapter; revision: number }) {
  const [page, setPage] = useState<'home' | 'calendar'>('home')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ original?: CalendarEvent }>()
  const [detail, setDetail] = useState<string>()
  const [message, setMessage] = useState('')
  const listGeneration = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const generation = ++listGeneration.current
    setLoading(true); setError(''); setEvents([])
    adapter.list(member.id).then(result => { if (generation === listGeneration.current) setEvents(result) }).catch(failure => { if (generation === listGeneration.current) setError(failure.message) }).finally(() => { if (generation === listGeneration.current) setLoading(false) })
    return () => { listGeneration.current += 1 }
  }, [adapter, member.id, revision, reload])
  const cards = homeItems(events, member, date)
  const filtered = events.filter(event => `${event.title} ${event.location} ${event.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime))
  function changePage(next: 'home' | 'calendar') { setPage(next); setMessage(''); requestAnimationFrame(() => heading.current?.focus()) }
  return <><nav className="main-nav" aria-label="업무 메뉴"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => changePage('home')}><Icon name="home" /><span>오늘</span></button><button aria-current={page === 'calendar' ? 'page' : undefined} onClick={() => changePage('calendar')}><Icon name="calendar" /><span>학교 일정</span></button><span className="nav-note">첫 업무 흐름을 검증하고 있어요</span></nav><main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{schoolName} · {dateLabel(date)}</p><h1 ref={heading} tabIndex={-1}>{page === 'home' ? `${member.name.split(' ')[0]} 선생님, 좋은 하루예요.` : '학교 일정'}</h1><p>{page === 'home' ? '내게 필요한 일정부터, 오늘을 차분하게 시작하세요.' : '학교의 일정을 함께 보고, 필요한 일을 함께 준비해요.'}</p></div><button className="primary" disabled={!activeAt(member, date)} onClick={() => { setEditor({}); setMessage('') }}><Icon name="plus" />일정 등록</button></header>
      <div className="basis-strip"><span className="small-tag">기준일 안내</span><span>‘오늘’은 <strong>{date} (한국 시간)</strong>인 가상 시나리오입니다. 종일 일정의 종료일을 포함합니다.</span></div>
      {message && <div className="success-box" role="status">{message}</div>}
      {loading ? <section className="loading-state" role="status" aria-live="polite"><div className="skeleton" /><div className="skeleton" /><p>현재 소속의 일정을 불러오는 중…</p></section> : error ? <section className="error-state" role="alert"><span className="state-symbol">!</span><h2>일정을 확인할 수 없어요</h2><p>{error}</p><button className="secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></section> : page === 'home' ? <>
        <div className="overview-grid"><section className="day-summary"><p>오늘 내게 필요한 일정</p><div><strong>{cards.today.length}</strong><span>개의 일정이 있어요</span></div><span className="summary-line">{cards.today.length ? '일정을 누르면 원본과 안내를 확인할 수 있어요.' : '새 일정이 생기면 이곳에서 함께 확인해요.'}</span></section><section className="quiet-card"><span className="sun-mark" aria-hidden="true">◒</span><div><strong>한 번 등록하면, 필요한 곳에.</strong><p>같은 원본이 학교 일정과 나의 오늘에 연결됩니다.</p><button className="text-button" onClick={() => changePage('calendar')}>학교 전체 일정 살펴보기 <Icon name="arrow" /></button></div></section></div>
        <div className="home-columns"><section><div className="section-heading"><div><span className="section-index">01</span><h2>오늘의 일정</h2></div><span className="count">{cards.today.length}</span></div><p className="section-description">오늘 시작하거나 진행 중인 관련 일정</p><div className="event-list">{cards.today.length ? cards.today.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} />) : <Empty title="오늘 필요한 일정이 없어요" text="학교 전체 일정에서 다른 업무도 살펴볼 수 있어요." />}</div></section><section><div className="section-heading"><div><span className="section-index">02</span><h2>다가오는 일정</h2></div><span className="count">{cards.upcoming.length}</span></div><p className="section-description">기준일 다음 날부터의 관련 일정 전체</p><div className="event-list">{cards.upcoming.length ? cards.upcoming.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} compact />) : <Empty title="예정된 관련 일정이 없어요" text="등록된 일정과 내 관련 조건에 따라 자동으로 정리됩니다." />}</div></section></div>
        <div className="scope-note"><strong>이번 미리보기의 범위</strong><span>일정 → 원본 → 오늘 홈 흐름입니다. 업무·수합·AI·시간표·학생 기록은 아직 연결되지 않았습니다.</span></div>
      </> : <section className="calendar-section"><div className="list-toolbar"><label className="search-field"><span>일정 검색</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="제목·장소·안내 내용 검색" /></label><span className="result-count">열람 가능한 일정 <strong>{filtered.length}</strong>개</span></div><p className="hint list-hint">현재 소속으로 볼 수 있는 모든 날짜의 원본입니다. 홈에는 이 중 나와 관련된 오늘·미래 일정만 나타납니다.</p><div className="calendar-list">{filtered.length ? filtered.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} />) : <Empty title={search ? '검색 결과가 없어요' : '아직 등록된 일정이 없어요'} text={search ? '다른 제목이나 장소로 검색해 보세요.' : '첫 일정을 등록해 학교와 공유해 보세요.'} />}</div></section>}
      <footer className="workspace-footer">합성 자료 · 로컬 메모리 저장 <span>업무혁신시스템 · 개발 계약 미리보기</span></footer>
    </main>{detail && <EventDetail key={detail} id={detail} member={member} date={date} adapter={adapter} onClose={() => setDetail(undefined)} onEdit={event => { setDetail(undefined); setEditor({ original: event }) }} />}{editor && <EventEditor original={editor.original} member={member} members={members} date={date} adapter={adapter} onClose={() => setEditor(undefined)} onSaved={event => { setEditor(undefined); setMessage(`‘${event.title}’ ${event.version === 1 ? '등록' : '수정'} 완료 · 원본 v${event.version}. 관련 일정은 오늘 홈에도 반영됩니다.`); setReload(value => value + 1) }} />}</>
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
