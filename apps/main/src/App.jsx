import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import DocAiPage from './pages/DocAiPage.jsx'
import AdminUsersPage from './pages/AdminUsersPage.jsx'

// 로그인 전에는 무조건 로그인 화면. 세션 확인 중에는 아무것도 그리지 않는다
// (깜빡임 방지 겸, OAuth 복귀 직후 로그인 화면이 스쳐 보이는 것을 막는다)
function Gate() {
  const { isLoggedIn, loading } = useAuth()

  if (loading) return <div className="boot">불러오는 중…</div>
  if (!isLoggedIn) return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="doc-ai" element={<DocAiPage />} />
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
