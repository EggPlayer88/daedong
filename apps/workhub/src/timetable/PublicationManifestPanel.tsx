import { useEffect, useRef, useState } from 'react'
import type { OperationsExtensions, PublicationChangePage, PublicationManifest } from './operations-next-contracts'
import type { PublishInput } from './operations-contracts'
import type { PublicationCommitCommand, PublicationCommitReceipt } from './publication-execution-contracts'
import { parsePublicationManifest, parsePublicationPage } from './operations-next-server'
import { verifyPublicationChanges } from './publication-execution-server'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { OperationChangeList } from './OperationChangeList'

interface Props {
  extensions?: OperationsExtensions; memberId: string; input: PublishInput; sourceKey: string; timeZone: string; disabled: boolean
  onCommand?: (command: PublicationCommitCommand) => Promise<PublicationCommitReceipt>; onBusyChange?: (busy: boolean) => void
}
/** 모든 페이지의 지문·수업 ID를 검증한 명세만 확인 버튼에 연결한다. 전체 수업은 쌓지 않는다. */
export function PublicationManifestPanel({ extensions, memberId, input, sourceKey, timeZone, disabled, onCommand, onBusyChange }: Props) {
  const [manifest, setManifest] = useState<PublicationManifest>(), [page, setPage] = useState<PublicationChangePage>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [verified, setVerified] = useState<PublicationCommitCommand>(), [confirmed, setConfirmed] = useState(false), [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ pages: number; totalPages: number; changes: number; totalChanges: number }>(), [now, setNow] = useState(Date.now)
  const sequence = useRef(0), seen = useRef(new Map<string, number>()), abort = useRef<AbortController>(), reading = useRef(false), writing = useRef(false)
  const manifestSource = useRef('')
  const inputKey = canonical(input), current = useRef({ inputKey, sourceKey, memberId, timeZone, disabled }), busyCallback = useRef(onBusyChange)
  current.current = { inputKey, sourceKey, memberId, timeZone, disabled }; busyCallback.current = onBusyChange
  const running = busy || submitting, expired = Boolean(manifest && Date.parse(manifest.expiresAt) <= now)
  const fresh = Boolean(manifest && manifest.timeZone === timeZone && canonical(manifest.input) === inputKey && manifestSource.current === canonical([sourceKey, memberId, timeZone]))
  function markBusy(value: boolean) { reading.current = value; setBusy(value); busyCallback.current?.(value) }
  useEffect(() => {
    sequence.current++; abort.current?.abort(); markBusy(false); setManifest(undefined); setPage(undefined); setError(''); setVerified(undefined); setConfirmed(false); setProgress(undefined); seen.current.clear()
    return () => { sequence.current++; abort.current?.abort(); reading.current = false; busyCallback.current?.(false) }
  }, [sourceKey, inputKey, memberId, timeZone])
  useEffect(() => { if (disabled && reading.current) { sequence.current++; abort.current?.abort(); abort.current = undefined; markBusy(false); setVerified(undefined); setConfirmed(false) } }, [disabled])
  useEffect(() => { if (!manifest) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [manifest])
  const valid = (token: number, captured: typeof current.current) => token === sequence.current && !current.current.disabled && captured.inputKey === current.current.inputKey && captured.sourceKey === current.current.sourceKey && captured.memberId === current.current.memberId && captured.timeZone === current.current.timeZone
  async function inspect() {
    if (!extensions || disabled || reading.current || writing.current) return
    const token = ++sequence.current, captured = { ...current.current }; markBusy(true); setError(''); setManifest(undefined); setPage(undefined); setVerified(undefined); setConfirmed(false); setProgress(undefined); seen.current.clear()
    try { const result = await parsePublicationManifest(await extensions.publicationManifest(memberId, input), input); if (result.timeZone !== captured.timeZone) throw new ServiceError('INVALID_RESPONSE'); if (valid(token, captured)) { manifestSource.current = canonical([captured.sourceKey, captured.memberId, captured.timeZone]); setManifest(result); setNow(Date.now()) } }
    catch (failure) { if (valid(token, captured)) setError(failure instanceof ServiceError ? failure.message : '전체 변경 목록을 확인하지 못했습니다.') }
    finally { if (token === sequence.current) markBusy(false) }
  }
  async function load(index: number) {
    if (!manifest || !fresh || !extensions || disabled || reading.current || writing.current || Date.parse(manifest.expiresAt) <= Date.now()) return
    const token = ++sequence.current, captured = { ...current.current }; markBusy(true); setError('')
    try {
      const result = await parsePublicationPage(await extensions.publicationPage(memberId, manifest, index), manifest, index)
      if (!valid(token, captured)) return
      if (result.changes.some(change => seen.current.has(change.after.id) && seen.current.get(change.after.id) !== index)) throw new ServiceError('INVALID_RESPONSE')
      result.changes.forEach(change => seen.current.set(change.after.id, index)); setPage(result)
    } catch (failure) { if (valid(token, captured)) { setError(failure instanceof ServiceError ? failure.message : '변경 상세를 확인하지 못했습니다.'); setVerified(undefined); setConfirmed(false) } }
    finally { if (token === sequence.current) markBusy(false) }
  }
  async function verifyAll() {
    if (!manifest || !fresh || !extensions || disabled || reading.current || writing.current || expired || manifest.blockerCount) return
    const token = ++sequence.current, captured = { ...current.current }, controller = new AbortController(); abort.current = controller
    markBusy(true); setError(''); setVerified(undefined); setConfirmed(false)
    try {
      const command = await verifyPublicationChanges(extensions, memberId, manifest, { signal: controller.signal, onProgress: value => { if (valid(token, captured)) setProgress(value) } })
      if (valid(token, captured)) { setVerified(command); setNow(Date.now()) }
    } catch (failure) { if (valid(token, captured) && !controller.signal.aborted) setError(failure instanceof ServiceError ? failure.message : '전체 변경 검증을 완료하지 못했습니다.') }
    finally { if (token === sequence.current) { abort.current = undefined; markBusy(false) } }
  }
  function cancel() { if (disabled || !reading.current) return; sequence.current++; abort.current?.abort(); abort.current = undefined; markBusy(false); setVerified(undefined); setConfirmed(false); setError('전체 검증을 중지했습니다. 확정하려면 전체 검증을 다시 진행해 주세요.') }
  async function commit() {
    if (!onCommand || !verified || !fresh || !confirmed || disabled || reading.current || writing.current || Date.parse(verified.manifest.expiresAt) <= Date.now()) return
    const token = sequence.current; writing.current = true; setSubmitting(true); setError(''); markBusy(false)
    try { await onCommand(structuredClone(verified)); if (token === sequence.current) { setManifest(undefined); setPage(undefined); setVerified(undefined); setConfirmed(false); setProgress(undefined) } }
    catch (failure) { if (token === sequence.current) { setError(failure instanceof ServiceError ? failure.message : '확정 결과를 확인하지 못했습니다. 원래 요청은 상단에서 다시 확인할 수 있습니다.'); setConfirmed(false) } }
    finally { writing.current = false; setSubmitting(false) }
  }
  return <details className="ttops-publications"><summary>학기 전체 시간표 확인·확정</summary><p className="ttops-muted">전체 변경 건수와 원본 지문을 고정하고 상세를 나누어 읽습니다. 확정 전에 모든 쪽의 누락·중복·변경 여부를 자동 검증합니다.</p>
    <button type="button" className="secondary" disabled={!extensions || disabled || running} onClick={() => void inspect()}>{busy && !progress ? '전체 영향 확인 중…' : '전체 변경 목록 확인'}</button>{!extensions && <p>분할 조회 서버 연결을 준비 중입니다.</p>}
    {error && <p role="alert" className="ttops-error">{error}</p>}
    {manifest && fresh && <section aria-label="전체 변경 목록 요약"><p>전체 {manifest.totalChanges.toLocaleString('ko-KR')}건 · {manifest.pageHashes.length}쪽 · 확인 필요 {manifest.blockerCount}건</p><p className="ttops-muted">원본 기준과 전체 목록 지문을 확인했습니다. 과거 수업·적용 기간 밖 수업과 기존 교환 기록은 보존합니다.</p>{expired && <p role="status">전체 변경 목록의 확인 기한이 지났습니다. 다시 조회해 주세요.</p>}
      {manifest.pageHashes.length > 0 && <div className="ttboard-actions"><button type="button" className="secondary" disabled={disabled || running || expired || !page || page.index === 0} onClick={() => void load((page?.index ?? 0) - 1)}>이전 상세</button><span>{page ? page.index + 1 : 0}/{manifest.pageHashes.length}쪽</span><button type="button" className="secondary" disabled={disabled || running || expired || Boolean(page && page.index + 1 >= manifest.pageHashes.length)} onClick={() => void load(page ? page.index + 1 : 0)}>{page ? '다음 상세' : '첫 상세 확인'}</button></div>}
      {page && <OperationChangeList key={page.index} changes={page.changes} timeZone={timeZone} />}
      <button type="button" className="secondary" disabled={disabled || running || expired || manifest.blockerCount > 0} onClick={() => void verifyAll()}>전체 변경 자동 검증</button>
      {progress && <p role="status" aria-live="polite">{verified ? '전체 검증 완료' : busy ? '전체 검증 진행' : '확인한 범위'} · {progress.pages}/{progress.totalPages}쪽 · {progress.changes.toLocaleString('ko-KR')}/{progress.totalChanges.toLocaleString('ko-KR')}건</p>}
      {busy && progress && <button type="button" className="secondary" disabled={disabled} onClick={cancel}>전체 검증 중지</button>}
      {manifest.blockerCount > 0 && <p role="alert">확인을 막는 항목이 있습니다. 초안과 조건을 수정한 뒤 다시 확인해 주세요.</p>}
      {verified && <label className="ttops-check"><input type="checkbox" checked={confirmed} disabled={disabled || running || expired} onChange={event => setConfirmed(event.target.checked)} />전체 변경 {verified.manifest.totalChanges.toLocaleString('ko-KR')}건과 적용 기간을 확인했으며 학교 시간표로 확정합니다.</label>}
      <button type="button" disabled={!onCommand || disabled || running || expired || !verified || !confirmed} onClick={() => void commit()}>{submitting ? '학기 시간표 확정 중…' : '검증한 학기 시간표 확정'}</button>
      {!onCommand && <p className="ttops-muted">학기 전체 확정 서버 연결을 준비 중입니다. 미리보기만으로는 시간표가 바뀌지 않습니다.</p>}
    </section>}
  </details>
}
