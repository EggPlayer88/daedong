import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import CalendarPage from './pages/CalendarPage.jsx'
import SubmissionsPage from './pages/SubmissionsPage.jsx'
import DocAiPage from './pages/DocAiPage.jsx'
import AdminUsersPage from './pages/AdminUsersPage.jsx'
import PendingPage from './pages/PendingPage.jsx'
import { visibleModules } from './lib/modules.js'

// 모듈 key → 화면. 라우트 목록은 lib/modules.js 가 정한다 —
// **볼 수 없는 모듈은 라우트를 아예 만들지 않는다.** 메뉴만 숨기면 주소를 아는
// 사람이 그대로 들어온다. 등록되지 않은 경로는 아래 '*' 가 대시보드로 돌려보낸다.
const SCREENS = {
  dashboard: <DashboardPage />,
  'doc-ai': <DocAiPage />,
  submissions: <SubmissionsPage />,
  calendar: <CalendarPage />,
  'admin-users': <AdminUsersPage />,
}

// 로그인 전에는 무조건 로그인 화면. 세션 확인 중에는 아무것도 그리지 않는다
// (깜빡임 방지 겸, OAuth 복귀 직후 로그인 화면이 스쳐 보이는 것을 막는다)
function Gate() {
  const { isLoggedIn, loading, profile, profileLoading, profileError } = useAuth()

  if (loading) return <div className="boot">불러오는 중…</div>
  if (!isLoggedIn) return <LoginPage />

  // 프로필을 아직 못 읽었으면 판정을 미룬다 — 승인된 사용자에게 대기 화면이
  // 스쳐 보이지 않게. (프로필 조회 실패는 아래 대시보드가 사유를 보여준다)
  if (profileLoading && !profileError) return <div className="boot">불러오는 중…</div>

  // 승인 대기 (D20) — 앱 진입 차단. 라우트 자체를 만들지 않는다
  if (profile && profile.is_active === false) return <PendingPage />

  const mods = visibleModules(profile)

  return (
    <Routes>
      <Route element={<Layout />}>
        {mods.map((m) =>
          m.to === '/' ? (
            <Route key={m.key} index element={SCREENS[m.key]} />
          ) : (
            <Route key={m.key} path={m.to.replace(/^\//, '')} element={SCREENS[m.key]} />
          )
        )}
        {/* 공개 범위 밖이거나 없는 주소는 대시보드로 (URL 직접 접근 차단) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  )
}
