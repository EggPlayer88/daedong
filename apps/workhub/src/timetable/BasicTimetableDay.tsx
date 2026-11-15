import { useEffect, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { createPublishedRosterServer, type Published } from '../teacher-roster/published'
import { personalRosterDay } from '../teacher-roster/calendar'
import { timetableClock } from './designer-model'
import styles from './operations-agenda.css?inline'

interface Props {
  connection: SupabaseConnection; member: Membership; date: string; revision?: number
  onOpenWeekly?: (date: string) => void; locked?: boolean
}

// 날짜별 확정 수업이 없는 경우에만 표시할 읽기 전용 참고표다. 교환·실시 기록의 원본으로 사용하지 않는다.
export function BasicTimetableDay({ connection, member, date, revision = 0, onOpenWeekly, locked }: Props) {
  const server = useMemo(() => createPublishedRosterServer(connection), [connection])
  const key = JSON.stringify([recoveryScope(member), date, revision])
  const [loaded, setLoaded] = useState<{ key: string; data?: Published; error?: boolean }>(), [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setLoaded(undefined)
    void server.get(member.id, date).then(data => { if (live) setLoaded({ key, data }) })
      .catch(() => { if (live) setLoaded({ key, error: true }) })
    return () => { live = false }
  }, [server, member.id, key, date, retry])
  const current = loaded?.key === key ? loaded : undefined
  const data = current?.data, rows = data ? personalRosterDay(data) : []
  return <section className="ttagenda ttagenda-basic" aria-label="내 기본 시간표 참고">
    <style>{styles}</style>
    <header className="ttagenda-header"><h3>내 기본 시간표 참고</h3><span>{date}</span></header>
    <p>날짜별 확정 수업이 아직 없습니다. 아래 기본 배치에는 휴업·교환 등 날짜별 변경이 반영되지 않습니다.</p>
    {current?.error ? <div role="alert"><p>기본 시간표를 확인하지 못했습니다. 수업이 없는 것으로 처리하지 않습니다.</p><button type="button" disabled={locked} onClick={() => setRetry(value => value + 1)}>기본 시간표 다시 확인</button></div>
      : !data ? <p role="status">기본 시간표를 확인하는 중…</p>
      : !data.available ? <p>기본 시간표 연결을 준비 중입니다.</p>
      : !data.myTeacherIds.length ? <p>이 날짜의 기본 시간표에 내 교사 배정이 연결되어 있지 않습니다.</p>
      : rows.length ? <ol>{rows.map(row => <li key={row.id}><strong>{row.period}교시 · {row.subject}</strong><span>{row.className} · {timetableClock(row.start)}–{timetableClock(row.end)}</span></li>)}</ol>
      : <p>이 날짜의 기본 배치에는 내 수업이 없습니다.</p>}
    {data?.available && onOpenWeekly && <button type="button" className="ttagenda-all" disabled={locked} onClick={() => onOpenWeekly(date)}>이 날짜의 기본 주간표 보기</button>}
  </section>
}
