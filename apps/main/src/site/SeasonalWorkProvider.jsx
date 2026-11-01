import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import { createSeasonalService } from './seasonal-service.js'

export const SeasonalWorkContext = createContext({
  state: null,
  loading: true,
  error: '',
  pending: null,
  busy: false,
})
export const useSeasonalWork = () => useContext(SeasonalWorkContext)
export function SeasonalWorkProvider({ children, service: supplied }) {
  const { profile, session } = useAuth()
  const userId = session?.user?.id
  const scope =
    profile?.id === userId && profile?.is_active === true ? `${userId}:${profile.role}` : ''
  const service = useMemo(() => supplied ?? createSeasonalService(supabase), [supplied])
  return (
    <SeasonalScope key={scope} scope={scope} service={service}>
      {children}
    </SeasonalScope>
  )
}
function SeasonalScope({ children, scope, service }) {
  const [state, setState] = useState(null),
    [loading, setLoading] = useState(Boolean(scope)),
    [error, setError] = useState('')
  const [pending, setPending] = useState(null),
    [busy, setBusy] = useState(false)
  const alive = useRef(true),
    serial = useRef(0),
    writing = useRef(false)
  const accept = (value) =>
    setState((previous) => (!previous || value.version >= previous.version ? value : previous))
  const refresh = useCallback(async () => {
    if (!scope) return
    const turn = ++serial.current
    setLoading(true)
    try {
      const value = await service.read()
      if (alive.current && turn === serial.current) {
        accept(value)
        setError('')
      }
    } catch (e) {
      if (alive.current && turn === serial.current) setError(e.message)
    } finally {
      if (alive.current && turn === serial.current) setLoading(false)
    }
  }, [scope, service])
  useEffect(() => {
    alive.current = true
    void refresh()
    const focus = () => {
      void refresh()
    }
    window.addEventListener('focus', focus)
    return () => {
      alive.current = false
      serial.current++
      window.removeEventListener('focus', focus)
    }
  }, [refresh])
  async function save(enabled, retry = false) {
    if (!scope || writing.current || !state?.canManage || (pending && !retry)) return
    const command = retry ? pending : { enabled, version: state.version, key: crypto.randomUUID() }
    if (!command) return
    writing.current = true
    setBusy(true)
    setPending(command)
    setError('')
    try {
      const result = await service.save(command)
      if (alive.current) {
        accept(result)
        setPending(null)
        void refresh()
      }
    } catch (e) {
      if (alive.current) {
        setError(e.message)
        if (
          [
            'FORBIDDEN',
            'CONFLICT',
            'INVALID_INPUT',
            'IDEMPOTENCY_CONFLICT',
            'NOT_INSTALLED',
          ].includes(e.code)
        ) {
          setPending(null)
          void refresh()
        }
      }
    } finally {
      writing.current = false
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    if (!pending) return
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])
  return (
    <SeasonalWorkContext.Provider value={{ state, loading, error, pending, busy, refresh, save }}>
      {children}
    </SeasonalWorkContext.Provider>
  )
}
