import { useEffect, useId, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import type { TimetableOperationsServer } from './operations-contracts'
import { createTimetableOperationsServer } from './operations-server'
import { projectTimetableCalendar, timetableDateOffset, type TimetableCalendarItem } from './operations-calendar'
import { recoveryScope } from '../app/pending-requests'
import { ServiceError } from '../services/scoped-rpc'
import styles from './operations-agenda.css?inline'
import themeStyles from './timetable-theme.css?inline'

interface SharedProps { member: Membership; date: string; revision?: number; title?: string; onOpen: (lessonId: string, date: string) => void }
interface Props extends SharedProps { server: TimetableOperationsServer }
export function TimetableAgendaWorkspace({ connection, ...props }: SharedProps & { connection: SupabaseConnection }) {
  const server = useMemo(() => createTimetableOperationsServer(connection), [connection])
  return <TimetableAgendaPanel key={recoveryScope(props.member)} {...props} server={server} />
}
type AgendaState = { status: 'ready'; items: TimetableCalendarItem[] } | { status: 'loading' | 'unavailable' | 'error'; message: string }
export function TimetableAgendaPanel({ server, member, date, revision = 0, title = '내 수업', onOpen }: Props) {
  const [loaded, setLoaded] = useState<{ key: string; state: AgendaState }>(), [retry, setRetry] = useState(0)
  const key = JSON.stringify([recoveryScope(member), date]), state = loaded?.key === key ? loaded.state : { status: 'loading' as const, message: '확정된 내 수업을 확인하고 있습니다.' }
  useEffect(() => {
    let cancelled = false
    const save = (state: AgendaState) => { if (!cancelled) setLoaded({ key, state }) }
    void (async () => {
      try {
        const until = timetableDateOffset(date, 1), readiness = await server.readiness(member.id)
        if (cancelled) return
        if (!readiness.available) { save({ status: 'unavailable', message: readiness.reason === 'not_allowed' ? '현재 계정의 시간표 조회 권한을 확인해야 합니다.' : '확정 시간표 연결을 준비 중입니다.' }); return }
        const view = await server.get(member.id, date, until)
        if (cancelled) return
        save({ status: 'ready', items: projectTimetableCalendar(view, member.id) })
      } catch (failure) { save({ status: failure instanceof ServiceError && failure.code === 'NOT_READY' ? 'unavailable' : 'error', message: failure instanceof ServiceError && failure.code === 'NOT_READY' ? '확정 시간표 연결을 준비 중입니다.' : '내 수업을 확인하지 못했습니다. 수업이 없는 것으로 처리하지 않습니다.' }) }
    })()
    return () => { cancelled = true }
  }, [server, member.id, key, date, revision, retry])
  return <TimetableAgendaContent title={title} date={date} state={state} onRetry={() => setRetry(value => value + 1)} onOpen={onOpen} />
}
export function TimetableAgendaContent({ title, date, state, onRetry, onOpen }: { title: string; date: string; state: AgendaState; onRetry: () => void; onOpen: SharedProps['onOpen'] }) {
  const id = useId()
  return <section className={`ttagenda ttagenda-${state.status}${state.status === 'ready' && !state.items.length ? ' ttagenda-empty' : ''}`} aria-labelledby={id + '-title'}><style>{themeStyles + styles}</style><div className="ttagenda-header"><h3 id={id + '-title'}>{title}</h3><span>{date}</span></div>
    {state.status !== 'ready' ? <div><p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>{state.status === 'error' && <button type="button" onClick={onRetry}>내 수업 다시 확인</button>}</div> : <>
      {!state.items.length ? <p>이 날짜에 확인된 내 수업이 없습니다.</p> : <ol>{state.items.slice(0, 5).map(item => <li key={item.id}><button type="button" onClick={() => onOpen(item.lessonId, item.startDate)}><time dateTime={item.startsAt}>{item.startTime}–{item.endTime}</time><span><strong>{item.title}</strong><span>{item.groupNames.join(' · ')}{item.location ? ' · ' + item.location : ''}</span></span><small>{item.state === 'cancelled' ? '취소' : item.state === 'performed' ? '진행 완료' : '예정'}</small></button></li>)}</ol>}
      <button type="button" className="ttagenda-all" onClick={() => onOpen('', date)}>{state.items.length > 5 ? `내 수업 ${state.items.length}건 전체 보기` : '시간표 전체 보기'}</button>
    </>}
  </section>
}
