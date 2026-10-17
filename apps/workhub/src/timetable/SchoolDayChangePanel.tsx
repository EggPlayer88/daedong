import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { OperationsView } from './operations-contracts'
import type { OperationReferenceView, OperationsExtensions, SchoolDayChangePreview } from './operations-next-contracts'
import type { SchoolDayCommitCommand, SchoolDayCommitReceipt, SchoolDayExecutionInput, SchoolDayExecutionPreview, SchoolDayExecutionServer } from './school-day-execution-contracts'
import { schoolDayCommitCommand, schoolDayLocalTime, schoolDaySourceLessons } from './school-day-execution-server'
import { useEditDraft } from '../app/edit-drafts'
import { ServiceError, canonical } from '../services/scoped-rpc'
import limits from './operations-api-limits.json'
import { dateOffset } from './OperationChangeList'

interface Draft { kind?: 'closure' | 'special_bells'; date: string; groupIds: string[]; reason: string; bells?: Record<string, { start?: string; end?: string }> }
interface Props {
  member: Membership; view: OperationsView | null; references?: OperationReferenceView; extensions?: OperationsExtensions
  execution?: SchoolDayExecutionServer; onCommand?: (command: SchoolDayCommitCommand) => Promise<SchoolDayCommitReceipt>
  onBusyChange?: (busy: boolean) => void; locked: boolean; onDirtyChange: (dirty: boolean) => void
}
const emptyDraft = (): Draft => ({ kind: 'closure', date: '', groupIds: [], reason: '', bells: {} })
/** 입력은 보존하고 내용 확인 후에만 부모의 공통 요청 보관으로 명령을 넘긴다. */
export function SchoolDayChangePanel({ member, view, references, extensions, execution, onCommand, onBusyChange, locked, onDirtyChange }: Props) {
  const id = useId(), memory = useEditDraft<Draft>(member, 'timetable-school-day')
  const [draft, setDraft] = useState<Draft>(() => memory.initial ?? emptyDraft())
  const [preview, setPreview] = useState<SchoolDayExecutionPreview>(), [legacyPreview, setLegacyPreview] = useState<SchoolDayChangePreview>()
  const [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const sequence = useRef(0), mounted = useRef(true), source = view ? canonical([view.asOf, view.from, view.until, view.canPublish, view.lessons, view.requests, references]) : ''
  const current = useRef(source); current.current = source
  const dirty = Boolean(draft.date || draft.groupIds.length || draft.reason), blocked = locked || busy || sending
  const visible = Boolean(view?.canPublish), referencesCurrent = Boolean(references && references.asOf === view?.asOf && references.from === view?.from && references.until === view?.until)
  const groups = [...new Map((referencesCurrent ? references!.lessons : []).flatMap(lesson => lesson.groups.map(group => [group.id, group.name] as const)))].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  const canExecute = Boolean(execution && onCommand), kind = draft.kind ?? 'closure'
  const clock = (at: string) => new Intl.DateTimeFormat('en-GB', { timeZone: view!.timeZone, hour: '2-digit', minute: '2-digit', ...(new Date(at).getUTCSeconds() ? { second: '2-digit' as const } : {}), hourCycle: 'h23' }).format(new Date(at))
  const sourceLessons = view && referencesCurrent ? schoolDaySourceLessons({ kind, date: draft.date, groupIds: draft.groupIds, reason: draft.reason, bells: [] }, view, references!) : []
  const sourceTimes = [...new Map(sourceLessons.map(lesson => [canonical(lesson.time), lesson.time]))].sort((a, b) => a[1].startsAt.localeCompare(b[1].startsAt))
  useEffect(() => { onDirtyChange(dirty || busy || sending); return () => onDirtyChange(false) }, [dirty, busy, sending, onDirtyChange])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
  useEffect(() => { sequence.current++; setPreview(undefined); setLegacyPreview(undefined); setConfirmed(false); return () => { sequence.current++ } }, [source])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++ } }, [])
  function update(patch: Partial<Draft>) { if (blocked) return; const next = { ...draft, ...patch }; setDraft(next); memory.save(next, Boolean(next.date || next.groupIds.length || next.reason)); setPreview(undefined); setLegacyPreview(undefined); setConfirmed(false); setError(''); setSuccess(''); sequence.current++ }
  function clear() { if (blocked) return; setDraft(emptyDraft()); memory.remove(); setPreview(undefined); setLegacyPreview(undefined); setConfirmed(false); setError(''); setSuccess(''); sequence.current++ }
  async function inspect() {
    if (!view?.canPublish || !referencesCurrent || blocked || !draft.date || !draft.reason.trim() || !draft.groupIds.length || draft.groupIds.some(key => !groups.some(([group]) => group === key))) return
    const token = ++sequence.current, original = source; setBusy(true); setError(''); setSuccess(''); setPreview(undefined); setLegacyPreview(undefined); setConfirmed(false)
    try {
      if (execution && onCommand) {
        const input: SchoolDayExecutionInput = { kind, date: draft.date, groupIds: [...draft.groupIds].sort(), reason: draft.reason.trim(), bells: kind === 'closure' ? [] : sourceTimes.map(([key, before]) => { const value = draft.bells?.[key]; return { before, after: { startsAt: value?.start === undefined ? before.startsAt : schoolDayLocalTime(draft.date, value.start, view.timeZone), endsAt: value?.end === undefined ? before.endsAt : schoolDayLocalTime(draft.date, value.end, view.timeZone) } } }) }
        const result = await execution.preview(member.id, input, view, references!)
        if (token === sequence.current && current.current === original) setPreview(result)
      } else if (extensions) {
        const result = await extensions.previewSchoolDay(member.id, { kind: 'closure', date: draft.date, groupIds: [...draft.groupIds], reason: draft.reason.trim(), bells: [] }, view, references!)
        if (token === sequence.current && current.current === original) setLegacyPreview(result)
      }
    } catch (failure) { if (token === sequence.current) setError(failure instanceof ServiceError ? failure.message : '영향을 확인하지 못했습니다. 입력은 보관했습니다.') }
    finally { if (mounted.current) setBusy(false) }
  }
  async function commit() {
    if (!preview || !view || !references || !onCommand || blocked || !confirmed || preview.blockers.length || !preview.changes.length || Date.parse(preview.expiresAt) <= Date.now()) return
    setSending(true); setError('')
    try {
      const receipt = await onCommand(schoolDayCommitCommand(preview, view, references))
      if (mounted.current) { setDraft(emptyDraft()); memory.remove(); setPreview(undefined); setConfirmed(false); setSuccess(`학사 변경을 반영했습니다. 수업 ${receipt.changedLessonCount}건 · 보강 검토 ${receipt.lostLessonCount}차시`) }
    } catch (failure) { if (mounted.current) setError(failure instanceof ServiceError ? failure.message : '반영 결과를 확인하지 못했습니다. 입력과 원래 요청 번호를 보관합니다.') }
    finally { if (mounted.current) setSending(false) }
  }
  if (!visible && !dirty) return null
  if (!visible) return <section className="ttops-card" aria-label="학사 변경 초안 보관"><p>담당 권한과 최신 자료를 확인할 때까지 학사 변경 입력을 숨깁니다.</p><button type="button" className="secondary" disabled={blocked} onClick={clear}>학사 변경 초안 버리기</button></section>
  return <details className="ttops-card"><summary>행사·휴업·특별일과 관리</summary><p className="ttops-muted">날짜와 학급을 정하고 바뀔 수업을 확인합니다. 행사 일정 등록만으로 수업이 취소되지는 않습니다.</p>
    {(!extensions && !canExecute) || !referencesCurrent ? <p role="status">학급 식별 정보와 학사 변경 서버 연결을 준비 중입니다.</p> : <fieldset className="ttops-fields" disabled={blocked}><legend>학사 변경 입력</legend>
      {canExecute && <label>변경 종류<select aria-label="학사 변경 종류" value={kind} onChange={event => update({ kind: event.target.value as Draft['kind'] })}><option value="closure">휴업·행사로 수업 취소</option><option value="special_bells">특별일과로 수업 시각 변경</option></select></label>}
      <label>학사 변경 날짜<input type="date" aria-label="학사 변경 날짜" min={view!.from} max={dateOffset(view!.until, -1)} value={draft.date} onChange={event => update({ date: event.target.value, bells: {} })} /></label>
      <fieldset className="ttops-fields"><legend>영향받는 학급</legend>{groups.map(([key, name]) => <label key={key} className="ttops-check"><input type="checkbox" checked={draft.groupIds.includes(key)} onChange={event => update({ groupIds: event.target.checked ? [...draft.groupIds, key] : draft.groupIds.filter(item => item !== key), bells: {} })} />{name}</label>)}</fieldset>
      {canExecute && kind === 'special_bells' && <fieldset className="ttops-fields"><legend>현재 수업 시각 → 특별일과 시각 ({view!.timeZone})</legend><p className="ttops-muted">교시를 추정하지 않고 선택한 학급의 실제 수업 시각에 연결합니다.</p>{sourceTimes.map(([key, before], index) => <div key={key}><p>현재 {clock(before.startsAt)}–{clock(before.endsAt)}</p><label>변경 시작<input type="time" aria-label={`특별일과 ${index + 1} 시작`} value={draft.bells?.[key]?.start ?? clock(before.startsAt)} onChange={event => update({ bells: { ...draft.bells, [key]: { ...draft.bells?.[key], start: event.target.value } } })} /></label><label>변경 종료<input type="time" aria-label={`특별일과 ${index + 1} 종료`} value={draft.bells?.[key]?.end ?? clock(before.endsAt)} onChange={event => update({ bells: { ...draft.bells, [key]: { ...draft.bells?.[key], end: event.target.value } } })} /></label></div>)}{!sourceTimes.length && <p>선택한 날짜·학급의 예정 수업을 먼저 확인해 주세요.</p>}</fieldset>}
      <label>학사 변경 사유<textarea maxLength={limits.reason} aria-label="학사 변경 사유" value={draft.reason} onChange={event => update({ reason: event.target.value })} /></label><button type="button" disabled={!draft.date || !draft.groupIds.length || !draft.reason.trim()} onClick={() => void inspect()}>{busy ? '수업 영향 확인 중…' : canExecute ? '바뀔 수업 미리보기' : '학사 변경 영향만 확인'}</button>
    </fieldset>}
    {error && <p role="alert" className="ttops-error">{error}</p>}{success && <p role="status">{success}</p>}
    {legacyPreview && <section aria-labelledby={id + '-legacy'}><h4 id={id + '-legacy'}>학사 변경 검토 결과</h4><p>영향받는 수업 {legacyPreview.affectedLessons.length}건 · 처리 중인 교환 요청 {legacyPreview.pendingRequests}건</p>{legacyPreview.blockers.length > 0 && <ul>{legacyPreview.blockers.map((blocker, index) => <li key={index}>{blocker.message}</li>)}</ul>}<p role="status">아직 실제 시간표는 바뀌지 않았습니다. 학사 변경 승인·반영 연결은 별도 검토 후 제공합니다.</p></section>}
    {preview && <section aria-labelledby={id + '-preview'}><h4 id={id + '-preview'}>반영 전 수업 확인</h4><p>대상 수업 {preview.affectedLessons.length}건 · 변경 {preview.changes.length}건 · 보강 검토 {preview.lostLessonCount}차시 · 줄어드는 수업 시간 {preview.lostMinutes}분</p><p className="ttops-muted">보강 수업은 자동 생성하지 않습니다. 취소·단축된 수업은 담당자가 따로 검토해 주세요.</p>
      <ul className="ttops-list">{preview.changes.map(change => <li key={change.after.id}><strong>{change.after.groupNames.join(', ')} · {change.after.label}</strong><p>{change.after.teachers.map(teacher => teacher.name).join(', ')}</p><p>변경 전 {clock(change.before!.time.startsAt)}–{clock(change.before!.time.endsAt)} → {change.after.state === 'cancelled' ? '수업 취소' : `변경 후 ${clock(change.after.time.startsAt)}–${clock(change.after.time.endsAt)}`}</p></li>)}</ul>
      {preview.blockers.length > 0 && <div role="alert"><p>먼저 해결할 항목이 있어 반영할 수 없습니다.</p><ul>{preview.blockers.map(blocker => <li key={blocker.code}>{blocker.message}</li>)}</ul></div>}
      {preview.requestEffects.length > 0 && <p>기존 교환 {preview.requestEffects.length}건은 임의로 취소하거나 덮어쓰지 않습니다.</p>}
      <label className="ttops-check"><input type="checkbox" checked={confirmed} disabled={blocked || preview.blockers.length > 0 || !preview.changes.length} onChange={event => setConfirmed(event.target.checked)} />대상 학급·변경 전후·보강 검토 수를 확인했습니다</label><button type="button" disabled={blocked || !confirmed || preview.blockers.length > 0 || !preview.changes.length || Date.parse(preview.expiresAt) <= Date.now()} onClick={() => void commit()}>{sending ? '학사 변경 반영 중…' : '확인한 학사 변경 반영'}</button><p className="ttops-muted">담당자가 확인한 이번 날짜의 변경만 한 번에 반영합니다.</p>
    </section>}
    {dirty && <button type="button" className="secondary" disabled={blocked} onClick={clear}>학사 변경 초안 버리기</button>}
  </details>
}
