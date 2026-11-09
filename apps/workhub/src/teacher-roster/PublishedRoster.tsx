import { useEffect, useMemo, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { createPublishedRosterServer, type Published } from './published'
import styles from './teacher-roster.css?inline'
type Props = { connection: SupabaseConnection; member: Membership; date: string }
export function PublishedRoster(props: Props) { return <PublishedScope key={recoveryScope(props.member)} {...props} /> }
function PublishedScope({ connection, member, date: initial }: Props) {
  const server = useMemo(() => createPublishedRosterServer(connection), [connection])
  const [date, setDate] = useState(initial), [loaded, setData] = useState<{ date: string; value: Published }>(), [error, setError] = useState(''), [loading, setLoading] = useState(false), [reload, setReload] = useState(0)
  const data = loaded?.date === date ? loaded.value : undefined
  const [mode, setMode] = useState<'class' | 'teacher' | 'mine'>('class'), [selected, setSelected] = useState('')
  useEffect(() => { let live = true; setLoading(true); setData(undefined); setError(''); server.get(member.id, date).then(v => { if (live) setData({ date, value: v }) }).catch(() => { if (live) setError('기본 주간표를 불러오지 못했습니다. 기존 날짜별 시간표는 시간표 보기에서 확인할 수 있습니다.') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [server, member.id, date, reload])
  const options = [...new Map((data?.plans ?? []).flatMap<{ id: string; name: string }>(p => mode === 'class' ? p.classes : p.teachers).map(x => [x.id, x])).values()]
  const id = options.some(x => x.id === selected) ? selected : options[0]?.id
  const rows = (data?.plans ?? []).flatMap(p => p.lessons.map(l => ({ plan: p, lesson: l, course: p.courses.find(c => c.id === l.courseId)!, slot: p.slots.find(s => s.id === l.slotId)! }))).filter(r => mode === 'class' ? r.course.classId === id : mode === 'teacher' ? r.course.teacherId === id : data?.myTeacherIds.includes(r.course.teacherId))
  const clock = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
  return <section className="panel teacher-roster" aria-label="확정 기본 주간표"><style>{styles}</style><h2>기본 주간표</h2><p>선택한 날짜에 적용되는 기본 배치입니다. 휴업·교환 등 날짜별 변경은 시간표 보기에서 확인하세요.</p><label>적용 기준일<input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label><button onClick={() => setReload(v => v + 1)} disabled={loading}>다시 확인</button>{loading && <p role="status">기본 시간표를 불러오는 중…</p>}{error && <p role="alert">{error}</p>}
    {data && <><div className="button-row">{([['class', '학급별'], ['teacher', '교사별'], ['mine', '내 기본 시간표']] as const).map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => { setMode(key); setSelected('') }}>{label}</button>)}</div>{mode !== 'mine' && <label>{mode === 'class' ? '학급' : '교사'}<select value={id ?? ''} onChange={e => setSelected(e.target.value)}>{options.map(x => <option key={x.id} value={x.id}>{x.name} · {x.id.slice(0, 8)}</option>)}</select></label>}
      {!data.available ? <p>기본 시간표 연결을 준비 중입니다.</p> : !data.plans.length ? <p>이 날짜에 적용되는 확정 기본표가 없습니다.</p> : mode === 'mine' && !data.myTeacherIds.length ? <p>내 계정에 연결된 명부 교사가 없습니다. 관리자에게 담당 연결을 요청하세요.</p> : <><p>{rows.length}교시 · {data.timeZone}</p><div className="teacher-roster-week">{[1, 2, 3, 4, 5, 6, 7].filter(day => rows.some(r => r.slot.day === day)).map(day => <section key={day}><h3>{['월', '화', '수', '목', '금', '토', '일'][day - 1]}</h3>{rows.filter(r => r.slot.day === day).sort((a, b) => a.slot.start - b.slot.start).map(r => <article key={`${r.plan.id}:${r.lesson.id}`}><strong>{r.slot.period}교시 · {r.course.subject}</strong><p>{r.plan.classes.find(c => c.id === r.course.classId)?.name} · {r.plan.teachers.find(t => t.id === r.course.teacherId)?.name}</p><small>{clock(r.slot.start)}–{clock(r.slot.end)}</small></article>)}</section>)}</div></>}</>}
  </section>
}
