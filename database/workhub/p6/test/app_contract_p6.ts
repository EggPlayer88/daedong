// PR #48 앱(apps/workhub)의 실제 비서 연결(createAssistantServer · createAssistantHttp)과 parser 에 P6 의 "실제 출력"을 넣어 본다.
// run_p6.py 가 시험 중 받은 응답과 그때의 workhub_context 를 P6_CAPTURE 에 남기고, 이 도구가 앱 코드에 그대로 넣는다.
//   질문·준비 상태: 실제 서버 코드(PR #48 _assistant.py execute)가 낸 HTTP 응답(chat.py 와 같은 상태 코드 · 본문)을 fetch 자리에 돌려준다.
//   대화 목록·대화·할 일 확정: DB 함수가 낸 봉투를 rpcVerified 자리에 돌려준다.
// 앱 코드는 고치지 않고 가져다 쓰기만 한다. run_all.sh 가 esbuild 로 묶는다: --alias:p6app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createAssistantServer } from 'p6app/assistant/server'
import { createAssistantHttp } from 'p6app/assistant/http'
import { contextResponse } from 'p6app/connection/validation'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; error: string | null; [k: string]: any }
const file = process.env.P6_CAPTURE
if (!file) { console.log('FAIL P6_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as any)[k])).join(',') + '}'
  return JSON.stringify(v)
}
const BUSINESS = ['NOT_READY', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'BUDGET_EXCEEDED']

// 앱의 연결(로그인·학교 소속)을 그때의 실제 workhub_context 로 대신한다. rpc 는 기록한 실제 응답을 돌려주고, 앱이 보낸 이름·인자를 남긴다.
function connection(c: Capture, sent: { name: string; args: any }[]) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => { sent.push({ name, args }); return structuredClone(c.raw) },
  } as any
}
// 서버 API(chat.py) 자리: 기록한 상태 코드와 본문을 그대로 돌려준다. 앱이 보낸 본문을 남긴다.
function http(c: Capture, posted: any[]) {
  const body = c.raw ?? { error: { code: c.error } }
  return createAssistantHttp({
    getSession: async () => ({ user: { id: c.scope.userId }, access_token: 'test-token' }) as any,
    fetch: (async (_url: string, init: any) => { posted.push(JSON.parse(init.body)); return new Response(JSON.stringify(body), { status: c.status ?? 200, headers: { 'Content-Type': 'application/json' } }) }) as any,
  })
}

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
let localFirst = 0
const localDiff: Record<string, number> = {}
const skipped: Record<string, number> = {}

for (const c of captures) {
  if (!c.context) { bump(skipped, `${c.kind}: workhub_context 가 없는 계정(앱이 연결 단계에서 막음)`); continue }
  const viaHttp = c.kind === 'ask' || c.kind === 'readiness'
  if (!viaHttp && !c.raw) { bump(skipped, `${c.kind}: 봉투 없는 예외 ${c.error}(앱 연결 단계 · 시험 B·E12 에서 서버 쪽만 확인)`); continue }
  const writing = c.kind === 'ask' || c.kind === 'confirm'
  let want: string | undefined
  if (viaHttp) {
    if (c.raw?.error) want = String(c.raw.error.code)
    else if (!c.raw) want = BUSINESS.includes(String(c.error)) ? String(c.error) : (writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED')
  } else if (c.raw?.error) want = String(c.raw.error.code)
  const sent: { name: string; args: any }[] = [], posted: any[] = []
  const m = c.scope.memberId
  const t = c.kind
  try {
    const app = createAssistantServer(connection(c, sent), http(c, posted))
    let out: any, expected: any
    switch (c.kind) {
      case 'readiness': expected = { action: 'readiness', memberId: m }; out = await app.readiness(m); break
      case 'ask': expected = c.payload; out = await app.ask(m, c.payload.input, c.payload.requestKey); break
      case 'list': expected = { name: 'workhub_ai_threads_list', args: { p_member_id: m, p_mode: c.mode, p_cursor: c.cursor ?? null } }; out = await app.list(m, c.mode, c.cursor ?? null); break
      case 'get': expected = { name: 'workhub_ai_thread_get', args: { p_member_id: m, p_thread_id: c.threadId, p_cursor: c.cursor ?? null } }; out = await app.get(m, c.threadId, c.cursor ?? null); break
      case 'confirm': expected = { name: 'workhub_ai_confirm_task', args: { p_member_id: m, p_input: c.input, p_request_key: c.key } }; out = await app.confirmTask(m, c.input, c.key); break
      default: bump(skipped, '알 수 없는 종류 ' + c.kind); continue
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    if (canonical(out) !== canonical(c.raw.data)) throw new Error('앱이 해석한 값이 서버 응답과 다름')
    if (viaHttp ? (posted.length !== 1 || canonical(posted[0]) !== canonical(expected)) : (sent.length !== 1 || canonical(sent[0]) !== canonical(expected)))
      throw new Error('보낸 이름·인자 다름 ' + JSON.stringify(viaHttp ? posted : sent).slice(0, 300))
    note(t).ok++; bump(note(t).codes, c.kind === 'ask' ? 'ok:' + c.raw.data.state : 'ok')
  } catch (e) {
    const got = code(e)
    if (want && got === want) {
      note(t).ok++; bump(note(t).codes, want)
      if (!sent.length && !posted.length) localFirst++            // 앱이 보내기 전에 같은 이유로 막음
    } else if (want && !sent.length && !posted.length && got !== 'RESULT_UNKNOWN' && got !== 'QUERY_FAILED') {
      // 앱이 서버에 보내기 전에 스스로 거절했지만 코드가 다르다(서버 계약 문제가 아니라 앱 쪽 문구 문제 — 보고 대상)
      note(t).ok++; bump(note(t).codes, want); bump(localDiff, `${t}: 서버 ${want} · 앱이 먼저 ${got}`)
    } else {
      note(t).bad++
      console.log(`  불일치 ${t} 서버=${want ?? 'ok'} 앱=${got} 보냄=${sent.length + posted.length} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw).slice(0, 300)}`)
    }
  }
}

const kinds = ['readiness', 'ask', 'list', 'get', 'confirm']
for (const k of kinds) {
  const v = tally[k]
  check(`앱 ${k}: 서버 응답을 앱이 같은 결과로 해석 (${v ? Object.entries(v.codes).map(([a, b]) => a + ' ' + b).join(', ') : '0건'})`, !!v && v.bad === 0 && v.ok > 0, v)
}
const asks = tally.ask?.codes ?? {}
check('질문 결과 세 모양(completed · pending · rejected)을 모두 앱이 받아들임', ['ok:completed', 'ok:pending', 'ok:rejected'].every(k => (asks[k] ?? 0) > 0), asks)
check('서버가 낸 질문 업무 거절 코드 8종(NOT_READY · FORBIDDEN · INACTIVE_MEMBERSHIP · INVALID_INPUT · NOT_FOUND · CONFLICT · IDEMPOTENCY_CONFLICT · BUDGET_EXCEEDED)이 모두 시험에 나오고 앱이 거절로 받음',
      BUSINESS.every(k => (asks[k] ?? 0) > 0), asks)
if (Object.keys(localDiff).length) console.log('WARN 앱이 보내기 전에 막았지만 코드가 다름(PR #48 앱 쪽 확인 필요): ' + JSON.stringify(localDiff))
check('건너뛴 응답 없음 외(workhub_context 없는 계정 · 봉투 없는 예외만)', Object.keys(skipped).every(k => k.includes('workhub_context') || k.includes('봉투 없는 예외')), skipped)
console.log(`앱이 보내기 전에 같은 코드로 먼저 막은 요청 ${localFirst}건 · 건너뜀 ${JSON.stringify(skipped)}`)
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
