import { Suspense } from 'react'
import { SiteNavigationProvider } from '../site/site-navigation.jsx'
import UnifiedPageShell from '../site/UnifiedPageShell.jsx'
import { Outlet, useLocation } from 'react-router-dom'
import { signOut, ROLE_LABELS, ROLE_COLORS } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import { useRef } from 'react'

export default function Layout() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const workhub = pathname === '/workhub'
  const content = useRef(null)

  return (
    <SiteNavigationProvider>
      <div className="app app-workhub app-unified">
        <a
          className="site-skip-link"
          href="#site-main"
          onClick={(event) => {
            event.preventDefault()
            content.current?.focus()
          }}
        >
          본문으로 바로가기
        </a>
        <header className="topbar">
          <div className="brand">대동여중 업무혁신시스템</div>

          <div className="me">
            {profile && (
              <>
                <span className="me-name" title={profile.name}>
                  {profile.name}
                </span>
                <RoleBadge role={profile.role} />
              </>
            )}
            <button className="btn-plain" onClick={() => signOut()}>
              로그아웃
            </button>
          </div>
        </header>

        <main className="content" id="site-main" ref={content} tabIndex={-1}>
          {workhub ? (
            <Outlet />
          ) : (
            <Suspense fallback={<p role="status">업무 화면을 준비하고 있습니다…</p>}>
              <UnifiedPageShell>
                <Outlet />
              </UnifiedPageShell>
            </Suspense>
          )}
        </main>
      </div>
    </SiteNavigationProvider>
  )
}

export function RoleBadge({ role }) {
  const color = ROLE_COLORS[role] ?? '#8b95ad'
  return (
    <span
      className="badge"
      style={{ color: 'var(--text)', borderColor: `${color}40`, background: `${color}18` }}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}
