import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/setup-workbook'; export { writeTimetableXlsx } from '../apps/workhub/src/timetable/xlsx'; export { unzipSync, strFromU8 } from 'fflate';`)
const source = {
  termId: 'term', termLabel: '2026학년도 2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', referenceDay: '2026-10-19',
  sourceRevision: 2, sourceFingerprint: 'a'.repeat(64), canEdit: true,
  spaces: [{ id: 'room-b', kind: 'room', label: '과학실', capacity: null, version: 3 }, { id: 'room-a', kind: 'room', label: '음악실', capacity: 1, version: 4 }, { id: 'equipment', kind: 'equipment', label: '과학실', capacity: 2, version: 1 }],
  classes: [{ id: 'class-a', label: '1학년 1반', grade: 1 }, { id: 'class-b', label: '1학년 1반', grade: 1 }],
  courses: [{ id: 'course-b', label: '과학', inTimetable: true, teacherLabels: ['합성 교사'], studentCount: 24, link: null }, { id: 'course-a', label: '과학', inTimetable: true, teacherLabels: ['합성 교사'], studentCount: 12, link: { version: 2, studentGroup: false, classIds: ['class-a', 'class-b'], spaceIds: ['room-a', 'room-b'] } }], findings: [],
}
const clone = value => structuredClone(value), sheet = (sheets, name) => sheets.find(sheet => sheet.name === name)
const sheets = (value = source) => m.setupWorkbookSheets(value, 'school'), preview = (book, value = source, school = 'school') => m.previewSetupWorkbook(book, value, school)
const spaceRow = (book, id = 'room-b') => sheet(book, '공간').rows.find(row => row[0] === id)
const courseRow = (book, id = 'course-b') => sheet(book, '수업연결').rows.find(row => row[0] === id)
let checks = 0
async function check(name, run) { await run(); checks++; console.log('  ✓ ' + name) }
await check('현재 원본을 그대로 가져오면 저장 명령이 없고 미완성 입력을 임의로 채우지 않는다', () => {
  const book = sheets(), result = preview(book)
  assert.equal(result.items.length, 0); assert.equal(result.unchanged, 5); assert.equal(spaceRow(book)[3], '')
  assert.equal(result.sourceKey, m.setupWorkbookSourceKey(source, 'school')); assert.match(result.notices.join(' '), /미입력.*연결되지/)
})
await check('공간과 연결 변경은 명시 ID·현재 판의 저장 명령으로 만들고 공백·배열 순서를 보존한다', () => {
  const book = sheets(); spaceRow(book)[2] = '  탐구실  '; spaceRow(book)[3] = '3'
  courseRow(book)[3] = 'class-b|class-a'; courseRow(book)[5] = 'room-b|equipment'
  const result = preview(book)
  assert.deepEqual(result.items.map(row => row.id), ['space:room-b', 'course:course-b'])
  assert.deepEqual(result.items[0].command, { kind: 'space_save', spaceId: 'room-b', expectedVersion: 3, input: { kind: 'room', label: '  탐구실  ', capacity: 3 } })
  assert.deepEqual(result.items[1].command, { kind: 'course_link', courseId: 'course-b', expectedVersion: null, input: { classIds: ['class-b', 'class-a'], studentGroup: false, spaceIds: ['room-b', 'equipment'] } })
  assert.match(result.items[1].after[0], /class-b.*class-a/); assert.match(result.items[1].after[1], /원본 이름·ID.*과학실.*room-b/)
  assert.equal(source.spaces[0].label, '과학실'); assert.equal(source.courses[0].link, null)
})
await check('행 순서·연결 ID 순서만 바꾼 파일은 중복 저장 명령을 만들지 않는다', () => {
  const book = sheets(); courseRow(book, 'course-a')[3] = 'class-b|class-a'; courseRow(book, 'course-a')[5] = 'room-b|room-a'
  for (const name of ['기준', '공간', '수업연결', '공식학급', '공식수업']) { const current = sheet(book, name); current.rows = [current.rows[0], ...current.rows.slice(1).reverse()] }
  assert.equal(preview(book).items.length, 0)
})
await check('공백만 달라진 이름은 중복 저장하지 않지만 실제 변경에서는 원문 공백을 지우지 않는다', () => {
  const book = sheets(); spaceRow(book)[2] = '  과학실  '; assert.equal(preview(book).items.length, 0)
  spaceRow(book)[3] = '2'; assert.equal(preview(book).items[0].command.input.label, '  과학실  ')
})
await check('명령 순서는 엑셀 행 순서와 무관하게 공간·수업별 ID 순으로 고정한다', () => {
  const book = sheets(); spaceRow(book)[3] = '2'; spaceRow(book, 'room-a')[3] = '3'; courseRow(book)[3] = 'class-b'; courseRow(book, 'course-a')[3] = 'class-a'
  assert.deepEqual(preview(book).items.map(item => item.id), ['space:room-a', 'space:room-b', 'course:course-a', 'course:course-b'])
})
await check('같은 이름 학급은 ID로 구분하고 이름으로 추정해 연결하지 않는다', () => {
  const book = sheets(); courseRow(book)[3] = 'class-b'
  assert.deepEqual(preview(book).items[0].command.input.classIds, ['class-b'])
  assert.match(preview(book).items[0].after[0], /1학년 1반 \[class-b\]/)
  courseRow(book)[3] = '1학년 1반'; assert.throws(() => preview(book), /수업연결 시트 2행 D열/)
})
await check('별도 수강집단과 빈 공간 선택을 명시 명령으로 보존한다', () => {
  const book = sheets(); courseRow(book)[4] = '예'
  assert.deepEqual(preview(book).items[0].command.input, { classIds: [], studentGroup: true, spaceIds: [] })
  courseRow(book)[4] = '아니오'; assert.equal(preview(book).items.length, 0)
})
await check('기존 연결을 모두 비우는 변경도 미연결 상태로 설명한다', () => {
  const book = sheets(); const row = courseRow(book, 'course-a'); row[3] = ''; row[5] = ''
  const result = preview(book); assert.equal(result.items[0].command.expectedVersion, 2); assert.match(result.items[0].after[0], /미연결/)
  assert.match(result.notices.join(' '), /2개 수업/)
})
await check('이미 입력한 동시수업수를 지우면 null 저장이며 확인 안내를 남긴다', () => {
  const book = sheets(); spaceRow(book, 'room-a')[3] = ''
  const result = preview(book); assert.equal(result.items[0].command.input.capacity, null); assert.match(result.notices[0], /2개 공간/)
})
for (const [label, mutate] of [
  ['학교', book => sheet(book, '기준').rows.find(row => row[0] === '학교')[1] = 'other'],
  ['학기', book => sheet(book, '기준').rows.find(row => row[0] === '학기')[1] = 'other'],
  ['기준일', book => sheet(book, '기준').rows.find(row => row[0] === '기준일')[1] = '2026-10-20'],
  ['기준판', book => sheet(book, '기준').rows.find(row => row[0] === '기준판')[1] = '3'],
  ['원본지문', book => sheet(book, '기준').rows.find(row => row[0] === '원본지문')[1] = 'b'.repeat(64)],
  ['양식판', book => sheet(book, '기준').rows.find(row => row[0] === '형식')[1] = 'timetable.workbook.v1'],
]) await check('다른 기준 파일 거부: ' + label, () => { const book = sheets(); mutate(book); assert.throws(() => preview(book), /기준 시트/) })
await check('지문이 같아도 공식 내용이나 판이 바뀐 원본에는 옛 파일을 쓰지 않는다', () => {
  for (const mutate of [s => s.courses[0].teacherLabels.push('새 교사'), s => s.spaces[0].version++, s => s.classes[0].grade = 2]) {
    const current = clone(source); mutate(current); assert.throws(() => preview(sheets(), current)); assert.notEqual(m.setupWorkbookSourceKey(current, 'school'), m.setupWorkbookSourceKey(source, 'school'))
  }
  assert.throws(() => preview(sheets(), source, 'other'), /기준 시트/)
})
await check('자정 뒤 기준일만 바뀌면 이전 파일을 현재 판의 변경 미리보기로 받고 날짜 차이를 알린다', () => {
  const book = sheets(); spaceRow(book)[3] = '2'; courseRow(book)[3] = 'class-a'
  const current = { ...clone(source), referenceDay: '2026-10-20' }, result = preview(book, current)
  assert.deepEqual(result.referenceDayChange, { from: '2026-10-19', to: '2026-10-20' })
  assert.equal(result.items.length, 2); assert.equal(result.items[0].command.expectedVersion, 3)
  assert.equal(result.items[1].command.expectedVersion, null)
  assert.equal(result.sourceKey, m.setupWorkbookSourceKey(current, 'school'))
  assert.notEqual(result.sourceKey, m.setupWorkbookSourceKey(source, 'school'))
  assert.match(result.notices.join(' '), /2026-10-19.*2026-10-20.*날짜만.*판·원본지문.*다시 확인/)
  assert.equal(sheet(book, '기준').rows.find(row => row[0] === '기준일')[1], '2026-10-19')
})
await check('여러 날 지난 파일도 실제 자료가 같으면 허용하며 같은 날 파일은 날짜 변경 표시가 없다', () => {
  const current = { ...clone(source), referenceDay: '2027-01-15' }
  assert.equal(preview(sheets(), current).unchanged, 5)
  assert.deepEqual(preview(sheets(), current).referenceDayChange, { from: source.referenceDay, to: current.referenceDay })
  assert.equal(preview(sheets()).referenceDayChange, undefined)
})
for (const [label, mutate] of [
  ['원본지문', s => s.sourceFingerprint = 'b'.repeat(64)], ['기준판', s => s.sourceRevision++],
  ['학기 ID', s => s.termId = 'other'], ['학기명', s => s.termLabel = '다른 학기'],
  ['학기 시작', s => s.firstDay = '2026-08-14'], ['학기 종료', s => s.lastDay = '2027-02-27'],
  ['공간 판', s => s.spaces[0].version++], ['공간 정원', s => s.spaces[0].capacity = 2],
  ['공간 이름', s => s.spaces[0].label = '새 과학실'], ['공간 종류', s => s.spaces[0].kind = 'equipment'],
  ['공간 추가', s => s.spaces.push({ id: 'new', kind: 'room', label: '새 공간', capacity: 1, version: 1 })],
  ['학급 학년', s => s.classes[0].grade++], ['교사', s => s.courses[0].teacherLabels.push('새 교사')],
  ['수강 인원', s => s.courses[0].studentCount++], ['편성 여부', s => s.courses[0].inTimetable = false],
  ['연결판', s => s.courses[1].link.version++], ['연결 학급', s => s.courses[1].link.classIds.pop()],
  ['연결 공간', s => s.courses[1].link.spaceIds.pop()],
  ['경고', s => s.findings.push({ code: 'COURSE_TEACHER_MISSING', targetId: 'course-b', message: '담당 없음', blocksConfirm: false })],
]) await check('자정 예외가 실제 변경을 허용하지 않는다: ' + label, () => {
  const current = { ...clone(source), referenceDay: '2026-10-20' }; mutate(current)
  assert.throws(() => preview(sheets(), current), error => error.name === 'TimetableWorkbookError')
})
await check('이전 파일의 기준일과 숨은 원본 중 한쪽만 고친 경우에도 거절한다', () => {
  const book = sheets(), current = { ...clone(source), referenceDay: '2026-10-20' }
  sheet(book, '기준').rows.find(row => row[0] === '기준일')[1] = '2026-10-18'
  assert.throws(() => preview(book, current), /원본대조/)
  const changedHidden = sheets(); sheet(changedHidden, '원본대조').rows[1][1] = sheet(changedHidden, '원본대조').rows[1][1].replace('2026-10-19', '2026-10-18')
  assert.throws(() => preview(changedHidden, current), /원본대조/)
  assert.throws(() => preview(sheets(), current, 'other'), /기준 시트/)
})
for (const day of ['2026-10-21', '2026-08-12', '2026-02-30', '2026-9-1', 'yesterday']) await check('이전 파일 예외에서도 잘못된 기준일은 거부: ' + day, () => {
  const book = sheets(); sheet(book, '기준').rows.find(row => row[0] === '기준일')[1] = day
  assert.throws(() => preview(book, { ...clone(source), referenceDay: '2026-10-20' }), /기준 시트/)
})
for (const [label, mutate, expected] of [
  ['공식 학급명', book => sheet(book, '공식학급').rows[1][1] = '다른 반', /공식학급 시트 2행 B열/],
  ['공식 교사명', book => sheet(book, '공식수업').rows[1][3] = '다른 교사', /공식수업 시트 2행 D열/],
  ['공식 수강 인원', book => sheet(book, '공식수업').rows[1][4] = '30', /공식수업 시트 2행 E열/],
  ['편성 여부', book => sheet(book, '공식수업').rows[1][2] = '아니오', /공식수업 시트 2행 C열/],
  ['공간 종류', book => spaceRow(book)[1] = 'equipment', /공간 시트 2행 B열/],
  ['공간 판', book => spaceRow(book)[4] = '4', /공간 시트 2행 E열/],
  ['수업명', book => courseRow(book)[1] = '생물', /수업연결 시트 2행 B열/],
  ['연결판', book => courseRow(book)[2] = '1', /수업연결 시트 2행 C열/],
  ['숨은 대조', book => sheet(book, '원본대조').rows[1][1] += '바꿈', /원본대조/],
]) await check('수정 금지 원본 거부: ' + label, () => { const book = sheets(); mutate(book); assert.throws(() => preview(book), expected) })
for (const name of ['공간', '수업연결', '공식학급', '공식수업', '기준']) {
  for (const mode of ['행 누락', '중복 ID', '새 ID']) await check(name + ' ' + mode + ' 거부', () => {
    const book = sheets(), current = sheet(book, name)
    if (mode === '행 누락') current.rows.pop()
    else if (mode === '중복 ID') current.rows.push(clone(current.rows[1]))
    else { const row = clone(current.rows[1]); row[0] = 'new'; current.rows.push(row) }
    assert.throws(() => preview(book), new RegExp(name + ' 시트'))
  })
}
for (const [label, mutate] of [
  ['누락 시트', book => book.pop()], ['중복 시트', book => book.push(clone(book[0]))], ['추가 시트', book => book.push({ name: '추가', rows: [] })],
  ['열 이름 변경', book => sheet(book, '공간').rows[0][2] = '새 이름'], ['추가 열 값', book => sheet(book, '공간').rows[1].push('추가')],
]) await check('양식 구조 오류: ' + label, () => { const book = sheets(); mutate(book); assert.throws(() => preview(book)) })
for (const value of ['0', '-1', '1.5', '1e2', '01', ' 2 ', '1001', '2개', '=1+1']) await check('정수 이외 동시수업수 거부: ' + value, () => {
  const book = sheets(); spaceRow(book)[3] = value; assert.throws(() => preview(book), /공간 시트 2행 D열/)
})
await check('동시수업수 상한과 글자수 상한은 기존 계약을 그대로 따른다', () => {
  const book = sheets(); spaceRow(book)[2] = '😀'.repeat(100); spaceRow(book)[3] = '1000'; assert.equal(preview(book).items[0].command.input.capacity, 1000)
  spaceRow(book)[2] += '😀'; assert.throws(() => preview(book), /C열/)
})
for (const value of ['', '   ', '과학\n실', '\ud800']) await check('공간 이름의 공백·제어 문자·깨진 문자 거부', () => {
  const book = sheets(); spaceRow(book)[2] = value; assert.throws(() => preview(book), /공간 시트 2행 C열/)
})
await check('같은 종류의 이름 중복은 한 파일의 새 이름끼리도 거부한다', () => {
  const book = sheets(); spaceRow(book)[2] = '새 이름'; spaceRow(book, 'room-a')[2] = '새 이름'; assert.throws(() => preview(book), /중복/)
  spaceRow(book)[2] = '음악실'; assert.throws(() => preview(book), /같은 종류/)
})
for (const [label, mutate, expected] of [
  ['학급 중복', row => row[3] = 'class-a|class-a', /D열/], ['학급 공백', row => row[3] = 'class-a |class-b', /D열/],
  ['학급 빈 구분', row => row[3] = 'class-a|', /D열/], ['학급 없음', row => row[3] = 'missing-class', /D열/],
  ['공간 없음', row => row[5] = 'missing-room', /F열/], ['공간 중복', row => row[5] = 'room-b|room-b', /F열/],
  ['예·아니오 외', row => row[4] = 'true', /E열/], ['학급과 집단 함께', row => { row[3] = 'class-a'; row[4] = '예' }, /E열/],
  ['학급 개수', row => row[3] = Array.from({ length: 21 }, (_, i) => 'c' + i).join('|'), /D열/],
  ['공간 개수', row => row[5] = Array.from({ length: 11 }, (_, i) => 's' + i).join('|'), /F열/],
]) await check('수업 연결 오류 위치: ' + label, () => { const book = sheets(); mutate(courseRow(book)); assert.throws(() => preview(book), expected) })
await check('원본의 깨진 참조를 그대로 두면 안내하고 실제 수정 시 현재 참조만 받는다', () => {
  const current = clone(source); current.courses[0].link = { version: 1, studentGroup: false, classIds: ['removed-class'], spaceIds: ['removed-room'] }
  const book = sheets(current); assert.match(preview(book, current).notices.join(' '), /없어진 학급·공간/)
  spaceRow(book)[3] = '2'; assert.equal(preview(book, current).items.length, 1)
  courseRow(book)[3] = 'class-a'; assert.throws(() => preview(book, current), /F열/)
  courseRow(book)[5] = 'room-b'; assert.equal(preview(book, current).items.length, 2)
})
await check('지원하지 않는 비편성 수업 ID는 원본에서 보존하되 저장 명령으로 만들지 않는다', () => {
  const current = clone(source); current.courses[0].id = '지원 불가/수업'; current.courses[0].inTimetable = false
  const book = sheets(current); assert.equal(preview(book, current).items.length, 0); assert.match(preview(book, current).notices.join(' '), /편성 대상에서 제외/)
  courseRow(book, '지원 불가/수업')[3] = 'class-a'; assert.throws(() => preview(book, current), /A열/)
})
await check('이름 변경을 선택 해제해도 연결 비교는 원본 이름과 ID로 정확히 표시한다', () => {
  const book = sheets(); spaceRow(book)[2] = '새 과학실'; courseRow(book, 'course-a')[3] = 'class-b'
  const row = preview(book).items.find(row => row.id === 'course:course-a')
  assert.match(row.before[1], /과학실 \[room-b\]/); assert.doesNotMatch(row.before[1], /새 과학실/); assert.match(row.after[1], /공간\(원본 이름·ID\): .*과학실 \[room-b\]/); assert.doesNotMatch(row.after[1], /새 과학실/)
})
await check('빈 뒤쪽 열·공백 행은 허용하되 기존 행 누락을 숨기지 않는다', () => {
  const book = sheets(); sheet(book, '공간').rows[1].push('', ''); sheet(book, '공간').rows.push([], [''])
  assert.equal(preview(book).items.length, 0); sheet(book, '공간').rows[1] = []; assert.throws(() => preview(book), /공간 행이 빠졌/)
})
await check('깨진 워크북·서버 원본은 업무용 오류로 거부한다', () => {
  for (const book of [null, {}, [null], [{ name: '공간', rows: [null] }], [{ name: '공간', rows: [[3]] }]]) assert.throws(() => preview(book), error => error.name === 'TimetableWorkbookError')
  assert.throws(() => preview(sheets(), { ...source, spaces: null }), /준비 원본/)
  assert.throws(() => m.setupWorkbookSheets(source, ''), /학교 식별자/)
})
await check('XLSX 쓰기는 숨은 원본과 편집 셀을 문자열로 보존하고 수식을 만들지 않는다', () => {
  const current = clone(source); current.spaces[0].label = '=1+1'
  const book = sheets(current), bytes = m.writeTimetableXlsx(book), files = m.unzipSync(bytes)
  assert.ok(bytes.length > 1000); assert.match(m.strFromU8(files['xl/workbook.xml']), /name="원본대조"[^>]+state="hidden"/)
  const cells = m.strFromU8(files['xl/worksheets/sheet3.xml']); assert.match(cells, /=1\+1/); assert.doesNotMatch(cells, /<f[ >]/)
  assert.equal(preview(book, current).items.length, 0)
})
await check('긴 원본과 이모지를 쪼갠 대조본은 내용 손실 없이 다시 이어진다', () => {
  const current = clone(source); current.courses = Array.from({ length: 120 }, (_, i) => ({ ...clone(source.courses[0]), id: 'course-' + i, label: '가'.repeat(98) + '😀' }))
  const book = sheets(current), parts = sheet(book, '원본대조').rows.slice(1).map(row => row[1])
  assert.ok(parts.length > 5); assert.equal(parts.join(''), m.setupWorkbookSourceKey(current, 'school')); assert.equal(preview(book, current).items.length, 0)
  assert.ok(m.writeTimetableXlsx(book).length > 1000)
})
console.log(`시간표 준비 엑셀 검사: ${checks}개 통과`)
