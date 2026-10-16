import { useEffect, useRef, useState } from 'react'
import type { OperationsExtensions, PublicationChangePage, PublicationManifest } from './operations-next-contracts'
import type { PublishInput } from './operations-contracts'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { OperationChangeList } from './OperationChangeList'

interface Props { extensions?: OperationsExtensions; memberId: string; input: PublishInput; sourceKey: string; timeZone: string; disabled: boolean }
/** 전체 영향은 고정 manifest로, 상세는 검증된 페이지로 읽는다. v1 확정 명령으로 우회하지 않는다. */
export function PublicationManifestPanel({ extensions, memberId, input, sourceKey, timeZone, disabled }: Props) {
  const [manifest, setManifest] = useState<PublicationManifest>(), [page, setPage] = useState<PublicationChangePage>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const sequence = useRef(0), seen = useRef(new Map<string, number>()), inputKey = canonical(input)
  useEffect(() => { sequence.current++; setManifest(undefined); setPage(undefined); setBusy(false); setError(''); seen.current.clear(); return () => { sequence.current++ } }, [sourceKey, inputKey])
  async function inspect() {
    if (!extensions || disabled || busy) return
    const token = ++sequence.current; setBusy(true); setError(''); setManifest(undefined); setPage(undefined); seen.current.clear()
    try { const result = await extensions.publicationManifest(memberId, input); if (token === sequence.current) setManifest(result) }
    catch (failure) { if (token === sequence.current) setError(failure instanceof ServiceError ? failure.message : '전체 변경 목록을 확인하지 못했습니다.') }
    finally { if (token === sequence.current) setBusy(false) }
  }
  async function load(index: number) {
    if (!manifest || !extensions || disabled || busy || Date.parse(manifest.expiresAt) <= Date.now()) return
    const token = ++sequence.current; setBusy(true); setError('')
    try {
      const result = await extensions.publicationPage(memberId, manifest, index)
      if (token !== sequence.current) return
      if (result.changes.some(change => seen.current.has(change.after.id) && seen.current.get(change.after.id) !== index)) throw new ServiceError('INVALID_RESPONSE')
      result.changes.forEach(change => seen.current.set(change.after.id, index)); setPage(result)
    } catch (failure) { if (token === sequence.current) setError(failure instanceof ServiceError ? failure.message : '변경 상세를 확인하지 못했습니다.') }
    finally { if (token === sequence.current) setBusy(false) }
  }
  return <details className="ttops-publications"><summary>많은 수업의 변경 목록 나누어 확인</summary><p className="ttops-muted">전체 변경 건수와 원본 지문을 고정하고 상세만 나누어 읽습니다. 일부 목록을 전체 목록으로 판단하지 않습니다.</p>
    <button type="button" className="secondary" disabled={!extensions || disabled || busy} onClick={() => void inspect()}>{busy ? '전체 영향 확인 중…' : '전체 변경 목록 확인'}</button>{!extensions && <p>분할 조회 서버 연결을 준비 중입니다.</p>}
    {error && <p role="alert" className="ttops-error">{error}</p>}
    {manifest && <section aria-label="전체 변경 목록 요약"><p>전체 {manifest.totalChanges.toLocaleString('ko-KR')}건 · {manifest.pageHashes.length}쪽 · 확인 필요 {manifest.blockerCount}건</p><p className="ttops-muted">원본 기준과 전체 목록 지문을 확인했습니다. 분할 목록의 확정 연결 전에는 이 화면에서 확정하지 않습니다.</p>{Date.parse(manifest.expiresAt) <= Date.now() && <p role="status">전체 변경 목록의 확인 기한이 지났습니다. 다시 조회해 주세요.</p>}
      {manifest.pageHashes.length > 0 && <div className="ttboard-actions"><button type="button" className="secondary" disabled={disabled || busy || !page || page.index === 0} onClick={() => void load((page?.index ?? 0) - 1)}>이전 상세</button><span>{page ? page.index + 1 : 0}/{manifest.pageHashes.length}쪽</span><button type="button" className="secondary" disabled={disabled || busy || Boolean(page && page.index + 1 >= manifest.pageHashes.length)} onClick={() => void load(page ? page.index + 1 : 0)}>{page ? '다음 상세' : '첫 상세 확인'}</button></div>}
      {page && <OperationChangeList key={page.index} changes={page.changes} timeZone={timeZone} />}
    </section>}
  </details>
}
