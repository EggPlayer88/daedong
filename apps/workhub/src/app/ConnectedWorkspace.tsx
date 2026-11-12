import { teacherPilotAccess, sameTeacherPilot, teacherPilotPages, teacherPilotModules, teacherPilotSearchSources, type TeacherPilotAccess } from '../participation/teacher-pilot-access'
import { EvaluationWorkspace, evaluationLink, type EvaluationTarget, type LegacyEvaluationLinks } from '../assistant/evaluation-workspace'
import { retryableLazy as lazy } from './retryable-lazy'
import {guidedSetupOrigin,guidedSetupSuggestion,type GuidedSetupAiOrigin,type GuidedSetupAiSuggestion} from '../documents/guided-setup-ai'
import { assistantDocumentDraft, documentAssistantRequest, studentAssistantRequest } from './pilot-handoff'
import type { AssistantContextRequest } from '../assistant/contracts'
import type { DocumentAiDraft } from '../documents/contracts'
import type { MessageComposeRequest } from '../messaging/MessagingWorkspace'
import type { CollectionComposeRequest } from '../collections/collection-editor-model'
import type { GeneratedDocument } from '../documents/guided-contracts'
import { guidedAiOrigin, guidedAiSuggestion, type GuidedAiOrigin, type GuidedAiSuggestion } from '../documents/guided-ai'
import { knowledgeAssistantContext, validKnowledgeOpenRequest, type KnowledgeOpenRequest } from '../knowledge/assistant-links'
import { createCollectionOperations } from '../collections/operations'
import '../typography.css'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HomeOverviewPanel } from '../home/HomeOverviewPanel'
import { homeCountLabels } from '../home/counts'
import type { HomeKind } from '../home/overview'
import type { NotificationSource } from '../messaging/contracts'
import type { DailyCommand } from '../assistant/daily-command'
import type { WorkflowResultListener } from './workflow-results'
import { CalendarPanel } from '../calendar/CalendarPanel'
import { buildAssistantCalendarDraft, type AssistantCalendarDraftRequest } from '../calendar/assistant-draft'
import type { AssistantWorkspaceActions } from '../assistant/workspace-model'
import { createConnectedAssistantOperations } from '../assistant/connected-operations'
import { AssistantDeliveryFrame, deliveryKind, hasDeliveryDraft, isDeliveryKind, type DeliveryWorkspace, type DeliveryKind } from '../assistant/delivery-workspace'
import { specialistWorkflow, type SpecialistTask } from '../assistant/specialist-workflows'
import { searchAssistantWorkspace } from '../assistant/workspace-search'
import { activeAt } from '../domain'
import { ContractError } from '../contracts'
import { createSupabaseConnection, type SupabaseConnection } from '../connection/supabase-connection'
import { createSupabaseCalendarAdapter } from '../connection/supabase-calendar'
import type { ConnectionContext } from '../connection/contracts'
import theme from '../style.css?inline'
import timetableNavigationStyles from './timetable-navigation.css?inline'
import { ConnectionReadinessPanel } from './ConnectionReadinessPanel'
import { createSupabaseTaskAdapter } from '../tasks/supabase-task-adapter'
import { TaskPanel } from '../tasks/TaskPanel'
import type { AssistantTaskChangeRequest } from '../tasks/assistant-change'
import { WorkspaceShell } from './WorkspaceShell'
import { AssistantDock } from './AssistantDock'
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
const AssistantDailyWorkspace = lazy(() => import('../assistant/AssistantDailyWorkspace').then(module => ({ default: module.AssistantDailyWorkspace })))
const AssistantCalendarWorkspace = lazy(() => import('../assistant/AssistantCalendarWorkspace').then(module => ({ default: module.AssistantCalendarWorkspace })))
const CalendarBatchImport = lazy(() => import('../calendar/CalendarBatchImport').then(module => ({ default: module.CalendarBatchImport })))

const NeisMeals = lazy(() => import('../neis/NeisMeals').then(module => ({default:module.NeisMeals})))
const SchoolAdminPanel = lazy(() => import('../administration/SchoolAdministration').then(module => ({ default: module.SchoolAdministration })))
const PersonalRosterAgenda = lazy(() => import('../teacher-roster/PersonalRosterAgenda').then(module => ({ default: module.PersonalRosterAgenda })))
const TimetableAgendaWorkspace = lazy(() => import('../timetable/TimetableAgendaPanel').then(module => ({ default: module.TimetableAgendaWorkspace })))
const TimetableActionSummary = lazy(() => import('../timetable/TimetableActionSummary').then(module => ({ default: module.TimetableActionSummary })))
const TimetableWorkspace = lazy(() => import('../timetable/TimetableWorkspace').then(module => ({ default: module.TimetableWorkspace })))
const TeachingWorkspace = lazy(() => import('../teaching/TeachingWorkspace').then(module => ({ default: module.TeachingWorkspace })))
const MessagingWorkspace = lazy(() => import('../messaging/MessagingWorkspace').then(module => ({ default: module.MessagingWorkspace })))
const KnowledgeWorkspace = lazy(() => import('../knowledge/KnowledgeWorkspace').then(module => ({ default: module.KnowledgeWorkspace })))

const CollectionServerPanel = lazy(() => import('../collections/CollectionServerPanel').then(module => ({ default: module.CollectionServerPanel })))

const SchoolTransitions = lazy(() => import('../administration/SchoolTransitions').then(module => ({ default: module.SchoolTransitions })))
const allConnectedPages = enabledModules('connected').map(module => module.id)

// 기존 앱의 전역 CSS와 신축 화면을 격리한다. 같은 origin·같은 인증 인스턴스를 사용한다.
function StyleBoundary({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<ShadowRoot>()
  useEffect(() => { if (host.current) setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })) }, [])
  return <div ref={host}>{root ? createPortal(<><style>{theme.replaceAll(':root', ':host').replace(/(^|[}\s,])body(?=\s*[{,])/g, '$1.workhub-connected')}{`
    :host{display:block}.workhub-connected{min-height:70vh;border-radius:16px;overflow:hidden}.connected-top{padding:20px 28px;display:flex;gap:24px;align-items:center;border-bottom:1px solid var(--border);background:#fffefa}.connected-top label{max-width:300px;flex:1}.connected-top nav{display:flex;gap:8px}.connected-top nav button[aria-current]{background:#157c75;color:white}.connection-notice{padding:10px 28px;background:#eaf2ef;color:#46645e;font-size:.8rem}.connected-empty{padding:40px;max-width:700px}.connected-error{white-space:pre-wrap}.main-content{padding-top:30px}@media(max-width:720px){.connected-top{align-items:stretch;flex-direction:column;padding:16px;gap:12px}.connected-top label{max-width:none}.connection-notice{padding:12px 16px}}
  `}</style><div className="workhub-connected">{children}</div></>, root) : <p role="status">새 업무 화면을 준비하고 있습니다…</p>}</div>
}

export function ConnectedWorkspace({ expectedUserId, legacyHomeHref, legacyPlanHref, legacyEvaluationLinks, connection: providedConnection, teacherPilot }: { expectedUserId: string; legacyHomeHref: string; legacyPlanHref?: string; legacyEvaluationLinks?: LegacyEvaluationLinks; connection?: SupabaseConnection; teacherPilot?: TeacherPilotAccess }) {
  const [connection] = useState(() => providedConnection ?? createSupabaseConnection(undefined, { participant: Boolean(teacherPilot) }))
  const connectedPages = teacherPilot ? teacherPilotPages : allConnectedPages
  const displayModules = teacherPilot ? teacherPilotModules() : enabledModules('connected')
  const pilotKey = teacherPilot ? JSON.stringify(teacherPilot) : ''
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
  const [assistantNavigationLocked, setAssistantNavigationLocked] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantVisited, setAssistantVisited] = useState(false)
  const [delivery, setDelivery] = useState<DeliveryWorkspace>()
  const [deliveryTalking, setDeliveryTalking] = useState(false)
  const [deliveryLocked, setDeliveryLocked] = useState(false)
  const [deliveryTransfer, setDeliveryTransfer] = useState<DeliveryWorkspace>()
  const assistantReturn = useRef<{scope:string;page:PageId}>()
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchNavigationLocked, setBatchNavigationLocked] = useState(false)
  const [handoff, setHandoff] = useState<{scope:string; page:PageId; fromPage:PageId; requestId?:string; taskId?:string; viaAssistant?:boolean}>()
  const [workReturn, setWorkReturn] = useState<{scope:string; page:PageId; fromPage:PageId}>()
  const [assistantContext, setAssistantContext] = useState<{scope:string; id:string; request:AssistantContextRequest}>()
  const [documentDraft, setDocumentDraft] = useState<{scope:string; draft:DocumentAiDraft}>()
  const [setupOrigin,setSetupOrigin]=useState<GuidedSetupAiOrigin>()
  const [setupSuggestion,setSetupSuggestion]=useState<GuidedSetupAiSuggestion>()
  const [guidedOrigin, setGuidedOrigin] = useState<GuidedAiOrigin>()
  const [guidedSuggestion, setGuidedSuggestion] = useState<GuidedAiSuggestion>()
  const [knowledgeOpen, setKnowledgeOpen] = useState<{ scope: string; request: KnowledgeOpenRequest; fromPage?: PageId }>()
  const [messageDraft, setMessageDraft] = useState<{scope:string;draft:MessageComposeRequest}>()
  const [collectionDraft, setCollectionDraft] = useState<{scope:string;draft:CollectionComposeRequest}>()
  const [assistantTask, setAssistantTask] = useState<{scope:string;request:AssistantTaskChangeRequest}>()
  const [assistantCalendar, setAssistantCalendar] = useState<{scope:string;request:AssistantCalendarDraftRequest;prompt:string}>()
  const [generatedFile, setGeneratedFile] = useState<{scope:string; value:GeneratedDocument}>()
  const [handoffError, setHandoffError] = useState('')
  const [homeListOpen, setHomeListOpen] = useState<{ scope: string; kind: HomeKind; page: PageId }>()
  const [teachingOpen,setTeachingOpen]=useState<{scope:string;courseId:string;token:string;source:'home'|'search'}>()
  const [transitionOpen,setTransitionOpen]=useState<{scope:string;key:string;id:string}>()
  const [timetableOpen, setTimetableOpen] = useState<{scope:string;lessonId?:string;requestId?:string;notificationId?:string;date?:string;key:string;fromPage:'home'|'calendar'|'messages'|'schoolAdmin';intent?:{kind:'makeup';lessonId:string;token:string};preparationStep?:'target'|'setup'|'preparation'|'import'}>()
  const clearHandoffs = useCallback(() => {setDelivery(undefined);setDeliveryTransfer(undefined);setDeliveryLocked(false);setDeliveryTalking(false);setAssistantOpen(false);setAssistantVisited(false);setAssistantNavigationLocked(false);setHandoff(undefined);setWorkReturn(undefined);setAssistantContext(undefined);setDocumentDraft(undefined);setGuidedOrigin(undefined);setGuidedSuggestion(undefined);setSetupOrigin(undefined);setSetupSuggestion(undefined);setKnowledgeOpen(undefined);setMessageDraft(undefined);setCollectionDraft(undefined);setAssistantCalendar(undefined);setAssistantTask(undefined);setGeneratedFile(undefined);setHandoffError('');setTimetableOpen(undefined);setTransitionOpen(undefined);setTeachingOpen(undefined);setHomeListOpen(undefined);setBatchOpen(false);setBatchNavigationLocked(false)}, [])

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
            if (!identity?.approved || identity.userId !== expectedUserId || identity.profile?.role !== (teacherPilot ? 'teacher' : 'superadmin')) { pendingRequests.clear(); editDrafts.clear(); clearHandoffs(); throw new Error('현재 로그인 계정으로 업무 화면을 이용할 수 없습니다. 로그인·승인 상태를 확인해 주세요.') }
            if (teacherPilot) {
              const permitted = teacherPilotAccess(await connection.rpcVerified('workhub_teacher_pilot_access'), teacherPilot)
              if (!sameTeacherPilot(teacherPilot, permitted)) throw new Error('시험 참여 기간 또는 허용 범위가 변경됐습니다. 학교 업무 메뉴를 다시 열어 주세요.')
            }
            const next = await connection.loadContext(teacherPilot?.schoolId)
            if (!alive || version !== generation.current) continue
            const mine = next.memberships.filter(item => item.userId === expectedUserId && activeAt(item, next.basisDate) && (!teacherPilot || item.schoolId === teacherPilot.schoolId && item.id === teacherPilot.memberId))
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
            // 창 복귀와 동일 계정의 토큰 갱신이 겹치면 이전 조회만 취소된다.
            // 이 중간 결과로 화면을 비우지 않고 최신 신원·소속을 다시 읽는다.
            // 실제 계정/권한 무효화는 아래 구독에서 세대를 바꾸고 즉시 화면을 닫는다.
            if (alive && version === generation.current && failure instanceof ContractError && failure.code === 'CANCELLED') {
              queued = ++generation.current
              continue
            }
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
      setTaskNavigationLocked(false); setCalendarNavigationLocked(false); setCollectionNavigationLocked(false); setExtensionNavigationLocked(false); setAssistantNavigationLocked(false)
      setContext(undefined); setMemberId(''); setLoading(false); setError(reason.message)
    })
    // 계정·권한 판정은 기존 서버 경로를 유지한다. 새 날짜는 재조회 신호로만 사용한다.
    const stopDayWatch = watchSchoolDay(window, () => refresh(true), () => basisDateRef.current)
    const onFocus = () => { refresh(true) }
    window.addEventListener('focus', onFocus)
    const pilotExpiry = teacherPilot ? setTimeout(() => {
      generation.current++; queued = undefined; editDrafts.suspend(); clearHandoffs(); setContext(undefined); setLoading(false); setError('시험 참여 기간이 끝났습니다. 관리자에게 참여 기간을 확인해 주세요.')
    }, Math.min(2147483647, Math.max(0, Date.parse(teacherPilot.expiresAt) - Date.now()))) : undefined
    return () => { clearTimeout(pilotExpiry); alive = false; queued = undefined; generation.current += 1; stopDayWatch(); unsubscribe(); stopInvalidation(); window.removeEventListener('focus', onFocus) }
  }, [connection, expectedUserId, attempt, pendingRequests, editDrafts, clearHandoffs, pilotKey])
  const member = context?.memberships.find(item => item.id === memberId)
  const school = context?.schools.find(item => item.id === member?.schoolId)
  const connectionUnavailable = loading || !!error || !context || !member || !school
  const currentScope = member ? recoveryScope(member) : ''
  const navigationLocked = deliveryLocked || assistantNavigationLocked || batchNavigationLocked || taskNavigationLocked || calendarNavigationLocked || collectionNavigationLocked || extensionNavigationLocked || (connectionUnavailable && (draftCount > 0 || pendingCount > 0))
  const exitLocked = draftCount > 0 || pendingCount > 0
  const navigation = useWorkspaceNavigation({
    allowedPages: [...connectedPages],
    defaultPage: teacherPilot ? 'assistant' : 'home',
    scopeKey: member ? `${expectedUserId}:${memberId}:${scopeEpoch}` : undefined,
    locked: navigationLocked,
    exitLocked,
  })
  const page = navigation.page as PageId
  const activeDelivery = page === 'assistant' && delivery?.scope === currentScope ? delivery : undefined
  const deliveryResultContext = useRef({ key: activeDelivery?.key, scope: currentScope, date: context?.basisDate, available: !connectionUnavailable })
  deliveryResultContext.current = { key: activeDelivery?.key, scope: currentScope, date: context?.basisDate, available: !connectionUnavailable }
  const resetKey = `${memberId}:${attempt}:${scopeEpoch}`
  const resource = useResourceNavigation(`${expectedUserId}:${resetKey}`, page, navigation.requestNavigate)
  const navigate = (next: PageId) => { if (!resource.navigate(next)) return false; if (next === 'assistant' && page !== 'assistant') assistantReturn.current = {scope:currentScope,page}; setHandoff(undefined); setWorkReturn(undefined); return true }
  useEffect(() => { if (workReturn && (page !== workReturn.page || (currentScope && currentScope !== workReturn.scope))) setWorkReturn(undefined) }, [page, currentScope, workReturn])
  // 수업 선택은 한 번의 이동에만 속한다. 다른 메뉴에서 시간표를 다시 열 때 과거 수업을 강제로 열지 않는다.
  useEffect(() => { if (page !== 'tasks') setAssistantTask(undefined) }, [page])
  useEffect(() => {
    // 일시적으로 신원을 다시 읽을 때는 초안을 보관하고, 확인된 다음 날짜로만 비교한다.
    if (connectionUnavailable || !context) return
    setCollectionDraft(current => current && ((page !== 'collections' && activeDelivery?.kind !== 'collections') || current.draft.basisDate !== context?.basisDate)
      ? undefined : current)
    setMessageDraft(current => current?.draft.basisDate && ((page !== 'messages' && activeDelivery?.kind !== 'messages') || current.draft.basisDate !== context?.basisDate)
      ? undefined : current)
  }, [page, activeDelivery?.kind, context?.basisDate, connectionUnavailable])
  useEffect(() => { if (page !== 'timetable' && activeDelivery?.kind !== 'timetable') setTimetableOpen(undefined) }, [page, activeDelivery?.kind])
  useEffect(() => { if (page !== 'students' && activeDelivery?.kind !== 'students') setTeachingOpen(undefined) }, [page, activeDelivery?.kind])
  useEffect(() => { if (page !== 'knowledge' && activeDelivery?.kind !== 'knowledge') setKnowledgeOpen(undefined) }, [page, activeDelivery?.kind])
  useEffect(() => { if (homeListOpen && (page !== homeListOpen.page || currentScope !== homeListOpen.scope)) setHomeListOpen(undefined) }, [page, currentScope, homeListOpen])
  const searchSources = useMemo(() => {
    const sources = member && context ? createConnectedSearchSources(connection,member,context.basisDate,{calendarAdapter:adapter,taskAdapter,collectionServer}) : []
    return teacherPilot ? teacherPilotSearchSources(sources) : sources
  }, [connection,adapter,taskAdapter,collectionServer,member,context,pilotKey])
  const requested = resource.current
  const deliverySwitchBlocked = (kind: DeliveryKind) => Boolean(activeDelivery && activeDelivery.kind !== kind &&
    hasDeliveryDraft(activeDelivery.kind, editDrafts.dirtySlots(currentScope)))
  function startDelivery(kind: DeliveryKind, request?: DeliveryWorkspace['request'], resume = false, task?: SpecialistTask, options?: { daily?: DailyCommand; inbox?: boolean; list?: boolean; evaluation?: EvaluationTarget; onResult?: WorkflowResultListener }) {
    if (!member || !context || connectionUnavailable || navigationLocked || pendingRequests.count() ||
        !activeAt(member, context.basisDate) || !connectedPages.includes(kind === 'daily' ? 'home' : kind === 'evaluation' ? 'documents' : kind)) return false
    if (teacherPilot && kind === 'schoolAdmin' && task !== 'schoolTransition') return false
    if (!resume && hasDeliveryDraft(kind, editDrafts.dirtySlots(currentScope))) return false
    if (deliverySwitchBlocked(kind)) return false
    // 같은 업무도 미저장 입력이 있으면 새 대상·분야로 다시 마운트하지 않는다.
    if (activeDelivery?.kind === kind && ['timetable','students','schoolAdmin','cooperation','knowledge','calendar','tasks'].includes(kind) &&
        hasDeliveryDraft(kind, editDrafts.dirtySlots(currentScope))) return false
    if (!navigate('assistant')) return false
    // 이전 메뉴 알림·준비 링크는 새 대화 목표에 재사용하지 않는다.
    setTimetableOpen(undefined); setTeachingOpen(undefined); setTransitionOpen(undefined); setKnowledgeOpen(undefined)
    const key = crypto.randomUUID(), sourceScope = currentScope, sourceDate = context.basisDate
    const report = options?.onResult
    const onResult: WorkflowResultListener | undefined = report ? result => {
      const current = deliveryResultContext.current
      if (!current.available || current.key !== key || current.scope !== sourceScope || current.date !== sourceDate || result.scope !== sourceScope) return
      try { report(result) } catch { /* 결과 표시가 원래 처리의 성공·복구를 바꾸지 않는다. */ }
    } : undefined
    setDelivery({ scope: currentScope, kind, key, request, task, ...options, onResult })
    setHandoffError('')
    setDeliveryTalking(false); setDeliveryLocked(false); openAssistant()
    return true
  }
  function queueDeliveryCollection(requestId?: string, value?: GeneratedDocument) {
    if (!member || !activeDelivery || activeDelivery.kind !== 'documents') return
    if (hasDeliveryDraft('collections', editDrafts.dirtySlots(currentScope)) || collectionDraft || generatedFile)
      throw new Error('수합에서 작성 중인 내용을 먼저 확인해 주세요. 생성한 파일은 문서에 유지됩니다.')
    if (value) setGeneratedFile({scope:currentScope,value})
    setDeliveryTransfer({scope:currentScope,kind:'collections',key:crypto.randomUUID(),
      request:requestId ? {key:crypto.randomUUID(),id:requestId} : undefined})
  }
  useEffect(() => {
    if (!deliveryTransfer || deliveryTransfer.scope !== currentScope || connectionUnavailable ||
        navigationLocked || pendingCount || page !== 'assistant') return
    // 생성물 내려받기/접수 결과가 끝나기 전에는 원 문서 편집기를 해제하지 않는다.
    setDelivery(deliveryTransfer); setDeliveryTalking(false); setDeliveryTransfer(undefined)
  }, [deliveryTransfer, currentScope, connectionUnavailable, navigationLocked, pendingCount, page])
  useEffect(() => {
    if (!handoff || !currentScope || navigationLocked || handoff.scope !== currentScope) return
    if (handoff.fromPage !== page) {setHandoff(undefined);return}
    if (handoff.viaAssistant && ['messages','collections','documents','tasks'].includes(handoff.page)) {
      const target = handoff.page as DeliveryKind
      if (startDelivery(target, handoff.taskId ? {key:crypto.randomUUID(),id:handoff.taskId} : handoff.requestId ? {key:crypto.randomUUID(),id:handoff.requestId} : undefined, true)) setHandoff(undefined)
      return
    }
    const moved = handoff.taskId && handoff.page === 'tasks' ? resource.openSearchItem({kind:'task',id:handoff.taskId,title:'',description:'',meta:''}) : handoff.requestId ? resource.openCollection(handoff.requestId) : resource.navigate(handoff.page)
    if (moved) {
      // 이동에 성공한 현재 학교의 작업만 복귀 경로로 보관한다. 이동 자체로 전송·제출하지 않는다.
      setWorkReturn(handoff.page !== 'knowledge' && (handoff.viaAssistant || handoff.page !== handoff.fromPage) ? {scope:handoff.scope,page:handoff.page,fromPage:handoff.viaAssistant ? 'assistant' : handoff.fromPage} : undefined)
      if (handoff.viaAssistant) setAssistantOpen(false)
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
  const assistantActions: AssistantWorkspaceActions = {
    deliveryInConversation: true,
    evaluation(target) {
      return Boolean(evaluationLink(legacyEvaluationLinks,target)) && startDelivery('evaluation', undefined, false, undefined, {evaluation:target})
    },
    daily(command) {
      if (!context || !/^\d{4}-\d{2}-\d{2}$/.test(command.date) || (command.view !== 'meals' && command.date !== context.basisDate)) return false
      return command.view === 'notifications' ? startDelivery('messages', undefined, false, undefined, { inbox: true })
        : startDelivery('daily', undefined, false, undefined, { daily: command })
    },
    specialist(command, onResult) {
      const workflow = specialistWorkflow(command.task)
      return Boolean(workflow && startDelivery(workflow.page, undefined, false, command.task, {onResult}))
    },
    operations: createConnectedAssistantOperations(taskAdapter, adapter, (kind, preparing) => {
      if (!member || !context || connectionUnavailable || !activeAt(member, context.basisDate))
        throw new Error('현재 학교 연결과 소속을 확인해 주세요.')
      const ownPending = pendingRequests.get(currentScope, 'assistantOperation') ? 1 : 0
      if (pendingRequests.count() > (preparing ? 0 : ownPending) || handoff || activeDelivery ||
          taskNavigationLocked || calendarNavigationLocked || collectionNavigationLocked || extensionNavigationLocked || batchNavigationLocked)
        throw new Error('먼저 작성 중인 업무나 결과 확인을 마쳐 주세요. 입력은 유지됩니다.')
      if (kind === 'taskChange' && (assistantTask || editDrafts.bind(currentScope, 'task-editor').initial))
        throw new Error('내 업무 화면에서 작성 중인 내용을 먼저 확인해 주세요.')
      if (kind === 'calendarCreate') {
        const prior = editDrafts.bind<{ editor?: unknown; importing?: boolean }>(currentScope, 'calendar-panel').initial
        if (batchOpen || assistantCalendar || prior?.editor || prior?.importing ||
            ['calendar-editor', 'calendar-import', 'calendar-batch'].some(slot => editDrafts.bind(currentScope, slot).initial))
          throw new Error('일정 화면에서 작성 중인 내용을 먼저 확인해 주세요.')
      }
      const epoch = generation.current
      return { member, date: context.basisDate, isCurrent: () => epoch === generation.current }
    }),
    navigate(next, onResult) {
      if (!member || connectionUnavailable || navigationLocked || !connectedPages.includes(next) || teacherPilot && next === 'schoolAdmin') return false
      if (isDeliveryKind(next)) return startDelivery(next, undefined, false, undefined, {onResult})
      if (!navigate(next)) return false
      setWorkReturn(next === 'assistant' ? undefined : {scope:currentScope,page:next,fromPage:'assistant'})
      setAssistantOpen(false)
      return true
    },
    search: (query, kinds, signal) => searchAssistantWorkspace(searchSources, query, kinds, signal),
    async findDraftPeople(kind, query, signal) {
      const page = kind === 'messageDraft' ? 'messages' : 'collections'
      if (!member || !context || connectionUnavailable || !activeAt(member, context.basisDate) || !connectedPages.includes(page))
        throw new Error('학교 연결을 확인해 주세요.')
      const { findDraftPeople } = await import('./draft-people')
      return findDraftPeople(kind, query, signal, connection, collectionServer, member, context)
    },
    prepareDraft(command, followup, onResult, composeId) {
      if (!member || !context || !activeAt(member, context.basisDate) || connectionUnavailable ||
          navigationLocked || pendingRequests.count() || handoff) return false
      if (followup && (followup.scope !== currentScope || followup.basisDate !== context.basisDate ||
          followup.command !== command)) return false
      const isMessage = command.kind === 'messageDraft'
      const destination = isMessage ? 'messages' : 'collections'
      const slot = isMessage ? 'messaging-composer' : 'collection-editor'
      if (!connectedPages.includes(destination) || editDrafts.bind(currentScope, slot).dirty ||
          (isMessage ? messageDraft : collectionDraft || generatedFile)) return false
      const identity = { id: composeId ?? crypto.randomUUID(), schoolId: member.schoolId, memberId: member.id, basisDate: context.basisDate }
      const recipients = followup?.selected.flatMap(person => person.recipient && person.recipient.memberId === person.memberId &&
        person.recipient.schoolId === member.schoolId ? [person.recipient] : [])
      if (isMessage && followup && recipients?.length !== followup.selected.length) return false
      if (!startDelivery(destination, undefined, false, undefined, {onResult})) return false
      if (command.kind === 'messageDraft') {
        setMessageDraft({ scope: currentScope, draft: { ...identity, body: command.body, recipients } })
      } else {
        setCollectionDraft({ scope: currentScope, draft: { ...identity, title: command.title, instructions: command.instructions,
          dueDate: followup?.dueDate, targetMemberIds: followup?.selected.map(person => person.memberId) } })
      }
      return true
    },
    open(item, onResult) {
      if (item.kind === 'knowledge') {
        if (!member || item.version === undefined || item.locator === undefined) return false
        const request = {key:crypto.randomUUID(),schoolId:member.schoolId,memberId:member.id,sourceId:item.id,sourceVersion:item.version,title:item.title,locator:item.locator}
        if (!validKnowledgeOpenRequest(request,member) || !startDelivery('knowledge', undefined, false, undefined, {onResult})) return false
        setKnowledgeOpen({scope:currentScope,request,fromPage:'assistant'}); return true
      }
      const kind = deliveryKind(item.kind)
      if (kind) return startDelivery(kind, {key:crypto.randomUUID(),id:item.id,version:item.version}, false, undefined, {onResult})
      if (!openSearchItem(item)) return false
      setAssistantOpen(false)
      return true
    },
    changeTask(command,item) {
      if (!member || !context || !activeAt(member,context.basisDate) || connectionUnavailable || navigationLocked
        || pendingRequests.count() || assistantTask || item.kind !== 'task' || !item.id || !Number.isSafeInteger(item.version)
        || (item.version ?? 0) < 1 || editDrafts.bind(currentScope,'task-editor').initial) return false
      if (!navigate('tasks')) return false
      setAssistantTask({scope:currentScope,request:{key:crypto.randomUUID(),schoolId:member.schoolId,memberId:member.id,
        basisDate:context.basisDate,taskId:item.id,title:item.title,expectedVersion:item.version!,change:command.change}})
      setWorkReturn({scope:currentScope,page:'tasks',fromPage:'assistant'})
      setAssistantOpen(false)
      return true
    },
    calendar(command) {
      if (!member || !context || connectionUnavailable || navigationLocked || pendingRequests.count() || batchOpen || assistantCalendar) return false
      const prior = editDrafts.bind<{editor?:unknown;importing?:boolean}>(currentScope,'calendar-panel').initial
      if (prior?.editor || prior?.importing || editDrafts.bind(currentScope,'calendar-editor').initial
        || editDrafts.bind(currentScope,'calendar-import').initial || editDrafts.bind(currentScope,'calendar-batch').initial) return false
      try {
        const draft = buildAssistantCalendarDraft(command,member,context.basisDate)
        if (!navigate('calendar')) return false
        setAssistantCalendar({scope:currentScope,request:{id:crypto.randomUUID(),schoolId:member.schoolId,memberId:member.id,draft},prompt:command.prompt})
        setWorkReturn({scope:currentScope,page:'calendar',fromPage:'assistant'})
        setAssistantOpen(false)
        return true
      } catch { return false }
    },
  }
  function sendToAssistant(request: AssistantContextRequest, origin?: GuidedAiOrigin) {
    if (!member) return
    if (activeDelivery) setDeliveryTalking(true)
    setHandoffError('');setSetupOrigin(undefined);setSetupSuggestion(undefined);setGuidedOrigin(origin);setGuidedSuggestion(undefined);setAssistantContext({scope:currentScope,id:origin?.id ?? crypto.randomUUID(),request});openAssistant()
  }

  function forwardMessageAnswer(value: { requestId: string; body: string }) {
    if (!member) return
    if (deliverySwitchBlocked('messages') || deliveryTransfer) {
      setHandoffError('작성하던 업무를 먼저 마친 뒤 이 답변을 다시 선택해 주세요. 답변과 기존 입력은 유지했습니다.')
      return
    }
    if (messageDraft?.draft.basisDate) {
      setHandoffError('메시지 화면에서 먼저 전달받은 초안을 사용하거나 닫아 주세요.')
      return
    }
    setHandoffError('')
    setMessageDraft({ scope: currentScope, draft: { id: value.requestId, schoolId: member.schoolId, memberId: member.id, body: value.body } })
    setHandoff({ scope: currentScope, fromPage: page, viaAssistant: true, page: 'messages' })
  }
  function openAssistant() { setAssistantVisited(true); setAssistantOpen(true) }

  // AI 안과 일반 메뉴는 같은 편집기·서버를 사용하며 현재 페이지에서 한 번만 렌더한다.
  function openMessageSource(source: NotificationSource, inDelivery: boolean) {
    let moved = false
    if (source.module === 'transitions') {
      moved = inDelivery ? startDelivery('schoolAdmin', undefined, false, 'schoolTransition') : navigate('schoolAdmin')
      if (moved) setTransitionOpen({scope:currentScope,id:source.id,key:crypto.randomUUID()})
    } else if (source.module === 'timetable') {
      moved = inDelivery ? startDelivery('timetable') : navigate('timetable')
      if (moved) setTimetableOpen({scope:currentScope,notificationId:source.id,key:crypto.randomUUID(),fromPage:'messages'})
    } else if (['calendar','tasks','collections','cooperation'].includes(source.module)) {
      if (inDelivery) moved = startDelivery(source.module as DeliveryKind, {key:crypto.randomUUID(),id:source.id})
      else moved = source.module === 'cooperation' ? resource.openCooperation(source.id)
        : source.module === 'collections' ? resource.openCollection(source.id)
        : resource.openSearchItem({kind:source.module === 'tasks' ? 'task' : 'calendar',id:source.id,title:'',description:'',meta:''})
    }
    if (!moved) throw new Error('작성 중인 내용을 확인한 뒤 원본을 열어 주세요.')
  }
  function renderMessages(inDelivery: boolean) {
    if (!member || !context) return null
    return <MessagingWorkspace onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} presentation={inDelivery ? 'assistant' : 'page'} initialTab={inDelivery && activeDelivery?.inbox ? 'inbox' : 'messages'} showThreadList={inDelivery && activeDelivery?.list}
      onUpdated={() => setRefreshEpoch(value => value + 1)}
      openRequest={inDelivery ? activeDelivery?.request : requested?.kind === 'message' && requested.id ? {key:requested.key,id:requested.id} : undefined}
      onReturnToSource={!inDelivery && requested?.kind === 'message' ? () => resource.navigate('home') : undefined}
      composeRequest={messageDraft?.scope === currentScope ? messageDraft.draft : undefined}
      onComposeRequestConsumed={id => setMessageDraft(current => current?.draft.id === id ? undefined : current)}
      canOpenSource={source => ['calendar','tasks','collections','cooperation','timetable','transitions'].includes(source.module)}
      onOpenSource={source => openMessageSource(source,inDelivery)}
      key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch}
      onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked} />
  }
  function renderDocuments(inDelivery: boolean) {
    if (!member || !context) return null
    return <DocumentsWorkspace onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} presentation={inDelivery ? 'assistant' : 'page'} onOpenFileCollections={()=>inDelivery ? queueDeliveryCollection() : setHandoff({scope:currentScope,fromPage:page,page:'collections'})} guidedSetupAiSuggestion={setupSuggestion?.origin.scope===currentScope?setupSuggestion:undefined} onRequestGuidedSetupAi={value=>{
               const origin=guidedSetupOrigin(value.origin,member)
               if(value.request.intent!=='guided_collection')throw new Error('질문형 준비 요청 불일치')
               const request=documentAssistantRequest(value.request)
               if(inDelivery)setDeliveryTalking(true);setGuidedOrigin(undefined);setGuidedSuggestion(undefined);setSetupOrigin(origin);setSetupSuggestion(undefined);setHandoffError('');setAssistantContext({scope:currentScope,id:origin.id,request});openAssistant()
             }} openRequest={inDelivery ? activeDelivery?.request : requested?.kind === 'document' && requested.id ? {key:requested.key,id:requested.id,version:requested.version} : undefined} legacyPlanHref={legacyPlanHref} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked} aiDraft={documentDraft?.scope === currentScope ? documentDraft.draft : undefined} guidedAiSuggestion={guidedSuggestion?.origin.scope === currentScope ? guidedSuggestion : undefined} onRequestGuidedAi={value => {try {
               const origin = guidedAiOrigin(value.origin,member)
               if (value.request.intent !== 'guided_collection') throw new Error('질문형 작성 요청 불일치')
               sendToAssistant(documentAssistantRequest(value.request),origin)
             } catch {throw new Error('AI로 전달할 양식과 답변을 확인하지 못했습니다. 작성 중인 내용은 유지됩니다.')}}} onRequestAi={input => {try{sendToAssistant(documentAssistantRequest(input))}catch{setHandoffError('AI로 전달할 제목·입력 길이와 근거를 확인해 주세요. 문서 입력은 보관되어 있습니다.')}}} onOpenCollection={requestId => inDelivery ? queueDeliveryCollection(requestId) : setHandoff({scope:currentScope,fromPage:page,page:'collections',requestId})} onUseGenerated={value => {if(inDelivery){queueDeliveryCollection(value.requestId,value);return}setGeneratedFile({scope:currentScope,value});setHandoff({scope:currentScope,fromPage:page,page:'collections',requestId:value.requestId})}} />
  }
  function renderCollections(inDelivery: boolean) {
    if (!member || !context) return null
    return <CollectionServerPanel onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} presentation={inDelivery ? 'assistant' : 'page'} key={resetKey} composeRequest={collectionDraft?.scope === currentScope ? collectionDraft.draft : undefined} onComposeRequestConsumed={id => setCollectionDraft(current => current?.draft.id === id ? undefined : current)} server={collectionServer} operations={collectionOperations} incomingFile={generatedFile?.scope === currentScope ? generatedFile.value : undefined} onIncomingFileConsumed={() => setGeneratedFile(undefined)} member={member} members={context.memberships} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={inDelivery ? setDeliveryLocked : setCollectionNavigationLocked} openRequest={inDelivery ? activeDelivery?.request : requested?.kind === 'collection' && requested.id ? { key: requested.key, id: requested.id } : undefined} />
  }
  function renderSchoolAdmin(inDelivery: boolean) {
    if (!member || !context) return null
    if (teacherPilot) return <SchoolTransitions key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : resetKey} connection={connection} member={member} revision={refreshEpoch}
      presentation={inDelivery ? 'assistant' : 'page'} onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined}
      openRequest={transitionOpen?.scope === currentScope ? transitionOpen : undefined}
      onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked} />
    const task = inDelivery ? activeDelivery?.task : undefined
    const initialSection = task === 'schoolRoster' ? 'teachers' : task === 'schoolMembership' ? 'roster' : task === 'schoolTransition' ? 'transitions' : task === 'schoolSettings' ? 'settings' : undefined
    return <SchoolAdminPanel onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} presentation={inDelivery ? 'assistant' : 'page'} initialSection={initialSection}
      transitionOpen={transitionOpen?.scope === currentScope ? transitionOpen : undefined}
      initialGuideOpen={!inDelivery && timetableOpen?.scope === currentScope && timetableOpen.fromPage === 'schoolAdmin'}
      onOpenPreparation={destination => {
        if (inDelivery) {
          if (destination === 'teaching') startDelivery('students')
          else if (['target','setup','preparation','import'].includes(destination)) {
            if (startDelivery('timetable', undefined, false, 'timetablePrepare'))
              setTimetableOpen({scope:currentScope,key:crypto.randomUUID(),fromPage:'schoolAdmin',preparationStep:destination as 'target'|'setup'|'preparation'|'import'})
          }
        } else if (destination === 'teaching') navigate('students')
        else if (['target','setup','preparation','import'].includes(destination) && navigate('timetable'))
          setTimetableOpen({scope:currentScope,key:crypto.randomUUID(),fromPage:'schoolAdmin',preparationStep:destination as 'target'|'setup'|'preparation'|'import'})
      }} onUpdated={() => setAttempt(value => value + 1)}
      key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : resetKey} connection={connection} member={member} date={context.basisDate}
      revision={refreshEpoch} onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked} />
  }
  function renderTimetable(inDelivery: boolean) {
    if (!member || !context) return null
    const task = inDelivery ? activeDelivery?.task : undefined
    const opened = timetableOpen?.scope === currentScope ? timetableOpen : undefined
    return <TimetableWorkspace onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} presentation={inDelivery ? 'assistant' : 'page'}
      initialOperationTab={task === 'timetableExchange' || task === 'timetableSubstitute' ? 'exchange' : task === 'timetablePublish' ? 'publish' : task === 'timetableView' ? 'shared' : undefined}
      initialOperationMode={task === 'timetableSubstitute' ? 'interventions' : task === 'timetableExchange' ? 'exchange' : undefined}
      initialPreparationStep={opened?.preparationStep ?? (task === 'timetablePrepare' ? 'target' : undefined)}
      initialIntent={opened?.intent} initialNotificationId={opened?.notificationId} initialRequestId={opened?.requestId}
      initialLessonId={opened?.lessonId} initialDate={opened?.date}
      key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : `${resetKey}:${opened?.key ?? ''}`}
      connection={connection} member={member} date={context.basisDate} revision={refreshEpoch}
      onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked}
      onOpenSchoolAdmin={teacherPilot ? undefined : () => inDelivery ? startDelivery('schoolAdmin') : navigate('schoolAdmin')}
      onOpenTeaching={() => inDelivery ? startDelivery('students') : navigate('students')} />
  }
  function renderTeaching(inDelivery: boolean) {
    if (!member || !context) return null
    const task = inDelivery ? activeDelivery?.task : undefined
    const initialTab: 'activity' | 'assessment' | 'records' | undefined = task === 'teachingActivity' ? 'activity' : task === 'teachingAssessment' ? 'assessment' : task === 'teachingRecords' ? 'records' : undefined
    const request = inDelivery && activeDelivery?.request
      ? {courseId:activeDelivery.request.id,token:activeDelivery.request.key,source:'assistant' as const,tab:initialTab}
      : teachingOpen?.scope === currentScope ? teachingOpen : undefined
    return <TeachingWorkspace onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} presentation={inDelivery ? 'assistant' : 'page'} initialTab={initialTab} initialRequest={request}
      initialAction={task === 'teachingActivity' ? 'activityImport' : undefined}
      onRequestStudentDraft={source => { try { sendToAssistant(studentAssistantRequest(source,member)) } catch { setHandoffError('현재 학교와 학생 근거를 다시 확인해 주세요.') } }}
      key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : resetKey} connection={connection} member={member} date={context.basisDate}
      revision={refreshEpoch} onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked} />
  }
  function renderCooperation(inDelivery: boolean) {
    if (!member || !context) return null
    return <CooperationWorkspace onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} openRequest={inDelivery ? activeDelivery?.request : requested?.kind === 'cooperation' && requested.id ? { key: requested.key, id: requested.id } : undefined}
      key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch}
      onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked}
      onOpenTask={id => inDelivery ? startDelivery('tasks',{key:crypto.randomUUID(),id}) : resource.openSearchItem({kind:'task',id,title:'',description:'',meta:''})} />
  }
  function renderKnowledge(inDelivery: boolean) {
    if (!member || !context) return null
    return <KnowledgeWorkspace onWorkflowResult={inDelivery ? activeDelivery?.onResult : undefined} returnLabel={inDelivery ? '대화로 돌아가기' : knowledgeOpen?.fromPage ? '이전 화면으로 돌아가기' : undefined}
      openRequest={knowledgeOpen?.scope === currentScope ? knowledgeOpen.request : undefined}
      onReturnToSource={inDelivery ? () => setDeliveryTalking(true) : knowledgeOpen?.scope === currentScope && knowledgeOpen.fromPage !== 'knowledge' ? () => {navigate(knowledgeOpen.fromPage ?? 'assistant')} : undefined}
      onAskAssistant={request => sendToAssistant(knowledgeAssistantContext(request,member))}
      key={inDelivery ? `${resetKey}:${activeDelivery?.key}` : resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch}
      onNavigationLockChange={inDelivery ? setDeliveryLocked : setExtensionNavigationLocked} />
  }
  function renderAssistantCalendar() {
    if (!member || !context || !school) return null
    return <AssistantCalendarWorkspace onWorkflowResult={activeDelivery?.onResult} key={`${resetKey}:${activeDelivery?.key}`} connection={connection} adapter={adapter}
      member={member} members={context.memberships} schoolName={school.name} date={context.basisDate} revision={refreshEpoch}
      relationOptions={context.schoolLabels[school.id] ?? context.relationLabels} openRequest={activeDelivery?.request}
      onNavigationLockChange={setDeliveryLocked} onPageChange={next => { if (next === 'home') navigate('home') }}
      renderLessonAgenda={lessonDate => <ModuleBoundary moduleName="내 수업" resetKey={`${resetKey}:${lessonDate}`}><Suspense fallback={<p role="status">내 수업을 확인하는 중…</p>}>
        <TimetableAgendaWorkspace connection={connection} member={member} date={lessonDate} revision={refreshEpoch}
          onOpen={(lessonId, date) => {if(startDelivery('timetable',undefined,false,'timetableView'))setTimetableOpen({scope:currentScope,lessonId,date,key:crypto.randomUUID(),fromPage:'calendar'})}} />
        <PersonalRosterAgenda connection={connection} member={member} date={lessonDate} revision={refreshEpoch} />
      </Suspense></ModuleBoundary>} />
  }
  function renderAssistantTasks() {
    if (!member || !context) return null
    return <TaskPanel key={`${resetKey}:${activeDelivery?.key}`} adapter={taskAdapter} member={member} date={context.basisDate}
      revision={refreshEpoch} onNavigationLockChange={setDeliveryLocked}
      openRequest={activeDelivery?.request ? {key:activeDelivery.request.key,taskId:activeDelivery.request.id} : undefined} />
  }
  function renderAssistantDaily() {
    if (!member || !context) return null
    const daily = activeDelivery?.daily
    return <AssistantDailyWorkspace key={`${resetKey}:${activeDelivery?.key}`} connection={connection} member={member}
      members={context.memberships} date={context.basisDate} revision={refreshEpoch} calendarAdapter={adapter} taskAdapter={taskAdapter}
      view={daily?.view === 'meals' ? 'meals' : 'overview'} mealDate={daily?.view === 'meals' ? daily.date : undefined}
      locked={navigationLocked || pendingCount > 0}
      onOpen={item => {
        if (item.kind === 'student_followup') {
          if (startDelivery('students')) setTeachingOpen({scope:currentScope,courseId:item.sourceId,token:crypto.randomUUID(),source:'home'})
        } else startDelivery(item.kind === 'message' ? 'messages' : item.kind === 'cooperation' ? 'cooperation' : 'collections',{key:crypto.randomUUID(),id:item.sourceId})
      }}
      onOpenList={kind => {const target=homeCountLabels[kind].page;if(isDeliveryKind(target))startDelivery(target, undefined, false, undefined, target === 'messages' ? {list:true} : undefined)}}
      onOpenLesson={(lessonId,date) => {if(startDelivery('timetable',undefined,false,'timetableView'))setTimetableOpen({scope:currentScope,lessonId:lessonId||undefined,date,key:crypto.randomUUID(),fromPage:'home'})}}
      onOpenCalendar={item => startDelivery('calendar',{key:crypto.randomUUID(),id:item.id,version:item.version})}
      onOpenTask={item => startDelivery('tasks',{key:crypto.randomUUID(),id:item.id,version:item.version})}
      onOpenCalendarList={() => startDelivery('calendar')} onOpenTaskList={() => startDelivery('tasks')} />
  }
  const assistantPanel = member && !connectionUnavailable && (assistantVisited || page === 'assistant') ? <AssistantDock open={assistantOpen} fullPage={page === 'assistant'} contextLabel={displayModules.find(item => item.id === page)?.title ?? '업무실'} closeDisabled={page === 'assistant' && (navigationLocked || Boolean(activeDelivery && pendingCount))} onClose={() => { if (page !== 'assistant' || navigate(assistantReturn.current?.scope === currentScope ? assistantReturn.current.page : teacherPilot ? 'tasks' : 'home')) setAssistantOpen(false) }}><ModuleBoundary moduleName="AI 비서" resetKey={resetKey}><Suspense fallback={<p role="status">AI 비서를 준비하고 있습니다…</p>}><AssistantDeliveryFrame error={handoffError} workspace={activeDelivery} finishDisabled={Boolean(activeDelivery && (hasDeliveryDraft(activeDelivery.kind, editDrafts.dirtySlots(currentScope)) || (activeDelivery.kind === 'messages' ? messageDraft : activeDelivery.kind === 'collections' ? collectionDraft || generatedFile : false)))} talking={deliveryTalking} locked={deliveryLocked || assistantNavigationLocked || pendingCount > 0 || Boolean(deliveryTransfer)} onTalk={() => setDeliveryTalking(true)} onResume={() => setDeliveryTalking(false)} onClose={() => {if(!deliveryLocked && !pendingCount){setDelivery(undefined);setDeliveryTalking(false)}}} chat={<AssistantPanel memoryEnabled={!teacherPilot} workActive={Boolean(activeDelivery && !deliveryTalking)} workspaceActions={assistantActions} onOpenTask={id => setHandoff({scope:currentScope,fromPage:page,viaAssistant:true,page:'tasks',taskId:id})} onOpenKnowledgeCitation={teacherPilot ? undefined : value => {
               const request = {...value,key:crypto.randomUUID()}
               if (!validKnowledgeOpenRequest(request,member)) throw new Error('현재 학교의 인용인지 확인하지 못했습니다.')
               if (!startDelivery('knowledge')) throw new Error('작성 중인 업무를 먼저 확인해 주세요.')
               setKnowledgeOpen({scope:currentScope,request,fromPage:'assistant'})
             }} key={resetKey} connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} contextRequest={assistantContext?.scope === currentScope ? assistantContext : undefined} onComposeMessage={forwardMessageAnswer} onNavigationLockChange={setAssistantNavigationLocked} onUpdated={() => setRefreshEpoch(value => value + 1)} onDraftReady={teacherPilot ? undefined : (value, contextId) => {try {
               if (deliverySwitchBlocked('documents') || deliveryTransfer) {setHandoffError('작성하던 업무를 먼저 마친 뒤 이 답변을 다시 선택해 주세요. 답변과 기존 입력은 유지했습니다.');return}
               const draft = assistantDocumentDraft(value,member)
               if (value.intent === 'guided_collection') {
                 if(setupOrigin?.scope===currentScope&&setupOrigin.id===contextId){setSetupSuggestion(guidedSetupSuggestion({origin:setupOrigin,requestId:value.requestKey,body:draft.body},member));setGuidedSuggestion(undefined)}
                 else{if (!guidedOrigin || guidedOrigin.scope !== currentScope || guidedOrigin.id !== contextId) throw new Error('질문형 원본 연결 없음')
                 setGuidedSuggestion(guidedAiSuggestion({origin:guidedOrigin,requestId:value.requestKey,body:draft.body},member));setSetupSuggestion(undefined)}setDocumentDraft(undefined)
               } else {setDocumentDraft({scope:currentScope,draft});setGuidedSuggestion(undefined);setSetupSuggestion(undefined)}
               if(activeDelivery?.kind === 'documents')setDeliveryTalking(false);else setHandoff({scope:currentScope,fromPage:page,viaAssistant:true,page:'documents'})
             } catch {setHandoffError('초안의 원래 양식·근거와 학생 범위를 확인하지 못했습니다. 원래 답변은 유지됩니다.')}}} />}>{activeDelivery?.kind === 'messages' ? renderMessages(true) : activeDelivery?.kind === 'collections' ? renderCollections(true) : activeDelivery?.kind === 'documents' ? renderDocuments(true) : activeDelivery?.kind === 'timetable' ? renderTimetable(true) : activeDelivery?.kind === 'students' ? renderTeaching(true) : activeDelivery?.kind === 'schoolAdmin' ? renderSchoolAdmin(true) : activeDelivery?.kind === 'cooperation' ? renderCooperation(true) : activeDelivery?.kind === 'knowledge' ? renderKnowledge(true) : activeDelivery?.kind === 'calendar' ? renderAssistantCalendar() : activeDelivery?.kind === 'evaluation' ? <EvaluationWorkspace links={legacyEvaluationLinks} target={activeDelivery.evaluation ?? 'authoring'} locked={navigationLocked || pendingCount > 0} /> : activeDelivery?.kind === 'tasks' ? renderAssistantTasks() : activeDelivery?.kind === 'daily' ? renderAssistantDaily() : null}</AssistantDeliveryFrame></Suspense></ModuleBoundary></AssistantDock> : undefined

  function discardUnsentInput() {
    if (pendingRequests.count() > 0) return false
    editDrafts.clear(); clearHandoffs()
    setTaskNavigationLocked(false); setCalendarNavigationLocked(false); setCollectionNavigationLocked(false); setExtensionNavigationLocked(false); setAssistantNavigationLocked(false)
    navigation.clearAnnouncement()
    return true
  }
  return <EditDraftsProvider store={editDrafts}><PendingRequestsProvider store={pendingRequests}><StyleBoundary>
    <style>{timetableNavigationStyles}</style>
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
        <p>현재 날짜에 이용 가능한 학교 소속을 확인하지 못했습니다. 기존 계정과 저장 자료는 보존되어 있습니다. 관리자에게 학교 소속의 연결·승인 상태와 유효기간을 확인해 주세요.</p>
      </>}
      {!loading && <button className="secondary" onClick={() => setAttempt(value => value + 1)}>학교 연결 다시 확인</button>}
      <ConnectionRecoveryActions hasDraft={draftCount > 0} hasPending={pendingCount > 0}
        announcement={navigation.announcement} onDiscard={discardUnsentInput} legacyHomeHref={legacyHomeHref} />
    </main> :
      <WorkspaceShell navigationModules={teacherPilot ? displayModules : undefined} onOpenAssistant={openAssistant} assistantOpen={assistantOpen || page === 'assistant'} sidePanel={assistantPanel} mode="connected" page={page} onNavigate={navigate} schoolName={school.name} memberName={member.name}
        serviceTools={!teacherPilot && <details className="connected-diagnostics"><summary>운영 연결 진단</summary><ConnectionReadinessPanel key={`${expectedUserId}:${diagnosticEpoch}`} expectedUserId={expectedUserId} runCheck={checkReadiness} /></details>}
        storageLabel={page === 'timetable' ? '학교 서버에서 확인' : page === 'collections' ? '학교 계정으로 연결' : '현재 학교 서버에 저장'} locked={navigationLocked} notice={navigation.announcement}
        quickActions={<><WorkspaceSearch key={`${expectedUserId}:${resetKey}:${page}`} scopeKey={`${expectedUserId}:${resetKey}`} sources={searchSources} locked={navigationLocked} onOpen={openSearchItem} />{!teacherPilot && <WorkspaceHelp key={resetKey} connection={connection} memberId={member.id} scopeKey={`${expectedUserId}:${resetKey}:${currentScope}`} locked={navigationLocked} onNavigate={navigate}/>}</>}
        contextControls={!teacherPilot && <label>사용할 학교<select disabled={navigationLocked || exitLocked} value={memberId} onChange={event => { const value = event.target.value; navigation.requestAction(() => { resource.clear(); clearHandoffs(); const nextMember = context.memberships.find(item => item.id === value); if (nextMember) { scopeFingerprint.current = recoveryScope(nextMember); editDrafts.activate(scopeFingerprint.current) } else editDrafts.clear(); lastVerifiedMemberId.current = value; setMemberId(value) }) }}>{context.memberships.filter(item => item.userId === expectedUserId && activeAt(item, context.basisDate)).map(item => <option key={item.id} value={item.id}>{context.schools.find(value => value.id === item.schoolId)?.name ?? '학교'} · {item.name}</option>)}</select></label>}>
        <ModuleBoundary moduleName={displayModules.find(item => item.id === page)?.title ?? '업무실'} resetKey={`${resetKey}:${page}`}>
          {assistantNavigationLocked && !assistantOpen && page !== 'assistant' && <p className="ws-ai-preserved" role="status">AI 입력 또는 확인할 요청이 보관되어 있습니다. <button type="button" onClick={openAssistant}>작성 중인 AI 대화 열기</button></p>}
          {handoffError && !assistantOpen && page !== 'assistant' && <p role="alert">{handoffError}</p>}
          {workReturn?.scope === currentScope && workReturn.page === page && <nav aria-label="작업 연결" className="timetable-source-navigation">
            <button type="button" className="text-button" disabled={navigationLocked} onClick={() => workReturn.fromPage === 'assistant' ? openAssistant() : navigate(workReturn.fromPage)}>{workReturn.fromPage === 'assistant' ? 'AI 비서로 돌아가기' : workReturn.fromPage === 'knowledge' ? '학교 자료로 돌아가기' : `${displayModules.find(item => item.id === workReturn.fromPage)?.title ?? '이전 작업'}으로 돌아가기`}</button>
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
          {['schoolAdmin', 'students', 'messages', 'knowledge', 'documents', 'assistant', 'cooperation', 'timetable'].includes(page) ? <main id="main-content" className="main-content">{page !== 'timetable' && <header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>{displayModules.find(item => item.id === page)?.title}</h1></div></header>}<Suspense fallback={<p role="status">업무 화면을 준비하는 중…</p>}>
            {page === 'schoolAdmin' ? renderSchoolAdmin(false) :
             page === 'timetable' ? renderTimetable(false) :
             page === 'students' ? renderTeaching(false) :
             page === 'messages' ? renderMessages(false) :
             page === 'assistant' ? null :
             page === 'documents' ? renderDocuments(false) :
             page === 'cooperation' ? renderCooperation(false) : renderKnowledge(false)}

          </Suspense></main> : page === 'collections' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>자료 수합</h1><p>양식을 배부하고 제출된 파일을 확인하세요.</p></div></header><Suspense fallback={<p role="status">자료 수합 화면을 준비하고 있습니다…</p>}>{renderCollections(false)}</Suspense></main> : page === 'tasks' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>내 업무</h1><p>현재 학교에서 내가 할 일을 정리하고 진행 상황을 확인하세요.</p></div></header><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setTaskNavigationLocked} openRequest={assistantTask?.scope === currentScope ? {key:assistantTask.request.key, taskId:assistantTask.request.taskId, change:assistantTask.request} : requested?.kind === 'task' ? { key: requested.key, taskId: requested.id, dueFilter: requested.dueFilter } : undefined} onAssistantTaskHandled={key => setAssistantTask(current => current?.request.key === key ? undefined : current)} /></main> :
            page === 'calendar' && batchOpen ? <main id="main-content" className="main-content"><header className="page-header"><h1 tabIndex={-1}>시트에서 일정 가져오기</h1></header><Suspense fallback={<p role="status">일괄 가져오기를 준비하고 있습니다…</p>}><CalendarBatchImport connection={connection} member={member} members={context.memberships} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setBatchNavigationLocked} onClose={() => setBatchOpen(false)} onSaved={() => setRefreshEpoch(value => value + 1)} /></Suspense></main> :
            <CalendarPanel key={resetKey} member={member} members={context.memberships} schoolName={school.name} date={context.basisDate} adapter={adapter} revision={refreshEpoch}
              page={page === 'calendar' ? 'calendar' : 'home'} onPageChange={navigate} onNavigationLockChange={setCalendarNavigationLocked} onOpenBatchImport={() => setBatchOpen(true)}
              assistantDraftRequest={assistantCalendar?.scope === currentScope ? assistantCalendar.request : undefined}
              onAssistantDraftHandled={(id,accepted) => {
                if (!assistantCalendar || assistantCalendar.scope !== currentScope || assistantCalendar.request.id !== id) return
                if (!accepted) setHandoffError(`일정 초안을 열지 못했습니다. 기존 입력은 유지했습니다. 원래 요청: ${assistantCalendar.prompt}`)
                setAssistantCalendar(undefined)
              }}
              relationOptions={context.schoolLabels[school.id] ?? context.relationLabels} storageLabel="현재 학교 서버에 저장"
              openRequest={requested?.kind === 'calendar' && requested.id ? { key: requested.key, id: requested.id } : undefined}
              renderLessonAgenda={lessonDate => <ModuleBoundary moduleName="내 수업" resetKey={`${resetKey}:${lessonDate}`}><Suspense fallback={<p role="status">내 수업을 확인하는 중…</p>}><TimetableAgendaWorkspace connection={connection} member={member} date={lessonDate} revision={refreshEpoch} onOpen={(lessonId, date) => {if(resource.navigate('timetable'))setTimetableOpen({scope:currentScope,lessonId,date,key:crypto.randomUUID(),fromPage:page === 'calendar' ? 'calendar' : 'home'})}} /><PersonalRosterAgenda connection={connection} member={member} date={lessonDate} revision={refreshEpoch} /></Suspense></ModuleBoundary>}
              homePriority={<><ModuleBoundary moduleName="확인할 일" resetKey={resetKey}><HomeOverviewPanel connection={connection} member={member} revision={refreshEpoch} locked={navigationLocked} onOpenList={kind => { const target = homeCountLabels[kind].page; if (navigate(target)) setHomeListOpen({ scope: currentScope, kind, page: target }) }} onOpen={item => { if (item.kind === 'collection' || item.kind === 'supplement') resource.openCollection(item.sourceId); else if (item.kind === 'cooperation') resource.openCooperation(item.sourceId); else if (item.kind === 'message') resource.openMessage(item.sourceId); else if(navigate('students'))setTeachingOpen({scope:currentScope,courseId:item.sourceId,token:crypto.randomUUID(),source:'home'}) }} /></ModuleBoundary><ModuleBoundary moduleName="시간표 확인할 일" resetKey={resetKey}><Suspense fallback={null}><TimetableActionSummary connection={connection} member={member} date={context.basisDate} revision={refreshEpoch} onOpen={item => { if (navigate('timetable')) { const key = crypto.randomUUID(); setTimetableOpen({ scope: currentScope, notificationId: item.requestId ?? undefined, lessonId: item.lessonId ?? undefined, date: item.date, key, fromPage: 'home', ...(item.kind === 'makeup' && item.lessonId ? { intent: { kind: 'makeup', lessonId: item.lessonId, token: key } as const } : {}) }) } }} /></Suspense></ModuleBoundary></>}
              homeExtras={<><ModuleBoundary moduleName="내 업무" resetKey={resetKey}><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} compact onNavigationLockChange={setTaskNavigationLocked} onOpenTasks={resource.openTasks} /></ModuleBoundary><ModuleBoundary moduleName="학교 급식" resetKey={resetKey}><Suspense fallback={null}><NeisMeals connection={connection} member={member} date={context.basisDate}/></Suspense></ModuleBoundary></>} />}
        </ModuleBoundary>
      </WorkspaceShell>}
    {connectionUnavailable && !teacherPilot && <details className="connected-diagnostics"><summary>운영 연결 진단</summary><ConnectionReadinessPanel key={`${expectedUserId}:${diagnosticEpoch}`} expectedUserId={expectedUserId} runCheck={checkReadiness} /></details>}
  </StyleBoundary></PendingRequestsProvider></EditDraftsProvider>
}
