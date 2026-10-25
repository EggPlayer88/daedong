import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, getSession } from '@daedong/shared'
import { useAuth } from './AuthContext.jsx'
import { parseMessagingPilot } from './messaging-pilot.js'

const Context = createContext({ access: null, checking: false })
export const useMessagingPilot = () => useContext(Context)

export function MessagingPilotProvider({ children }) {
  const { session, profile, profileError } = useAuth()
  const userId = session?.user?.id
  const eligible = !profileError && profile?.id === userId && profile?.is_active === true && profile?.role === 'teacher'
  const [state, setState] = useState({ userId: null, access: null, checking: false })
  useEffect(() => {
    if (!eligible) { setState({ userId: null, access: null, checking: false }); return }
    let alive = true, serial = 0, timer
    setState({ userId, access: null, checking: true })
    async function refresh() {
      const turn = ++serial
      let access = null
      let deadline
      try {
        access = await Promise.race([
          (async () => {
            const { data, error } = await supabase.rpc('workhub_messaging_pilot_access')
            const current = await getSession()
            return !error && current?.user?.id === userId ? parseMessagingPilot(data, profile, userId) : null
          })(),
          new Promise(resolve => { deadline = setTimeout(() => resolve(null), 10000) }),
        ])
      } catch { /* 미설치·통신 실패·응답 이상 모두 시범 허용으로 간주하지 않는다. */ }
      finally { clearTimeout(deadline) }
      if (!alive || turn !== serial) return
      clearTimeout(timer)
      setState({ userId, access, checking: false })
      if (access) timer = setTimeout(() => { if (alive) setState({ userId, access: null, checking: false }) }, Math.min(2147483647, Math.max(0, Date.parse(access.expiresAt) - Date.now())))
    }
    const onFocus = () => { void refresh() }
    void refresh()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; serial++; clearTimeout(timer); window.removeEventListener('focus', onFocus) }
  }, [userId, eligible, profile])
  // 계정 전환 직후 이전 계정의 허용을 한 프레임도 전달하지 않는다.
  const value = eligible && state.userId === userId ? state : { access: null, checking: eligible }
  return <Context.Provider value={value}>{children}</Context.Provider>
}
