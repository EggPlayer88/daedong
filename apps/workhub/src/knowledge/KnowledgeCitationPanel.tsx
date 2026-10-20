import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { activeAt } from '../domain'
import { ServiceError } from '../services/scoped-rpc'
import { createKnowledgeService } from './adapter'
import { sourceEffective, type KnowledgeSource } from './contracts'
import { knowledgeAssistantRequest, validKnowledgeOpenRequest, type KnowledgeAssistantRequest, type KnowledgeOpenRequest } from './assistant-links'

interface Props {
  connection: SupabaseConnection; member: Membership; date: string; revision: number; request: KnowledgeOpenRequest
  onAskAssistant?: (request: KnowledgeAssistantRequest) => void | Promise<void>
  onReturnToSource?: () => void
}
export function KnowledgeCitationPanel(props: Props) {
  if (!validKnowledgeOpenRequest(props.request, props.member)) return <section className="knowledge-citation" role="alert">현재 계정·학교와 맞지 않는 인용 요청은 열지 않습니다.</section>
  return <CitationScope key={`${recoveryScope(props.member)}:${props.request.key}:${props.request.sourceId}:${props.request.sourceVersion}`} {...props} />
}
function CitationScope({ connection, member, date, revision, request, onAskAssistant, onReturnToSource }: Props) {
  const service = useMemo(() => createKnowledgeService(connection), [connection])
  const [cursor, setCursor] = useState<string | null>(null), [reload, setReload] = useState(0), [handing, setHanding] = useState(false)
  const readKey = useMemo(() => ({}), [service, member, date, request.sourceId, cursor, revision, reload])
  const [read, setRead] = useState<{ key: object; source?: KnowledgeSource; nextCursor: string | null; error: string; loading: boolean }>()
  // 새 조회 범위가 렌더된 순간부터 이전 원문을 숨긴다. effect 실행 전에도 과거 권한·판을 재사용하지 않는다.
  const current = read?.key === readKey ? read : undefined
  const source = current?.source, nextCursor = current?.nextCursor, error = current?.error ?? '', loading = !current || current.loading
  const heading = useRef<HTMLHeadingElement>(null), generation = useRef(0), flight = useRef(false), seen = useRef(new Set<string>())
  useEffect(() => {
    seen.current.clear(); setCursor(null)
  }, [service, date, revision, reload])
  useEffect(() => {
    const epoch = ++generation.current
    setRead({ key: readKey, nextCursor: null, error: '', loading: true }); setHanding(false)
    if (!activeAt(member, date)) { setRead({ key: readKey, nextCursor: null, error: '현재 학교 소속을 확인한 뒤 원문을 열어 주세요.', loading: false }); return }
    void service.list(member.id, '', cursor).then(result => {
      if (generation.current !== epoch) return
      const found = result.items.find(item => item.id === request.sourceId)
      if (!found && result.nextCursor) {
        if (result.nextCursor === cursor || seen.current.has(result.nextCursor)) throw new ServiceError('INVALID_RESPONSE')
        seen.current.add(result.nextCursor)
      }
      setRead({ key: readKey, source: found, nextCursor: found ? null : result.nextCursor, error: '', loading: false })
    }).catch(failure => { if (generation.current === epoch) setRead({ key: readKey, nextCursor: null, error: failure instanceof ServiceError ? failure.message : '인용 원문을 확인하지 못했습니다. 다시 확인해 주세요.', loading: false }) })
    return () => { generation.current++ }
  }, [readKey])
  useEffect(() => { if (!loading) heading.current?.focus() }, [loading])
  const exact = source?.version === request.sourceVersion && source.status === 'published'
  async function ask() {
    if (flight.current || !source || !exact || !sourceEffective(source, date) || !onAskAssistant) return
    const epoch = generation.current
    flight.current = true; setHanding(true)
    try { await onAskAssistant(knowledgeAssistantRequest(source, member, date)) }
    catch { if (epoch === generation.current) setRead(value => value?.key === readKey ? { ...value, error: '자료를 비서에게 전달하지 못했습니다. 원문은 그대로 유지했습니다.' } : value) }
    finally { flight.current = false; if (epoch === generation.current) setHanding(false) }
  }
  return <section className="knowledge-citation" aria-label="인용 원문 확인">
    <header><h3 tabIndex={-1} ref={heading}>인용 원문 확인 · {request.sourceVersion}판</h3>{onReturnToSource && <button type="button" disabled={handing} onClick={onReturnToSource}>비서 답변으로 돌아가기</button>}</header>
    <p>{request.title} · 인용 위치: {request.locator}</p>
    {loading ? <p role="status">현재 열람 가능한 원문과 인용한 판을 확인하고 있습니다.</p> : error ? <p role="alert">{error}</p> : exact && source ? <>
      <p>{source.title} · {source.version}판 · {source.effectiveFrom}~{source.effectiveThrough || '종료일 없음'}</p><p>{source.locator}</p>
      {!sourceEffective(source, date) && <p role="status">인용한 판은 확인했지만 현재 적용 기간 밖입니다. 현재 업무의 근거로 비서에게 전달하지 않습니다.</p>}
      <div className="knowledge-body">{source.body}</div>
      {onAskAssistant && <button type="button" disabled={handing || !sourceEffective(source, date)} onClick={() => void ask()}>이 자료로 질문</button>}
    </> : source ? <p role="status">인용한 {request.sourceVersion}판 원문을 현재 조회로 확인할 수 없습니다. {source.version === request.sourceVersion ? '현재 게시된 자료가 아닙니다.' : `현재 조회된 자료는 ${source.version}판입니다.`} 최신 내용으로 인용 원문을 대신 표시하지 않습니다.</p> : nextCursor ? <><p>아직 인용 원문을 찾지 못했습니다. 다음 자료 목록에서 계속 확인할 수 있습니다.</p><button type="button" onClick={() => setCursor(nextCursor)}>다음 자료에서 원문 찾기</button></> : <p role="status">현재 열람 가능한 목록에서 인용 원문을 찾지 못했습니다. 삭제·게시 상태·권한 변경 여부를 확인해 주세요. 최신 자료를 인용한 판으로 대신 표시하지 않습니다.</p>}
    {!loading && <button type="button" disabled={handing} onClick={() => setReload(value => value + 1)}>인용 원문 다시 확인</button>}
    <p className="knowledge-muted">인용한 과거 판을 현재 자료에서 확인할 수 없으면 원문을 표시하지 않습니다. 원본 번호와 판이 모두 일치하는 게시 자료만 표시합니다.</p>
  </section>
}
