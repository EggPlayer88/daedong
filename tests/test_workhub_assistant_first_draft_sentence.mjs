import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspaceCommand: parse } = await loadBrowserModule("export { parseWorkspaceCommand } from '../apps/workhub/src/assistant/workspace-commands.ts'")
const basis = '2026-11-04'
function test(name, run) { run(); console.log('  ✓ ' + name) }

test('수신자·인용 본문은 분리하고 본문 안의 날짜·이름·줄바꿈은 문자 그대로 남긴다', () => {
  const body = '금요일까지 이한결에게 확인해 주세요.\n둘째 줄입니다.'
  const prompt = '이민준 선생님에게 “' + body + '”라는 메시지 초안 만들어줘'
  assert.deepEqual(parse(prompt,basis), {kind:'messageDraft',prompt,body,firstTurn:{names:['이민준']}})
  assert.equal(parse('이민준에게 “시간표 원문으로”로 메시지 초안을 준비해줘',basis).body,'시간표 원문으로')
  assert.equal(parse('시험 교사에게 내일 회의 자료를 확인해 달라는 메시지 초안 만들어줘',basis).body,'내일 회의 자료를 확인해 주세요')
})
test('학교 날짜·두 교사·제목·명시 안내를 분리하고 순서 변경도 허용한다', () => {
  for (const prompt of [
    '이민준 선생님과 김서진 선생님께, 제출 기한은 다음 주 금요일까지, “현장체험학습 계획서” 안내는 “변동 사항을 적어 주세요.” 수합 초안 만들어줘',
    '다음 주 금요일까지 이민준 선생님과 김서진 선생님에게 “현장체험학습 계획서” 안내는 “변동 사항을 적어 주세요.” 수합 초안 만들어줘',
    '현장체험학습 계획서를 이민준 선생님과 김서진 선생님에게 다음 주 금요일까지 안내는 “변동 사항을 적어 주세요.” 수합해줘',
  ]) {
    assert.deepEqual(parse(prompt,basis),{kind:'collectionDraft',prompt,title:'현장체험학습 계획서',instructions:'변동 사항을 적어 주세요.',
      firstTurn:{names:['이민준','김서진'],dueDate:'2026-11-13'}})
  }
})
test('첫 입력에서 빠진 본문·제목·대상·기한만 비워 둔다', () => {
  for(const [prompt,kind,content,firstTurn] of [
    ['이민준에게 메시지 초안 만들어줘','messageDraft','',{names:['이민준']}],
    ['“금요일 회의” 메시지 초안 만들어줘','messageDraft','금요일 회의',{names:[]}],
    ['내일까지 김서진 선생님께 수합 초안 만들어줘','collectionDraft','',{names:['김서진'],dueDate:'2026-11-05'}],
    ['학기말 계획서 수합 초안 만들어줘','collectionDraft','학기말 계획서',{names:[]}],
  ]) {const c=parse(prompt,basis);assert.equal(c.kind,kind);assert.equal(c.body??c.title,content);assert.deepEqual(c.firstTurn,firstTurn)}
})
test('줄이나 명시한 쉼표로 구분한 필드는 원래 안내의 여러 줄과 구두점을 유지한다', () => {
  const prompt='수합 초안: 계획서\r\n안내: 확인해 주세요.\r\n둘째 줄입니다.\r\n마감일: 내일\r\n대상: 김서진 선생님, 이민준 선생님'
  assert.deepEqual(parse(prompt,basis),{kind:'collectionDraft',prompt,title:'계획서',instructions:'확인해 주세요.\r\n둘째 줄입니다.',
    firstTurn:{names:['김서진','이민준'],dueDate:'2026-11-05'}})
  const quoted='메시지 초안: 본문: “회의 자료, 대상: 학생”\n수신자: 이민준'
  assert.deepEqual(parse(quoted,basis),{kind:'messageDraft',prompt:quoted,body:'“회의 자료, 대상: 학생”',firstTurn:{names:['이민준']}})
  const msg='메시지 초안: 안녕하세요, 반갑습니다., 수신자: 이민준'
  assert.deepEqual(parse(msg,basis),{kind:'messageDraft',prompt:msg,body:'안녕하세요, 반갑습니다.',firstTurn:{names:['이민준']}})
})
test('없거나 모호하거나 지난 기한은 채우지 않고 이미 제공한 이름·제목을 유지한다', () => {
  for(const due of ['2027-02-30','2026-11-03','금요일까지 월요일','주말','내일모레']) {
    const c=parse('이민준 선생님에게 '+due+'까지 현장체험학습 계획서 수합 초안 만들어줘',basis)
    assert.equal(c.title,'현장체험학습 계획서');assert.deepEqual(c.firstTurn.names,['이민준'])
    assert.equal(c.firstTurn.dueDate,undefined);assert.ok(c.firstTurn.dateIssue)
  }
})
test('넓은 대상·두 명령·중복 필드를 일부만 실행하지 않고 예시·문체 작성은 기존 분류를 유지한다', () => {
  assert.equal(parse('김서진에게 우리 마을 수합 초안 만들어줘',basis).title,'우리 마을')
  assert.equal(parse('우리 마을을 김서진에게 수합해줘',basis).title,'우리 마을')
  for(const prompt of ['전체 교사에게 공지 메시지 초안 만들어줘','이민준 말고 김서진에게 공지 메시지 초안 만들어줘',
    '김서진에게 수합을 공개하고 공지 메시지 초안 만들어줘','메시지 초안: 회의\n수신자: 김서진\n수신자: 이민준'])
    assert.equal(parse(prompt,basis)?.kind,'clarify',prompt)
  for(const prompt of ['예시: 김서진에게 회의 자료 메시지 초안 만들어줘','내일 회의 안내 메시지 초안 만들어줘'])
    assert.equal(parse(prompt,basis),null)
})
