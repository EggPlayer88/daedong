// PR #48 앱(apps/workhub)의 실제 학교 관리 어댑터·parser 에 P1 의 "실제 출력"을 넣어 본다.
// run_p1.py 가 시험 중 받은 응답(준비 상태 · 스냅샷 · 접수증/오류 봉투)을 P1_CAPTURE 에 남기고,
// 이 도구가 그것을 앱 코드에 그대로 넣는다. 앱 코드는 고치지 않고 가져다 쓰기만 한다.
// run_all.sh 가 esbuild 로 묶는다: --alias:p1app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createSupabaseSchoolAdminServer } from 'p1app/setup/school-admin-server'
import { schoolAdminCommand } from 'p1app/setup/school-admin-contract'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: 'readiness' | 'snapshot' | 'receipt'; scope: Scope; raw: any; year?: number | null; command?: any; key?: string }
const file = process.env.P1_CAPTURE
if (!file) { console.log('FAIL P1_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}

// 앱의 연결(로그인·학교 소속)을 시험 값으로 대신한다. rpc 는 기록한 실제 응답을 그대로 돌려주고, 앱이 보낸 인자를 남긴다.
function server(c: Capture, raw: unknown, sent: { name?: string; args?: any } = {}) {
  const connection: any = {
    info: () => ({ basisDate: '2026-10-16', schools: [{ id: c.scope.schoolId }],
                   memberships: [{ id: c.scope.memberId, schoolId: c.scope.schoolId, userId: c.scope.userId, active: true, validFrom: '2000-01-01', validThrough: '2999-12-31' }] }),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true }),
    rpcVerified: async (name: string, args: any) => { sent.name = name; sent.args = args; return raw },
  }
  return createSupabaseSchoolAdminServer(connection, { timeoutMs: 5000 })
}

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
const count = (t: { codes: Record<string, number> }, k: string) => { t.codes[k] = (t.codes[k] ?? 0) + 1 }
let localBlocked = 0, localBlockedBad = 0

for (const c of captures) {
  const want = c.raw?.error?.code as string | undefined
  if (c.kind === 'readiness') {
    const t = note('readiness')
    try {
      const r = await server(c, c.raw).readiness(c.scope.memberId)
      if (want || canonical(r) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
      t.ok++; count(t, r.available ? 'available' : r.reason)
    } catch (e) { if (want && code(e) === want) { t.ok++; count(t, want) } else { t.bad++; console.log(`  준비 상태 불일치(${code(e)}): ${JSON.stringify(c.raw).slice(0, 300)}`) } }
  } else if (c.kind === 'snapshot') {
    const t = note('snapshot')
    const year = c.year ?? undefined
    // 앱이 받지 않는 학년도(범위 밖)는 앱이 보내기 전에 막는다. 서버도 INVALID_INPUT 이어야 한다.
    try {
      const sent: { name?: string; args?: any } = {}
      const s = await server(c, c.raw, sent).get(c.scope.memberId, year)
      if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
      if (sent.name !== 'workhub_school_admin_get' || canonical(sent.args) !== canonical({ p_member_id: c.scope.memberId, p_school_year: year ?? null })) throw new Error('보낸 인자 다름')
      if (s.version !== c.raw.data.version || s.memberships.length !== c.raw.data.memberships.length || s.assignments.length !== c.raw.data.assignments.length) throw new Error('값이 바뀜')
      t.ok++; count(t, 'data')
    } catch (e) {
      if (want && code(e) === want) { t.ok++; count(t, want) }
      else if (want === 'INVALID_INPUT' && code(e) === 'INVALID_INPUT') { t.ok++ }
      else { t.bad++; console.log(`  스냅샷 불일치(${code(e)}): ${JSON.stringify(c.raw).slice(0, 300)}`) }
    }
  } else {
    const t = note('receipt')
    // 앱 parser 가 보내기 전에 거르는 명령: 서버도 같은 명령을 거부했어야 한다(앱보다 느슨하면 안 됨은 아니지만, 앱이 통과시킨 걸 서버가 받으면 안 되는 쪽은 아래에서 본다).
    let checked: unknown
    try { checked = schoolAdminCommand(c.command) } catch {
      localBlocked++
      if (!want) { localBlockedBad++; console.log(`  앱은 막는데 서버는 받은 명령: ${JSON.stringify(c.command).slice(0, 300)}`) }
      continue
    }
    try {
      const sent: { name?: string; args?: any } = {}
      const r = await server(c, c.raw, sent).mutate(c.scope.memberId, c.command, c.key!)
      if (want) throw new Error(`서버는 ${want} 인데 앱은 성공으로 읽음`)
      if (sent.name !== 'workhub_school_admin_mutate' || sent.args?.p_request_key !== c.key || canonical(sent.args?.p_command) !== canonical(checked)) throw new Error('보낸 인자 다름')
      if (r.version !== c.raw.data.version || r.requestKey !== c.key) throw new Error('값이 바뀜')
      t.ok++; count(t, `ok:${c.command.kind}`)
    } catch (e) {
      if (want && code(e) === want) { t.ok++; count(t, want) }
      else { t.bad++; console.log(`  접수증 불일치(${code(e)}): ${JSON.stringify(c.raw).slice(0, 300)} / ${JSON.stringify(c.command).slice(0, 200)}`) }
    }
  }
}
for (const [k, t] of Object.entries(tally).sort()) {
  const codes = Object.entries(t.codes).map(([x, n]) => `${x}×${n}`).join(' ')
  check(`AC-${k} 앱 어댑터·parser 통과 ${t.ok}건${codes ? ` (${codes})` : ''}`, t.bad === 0 && t.ok > 0, t)
}
for (const k of ['readiness', 'snapshot', 'receipt']) if (!tally[k]) check(`AC-${k} 응답 기록이 있음`, false, '이 종류의 응답을 하나도 받지 못함')
check(`AC-local 앱이 보내기 전에 거르는 명령 ${localBlocked}건은 서버도 모두 거부`, localBlockedBad === 0, localBlockedBad)

// 앱이 쓰는 명령 모양 그대로 보냈는지: 성공한 명령은 앱 parser 를 거친 모양과 같아야 한다(시험이 앱이 안 보내는 모양으로 통과하지 않게).
const okCmds = captures.filter(c => c.kind === 'receipt' && c.raw?.data)
const reshaped = okCmds.filter(c => { try { return canonical(schoolAdminCommand(c.command)) !== canonical(c.command) } catch { return true } })
check(`AC-shape 성공한 명령 ${okCmds.length}건이 앱 parser 를 거친 모양과 같음`, okCmds.length > 0 && reshaped.length === 0, reshaped.map(c => c.command.kind))
const kinds = new Set(okCmds.map(c => c.command.kind + (c.command.mode ? ':' + c.command.mode : '') + (c.command.decision ? ':' + c.command.decision : '')))
for (const k of ['save_configuration:update', 'save_configuration:create_year', 'assign_duty', 'end_assignment', 'review_membership:active', 'review_membership:suspended', 'review_membership:ended', 'review_membership:rejected'])
  check(`AC-k ${k} 성공 응답이 기록됨`, kinds.has(k), [...kinds])

// 앱이 실제로 걸러 내는지: 다른 학교 봉투 · 접수증 판이 기대 판 이하
const snap = captures.find(c => c.kind === 'snapshot' && c.raw?.data)
const rec = okCmds[0]
if (snap && rec) {
  let r = 'OK'
  try { await server(snap, { ...snap.raw, schoolId: 'school-other' }).get(snap.scope.memberId, snap.year ?? undefined) } catch (e) { r = code(e) }
  check('AC-x1 다른 학교 봉투는 앱이 거부', r === 'INVALID_RESPONSE' || r === 'QUERY_FAILED', r)
  r = 'OK'
  try { await server(rec, { ...rec.raw, data: { ...rec.raw.data, version: rec.command.expectedVersion } }).mutate(rec.scope.memberId, rec.command, rec.key!) } catch (e) { r = code(e) }
  check('AC-x2 판이 오르지 않은 접수증은 앱이 결과 모름으로 처리', r === 'RESULT_UNKNOWN', r)
} else check('AC-x 표본', false)
console.log(`app_contract_p1: ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
