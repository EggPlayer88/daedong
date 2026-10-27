import { useAuth } from '../lib/AuthContext.jsx'
import { RoleBadge } from '../components/Layout.jsx'
import { Link } from 'react-router-dom'
import { visibleModules } from '../lib/modules.js'
import { useMessagingPilot } from '../lib/MessagingPilotContext.jsx'
import { PageHeading } from '../components/PageFrame.jsx'

// 바로가기도 상단 메뉴와 같은 목록을 사용한다. 별도 공개 규칙을 만들지 않는다.
export default function DashboardPage() {
  const { session, profile, profileError } = useAuth()
  const { access } = useMessagingPilot()
  const links = profile ? visibleModules(profile, access).filter(item => item.key !== 'dashboard') : []

  return (
    <div className="page site-page dashboard-page">
      <PageHeading title="대시보드" description="오늘 필요한 업무를 선택해 시작하세요." />

      {profileError && <p className="error" role="alert">{profileError.message}</p>}

      {links.length > 0 && <section aria-label="내 업무 바로가기" className="site-shortcuts">{links.map(item => <Link key={item.key} to={item.to}><span>{item.label}</span><span aria-hidden="true">→</span></Link>)}</section>}

      {profile ? (
        <section className="card site-account" aria-label="내 계정 정보">
          <h3>내 계정</h3>
          <div className="kv">
            <span className="k">이름</span>
            <span className="v">{profile.name}</span>
          </div>
          <div className="kv">
            <span className="k">이메일</span>
            <span className="v">{profile.email}</span>
          </div>
          <div className="kv">
            <span className="k">역할</span>
            <span className="v">
              <RoleBadge role={profile.role} />
            </span>
          </div>
          <div className="kv">
            <span className="k">추가 권한</span>
            <span className="v">
              {profile.extra_permissions?.length ? profile.extra_permissions.join(', ') : '—'}
            </span>
          </div>
        </section>
      ) : (
        !profileError && <p className="muted">프로필을 불러오는 중…</p>
      )}

      <p className="muted small">
        로그인 계정: {session?.user?.email}
      </p>
    </div>
  )
}
