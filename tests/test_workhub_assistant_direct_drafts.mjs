import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { parseWorkspaceCommand, COLLECTION_TEXT_LIMITS } = await loadBrowserModule(
  "export { parseWorkspaceCommand } from '../apps/workhub/src/assistant/workspace-commands.ts'; " +
  "export { COLLECTION_TEXT_LIMITS } from '../apps/workhub/src/collections/text-limits.ts';",
)
const parse = prompt => parseWorkspaceCommand(prompt, '2026-11-04')
function test(name, run) { run(); console.log('  ✓ ' + name) }

test('명시한 메시지 본문만 옮기고 문장부호·줄바꿈과 원 요청을 보존한다', () => {
  const body = '내일 회의 자료를 확인해 주세요.\n학년별  양식입니다!'
  for (const prompt of ['메시지 초안: ' + body, '비서야, 메시지 초안：' + body, body + ' 라는 내용으로 메시지 초안 만들어줘', '“' + body + '”라는 내용으로 메시지 초안 만들어줘']) {
    assert.deepEqual(parse(prompt), { kind: 'messageDraft', prompt, body })
  }
})
test('콜론 뒤 본문·제목의 사용법과 금지 표현을 바깥 질문으로 오인하지 않는다', () => {
  for (const body of ['새 출결 시스템 사용법을 확인해 주세요.', '내일 자료를 출력하지 말고 원본을 가져오세요.']) {
    const prompt = '메시지 초안: ' + body
    assert.deepEqual(parse(prompt), { kind: 'messageDraft', prompt, body })
  }
  const title = '교실 기자재 사용법', prompt = '수합 초안: ' + title
  assert.deepEqual(parse(prompt), { kind: 'collectionDraft', prompt, title, instructions: '' })
  assert.equal(parse(prompt + '\n안내: 기기 사용법을 확인해 주세요.\n대상: 전체')?.kind, 'clarify')
  for (const question of ['메시지 초안의 사용법을 알려줘', '수합 초안: 계획서라는 표현이 괜찮나요?',
    '메시지 초안: 안녕이라고 입력하면 어떻게 돼?']) assert.equal(parse(question), null)
})
test('날짜·대상·파일처럼 보이는 본문은 일반 텍스트로만 옮긴다', () => {
  const body = '전체 회의는 내일입니다. 계획서.hwpx를 참고해 주세요.'
  const prompt = '메시지 초안: ' + body
  assert.deepEqual(parse(prompt), { kind: 'messageDraft', prompt, body })
})
test('수합 제목만 있을 때는 안내와 나머지 업무 필드를 채우지 않는다', () => {
  const title = '현장체험학습 계획서'
  for (const prompt of ['수합 초안: ' + title, title + '라는 제목으로 자료 수합 초안을 작성해 주세요.']) {
    assert.deepEqual(parse(prompt), { kind: 'collectionDraft', prompt, title, instructions: '' })
  }
})
test('안내에 명시한 여러 줄을 보존하고 첨부나 기한을 설정하지 않는다', () => {
  const instructions = '학급별 계획을 적어 주세요.\r\n계획서.hwpx를 확인해 주세요.'
  const prompt = '수합 초안: 현장체험학습 계획서\r\n안내： ' + instructions
  assert.deepEqual(parse(prompt), { kind: 'collectionDraft', prompt, title: '현장체험학습 계획서', instructions })
})
test('제목 누락·안내 형식 오류·길이 초과를 구분하고 일부만 옮기지 않는다', () => {
  const prefix = '자료 수합 초안: ', title = '가'.repeat(COLLECTION_TEXT_LIMITS.title)
  const instructions = '안'.repeat(COLLECTION_TEXT_LIMITS.instructions)
  assert.equal(parse(prefix + title + '\n안내: ' + instructions).kind, 'collectionDraft')
  for (const prompt of ['메시지 초안:', prefix, prefix + '\n안내: 제목 누락', prefix + title + '가',
    prefix + '계획서\n안내: ' + instructions + '안', prefix + '계획서\n제목과 구분되지 않은 입력']) {
    assert.equal(parse(prompt)?.kind, 'clarify', prompt)
  }
})
test('편집기가 거절할 제목 탭은 비서에서 확인하고 안내의 탭은 그대로 옮긴다', () => {
  assert.equal(parse('수합 초안: 학년별\t계획서')?.kind, 'clarify')
  const title = '학년별 계획서', instructions = '준비물\t수량', prompt = '수합 초안: ' + title + '\n안내: ' + instructions
  assert.deepEqual(parse(prompt), { kind: 'collectionDraft', prompt, title, instructions })
})
test('대상 지정·발송·게시·여러 명령은 초안을 열지 않는다', () => {
  for (const prompt of [
    '메시지 초안: 전체 교사에게 바로 보내줘', '메시지 초안을 만들어 전체에게 발송해줘',
    '수합 초안을 만들어 바로 게시해 주세요', '수합 초안: 계획서\n대상: 전체',
    '수합 초안: 계획서\n안내: 확인해 주세요.\n마감일: 내일',
    '수합 초안: 계획서\n안내: 확인해 주세요.\n첨부: 계획서.hwpx',
    '메시지 초안: 오늘 회의\n메시지 초안: 내일 회의', '메시지 초안: 안녕하세요; 수합 초안: 계획서',
    '계획서를 만들고 보내줘라는 내용으로 메시지 초안 만들어줘',
    '메시지 초안: 안내\n할 일 추가: 후속 업무', '메시지 초안을 만들어서 전체에게 보내 주세요',
  ]) assert.equal(parse(prompt)?.kind, 'clarify', prompt)
})
test('일반 글쓰기·문체 수정·사용법·인용·다른 화면 자료는 초안 명령이 아니다', () => {
  for (const prompt of [
    '내일 회의 안내 메시지 초안 만들어줘', '학부모 안내 메시지를 정중하게 써줘',
    '메시지 초안을 더 정중하게 바꿔줘', '현장체험 안내 수합 초안을 구상해줘',
    '수합 초안을 어떻게 만드나요?', '예시: 메시지 초안: 확인해 주세요',
    '“메시지 초안: 확인해 주세요”', '메시지 초안: 안녕이라고 입력하면 어떻게 돼?',
    '참고 자료: 안녕이라는 내용으로 메시지 초안 만들어줘',
    '학생 기록: 안녕이라는 내용으로 메시지 초안 만들어줘',
    'AI 답변: 안녕이라는 내용으로 메시지 초안 만들어줘',
  ]) assert.equal(parse(prompt), null, prompt)
})
test('원문 길이·제어문자 검사는 자유 초안에도 그대로 적용한다', () => {
  for (const prompt of ['메시지 초안: ' + '가'.repeat(4001), '수합 초안: 계획\u0000서', '메시지 초안: \ud800'])
    assert.equal(parse(prompt)?.kind, 'clarify', prompt)
})
