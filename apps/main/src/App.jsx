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

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="doc-ai" element={<DocAiPage />} />
        <Route path="submissions" element={<SubmissionsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="admin/users" element={<AdminUsersPage />} />
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
