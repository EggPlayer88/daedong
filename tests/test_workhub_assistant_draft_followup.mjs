import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { parseDraftReply, isDeadlineReplyWhileNaming } = await loadBrowserModule(`
  export { parseDraftReply, isDeadlineReplyWhileNaming } from '../apps/workhub/src/assistant/draft-followup.ts'
`)
const selected = [{ memberId: 'member-a', displayName: '이수진' }]
const message = { command: { kind: 'messageDraft', body: '두 줄\n안내', prompt: '메시지 초안: 두 줄\n안내' },
  scope: 'school/member', basisDate: '2026-12-30', selected }
const collection = { ...message, command: { kind: 'collectionDraft', title: '모집 계획', instructions: '학급별 제출', prompt: '수합 초안: 모집 계획' } }
function check(name, test) {
  try { test(); console.log('  ✓ ' + name) }
  catch (error) { console.log('  ✗ ' + name + ': ' + error.stack); process.exitCode = 1 }
}

check('메시지 수신자 답은 검색어만 만들고 원래 본문과 선택을 보존한다', () => {
  const before = structuredClone(message)
  assert.deepEqual(parseDraftReply(message, '수신자: 김다솜 선생님께'), { kind: 'fields', query: '김다솜' })
  assert.deepEqual(parseDraftReply(message, '김다솜 선생님도 추가해줘'), { kind: 'fields', query: '김다솜' })
  assert.deepEqual(parseDraftReply(message, '김다솜에게'), { kind: 'fields', query: '김다솜' })
  assert.equal(parseDraftReply(message, '내일까지').kind, 'clarify')
  assert.deepEqual(message, before)
})

check('연말의 상대 날짜·요일·윤년을 학교 기준일로 계산하고 날짜 하나만 받는다', () => {
  for (const [reply, date] of [['내일까지', '2026-12-31'], ['모레', '2027-01-01'],
    ['다음 주 금요일까지', '2027-01-08'], ['2028년 2월 29일', '2028-02-29'],
    ['기한: 2027/1/2', '2027-01-02'], ['12월 31일', '2026-12-31'], ['내년 2월 2일', '2027-02-02'], ['다음 주 금요일로 해줘', '2027-01-08']]) {
    assert.deepEqual(parseDraftReply(collection, reply), { kind: 'fields', dueDate: date }, reply)
  }
  for (const reply of ['2027-02-29', '2026-11-01', '내일이나 모레', '내일 오후 3시', '다음 달']) {
    assert.equal(parseDraftReply(collection, reply).kind, 'clarify', reply)
  }
})

check('수합 기한·이름은 어느 순서로 답해도 원문이나 선택 대상을 변경하지 않는다', () => {
  const before = structuredClone(collection)
  const expected = { kind: 'fields', dueDate: '2026-12-31', query: '김다솜' }
  for (const reply of ['기한은 내일까지, 제출 대상은 김다솜 선생님', '대상: 김다솜 선생님, 기한: 내일', '내일까지 김다솜 선생님']) {
    assert.deepEqual(parseDraftReply(collection, reply), expected, reply)
  }
  assert.deepEqual(parseDraftReply({ ...collection, dueDate: '2026-12-31' }, '대상: 박선우'), { kind: 'fields', query: '박선우' })
  assert.deepEqual(collection, before)
})

check('제목을 물었을 때 기한 답변만 구분하고 날짜가 들어간 실제 제목은 그대로 받는다', () => {
  const deadline = text => isDeadlineReplyWhileNaming(text, parseDraftReply(collection, text))
  for (const text of ['기한은 내일까지', '제출 기한 12월 31일', '내일까지', '마감일: 2027-02-29',
    '기한: 내일이나 모레', '기한은 내일까지, 제출 대상은 김다솜 선생님']) {
    assert.equal(deadline(text), true, text)
  }
  for (const text of ['내일', '내일 체험학습 안내', '12월 31일까지 제출할 계획서', '기한 관리 안내',
    '마감일 12월 31일 대비 계획서']) {
    assert.equal(deadline(text), false, text)
  }
})

check('일괄 발송·다른 명령·여러 이름·불명확한 날짜는 기존 초안에서 안내한다', () => {
  for (const reply of ['김다솜에게 보내줘', '모든 교사에게', '기한: 나중에', '김다솜과 이수진', '김다솜, 이수진',
    '내일부터 다음 주 월요일', '자료 공개해줘', '알아서 해줘', '내일?']) {
    assert.equal(parseDraftReply(collection, reply).kind, 'clarify', reply)
  }
  assert.deepEqual(parseDraftReply(message, '초안 취소'), { kind: 'cancel' })
})
