import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/service-values'
import { PlanEditor } from './PlanEditor'
import { createTeacherRosterServer } from './server'
import { localPlan, type Command, type Intent, type Plan, type Preview, type RosterServer, type Snapshot } from './contracts'
import limits from './limits.json'
import styles from './teacher-roster.css?inline'

type Props = { connection: SupabaseConnection; member: Membership; date: string; onNavigationLockChange?: (locked: boolean) => void; onUpdated?: () => void; server?: RosterServer }
type Draft = { plan?: Plan; dirty: boolean; teacherId: string; memberId: string; from: string; until: string; candidates: { classId: string; teacherId: string }[]; accountCandidates?: { teacherId: string; memberId: string }[] }
const fail = (e: unknown) => e instanceof ServiceError ? e.message : '확인하지 못했습니다. 작성 내용과 요청 번호는 유지했습니다.'
const safeRejection = (e: unknown) => e instanceof ServiceError && ['INVALID_INPUT', 'CONFLICT', 'NOT_READY', 'FORBIDDEN', 'NOT_FOUND', 'INACTIVE_MEMBERSHIP'].includes(e.code)

export function TeacherRosterPanel(props: Props) { return <RosterScope key={recoveryScope(props.member)} {...props} /> }
function RosterScope({ connection, member, date, onNavigationLockChange, onUpdated, server: supplied }: Props) {
  const server = useMemo(() => supplied ?? createTeacherRosterServer(connection), [supplied, connection])
  const memory = useEditDraft<Draft>(member, 'teacher-roster-editor'), recovery = usePendingRequest(member, 'teacherRoster')
  const [draft, setDraft] = useState<Draft>(() => memory.initial ?? { dirty: false, teacherId: '', memberId: '', from: date, until: '', candidates: [] })
  const [data, setData] = useState<Snapshot>(), [preview, setPreview] = useState<Preview>()
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [checked, setChecked] = useState(false), [closeChecked, setCloseChecked] = useState(false), [reload, setReload] = useState(0), [now, setNow] = useState(Date.now())
  const generation = useRef(0), running = useRef(false)
  const pending = recovery.request as { command: Command; key: string; closeState?: 'closing' } | undefined
  const locked = busy || Boolean(pending), dirty = draft.dirty || Boolean(draft.teacherId || draft.memberId)
  useEffect(() => { generation.current++; return () => { generation.current++ } }, [server])
  useEffect(() => { onNavigationLockChange?.(locked || dirty); return () => onNavigationLockChange?.(false) }, [locked, dirty, onNavigationLockChange])
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  useEffect(() => { setCloseChecked(false) }, [pending?.key])
  useEffect(() => { let live = true; setLoading(true); setData(undefined); server.get(member.id).then(v => { if (live) setData(v) }).catch(e => { if (live) setError(fail(e)) }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [server, member.id, reload])
  function change(patch: Partial<Draft>) { if (locked) return; const next = { ...draft, ...patch }; setDraft(next); memory.save(next, next.dirty || Boolean(next.teacherId || next.memberId)); setPreview(undefined); setChecked(false); setError(''); setNotice('') }
  function editPlan(p: Plan) { change({ plan: p, dirty: true }) }
  async function loadFile(file?: File) {
    if (!file || locked || running.current) return
    const turn = generation.current; running.current = true; setBusy(true); setError('')
    try {
      if (file.size > limits.fileBytes) throw new ServiceError('INVALID_INPUT')
      const input = JSON.parse(await file.text()); const p = localPlan(input.plan)
      if (input.format !== 'teacher-roster-plan.v1' || !data?.terms.some(t => t.id === p.termId)) throw new ServiceError('INVALID_INPUT')
      const raw = Array.isArray(input.homeroomCandidates) ? input.homeroomCandidates : []
      const candidates = raw.filter((r: { classId?: string; teacherId?: string }) => p.classes.some(c => c.id === r.classId) && p.teachers.some(t => t.id === r.teacherId)).map((r: { classId: string; teacherId: string }) => ({ classId: r.classId, teacherId: r.teacherId }))
      if (turn !== generation.current) return
      const accountCandidates = (Array.isArray(input.accountCandidates) ? input.accountCandidates : []).filter((r: { teacherId?: string; memberId?: string }) => p.teachers.some(t => t.id === r.teacherId) && data?.members.some(m => m.id === r.memberId)).slice(0, limits.teachers).map((r: { teacherId: string; memberId: string }) => ({ teacherId: r.teacherId, memberId: r.memberId }))
      const next = { ...draft, plan: p, dirty: true, candidates, accountCandidates }; setDraft(next); memory.save(next, true); setPreview(undefined); setChecked(false); setNotice('가져왔습니다. 적용 기간·기존 학급 연결·담임을 확인한 뒤 저장하세요.')
    } catch (e) { if (turn === generation.current) setError(fail(e)) } finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  async function review(input: Intent) {
    if (locked || running.current) return
    const turn = generation.current; running.current = true; setBusy(true); setError(''); setPreview(undefined); setChecked(false)
    try { const v = await server.preview(member.id, input); if (turn === generation.current) { setNow(Date.now()); setPreview(v) } } catch (e) { if (turn === generation.current) setError(fail(e)) } finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  function finish(applied: boolean, key: string) {
    recovery.remove(key); setPreview(undefined); setChecked(false); setCloseChecked(false)
    if (applied) { const next = { ...draft, dirty: false, teacherId: '', memberId: '' }; setDraft(next); memory.save(next, false); setNotice('서버 반영을 확인했습니다. 기존 계정·권한과 시간표는 유지됩니다.'); onUpdated?.() }
    else setNotice('요청을 닫았습니다. 입력은 보존했으며 늦게 도착한 같은 요청도 반영되지 않습니다.')
    setReload(v => v + 1)
  }
  async function send(retry = false, closing = false) {
    if (running.current) return
    if (!retry && (!preview || !checked || preview.findings.length || Date.parse(preview.expiresAt) <= Date.now())) return
    if (closing && !closeChecked && pending?.closeState !== 'closing') return
    const request: { key: string; command: Command; closeState?: 'closing' } | undefined = retry ? pending : preview ? { key: crypto.randomUUID(), command: { previewId: preview.id, hash: preview.hash, intent: preview.intent } } : undefined
    if (!request) return
    closing = closing || request.closeState === 'closing'
    const turn = generation.current; running.current = true; setBusy(true); setError(''); recovery.put({ ...request, ...(closing ? { closeState: 'closing' as const } : {}) })
    try {
      const result = closing ? await server.close(member.id, request.command, request.key) : await server.commit(member.id, request.command, request.key)
      if (turn === generation.current) finish(!('outcome' in result) || result.outcome === 'applied', request.key)
    } catch (e) {
      if (turn !== generation.current) return
      if (!retry && safeRejection(e)) { recovery.remove(request.key); setPreview(undefined); setReload(v => v + 1) }
      setError(fail(e))
    } finally { if (turn === generation.current) { running.current = false; setBusy(false) } }
  }
  function download() {
    if (!draft.plan) return
    const blob = new Blob([JSON.stringify({ format: 'teacher-roster-plan.v1', plan: draft.plan, homeroomCandidates: draft.candidates, accountCandidates: draft.accountCandidates ?? [] }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = '교사명부_주간시간표.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const selected = data?.plans.find(r => r.plan.id === draft.plan?.id), published = selected?.state === 'published'
  return <section className="panel teacher-roster" aria-label="교사 명부·기본 시간표"><style>{styles}</style><header><h2>교사 명부·기본 시간표</h2><p>가입 전에도 교사·수업·담임을 준비하고, 가입 후 기존 배정을 계정에 연결합니다.</p></header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">서버에서 확인 중입니다. 화면과 입력을 유지해 주세요.</p>}
    {pending && <aside className="notice"><p>결과를 확인하지 못한 요청이 있습니다. 같은 번호로 확인하거나 서버에서 닫을 수 있습니다.</p><button disabled={busy} onClick={() => void send(true)}>같은 요청으로 결과 확인</button>{pending.closeState !== 'closing' && <><label><input type="checkbox" checked={closeChecked} disabled={busy} onChange={e => setCloseChecked(e.target.checked)} />이 요청을 닫고 입력을 다시 확인하겠습니다.</label><button disabled={busy || !closeChecked} onClick={() => void send(true, true)}>이 요청 닫기</button></>}</aside>}
    <button disabled={locked} onClick={() => { setError(''); setPreview(undefined); setReload(v => v + 1) }}>현재 자료 다시 확인</button>
    {draft.plan && <button disabled={busy} onClick={download}>작성 내용 파일로 보관</button>}
    {loading && <p role="status">교사 명부를 불러오는 중…</p>}
    {data && <><fieldset disabled={locked}><legend>편성 선택</legend><select aria-label="저장한 편성" value={selected?.plan.id ?? ''} onChange={e => { const r = data.plans.find(x => x.plan.id === e.target.value); if (r) change({ plan: structuredClone(r.plan), dirty: false, candidates: [] }) }} disabled={draft.dirty}><option value="">선택</option>{data.plans.map(r => <option key={r.plan.id} value={r.plan.id}>{r.plan.title} · {r.state === 'published' ? '확정' : '초안'}</option>)}</select>
      <button disabled={draft.dirty || !data.terms.length} onClick={() => { const t = data.terms[0]; if (t) editPlan({ id: crypto.randomUUID(), termId: t.id, title: '기본 시간표', from: t.from > date ? t.from : date, until: t.until, teachers: data.teachers, classes: [], courses: [], slots: [], lessons: [], homerooms: [] }) }}>새 편성</button>
      <label>준비한 명부·시간표 가져오기<input type="file" accept=".json,application/json" disabled={draft.dirty} onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = '' }} /></label>
      {dirty && <button onClick={() => { memory.remove(); setDraft({ dirty: false, teacherId: '', memberId: '', from: date, until: '', candidates: [] }); setPreview(undefined) }}>작성 취소</button>}
    </fieldset>
    {draft.plan && <><PlanEditor value={draft.plan} onChange={editPlan} disabled={locked || published} snapshot={data} />
      {!!draft.candidates.length && !published && <details><summary>원본에서 찾은 담임 후보 (미반영)</summary>{draft.candidates.map((h, i) => <p key={i}>{draft.plan?.classes.find(c => c.id === h.classId)?.name} · {draft.plan?.teachers.find(t => t.id === h.teacherId)?.name}<button disabled={locked} onClick={() => editPlan({ ...draft.plan!, homerooms: [...draft.plan!.homerooms.filter(x => x.classId !== h.classId), h] })}>이 후보를 담임으로 선택</button></p>)}</details>}
      {!published && <button disabled={locked} onClick={() => void review({ kind: 'save', expectedRevision: data.revision, plan: draft.plan! })}>초안 저장 미리보기</button>}
      {selected && !published && !draft.dirty && canonical(selected.plan) === canonical(draft.plan) && <button disabled={locked} onClick={() => void review({ kind: 'publish', expectedRevision: data.revision, planId: selected.plan.id, version: selected.version })}>기본 시간표 확정 미리보기</button>}
      {published && <p>확정됨 · {selected.plan.lessons.length}교시. 교사 계정을 연결해도 이 배치는 바뀌지 않습니다.</p>}
    </>}
    <fieldset disabled={locked}><legend>가입 후 담당 연결</legend><p>학교 소속으로 승인된 계정을 직접 선택합니다. 로그인·관리자 권한은 변경하지 않습니다.</p>
      {!!draft.accountCandidates?.length && <details><summary>이미 확인한 계정 후보 (자동 연결 안 함)</summary>{draft.accountCandidates.map((c, i) => <p key={i}>{data.teachers.find(t => t.id === c.teacherId)?.name ?? '명부 저장 전'} → {data.members.find(m => m.id === c.memberId)?.name ?? '소속 다시 확인'}<button disabled={!data.teachers.some(t => t.id === c.teacherId) || !data.members.some(m => m.id === c.memberId)} onClick={() => change({ teacherId: c.teacherId, memberId: c.memberId, until: draft.plan?.until ?? draft.until })}>이 후보 선택</button></p>)}</details>}
      <label>명부 교사<select aria-label="명부 교사" value={draft.teacherId} onChange={e => change({ teacherId: e.target.value })}><option value="">선택</option>{data.teachers.map(t => <option key={t.id} value={t.id}>{t.name} [{t.id}]</option>)}</select></label>
      <label>연결할 학교 소속<select aria-label="연결할 학교 소속" value={draft.memberId} onChange={e => change({ memberId: e.target.value })}><option value="">선택</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.name} [{m.id}]</option>)}</select></label>
      <label>담당 시작일<input type="date" value={draft.from} onChange={e => change({ from: e.target.value })} /></label><label>담당 종료 경계일<input type="date" value={draft.until} onChange={e => change({ until: e.target.value })} /></label>
      <button disabled={!draft.teacherId || !draft.memberId || !draft.until} onClick={() => void review({ kind: 'link', expectedRevision: data.revision, teacherId: draft.teacherId, memberId: draft.memberId, from: draft.from, until: draft.until })}>담당 연결 미리보기</button>
      {data.links.map(l => <p key={`${l.teacherId}:${l.from}`}>{data.teachers.find(t => t.id === l.teacherId)?.name} → {data.members.find(m => m.id === l.memberId)?.name ?? l.memberId} · {l.from} ~ {l.until} 전</p>)}
    </fieldset></>}
    {preview && !pending && <section aria-label="반영 전 확인"><h3>{preview.intent.kind === 'save' ? '초안 저장' : preview.intent.kind === 'publish' ? '기본 시간표 확정' : '계정과 담당 연결'}</h3><p>교사 {preview.summary.teachers}명 · 수업 {preview.summary.courses}개 · {preview.summary.lessons}교시 · 담임 {preview.summary.homerooms}개</p>{preview.findings.map((f, i) => <p role="alert" key={i}>{f.message}</p>)}{preview.intent.kind === 'link' && <p>{data?.teachers.find(t => t.id === draft.teacherId)?.name} [{draft.teacherId}] → {data?.members.find(m => m.id === draft.memberId)?.name} [{draft.memberId}] · {draft.from} ~ {draft.until} 전</p>}{Date.parse(preview.expiresAt) <= now && <p role="alert">미리보기가 만료됐습니다. 입력을 유지한 채 다시 확인해 주세요.</p>}<label><input type="checkbox" checked={checked} disabled={locked} onChange={e => setChecked(e.target.checked)} />대상·적용 기간과 변경 내용을 확인했습니다.</label><button disabled={locked || !checked || !!preview.findings.length || Date.parse(preview.expiresAt) <= now} onClick={() => void send()}>확인한 내용 반영</button></section>}
  </section>
}
