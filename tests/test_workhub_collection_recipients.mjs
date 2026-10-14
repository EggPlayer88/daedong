import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { collectionRecipients, filterCollectionRecipients, currentRecipientSelection, appendCollectionRecipients, render, collectionUnitLimit } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionRecipients} from '../apps/workhub/src/workflows/CollectionRecipients.tsx'
  export * from '../apps/workhub/src/workflows/collection-recipients.ts'
  export {collectionUnitLimit} from '../apps/workhub/src/workflows/entry-guide.ts'
  export const render = props => renderToStaticMarkup(<CollectionRecipients {...props} onChange={() => {throw Error('렌더 중 변경 금지')}} />)
`)
const date = '2026-10-14', schoolId = 'school'
const member = (id, name = `교사 ${id}`, overrides = {}) => ({ id, name, schoolId, userId: `user-${id}`, active: true, validFrom: date, validThrough: date, role: 'teacher', departmentIds: [], gradeIds: [], subjectIds: [], ...overrides })
const unit = (id, label = `기존 ${id}`) => ({ label, responsibleMemberId: id, contributorMemberIds: ['공동 작성자'] })
const context = overrides => ({ schoolId, date, members: [member('a', '김가람'), member('b', '박나래'), member('c', '이서진')], units: [], ...overrides })
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }

test('같은 학교의 현재 유효 교사만 표시하며 시작일과 마지막 유효일을 포함한다', () => {
  const value = context({ members: [member('valid'), member('other', '타교', { schoolId: 'elsewhere' }), member('inactive', '정지', { active: false }), member('future', '예정', { validFrom: '2026-10-15', validThrough: '2026-12-31' }), member('ended', '종료', { validFrom: '2026-01-01', validThrough: '2026-10-13' })] })
  assert.deepEqual(collectionRecipients(value).candidates.map(value => value.id), ['valid'])
})
test('기존 책임자와 검토자는 제외하고 기존 공동 작성자는 개인 제출 대상에 추가할 수 있다', () => {
  const value = context({ units: [{ ...unit('a'), contributorMemberIds: ['b'] }], reviewerMemberId: 'c' })
  assert.deepEqual(collectionRecipients(value).candidates.map(value => value.id), ['b'])
  assert.deepEqual(collectionRecipients({ ...value, reviewerMemberId: undefined }).candidates.map(value => value.id), ['b', 'c'])
})
test('깨진 명부 행과 중복 ID는 추측해서 선택하지 않고 제외한다', () => {
  const value = context({ members: [null, 'oops', member('a'), member('a', '다른 이름'), member('bad-date', '날짜 오류', { validThrough: '2026-02-30' }), member('truthy', '잘못된 활성', { active: 'true' }), member('valid')] })
  const roster = collectionRecipients(value)
  assert.deepEqual(roster.candidates.map(value => value.id), ['valid']); assert.equal(roster.skipped, 6)
})
test('현재 학교나 기준일, 명부 또는 기존 단위가 깨지면 전체 추가를 거부한다', () => {
  for (const invalid of [{ members: null }, { date: '2026-02-30' }, { schoolId: '' }, { units: [null] }, { units: null }, { units: [{ ...unit('a'), contributorMemberIds: 'bad' }] }]) {
    const value = context(invalid)
    assert(collectionRecipients(value).error); assert.throws(() => appendCollectionRecipients(value, ['b']))
  }
})
test('선택 순서나 중복 ID와 무관하게 한 교사당 단위 하나만 추가한다', () => {
  const result = appendCollectionRecipients(context(), ['b', 'a', 'b', 'unknown'])
  assert.equal(result.added, 2); assert.deepEqual(result.units.map(value => value.responsibleMemberId), ['a', 'b'])
  assert(result.units.every(value => value.contributorMemberIds.length === 0))
})
test('기존 단위 이름·책임자·공동작성자는 그대로 복사하고 원본 배열을 변경하지 않는다', () => {
  const value = context({ units: [unit('a', '  기존 반별 단위  ')] }), before = structuredClone(value)
  const result = appendCollectionRecipients(value, ['b'])
  assert.deepEqual(value, before); assert.deepEqual(result.units[0], before.units[0])
  result.units[0].contributorMemberIds.push('추가'); result.units[0].label = '결과 변경'
  assert.deepEqual(value, before)
})
test('추가 직전 최신 명부·학교·검토자·책임자를 다시 검사한다', () => {
  const selected = ['a', 'b', 'c']
  const value = context({ members: [member('a'), member('b', '소속 종료', { active: false }), member('c')], reviewerMemberId: 'c' })
  assert.deepEqual(currentRecipientSelection(selected, collectionRecipients(value).candidates), ['a'])
  assert.equal(appendCollectionRecipients(value, selected).added, 1)
  assert.throws(() => appendCollectionRecipients({ ...value, schoolId: 'other' }, selected), /현재 추가할 수 있는/)
  assert.throws(() => appendCollectionRecipients({ ...value, units: [unit('a')] }, selected), /현재 추가할 수 있는/)
})
test('학교 기준일 변경으로 만료된 선택은 추가되지 않는다', () => {
  const value = context({ date: '2026-10-15' })
  assert.deepEqual(currentRecipientSelection(['a'], collectionRecipients(value).candidates), [])
  assert.throws(() => appendCollectionRecipients(value, ['a']), /현재 추가할 수 있는/)
})
test('한도까지는 모두 추가하고 초과 시 원본을 전혀 바꾸지 않는다', () => {
  const units = Array.from({ length: collectionUnitLimit - 2 }, (_, i) => unit(`old-${i}`))
  const value = context({ units }), before = structuredClone(value)
  assert.equal(appendCollectionRecipients(value, ['a', 'b']).units.length, collectionUnitLimit)
  assert.throws(() => appendCollectionRecipients(value, ['a', 'b', 'c']), /2명까지/)
  assert.deepEqual(value, before)
})
test('중복 책임자는 남은 용량을 소비하지 않는다', () => {
  const value = context({ units: Array.from({ length: collectionUnitLimit - 1 }, (_, i) => unit(i === 0 ? 'a' : `old-${i}`)) })
  const result = appendCollectionRecipients(value, ['a', 'b'])
  assert.equal(result.added, 1); assert.equal(result.units.length, collectionUnitLimit)
  assert.throws(() => appendCollectionRecipients({ ...value, units: result.units }, ['c']), /0명까지/)
})
test('동명이인과 이미 있는 괄호 이름을 충돌 없이 구분한다', () => {
  const value = context({ members: [member('a', '김교사'), member('b', '김교사'), member('c', '김교사 (2)')], units: [unit('old', ' 김교사 ')] })
  const result = appendCollectionRecipients(value, ['a', 'b', 'c'])
  const labels = result.units.map(value => value.label.trim())
  assert.equal(new Set(labels).size, labels.length); assert(labels.includes('김교사 (2)')); assert(labels.includes('김교사 (3)')); assert(labels.includes('김교사 (2) (2)'))
})
test('긴 한글과 이모지 이름도 접미사까지 100 코드포인트 안에 담는다', () => {
  const long = '김😀'.repeat(70), value = context({ members: [member('a', long), member('b', long)] })
  const result = appendCollectionRecipients(value, ['a', 'b'])
  assert(result.units.every(value => Array.from(value.label).length === 100))
  assert(result.units[1].label.endsWith(' (2)')); assert.notEqual(result.units[0].label, result.units[1].label)
})
test('이름을 자른 위치가 공백이어도 저장소 trim 이후 단위 이름이 중복되지 않는다', () => {
  const name = '가'.repeat(99), value = context({ members: [member('a', name + ' 나머지'), member('b', name)] })
  const result = appendCollectionRecipients(value, ['a', 'b'])
  const labels = result.units.map(value => value.label.trim())
  assert.equal(new Set(labels).size, 2); assert(result.units.every(value => value.label === value.label.trim()))
})
test('검색 정규화는 선택 목록을 바꾸지 않고 필터 바깥 선택도 유지한다', () => {
  const candidates = collectionRecipients(context()).candidates, chosen = ['a', 'b']
  assert.deepEqual(filterCollectionRecipients(candidates, '  김가람  ').map(value => value.id), ['a'])
  assert.deepEqual(filterCollectionRecipients(candidates, '김가람'.normalize('NFD')).map(value => value.id), ['a'])
  assert.deepEqual(currentRecipientSelection(chosen, candidates), chosen)
  assert.deepEqual(filterCollectionRecipients(candidates, '없는 이름'), [])
})
test('SSR은 저장이나 게시를 호출하지 않고 이름과 안내를 안전하게 표시한다', () => {
  const html = render(context({ members: [member('a', '<script>name</script>')] }))
  assert.match(html, /교사마다 1부씩 추가/); assert.match(html, /교사 이름 검색/); assert.match(html, /검색 결과 전체 선택/)
  assert.match(html, /&lt;script&gt;name&lt;\/script&gt;/); assert(!html.includes('<script>'))
  assert.match(html, /선택한 교사 0명 추가/); assert.match(html, /type="button"/)
})
test('대량 명부는 SSR에서도 20명만 표시하고 전체 검색 결과 수는 보존한다', () => {
  const html = render(context({ members: Array.from({ length: 45 }, (_, i) => member(`m-${i}`, `교사 ${String(i).padStart(2, '0')}`)) }))
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 20)
  assert.match(html, /검색 결과 전체 선택 \(45명\)/); assert.match(html, /1 \/ 3쪽/); assert.match(html, /추가할 교사 목록 페이지/)
})
test('disabled와 깨진 명부 SSR은 조작을 잠그고 올바른 빈 상태를 보여준다', () => {
  assert.match(render({ ...context(), disabled: true }), /<fieldset disabled=""/)
  const html = render({ ...context(), members: null })
  assert.match(html, /학교와 교사 명부를 다시 확인/); assert.match(html, /role="alert"/); assert.match(html, /<fieldset disabled=""/)
})
console.log(`\n수합 교사 일괄 추가 검증: ${passed} 통과, ${failed} 실패`)
if (failed) process.exit(1)
