import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import type { SetupServer, SetupSnapshot } from './setup'
import { setupWorkbookSheets, previewSetupWorkbook, setupWorkbookSourceKey, type SetupWorkbookPreview } from './setup-workbook'
import { createSetupBatch, restoreSetupBatch, runSetupBatch, recoverSetupBatch, batchHasUnknown, previewSetupBatchConflict, approveSetupBatchConflict, type SetupBatchConflictReview, type SetupBatchConflictChoices, type SetupBatch } from './setup-batch'
import { readTimetableXlsx, writeTimetableXlsx, TimetableWorkbookError, type WorkbookSheet } from './xlsx'
import limits from './workbook-limits.json'
import './timetable-setup-batch.css'

interface Props { server?: SetupServer; snapshot?: SetupSnapshot; member: Membership; disabled: boolean; onLockChange?: (locked: boolean) => void; onActivityChange?: (busy: boolean) => void; onChanged?: () => void }
interface Draft { fileName: string; sheets: WorkbookSheet[]; source: SetupSnapshot; preview: SetupWorkbookPreview; selected: string[]; batch?: SetupBatch }
const PAGE_SIZE = 20
const layoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const labelForStatus: Record<string, string> = { waiting: '대기', saving: '저장 중', saved: '저장 완료', rejected: '저장 안 됨', unknown: '결과 확인 필요', not_found: '접수 기록 없음', skipped: '현재 서버 값 유지' }
const failureText = (failure: unknown) => failure instanceof TimetableWorkbookError ? failure.message : failure instanceof ServiceError ? failure.message : '처리 결과를 확인하지 못했습니다. 입력과 원래 요청을 보관합니다.'
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '')
const isUnfinished = (batch: SetupBatch) => batch.phase !== 'complete'
function download(sheets: WorkbookSheet[], name: string) {
  const bytes = writeTimetableXlsx(sheets), url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const explanation: Record<string, string> = {
  CONFLICT: '다른 담당자가 자료를 바꿨거나 연결 조건이 달라졌습니다. 완료한 항목은 유지합니다. 아래에서 남은 항목을 최신 자료와 다시 비교하고 선택해 주세요.',
  INVALID_INPUT: '이 항목의 이름·동시 수업 수·학급 및 공간 선택을 확인해 주세요.',
  NOT_READY: '준비 입력 기능을 사용할 수 있는지 확인한 뒤 이어서 저장해 주세요.',
  FORBIDDEN: '현재 계정에 이 입력을 저장할 권한이 없습니다.',
  INACTIVE_MEMBERSHIP: '학교 소속을 다시 확인해야 합니다.',
  NOT_FOUND: '원래 요청의 접수 기록이 없습니다. 남은 항목을 다시 확인한 뒤 같은 요청 번호로 이어서 저장할 수 있습니다.',
  IDEMPOTENCY_CONFLICT: '원래 요청 번호의 내용이 달라 확인이 필요합니다. 새 번호로 자동 재전송하지 않습니다.',
  RESULT_UNKNOWN: '응답이 끊겼습니다. 원래 요청 결과를 확인하기 전에는 다음 항목을 저장하지 않습니다.',
  QUERY_FAILED: '현재 자료를 확인하지 못했습니다. 완료한 항목과 아직 저장하지 않은 항목을 보관합니다.',
}

export function TimetableSetupBatchPanel(props: Props) {
  const scopeKey = recoveryScope(props.member), scope = { schoolId: props.member.schoolId, memberId: props.member.id, scopeKey }
  const memory = useEditDraft<Draft>(props.member, 'timetable-setup-batch'), recovery = usePendingRequest(props.member, 'timetableSetupBatch')
  const initial = () => {
    const pending = recovery.request?.command as { draft?: Draft } | undefined
    const saved = pending?.draft ?? memory.initial
    if (!saved) return undefined
    return { ...saved, ...(saved.batch ? { batch: restoreSetupBatch(saved.batch, scope) } : {}) }
  }
  const [draft, setDraft] = useState<Draft | undefined>(initial), [opened, setOpened] = useState(Boolean(memory.initial || recovery.request))
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [confirmed, setConfirmed] = useState(false), [invalidPreview, setInvalidPreview] = useState(false), [discarding, setDiscarding] = useState(false), [pauseRequested, setPauseRequested] = useState(false)
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [conflictReview, setConflictReview] = useState<SetupBatchConflictReview>(), [conflictChoices, setConflictChoices] = useState<SetupBatchConflictChoices>({}), [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [reviewPage, setReviewPage] = useState(0)
  const current = useRef({ props, scopeKey, draft }), life = useRef(0), operation = useRef(false), pause = useRef(false), readTicket = useRef(0)
  current.current = { props, scopeKey, draft }
  const batch = draft?.batch, unknown = Boolean(batch && batchHasUnknown(batch)), pending = Boolean(recovery.request)
  const needsConflictReview = Boolean(batch?.jobs.some(row => row.status === 'rejected' && row.errorCode === 'CONFLICT'))
  const awaitingOriginal = Boolean(batch?.jobs.some(row => row.status === 'not_found'))
  const unfinished = Boolean(draft && (!batch ? draft.preview.items.length : isUnfinished(batch)))
  const locked = busy || reading || pending || unfinished
  const sourceKey = props.snapshot ? setupWorkbookSourceKey(props.snapshot, props.member.schoolId) : ''
  const stale = Boolean(draft && !batch && draft.preview.sourceKey !== sourceKey)
  const canPrepare = !props.disabled && !busy && !reading && !pending && Boolean(props.snapshot && props.server)
  const filtered = useMemo(() => (batch?.jobs ?? draft?.preview.items ?? []).filter(row => normalize(row.label + ' ' + row.id).includes(normalize(query))), [batch, draft?.preview, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), activePage = Math.min(page, pages - 1)
  const reviewPages = Math.max(1, Math.ceil((conflictReview?.items.length ?? 0) / PAGE_SIZE)), activeReviewPage = Math.min(reviewPage, reviewPages - 1)
  const selectedCount = draft?.selected.length ?? 0, savedCount = batch?.jobs.filter(row => row.status === 'saved').length ?? 0
  const persist = (value: Draft | undefined) => { setDraft(value); current.current.draft = value; memory.save(value, Boolean(value && (!value.batch ? value.preview.items.length : isUnfinished(value.batch)))) }
  useEffect(() => () => { life.current++; readTicket.current++; pause.current = true }, [])
  layoutEffect(() => { props.onActivityChange?.(busy || reading); return () => props.onActivityChange?.(false) }, [busy, reading, props.onActivityChange])
  layoutEffect(() => { props.onLockChange?.(locked); return () => props.onLockChange?.(false) }, [locked, props.onLockChange])
  useEffect(() => { setConfirmed(false); setConflictReview(undefined); setConflictChoices({}); setReviewConfirmed(false) }, [sourceKey, props.disabled])
  useEffect(() => { life.current++; readTicket.current++; pause.current = true; operation.current = false; setBusy(false); setReading(false); setDraft(initial()); setConfirmed(false); setInvalidPreview(false); setError(''); setNotice(''); setConflictReview(undefined); setConflictChoices({}); setReviewConfirmed(false) }, [scopeKey, memory])

  function inspect(sheets: WorkbookSheet[], fileName: string, snapshot: SetupSnapshot) {
    const preview = previewSetupWorkbook(sheets, snapshot, props.member.schoolId)
    persist({ fileName, sheets, source: structuredClone(snapshot), preview, selected: preview.items.map(row => row.id) })
    setInvalidPreview(false); setConfirmed(false); setDiscarding(false); setQuery(''); setPage(0); setNotice(preview.items.length ? '아직 저장하지 않았습니다. 바뀌는 항목과 선택을 확인해 주세요.' : '현재 자료와 같습니다. 저장할 변경이 없습니다.')
  }
  async function readFile(file: File | undefined) {
    if (!file || !canPrepare || batch) return
    const epoch = life.current, token = scopeKey, ticket = ++readTicket.current, snapshot = props.snapshot!
    setReading(true); setConfirmed(false); setInvalidPreview(true); setError(''); setNotice('')
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > limits.fileBytes) throw new TimetableWorkbookError('이 화면에서 내려받은 8 MiB 이하 XLSX 양식을 선택해 주세요.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (life.current !== epoch || current.current.scopeKey !== token || readTicket.current !== ticket) return
      if (current.current.props.disabled || !current.current.props.snapshot || setupWorkbookSourceKey(current.current.props.snapshot, props.member.schoolId) !== setupWorkbookSourceKey(snapshot, props.member.schoolId)) throw new TimetableWorkbookError('파일을 읽는 동안 학교 자료가 바뀌었습니다. 최신 자료를 확인한 뒤 다시 검사해 주세요.')
      inspect(readTimetableXlsx(bytes), file.name, snapshot)
    } catch (failure) { if (life.current === epoch && current.current.scopeKey === token && readTicket.current === ticket) setError(failureText(failure)) }
    finally { if (life.current === epoch && current.current.scopeKey === token && readTicket.current === ticket) setReading(false) }
  }
  function saveBatchState(next: SetupBatch, base: Draft, token: string, epoch: number) {
    if (life.current !== epoch || current.current.scopeKey !== token) throw new ServiceError('CANCELLED')
    const value = { ...base, batch: next }; persist(value)
    const inflight = next.jobs.find(row => row.status === 'saving' || row.status === 'unknown')
    if (inflight) recovery.put({ key: inflight.requestKey, command: { draft: value } })
    else recovery.remove()
  }
  async function run(recoverOnly = false) {
    if (!draft || !props.server || operation.current || reading) return
    if (!recoverOnly && (needsConflictReview || !canPrepare || !confirmed || invalidPreview || stale || (!batch && !selectedCount))) return
    if (recoverOnly && (!batch || !unknown)) return
    const epoch = life.current, token = scopeKey, base = draft, server = props.server
    operation.current = true; pause.current = false; setPauseRequested(false); setBusy(true); setError(''); setNotice(''); setConfirmed(false)
    const active = () => life.current === epoch && current.current.scopeKey === token
    try {
      const target = batch ?? createSetupBatch(draft.source, draft.preview.items.filter(row => draft.selected.includes(row.id)), scope)
      const options = { onChange: (next: SetupBatch) => saveBatchState(next, base, token, epoch), shouldPause: () => pause.current || current.current.props.disabled, isActive: () => active() && !current.current.props.disabled }
      const next = await (recoverOnly ? recoverSetupBatch(target, server, { ...options, isActive: active }) : runSetupBatch(target, server, options))
      if (!active()) return
      saveBatchState(next, base, token, epoch)
      const completed = next.jobs.filter(row => row.status === 'saved').length
      setNotice(next.phase === 'complete' ? `선택한 ${completed}건을 저장했습니다.` : `저장 완료 ${completed}건. 나머지 입력과 요청 번호를 보관했습니다.`)
      if (completed > (batch?.jobs.filter(row => row.status === 'saved').length ?? 0)) current.current.props.onChanged?.()
    } catch (failure) { if (active()) setError(failureText(failure)) }
    finally { if (active()) { operation.current = false; setBusy(false); setPauseRequested(false) } }
  }
  async function reviewConflict() {
    if (!batch || !props.server || !needsConflictReview || !canPrepare || operation.current || unknown) return
    const epoch = life.current, token = scopeKey, input = batch
    operation.current = true; setReading(true); setError(''); setConflictReview(undefined); setConflictChoices({}); setReviewConfirmed(false); setConfirmed(false)
    try {
      const latest = await props.server.get(props.member.id)
      if (life.current !== epoch || current.current.scopeKey !== token || current.current.props.disabled || current.current.draft?.batch !== input) return
      setConflictReview(previewSetupBatchConflict(input, latest, scope)); setReviewPage(0)
      setNotice('최신 자료를 읽었습니다. 각 남은 항목에서 보관한 입력을 쓸지, 현재 서버 값을 유지할지 선택해 주세요. 아직 저장하지 않았습니다.')
    } catch (failure) { if (life.current === epoch && current.current.scopeKey === token) setError(failureText(failure)) }
    finally { if (life.current === epoch && current.current.scopeKey === token) { operation.current = false; setReading(false) } }
  }
  function approveConflict() {
    if (!draft?.batch || !conflictReview || !reviewConfirmed || !canPrepare || operation.current) return
    try {
      const next = approveSetupBatchConflict(draft.batch, conflictReview, conflictChoices, scope)
      persist({ ...draft, batch: next }); setConflictReview(undefined); setConflictChoices({}); setReviewConfirmed(false); setConfirmed(false); setError('')
      setNotice(next.phase === 'complete' ? '저장 완료한 항목은 보존하고, 나머지는 선택대로 현재 서버 값을 유지했습니다.' : '최신 비교 결과를 적용했습니다. 저장 완료한 항목은 다시 보내지 않습니다. 아래에서 확인 후 남은 항목을 저장해 주세요.')
    } catch (failure) { setError(failureText(failure)) }
  }
  function resultWorkbook() {
    if (!draft?.batch) return
    download([{ name: '저장결과', rows: [['학기', '항목 ID', '항목', '상태', '요청 번호', '오류', '변경 전', '저장하려던 값', '교체된 거절 요청 번호'], ...draft.batch.jobs.map(row => [draft.source.termLabel, row.id, row.label, labelForStatus[row.status] ?? row.status, row.requestKey, row.errorCode ?? '', row.before?.join(' · ') ?? '', row.after?.join(' · ') ?? '', row.replacedRequests?.map(value => value.requestKey).join(' · ') ?? ''])] }], '시간표_준비_저장결과.xlsx')
  }
  function clear() { if (busy || pending || unknown || awaitingOriginal) return; persist(undefined); setConfirmed(false); setInvalidPreview(false); setDiscarding(false); setError(''); setNotice(''); setQuery(''); setPage(0); setConflictReview(undefined); setConflictChoices({}); setReviewConfirmed(false); props.onChanged?.() }
  function toggle(id: string, checked: boolean) { if (!draft || batch || !canPrepare) return; persist({ ...draft, selected: checked ? [...new Set([...draft.selected, id])] : draft.selected.filter(value => value !== id) }); setConfirmed(false) }
  const runLabel = batch ? '남은 항목 다시 확인하고 이어 저장' : '선택한 항목 순서대로 저장'

  return <details className="timetable-setup-batch" open={opened} onToggle={event => { if (!locked) setOpened(event.currentTarget.open); else if (!event.currentTarget.open) event.currentTarget.open = true }}>
    <summary onClick={event => { if (locked) event.preventDefault() }}>엑셀로 공간·수업 연결 한 번에 준비</summary>
    <p>기존 공간의 이름·동시 수업 수와 수업의 학급·공간 연결을 엑셀에서 정리합니다. 공간 추가·삭제는 위의 개별 관리에서 진행해 주세요.</p>
    <p className="timetable-muted">현재 자료 내려받기 → 파일 편집 → 변경 비교 → 선택한 항목 저장. 시수·일과는 별도로 준비합니다.</p>
    {props.disabled && <p role="status">다른 편집을 저장하거나 정리한 뒤 일괄 작업을 이어갈 수 있습니다. 결과가 미확정인 요청은 계속 확인할 수 있습니다.</p>}
    {!props.snapshot && <p className="timetable-notice">최신 준비 입력 자료를 확인하면 양식을 내려받을 수 있습니다. 보관한 입력과 미확정 요청은 유지합니다.</p>}
    <div className="timetable-actions"><button type="button" className="secondary" disabled={!props.snapshot || busy || reading || props.disabled} onClick={() => { try { download(setupWorkbookSheets(props.snapshot!, props.member.schoolId), '시간표_준비_편집양식.xlsx'); setError('') } catch (failure) { setError(failureText(failure)) } }}>준비 입력 엑셀 내려받기</button></div>
    <label className="timetable-setup-batch-file">편집한 준비 입력 엑셀 가져오기<input type="file" accept=".xlsx" disabled={!canPrepare || Boolean(batch)} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void readFile(file) }} /></label>
    <p className="timetable-muted">파일은 이 브라우저에서 검사합니다. 이름이 같은 학급·수업은 ID로 구별하며, 행 삭제를 자료 삭제로 처리하지 않습니다. 입력과 결과는 현재 탭에만 보관됩니다.</p>
    {reading && <p role="status">엑셀 파일과 현재 자료를 비교하고 있습니다…</p>}
    {error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {draft && <section aria-label="일괄 준비 변경 비교">
      <h4>{batch ? '일괄 저장 진행 상황' : '저장 전 변경 비교'}</h4><p>{draft.fileName} · {draft.source.termLabel}</p>
      {stale && <p role="alert" className="timetable-error">학교 자료가 바뀌어 이 파일의 저장 승인을 해제했습니다. 입력은 보관했습니다. 최신 양식을 내려받아 바뀐 자료와 비교한 뒤 다시 가져와 주세요.</p>}
      {invalidPreview && !batch && <p role="alert">새로 고른 파일을 확인하지 못했습니다. 이전 입력은 보관했지만 저장할 수 없습니다.</p>}
      {draft.preview.referenceDayChange && <p role="status" className="timetable-notice">파일 기준일 {draft.preview.referenceDayChange.from} → 현재 기준일 {draft.preview.referenceDayChange.to}. 준비 자료는 같음을 확인했습니다. 변경 내용을 다시 확인하고 저장해 주세요.</p>}
      {draft.preview.notices.length > 0 && <details><summary>입력 시 참고할 항목 {draft.preview.notices.length}건</summary><ul>{draft.preview.notices.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
      {batch ? <div className="timetable-setup-batch-counts" aria-live="polite"><strong>저장 완료 {savedCount}건</strong><span>결과 확인 필요 {batch.jobs.filter(row => row.status === 'saving' || row.status === 'unknown').length}건</span><span>현재 서버 값 유지 {batch.jobs.filter(row => row.status === 'skipped').length}건</span><span>남은 항목 {batch.jobs.filter(row => !['saved', 'skipped', 'saving', 'unknown'].includes(row.status)).length}건</span></div> : <p>변경 {draft.preview.items.length}건 · 선택 {selectedCount}건 · 변경 없음 {draft.preview.unchanged}건</p>}
      <label>일괄 항목 검색<input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="이름 또는 ID" /></label>
      {!batch && draft.preview.items.length > 0 && <div className="timetable-actions"><button type="button" className="secondary" disabled={!canPrepare || stale || invalidPreview} onClick={() => { persist({ ...draft, selected: draft.preview.items.map(row => row.id) }); setConfirmed(false) }}>변경 항목 모두 선택</button><button type="button" className="secondary" disabled={!canPrepare} onClick={() => { persist({ ...draft, selected: [] }); setConfirmed(false) }}>선택 모두 해제</button></div>}
      <ul className="timetable-setup-batch-list">{filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE).map(row => <li key={row.id} aria-label={row.label}>
        <div className="timetable-setup-batch-rowtitle">{batch ? <strong>{row.label}</strong> : <label className="timetable-check"><input type="checkbox" checked={draft.selected.includes(row.id)} disabled={!canPrepare || stale || invalidPreview} onChange={event => toggle(row.id, event.target.checked)} />{row.label}</label>}{'status' in row && <span>{labelForStatus[String(row.status)] ?? String(row.status)}</span>}</div>
        <dl><div><dt>변경 전</dt><dd>{row.before?.map((value, index) => <span key={index}>{value}</span>)}</dd></div><div><dt>저장하려는 값</dt><dd>{row.after?.map((value, index) => <span key={index}>{value}</span>)}</dd></div></dl>
        {'errorCode' in row && Boolean(row.errorCode) && <p className="timetable-error">{explanation[String(row.errorCode)] ?? '이 항목을 확인한 뒤 다시 진행해 주세요.'} <small>({String(row.errorCode)})</small></p>}
      </li>)}</ul>
      {!filtered.length && <p>{draft.preview.items.length ? '검색 조건에 맞는 항목이 없습니다.' : '바뀌는 항목이 없습니다.'}</p>}
      {pages > 1 && <nav className="timetable-actions" aria-label="일괄 준비 항목 쪽 이동"><button type="button" className="secondary" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>이전 일괄 항목</button><span>{activePage + 1}/{pages}쪽</span><button type="button" className="secondary" disabled={activePage + 1 === pages} onClick={() => setPage(activePage + 1)}>다음 일괄 항목</button></nav>}
      <p className="timetable-notice">각 항목을 하나씩 저장합니다. 중간에 멈추면 앞서 저장한 항목은 유지되고, 남은 항목은 그대로 보관됩니다. 전체가 한 번에 취소되는 작업이 아닙니다.</p>
      {awaitingOriginal && <p role="status" className="timetable-notice">원래 요청의 접수 기록을 아직 찾지 못했습니다. 늦은 저장 가능성이 있어 원래 명령과 요청 번호를 유지합니다. 확인 후 같은 번호로 이어 저장해 주세요.</p>}
      {(unknown || pending) && <div className="timetable-notice"><p>저장 결과를 모르는 요청이 있습니다. 새 번호로 다시 보내거나 다음 항목으로 넘어가지 않습니다.</p><button type="button" disabled={busy || !props.server || !unknown} onClick={() => void run(true)}>원래 일괄 저장 요청 결과 확인</button></div>}
      {needsConflictReview && !unknown && !pending && <section aria-label="충돌한 일괄 입력 다시 비교" className="timetable-notice">
        <h4>남은 입력을 최신 자료와 다시 비교</h4>
        <p>완료한 항목과 결과 미상 요청은 바꾸지 않습니다. 거절이 확정된 항목만 새 요청 번호로 준비합니다. 아직 보내지 않은 항목은 보관한 번호를 유지합니다.</p>
        <button type="button" className="secondary" disabled={!canPrepare} onClick={() => void reviewConflict()}>최신 자료로 남은 항목 다시 비교</button>
        {conflictReview && <>
          <p>전체 남은 항목 {conflictReview.items.length}건 · 검색과 관계없이 각 항목에서 직접 선택해야 합니다.</p>
          <ul className="timetable-setup-batch-list">{conflictReview.items.slice(activeReviewPage * PAGE_SIZE, (activeReviewPage + 1) * PAGE_SIZE).map(item => <li key={item.id}>
            <strong>{item.label}</strong><dl><div><dt>처음 비교한 값</dt><dd>{item.before.map((line, index) => <span key={index}>{line}</span>)}</dd></div><div><dt>현재 서버 값</dt><dd>{item.current.map((line, index) => <span key={index}>{line}</span>)}</dd></div><div><dt>보관한 내 입력</dt><dd>{item.after.map((line, index) => <span key={index}>{line}</span>)}</dd></div></dl>
            {item.errorCode && <p role="alert">이 입력은 현재 자료에 적용할 수 없습니다 ({item.errorCode}). 현재 서버 값을 유지하거나 일괄 입력을 정리한 뒤 개별 화면에서 수정해 주세요.</p>}
            <label>{item.label} 충돌 처리<select aria-label={`${item.label} 충돌 처리`} value={conflictChoices[item.id] ?? ''} disabled={!canPrepare} onChange={event => { const value = event.target.value; setConflictChoices(previous => { const next = { ...previous }; if (value) next[item.id] = value as 'mine' | 'server'; else delete next[item.id]; return next }); setReviewConfirmed(false) }}><option value="">직접 선택해 주세요</option><option value="mine" disabled={!item.command}>보관한 내 입력으로 저장 준비</option><option value="server">현재 서버 값 유지 — 이 항목 저장 안 함</option></select></label>
          </li>)}</ul>
          {reviewPages > 1 && <nav className="timetable-actions" aria-label="충돌 비교 쪽 이동"><button type="button" className="secondary" disabled={activeReviewPage === 0} onClick={() => setReviewPage(activeReviewPage - 1)}>이전 충돌 비교</button><span>{activeReviewPage + 1}/{reviewPages}쪽 · 선택 {Object.keys(conflictChoices).length}/{conflictReview.items.length}건</span><button type="button" className="secondary" disabled={activeReviewPage + 1 === reviewPages} onClick={() => setReviewPage(activeReviewPage + 1)}>다음 충돌 비교</button></nav>}
          <label className="timetable-check"><input type="checkbox" checked={reviewConfirmed} disabled={!canPrepare || conflictReview.items.some(item => !conflictChoices[item.id])} onChange={event => setReviewConfirmed(event.target.checked)} />최신 자료와 내 입력의 차이 및 각 항목 선택을 확인했습니다</label>
          <button type="button" disabled={!canPrepare || !reviewConfirmed || conflictReview.items.some(item => !conflictChoices[item.id])} onClick={approveConflict}>선택한 비교 결과 적용</button>
          <p className="timetable-muted">이 버튼은 저장하지 않습니다. 비교 결과 적용 뒤 별도 확인을 거쳐 남은 항목을 저장합니다.</p>
        </>}
      </section>}
      {busy ? <div className="timetable-actions"><p role="status">현재 항목을 확인하고 있습니다…</p><button type="button" className="secondary" disabled={pauseRequested} onClick={() => { pause.current = true; setPauseRequested(true) }}>현재 항목 처리 후 멈추기</button>{pauseRequested && <span role="status">현재 요청의 결과를 확인한 뒤 멈춥니다.</span>}</div> : !unknown && !pending && !needsConflictReview && batch?.phase !== 'complete' && draft.preview.items.length > 0 && <div className="timetable-setup-batch-confirm"><label className="timetable-check"><input type="checkbox" checked={confirmed} disabled={!canPrepare || stale || invalidPreview || (!batch && !selectedCount)} onChange={event => setConfirmed(event.target.checked)} />변경 내용과 일부만 저장될 수 있음을 확인했습니다</label><button type="button" disabled={!canPrepare || !confirmed || stale || invalidPreview || (!batch && !selectedCount)} onClick={() => void run()}>{runLabel}</button></div>}
      <div className="timetable-actions"><button type="button" className="secondary" disabled={busy || reading} onClick={() => { try { download(draft.sheets, '시간표_준비_보관입력.xlsx') } catch (failure) { setError(failureText(failure)) } }}>보관한 편집 파일 내려받기</button>{batch && <button type="button" className="secondary" disabled={busy} onClick={() => { try { resultWorkbook() } catch (failure) { setError(failureText(failure)) } }}>일괄 저장 결과 내려받기</button>}{(invalidPreview || stale) && !batch && <button type="button" className="secondary" disabled={!canPrepare} onClick={() => { try { inspect(draft.sheets, draft.fileName, props.snapshot!); setError('') } catch (failure) { setError(failureText(failure)) } }}>보관한 파일 다시 검사</button>}</div>
      {!busy && !pending && !unknown && !awaitingOriginal && (discarding ? <div className="timetable-notice"><p>저장 완료한 자료는 유지합니다. 아직 저장하지 않은 일괄 입력과 화면의 결과 목록을 정리합니다. 필요하면 먼저 결과를 내려받아 주세요.</p><div className="timetable-actions"><button type="button" className="secondary" onClick={clear}>보관 입력 정리하고 새 작업 시작</button><button type="button" className="secondary" onClick={() => setDiscarding(false)}>일괄 입력 계속 보관</button></div></div> : <button type="button" className="secondary" onClick={() => setDiscarding(true)}>{batch?.phase === 'complete' ? '결과 정리하고 새 작업 준비' : '일괄 입력 정리'}</button>)}
    </section>}
  </details>
}
