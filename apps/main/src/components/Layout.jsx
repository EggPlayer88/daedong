import { NavLink, Outlet } from 'react-router-dom'
import { can, signOut, ROLE_LABELS, ROLE_COLORS } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'

// 메뉴 정의 — action 이 null 이면 로그인만 하면 보인다.
// ROADMAP 의 라우트 표를 따르되, P1 에 맞춰 지금 있는 화면만 등록한다.
const MENU = [
  { to: '/', label: '대시보드', end: true, action: null },
  { to: '/doc-ai', label: '문서 작성 AI', end: false, action: null },
  { to: '/admin/users', label: '사용자 관리', end: false, action: 'users.manage' },
]

export default function Layout() {
  const { profile } = useAuth()
  const menu = MENU.filter((m) => !m.action || can(profile, m.action))

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">대동여중 업무혁신시스템</div>

        <nav className="nav">
          {menu.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>

        <div className="me">
          {profile && (
            <>
              <span className="me-name">{profile.name}</span>
              <RoleBadge role={profile.role} />
            </>
          )}
          <button className="btn-plain" onClick={() => signOut()}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export function RoleBadge({ role }) {
  const color = ROLE_COLORS[role] ?? '#8b95ad'
  return (
    <span className="badge" style={{ color, borderColor: `${color}40`, background: `${color}18` }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}
