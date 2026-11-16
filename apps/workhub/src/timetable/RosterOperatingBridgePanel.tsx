import { useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest, useRecoveryStore, PendingRequestsProvider } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/service-values'
import { OperationChangeList, dateOffset } from './OperationChangeList'
import type { RosterOperatingChoice, RosterOperatingCommand, RosterOperatingInput, RosterOperatingPreview, RosterOperatingReceipt, RosterOperatingServer } from './roster-bridge-contracts'
type Form = { planId: string; from: string; lastDay: string }
interface Props { server: RosterOperatingServer; member: Membership; date: string; canManage: boolean; disabled: boolean; onLock: (locked: boolean) => void; onPublished: () => void }
const errorText = (e: unknown) => e instanceof ServiceError ? e.message : '결과를 확인하지 못했습니다. 입력과 요청 번호는 보관합니다.'
const rejected = (e: unknown) => e instanceof ServiceError && ['CONFLICT', 'FORBIDDEN', 'INVALID_INPUT', 'INACTIVE_MEMBERSHIP', 'NOT_READY', 'IDEMPOTENCY_CONFLICT'].includes(e.code)

export function RosterOperatingBridgePanel(props: Props) {
 const store = useRecoveryStore()
 return <PendingRequestsProvider store={store}><RosterOperatingBridgeContent {...props} /></PendingRequestsProvider>
}
function RosterOperatingBridgeContent({ server, member, date, canManage, disabled, onLock, onPublished }: Props) {
 const memory = useEditDraft<Form>(member, 'timetable-roster-bridge'), pending = usePendingRequest(member, 'timetableRosterBridge')
 const recovery = useRecoveryStore(), scope = recoveryScope(member)
 const [form, setForm] = useState<Form>(() => memory.initial ?? { planId: '', from: date, lastDay: dateOffset(date, 6) })
 const [dirty, setDirty] = useState(Boolean(memory.initial))
 const [plans, setPlans] = useState<RosterOperatingChoice[]>([]), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
 const [preview, setPreview] = useState<RosterOperatingPreview>(), [confirmed, setConfirmed] = useState(false), [closeConfirmed, setCloseConfirmed] = useState(false)
 const [missing, setMissing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0), [now, setNow] = useState(Date.now)
 const generation = useRef(0), running = useRef(false), live = useRef({ canManage, disabled, form }); live.current = { canManage, disabled, form }
 const selected = plans.find(p => p.id === form.planId), locked = disabled || busy || Boolean(pending.request)
 const input: RosterOperatingInput | null = selected && form.from && form.lastDay && form.from <= form.lastDay ? { planId: selected.id, planVersion: selected.version, from: form.from, until: dateOffset(form.lastDay, 1) } : null
 const inRange = Boolean(input && selected && input.from >= date && input.from >= selected.from && input.until <= selected.until)
 const expired = Boolean(preview && Date.parse(preview.expiresAt) <= now)
 useEffect(() => { onLock(busy || dirty || Boolean(pending.request)); return () => onLock(false) }, [busy, dirty, Boolean(pending.request), onLock])
 useEffect(() => {
  const token = ++generation.current; running.current = false; setBusy(false); setPlans([]); setPreview(undefined); setConfirmed(false)
  if (!canManage) return
  setLoading(true); setError('')
  void server.get(member.id).then(v => { if (token === generation.current) setPlans(v.plans) }).catch(e => { if (token === generation.current) setError(errorText(e)) }).finally(() => { if (token === generation.current) setLoading(false) })
  return () => { generation.current++ }
 }, [server, scope, date, canManage, retry])
 useEffect(() => { if (!preview) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [preview])
 function change(patch: Partial<Form>) { if (locked || !canManage) return; const next = { ...form, ...patch }; setForm(next); setDirty(true); memory.save(next, true); setPreview(undefined); setConfirmed(false); setError(''); setNotice(''); generation.current++ }
 async function inspect() {
  if (!input || !inRange || locked || !canManage || running.current) return
  const captured = structuredClone(input), token = ++generation.current
  running.current = true; setBusy(true); setPreview(undefined); setConfirmed(false); setError(''); setNotice('')
  try { const v = await server.preview(member.id, captured); if (token === generation.current && live.current.canManage && !live.current.disabled) { setPreview(v); setNow(Date.now()) } }
  catch (e) { if (token === generation.current) setError(errorText(e)) }
  finally { if (token === generation.current) { running.current = false; setBusy(false) } }
 }
 function currentRequest(token: number, key: string) { return token === generation.current && live.current.canManage && !live.current.disabled && recovery.get(scope, 'timetableRosterBridge')?.key === key }
 function complete(receipt: RosterOperatingReceipt, key: string) {
  pending.remove(key); memory.remove(); setDirty(false); setForm({ planId: '', from: date, lastDay: dateOffset(date, 6) }); setPreview(undefined); setConfirmed(false); setMissing(false); setCloseConfirmed(false)
  setNotice(`날짜별 운영 수업 ${receipt.changedLessons}건의 반영을 확인했습니다. ${receipt.from} ~ ${dateOffset(receipt.until, -1)} 수업을 공유 시간표에서 확인하세요.`)
  try { onPublished() } catch { setError('날짜별 수업은 반영됐지만 화면을 갱신하지 못했습니다. 다시 반영하지 말고 공유 시간표에서 확인해 주세요.') }
 }
 async function send(recoverOnly: boolean, resend = false) {
  if (running.current || disabled || !canManage) return
  const saved = pending.request
  if (!saved && (!preview || !confirmed || expired || preview.blockers.length || !preview.changes.length || !input || !inRange || canonical(input) !== canonical(preview.input) || Date.parse(preview.expiresAt) <= Date.now())) return
  if (saved?.closeState === 'closing') return
  const command: RosterOperatingCommand = saved ? saved.command as RosterOperatingCommand : { previewId: preview!.id, hash: preview!.hash, input: preview!.input }
  const key = saved?.key ?? crypto.randomUUID()
  if (!saved) pending.put({ command, key })
  const token = ++generation.current
  running.current = true; setBusy(true); setError(''); setMissing(false)
  try { const receipt = await server.commit(member.id, command, key, recoverOnly && !resend); if (currentRequest(token, key)) complete(receipt, key) }
  catch (e) { if (currentRequest(token, key)) { if (!saved && rejected(e)) { pending.remove(key); setPreview(undefined); setConfirmed(false) } else if (e instanceof ServiceError && e.code === 'NOT_FOUND') setMissing(true); setError(errorText(e)) } }
  finally { if (token === generation.current) { running.current = false; setBusy(false) } }
 }
 async function close() {
  const saved = pending.request
  if (!saved || running.current || disabled || !canManage || !closeConfirmed && saved.closeState !== 'closing') return
  const token = ++generation.current
  pending.put({ ...saved, closeState: 'closing' }); running.current = true; setBusy(true); setError('')
  try { const result = await server.close(member.id, saved.command as RosterOperatingCommand, saved.key); if (!currentRequest(token, saved.key)) return; if (result.outcome === 'applied') complete(result.receipt, saved.key); else { pending.remove(saved.key); setPreview(undefined); setConfirmed(false); setMissing(false); setCloseConfirmed(false); setNotice('요청을 닫았습니다. 입력을 확인하고 새로 미리보기 하세요.') } }
  catch (e) { if (currentRequest(token, saved.key)) setError(errorText(e)) } finally { if (token === generation.current) { running.current = false; setBusy(false) } }
 }
 if (!canManage && !pending.request && !dirty) return null
 return <section className="ttops-card" aria-label="기본 시간표 운영 연결"><h3>기본 주간표를 날짜별 수업으로 연결</h3><p>명부의 확정 기본표를 선택한 기간에 적용합니다. 교사·학급·실제 교시 시각을 대조하고 기존 시험·운영 수업과 겹치면 멈춥니다.</p>
  {!canManage && <p role="status">관리 권한과 연결 상태를 다시 확인해야 합니다. 보관한 입력과 요청은 유지합니다.</p>}
  {error && <p role="alert" className="ttops-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  {busy && <p role="status">{pending.request ? '반영 결과 확인 중…' : '기간별 연결과 변경 수업을 확인 중…'}</p>}
  {pending.request ? !busy && <div className="ttops-preview"><h4>원래 요청 결과 확인</h4><p>처리 여부를 확인할 때까지 새 공개 요청을 만들지 않습니다.</p><button disabled={busy || disabled || !canManage || pending.request.closeState === 'closing'} onClick={() => void send(true)}>원래 요청 결과만 확인</button>{missing && <button disabled={busy || disabled || !canManage} onClick={() => void send(false, true)}>같은 번호·같은 내용으로 다시 보내기</button>}
   <label><input type="checkbox" checked={closeConfirmed} disabled={busy || disabled} onChange={e => setCloseConfirmed(e.target.checked)} />원래 요청을 닫고 입력을 다시 확인하겠습니다.</label><button disabled={busy || disabled || !canManage || !closeConfirmed && pending.request.closeState !== 'closing'} onClick={() => void close()}>{pending.request.closeState === 'closing' ? '요청 닫기 결과 확인' : '이 요청 닫기'}</button><p className="ttops-muted">결과를 먼저 확인해 주세요. 같은 탭을 새로고침했다면 보관한 원래 요청을 복원해 확인할 수 있습니다.</p>
  </div> : <>
   {loading && <p role="status">확정 기본표를 확인 중…</p>}
   {!loading && !plans.length && canManage && <p>선택할 확정 기본표가 없습니다. 교사 명부·기본 시간표에서 먼저 확정해 주세요.</p>}
   <fieldset disabled={locked || loading || !canManage}><legend>기본표와 적용 기간</legend><label>운영할 기본 주간표<select aria-label="운영할 기본 주간표" value={form.planId} onChange={e => change({ planId: e.target.value })}><option value="">기본표 선택</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title} · {p.version}판</option>)}</select></label>
    {selected && <p>{selected.teachers}명 · {selected.classes}학급 · 주 {selected.weeklyLessons}교시 · 기본표 기간 {selected.from} ~ {dateOffset(selected.until, -1)}</p>}
    <div className="ttops-form-row"><label>운영 연결 시작일<input aria-label="운영 연결 시작일" type="date" value={form.from} onChange={e => change({ from: e.target.value })} /></label><label>운영 연결 마지막 날<input aria-label="운영 연결 마지막 날" type="date" value={form.lastDay} onChange={e => change({ lastDay: e.target.value })} /></label></div>
    {input && !inRange && <p>오늘 이후이며 기본표 기간 안인 날짜를 선택하세요.</p>}<button disabled={!inRange} onClick={() => void inspect()}>날짜별 연결 미리보기</button><button type="button" className="secondary" onClick={() => { setRetry(v => v + 1); setPreview(undefined) }}>기본표 목록 다시 확인</button>
   </fieldset>
   {preview && <section className="ttops-preview" aria-label="운영 연결 미리보기"><h4>{preview.input.from} ~ {dateOffset(preview.input.until, -1)} 연결 검토</h4><p>{preview.summary.teachers}명 · {preview.summary.classes}학급 · 기본 주 {preview.summary.weeklyLessons}교시 / 날짜별 변경 {preview.summary.changedLessons}건</p><p>기존 편성 기준판과 준비 입력은 유지합니다. 휴업·교환으로 이미 변경된 수업은 기존 T2 규칙으로 보존합니다. 미리보기는 날짜별 수업을 바꾸지 않습니다.</p>
    {preview.blockers.length > 0 && <div role="alert"><strong>연결 전에 확인할 항목</strong><ul>{preview.blockers.map((b, n) => <li key={n}>{b.message}</li>)}</ul></div>}
    {!!preview.excludedDays.length && <details><summary>미편성 날짜 {preview.excludedDays.length}일</summary><ul>{preview.excludedDays.map(d => <li key={d.date}>{d.date} · {d.reason}</li>)}</ul></details>}
    <OperationChangeList changes={preview.changes} timeZone={preview.timeZone} />
    {!preview.changes.length && !preview.blockers.length && <p>이 기간에 새로 반영할 수업이 없습니다. 이미 반영된 수업과 지난 수업은 다시 만들지 않습니다.</p>}
    {expired && <p role="alert">미리보기가 만료됐습니다. 같은 기간을 다시 확인하세요.</p>}
    <label><input type="checkbox" checked={confirmed} disabled={locked || expired || Boolean(preview.blockers.length)} onChange={e => setConfirmed(e.target.checked)} />교사·기간·변경 수업을 확인했으며 날짜별 운영에 반영합니다.</label>
    <button disabled={locked || !confirmed || expired || Boolean(preview.blockers.length) || !preview.changes.length || !canManage} onClick={() => void send(false)}>확인한 날짜별 수업 반영</button>
   </section>}
   {dirty && <button className="secondary" disabled={locked} onClick={() => { memory.remove(); setDirty(false); setForm({ planId: '', from: date, lastDay: dateOffset(date, 6) }); setPreview(undefined); setConfirmed(false); setError('') }}>연결 입력 비우기</button>}
  </>}
 </section>
}
