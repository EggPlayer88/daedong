import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { createPendingRequests, recoveryScope } = await loadBrowserModule(`
  export { createPendingRequests, recoveryScope } from '../apps/workhub/src/app/pending-requests';
`)
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name, error) } }
const member = { userId: 'user-a', schoolId: 'school-a', id: 'member-a', active: true, validFrom: '2026-03-01', validThrough: '' }
const request = () => ({ command: { kind: 'create', input: { title: '보관한 입력', notes: '', dueDate: '' } }, key: 'same-request' })
test('교사·학교·소속·유효기간별로 미확정 요청을 격리한다', () => {
  const store = createPendingRequests(), scope = recoveryScope(member)
  store.put(scope, 'task', request())
  for (const change of [{userId:'user-b'},{schoolId:'school-b'},{id:'member-b'},{active:false},{validThrough:'2026-10-13'}])
    assert.equal(store.get(recoveryScope({...member,...change}), 'task'), undefined)
  assert.equal(store.get(scope, 'calendar'), undefined)
  assert.equal(store.count(), 1)
})
test('외부에서 입력을 변경해도 보관한 명령과 요청 번호는 바뀌지 않는다', () => {
  const store = createPendingRequests(), original = request()
  store.put('scope', 'task', original); original.command.input.title = '다른 입력'; original.key = 'new-key'
  assert.deepEqual(store.get('scope', 'task'), request())
})
test('이전 응답의 정리 작업은 뒤에 생성된 다른 요청을 지우지 않는다', () => {
  const store = createPendingRequests()
  store.put('scope', 'task', request())
  store.put('scope', 'task', {...request(),key:'new-request'})
  store.remove('scope', 'task', 'same-request')
  assert.equal(store.get('scope', 'task').key, 'new-request')
  store.remove('scope', 'task', 'new-request'); assert.equal(store.count(), 0)
})
test('일정은 최초 멱등 키가 일치할 때만 보관을 해제한다', () => {
  const store = createPendingRequests()
  store.put('scope', 'calendar', {command:{draft:{title:'합성 일정'},idempotencyKey:'calendar-key'}})
  store.remove('scope', 'calendar', 'different'); assert.equal(store.count(), 1)
  store.remove('scope', 'calendar', 'calendar-key'); assert.equal(store.count(), 0)
})
test('계정 폐기 후 모든 요청과 구독 결과에서 이전 내용이 사라진다', () => {
  const store = createPendingRequests(), counts = []
  const stop = store.subscribe(() => counts.push(store.count()))
  store.put('scope', 'task', request()); store.clear()
  assert.equal(store.get('scope', 'task'), undefined); assert.deepEqual(counts, [1,0])
  stop(); store.put('scope', 'task', request()); assert.deepEqual(counts, [1,0])
})
test('다른 교사 변경과 명부 순서 변화는 내 명령을 유지하고 담당 범위 회수는 폐기한다', () => {
  const store = createPendingRequests()
  const owner = {...member,role:'calendar_manager',departmentIds:['a','b'],gradeIds:['1'],subjectIds:['math']}
  const scope = recoveryScope(owner)
  store.put(scope, 'task', request())
  store.retainScopes([recoveryScope({...owner,name:'바뀐 이름',departmentIds:['b','a']})])
  assert.equal(store.count(), 1)
  store.retainScopes([recoveryScope({...owner,role:'teacher'})])
  assert.equal(store.count(), 0)
  for (const change of [{departmentIds:[]},{gradeIds:[]},{subjectIds:[]}]) {
    store.put(scope, 'task', request())
    store.retainScopes([recoveryScope({...owner,...change})]); assert.equal(store.count(), 0)
  }
})
console.log('  → ' + passed + '개 통과' + (failed ? ', ' + failed + '개 실패' : ''))
if (failed) process.exitCode = 1
