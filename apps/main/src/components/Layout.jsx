import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { signOut, ROLE_LABELS, ROLE_COLORS } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
// 메뉴와 라우트는 **같은 표**를 본다 (lib/modules.js). 한쪽만 고치면 메뉴에 없는
// 화면이 주소로는 열리거나, 그 반대가 된다.
import { visibleModules } from '../lib/modules.js'
import { useMessagingPilot } from '../lib/MessagingPilotContext.jsx'
import { useEffect, useRef } from 'react'

export default function Layout() {
  const { profile } = useAuth()
  const { access } = useMessagingPilot()
  const menu = visibleModules(profile, access)
  const { pathname } = useLocation()
  const workhub = pathname === '/workhub'
  const content = useRef(null)
  const previousPath = useRef(pathname)
  useEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    // 업무실 내부 초점은 자체 셸이 맡고, 기존 업무 사이 이동만 제목으로 안내한다.
    if (!workhub) {
      const target = content.current?.querySelector('h2') ?? content.current
      target?.setAttribute('tabindex', '-1')
      target?.focus()
    }
  }, [pathname, workhub])
  const navigation = <nav className="nav" aria-label="기존 업무 메뉴">{menu.map(m => (
    <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>{m.label}</NavLink>
  ))}</nav>

  return (
    <div className={workhub ? "app app-workhub" : "app"}>
      <a className="site-skip-link" href="#site-main" onClick={event => { event.preventDefault(); content.current?.focus() }}>본문으로 바로가기</a>
      <header className="topbar">
        <div className="brand">대동여중 업무혁신시스템</div>

        {workhub ? <details className="legacy-navigation"><summary>기존 업무 메뉴</summary>{navigation}</details> : navigation}

        <div className="me">
          {profile && (
            <>
              <span className="me-name" title={profile.name}>{profile.name}</span>
              <RoleBadge role={profile.role} />
            </>
          )}
          <button className="btn-plain" onClick={() => signOut()}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="content" id="site-main" ref={content} tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

export function RoleBadge({ role }) {
  const color = ROLE_COLORS[role] ?? '#8b95ad'
  return (
    <span className="badge" style={{ color: 'var(--text)', borderColor: `${color}40`, background: `${color}18` }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}
