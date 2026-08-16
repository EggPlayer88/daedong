import { useAuth } from '../lib/AuthContext.jsx'
import { RoleBadge } from '../components/Layout.jsx'

// Phase 0 의 대시보드는 "빈 대시보드" 다 (ROADMAP).
// 위젯 4종(my_tasks / today_timetable / upcoming_events / recent_documents)은 Phase 1.
// 지금은 Phase 0 완료 판정에 필요한 것 — 내 역할이 보이는지 — 만 표시한다.
export default function DashboardPage() {
  const { session, profile, profileError } = useAuth()

  return (
    <div className="page">
      <h2>대시보드</h2>

      {profileError && <p className="error">{profileError.message}</p>}

      {profile ? (
        <div className="card">
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
        </div>
      ) : (
        !profileError && <p className="muted">프로필을 불러오는 중…</p>
      )}

      <p className="muted small">
        로그인 계정: {session?.user?.email} · 위젯은 Phase 1 에서 추가됩니다.
      </p>
    </div>
  )
}
