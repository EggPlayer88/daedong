import '../../../workhub/src/app/navigation-bridge'
import { Component, lazy, Suspense } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { useHref } from 'react-router-dom'
import { MODULES } from '../lib/modules.js'
import { useMessagingPilot } from '../lib/MessagingPilotContext.jsx'
import { hasMessagingPilot } from '../lib/messaging-pilot.js'

const ConnectedWorkspace = lazy(() => import('../../../workhub/src/app/ConnectedWorkspace.tsx').then(module => ({ default: module.ConnectedWorkspace })))
const MessagingPilotWorkspace = lazy(() => import('../../../workhub/src/messaging/MessagingPilotWorkspace.tsx').then(module => ({ default: module.MessagingPilotWorkspace })))

class WorkhubBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <section role="alert"><h1>신축 화면을 불러오지 못했습니다</h1><p>기존 업무 메뉴를 계속 이용할 수 있습니다.</p><button onClick={() => window.location.reload()}>다시 불러오기</button></section>
    return this.props.children
  }
}

export default function WorkhubPage() {
  const { session, profile, profileLoading, profileError } = useAuth()
  const { access } = useMessagingPilot()
  // 새 탭 주소도 기존 메뉴 표와 현재 라우터의 기준 경로를 따른다.
  const legacyHomeHref = useHref(MODULES.find(module => module.key === 'dashboard').to)
  const legacyPlanHref = useHref(MODULES.find(module => module.key === 'doc-ai').to)
  // 기존 로그인 연결을 사용한다. 신축 화면의 실패는 기존 문서·제출 화면에 전파하지 않는다.
  if (profileLoading) return <p role="status">계정 확인 중…</p>
  if (profileError || !session?.user?.id || profile?.id !== session.user.id || profile?.is_active !== true || (profile?.role !== 'superadmin' && !hasMessagingPilot(profile, access))) return <p role="alert">현재 계정으로 신축 시험 화면을 이용할 수 없습니다.</p>
  if (profile.role === 'teacher') return <WorkhubBoundary key={session.user.id}><Suspense fallback={<p role="status">메신저 시험 화면을 준비하고 있습니다…</p>}><MessagingPilotWorkspace access={access} /></Suspense></WorkhubBoundary>
  return <WorkhubBoundary key={session.user.id}><Suspense fallback={<p role="status">신축 업무 화면을 준비하고 있습니다…</p>}><ConnectedWorkspace expectedUserId={session.user.id} legacyHomeHref={legacyHomeHref} legacyPlanHref={legacyPlanHref} /></Suspense></WorkhubBoundary>
}
