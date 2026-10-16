import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { OperationsView } from './operations-contracts'
import type { OperationReferenceView, OperationsExtensions, SchoolDayChangePreview } from './operations-next-contracts'
import { useEditDraft } from '../app/edit-drafts'
import { ServiceError, canonical } from '../services/scoped-rpc'
import limits from './operations-api-limits.json'
import { dateOffset } from './OperationChangeList'

interface Draft { date: string; groupIds: string[]; reason: string }
interface Props { member: Membership; view: OperationsView | null; references?: OperationReferenceView; extensions?: OperationsExtensions; locked: boolean; onDirtyChange: (dirty: boolean) => void }
/** 학사 변경을 임시교환으로 위장하지 않는다. 서버의 영향 검토만 요청하고 승인 명령은 별도 계약이다. */
export function SchoolDayChangePanel({ member, view, references, extensions, locked, onDirtyChange }: Props) {
  const id = useId(), memory = useEditDraft<Draft>(member, 'timetable-school-day')
  const [draft, setDraft] = useState<Draft>(() => memory.initial ?? { date: '', groupIds: [], reason: '' })
  const [preview, setPreview] = useState<SchoolDayChangePreview>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const sequence = useRef(0), source = view ? canonical([view.asOf, view.from, view.until, view.canPublish, view.lessons]) : ''
  const current = useRef(source); current.current = source
  const dirty = Boolean(draft.date || draft.groupIds.length || draft.reason)
  const visible = Boolean(view?.canPublish), referencesCurrent = references && references.asOf === view?.asOf && references.from === view?.from && references.until === view?.until
  const groups = [...new Map((referencesCurrent ? references.lessons : []).flatMap(lesson => lesson.groups.map(group => [group.id, group.name] as const)))].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false) }, [dirty, busy, onDirtyChange])
  useEffect(() => { sequence.current++; setPreview(undefined); return () => { sequence.current++ } }, [source])
  function update(patch: Partial<Draft>) { if (locked || busy) return; const next = { ...draft, ...patch }; setDraft(next); memory.save(next, Boolean(next.date || next.groupIds.length || next.reason)); setPreview(undefined); setError(''); sequence.current++ }
  function clear() { if (locked || busy) return; setDraft({ date: '', groupIds: [], reason: '' }); memory.remove(); setPreview(undefined); setError(''); sequence.current++ }
  async function inspect() {
    if (!view?.canPublish || !extensions || !referencesCurrent || locked || busy || !draft.date || !draft.reason.trim() || !draft.groupIds.length || draft.groupIds.some(key => !groups.some(([group]) => group === key))) return
    const token = ++sequence.current, original = source; setBusy(true); setError(''); setPreview(undefined)
    try { const result = await extensions.previewSchoolDay(member.id, { kind: 'closure', date: draft.date, groupIds: [...draft.groupIds], reason: draft.reason.trim(), bells: [] }, view, references!); if (token === sequence.current && current.current === original) setPreview(result) }
    catch (failure) { if (token === sequence.current) setError(failure instanceof ServiceError ? failure.message : '영향을 확인하지 못했습니다. 입력은 보관했습니다.') }
    finally { setBusy(false) }
  }
  if (!visible && !dirty) return null
  if (!visible) return <section className="ttops-card" aria-label="학사 변경 초안 보관"><p>담당 권한과 최신 자료를 확인할 때까지 학사 변경 입력을 숨깁니다.</p><button type="button" className="secondary" disabled={locked || busy} onClick={clear}>학사 변경 초안 버리기</button></section>
  return <details className="ttops-card"><summary>행사·휴업에 따른 수업 변경 검토</summary><p className="ttops-muted">공유 일정만 등록해 수업을 자동 취소하지 않습니다. 날짜와 대상 학급을 정한 뒤 영향을 먼저 확인합니다.</p>
    {!extensions || !referencesCurrent ? <p role="status">학급 식별 정보와 학사 변경 서버 연결을 준비 중입니다.</p> : <fieldset className="ttops-fields" disabled={locked || busy}><legend>수업 없는 날짜의 초안</legend><label>학사 변경 날짜<input type="date" aria-label="학사 변경 날짜" min={view!.from} max={dateOffset(view!.until, -1)} value={draft.date} onChange={event => update({ date: event.target.value })} /></label><fieldset className="ttops-fields"><legend>영향받는 학급</legend>{groups.map(([key, name]) => <label key={key} className="ttops-check"><input type="checkbox" checked={draft.groupIds.includes(key)} onChange={event => update({ groupIds: event.target.checked ? [...draft.groupIds, key] : draft.groupIds.filter(item => item !== key) })} />{name}</label>)}</fieldset><label>학사 변경 사유<textarea maxLength={limits.reason} aria-label="학사 변경 사유" value={draft.reason} onChange={event => update({ reason: event.target.value })} /></label><button type="button" disabled={!draft.date || !draft.groupIds.length || !draft.reason.trim()} onClick={() => void inspect()}>{busy ? '수업 영향 확인 중…' : '학사 변경 영향만 확인'}</button></fieldset>}
    {error && <p role="alert" className="ttops-error">{error}</p>}
    {preview && <section aria-labelledby={id + '-preview'}><h4 id={id + '-preview'}>학사 변경 검토 결과</h4><p>영향받는 수업 {preview.affectedLessons.length}건 · 처리 중인 교환 요청 {preview.pendingRequests}건</p>{preview.blockers.length > 0 && <ul>{preview.blockers.map((blocker, index) => <li key={index}>{blocker.message}</li>)}</ul>}<p role="status">아직 실제 시간표는 바뀌지 않았습니다. 학사 변경 승인·반영 연결은 별도 검토 후 제공합니다.</p></section>}
    {dirty && <button type="button" className="secondary" disabled={locked || busy} onClick={clear}>학사 변경 초안 버리기</button>}
  </details>
}
