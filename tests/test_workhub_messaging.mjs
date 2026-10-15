import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const m = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import * as validation from '../apps/workhub/src/messaging/validation'
  import * as composer from '../apps/workhub/src/messaging/composer'
  import { createSupabaseMessagingServer } from '../apps/workhub/src/messaging/supabase-messaging'
  import { MessagingWorkspace } from '../apps/workhub/src/messaging/MessagingWorkspace'
  import { MessagePreview } from '../apps/workhub/src/messaging/MessagePreview'
  import { MessagingError } from '../apps/workhub/src/messaging/contracts'
  export { validation, composer, createSupabaseMessagingServer, MessagingError }
  export const render = props => renderToStaticMarkup(<MessagingWorkspace {...props} />)
  export const preview = attempt => renderToStaticMarkup(<MessagePreview attempt={attempt} busy={false} onConfirm={() => {}} onEdit={() => {}} />)
`)
const scope = { schoolId: 'school-one', memberId: 'member-one', userId: 'user-one' }
const member = { id: scope.memberId, schoolId: scope.schoolId, userId: scope.userId, name: '나', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [] }
const person = (id = 'member-two', name = '김교사') => ({ memberId: id, schoolId: scope.schoolId, name, department: '교무부', version: 1 })
const thread = () => ({ id: 'thread-one', schoolId: scope.schoolId, kind: 'direct', title: '', participants: [person(scope.memberId, '나'), person()], version: 1, latestSequence: 2, readSequence: 0, unreadCount: 1, updatedAt: '2026-10-16T12:00:00+09:00', canSend: true })
const message = (id = 'message-one', sequence = 1) => ({ id, schoolId: scope.schoolId, threadId: 'thread-one', senderMemberId: 'member-two', senderName: '김교사', sequence, body: '확인 부탁드립니다.', createdAt: '2026-10-16T12:00:00+09:00', attachments: [] })
const notification = () => ({ id: 'notice-one', schoolId: scope.schoolId, ownerMemberId: scope.memberId, title: '수합 알림', body: '자료를 제출해 주세요.', createdAt: '2026-10-16T12:00:00+09:00', readAt: null, version: 1, source: { module: 'collections', id: 'collection-one' } })
const ready = () => ({ available: true, reason: 'ready', limits: { bodyCharacters: 2000, titleCharacters: 100, recipients: 50 }, attachments: 'not_configured' })
const envelope = data => ({ contractVersion: 1, ...scope, ok: true, data })
const start = () => ({ kind: 'start', mode: 'direct', recipients: [{ memberId: 'member-two', expectedVersion: 1 }], title: '', body: '확인 부탁드립니다.', attachmentIds: [] })
const receipt = (sent, key = 'request-one') => ({ requestKey: key, kind: sent.kind, recordedAt: '2026-10-16T12:00:00+09:00', deliveries: sent.kind === 'start' ? sent.mode === 'individual' ? sent.recipients.map((r, index) => ({ threadId: `thread-${index}`, messageId: `message-${index}`, recipientMemberIds: [r.memberId], sequence: 1 })) : [{ threadId: 'thread-one', messageId: 'message-one', recipientMemberIds: sent.recipients.map(r => r.memberId), sequence: 1 }] : sent.kind === 'reply' ? [{ threadId: sent.threadId, messageId: 'message-three', recipientMemberIds: [...sent.recipientMemberIds], sequence: 3 }] : [], threadId: ['reply', 'read_thread'].includes(sent.kind) ? sent.threadId : null, throughSequence: sent.kind === 'read_thread' ? sent.throughSequence : null, noticeId: sent.kind === 'read_notice' ? sent.noticeId : null, version: sent.kind === 'read_notice' ? sent.expectedVersion + 1 : null })
function harness(handler) {
  let context = { memberships: [structuredClone(member)], schools: [{ id: scope.schoolId, name: '학교' }], basisDate: '2026-10-16' }
  let identity = { userId: scope.userId, approved: true }
  const calls = []
  const connection = { info: () => structuredClone(context), getIdentity: async () => structuredClone(identity), rpcVerified: async (name, args) => {
    calls.push({ name, args: structuredClone(args) })
    if (name === 'workhub_messaging_readiness') return envelope(ready())
    return handler ? handler(name, args) : envelope({ items: [], nextCursor: null })
  } }
  return { connection, calls, setContext(value) { context = value }, setIdentity(value) { identity = value }, context: () => structuredClone(context), server: m.createSupabaseMessagingServer(connection, { timeoutMs: 100 }) }
}
let count = 0
async function check(name, run) { await run(); count++; console.log(`  ✓ ${name}`) }
const rejects = (run, code) => assert.rejects(run, error => error instanceof m.MessagingError && error.code === code)

await check('학교·회원·사용자·계약 버전을 모두 대조한다', () => {
  for (const changed of [{ schoolId: 'other-school' }, { memberId: 'other-member' }, { userId: 'other-user' }, { contractVersion: 2 }, { token: 'unexpected' }]) assert.throws(() => m.validation.envelope({ ...envelope({}), ...changed }, scope), /서버 응답/)
})
await check('서버 오류는 제한된 코드만 받으며 원시 메시지·내부 SQL을 노출하지 않는다', () => {
  assert.throws(() => m.validation.envelope({ contractVersion: 1, ...scope, ok: false, error: { code: 'CONFLICT' } }, scope), error => error.code === 'CONFLICT')
  assert.throws(() => m.validation.envelope({ contractVersion: 1, ...scope, ok: false, error: { code: 'FORBIDDEN', sql: '비밀' } }, scope), error => error.code === 'INVALID_RESPONSE')
})
await check('학교가 다른 받는 사람과 중복 명단을 거부한다', () => {
  assert.throws(() => m.validation.recipient({ ...person(), schoolId: 'other' }, scope))
  assert.throws(() => m.validation.page({ items: [person(), person()], nextCursor: null }, item => m.validation.recipient(item, scope), item => item.memberId))
})
await check('준비 완료의 한도·상태는 일치해야 하며 허위 ready를 거부한다', () => {
  for (const value of [{ ...ready(), limits: null }, { ...ready(), reason: 'disabled' }, { ...ready(), limits: { ...ready().limits, recipients: 0 } }, { ...ready(), attachments: 'clean' }]) assert.throws(() => m.validation.readiness(value))
  assert.equal(m.validation.readiness({ available: false, reason: 'database_missing', limits: null, attachments: 'not_configured' }).available, false)
})
await check('대화에는 현재 본인 소속이 있어야 하고 DM은 두 명만 허용한다', () => {
  for (const value of [{ ...thread(), participants: [person(), person('member-three')] }, { ...thread(), participants: [...thread().participants, person('member-three')] }, { ...thread(), schoolId: 'other' }, { ...thread(), canSend: 'true' }]) assert.throws(() => m.validation.thread(value, scope))
})
await check('읽음 순번과 읽지 않은 개수의 범위를 검증한다', () => {
  for (const value of [{ ...thread(), readSequence: 3 }, { ...thread(), unreadCount: 3 }, { ...thread(), latestSequence: -1 }]) assert.throws(() => m.validation.thread(value, scope))
})
await check('메시지는 지정 대화·학교·참여자와 일치해야 한다', () => {
  for (const changed of [{ threadId: 'other-thread' }, { schoolId: 'other-school' }, { senderMemberId: 'outsider' }, { sequence: 3 }]) assert.throws(() => m.validation.messages({ thread: thread(), items: [{ ...message(), ...changed }], nextCursor: null }, scope, 'thread-one'))
})
await check('이전 메시지 페이지의 중복·역순·잘못된 첨부를 거부한다', () => {
  for (const items of [[message(), message()], [message('two', 2), message('one', 1)], [{ ...message(), attachments: [{ id: 'file', name: '../비밀.hwpx', bytes: 10, sha256: 'a'.repeat(64), profile: 'hwpx_basic_v1' }] }]]) assert.throws(() => m.validation.messages({ thread: thread(), items, nextCursor: null }, scope, 'thread-one'))
})
await check('다른 교사의 알림과 외부 URL 형식의 원본 링크를 거부한다', () => {
  assert.throws(() => m.validation.notice({ ...notification(), ownerMemberId: 'other-member' }, scope))
  assert.throws(() => m.validation.notice({ ...notification(), source: { module: 'collections', id: 'https://example.com' } }, scope))
  assert.throws(() => m.validation.notice({ ...notification(), source: { module: 'javascript', id: 'x' } }, scope))
})
await check('새 대화 입력은 자기 자신·중복·빈 메시지·중복 첨부 ID를 거부한다', () => {
  for (const value of [{ ...start(), recipients: [{ memberId: scope.memberId, expectedVersion: 1 }] }, { ...start(), mode: 'individual', recipients: [...start().recipients, ...start().recipients] }, { ...start(), body: '   ' }, { ...start(), attachmentIds: ['same-file', 'same-file'] }]) assert.throws(() => m.validation.command(value, scope.memberId), error => error.code === 'INVALID_INPUT')
})
await check('단체 대화는 최소 두 명과 제목을 요구하고 개별 전송은 다른 뜻으로 유지한다', () => {
  assert.throws(() => m.validation.command({ ...start(), mode: 'group' }, scope.memberId))
  const result = m.validation.command({ ...start(), mode: 'individual', recipients: [...start().recipients, { memberId: 'member-three', expectedVersion: 2 }] }, scope.memberId)
  assert.equal(result.mode, 'individual'); assert.equal(result.recipients.length, 2)
})
await check('개별 일괄 전송 접수증은 수신자를 빠짐없이 한 명씩만 포함해야 한다', () => {
  const sent = { ...start(), mode: 'individual', recipients: [...start().recipients, { memberId: 'member-three', expectedVersion: 1 }] }, result = receipt(sent)
  assert.equal(m.validation.receipt(result, sent, 'request-one', scope.memberId).deliveries.length, 2)
  for (const deliveries of [result.deliveries.slice(0, 1), [{ ...result.deliveries[0], recipientMemberIds: ['member-two', 'member-three'] }], [{ ...result.deliveries[0], recipientMemberIds: ['outsider'] }, result.deliveries[1]]]) assert.throws(() => m.validation.receipt({ ...result, deliveries }, sent, 'request-one', scope.memberId))
})
await check('접수증에 다른 요청 번호·명령·메시지 중복이 오면 성공으로 처리하지 않는다', () => {
  for (const changed of [{ requestKey: 'wrong' }, { kind: 'reply' }, { noticeId: 'unrelated' }]) assert.throws(() => m.validation.receipt({ ...receipt(start()), ...changed }, start(), 'request-one', scope.memberId))
})
await check('답장 접수증도 미리 확인한 참여자 명단과 정확히 같아야 한다', () => {
  const sent = m.composer.messageAttempt({ ...m.composer.blankMessageDraft(), thread: thread(), body: '답장' }, scope.memberId, 'reply-one').command
  assert.equal(m.validation.receipt(receipt(sent, 'reply-one'), sent, 'reply-one', scope.memberId).deliveries.length, 1)
  const wrong = receipt(sent, 'reply-one'); wrong.deliveries[0].recipientMemberIds.push('outsider')
  assert.throws(() => m.validation.receipt(wrong, sent, 'reply-one', scope.memberId))
})
await check('읽음 접수증은 요청한 순번과 알림만 확인하며 제출 접수증을 허용하지 않는다', () => {
  const read = { kind: 'read_thread', threadId: 'thread-one', throughSequence: 1 }
  assert.equal(m.validation.receipt(receipt(read), read, 'request-one', scope.memberId).throughSequence, 1)
  assert.throws(() => m.validation.receipt({ ...receipt(read), throughSequence: 2 }, read, 'request-one', scope.memberId))
  assert.throws(() => m.validation.receipt({ ...receipt(read), submissionId: 'submitted' }, read, 'request-one', scope.memberId))
})
await check('전송 확인 스냅샷은 원본 입력 수정과 재시도 수정에서 분리된다', () => {
  const draft = { ...m.composer.blankMessageDraft(), recipients: [person()], body: '최초 내용' }
  const attempt = m.composer.messageAttempt(draft, scope.memberId, 'request-one')
  draft.body = '수정 내용'; draft.recipients[0].name = '바뀐 이름'
  const retry = m.composer.retryMessageAttempt(attempt); retry.command.body = '실수'
  assert.equal(attempt.command.body, '최초 내용'); assert.deepEqual(attempt.recipientNames, ['김교사']); assert.equal(attempt.key, 'request-one')
})
await check('응답이 없던 전송은 같은 요청 번호와 내용을 그대로 재시도한다', async () => {
  let calls = 0
  const h = harness((name, args) => { if (name === 'workhub_message_mutate' && ++calls === 1) throw new Error('연결 끊김'); return envelope(receipt(args.p_command, args.p_request_key)) })
  await h.server.readiness(member.id)
  await rejects(() => h.server.mutate(member.id, start(), 'request-one'), 'RESULT_UNKNOWN')
  const result = await h.server.mutate(member.id, start(), 'request-one')
  assert.equal(result.requestKey, 'request-one')
  const sent = h.calls.filter(call => call.name === 'workhub_message_mutate')
  assert.deepEqual(sent[0].args, sent[1].args)
})
await check('불명확한 전송 뒤 동일 요청 번호의 내용 변경은 서버에 보내기 전에 막는다', async () => {
  const h = harness(() => { throw new Error('결과 유실') }); await h.server.readiness(member.id)
  await rejects(() => h.server.mutate(member.id, start(), 'request-one'), 'RESULT_UNKNOWN')
  await rejects(() => h.server.mutate(member.id, { ...start(), body: '새 내용' }, 'request-one'), 'IDEMPOTENCY_CONFLICT')
  assert.equal(h.calls.filter(call => call.name === 'workhub_message_mutate').length, 1)
})
await check('전송 성공이라고 온 범위가 다른 응답은 결과 미확정으로 남긴다', async () => {
  const h = harness((_, args) => ({ ...envelope(receipt(args.p_command, args.p_request_key)), schoolId: 'other-school' })); await h.server.readiness(member.id)
  await rejects(() => h.server.mutate(member.id, start(), 'request-one'), 'RESULT_UNKNOWN')
})
await check('받는 사람 조회는 실제 서버 검색과 커서를 사용한다', async () => {
  const h = harness(() => envelope({ items: [person()], nextCursor: 'next-one' }))
  const result = await h.server.recipients(member.id, ' 교무 ', 'previous-one')
  assert.equal(result.items[0].name, '김교사'); assert.equal(h.calls[0].args.p_query, '교무'); assert.equal(h.calls[0].args.p_cursor, 'previous-one')
})
await check('같은 커서를 되돌리거나 본인을 수신자 목록에 포함한 응답을 막는다', async () => {
  const h = harness(() => envelope({ items: [person()], nextCursor: 'same' }))
  await rejects(() => h.server.recipients(member.id, '', 'same'), 'INVALID_RESPONSE')
  const own = harness(() => envelope({ items: [person(member.id)], nextCursor: null }))
  await rejects(() => own.server.recipients(member.id, ''), 'INVALID_RESPONSE')
})
await check('조회 중 계정이 바뀌면 이전 사용자 내용을 반환하지 않는다', async () => {
  let h
  h = harness(() => { h.setIdentity({ userId: 'other-user', approved: true }); return envelope({ items: [person()], nextCursor: null }) })
  await rejects(() => h.server.recipients(member.id, ''), 'CANCELLED')
})
await check('조회 중 같은 회원의 역할·담당이 바뀌어도 이전 권한 응답을 취소한다', async () => {
  let h
  h = harness(() => { const next = h.context(); next.memberships[0].role = 'calendar_manager'; h.setContext(next); return envelope({ items: [person()], nextCursor: null }) })
  await rejects(() => h.server.recipients(member.id, ''), 'CANCELLED')
})
await check('소속 종료·가입 미승인은 RPC를 실행하지 않는다', async () => {
  const h = harness(); const next = h.context(); next.memberships[0].active = false; h.setContext(next)
  await rejects(() => h.server.recipients(member.id, ''), 'INACTIVE_MEMBERSHIP'); assert.equal(h.calls.length, 0)
  const inactive = harness(); inactive.setIdentity({ userId: member.userId, approved: false })
  await rejects(() => inactive.server.recipients(member.id, ''), 'FORBIDDEN'); assert.equal(inactive.calls.length, 0)
})
await check('읽지 않은 전용 목록에 읽은 대화·알림이 오면 잘못된 숫자로 표시하지 않는다', async () => {
  const h = harness(name => envelope({ items: name === 'workhub_message_threads' ? [{ ...thread(), unreadCount: 0 }] : [{ ...notification(), readAt: '2026-10-16T12:10:00+09:00' }], nextCursor: null }))
  await rejects(() => h.server.threads(member.id, '', true), 'INVALID_RESPONSE'); await rejects(() => h.server.inbox(member.id, true), 'INVALID_RESPONSE')
})
await check('실제 열어 본 대화보다 높은 순번으로 읽음 처리하지 않는다', async () => {
  const h = harness(name => name === 'workhub_message_get' ? envelope({ thread: thread(), items: [message()], nextCursor: null }) : envelope({}))
  await h.server.readiness(member.id); await h.server.messages(member.id, 'thread-one')
  await rejects(() => h.server.mutate(member.id, { kind: 'read_thread', threadId: 'thread-one', throughSequence: 3 }, 'read-one'), 'INVALID_INPUT')
  assert.equal(h.calls.some(call => call.name === 'workhub_message_mutate'), false)
})
await check('메시지 미연결 RPC 오류는 빈 대화 성공으로 바꾸지 않는다', async () => {
  const h = harness(() => { throw new Error('function missing') })
  await rejects(() => h.server.threads(member.id, '', false), 'QUERY_FAILED')
})
await check('서버가 게시한 메시지 길이·인원 한도를 적용한다', async () => {
  const h = harness(); await h.server.readiness(member.id)
  await rejects(() => h.server.mutate(member.id, { ...start(), body: '가'.repeat(2001) }, 'too-long'), 'INVALID_INPUT')
})
await check('전송 타임아웃도 입력 폐기 대신 결과 미확정이다', async () => {
  const h = harness(() => new Promise(() => {})); const server = m.createSupabaseMessagingServer(h.connection, { timeoutMs: 10 }); await server.readiness(member.id)
  await rejects(() => server.mutate(member.id, start(), 'request-one'), 'RESULT_UNKNOWN')
})
await check('교사 화면 SSR은 연결 중·비활성 새 메시지로 시작하고 가짜 대화를 보이지 않는다', () => {
  const h = harness(), html = m.render({ connection: h.connection, member, date: '2026-10-16', server: h.server }).replace(/<style>[\s\S]*?<\/style>/g, '')
  assert.match(html, /메시지 연결을 확인하는 중/); assert.match(html, /disabled=""[^>]*>새 메시지/); assert.doesNotMatch(html, /김교사|가짜|sample|전송되었습니다/)
})
await check('개별 일괄 확인 화면은 받는 사람·본문·개별 전송 의미를 명시한다', () => {
  const attempt = m.composer.messageAttempt({ ...m.composer.blankMessageDraft(), mode: 'individual', recipients: [person(), person('member-three', '이교사')], body: '<script>실행 금지</script>' }, member.id, 'request-one')
  const html = m.preview(attempt)
  assert.match(html, /개별 대화/); assert.match(html, /받는 사람 · 2명/); assert.match(html, /김교사, 이교사/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
  assert.match(html, /확인한 내용 보내기/); assert.match(html, /내용 수정/)
})
await check('단체 대화 확인 화면은 참여자와 답장 공개 범위를 구분한다', () => {
  const attempt = m.composer.messageAttempt({ ...m.composer.blankMessageDraft(), mode: 'group', title: '교무부', recipients: [person(), person('member-three', '이교사')], body: '안녕하세요' }, member.id, 'request-one')
  const html = m.preview(attempt)
  assert.match(html, /참여자 이름과 답장이 서로에게 보입니다/); assert.match(html, /교무부/)
})
await check('설정 비활성화 후 기존 요청 재조회는 replay 전용으로 보내며 새 쓰기는 막는다', async () => {
  const h = harness((_, args) => envelope(receipt(args.p_command, args.p_request_key)))
  await rejects(() => h.server.mutate(member.id, start(), 'new-one'), 'NOT_READY')
  const result = await h.server.mutate(member.id, start(), 'old-one', { recovering: true, replayOnly: true })
  assert.equal(result.requestKey, 'old-one'); assert.equal(h.calls[0].args.p_replay_only, true)
})
await check('쓰기 이후 가입 승인 재조회 실패는 확정 거절로 바꾸지 않고 pending 보존 코드다', async () => {
  let h
  h = harness((_, args) => { h.setIdentity({ userId: member.userId, approved: false }); return envelope(receipt(args.p_command, args.p_request_key)) })
  await h.server.readiness(member.id)
  await rejects(() => h.server.mutate(member.id, start(), 'request-one'), 'CANCELLED')
  assert.equal(h.calls.filter(call => call.name === 'workhub_message_mutate').length, 1)
})
await check('첨부 정책이 준비되지 않은 메시지 전송은 수합 ID를 첨부할 수 없다', async () => {
  const h = harness(); await h.server.readiness(member.id)
  await rejects(() => h.server.mutate(member.id, { ...start(), attachmentIds: ['collection-file'] }, 'request-one'), 'NOT_READY')
  assert.equal(h.calls.some(call => call.name === 'workhub_message_mutate'), false)
})
await check('전송 사전 조회가 만료된 뒤 응답해도 새 메시지를 보내지 않는다', async () => {
  const h = harness(), server = m.createSupabaseMessagingServer(h.connection, { timeoutMs: 20 })
  await server.readiness(member.id)
  let release
  h.connection.getIdentity = () => new Promise(resolve => { release = resolve })
  await rejects(() => server.mutate(member.id, start(), 'late-preflight'), 'RESULT_UNKNOWN')
  release({ userId: member.userId, approved: true })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(h.calls.filter(call => call.name === 'workhub_message_mutate').length, 0)
})
await check('이미 시작된 전송의 늦은 응답은 기존 번호로만 확인하고 한 번만 저장한다', async () => {
  let release, saved = 0
  const receipts = new Map()
  const h = harness((_, args) => {
    if (receipts.has(args.p_request_key)) return receipts.get(args.p_request_key)
    saved++; const result = envelope(receipt(args.p_command, args.p_request_key)); receipts.set(args.p_request_key, result)
    return new Promise(resolve => { release = () => resolve(result) })
  }), server = m.createSupabaseMessagingServer(h.connection, { timeoutMs: 20 })
  await server.readiness(member.id)
  await rejects(() => server.mutate(member.id, start(), 'late-receipt'), 'RESULT_UNKNOWN')
  release(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await server.mutate(member.id, start(), 'late-receipt', { recovering: true })).requestKey, 'late-receipt')
  assert.equal(saved, 1)
  const calls = h.calls.filter(call => call.name === 'workhub_message_mutate')
  assert.deepEqual(calls[0].args, calls[1].args)
})
console.log(`메신저·알림 계약과 화면 ${count}건 통과`)



