import { NavLink, Outlet } from 'react-router-dom'
import { signOut, ROLE_LABELS, ROLE_COLORS } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
// 메뉴와 라우트는 **같은 표**를 본다 (lib/modules.js). 한쪽만 고치면 메뉴에 없는
// 화면이 주소로는 열리거나, 그 반대가 된다.
import { visibleModules } from '../lib/modules.js'

export default function Layout() {
  const { profile } = useAuth()
  const menu = visibleModules(profile)

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
