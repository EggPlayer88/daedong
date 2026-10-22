import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/exchange-inbox'`)
const now = Date.parse('2026-10-20T00:00:00.000Z')
const request = (patch = {}) => ({ id: 'exact-id', state: 'awaiting_consent', requester: { id: 'other', name: '교사' }, requesterIsViewer: false, participants: [{ id: 'me', name: '교사', response: 'pending' }, { id: 'other', name: '교사', response: 'accepted' }], actions: ['accept', 'reject'], reason: '연수', createdAt: '2026-10-19T00:00:00.000Z', expiresAt: '2026-10-21T00:00:00.000Z', changes: [], ...patch })
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
check('정확한 요청 ID만 찾고 비슷한 이름이나 다른 순번으로 대체하지 않는다', () => {
  const rows = [request({ id: 'prefix-exact-id' }), request(), request({ id: 'exact-id-2' })]
  assert.equal(m.findExchangeRequest(rows, 'exact-id'), rows[1])
  assert.equal(m.findExchangeRequest(rows, 'missing'), undefined)
  assert.equal(m.findExchangeRequest(rows, ' exact-id'), undefined)
  assert.equal(m.findExchangeRequest([], 'exact-id'), undefined)
})
check('필터 검색에도 요청 번호를 사용할 수 있고 실제 원본은 바꾸지 않는다', () => {
  const rows = [request(), request({ id: 'other-id' })], before = JSON.stringify(rows)
  assert.deepEqual(m.selectExchangeRequests(rows, 'all', 'exact-id', now).map(row => row.id), ['exact-id'])
  assert.equal(JSON.stringify(rows), before)
})
check('동의 단계에서는 담당자 승인과 실제 반영을 완료로 표시하지 않는다', () => {
  const row = request()
  assert.deepEqual(m.exchangeConsentSummary(row), { accepted: 1, pending: 1, rejected: 0, total: 2 })
  assert.deepEqual(m.exchangeProgress(row, now).map(step => step.state), ['complete', 'current', 'waiting', 'waiting'])
})
check('모든 교사 동의 뒤에는 승인만 현재 단계이고 실제 반영은 대기다', () => {
  const row = request({ state: 'awaiting_approval', participants: [{ id: 'me', response: 'accepted' }] })
  assert.deepEqual(m.exchangeProgress(row, now).map(step => step.state), ['complete', 'complete', 'current', 'waiting'])
})
check('적용 완료가 되어야 승인과 반영을 모두 완료로 표시한다', () => {
  const row = request({ state: 'applied', participants: [{ id: 'me', response: 'accepted' }], expiresAt: '2026-10-19T00:00:00.000Z' })
  assert.deepEqual(m.exchangeProgress(row, now).map(step => step.state), ['complete', 'complete', 'complete', 'complete'])
})
check('거절·철회·만료·원본변경은 후속 단계를 진행 안 함으로 표시한다', () => {
  for (const state of ['rejected', 'withdrawn', 'expired', 'stale']) {
    const row = request({ state }), before = JSON.stringify(row)
    assert.deepEqual(m.exchangeProgress(row, now).map(step => step.state), ['complete', 'stopped', 'stopped', 'stopped'])
    assert.equal(JSON.stringify(row), before)
  }
})
check('서버 상태가 대기여도 기한이 지났으면 화면 진행을 막되 상태를 다시 쓰지 않는다', () => {
  const row = request({ expiresAt: new Date(now).toISOString() })
  assert.deepEqual(m.exchangeProgress(row, now).map(step => step.state), ['complete', 'stopped', 'stopped', 'stopped'])
  assert.equal(row.state, 'awaiting_consent')
  assert.deepEqual(m.exchangeAttention(row, now), { consent: false, approval: false })
})
check('동의하지 않음 응답과 무응답을 따로 집계한다', () => {
  const row = request({ participants: [{ id: 'a', response: 'accepted' }, { id: 'b', response: 'rejected' }, { id: 'c', response: 'pending' }] })
  assert.deepEqual(m.exchangeConsentSummary(row), { accepted: 1, pending: 1, rejected: 1, total: 3 })
})
console.log(`시간표 교환 정확한 연결·진행 단계 검사: ${count}개 통과`)
