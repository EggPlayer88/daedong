import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ContractError, type Membership } from '../contracts'
import { createSupabaseConnection, type SupabaseConnection } from '../connection/supabase-connection'
import { activeAt } from '../domain'
import { MessagingWorkspace } from './MessagingWorkspace'
import theme from '../style.css?inline'
import { createEditDrafts, EditDraftsProvider } from '../app/edit-drafts'
import { createPendingRequests, PendingRequestsProvider, recoveryScope } from '../app/pending-requests'
import { WorkspaceShell } from '../app/WorkspaceShell'
import { enabledModules } from '../modules'
import { useWorkspaceNavigation } from '../app/navigation'

export type MessagingPilotAccess = { userId: string; schoolId: string; memberId: string; expiresAt: string; revision: number }

// 공통 메뉴 틀에 허용된 메신저만 연결한다. 다른 업무 모듈을 불러오거나 호출하지 않는다.
export function MessagingPilotWorkspace({ access, connection: provided }: { access: MessagingPilotAccess; connection?: SupabaseConnection }) {
  const [connection] = useState(() => provided ?? createSupabaseConnection(undefined, { messagingPilot: true }))
  const [scope, setScope] = useState<{member: Membership; date: string; schoolName: string} | null>(null)
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [drafts] = useState(() => createEditDrafts(true)), [pending] = useState(createPendingRequests)
  const draftCount = useSyncExternalStore(drafts.subscribe, drafts.count, drafts.count)
  const pendingCount = useSyncExternalStore(pending.subscribe, pending.count, pending.count)
  const [locked, setLocked] = useState(false)
  const navigation = useWorkspaceNavigation({ allowedPages: ['messages'], defaultPage: 'messages', scopeKey: `${access.userId}:${access.memberId}`, locked, exitLocked: draftCount > 0 || pendingCount > 0 })
  const host = useRef<HTMLDivElement>(null), [root, setRoot] = useState<ShadowRoot>()
  useEffect(() => { if (host.current) setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })) }, [])
  useEffect(() => {
    let alive = true, invalidated = false
    setScope(null); setError('')
    const stop = () => { invalidated = true; if (alive) { drafts.suspend(); setScope(null); setError('시험 권한이나 학교 소속을 다시 확인해 주세요.') } }
    const unsub = connection.subscribeInvalidation(stop)
    const deadline = setTimeout(stop, 10000)
    void connection.loadContext(access.schoolId).then(context => {
      if (!alive || invalidated) return
      clearTimeout(deadline)
      const member = context.memberships.find(m => m.id === access.memberId && m.schoolId === access.schoolId && m.userId === access.userId)
      if (Date.parse(access.expiresAt) <= Date.now() || !member || !activeAt(member, context.basisDate) || context.memberships.length !== 1) throw new ContractError('FORBIDDEN', '시험 범위가 다릅니다.')
      drafts.activate(recoveryScope(member)); pending.retainScopes([recoveryScope(member)])
      setScope({ member, date: context.basisDate, schoolName: context.schools.find(s => s.id === access.schoolId)!.name })
    }).catch(() => { clearTimeout(deadline); stop() })
    const timer = setTimeout(stop, Math.min(2147483647, Math.max(0, Date.parse(access.expiresAt) - Date.now())))
    return () => { alive = false; unsub(); clearTimeout(timer); clearTimeout(deadline) }
  }, [connection, drafts, pending, access.userId, access.schoolId, access.memberId, access.expiresAt, access.revision, attempt])
  const content = <section className="messaging-pilot"><header><h1>업무실 · 메신저 시험</h1><p>{scope?.schoolName} · 일반 교사 권한으로 메시지와 HWPX 첨부를 시험합니다.</p></header>
    {navigation.announcement && <p role="status">{navigation.announcement}</p>}
    {error ? <div role="alert"><p>{error}</p><button onClick={() => setAttempt(v => v + 1)}>다시 확인</button></div>
      : scope ? <MessagingWorkspace key={`${access.userId}:${access.memberId}:${access.revision}`} connection={connection} member={scope.member} date={scope.date} onNavigationLockChange={setLocked} />
        : <p role="status">시험 계정의 학교 소속 확인 중…</p>}
  </section>
  return <div ref={host}>{root ? createPortal(<EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{theme.replaceAll(':root', ':host').replace(/(^|[}\s,])body(?=\s*[{,])/g, '$1.messaging-pilot')}{`:host{display:block}.messaging-pilot{padding:20px;min-height:65vh}.messaging-pilot>header{margin-bottom:20px}`}</style><WorkspaceShell participant mode="connected" page="messages" schoolName={scope?.schoolName ?? '학교 업무'} memberName={scope?.member.name ?? '선생님'} navigationModules={enabledModules('connected').filter(item => item.id === 'messages')} locked={locked} onNavigate={() => { navigation.requestNavigate('messages') }}>{content}</WorkspaceShell></PendingRequestsProvider></EditDraftsProvider>, root) : <p role="status">메신저 준비 중…</p>}</div>
}
