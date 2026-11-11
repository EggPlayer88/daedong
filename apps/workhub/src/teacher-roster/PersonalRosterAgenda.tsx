import { useEffect, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { createPublishedRosterServer, type Published } from './published'
import { personalRosterDay } from './calendar'
import styles from './teacher-roster.css?inline'

export function PersonalRosterAgenda({ connection, member, date, revision = 0 }: { connection: SupabaseConnection; member: Membership; date: string; revision?: number }) {
  const server = useMemo(() => createPublishedRosterServer(connection), [connection])
  const key = `${recoveryScope(member)}:${date}:${revision}`
  const [loaded, setLoaded] = useState<{ key: string; data?: Published; failed?: boolean }>(), [retry, setRetry] = useState(0)
  useEffect(() => { let live = true; server.get(member.id, date).then(data => { if (live) setLoaded({ key, data }) }).catch(() => { if (live) setLoaded({ key, failed: true }) }); return () => { live = false } }, [server, member.id, date, key, retry])
  // 다른 계정·날짜의 응답은 새 화면에 잠깐이라도 표시하지 않는다.
  const state = loaded?.key === key ? loaded : undefined, data = state?.data
  if (data && (!data.available || !data.myTeacherIds.length)) return null
  const rows = data ? personalRosterDay(data) : []
  const clock = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
  return <details className="teacher-roster personal-roster"><style>{styles}</style><summary>내 기본 시간표 참고</summary>
    <p>계정에 연결된 기본 배치입니다. 휴업·교환은 반영하지 않으므로 위 날짜별 수업을 우선 확인하세요.</p>
    {!state ? <p role="status">기본 배치를 확인하고 있습니다…</p> : state.failed ? <><p role="alert">기본 배치를 불러오지 못했습니다. 날짜별 수업에는 영향이 없습니다.</p><button type="button" onClick={() => setRetry(v => v + 1)}>기본 배치 다시 확인</button></> : rows.length ? <ol>{rows.map(r => <li key={r.id}><strong>{r.period}교시 · {r.subject}</strong><span>{r.className} · {clock(r.start)}–{clock(r.end)}</span></li>)}</ol> : <p>이 날짜의 기본 배치가 없습니다.</p>}
  </details>
}
