import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
import * as deliveries from '../apps/workhub/src/messaging/deliveries'
import { messageAttempt, blankMessageDraft } from '../apps/workhub/src/messaging/composer'
import { SentDeliveryPanel } from '../apps/workhub/src/messaging/SentDeliveryPanel'
import { renderToStaticMarkup } from 'react-dom/server'
export { deliveries, messageAttempt, blankMessageDraft }
export const render=record=>renderToStaticMarkup(<SentDeliveryPanel record={record} disabled={false} hasDraft={true} onOpen={()=>{}} onDismiss={()=>{}}/>)
`)
const person = (memberId, name = '김교사') => ({ memberId, name, schoolId: 'school', department: '교무부', version: 1 })
const people = [person('z-teacher', '뒤 교사'), person('a-teacher', '앞 교사')]
const draft = mode => ({ ...m.blankMessageDraft(), mode, title: mode === 'group' ? '협의' : '', body: '민감한 본문은 결과 목록에 복제하지 않음', recipients: mode === 'direct' ? people.slice(0, 1) : people })
function receipt(attempt) {
  const sent = attempt.command, ids = sent.kind === 'start' ? sent.recipients.map(r => r.memberId) : sent.recipientMemberIds
  return { requestKey: attempt.key, kind: sent.kind, recordedAt: '2026-10-21T00:00:00.000Z', deliveries: sent.kind === 'start' && sent.mode === 'individual' ? ids.slice().reverse().map(id => ({ threadId: 'thread-' + id, messageId: 'message-' + id, recipientMemberIds: [id], sequence: 1 })) : [{ threadId: sent.threadId ?? 'group-thread', messageId: 'message', recipientMemberIds: ids, sequence: 1 }], threadId: sent.kind === 'reply' ? sent.threadId : null, throughSequence: null, noticeId: null, version: null }
}
let count = 0
function test(name, run) { run(); count++; console.log('  ✓ ' + name) }
test('선택 순서·서버 접수 순서가 달라도 소속 번호로 정확한 이름과 대화를 연결한다', () => {
  const attempt = m.messageAttempt(draft('individual'), 'self', 'request'), record = m.deliveries.sentDeliveryRecord(attempt, receipt(attempt), 'scope', 'self')
  assert.deepEqual(attempt.command.recipients.map(r => r.memberId), ['a-teacher', 'z-teacher'])
  assert.deepEqual(record.receipt.deliveries.map(r => r.threadId), ['thread-z-teacher', 'thread-a-teacher'])
  assert.deepEqual(record.recipients.map(r => [r.memberId, r.name]), [['a-teacher', '앞 교사'], ['z-teacher', '뒤 교사']])
  assert.equal(JSON.stringify(record).includes('민감한 본문'), false)
})
for (const mode of ['direct', 'group', 'individual']) test(`${mode} 접수 목록을 현재 탭 범위로 복원한다`, () => {
  const attempt = m.messageAttempt(draft(mode), 'self', 'request'), record = m.deliveries.sentDeliveryRecord(attempt, receipt(attempt), 'scope', 'self')
  assert.deepEqual(m.deliveries.restoreSentDelivery(record, 'scope', 'self'), record)
  assert.equal(m.deliveries.restoreSentDelivery(record, 'other-scope', 'self'), null)
})
test('답장 접수증은 원래 대화 번호를 보존한다', () => {
  const attempt = m.messageAttempt({ ...draft('direct'), thread: { id: 'reply-thread', version: 4, participants: [person('self'), ...people] } }, 'self', 'reply-request')
  const record = m.deliveries.sentDeliveryRecord(attempt, receipt(attempt), 'scope', 'self')
  assert.equal(record.receipt.deliveries[0].threadId, 'reply-thread'); assert.deepEqual(m.deliveries.restoreSentDelivery(record, 'scope', 'self'), record)
})
test('이름만 남은 옛 복구 자료의 명단 순서를 추정하지 않는다', () => {
  const attempt = m.messageAttempt(draft('individual'), 'self', 'request'); delete attempt.recipientSnapshots
  const record = m.deliveries.sentDeliveryRecord(attempt, receipt(attempt), 'scope', 'self')
  assert.ok(record.recipients.every(r => r.name === '이름 확인 필요'))
  assert.match(m.render(record), /a-teacher/)
})
test('동명이인은 부서가 같아도 전체 소속 번호로 구별한다', () => {
  const same = [person('a'), person('b')]
  assert.equal(m.deliveries.recipientLabel(same[0], same), '김교사 · 교무부 [a]')
  assert.equal(m.deliveries.recipientLabel(same[1], same), '김교사 · 교무부 [b]')
})
test('잘못된 범위·중복 수신자·깨진 접수증은 복원해 표시하지 않는다', () => {
  const attempt = m.messageAttempt(draft('individual'), 'self', 'request'), record = m.deliveries.sentDeliveryRecord(attempt, receipt(attempt), 'scope', 'self')
  const variants = [null, {}, { ...record, mode: 'unknown' }, { ...record, recipients: 'bad' }, { ...record, recipients: [...record.recipients, record.recipients[0]] }, { ...record, receipt: { ...record.receipt, recordedAt: 'invalid' } }, { ...record, receipt: { ...record.receipt, deliveries: [] } }, { ...record, receipt: { ...record.receipt, deliveries: record.receipt.deliveries.map(r => ({ ...r, threadId: 'duplicate' })) } }]
  for (const value of variants) assert.equal(m.deliveries.restoreSentDelivery(value, 'scope', 'self'), null)
})
test('개별 접수증 누락·잘못된 요청 번호를 성공 목록으로 만들지 않는다', () => {
  const attempt = m.messageAttempt(draft('individual'), 'self', 'request'), raw = receipt(attempt)
  for (const bad of [{ ...raw, requestKey: 'other' }, { ...raw, deliveries: raw.deliveries.slice(1) }]) assert.throws(() => m.deliveries.sentDeliveryRecord(attempt, bad, 'scope', 'self'))
})
test('발송 결과에는 읽음·완료와 다른 접수 의미 및 초안 보존 안내가 있다', () => {
  const attempt = m.messageAttempt(draft('individual'), 'self', 'request'), html = m.render(m.deliveries.sentDeliveryRecord(attempt, receipt(attempt), 'scope', 'self'))
  assert.match(html, /상대방의 읽음이나 업무 완료를 뜻하지 않습니다/); assert.match(html, /입력 보관하고 대화 열기/); assert.match(html, /현재 탭의 가장 최근 발송 1건/)
})
console.log(`메시지 접수 결과 ${count}건 통과`)
