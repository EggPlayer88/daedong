import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { activeAt } from '../domain'
import { ServiceError } from '../services/scoped-rpc'
import { createKnowledgeService } from './adapter'
import { sourceEffective, type KnowledgeRevision } from './contracts'
import { KnowledgeSourceFile } from './KnowledgeImport'
import { knowledgeAssistantRequest, validKnowledgeOpenRequest, type KnowledgeAssistantRequest, type KnowledgeOpenRequest } from './assistant-links'

interface Props {
  connection: SupabaseConnection; member: Membership; date: string; revision: number; request: KnowledgeOpenRequest
  onAskAssistant?: (request: KnowledgeAssistantRequest) => void | Promise<void>
  onReturnToSource?: () => void
  returnLabel?: string
  context?: 'citation' | 'history'
}
export function KnowledgeCitationPanel(props: Props) {
  if (!validKnowledgeOpenRequest(props.request, props.member)) return <section className="knowledge-citation" role="alert">현재 계정·학교와 맞지 않는 원문 요청은 열지 않습니다.</section>
  return <CitationScope key={`${recoveryScope(props.member)}:${props.request.key}:${props.request.sourceId}:${props.request.sourceVersion}`} {...props} />
}
function CitationScope({ connection, member, date, revision, request, onAskAssistant, onReturnToSource, returnLabel = '비서 답변으로 돌아가기', context = 'citation' }: Props) {
  const service = useMemo(() => createKnowledgeService(connection), [connection])
  const [reload, setReload] = useState(0), [handing, setHanding] = useState(false)
  const readKey = useMemo(() => ({}), [service, member, date, request.sourceId, request.sourceVersion, revision, reload])
  const [read, setRead] = useState<{ key: object; result?: KnowledgeRevision; error: string; loading: boolean }>()
  // 권한·학교·판이 달라진 렌더에서는 effect 전에 이전 원문부터 숨긴다.
  const current = read?.key === readKey ? read : undefined
  const result = current?.result, source = result?.source, error = current?.error ?? '', loading = !current || current.loading
  const heading = useRef<HTMLHeadingElement>(null), generation = useRef(0), flight = useRef(false)
  useEffect(() => {
    const epoch = ++generation.current
    setRead({ key: readKey, error: '', loading: true }); setHanding(false)
    if (!activeAt(member, date)) { setRead({ key: readKey, error: '현재 학교 소속을 확인한 뒤 원문을 열어 주세요.', loading: false }); return }
    void service.get(member.id, request.sourceId, request.sourceVersion).then(value => {
      if (generation.current === epoch) setRead({ key: readKey, result: value, error: '', loading: false })
    }).catch(failure => {
      if (generation.current === epoch) setRead({ key: readKey, error: failure instanceof ServiceError ? failure.message : '요청한 판의 원문을 확인하지 못했습니다. 다시 확인해 주세요.', loading: false })
    })
    return () => { generation.current++ }
  }, [readKey])
  useEffect(() => { if (!loading) heading.current?.focus() }, [loading])
  const canAsk = !!result?.isCurrent && !!source && sourceEffective(source, date)
  async function ask() {
    if (flight.current || !source || !canAsk || !onAskAssistant) return
    const epoch = generation.current
    flight.current = true; setHanding(true)
    try { await onAskAssistant(knowledgeAssistantRequest(source, member, date)) }
    catch { if (epoch === generation.current) setRead(value => value?.key === readKey ? { ...value, error: '자료를 비서에게 전달하지 못했습니다. 원문은 그대로 유지했습니다.' } : value) }
    finally { flight.current = false; if (epoch === generation.current) setHanding(false) }
  }
  const label = context === 'citation' ? '인용 원문 확인' : '선택한 판 원문'
  return <section className="knowledge-citation" aria-label={label}>
    <header><h3 tabIndex={-1} ref={heading}>{label} · {request.sourceVersion}판</h3>{onReturnToSource && <button type="button" disabled={handing} onClick={onReturnToSource}>{returnLabel}</button>}</header>
    <p>{request.title}{context === 'citation' && ` · 인용 위치: ${request.locator}`}</p>
    {loading ? <p role="status">요청한 판의 원문과 현재 열람 권한을 확인하고 있습니다.</p> : error ? <p role="alert">{error}</p> : source && result ? <>
      <p>{source.title} · {source.version}판 · {source.status === 'draft' ? '초안' : source.status === 'retired' ? '게시 종료' : '게시'} · {result.isCurrent ? '최신 판' : '과거 판'}</p>
      <p>적용 기간: {source.effectiveFrom}~{source.effectiveThrough || '종료일 없음'} · 기록 시각: {source.updatedAt}</p><p>{source.locator}</p>
      {!result.isCurrent && <p role="status">과거에 보관한 원문입니다. 현재 업무의 근거로 비서에게 다시 전달하지 않습니다.</p>}
      {result.isCurrent && !sourceEffective(source, date) && <p role="status">현재 적용 기간 밖이거나 게시 중인 자료가 아닙니다. 현재 업무의 근거로 비서에게 전달하지 않습니다.</p>}
      <div className="knowledge-body">{source.body}</div>
      <KnowledgeSourceFile key={`${source.id}:${source.version}`} connection={connection} member={member} sourceId={source.id} sourceVersion={source.version}/>
      {onAskAssistant && <button type="button" disabled={handing || !canAsk} onClick={() => void ask()}>이 자료로 질문</button>}
    </> : null}
    {!loading && <button type="button" disabled={handing} onClick={() => setReload(value => value + 1)}>원문 다시 확인</button>}
    <p className="knowledge-muted">원본 번호와 판이 일치하는 자료만 표시합니다. 과거 판 조회가 준비되지 않았거나 권한이 없으면 최신 판으로 대신 표시하지 않습니다. HWPX 원본은 해당 판에 연결된 파일만 내려받습니다.</p>
  </section>
}
