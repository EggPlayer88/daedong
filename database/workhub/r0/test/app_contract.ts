// 앱의 실제 응답 검증 함수로 R0 호환 함수의 실제 출력을 검사한다 (임시 DB).
import pg from 'pg'
import { contextResponse, eventResponse } from '/home/claude/daedong/apps/workhub/src/connection/validation'
import { taskListResponse, taskResponse, normalizeTaskInput } from '/home/claude/daedong/apps/workhub/src/tasks/validation'
import { normalizeDraft, canRead } from '/home/claude/daedong/apps/workhub/src/domain'

const U1 = '00000000-0000-0000-0000-000000000001', U9 = '00000000-0000-0000-0000-000000000009'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info))) }
async function as(uid: string) {
  const c = new pg.Client({ host: '/var/tmp/r0pg', port: 55433, database: 'r0', user: 'authenticator' }); await c.connect()
  await c.query('set role authenticated'); await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
  return { rpc: async (fn: string, args: unknown[]) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(',')
    try { return { data: (await c.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r, error: null } }
    catch (e: any) { return { data: null, error: { message: e.message, details: e.detail ?? null } } }
  }, end: () => c.end() }
}
const key = () => crypto.randomUUID()
async function main() {
  for (const uid of [U1, U9]) {
    const api = await as(uid)
    const raw = (await api.rpc('workhub_context', [])).data
    let ctx: any
    try { ctx = contextResponse(raw); check(`A1 contextResponse 통과 (${uid.slice(-2)})`, true) } catch (e: any) { check(`A1 contextResponse 통과 (${uid.slice(-2)})`, false, e.message); continue }
    const me = ctx.memberships.find((m: any) => m.userId === uid)
    const list = (await api.rpc('workhub_calendar_list', [me.id])).data as unknown[]
    let okAll = true; let readOk = true
    for (const row of list) {
      try { const ev = eventResponse(row, me.schoolId, ctx.memberships); if (!canRead(ev, me, raw.basisDate)) readOk = readOk && ev.authorMemberId === me.id }
      catch (e: any) { okAll = false; console.log(e.message, JSON.stringify(row)) }
    }
    check(`A2 일정 목록 ${list.length}건 모두 eventResponse 통과`, okAll && list.length > 0)
    check(`A3 서버가 준 일정은 앱 canRead 로도 읽을 수 있음(작성자 본인 제외)`, readOk)
    // 앱이 정규화한 초안 그대로 저장
    const draft = normalizeDraft({ title: '  앱 경로 저장  ', description: '', location: '3층 회의실', startDate: '2026-10-22', endDate: '2026-10-22', allDay: false,
      startTime: '14:00', endTime: '15:30', visibility: 'school', audience: { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] } }, me, ctx.memberships)
    const saved = await api.rpc('workhub_calendar_save', [me.id, JSON.stringify({ draft, idempotencyKey: key() })])
    let ev: any
    try { ev = eventResponse(saved.data, me.schoolId, ctx.memberships); check('A4 저장 응답 eventResponse 통과, 제목 정리됨', ev.title === '앱 경로 저장' && ev.startTime === '14:00') } catch (e: any) { check('A4 저장 응답 eventResponse 통과', false, [e.message, saved]) }
    // '현재 내용으로 바꾸기' 경로: 이벤트 전체를 draft 로
    const replay = await api.rpc('workhub_calendar_save', [me.id, JSON.stringify({ draft: { ...ev, title: '다시 저장' }, id: ev.id, expectedVersion: ev.version, idempotencyKey: key() })])
    check('A5 이벤트 전체를 draft 로 보내도 저장됨(여분 키 무시)', replay.error === null && replay.data.version === 2, replay)
    const conflict = await api.rpc('workhub_calendar_save', [me.id, JSON.stringify({ draft, id: ev.id, expectedVersion: 1, idempotencyKey: key() })])
    let cur: any = null
    try { cur = eventResponse(JSON.parse(conflict.error!.details!), me.schoolId, ctx.memberships) } catch (e: any) { cur = e.message }
    check('A6 CONFLICT 오류 message=코드, details=현재 원본(eventResponse 통과)', conflict.error?.message === 'CONFLICT' && cur?.version === 2, [conflict, cur])
    // 업무
    const scope = { memberId: me.id, schoolId: me.schoolId }
    const created = await api.rpc('workhub_task_mutate', [me.id, JSON.stringify({ kind: 'create', input: normalizeTaskInput({ title: ' 앱 업무 ', notes: '', dueDate: '2026-11-01' }) }), key()])
    let t: any
    try { t = taskResponse(created.data, scope); check('A7 업무 생성 응답 taskResponse 통과', t.title === '앱 업무') } catch (e: any) { check('A7 taskResponse', false, [e.message, created]) }
    const tl = (await api.rpc('workhub_task_list', [me.id])).data
    try { check(`A8 업무 목록 taskListResponse 통과 (${(tl as unknown[]).length}건)`, taskListResponse(tl, scope).length > 0) } catch (e: any) { check('A8 taskListResponse', false, e.message) }
    const tc = await api.rpc('workhub_task_mutate', [me.id, JSON.stringify({ kind: 'status', taskId: t.id, status: 'doing', expectedVersion: 9 }), key()])
    let tcur: any = null
    try { tcur = taskResponse(JSON.parse(tc.error!.details!), scope, t.id) } catch (e: any) { tcur = e.message }
    check('A9 업무 CONFLICT details 가 taskResponse 통과', tc.error?.message === 'CONFLICT' && tcur?.version === 1, [tc, tcur])
    const tg = (await api.rpc('workhub_task_get', [me.id, t.id])).data
    try { check('A10 업무 단건 taskResponse 통과', taskResponse(tg, scope, t.id).id === t.id) } catch (e: any) { check('A10', false, e.message) }
    await api.end()
  }
  console.log(`== ${pass}/${pass + fail} PASS`); process.exit(fail ? 1 : 0)
}
main()
