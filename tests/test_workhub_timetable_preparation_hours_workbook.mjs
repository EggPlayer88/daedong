import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/preparation-hours-workbook'; export { writeTimetableXlsx } from '../apps/workhub/src/timetable/xlsx'; export { unzipSync, strFromU8 } from 'fflate';`)
const source = {
  sourceRevision: 2, sourceFingerprint: 'a'.repeat(64), schoolId: 'school', schoolLevel: 'middle',
  termId: 'term', termLabel: '2026학년도 2학기', firstDay: '2026-08-13', lastDay: '2027-02-28', canEdit: true, canConfirm: true,
  resources: [
    { id: 'teacher-a', kind: 'teacher', label: '합성 교사', capacity: 1 },
    { id: 'teacher-b', kind: 'teacher', label: '합성 교사', capacity: 1 },
    { id: 'class-a', kind: 'class', label: '1학년 1반', capacity: 1 },
  ],
  courses: [
    { id: 'course-b', label: '국어', requiredPeriods: null, resourceIds: ['teacher-b', 'class-a'] },
    { id: 'course-a', label: '국어', requiredPeriods: null, resourceIds: ['teacher-a', 'class-a'] },
    { id: 'course-fixed', label: '수학', requiredPeriods: 2, resourceIds: ['teacher-b', 'class-a'] },
  ], unsupportedFeatures: [], savedDraft: null,
}
const draft = {
  title: '담당자 준비',
  slots: [
    { id: 'slot-b', day: 2, label: '1교시', startMinute: 540, endMinute: 585, periods: 1 },
    { id: 'slot-a', day: 1, label: '1교시', startMinute: 540, endMinute: 585, periods: 1 },
  ],
  plans: [
    { courseId: 'course-a', weeklyPeriods: 1, blocks: [{ id: 'block-a', periods: 1, allowedSlotIds: ['slot-b', 'slot-a'] }] },
    { courseId: 'course-fixed', weeklyPeriods: 2, blocks: [{ id: 'block-fixed', periods: 1, allowedSlotIds: [] }] },
    { courseId: 'course-b', weeklyPeriods: 0, blocks: [] },
  ],
}
const clone = value => structuredClone(value), sheet = (book, name) => book.find(row => row.name === name)
const sheets = (s = source, d = draft) => m.preparationHoursWorkbookSheets(s, d)
const row = (book, id = 'course-a') => sheet(book, '주당시수').rows.find(row => row[0] === id)
const preview = (book, s = source, d = draft) => m.previewPreparationHoursWorkbook(book, s, d)
const change = () => { const book = sheets(); row(book)[6] = '3'; row(book, 'course-b')[6] = '4'; return preview(book) }
let count = 0
async function check(name, run) { await run(); count++; console.log('  ✓ ' + name) }
await check('그대로 왕복하면 시수·미완성 상태를 보존하고 변경 목록은 비어 있다', () => {
  const result = preview(sheets())
  assert.equal(result.sourceKey, m.preparationHoursWorkbookKey(source, draft)); assert.equal(result.changes.length, 0); assert.equal(result.unchanged, 3)
  assert.match(result.warnings.join(' '), /1개 수업의 시수가 0/)
  assert.deepEqual(result.hours.map(item => item.courseId), source.courses.map(course => course.id))
})
await check('미정인 공식 시수만 편집하고 전후 값과 기존 활동 합계를 함께 비교한다', () => {
  const result = change()
  assert.deepEqual(result.changes.map(item => [item.courseId, item.before, item.after, item.activityPeriods]), [['course-a', 1, 3, 1], ['course-b', 0, 4, 0]])
  assert.match(result.changes[0].warnings[0], /기존 수업 활동 합계 1차시는 유지/); assert.match(result.warnings[0], /2개 변경 수업/)
})
await check('선택한 수업만 반영하고 제목·배정·활동·시간대와 모든 배열 순서를 보존한다', () => {
  const result = m.applyPreparationHoursWorkbook(source, draft, change(), ['course-b'])
  const wanted = clone(draft); wanted.plans[2].weeklyPeriods = 4
  assert.deepEqual(result, wanted); assert.equal(draft.plans[2].weeklyPeriods, 0)
  assert.notEqual(result, draft); assert.notEqual(result.slots, draft.slots); assert.notEqual(result.plans[0].blocks, draft.plans[0].blocks)
})
await check('선택 순서가 반대여도 원래 초안 순서를 유지한다', () => {
  const result = m.applyPreparationHoursWorkbook(source, draft, change(), ['course-b', 'course-a'])
  assert.deepEqual(result.plans.map(plan => plan.courseId), draft.plans.map(plan => plan.courseId))
  assert.equal(result.plans[0].weeklyPeriods, 3); assert.equal(result.plans[2].weeklyPeriods, 4)
})
await check('시수 0은 명시적인 미완성으로 안내하고 남은 활동을 지우지 않는다', () => {
  const book = sheets(); row(book)[6] = '0'; const result = preview(book)
  assert.equal(result.changes[0].after, 0); assert.match(result.changes[0].warnings.join(' '), /미완성/)
  assert.deepEqual(m.applyPreparationHoursWorkbook(source, draft, result, ['course-a']).plans[0].blocks, draft.plans[0].blocks)
})
await check('기존 활동 합계와 같은 시수에는 활동 불일치 경고를 붙이지 않는다', () => {
  const d = clone(draft); d.plans[0].weeklyPeriods = 3; const book = sheets(source, d); row(book)[6] = '1'
  const result = preview(book, source, d); assert.deepEqual(result.changes[0].warnings, []); assert.doesNotMatch(result.warnings.join(' '), /활동 합계가 다릅니다/)
})
await check('공식 시수는 같은 값만 받으며 0으로 지우는 것도 거부한다', () => {
  for (const value of ['0', '1', '3']) { const book = sheets(); row(book, 'course-fixed')[6] = value; assert.throws(() => preview(book), /공식 시수가 있는 수업/) }
  assert.equal(preview(sheets()).changes.length, 0)
})
for (const value of ['', ' ', ' 2 ', '-1', '1.5', '1e2', '+2', '01', 'NaN', 'Infinity', '1001', '2차시', '=1+1', '1\n']) await check('잘못된 시수와 셀 위치 안내: ' + JSON.stringify(value), () => {
  const book = sheets(); row(book)[6] = value; assert.throws(() => preview(book), /주당시수 시트 3행 G열/)
})
await check('시수 상한은 현재 편성 계약에서 읽는다', () => {
  const book = sheets(); row(book)[6] = '1000'; assert.equal(preview(book).changes[0].after, 1000)
})
await check('수업·공식배정·기준 행을 정렬해도 ID로 대조하고 원래 배열 순서를 돌려준다', () => {
  const book = sheets(); row(book)[6] = '3'
  for (const name of ['주당시수', '공식배정', '기준']) { const current = sheet(book, name); current.rows = [current.rows[0], ...current.rows.slice(1).reverse()] }
  const result = preview(book); assert.deepEqual(result.hours.map(item => item.courseId), source.courses.map(item => item.id)); assert.equal(result.changes[0].courseId, 'course-a')
})
for (const column of [0, 1, 2, 3, 4, 5]) await check('입력시수 외 열 수정 거부: ' + column, () => {
  const book = sheets(); row(book)[column] += '변경'; assert.throws(() => preview(book), /주당시수 시트/)
})
for (const name of ['기준', '공식배정', '주당시수']) for (const mode of ['missing', 'duplicate', 'unknown']) await check(name + '의 ' + mode + ' 행 거부', () => {
  const book = sheets(), current = sheet(book, name)
  if (mode === 'missing') current.rows.pop()
  else if (mode === 'duplicate') current.rows.push(clone(current.rows[1]))
  else current.rows[1][0] = 'unknown-id'
  assert.throws(() => preview(book), new RegExp(name + ' 시트'))
})
for (const [name, mutate] of [
  ['필수 시트 누락', book => book.pop()], ['중복 시트', book => book.push(clone(book[0]))], ['추가 시트', book => book.push({ name: '새시트', rows: [] })],
  ['열 제목 변경', book => sheet(book, '주당시수').rows[0][6] = '주당 시수'], ['추가 열 값', book => row(book).push('extra')],
  ['공식 배정 수정', book => sheet(book, '공식배정').rows[1][2] = '다른교사'], ['숨은 원본 수정', book => sheet(book, '원본대조').rows[1][1] += 'changed'],
  ['원본 순서 수정', book => sheet(book, '원본대조').rows[1][0] = '9'],
]) await check('양식 구조 오류: ' + name, () => { const book = sheets(); mutate(book); assert.throws(() => preview(book)) })
await check('빈 뒤쪽 열과 빈 행은 허용하지만 지워진 수업을 숨기지 않는다', () => {
  const book = sheets(); row(book).push('', ''); sheet(book, '주당시수').rows.push([], ['']); assert.equal(preview(book).changes.length, 0)
  row(book).splice(0); assert.throws(() => preview(book), /수업 행이 빠졌/)
})
for (const [name, mutate] of [
  ['학교', s => s.schoolId = 'other-school'], ['학기', s => s.termId = 'other-term'], ['원본판', s => s.sourceRevision++],
  ['원본지문', s => s.sourceFingerprint = 'b'.repeat(64)], ['공식 교사 이름', s => s.resources[0].label += '변경'],
  ['공식 수업 이름', s => s.courses[0].label += '변경'], ['공식 배정 순서', s => s.courses[0].resourceIds.reverse()],
  ['저장된 초안', s => s.savedDraft = { id: 'saved', revision: 1, sourceFingerprint: s.sourceFingerprint, draft: clone(draft) }],
]) await check('파일과 미리보기의 다른 ' + name + ' 거부', () => {
  const s = clone(source); mutate(s)
  assert.throws(() => preview(sheets(), s)); assert.throws(() => m.applyPreparationHoursWorkbook(s, draft, change(), ['course-a']))
})
for (const [name, mutate] of [
  ['제목', d => d.title += '변경'], ['시수', d => d.plans[0].weeklyPeriods++], ['시간대 이름', d => d.slots[0].label += '변경'],
  ['시간대 순서', d => d.slots.reverse()], ['활동 허용시간대 순서', d => d.plans[0].blocks[0].allowedSlotIds.reverse()],
  ['활동 ID', d => d.plans[0].blocks[0].id = 'other-block'], ['수업 순서', d => d.plans.reverse()],
]) await check('파일과 미리보기 사이 현재 입력 변경 거부: ' + name, () => {
  const d = clone(draft); mutate(d)
  assert.throws(() => preview(sheets(), source, d)); assert.throws(() => m.applyPreparationHoursWorkbook(source, d, change(), ['course-a']))
})
for (const [name, mutate] of [
  ['후값', p => p.changes[0].after++], ['이전값', p => p.changes[0].before++], ['이름', p => p.changes[0].label += '변경'],
  ['활동합계', p => p.changes[0].activityPeriods++], ['경고', p => p.changes[0].warnings = []], ['전체경고', p => p.warnings = []],
  ['변경누락', p => p.changes.pop()], ['중복', p => p.hours.push(clone(p.hours[0]))], ['미변경수', p => p.unchanged++],
  ['새필드', p => p.extra = true], ['음수', p => p.hours[0].weeklyPeriods = -1], ['소수', p => p.hours[0].weeklyPeriods = 0.5],
  ['공식시수', p => p.hours[2].weeklyPeriods++], ['가짜수업', p => p.hours[0].courseId = 'fake'],
  ['값추가필드', p => p.hours[0].extra = 'bad'], ['값목록누락', p => p.hours = null], ['값수업중복', p => p.hours[0] = clone(p.hours[1])],
]) await check('변조된 미리보기 재검사: ' + name, () => { const p = change(); mutate(p); assert.throws(() => m.applyPreparationHoursWorkbook(source, draft, p, ['course-a'])) })
for (const selected of [[], ['course-a', 'course-a'], ['course-fixed'], ['not-found'], [null], 'course-a', null]) await check('잘못된 선택 거부: ' + JSON.stringify(selected), () => {
  assert.throws(() => m.applyPreparationHoursWorkbook(source, draft, change(), selected), /반영할 변경 수업/)
})
await check('조회 전용 원본은 내려받기만 가능하고 가져오기·반영은 막는다', () => {
  const s = { ...source, canEdit: false, canConfirm: false }
  assert.ok(m.exportPreparationHoursWorkbook(s, draft).length > 1000)
  assert.throws(() => preview(sheets(s), s), /수정할 수 없습니다/)
  const p = change(); p.sourceKey = m.preparationHoursWorkbookKey(s, draft); assert.throws(() => m.applyPreparationHoursWorkbook(s, draft, p, ['course-a']), /수정할 수 없습니다/)
})
await check('깨진 원본과 입력은 업무용 오류로 거부한다', () => {
  for (const s of [null, {}, { ...source, resources: null }, { ...source, courses: [source.courses[0], source.courses[0]] }]) assert.throws(() => sheets(s), e => e.name === 'TimetableWorkbookError')
  for (const d of [null, {}, { ...draft, plans: [] }, { ...draft, slots: null }]) assert.throws(() => sheets(source, d), e => e.name === 'TimetableWorkbookError')
  for (const b of [null, {}, [null], [{ name: '주당시수', rows: [null] }], [{ name: '주당시수', rows: [[2]] }]]) assert.throws(() => preview(b), e => e.name === 'TimetableWorkbookError')
  for (const p of [null, {}, [], { ...change(), extra: true }]) assert.throws(() => m.applyPreparationHoursWorkbook(source, draft, p, ['course-a']), e => e.name === 'TimetableWorkbookError')
})
await check('동명 수업·교사는 원본 ID로 구분하고 수식 모양 이름도 문자열로 출력한다', () => {
  const s = clone(source); s.courses[0].label = '=1+1'; s.resources[0].label = '=합성교사'
  const book = sheets(s); assert.match(row(book)[3], /합성교사 \[teacher-a\]/)
  const files = m.unzipSync(m.exportPreparationHoursWorkbook(s, draft)), xml = m.strFromU8(files['xl/worksheets/sheet3.xml'])
  assert.match(xml, /=1\+1/); assert.doesNotMatch(xml, /<f[ >]/); assert.match(m.strFromU8(files['xl/workbook.xml']), /name="원본대조"[^>]+state="hidden"/)
})
await check('긴 원본·이모지는 분할 대조와 XLSX 쓰기에서 손실 없이 보존한다', () => {
  const s = clone(source); s.courses = Array.from({ length: 100 }, (_, i) => ({ ...s.courses[0], id: 'course-' + i, label: '가'.repeat(155) + '🎵' }))
  const d = { ...draft, plans: s.courses.map(course => ({ courseId: course.id, weeklyPeriods: 0, blocks: [] })) }
  const book = sheets(s, d), parts = sheet(book, '원본대조').rows.slice(1).map(row => row[1])
  assert.ok(parts.length > 4); assert.equal(parts.join(''), m.preparationHoursWorkbookKey(s, d)); assert.equal(preview(book, s, d).changes.length, 0)
  assert.ok(m.exportPreparationHoursWorkbook(s, d).length > 1000)
})
await check('빈 수업 목록은 양식을 왕복하지만 빈 선택 반영은 하지 않는다', () => {
  const s = { ...source, courses: [] }, d = { ...draft, plans: [] }; assert.equal(preview(sheets(s, d), s, d).changes.length, 0)
  assert.throws(() => m.applyPreparationHoursWorkbook(s, d, preview(sheets(s, d), s, d), []), /반영할 변경 수업/)
})
await check('XLSX 바이트 입력은 크기·ZIP 검사에서 잘못된 파일을 먼저 거부한다', () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(8 * 1024 * 1024 + 1), new Uint8Array([1, 2, 3])]) assert.throws(() => m.importPreparationHoursWorkbook(bytes, source, draft), e => e.name === 'TimetableWorkbookError')
})
console.log(`시간표 준비 시수 엑셀 검사: ${count}개 통과`)
