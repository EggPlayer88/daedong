import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { signInWithGoogle, signInWithEmailPassword } from '@daedong/shared'

function emailLoginError(error) {
  if (error?.code === 'email_not_confirmed') return '이메일 인증이 완료되지 않았습니다. 계정 생성 상태를 관리자에게 확인해 주세요.'
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') return '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
  if (error?.code === 'invalid_credentials' || error?.code === 'user_banned') return '이메일·비밀번호 또는 계정 이용 상태를 확인해 주세요.'
  return '로그인 연결을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'
}

export default function LoginPage() {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const passwordInput = useRef(null), inFlight = useRef(false), alive = useRef(true)
  // 별도 안내 주소에서만 입력창을 보여 준다. 이 값은 접근 권한이 아니며 기존 승인 게이트를 따른다.
  const emailMode = new URLSearchParams(useLocation().search).get('login') === 'email'
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function handleEmailLogin(event) {
    event.preventDefault()
    if (inFlight.current) return
    const form = event.currentTarget
    const email = form.elements.namedItem('email').value
    let password = passwordInput.current.value
    passwordInput.current.value = ''
    inFlight.current = true
    setError(null)
    setBusy(true)
    try {
      await signInWithEmailPassword(email, password)
      // 세션 변화는 공통 AuthProvider가 처리한다. 여기서 승인이나 역할을 가정하지 않는다.
    } catch (failure) {
      if (alive.current) setError(emailLoginError(failure))
    } finally {
      password = ''
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function handleLogin() {
    if (inFlight.current) return
    inFlight.current = true
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle() // 성공 시 Google 로 이동하므로 이 아래는 실행되지 않는다
    } catch (e) {
      inFlight.current = false
      if (alive.current) {
        setError('Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        setBusy(false)
      }
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>대동여중 업무혁신시스템</h1>
        {emailMode ? <>
          <h2>이메일 계정 로그인</h2>
          <p className="muted">관리자가 준비한 계정으로 로그인합니다. 가입 승인과 학교 소속 확인은 별도로 필요합니다.</p>
          <form className="email-login-form" onSubmit={handleEmailLogin}>
            <label htmlFor="login-email">이메일<input id="login-email" name="email" type="email" autoComplete="username" required disabled={busy} /></label>
            <label htmlFor="login-password">비밀번호<input id="login-password" name="password" type="password" autoComplete="current-password" ref={passwordInput} required disabled={busy} /></label>
            <button className="btn-google" type="submit" disabled={busy}>{busy ? '로그인 확인 중…' : '이메일로 로그인'}</button>
          </form>
          <p className="muted small email-login-note">로그인 요청 후 비밀번호 입력란은 비워집니다.</p>
        </> : <>
          <p className="muted">학교 계정(Google)으로 로그인하세요.</p>
          <button className="btn-google" onClick={handleLogin} disabled={busy}>
            {busy ? '이동 중…' : 'Google 로 로그인'}
          </button>
        </>}

        {error && (
          <p className="error" role="alert">{error}</p>
        )}
      </div>
    </div>
  )
}
