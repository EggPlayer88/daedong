import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { picker, preview, delivery } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { MessageRecipientPicker } from '../apps/workhub/src/messaging/MessageRecipientPicker'
  import { MessagePreview } from '../apps/workhub/src/messaging/MessagePreview'
  import { SentDeliveryPanel } from '../apps/workhub/src/messaging/SentDeliveryPanel'
  export const picker = props => renderToStaticMarkup(<MessageRecipientPicker {...props}>선택 목록</MessageRecipientPicker>)
  export const preview = attempt => renderToStaticMarkup(<MessagePreview attempt={attempt} busy={false} onConfirm={()=>{}} onEdit={()=>{}} />)
  export const delivery = record => renderToStaticMarkup(<SentDeliveryPanel record={record} disabled={false} hasDraft={false} onOpen={()=>{}} onDismiss={()=>{}} />)
`)
const people = [{ memberId: 'kim', name: '김교사', department: '교무부' }, { memberId: 'lee', name: '이교사', department: '연구부' }]
const attempt = { key: 'request-1', command: { kind: 'start', mode: 'individual', recipients: people.map(person => ({ memberId: person.memberId, expectedVersion: 2 })), title: '', body: '회의 자료를 확인해 주세요.', attachmentIds: [] }, recipientNames: people.map(person => person.name), recipientSnapshots: people, attachments: [] }
const record = { scope: 'scope', mode: 'individual', title: '', recipients: people, receipt: { requestKey: attempt.key, kind: 'start', recordedAt: '2026-11-25T03:00:00Z', deliveries: people.map(person => ({ threadId: 'thread-' + person.memberId, messageId: 'message-' + person.memberId, recipientMemberIds: [person.memberId], sequence: 1 })), threadId: null, throughSequence: null, noticeId: null, version: null } }
let count = 0
function test(name, run) { run(); count++; console.log('  ✓ ' + name) }
test('선택된 수신자의 이름·수·전송방식 요약을 접힌 선택 목록 위에 표시한다', () => {
  const before = structuredClone(people), html = picker({ people, peers: people, mode: 'individual', disabled: false })
  assert.match(html, /2명/); assert.match(html, /김교사 · 교무부, 이교사 · 연구부/); assert.match(html, /각자에게 개별 전송/)
  assert.match(html, /aria-label="받는 사람 변경"/); assert.doesNotMatch(html, /<details[^>]*open=""/)
  assert.deepEqual(people, before)
})
test('빈 선택은 펼치며 답장은 고정 참여자 요약만 제공한다', () => {
  assert.match(picker({ people: [], peers: people, mode: 'direct', disabled: false }), /<details[^>]*open=""/)
  const reply = picker({ people, peers: people, mode: 'reply', readOnly: true, disabled: false })
  assert.match(reply, /기존 대화에 답장/); assert.doesNotMatch(reply, /<details|<button/)
})
test('확인 화면은 개별·단체 차이를 유지하고 소속 번호를 상세로 접는다', () => {
  const before = structuredClone(attempt), individual = preview(attempt)
  assert.match(individual, /받는 사람끼리는 서로의 명단을 보지 않습니다/)
  assert.match(individual, /<details[^>]*><summary>받는 사람 소속 정보<\/summary>/)
  assert.match(individual, /소속 번호: kim/); assert.deepEqual(attempt, before)
  assert.match(preview({ ...attempt, command: { ...attempt.command, mode: 'group', title: '학년 협의' } }), /참여자 이름과 답장이 서로에게 보입니다/)
})
test('접수 결과의 요청·대화 번호는 상세에 있고 읽음·완료와 구별한다', () => {
  const html = delivery(record)
  assert.match(html, /상대방의 읽음이나 업무 완료를 뜻하지 않습니다/)
  assert.match(html, /<details[^>]*><summary>접수 정보<\/summary><p>요청 번호:/)
  assert.match(html, /<details[^>]*><summary>수신자·대화 정보<\/summary>/)
})
test('동명이인 구별 정보는 소속 상세를 접어도 확인 화면에 남긴다', () => {
  const same = people.map(person => ({ ...person, name: '김교사' }))
  const html = preview({ ...attempt, recipientNames: ['김교사', '김교사'], recipientSnapshots: same })
  assert.match(html, /<p class="messaging-recipient-disambiguation">같은 이름의 교사를 확인해 주세요: 김교사 · 교무부 \[kim\], 김교사 · 연구부 \[lee\]<\/p>/)
})
test('깨진 명단·첨부·접수 응답은 렌더를 중단하지 않고 실행 버튼도 만들지 않는다', () => {
  assert.doesNotThrow(() => picker({ people: null, peers: 'wrong', mode: 'direct', disabled: true }))
  for (const bad of [null, {}, { ...attempt, recipientNames: null }, { ...attempt, recipientSnapshots: 'wrong' }, { ...attempt, attachments: [null] }]) {
    const html = preview(bad); assert.match(html, /role="alert"/); assert.doesNotMatch(html, /확인한 내용 보내기/)
  }
  for (const bad of [null, {}, { ...record, recipients: 'wrong' }, { ...record, receipt: { ...record.receipt, deliveries: null } }, { ...record, recipients: [] }]) {
    const html = delivery(bad); assert.match(html, /role="alert"/); assert.doesNotMatch(html, /대화 열기/)
  }
})
console.log(`메신저 화면 정리 렌더 ${count}건 통과`)
