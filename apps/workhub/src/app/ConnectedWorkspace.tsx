import '../typography.css'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CalendarPanel } from '../calendar/CalendarPanel'
import { activeAt } from '../domain'
import { createSupabaseConnection, type SupabaseConnection } from '../connection/supabase-connection'
import { createSupabaseCalendarAdapter } from '../connection/supabase-calendar'
import type { ConnectionContext } from '../connection/contracts'
import theme from '../style.css?inline'
import { ConnectionReadinessPanel } from './ConnectionReadinessPanel'
import { createSupabaseTaskAdapter } from '../tasks/supabase-task-adapter'
import { TaskPanel } from '../tasks/TaskPanel'
import { WorkspaceShell } from './WorkspaceShell'
import { ModuleBoundary } from './ModuleBoundary'
import { useWorkspaceNavigation } from './navigation'
import { enabledModules, type PageId } from '../modules'
import { WorkspaceSearch } from '../search/WorkspaceSearch'
import { calendarSearchSource, taskSearchSource } from '../search/sources'
import { useResourceNavigation } from './resource-navigation'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from './pending-requests'
import { watchSchoolDay } from './school-day'
import { ConnectionRecoveryActions } from './ConnectionRecoveryActions'
import { createEditDrafts, EditDraftsProvider } from './edit-drafts'
import { createSupabaseCollectionServer } from '../collections/supabase-collections'

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

export function ConnectedWorkspace({ expectedUserId, legacyHomeHref, connection: providedConnection }: { expectedUserId: string; legacyHomeHref: string; connection?: SupabaseConnection }) {
  const [connection] = useState(() => providedConnection ?? createSupabaseConnection())
  const [adapter] = useState(() => createSupabaseCalendarAdapter(connection))
  const [taskAdapter] = useState(() => createSupabaseTaskAdapter(connection))
  const [collectionServer] = useState(() => createSupabaseCollectionServer(connection))
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
            if (!identity?.approved || identity.userId !== expectedUserId || identity.profile?.role !== 'superadmin') { pendingRequests.clear(); editDrafts.clear(); throw new Error('현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다. 기존 앱의 로그인·승인 상태를 확인해 주세요.') }
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
            if (scopeFingerprint.current && fingerprint !== scopeFingerprint.current) setScopeEpoch(value => value + 1)
            scopeFingerprint.current = fingerprint
            setError('')
            setContext(next)
            setRefreshEpoch(value => value + 1)
            setMemberId(selected?.id ?? '')
          } catch (failure) {
            if (alive && version === generation.current) { editDrafts.suspend(); setContext(undefined); setError(failure instanceof Error ? failure.message : '학교 연결을 확인하지 못했습니다.') }
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
      if (reason.code !== 'QUERY_FAILED') { pendingRequests.clear(); editDrafts.clear(); lastVerifiedMemberId.current = '' }
      else editDrafts.suspend()
      setDiagnosticEpoch(value => value + 1)
      setTaskNavigationLocked(false); setCalendarNavigationLocked(false); setCollectionNavigationLocked(false)
      setContext(undefined); setMemberId(''); setLoading(false); setError(reason.message)
    })
    // 계정·권한 판정은 기존 서버 경로를 유지한다. 새 날짜는 재조회 신호로만 사용한다.
    const stopDayWatch = watchSchoolDay(window, () => refresh(true), () => basisDateRef.current)
    const onFocus = () => { refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; queued = undefined; generation.current += 1; stopDayWatch(); unsubscribe(); stopInvalidation(); window.removeEventListener('focus', onFocus) }
  }, [connection, expectedUserId, attempt, pendingRequests, editDrafts])
  const member = context?.memberships.find(item => item.id === memberId)
  const school = context?.schools.find(item => item.id === member?.schoolId)
  const connectionUnavailable = loading || !!error || !context || !member || !school
  const navigationLocked = taskNavigationLocked || calendarNavigationLocked || collectionNavigationLocked || (connectionUnavailable && (draftCount > 0 || pendingCount > 0))
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
  const navigate = (next: PageId) => { resource.navigate(next) }
  const searchSources = useMemo(() => member && context ? [calendarSearchSource(adapter, member, context.basisDate), taskSearchSource(taskAdapter, member, context.basisDate)] : [], [adapter, taskAdapter, member, context])
  const requested = resource.current
  function discardUnsentInput() {
    if (pendingRequests.count() > 0) return false
    editDrafts.clear()
    setTaskNavigationLocked(false); setCalendarNavigationLocked(false); setCollectionNavigationLocked(false)
    navigation.clearAnnouncement()
    return true
  }
  return <EditDraftsProvider store={editDrafts}><PendingRequestsProvider store={pendingRequests}><StyleBoundary>
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
        storageLabel={page === 'collections' ? '학교 계정으로 연결' : '현재 학교 서버에 저장'} locked={navigationLocked} notice={navigation.announcement}
        quickActions={<WorkspaceSearch key={`${expectedUserId}:${resetKey}:${page}`} scopeKey={`${expectedUserId}:${resetKey}`} sources={searchSources} locked={navigationLocked} onOpen={resource.openSearchItem} />}
        contextControls={<label>사용할 학교<select disabled={navigationLocked || exitLocked} value={memberId} onChange={event => { const value = event.target.value; navigation.requestAction(() => { resource.clear(); const nextMember = context.memberships.find(item => item.id === value); if (nextMember) { scopeFingerprint.current = recoveryScope(nextMember); editDrafts.activate(scopeFingerprint.current) } else editDrafts.clear(); lastVerifiedMemberId.current = value; setMemberId(value) }) }}>{context.memberships.filter(item => item.userId === expectedUserId && activeAt(item, context.basisDate)).map(item => <option key={item.id} value={item.id}>{context.schools.find(value => value.id === item.schoolId)?.name ?? '학교'} · {item.name}</option>)}</select></label>}>
        <ModuleBoundary moduleName={page === 'collections' ? '자료 수합' : page === 'tasks' ? '내 업무' : '학교 일정'} resetKey={`${resetKey}:${page}`}>
          {page === 'collections' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>자료 수합</h1><p>양식을 배부하고 제출된 파일을 확인하세요.</p></div></header><Suspense fallback={<p role="status">자료 수합 화면을 준비하고 있습니다…</p>}><CollectionServerPanel key={resetKey} server={collectionServer} member={member} members={context.memberships} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setCollectionNavigationLocked} /></Suspense></main> : page === 'tasks' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>내 업무</h1><p>현재 학교에서 내가 할 일을 정리하고 진행 상황을 확인하세요.</p></div></header><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setTaskNavigationLocked} openRequest={requested?.kind === 'task' ? { key: requested.key, taskId: requested.id, dueFilter: requested.dueFilter } : undefined} /></main> :
            <CalendarPanel key={resetKey} member={member} members={context.memberships} schoolName={school.name} date={context.basisDate} adapter={adapter} revision={refreshEpoch}
              page={page === 'calendar' ? 'calendar' : 'home'} onPageChange={navigate} onNavigationLockChange={setCalendarNavigationLocked}
              relationOptions={context.schoolLabels[school.id] ?? context.relationLabels} storageLabel="현재 학교 서버에 저장"
              openRequest={requested?.kind === 'calendar' && requested.id ? { key: requested.key, id: requested.id } : undefined}
              homeExtras={<ModuleBoundary moduleName="내 업무" resetKey={resetKey}><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} compact onNavigationLockChange={setTaskNavigationLocked} onOpenTasks={resource.openTasks} /></ModuleBoundary>} />}
        </ModuleBoundary>
      </WorkspaceShell>}
    <ConnectionReadinessPanel key={`${expectedUserId}:${diagnosticEpoch}`} expectedUserId={expectedUserId} runCheck={checkReadiness} />
  </StyleBoundary></PendingRequestsProvider></EditDraftsProvider>
}
