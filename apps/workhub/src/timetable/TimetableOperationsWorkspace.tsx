import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import { createTimetableOperationsServer } from './operations-server'
import type { OperationCommand, OperationLesson, OperationReceipt, OperationsReadiness, OperationsView, TimetableOperationsServer } from './operations-contracts'
import { TimetablePublishPanel } from './TimetablePublishPanel'
import { TimetableExchangePanel } from './TimetableExchangePanel'
import { dateOffset } from './OperationChangeList'
import { PublishedTimetableBoard } from './PublishedTimetableBoard'
import { createTimetableOperationsExtensions } from './operations-next-server'
import type { OperationsExtensions, OperationReferenceView } from './operations-next-contracts'
import { SchoolDayChangePanel } from './SchoolDayChangePanel'
import { timetableWeekStart } from './operations-calendar'
import nextLimits from './operations-next-limits.json'
import styles from './operations.css?inline'
import themeStyles from './timetable-theme.css?inline'

type Tab = 'shared' | 'publish' | 'exchange'
interface Props { connection: SupabaseConnection; member: Membership; date: string; revision?: number; onNavigationLockChange?: (locked: boolean) => void; initialLessonId?: string; initialDate?: string; onOpenLesson?: (lessonId: string, date: string) => void }
interface PanelProps extends Omit<Props, 'connection'> { server: TimetableOperationsServer; extensions?: OperationsExtensions }
const message = (error: unknown) => error instanceof ServiceError ? error.message : '처리 결과를 확인하지 못했습니다. 입력과 원래 요청 번호를 보관했습니다.'
const rejected = (error: unknown) => error instanceof ServiceError && ['NOT_READY', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'CONFLICT'].includes(error.code)
const readinessMessage = { not_installed: '확정·공유·교환 기능의 서버 연결을 준비 중입니다.', not_allowed: '현재 계정에는 시간표 운영 자료를 볼 권한이 없습니다.', basis_missing: '학교의 시간표 운영 기초 자료를 먼저 연결해야 합니다.' }
const receiptMessage = (receipt: OperationReceipt) => receipt.kind === 'publish' ? `학교 시간표 ${receipt.version}판을 확정했습니다. 공유 화면에서 적용 기간을 확인할 수 있습니다.` : receipt.status === 'applied' ? '수업 변경을 시간표에 반영했습니다. 최신 수업을 확인해 주세요.' : '수업 변경 요청의 처리 결과를 확인했습니다. 요청 현황에서 다음 단계를 확인해 주세요.'

export function TimetableOperationsWorkspace(props: Props) {
  const server = useMemo(() => createTimetableOperationsServer(props.connection), [props.connection])
  const extensions = useMemo(() => createTimetableOperationsExtensions(props.connection), [props.connection])
  return <TimetableOperationsPanel key={recoveryScope(props.member)} {...props} server={server} extensions={extensions} />
}
export function TimetableOperationsPanel({ server, member, date, revision = 0, onNavigationLockChange, extensions, initialLessonId, initialDate, onOpenLesson }: PanelProps) {
  const id = useId(), pendingStore = usePendingRequest(member, 'timetableOperations')
  const route = useEditDraft<Tab>(member, 'timetable-operations-tab'), publishMemory = useEditDraft<unknown>(member, 'timetable-publish'), exchangeMemory = useEditDraft<unknown>(member, 'timetable-exchanges')
  const schoolDayMemory = useEditDraft<unknown>(member, 'timetable-school-day')
  const pending = pendingStore.request as { command: OperationCommand; key: string } | undefined
  const [tab, setTab] = useState<Tab>(() => pending ? pending.command.kind === 'publish' ? 'publish' : 'exchange' : route.initial ?? 'shared')
  const focusedDate = dateOffset(initialDate ?? date, 0) || date, focusSource = useRef(focusedDate)
  const [from, setFrom] = useState(() => timetableWeekStart(focusedDate)), [reload, setReload] = useState(0), [ready, setReady] = useState<OperationsReadiness>()
  const [boardDate, setBoardDate] = useState(focusedDate), [schoolDayDirty, setSchoolDayDirty] = useState(false)
  const [boardFilter, setBoardFilter] = useState({ teacher: member.id, group: '' })
  const [boardMode, setBoardMode] = useState<'week' | 'day'>()
  const [fetched, setFetched] = useState<{ key: string; value: OperationsView }>(), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [discard, setDiscard] = useState(false)
  const [publishDirty, setPublishDirty] = useState(false), [exchangeDirty, setExchangeDirty] = useState(false), [publishEpoch, setPublishEpoch] = useState(0), [exchangeEpoch, setExchangeEpoch] = useState(0)
  const [sourceSelection, setSourceSelection] = useState<{ lessonId: string; token: number }>(), selectionToken = useRef(0)
  const [references, setReferences] = useState<OperationReferenceView>(), [referenceError, setReferenceError] = useState('')
  const life = useRef(0), running = useRef(false), feedback = useRef<HTMLDivElement>(null)
  const until = dateOffset(from, nextLimits.sharedWindowDays), enabled = activeAt(member, date), queryKey = JSON.stringify([date, from, until, revision, reload, enabled])
  const view = !loading && !loadError && ready?.available && fetched?.key === queryKey && enabled ? fetched.value : null
  const current = useRef({ view, enabled, pending }); current.current = { view, enabled, pending }
  const locked = busy || Boolean(pending), navLocked = locked || publishDirty || exchangeDirty || schoolDayDirty
  const refresh = useCallback(() => setReload(value => value + 1), [])
  const changePublishDirty = useCallback((value: boolean) => setPublishDirty(value), [])
  const changeExchangeDirty = useCallback((value: boolean) => setExchangeDirty(value), [])
  useEffect(() => { if (focusedDate !== focusSource.current && !locked) { focusSource.current = focusedDate; setBoardDate(focusedDate); setFrom(timetableWeekStart(focusedDate)) } }, [focusedDate, locked])
  useEffect(() => { life.current++; return () => { life.current++; running.current = false } }, [server])
  useEffect(() => { onNavigationLockChange?.(navLocked); return () => onNavigationLockChange?.(false) }, [navLocked, onNavigationLockChange])
  useEffect(() => { if (!navLocked) return; const beforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', beforeLeave); return () => window.removeEventListener('beforeunload', beforeLeave) }, [navLocked])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError(''); setReady(undefined)
    if (!enabled || !until) { setFetched(undefined); setLoadError('현재 학교 소속과 조회 기간을 확인해 주세요.'); setLoading(false); return }
    void server.readiness(member.id).then(async value => {
      if (cancelled) return
      setReady(value)
      if (!value.available) { setFetched(undefined); return }
      const next = await server.get(member.id, from, until)
      if (!cancelled) setFetched({ key: queryKey, value: next })
    }).catch(failure => { if (!cancelled) { setFetched(undefined); setLoadError(message(failure)) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [server, member.id, queryKey, enabled, from, until])
  useEffect(() => { if (error || notice) feedback.current?.focus() }, [error, notice])
  useEffect(() => {
    let cancelled = false; setReferences(undefined); setReferenceError('')
    if (!view || !extensions) return
    void extensions.references(member.id, view).then(result => { if (!cancelled) setReferences(result) }).catch(() => { if (!cancelled) setReferenceError('학급별 조회 연결을 확인하지 못했습니다. 교사별 시간표와 기존 요청은 계속 이용할 수 있습니다.') })
    return () => { cancelled = true }
  }, [view, extensions, member.id])
  function open(next: Tab) { if (locked || next === tab) return; route.save(next, false); setTab(next); setDiscard(false) }
  function clearCommandDraft(command: OperationCommand) {
    if (command.kind === 'publish') { publishMemory.remove(); setPublishEpoch(value => value + 1); setPublishDirty(false) }
    // 기존 요청에 응답한 결과를 복구해도 별도로 작성 중인 새 요청은 지우지 않는다.
    else if (command.kind === 'submit') { exchangeMemory.remove(); setExchangeEpoch(value => value + 1); setExchangeDirty(false) }
  }
  async function execute(command: OperationCommand): Promise<OperationReceipt> {
    const live = current.current, snapshot = live.view
    if (running.current || live.pending) throw new ServiceError('RESULT_UNKNOWN')
    if (!live.enabled || !snapshot) throw new ServiceError('NOT_READY')
    if (command.kind === 'publish' && !snapshot.canPublish || command.kind === 'submit' && !snapshot.canRequest) throw new ServiceError('FORBIDDEN')
    if (command.kind === 'action' && !snapshot.requests.some(request => request.id === command.requestId && request.version === command.expectedVersion && request.proposalHash === command.proposalHash && request.actions.includes(command.action))) throw new ServiceError('CONFLICT')
    const request = { command: structuredClone(command), key: crypto.randomUUID() }, generation = life.current
    running.current = true; setBusy(true); setError(''); setNotice(''); pendingStore.put(request)
    try {
      const receipt = await server.execute(member.id, request.command, request.key)
      if (generation !== life.current) throw new ServiceError('CANCELLED')
      pendingStore.remove(request.key); setNotice(receiptMessage(receipt)); refresh()
      return receipt
    } catch (failure) {
      if (generation === life.current && rejected(failure)) {
        pendingStore.remove(request.key)
        if (failure instanceof ServiceError && failure.code !== 'INVALID_INPUT') refresh()
      }
      throw failure
    } finally { if (generation === life.current) { running.current = false; setBusy(false) } }
  }
  async function recover() {
    if (!pending || running.current || !enabled) return
    const request = structuredClone(pending), generation = life.current
    running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const receipt = await server.recover(member.id, request.command, request.key)
      if (generation !== life.current) return
      pendingStore.remove(request.key); clearCommandDraft(request.command); setNotice(receiptMessage(receipt)); refresh()
    } catch (failure) {
      if (generation !== life.current) return
      // 현재 권한·준비 조회 실패로 이전 실행이 취소되었다고 판단하지 않는다.
      if (failure instanceof ServiceError && failure.code === 'NOT_FOUND') { pendingStore.remove(request.key); setNotice('원래 요청이 실행되지 않았음을 확인했습니다. 입력은 유지했습니다. 최신 내용을 다시 검토해 주세요.'); refresh() }
      else setError(message(failure))
    } finally { if (generation === life.current) { running.current = false; setBusy(false) } }
  }
  function discardInputs() {
    if (locked) return
    publishMemory.remove(); exchangeMemory.remove(); schoolDayMemory.remove(); setPublishEpoch(value => value + 1); setExchangeEpoch(value => value + 1)
    setPublishDirty(false); setExchangeDirty(false); setSchoolDayDirty(false); setDiscard(false); setNotice('보관한 입력을 버렸습니다. 다른 메뉴로 이동할 수 있습니다.'); setError('')
  }
  function requestLesson(lesson: OperationLesson) {
    if (locked || !view?.canRequest || !lesson.canRequest) return
    setSourceSelection({ lessonId: lesson.id, token: ++selectionToken.current }); open('exchange')
  }
  return <section className="timetable-operations" aria-labelledby={`${id}-title`}>
    <style>{themeStyles + styles}</style>
    <header className="ttops-header"><div><p className="ttops-eyebrow">학교 시간표</p><h1 id={`${id}-title`}>시간표 운영</h1><p className="ttops-muted">확정된 수업을 함께 확인하고, 변경은 상대 확인과 승인을 거쳐 반영합니다.</p></div><button type="button" className="secondary" onClick={refresh} disabled={busy || loading}>최신 시간표 확인</button></header>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="ttops-error">{error}</p>}{notice && <p role="status" className="ttops-notice">{notice}</p>}</div>
    {pending && <section className="ttops-pending" aria-labelledby={`${id}-pending`}>
      <h3 id={`${id}-pending`}>원래 요청의 결과 확인이 필요합니다</h3><p>새 요청을 만들지 않고 보관한 요청 번호의 결과만 조회합니다. 확인 전에는 다른 시간표 변경을 시작할 수 없습니다.</p>
      <details><summary>보관한 요청 번호</summary><code>{pending.key}</code></details>
      <button type="button" disabled={busy || !enabled} onClick={() => void recover()}>{busy ? '처리 결과 확인 중…' : '원래 요청 결과만 다시 확인'}</button>
      <p className="ttops-muted">입력과 요청 번호는 현재 탭에만 보관됩니다. 확인을 마칠 때까지 새로고침하거나 창을 닫지 마세요.</p>
    </section>}
    {loading && <p role="status">시간표 운영 연결을 확인하고 있습니다…</p>}
    {!loading && loadError && <div role="alert" className="ttops-error"><h3>시간표 운영 자료를 불러오지 못했습니다</h3><p>{loadError}</p><p>이전 자료는 숨겼습니다. 작성한 입력은 연결 확인 뒤 이어서 사용할 수 있습니다.</p><button type="button" className="secondary" onClick={refresh} disabled={busy}>운영 연결 다시 확인</button></div>}
    {!loading && !loadError && ready && !ready.available && <div role="status" className="ttops-card"><h3>시간표 운영 연결 준비 중</h3><p>{readinessMessage[ready.reason]}</p><p className="ttops-muted">연결되지 않은 시간표를 임의로 만들거나 확정하지 않습니다. 편성 화면의 초안 작업은 별도로 이용할 수 있습니다.</p></div>}
    <nav className="ttops-tabs" aria-label="시간표 운영 작업"><button type="button" aria-pressed={tab === 'shared'} disabled={locked && tab !== 'shared'} onClick={() => open('shared')}>공유 시간표</button>{(!view || view.canPublish || publishDirty || schoolDayDirty || tab === 'publish') && <button type="button" aria-pressed={tab === 'publish'} disabled={locked && tab !== 'publish'} onClick={() => open('publish')}>시간표 확정{publishDirty ? ' · 작성 중' : ''}</button>}<button type="button" aria-pressed={tab === 'exchange'} disabled={locked && tab !== 'exchange'} onClick={() => open('exchange')}>교환·변경 요청{exchangeDirty ? ' · 작성 중' : ''}</button></nav>
    <div hidden={tab !== 'shared'}>
      {view && <section className="ttops-card" aria-label="확정 수업 조회">
        <PublishedTimetableBoard view={view} memberId={member.id} date={date} initialDate={boardDate} initialFilter={boardFilter} onFilterChange={setBoardFilter} initialMode={boardMode} onModeChange={setBoardMode} locked={locked} references={references} onRequest={requestLesson} onRangeChange={(first, selected) => { setBoardDate(selected); if (first < view.from || dateOffset(first, 7) > view.until) setFrom(first) }} initialLessonId={initialLessonId} onOpenLesson={onOpenLesson} />
        {referenceError && <details><summary>학급 연결 상태</summary><p className="ttops-muted">{referenceError}</p></details>}
        <details className="ttops-publications"><summary>적용 중인 확정본 {view.publications.length}건</summary>{view.publications.length ? <ul>{view.publications.map(item => <li key={item.id}><strong>{item.title} · {item.version}판</strong><p>{item.from} ~ {dateOffset(item.until, -1)}</p><small>확정 시각 {new Date(item.publishedAt).toLocaleString('ko-KR', { timeZone: view.timeZone })}</small></li>)}</ul> : <p>이 조회 기간에 적용되는 확정본이 없습니다.</p>}</details>
      </section>}
    </div>
    <div hidden={tab !== 'publish'}><TimetablePublishPanel key={publishEpoch} server={server} member={member} view={view} loading={loading} locked={locked} onCommand={execute} onDirtyChange={changePublishDirty} extensions={extensions} /><SchoolDayChangePanel key={'school-day-' + publishEpoch} member={member} view={view} references={references} extensions={extensions} locked={locked} onDirtyChange={setSchoolDayDirty} /></div>
    <div hidden={tab !== 'exchange'}><TimetableExchangePanel key={exchangeEpoch} server={server} member={member} view={view} loading={loading} locked={locked} onCommand={execute} onDirtyChange={changeExchangeDirty} onReload={refresh} revision={revision + reload} sourceSelection={sourceSelection} onSelectionConsumed={() => setSourceSelection(undefined)} extensions={extensions} /></div>
    {(publishDirty || exchangeDirty || schoolDayDirty) && !locked && (!view || tab === 'shared' || tab === 'publish' && !view.canPublish || tab === 'exchange' && (!view.canRequest || schoolDayDirty)) && <section className="ttops-reset" aria-label="보관한 입력 정리">
      {discard ? <><p>현재 탭에 보관한 확정·교환·학사 변경 입력을 모두 버립니다. 이미 서버에 반영된 시간표와 요청은 바뀌지 않습니다.</p><button type="button" className="secondary" onClick={discardInputs}>입력 버리고 메뉴 잠금 해제</button><button type="button" className="secondary" onClick={() => setDiscard(false)}>계속 작성하기</button></> : <button type="button" className="secondary" onClick={() => setDiscard(true)}>보관한 입력 정리</button>}
    </section>}
  </section>
}
