import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import { activeAt, canEdit, homeItems } from '../domain'
import { dateLabel, EventEditor, eventTime, visibilityLabels, type Adapter } from './EventEditor'
import type { RelationOptions } from './contracts'
const Icon = ({ name }: { name: 'arrow' | 'plus' }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={name === 'plus' ? 'M12 5v14M5 12h14' : 'M5 12h14m-5-5 5 5-5 5'} /></svg>

export function CalendarPanel({ member, members, schoolName, date, adapter, revision, page, onPageChange, relationOptions, demo = false, homeExtras, storageLabel }: { member: Membership; members: Membership[]; schoolName: string; date: string; adapter: Adapter; revision: number; page: 'home' | 'calendar'; onPageChange: (page: 'home' | 'calendar') => void; relationOptions?: RelationOptions; demo?: boolean; homeExtras?: ReactNode; storageLabel?: string }) {
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
  function changePage(next: 'home' | 'calendar') { onPageChange(next); setMessage(''); requestAnimationFrame(() => heading.current?.focus()) }
  return <><main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{schoolName} · {dateLabel(date)}</p><h1 ref={heading} tabIndex={-1}>{page === 'home' ? `${member.name.split(' ')[0]} 선생님, 좋은 하루예요.` : '학교 일정'}</h1><p>{page === 'home' ? '내게 필요한 일정부터, 오늘을 차분하게 시작하세요.' : '학교의 일정을 함께 보고, 필요한 일을 함께 준비해요.'}</p></div><button className="primary" disabled={!activeAt(member, date)} onClick={() => { setEditor({}); setMessage('') }}><Icon name="plus" />일정 등록</button></header>
      <div className="basis-strip"><span className="small-tag">{demo ? '합성 기준일' : '한국 시간'}</span><span><strong>{date}</strong> 기준입니다. 종일 일정의 종료일을 포함합니다.</span></div>
      {message && <div className="success-box" role="status">{message}</div>}
      {page === 'home' && homeExtras}
      {loading ? <section className="loading-state" role="status" aria-live="polite"><div className="skeleton" /><div className="skeleton" /><p>현재 소속의 일정을 불러오는 중…</p></section> : error ? <section className="error-state" role="alert"><span className="state-symbol">!</span><h2>일정을 확인할 수 없어요</h2><p>{error}</p><button className="secondary" onClick={() => setReload(value => value + 1)}>다시 불러오기</button></section> : page === 'home' ? <>
        <div className="overview-grid"><section className="day-summary"><p>오늘 내게 필요한 일정</p><div><strong>{cards.today.length}</strong><span>개의 일정이 있어요</span></div><span className="summary-line">{cards.today.length ? '일정을 누르면 원본과 안내를 확인할 수 있어요.' : '새 일정이 생기면 이곳에서 함께 확인해요.'}</span></section><section className="quiet-card"><span className="sun-mark" aria-hidden="true">◒</span><div><strong>한 번 등록하면, 필요한 곳에.</strong><p>같은 원본이 학교 일정과 나의 오늘에 연결됩니다.</p><button className="text-button" onClick={() => changePage('calendar')}>학교 전체 일정 살펴보기 <Icon name="arrow" /></button></div></section></div>
        <div className="home-columns"><section><div className="section-heading"><div><span className="section-index">01</span><h2>오늘의 일정</h2></div><span className="count">{cards.today.length}</span></div><p className="section-description">오늘 시작하거나 진행 중인 관련 일정</p><div className="event-list">{cards.today.length ? cards.today.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} />) : <Empty title="오늘 필요한 일정이 없어요" text="학교 전체 일정에서 다른 업무도 살펴볼 수 있어요." />}</div></section><section><div className="section-heading"><div><span className="section-index">02</span><h2>다가오는 일정</h2></div><span className="count">{cards.upcoming.length}</span></div><p className="section-description">기준일 다음 날부터의 관련 일정 전체</p><div className="event-list">{cards.upcoming.length ? cards.upcoming.map(({ event, reason }) => <EventCard key={event.id} event={event} reason={reason} onOpen={setDetail} compact />) : <Empty title="예정된 관련 일정이 없어요" text="등록된 일정과 내 관련 조건에 따라 자동으로 정리됩니다." />}</div></section></div>

      </> : <section className="calendar-section"><div className="list-toolbar"><label className="search-field"><span>일정 검색</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="제목·장소·안내 내용 검색" /></label><span className="result-count">열람 가능한 일정 <strong>{filtered.length}</strong>개</span></div><p className="hint list-hint">현재 소속으로 볼 수 있는 모든 날짜의 원본입니다. 홈에는 이 중 나와 관련된 오늘·미래 일정만 나타납니다.</p><div className="calendar-list">{filtered.length ? filtered.map(event => <EventCard key={event.id} event={event} onOpen={setDetail} />) : <Empty title={search ? '검색 결과가 없어요' : '아직 등록된 일정이 없어요'} text={search ? '다른 제목이나 장소로 검색해 보세요.' : '첫 일정을 등록해 학교와 공유해 보세요.'} />}</div></section>}
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
