import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { validateCollectionUnitInputs, collectionUnitMemberOptions, appendPersonalCollectionUnit, appendSharedCollectionUnit, render } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionUnitsEditor} from '../apps/workhub/src/collections/CollectionUnitsEditor'
  export * from '../apps/workhub/src/collections/unit-inputs'
  export function render(props) { return renderToStaticMarkup(<CollectionUnitsEditor {...props} onChange={() => {throw Error('렌더 중 입력 변경 금지')}} />).replace(/<style>[\\s\\S]*?<\\/style>/g, '') }
`)
const member = (id, name = `교사 ${id}`, rest = {}) => ({ id, name, active: true, schoolId: 'school', userId: `user-${id}`, role: 'teacher', validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [], ...rest })
const members = [member('a', '김교사'), member('b', '박교사'), member('c', '이교사')]
const unit = (rest = {}) => ({ label: '1학년', responsibleMemberId: 'a', contributorMemberIds: ['b'], ...rest })
let failed = 0
function test(name, run) { try { run(); console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }

test('개인·공동 제출을 섞을 수 있고 같은 교사는 여러 단위에 참여할 수 있다', () => {
  assert.equal(validateCollectionUnitInputs([unit(), unit({ label: '국어과', responsibleMemberId: 'a', contributorMemberIds: ['b', 'c'] })], members).valid, true)
})
test('명부 순서가 바뀌어도 동명이인은 ID 순서로 구별한다', () => {
  const roster = [member('b', '김교사'), member('a', '김교사'), member('c', '박교사')]
  const first = collectionUnitMemberOptions(roster), second = collectionUnitMemberOptions([...roster].reverse())
  assert.deepEqual(first, second); assert.deepEqual(first.slice(0, 2), [{ id: 'a', label: '김교사 · 동명이인 1' }, { id: 'b', label: '김교사 · 동명이인 2' }])
})
test('추가할 때 기존 이름·책임자·공동 작성자를 변경하지 않고 깊은 복사한다', () => {
  const original = [unit()], before = structuredClone(original)
  const next = appendPersonalCollectionUnit(original, members, 'c')
  assert.deepEqual(next[0], before[0]); assert.deepEqual(original, before)
  next[0].contributorMemberIds.push('c'); assert.deepEqual(original, before)
  assert.deepEqual(next[1], { label: '이교사', responsibleMemberId: 'c', contributorMemberIds: [] })
})
test('동명이인 개인 단위와 기존 사용자 지정 단위는 이름이 충돌하지 않는다', () => {
  const roster = [member('a', '김교사'), member('b', '김교사')]
  const original = [unit({ label: '김교사 · 동명이인 2', responsibleMemberId: 'a', contributorMemberIds: [] })]
  const next = appendPersonalCollectionUnit(original, roster, 'b')
  assert.equal(next[1].label, '김교사 · 동명이인 2 (2)'); assert.equal(validateCollectionUnitInputs(next, roster).valid, true)
})
test('공동 단위 추가는 기존 배열을 대체하지 않으며 책임자를 임의로 고르지 않는다', () => {
  const original = [unit({ label: '공동 제출' })], before = structuredClone(original)
  const next = appendSharedCollectionUnit(original)
  assert.deepEqual(original, before); assert.deepEqual(next[0], before[0]); assert.deepEqual(next[1], { label: '공동 제출 (2)', responsibleMemberId: '', contributorMemberIds: [] })
  assert(validateCollectionUnitInputs(next, members).issues.some(issue => issue.unitIndex === 1 && issue.field === 'responsible'))
})
test('현재 검토자·종료된 소속·없는 교사·기존 책임자는 개인 단위로 새로 추가하지 않는다', () => {
  for (const id of ['a', 'missing', 'b', 'ended']) assert.throws(() => appendPersonalCollectionUnit([unit()], [...members, member('ended', '종료', { active: false })], id, 'b'))
})
test('검토자 권한을 새로운 클라이언트 규칙으로 재정의하지 않는다', () => {
  // 이 검사에는 검토자 인자가 없다. 기존/실제 제출자 계정의 자기검토는 서버가 판정한다.
  assert.equal(validateCollectionUnitInputs([unit({ responsibleMemberId: 'a', contributorMemberIds: ['a', 'b'] })], members).valid, true)
})
test('빈 단위·공백 이름·100자 초과·중복 단위 이름을 저장 전에 알린다', () => {
  assert.equal(validateCollectionUnitInputs([], members).valid, false)
  for (const label of ['', '  ', '가'.repeat(101), '이름\u0000']) assert.equal(validateCollectionUnitInputs([unit({ label })], members).valid, false)
  const duplicate = validateCollectionUnitInputs([unit(), unit({ label: ' 1학년 ' })], members)
  assert.deepEqual(duplicate.issues.filter(issue => issue.field === 'label').map(issue => issue.unitIndex), [0, 1])
})
test('알 수 없는 책임자·공동 작성자와 중복 공동 작성자를 저장 전에 알린다', () => {
  const invalid = validateCollectionUnitInputs([unit({ responsibleMemberId: 'ended', contributorMemberIds: ['missing', 'missing'] })], [...members, member('ended', '종료', { active: false })])
  assert.equal(invalid.valid, false); assert(invalid.issues.some(issue => issue.field === 'responsible')); assert.equal(invalid.issues.filter(issue => issue.field === 'contributors').length, 2)
})
test('100개 제출 단위·100명 구성원 계약을 넘는 추가와 저장은 차단한다', () => {
  const many = Array.from({ length: 100 }, (_, index) => unit({ label: `단위 ${index}` }))
  assert.equal(validateCollectionUnitInputs(many, members).valid, true)
  assert.throws(() => appendPersonalCollectionUnit(many, members, 'c')); assert.throws(() => appendSharedCollectionUnit(many))
  assert.equal(validateCollectionUnitInputs([...many, unit()], members).valid, false)
  const roster = Array.from({ length: 101 }, (_, index) => member(`id-${index}`))
  assert.equal(validateCollectionUnitInputs([unit({ responsibleMemberId: 'id-0', contributorMemberIds: roster.slice(1).map(value => value.id) })], roster).valid, false)
})
test('깨진 배열·단위·명부 입력은 예외 없이 실패 결과를 반환한다', () => {
  for (const invalid of [null, undefined, 'bad', [null], [1], Array(1), [{ ...unit(), contributorMemberIds: 'b' }], [{ ...unit(), contributorMemberIds: [null] }], [{ ...unit(), contributorMemberIds: Array(1) }]]) assert.equal(validateCollectionUnitInputs(invalid, members).valid, false)
  for (const invalid of [null, 'bad', [null], [member('a'), member('a')], [member('a', '')], [member('a', '잘못된 소속', { active: 'true' })]]) assert.equal(validateCollectionUnitInputs([unit()], invalid).valid, false)
})
test('SSR은 기존 공동 단위를 그대로 표시하고 책임자·작성자·제거 조작을 제공한다', () => {
  const html = render({ units: [unit()], members })
  assert.match(html, /공동 제출 단위 추가/); assert.match(html, /aria-label="제출 단위 1 이름"[^>]*value="1학년"/)
  assert.match(html, /aria-label="책임 교사 1"/); assert.match(html, /aria-label="박교사 · 공동 작성자 1"[^>]*checked/)
  assert.match(html, /aria-label="1학년 제출 단위 제거"/); assert.match(html, /<details[^>]*open/)
  assert.match(html, /아래 제출 단위에서 조정/)
})
test('SSR은 현재 명부에서 사라진 기존 선택을 숨기거나 다른 교사로 바꾸지 않는다', () => {
  const html = render({ units: [unit({ responsibleMemberId: 'gone', contributorMemberIds: ['also-gone'] })], members })
  assert.match(html, /value="gone" selected="">기존 책임자 · 현재 명부에 없음/)
  assert.match(html, /명부에 없는 공동 작성자 1 · 제출 단위 1/); assert.match(html, /role="alert"/)
  assert.match(html, /현재 명부에 없는 공동 작성자가 있습니다/)
})
test('SSR은 기존 책임자와 현재 검토자의 겹침을 선택값과 안내로 보존한다', () => {
  const html = render({ units: [unit()], members, reviewerMemberId: 'a' })
  assert.match(html, /value="a" disabled="" selected="">김교사 · 현재 검토자/)
  assert.match(html, /현재 책임 교사가 검토자로도 선택되어 있습니다/)
})
test('SSR은 깨진 입력을 조용히 빈 목록으로 저장하지 않고 편집을 막는다', () => {
  for (const props of [{ units: null, members }, { units: [null], members }, { units: [unit()], members: null }]) {
    const html = render(props); assert.match(html, /<fieldset[^>]*disabled/); assert.match(html, /role="alert"/)
  }
})
test('SSR은 비활성 편집과 HTML 입력 이스케이프를 유지한다', () => {
  const html = render({ units: [unit({ label: '<script>공동</script>' })], members, disabled: true })
  assert.match(html, /<fieldset[^>]*disabled/); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/)
})

if (failed) process.exit(1)
