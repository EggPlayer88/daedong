import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

export function ConnectedWorkspace({ expectedUserId, connection: providedConnection }: { expectedUserId: string; connection?: SupabaseConnection }) {
  const [connection] = useState(() => providedConnection ?? createSupabaseConnection())
  const [adapter] = useState(() => createSupabaseCalendarAdapter(connection))
  const [taskAdapter] = useState(() => createSupabaseTaskAdapter(connection))
  const [context, setContext] = useState<ConnectionContext>()
  const [memberId, setMemberId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const [scopeEpoch, setScopeEpoch] = useState(0)
  const [diagnosticEpoch, setDiagnosticEpoch] = useState(0)
  const [taskNavigationLocked, setTaskNavigationLocked] = useState(false)
  const [calendarNavigationLocked, setCalendarNavigationLocked] = useState(false)
  const checkReadiness = useCallback(() => connection.checkReadiness(), [connection])
  const generation = useRef(0)
  const scopeFingerprint = useRef('')
  useEffect(() => {
    let alive = true
    async function refresh(quiet = false) {
      const version = ++generation.current
      if (!quiet) { setLoading(true); setContext(undefined) }
      setError('')
      try {
        const identity = await connection.getIdentity()
        if (!identity?.approved || identity.userId !== expectedUserId || identity.profile?.role !== 'superadmin') throw new Error('현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다. 기존 앱의 로그인·승인 상태를 확인해 주세요.')
        const next = await connection.loadContext()
        if (!alive || version !== generation.current) return
        const fingerprint = JSON.stringify(next.memberships)
        if (scopeFingerprint.current && fingerprint !== scopeFingerprint.current) setScopeEpoch(value => value + 1)
        scopeFingerprint.current = fingerprint
        setContext(next)
        setRefreshEpoch(value => value + 1)
        const mine = next.memberships.filter(member => member.userId === expectedUserId && activeAt(member, next.basisDate))
        setMemberId(previous => mine.some(member => member.id === previous) ? previous : mine[0]?.id ?? '')
      } catch (failure) {
        if (alive && version === generation.current) { setContext(undefined); setError(failure instanceof Error ? failure.message : '학교 연결을 확인하지 못했습니다.') }
      } finally { if (alive && version === generation.current) setLoading(false) }
    }
    void refresh()
    const unsubscribe = connection.subscribeIdentity(() => { void refresh(true) })
    const stopInvalidation = connection.subscribeInvalidation(reason => {
      if (!alive) return
      generation.current += 1
      setDiagnosticEpoch(value => value + 1)
      setTaskNavigationLocked(false); setCalendarNavigationLocked(false)
      setContext(undefined); setMemberId(''); setLoading(false); setError(reason.message)
    })
    // 다른 창의 로그아웃·승인 변경 후에는 이전 학교 화면을 다시 그대로 쓰지 않는다.
    const onFocus = () => { void refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; generation.current += 1; unsubscribe(); stopInvalidation(); window.removeEventListener('focus', onFocus) }
  }, [connection, expectedUserId, attempt])
  const member = context?.memberships.find(item => item.id === memberId)
  const school = context?.schools.find(item => item.id === member?.schoolId)
  const navigationLocked = taskNavigationLocked || calendarNavigationLocked
  const navigation = useWorkspaceNavigation({
    allowedPages: connectedPages,
    scopeKey: member ? `${expectedUserId}:${memberId}:${scopeEpoch}` : undefined,
    locked: navigationLocked,
  })
  const page = navigation.page as PageId
  const resetKey = `${memberId}:${attempt}:${scopeEpoch}`
  const resource = useResourceNavigation(`${expectedUserId}:${resetKey}`, page, navigation.requestNavigate)
  const navigate = (next: PageId) => { resource.navigate(next) }
  const searchSources = useMemo(() => member && context ? [calendarSearchSource(adapter, member, context.basisDate), taskSearchSource(taskAdapter, member, context.basisDate)] : [], [adapter, taskAdapter, member, context])
  const requested = resource.current
  return <StyleBoundary>
    <div className="connection-notice">신축 기능 시험 · 기존 Google 로그인과 회원 계정을 그대로 사용합니다. 현재 슈퍼관리자에게만 공개됩니다.</div>
    {loading ? <section className="connected-empty" role="status"><h1>학교 연결 확인 중</h1><p>현재 계정의 승인 상태와 학교 소속을 확인하고 있습니다.</p></section> : error ? <section className="connected-empty"><h1>학교 연결을 완료하지 못했습니다</h1><p className="connected-error" role="alert">{error}</p><p>운영 연결 전에는 가상 자료로 대체하지 않습니다. 기존 업무 메뉴는 계속 이용할 수 있습니다.</p><button className="secondary" onClick={() => setAttempt(value => value + 1)}>학교 연결 다시 확인</button></section> : !member || !school || !context ? <section className="connected-empty"><h1>연결된 학교 소속이 없습니다</h1><p>기존 계정은 보존되어 있습니다. 신축 DB 기반과 기존 회원의 학교 소속 연결이 적용된 뒤 이용할 수 있습니다.</p><button className="secondary" onClick={() => setAttempt(value => value + 1)}>학교 연결 다시 확인</button></section> :
      <WorkspaceShell mode="connected" page={page} onNavigate={navigate} schoolName={school.name} memberName={member.name}
        storageLabel="현재 학교 서버에 저장" locked={navigationLocked} notice={navigation.announcement}
        quickActions={<WorkspaceSearch key={`${expectedUserId}:${resetKey}:${page}`} scopeKey={`${expectedUserId}:${resetKey}`} sources={searchSources} locked={navigationLocked} onOpen={resource.openSearchItem} />}
        contextControls={<label>사용할 학교<select disabled={navigationLocked} value={memberId} onChange={event => { const value = event.target.value; navigation.requestAction(() => { resource.clear(); setMemberId(value) }) }}>{context.memberships.filter(item => item.userId === expectedUserId && activeAt(item, context.basisDate)).map(item => <option key={item.id} value={item.id}>{context.schools.find(value => value.id === item.schoolId)?.name ?? '학교'} · {item.name}</option>)}</select></label>}>
        <ModuleBoundary moduleName={page === 'tasks' ? '내 업무' : '학교 일정'} resetKey={`${resetKey}:${page}`}>
          {page === 'tasks' ? <main id="main-content" className="main-content"><header className="page-header"><div><p className="eyebrow">{school.name} · {context.basisDate}</p><h1 tabIndex={-1}>내 업무</h1><p>현재 학교에서 내가 할 일을 정리하고 진행 상황을 확인하세요.</p></div></header><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} onNavigationLockChange={setTaskNavigationLocked} openRequest={requested?.kind === 'task' ? { key: requested.key, taskId: requested.id, dueFilter: requested.dueFilter } : undefined} /></main> :
            <CalendarPanel key={resetKey} member={member} members={context.memberships} schoolName={school.name} date={context.basisDate} adapter={adapter} revision={refreshEpoch}
              page={page === 'calendar' ? 'calendar' : 'home'} onPageChange={navigate} onNavigationLockChange={setCalendarNavigationLocked}
              relationOptions={context.schoolLabels[school.id] ?? context.relationLabels} storageLabel="현재 학교 서버에 저장"
              openRequest={requested?.kind === 'calendar' && requested.id ? { key: requested.key, id: requested.id } : undefined}
              homeExtras={<ModuleBoundary moduleName="내 업무" resetKey={resetKey}><TaskPanel key={resetKey} adapter={taskAdapter} member={member} date={context.basisDate} revision={refreshEpoch} compact onNavigationLockChange={setTaskNavigationLocked} onOpenTasks={resource.openTasks} /></ModuleBoundary>} />}
        </ModuleBoundary>
      </WorkspaceShell>}
    <ConnectionReadinessPanel key={`${expectedUserId}:${diagnosticEpoch}`} expectedUserId={expectedUserId} runCheck={checkReadiness} />
  </StyleBoundary>
}
