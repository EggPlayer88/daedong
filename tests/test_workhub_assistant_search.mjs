import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { searchAssistantWorkspace } = await loadBrowserModule(`export { searchAssistantWorkspace } from '../apps/workhub/src/assistant/workspace-search.ts'`)
let passed = 0
async function test(name, action) { await action(); passed++; console.log('  ✓ ' + name) }
const item = (overrides = {}) => ({ id: 'source-one', kind: 'knowledge', title: '출장 규정', description: '학교 출장 절차', meta: '2판', version: 2, locator: '3쪽', ...overrides })
const source = (load, kind = 'knowledge') => ({kind, label: kind === 'knowledge' ? '학교 자료' : '문서함', load})
const search = (sources, query = '출장', kinds = ['knowledge'], controller = new AbortController()) => searchAssistantWorkspace(sources,query,kinds,controller.signal)
const tick = () => new Promise(resolve => setTimeout(resolve,0))
await test('명시한 자료원만 기존 검색으로 조회하고 원본 ID·판·위치를 보존한다', async () => {
  const calls=[]
  const result=await search([source(async options=>{calls.push(options);return [item({unexpected:'SECRET'})]}),source(async()=>{throw Error('조회하면 안 됨')},'document')])
  assert.equal(calls.length,1); assert.equal(calls[0].query,'출장'); assert.equal(calls[0].cursor,null)
  assert.equal(result.items[0].id,'source-one'); assert.equal(result.items[0].version,2); assert.equal(result.items[0].locator,'3쪽'); assert(!('unexpected' in result.items[0])); assert.equal(result.hasMore,false)
})
await test('첫 쪽과 일부 표시를 전체 결과로 과장하지 않고 다음 쪽을 자동 수집하지 않는다', async () => {
  let calls=0
  const result=await search([source(async()=>{calls++;return {items:Array.from({length:25},(_,i)=>item({id:'s'+i})),nextCursor:'more',coverage:'게시 자료',scanned:25}})])
  assert.equal(calls,1); assert.equal(result.items.length,20); assert.equal(result.hasMore,true)
  assert.match(result.coverage.join(' '),/첫 쪽/); assert.match(result.coverage.join(' '),/25건 중 앞의 20건/)
})
await test('성공한 빈 결과와 전부 조회 실패를 구분한다', async () => {
  assert.deepEqual((await search([source(async()=>[])])).items,[])
  await assert.rejects(search([source(async()=>{throw new Error('network')})]),/확인하지 못했습니다/)
})
await test('일부 실패는 성공한 결과 옆에 실패 범위를 남긴다', async () => {
  const result=await search([source(async()=>[item()]),source(async()=>{throw new Error('network')},'document')],'출장',['knowledge','document'])
  assert.equal(result.items.length,1); assert.equal(result.hasMore,true); assert.match(result.coverage.join(' '),/문서함: 조회 실패/)
})
await test('계정 취소 신호는 이미 읽힌 다른 자료까지 노출하지 않는다', async () => {
  let release
  const delayed = new Promise((_,reject)=>{release=reject})
  const promise=search([source(async()=>[item()]),source(()=>delayed,'document')],'출장',['knowledge','document'])
  await tick(); release({code:'CANCELLED'})
  await assert.rejects(promise,/확인하지 못했습니다/)
})
await test('다른 종류를 섞거나 잘못된 판·커서를 반환한 자료원은 거부한다', async () => {
  for (const result of [[item({kind:'document'})],[item({version:0})],{items:[item()],nextCursor:37,coverage:''}]) {
    await assert.rejects(search([source(async()=>result)]),/확인하지 못했습니다/)
  }
})
await test('조회 중 닫기는 즉시 중단하며 뒤늦은 결과를 다시 반환하지 않는다', async () => {
  const controller=new AbortController();let release, observed
  const promise=search([source(options=>{observed=options.signal;return new Promise(resolve=>{release=resolve})})],'출장',['knowledge'],controller)
  await tick();controller.abort();await assert.rejects(promise,/취소/);assert.equal(observed.aborted,true)
  release([item()]);await tick()
})
await test('이미 취소되었거나 잘못된 입력은 자료를 조회하지 않는다', async () => {
  let calls=0;const sources=[source(async()=>{calls++;return []})]
  const controller=new AbortController();controller.abort()
  await assert.rejects(search(sources,'출장',['knowledge'],controller),/취소/)
  for(const query of ['', ' '.repeat(5), '가'.repeat(201)]) await assert.rejects(search(sources,query),/검색어/)
  await assert.rejects(search(sources,'출장',['invented']),/종류/)
  await assert.rejects(search(sources,'출장',['document']),/조회할 수 없는/)
  assert.equal(calls,0)
})
console.log(`대화 자료 조회 ${passed}건 통과`)
