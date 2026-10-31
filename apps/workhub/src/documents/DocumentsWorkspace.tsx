import libraryStyles from './library-ui.css?inline'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { useEditDraft } from '../app/edit-drafts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { canonical, ServiceError } from '../services/service-values'
import { requestBlobDownload } from '../files/download'
import { createDocumentsService, type DocumentsService } from './adapter'
import { blankDocument, documentAiDraft, documentAiRequest, documentCommand, documentInput, documentKindLabels, documentPlainText, DOCUMENT_KINDS, type DocumentAiDraft, type DocumentAiRequest, type DocumentCommand, type DocumentInput, type LibraryDocument } from './contracts'
import { DocumentReviewTools } from './DocumentReviewTools'
import { readSavedDocument } from './document-review'
import { GuidedWorkspace } from './GuidedWorkspace'
import type { GeneratedDocument } from './guided-contracts'
import type { GuidedAiRequest, GuidedAiSuggestion } from './guided-ai'
import type { GuidedSetupAiRequest, GuidedSetupAiSuggestion } from './guided-setup-ai'
import documentStyles from './documents.css?inline'

export interface DocumentsWorkspaceProps {
  connection: SupabaseConnection; member: Membership; date: string; revision?: number
  onNavigationLockChange?: (locked: boolean) => void
  onRequestAi?: (request: DocumentAiRequest) => void
  onRequestGuidedAi?: (request: GuidedAiRequest) => void
  guidedAiSuggestion?: GuidedAiSuggestion
  onRequestGuidedSetupAi?: (request:GuidedSetupAiRequest)=>void
  guidedSetupAiSuggestion?: GuidedSetupAiSuggestion
  onOpenFileCollections?:()=>void
  legacyPlanHref?: string
  aiDraft?: DocumentAiDraft
  openRequest?: { key: string; id: string; version?: number }
  onOpenCollection?: (requestId: string) => void
  onUseGenerated?: (file: GeneratedDocument) => void
  service?: DocumentsService
}
type Pending = { command: DocumentCommand; key: string }
type Memory = { input: DocumentInput; original: LibraryDocument | null; origin: LibraryDocument['origin']; editing: boolean; pending: Pending | null; folded: boolean }
const problemOf = (error: unknown) => error instanceof ServiceError ? error : new ServiceError('QUERY_FAILED')
const inputOf = (value: LibraryDocument): DocumentInput => ({ title: value.title, kind: value.kind, body: value.body, visibility: value.visibility, sources: value.sources, basisDate: value.basisDate, studentContext: value.studentContext })
const statusLabels = { draft: '작성 중', confirmed: '내용 확인 완료', archived: '보관함' }
const scaffolds = { parent_letter: '제목\n\n안내 목적\n\n대상\n\n일정 및 장소\n\n안내 내용\n\n협조 사항\n\n문의', event_plan: '추진 목적\n\n운영 개요\n\n세부 일정\n\n역할 분담\n\n준비 사항\n\n안전 계획\n\n예산', event_report: '실시 개요\n\n운영 내용\n\n참여 현황\n\n운영 결과\n\n개선 사항\n\n관련 자료', student_record: '', rubric: '평가 목적\n\n평가 대상 및 기간\n\n평가 과제\n\n평가 요소\n\n수준별 기준\n\n확인할 학교 규정', general: '' }

const openToken = (request: DocumentsWorkspaceProps['openRequest']) => request ? JSON.stringify([request.key, request.id, request.version ?? null]) : null
export function DocumentsWorkspace(props: DocumentsWorkspaceProps) {
  const scope = recoveryScope(props.member), token = openToken(props.openRequest)
  const binding = useRef({ scope, token })
  // 다른 계정·학교로 바뀌어도 남은 이전 화면의 열기 요청은 다시 실행하지 않는다.
  if (binding.current.token !== token) binding.current = { scope, token }
  return <DocumentsRouter key={scope} {...props} openRequest={binding.current.scope === scope ? props.openRequest : undefined} />
}
function DocumentsRouter(props: DocumentsWorkspaceProps) {
  const route = useEditDraft<{tab:'library'|'guided'; aiId?:string; guidedId?:string;setupId?:string}>(props.member, 'documents-route')
  const libraryRecovery = usePendingRequest(props.member, 'documents'), guidedRecovery = usePendingRequest(props.member, 'guidedDocuments')
  const seenAi = useRef(route.initial?.aiId), consumedSuggestion = useRef(route.initial?.guidedId), consumedSetup = useRef(route.initial?.setupId)
  const [opened, setOpened] = useState<string | null>(null)
  const target = openToken(props.openRequest) === opened ? undefined : props.openRequest
  const [tab, setTab] = useState<'library' | 'guided'>(() => guidedRecovery.request ? 'guided' : libraryRecovery.request ? 'library' : props.guidedSetupAiSuggestion && props.guidedSetupAiSuggestion.requestId !== consumedSetup.current ? 'guided' : props.guidedAiSuggestion && props.guidedAiSuggestion.requestId !== consumedSuggestion.current ? 'guided' : props.aiDraft && props.aiDraft.requestId !== seenAi.current ? 'library' : route.initial?.tab ?? 'library'), [locked, setLocked] = useState(false)
  const onLock = useCallback((value: boolean) => { setLocked(value); props.onNavigationLockChange?.(value) }, [props.onNavigationLockChange])
  const recovering = Boolean(libraryRecovery.request || guidedRecovery.request)
  useEffect(() => { if (props.aiDraft && !locked && !recovering && seenAi.current !== props.aiDraft.requestId) { seenAi.current = props.aiDraft.requestId; setTab('library') } }, [props.aiDraft, locked, recovering])
  useEffect(() => { if (props.guidedAiSuggestion && !locked && !recovering && consumedSuggestion.current !== props.guidedAiSuggestion.requestId) { consumedSuggestion.current = props.guidedAiSuggestion.requestId; setTab('guided') } }, [props.guidedAiSuggestion, locked, recovering])
  useEffect(() => { if (props.guidedSetupAiSuggestion && !locked && !recovering && consumedSetup.current !== props.guidedSetupAiSuggestion.requestId) { consumedSetup.current = props.guidedSetupAiSuggestion.requestId; setTab('guided') } }, [props.guidedSetupAiSuggestion, locked, recovering])
  // AI 도움 요청 뒤에도 원래 문서 작업으로 돌아온다. 탭 기억은 미저장 입력 경고에 포함하지 않는다.
  useEffect(() => { route.save({tab,aiId:seenAi.current,guidedId:consumedSuggestion.current,setupId:consumedSetup.current},false) }, [tab, props.aiDraft, props.guidedAiSuggestion, props.guidedSetupAiSuggestion, route])
  return <div className="documents-workspace document-library-ui"><style>{documentStyles}</style><style>{libraryStyles}</style><div className="documents-tabs" aria-label="문서 작업 선택"><button type="button" aria-pressed={tab === 'library'} disabled={locked && tab !== 'library'} onClick={() => setTab('library')}>내 문서함</button><button type="button" aria-pressed={tab === 'guided'} disabled={locked && tab !== 'guided'} onClick={() => setTab('guided')}>질문형 수합 양식</button></div>{tab === 'guided' && target && <section className="documents-status" aria-label="선택한 문서 열기 대기"><p>선택한 문서가 있습니다. 작성 중인 양식은 먼저 입력을 보관하고 접어 주세요. 처리 결과를 모르는 요청은 원래 요청 번호로 확인한 뒤 열 수 있습니다.</p><button type="button" disabled={locked || recovering} onClick={() => setTab('library')}>선택한 문서 열기</button></section>}{tab === 'library' ? <DocumentsWorkspaceScope {...props} openRequest={target} onOpenRequestHandled={setOpened} onNavigationLockChange={onLock} /> : <GuidedWorkspace connection={props.connection} member={props.member} date={props.date} revision={props.revision} onNavigationLockChange={onLock} onRequestAi={props.onRequestAi} onRequestGuidedSetupAi={props.onRequestGuidedSetupAi} setupAiSuggestion={props.guidedSetupAiSuggestion} onOpenFileCollections={props.onOpenFileCollections} onRequestGuidedAi={props.onRequestGuidedAi} aiSuggestion={props.guidedAiSuggestion} onOpenCollection={props.onOpenCollection} onUseGenerated={props.onUseGenerated} />}</div>
}
function DocumentsWorkspaceScope({ connection, member, date, revision = 0, onNavigationLockChange, onRequestAi, legacyPlanHref, aiDraft, openRequest, onOpenRequestHandled, service: supplied }: DocumentsWorkspaceProps & { onOpenRequestHandled: (token: string) => void }) {
  const service = useMemo(() => supplied ?? createDocumentsService(connection), [connection, supplied]), id = useId(), memory = useEditDraft<Memory>(member, 'document-editor'), recovery = usePendingRequest(member, 'documents')
  const [saved] = useState(() => memory.initial)
  const [restored] = useState(() => { try { return recovery.request ? documentCommand(recovery.request.command) : null } catch { return null } })
  const [input, setInput] = useState(saved?.input ?? (restored && 'input' in restored ? restored.input : blankDocument(date))), [original, setOriginal] = useState<LibraryDocument | null>(saved?.original ?? null), [origin, setOrigin] = useState<LibraryDocument['origin']>(saved?.origin ?? (restored?.kind === 'create' ? restored.origin : null))
  const [editing, setEditing] = useState(saved?.editing ?? Boolean(restored && 'input' in restored)), [pending, setPending] = useState<Pending | null>(() => {
    if (recovery.request) { try { return { key: recovery.request.key, command: documentCommand(recovery.request.command) } } catch { return saved?.pending ?? null } }
    return saved?.pending ?? null
  })
  const [folded, setFolded] = useState(saved?.folded ?? Boolean(pending)), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState(''), [denied, setDenied] = useState(false)
  const [items, setItems] = useState<LibraryDocument[]>([]), [cursor, setCursor] = useState<string | null>(null), [canShare, setCanShare] = useState(false), [selected, setSelected] = useState<LibraryDocument | null>(null)
  const [history, setHistory] = useState<Awaited<ReturnType<DocumentsService['history']>>>([]), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [archived, setArchived] = useState(false), [refresh, setRefresh] = useState(0)
  const [discard, setDiscard] = useState(false), [conflict, setConflict] = useState<LibraryDocument | null>(null), [proposal, setProposal] = useState<DocumentAiDraft | null>(null), [beforeAi, setBeforeAi] = useState<DocumentInput | null>(null)
  const externalToken = openToken(openRequest), currentTarget = useRef(externalToken)
  currentTarget.current = externalToken
  const [requested, setRequested] = useState<{ token: string; phase: 'waiting' | 'loading' | 'failed'; message?: string } | null>(null)
  const seenOpen = useRef<string | null>(null), selectionGeneration = useRef(0)
  const alive = useRef(true), writing = useRef(false), generation = useRef(0), bodyInput = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null), seenAi = useRef<string | null>(null), focusEditor = useRef(false)
  const enabled = activeAt(member, date), dirty = editing && canonical(input) !== canonical(original ? inputOf(original) : blankDocument(date)), locked = busy || Boolean(pending)
  const navigationLocked = busy || Boolean(conflict) || (!folded && (dirty || Boolean(pending)))
  // 입력을 시작한 뒤 예약된 초점 이동이 제목 입력을 가로채지 않도록 DOM 반영 직후 한 번만 실행한다.
  useLayoutEffect(() => {
    if (!focusEditor.current || !editing || folded) return
    focusEditor.current = false
    bodyInput.current?.focus()
    bodyInput.current?.scrollIntoView({ block: 'center' })
  })
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; selectionGeneration.current++ } }, [service])
  useEffect(() => { onNavigationLockChange?.(navigationLocked); return () => onNavigationLockChange?.(false) }, [navigationLocked, onNavigationLockChange])
  useEffect(() => { memory.save(dirty || pending ? { input, original, origin, editing, pending, folded } : undefined, dirty || Boolean(pending)) }, [input, original, origin, editing, pending, folded, dirty, memory])
  useEffect(() => { if (!dirty && !pending) return; const listener = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener) }, [dirty, pending])
  function fail(error: unknown, setter = setError) {
    if (!alive.current) return
    const problem = problemOf(error); setter(problem.message)
    if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(problem.code)) { setDenied(true); setItems([]); setSelected(null); setOriginal(null); setInput(blankDocument(date)); setEditing(false); setPending(null); recovery.remove(); memory.remove(); setProposal(null); setBeforeAi(null) }
    if (problem.code === 'CANCELLED') { setItems([]); setSelected(null); setProposal(null) }
  }
  async function load(more = false) {
    const current = ++generation.current; setLoading(true); setLoadError('')
    try {
      const result = await service.list(member.id, search, archived, more ? cursor : null)
      if (!alive.current || current !== generation.current) return
      setItems(previous => more ? [...new Map([...previous, ...result.items].map(item => [item.id, item])).values()] : result.items); setCursor(result.nextCursor); setCanShare(result.canShare); setDenied(false)
    } catch (error) { if (current === generation.current) { if (!more) setItems([]); fail(error, setLoadError) } }
    finally { if (alive.current && current === generation.current) setLoading(false) }
  }
  useEffect(() => { if (!enabled) { setDenied(true); return }; void load(); return () => { generation.current++ } }, [service, enabled, search, archived, refresh, revision])
  useEffect(() => {
    if (!aiDraft || seenAi.current === aiDraft.requestId) return
    try { const checked = documentAiDraft(aiDraft, member); seenAi.current = checked.requestId; setProposal(checked) } catch { setError('AI 초안의 현재 학교와 근거 정보를 확인하지 못했습니다.') }
  }, [aiDraft, member.id, member.schoolId])
  useEffect(() => {
    if (!externalToken || seenOpen.current === externalToken) return
    seenOpen.current = externalToken
    setRequested({ token: externalToken, phase: 'waiting' })
  }, [externalToken])
  useEffect(() => {
    if (requested?.phase === 'waiting' && requested.token === externalToken && openRequest && !dirty && !locked && !conflict && !loading && !loadError && enabled && !denied) void open(openRequest, openRequest.version, requested.token)
  }, [requested, externalToken, dirty, locked, conflict, loading, loadError, enabled, denied])
  async function open(document: Pick<LibraryDocument, 'id'>, requestedVersion?: number, requestToken?: string, preserveInput = false) {
    if (locked || dirty && !preserveInput || writing.current || conflict) return
    const turn = ++selectionGeneration.current, listTurn = generation.current
    const current = () => alive.current && turn === selectionGeneration.current && listTurn === generation.current && (!requestToken || currentTarget.current === requestToken)
    if (preserveInput && dirty) setFolded(true)
    setBusy(true); setError(''); setSelected(null); setHistory([])
    if (requestToken) setRequested({ token: requestToken, phase: 'loading' })
    let finished = false
    try {
      const fresh = await service.get(member.id, document.id, requestedVersion)
      if (!current()) return
      if (fresh.id !== document.id || requestedVersion !== undefined && fresh.version !== requestedVersion) throw new ServiceError('INVALID_RESPONSE')
      const history = await service.history(member.id, document.id)
      if (!current()) return
      setSelected(fresh)
      // 조회 이력의 개수 제한 밖에 있는 판도 선택칸에 정확히 표시한다. 본문은 단건 조회로 확인한 판이다.
      setHistory(history.some(item => item.version === fresh.version) ? history : [...history, { version: fresh.version, recordedAt: fresh.updatedAt, status: fresh.status }].sort((left, right) => right.version - left.version))
      if (requestToken) { setRequested(null); onOpenRequestHandled(requestToken) }
      finished = true
    } catch (error) {
      if (!current()) return
      fail(error)
      if (requestToken) setRequested({ token: requestToken, phase: 'failed', message: '선택한 문서의 저장판을 확인하지 못했습니다. 다른 판으로 대신 열지 않습니다.' })
      finished = true
    } finally {
      if (alive.current && turn === selectionGeneration.current) {
        setBusy(false)
        if (!finished && requestToken && currentTarget.current === requestToken) setRequested({ token: requestToken, phase: 'failed', message: '조회 중 현재 자료가 바뀌었습니다. 선택한 문서를 다시 확인해 주세요.' })
      }
    }
  }
  function begin(document: LibraryDocument | null, copy = false) {
    if (locked || dirty) return
    focusEditor.current = true
    setInput(document ? { ...inputOf(document), title: copy ? `${document.title} (사본)` : document.title, visibility: copy ? 'private' : document.visibility } : blankDocument(date)); setOriginal(copy ? null : document); setOrigin(copy && document ? { documentId: document.id, version: document.version } : document?.origin ?? null)
    setEditing(true); setFolded(false); setDiscard(false); setConflict(null); setError(''); setBeforeAi(null)
  }
  function close() {
    if (locked) return
    if (dirty && !discard) { setDiscard(true); return }
    setEditing(false); setInput(blankDocument(date)); setOriginal(null); setOrigin(null); setConflict(null); setDiscard(false); memory.remove(); heading.current?.focus()
  }
  async function perform(command: DocumentCommand, key = `document-${crypto.randomUUID()}`, recovering = false) {
    if (writing.current) return
    const checked = documentCommand(command); writing.current = true; setBusy(true); setError(''); setNotice('')
    const next = { command: checked, key }; setPending(next); recovery.put(next)
    try {
      const receipt = recovering && loadError ? await service.recover(member.id, checked, key) : await service.mutate(member.id, checked, key)
      if (!alive.current) return
      setPending(null); recovery.remove(key); setEditing(false); setOriginal(null); setInput(blankDocument(date)); setConflict(null); memory.remove(); setFolded(false); setBeforeAi(null)
      setNotice(`문서 v${receipt.version}을 저장했습니다.${checked.kind === 'confirm' ? ' 내용을 확인한 버전으로 표시했습니다.' : checked.kind === 'archive' ? ' 보관함으로 옮겼습니다.' : ' 작성 중 초안이며 제출이나 결재가 완료된 것은 아닙니다.'}`); setRefresh(value => value + 1)
      try { const document = await service.get(member.id, receipt.documentId); if (alive.current) setSelected(document) } catch { if (alive.current) setNotice(`문서 v${receipt.version} 저장은 확인했습니다. 목록을 새로 불러오면 원본을 확인할 수 있습니다.`) }
    } catch (error) {
      if (!alive.current) return
      const problem = problemOf(error)
      if (!['RESULT_UNKNOWN', 'QUERY_FAILED', 'INVALID_RESPONSE', 'CANCELLED', 'IDEMPOTENCY_CONFLICT', 'NOT_READY'].includes(problem.code)) { setPending(null); recovery.remove(key) }
      if (problem.code === 'CONFLICT' && 'documentId' in checked) {
        try { const current = await service.get(member.id, checked.documentId); if (alive.current) { if (checked.kind === 'update') { setConflict(current); setFolded(false) } else setSelected(current) } } catch { /* 최신 내용을 모르면 저장하지 않는다. */ }
      }
      fail(problem)
    } finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  function save() { try { const checked = documentInput(input); void perform(original ? { kind: 'update', documentId: original.id, expectedVersion: original.version, input: checked } : { kind: 'create', input: checked, origin }) } catch (error) { fail(error) } }
  function applyAi() {
    if (!proposal || locked || conflict) return
    if ((Boolean(input.studentContext) !== Boolean(proposal.studentContext) && original) || (input.studentContext && proposal.studentContext && (input.studentContext.studentId !== proposal.studentContext.studentId || input.studentContext.courseId !== proposal.studentContext.courseId))) { setError('다른 학생의 기록 초안은 별도 새 문서에서 검토해 주세요. 현재 문서를 먼저 닫아 주세요.'); return }
    setBeforeAi(structuredClone(input)); setInput(value => ({ ...value, title: proposal.title, body: proposal.body, sources: proposal.sources, studentContext: proposal.studentContext, kind: proposal.studentContext ? 'student_record' : value.kind === 'student_record' ? 'general' : value.kind, visibility: proposal.studentContext ? 'private' : value.visibility })); setEditing(true); setFolded(false); setProposal(null); setNotice('AI 초안을 입력에 반영했습니다. 내용과 근거를 직접 확인한 뒤 저장해 주세요.')
  }
  async function exportText(document: LibraryDocument) {
    if (locked || writing.current || loading || loadError || denied || !enabled) return
    const turn = generation.current
    writing.current = true; setBusy(true); setError(''); setNotice('')
    let output = false
    try {
      const fresh = await readSavedDocument(service, member, document)
      if (!alive.current || generation.current !== turn) return
      output = true
      requestBlobDownload(new Blob([documentPlainText(fresh)], { type: 'text/plain;charset=utf-8' }), `${fresh.title} v${fresh.version}.txt`)
      setNotice(`v${fresh.version} 저장판의 본문 내려받기를 요청했습니다. 작성 중인 입력은 포함하지 않습니다.${fresh.studentContext ? ' 학생 기록은 검토 초안이며 현재 근거와 공식 입력 기준을 다시 확인해 주세요.' : ' HWPX 양식이 필요한 경우 확인한 양식을 연결해 주세요.'}`)
    } catch (failure) {
      if (!alive.current || generation.current !== turn) return
      if (output) setError('본문 파일을 내려받지 못했습니다. 입력은 유지했으며 다시 누르면 저장판을 재확인합니다.')
      else { setSelected(null); setHistory([]); fail(failure); setError('선택한 저장판과 현재 조회 권한을 확인하지 못해 내려받기를 중단했습니다. 문서를 다시 열어 주세요.') }
    } finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="documents-workspace document-library-ui" aria-labelledby={`${id}-heading`}><style>{documentStyles}</style><style>{libraryStyles}</style>
    <header className="documents-header"><div><h2 id={`${id}-heading`} tabIndex={-1} ref={heading}>문서함</h2><p className="documents-muted">초안부터 확인한 문서까지, 버전과 근거를 함께 보관합니다.</p></div><div className="documents-actions"><button type="button" className="documents-primary" disabled={!enabled || denied || locked || dirty || loading || Boolean(loadError)} onClick={() => begin(null)}>새 문서 작성</button>{legacyPlanHref && <a href={legacyPlanHref} target="_blank" rel="noopener noreferrer">기존 평가계획서 작성 · 새 탭</a>}</div></header>
    {notice && <div className="documents-status" role="status">{notice}</div>}{error && <div className="documents-status" role="alert">{error}</div>}
    {requested && requested.token === externalToken && openRequest && <section className="documents-status" aria-label="선택한 문서 열기 대기"><p role={requested.phase === 'failed' ? 'alert' : 'status'}>{requested.message ?? (requested.phase === 'loading' ? '선택한 문서와 저장판을 확인하고 있습니다…' : pending ? '이전 저장 결과를 먼저 확인해 주세요. 원래 입력과 요청 번호를 유지하고 있습니다.' : dirty ? '작성 중인 입력이 있습니다. 현재 탭에 입력을 보관하고 선택한 문서를 열 수 있습니다.' : '선택한 문서를 열 준비를 확인하고 있습니다.')}</p>{requested.phase !== 'loading' && <button type="button" disabled={locked || Boolean(conflict) || loading || Boolean(loadError) || denied || !enabled} onClick={() => void open(openRequest, openRequest.version, requested.token, true)}>{dirty ? '입력 보관하고 선택한 문서 열기' : '선택한 문서 다시 열기'}</button>}</section>}
    {pending && <section className="documents-status" aria-label="문서 저장 결과 확인"><h3>이전 저장 결과를 먼저 확인해 주세요</h3><p>입력과 요청 번호는 현재 탭에 보관했습니다. 서버 준비를 확인하지 못하면 기존 접수증만 조회합니다.</p><div className="documents-actions"><button type="button" disabled={busy || !enabled || denied} onClick={() => void perform(pending.command, pending.key, true)}>같은 문서 요청 다시 확인</button><button type="button" disabled={busy} onClick={() => setFolded(value => !value)}>{folded ? '보관한 문서 입력 보기' : '입력 접고 문서함 보기'}</button></div></section>}
    {(!enabled || denied) ? <p role="alert">현재 학교의 문서함 이용 권한을 다시 확인해 주세요.</p> : <>
      {proposal && <section className="documents-panel" aria-label="AI 문서 초안 비교"><h3>AI가 제안한 초안</h3><p className="documents-muted">현재 입력과 비교한 뒤 반영 여부를 결정합니다. 아직 저장되지 않았습니다.</p><div className="documents-comparison"><div><h4>현재 입력</h4><p className="documents-body">{input.body || '작성한 내용 없음'}</p></div><div><h4>{proposal.title}</h4><p className="documents-body">{proposal.body}</p><Sources sources={proposal.sources} /></div></div><div className="documents-actions"><button type="button" disabled={locked || Boolean(conflict)} onClick={applyAi}>이 초안을 입력에 반영</button><button type="button" onClick={() => setProposal(null)}>제안 닫기</button></div></section>}
      {editing && <form hidden={folded} className="documents-editor" aria-label="문서 초안 작성" onSubmit={event => { event.preventDefault(); save() }}><h3>{original ? `문서 수정 · v${original.version}` : '새 문서 초안'}</h3>
        {conflict && <section className="documents-status" aria-label="문서 변경 비교"><h4>다른 곳에서 먼저 저장했습니다</h4><div className="documents-comparison"><div><h4>최신 원본 · v{conflict.version}</h4><DocumentContents document={conflict} /></div><div><h4>내 입력</h4><DocumentContents document={input} /></div></div><div className="documents-actions"><button type="button" disabled={busy} onClick={() => { setOriginal(conflict); setConflict(null); setNotice('최신 버전을 기준으로 바꿨습니다. 내 입력을 다시 확인한 뒤 저장해 주세요.') }}>비교 완료 · 내 입력으로 계속 수정</button><button type="button" disabled={busy} onClick={() => { setInput(inputOf(conflict)); setOriginal(conflict); setConflict(null) }}>최신 원본 사용</button></div></section>}
        <fieldset disabled={locked || Boolean(conflict)}><legend>문서 정보와 본문</legend><div className="library-metadata"><label htmlFor={`${id}-title`}>문서 제목<input id={`${id}-title`} value={input.title} maxLength={200} required onChange={event => setInput(value => ({ ...value, title: event.target.value }))} /></label><div className="documents-fields"><label htmlFor={`${id}-kind`}>문서 종류<select aria-label="문서 종류" id={`${id}-kind`} value={input.kind} disabled={Boolean(input.studentContext)} onChange={event => setInput(value => ({ ...value, kind: event.target.value as DocumentInput['kind'] }))}>{DOCUMENT_KINDS.filter(kind => kind !== 'student_record' || input.studentContext).map(kind => <option key={kind} value={kind}>{documentKindLabels[kind]}</option>)}</select></label><label htmlFor={`${id}-date`}>기준일<input type="date" id={`${id}-date`} value={input.basisDate} required onChange={event => setInput(value => ({ ...value, basisDate: event.target.value }))} /></label></div><label htmlFor={`${id}-visibility`}>공개 범위<select aria-label="공개 범위" id={`${id}-visibility`} value={input.visibility} disabled={Boolean(input.studentContext)} onChange={event => setInput(value => ({ ...value, visibility: event.target.value as DocumentInput['visibility'] }))}><option value="private">나만 보기</option><option value="school" disabled={!canShare}>학교 선생님과 공유</option></select></label></div><div><label htmlFor={`${id}-body`}>문서 본문</label><textarea id={`${id}-body`} ref={bodyInput} value={input.body} maxLength={100000} required onChange={event => setInput(value => ({ ...value, body: event.target.value }))} /></div><div className="documents-actions"><button type="button" disabled={Boolean(input.body) || input.kind === 'general'} onClick={() => setInput(value => ({ ...value, body: scaffolds[value.kind] }))}>빈 본문에 기본 항목 넣기</button>{onRequestAi && <button type="button" onClick={() => { try { const request = documentAiRequest(input, original); setFolded(true); onRequestAi(request) } catch { setError('본문이 길어 한 번에 전달할 수 없습니다. 먼저 문서를 저장한 뒤 저장된 원본으로 AI 초안을 요청해 주세요. 입력은 유지했습니다.') } }}>현재 입력으로 AI 초안 요청</button>}</div><Sources sources={input.sources} />{input.studentContext && <p className="documents-status">학생 기록 검토용 초안입니다. 나만 보기로 보관하며, 공식 생활기록부에 자동 기재하지 않습니다. 근거 {input.studentContext.evidence.length}건의 버전·해시·범위를 보존합니다.</p>}{beforeAi && <button type="button" onClick={() => { setInput(beforeAi); setBeforeAi(null) }}>AI 반영 전 입력으로 되돌리기</button>}</fieldset>
        {!pending && <div className="documents-actions"><button type="submit" className="documents-primary" disabled={locked || Boolean(conflict)}>초안 저장</button><button type="button" disabled={locked} onClick={close}>{discard ? '입력 버리고 닫기' : '작성 닫기'}</button>{dirty && <button type="button" disabled={busy} onClick={() => setFolded(true)}>입력 접고 문서함 보기</button>}</div>}{discard && <p role="status">닫기를 한 번 더 누르면 아직 저장하지 않은 입력을 버립니다.</p>}
      </form>}
      {editing && folded && !pending && <div className="documents-status"><p>작성 중인 문서를 현재 탭에 보관했습니다.</p><button type="button" onClick={() => setFolded(false)}>문서 작성 계속하기</button></div>}
      <form className="documents-filters" onSubmit={event => { event.preventDefault(); setSearch(query); setRefresh(value => value + 1) }}><label htmlFor={`${id}-search`}>문서 검색<input id={`${id}-search`} type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><button type="submit" disabled={loading}>검색</button><label className="documents-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />보관함 포함</label><button type="button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>새로고침</button></form>
      {loadError && <div className="documents-status" role="alert"><p>{loadError} 문서가 없는 것으로 처리하지 않습니다.</p><button type="button" onClick={() => setRefresh(value => value + 1)}>문서함 다시 연결</button></div>}{loading && <p role="status">문서함을 불러오는 중…</p>}
      <div className="documents-grid"><section className="documents-panel" aria-label="문서 목록"><div className="library-list-heading"><h3>보관한 문서</h3>{!loading && !loadError && <span>불러온 문서 {items.length}개</span>}</div><ul className="documents-list">{items.map(item => <li key={item.id}><button type="button" disabled={locked || dirty} aria-current={selected?.id === item.id} onClick={() => void open(item)}><strong>{item.title}</strong><span className="documents-muted">{documentKindLabels[item.kind]} · v{item.version} · {statusLabels[item.status]} · {item.visibility === 'private' ? '나만 보기' : '학교 공유'}</span></button></li>)}</ul>{!loading && !loadError && items.length === 0 && <p className="documents-muted">조건에 맞는 문서가 없습니다.</p>}{cursor && <button type="button" disabled={loading} onClick={() => void load(true)}>문서 더 보기</button>}</section>
        <section className="documents-panel" aria-label="선택한 문서">{selected ? <><h3>{selected.title}</h3><p className="documents-muted">v{selected.version} · {statusLabels[selected.status]} · {selected.version === selected.latestVersion ? '최신 버전' : '이전 기록'}</p><div className="documents-actions library-detail-actions"><button type="button" disabled={locked || dirty || !selected.canEdit || selected.status === 'archived'} onClick={() => begin(selected)}>이 문서 수정</button><button type="button" disabled={locked || dirty} onClick={() => begin(selected, true)}>이 문서부터 새로 작성</button><button type="button" disabled={locked || loading || Boolean(loadError) || denied || !enabled} onClick={() => void exportText(selected)}>본문 내려받기</button>{selected.canEdit && selected.status === 'draft' && <button type="button" disabled={locked || dirty} onClick={() => void perform({ kind: 'confirm', documentId: selected.id, expectedVersion: selected.version })}>내용 확인 완료</button>}{selected.canEdit && selected.status !== 'archived' && <button type="button" disabled={locked || dirty} onClick={() => void perform({ kind: 'archive', documentId: selected.id, expectedVersion: selected.version })}>보관함으로 이동</button>}</div><DocumentContents document={selected} /><label htmlFor={`${id}-history`}>저장 이력<select id={`${id}-history`} value={selected.version} disabled={locked || dirty} onChange={event => void open(selected, Number(event.target.value))}>{history.map(item => <option key={item.version} value={item.version}>v{item.version} · {statusLabels[item.status]}</option>)}</select></label><DocumentReviewTools key={`${selected.id}:${selected.version}`} document={selected} service={service} member={member} disabled={locked || loading || Boolean(loadError) || denied || !enabled} revision={revision} /></> : <p className="documents-muted">문서를 선택하면 본문과 저장 이력을 확인할 수 있습니다.</p>}</section>
      </div>
    </>}
  </section>
}
function Sources({ sources }: { sources: DocumentInput['sources'] }) { return sources.length ? <div><h4>확인할 근거</h4><ul className="documents-source-list">{sources.map((source, index) => <li key={`${source.kind}:${source.sourceId}:${source.sourceVersion}:${index}`}><span>{source.locator} · v{source.sourceVersion}</span>{source.quote && <blockquote>{source.quote}</blockquote>}</li>)}</ul></div> : <p className="documents-muted">연결한 근거가 없습니다. 문서의 날짜·수치·학교 규정을 직접 확인해 주세요.</p> }
function DocumentContents({ document }: { document: DocumentInput }) { return <><dl className="library-document-meta"><dt>제목</dt><dd>{document.title}</dd><dt>종류</dt><dd>{documentKindLabels[document.kind]}</dd><dt>기준일</dt><dd>{document.basisDate}</dd><dt>공개 범위</dt><dd>{document.visibility === 'private' ? '나만 보기' : '학교 공유'}</dd></dl><p className="documents-body library-document-body">{document.body}</p><Sources sources={document.sources} /></> }
