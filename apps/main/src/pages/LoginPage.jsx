import { useState } from 'react'
import { signInWithGoogle } from '@daedong/shared'

export default function LoginPage() {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleLogin() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle() // 성공 시 Google 로 이동하므로 이 아래는 실행되지 않는다
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>대동여중 업무혁신시스템</h1>
        <p className="muted">학교 계정(Google)으로 로그인하세요.</p>

        <button className="btn-google" onClick={handleLogin} disabled={busy}>
          {busy ? '이동 중…' : 'Google 로 로그인'}
        </button>

        {error && (
          <p className="error">
            로그인을 시작하지 못했습니다: {error.message}
          </p>
        )}
      </div>
    </div>
  )
}
