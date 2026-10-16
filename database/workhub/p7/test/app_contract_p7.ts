// PR #48 앱(apps/workhub)의 실제 서비스(createCollectionOperations · createHomeService · createTransitionService)와 parser 에
// P7 의 "실제 출력"을 넣어 본다. run_p7.py 가 시험 중 받은 봉투와 그때의 workhub_context 를 P7_CAPTURE 에 남기고,
// 이 도구가 그 봉투를 rpcVerified 자리에 돌려준다. 앱 코드는 고치지 않고 가져다 쓰기만 한다.
// run_all.sh 가 esbuild 로 묶는다: --alias:p7app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createCollectionOperations } from 'p7app/collections/operations'
import { createHomeService } from 'p7app/home/overview'
import { createTransitionService } from 'p7app/administration/transitions'
import { contextResponse } from 'p7app/connection/validation'
import { createCooperationAdapter, detailResponse as appDetailResponse } from 'p7app/cooperation/adapter'
import { writeFileSync } from 'node:fs'
import { proposedDetailResponse, historyLine } from './cooperation_history_contract'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; error: string | null; [k: string]: any }
const file = process.env.P7_CAPTURE
if (!file) { console.log('FAIL P7_CAPTURE 경로가 없습니다'); process.exit(1) }
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

// 앱의 연결(로그인·학교 소속)을 그때의 실제 workhub_context 로 대신한다. rpc 는 기록한 실제 봉투를 돌려주고, 앱이 보낸 이름·인자를 남긴다.
function connection(c: Capture, sent: { name: string; args: any }[]) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    // 봉투 없는 예외(강제 실패 등)는 Supabase 처럼 오류로 던진다
    rpcVerified: async (name: string, args: any) => { sent.push({ name, args }); if (!c.raw) throw new Error(String(c.error)); return structuredClone(c.raw) },
  } as any
}

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
let localFirst = 0
const localDiff: Record<string, number> = {}
const skipped: Record<string, number> = {}
const states: Record<string, number> = {}

for (const c of captures) {
  if (c.kind === 'coop_get') continue                    // 협업 상세는 아래에서 따로(인계 이력 계약)
  if (!c.context) { bump(skipped, `${c.kind}: workhub_context 가 없는 계정(앱이 연결 단계에서 막음)`); continue }
  const writing = c.kind === 'ops_mutate' || c.kind === 'tr_mutate'
  // 봉투 없는 예외 중 업무 코드(권한 · 소속)는 앱 연결 단계 몫이라 건너뛰고, 그 밖(중간 실패)은 앱이 '결과 모름'으로 받는지 본다
  if (!c.raw && /^[A-Z_]+$/.test(String(c.error)) && !String(c.error).startsWith('P7_TEST')) { bump(skipped, `${c.kind}: 봉투 없는 예외 ${c.error}(앱 연결 단계 · 서버 쪽만 확인)`); continue }
  const want: string | undefined = !c.raw ? (writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED') : c.raw.error ? String(c.raw.error.code) : undefined
  const sent: { name: string; args: any }[] = []
  const m = c.scope.memberId
  const t = c.kind
  try {
    const conn = connection(c, sent)
    let out: any, expected: any, same: any
    switch (t) {
      case 'ops_get':
        expected = { name: 'workhub_collection_operations_get', args: { p_request_id: c.requestId, p_member_id: m } }
        out = await createCollectionOperations(conn).get(m, c.requestId); same = c.raw.data; break
      case 'ops_mutate':
        expected = { name: 'workhub_collection_operations_mutate', args: { p_command: c.command, p_request_key: c.key, p_member_id: m } }
        out = await createCollectionOperations(conn).mutate(m, c.command, c.key); same = c.raw.data; break
      case 'home':
        expected = { name: 'workhub_home_overview', args: { p_member_id: m } }
        out = await createHomeService(conn).load(m); same = c.raw.data; break
      case 'tr_list':
        expected = { name: 'workhub_school_transition_list', args: { p_cursor: c.cursor ?? null, p_member_id: m } }
        out = await createTransitionService(conn).list(m, c.cursor ?? null); same = c.raw.data; break
      case 'tr_preview':
        expected = { name: 'workhub_school_transition_preview', args: { p_plan: c.plan, p_member_id: m } }
        out = await createTransitionService(conn).preview(m, c.plan); same = c.raw.data; break
      case 'tr_mutate':
        expected = { name: 'workhub_school_transition_mutate', args: { p_command: c.command, p_request_key: c.key, p_member_id: m } }
        out = await createTransitionService(conn).mutate(m, c.command, c.key)
        // 앱은 응답 중 요청 번호 · 기록 ID · 상태만 돌려준다(판 · 시각은 검사만 한다)
        same = c.raw.data && { requestKey: c.raw.data.requestKey, recordId: c.raw.data.recordId, state: c.raw.data.state }; break
      default: bump(skipped, '알 수 없는 종류 ' + t); continue
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    if (canonical(out) !== canonical(same)) throw new Error('앱이 해석한 값이 서버 응답과 다름 ' + JSON.stringify(out).slice(0, 200))
    if (sent.length !== 1 || canonical(sent[0]) !== canonical(expected)) throw new Error('보낸 이름·인자 다름 ' + JSON.stringify(sent).slice(0, 300))
    note(t).ok++; bump(note(t).codes, 'ok')
    if (t === 'tr_mutate') bump(states, out.state)
    if (t === 'ops_get') bump(states, 'phase:' + out.phase)
  } catch (e) {
    const got = code(e)
    if (want && got === want) {
      note(t).ok++; bump(note(t).codes, want)
      if (!sent.length) localFirst++                     // 앱이 보내기 전에 같은 이유로 막음
    } else if (want && !sent.length && got !== 'RESULT_UNKNOWN' && got !== 'QUERY_FAILED') {
      // 앱이 서버에 보내기 전에 스스로 거절했지만 코드가 다르다(서버 계약 문제가 아니라 앱 쪽 문구 문제 — 보고 대상)
      note(t).ok++; bump(note(t).codes, want); bump(localDiff, `${t}: 서버 ${want} · 앱이 먼저 ${got}`)
    } else {
      note(t).bad++
      console.log(`  불일치 ${t} 서버=${want ?? 'ok'} 앱=${got} 보냄=${sent.length} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw).slice(0, 400)}`)
    }
  }
}

for (const k of ['ops_get', 'ops_mutate', 'home', 'tr_list', 'tr_preview', 'tr_mutate']) {
  const v = tally[k]
  check(`앱 ${k}: 서버 응답을 앱이 같은 결과로 해석 (${v ? Object.entries(v.codes).map(([a, b]) => a + ' ' + b).join(', ') : '0건'})`, !!v && v.bad === 0 && (v.codes.ok ?? 0) > 0, v)
}
// ---- 협업 인계 뒤 상세 이력: 지금 앱 parser(PR #48) · 제안 계약 기준 구현(cooperation_history_contract.ts)
const coop = captures.filter(c => c.kind === 'coop_get' && c.context)
const known: string[] = []
let coopOk = 0, coopBad = 0, refOk = 0, refBad = 0, notFound = 0, appHandedOk = 0
for (const c of coop) {
  const m = c.scope.memberId, scope = { schoolId: c.scope.schoolId, memberId: m, ownerUserId: c.scope.userId }
  const handed = !!c.raw?.history?.some((h: any) => h.action === 'handover')
  let current: any, currentErr: unknown
  try { current = await createCooperationAdapter(connection(c, [])).detail(m, c.requestId) } catch (e) { currentErr = e }
  if (c.raw?.ok === false) { (code(currentErr) === c.raw.code ? notFound++ : coopBad++); continue }
  if (handed) {
    if (currentErr) known.push(`${m}: 인계 이력 ${c.raw.history.length}행 → 지금 앱 ${code(currentErr)}`)
    else if (canonical(current) !== canonical({ request: c.raw.request, history: c.raw.history })) { coopBad++; console.log('  불일치(인계 있음): 앱이 받았지만 값이 다름', m) }
    else appHandedOk++
  } else if (currentErr || canonical(current) !== canonical({ request: c.raw.request, history: c.raw.history })) { coopBad++; console.log('  불일치(인계 없음)', code(currentErr)) }
  else coopOk++
  try { const out = proposedDetailResponse(structuredClone(c.raw), scope, c.requestId); canonical(out) === canonical({ request: c.raw.request, history: c.raw.history }) ? refOk++ : refBad++ }
  catch (e) { refBad++; console.log('  제안 계약 거부', m, code(e), JSON.stringify(c.raw.history).slice(0, 300)) }
}
const handedCaps = coop.filter(c => c.raw?.ok && c.raw.history.some((h: any) => h.action === 'handover'))
if (process.env.P7_BRIDGE === '0') check('협업 상세: 보강(P7-05) 없이는 인계가 없어 시험 대상 없음', coop.length === 0, coop.length)
else {
check(`협업 상세(인계 없는 요청 ${coopOk}건 · 당사자 아님 ${notFound}건): 지금 앱이 서버와 같은 결과로 해석 — 추가된 이력 칸(actorName 등)과 호환`,
      coop.length > 0 && coopBad === 0 && coopOk > 0 && notFound > 0, { coopOk, coopBad, notFound })
check(`협업 상세: 제안 계약 기준 구현이 인계 전후 응답 ${refOk}건을 모두 받아들이고 값 그대로(인계 응답 ${handedCaps.length}건)`,
      refBad === 0 && refOk > 0 && handedCaps.length >= 4, { refOk, refBad })
const longest = handedCaps.reduce((a: Capture | undefined, c) => !a || c.raw.history.length > a.raw.history.length ? c : a, undefined)
if (longest) {
  const scope = { schoolId: longest.scope.schoolId, memberId: longest.scope.memberId, ownerUserId: longest.scope.userId }
  // 기대 응답 사례(Codex 가 옮겨 쓸 고정 사례): 정상 인계 · 연속 인계 · 위조. 기준 구현의 판정과 지금 앱의 판정을 같이 남긴다.
  const cases: { name: string; expect: 'accept' | 'reject'; scope: typeof scope; requestId: string; raw: any; app: string }[] = []
  const appVerdict = (r: any, sc = scope) => { try { appDetailResponse(structuredClone(r), sc, longest.requestId); return 'accept' } catch (e) { return 'reject:' + code(e) } }
  const appTamperAccepted: string[] = []
  const rejects = (name: string, f: (r: any) => void) => {
    const r = structuredClone(longest.raw); f(r)
    const app = appVerdict(r); cases.push({ name, expect: 'reject', scope, requestId: longest.requestId, raw: r, app })
    if (app === 'accept') appTamperAccepted.push(name)
    try { proposedDetailResponse(r, scope, longest.requestId); return name + ' 통과(X)' } catch (e) { return code(e) === 'INVALID_INPUT' ? '' : name + ' ' + code(e) }
  }
  for (const c of handedCaps) {
    const sc = { schoolId: c.scope.schoolId, memberId: c.scope.memberId, ownerUserId: c.scope.userId }
    cases.push({ name: `정상: ${c.scope.memberId} 조회 · 이력 ${c.raw.history.length}행(인계 ${c.raw.history.filter((h: any) => h.action === 'handover').length}번)`,
                 expect: 'accept', scope: sc, requestId: c.requestId, raw: c.raw, app: appVerdict(c.raw, sc) })
  }
  const firstHand = longest.raw.history.findIndex((h: any) => h.action === 'handover')
  const errs = [
    rejects('과거 처리자를 새 받는 사람으로 바꿈', r => { r.history[1].actorMemberId = r.request.recipientMemberId }),
    rejects('인계 행의 넘겨준 사람 바꿈', r => { r.history[firstHand].previousRecipientMemberId = r.request.senderMemberId }),
    rejects('행의 받는 사람을 지금 받는 사람으로 덮음', r => { r.history.forEach((h: any) => { h.recipientMemberId = r.request.recipientMemberId }) }),
    rejects('인계 행을 지움', r => { r.history.splice(firstHand, 1); r.history.forEach((h: any, i: number) => { h.version = i + 1 }); r.request.version-- }),
    rejects('인계가 아닌 행에 넘겨준 사람', r => { r.history[1].previousRecipientMemberId = r.request.senderMemberId }),
    rejects('보낸 사람에게 인계', r => { r.history[firstHand].actorMemberId = r.history[firstHand].recipientMemberId = r.request.senderMemberId }),
  ].filter(Boolean)
  check('협업 상세: 제안 계약은 이력을 고치거나 지운 응답 6종을 모두 INVALID_INPUT 으로 거부', errs.length === 0, errs)
  // 연속 인계 뒤 과거 행의 받는 사람 하나만 지금 받는 사람으로 바꿈(행 전체가 아니라 한 행)
  const lastHand = longest.raw.history.map((h: any) => h.action).lastIndexOf('handover')
  const one = rejects('인계 전 한 행의 받는 사람만 지금 받는 사람으로 바꿈', r => { r.history[Math.max(1, firstHand - 1)].recipientMemberId = r.request.recipientMemberId })
  const two = rejects('두 번째 인계의 넘겨준 사람을 첫 받는 사람으로 바꿈', r => { r.history[lastHand].previousRecipientMemberId = r.history[0].recipientMemberId })
  check('협업 상세: 제안 계약은 연속 인계의 한 행 위조 2종도 거부', !one && !two, [one, two])
  if (appTamperAccepted.length) console.log(`KNOWN 지금 앱 협업 상세 parser 가 위조 응답 ${appTamperAccepted.length}종을 받아들임 — Codex C1 남은 일: ${appTamperAccepted.join(' | ')}`)
  if (process.env.P7_COOP_CASES) writeFileSync(process.env.P7_COOP_CASES, JSON.stringify({ requestId: longest.requestId,
    note: '기대 응답 사례 — expect 는 제안 계약(cooperation_history_contract.ts) 기준, app 은 이 시험을 돌린 앱의 판정', cases }, null, 1))
  const lines = (proposedDetailResponse(structuredClone(longest.raw), scope, longest.requestId).history).map(historyLine)
  const names = longest.raw.history.map((h: any) => h.actorName)
  check(`협업 상세 화면 이력 줄: 처리자 이름이 그때 처리한 사람(${[...new Set(names)].length}명) — ${lines.join(' / ')}`,
        new Set(names).size >= 3 && lines.every((l, i) => l.endsWith(' · ' + names[i])), lines)
}
}
if (known.length) console.log(`KNOWN 지금 앱 협업 상세 parser 가 정상 인계 이력을 거부 ${known.length}건 — Codex 수정 대상(통합 검토 1번): ${known.join(' | ')}`)
if (handedCaps.length && !known.length) console.log(`  참고: 지금 앱이 정상 인계 이력 ${appHandedOk}건을 값 그대로 받아들임`)

const bridge = process.env.P7_BRIDGE !== '0'
const wantStates = ['pending', 'accepted', 'rejected', 'cancelled', 'completed', 'phase:open', ...(bridge ? ['phase:closed', 'phase:archived'] : [])]
check(`인계 · 학년도 결과 상태와 수합 단계(${wantStates.join(' · ')})를 모두 앱이 받아들임`, wantStates.every(k => (states[k] ?? 0) > 0), states)
const codes = Object.values(tally).reduce((a, v) => ({ ...a, ...v.codes }), {} as Record<string, number>)
check('중간 강제 실패(봉투 없는 오류)를 앱이 결과 모름(RESULT_UNKNOWN)으로 받음 — 수합 운영 · 업무 전환 각 1',
      (tally.ops_mutate?.codes.RESULT_UNKNOWN ?? 0) > 0 && (tally.tr_mutate?.codes.RESULT_UNKNOWN ?? 0) > 0, tally)
const BUSINESS = ['NOT_READY', 'FORBIDDEN', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT']
check(`서버 업무 거절 코드(${BUSINESS.join(' · ')})가 시험에 나오고 앱이 거절로 받음`, BUSINESS.every(k => (codes[k] ?? 0) > 0), codes)
if (Object.keys(localDiff).length) console.log('WARN 앱이 보내기 전에 막았지만 코드가 다름(PR #48 앱 쪽 확인 필요): ' + JSON.stringify(localDiff))
check('건너뛴 응답 없음 외(workhub_context 없는 계정 · 봉투 없는 예외만)', Object.keys(skipped).every(k => k.includes('workhub_context') || k.includes('봉투 없는 예외')), skipped)
console.log(`앱이 보내기 전에 같은 코드로 먼저 막은 요청 ${localFirst}건 · 건너뜀 ${JSON.stringify(skipped)}`)
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
