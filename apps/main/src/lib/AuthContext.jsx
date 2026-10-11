import { createContext, useContext, useEffect, useState } from 'react'
import { getSession, onAuthStateChange, fetchMyProfile } from '@daedong/shared'

// 세션(로그인 여부)과 프로필(public.users 행)을 함께 들고 있는 단일 출처.
// 권한 판정은 언제나 profile 로 한다 (session 에는 role 이 없다).
// 테스트에서 Provider 로 값을 주입할 수 있게 export (앱 코드는 useAuth 만 쓴다)
export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)
  // 프로필 조회가 끝났는지 — 승인 대기 판정을 성급히 내리지 않기 위해 필요하다
  const [profileLoading, setProfileLoading] = useState(true)

  // 1) 세션 — 최초 1회 조회 + 이후 변화 구독
  useEffect(() => {
    let alive = true
    const unsubscribe = onAuthStateChange((s) => {
      if (alive) setSession(s)
    })

    getSession()
      .then((s) => {
        if (alive) setSession(s)
      })
      .catch((e) => {
        if (alive) setProfileError(e)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  // 2) 프로필 — 세션의 uid 가 바뀔 때마다 다시 조회
  const userId = session?.user?.id ?? null
  useEffect(() => {
    let alive = true

    if (!userId) {
      setProfile(null)
      setProfileError(null)
      setProfileLoading(false)
      return
    }

    setProfileLoading(true)
    fetchMyProfile(userId)
      .then((p) => {
        if (!alive) return
        setProfile(p)
        // 기존 로그인 계정을 지우지 않고 같은 회원 ID의 프로필 연결을 확인한다.
        setProfileError(
          p
            ? null
            : new Error(
                '기존 로그인 계정에 연결된 회원 프로필을 확인할 수 없습니다. ' +
                  '관리자에게 회원 프로필 연결과 가입 처리 상태를 확인해 달라고 알려주세요.'
              )
        )
      })
      .catch((e) => {
        if (alive) setProfileError(e)
      })
      .finally(() => {
        if (alive) setProfileLoading(false)
      })

    return () => {
      alive = false
    }
  }, [userId])

  const value = {
    session,
    profile,
    loading,
    profileLoading,
    profileError,
    isLoggedIn: !!session,
    // D20: 승인된 사용자만 앱을 쓸 수 있다. 프로필이 없으면 판정 보류(null)
    isApproved: profile ? profile.is_active !== false : null,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있습니다')
  return ctx
}
