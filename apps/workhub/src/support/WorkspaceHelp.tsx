import { Component, Suspense, lazy, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { SupabaseConnection } from '../connection/supabase-connection'
import type { PageId } from '../modules'
import type { CheckId, ModuleCheck } from './module-checks'

export interface WorkspaceHelpProps {
  connection: SupabaseConnection
  memberId: string
  scopeKey: string
  locked: boolean
  onNavigate: (page: PageId) => boolean
  runCheck?: (id: CheckId, signal: AbortSignal) => Promise<ModuleCheck>
}

class HelpLoadBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <span role="alert">사용 안내를 불러오지 못했습니다. <button type="button" onClick={this.props.onClose}>닫고 다시 시도</button></span> : this.props.children }
}

function HelpSession(props: WorkspaceHelpProps & { onClose: () => void; returnFocus: HTMLElement | null }) {
  // 열 때만 내려받고, 가져오기에 실패한 뒤 다시 열면 새 시도로 시작한다.
  const [Dialog] = useState(() => lazy(() => import('./WorkspaceHelpDialog')))
  return <HelpLoadBoundary onClose={props.onClose}><Suspense fallback={<span role="status">사용 안내 여는 중… <button type="button" onClick={props.onClose}>취소</button></span>}><Dialog {...props}/></Suspense></HelpLoadBoundary>
}

export function WorkspaceHelp(props: WorkspaceHelpProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = useState<{ scope: string; member: string; connection: SupabaseConnection } | null>(null)
  const previous = useRef({ scope: props.scopeKey, member: props.memberId, connection: props.connection })
  useLayoutEffect(() => {
    const changed = previous.current.scope !== props.scopeKey || previous.current.member !== props.memberId || previous.current.connection !== props.connection
    previous.current = { scope: props.scopeKey, member: props.memberId, connection: props.connection }
    if (changed) setOpened(null)
  }, [props.scopeKey, props.memberId, props.connection])
  const visible = opened?.scope === props.scopeKey && opened.member === props.memberId && opened.connection === props.connection
  return <>
    <button ref={trigger} type="button" className="appearance-trigger workspace-help-trigger" aria-haspopup="dialog" aria-expanded={visible} onClick={() => setOpened({ scope: props.scopeKey, member: props.memberId, connection: props.connection })}>
      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/></svg><span>사용 안내</span>
    </button>
    {visible && <HelpSession {...props} onClose={() => { setOpened(null); trigger.current?.focus() }} returnFocus={trigger.current}/>}
  </>
}
