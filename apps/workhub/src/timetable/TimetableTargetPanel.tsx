import { useCallback, useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import { targetCommand, targetTermLabel, type TargetCommand, type TargetReceipt, type TargetServer, type TargetSnapshot } from './target'
import './timetable-target.css'

export type TargetPanelState = { status: 'loading' | 'ready' | 'unavailable' | 'error'; snapshot?: TargetSnapshot }
type Edit = { kind: 'selection'; selection: string; version: number } | { kind: 'confirmed'; receipt: TargetReceipt }
interface Props {
  server?: TargetServer; member: Membership; disabled: boolean; refreshKey?: number
  onLockChange?: (locked: boolean) => void
  onStateChange?: (state: TargetPanelState) => void
  onChanged?: (snapshot: TargetSnapshot) => void
}
const message = (error: unknown) => error instanceof ServiceError ? error.message : '학기 선택 결과를 확인하지 못했습니다. 원래 요청과 선택을 보관했습니다.'
export function TimetableTargetPanel(props: Props) {
  const scope = recoveryScope(props.member), memory = useEditDraft<Edit>(props.member, 'timetable-target'), recovery = usePendingRequest(props.member, 'timetableTarget')
  const [edit, setEdit] = useState(memory.initial), [snapshot, setSnapshot] = useState<TargetSnapshot>(), [loadedScope, setLoadedScope] = useState('')
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [unavailable, setUnavailable] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [reload, setReload] = useState(0)
  const [missingKey, setMissingKey] = useState<string>(), [resendConfirmed, setResendConfirmed] = useState(false)
  const current = useRef({ props, scope, edit }), life = useRef(0), operation = useRef(false), readEpoch = useRef(0)
  current.current = { props, scope, edit }
  const pending = recovery.request, source = loadedScope === scope ? snapshot : undefined
  const selection = edit?.kind === 'selection' ? edit.selection : source?.selectedTermId ?? ''
  const stale = edit?.kind === 'selection' && edit.version !== source?.version
  const changed = edit?.kind === 'selection' && edit.selection !== (source?.selectedTermId ?? '')
  const editing = Boolean(source && !loading && !busy && !pending && !props.disabled && edit?.kind !== 'confirmed')
  const lock = busy || Boolean(pending) || Boolean(edit)
  const store = useCallback((next: Edit | undefined) => { setEdit(next); memory.save(next, Boolean(next)) }, [memory])
  useEffect(() => () => { life.current++; readEpoch.current++ }, [])
  useEffect(() => { props.onLockChange?.(lock); return () => props.onLockChange?.(false) }, [lock, props.onLockChange])
  useEffect(() => { life.current++; readEpoch.current++; operation.current = false; setBusy(false); setSnapshot(undefined); setLoadedScope(''); setEdit(memory.initial); setConfirmed(false); setMissingKey(undefined); setResendConfirmed(false); setError(''); setNotice('') }, [scope, memory])

  useEffect(() => {
    const epoch = ++readEpoch.current, token = scope
    const active = () => epoch === readEpoch.current && current.current.scope === token
    setConfirmed(false); setSnapshot(undefined); setLoadedScope(''); setError(''); setUnavailable(false)
    if (!props.server) { setLoading(false); setUnavailable(true); props.onStateChange?.({ status: 'unavailable' }); return }
    setLoading(true); props.onStateChange?.({ status: 'loading' })
    void props.server.get(props.member.id).then(value => {
      if (!active()) return
      setSnapshot(value); setLoadedScope(token); setLoading(false)
      const receipt = current.current.edit?.kind === 'confirmed' ? current.current.edit.receipt : undefined
      if (receipt) {
        store(undefined)
        setNotice(value.termId === receipt.effectiveTermId && value.version === receipt.version
          ? '저장 결과와 현재 준비 학기를 다시 확인했습니다. 학교 준비 자료를 새로 불러옵니다.'
          : '원래 저장은 확인됐지만 그 뒤 다른 담당자가 학기를 바꿨거나 학기 상태가 달라졌습니다. 현재 준비 학기로 자료를 새로 불러옵니다.')
      }
      current.current.props.onStateChange?.({ status: 'ready', snapshot: value })
      if (receipt) current.current.props.onChanged?.(value)
    }).catch(failure => {
      if (!active()) return
      const unavailable = failure instanceof ServiceError && failure.code === 'NOT_READY'
      setLoading(false); setUnavailable(unavailable); setError(unavailable ? '' : message(failure))
      current.current.props.onStateChange?.({ status: unavailable ? 'unavailable' : 'error' })
    })
    return () => { if (epoch === readEpoch.current) readEpoch.current++ }
  }, [props.server, props.member.id, scope, props.refreshKey, reload, store])

  function choose(value: string) {
    if (!editing || !source) return
    setConfirmed(false); setError(''); setNotice('')
    store(value === (source.selectedTermId ?? '') ? undefined : { kind: 'selection', selection: value, version: source.version })
  }
  async function send(mode: 'new' | 'recover' | 'resend' = 'new') {
    const retry = mode === 'recover', resending = mode === 'resend', restoring = retry || resending
    const server = props.server
    if (!server || operation.current) return
    let request: { key: string; command: TargetCommand }
    if (restoring) { if (!pending || resending && (missingKey !== pending.key || !resendConfirmed)) return; request = pending as typeof request }
    else {
      if (!editing || !source || !changed || stale || !confirmed || edit?.kind !== 'selection') return
      try { request = { key: crypto.randomUUID(), command: targetCommand({ termId: edit.selection || null, expectedVersion: edit.version }, source) } }
      catch (failure) { setError(message(failure)); return }
      recovery.put(request)
    }
    const epoch = life.current, token = scope
    operation.current = true; setBusy(true); setError(''); setNotice(''); setMissingKey(undefined); setResendConfirmed(false)
    try {
      const receipt = await (retry ? server.recover(props.member.id, request.command, request.key) : resending ? server.resend(props.member.id, request.command, request.key) : server.execute(props.member.id, request.command, request.key))
      if (life.current !== epoch || current.current.scope !== token) return
      recovery.remove(request.key); store({ kind: 'confirmed', receipt }); setConfirmed(false)
      // 접수증은 과거 시점의 결과다. 현재 학교 공통 선택을 다시 읽기 전에는 전환 성공으로 알리지 않는다.
      setNotice('원래 저장 접수증을 확인했습니다. 현재 준비 학기를 다시 확인하고 있습니다.'); setReload(value => value + 1)
    } catch (failure) {
      if (life.current !== epoch || current.current.scope !== token) return
      setError(message(failure)); setConfirmed(false)
      if (failure instanceof ServiceError && retry && failure.code === 'NOT_FOUND') {
        setMissingKey(request.key); setNotice('접수 원장에는 아직 이 요청이 없습니다. 늦은 최초 요청이 도착할 수 있어 선택과 원래 번호를 계속 보관합니다. 결과를 다시 조회하거나 같은 번호·같은 내용으로만 다시 보낼 수 있습니다.')
      }
      if (failure instanceof ServiceError && !restoring && ['INVALID_INPUT', 'NOT_READY', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(failure.code)) {
        recovery.remove(request.key)
        if (failure.code === 'CONFLICT') { setNotice('다른 담당자가 선택을 바꿨습니다. 내 선택을 보관했으니 최신 학기와 다시 비교해 주세요.'); setReload(value => value + 1) }
      }
    } finally { if (life.current === epoch && current.current.scope === token) { operation.current = false; setBusy(false) } }
  }
  const termText = (id: string | null) => id === null ? '준비할 수 있는 학기가 없습니다' : source?.terms.find(row => row.id === id) ? targetTermLabel(source.terms.find(row => row.id === id)!) : `목록 밖 학기 [${id}]`
  return <section className="timetable-target" aria-label="준비할 학기 선택" aria-busy={loading || busy}>
    <div className="timetable-heading"><h2>준비할 학기</h2><button type="button" className="secondary" disabled={!props.server || busy || loading} onClick={() => setReload(value => value + 1)}>준비 학기 다시 확인</button></div>
    <p className="timetable-muted">이 선택은 개인 설정이 아니라 학교의 모든 시간표 담당자가 함께 사용하는 준비 대상입니다. 현재 공개 시간표를 바꾸거나 다음 학년도를 자동으로 만들지 않습니다.</p>
    {props.disabled && <p role="status">작성 중인 입력·엑셀 선택·계산 또는 결과를 모르는 요청을 먼저 저장하거나 정리해 주세요. 다른 작업이 끝나기 전에는 준비 학기를 바꾸지 않습니다.</p>}
    {loading && <p role="status">학교의 준비 대상 학기를 확인하고 있습니다…</p>}
    {unavailable && <p className="timetable-notice">준비 학기 선택 기능을 연결 중입니다. 기존 시간표 준비 기능은 현재 연결 상태에 따라 계속 사용할 수 있습니다.</p>}
    {error && <p role="alert" className="timetable-error">{error} 현재 학기를 확인하기 전에는 이전 목록을 표시하지 않습니다.</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div className="timetable-notice"><p>학기 변경 결과를 아직 모릅니다. 원래 학기 선택과 요청 번호를 보관했습니다. 새 변경은 잠시 막고 접수 결과만 확인합니다.</p><button type="button" disabled={busy || !props.server} onClick={() => void send('recover')}>원래 학기 변경 결과 확인</button></div>}
    {pending && missingKey === pending.key && <div className="timetable-target-retry">
      <p>다시 보낼 원래 선택: {(pending.command as TargetCommand).termId ?? '자동 선택'} · 원래 판 {(pending.command as TargetCommand).expectedVersion}. 현재 목록이나 판으로 내용을 바꾸지 않습니다.</p>
      <label className="timetable-check"><input type="checkbox" checked={resendConfirmed} disabled={busy} onChange={event => setResendConfirmed(event.target.checked)} />늦은 처리 가능성을 확인했고 원래 번호와 같은 선택으로만 다시 보냅니다</label>
      <button type="button" disabled={busy || !props.server || !resendConfirmed} onClick={() => void send('resend')}>같은 번호·같은 학기 선택으로 다시 보내기</button>
    </div>}
    {edit?.kind === 'confirmed' && <p className="timetable-notice">접수증을 보관했습니다. 현재 학기 재조회가 끝날 때까지 다른 준비 작업을 잠시 막습니다. 다시 확인해도 학기 변경을 재전송하지 않습니다.</p>}
    {source && !loading && <>
      <p className="timetable-target-current"><strong>현재 준비 대상</strong><span>{termText(source.termId)}</span></p>
      {source.selectedTermId !== null && source.selectedTermId !== source.termId && <p className="timetable-notice">고른 학기가 닫히거나 기간이 끝나 자동 선택으로 돌아왔습니다. 아래 현재 준비 대상을 확인해 주세요.</p>}
      {!source.terms.length && <p>학교 관리에서 학년도와 공식 학기 날짜를 먼저 등록해 주세요. 아직 준비할 수 있는 학기가 없습니다.</p>}
      <label>준비할 학기 선택<select value={selection} disabled={!editing} onChange={event => choose(event.target.value)}>
        <option value="">원래대로 · 지금 학기 ({source.automaticTermId === null ? '현재 대상 없음' : termText(source.automaticTermId)})</option>
        {selection && !source.terms.some(row => row.id === selection) && <option value={selection} disabled>더 이상 목록에 없는 선택 [{selection}]</option>}
        {source.terms.map(term => <option key={term.id} value={term.id}>{targetTermLabel(term)}{term.id === source.automaticTermId ? ' · 지금 학기' : ''}{term.hasBasis ? ' · 기준판 있음' : ' · 기준판 없음'}{term.hasPreparationDraft ? ' · 준비 초안 있음' : ''}</option>)}
      </select></label>
      {edit?.kind === 'selection' && <div className="timetable-target-comparison" aria-label="학기 변경 확인">
        <p><strong>학교 공통 선택 변경</strong><br />{termText(source.termId)} → {edit.selection ? termText(edit.selection) : `자동 선택: ${termText(source.automaticTermId)}`}</p>
        {stale && <><p className="timetable-notice">학기 선택의 판이 달라졌습니다. 최신 목록과 비교한 뒤 다시 확인해 주세요.</p><button type="button" className="secondary" disabled={!editing || Boolean(edit.selection && !source.terms.some(row => row.id === edit.selection))} onClick={() => { store(edit.selection === (source.selectedTermId ?? '') ? undefined : { ...edit, version: source.version }); setConfirmed(false) }}>최신 학기 기준으로 다시 확인</button></>}
        <label className="timetable-check"><input type="checkbox" checked={confirmed} disabled={!editing || stale || !changed} onChange={event => setConfirmed(event.target.checked)} />학교 전체의 준비 대상이 바뀌며, 저장한 기존 학기 자료는 유지됨을 확인했습니다</label>
        <div className="timetable-actions"><button type="button" disabled={!editing || stale || !changed || !confirmed} onClick={() => void send()}>확인한 학기로 변경</button><button type="button" className="secondary" disabled={busy || Boolean(pending)} onClick={() => { store(undefined); setConfirmed(false); setError('') }}>학기 선택 취소</button></div>
      </div>}
    </>}
  </section>
}
