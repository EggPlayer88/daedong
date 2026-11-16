import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspacePlan: parse, parseWorkspaceCommand, WORKSPACE_PLAN_MAX_STEPS } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/workspace-plan.ts'
  export * from '../apps/workhub/src/assistant/workspace-commands.ts'
`)
const day = '2026-11-11', plan = text => parse(text, day)
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name, error) } }

test('두 완전한 명령은 순서와 원문을 보존한 검토 목록으로만 만든다', () => {
  const prompt = '시간표 보여줘 그리고 교사 명부 보여줘', result = plan(prompt)
  assert.equal(result.kind, 'plan'); assert.equal(result.prompt, prompt); assert.equal(result.basisDate, day)
  assert.deepEqual(result.steps.map(step => [step.id, step.prompt, step.command]), [
    ['step-1', '시간표 보여줘', {kind:'navigate',page:'timetable'}],
    ['step-2', '교사 명부 보여줘', {kind:'specialist',task:'schoolRoster'}],
  ])
  assert.deepEqual(result.steps.map(step => step.label), ['시간표 열기','교사 명부·배정'])
  assert.equal('requestKey' in result, false); assert.equal('status' in result.steps[0], false)
})

test('번호 목록은 메시지·수합·일정의 입력과 상대 날짜를 기준일에 고정한다', () => {
  const prompt = '1. 메시지 초안: 안내장을 확인해 주세요.\n2. 내일 15:00~16:00 회의 일정 만들어줘\n3. 자료 수합 초안: 운영 자료\n안내: 내용을 채워 주세요.'
  const result = plan(prompt); assert.equal(result.kind, 'plan')
  assert.equal(result.steps[0].command.body, '안내장을 확인해 주세요.')
  assert.equal(result.steps[1].command.date, '2026-11-12')
  assert.equal(result.steps[2].command.title, '운영 자료')
  assert.equal(result.steps[2].command.instructions, '내용을 채워 주세요.')
  assert.equal(result.steps[2].prompt, '자료 수합 초안: 운영 자료\n안내: 내용을 채워 주세요.')
})

test('개인 할 일 변경은 대상을 고르고 검토할 명령만 유지한다', () => {
  const result = plan('내 할 일 보여줘; 안내장 확인 할 일 완료해줘')
  assert.equal(result.kind, 'plan'); assert.equal(result.steps[1].command.kind, 'taskChange')
  assert.equal(result.steps[1].command.change.kind, 'complete')
  assert.equal(result.steps[1].label, '할 일 완료 검토')
})

test('한 단계라도 지원하지 않거나 위험한 확정 지시면 일부만 실행하지 않는다', () => {
  for (const text of [
    '시간표 보여줘 그리고 없는 메뉴 열어줘',
    '없는 메뉴 열어줘 그리고 시간표 보여줘',
    '권한을 넓혀줘 그리고 시간표 보여줘',
    '시간표 보여줘 그리고 이 메시지 전송해줘',
    '1. 메시지 초안: 안내\n2. 전체 공개해줘',
    '1. 시간표 보여줘\n2. 학교 자료 찾아줘',
    '1. 시간표 보여줘\n2. 시간표 교환은 어떻게 하나요',
  ]) {
    const result = plan(text); assert.equal(result.kind, 'clarify', text); assert.equal('steps' in result, false)
  }
})

test('한 건의 본문·검색어에 들어 있는 접속사와 명령을 작업 목록으로 자르지 않는다', () => {
  for (const text of [
    '메시지 초안: 안내장 그리고 동의서를 확인해 주세요.',
    '메시지 초안: 시간표 보여줘 그리고 교사 명부 보여줘',
    '수합 초안: 시간표 보여줘\n안내: 교사 명부 보여줘',
    '학교 자료 검색: 시간표 보여줘; 교사 명부 보여줘',
    '검색: 시간표 보여줘 그리고 교사 명부 보여줘',
    '할 일 추가: 시간표 보여줘 그리고 교사 명부 보여줘',
    '일정 초안: 시간표 보여줘 그리고 교사 명부 보여줘',
  ]) assert.equal(plan(text), null, text)
})

test('인용된 본문과 검색어 안의 접속사는 그대로 유지한다', () => {
  const result = plan('학교 자료에서 "검토 그리고 수정" 찾아줘 그리고 교사 명부 보여줘')
  assert.equal(result.kind,'plan'); assert.equal(result.steps[0].command.query, '검토 그리고 수정')
  const message = plan('1. “시간표 보여줘 그리고 교사 명부 보여줘”라는 내용으로 메시지 초안 만들어줘\n2. 시간표 보여줘')
  assert.equal(message.kind,'plan'); assert.equal(message.steps[0].command.body, '시간표 보여줘 그리고 교사 명부 보여줘')
})

test('두 번째 단계 본문 안의 명령도 세 번째 업무로 분리하지 않는다', () => {
  const result = plan('시간표 보여줘 그리고 메시지 초안: 시간표 보여줘 그리고 교사 명부 보여줘')
  assert.equal(result.kind,'plan'); assert.equal(result.steps.length,2)
  assert.equal(result.steps[1].command.body,'시간표 보여줘 그리고 교사 명부 보여줘')
  const search = plan('시간표 보여줘; 학교 자료 검색: 시간표 보여줘 그리고 교사 명부 보여줘')
  assert.equal(search.kind,'plan'); assert.equal(search.steps.length,2)
  assert.equal(search.steps[1].command.query,'시간표 보여줘 그리고 교사 명부 보여줘')
})

test('전체 인용·예시·일반 대화의 일부를 실행 계획으로 승격하지 않는다', () => {
  for (const text of [
    '“시간표 보여줘 그리고 교사 명부 보여줘”',
    '예시: 시간표 보여줘 그리고 교사 명부 보여줘',
    'AI 답변: 시간표 보여줘 그리고 교사 명부 보여줘',
    '학교 자료를 어떻게 정리할까 그리고 시간표 보여줘',
    '시간표를 열지 말고 그리고 교사 명부 보여줘',
    '교사 명부 보여줘라고 말하면 그리고 시간표 보여줘',
  ]) assert.equal(plan(text), null, text)
})

test('번호로 정리한 일반 질문은 AI 대화로 남기고 실행 업무가 섞이면 전체 보류한다', () => {
  for (const text of [
    '1. 교사 협업이 왜 어려울까?\n2. 개선 방향은?',
    '1) 회의가 길어지는 원인은 무엇일까?\n2) 모두가 의견을 내는 방법은?',
    '1. 현재 학교 운영의 장점\n2. 앞으로의 개선 방향',
    '1. 협업이 어려운 이유를 설명해줘\n2. 개선 방법을 제안해줘',
    '1. 없는 메뉴 열어줘\n2. 권한을 넓혀줘',
  ]) assert.equal(plan(text), null, text)
  for (const text of [
    '1. 교사 협업이 왜 어려울까?\n2. 교사 명부 보여줘',
    '1. 시간표 보여줘\n2. 개선 방향은?',
  ]) assert.equal(plan(text)?.kind, 'clarify', text)
})

test('번호 누락·중복·빈 단계와 여분 구분자를 조용히 버리지 않는다', () => {
  for (const text of [
    '1. 시간표 보여줘\n3. 교사 명부 보여줘',
    '2. 시간표 보여줘\n3. 교사 명부 보여줘',
    '1. 시간표 보여줘\n1. 교사 명부 보여줘',
    '1. 시간표 보여줘\n2. \n3. 교사 명부 보여줘',
    '시간표 보여줘;;교사 명부 보여줘',
    '시간표 보여줘 그리고 ',
  ]) assert.equal(plan(text)?.kind, 'clarify', text)
})

test('최대 4개를 넘는 요청은 잘라서 부분 목록을 만들지 않는다', () => {
  assert.equal(WORKSPACE_PLAN_MAX_STEPS,4)
  const four = ['시간표 보여줘','교사 명부 보여줘','평가 기록 보여줘','업무 인계 준비해줘']
  assert.equal(plan(four.join(' 그리고 ')).steps.length,4)
  for (const text of [[...four,'문서함 열어줘'].join(' 그리고 '), [...four,'문서함 열어줘'].map((x,i)=>`${i+1}. ${x}`).join('\n')]) {
    const result=plan(text);assert.equal(result.kind,'clarify');assert.equal('steps' in result,false)
  }
})

test('한 요청·빈 입력은 단일 경로에 남기고 제어문자와 잘못된 입력은 보류한다', () => {
  for (const text of ['', ' ', '시간표 보여줘', '활동 자료 가져오기 시작해줘', '1. 시간표 보여줘']) assert.equal(plan(text),null)
  for (const text of [null, {}, '가'.repeat(4001), '시간표 보여줘\u0000 그리고 교사 명부 보여줘', '시간표 보여줘 그리고 \ud800교사 명부 보여줘']) assert.equal(plan(text).kind,'clarify')
})

test('줄바꿈·호출말·다음 순서의 표기도 원문과 분야를 유지한다', () => {
  for (const separator of ['\n','\r\n',';','；',' 그다음 ',' 그 다음에 ',' 이어서 ']) {
    const result=plan('비서야, 시간표 보여줘'+separator+'교사 명부 보여줘')
    assert.equal(result.kind,'plan');assert.equal(result.steps[0].command.page,'timetable');assert.equal(result.steps[1].command.task,'schoolRoster')
  }
})

test('U5 할 일 추가하고 일정도 추가 요청은 원문을 보존한 두 단계 후보로만 만든다', () => {
  const prompt = '[TP1 U5] 협의회 자료 확인 할 일 추가하고, 11월 19일 오후 3시에 [TP1 U5] 평가 협의회 일정도 추가해줘'
  const result = plan(prompt)
  assert.equal(result.kind,'plan'); assert.equal(result.prompt,prompt); assert.equal(result.basisDate,day)
  assert.deepEqual(result.steps.map(step => step.prompt),[
    '[TP1 U5] 협의회 자료 확인 할 일 추가해줘',
    '11월 19일 오후 3시에 [TP1 U5] 평가 협의회 일정 추가해줘',
  ])
  assert.deepEqual(result.steps.map(step => step.command.kind),['task','calendar'])
  const calendar = result.steps[1].command
  assert.equal(calendar.title,'[TP1 U5] 평가 협의회'); assert.equal(calendar.date,'2026-11-19')
  assert.equal(calendar.startTime,'15:00'); assert.equal(calendar.endTime,null)
  for (const step of result.steps) {
    assert.deepEqual(parseWorkspaceCommand(step.prompt,day),step.command)
    assert.equal('requestKey' in step,false); assert.equal('status' in step,false)
  }
})

test('U5 명시한 등록 동사·존댓말만 정규화하고 날짜와 내용은 바꾸지 않는다', () => {
  for (const ending of ['주세요','주실 수 있나요?','주실 수 있을까요?','줄 수 있을까요?']) {
    const result=plan('비서야, 안내장 확인 할 일로 등록하고， 내일 종일 평가 회의 일정도 등록해 ' + ending)
    assert.equal(result.kind,'plan')
    assert.equal(result.steps[0].prompt,'안내장 확인 할 일로 등록해줘')
    assert.equal(result.steps[1].command.title,'평가 회의')
    assert.equal(result.steps[1].command.date,'2026-11-12')
    assert.equal(result.steps[1].command.allDay,true)
  }
})

test('U5 인용 본문·검색어·시험 표식과 한 건의 할 일은 접속어로 분리하지 않는다', () => {
  const inside='자료 확인 할 일 추가하고, 내일 회의 일정도 추가해줘'
  for(const prompt of [
    '메시지 초안: '+inside,
    '학교 자료 검색: '+inside,
    '할 일 추가: '+inside,
    '김혜진 선생님에게 “'+inside+'” 메시지 써줘',
    '“'+inside+'”라는 내용으로 메시지 초안 만들어줘',
    '['+inside+'] 자료 정리 할 일 추가해줘',
    '자료 확인하고, 결과도 정리하는 할 일 추가해줘',
    '1. 자료 확인하고, 결과도 정리하는 할 일 추가해줘',
  ]) assert.equal(plan(prompt),null,prompt)
})

test('U5 조건부·부정·여러 날짜와 섞인 명령을 일부만 후보로 만들지 않는다', () => {
  for (const prompt of [
    '만약 회의가 확정되면 자료 확인 할 일 추가하고, 내일 회의 일정도 추가해줘',
    '자료 확인이 끝나면 안내 할 일 추가하고, 내일 회의 일정도 추가해줘',
    '자료는 등록하지 말고 확인 할 일 추가하고, 내일 회의 일정도 추가해줘',
    '자료 확인 할 일 추가하고, 11월 19일 수요일 회의 일정도 추가해줘',
    '자료 확인 할 일 추가하고, 내일과 모레 회의 일정도 추가해줘',
    '자료 확인 할 일 추가하고, 계획서 수합 요청해줘 그리고 내일 회의 일정도 추가해줘',
    '자료 확인 할 일 추가하고, 기록 검토 할 일 추가하고, 내일 회의 일정도 추가해줘',
  ]) assert.notEqual(plan(prompt)?.kind,'plan',prompt)
})

test('R1 접속 요청의 조건절을 독립된 두 업무로 승격하지 않는다', () => {
  for (const condition of ['비가 오면','학교에 가면','검토하면','회의가 끝나면','자료가 있으면','자료가 없으면','준비되면','승인이라면','참석한다면','확인해주면','결과가 좋으면','비가 오면,']) {
    for (const prompt of [
      `자료 확인 할 일 추가하고, ${condition} 내일 회의 일정도 추가해줘`,
      `${condition} 자료 확인 할 일 추가하고, 내일 회의 일정도 추가해줘`,
    ]) {
      assert.equal(plan(prompt),null,prompt)
      assert.equal(parseWorkspaceCommand(prompt,day)?.kind,'clarify',prompt)
    }
  }
})

test('R1 인용 제목의 조건 표현은 내용으로 보존하고 번호 목록과 본문 문법은 유지한다', () => {
  const prompt='자료 “비가 오면 확인” 할 일 추가하고, 내일 “자료가 있으면 검토” 회의 일정도 추가해줘'
  const result=plan(prompt)
  assert.equal(result?.kind,'plan');assert.equal(result.prompt,prompt)
  assert.equal(result.steps[0].prompt,'자료 “비가 오면 확인” 할 일 추가해줘')
  assert.equal(result.steps[1].command.title,'“자료가 있으면 검토” 회의')
  const body='비가 오면 자료 확인 할 일 추가하고, 내일 회의 일정도 추가해줘'
  assert.equal(plan('메시지 초안: '+body),null)
  assert.equal(parseWorkspaceCommand('메시지 초안: '+body,day).body,body)
  const numbered=plan('1. 메시지 초안: '+body+'\n2. 시간표 보여줘')
  assert.equal(numbered?.kind,'plan');assert.equal(numbered.steps[0].command.body,body)
})

test('U5 안전하게 나누지 못하는 요청은 번호·줄바꿈 입력 방법을 안내한다', () => {
  const result = parseWorkspaceCommand('자료 확인 할 일 추가하고, 문서함도 열어줘',day)
  assert.equal(result.kind,'clarify'); assert.match(result.message,/번호/); assert.match(result.message,/줄을 나누/)
  const invalid = plan('시간표 보여줘 그리고 없는 메뉴 열어줘')
  assert.equal(invalid.kind,'clarify'); assert.match(invalid.message,/1\., 2\./); assert.match(invalid.message,/줄을 나누/)
})

console.log(`\n업무 단계 계획: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
