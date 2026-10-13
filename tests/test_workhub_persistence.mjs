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
  assert.deepEqual([...storage.values.keys()].sort(), ['other-app', 'sb-existing-auth-token', 'workhub:synthetic:v3:workspace'])
  assert.deepEqual(JSON.parse(storage.values.get('workhub:synthetic:v3:workspace')).sections,{})
})
await test('영속 영역과 학생 메모리 초기화는 저장 성공 후 함께 확정한다', () => {
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
await test('학생·활동 자유기록은 현재 인스턴스에만 남고 브라우저나 내보내기에 기록하지 않는다', () => {
  const storage=port(),p=createDemoPersistence(storage)
  const record={observations:[{content:'학생 기록 메모리 전용 표식'}],sources:[{answer:'활동 답변 메모리 전용 표식'}]}
  p.save('students',record)
  assert.deepEqual(p.load('students'),record)
  assert.equal(createDemoPersistence(storage).load('students'),undefined)
  assert.equal(storage.values.size,0)
  assert(!p.exportRaw().includes('메모리 전용 표식'))
  storage.getItem=()=>{throw new Error('blocked')};storage.setItem=()=>{throw new Error('blocked')}
  p.save('students',{observations:['저장소 차단에도 메모리 동작']})
  assert.deepEqual(p.load('students'),{observations:['저장소 차단에도 메모리 동작']})
})
await test('구버전 학생 자료는 자동 복원·재저장하지 않고 원본 바이트를 보존한다', () => {
  const storage=port(),oldKey='workhub:synthetic:v2:workspace',newKey='workhub:synthetic:v3:workspace'
  const original=JSON.stringify({schema:2,kind:'synthetic-only',revision:7,sections:{calendar:{title:'기존 일정'},workflows:{title:'기존 업무'},students:{content:'구버전 학생 기록 표식'}}})
  storage.values.set(oldKey,original)
  const p=createDemoPersistence(storage)
  assert.equal(p.load('students'),undefined)
  assert.deepEqual(p.load('calendar'),{title:'기존 일정'})
  assert.deepEqual(p.load('workflows'),{title:'기존 업무'})
  p.save('workflows',{title:'변경한 업무'})
  assert.equal(storage.values.get(oldKey),original)
  assert(!storage.values.get(newKey).includes('구버전 학생 기록 표식'))
  assert.deepEqual(Object.keys(JSON.parse(storage.values.get(newKey)).sections).sort(),['calendar','workflows'])
  const next=createDemoPersistence(storage)
  assert.equal(next.load('students'),undefined)
  assert.deepEqual(next.load('workflows'),{title:'변경한 업무'})
  p.clear()
  assert.equal(storage.values.get(oldKey),original)
  assert.equal(createDemoPersistence(storage).load('calendar'),undefined)
})
await test('일괄 교체나 변조된 새 봉투로도 학생 영역이 영속 저장·자동 복원되지 않는다', () => {
  const storage=port(),p=createDemoPersistence(storage),key='workhub:synthetic:v3:workspace'
  p.replaceAll({calendar:{title:'일정'},students:{content:'일괄 입력 학생 기록'}})
  assert.deepEqual(p.load('students'),{content:'일괄 입력 학생 기록'})
  assert(!storage.values.get(key).includes('일괄 입력 학생 기록'))
  const raw=JSON.parse(storage.values.get(key));raw.sections.students={content:'변조 학생 기록'};storage.values.set(key,JSON.stringify(raw))
  const next=createDemoPersistence(storage)
  assert.equal(next.load('students'),undefined)
  assert.deepEqual(next.load('calendar'),{title:'일정'})
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
