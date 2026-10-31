import { Navigate } from 'react-router-dom'
import { useSeasonalWork } from '../site/SeasonalWorkProvider.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { RoleBadge } from '../components/Layout.jsx'
import { Link } from 'react-router-dom'
import { visibleModules } from '../lib/modules.js'
import { useMessagingPilot } from '../lib/MessagingPilotContext.jsx'
import { PageHeading } from '../components/PageFrame.jsx'

// 바로가기도 상단 메뉴와 같은 목록을 사용한다. 별도 공개 규칙을 만들지 않는다.
export default function DashboardPage({ accountOnly = false }) {
  const { session, profile, profileError } = useAuth()
  const { access } = useMessagingPilot()
  const seasonal = useSeasonalWork()
  const workspace = visibleModules(profile, access).find(item => item.key === 'workhub')
  if (workspace && !accountOnly) return <Navigate to={workspace.to} replace />
  const links = profile ? visibleModules(profile, access).filter(item => item.key !== 'dashboard' && (!['doc-ai', 'submissions'].includes(item.key) || seasonal.state?.enabled)) : []

  return (
    <div className="page site-page dashboard-page">
      <PageHeading title={accountOnly ? "내 계정" : "오늘의 업무"} description="오늘 필요한 업무를 선택해 시작하세요." />

      {profileError && <p className="error" role="alert">{profileError.message}</p>}

      {!accountOnly && !seasonal.state?.enabled && <p className="muted">{seasonal.error ? '기간 업무 메뉴를 확인하지 못했습니다. 설정을 다시 확인하거나 관리자에게 문의해 주세요.' : seasonal.loading ? '진행 중인 기간 업무를 확인하고 있습니다…' : '현재 진행 중인 기간 업무가 없습니다. 평가계획서 제출 기간이 되면 관리자가 메뉴를 열어 드립니다.'}</p>}
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
