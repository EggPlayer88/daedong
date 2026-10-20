import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { useEditDraft } from '../app/edit-drafts'
import { usePendingRequest } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import { createSchoolRosterServer } from './school-roster-server'
import type { SchoolRosterServer, SchoolRosterSnapshot as RosterSnapshot, SchoolRosterPreview as RosterPreview, SchoolRosterCommand as RosterCommand, SchoolRosterIntent as RosterIntent } from './school-roster-contracts'

type Draft = { selected: string[]; startsOn: string; lastDay: string; reason: string }
const failureMessage = (error: unknown) => error instanceof ServiceError ? error.message : '교사 연결을 확인하지 못했습니다. 선택한 명단과 입력을 보존했습니다.'
const rejected = (error: unknown) => error instanceof ServiceError && ['INVALID_INPUT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CONFLICT', 'NOT_READY', 'NOT_FOUND'].includes(error.code)

/** 기존 회원의 소속만 연결한다. 새 로그인 계정이나 역할을 만들지 않는다. */
export function SchoolRosterPanel({ connection, member, date, onNavigationLockChange, onUpdated, server: provided }: {
  connection: SupabaseConnection; member: Membership; date: string
  onNavigationLockChange?: (locked: boolean) => void; onUpdated?: () => void; server?: SchoolRosterServer
}) {
  const server = useMemo(() => provided ?? createSchoolRosterServer(connection), [provided, connection])
  const memory = useEditDraft<Draft>(member, 'school-roster')
  const recovery = usePendingRequest(member, 'schoolRoster')
  const [draft, setDraft] = useState<Draft>(() => memory.initial ?? { selected: [], startsOn: date, lastDay: '', reason: '' })
  const [data, setData] = useState<RosterSnapshot>(), [preview, setPreview] = useState<RosterPreview>()
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true), [confirmed, setConfirmed] = useState(false)
  const [closeConfirmed, setCloseConfirmed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0), running = useRef(false)
  const pending = recovery.request as { command: RosterCommand; key: string; closeState?: 'closing' } | undefined
  const dirty = draft.selected.length > 0 || Boolean(draft.reason || draft.lastDay) || draft.startsOn !== date
  const locked = busy || Boolean(pending)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { generation.current++; return () => { generation.current++ } }, [server, member.id])
  useEffect(() => { setCloseConfirmed(false) }, [pending?.key])
  useEffect(() => { onNavigationLockChange?.(locked || dirty); return () => onNavigationLockChange?.(false) }, [locked, dirty, onNavigationLockChange])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setData(undefined)
    server.get(member.id).then(value => { if (!cancelled) setData(value) }).catch(e => { if (!cancelled) setError(failureMessage(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [server, member.id, reload])
  function edit(patch: Partial<Draft>) {
    if (locked) return
    const value = { ...draft, ...patch }; setDraft(value); memory.save(value, value.selected.length > 0 || Boolean(value.reason || value.lastDay) || value.startsOn !== date)
    setPreview(undefined); setConfirmed(false); setError(''); setNotice('')
  }
  async function review() {
    if (!data?.available || locked || running.current) return
    const intent: RosterIntent = { expectedVersion: data.version, targetUserIds: [...draft.selected].sort(), startsOn: draft.startsOn, lastDay: draft.lastDay || null, reason: draft.reason.trim() }
    running.current = true; setBusy(true); setError('')
    const turn = generation.current
    try { const value = await server.preview(member.id, intent); if (turn === generation.current) { setPreview(value); setConfirmed(false) } }
    catch (e) { if (turn === generation.current) setError(failureMessage(e)) }
    finally { if (turn === generation.current) { setBusy(false); running.current = false } }
  }
  async function save(retry = false) {
    if (retry && pending?.closeState === 'closing') { await closeRequest(); return }
    if (running.current || (!retry && (!preview?.allowed || !confirmed || Date.parse(preview.expiresAt) <= Date.now()))) return
    const request = retry ? pending : preview ? { key: crypto.randomUUID(), command: { previewId: preview.previewId, fingerprint: preview.fingerprint, intent: preview.intent } } : undefined
    if (!request) return
    const turn = generation.current; running.current = true; setBusy(true); setError('')
    recovery.put(request)
    try {
      const result = await server.commit(member.id, request.command, request.key)
      if (turn !== generation.current) return
      recovery.remove(request.key); memory.remove(); setDraft({ selected: [], startsOn: date, lastDay: '', reason: '' }); setPreview(undefined)
      setNotice(`교사 ${result.items.length}명의 소속 연결을 확인했습니다. 수업 담당 목록에서 배정할 수 있습니다.`); setReload(value => value + 1); onUpdated?.()
    } catch (e) {
      if (turn !== generation.current) return
      // 재확인 중 실패는 첫 요청이 취소됐다는 증거가 아니다.
      if (!retry && rejected(e)) { recovery.remove(request.key); setPreview(undefined); setReload(value => value + 1) }
      setError(failureMessage(e))
    } finally { if (turn === generation.current) { setBusy(false); running.current = false } }
  }
  async function closeRequest() {
    if (!pending || (!closeConfirmed && pending.closeState !== 'closing') || running.current) return
    const request = pending, turn = generation.current
    running.current = true; setBusy(true); setError('')
    recovery.put({ ...request, closeState: 'closing' })
    try {
      const result = await server.close(member.id, request.command, request.key)
      if (turn !== generation.current) return
      // 이 응답만 기존 접수증 또는 지연 전송을 막은 종료 장벽을 증명한다.
      recovery.remove(request.key); setPreview(undefined); setConfirmed(false); setCloseConfirmed(false)
      if (result.outcome === 'applied') {
        memory.remove(); setDraft({ selected: [], startsOn: date, lastDay: '', reason: '' })
        setNotice(`이미 연결된 교사 ${result.receipt!.items.length}명의 원래 결과를 확인했습니다.`); onUpdated?.()
      } else {
        setNotice('이 요청을 종료했습니다. 늦게 도착하는 같은 요청도 반영되지 않습니다. 입력은 보존했으니 다시 미리보기할 수 있습니다.')
      }
      setReload(value => value + 1)
    } catch (e) { if (turn === generation.current) setError(failureMessage(e)) }
    finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  const candidates = data?.candidates.filter(row => `${row.name} ${row.legacyUserId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  return <section className="panel school-roster" aria-label="가입 교사 연결">
    <header><p className="eyebrow">학교 자료 준비</p><h2>가입 교사 연결</h2><p>가입된 교사를 학교 소속으로 연결한 뒤 수업 담당자로 선택합니다. 로그인 계정과 기존 회원 승인은 유지됩니다.</p></header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {pending && <div className="notice" role="status"><p>소속 연결 결과를 확인 중입니다. 원래 요청 번호와 선택한 명단을 보관했습니다.</p>{pending.closeState === 'closing' ? <><p>요청 종료를 확인하고 있습니다. 연결 명령을 다시 보내지 않고 종료 결과만 확인합니다.</p><button disabled={busy} onClick={() => void closeRequest()}>같은 요청으로 종료 확인</button></> : <><button disabled={busy} onClick={() => void save(true)}>같은 요청으로 결과 확인</button><details><summary>이 요청 종료</summary><p>서버가 이미 연결했다면 원래 결과를 확인합니다. 아직 연결하지 않았다면 늦게 도착하는 요청까지 막은 뒤 새 미리보기를 할 수 있습니다.</p><label><input type="checkbox" checked={closeConfirmed} disabled={busy} onChange={e => setCloseConfirmed(e.target.checked)} />이 요청을 종료하고 입력을 다시 확인하겠습니다.</label><button disabled={busy || !closeConfirmed} onClick={() => void closeRequest()}>서버에서 요청 종료 확인</button></details></>}</div>}
    {loading ? <p role="status">연결 가능한 가입 교사를 확인하는 중…</p> : !data?.available ? <div><p>학교별 교사 연결 명단을 준비 중입니다. 서버에서 허용한 가입 회원만 표시됩니다.</p><button disabled={busy} onClick={() => { setError(''); setReload(value => value + 1) }}>다시 확인</button></div> : <>
      <label>이름·회원 번호 찾기<input value={search} onChange={e => setSearch(e.target.value)} /></label>
      <p>{data.candidates.length}명 중 {draft.selected.length}명 선택 · 이름이 같으면 회원 번호로 구별합니다.</p>
      <div className="school-roster-list" style={{ maxHeight: 360, overflow: 'auto' }}>
        {candidates.map(row => <label key={row.legacyUserId} style={{ display: 'flex', gap: 12, padding: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={draft.selected.includes(row.legacyUserId)} disabled={locked || row.state !== 'unlinked'} onChange={e => edit({ selected: e.target.checked ? [...draft.selected, row.legacyUserId] : draft.selected.filter(id => id !== row.legacyUserId) })} />
          <span>{row.name} <small>[{row.legacyUserId}]</small> · {row.state === 'linked' ? '연결됨' : row.state === 'blocked' ? '연결 조건 확인 필요' : '미연결'}</span>
        </label>)}
      </div>
      {!candidates.length && <p>표시할 교사가 없습니다. 서버 연결 명단 또는 검색어를 확인해 주세요.</p>}
      <fieldset disabled={locked}><legend>소속 기간과 근거</legend>
        <p>수업 학기의 날짜와 별개인 현재 재직 기간입니다. 학교 기준일 {data.asOfDate}에 재직 중인 교사를 연결합니다.</p>
        <label>소속 시작일<input type="date" value={draft.startsOn} max={data.asOfDate} onChange={e => edit({ startsOn: e.target.value })} /></label>
        <label>소속 마지막 날 (선택)<input type="date" value={draft.lastDay} min={data.asOfDate} onChange={e => edit({ lastDay: e.target.value })} /></label>
        <label>연결 근거<textarea value={draft.reason} maxLength={200} onChange={e => edit({ reason: e.target.value })} placeholder="확인한 재직 명단이나 승인 근거" /></label>
      </fieldset>
      <div className="button-row"><button disabled={locked || !draft.selected.length || !draft.startsOn || !draft.reason.trim()} onClick={() => void review()}>연결 내용 미리보기</button><button disabled={locked} onClick={() => { memory.remove(); setDraft({ selected: [], startsOn: date, lastDay: '', reason: '' }); setPreview(undefined); setError('') }}>선택 취소</button></div>
      {preview && <section aria-label="교사 연결 확인"><h3>연결할 교사 확인</h3><ul>{preview.items.map(item => <li key={item.legacyUserId}>{item.name} [{item.legacyUserId}] · {item.outcome === 'blocked' ? '연결 불가' : item.outcome === 'already_linked' ? '이미 연결됨' : '소속 연결'}</li>)}</ul>
        <p>{preview.intent.startsOn}부터 {preview.intent.lastDay ?? '종료일 없이'} · {preview.intent.reason}</p>
        <label><input type="checkbox" checked={confirmed} disabled={locked} onChange={e => setConfirmed(e.target.checked)} />선택한 교사의 재직과 소속 기간을 확인했습니다.</label>
        {Date.parse(preview.expiresAt) <= now && <p role="status">확인 기한이 지났습니다. 입력을 유지한 채 미리보기를 다시 실행해 주세요.</p>}
        <button disabled={locked || !preview.allowed || !confirmed || Date.parse(preview.expiresAt) <= now} onClick={() => void save()}>확인한 교사 연결</button>
      </section>}
    </>}
  </section>
}
