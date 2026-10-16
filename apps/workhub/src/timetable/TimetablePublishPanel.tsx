import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { canonical, ServiceError } from '../services/scoped-rpc'
import type { OperationCommand, OperationReceipt, OperationsView, PublishInput, PublishPreview, TimetableOperationsServer } from './operations-contracts'
import { dateOffset, OperationChangeList } from './OperationChangeList'
import type { OperationsExtensions } from './operations-next-contracts'
import { PublicationManifestPanel } from './PublicationManifestPanel'

interface PublishForm { draftId: string; draftVersion: number; from: string; lastDay: string; dirty: boolean }
interface Props {
  server: TimetableOperationsServer; member: Membership; view: OperationsView | null; loading: boolean; locked: boolean
  onCommand: (command: OperationCommand) => Promise<OperationReceipt>; onDirtyChange: (dirty: boolean) => void
  extensions?: OperationsExtensions
}
const message = (error: unknown) => error instanceof ServiceError ? error.message : '검토 결과를 확인하지 못했습니다. 입력을 보관했습니다.'
const blank = (view: OperationsView | null): PublishForm => ({ draftId: '', draftVersion: 0, from: view?.from ?? '', lastDay: view ? dateOffset(view.until, -1) : '', dirty: false })

export function TimetablePublishPanel({ server, member, view, loading, locked, onCommand, onDirtyChange, extensions }: Props) {
  const id = useId(), memory = useEditDraft<PublishForm>(member, 'timetable-publish')
  const [form, setForm] = useState(() => memory.initial ?? blank(view)), [preview, setPreview] = useState<PublishPreview>()
  const [confirmed, setConfirmed] = useState(false), [previewing, setPreviewing] = useState(false), [error, setError] = useState('')
  const [now, setNow] = useState(Date.now), [discard, setDiscard] = useState(false)
  const epoch = useRef(0), requestRunning = useRef(false), current = useRef({ view, form, locked }), feedback = useRef<HTMLDivElement>(null)
  current.current = { view, form, locked }
  const identity = view ? canonical(view) : ''
  const source = useRef(identity)
  const selected = view?.drafts.find(row => row.id === form.draftId && row.version === form.draftVersion)
  const allowed = Boolean(view?.canPublish && !loading)
  const staleDraft = Boolean(form.draftId && !selected)
  const until = dateOffset(form.lastDay, 1)
  const input: PublishInput = { draftId: form.draftId, draftVersion: form.draftVersion, from: form.from, until }
  const validInput = Boolean(selected && dateOffset(form.from, 0) && until && form.from < until)
  const expired = Boolean(preview && Date.parse(preview.expiresAt) <= now)
  const currentPreview = Boolean(preview && source.current === identity && canonical(preview.input) === canonical(input) && !expired)
  const blocked = Boolean(preview && (preview.blockers.length || preview.preserved.existingChanges === 'blocked'))
  const canCommit = allowed && !locked && !previewing && currentPreview && confirmed && !blocked
  function update(next: PublishForm) { setForm(next); memory.save(next.dirty ? next : undefined); setPreview(undefined); setConfirmed(false); setError(''); setDiscard(false); epoch.current++ }
  useEffect(() => { onDirtyChange(form.dirty || previewing); return () => onDirtyChange(false) }, [form.dirty, previewing, onDirtyChange])
  useEffect(() => { if (!form.dirty && view) setForm(blank(view)) }, [view, form.dirty])
  useEffect(() => { epoch.current++; setPreview(undefined); setConfirmed(false); setPreviewing(false); requestRunning.current = false; source.current = identity }, [identity])
  useEffect(() => () => { epoch.current++; requestRunning.current = false }, [])
  useEffect(() => { if (!preview) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [preview])
  useEffect(() => { if (error) feedback.current?.focus() }, [error])
  function change(patch: Partial<PublishForm>) { if (!allowed || locked || previewing) return; update({ ...form, ...patch, dirty: true }) }
  async function inspect() {
    if (!allowed || locked || requestRunning.current || !validInput) { if (!validInput) setError('저장된 초안과 올바른 적용 기간을 선택해 주세요.'); return }
    requestRunning.current = true; setPreviewing(true); setError(''); setPreview(undefined); setConfirmed(false)
    const run = ++epoch.current, requested = structuredClone(input), basis = identity
    try {
      const result = await server.previewPublish(member.id, requested)
      const live = current.current, liveInput = { draftId: live.form.draftId, draftVersion: live.form.draftVersion, from: live.form.from, until: dateOffset(live.form.lastDay, 1) }
      if (run !== epoch.current || !live.view?.canPublish || live.locked || canonical(live.view) !== basis || canonical(liveInput) !== canonical(requested)) return
      if (canonical(result.input) !== canonical(requested)) throw new ServiceError('INVALID_RESPONSE')
      source.current = basis; setPreview(result); setNow(Date.now())
    } catch (failure) { if (run === epoch.current) setError(message(failure)) }
    finally { if (run === epoch.current) { requestRunning.current = false; setPreviewing(false) } }
  }
  async function publish() {
    if (!canCommit || !preview || requestRunning.current) return
    if (Date.parse(preview.expiresAt) <= Date.now()) { setNow(Date.now()); setConfirmed(false); return }
    requestRunning.current = true; setError('')
    try {
      await onCommand({ kind: 'publish', preview: { previewId: preview.previewId, previewHash: preview.previewHash, expiresAt: preview.expiresAt, input: structuredClone(preview.input) } })
      update(blank(current.current.view))
    } catch (failure) { setError(message(failure)); setConfirmed(false) }
    finally { requestRunning.current = false }
  }
  if (!allowed) return <section className="ttops-card" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>시간표 확정</h3>
    <p>{loading ? '공개 권한과 저장된 초안을 확인하는 중입니다.' : '시간표 확정 담당 권한과 서버 준비 상태가 확인되어야 초안을 열 수 있습니다.'}</p>
    {form.dirty && <p className="ttops-muted">작성 중인 입력은 현재 탭에 보관했습니다. 다시 연결되면 이어서 확인할 수 있습니다.</p>}
  </section>
  return <section className="ttops-card" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>저장한 초안을 학교 시간표로 확정</h3>
    <p className="ttops-muted">초안과 적용 기간을 고른 뒤, 실제로 달라질 수업을 확인하세요. 미리보기만으로 시간표가 바뀌지 않습니다.</p>
    <div ref={feedback} tabIndex={-1}>{error && <p role="alert" className="ttops-error">{error}</p>}</div>
    {!view?.drafts.length && <p role="status">공개할 수 있는 저장 초안이 없습니다. 편성 화면에서 초안을 먼저 저장해 주세요.</p>}
    <fieldset disabled={locked || previewing} className="ttops-fields">
      <legend>1. 초안과 적용 기간</legend>
      <label>확정할 저장 초안<select aria-label="확정할 저장 초안" value={form.draftId ? `${form.draftId}@${form.draftVersion}` : ''} onChange={event => { const draft = view!.drafts.find(row => `${row.id}@${row.version}` === event.target.value); change({ draftId: draft?.id ?? '', draftVersion: draft?.version ?? 0 }) }}>
        <option value="">초안 선택</option>{staleDraft && <option value={`${form.draftId}@${form.draftVersion}`}>이전 초안 · 현재 판 재확인 필요</option>}{view!.drafts.map(draft => <option key={draft.id} value={`${draft.id}@${draft.version}`}>{draft.title} · {draft.version}판</option>)}
      </select></label>
      <div className="ttops-form-row"><label>적용 시작일<input aria-label="적용 시작일" type="date" value={form.from} onChange={event => change({ from: event.target.value })} /></label><label>적용 마지막 날<input aria-label="적용 마지막 날" type="date" value={form.lastDay} onChange={event => change({ lastDay: event.target.value })} /></label></div>
      <p className="ttops-muted">마지막 날까지 적용합니다. 학교 시간대: {view!.timeZone}</p>
      {staleDraft && <p role="alert" className="ttops-error">선택한 초안의 판이나 공개 권한이 바뀌었습니다. 최신 초안을 다시 선택해 주세요.</p>}
      <button type="button" disabled={!validInput} onClick={() => void inspect()}>{previewing ? '변경 영향 확인 중…' : '적용 전 변경 영향 확인'}</button>
    </fieldset>
    <PublicationManifestPanel extensions={extensions} memberId={member.id} input={input} sourceKey={identity} timeZone={view!.timeZone} disabled={locked || previewing || !validInput} />
    {preview && <section className="ttops-preview" aria-labelledby={`${id}-preview`}>
      <h4 id={`${id}-preview`}>2. 적용 전 최종 확인</h4>
      <p><strong>{preview.input.from} ~ {dateOffset(preview.input.until, -1)}</strong>에 적용할 수업 {preview.changes.length}건을 확인했습니다.</p>
      <ul className="ttops-assurances"><li>적용 기간 앞뒤의 수업 보존</li><li>이미 진행한 수업과 연결 기록 보존</li><li>{preview.preserved.existingChanges === 'retained' ? '기존 수업 변경 내역 보존' : '기존 수업 변경 내역과 충돌 · 확정 불가'}</li></ul>
      {preview.blockers.length > 0 && <div role="alert" className="ttops-error"><strong>먼저 해결해야 할 항목</strong><ul>{preview.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul></div>}
      {preview.excludedDays.length > 0 && <details className="ttops-exclusions"><summary>편성에서 제외된 날짜 {preview.excludedDays.length}일</summary><ul>{preview.excludedDays.map(day => <li key={day.date}>{day.date} · {day.reason}</li>)}</ul></details>}
      <OperationChangeList changes={preview.changes} timeZone={view!.timeZone} />
      {preview.participants.length > 0 && <details><summary>영향을 받는 교사 {preview.participants.length}명</summary><p>{preview.participants.map(row => row.name).join(' · ')}</p></details>}
      {expired && <p role="alert" className="ttops-error">미리보기 유효 시간이 지났습니다. 변경 영향을 다시 확인해 주세요.</p>}
      <label className="ttops-check"><input type="checkbox" checked={confirmed} disabled={locked || expired || blocked} onChange={event => setConfirmed(event.target.checked)} />적용 기간과 변경 수업을 확인했으며, 학교 시간표로 확정합니다.</label>
      <button type="button" disabled={!canCommit} onClick={() => void publish()}>확인한 시간표 확정</button>
      <p className="ttops-muted">확정 결과는 서버 응답으로 확인합니다. 교사에게 메시지가 발송되었다는 뜻은 아닙니다.</p>
    </section>}
    {form.dirty && !locked && <div className="ttops-reset">{discard ? <><p>기간과 초안 선택을 비웁니다. 이미 확정한 시간표는 바뀌지 않습니다.</p><button type="button" className="secondary" onClick={() => update(blank(view))}>확정 입력 비우기</button><button type="button" className="secondary" onClick={() => setDiscard(false)}>계속 작성</button></> : <button type="button" className="secondary" disabled={previewing} onClick={() => setDiscard(true)}>확정 입력 정리</button>}</div>}
  </section>
}
