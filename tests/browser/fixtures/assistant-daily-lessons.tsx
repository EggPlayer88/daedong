import rosterFixture from '../../fixtures/teacher-roster/nine-classes.json'
import { createRoot } from 'react-dom/client'
import { AssistantDailyWorkspace } from '../../../apps/workhub/src/assistant/AssistantDailyWorkspace'
import type { Membership, CalendarEvent } from '../../../apps/workhub/src/contracts'
import type { PersonalTask, TaskAdapter } from '../../../apps/workhub/src/tasks/contracts'
import type { CalendarAdapter } from '../../../apps/workhub/src/calendar/contracts'
import type { SupabaseConnection } from '../../../apps/workhub/src/connection/supabase-connection'
import theme from '../../../apps/workhub/src/style.css?inline'
import home from '../../../apps/workhub/src/calendar/home-dashboard.css?inline'
import neis from '../../../apps/workhub/src/neis/neis.css?inline'

// 실제 표시 컴포넌트와 응답 검증기를 사용하고, 자료·어댑터만 합성한다.
const win = window as any
const member = (id = 'member', role: Membership['role'] = 'teacher'): Membership => ({
  id, schoolId: 'school', userId: id + '-user', name: id === 'member' ? '가상 교사' : '다른 가상 교사', role,
  active: true, validFrom: '2026-01-01', validThrough: '2026-12-31', departmentIds: [], gradeIds: [], subjectIds: [],
})
const qa = win.qa = {
  member: member(), members: [] as Membership[], date: '2026-11-16', mealDate: undefined as string | undefined,
  view: 'overview' as 'overview' | 'meals', revision: 0, locked: false, failed: [] as string[], defer: [] as string[],
  lessonEmpty: false, lessonNotReady: false, rosterUnlinked: false, lessonBadScope: false, lessonLong: false, empty: false, unconfigured: false, homeUnavailable: false, invalid: '', long: false, label: '원본',
  calls: [] as any[], opened: [] as any[], waits: [] as Array<{ source: string; resolve: () => void }>,
}
Object.assign(qa, win.dailyInitial ?? {})
qa.members = [qa.member, member('other')]
async function after<T>(source: string, value: T): Promise<T> {
  const failed = qa.failed.includes(source)
  if (qa.defer.includes(source)) await new Promise<void>(resolve => qa.waits.push({ source, resolve }))
  if (failed) throw new Error('합성 자료 조회 실패')
  return value
}
function tasks(): PersonalTask[] {
  if (qa.empty) return []
  return Array.from({ length: 7 }, (_, i) => ({ id: 'task-' + i, schoolId: 'school', ownerMemberId: qa.invalid === 'task' ? 'other' : qa.member.id,
    title: qa.long ? '긴할일'.repeat(28) + i : qa.label + ' 할 일 ' + i, notes: '서버 원본 메모', dueDate: i < 3 ? qa.date : '',
    status: i === 5 ? 'done' : i === 6 ? 'cancelled' : 'todo', version: i + 2,
  }))
}
function events(): CalendarEvent[] {
  if (qa.empty) return []
  const base: CalendarEvent = { id: 'event-0', schoolId: qa.invalid === 'calendar' ? 'foreign' : 'school', authorMemberId: qa.member.id,
    version: 4, updatedAt: '2026-10-20T00:00:00Z', title: qa.long ? '긴일정'.repeat(30) : qa.label + ' 일정', description: '', location: '회의실',
    startDate: '2026-10-19', endDate: qa.date, allDay: false, startTime: '09:00', endTime: '15:00', visibility: 'school',
    audience: { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] },
  }
  return [base,
    { ...base, id: 'event-unrelated', authorMemberId: 'other', title: '관련 없는 공개 일정', audience: { ...base.audience, all: false, includeMemberIds: ['other'] } },
    { ...base, id: 'event-next', title: qa.label + ' 다음 일정', startDate: '2026-10-22', endDate: '2026-10-22', version: 9 },
  ]
}
const connection = {
  info: () => ({ memberships: qa.members, schools: [{ id: 'school' }], basisDate: qa.date }),
  getIdentity: async () => ({ userId: qa.member.userId, approved: true, profile: { role: 'superadmin', is_active: true, extra_permissions: [], department_id: null } }),
  rpcVerified: async (name: string, args: Record<string, any>) => {
    qa.calls.push({ source: 'rpc', name, args })
    const who = { ...qa.member }, date = qa.date, label = qa.label
    if (name === 'workhub_timetable_operations_readiness') return after('readiness', { contract:'timetable-operations.v1',schoolId:who.schoolId,memberId:who.id,data:qa.lessonNotReady ? {available:false,reason:'not_installed'} : {available:true} })
    if (name === 'workhub_timetable_operations_get') {
      const rows = qa.lessonEmpty ? [] : [
        {id:'lesson-exchanged',label:label + ' 국어 교환 반영',state:'scheduled',hour:'00',minute:'40',teacher:who.id},
        {id:'lesson-cancelled',label:label + ' 휴업 수업',state:'cancelled',hour:'01',minute:'40',teacher:who.id},
        {id:'lesson-performed',label:label + ' 실시 완료 수업',state:'performed',hour:'02',minute:'40',teacher:who.id},
        {id:'lesson-other',label:'다른 교사의 수업 원문',state:'scheduled',hour:'03',minute:'40',teacher:'other'},
      ].map(row=>({id:row.id,version:3,label:qa.lessonLong ? row.label+'아주긴수업이름'.repeat(15) : row.label,time:{startsAt:args.p_from+'T'+row.hour+':'+row.minute+':00.000Z',endsAt:args.p_from+'T'+String(Number(row.hour)+1).padStart(2,'0')+':25:00.000Z'},teachers:[{id:row.teacher,name:who.name}],groupNames:[qa.lessonLong ? '아주긴학급이름'.repeat(10) : '1학년 1반'],roomNames:['본관'],state:row.state,canRequest:false,allowedTargets:[]}))
      return after('lessons',{contract:'timetable-operations.v1',schoolId:qa.lessonBadScope?'foreign':who.schoolId,memberId:who.id,data:{asOf:new Date().toISOString(),timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:false,canRequest:false,drafts:[],requests:[],publications:[],lessons:rows}})
    }
    if (name === 'workhub_teacher_roster_published') {
      const plan=structuredClone(rosterFixture.plan), inRange=plan.from<=args.p_date && args.p_date<plan.until
      return after('roster',{contract:'teacher-roster.v1',schoolId:who.schoolId,memberId:who.id,data:{date:args.p_date,timeZone:'Asia/Seoul',available:true,plans:inRange?[plan]:[],myTeacherIds:inRange&&!qa.rosterUnlinked?[plan.teachers[0].id]:[]}})
    }
    if (name === 'workhub_home_overview') return after('home', { contract: 'home.v1', schoolId: who.schoolId, memberId: who.id,
      data: { asOf: date + 'T00:00:00Z', items: qa.empty || qa.homeUnavailable ? [] : [{ id: 'home-1', kind: 'message', title: qa.long ? '긴메시지'.repeat(25) : label + ' 메시지', dueDate: null, sourceId: 'thread-7', priority: 'urgent', label: '메시지 열기' }],
        counts: { collection: 0, supplement: 0, message: qa.homeUnavailable ? null : qa.empty ? 0 : 7, student_followup: 0, cooperation: 0 }, unavailable: qa.homeUnavailable ? ['message'] : [] },
    })
    if (name !== 'workhub_neis_status') throw Error('허용하지 않은 RPC: ' + name)
    const rows = [date, '2026-10-21', '2026-10-22', '2027-01-01'].filter((value, i, all) => all.indexOf(value) === i && value >= args.p_from && value <= args.p_to)
      .map((value, i) => ({ identity: String(i + 1).repeat(64), contentHash: 'a'.repeat(64), loadedOn: date, date: value, mealCode: '2', mealName: '중식',
        menu: label + ' ' + value + ' 쌀밥\n미역국', calories: '650 Kcal', origins: '쌀 국내산', nutrition: '합성 영양 정보' }))
    return after('meals', { contract: 'neis.v1', schoolId: who.schoolId, memberId: who.id, today: date,
      kind: args.p_kind, year: args.p_year, from: args.p_from, to: args.p_to, configured: !qa.unconfigured, canManage: false,
      source: qa.unconfigured ? null : { officeCode: 'K10', schoolCode: '7892043', schoolName: '가상학교' }, version: 1,
      fetchedAt: new Date().toISOString(), errorCode: null, rows: qa.empty || qa.unconfigured ? [] : rows,
    })
  },
} as unknown as SupabaseConnection
const readonly = () => { throw Error('읽기 화면이 쓰기를 호출했습니다.') }
const taskAdapter = { list: async (id: string) => { qa.calls.push({ source: 'tasks', id }); return after('tasks', tasks()) }, get: readonly, create: readonly, update: readonly, setStatus: readonly } as unknown as TaskAdapter
const calendarAdapter = { list: async (id: string) => { qa.calls.push({ source: 'calendar', id }); return after('calendar', events()) }, get: readonly, save: readonly } as unknown as CalendarAdapter
const root = createRoot(document.getElementById('root')!)
qa.render = () => root.render(<><style>{theme}{home}{neis}{'body{margin:0}.ws-shell{padding:16px}.assistant-daily{max-width:1120px;margin:auto}'}</style><main className="ws-shell"><AssistantDailyWorkspace
  connection={connection} member={qa.member} members={qa.members} date={qa.date} revision={qa.revision} calendarAdapter={calendarAdapter} taskAdapter={taskAdapter}
  view={qa.view} mealDate={qa.mealDate} locked={qa.locked} onOpenLesson={(lessonId,date)=>qa.opened.push({source:'lesson',lessonId,date})}
  onOpen={item => qa.opened.push({ source: 'home', item })} onOpenList={kind => qa.opened.push({ source: 'home-list', kind })}
  onOpenCalendar={item => qa.opened.push({ source: 'calendar', item })} onOpenTask={item => qa.opened.push({ source: 'task', item })}
  onOpenCalendarList={() => qa.opened.push({ source: 'calendar-list' })} onOpenTaskList={() => qa.opened.push({ source: 'task-list' })}
/></main></>)
qa.update = (values: any) => { Object.assign(qa, values); qa.revision++; qa.render() }
qa.switchMember = () => { qa.member = member('second'); qa.members = [qa.member, member('other')]; qa.revision++; qa.render() }
qa.resolve = async () => { const pending = qa.waits.splice(0); pending.forEach(item => item.resolve()); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) }
qa.render()
