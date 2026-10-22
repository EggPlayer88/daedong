import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { FILE_TECHNICAL_LIMITS, FileError } from '../files/contracts'
import { requestBlobDownload } from '../files/download'
import { CollectionServerError, type CollectionFailureCode, type CollectionServer } from './contracts'
import { collectionExportJobKey, prepareCollectionExport, recheckCollectionExport, releaseCollectionExport, type CollectionExportBatch, type CollectionExportMode } from './collection-export'
import styles from './collection-export.css?inline'

interface Props {
  server: CollectionServer; member: Membership; requestId: string; date: string
  disabled?: boolean; onBusyChange?: (busy: boolean) => void
}
const serverMessages: Record<CollectionFailureCode, string> = {
  NOT_READY: '문서 수합 연결이 아직 준비되지 않았습니다. 준비 상태를 확인해 주세요.',
  INVALID_INPUT: '묶음 다운로드의 입력을 확인하지 못했습니다. 수합을 다시 열어 주세요.',
  INVALID_RESPONSE: '서버 응답을 확인하지 못했습니다. 수합을 다시 조회해 주세요.',
  FORBIDDEN: '현재 계정에는 이 수합을 모아 받을 권한이 없습니다.',
  INACTIVE_MEMBERSHIP: '학교 소속을 다시 확인해 주세요.',
  NOT_FOUND: '수합 자료를 찾을 수 없습니다. 다시 조회해 주세요.',
  CONFLICT: '제출 현황이나 접근 범위가 바뀌었습니다. 최신 현황으로 다시 준비해 주세요.',
  IDEMPOTENCY_CONFLICT: '요청 상태를 확인하지 못했습니다. 수합을 다시 열어 주세요.',
  QUERY_FAILED: '서버에서 자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  RESULT_UNKNOWN: '서버의 처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  CANCELLED: '묶음 준비를 취소했습니다.',
  FILE_NOT_READY: '아직 확인이 끝나지 않은 파일이 있습니다. 잠시 후 다시 준비해 주세요.',
  FILE_FAILED: '파일을 확인하지 못했습니다. 원본 파일 상태를 확인해 주세요.',
}
function failureMessage(error: unknown): string {
  // 서버나 시험 도구가 Error.message에 경로·SQL 원문을 넣어도 화면에 전달하지 않는다.
  return (error instanceof CollectionServerError ? serverMessages[error.code] : error instanceof FileError ? new FileError(error.code).message : '') || '묶음 파일을 준비하지 못했습니다. 다시 시도해 주세요.'
}
const modeLabel = (mode: CollectionExportMode) => mode === 'effective' ? '완료본' : '현재 제출본'
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024).toLocaleString('ko-KR')} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`

export function CollectionServerExport({ server, member, requestId, date, disabled = false, onBusyChange }: Props) {
  const id = useId()
  const [mode, setMode] = useState<CollectionExportMode>('effective')
  const [batch, setBatch] = useState<CollectionExportBatch>()
  const [sequence, setSequence] = useState<{ fingerprint: string; index: number; count: number; totalFiles: number; totalFileBytes: number }>()
  const [requested, setRequested] = useState<number[]>([])
  const batchRef = useRef<CollectionExportBatch>()
  batchRef.current = batch
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef<AbortController>()
  const generation = useRef(0)
  const busyRef = useRef(false)
  const busyCallback = useRef(onBusyChange)
  busyCallback.current = onBusyChange
  const actor = JSON.stringify([member.id, member.userId, member.schoolId, member.active, member.role, member.validFrom, member.validThrough])
  const live = useRef({ actor, requestId, date, server, disabled })
  live.current = { actor, requestId, date, server, disabled }

  function updateBusy(value: boolean) {
    if (busyRef.current !== value) { busyRef.current = value; busyCallback.current?.(value) }
    setBusy(value)
  }
  function invalidate() {
    generation.current++
    active.current?.abort()
    active.current = undefined
  }
  function clearBatch() { releaseCollectionExport(batchRef.current); batchRef.current = undefined; setBatch(undefined) }
  function cancel() {
    invalidate(); updateBusy(false); clearBatch(); setSequence(undefined); setRequested([]); setProgress(''); setError('')
    setNotice('묶음 준비를 취소했습니다. 제출 자료는 바뀌지 않았습니다.')
  }
  useEffect(() => {
    invalidate(); updateBusy(false); clearBatch(); setSequence(undefined); setRequested([]); setProgress(''); setError(''); setNotice('')
    return () => {
      invalidate(); releaseCollectionExport(batchRef.current)
      if (busyRef.current) { busyRef.current = false; busyCallback.current?.(false) }
    }
    // 계정·학교·수합·연결·기준일 변경과 편집 시작 시 이전 파일을 내려주지 않는다.
  }, [actor, requestId, date, server, disabled])

  function begin() {
    // React 상태가 반영되기 전 연속 클릭도 같은 작업을 중복 시작하지 않는다.
    if (busyRef.current || live.current.disabled) return null
    const controller = new AbortController(), token = ++generation.current, context = live.current
    active.current = controller; updateBusy(true); setError(''); setNotice(''); setProgress('수합 현황을 확인하고 있습니다.')
    return {
      signal: controller.signal,
      valid: () => token === generation.current && !controller.signal.aborted && !live.current.disabled && live.current.actor === context.actor && live.current.requestId === context.requestId && live.current.date === context.date && live.current.server === context.server,
    }
  }
  async function prepare(retry = false, partIndex = 0, expectedFingerprint?: string) {
    const op = begin()
    if (!op) return
    const previous = retry ? batch : undefined
    if (retry) setBatch(undefined)
    else clearBatch()
    if (expectedFingerprint === undefined && !retry) { setSequence(undefined); setRequested([]) }
    try {
      const result = await prepareCollectionExport({ server, member, requestId, date, mode, previous, partIndex: retry ? previous?.plan.part?.index ?? 0 : partIndex, expectedFingerprint: expectedFingerprint ?? previous?.plan.fingerprint, signal: op.signal, onProgress: value => { if (op.valid()) setProgress(value) } })
      if (!op.valid()) { releaseCollectionExport(result); return }
      releaseCollectionExport(previous)
      setBatch(result); batchRef.current = result
      setSequence({ fingerprint: result.plan.fingerprint, ...result.plan.part! })
      if (result.failed.length) setError(`${result.failed.length}개 파일을 확인하지 못했습니다. 모두 확인한 뒤 ZIP을 내려받을 수 있습니다.`)
      else setNotice(result.plan.jobs.length ? `${result.plan.part!.count > 1 ? `${result.plan.part!.index + 1}/${result.plan.part!.count} 묶음의 ` : ''}${result.plan.jobs.length}개 파일과 제출 현황표를 준비했습니다.` : '포함할 제출 파일이 없어 제출 현황표만 준비했습니다.')
    } catch (failure) {
      releaseCollectionExport(previous)
      if (op.valid()) { clearBatch(); setSequence(undefined); setRequested([]); setError(failureMessage(failure)) }
    } finally {
      if (op.valid()) { active.current = undefined; updateBusy(false); setProgress('') }
    }
  }
  async function download() {
    if (!batch?.zip || batch.failed.length) return
    const op = begin()
    if (!op) return
    try {
      await recheckCollectionExport({ server, member, date, batch, signal: op.signal, onProgress: value => { if (op.valid()) setProgress(value) } })
      if (!op.valid()) return
      const part = batch.plan.part, suffix = part && part.count > 1 ? `_묶음${String(part.index + 1).padStart(3, '0')}-${String(part.count).padStart(3, '0')}` : ''
      requestBlobDownload(batch.zip, `${batch.plan.title}_${modeLabel(batch.plan.mode)}${suffix}.zip`)
      setRequested(values => [...new Set([...values, part?.index ?? 0])])
      setNotice(`${part && part.count > 1 ? `${part.index + 1}/${part.count} 묶음 ` : ''}ZIP 다운로드를 요청했습니다. 브라우저의 다운로드 목록에서 확인해 주세요.`)
    } catch (failure) {
      if (op.valid()) { clearBatch(); setSequence(undefined); setRequested([]); setError(failureMessage(failure)) }
    } finally {
      if (op.valid()) { active.current = undefined; updateBusy(false); setProgress('') }
    }
  }

  return <><style>{styles}</style><details className="cs-file-export">
    <summary>제출 파일 모아 받기{busy && <span className="csfe-summary-state"> · 준비 중</span>}</summary>
    <div className="csfe-body">
      <div className="csfe-choice"><label htmlFor={id}>모을 파일 기준</label><select id={id} value={mode} disabled={busy || disabled} onChange={event => {
        setMode(event.target.value as CollectionExportMode); clearBatch(); setSequence(undefined); setRequested([]); setError(''); setNotice('')
      }}>
        <option value="effective">완료본 · 검토가 끝난 제출</option>
        <option value="current">현재 제출본 · 검토 대기 포함</option>
      </select></div>
      <p className="csfe-hint">{mode === 'effective' ? '검토가 필요한 수합은 검토 완료된 제출판을, 검토 없는 수합은 접수된 완료본을 모읍니다. 새 제출을 검토 중이면 이전 완료본이 포함될 수 있습니다.' : '검토 대기·보완 요청 상태인 현재 제출판도 모읍니다. 완료본과 다를 수 있습니다.'} 미제출 초안과 철회한 제출판은 포함하지 않습니다.</p>
      <div className="csfe-actions">
        <button type="button" disabled={busy || disabled} onClick={() => void prepare()}>최신 현황으로 묶음 준비</button>
        {!!batch?.failed.length && <button type="button" disabled={busy || disabled} onClick={() => void prepare(true)}>실패한 파일 다시 확인</button>}
        {batch?.zip && !batch.failed.length && <button type="button" className="csfe-primary" disabled={busy || disabled} onClick={() => void download()}>{sequence && sequence.count > 1 ? `${sequence.index + 1}/${sequence.count} ZIP 내려받기` : 'ZIP 내려받기'}</button>}
        {sequence && sequence.count > 1 && <><button type="button" disabled={busy || disabled || sequence.index === 0} onClick={() => void prepare(false, sequence.index - 1, sequence.fingerprint)}>이전 묶음 준비</button><button type="button" disabled={busy || disabled || sequence.index + 1 === sequence.count} onClick={() => void prepare(false, sequence.index + 1, sequence.fingerprint)}>다음 묶음 준비</button></>}
        {busy && <button type="button" onClick={cancel}>묶음 준비 취소</button>}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="csfe-status">{busy ? progress : notice}</p>
      {error && <p role="alert" className="csfe-error">{error}</p>}
      {sequence && sequence.count > 1 && <section aria-label="나누어 받는 ZIP 현황"><p className="csfe-hint">전체 파일 {sequence.totalFiles}개 · {sizeLabel(sequence.totalFileBytes)}를 ZIP {sequence.count}개로 나누었습니다. 지금은 {sequence.index + 1}번 묶음만 보관하며 다른 묶음을 준비하면 현재 파일을 메모리에서 비웁니다.</p><p className="csfe-hint">다운로드 요청 {requested.length}/{sequence.count}개{requested.length > 0 ? ` · ${[...requested].sort((a,b)=>a-b).map(value=>value+1).join(', ')}번` : ''}. 실제 저장 완료 여부는 브라우저에서 확인해 주세요.</p><p className="csfe-hint">각 CSV에는 해당 묶음의 파일과 미제출·제외 사유를 담습니다. 묶음 사이에 제출 현황이 바뀌면 이전 요청 표시를 지우고 전체를 다시 준비합니다.</p></section>}
      {batch && <p className="csfe-hint">{sequence && sequence.count > 1 ? '이 묶음 · ' : ''}대상 {batch.plan.totalUnits}단위 중 파일 포함 {batch.plan.includedUnits}단위 · 파일 {batch.plan.jobs.length}개 · 현황표 포함 {sizeLabel(batch.plan.totalBytes)}. 포함한 제출판과 제외 사유는 CSV 현황표에 표시합니다.</p>}
      {batch && batch.failed.length > 0 && <ul className="csfe-failures" aria-label="확인하지 못한 파일">{batch.plan.jobs.filter(job => batch.failed.includes(collectionExportJobKey(job))).slice(0, 20).map(job => <li key={collectionExportJobKey(job)}>{job.unitLabel} · v{job.revision} · {job.file.name}</li>)}{batch.failed.length > 20 && <li>외 {batch.failed.length - 20}개</li>}</ul>}
      <p className="csfe-hint">이 수합의 제출 자료를 확인해 ZIP과 CSV로 정리합니다. 내려받기 직전에 제출 상태와 파일 접근을 다시 확인하며, 내용이 바뀌면 다시 준비해야 합니다.</p>
      <p className="csfe-limit">ZIP 하나에 첨부 파일 {FILE_TECHNICAL_LIMITS.zipEntries - 1}개, 파일과 현황표 합계 {FILE_TECHNICAL_LIMITS.memoryBytes / 1024 / 1024} MiB까지 담고, 그보다 많으면 여러 묶음으로 나누어 받습니다.</p>
    </div>
  </details></>
}
