import './reset-fixture-checkpoint'
import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'

// 연결 셸·실제 서비스·응답 파서를 통과한다. 모든 자료와 계정은 합성이며 쓰기는 거절한다.
const w = window as any, clone = structuredClone, date = '2026-10-21', now = '2026-10-21T03:00:00Z'
const teacher = { ...fixtureData.memberships[0], id: 'member-01', userId: 'user-01', schoolId: fixtureData.schools[0].id, name: '가상 교사 01', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31' }
const other = { ...teacher, id: 'member-02', userId: 'user-02', name: '가상 교사 02' }, members = [teacher, other]
const context = { schools: fixtureData.schools, memberships: members, basisDate: date, schoolLabels: Object.fromEntries(fixtureData.schools.map(school => [school.id, relationLabels])) }
const env = (contract: string, data: unknown) => ({ contract, schoolId: teacher.schoolId, memberId: teacher.id, data })
const msg = (data: unknown) => ({ contractVersion: 1, schoolId: teacher.schoolId, memberId: teacher.id, userId: teacher.userId, ok: true, data })
const tasks = [
  { id: 'task-a', schoolId: teacher.schoolId, ownerMemberId: teacher.id, title: '제출 자료 확인', notes: '1학년 원본 업무', dueDate: date, status: 'todo', version: 2 },
  { id: 'task-b', schoolId: teacher.schoolId, ownerMemberId: teacher.id, title: '제출 자료 확인', notes: '2학년 원본 업무', dueDate: '2026-10-23', status: 'doing', version: 4 },
]
const events = [{ id: 'event-a', schoolId: teacher.schoolId, authorMemberId: teacher.id, title: '교과 협의', description: '대화 알림으로 여는 원본 일정', location: '교무실', startDate: date, endDate: date, startTime: '15:00', endTime: '16:00', allDay: false, visibility: 'private', audience: { all: false, groups: [], includeMemberIds: [], excludeMemberIds: [] }, version: 3, updatedAt: now }]
const notices = [
  { id: 'notice-task', title: '2학년 업무 확인', body: '원본 할 일을 확인해 주세요.', source: { module: 'tasks', id: 'task-b' } },
  { id: 'notice-calendar', title: '교과 협의 일정 확인', body: '원본 일정을 확인해 주세요.', source: { module: 'calendar', id: 'event-a' } },
  { id: 'notice-knowledge', title: '자료 안내', body: '별도 자료실에서 확인합니다.', source: { module: 'knowledge', id: 'source-a' } },
].map(item => ({ ...item, schoolId: teacher.schoolId, ownerMemberId: teacher.id, createdAt: now, readAt: null, version: 1 }))
const thread = { id: 'thread-1', schoolId: teacher.schoolId, kind: 'direct', title: '알림 확인 대화',
  participants: members.map(item => ({ memberId: item.id, schoolId: item.schoolId, name: item.name, department: '시험 부서', version: 1 })),
  version: 1, latestSequence: 1, readSequence: 0, unreadCount: 1, updatedAt: now, canSend: true }
let denied = false, authChanged = () => {}
w.dailyConnected = { calls: [] as any[], deny() { denied = true; authChanged() }, tasks, events, notices }
const services: any = {
  getSession: async () => ({ user: { id: teacher.userId } }),
  fetchMyProfile: async () => ({ id: teacher.userId, name: teacher.name, email: 'daily-virtual@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: !denied }),
  onAuthStateChange(cb: any) { authChanged = () => cb({ user: { id: teacher.userId } }); return () => {} }, async signOut() {}, async signInWithGoogle() {},
  async rpc(name: string, args: any) {
    w.dailyConnected.calls.push(clone({ name, args }))
    const ok = (data: any) => ({ data: clone(data), error: null }), failure = (message = 'NOT_READY') => ({ data: null, error: { message } })
    if (name === 'workhub_timetable_operations_readiness') return ok(env('timetable-operations.v1', { available: true }))
    if (name === 'workhub_timetable_operations_get') {
      const lessons = [
        { id: 'lesson-first', version: 1, label: '오늘 첫 수업', time: { startsAt: date + 'T00:00:00.000Z', endsAt: date + 'T00:30:00.000Z' }, teachers: [{ id: teacher.id, name: teacher.name }], groupNames: ['1학년 1반'], roomNames: ['본관'], state: 'scheduled', canRequest: false, allowedTargets: [] },
        { id: 'lesson-exchanged', version: 3, label: '정확한 교환 반영 수업', time: { startsAt: date + 'T00:40:00.000Z', endsAt: date + 'T01:25:00.000Z' }, teachers: [{ id: teacher.id, name: teacher.name }], groupNames: ['2학년 1반'], roomNames: ['특별실'], state: 'scheduled', canRequest: false, allowedTargets: [] },
      ].filter(() => args.p_from <= date && args.p_until > date)
      return ok(env('timetable-operations.v1', { asOf: new Date().toISOString(), timeZone: 'Asia/Seoul', from: args.p_from, until: args.p_until, canPublish: false, canRequest: false, drafts: [], lessons, requests: [], publications: [] }))
    }
    if (name === 'workhub_teacher_roster_published') return ok(env('teacher-roster.v1', { date: args.p_date, timeZone: 'Asia/Seoul', available: false, plans: [], myTeacherIds: [] }))
    if (name === 'workhub_context') return ok(context)
    if (name === 'workhub_task_list') return ok(tasks)
    if (name === 'workhub_task_get') return tasks.some(item => item.id === args.p_task_id) ? ok(tasks.find(item => item.id === args.p_task_id)) : failure('NOT_FOUND')
    if (name === 'workhub_calendar_list') return ok(events)
    if (name === 'workhub_calendar_get') return events.some(item => item.id === args.p_event_id) ? ok(events.find(item => item.id === args.p_event_id)) : failure('NOT_FOUND')
    if (name === 'workhub_home_overview') return ok(env('home.v1', { asOf: now, items: [], counts: { collection: 0, supplement: 0, message: 1, student_followup: 0, cooperation: 0 }, unavailable: [] }))
    if (name === 'workhub_neis_status') {
      const rows = [date, '2026-10-22'].map((day, i) => ({ identity: String(i + 1).repeat(64), contentHash: 'b'.repeat(64), loadedOn: date, date: day, mealCode: '2', mealName: '중식', menu: day + ' 쌀밥\n미역국', calories: '650 Kcal', origins: '쌀 국내산', nutrition: '합성 영양 정보' }))
      return ok({ contract: 'neis.v1', schoolId: teacher.schoolId, memberId: teacher.id, today: date, kind: args.p_kind, year: args.p_year, from: args.p_from, to: args.p_to, configured: true, canManage: false, source: { officeCode: 'K10', schoolCode: '7892043', schoolName: '가상학교' }, version: 1, fetchedAt: new Date().toISOString(), errorCode: null, rows })
    }
    if (name === 'workhub_messaging_readiness') return ok(msg({ available: true, reason: 'ready', limits: { bodyCharacters: 5000, titleCharacters: 100, recipients: 100 }, attachments: 'not_configured' }))
    if (name === 'workhub_message_threads') return ok(msg({ items: [thread], nextCursor: null }))
    if (name === 'workhub_message_recipients') return ok(msg({ items: [], nextCursor: null }))
    if (name === 'workhub_inbox_list') return ok(msg({ items: notices, nextCursor: null }))
    return failure()
  },
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={teacher.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)} />)
