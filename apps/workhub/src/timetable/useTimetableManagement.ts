import { useEffect, useState } from 'react'
import type { TimetableServer } from './contracts'

// 기존 T1 서버가 year.manage를 확인한 뒤 내리는 판정만 사용한다.
// 재검증 중에는 작성 화면을 없애지 않으며, 결과가 달라지면 진입점에서 복구 요청만 유지한다.
export function useTimetableManagement(server: TimetableServer, memberId: string, date: string, revision?: number) {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'hidden' | 'error'>('loading'), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    void server.readiness(memberId).then(value => {
      if (live) setStatus(value.available || value.reason === 'basis_missing' ? 'allowed' : 'hidden')
    }).catch(() => { if (live) setStatus('error') })
    return () => { live = false }
  }, [server, memberId, date, revision, attempt])
  return { status, retry: () => setAttempt(value => value + 1) }
}
