import { useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest, type TimetableRecovery } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import type { PreparationSource } from './preparation'
import type { TimetableImportCommand, TimetableImportPreview, TimetableImportReceipt, TimetableImportServer } from './import-contracts'
import { reviewTimetableImport, timetableImportPilotTemplate, timetableImportReference, timetableImportTemplate } from './import-csv'
import { getPilotFixture } from './pilot/fixture'

interface Props {
  server: TimetableImportServer; member: Membership; onLockChange?: (locked: boolean) => void
  onOpenPublish?: (draft: { id: string; version: number }) => void; onOpenSchoolAdmin?: () => void; onOpenTeaching?: () => void
}
interface Input { title: string; csv: string }
interface Session { input: Input; receipt?: TimetableImportReceipt }
const initial = (): Input => ({ title: '가져온 학기 시간표', csv: '' })
const message = (e: unknown) => e instanceof Error ? e.message : '처리 결과를 확인하지 못했습니다. 입력과 요청 번호는 보관했습니다.'
const rejection = (e: unknown) => e instanceof ServiceError && ['NOT_READY', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'CONFLICT'].includes(e.code)
function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function TimetableImportPanel({ server, member, onLockChange, onOpenPublish, onOpenSchoolAdmin, onOpenTeaching }: Props) {
  const memory = useEditDraft<Session>(member, 'timetable-import'), recovery = usePendingRequest(member, 'timetableImport')
  const [input, setInput] = useState<Input>(memory.initial?.input ?? initial()), [receipt, setReceipt] = useState(memory.initial?.receipt)
  const [source, setSource] = useState<PreparationSource>(), [preview, setPreview] = useState<TimetableImportPreview>()
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false), [closeConfirmed, setCloseConfirmed] = useState(false), [discard, setDiscard] = useState(false)
  const [now, setNow] = useState(Date.now()), life = useRef(0), running = useRef(false), fileGeneration = useRef(0)
  const pending = recovery.request as (TimetableRecovery & { command: TimetableImportCommand }) | undefined
  const locked = busy || Boolean(pending), dirty = Boolean(input.csv)
  const current = useRef({ pending, input, preview }); current.current = { pending, input, preview }
  useEffect(() => { life.current++; return () => { life.current++; fileGeneration.current++; running.current = false } }, [server, recoveryScope(member)])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { onLockChange?.(locked || dirty); return () => onLockChange?.(false) }, [locked, dirty, onLockChange])
  useEffect(() => {
    if (!locked && !dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [locked, dirty])
  function change(next: Input) { fileGeneration.current++; setInput(next); memory.save({ input: next }, Boolean(next.csv)); setPreview(undefined); setReceipt(undefined); setConfirmed(false); setError('') }
  async function load() {
    if (running.current || current.current.pending) return
    const epoch = life.current; setLoading(true); setError(''); setSource(undefined); setPreview(undefined); setConfirmed(false)
    try { const value = await server.get(member.id); if (epoch === life.current) setSource(value) }
    catch (e) { if (epoch === life.current) setError(message(e)) }
    finally { if (epoch === life.current) setLoading(false) }
  }
  useEffect(() => { if (!pending) void load() }, [server, member.id])
  async function inspect() {
    if (!source || running.current || pending) return
    const epoch = life.current, original = current.current.input
    running.current = true; setBusy(true); setError(''); setPreview(undefined); setConfirmed(false)
    try {
      const normalized = await reviewTimetableImport(source, original.csv, original.title)
      if (epoch !== life.current) return
      const value = await server.preview(member.id, normalized)
      if (epoch === life.current && current.current.input === original) setPreview(value)
    } catch (e) { if (epoch === life.current) setError(message(e)) }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  function completed(value: TimetableImportReceipt, key: string) {
    recovery.remove(key); setReceipt(value); setInput(initial()); memory.save({ input: initial(), receipt: value }, false)
    setPreview(undefined); setConfirmed(false); setCloseConfirmed(false); setError('')
  }
  async function send(close = false) {
    if (running.current) return
    const original = current.current.pending
    if (!original && (!preview || !confirmed || Date.parse(preview.expiresAt) <= Date.now())) return
    if (close && (!original || !closeConfirmed)) return
    const request = original ?? { key: crypto.randomUUID(), command: { previewId: preview!.previewId, fingerprint: preview!.fingerprint, input: preview!.input } }
    const closing = close || request.closeState === 'closing'
    // 닫기 의도를 요청 전에 보관한다. 응답 유실·재마운트 뒤 commit으로 돌아가지 않는다.
    recovery.put({ ...request, ...(closing ? { closeState: 'closing' as const } : {}) })
    const epoch = life.current; running.current = true; setBusy(true); setError('')
    try {
      if (closing) {
        const result = await server.close(member.id, request.command, request.key)
        if (epoch !== life.current) return
        if (result.outcome === 'applied') completed(result.receipt!, request.key)
        else { recovery.remove(request.key); setPreview(undefined); setConfirmed(false); setCloseConfirmed(false); setError('요청을 닫았습니다. 입력을 유지했으니 현재 자료를 다시 불러와 비교할 수 있습니다.') }
      } else {
        const value = await server.commit(member.id, request.command, request.key)
        if (epoch === life.current) completed(value, request.key)
      }
    } catch (e) {
      if (epoch === life.current) {
        if (!original && !closing && rejection(e)) { recovery.remove(request.key); setPreview(undefined); setConfirmed(false) }
        setError(message(e))
      }
    } finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  return <section className="timetable-card" aria-label="실제 시간표 가져오기">
    <h2>실제 시간표 가져오기</h2>
    <p>선택한 학기의 공식 수업에 시간표를 연결하고, 공개 전 초안으로 저장합니다. 기존 공개 시간표와 과거 운영 기록은 유지됩니다.</p>
    {error && <p role="alert" className="timetable-error">{error}</p>}
    {pending && <section aria-label="가져오기 요청 복구">
      <p>처리 결과를 확인하고 있습니다. 원래 요청 번호와 입력을 보관했습니다.</p>
      <button type="button" disabled={busy} onClick={() => void send()}>{pending.closeState === 'closing' ? '닫기 결과 다시 확인' : '같은 요청으로 결과 확인'}</button>
      {pending.closeState !== 'closing' && <><label><input type="checkbox" checked={closeConfirmed} disabled={busy} onChange={e => setCloseConfirmed(e.target.checked)} />이미 저장되었다면 결과를 확인하고, 미처리 요청은 닫습니다.</label><button type="button" className="secondary" disabled={busy || !closeConfirmed} onClick={() => void send(true)}>이 요청 닫기</button></>}
    </section>}
    {receipt && <section role="status"><h3>서버 초안 저장 완료</h3><p>수업 {receipt.lessonCount}개 · 기준판 {receipt.basisRevision}판. 공개할 적용일과 변경 영향을 다음 화면에서 확인하세요.</p><button type="button" disabled={locked} onClick={() => onOpenPublish?.({ id: receipt.draftId, version: receipt.draftVersion })}>이 초안의 공개 검토</button></section>}
    <div className="timetable-actions">
      <button type="button" className="secondary" disabled={locked || loading} onClick={() => void load()}>{loading ? '학교 자료 확인 중…' : '현재 학교 자료 다시 확인'}</button>
      <button type="button" className="text-button" disabled={locked || dirty} onClick={onOpenSchoolAdmin}>교사·학급 관리</button>
      {onOpenTeaching && <button type="button" className="text-button" disabled={locked || dirty} onClick={onOpenTeaching}>수업·학생 정정</button>}
    </div>
    {source && <><p><strong>{source.termLabel}</strong> · {source.firstDay} ~ {source.lastDay} · 수업 {source.courses.length}개</p>
      <details><summary>가져오기 순서와 양식</summary>
        <ol><li>교사·학급·공간을 학교 자료에 등록하고 수업과 연결합니다.</li><li>학교 ID가 채워진 양식을 내려받아 요일·시각을 채웁니다. 여러 ID는 | 로 구분합니다.</li><li>전체 수업의 시수와 충돌을 비교한 뒤 초안으로 저장합니다.</li><li>공개 검토에서 적용 기간을 선택합니다. 연습의 동의·승인은 옮기지 않습니다.</li></ol>
        <div className="timetable-actions">
          <button type="button" className="secondary" disabled={locked} onClick={async () => { const epoch = life.current; try { const content = await timetableImportTemplate(source); if (epoch === life.current) download('학교시간표_입력양식.csv', content) } catch { if (epoch === life.current) setError('입력 양식을 만들지 못했습니다. 현재 학교 자료를 다시 확인해 주세요.') } }}>학교 자료로 양식 받기</button>
          <button type="button" className="secondary" disabled={locked} onClick={() => download('학교자료_ID목록.csv', timetableImportReference(source))}>수업·교사·학급·공간 ID 목록</button>
          <button type="button" className="secondary" disabled={locked} onClick={() => download('9학급_연습배치_연결양식.csv', timetableImportPilotTemplate(getPilotFixture()))}>9학급 연습 배치로 시작</button>
        </div><p className="timetable-muted">연습 배치의 실제 수업 ID는 비어 있습니다. 이름이 같다는 이유로 자동 연결하지 않습니다.</p>
      </details></>}
    <fieldset disabled={locked || loading}><label>초안 이름<input aria-label="가져올 시간표 이름" maxLength={100} value={input.title} onChange={e => change({ ...input, title: e.target.value })} /></label>
      <label>UTF-8 CSV 파일<input type="file" accept=".csv,text/csv" onChange={async e => {
        const file = e.target.files?.[0], epoch = life.current, generation = ++fileGeneration.current
        e.target.value = ''; if (!file) return
        if (file.size > 2 * 1024 * 1024) { setError('CSV는 2MB 이하로 선택해 주세요.'); return }
        try { const content = await file.text(); if (epoch === life.current && generation === fileGeneration.current && !running.current && !current.current.pending) change({ ...current.current.input, csv: content }) }
        catch { if (epoch === life.current) setError('파일을 읽지 못했습니다. 기존 입력을 유지합니다.') }
      }} /></label>
      <label>CSV 내용<textarea aria-label="시간표 CSV 내용" rows={6} value={input.csv} onChange={e => change({ ...input, csv: e.target.value })} /></label>
      <button type="button" disabled={!source || !input.csv} onClick={() => void inspect()}>공식 자료와 배치 비교</button>
    </fieldset>
    {preview && <section aria-label="가져오기 비교 결과">
      <h3>수업 {preview.courseCount}개 · 활동 {preview.lessonCount}개 검사 통과</h3>
      <p>교사·학급·공간 연결, 수업시수와 중복 배치를 확인했습니다. 준비 초안을 갱신하고 새 기준판·편성 초안을 함께 저장합니다.</p>
      <label><input type="checkbox" checked={confirmed} disabled={locked} onChange={e => setConfirmed(e.target.checked)} />공식 연결과 배치를 확인했습니다.</label>
      <button type="button" disabled={locked || !confirmed || Date.parse(preview.expiresAt) <= now} onClick={() => void send()}>서버 초안으로 저장</button>
      {Date.parse(preview.expiresAt) <= now && <p role="status">비교 시간이 지났습니다. 다시 비교해 주세요.</p>}
    </section>}
    {dirty && !locked && <details><summary>작성 중인 내용 비우기</summary><label><input type="checkbox" checked={discard} onChange={e => setDiscard(e.target.checked)} />현재 CSV 입력을 비웁니다.</label><button type="button" disabled={!discard} onClick={() => { change(initial()); memory.remove(); setDiscard(false) }}>입력 비우기</button></details>}
  </section>
}
