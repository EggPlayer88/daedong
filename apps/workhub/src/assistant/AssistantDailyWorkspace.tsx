import { useEffect, useState } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import type { CalendarAdapter } from '../calendar/contracts'
import type { PersonalTask, TaskAdapter } from '../tasks/contracts'
import { activeAt, homeItems } from '../domain'
import { eventResponse } from '../connection/validation'
import { eventTiming } from '../calendar/formatting'
import { dayLabel, upcomingPreview } from '../calendar/presentation'
import { taskListResponse } from '../tasks/validation'
import { summarizeTasks, taskStatusLabels } from '../tasks/presentation'
import { recoveryScope } from '../app/pending-requests'
import { HomeOverviewPanel } from '../home/HomeOverviewPanel'
import type { HomeAction, HomeKind } from '../home/overview'
import { NeisMeals } from '../neis/NeisMeals'
import { TimetableAgendaWorkspace } from '../timetable/TimetableAgendaPanel'
import { PersonalRosterAgenda } from '../teacher-roster/PersonalRosterAgenda'
import { iso } from '../neis/contracts'
import styles from './daily-workspace.css?inline'

export interface AssistantDailyWorkspaceProps {
  connection: SupabaseConnection
  member: Membership
  members: Membership[]
  date: string
  revision: number
  calendarAdapter: CalendarAdapter
  taskAdapter: TaskAdapter
  view: 'overview' | 'meals' | 'lessons'
  mealDate?: string
  lessonDate?: string
  locked?: boolean
  onOpen: (item: HomeAction) => void
  onOpenList: (kind: HomeKind) => void
  onOpenCalendar: (item: { id: string; version: number; title: string }) => void
  onOpenTask: (item: { id: string; version: number; title: string }) => void
  onOpenCalendarList: () => void
  onOpenTaskList: () => void
  onOpenLesson?: (lessonId: string, date: string) => void
}

// 원본은 기존 조회·표시 규칙을 사용한다. 이 화면의 조회 결과를 AI 문맥이나 쓰기 명령으로 바꾸지 않는다.
export function AssistantDailyWorkspace(props: AssistantDailyWorkspaceProps) {
  const mealDate = props.mealDate ?? props.date
  const lessonDate = props.lessonDate ?? props.date
  try { iso(props.date); iso(mealDate); iso(lessonDate) } catch { return <p role="alert">확인할 날짜를 다시 선택해 주세요.</p> }
  if (!activeAt(props.member, props.date)) return <p role="alert">현재 학교 소속을 확인한 뒤 다시 열어 주세요.</p>
  return <DailyWorkspaceScope key={`${recoveryScope(props.member)}:${props.date}:${props.view}:${mealDate}:${lessonDate}`} {...props} mealDate={mealDate} lessonDate={lessonDate} />
}

function DailyWorkspaceScope(props: AssistantDailyWorkspaceProps & { mealDate: string }) {
  const { connection, member, date, revision, view, mealDate, locked, onOpen, onOpenList } = props
  return <section className="assistant-daily" aria-label={view === 'meals' ? '대화에서 급식 확인' : view === 'lessons' ? '대화에서 내 수업 확인' : '대화에서 오늘 업무 확인'}>
    <style>{styles}</style>
    <header className="assistant-daily-heading"><h2>{view === 'meals' ? '급식' : view === 'lessons' ? '내 수업 시간표' : '오늘의 업무'}</h2>{view === 'overview' && <span>{dayLabel(date)}</span>}</header>
    {view === 'meals' ? <NeisMeals key={mealDate} connection={connection} member={member} date={mealDate} heading="급식" /> : view === 'lessons' ? <fieldset disabled={locked} aria-label="선택 날짜 내 수업 조회"><TimetableAgendaWorkspace connection={connection} member={member} date={props.lessonDate ?? date} revision={revision} title="날짜별 내 수업" showBasicFallback onOpen={(lessonId, lessonDate) => { if (!locked) props.onOpenLesson?.(lessonId, lessonDate) }} /></fieldset> : <>
    {props.onOpenLesson && <section className="assistant-daily-lessons" aria-label="대화에서 오늘 수업">
      <fieldset disabled={locked} aria-label="오늘 수업 조회">
        <TimetableAgendaWorkspace connection={connection} member={member} date={date} revision={revision} title="오늘 수업"
          onOpen={(lessonId, lessonDate) => { if (!locked) props.onOpenLesson?.(lessonId, lessonDate) }} />
        <PersonalRosterAgenda connection={connection} member={member} date={date} revision={revision} />
      </fieldset>
    </section>}
    <div className="assistant-daily-grid">
      <HomeOverviewPanel connection={connection} member={member} revision={revision} locked={locked} onOpen={onOpen} onOpenList={onOpenList} />
      <DailyTasks {...props} />
      <DailyCalendar {...props} />
      <NeisMeals key={mealDate} connection={connection} member={member} date={mealDate} heading="급식" />
    </div></>}
  </section>
}

function DailyTasks({ taskAdapter, member, date, revision, locked, onOpenTask, onOpenTaskList }: AssistantDailyWorkspaceProps) {
  const [data, setData] = useState<PersonalTask[]>(), [failed, setFailed] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    setData(undefined); setFailed(false)
    void taskAdapter.list(member.id).then(raw => {
      const result = taskListResponse(raw, { schoolId: member.schoolId, memberId: member.id })
      if (live) setData(result)
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [taskAdapter, member, date, revision, reload])
  const summary = data ? summarizeTasks(data, date) : undefined
  return <section className="assistant-daily-card" aria-label="대화에서 내 할 일" aria-busy={!data && !failed}>
    <header><h3>내 할 일</h3>{summary && <span>{summary.total}개</span>}</header>
    {failed ? <div role="alert"><p>내 할 일을 확인하지 못했습니다.</p><button type="button" onClick={() => setReload(value => value + 1)}>할 일 다시 확인</button></div>
      : !summary ? <p role="status">내 할 일을 확인하는 중…</p>
      : <><ul>{summary.items.map(({ task, reason }) => <li key={task.id}><button type="button" disabled={locked} onClick={() => onOpenTask(task)} aria-label={`${task.title} · 할 일 v${task.version} 열기`}><strong>{task.title}</strong><small>{reason}{task.dueDate && ` · ${task.dueDate}`} · {taskStatusLabels[task.status]}</small></button></li>)}</ul>
        {!summary.total && <p className="assistant-daily-empty">현재 미완료 할 일이 없습니다.</p>}
        {summary.total > summary.items.length && <p className="assistant-daily-count">{summary.total}개 중 {summary.items.length}개 표시</p>}
        <button type="button" className="assistant-daily-link" disabled={locked} onClick={onOpenTaskList}>내 할 일 모두 보기</button></>}
  </section>
}

function DailyCalendar({ calendarAdapter, member, members, date, revision, locked, onOpenCalendar, onOpenCalendarList }: AssistantDailyWorkspaceProps) {
  const [data, setData] = useState<CalendarEvent[]>(), [failed, setFailed] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    setData(undefined); setFailed(false)
    void calendarAdapter.list(member.id).then(raw => {
      if (!Array.isArray(raw)) throw new Error('일정 응답을 확인하지 못했습니다.')
      const result = raw.map(item => eventResponse(item, member.schoolId, members))
      if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('일정 응답을 확인하지 못했습니다.')
      if (live) setData(result)
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [calendarAdapter, member, members, date, revision, reload])
  const today = data ? homeItems(data, member, date).today : undefined
  const next = data ? upcomingPreview(data, member, date, 3) : undefined
  return <section className="assistant-daily-card" aria-label="대화에서 내 일정" aria-busy={!data && !failed}>
    <header><h3>오늘 관련 일정</h3>{today && <span>{today.length}개</span>}</header>
    {failed ? <div role="alert"><p>관련 일정을 확인하지 못했습니다.</p><button type="button" onClick={() => setReload(value => value + 1)}>일정 다시 확인</button></div>
      : !today || !next ? <p role="status">관련 일정을 확인하는 중…</p>
      : <><ul>{today.slice(0, 4).map(({ event }) => <li key={event.id}><button type="button" disabled={locked} onClick={() => onOpenCalendar(event)} aria-label={`${event.title} · 일정 v${event.version} 열기`}><strong>{event.title}</strong><small>{eventTiming(event, date).description}{event.location && ` · ${event.location}`}</small></button></li>)}</ul>
        {!today.length && <p className="assistant-daily-empty">오늘 나와 관련된 일정이 없습니다.</p>}
        {today.length > 4 && <p className="assistant-daily-count">{today.length}개 중 4개 표시</p>}
        {next.total > 0 && <details><summary>다가오는 7일 · {next.total}개</summary><ul>{next.items.map(({ event }) => <li key={event.id}><button type="button" disabled={locked} onClick={() => onOpenCalendar(event)} aria-label={`${event.title} · 예정 일정 v${event.version} 열기`}><strong>{event.title}</strong><small>{dayLabel(event.startDate)}</small></button></li>)}</ul>{next.total > next.items.length && <p className="assistant-daily-count">{next.total}개 중 {next.items.length}개 표시</p>}</details>}
        <button type="button" className="assistant-daily-link" disabled={locked} onClick={onOpenCalendarList}>일정 모두 보기</button></>}
  </section>
}
