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
        // 행이 없는 것은 정상이 아니다 (트리거 미적용 / 000 [D] 누락).
        // 조용히 넘기면 "로그인은 됐는데 아무 권한도 없는" 상태로 헤맨다.
        setProfileError(
          p
            ? null
            : new Error(
                'public.users 에 내 행이 없습니다. 001 의 on_auth_user_created 트리거와 ' +
                  '000 [D](기존 auth 사용자 삭제) 수행 여부를 확인하세요.'
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
