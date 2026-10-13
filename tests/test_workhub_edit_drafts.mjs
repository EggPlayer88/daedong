import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createEditDrafts } = await loadBrowserModule("export * from '../apps/workhub/src/app/edit-drafts.tsx'")
let passed = 0, failures = 0
function test(name, action) { try { action(); passed++; console.log('  ✓ ' + name) } catch (error) { failures++; console.error('  ✗ ' + name + ': ' + error.stack) } }

test('서버 범위 확인 전에는 미저장 입력을 쓰거나 읽지 못한다', () => {
  const store = createEditDrafts(true), early = store.bind('school-a', 'task')
  early.save({ title: '보이면 안 됨' })
  assert.equal(store.bind('school-a', 'task').initial, undefined)
  store.activate('school-a')
  early.save({ title: '이전 세대' })
  assert.equal(store.bind('school-a', 'task').initial, undefined)
})
test('보관값과 복구값은 원본 객체와 분리되어 다음 입력이 과거 초안을 바꾸지 않는다', () => {
  const store = createEditDrafts(true); store.activate('a')
  const input = { title: '초안', audience: ['교사 A'] }
  store.bind('a', 'calendar').save(input)
  input.audience.push('교사 B')
  const restored = store.bind('a', 'calendar').initial
  restored.audience.push('교사 C')
  assert.deepEqual(store.bind('a', 'calendar').initial.audience, ['교사 A'])
})
test('일시 실패 중 본문을 읽지 못해도 이탈 경고와 같은 범위 복구는 유지한다', () => {
  const store = createEditDrafts(true); store.activate('a')
  store.bind('a', 'task').save({ notes: '마지막 글자까지' })
  store.suspend()
  assert.equal(store.bind('a', 'task').initial, undefined)
  assert.equal(store.count(), 1)
  store.activate('a')
  assert.deepEqual(store.bind('a', 'task').initial, { notes: '마지막 글자까지' })
})
test('같은 학교를 재확인해도 오류 전 늦은 쓰기·지우기가 새 초안을 덮지 않는다', () => {
  const store = createEditDrafts(true); store.activate('a')
  const old = store.bind('a', 'task'); old.save({ title: '오류 전' })
  store.suspend(); store.activate('a')
  store.bind('a', 'task').save({ title: '복원 후 수정' })
  old.save({ title: '늦은 응답' }); old.remove(); old.removePrefix('')
  assert.equal(store.bind('a', 'task').initial.title, '복원 후 수정')
})
test('권한 회수 후 같은 계정·학교로 돌아와도 폐기한 초안이 부활하지 않는다', () => {
  const store = createEditDrafts(true); store.activate('a')
  const old = store.bind('a', 'calendar'); old.save({ title: '폐기 대상' })
  store.clear(); store.activate('a'); old.save({ title: '늦은 저장' })
  assert.equal(store.bind('a', 'calendar').initial, undefined)
  assert.equal(store.count(), 0)
})
test('학교나 본인 권한 범위를 바꾸면 이전 입력은 폐기하고 돌아와도 복원하지 않는다', () => {
  const store = createEditDrafts(true); store.activate('school-a-role-1')
  store.bind('school-a-role-1', 'task').save({ title: '학교 A' })
  store.activate('school-b-role-1')
  assert.equal(store.bind('school-a-role-1', 'task').initial, undefined)
  store.activate('school-a-role-1')
  assert.equal(store.bind('school-a-role-1', 'task').initial, undefined)
})
test('가져오기 종료는 해당 행 초안만 지우고 일반 일정 입력을 지우지 않는다', () => {
  const store = createEditDrafts(true); store.activate('a')
  store.bind('a', 'calendar-editor').save({ title: '일반' })
  store.bind('a', 'import-row:1').save({ title: '첫 행' })
  store.bind('a', 'import-row:2').save({ title: '둘째 행' })
  store.bind('a', 'import-session').removePrefix('import-row:')
  assert.equal(store.bind('a', 'import-row:1').initial, undefined)
  assert.equal(store.bind('a', 'calendar-editor').initial.title, '일반')
})
test('빈 편집기 위치 정보는 이탈 경고를 만들지 않고 명시 취소는 경고를 해제한다', () => {
  const store = createEditDrafts(true); store.activate('a')
  store.bind('a', 'calendar-panel').save({ opened: true }, false)
  assert.equal(store.count(), 0)
  const input = store.bind('a', 'calendar-editor'); input.save({ title: '입력' })
  assert.equal(store.count(), 1)
  input.remove()
  assert.equal(store.count(), 0)
})
console.log(`\n미저장 입력 보관 ${passed}개 통과, ${failures}개 실패`)
if (failures) process.exitCode = 1
