import { signOut } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'

/**
 * 승인 대기 화면 (D20).
 * 로그인은 됐지만 public.users.is_active = false 인 동안 앱 전체를 대신한다.
 * 여기서 할 수 있는 일은 로그아웃뿐 — 데이터 화면으로 들어갈 경로를 두지 않는다.
 */
export default function PendingPage() {
  const { session, profile } = useAuth()
  const email = profile?.email || session?.user?.email

  return (
    <div className="login">
      <div className="login-card pending">
        <div className="pending-icon">⏳</div>
        <h1>승인 대기중입니다</h1>
        <p className="muted">
          관리자 승인 후 이용할 수 있습니다.
          <br />
          승인되면 이 페이지를 새로고침해 주세요.
        </p>

        {email && (
          <div className="pending-account">
            <span className="muted small">가입 계정</span>
            <div>{email}</div>
          </div>
        )}

        <p className="muted small">
          다른 계정으로 가입하시려면 로그아웃 후 다시 로그인해 주세요.
        </p>

        <button className="btn-plain wide" onClick={() => signOut()}>
          로그아웃
        </button>
      </div>
    </div>
  )
}
