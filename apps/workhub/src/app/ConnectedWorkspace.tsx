import {guidedSetupOrigin,guidedSetupSuggestion,type GuidedSetupAiOrigin,type GuidedSetupAiSuggestion} from '../documents/guided-setup-ai'
import { assistantDocumentDraft, documentAssistantRequest, studentAssistantRequest } from './pilot-handoff'
import type { AssistantContextRequest } from '../assistant/contracts'
import type { DocumentAiDraft } from '../documents/contracts'
import type { MessageComposeRequest } from '../messaging/MessagingWorkspace'
import type { GeneratedDocument } from '../documents/guided-contracts'
import { guidedAiOrigin, guidedAiSuggestion, type GuidedAiOrigin, type GuidedAiSuggestion } from '../documents/guided-ai'
import { knowledgeAssistantContext, validKnowledgeOpenRequest, type KnowledgeOpenRequest } from '../knowledge/assistant-links'
import { createCollectionOperations } from '../collections/operations'
import '../typography.css'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HomeOverviewPanel } from '../home/HomeOverviewPanel'
import { homeCountLabels } from '../home/counts'
import type { HomeKind } from '../home/overview'
import { CalendarPanel } from '../calendar/CalendarPanel'
import { activeAt } from '../domain'
import { createSupabaseConnection, type SupabaseConnection } from '../connection/supabase-connection'
import { createSupabaseCalendarAdapter } from '../connection/supabase-calendar'
import type { ConnectionContext } from '../connection/contracts'
import theme from '../style.css?inline'
import timetableNavigationStyles from './timetable-navigation.css?inline'
import { ConnectionReadinessPanel } from './ConnectionReadinessPanel'
import { createSupabaseTaskAdapter } from '../tasks/supabase-task-adapter'
import { TaskPanel } from '../tasks/TaskPanel'
import { WorkspaceShell } from './WorkspaceShell'
import { ModuleBoundary } from './ModuleBoundary'
import { useWorkspaceNavigation } from './navigation'
import { enabledModules, type PageId } from '../modules'
import { WorkspaceSearch } from '../search/WorkspaceSearch'
import { WorkspaceHelp } from '../support/WorkspaceHelp'
import { createConnectedSearchSources } from '../search/connected-sources'
import type { SearchItem } from '../search/contracts'
import { useResourceNavigation } from './resource-navigation'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from './pending-requests'
import { watchSchoolDay } from './school-day'
import { ConnectionRecoveryActions } from './ConnectionRecoveryActions'
import { createEditDrafts, EditDraftsProvider } from './edit-drafts'
import { createSupabaseCollectionServer } from '../collections/supabase-collections'

const AssistantPanel = lazy(() => import('../assistant/AssistantPanel').then(module => ({ default: module.AssistantPanel })))
const DocumentsWorkspace = lazy(() => import('../documents/DocumentsWorkspace').then(module => ({ default: module.DocumentsWorkspace })))
const CooperationWorkspace = lazy(() => import('../cooperation/CooperationWorkspace').then(module => ({ default: module.CooperationWorkspace })))
const CalendarBatchImport = lazy(() => import('../calendar/CalendarBatchImport').then(module => ({ default: module.CalendarBatchImport })))

const SchoolAdminPanel = lazy(() => import('../administration/SchoolAdministration').then(module => ({ default: module.SchoolAdministration })))
const TimetableAgendaWorkspace = lazy(() => import('../timetable/TimetableAgendaPanel').then(module => ({ default: module.TimetableAgendaWorkspace })))
const TimetableActionSummary = lazy(() => import('../timetable/TimetableActionSummary').then(module => ({ default: module.TimetableActionSummary })))
const TimetableWorkspace = lazy(() => import('../timetable/TimetableWorkspace').then(module => ({ default: module.TimetableWorkspace })))
const TeachingWorkspace = lazy(() => import('../teaching/TeachingWorkspace').then(module => ({ default: module.TeachingWorkspace })))
const MessagingWorkspace = lazy(() => import('../messaging/MessagingWorkspace').then(module => ({ default: module.MessagingWorkspace })))
const KnowledgeWorkspace = lazy(() => import('../knowledge/KnowledgeWorkspace').then(module => ({ default: module.KnowledgeWorkspace })))

const CollectionServerPanel = lazy(() => import('../collections/CollectionServerPanel').then(module => ({ default: module.CollectionServerPanel })))

const connectedPages = enabledModules('connected').map(module => module.id)

// 기존 앱의 전역 CSS와 신축 화면을 격리한다. 같은 origin·같은 인증 인스턴스를 사용한다.
function StyleBoundary({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<ShadowRoot>()
  useEffect(() => { if (host.current) setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })) }, [])
  return <div ref={host}>{root ? createPortal(<><style>{theme.replaceAll(':root', ':host').replace(/(^|[}\s,])body(?=\s*[{,])/g, '$1.workhub-connected')}{`
    :host{display:block}.workhub-connected{min-height:70vh;border-radius:16px;overflow:hidden}.connected-top{padding:20px 28px;display:flex;gap:24px;align-items:center;border-bottom:1px solid var(--border);background:#fffefa}.connected-top label{max-width:300px;flex:1}.connected-top nav{display:flex;gap:8px}.connected-top nav button[aria-current]{background:#157c75;color:white}.connection-notice{padding:10px 28px;background:#eaf2ef;color:#46645e;font-size:.8rem}.connected-empty{padding:40px;max-width:700px}.connected-error{white-space:pre-wrap}.main-content{padding-top:30px}@media(max-width:720px){.connected-top{align-items:stretch;flex-direction:column;padding:16px;gap:12px}.connected-top label{max-width:none}.connection-notice{padding:12px 16px}}
  `}</style><div className="workhub-connected">{children}</div></>, root) : <p role="status">새 업무 화면을 준비하고 있습니다…</p>}</div>
}

export function ConnectedWorkspace({ expectedUserId, legacyHomeHref, legacyPlanHref, connection: providedConnection }: { expectedUserId: string; legacyHomeHref: string; legacyPlanHref?: string; connection?: SupabaseConnection }) {
  const [connection] = useState(() => providedConnection ?? createSupabaseConnection())
  const [adapter] = useState(() => createSupabaseCalendarAdapter(connection))
  const [taskAdapter] = useState(() => createSupabaseTaskAdapter(connection))
  const [collectionServer] = useState(() => createSupabaseCollectionServer(connection))
  const [collectionOperations] = useState(() => createCollectionOperations(connection))
  const pendingRequests = useMemo(createPendingRequests, [connection, expectedUserId])
  const editDrafts = useMemo(() => createEditDrafts(true), [connection, expectedUserId])
  const draftCount = useSyncExternalStore(editDrafts.subscribe, editDrafts.count, editDrafts.count)
  const pendingCount = useSyncExternalStore(pendingRequests.subscribe, pendingRequests.count, pendingRequests.count)
  useEffect(() => () => editDrafts.clear(), [editDrafts])
  const [context, setContext] = useState<ConnectionContext>()
  const basisDateRef = useRef<string>()
  basisDateRef.current = context?.basisDate
  const [memberId, setMemberId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const [scopeEpoch, setScopeEpoch] = useState(0)
  const [diagnosticEpoch, setDiagnosticEpoch] = useState(0)
  const [taskNavigationLocked, setTaskNavigationLocked] = useState(false)
  const [calendarNavigationLocked, setCalendarNavigationLocked] = useState(false)
  const [collectionNavigationLocked, setCollectionNavigationLocked] = useState(false)
  const [extensionNavigationLocked, setExtensionNavigationLocked] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchNavigationLocked, setBatchNavigationLocked] = useState(false)
  const [handoff, setHandoff] = useState<{scope:string; page:PageId; fromPage:PageId; requestId?:string; taskId?:string}>()
  const [workReturn, setWorkReturn] = useState<{scope:string; page:PageId; fromPage:PageId}>()
  const [assistantContext, setAssistantContext] = useState<{scope:string; id:string; request:AssistantContextRequest}>()
  const [documentDraft, setDocumentDraft] = useState<{scope:string; draft:DocumentAiDraft}>()
  const [setupOrigin,setSetupOrigin]=useState<GuidedSetupAiOrigin>()
  const [setupSuggestion,setSetupSuggestion]=useState<GuidedSetupAiSuggestion>()
  const [guidedOrigin, setGuidedOrigin] = useState<GuidedAiOrigin>()
  const [guidedSuggestion, setGuidedSuggestion] = useState<GuidedAiSuggestion>()
  const [knowledgeOpen, setKnowledgeOpen] = useState<{ scope: string; request: KnowledgeOpenRequest; fromPage?: PageId }>()
  const [messageDraft, setMessageDraft] = useState<{scope:string;draft:MessageComposeRequest}>()
  const [generatedFile, setGeneratedFile] = useState<{scope:string; value:GeneratedDocument}>()
  const [handoffError, setHandoffError] = useState('')
  const [homeListOpen, setHomeListOpen] = useState<{ scope: string; kind: HomeKind; page: PageId }>()
  const [teachingOpen,setTeachingOpen]=useState<{scope:string;courseId:string;token:string;source:'home'|'search'}>()
  const [timetableOpen, setTimetableOpen] = useState<{scope:string;lessonId?:string;requestId?:string;notificationId?:string;date?:string;key:string;fromPage:'home'|'calendar'|'messages'|'schoolAdmin';intent?:{kind:'makeup';lessonId:string;token:string};preparationStep?:'target'|'setup'|'preparation'|'import'}>()
  const clearHandoffs = useCallback(() => {setHandoff(undefined);setWorkReturn(undefined);setAssistantContext(undefined);setDocumentDraft(undefined);setGuidedOrigin(undefined);setGuidedSuggestion(undefined);setSetupOrigin(undefined);setSetupSuggestion(undefined);setKnowledgeOpen(undefined);setMessageDraft(undefined);setGeneratedFile(undefined);setHandoffError('');setTimetableOpen(undefined);setTeachingOpen(undefined);setHomeListOpen(undefined);setBatchOpen(false);setBatchNavigationLocked(false)}, [])

  const checkReadiness = useCallback(() => connection.checkReadiness(), [connection])
  const generation = useRef(0)
  const scopeFingerprint = useRef('')
  const lastVerifiedMemberId = useRef('')
  useEffect(() => { if (memberId) lastVerifiedMemberId.current = memberId }, [memberId])
  useEffect(() => {
    let alive = true, running = false
    let queued: number | undefined
    function refresh(quiet = false) {
      // 동시에 여러 신호가 와도 진행 중 조회 하나와 최신 후속 조회 하나만 유지한다.
      // 요청 즉시 이전 화면 응답을 무효화하고, 서버 문맥 읽기는 순서대로 완료한다.
      queued = ++generation.current
      if (!quiet) { setLoading(true); setContext(undefined); setError('') }
      // 재검증 대기 중에는 이전 실패 안내를 유지한다. 빈 학교 문맥으로 오해시키지 않는다.
      if (!running) void drain()
    }
    async function drain() {
      running = true
      try {
        while (alive && queued !== undefined) {
          const version = queued
          queued = undefined
          if (version !== generation.current) continue
          try {
            const identity = await connection.getIdentity()
            if (!alive || version !== generation.current) continue
            if (!identity?.approved || identity.userId !== expectedUserId || identity.profile?.role !== 'superadmin') { pendingRequests.clear(); editDrafts.clear(); clearHandoffs(); throw new Error('현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다. 기존 앱의 로그인·승인 상태를 확인해 주세요.') }
            const next = await connection.loadContext()
            if (!alive || version !== generation.current) continue
            const mine = next.memberships.filter(item => item.userId === expectedUserId && activeAt(item, next.basisDate))
            const selected = mine.find(item => item.id === lastVerifiedMemberId.current) ?? mine[0]
            const fingerprint = selected ? recoveryScope(selected) : ''
            // 이름·동료 명부·서버 날짜 자체는 편집 권한을 바꾸지 않는다.
            // 내 현재 학교의 유효 권한만 대조하고, 변경되면 기존 초안을 폐기한다.
            pendingRequests.retainScopes(mine.map(recoveryScope))
            if (selected) editDrafts.activate(fingerprint)
            else editDrafts.clear()
            if (scopeFingerprint.current && fingerprint !== scopeFingerprint.current) { clearHandoffs(); setScopeEpoch(value => value + 1) }
            scopeFingerprint.current = fingerprint
            setError('')
            setContext(next)
            setRefreshEpoch(value => value + 1)
            setMemberId(selected?.id ?? '')
          } catch (failure) {
            if (alive && version === generation.current) { setHandoff(undefined); editDrafts.suspend(); setContext(undefined); setError(failure instanceof Error ? failure.message : '학교 연결을 확인하지 못했습니다.') }
          } finally { if (alive && version === generation.current) setLoading(false) }
        }
      } finally { running = false }
    }
    refresh()
    const unsubscribe = connection.subscribeIdentity(() => { refresh(true) })
    const stopInvalidation = connection.subscribeInvalidation(reason => {
      if (!alive) return
      generation.current += 1
      queued = undefined
      // 조회 실패도 화면은 숨긴다. 결과 미확정 명령은 같은 계정·소속 재검증 후에만 다시 표시한다.
      if (reason.code !== 'QUERY_FAILED') { pendingRequests.clear(); editDrafts.clear(); clearHandoffs(); lastVerifiedMemberId.current = '' }
      else editDrafts.suspend()
      setHandoff(undefined)
      setDiagnosticEpoch(value => value + 1)
      setTaskNavigationLocked(false); setCalendarNavigationLocked(false); setCollectionNavigationLocked(false); setExtensionNavigationLocked(false)
      setContext(undefined); setMemberId(''); setLoading(false); setError(reason.message)
    })
    // 계정·권한 판정은 기존 서버 경로를 유지한다. 새 날짜는 재조회 신호로만 사용한다.
    const stopDayWatch = watchSchoolDay(window, () => refresh(true), () => basisDateRef.current)
    const onFocus = () => { refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; queued = undefined; generation.current += 1; stopDayWatch(); unsubscribe(); stopInvalidation(); window.removeEventListener('focus', onFocus) }
  }, [connection, expectedUserId, attempt, pendingRequests, editDrafts, clearHandoffs])
  const member = context?.memberships.find(item => item.id === memberId)
  const school = context?.schools.find(item => item.id === member?.schoolId)
  const connectionUnavailable = loading || !!error || !context || !member || !school
  const currentScope = member ? recoveryScope(member) : ''
  const navigationLocked = batchNavigationLocked || taskNavigationLocked || calendarNavigationLocked || collectionNavigationLocked || extensionNavigationLocked || (connectionUnavailable && (draftCount > 0 || pendingCount > 0))
  const exitLocked = draftCount > 0 || pendingCount > 0
  const navigation = useWorkspaceNavigation({
    allowedPages: connectedPages,
    scopeKey: member ? `${expectedUserId}:${memberId}:${scopeEpoch}` : undefined,
    locked: navigationLocked,
    exitLocked,
  })
  const page = navigation.page as PageId
  const resetKey = `${memberId}:${attempt}:${scopeEpoch}`
  const resource = useResourceNavigation(`${expectedUserId}:${resetKey}`, page, navigation.requestNavigate)
  const navigate = (next: PageId) => { if (!resource.navigate(next)) return false; setHandoff(undefined); setWorkReturn(undefined); return true }
  useEffect(() => { if (workReturn && (page !== workReturn.page || (currentScope && currentScope !== workReturn.scope))) setWorkReturn(undefined) }, [page, currentScope, workReturn])
  // 수업 선택은 한 번의 이동에만 속한다. 다른 메뉴에서 시간표를 다시 열 때 과거 수업을 강제로 열지 않는다.
  useEffect(() => { if (page !== 'timetable') setTimetableOpen(undefined) }, [page])
  useEffect(() => { if (page !== 'students') setTeachingOpen(undefined) }, [page])
  useEffect(() => { if (page !== 'knowledge') setKnowledgeOpen(undefined) }, [page])
  useEffect(() => { if (homeListOpen && (page !== homeListOpen.page || currentScope !== homeListOpen.scope)) setHomeListOpen(undefined) }, [page, currentScope, homeListOpen])
  const searchSources = useMemo(() => member && context ? createConnectedSearchSources(connection,member,context.basisDate,{calendarAdapter:adapter,taskAdapter,collectionServer}) : [], [connection,adapter,taskAdapter,collectionServer,member,context])
  const requested = resource.current
  useEffect(() => {
    if (!handoff || !currentScope || navigationLocked || handoff.scope !== currentScope) return
    if (handoff.fromPage !== page) {setHandoff(undefined);return}
    const moved = handoff.taskId && handoff.page === 'tasks' ? resource.openSearchItem({kind:'task',id:handoff.taskId,title:'',description:'',meta:''}) : handoff.requestId ? resource.openCollection(handoff.requestId) : resource.navigate(handoff.page)
    if (moved) {
      // 이동에 성공한 현재 학교의 작업만 복귀 경로로 보관한다. 이동 자체로 전송·제출하지 않는다.
      setWorkReturn(handoff.page !== 'knowledge' && handoff.page !== handoff.fromPage ? {scope:handoff.scope,page:handoff.page,fromPage:handoff.fromPage} : undefined)
      setHandoff(undefined)
    }
  }, [handoff, currentScope, navigationLocked, resource, page])
  function openSearchItem(item: SearchItem) {
    if (!member || navigationLocked) return false
    if (item.kind === 'knowledge') {
      if (item.version === undefined || item.locator === undefined) return false
      const request = {key:crypto.randomUUID(),schoolId:member.schoolId,memberId:member.id,sourceId:item.id,sourceVersion:item.version,title:item.title,locator:item.locator}
      if (!validKnowledgeOpenRequest(request,member) || !navigate('knowledge')) return false
      setKnowledgeOpen({scope:currentScope,request,fromPage:page}); return true
    }
    if (item.kind === 'course') {
      if (!navigate('students')) return false
      setTeachingOpen({scope:currentScope,courseId:item.id,token:crypto.randomUUID(),source:'search'}); return true
    }
    if (!resource.openSearchItem(item)) return false
    setHandoff(undefined);setWorkReturn(undefined);return true
  }
  function sendToAssistant(request: AssistantContextRequest, origin?: GuidedAiOrigin) {
    if (!member) return
    setHandoffError('');setSetupOrigin(undefined);setSetupSuggestion(undefined);setGuidedOrigin(origin);setGuidedSuggestion(undefined);setAssistantContext({scope:currentScope,id:origin?.id ?? crypto.randomUUID(),request});setHandoff({scope:currentScope,fromPage:page,page:'assistant'})
  }

  function discardUnsentInput() {
    if (pendingRequests.count() > 0) return false
    editDrafts.clear(); clearHandoffs()
    setTaskNavigationLocked(false); setCalendarNavigationLocked(false); setCollectionNavigationLocked(false); setExtensionNavigationLocked(false)
    navigation.clearAnnouncement()
    return true
  }
  return <EditDraftsProvider store={editDrafts}><PendingRequestsProvider store={pendingRequests}><StyleBoundary>
    <style>{timetableNavigationStyles}</style>
    <div className="connection-notice">신축 기능 시험 · 기존 Google 로그인과 회원 계정을 그대로 사용합니다. 현재 슈퍼관리자에게만 공개됩니다.</div>
    {connectionUnavailable ? <main id="main-content" className="connected-empty">
      {loading ? <>
        <h1>학교 연결 확인 중</h1>
        <p role="status">현재 계정의 승인 상태와 학교 소속을 확인하고 있습니다.</p>
      </> : error ? <>
        <h1>학교 연결을 완료하지 못했습니다</h1>
        <p className="connected-error" role="alert">{error}</p>
        <p>운영 연결 전에는 가상 자료로 대체하지 않습니다.</p>
      </> : <>
        <h1>연결된 학교 소속이 없습니다</h1>
        <p>기존 계정은 보존되어 있습니다. 신축 DB 기반과 기존 회원의 학교 소속 연결이 적용된 뒤 이용할 수 있습니다.</p>
      </>}
      {!loading && <button className="secondary" onClick={() => setAttempt(value => value + 1)}>학교 연결 다시 확인</button>}
      <ConnectionRecoveryActions hasDraft={draftCount > 0} hasPending={pendingCount > 0}
        announcement={navigation.announcement} onDiscard={discardUnsentInput} legacyHomeHref={legacyHomeHref} />
    </main> :
      <WorkspaceShell mode="connected" page={page} onNavigate={navigate} schoolName={school.name} memberName={member.name}
        storageLabel={page === 'timetable' ? '학교 서버에서 확인' : page === 'collections' ? '학교 계정으로 연결' : '현재 학교 서버에 저장'} locked={navigationLocked} notice={navigation.announcement}
        quickActions={<><WorkspaceSearch key={`${expectedUserId}:${resetKey}:${page}`} scopeKey={`${expectedUserId}:${resetKey}`} sources={searchSources} locked={navigationLocked} onOpen={openSearchItem} /><WorkspaceHelp key={resetKey} connection={connection} memberId={member.id} scopeKey={`${expectedUserId}:${resetKey}:${currentScope}`} locked={navigationLocked} onNavigate={navigate}/></>}
        contextControls={<label>사용할 학교<select disabled={navigationLocked || exitLocked} value={memberId} onChange={event => { const value = event.target.value; navigation.requestAction(() => { resource.clear(); clearHandoffs(); const nextMember = context.memberships.find(item => item.id === value); if (nextMember) { scopeFingerprint.current = recoveryScope(nextMember); editDrafts.activate(scopeFingerprint.current) } else editDrafts.clear(); lastVerifiedMemberId.current = value; setMemberId(value) }) }}>{context.memberships.filter(item => item.userId === expectedUserId && activeAt(item, context.basisDate)).map(item => <option key={item.id} value={item.id}>{context.schools.find(value => value.id === item.schoolId)?.name ?? '학교'} · {item.name}</option>)}</select></label>}>
        <ModuleBoundary moduleName={enabledModules('connected').find(item => item.id === page)?.title ?? '업무실'} resetKey={`${resetKey}:${page}`}>
          {handoffError && <p role="alert">{handoffError}</p>}
          {workReturn?.scope === currentScope && workReturn.page === page && <nav aria-label="작업 연결" className="timetable-source-navigation">
            <button type="button" className="text-button" disabled={navigationLocked} onClick={() => navigate(workReturn.fromPage)}>{workReturn.fromPage === 'assistant' ? 'AI 비서로 돌아가기' : workReturn.fromPage === 'knowledge' ? '학교 자료로 돌아가기' : `${enabledModules('connected').find(item => item.id === workReturn.fromPage)?.title ?? '이전 작업'}으로 돌아가기`}</button>
            <span>{page === 'messages' ? '전달받은 초안은 받는 사람과 내용을 확인한 뒤 전송하세요.' : page === 'collections' ? '연결한 문서와 제출 대상을 확인한 뒤 첨부·제출하세요.' : page === 'documents' ? 'AI 초안을 검토하고 필요한 내용만 반영하세요.' : '답변을 확인한 뒤 원래 작업을 이어갈 수 있습니다.'}</span>
            {navigationLocked && <span role="status">작성 중인 내용을 마치거나 같은 요청의 결과를 확인한 뒤 돌아갈 수 있습니다.</span>}
          </nav>}
          {homeListOpen?.scope === currentScope && homeListOpen.page === page && <nav aria-label="홈 업무 목록 연결" className="timetable-source-navigation">
            <button type="button" className="text-button" disabled={navigationLocked} onClick={() => navigate('home')}>홈 업무 요약으로 돌아가기</button>
            <span>{homeCountLabels[homeListOpen.kind].label}에서 이동했습니다. 이 목록에는 다른 상태의 항목도 표시됩니다.</span>
          </nav>}
          {page === 'timetable' && timetableOpen?.scope === currentScope && <nav aria-label="시간표 연결 동선" className="timetable-source-navigation">
            <button type="button" className="text-button" disabled={navigationLocked} onClick={() => navigate(timetableOpen.fromPage)}>{timetableOpen.fromPage === 'schoolAdmin' ? '학교 준비 안내로 돌아가기' : timetableOpen.fromPage === 'messages' ? '메시지·알림으로 돌아가기' : timetableOpen.fromPage === 'calendar' ? '학교 일정으로 돌아가기' : '홈으로 돌아가기'}</button>
            <span>{timetableOpen.preparationStep ? '학교 준비 안내에서 연 입력 화면' : timetableOpen.requestId || timetableOpen.notificationId ? '알림에서 연 시간표 변경 요청' : `${timetableOpen.fromPage === 'calendar' ? '학교 일정' : '홈'}에서 연 ${timetableOpen.date} 수업`}</span>
            {navigationLocked && <span role="status">작성 중인 내용을 마치거나 같은 요청의 결과를 확인한 뒤 돌아갈 수 있습니다.</span>}
          </nav>}
          {['schoolAdmin', 'students', 'messages', 'knowledge', 'documents', 'assistant', 'cooperation', 'timetable'].includes(page) ? <main id="main-content" className="main-content">{page !== 'timetable' && <header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>{enabledModules('connected').find(item => item.id === page)?.title}</h1></div></header>}<Suspense fallback={<p role="status">업무 화면을 준비하는 중…</p>}>
            {page === 'schoolAdmin' ? <SchoolAdminPanel initialGuideOpen={timetableOpen?.scope === currentScope && timetableOpen.fromPage === 'schoolAdmin'} onOpenPreparation={destination => { if (destination === 'teaching') navigate('students'); else if (['target','setup','preparation','import'].includes(destination) && navigate('timetable')) setTimetableOpen({scope:currentScope,key:crypto.randomUUID(),fromPage:'schoolAdmin',preparationStep:destination as 'target'|'setup'|'preparation'|'import'}) }} onUpdated={() => setAttempt(value => value + 1)} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} /> :
             page === 'timetable' ? <TimetableWorkspace initialPreparationStep={timetableOpen?.scope === currentScope ? timetableOpen.preparationStep : undefined} initialIntent={timetableOpen?.scope === currentScope ? timetableOpen.intent : undefined} initialNotificationId={timetableOpen?.scope === currentScope ? timetableOpen.notificationId : undefined} initialRequestId={timetableOpen?.scope === currentScope ? timetableOpen.requestId : undefined} initialLessonId={timetableOpen?.scope === currentScope ? timetableOpen.lessonId : undefined} initialDate={timetableOpen?.scope === currentScope ? timetableOpen.date : undefined} key={`${resetKey}:${timetableOpen?.key ?? ''}`} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} onOpenSchoolAdmin={() => navigate('schoolAdmin')} onOpenTeaching={() => navigate('students')} /> :
             page === 'students' ? <TeachingWorkspace initialRequest={teachingOpen?.scope===currentScope?teachingOpen:undefined} onRequestStudentDraft={source => { try { sendToAssistant(studentAssistantRequest(source,member)) } catch { setHandoffError('현재 학교와 학생 근거를 다시 확인해 주세요.') } }} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} /> :
             page === 'messages' ? <MessagingWorkspace openRequest={requested?.kind === 'message' && requested.id ? { key: requested.key, id: requested.id } : undefined} onReturnToSource={requested?.kind === 'message' ? () => resource.navigate('home') : undefined} composeRequest={messageDraft?.scope === currentScope ? messageDraft.draft : undefined} onComposeRequestConsumed={() => setMessageDraft(undefined)} canOpenSource={source => ['calendar', 'tasks', 'collections', 'cooperation', 'timetable'].includes(source.module)} onOpenSource={source => { if (source.module === 'timetable') { if (!navigate('timetable')) throw new Error('작성 중인 내용을 확인한 뒤 시간표 요청을 열어 주세요.'); setTimetableOpen({ scope: currentScope, notificationId: source.id, key: crypto.randomUUID(), fromPage: 'messages' }); return } const moved = source.module === 'cooperation' ? resource.openCooperation(source.id) : source.module === 'collections' ? resource.openCollection(source.id) : (source.module === 'tasks' || source.module === 'calendar') ? resource.openSearchItem({ kind: source.module === 'tasks' ? 'task' : 'calendar', id: source.id, title: '', description: '', meta: '' }) : false; if (!moved) throw new Error('작성 중인 내용을 확인한 뒤 원본을 열어 주세요.') }} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} /> :
             page === 'assistant' ? <AssistantPanel onOpenTask={id => setHandoff({scope:currentScope,fromPage:page,page:'tasks',taskId:id})} onOpenKnowledgeCitation={value => {
               const request = {...value,key:crypto.randomUUID()}
               if (!validKnowledgeOpenRequest(request,member)) throw new Error('현재 학교의 인용인지 확인하지 못했습니다.')
               setKnowledgeOpen({scope:currentScope,request});setHandoff({scope:currentScope,fromPage:page,page:'knowledge'})
             }} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} contextRequest={assistantContext?.scope === currentScope ? assistantContext : undefined} onComposeMessage={value => {setMessageDraft({scope:currentScope,draft:{id:value.requestId,schoolId:member.schoolId,memberId:member.id,body:value.body}});setHandoff({scope:currentScope,fromPage:page,page:'messages'})}} onNavigationLockChange={setExtensionNavigationLocked} onUpdated={() => setRefreshEpoch(value => value + 1)} onDraftReady={(value, contextId) => {try {
               const draft = assistantDocumentDraft(value,member)
               if (value.intent === 'guided_collection') {
                 if(setupOrigin?.scope===currentScope&&setupOrigin.id===contextId){setSetupSuggestion(guidedSetupSuggestion({origin:setupOrigin,requestId:value.requestKey,body:draft.body},member));setGuidedSuggestion(undefined)}
                 else{if (!guidedOrigin || guidedOrigin.scope !== currentScope || guidedOrigin.id !== contextId) throw new Error('질문형 원본 연결 없음')
                 setGuidedSuggestion(guidedAiSuggestion({origin:guidedOrigin,requestId:value.requestKey,body:draft.body},member));setSetupSuggestion(undefined)}setDocumentDraft(undefined)
               } else {setDocumentDraft({scope:currentScope,draft});setGuidedSuggestion(undefined);setSetupSuggestion(undefined)}
               setHandoff({scope:currentScope,fromPage:page,page:'documents'})
             } catch {setHandoffError('초안의 원래 양식·근거와 학생 범위를 확인하지 못했습니다. 원래 답변은 유지됩니다.')}}} /> :
             page === 'documents' ? <DocumentsWorkspace onOpenFileCollections={()=>setHandoff({scope:currentScope,fromPage:page,page:'collections'})} guidedSetupAiSuggestion={setupSuggestion?.origin.scope===currentScope?setupSuggestion:undefined} onRequestGuidedSetupAi={value=>{
               const origin=guidedSetupOrigin(value.origin,member)
               if(value.request.intent!=='guided_collection')throw new Error('질문형 준비 요청 불일치')
               const request=documentAssistantRequest(value.request)
               setGuidedOrigin(undefined);setGuidedSuggestion(undefined);setSetupOrigin(origin);setSetupSuggestion(undefined);setHandoffError('');setAssistantContext({scope:currentScope,id:origin.id,request});setHandoff({scope:currentScope,fromPage:page,page:'assistant'})
             }} openRequest={requested?.kind === 'document' && requested.id ? {key:requested.key,id:requested.id,version:requested.version} : undefined} legacyPlanHref={legacyPlanHref} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} aiDraft={documentDraft?.scope === currentScope ? documentDraft.draft : undefined} guidedAiSuggestion={guidedSuggestion?.origin.scope === currentScope ? guidedSuggestion : undefined} onRequestGuidedAi={value => {try {
               const origin = guidedAiOrigin(value.origin,member)
               if (value.request.intent !== 'guided_collection') throw new Error('질문형 작성 요청 불일치')
               sendToAssistant(documentAssistantRequest(value.request),origin)
             } catch {throw new Error('AI로 전달할 양식과 답변을 확인하지 못했습니다. 작성 중인 내용은 유지됩니다.')}}} onRequestAi={input => {try{sendToAssistant(documentAssistantRequest(input))}catch{setHandoffError('AI로 전달할 제목·입력 길이와 근거를 확인해 주세요. 문서 입력은 보관되어 있습니다.')}}} onOpenCollection={requestId => setHandoff({scope:currentScope,fromPage:page,page:'collections',requestId})} onUseGenerated={value => {setGeneratedFile({scope:currentScope,value});setHandoff({scope:currentScope,fromPage:page,page:'collections',requestId:value.requestId})}} /> :
             page === 'cooperation' ? <CooperationWorkspace openRequest={requested?.kind === 'cooperation' && requested.id ? { key: requested.key, id: requested.id } : undefined} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} onOpenTask={id => resource.openSearchItem({kind:'task',id,title:'',description:'',meta:''})} /> :
             <KnowledgeWorkspace returnLabel={knowledgeOpen?.fromPage ? '이전 화면으로 돌아가기' : undefined} openRequest={knowledgeOpen?.scope === currentScope ? knowledgeOpen.request : undefined} onReturnToSource={knowledgeOpen?.scope === currentScope && knowledgeOpen.fromPage !== 'knowledge' ? () => {navigate(knowledgeOpen.fromPage ?? 'assistant')} : undefined} onAskAssistant={request => sendToAssistant(knowledgeAssistantContext(request,member))} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setExtensionNavigationLocked} />}
          </Suspense></main> : page === 'collections' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>자료 수합</h1><p>양식을 배부하고 제출된 파일을 확인하세요.</p></div></header><Suspense fallback={<p role="status">자료 수합 화면을 준비하고 있습니다…</p>}><CollectionServerPanel key={resetKey} server={collectionServer} operations={collectionOperations} incomingFile={generatedFile?.scope === currentScope ? generatedFile.value : undefined} onIncomingFileConsumed={() => setGeneratedFile(undefined)} member={member} members={context.memberships} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setCollectionNavigationLocked} openRequest={requested?.kind === 'collection' && requested.id ? { key: requested.key, id: requested.id } : undefined} /></Suspense></main> : page === 'tasks' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>내 업무</h1><p>현재 학교에서 내가 할 일을 정리하고 진행 상황을 확인하세요.</p></div></header><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setTaskNavigationLocked} openRequest={requested?.kind === 'task' ? { key: requested.key, taskId: requested.id, dueFilter: requested.dueFilter } : undefined} /></main> :
            page === 'calendar' && batchOpen ? <main id="main-content" className="main-content"><header className="page-header"><h1 tabIndex={-1}>시트에서 일정 가져오기</h1></header><Suspense fallback={<p role="status">일괄 가져오기를 준비하고 있습니다…</p>}><CalendarBatchImport connection={connection} member={member} members={context.memberships} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setBatchNavigationLocked} onClose={() => setBatchOpen(false)} onSaved={() => setRefreshEpoch(value => value + 1)} /></Suspense></main> :
            <CalendarPanel key={resetKey} member={member} members={context.memberships} schoolName={school.name} date={context.basisDate} adapter={adapter} revision={refreshEpoch}
              page={page === 'calendar' ? 'calendar' : 'home'} onPageChange={navigate} onNavigationLockChange={setCalendarNavigationLocked} onOpenBatchImport={() => setBatchOpen(true)}
              relationOptions={context.schoolLabels[school.id] ?? context.relationLabels} storageLabel="현재 학교 서버에 저장"
              openRequest={requested?.kind === 'calendar' && requested.id ? { key: requested.key, id: requested.id } : undefined}
              renderLessonAgenda={lessonDate => <ModuleBoundary moduleName="내 수업" resetKey={`${resetKey}:${lessonDate}`}><Suspense fallback={<p role="status">내 수업을 확인하는 중…</p>}><TimetableAgendaWorkspace connection={connection} member={member} date={lessonDate} revision={refreshEpoch} onOpen={(lessonId, date) => {if(resource.navigate('timetable'))setTimetableOpen({scope:currentScope,lessonId,date,key:crypto.randomUUID(),fromPage:page === 'calendar' ? 'calendar' : 'home'})}} /></Suspense></ModuleBoundary>}
              homePriority={<><ModuleBoundary moduleName="확인할 일" resetKey={resetKey}><HomeOverviewPanel connection={connection} member={member} revision={refreshEpoch} locked={navigationLocked} onOpenList={kind => { const target = homeCountLabels[kind].page; if (navigate(target)) setHomeListOpen({ scope: currentScope, kind, page: target }) }} onOpen={item => { if (item.kind === 'collection' || item.kind === 'supplement') resource.openCollection(item.sourceId); else if (item.kind === 'cooperation') resource.openCooperation(item.sourceId); else if (item.kind === 'message') resource.openMessage(item.sourceId); else if(navigate('students'))setTeachingOpen({scope:currentScope,courseId:item.sourceId,token:crypto.randomUUID(),source:'home'}) }} /></ModuleBoundary><ModuleBoundary moduleName="시간표 확인할 일" resetKey={resetKey}><Suspense fallback={null}><TimetableActionSummary connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onOpen={item => { if (navigate('timetable')) { const key = crypto.randomUUID(); setTimetableOpen({ scope: currentScope, notificationId: item.requestId ?? undefined, lessonId: item.lessonId ?? undefined, date: item.date, key, fromPage: 'home', ...(item.kind === 'makeup' && item.lessonId ? { intent: { kind: 'makeup', lessonId: item.lessonId, token: key } as const } : {}) }) } }} /></Suspense></ModuleBoundary></>}
              homeExtras={<ModuleBoundary moduleName="내 업무" resetKey={resetKey}><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} compact onNavigationLockChange={setTaskNavigationLocked} onOpenTasks={resource.openTasks} /></ModuleBoundary>} />}
        </ModuleBoundary>
      </WorkspaceShell>}
    <ConnectionReadinessPanel key={`${expectedUserId}:${diagnosticEpoch}`} expectedUserId={expectedUserId} runCheck={checkReadiness} />
  </StyleBoundary></PendingRequestsProvider></EditDraftsProvider>
}
