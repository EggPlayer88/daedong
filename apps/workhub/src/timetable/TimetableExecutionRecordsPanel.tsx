import { useCallback, useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { OperationLesson } from './operations-contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest, type TimetableRecovery } from '../app/pending-requests'
import { ServiceError } from '../services/service-values'
import { executionOutcomeLabels, executionRecordCommand, type ExecutionOutcome, type ExecutionRecord, type ExecutionRecordCommand, type ExecutionRecordReceipt, type ExecutionRecordsView, type TimetableExecutionRecordsServer } from './execution-records'
import policy from './execution-records-policy.json'
import executionStyles from './execution-records.css?inline'
import { RequestClosePanel } from './RequestClosePanel'

interface Props { member: Membership; lesson?: OperationLesson; server?: TimetableExecutionRecordsServer; disabled?: boolean; refreshKey?: number; onLockChange?: (locked: boolean) => void; onRecorded?: (receipt: ExecutionRecordReceipt) => void; openRequest?: { lessonId: string; token: number } }
type Draft = { kind: 'editing'; command: ExecutionRecordCommand } | { kind: 'saved'; receipt: ExecutionRecordReceipt }
const errorText = (error: unknown) => error instanceof ServiceError ? error.message : '기록 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다.'
const definitive = ['INVALID_INPUT', 'CONFLICT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_READY', 'NOT_FOUND']
export function TimetableExecutionRecordsPanel(props: Props) {
  const token = recoveryScope(props.member)
  const memory = useEditDraft<Draft>(props.member, 'timetable-execution-records'), pendingStore = usePendingRequest(props.member, 'timetableExecutionRecords')
  const pending = pendingStore.request as (TimetableRecovery & { command: ExecutionRecordCommand }) | undefined
  const [storedDraft, setDraft] = useState(memory.initial), [draftScope, setDraftScope] = useState(token)
  const draft = draftScope === token ? storedDraft : undefined
  const lessonId = props.lesson?.id ?? (draft?.kind === 'editing' ? draft.command.lessonId : draft?.receipt.record.lessonId) ?? pending?.command.lessonId ?? '', selection = token + ':' + lessonId
  const [snapshot, setView] = useState<ExecutionRecordsView>(), [loadedSelection, setLoadedSelection] = useState(''), [history, setHistory] = useState<ExecutionRecord[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null)
  const view = loadedSelection === selection ? snapshot : undefined
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (props.openRequest?.lessonId === lessonId && !props.disabled) setExpanded(true) }, [props.openRequest, lessonId, props.disabled])
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [historyBusy, setHistoryBusy] = useState(false), [unavailable, setUnavailable] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0)
  const [confirmed, setConfirmed] = useState(false), [resendConfirmed, setResendConfirmed] = useState(false), [missingKey, setMissingKey] = useState<string>()
  const current = useRef({ props, selection, draft }), life = useRef(0), operation = useRef(false), readEpoch = useRef(0)
  current.current = { props, selection, draft }
  const activeDraft = draft?.kind === 'editing' ? draft.command : undefined
  const stale = Boolean(activeDraft && view && (activeDraft.lessonId !== view.lesson.id || activeDraft.expectedLessonVersion !== view.lesson.version || activeDraft.expectedRecordVersion !== (view.current?.version ?? 0) || activeDraft.expectedRecordId !== (view.current?.id ?? null)))
  const lock = Boolean(draft || pending || busy)
  const editAllowed = Boolean(view && !loading && !busy && !pending && !props.disabled && draft?.kind !== 'saved' && view.allowedOutcomes.length)
  const store = useCallback((value: Draft | undefined) => { setDraftScope(token); setDraft(value); memory.save(value, Boolean(value)) }, [memory, token])
  useEffect(() => () => { life.current++; readEpoch.current++ }, [])
  useEffect(() => { props.onLockChange?.(lock); return () => props.onLockChange?.(false) }, [lock, props.onLockChange])
  useEffect(() => { life.current++; operation.current = false; setBusy(false); setHistoryBusy(false); setDraftScope(token); setDraft(memory.initial); setConfirmed(false); setMissingKey(undefined); setResendConfirmed(false); setError(''); setNotice('') }, [token, memory])
  useEffect(() => {
    const epoch = ++readEpoch.current, active = () => epoch === readEpoch.current && selection === current.current.selection
    setView(undefined); setHistory([]); setNextCursor(null); setConfirmed(false); setError(''); setUnavailable(false)
    if (!props.server || !lessonId) { setLoading(false); setUnavailable(Boolean(lessonId)); return }
    setLoading(true)
    void props.server.get(props.member.id, lessonId).then(data => {
      if (!active()) return
      setView(data); setLoadedSelection(selection); setHistory(data.history); setNextCursor(data.nextCursor); setLoading(false)
      const saved = current.current.draft?.kind === 'saved' ? current.current.draft.receipt : undefined
      if (saved) {
        store(undefined)
        setNotice(data.current?.id === saved.record.id && data.current.version === saved.record.version ? '저장한 실시 기록과 현재 기록을 다시 확인했습니다.' : '원래 저장은 확인했습니다. 그 뒤 기록이나 시간표가 달라졌으니 현재 기록을 확인해 주세요.')
      }
    }).catch(failure => {
      if (!active()) return
      setLoading(false); setUnavailable(failure instanceof ServiceError && failure.code === 'NOT_READY'); setError(failure instanceof ServiceError && failure.code === 'NOT_READY' ? '' : errorText(failure))
    })
    return () => { if (epoch === readEpoch.current) readEpoch.current++ }
  }, [props.server, props.member.id, selection, lessonId, props.refreshKey, refresh, store])
  function start() {
    if (!view || !editAllowed) return
    store({ kind: 'editing', command: { lessonId, expectedLessonVersion: view.lesson.version, expectedRecordVersion: view.current?.version ?? 0, expectedRecordId: view.current?.id ?? null, outcome: view.current?.outcome ?? view.allowedOutcomes[0], note: view.current?.note ?? '', correctionReason: view.current ? '' : null } }); setConfirmed(false); setNotice('')
  }
  function change(patch: Partial<ExecutionRecordCommand>) { if (!activeDraft || !editAllowed) return; store({ kind: 'editing', command: { ...activeDraft, ...patch } }); setConfirmed(false) }
  function adopt() {
    if (!view || !activeDraft || !editAllowed) return
    change({ expectedLessonVersion: view.lesson.version, expectedRecordVersion: view.current?.version ?? 0, expectedRecordId: view.current?.id ?? null, correctionReason: view.current ? activeDraft.correctionReason ?? '' : null })
  }
  async function send(mode: 'new' | 'recover' | 'resend') {
    const server = props.server; if (!server || operation.current) return
    let request: { key: string; command: ExecutionRecordCommand }
    if (mode !== 'new') { if (!pending || pending.closeState === 'closing' || mode === 'resend' && (missingKey !== pending.key || !resendConfirmed)) return; request = pending }
    else {
      if (!activeDraft || !view || !confirmed || stale || !editAllowed) return
      try { request = { key: crypto.randomUUID(), command: executionRecordCommand(activeDraft, view) } } catch (failure) { setError(errorText(failure)); return }
      pendingStore.put(request)
    }
    const epoch = life.current, scope = selection; operation.current = true; setBusy(true); setConfirmed(false); setError(''); setNotice(''); setMissingKey(undefined); setResendConfirmed(false)
    try {
      const receipt = await (mode === 'recover' ? server.recover(props.member.id, request.command, request.key) : mode === 'resend' ? server.resend(props.member.id, request.command, request.key) : server.execute(props.member.id, request.command, request.key))
      if (life.current !== epoch || current.current.selection !== scope) return
      pendingStore.remove(request.key)
      if (request.command.lessonId === lessonId) { store({ kind: 'saved', receipt }); setRefresh(value => value + 1) }
      setNotice('원래 요청의 저장 접수증을 확인했습니다. 현재 기록을 다시 읽고 있습니다.')
      current.current.props.onRecorded?.(receipt)
    } catch (failure) {
      if (life.current !== epoch || current.current.selection !== scope) return
      setError(errorText(failure))
      if (mode === 'recover' && failure instanceof ServiceError && failure.code === 'NOT_FOUND') { setMissingKey(request.key); setNotice('아직 원장에 요청이 없습니다. 늦은 최초 요청이 올 수 있으므로 원래 번호와 입력을 계속 보관합니다.') }
      if (mode === 'resend' && failure instanceof ServiceError && definitive.includes(failure.code)) pendingStore.put({ ...request, closeState: 'available' })
      if (mode === 'new' && failure instanceof ServiceError && definitive.includes(failure.code)) {
        pendingStore.remove(request.key)
        if (failure.code === 'CONFLICT') { setNotice('다른 곳에서 수업이나 기록을 수정했습니다. 입력을 보관했으니 최신 값과 비교해 주세요.'); setRefresh(value => value + 1) }
      }
    } finally { if (life.current === epoch && current.current.selection === scope) { operation.current = false; setBusy(false) } }
  }
  async function closeRequest() {
    const server = props.server
    if (!server?.abandon || !pending?.closeState || operation.current) return
    const request = structuredClone(pending), epoch = life.current, scope = selection
    operation.current = true; setBusy(true); setConfirmed(false); setError(''); setNotice(''); setMissingKey(undefined); setResendConfirmed(false)
    pendingStore.put({ ...request, closeState: 'closing' })
    try {
      const result = await server.abandon(props.member.id, request.command, request.key)
      if (life.current !== epoch || current.current.selection !== scope) return
      pendingStore.remove(request.key)
      if (result.outcome === 'applied') {
        store({ kind: 'saved', receipt: result.receipt })
        setNotice('원래 요청의 실시 기록이 이미 저장됐습니다. 현재 기록을 다시 확인합니다.')
        current.current.props.onRecorded?.(result.receipt)
      } else {
        store({ kind: 'editing', command: request.command })
        setNotice('이 요청을 닫았습니다. 기록 입력은 보관했습니다. 최신 수업과 기록을 확인한 뒤 새 요청으로 저장할 수 있습니다.')
      }
      setRefresh(value => value + 1)
    } catch (failure) {
      if (life.current === epoch && current.current.selection === scope) setError('요청 닫기를 확인하지 못했습니다. 원래 번호와 입력을 유지합니다. ' + errorText(failure))
    } finally { if (life.current === epoch && current.current.selection === scope) { operation.current = false; setBusy(false) } }
  }
  async function more() {
    if (!props.server || !view?.current || !nextCursor || historyBusy) return
    const epoch = readEpoch.current, scope = selection, cursor = nextCursor; setHistoryBusy(true)
    try {
      const result = await props.server.history(props.member.id, lessonId, view.current.version, cursor)
      if (epoch !== readEpoch.current || scope !== current.current.selection) return
      setHistory(rows => [...rows, ...result.history]); setNextCursor(result.nextCursor)
    } catch (failure) { if (epoch === readEpoch.current && scope === current.current.selection) setError(errorText(failure)) }
    finally { if (scope === current.current.selection) setHistoryBusy(false) }
  }
  const date = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: view?.timeZone ?? 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  return <><style>{executionStyles}</style><details className="timetable-execution-records" open={expanded || Boolean(draft || pending)} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>실시 기록 · 선택한 수업 확인</summary>
    <div className="execution-content" aria-label="수업 실시 기록" aria-busy={loading || busy}>
      <p>수업을 실제로 진행했는지 확인해 남깁니다. 예정 시간표와 별도로 보관되며, 시간이 지나도 자동으로 완료 처리하지 않습니다.</p>
      {!lessonId && <p>시간표에서 기록할 수업을 먼저 선택해 주세요.</p>}
      {lessonId && <button type="button" className="secondary" disabled={busy || loading || !props.server} onClick={() => setRefresh(value => value + 1)}>실시 기록 다시 확인</button>}
      {loading && <p role="status">현재 수업과 실시 기록을 확인하고 있습니다…</p>}
      {unavailable && <p role="status">실시 기록 기능을 준비 중입니다. 기존 시간표 조회와 교환 기능은 계속 사용할 수 있습니다.</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {pending && <div className="execution-notice"><p>수업 [{pending.command.lessonId}]의 결과를 아직 모릅니다. 입력과 원래 요청 번호를 보관했습니다.</p>{pending.closeState !== 'closing' && <button type="button" disabled={busy || !props.server} onClick={() => void send('recover')}>원래 실시 기록 결과 확인</button>}</div>}
      {pending && pending.closeState !== 'closing' && missingKey === pending.key && <div className="execution-notice"><p>다시 보낼 기록: {executionOutcomeLabels[pending.command.outcome]} · 수업 판 {pending.command.expectedLessonVersion} · 기존 기록 판 {pending.command.expectedRecordVersion}</p><label><input type="checkbox" checked={resendConfirmed} disabled={busy} onChange={event => setResendConfirmed(event.target.checked)} />늦은 처리 가능성을 확인했고 같은 번호·같은 입력으로 다시 보냅니다</label><button type="button" disabled={busy || !resendConfirmed} onClick={() => void send('resend')}>같은 번호로 실시 기록 다시 보내기</button></div>}
      {pending && <RequestClosePanel key={pending.key} state={pending.closeState} busy={busy} disabled={!props.server?.abandon} onConfirm={() => void closeRequest()} />}
      {activeDraft && !view && <div className="execution-notice"><p>보관한 입력: {executionOutcomeLabels[activeDraft.outcome]} · 수업 [{activeDraft.lessonId}]</p><p className="execution-note">{activeDraft.note}</p>{activeDraft.correctionReason && <p className="execution-note">정정 사유: {activeDraft.correctionReason}</p>}<button type="button" className="secondary" disabled={busy || Boolean(pending)} onClick={() => { store(undefined); setConfirmed(false) }}>보관한 실시 기록 입력 취소</button></div>}
      {draft?.kind === 'saved' && <p role="status">접수증은 보관했습니다. 현재 기록을 다시 확인하기 전에는 새 기록을 보내지 않습니다.</p>}
      {view && <>
        <h3>{view.lesson.label} [{view.lesson.id}]</h3><p>예정: {date(view.lesson.startsAt)} ~ {date(view.lesson.endsAt)} · 시간표 판 {view.lesson.version}</p>
        {props.lesson && props.lesson.version !== view.lesson.version && <p className="execution-notice">시간표 목록과 수업의 판이 다릅니다. 아래는 서버에서 새로 읽은 수업 기준입니다. 시간표 목록도 다시 확인해 주세요.</p>}
        <p><strong>현재 기록: {view.current ? executionOutcomeLabels[view.current.outcome] : '아직 확인하지 않음'}</strong>{view.current && ` · 기록 판 ${view.current.version} · ${view.current.recordedBy.name} · ${date(view.current.recordedAt)}`}</p>
        {view.current && <p className="execution-note">{view.current.note || '추가 메모 없음'}</p>}
        {view.current && view.current.lessonVersion !== view.lesson.version && <p className="execution-notice">이 기록은 시간표 {view.current.lessonVersion}판을 확인한 결과입니다. 이후 바뀐 수업에 자동으로 옮겨 적용하지 않습니다.</p>}
        {!view.allowedOutcomes.length && <p>현재 이 수업에는 새 기록을 남길 수 없습니다. 수업 종료 여부와 기록 권한은 서버에서 확인합니다.</p>}
        {!draft && <button type="button" disabled={!editAllowed} onClick={start}>{view.current ? '실시 기록 정정하기' : '실시 기록 작성하기'}</button>}
        {activeDraft && <div className="execution-editor">
          {stale && <div className="execution-notice"><p>기준이 바뀌었습니다. 내 입력은 아래에 보관했습니다.</p><p>처음: 시간표 {activeDraft.expectedLessonVersion}판 / 기록 {activeDraft.expectedRecordVersion}판<br />현재: 시간표 {view.lesson.version}판 / 기록 {view.current?.version ?? 0}판</p><p>현재 기록: {view.current ? executionOutcomeLabels[view.current.outcome] + ' · ' + view.current.note : '없음'}</p><button type="button" disabled={!editAllowed} onClick={adopt}>내 입력을 보존하고 최신 기준으로 비교</button></div>}
          <label>실시 결과<select aria-label="실시 결과" value={activeDraft.outcome} disabled={!editAllowed} onChange={event => change({ outcome: event.target.value as ExecutionOutcome })}>{Object.entries(executionOutcomeLabels).map(([value, label]) => <option key={value} value={value} disabled={!view.allowedOutcomes.includes(value as ExecutionOutcome)}>{label}</option>)}</select></label>
          <label>기록 메모{activeDraft.outcome !== 'completed' ? ' (필수)' : ''}<textarea aria-label="기록 메모" aria-required={activeDraft.outcome !== 'completed'} value={activeDraft.note} maxLength={policy.note} disabled={!editAllowed} onChange={event => change({ note: event.target.value })} /></label>
          {activeDraft.expectedRecordVersion > 0 && <label>정정 사유 (필수)<textarea aria-label="정정 사유" aria-required="true" value={activeDraft.correctionReason ?? ''} maxLength={policy.correctionReason} disabled={!editAllowed} onChange={event => change({ correctionReason: event.target.value })} /></label>}
          <label><input type="checkbox" checked={confirmed} disabled={!editAllowed || stale} onChange={event => setConfirmed(event.target.checked)} />선택 수업과 실제 실시 여부를 직접 확인했습니다</label>
          <div className="execution-actions"><button type="button" disabled={!editAllowed || stale || !confirmed} onClick={() => void send('new')}>확인한 실시 기록 저장</button><button type="button" className="secondary" disabled={busy || Boolean(pending)} onClick={() => { store(undefined); setConfirmed(false); setError('') }}>실시 기록 입력 취소</button></div>
        </div>}
        {history.length > 0 && <details className="execution-history"><summary>실시 기록 정정 이력 ({history.length}/{view.current?.version ?? 0})</summary><ol>{history.map(row => <li key={row.version}><strong>{row.version}판 · {executionOutcomeLabels[row.outcome]}</strong><p>{row.recordedBy.name} · {date(row.recordedAt)} · 시간표 {row.lessonVersion}판</p><p className="execution-note">{row.note || '추가 메모 없음'}</p>{row.correctionReason && <p className="execution-note">정정 사유: {row.correctionReason}</p>}</li>)}</ol>{nextCursor && <button type="button" disabled={historyBusy || loading} onClick={() => void more()}>이전 실시 기록 더 보기</button>}</details>}
      </>}
    </div>
  </details></>
}
