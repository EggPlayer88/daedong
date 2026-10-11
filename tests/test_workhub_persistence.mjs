import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { createDemoPersistence, acquireDemoLease, createMemoryAdapter, fixtureData } = await loadBrowserModule(`
  export { createDemoPersistence, acquireDemoLease } from '../apps/workhub/src/preview/persistence.ts'
  export { createMemoryAdapter } from '../apps/workhub/src/preview/memory-adapter.ts'
  export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
`)
let failures = 0
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name) } catch (error) { failures++; console.error('  ✗ ' + name + ': ' + error.message) } }
function port() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}
const own = fixtureData.events.find(event => event.authorMemberId === 'gaon-soyeon')
await test('저장 후 새 인스턴스가 일정과 멱등 접수 결과를 복원한다', async () => {
  const storage = port()
  function boot() { const p = createDemoPersistence(storage); return createMemoryAdapter(fixtureData, 0, { snapshot: p.load('calendar'), onChange: snapshot => p.save('calendar', snapshot) }) }
  const first = boot()
  const cmd = { id: own.id, expectedVersion: own.version, draft: { ...own, title: '새로고침 후 유지' }, idempotencyKey: 'restore-1' }
  const saved = await first.save(own.authorMemberId, cmd)
  const second = boot()
  assert.equal((await second.get(own.authorMemberId, own.id)).title, saved.title)
  assert.equal((await second.save(own.authorMemberId, cmd)).version, saved.version)
})
await test('저장장치 실패 시 메모리 원본과 버전·접수 결과도 확정하지 않는다', async () => {
  const storage = port(); const p = createDemoPersistence(storage); p.load('calendar')
  const adapter = createMemoryAdapter(fixtureData, 0, { onChange: snapshot => p.save('calendar', snapshot) })
  storage.setItem = () => { throw new Error('quota') }
  await assert.rejects(adapter.save(own.authorMemberId, { id: own.id, expectedVersion: own.version, draft: { ...own, title: '유실되면 안 됨' }, idempotencyKey: 'quota' }), /저장하지 못했습니다/)
  assert.equal((await adapter.get(own.authorMemberId, own.id)).version, own.version)
  assert.equal(adapter.exportState().receipts.length, 0)
})
await test('손상된 저장 자료는 삭제하거나 빈 목록으로 바꾸지 않는다', () => {
  const storage = port(); storage.values.set('workhub:synthetic:v2:workspace', '{broken')
  const p = createDemoPersistence(storage)
  assert.throws(() => p.load('calendar'), /원본을 유지/)
  assert.equal(storage.values.get('workhub:synthetic:v2:workspace'), '{broken')
  assert(p.exportRaw().includes('{broken'))
})
await test('이전 창의 버전으로 새 내용을 덮어쓰지 않는다', () => {
  const storage = port(); const a = createDemoPersistence(storage); const b = createDemoPersistence(storage)
  a.load('workflows'); b.load('workflows'); a.save('workflows', { title: '원본' })
  assert.throws(() => b.save('workflows', { title: '낡은 화면' }), /다른 창/)
  assert.equal(createDemoPersistence(storage).load('workflows').title, '원본')
})
await test('개발 자료 초기화가 로그인과 다른 앱 저장키에 닿지 않는다', () => {
  const storage = port(); storage.values.set('sb-existing-auth-token', 'opaque'); storage.values.set('other-app', 'keep')
  const p = createDemoPersistence(storage); p.load('students'); p.save('students', { synthetic: true }); p.clear()
  assert.deepEqual([...storage.values.keys()].sort(), ['other-app', 'sb-existing-auth-token'])
})
await test('세 영역 초기화는 저장 한 번으로 확정하고 실패하면 어느 영역도 바꾸지 않는다', () => {
  const storage = port(); const p = createDemoPersistence(storage)
  for (const section of ['calendar', 'workflows', 'students']) { p.load(section); p.save(section, { title: section }) }
  const before = p.exportRaw(); const write = storage.setItem
  storage.setItem = () => { throw new Error('quota') }
  assert.throws(() => p.replaceAll({}), /저장하지 못했습니다/)
  assert.equal(p.exportRaw(), before)
  for (const section of ['calendar', 'workflows', 'students']) assert.equal(p.load(section).title, section)
  let writes = 0; storage.setItem = (...args) => { writes++; return write(...args) }
  p.replaceAll({}); assert.equal(writes, 1)
  for (const section of ['calendar', 'workflows', 'students']) assert.equal(createDemoPersistence(storage).load(section), undefined)
})
await test('복원할 때 위조 학교·깨진 audience·중복 원본을 거부한다', () => {
  const initial = createMemoryAdapter(fixtureData, 0).exportState()
  const cross = structuredClone(initial); cross.data.events[0].schoolId = 'other'
  assert.throws(() => createMemoryAdapter(fixtureData, 0, { snapshot: cross }))
  const broken = structuredClone(initial); broken.data.events[0].audience.groups = null
  assert.throws(() => createMemoryAdapter(fixtureData, 0, { snapshot: broken }))
  const duplicate = structuredClone(initial); duplicate.data.events.push(duplicate.data.events[0])
  assert.throws(() => createMemoryAdapter(fixtureData, 0, { snapshot: duplicate }))
})
await test('Web Locks 없이는 영속 쓰기를 사용하지 않는다', async () => {
  assert.equal((await acquireDemoLease()).status, 'memory')
  assert.equal(createDemoPersistence().persistent, false)
})
await test('다른 창의 저장 잠금이 있으면 두 번째 편집을 열지 않는다', async () => {
  const busy = { request: async (_name, _options, callback) => callback(null) }
  assert.equal((await acquireDemoLease(busy)).status, 'busy')
  let ended = false
  const free = { request: async (_name, _options, callback) => { await callback({}); ended = true } }
  const lease = await acquireDemoLease(free)
  assert.equal(lease.status, 'persistent'); assert.equal(ended, false)
  lease.release(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(ended, true)
})
if (failures) process.exitCode = 1
