import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createSetupDraft, validateSetupDraft, parseSetupDraft, exportSetupDraft, exportSetupPlan, SETUP_LIMITS } = await loadBrowserModule(`
  export { createSetupDraft, validateSetupDraft, parseSetupDraft, exportSetupDraft, exportSetupPlan, SETUP_LIMITS } from '../apps/workhub/src/setup/contract.ts'
`)

function draft(overrides = {}) {
  return {
    draftId: 'synthetic-school-setup',
    schoolName: '합성 중학교',
    schoolCode: 'TEST-MIDDLE-01',
    schoolType: 'middle',
    gradeCount: '3',
    schoolYear: '2027',
    startsOn: '2027-03-01',
    lastDay: '2028-02-29',
    terms: [
      { id: 'term-first', termNo: '1', name: '1학기', startsOn: '2027-03-01', lastDay: '2027-08-15' },
      { id: 'term-second', termNo: '2', name: '2학기', startsOn: '2027-08-16', lastDay: '2028-02-29' },
    ],
    departments: [
      { id: 'department-curriculum', name: '교육과정부' },
      { id: 'department-student', name: '학생생활부' },
    ],
    classes: [
      { id: 'class-first', grade: '1', classNo: '1', name: '1학년 1반', kind: 'regular' },
      { id: 'class-third', grade: '3', classNo: '2', name: '3학년 2반', kind: 'regular' },
    ],
    ...overrides,
  }
}
const asPlan = value => JSON.parse(exportSetupPlan(value))
const asEnvelope = value => JSON.parse(exportSetupDraft(value))
const parseEnvelope = value => parseSetupDraft(JSON.stringify(value))
function rejectPlan(value, message) {
  const issues = validateSetupDraft(value)
  assert(Array.isArray(issues) && issues.length > 0, message)
  assert(issues.every(issue => typeof issue.path === 'string' && typeof issue.message === 'string' && issue.message.trim()), '오류는 경로와 안전한 설명을 가져야 한다')
  assert.throws(() => exportSetupPlan(value), undefined, message)
}
let passed = 0, failed = 0
async function test(name, run) {
  try { await run(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error.message}`) }
}

await test('새 준비 초안은 학교가 적용됐다고 표시하지 않으며 미완성 상태로 왕복 저장된다', () => {
  const input = createSetupDraft()
  assert.equal(typeof input.draftId, 'string')
  assert(input.draftId.trim())
  const envelope = asEnvelope(input)
  assert.deepEqual(Object.keys(envelope).sort(), ['deploymentState', 'input', 'kind', 'schemaVersion'])
  assert.equal(envelope.kind, 'school-setup-draft')
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.deploymentState, 'not_applied')
  assert.deepEqual(parseSetupDraft(JSON.stringify(envelope)), input)
  rejectPlan(input, '입력 전 초안은 검토 계획으로 내보낼 수 없다')
})

await test('완성된 계획은 입력 식별자를 유지하고 배포·승인 사실을 만들지 않는다', () => {
  const input = draft()
  assert.deepEqual(validateSetupDraft(input), [])
  const plan = asPlan(input)
  assert.equal(plan.kind, 'school-setup-plan')
  assert.equal(plan.schemaVersion, 1)
  assert.equal(plan.deploymentState, 'not_applied')
  assert.equal(plan.sourceDraftId, input.draftId)
  assert.deepEqual(plan.school, { code: input.schoolCode, name: input.schoolName, schoolLevel: 'middle', gradeCount: 3 })
  assert.deepEqual(plan.academicYear, { schoolYear: 2027, startsOn: '2027-03-01', endsBefore: '2028-03-01' })
  assert.deepEqual(plan.terms.map(term => term.draftRowId), input.terms.map(term => term.id))
  assert.deepEqual(plan.departments, input.departments.map(row => ({ draftRowId: row.id, name: row.name })))
  assert.deepEqual(plan.classes, input.classes.map(row => ({ draftRowId: row.id, grade: Number(row.grade), classNo: Number(row.classNo), label: row.name, kind: row.kind })))
  assert(Array.isArray(plan.pendingChecks) && plan.pendingChecks.length > 0, '서버 검증·SQL 적용 전임을 계획에 남겨야 한다')
  for (const forbidden of ['approved', 'role', 'accountId', 'membershipId', 'authUserId', 'appliedAt']) assert(!Object.hasOwn(plan, forbidden))
})

await test('윤년·월말·연말의 마지막 유효일을 다음 날 종료 제외일로 정확하게 내보낸다', () => {
  for (const [lastDay, endsBefore] of [
    ['2028-02-29', '2028-03-01'],
    ['2027-02-28', '2027-03-01'],
    ['2027-04-30', '2027-05-01'],
    ['2027-12-31', '2028-01-01'],
  ]) {
    const start = lastDay.slice(0, 4) + '-01-01'
    const input = draft({ schoolYear: lastDay.slice(0, 4), startsOn: start, lastDay, terms: [{ id: 'term-only', termNo: '1', name: '검토 학기', startsOn: start, lastDay }] })
    const plan = asPlan(input)
    assert.equal(plan.academicYear.endsBefore, endsBefore)
    assert.equal(plan.terms[0].endsBefore, endsBefore)
    assert.equal(parseSetupDraft(exportSetupDraft(input)).lastDay, lastDay)
  }
})

await test('하루짜리 기간은 같은 날 포함으로 인정하고 다음 날을 종료 제외일로 쓴다', () => {
  const input = draft({ startsOn: '2027-03-01', lastDay: '2027-03-01', terms: [{ id: 'one-day', termNo: '1', name: '하루', startsOn: '2027-03-01', lastDay: '2027-03-01' }] })
  assert.equal(asPlan(input).terms[0].endsBefore, '2027-03-02')
})

await test('초안에는 작성 중인 공백·미완성 숫자·비어 있는 행을 그대로 보존한다', () => {
  const input = draft({
    schoolName: '  학교명 작성 중 ',
    schoolCode: '',
    schoolYear: '20',
    terms: [{ id: 'incomplete-term', termNo: '', name: ' 입력 중 ', startsOn: '', lastDay: '' }],
    departments: [{ id: 'incomplete-department', name: '' }],
    classes: [{ id: 'incomplete-class', grade: '', classNo: '', name: '', kind: 'regular' }],
  })
  assert.deepEqual(parseSetupDraft(exportSetupDraft(input)), input)
  rejectPlan(input)
})

await test('계획에서만 표시값을 정리하며 원본 초안의 입력과 행 순서를 바꾸지 않는다', () => {
  const input = draft({
    schoolName: '  합성 중학교  ',
    schoolCode: ' TEST-MIDDLE-01 ',
    departments: [{ id: 'department-one', name: '  교육과정부 ' }],
    terms: [{ id: 'term-one', termNo: '1', name: '  1학기 ', startsOn: '2027-03-01', lastDay: '2028-02-29' }],
    classes: [{ id: 'class-one', grade: '1', classNo: '1', name: '  1학년 1반 ', kind: 'regular' }],
  })
  const before = structuredClone(input)
  const plan = asPlan(input)
  assert.equal(plan.school.name, '합성 중학교')
  assert.equal(plan.school.code, 'TEST-MIDDLE-01')
  assert.equal(plan.terms[0].name, '1학기')
  assert.equal(plan.departments[0].name, '교육과정부')
  assert.equal(plan.classes[0].label, '1학년 1반')
  assert.deepEqual(input, before)
})

await test('깨진 JSON·최상위 값·다른 종류와 버전·적용 완료 주장은 가져오지 않는다', () => {
  for (const text of ['', '{', 'null', '[]', '"학교"', 'false']) assert.throws(() => parseSetupDraft(text))
  const base = asEnvelope(draft())
  for (const altered of [
    { ...base, kind: 'other' },
    { ...base, schemaVersion: 2 },
    { ...base, schemaVersion: '1' },
    { ...base, deploymentState: 'applied' },
    { ...base, input: null },
    { ...base, input: [] },
    { input: base.input },
  ]) assert.throws(() => parseEnvelope(altered))
})

await test('검토용 계획 파일을 초안으로 잘못 다시 가져오지 않는다', () => {
  assert.throws(() => parseSetupDraft(exportSetupPlan(draft())))
})

await test('학교·계정·승인·역할 필드를 초안에 섞어도 조용히 받아들이지 않는다', () => {
  const base = asEnvelope(draft())
  for (const field of ['approved', 'role', 'is_active', 'accountId', 'membershipId', 'authUserId', 'schoolId', 'permissionVersion']) {
    assert.throws(() => parseEnvelope({ ...base, [field]: 'synthetic-injected-value' }), field)
    assert.throws(() => parseEnvelope({ ...base, input: { ...base.input, [field]: 'synthetic-injected-value' } }), field)
  }
  for (const key of ['terms', 'departments', 'classes']) {
    const altered = structuredClone(base)
    altered.input[key][0].permission = 'school.admin'
    assert.throws(() => parseEnvelope(altered), key)
  }
})

await test('필수 필드 누락·숫자형 입력·손상된 목록과 행은 임의 기본값으로 복구하지 않는다', () => {
  const base = asEnvelope(draft())
  for (const transform of [
    value => { delete value.input.schoolName },
    value => { value.input.schoolYear = 2027 },
    value => { value.input.gradeCount = null },
    value => { value.input.terms = '1학기' },
    value => { value.input.departments = null },
    value => { value.input.classes = {} },
    value => { value.input.terms[0] = null },
    value => { value.input.terms[0].termNo = 1 },
    value => { delete value.input.classes[0].classNo },
    value => { value.input.classes[0].grade = 1 },
  ]) {
    const altered = structuredClone(base)
    transform(altered)
    assert.throws(() => parseEnvelope(altered))
  }
})

await test('형식이 올바른 초안의 의미 오류는 가져오기 후에도 입력을 보존하고 계획만 막는다', () => {
  const input = draft({ startsOn: '2027-02-30', schoolYear: '미정', gradeCount: '여섯' })
  const restored = parseSetupDraft(exportSetupDraft(input))
  assert.deepEqual(restored, input)
  rejectPlan(restored)
})

await test('학년도와 학년 수는 정수·허용 범위만 검토 계획으로 내보낸다', () => {
  for (const value of ['2019', '2101', '2027.5', '2e3', '-2027', '']) rejectPlan(draft({ schoolYear: value }), value)
  for (const value of ['0', '7', '-1', '1.5', '3e0', '']) rejectPlan(draft({ gradeCount: value }), value)
  for (const value of ['2020', '2100']) {
    const input = draft({ schoolYear: value })
    assert.equal(asPlan(input).academicYear.schoolYear, Number(value))
  }
})

await test('실제로 없는 날짜·시각 문자열·기간 역전은 계획에서 거부한다', () => {
  for (const value of ['2027-02-29', '2027-02-30', '2028-02-30', '2027-13-01', '2027-00-01', '2027-03-00', '2027-3-1', '2027-03-01T00:00:00Z', '']) {
    rejectPlan(draft({ startsOn: value }), value)
    rejectPlan(draft({ lastDay: value }), value)
  }
  rejectPlan(draft({ startsOn: '2028-03-01', lastDay: '2027-03-01' }))
  const input = draft()
  input.terms[0].startsOn = '2027-08-16'
  input.terms[0].lastDay = '2027-08-15'
  rejectPlan(input)
})

await test('학년도 밖의 학기·마지막 날짜가 겹치는 학기·포함 학기 모두 거부한다', () => {
  for (const transform of [
    value => { value.terms[0].startsOn = '2027-02-28' },
    value => { value.terms[1].lastDay = '2028-03-01' },
    value => { value.terms[1].startsOn = value.terms[0].lastDay },
    value => { value.terms[0].lastDay = '2028-02-29' },
  ]) {
    const input = draft()
    transform(input)
    rejectPlan(input)
  }
  assert.deepEqual(validateSetupDraft(draft()), [], '전날 종료·다음 날 시작은 중첩되지 않는다')
})

await test('초등학교 6학년과 특수·복식 학급의 빈 반 번호를 손실 없이 지원한다', () => {
  const input = draft({
    schoolType: 'elementary',
    gradeCount: '6',
    classes: [
      { id: 'sixth-grade', grade: '6', classNo: '1', name: '6학년 1반', kind: 'regular' },
      { id: 'special-class', grade: '1', classNo: '', name: '도움반', kind: 'special' },
      { id: 'mixed-class', grade: '2', classNo: '', name: '통합반', kind: 'multigrade' },
    ],
  })
  const plan = asPlan(input)
  assert.equal(plan.school.schoolLevel, 'elementary')
  assert.equal(plan.school.gradeCount, 6)
  assert.equal(plan.classes[0].grade, 6)
  assert.equal(plan.classes[1].classNo, null)
  assert.equal(plan.classes[2].classNo, null)
  assert.equal(plan.classes[2].kind, 'multigrade')
  assert.deepEqual(parseSetupDraft(exportSetupDraft(input)), input)
})

await test('지원 학교급은 이름을 보존하고 알 수 없는 학교급·학급 종류는 계획을 막는다', () => {
  for (const schoolType of ['elementary', 'middle', 'high', 'special', 'other']) {
    assert.equal(asPlan(draft({ schoolType })).school.schoolLevel, schoolType)
  }
  rejectPlan(draft({ schoolType: 'university' }))
  for (const kind of ['unknown', 'mixed']) rejectPlan(draft({ classes: [{ ...draft().classes[0], kind }] }))
})

await test('학교 학년 수 밖의 학급과 잘못된 반 번호를 막되 빈 반 번호는 보존한다', () => {
  for (const grade of ['0', '4', '-1', '1.5', '']) rejectPlan(draft({ classes: [{ ...draft().classes[0], grade }] }), grade)
  for (const classNo of ['0', '-1', '1.5', '1e1']) rejectPlan(draft({ classes: [{ ...draft().classes[0], classNo }] }), classNo)
  assert.equal(asPlan(draft({ classes: [{ ...draft().classes[0], classNo: '' }] })).classes[0].classNo, null)
})

await test('같은 목록의 행 식별자가 중복되면 대상 혼동을 막기 위해 계획을 거부한다', () => {
  for (const key of ['terms', 'departments', 'classes']) {
    const input = draft()
    input[key][1].id = input[key][0].id
    rejectPlan(input, key)
  }
})

await test('공백만 다른 부서·학기·학급 이름과 중복 학기 번호를 구별 없이 중복으로 잡는다', () => {
  for (const key of ['terms', 'departments', 'classes']) {
    const input = draft()
    input[key][1].name = '  ' + input[key][0].name + '　'
    rejectPlan(input, key)
  }
  const input = draft()
  input.terms[1].termNo = input.terms[0].termNo
  rejectPlan(input)
})

await test('부서·학기·학급 사이에 같은 행 식별자가 섞여도 계획을 거부한다', () => {
  const input = draft()
  input.classes[0].id = input.departments[0].id
  rejectPlan(input)
  const other = draft()
  other.terms[0].id = other.draftId
  rejectPlan(other)
})

await test('손상된 가져오기를 처리하는 동안 앞서 보유한 입력은 변경하지 않는다', () => {
  const current = draft({ schoolName: '작성 중 학교명' })
  const before = structuredClone(current)
  const damaged = asEnvelope(current)
  damaged.input.terms = null
  assert.throws(() => parseEnvelope(damaged))
  assert.deepEqual(current, before)
})


await test('DB 전달에 맞지 않는 제어 문자·짝 없는 서로게이트는 초안에 남기되 계획에서는 거부한다', () => {
  for (const text of ['앞\0뒤', '앞\u0001뒤', '앞\u001f뒤', '앞\n뒤', '앞\t뒤', '앞\ud800뒤', '앞\udc00뒤']) {
    for (const patch of [
      input => { input.schoolName = text },
      input => { input.terms[0].name = text },
      input => { input.departments[0].name = text },
      input => { input.classes[0].name = text },
    ]) {
      const input = draft()
      patch(input)
      assert.deepEqual(parseSetupDraft(exportSetupDraft(input)), input)
      rejectPlan(input)
    }
  }
  const input = draft({ schoolName: '\t합성 😀 학교\n' })
  assert.equal(asPlan(input).school.name, '합성 😀 학교')
})

await test('JSON 초안 파일 한도는 글자 수가 아니라 UTF-8 바이트 수로 적용한다', () => {
  const text = exportSetupDraft(draft())
  const baseSize = new TextEncoder().encode(text).length
  const exact = text + ' '.repeat(SETUP_LIMITS.maxImportBytes - baseSize)
  assert.equal(new TextEncoder().encode(exact).length, SETUP_LIMITS.maxImportBytes)
  assert.deepEqual(parseSetupDraft(exact), draft())
  assert.throws(() => parseSetupDraft(exact + ' '))
  const multibyte = JSON.stringify({ ...asEnvelope(draft()), note: '한'.repeat(Math.floor(SETUP_LIMITS.maxImportBytes / 3)) })
  assert(multibyte.length < SETUP_LIMITS.maxImportBytes)
  assert(new TextEncoder().encode(multibyte).length > SETUP_LIMITS.maxImportBytes)
  assert.throws(() => parseSetupDraft(multibyte), /1MB/)
})

await test('목록 한도의 마지막 행은 보존하고 초과 행은 초안 가져오기와 내보내기 모두 거부한다', () => {
  for (const key of ['terms', 'departments', 'classes']) {
    const input = draft()
    const prototype = input[key][0]
    input[key] = Array.from({ length: SETUP_LIMITS[key] }, (_, index) => ({ ...prototype, id: key + '-' + index }))
    assert.deepEqual(parseSetupDraft(exportSetupDraft(input)), input)
    input[key].push({ ...prototype, id: key + '-over-limit' })
    assert.throws(() => exportSetupDraft(input))
    assert.throws(() => parseEnvelope({ kind: 'school-setup-draft', schemaVersion: 1, deploymentState: 'not_applied', input }))
  }
})

await test('중복된 행 식별자는 계획뿐 아니라 가져오기·초안 내보내기 단계에서도 거부한다', () => {
  const input = draft()
  input.classes[0].id = input.terms[0].id
  assert.throws(() => exportSetupDraft(input))
  assert.throws(() => parseEnvelope({ kind: 'school-setup-draft', schemaVersion: 1, deploymentState: 'not_applied', input }))
})

console.log(`\n학교 초기 설정 계약: ${passed}건 통과, ${failed}건 실패`)
if (failed) process.exitCode = 1

