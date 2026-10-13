import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { parseImportTable, suggestImportMapping, prepareImportRows, findImportCandidates, IMPORT_LIMITS, IMPORT_FIELDS, fixtureData } = await loadBrowserModule(`
  export * from '../apps/workhub/src/calendar/import-table.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
`)
const member = fixtureData.memberships[0], members = fixtureData.memberships
const prepare = input => { const table = parseImportTable(input); return prepareImportRows(table, suggestImportMapping(table.headers), member, members) }
let failures = 0, passed = 0
function test(name, run) { try { run(); passed++; console.log(`  ✓ ${name}`) } catch (error) { failures++; console.error(`  ✗ ${name}: ${error.stack}`) } }

test('TSV는 BOM·CRLF·앞뒤 빈 행을 처리하고 원본 행 번호를 보존한다', () => {
  const table = parseImportTable('\uFEFF\r\n제목\t시작일\r\n협의회\t2026-10-19\r\n\r\n행사\t2026-10-20\r\n')
  assert.equal(table.delimiter, 'tab')
  assert.deepEqual(table.headers, ['제목', '시작일'])
  assert.deepEqual(table.rows, [{ line: 3, cells: ['협의회', '2026-10-19'] }, { line: 5, cells: ['행사', '2026-10-20'] }])
})
test('CSV는 쉼표·줄바꿈·큰따옴표를 포함한 인용 셀을 손실 없이 읽는다', () => {
  const table = parseImportTable('제목,시작일,설명\r\n"학교, 행사",2026-10-19,"첫 줄\r\n""인용"" 다음 줄"\r\n회의,2026-10-20,끝')
  assert.equal(table.delimiter, 'comma')
  assert.deepEqual(table.rows[0], { line: 2, cells: ['학교, 행사', '2026-10-19', '첫 줄\n"인용" 다음 줄'] })
  assert.equal(table.rows[1].line, 4)
})
test('TSV의 인용 셀 안 탭·쉼표·줄바꿈은 열 경계가 아니다', () => {
  const table = parseImportTable('제목\t시작일\t설명\n행사\t2026-10-19\t"가\t나,다\n라"')
  assert.deepEqual(table.rows[0].cells, ['행사', '2026-10-19', '가\t나,다\n라'])
})
test('구분자가 섞인 열 제목은 추정하지 않고 명시 선택을 받는다', () => {
  assert.throws(() => parseImportTable('제목,내용\t시작일\n회의\t2026-10-19'), /구분자를 직접/)
  const table = parseImportTable('제목,내용\t시작일\n회의\t2026-10-19', 'tab')
  assert.deepEqual(table.headers, ['제목,내용', '시작일'])
})
test('헤더의 인용된 구분자를 자동 판단 근거로 사용하지 않는다', () => {
  const table = parseImportTable('"제목, 행사"\t시작일\n회의\t2026-10-19')
  assert.equal(table.delimiter, 'tab')
  assert.deepEqual(table.headers, ['제목, 행사', '시작일'])
})
test('잘못된 따옴표는 셀을 임의 복원하지 않고 명확히 거부한다', () => {
  for (const text of ['제목,시작일\n"열린 셀,2026-10-19', '제목,시작일\n중간"따옴표,2026-10-19', '제목,시작일\n"회의"추가,2026-10-19']) assert.throws(() => parseImportTable(text), /따옴표/)
})
test('깨진 입력·지원하지 않는 구분자는 의도한 오류로 거부한다', () => {
  for (const input of [null, undefined, [], ['제목'], {}, 3]) assert.throws(() => parseImportTable(input), /텍스트/)
  for (const input of ['', ' \r\n\t ', '\uFEFF']) assert.throws(() => parseImportTable(input), /표를 입력/)
  assert.throws(() => parseImportTable('제목', 'pipe'), /구분자/)
})
test('처리 한도는 정확히 200개 자료·30개 열까지 허용한다', () => {
  assert.equal(parseImportTable(['제목,시작일', ...Array.from({ length: IMPORT_LIMITS.rows }, (_, index) => `행사${index},2026-10-19`)].join('\n')).rows.length, 200)
  assert.throws(() => parseImportTable(['제목', ...Array.from({ length: IMPORT_LIMITS.rows + 1 }, () => '행사')].join('\n')), /200행/)
  assert.equal(parseImportTable(Array.from({ length: 30 }, (_, index) => `열${index}`).join(',')).headers.length, 30)
  assert.throws(() => parseImportTable(Array.from({ length: 31 }, (_, index) => `열${index}`).join(',')), /30개 열/)
  assert.throws(() => parseImportTable(`제목,시작일\n행사,${','.repeat(30)}`), /30개 열/)
})
test('텍스트 처리 한도 직전과 초과를 구분한다', () => {
  assert.equal(parseImportTable('제'.repeat(IMPORT_LIMITS.text)).headers[0].length, IMPORT_LIMITS.text)
  assert.throws(() => parseImportTable('제'.repeat(IMPORT_LIMITS.text + 1)), /250,000자/)
})
test('빈 마지막 셀은 유지하고 빈 행만 건너뛴다', () => {
  assert.deepEqual(parseImportTable('제목,시작일,설명\n행사,2026-10-19,\n,,').rows, [{ line: 2, cells: ['행사', '2026-10-19', ''] }])
})
test('알려진 헤더만 제안하고 비슷한 말·중복 별칭은 비워 둔다', () => {
  const mapping = suggestImportMapping([' 원본 ID ', 'title', '시작일', '일자', '종료일 예정', '장소', '설명'])
  assert.equal(mapping.sourceId, 0); assert.equal(mapping.title, 1); assert.equal(mapping.startDate, -1)
  assert.equal(mapping.endDate, -1); assert.equal(mapping.location, 5); assert.equal(mapping.description, 6)
  for (const invalid of [null, '제목', [null, '제목']]) assert.ok(Object.values(suggestImportMapping(invalid)).every(index => index === -1))
  assert.equal(IMPORT_FIELDS.filter(field => field.required).map(field => field.key).join(','), 'title,startDate')
})
test('연도를 가진 세 날짜 형식과 윤년을 정규화한다', () => {
  const rows = prepare('제목,시작일\n가,2028-02-29\n나,2028.2.29\n다,2028/2/29')
  for (const row of rows) { assert.deepEqual(row.errors, []); assert.equal(row.draft.startDate, '2028-02-29'); assert.equal(row.draft.endDate, '2028-02-29') }
})
test('연도 생략·시트 일련번호·수식·모호한 날짜를 거부한다', () => {
  for (const date of ['10/19', '46314', '=TODAY()', '2026-1-1', '2026.1/1', '19/10/2026', '2026-10-19T00:00:00Z']) {
    const row = prepare(`제목,시작일\n행사,${date}`)[0]
    assert.equal(row.draft, undefined, date); assert.ok(row.errors.some(error => error.includes('연도가 있는')), date)
  }
})
test('존재하지 않는 날짜와 역순 기간은 기존 도메인과 함께 거부한다', () => {
  for (const date of ['2026-02-29', '2028-02-30', '2026-13-01', '2026-00-01']) assert.ok(prepare(`제목,시작일\n행사,${date}`)[0].errors.some(error => error.includes('실제 달력')))
  const row = prepare('제목,시작일,종료일\n행사,2026-10-20,2026-10-19')[0]
  assert.equal(row.draft, undefined); assert.ok(row.errors.some(error => error.includes('종료일')))
})
test('시간 두 개가 빈 경우만 종일이며 개인 공개로 초안을 만든다', () => {
  const row = prepare('제목,시작일,시작 시간,종료 시간\n 행사 ,2026-10-19,,')[0]
  assert.deepEqual(row.errors, []); assert.equal(row.draft.title, '행사')
  assert.equal(row.draft.allDay, true); assert.equal(row.draft.startTime, ''); assert.equal(row.draft.visibility, 'private')
  assert.deepEqual(row.draft.audience, { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] })
})
test('시간 범위와 자정·다음 날 기간을 정확히 판정한다', () => {
  const rows = prepare('제목,시작일,종료일,시작 시간,종료 시간\n가,2026-10-19,,00:00,00:01\n나,2026-10-19,2026-10-20,23:00,01:00')
  for (const row of rows) { assert.deepEqual(row.errors, []); assert.equal(row.draft.allDay, false) }
  for (const times of ['09:00,', ',10:00', '9:00,10:00', '09:00,24:00', '09:60,10:00', '10:00,10:00', '11:00,10:00']) assert.equal(prepare(`제목,시작일,시작 시간,종료 시간\n행사,2026-10-19,${times}`)[0].draft, undefined, times)
})
test('제목·설명·장소 길이는 기존 normalizeDraft 기준을 재사용한다', () => {
  for (const [column, value] of [['제목', '가'.repeat(101)], ['장소', '가'.repeat(101)], ['설명', '가'.repeat(2001)]]) {
    const input = column === '제목' ? `제목,시작일\n${value},2026-10-19` : `제목,시작일,${column}\n행사,2026-10-19,${value}`
    assert.equal(prepare(input)[0].draft, undefined, column)
  }
  assert.equal(prepare(`제목,시작일\n${'😀'.repeat(100)},2026-10-19`)[0].errors.length, 0)
})
test('필수 열 누락·범위 밖·중복 열 연결은 각 행에 문제를 남긴다', () => {
  const table = parseImportTable('제목,시작일\n행사,2026-10-19'), mapping = suggestImportMapping(table.headers)
  for (const override of [{ startDate: -1 }, { startDate: 20 }, { startDate: 0 }, { startDate: 0.5 }, { startDate: '1' }, { startDate: undefined }]) {
    const [row] = prepareImportRows(table, { ...mapping, ...override }, member, members)
    assert.equal(row.draft, undefined); assert.ok(row.errors.length)
  }
  assert.ok(prepareImportRows(table, null, member, members)[0].errors.length)
})
test('행의 열 개수가 다르면 부분 셀을 추측해 등록하지 않는다', () => {
  const rows = prepare('제목,시작일,설명\n행사,2026-10-19\n회의,2026-10-20,안내,추가')
  assert.equal(rows.length, 2)
  for (const row of rows) { assert.equal(row.draft, undefined); assert.ok(row.errors.some(error => error.includes('열 수'))) }
})
test('원본 ID 중복은 서로 다른 일정이어도 관련 행을 모두 차단한다', () => {
  const rows = prepare('원본 ID,제목,시작일\n same ,가,2026-10-19\nsame,나,2026-10-20\n,다,2026-10-21\n,라,2026-10-22')
  for (const row of rows.slice(0, 2)) { assert.equal(row.draft, undefined); assert.ok(row.errors.some(error => error.includes('원본 ID'))) }
  for (const row of rows.slice(2)) assert.deepEqual(row.errors, [])
})
test('동일 제목·기간·시간은 장소나 ID가 달라도 중복을 명시한다', () => {
  const rows = prepare('원본 ID,제목,시작일,장소\na, 회의 ,2026.10.19,교무실\nb,회의,2026-10-19,도서관')
  for (const row of rows) { assert.equal(row.draft, undefined); assert.ok(row.errors.some(error => error.includes('표 안에 중복'))) }
})
test('여러 잘못된 셀의 오류를 함께 표시하고 정상 행은 계속 준비한다', () => {
  const rows = prepare('제목,시작일,시작 시간,종료 시간\n,10/19,9:00,\n정상,2026-10-20,09:00,10:00')
  assert.ok(rows[0].errors.length >= 3); assert.equal(rows[0].draft, undefined)
  assert.deepEqual(rows[1].errors, []); assert.equal(rows[1].draft.title, '정상')
})
test('깨진 표·행·셀은 거부하고 빈 회원 목록은 대상 없는 개인 초안으로 처리한다', () => {
  const mapping = suggestImportMapping(['제목', '시작일'])
  for (const table of [null, {}, { headers: '제목', rows: [] }, { headers: ['제목'], rows: '깨짐' }, { headers: [null], rows: [] }]) assert.throws(() => prepareImportRows(table, mapping, member, members), /표 형식/)
  for (const row of [null, { line: 2, cells: '행사' }, { line: 2, cells: ['행사', null] }]) {
    const [result] = prepareImportRows({ headers: ['제목', '시작일'], rows: [row], delimiter: 'comma' }, mapping, member, members)
    assert.equal(result.draft, undefined); assert.ok(result.errors.some(error => error.includes('열 수')))
  }
  const table = parseImportTable('제목,시작일\n행사,2026-10-19')
  assert.deepEqual(prepareImportRows(table, mapping, member, null)[0].errors, [])
})
test('기존 일정 후보는 제목·날짜·종일·시간이 일치할 때만 반환한다', () => {
  const draft = prepare('제목,시작일,시작 시간,종료 시간\n회의,2026-10-19,09:00,10:00')[0].draft
  const base = { ...fixtureData.events[0], ...draft }
  const events = [{ ...base, id: 'same', location: '다른 장소' }, { ...base, id: 'name', title: '다른 제목' }, { ...base, id: 'time', startTime: '09:30' }, { ...base, id: 'date', endDate: '2026-10-20' }, { ...base, id: 'day', allDay: true }]
  assert.deepEqual(findImportCandidates(draft, events).map(event => event.id), ['same'])
  assert.deepEqual(findImportCandidates(draft, null), [])
  assert.deepEqual(findImportCandidates(draft, [null, '깨짐']), [])
  assert.deepEqual(findImportCandidates(null, events), [])
})
test('표·매핑·회원·기존 일정은 수정하지 않으며 행 초안끼리 공유하지 않는다', () => {
  const table = parseImportTable('제목,시작일\n가,2026-10-19\n나,2026-10-20'), mapping = suggestImportMapping(table.headers)
  const before = structuredClone({ table, mapping, member, members })
  const rows = prepareImportRows(table, mapping, member, members)
  rows[0].draft.audience.includeMemberIds.push('변경')
  assert.deepEqual(rows[1].draft.audience.includeMemberIds, [])
  assert.deepEqual({ table, mapping, member, members }, before)
  const event = { ...fixtureData.events[0], ...rows[1].draft }, snapshot = structuredClone(event)
  findImportCandidates(rows[1].draft, [event]); assert.deepEqual(event, snapshot)
})

console.log(`\n일정 표 가져오기 도메인 ${passed}개 통과, ${failures}개 실패`)
if (failures) process.exitCode = 1
