import { createContext, useCallback, useContext, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react'

interface Session { setLock: (id: string, value: boolean) => void; requestChange: (action: () => void) => boolean }
const EditContext = createContext<Session | null>(null)

// 여러 응답 단위·학생 카드가 동시에 편집되어도 한 카드의 종료가 다른 잠금을 풀지 않는다.
export function EditSession({ onLockChange, children }: { onLockChange: (locked: boolean) => void; children: ReactNode }) {
  const locks = useRef(new Set<string>())
  const [locked, setLocked] = useState(false)
  const [notice, setNotice] = useState('')
  const setLock = useCallback((id: string, value: boolean) => {
    if (value) locks.current.add(id)
    else locks.current.delete(id)
    setLocked(locks.current.size > 0)
    if (!locks.current.size) setNotice('')
  }, [])
  const requestChange = useCallback((action: () => void) => {
    if (locks.current.size) { setNotice('작성 중인 내용을 저장하거나 편집을 취소한 뒤 다른 항목으로 이동해 주세요.'); return false }
    action()
    return true
  }, [])
  useLayoutEffect(() => { onLockChange(locked); return () => onLockChange(false) }, [locked, onLockChange])
  return <EditContext.Provider value={{ setLock, requestChange }}>{notice && <p className="notice-box" role="status">{notice}</p>}{children}</EditContext.Provider>
}

export function useEditSession(locked = false) {
  const id = useId()
  const session = useContext(EditContext)
  const setLock = session?.setLock
  useLayoutEffect(() => {
    setLock?.(id, locked)
    return () => setLock?.(id, false)
  }, [id, locked, setLock])
  return session?.requestChange ?? ((action: () => void) => { action(); return true })
}
