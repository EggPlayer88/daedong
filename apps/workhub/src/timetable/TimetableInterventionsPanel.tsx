import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { AssistantServer } from '../assistant/contracts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { canonical, ServiceError } from '../services/scoped-rpc'
import type { ExchangeInput, OperationsView, RequestAction } from './operations-contracts'
import type { InterventionCommand, InterventionInput, InterventionKind, InterventionPreview, InterventionRequest, InterventionsView, TimetableInterventionsServer } from './interventions-contracts'
import { duplicateInterventionRequests, interventionAction, interventionCommand, interventionDisplayState, interventionInput, interventionInputProblem, interventionLabels, interventionStateLabels, interventionActionLabels, interventionNeedsMyAction, interventionSubmit, selectInterventionRequests, type InterventionRequestFilter } from './interventions-domain'
import { timetableDateOffset } from './operations-calendar'
import { InterventionAssistantPanel } from './InterventionAssistantPanel'
import type { OperationsAiProposal } from './interventions-assistant'
import { schoolDayLocalTime } from './school-day-execution-server'
import styles from './interventions.css?inline'

interface Props {
  server: TimetableInterventionsServer; member: Membership; date: string; view?: OperationsView
  selectedLessonId?: string; initialRequestId?: string; initialSchoolDayChangeId?: string; revision?: number
  disabled?: boolean; assistantServer?: AssistantServer; onChanged?: () => void; onLockChange?: (locked: boolean) => void
  onExchangeProposal?: (input: ExchangeInput) => void
  initialIntent?: { kind: 'makeup'; lessonId: string; token: string }
  onInitialIntentConsumed?: (token: string) => void
}
interface Form { kind: InterventionKind; lessonId: string; teacherId: string; closureId: string; targetStart: string; targetEnd: string; reason: string }
const empty = (): Form => ({ kind: 'substitute', lessonId: '', teacherId: '', closureId: '', targetStart: '', targetEnd: '', reason: '' })
const message = (e: unknown) => e instanceof Error ? e.message : '결과를 확인하지 못했습니다. 원래 요청과 입력은 유지합니다.'
const definite = (error: unknown) => error instanceof ServiceError && ['INVALID_INPUT', 'NOT_READY', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INACTIVE_MEMBERSHIP'].includes(error.code)
function timestampInput(value: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d)?$/.test(value)) throw new ServiceError('INVALID_INPUT')
  const minute = schoolDayLocalTime(value.slice(0, 10), value.slice(11, 16), zone)
  return new Date(Date.parse(minute) + Number(value.slice(17) || 0) * 1000).toISOString()
}
function localInput(value: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const pick = (kind: string) => parts.find(part => part.type === kind)!.value
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}${pick('second') === '00' ? '' : ':' + pick('second')}`
}
export function TimetableInterventionsPanel(props: Props) {
  return <InterventionsPanel key={recoveryScope(props.member)} {...props} />
}
function InterventionsPanel(props: Props) {
  const id = useId(), recovery = usePendingRequest(props.member, 'timetableInterventions'), memory = useEditDraft<Form>(props.member, 'timetable-interventions-form')
  const [form, setForm] = useState<Form>(() => memory.initial ?? { ...empty(), lessonId: props.selectedLessonId ?? '', ...(props.initialSchoolDayChangeId ? { kind: 'reopen', closureId: props.initialSchoolDayChangeId } : {}) })
  const [source, setSource] = useState<InterventionsView>(), [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [reload, setReload] = useState(0)
  const [preview, setPreview] = useState<InterventionPreview>(), [confirmed, setConfirmed] = useState(false), [closeConfirmed, setCloseConfirmed] = useState(false)
  const [selectedAction, setSelectedAction] = useState<{ row: InterventionRequest; action: RequestAction }>(), [actionConfirmed, setActionConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [aiLocked, setAiLocked] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now())
  const [discardConfirmed, setDiscardConfirmed] = useState(false)
  const [linkedIntent, setLinkedIntent] = useState<Props['initialIntent']>(), [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<InterventionRequestFilter>('all'), [kindFilter, setKindFilter] = useState<InterventionKind | ''>(''), [shownCount, setShownCount] = useState(20)
  const linkedToken = useRef(''), requestNodes = useRef(new Map<string, HTMLLIElement>())
  const life = useRef(0), running = useRef(false), current = useRef(props), latestSource = useRef(source)
  current.current = props; latestSource.current = source
  const pending = recovery.request, locked = busy || !!pending, dirty = Boolean(form.reason || form.teacherId || form.targetStart || form.targetEnd || preview || selectedAction)
  const from = props.view?.from ?? props.date, until = props.view?.until ?? timetableDateOffset(props.date, 7)
  const sourceKey = canonical([props.member, from, until, props.revision, reload]), validUntil = preview ? Date.parse(preview.expiresAt) : 0
  const latestQuery = useRef(sourceKey); latestQuery.current = sourceKey
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { props.onLockChange?.(locked || dirty || aiLocked); return () => props.onLockChange?.(false) }, [locked, dirty, aiLocked, props.onLockChange])
  useEffect(() => { memory.save(form, dirty) }, [form, dirty, memory])
  useEffect(() => {
    let active = true
    setLoading(true); setReady(false); setPreview(undefined); setConfirmed(false); setSelectedAction(undefined)
    void (async () => {
      try {
        const readiness = await props.server.readiness(props.member.id)
        if (!active) return
        if (!readiness.available) { setSource(undefined); setNotice(readiness.reason === 'approvers_missing' ? '서로 다른 승인 담당자와 학교의 사용 설정을 확인해야 합니다.' : '학교에서 대강·보강 요청 연결을 준비 중입니다. 기존 교환 요청과 입력은 유지합니다.'); return }
        const value = await props.server.get(props.member.id, from, until)
        if (active) { setSource(value); setReady(true); setNotice('') }
      } catch (e) { if (active) { setSource(undefined); setError(message(e)) } }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [props.server, sourceKey])
  useEffect(() => {
    if (locked || dirty || !props.selectedLessonId) return
    setForm(value => ({ ...value, lessonId: props.selectedLessonId! }))
  }, [props.selectedLessonId, locked, dirty])
  useEffect(() => {
    if (locked || dirty || !props.initialSchoolDayChangeId) return
    setForm(value => ({ ...value, kind: 'reopen', closureId: props.initialSchoolDayChangeId! }))
  }, [props.initialSchoolDayChangeId, locked, dirty])
  useEffect(() => {
    if (!props.initialIntent || linkedToken.current === props.initialIntent.token) return
    linkedToken.current = props.initialIntent.token; setLinkedIntent(props.initialIntent); setReplaceConfirmed(false)
  }, [props.initialIntent])
  useEffect(() => { setReplaceConfirmed(false) }, [form, preview, selectedAction, sourceKey])
  function finishIntent() {
    if (!linkedIntent) return
    props.onInitialIntentConsumed?.(linkedIntent.token); setLinkedIntent(undefined); setReplaceConfirmed(false)
  }
  function openMakeupIntent() {
    if (!linkedIntent || locked || aiLocked || props.disabled || !ready || !source || dirty && !replaceConfirmed) return
    const lesson = source.lessons.find(row => row.id === linkedIntent.lessonId)
    if (!lesson || lesson.state !== 'cancelled') return
    setForm({ ...empty(), kind: 'makeup', lessonId: lesson.id }); setPreview(undefined); setSelectedAction(undefined); setConfirmed(false)
    setNotice('홈에서 선택한 취소 수업을 보강 대상으로 열었습니다. 보강할 시각을 정해 주세요.'); setError(''); finishIntent()
  }
  useEffect(() => {
    if (linkedIntent && !dirty && !locked && !aiLocked && !props.disabled && ready && source?.lessons.some(row => row.id === linkedIntent.lessonId && row.state === 'cancelled')) openMakeupIntent()
  }, [linkedIntent, dirty, locked, aiLocked, props.disabled, ready, source])
  useEffect(() => { setShownCount(20) }, [query, filter, kindFilter])
  function change(patch: Partial<Form>) { setForm(value => ({ ...value, ...patch })); setPreview(undefined); setConfirmed(false); setError('') }
  function buildInput(): InterventionInput {
    if (!source) throw new ServiceError('NOT_READY')
    if (form.kind === 'reopen') return interventionInput({ kind: 'reopen', schoolDayChangeId: form.closureId, reason: form.reason })
    const lesson = source.lessons.find(row => row.id === form.lessonId)
    if (!lesson) throw new ServiceError('INVALID_INPUT')
    const base = { kind: form.kind, lessonId: lesson.id, expectedVersion: lesson.version, reason: form.reason }
    return interventionInput({ ...base, ...(form.kind === 'substitute' ? { substituteTeacherId: form.teacherId } : form.kind === 'makeup' ? { target: { startsAt: timestampInput(form.targetStart, source.timeZone), endsAt: timestampInput(form.targetEnd, source.timeZone) } } : {}) })
  }
  async function review(input?: InterventionInput) {
    if (running.current || locked || props.disabled || !ready || !source) return
    const epoch = life.current, original = canonical(source), query = sourceKey
    running.current = true; setBusy(true); setError(''); setNotice(''); setPreview(undefined); setConfirmed(false)
    try {
      const candidate = input ?? buildInput(), problem = interventionInputProblem(candidate, source)
      if (problem) throw new Error(problem)
      if (duplicateInterventionRequests(candidate, source.requests).length) throw new Error('같은 변경 요청이 이미 있습니다. 기존 요청의 진행 상태를 확인해 주세요.')
      const value = await props.server.preview(props.member.id, candidate, source)
      if (epoch !== life.current) return
      if (query !== latestQuery.current || current.current.disabled || canonical(latestSource.current) !== original) throw new ServiceError('CONFLICT')
      setPreview(value)
    } catch (e) { if (epoch === life.current) setError(message(e)) }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  function finish(key: string, text: string, clearInput = true) {
    recovery.remove(key)
    // 기존 요청에 응답해도 별도로 작성 중인 새 요청의 사유·대상은 보존한다.
    if (clearInput) { setForm(empty()); memory.remove() }
    setPreview(undefined); setConfirmed(false); setSelectedAction(undefined); setActionConfirmed(false); setCloseConfirmed(false)
    setNotice(text); setReload(value => value + 1); current.current.onChanged?.()
  }
  async function send(command: InterventionCommand, key: string, recover = false) {
    if (running.current) return
    const epoch = life.current; running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const receipt = await (recover ? props.server.recover(props.member.id, command, key) : props.server.execute(props.member.id, command, key))
      if (epoch !== life.current) return
      finish(key, receipt.status === 'applied' ? '수업 변경을 반영했습니다. 최신 시간표에서 확인해 주세요.' : `요청 결과: ${interventionStateLabels[receipt.status]}`, command.kind === 'submit')
    } catch (e) {
      if (epoch !== life.current) return
      setError(message(e))
      if (!recover && definite(e)) {
        recovery.remove(key); setPreview(undefined); setConfirmed(false); setSelectedAction(undefined); setActionConfirmed(false)
        if (e instanceof ServiceError && e.code !== 'INVALID_INPUT') setReload(value => value + 1)
      }
    } finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  async function submit() {
    if (locked || props.disabled || !ready || !source || !preview || !confirmed || preview.blockers.length || validUntil <= Date.now()) return
    const command = interventionSubmit(preview), key = crypto.randomUUID()
    recovery.put({ command, key }); await send(command, key)
  }
  async function act() {
    if (locked || props.disabled || !selectedAction || !actionConfirmed || !source) return
    const live = source.requests.find(row => row.id === selectedAction.row.id)
    if (!live || Date.parse(live.expiresAt) <= Date.now() || canonical(live) !== canonical(selectedAction.row)) { setError('요청 상태나 기한이 바뀌었습니다. 현재 요청에서 다시 확인해 주세요.'); return }
    const command = interventionAction(live, selectedAction.action), key = crypto.randomUUID()
    recovery.put({ command, key }); await send(command, key)
  }
  async function recover() {
    if (!pending || running.current || pending.closeState === 'closing') return
    try { await send(interventionCommand(pending.command), pending.key, true) } catch (e) { setError(message(e)) }
  }
  async function close() {
    if (!pending || running.current || !closeConfirmed && pending.closeState !== 'closing') return
    const epoch = life.current; running.current = true; setBusy(true); setError('')
    try {
      const command = interventionCommand(pending.command)
      recovery.put({ ...pending, closeState: 'closing' })
      const result = await props.server.close(props.member.id, command, pending.key)
      if (epoch !== life.current) return
      if (result.outcome === 'applied') finish(pending.key, `기존 처리 결과를 확인했습니다: ${interventionStateLabels[result.receipt.status]}`, command.kind === 'submit')
      else {
        recovery.remove(pending.key); setPreview(undefined); setConfirmed(false); setSelectedAction(undefined); setActionConfirmed(false); setCloseConfirmed(false)
        setNotice('이 요청을 닫았습니다. 작성한 내용은 유지하며, 다시 보내려면 새 변경 확인을 거칩니다.')
      }
    } catch (e) { if (epoch === life.current) setError(message(e)) }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  function adoptAi(input: OperationsAiProposal) {
    if (locked || props.disabled) return
    if (input.kind === 'move' || input.kind === 'swap') {
      if (!props.onExchangeProposal) { setError('교환 입력 연결을 확인해 주세요. 요청은 보내지 않았습니다.'); return }
      setForm(empty()); memory.remove(); setPreview(undefined); setConfirmed(false); setSelectedAction(undefined)
      props.onExchangeProposal(input); return
    }
    const next: Form = { ...empty(), kind: input.kind, reason: input.reason }
    if (input.kind === 'reopen') next.closureId = input.schoolDayChangeId
    else {
      next.lessonId = input.lessonId
      if (input.kind === 'substitute') next.teacherId = input.substituteTeacherId
      if (input.kind === 'makeup') { next.targetStart = localInput(input.target.startsAt, source!.timeZone); next.targetEnd = localInput(input.target.endsAt, source!.timeZone) }
    }
    setForm(next); setPreview(undefined); setConfirmed(false); setNotice('제안을 입력란에 채웠습니다. 변경 확인과 교사 동의·담당자 승인 전에는 수업이 바뀌지 않습니다.')
  }
  const selected = source?.lessons.find(row => row.id === form.lessonId)
  const displayTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: source?.timeZone ?? 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  const completeForm = Boolean(form.reason.trim() && (form.kind === 'reopen' ? form.closureId : selected && (form.kind === 'substitute' ? form.teacherId : form.kind === 'makeup' ? form.targetStart && form.targetEnd : true)))
  let inputProblem = '', duplicates: InterventionRequest[] = []
  if (completeForm && source) {
    try {
      const candidate = buildInput()
      inputProblem = interventionInputProblem(candidate, source, now) ?? ''
      duplicates = duplicateInterventionRequests(candidate, source.requests, now)
    } catch { inputProblem = '날짜·시각과 변경 사유를 확인해 주세요. 종료는 시작보다 늦어야 합니다.' }
  }
  const filtered = source ? selectInterventionRequests(source.requests, { query, filter, kind: kindFilter || undefined }, now) : []
  const shown = filtered.slice(0, shownCount)
  const selectedRequest = source?.requests.find(row => row.id === selectedAction?.row.id) ?? source?.requests.find(row => row.id === props.initialRequestId)
  if (selectedRequest && !shown.some(row => row.id === selectedRequest.id)) shown.unshift(selectedRequest)
  const mineCount = source?.requests.filter(row => interventionNeedsMyAction(row, now)).length ?? 0
  const pendingCount = source?.requests.filter(row => ['awaiting_consent', 'awaiting_approval'].includes(interventionDisplayState(row, now))).length ?? 0
  const intentLesson = source?.lessons.find(row => row.id === linkedIntent?.lessonId)
  function showRequest(row: InterventionRequest) {
    setQuery(''); setFilter('all'); setKindFilter(''); setShownCount(source?.requests.length ?? 20)
    requestAnimationFrame(() => { const element = requestNodes.current.get(row.id); element?.scrollIntoView({ block: 'center' }); element?.focus() })
  }
  function matchMakeupEnd() {
    if (!selected || !source || locked || props.disabled || aiLocked || !form.targetStart) return
    try {
      const start = timestampInput(form.targetStart, source.timeZone), end = Date.parse(start) + Date.parse(selected.time.endsAt) - Date.parse(selected.time.startsAt)
      change({ targetEnd: localInput(new Date(end).toISOString(), source.timeZone) })
    } catch { setError('보강 시작 시각을 먼저 올바르게 입력해 주세요.') }
  }
  return <section className="tt-interventions" aria-labelledby={`${id}-title`}><style>{styles}</style>
    <div className="timetable-toolbar"><div><h3 id={`${id}-title`}>대강·휴강·보강</h3><p>변경안 확인 → 관련 교사 수락 → 다른 담당자 승인 순서로 반영합니다.</p></div><button type="button" className="secondary" disabled={loading || locked} onClick={() => setReload(value => value + 1)}>최신 요청 확인</button></div>
    {error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}{loading && <p role="status">현재 수업과 요청을 확인하고 있습니다.</p>}
    {pending && <section className="timetable-card" aria-label="수업 요청 복구"><h4>원래 요청 결과 확인</h4><p>입력과 요청 번호를 보관했습니다. 확인 전에는 새 번호로 보내지 않습니다.</p><div className="timetable-actions"><button type="button" disabled={busy || pending.closeState === 'closing'} onClick={() => void recover()}>같은 요청 결과 확인</button></div><label><input type="checkbox" checked={closeConfirmed} disabled={busy || pending.closeState === 'closing'} onChange={e => setCloseConfirmed(e.target.checked)} />이미 처리된 결과 또는 닫힘을 확인한 뒤 이 요청을 종료합니다.</label><button type="button" disabled={busy || !closeConfirmed && pending.closeState !== 'closing'} onClick={() => void close()}>{pending.closeState === 'closing' ? '요청 닫힘 다시 확인' : '이 요청 닫기'}</button></section>}
    {linkedIntent && <section className="timetable-card" aria-label="홈에서 연 보강 입력"><h4>홈에서 선택한 보강</h4>
      {loading ? <p>원수업의 현재 상태를 확인하고 있습니다.</p> : !intentLesson || intentLesson.state !== 'cancelled' ? <p>현재 조회에서 취소된 원수업을 확인하지 못했습니다. 입력을 바꾸지 않았으니 최신 요청을 다시 확인해 주세요.</p> : <p>{intentLesson.label} · {intentLesson.groupNames.join(', ')} · {displayTime(intentLesson.time.startsAt)}</p>}
      {(locked || aiLocked) && <p>보관한 요청 결과를 먼저 확인해 주세요. 기존 입력과 요청 번호는 유지합니다.</p>}
      {dirty && <><p>작성 중인 변경 입력은 그대로 두었습니다.</p><label><input type="checkbox" checked={replaceConfirmed} disabled={locked || aiLocked || props.disabled} onChange={e => setReplaceConfirmed(e.target.checked)} />작성 중인 입력을 정리하고 선택한 수업의 보강을 작성합니다.</label></>}
      <div className="timetable-actions"><button type="button" disabled={locked || aiLocked || props.disabled || !ready || intentLesson?.state !== 'cancelled' || dirty && !replaceConfirmed} onClick={openMakeupIntent}>선택한 보강 입력으로 이동</button><button type="button" className="secondary" disabled={locked || aiLocked} onClick={finishIntent}>기존 입력 계속 작성</button></div>
    </section>}
    {!ready && dirty && !locked && !aiLocked && <section aria-label="보관한 수업 변경 입력"><p>작성한 입력은 현재 탭에 남아 있습니다. 연결을 복구하거나, 입력을 버리고 다른 작업으로 이동할 수 있습니다.</p><label><input type="checkbox" checked={discardConfirmed} onChange={e => setDiscardConfirmed(e.target.checked)} />서버로 보내지 않은 수업 변경 입력을 버립니다.</label><button type="button" disabled={!discardConfirmed} onClick={() => { setForm(empty()); memory.remove(); setPreview(undefined); setSelectedAction(undefined); setDiscardConfirmed(false); setNotice('보관한 입력을 버렸습니다.') }}>입력 버리고 이동 잠금 해제</button></section>}
    {ready && source && <><fieldset className="tt-intervention-form" disabled={locked || props.disabled || aiLocked}><legend>수업 변경 요청</legend>
      <label>처리할 일<select aria-label="처리할 일" value={form.kind} onChange={e => change({ kind: e.target.value as InterventionKind })}>{Object.entries(interventionLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      {form.kind === 'reopen' ? <label>취소할 휴업<select aria-label="취소할 휴업" value={form.closureId} onChange={e => change({ closureId: e.target.value })}><option value="">휴업 기록 선택</option>{source.closures.filter(row => !row.reopened).map(row => <option key={row.id} value={row.id}>{row.date} · {row.lessonIds.length}개 수업 · {row.reason}</option>)}</select></label>
        : <label>대상 수업<select aria-label="대상 수업" value={form.lessonId} onChange={e => change({ lessonId: e.target.value })}><option value="">수업 선택</option>{source.lessons.filter(row => row.state === (form.kind === 'makeup' ? 'cancelled' : 'scheduled')).map(row => <option key={row.id} value={row.id}>{displayTime(row.time.startsAt)} · {row.label} · {row.groupNames.join(', ')} [{row.id}]</option>)}</select></label>}
      {form.kind === 'substitute' && <label>대강 교사<select aria-label="대강 교사" value={form.teacherId} onChange={e => change({ teacherId: e.target.value })}><option value="">교사 선택</option>{source.teachers.map(row => <option key={row.id} value={row.id}>{row.name} [{row.id}]</option>)}</select></label>}
      {form.kind === 'makeup' && <><p>취소된 원수업은 보존합니다. 새 보강은 같은 수업 길이와 학생·공간을 기준으로 검사합니다.</p><label>보강 시작 시각<input type="datetime-local" step="1" value={form.targetStart} onChange={e => change({ targetStart: e.target.value })} /></label><label>보강 종료 시각<input type="datetime-local" step="1" value={form.targetEnd} onChange={e => change({ targetEnd: e.target.value })} /></label><button type="button" className="secondary" disabled={!selected || !form.targetStart} onClick={matchMakeupEnd}>원수업 길이로 종료 시각 맞추기</button><p className="timetable-muted">학교 시간대: {source.timeZone}. 선택한 원수업: {selected ? `${displayTime(selected.time.startsAt)}–${displayTime(selected.time.endsAt)} · ${(Date.parse(selected.time.endsAt) - Date.parse(selected.time.startsAt)) / 60000}분` : '선택 필요'}</p></>}
      <label>변경 사유<textarea aria-label="변경 사유" maxLength={500} rows={2} value={form.reason} onChange={e => change({ reason: e.target.value })} placeholder="공유에 필요한 사유만 적어 주세요." /></label>
      {inputProblem && <p role="status" className="timetable-error">{inputProblem}</p>}
      {!!duplicates.length && <div role="status"><p>{duplicates.some(row => row.state === 'applied') ? '이 원수업의 보강이 이미 반영되었습니다.' : '같은 변경 요청이 진행 중입니다. 새 요청 대신 기존 진행 상태를 확인해 주세요.'}</p><button type="button" className="text-button" onClick={() => showRequest(duplicates[0])}>기존 변경 요청 보기</button></div>}
      <div className="timetable-actions"><button type="button" disabled={!completeForm || !!inputProblem || !!duplicates.length} onClick={() => void review()}>변경 영향 확인</button><button type="button" className="secondary" onClick={() => { setForm(empty()); setPreview(undefined); setConfirmed(false); setSelectedAction(undefined); setError('') }}>입력 취소</button></div>
    </fieldset>
    {preview && <section className="timetable-card" aria-label="수업 변경 확인"><h4>{interventionLabels[preview.input.kind]} 변경 확인</h4><p>{preview.input.reason}</p><ul>{preview.changes.map(row => <li key={row.after.id}>{row.after.label} · {row.after.groupNames.join(', ')} — {row.before ? `${displayTime(row.before.time.startsAt)} / ${row.before.teachers.map(t => t.name).join(', ')}` : '새 보강'} → {row.after.state === 'cancelled' ? '휴강' : `${displayTime(row.after.time.startsAt)} / ${row.after.teachers.map(t => t.name).join(', ')}`}</li>)}</ul><p>동의할 교사: {preview.participants.map(row => row.name).join(', ') || '변경 없음'}</p><p>결손 {preview.hours.removedSeconds / 60}분 · 추가 {preview.hours.addedSeconds / 60}분</p>
      {!!preview.blockers.length && <ul role="alert">{preview.blockers.map((row, index) => <li key={index}>{row.message}</li>)}</ul>}{validUntil <= now && <p role="status">확인 시간이 지났습니다. 변경 영향을 다시 확인해 주세요.</p>}
      <label><input type="checkbox" checked={confirmed} disabled={locked || props.disabled || validUntil <= now} onChange={e => setConfirmed(e.target.checked)} />대상 수업과 영향받는 교사를 확인했습니다.</label><button type="button" disabled={locked || props.disabled || !confirmed || !!preview.blockers.length || validUntil <= now} onClick={() => void submit()}>동의 요청 보내기</button>
    </section>}
    <section aria-label="대강 보강 요청 현황"><h4>요청 현황</h4><p className="timetable-muted">내 확인 {mineCount}건 · 진행 중 {pendingCount}건 · 조회 기간 전체 {source.requests.length}건</p>
      {!!source.requests.length && <div className="tt-intervention-filters"><label>요청 검색<input aria-label="수업 변경 요청 검색" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="수업·학급·교사·사유" /></label><label>진행 상태<select aria-label="수업 변경 요청 상태" value={filter} onChange={e => setFilter(e.target.value as InterventionRequestFilter)}><option value="all">전체</option><option value="mine">내 확인 필요</option><option value="pending">진행 중</option><option value="finished">완료·종료</option></select></label><label>변경 종류<select aria-label="수업 변경 요청 종류" value={kindFilter} onChange={e => setKindFilter(e.target.value as InterventionKind | '')}><option value="">모든 변경</option>{Object.entries(interventionLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label></div>}
      {!source.requests.length ? <p>조회 기간의 요청이 없습니다.</p> : !filtered.length && <p role="status">검색 조건에 맞는 요청이 없습니다.</p>}
      <ul className="tt-intervention-requests">{shown.map(row => <li key={row.id} tabIndex={-1} ref={node => { if (node) requestNodes.current.set(row.id, node); else requestNodes.current.delete(row.id) }} data-request-id={row.id} data-highlight={row.id === props.initialRequestId}><strong>{interventionLabels[row.kind]} · {interventionStateLabels[interventionDisplayState(row, now)]}</strong><p>{row.changes[0].after.label} · {row.changes[0].after.groupNames.join(', ')} · {displayTime(row.changes[0].after.time.startsAt)}{row.changes.length > 1 ? ` 외 ${row.changes.length - 1}개 수업` : ''}</p><p>{row.reason}</p><p className="timetable-muted">요청: {row.requester.name} · 동의 {row.participants.filter(person => person.response === 'accepted').length}/{row.participants.length}명</p>
      <details><summary>교사별 응답과 요청 번호</summary><p>{row.participants.map(person => `${person.name}: ${person.response === 'accepted' ? '수락' : person.response === 'rejected' ? '반려' : '대기'}`).join(' / ')}</p><p>확인 기한: {displayTime(row.expiresAt)}</p><code>{row.id}</code></details>
      {['awaiting_consent', 'awaiting_approval'].includes(row.state) && Date.parse(row.expiresAt) <= now && <p role="status">표시 중 확인 기한이 지났습니다. 새 처리를 보내지 않고 최신 요청을 다시 확인해 주세요.</p>}
      <div className="timetable-actions">{row.actions.map(action => <button type="button" key={action} disabled={locked || props.disabled || aiLocked || Date.parse(row.expiresAt) <= now} onClick={() => { setSelectedAction({ row, action }); setActionConfirmed(false) }}>{interventionActionLabels[action]}</button>)}</div>
      {selectedAction?.row.id === row.id && <section aria-label="수업 요청 처리 확인"><p>{interventionActionLabels[selectedAction.action]}할 요청과 교사·수업을 확인해 주세요. 서버에서 최신 판과 동의를 다시 검사합니다.</p>{Date.parse(row.expiresAt) <= now && <p role="status">요청 기한이 지났습니다. 최신 요청을 다시 확인해 주세요.</p>}<label><input type="checkbox" checked={actionConfirmed} disabled={locked || props.disabled || Date.parse(row.expiresAt) <= now} onChange={e => setActionConfirmed(e.target.checked)} />이 요청의 처리 내용을 확인했습니다.</label><button type="button" disabled={locked || props.disabled || !actionConfirmed || Date.parse(row.expiresAt) <= now} onClick={() => void act()}>확인한 처리 반영</button><button type="button" className="secondary" disabled={locked} onClick={() => setSelectedAction(undefined)}>처리 선택 취소</button></section>}
    </li>)}</ul>{filtered.length > shownCount && <button type="button" className="secondary" onClick={() => setShownCount(value => value + 20)}>요청 더 보기 ({filtered.length - shownCount}건)</button>}</section></>}
    <InterventionAssistantPanel member={props.member} server={props.assistantServer} source={ready ? source : undefined} exchanges={props.view ?? null} selectedLessonId={form.lessonId} disabled={locked || !!props.disabled || !ready} draftFingerprint={dirty ? canonical(form) : undefined} onProposal={adoptAi} onLockChange={setAiLocked} />
  </section>
}
