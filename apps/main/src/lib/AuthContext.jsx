import { createContext, useContext, useEffect, useState } from 'react'
import { getSession, onAuthStateChange, fetchMyProfile } from '@daedong/shared'

// 세션(로그인 여부)과 프로필(public.users 행)을 함께 들고 있는 단일 출처.
// 권한 판정은 언제나 profile 로 한다 (session 에는 role 이 없다).
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)

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
      return
    }

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

    return () => {
      alive = false
    }
  }, [userId])

  const value = { session, profile, loading, profileError, isLoggedIn: !!session }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있습니다')
  return ctx
}
