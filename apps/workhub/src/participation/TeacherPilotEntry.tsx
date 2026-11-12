import { lazy, Suspense, useEffect, useState } from 'react'
import { createSupabaseConnection, type SupabaseConnection } from '../connection/supabase-connection'
import { ParticipantWorkspace, type ParticipantAccess } from './ParticipantWorkspace'
import { teacherPilotAccess, type TeacherPilotAccess } from './teacher-pilot-access'
const ConnectedWorkspace = lazy(() => import('../app/ConnectedWorkspace').then(module => ({ default: module.ConnectedWorkspace })))

// 일반 OP1 참여자는 기존 화면을 사용한다. TP1의 명시된 10명만 같은 AI 업무 화면으로 연결한다.
export function TeacherPilotEntry({ access, legacyHomeHref, connection: provided }: { access: ParticipantAccess; legacyHomeHref: string; connection?: SupabaseConnection }) {
  const [connection] = useState(() => provided ?? createSupabaseConnection(undefined, { participant: true }))
  const [loaded, setLoaded] = useState<{ key: string; access: TeacherPilotAccess | null }>(), [error, setError] = useState(false), [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([access.userId, access.memberId, access.schoolId, access.revision, access.expiresAt, access.scopes])
  useEffect(() => {
    let current = true
    setLoaded(undefined); setError(false)
    const timeout = setTimeout(() => { if (current) { current = false; setError(true) } }, 10000)
    void connection.rpcVerified('workhub_teacher_pilot_access').then(value => {
      if (!current) return
      const next = teacherPilotAccess(value, access)
      if (next && (Date.parse(next.expiresAt) > Date.parse(access.expiresAt) || Date.parse(access.expiresAt) <= Date.now())) throw Error('scope')
      setLoaded({ key, access: next })
    }).catch(reason => {
      if (!current) return
      // TP1 미설치 학교의 OP1 화면은 유지한다. 다른 실패를 허용으로 바꾸지 않는다.
      if (reason?.rpcCode === 'PGRST202') setLoaded({ key, access: null })
      else setError(true)
    }).finally(() => clearTimeout(timeout))
    return () => { current = false; clearTimeout(timeout) }
  }, [connection, key, attempt])
  const state = loaded?.key === key ? loaded : undefined
  if (error) return <section role="alert"><p>시험 참여 범위를 확인하지 못했습니다. 저장된 자료는 유지됩니다.</p><button onClick={() => setAttempt(n => n + 1)}>참여 범위 다시 확인</button></section>
  if (!state) return <p role="status">업무 참여 범위를 확인하고 있습니다…</p>
  return state.access ? <Suspense fallback={<p role="status">AI 업무 화면을 준비하고 있습니다…</p>}><ConnectedWorkspace key={key} expectedUserId={access.userId} legacyHomeHref={legacyHomeHref} teacherPilot={state.access} connection={connection}/></Suspense> : <ParticipantWorkspace access={access} connection={connection}/>
}
