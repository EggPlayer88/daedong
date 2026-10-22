import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/messaging/validation'`)
const scope = { schoolId: 'school', memberId: 'member', userId: 'user' }
const notice = (source = { module: 'timetable', id: 'exchange-uuid-123' }) => ({ id: 'notice-distinct-id', schoolId: scope.schoolId, ownerMemberId: scope.memberId, title: '교환 요청', body: '확인해 주세요.', createdAt: '2026-10-19T00:00:00Z', readAt: null, version: 1, source })
const bad = fn => assert.throws(fn, error => error.code === 'INVALID_RESPONSE')
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
check('시간표 알림은 알림 번호와 구분한 교환 요청 원본 ID를 그대로 반환한다', () => {
  const parsed = m.notice(notice(), scope)
  assert.deepEqual(parsed.source, { module: 'timetable', id: 'exchange-uuid-123' })
  assert.equal(parsed.id, 'notice-distinct-id'); assert.equal(parsed.readAt, null)
})
check('공백·경로·제어문자·빈값·비문자·길이 초과 원본 ID는 정규화 없이 거절한다', () => {
  for (const id of ['', ' req-id', 'req-id ', 'a/b', 'a.b', 'a\n', null, 4, [], {}, 'x'.repeat(101)]) bad(() => m.notice(notice({ module: 'timetable', id }), scope))
})
check('원본 필드 추가와 잘못된 모듈을 거절한다', () => {
  for (const source of [{ module: 'timetable', id: 'ok', date: '2026-10-19' }, { module: 'timetable' }, { module: 'timetable-operations', id: 'ok' }, { module: 'timetable', id: null }]) bad(() => m.notice(notice(source), scope))
})
check('다른 학교·소속 알림은 시간표 출처여도 기존 범위 검사로 거절한다', () => {
  bad(() => m.notice({ ...notice(), schoolId: 'other-school' }, scope))
  bad(() => m.notice({ ...notice(), ownerMemberId: 'other-member' }, scope))
})
check('이전 알림 출처와 원본 없는 알림은 그대로 호환된다', () => {
  for (const module of ['calendar', 'tasks', 'collections', 'messages', 'students', 'knowledge', 'cooperation']) assert.deepEqual(m.notice(notice({ module, id: 'old-id' }), scope).source, { module, id: 'old-id' })
  assert.equal(m.notice(notice(null), scope).source, null)
})
check('알림 목록의 실제 응답 wrapper와 페이지를 함께 통과하며 원문은 바꾸지 않는다', () => {
  const input = { contractVersion: 1, ...scope, ok: true, data: { items: [notice()], nextCursor: null } }, before = JSON.stringify(input)
  const result = m.page(m.envelope(input, scope), item => m.notice(item, scope), item => item.id)
  assert.equal(result.items[0].source.id, 'exchange-uuid-123'); assert.equal(JSON.stringify(input), before)
})
console.log(`시간표 알림 원본 계약 검사: ${count}개 통과`)
