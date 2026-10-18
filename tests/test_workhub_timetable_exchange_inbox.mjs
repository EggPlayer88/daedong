import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/exchange-inbox'`)
const now = Date.parse('2026-10-18T00:00:00.000Z')
const request = (patch = {}) => ({ id: 'incoming', requester: { id: 'other', name: '김교사' }, requesterIsViewer: false, createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-19T00:00:00.000Z', state: 'awaiting_consent', reason: '교내 연수', participants: [{ id: 'me', name: '이교사', response: 'pending' }], actions: ['accept', 'reject'], changes: [{ before: { label: '국어', groupNames: ['1학년 1반'], teachers: [{ id: 'other', name: '김교사' }] } }], ...patch })
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
check('교사의 동의와 담당자 승인을 서버 actions대로 나눈다', () => {
  const rows = [request(), request({ id: 'manager', state: 'awaiting_approval', actions: ['approve', 'rejectApproval'] }), request({ id: 'own', requesterIsViewer: true, actions: ['withdraw'] })]
  assert.deepEqual(m.selectExchangeRequests(rows, 'consent', '', now).map(r => r.id), ['incoming'])
  assert.deepEqual(m.selectExchangeRequests(rows, 'approval', '', now).map(r => r.id), ['manager'])
  assert.equal(m.selectExchangeRequests(rows, 'mine', '', now).length, 2)
  assert.deepEqual(m.selectExchangeRequests(rows, 'requested', '', now).map(r => r.id), ['own'])
})
check('응답 기한이 지난 요청은 지금 응답할 건수에서 제외하되 원래 상태로 남긴다', () => {
  const row = request({ expiresAt: new Date(now).toISOString() })
  assert.deepEqual(m.exchangeAttention(row, now), { consent: false, approval: false })
  assert.equal(m.selectExchangeRequests([row], 'active', '', now).length, 1)
  assert.match(m.exchangeNextStep(row, now), /응답 기한이 지났습니다/)
  assert.equal(row.state, 'awaiting_consent')
})
check('자기 승인 버튼을 집계에 다시 만들지 않는다', () => {
  const row = request({ requesterIsViewer: true, actions: ['approve', 'withdraw'] })
  assert.deepEqual(m.visibleExchangeActions(row), ['withdraw'])
  assert.equal(m.exchangeAttention(row, now).approval, false)
})
check('교사·수업·학급·사유의 여러 검색어를 모두 만족한 요청만 찾는다', () => {
  const rows = [request(), request({ id: 'different', reason: '출장', requester: { id: 'else', name: '최교사' } })]
  assert.deepEqual(m.selectExchangeRequests(rows, 'all', ' 김교사  연수 １학년 ', now).map(r => r.id), ['incoming'])
  assert.equal(m.selectExchangeRequests(rows, 'all', '존재하지않음', now).length, 0)
})
check('응답할 요청을 먼저, 같은 시각에는 안정된 ID로 정렬하고 원본을 유지한다', () => {
  const rows = [request({ id: 'z', actions: [] }), request({ id: 'b' }), request({ id: 'a' })], before = JSON.stringify(rows)
  assert.deepEqual(m.selectExchangeRequests(rows, 'all', '', now).map(r => r.id), ['a', 'b', 'z'])
  assert.equal(JSON.stringify(rows), before)
})
check('반영 완료와 동의 완료를 구분하고 끝난 요청에서 재전송을 안내하지 않는다', () => {
  const approval = request({ state: 'awaiting_approval', actions: [] }), applied = request({ id: 'done', state: 'applied', actions: [] })
  assert.match(m.exchangeNextStep(approval, now), /최종 승인을 기다리고/)
  assert.match(m.exchangeNextStep(applied, now), /변경된 시간표가 반영/)
  assert.deepEqual(m.selectExchangeRequests([approval, applied], 'finished', '', now).map(r => r.id), ['done'])
})
console.log(`시간표 변경 요청 목록 검사: ${count}개 통과`)
