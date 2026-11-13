import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspaceCommand: parse, parseDraftReply, continueCalendar, resolveDraftDate } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/workspace-commands.ts'
  export * from '../apps/workhub/src/assistant/draft-followup.ts'
  export * from '../apps/workhub/src/assistant/calendar-conversation.ts'
  export * from '../apps/workhub/src/assistant/draft-date.ts'
`)
const basis = '2026-11-13'
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }

check('B2 존댓말·질문형 할 일 등록은 유료 일반 답변 대신 원 요청을 유지한다', () => {
  for (const ending of ['넣어 줄래?', '넣어 주시겠어요?', '추가해 주세요.', '넣고 싶어요']) {
    const prompt = '다음 주 금요일까지 [TP1 ddms-20261113 T05] 체험학습 안내장 초안 써야 하는데 할 일로 ' + ending
    assert.deepEqual(parse(prompt,basis), {kind:'task',prompt})
  }
})
check('B2/R3/R5 두 문장 일정의 제목·장소·대상 힌트를 분리하고 교사 ID는 추측하지 않는다', () => {
  const prompt = '11월 18일 수요일 오후 3시 30분부터 4시 30분까지 2층 협의실에서 [TP1 ddms-20261113 T01] 2학년 평가 협의회 일정 잡아줘. 대상은 김준철 선생님이야.'
  const result = parse(prompt,basis)
  assert.deepEqual(result,{kind:'calendar',prompt,title:'[TP1 ddms-20261113 T01] 2학년 평가 협의회',date:'2026-11-18',startTime:'15:30',endTime:'16:30',allDay:false,location:'2층 협의실',audienceQueries:['김준철']})
  assert.equal('memberId' in result,false)
})
check('R3 숫자나 날짜가 있는 표식·인용 제목은 지우거나 날짜로 이동하지 않는다', () => {
  for (const title of ['[TP1 11월 16일 T01] 학년 회의', '“11월 16일 발표” 학년 회의']) {
    const c = parse('11월 18일 15:00~16:00 ' + title + ' 일정 만들어줘',basis)
    assert.equal(c.title,title); assert.equal(c.date,'2026-11-18')
  }
})
check('B7 날짜 축약·요일·반 표기를 학교 기준일로 해석한다', () => {
  for (const date of ['11월 18일 수요일','11월 18일(수)','11월 18일 (수요일)','11/18','18일']) {
    const c = parse(date + ' 오후 3시 반부터 4시 반까지 학년 회의 일정 만들어줘',basis)
    assert.equal(c.kind,'calendar',date)
    assert.deepEqual([c.date,c.startTime,c.endTime,c.title],['2026-11-18','15:30','16:30','학년 회의'])
  }
})
check('B7 틀린 요일·없는 날짜·범위는 날짜 하나로 조용히 바꾸지 않는다', () => {
  for (const date of ['11월 18일 목요일','11/31','31일','11/18~19','18일과 19일'])
    assert.equal(parse(date + ' 회의 일정 만들어줘',basis)?.kind,'clarify',date)
  assert.equal(resolveDraftDate('1/2', '2026-12-30'),'2026-01-02')
  assert.equal(resolveDraftDate('18일', '2027-02-30'),null)
})
check('B7/B9 할 일 뒤에 붙은 종류 이름을 검색어에서 빼고 날짜 표현을 보존한다', () => {
  for (const date of ['11월 18일','11월 18일 수요일','11/18','18일','다음 주 수요일']) {
    for (const ending of ['로 바꿔줘','까지로 바꿔 주시겠어요?']) {
      const c = parse('수행평가 채점 할 일 기한을 ' + date + ending,basis)
      assert.equal(c.kind,'taskChange',date + ending)
      assert.equal(c.query,'수행평가 채점'); assert.deepEqual(c.change,{kind:'dueDate',value:'2026-11-18'})
    }
  }
  assert.equal(parse('[TP1 T01] 수행평가 채점 할 일을 완료해 줄래?',basis).query,'[TP1 T01] 수행평가 채점')
  assert.equal(parse('수행평가 채점 할 일 기한을 11월 18일 목요일로 바꿔줘',basis).kind,'clarify')
})
check('R13 만들고 싶어요는 복합 실행과 구별하여 빈 초안부터 준비한다', () => {
  for (const text of ['수합을 만들고 싶어요','수합 초안을 작성하고 싶습니다','11월 18일까지 계획서 수합을 만들고 싶어요']) {
    const c = parse(text,basis)
    assert.equal(c.kind,'collectionDraft',text)
    assert.equal(c.firstTurn.names.length,0)
  }
  for (const text of ['수합 만들고 메시지 보내줘','계획서 수합 작성하고 학교 자료 열어줘','수합 만들고 싶어요; 시간표 열어줘'])
    assert.notEqual(parse(text,basis)?.kind,'collectionDraft',text)
})
check('R14 수합 요청·받아줘는 제목·기한과 후보 이름을 분리하고 저장하지 않는다', () => {
  for (const action of ['수합 요청해줘','수합 받아줘','수합해 주시겠어요?']) {
    const prompt = '11월 18일까지 선수영 선생님에게 [TP1 ddms-20261113 T01] 시험 계획서 ' + action
    assert.deepEqual(parse(prompt,basis), {kind:'collectionDraft',prompt,title:'[TP1 ddms-20261113 T01] 시험 계획서',instructions:'',firstTurn:{names:['선수영'],dueDate:'2026-11-18'}})
  }
})
check('두 문장 수합의 보충 기한·대상은 내용에 덧붙이지 않는다', () => {
  const prompt = '[TP1 T07] 계획서 수합 초안 만들어줘. 대상은 선수영 선생님이야. 기한은 11월 18일 수요일이야.'
  const c = parse(prompt,basis)
  assert.equal(c.title,'[TP1 T07] 계획서'); assert.equal(c.instructions,'')
  assert.deepEqual(c.firstTurn,{names:['선수영'],dueDate:'2026-11-18'})
  for(const text of ['계획서 수합 초안 만들어줘. 대상은 전체 교사야.',
    '11월 18일까지 계획서 수합해줘. 기한은 11월 19일이야.',
    '계획서 수합해줘. 대상은 김교사에게 보내줘.']) assert.equal(parse(text,basis).kind,'clarify',text)
})
check('B7 수합 기한과 대상 이어 쓰기도 같은 날짜 규칙을 사용한다', () => {
  const draft={command:{kind:'collectionDraft',title:'시험 계획서',instructions:'',prompt:'수합 요청해줘'},selected:[],basisDate:basis,scope:'school/member'}
  for(const value of ['11월 18일 수요일','11/18','18일']) assert.deepEqual(parseDraftReply(draft,value),{kind:'fields',dueDate:'2026-11-18'})
  assert.deepEqual(parseDraftReply(draft,'대상은 김준철 선생님이야'),{kind:'fields',query:'김준철'})
  assert.equal(parseDraftReply(draft,'11월 18일 목요일').kind,'clarify')
})
check('완성한 일정 뒤 대상 보충은 초안 내용·날짜를 유지하고 후보 검색어만 추가한다', () => {
  const initial=parse('11월 18일 15:00~16:00 회의 일정 만들어줘',basis)
  const c=continueCalendar(initial,'대상은 김준철 선생님이야',basis)
  assert.equal(c.kind,'calendar')
  assert.deepEqual(c.command.audienceQueries,['김준철'])
  for(const key of ['title','date','startTime','endTime','allDay']) assert.equal(c.command[key],initial[key])
  assert.equal(continueCalendar(c.command,'대상은 임영진 선생님이야',basis).kind,'clarify')
  assert.equal(continueCalendar(initial,'대상은 전체 교사야',basis).kind,'clarify')
})
check('보충 문장처럼 보이는 인용 본문은 이름·기한으로 분리하지 않는다', () => {
  const c=parse('“계획입니다. 대상은 학생이에요.” 수합 초안 만들어줘',basis)
  assert.equal(c.title,'계획입니다. 대상은 학생이에요.')
  assert.deepEqual(c.firstTurn,{names:[]})
  for(const place of ['강당','운동장','체육관','도서관']) {
    const c=parse('내일 15:00~16:00 '+place+'에서 연수 일정 만들어줘',basis)
    assert.equal(c.location,place);assert.equal(c.title,'연수')
  }
})
check('서버 안내의 대화 예시는 실제 로컬 작성 분류기와 일치한다', () => {
  const message=parse("김준철 선생님에게 '내일 자료 확인 부탁드립니다' 메시지 써줘",basis)
  assert.equal(message.kind,'messageDraft')
  assert.equal(message.body,'내일 자료 확인 부탁드립니다')
  assert.deepEqual(message.firstTurn.names,['김준철'])
  const collection=parse('연수 결과 수합 요청해줘. 기한은 11월 18일. 대상은 김준철 선생님',basis)
  assert.equal(collection.kind,'collectionDraft')
  assert.equal(collection.title,'연수 결과')
  assert.deepEqual(collection.firstTurn,{names:['김준철'],dueDate:'2026-11-18'})
  const calendar=parse('내일 오후 3시 회의 일정 잡아줘',basis)
  assert.equal(calendar.kind,'calendar')
  assert.equal(calendar.startTime,'15:00')
})
console.log(`\nAI 실사용 표현 회귀: ${count} 묶음 통과 (유료 API 호출 없음)`)
