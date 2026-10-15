// PR #45 앱(apps/workhub)의 실제 수합 어댑터·검증 함수에 R1S 의 "실제 출력"을 넣어 본다.
// run_r1s.py 가 시험 중 받은 응답(기본 확인 준비 상태 · 확인 API 응답 · 내려받기 허가)을 R1S_CAPTURE 에 남기고,
// 이 도구가 그것을 앱 코드에 그대로 넣는다. 앱 코드는 고치지 않고 가져다 쓰기만 한다.
// run_all.sh 가 esbuild 로 묶는다: --alias:r1sapp=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createSupabaseCollectionServer } from 'r1sapp/collections/supabase-collections'
import { collectionAccess, collectionEnvelope, collectionFiles } from 'r1sapp/collections/validation'

type Capture = { kind: string; raw: any; memberId: string; schoolId?: string; userId?: string; fileId?: string; expected?: any }
const file = process.env.R1S_CAPTURE
if (!file) { console.log('FAIL R1S_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures: Capture[] = []
for (const f of file.split(',')) captures.push(...(JSON.parse(readFileSync(f, 'utf8')) as { captures: Capture[] }).captures)
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 400))) }
const sorted = (v: unknown) => JSON.stringify(v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort()) : v)
const code = (e: unknown) => (e as { code?: string })?.code

// 앱의 연결(로그인·학교 소속)을 시험 값으로 대신한다. rpc 는 기록한 실제 응답을 그대로 돌려준다.
function server(c: Capture, rpc: (name: string) => unknown, basic?: () => unknown) {
  const connection: any = {
    info: () => ({ basisDate: '2026-10-16', schools: [{ id: c.schoolId }],
                   memberships: [{ id: c.memberId, schoolId: c.schoolId, userId: c.userId, active: true, validFrom: '2000-01-01', validThrough: '2999-12-31' }] }),
    getIdentity: async () => ({ userId: c.userId, approved: true }),
    rpcVerified: async (name: string) => rpc(name),
  }
  return createSupabaseCollectionServer(connection, { timeoutMs: 5000, basicCheck: { check: async () => basic?.() } })
}

const tally: Record<string, { ok: number; codes: Record<string, number>; bad: number }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, codes: {}, bad: 0 })
for (const c of captures) {
  if (c.kind === 'readiness') {
    const t = note('readiness')
    try {
      const r = await server(c, () => c.raw).readiness(c.memberId)
      const want = c.raw.data
      if (r.available !== want.available || r.reason !== want.reason) throw new Error('값이 바뀜')
      if (r.available && (r.policy?.extensions.join() !== 'hwpx' || r.policy.maxFileBytes !== want.policy.maxFileBytes)) throw new Error('정책이 바뀜')
      t.ok++
    } catch (e) { t.bad++; console.log(`  준비 상태 불일치(${code(e) ?? e}): ${JSON.stringify(c.raw).slice(0, 300)}`) }
  } else if (c.kind === 'api_status') {
    // 업로드 확인(complete)이 pending_verification 이면 앱은 같은 요청 번호로 확인 API 를 부르고, 그 응답을 다시 검증한다.
    const t = note('api_status')
    const pending = { contractVersion: 1, schoolId: c.schoolId, memberId: c.memberId, data: { fileId: c.fileId, state: 'pending_verification', file: null } }
    try {
      const st = await server(c, () => pending, () => c.raw).completeUpload(c.memberId, c.fileId!, 'k-' + 'a'.repeat(20))
      if (st.state !== c.raw.data.state || sorted(st.file) !== sorted(c.raw.data.file)) throw new Error('값이 바뀜')
      t.ok++; t.codes[st.state] = (t.codes[st.state] ?? 0) + 1
    } catch (e) { t.bad++; console.log(`  확인 응답 불일치(${code(e) ?? e}): ${JSON.stringify(c.raw).slice(0, 300)}`) }
  } else if (c.kind === 'access') {
    const t = note('access')
    try {
      const scope = { schoolId: c.schoolId!, memberId: c.memberId, userId: c.userId! }
      collectionAccess(collectionEnvelope(c.raw, scope), scope, collectionFiles([c.expected])[0]); t.ok++
    } catch (e) { t.bad++; console.log(`  내려받기 허가 불일치(${code(e) ?? e}): ${JSON.stringify(c.raw).slice(0, 300)}`) }
  }
}
for (const [k, t] of Object.entries(tally).sort()) {
  const codes = Object.entries(t.codes).map(([x, n]) => `${x}×${n}`).join(' ')
  check(`AC-${k} 앱 어댑터·검증 함수 통과 ${t.ok}건${codes ? ` (${codes})` : ''}`, t.bad === 0 && t.ok > 0, t)
}
for (const k of ['readiness', 'api_status', 'access']) if (!tally[k]) check(`AC-${k} 응답 기록이 있음`, false, '이 종류의 응답을 하나도 받지 못함')
const readyCount = captures.filter(c => c.kind === 'readiness' && c.raw?.data?.available).length
check('AC-r1 준비 상태 "사용 가능"과 "준비 안 됨" 응답이 모두 기록됨', readyCount > 0 && readyCount < captures.filter(c => c.kind === 'readiness').length)

// 앱이 실제로 걸러 내는지: HWPX 외 형식이 섞인 준비 상태 · 다른 학교 봉투
const sample = captures.find(c => c.kind === 'readiness' && c.raw?.data?.available)
if (sample) {
  const bad = { ...sample.raw, data: { ...sample.raw.data, policy: { ...sample.raw.data.policy, extensions: ['pdf', 'hwpx'] } } }
  let r: string | undefined = 'OK'
  try { await server(sample, () => bad).readiness(sample.memberId) } catch (e) { r = code(e) }
  check('AC-x1 준비 상태 정책에 HWPX 외 형식이 있으면 앱이 거부', r === 'INVALID_RESPONSE' || r === 'QUERY_FAILED', r)
  r = 'OK'
  try { await server(sample, () => ({ ...sample.raw, schoolId: 'school-other' })).readiness(sample.memberId) } catch (e) { r = code(e) }
  check('AC-x2 다른 학교 봉투는 앱이 거부', r === 'INVALID_RESPONSE' || r === 'QUERY_FAILED', r)
} else check('AC-x 사용 가능 준비 상태 표본', false)
console.log(`app_contract_r1s: ${pass}/${pass + fail} 통과`)
