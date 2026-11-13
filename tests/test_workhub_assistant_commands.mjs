import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspaceCommand: parse } = await loadBrowserModule(`export * from '../apps/workhub/src/assistant/workspace-commands.ts'`)
const day = '2026-11-03'
let passed = 0, failed = 0
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.log('  ✗ ' + name + ': ' + error.stack) } }
const command = value => parse(value, day)
const clarify = value => assert.equal(command(value)?.kind, 'clarify', value)

test('정확한 메뉴 이름과 자연스러운 이동 동사를 함께 해석한다', () => {
  for (const [text, page] of [['시간표 열어줘', 'timetable'], ['학교 일정으로 이동해 주세요.', 'calendar'], ['내 할 일 화면 보여줘', 'tasks'], ['AI 비서로 가줘', 'assistant'], ['비서야, 학교 자료실 열어주세요', 'knowledge'], ['홈 열어줄래요?', 'home'], ['메신저 띄워줘', 'messages']])
    assert.deepEqual(command(text), { kind: 'navigate', page })
})
test('모든 목적지는 현재 페이지 종류에 속하며 임의 경로를 반환하지 않는다', () => {
  for (const [text, page] of [['자료 수합 열어줘', 'collections'], ['문서함 열어줘', 'documents'], ['학교 관리 열어줘', 'schoolAdmin'], ['학생 기록 열어줘', 'students'], ['협업 요청 열어줘', 'cooperation']])
    assert.deepEqual(command(text), { kind: 'navigate', page })
  for (const text of ['https://evil.example 열어줘', '/admin 열어줘', '숨겨진 메뉴 열어줘']) assert.equal(command(text), null)
})
test('단순 조언과 사용법 질문은 명령으로 바꾸지 않는다', () => {
  for (const text of ['시간표는 어떻게 만들까?', '학교 자료를 정리하는 방법', '일정 초안 작성할 때 무엇이 필요해?', '이동해줘라는 말의 의미', '할 일 추가 기능을 설명해줘']) assert.equal(command(text), null, text)
})
test('인용·가정·부정 명령은 이동이나 저장 초안으로 실행하지 않는다', () => {
  for (const text of ["'시간표 열어줘'", '“학교 관리 열어줘”라고 하면?', '시간표 열지 마', '학교 관리로 이동하지 말고 설명해줘', '예시: 시간표 열어줘', '시간표 열어줘라고 입력하면', '할 일로 추가하지 말아줘']) assert.equal(command(text), null, text)
})
test('두 개의 명령을 일부만 실행하지 않는다', () => {
  for (const text of ['시간표 열어주고 학교 자료 찾아줘', '시간표 열고 일정 만들어줘', '학교 자료 열어줘; 내일 일정 만들어줘']) clarify(text)
})
test('학교 자료 검색은 학교 자료 원본 범위만 요청한다', () => {
  assert.deepEqual(command('학교 자료에서 출장 찾아줘'), { kind: 'search', query: '출장', kinds: ['knowledge'] })
  assert.deepEqual(command('학교 자료에서 "출장 규정" 검색해 주세요'), { kind: 'search', query: '출장 규정', kinds: ['knowledge'] })
  assert.deepEqual(command('출장 학교 자료 찾아줘'), { kind: 'search', query: '출장', kinds: ['knowledge'] })
})
test('문서·수합·일정·개인 업무·대화는 각각 기존 검색 종류를 사용한다', () => {
  for (const [scope, kind] of [['문서함', 'document'], ['수합', 'collection'], ['일정', 'calendar'], ['할 일', 'task'], ['협업', 'cooperation'], ['메신저', 'message'], ['수업', 'course']])
    assert.deepEqual(command(`${scope}에서 검토 찾아줘`), { kind: 'search', query: '검토', kinds: [kind] })
})
test('검색 단축 입력과 자료 통합 범위는 명시적이다', () => {
  assert.deepEqual(command('학교 자료 검색: 출장'), { kind: 'search', query: '출장', kinds: ['knowledge'] })
  assert.deepEqual(command('자료에서 출장 찾아줘'), { kind: 'search', query: '출장', kinds: ['knowledge', 'document'] })
  assert.deepEqual(command('검색: 출장')?.kinds, ['calendar', 'task', 'collection', 'document', 'knowledge', 'cooperation', 'message', 'course'])
})
test('검색어의 원문·인용부호는 데이터로 처리한다', () => {
  assert.equal(command('학교 자료에서 <script> 검색해줘')?.query, '<script>')
  assert.equal(command('학교 자료에서 "시간표 열어줘" 찾아줘')?.kind, 'search')
})
test('검색 한도를 넘으면 일부 검색어로 조용히 자르지 않는다', () => {
  assert.equal(command('학교 자료에서 ' + '가'.repeat(200) + ' 찾아줘')?.kind, 'search')
  clarify('학교 자료에서 ' + '가'.repeat(201) + ' 찾아줘')
})
test('할 일 명령은 서버가 해석할 원래 부탁을 보존한다', () => {
  for (const text of ['내일까지 안내장 작성 할 일로 추가해줘', '안내장 작성 개인 할 일에 등록해 주세요', '할 일 추가: 내일 안내장 작성'])
    assert.deepEqual(command(text), { kind: 'task', prompt: text })
})
test('할 일 제목을 임의로 생성하지 않는다', () => { clarify('할 일로 추가해줘'); clarify('할 일 만들어줘') })
test('일정은 제목·날짜·시간을 해석하지만 저장 요청은 만들지 않는다', () => {
  const text = '내일 오후 3시부터 4시까지 회의 일정 초안 만들어줘'
  assert.deepEqual(command(text), { kind: 'calendar', prompt: text, title: '회의', date: '2026-11-04', startTime: '15:00', endTime: '16:00', allDay: false })
})
test('24시간 범위와 입력한 연도·날짜는 그대로 유지한다', () => {
  const result = command('2027-03-02 15:00~16:30 학년 회의 일정 만들어줘')
  assert.deepEqual([result.date, result.startTime, result.endTime, result.title], ['2027-03-02', '15:00', '16:30', '학년 회의'])
})
test('날짜와 시각을 빠뜨리면 기준일이나 종료 시각으로 추정하지 않는다', () => {
  const result = command('학년 회의 일정 초안 만들어줘')
  assert.deepEqual([result.date, result.startTime, result.endTime, result.title, result.allDay], [null, null, null, '학년 회의', false])
  const partial = command('내일 오후 3시 회의 일정 만들어줘')
  assert.deepEqual([partial.startTime, partial.endTime], ['15:00', null])
})
test('월말·연말 상대 날짜는 학교 기준일에서 계산한다', () => {
  assert.equal(parse('내일 회의 일정 만들어줘', '2026-12-31').date, '2027-01-01')
  assert.equal(parse('모레 회의 일정 만들어줘', '2027-01-30').date, '2027-02-01')
  assert.equal(parse('오늘 회의 일정 만들어줘', '2026-12-31').date, '2026-12-31')
})
test('윤년과 없는 날짜를 구분한다', () => {
  assert.equal(command('2028-02-29 회의 일정 만들어줘').date, '2028-02-29')
  for (const date of ['2027-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-11-00']) clarify(`${date} 회의 일정 만들어줘`)
})
test('한국식 날짜는 명시한 연도 또는 학교 기준일의 연도를 사용한다', () => {
  assert.equal(command('2027년 3월 2일 회의 일정 만들어줘').date, '2027-03-02')
  assert.equal(command('12월 31일 회의 일정 만들어줘').date, '2026-12-31')
  assert.equal(command('2027/3/2 회의 일정 만들어줘').date, '2027-03-02')
})
test('다음 주는 월요일 시작 주간으로 계산한다', () => {
  assert.equal(command('다음 주 월요일 회의 일정 만들어줘').date, '2026-11-09')
  assert.equal(parse('다음 주 월요일 회의 일정 만들어줘', '2026-11-08').date, '2026-11-09')
  assert.equal(parse('다음 주 일요일 회의 일정 만들어줘', '2026-11-02').date, '2026-11-15')
})
test('모호한 날짜와 여러 날·반복 일정은 되묻는다', () => {
  for (const text of ['금요일 회의', '다음 달 회의', '매주 화요일 회의', '오늘부터 내일까지 회의', '2026-11-03부터 2026-11-04까지 회의']) clarify(`${text} 일정 만들어줘`)
})
test('잘못된 학교 기준일은 일정 생성에 사용하지 않는다', () => {
  for (const date of ['', '2026-02-30', 'not-date']) assert.equal(parse('내일 회의 일정 만들어줘', date).kind, 'clarify')
})
test('오전·오후 12시를 구별하며 반과 분을 보존한다', () => {
  const first = command('내일 오전 12시부터 1시 반까지 회의 일정 만들어줘')
  assert.deepEqual([first.startTime, first.endTime], ['00:00', '01:30'])
  const second = command('내일 오후 12시 10분부터 1시 20분까지 회의 일정 만들어줘')
  assert.deepEqual([second.startTime, second.endTime], ['12:10', '13:20'])
})
test('오전·오후가 없는 12시간 표기는 추정하지 않는다', () => {
  clarify('내일 3시부터 4시까지 회의 일정 만들어줘')
  clarify('내일 12시 회의 일정 만들어줘')
  assert.equal(command('내일 15시부터 16시까지 회의 일정 만들어줘').startTime, '15:00')
})
test('잘못된 시각·자정 넘김·빈 구간을 거절한다', () => {
  for (const time of ['24:00~25:00', '15:60~16:00', '오후 13시부터 14시까지', '16:00~15:00', '15:00~15:00', '오후 11시부터 오전 1시까지', '15:00:30~16:00:30']) clarify(`내일 ${time} 회의 일정 만들어줘`)
})
test('종일 일정에 시각을 덧붙이지 않는다', () => {
  const result = command('내일 종일 연수 일정 만들어줘')
  assert.deepEqual([result.allDay, result.startTime, result.endTime, result.title], [true, null, null, '연수'])
  clarify('내일 종일 오후 3시 연수 일정 만들어줘')
})
test('공개 대상·반복 여부는 암묵적으로 넓히지 않는다', () => {
  clarify('내일 전교사 회의 일정 만들어줘')
  clarify('내일 학교 전체 공개 회의 일정 만들어줘')
})
test('빈 일정 제목도 임의로 채우지 않는다', () => {
  const result = command('내일 오후 3시부터 4시까지 일정 초안 만들어줘')
  assert.equal(result.kind, 'calendar'); assert.equal(result.title, '')
})
test('삭제·승인·전송은 성공으로 꾸미거나 실행 요청을 생성하지 않는다', () => {
  for (const text of ['시간표 공개해줘', '이 메시지 전송해줘', '내 할 일 삭제해줘', '교환 승인해줘', '서류 최종 제출해줘']) clarify(text)
})
test('잘못된 텍스트·길이 초과는 검색이나 유료 질문으로 흘리지 않는다', () => {
  for (const value of [null, {}, '가'.repeat(4001), '시간표\u0000 열어줘', '시간표\u0085 열어줘', '\ud800시간표 열어줘', '시간표\udfff 열어줘']) assert.equal(parse(value, day).kind, 'clarify')
  assert.equal(command(''), null); assert.equal(command('   '), null)
})
test('정상 유니코드의 요청은 데이터 그대로 유지한다', () => {
  assert.equal(command('자료에서 🧑‍🏫 찾아줘').query, '🧑‍🏫')
  assert.equal(command('🧑‍🏫 연수 준비 할 일로 추가해줘').kind, 'task')
})
test('일반 질문의 줄바꿈과 탭을 명령 오류로 바꾸지 않는다', () => {
  assert.equal(command('학교 행사 준비를 도와줘.\n준비물과 절차를 정리해줘.'), null)
  assert.equal(command('연수 주제를\t추천해줘'), null)
  const prompt = '내일까지 안내장을 작성하고\n학년별로 확인받기 할 일로 추가해줘'
  assert.deepEqual(command(prompt), { kind: 'task', prompt })
})
test('잘못된 숫자의 뒷부분을 정상 날짜나 시각으로 해석하지 않는다', () => {
  for (const raw of ['20260-11-03 회의', '2026-11-030 회의', '내일 123시 회의', '내일 123:00 회의', '내일 15:000 회의', '내일 15시 000분 회의']) clarify(`${raw} 일정 만들어줘`)
})
test('명시한 상대 연도는 보존하고 해석하지 못한 연도를 버리지 않는다', () => {
  assert.equal(command('내년 3월 1일 회의 일정 만들어줘').date, '2027-03-01')
  assert.equal(command('내후년 3월 1일 회의 일정 만들어줘').date, '2028-03-01')
  assert.equal(command('작년 3월 1일 회의 일정 만들어줘').date, '2025-03-01')
  assert.equal(command('올해 3월 1일 회의 일정 만들어줘').date, '2026-03-01')
  clarify('내년 2026-03-01 회의 일정 만들어줘')
  clarify('금년 3월 1일 회의 일정 만들어줘')
})
test('축약한 여러 날 일정을 한 날짜로 오인하지 않는다', () => {
  clarify('2026-11-03~05 회의 일정 만들어줘')
  clarify('2026-11-03-05 회의 일정 만들어줘')
})
test('종료 시각만 제시한 경우 시작 시각으로 바꾸지 않는다', () => {
  const result = command('내일 오후 3시까지 회의 일정 만들어줘')
  assert.deepEqual([result.startTime, result.endTime], [null, '15:00'])
})
test('검색어 없는 조회는 자료 전체 수집이나 유료 답변으로 바꾸지 않는다', () => {
  clarify('학교 자료 찾아줘')
  clarify('문서 검색해줘')
  clarify('할 일 조회해 주세요')
})
console.log(`\n비서 업무 명령: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
