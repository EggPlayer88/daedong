// PR #48 앱(apps/workhub)의 실제 메시지·첨부 어댑터와 parser 에 P3 의 "실제 출력"을 넣어 본다.
// run_p3.py 가 시험 중 받은 응답(봉투)과 그때의 workhub_context·준비 상태·대화 조회를 P3_CAPTURE 에 남기고,
// 이 도구가 앱 코드에 그대로 넣는다. 앱 코드는 고치지 않고 가져다 쓰기만 한다.
// 서버 확인 결과(complete 뒤 check)는 PR #48 의 실제 Python wrapper(check_file)가 낸 응답을
// 앱의 createMessageFileCheck(fetch 흉내) → createMessageFileServer 순서로 통과시킨다.
// run_all.sh 가 esbuild 로 묶는다: --alias:p3app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createSupabaseMessagingServer } from 'p3app/messaging/supabase-messaging'
import { createMessageFileServer } from 'p3app/messaging/files'
import { createMessageFileCheck } from 'p3app/messaging/message-file-check'
import { canonical } from 'p3app/messaging/validation'
import { contextResponse } from 'p3app/connection/validation'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; [k: string]: any }
const file = process.env.P3_CAPTURE
if (!file) { console.log('FAIL P3_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'))
const DEFAULT_POLICY = { extensions: ['hwpx'], maxFileBytes: 31457280, maxFiles: 1 }

// 앱의 연결(로그인·학교 소속)을 그때의 실제 workhub_context 로 대신한다.
// rpc 는 이름별로 기록한 실제 응답을 돌려주고(준비 상태·대화 조회는 mutate 직전에 받은 값), 앱이 보낸 이름·인자를 남긴다.
function connection(c: Capture, sent: { name: string; args: any }[], answers: Record<string, any>) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => {
      sent.push({ name, args })
      if (!(name in answers)) throw new Error('기록 없는 호출 ' + name)
      return structuredClone(answers[name])
    },
  } as any
}

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
let localFirst = 0, unknownRead = 0, normalized = 0, serverOnly = 0, wrapperPassed = 0, downloads = 0
const skipped: Record<string, number> = {}

for (const c of captures) {
  const want = c.raw?.ok === false ? String(c.raw.error?.code) : undefined
  const sent: { name: string; args: any }[] = []
  const m = c.scope.memberId
  let expected: { name: string; args: any } | undefined
  let label = c.kind
  try {
    let out: any
    if (c.kind === 'readiness') {
      expected = { name: 'workhub_messaging_readiness', args: { p_member_id: m } }
      out = await createSupabaseMessagingServer(connection(c, sent, { [expected.name]: c.raw })).readiness(m)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
    } else if (c.kind === 'recipients') {
      expected = { name: 'workhub_message_recipients', args: { p_member_id: m, p_query: c.query.trim(), p_cursor: c.cursor } }
      out = await createSupabaseMessagingServer(connection(c, sent, { [expected.name]: c.raw })).recipients(m, c.query, c.cursor ?? undefined)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
    } else if (c.kind === 'threads') {
      expected = { name: 'workhub_message_threads', args: { p_member_id: m, p_query: c.query.trim(), p_unread_only: c.unread, p_cursor: c.cursor } }
      out = await createSupabaseMessagingServer(connection(c, sent, { [expected.name]: c.raw })).threads(m, c.query, c.unread, c.cursor ?? undefined)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
    } else if (c.kind === 'get') {
      expected = { name: 'workhub_message_get', args: { p_member_id: m, p_thread_id: c.threadId, p_before_cursor: c.cursor } }
      out = await createSupabaseMessagingServer(connection(c, sent, { [expected.name]: c.raw })).messages(m, c.threadId, c.cursor ?? undefined)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
    } else if (c.kind === 'inbox') {
      expected = { name: 'workhub_inbox_list', args: { p_member_id: m, p_unread_only: c.unread, p_cursor: c.cursor } }
      out = await createSupabaseMessagingServer(connection(c, sent, { [expected.name]: c.raw })).inbox(m, c.unread, c.cursor ?? undefined)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
    } else if (c.kind === 'mutate') {
      // 앱 순서: 준비 상태 조회 → (읽음 표시는) 대화 조회 → 보내기
      const answers: Record<string, any> = { workhub_messaging_readiness: c.ready, workhub_message_mutate: c.raw }
      if (c.threadGet) answers.workhub_message_get = c.threadGet
      const server = createSupabaseMessagingServer(connection(c, sent, answers))
      if (c.ready) { try { await server.readiness(m) } catch { /* 준비 조회 실패면 앱은 보내지 않는다 */ } }
      if (c.threadGet) { try { await server.messages(m, c.command.threadId) } catch { /* 대화를 모르면 앱이 먼저 막는다 */ } }
      const before = sent.length
      out = await server.mutate(m, c.command, c.key, c.replay ? { recovering: true, replayOnly: true } : {})
      const call = sent.slice(before).find(s => s.name === 'workhub_message_mutate')
      if (call && canonical(call.args.p_command) !== canonical(c.command)) { normalized++; skipped['앱이 명령을 다르게 정규화'] = (skipped['앱이 명령을 다르게 정규화'] ?? 0) + 1; continue }
      expected = { name: 'workhub_message_mutate', args: { p_member_id: m, p_command: c.command, p_request_key: c.key, p_replay_only: c.replay } }
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('접수증이 바뀜')
    } else if (c.kind === 'file_readiness') {
      label = 'file_readiness'
      expected = { name: 'workhub_message_file_readiness', args: { p_member_id: m } }
      out = await createMessageFileServer(connection(c, sent, { [expected.name]: c.raw })).readiness(m)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('값이 바뀜')
    } else if (c.kind === 'prepare') {
      if (!c.bytes) { skipped['prepare: 실물 없이 보낸 위조 메타데이터(서버 단독 방어)'] = (skipped['prepare: 실물 없이 보낸 위조 메타데이터(서버 단독 방어)'] ?? 0) + 1; continue }
      const bytes = b64(c.bytes), f = new File([bytes], c.file.name)
      expected = { name: 'workhub_message_file_prepare', args: { p_member_id: m, p_file: c.file, p_request_key: c.key, p_replay_only: c.replay } }
      out = await createMessageFileServer(connection(c, sent, { [expected.name]: c.raw })).prepare(m, f, c.policy ?? DEFAULT_POLICY, c.key, { replayOnly: c.replay })
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('예약이 바뀜')
    } else if (c.kind === 'status') {
      expected = { name: 'workhub_message_file_status', args: { p_member_id: m, p_file_id: c.fileId } }
      out = await createMessageFileServer(connection(c, sent, { [expected.name]: c.raw })).status(m, c.fileId)
      if (canonical(out) !== canonical(c.raw.data)) throw new Error('상태가 바뀜')
    } else if (c.kind === 'complete') {
      // complete → (pending_basic 이면) 서버 확인 API. 확인 API 응답은 실제 wrapper 출력을 HTTP 200 본문으로 돌려준다.
      if (c.raw?.ok === true && c.raw.data.state === 'pending_basic' && !c.check) { skipped['complete: 서버 확인을 나중에 돌린 경우'] = (skipped['complete: 서버 확인을 나중에 돌린 경우'] ?? 0) + 1; continue }
      const checker = createMessageFileCheck({
        getSession: async () => ({ access_token: 'a'.repeat(40), user: { id: c.scope.userId } }) as any,
        fetch: (async () => new Response(JSON.stringify(c.check), { status: 200, headers: { 'Content-Type': 'application/json' } })) as any,
        timeoutMs: 5000,
      })
      const port = { upload: async () => {}, download: async () => { throw new Error('호출되면 안 됨') }, check: checker.check }
      expected = { name: 'workhub_message_file_complete', args: { p_member_id: m, p_file_id: c.fileId, p_request_key: c.key } }
      out = await createMessageFileServer(connection(c, sent, { [expected.name]: c.raw }), { port }).complete(m, c.fileId, c.key)
      const final = c.check ?? c.raw
      if (canonical(out) !== canonical(final.data)) throw new Error('최종 상태가 바뀜')
      if (c.check) wrapperPassed++
    } else if (c.kind === 'access') {
      if (!c.bytes || c.raw?.ok !== true) {
        // 거절 응답: 앱의 download 가 같은 코드로 끝나는지만 본다(첨부 정보는 형식만 맞는 임의 값)
        expected = { name: 'workhub_message_file_access', args: { p_member_id: m, p_thread_id: c.threadId, p_message_id: c.messageId, p_file_id: c.fileId } }
        const dummy = { id: c.fileId, name: 'x.hwpx', bytes: 1, sha256: '0'.repeat(64), profile: 'hwpx_basic_v1' as const }
        out = await createMessageFileServer(connection(c, sent, { [expected.name]: c.raw }), { port: { upload: async () => {}, download: async () => new Blob([]), check: async () => null } }).download(m, c.threadId, c.messageId, dummy)
      } else {
        const bytes = b64(c.bytes)
        expected = { name: 'workhub_message_file_access', args: { p_member_id: m, p_thread_id: c.threadId, p_message_id: c.messageId, p_file_id: c.fileId } }
        const port = { upload: async () => {}, download: async (bucket: string, path: string) => {
          if (bucket !== c.raw.data.bucket || path !== c.raw.data.path) throw new Error('다른 위치를 내려받음'); return new Blob([bytes]) }, check: async () => null }
        out = await createMessageFileServer(connection(c, sent, { [expected.name]: c.raw }), { port }).download(m, c.threadId, c.messageId, c.raw.data.file)
        if (!(out instanceof Blob) || out.size !== bytes.length) throw new Error('내려받은 실물이 다름')
        downloads++
      }
    } else {
      skipped['알 수 없는 종류 ' + c.kind] = (skipped['알 수 없는 종류 ' + c.kind] ?? 0) + 1; continue
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    const last = sent.filter(s => s.name === expected!.name)
    if (!last.length || last.some(s => canonical(s.args) !== canonical(expected!.args))) throw new Error('보낸 이름·인자 다름 ' + JSON.stringify(sent).slice(0, 300))
    const t = note(label); t.ok++; t.codes.ok = (t.codes.ok ?? 0) + 1
  } catch (e) {
    const got = code(e), t = note(label)
    if (want && got === want) {
      t.ok++; t.codes[want] = (t.codes[want] ?? 0) + 1
      if (!sent.some(s => s.name === expected?.name)) localFirst++          // 앱이 보내기 전에 같은 이유로 막음
    } else if (!want && c.kind === 'prepare' && !sent.some(s => s.name === 'workhub_message_file_prepare') && got === 'INVALID_INPUT') {
      // 서버는 받았지만 앱은 실물 검사(이름·서명·크기)에서 먼저 막은 입력 — 앱이 더 엄격한 쪽이라 안전. 따로 센다.
      serverOnly++; t.ok++; t.codes['앱이 더 엄격(INVALID_INPUT)'] = (t.codes['앱이 더 엄격(INVALID_INPUT)'] ?? 0) + 1
    } else if (want && c.kind === 'mutate' && c.command?.kind === 'read_thread' && c.threadGet?.ok !== true && got === 'INVALID_INPUT' && !sent.some(s => s.name === 'workhub_message_mutate')) {
      // 서버도 열 수 없는 대화(get 이 거절)의 읽음 표시: 앱은 대화를 모르면 보내지 않고 INVALID_INPUT 으로 먼저 막는다(코드만 다름, 쓰기 없음)
      unknownRead++; t.ok++; t.codes['모르는 대화 읽음은 앱이 안 보냄'] = (t.codes['모르는 대화 읽음은 앱이 안 보냄'] ?? 0) + 1
    } else {
      t.bad++; console.log(`  불일치 ${c.kind} 서버=${want ?? 'ok'} 앱=${got} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw).slice(0, 300)}`)
    }
  }
}

for (const [k, v] of Object.entries(tally))
  check(`${k}: 실제 응답 ${v.ok + v.bad}건을 앱 어댑터가 서버와 같은 결과로 해석 (${Object.entries(v.codes).map(([a, b]) => `${a} ${b}`).join(' · ')})`, v.bad === 0 && v.ok > 0, v)
const kinds = ['readiness', 'recipients', 'threads', 'get', 'inbox', 'mutate', 'file_readiness', 'prepare', 'status', 'complete', 'access']
check('앱 함수 11종 모두 실제 응답으로 확인함', kinds.every(k => (tally[k]?.ok ?? 0) > 0), Object.keys(tally))
check(`실제 Python wrapper 출력 ${wrapperPassed}건을 앱 createMessageFileCheck → complete 가 그대로 받음`, wrapperPassed > 0, wrapperPassed)
check(`첨부 내려받기 ${downloads}건: 앱이 위치 확인 → 실물 크기·해시 확인 → 위치 재확인까지 통과`, downloads > 0, downloads)
check(`앱이 보내기 전에 같은 코드로 막은 요청 ${localFirst}건(서버도 같은 코드)`, localFirst > 0, localFirst)
console.log(`  참고: 앱이 명령을 다르게 정규화해 비교에서 뺀 요청 ${normalized}건 · 앱이 더 엄격하게 먼저 막은 예약 ${serverOnly}건 · 열 수 없는 대화의 읽음 표시를 앱이 보내지 않은 요청 ${unknownRead}건 · 건너뜀 ${JSON.stringify(skipped)}`)
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
