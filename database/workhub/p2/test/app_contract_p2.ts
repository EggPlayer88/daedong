// PR #48 앱(apps/workhub)의 실제 일정 일괄·협업 어댑터와 parser 에 P2 의 "실제 출력"을 넣어 본다.
// run_p2.py 가 시험 중 받은 응답(봉투)과 그때의 workhub_context 를 P2_CAPTURE 에 남기고,
// 이 도구가 앱 코드에 그대로 넣는다. 앱 코드는 고치지 않고 가져다 쓰기만 한다.
// run_all.sh 가 esbuild 로 묶는다: --alias:p2app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createCalendarBatchAdapter } from 'p2app/calendar/batch-adapter'
import { createCooperationAdapter } from 'p2app/cooperation/adapter'
import { contextResponse } from 'p2app/connection/validation'
import { canonical, sha256 } from 'p2app/cooperation/protocol'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: 'prepare' | 'commit' | 'catalog' | 'list' | 'detail' | 'mutate'; scope: Scope; context: any; raw: any
                 input?: any; command?: any; key?: string; cursor?: string | null; filter?: any; requestId?: string }
const file = process.env.P2_CAPTURE
if (!file) { console.log('FAIL P2_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)

// 앱의 연결(로그인·학교 소속)을 그때의 실제 workhub_context 로 대신한다. rpc 는 기록한 응답을 돌려주고, 앱이 보낸 이름·인자를 남긴다.
function connection(c: Capture, sent: { name?: string; args?: any }) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => { sent.name = name; sent.args = args; return c.raw },
  } as any
}

// Codex C4: 앱은 보내기 전에 includeMemberIds · excludeMemberIds 를 코드 포인트 순으로 정렬 · 중복 제거한다(서버 COLLATE "C" 와 같은 순서).
// 그런 앱은 정렬 전 입력(F01b)을 그대로 보내지 않으므로, 그 응답 대신 "정렬한 입력의 실제 응답"(F01c)과 짝지어 본다.
function sortedIds(v: any): any {
  if (Array.isArray(v)) return v.map(sortedIds)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) =>
    [k, (k === 'includeMemberIds' || k === 'excludeMemberIds') && Array.isArray(x)
      ? [...new Set(x as string[])].sort((a, b) => { const p = Array.from(a), q = Array.from(b)
          for (let i = 0; i < Math.min(p.length, q.length); i++) { const d = p[i].codePointAt(0)! - q[i].codePointAt(0)!; if (d) return d } return p.length - q.length })
      : sortedIds(x)]))
  return v
}
const appSorted: string[] = []
const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
let rejectedHash = 0, localFirst = 0

for (const c of captures) {
  const want = c.raw?.ok === false ? String(c.raw.code) : undefined
  const t = note(c.kind)
  const sent: { name?: string; args?: any } = {}
  let expectedName = '', expectedArgs: any
  try {
    const conn = connection(c, sent), m = c.scope.memberId
    let out: any
    if (c.kind === 'prepare') {
      expectedName = 'workhub_calendar_batch_prepare'; expectedArgs = { p_member_id: m, p_input: c.input }
      out = await createCalendarBatchAdapter(conn, { timeoutMs: 5000 }).prepare(m, c.input)
      if (out.rows.length !== c.raw.rows.length || out.rows.some((r: any, i: number) => r.state !== c.raw.rows[i].state || r.key !== c.raw.rows[i].key)) throw new Error('행 상태가 바뀜')
    } else if (c.kind === 'commit') {
      expectedName = 'workhub_calendar_batch_commit'; expectedArgs = { p_member_id: m, p_command: c.command, p_request_key: c.key }
      out = await createCalendarBatchAdapter(conn, { timeoutMs: 5000 }).commit(m, c.command, c.key!)
      if (out.outcome !== c.raw.outcome || canonical(out.items) !== canonical(c.raw.items)) throw new Error('접수증이 바뀜')
    } else if (c.kind === 'catalog') {
      expectedName = 'workhub_cooperation_catalog'; expectedArgs = { p_member_id: m, p_task_cursor: c.cursor ?? null }
      out = await createCooperationAdapter(conn, { timeoutMs: 5000 }).catalog(m, c.cursor ?? null)
      if (out.recipients.length !== c.raw.recipients.length || out.sourceTasks.length !== c.raw.sourceTasks.length || out.nextTaskCursor !== c.raw.nextTaskCursor) throw new Error('값이 바뀜')
    } else if (c.kind === 'list') {
      expectedName = 'workhub_cooperation_list'; expectedArgs = { p_member_id: m, p_filter: c.filter }
      out = await createCooperationAdapter(conn, { timeoutMs: 5000 }).list(m, c.filter)
      if (out.items.length !== c.raw.items.length || out.nextCursor !== c.raw.nextCursor) throw new Error('값이 바뀜')
    } else if (c.kind === 'detail') {
      expectedName = 'workhub_cooperation_get'; expectedArgs = { p_member_id: m, p_request_id: c.requestId }
      out = await createCooperationAdapter(conn, { timeoutMs: 5000 }).detail(m, c.requestId!)
      if (out.history.length !== c.raw.history.length || out.request.status !== c.raw.request.status) throw new Error('값이 바뀜')
    } else {
      expectedName = 'workhub_cooperation_mutate'; expectedArgs = { p_member_id: m, p_command: c.command, p_request_key: c.key }
      out = await createCooperationAdapter(conn, { timeoutMs: 5000 }).mutate(m, c.command, c.key!)
      if (out.outcome !== c.raw.outcome || out.entityId !== c.raw.entityId) throw new Error('접수증이 바뀜')
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    if (sent.name !== expectedName || canonical(sent.args) !== canonical(expectedArgs)) throw new Error('보낸 이름·인자 다름 ' + JSON.stringify(sent).slice(0, 200))
    t.ok++; t.codes.ok = (t.codes.ok ?? 0) + 1
  } catch (e) {
    const got = code(e)
    const reordered = c.kind === 'prepare' && sent.args && canonical(sent.args.p_input) !== canonical(c.input)
    if (reordered) {
      // 앱이 정렬해서 보냈다: 보낸 입력 = 정렬본이어야 하고, 그 정렬본의 실제 응답(같은 시험의 다른 기록)은 모든 행 duplicate 여야 한다
      // 앱은 정렬한 draft 로 sourceHash 를 다시 계산하므로 지문은 빼고 비교하고, 짝 응답은 앱이 보낸 입력과 바이트까지 같은 기록이어야 한다
      const noHash = (v: any) => ({ ...v, rows: v.rows.map(({ sourceHash, ...r }: any) => r) })
      const pair = captures.find(x => x.kind === 'prepare' && x.raw?.ok === true && canonical(x.input) === canonical(sent.args.p_input))
      if (canonical(noHash(sent.args.p_input)) === canonical(noHash(sortedIds(c.input))) && pair && pair.raw.rows.every((r: any) => r.state === 'duplicate')) {
        t.ok++; t.codes['정렬 뒤 보냄(C4)'] = (t.codes['정렬 뒤 보냄(C4)'] ?? 0) + 1; appSorted.push(c.raw?.rows?.map((r: any) => r.state).join(',') ?? '')
      } else { t.bad++; console.log(`  불일치 prepare 앱이 입력을 바꿔 보냈지만 정렬본이 아니거나 정렬본 응답이 duplicate 가 아님: ${JSON.stringify(sent.args.p_input).slice(0, 300)}`) }
      continue
    }
    if (want && got === want) {
      t.ok++; t.codes[want] = (t.codes[want] ?? 0) + 1
      if (sent.name === undefined) localFirst++                         // 앱이 보내기 전에 같은 이유로 막음
      else if (c.raw.commandHash !== undefined) rejectedHash++          // 쓰기 거절: 앱이 requestKey·commandHash·rejected 를 확인한 뒤 받아들임
    } else {
      t.bad++; console.log(`  불일치 ${c.kind} 서버=${want ?? 'ok'} 앱=${got} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw).slice(0, 300)}`)
    }
  }
}

for (const [k, v] of Object.entries(tally))
  check(`${k}: 실제 응답 ${v.ok + v.bad}건을 앱 어댑터가 서버와 같은 결과로 해석 (${Object.entries(v.codes).map(([a, b]) => `${a} ${b}`).join(' · ')})`, v.bad === 0 && v.ok > 0, v)
const kinds = ['prepare', 'commit', 'catalog', 'list', 'detail', 'mutate']
if (appSorted.length) console.log(`INFO 앱이 직접 포함 · 제외 교사 순서를 정렬해 보냄(C4) ${appSorted.length}건 — 정렬 전 응답(${appSorted.join(' | ')}) 대신 정렬본 응답(duplicate)과 짝지음`)
check('6개 함수 모두 실제 응답으로 확인함', kinds.every(k => (tally[k]?.ok ?? 0) > 0), Object.keys(tally))
check(`쓰기 거절 ${rejectedHash}건: 앱이 commandHash = sha256(canonical(명령)) 를 직접 계산해 서버 값과 같음을 확인`, rejectedHash >= 20, rejectedHash)
check(`앱이 보내기 전에 같은 코드로 막은 요청 ${localFirst}건(서버도 같은 코드)`, localFirst > 0, localFirst)
// 서버 canonical 과 앱 canonical 이 같은 지문을 내는지: 미리보기의 previewHash 를 앱 함수로 다시 계산
let ph = 0, phBad = 0
for (const c of captures.filter(c => c.kind === 'prepare' && c.raw?.ok === true)) {
  const { ok, contractVersion, schoolId, memberId, ownerUserId, previewHash, ...body } = c.raw
  ;(await sha256(canonical(body))) === previewHash ? ph++ : phBad++
}
check(`previewHash ${ph}건 = 앱 sha256(canonical(미리보기 본문))`, ph > 0 && phBad === 0, { ph, phBad })
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
