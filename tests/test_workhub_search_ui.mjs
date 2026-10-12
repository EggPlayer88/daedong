// 검색 UI의 실제 JSX와 조회 세대 처리를 합성 자료로 확인한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { renderInitial, renderResults, createWorkspaceSearchLoader } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { WorkspaceSearch, SearchResultsView, createWorkspaceSearchLoader } from '../apps/workhub/src/search/WorkspaceSearch.tsx'
  export { createWorkspaceSearchLoader }
  export function renderInitial(props) { return renderToStaticMarkup(<WorkspaceSearch {...props}/>) }
  export function renderResults(props) { return renderToStaticMarkup(<SearchResultsView onRetry={()=>{}} onOpen={()=>{}} {...props}/>) }
`)
let passed = 0, failed = 0
async function test(name, action) { try { await action(); passed++; console.log(`  ✓ ${name}`) } catch(error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error}`) } }
const item = (changes={}) => ({id:'fixture-one',kind:'calendar',title:'합성 학교 행사',description:'준비 자료 확인',meta:'가상 일정 · 10월 12일',...changes})
const state = (kind='calendar',status='ready',items=[item({kind})]) => ({kind,label:{calendar:'학교 일정',task:'내 업무',collection:'자료 수합'}[kind],status,items})
const tick = () => new Promise(resolve => setTimeout(resolve,0))
function deferred() { let resolve,reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject} }

await test('닫힌 검색은 자동 조회하지 않고 범위 ID·검색 자료를 DOM에 넣지 않는다', () => {
  let calls=0
  const html=renderInitial({sources:[{kind:'calendar',label:'학교 일정',load:()=>{calls++;return Promise.resolve([item({description:'SECRET-BODY'})])}}],scopeKey:'SECRET-SCOPE',onOpen:()=>true})
  assert.equal(calls,0);assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/>업무 찾기<\/button>/)
  assert(!html.includes('SECRET-SCOPE'));assert(!html.includes('SECRET-BODY'));assert(!html.includes('ws-search-result"'))
})
await test('편집 잠금이면 검색 진입을 막는다', () => {
  const html=renderInitial({sources:[],scopeKey:'fixture',locked:true,onOpen:()=>true})
  assert.match(html,/<button[^>]+class="ws-search-trigger"[^>]+disabled=""/)
})
await test('조회 중에는 확정된 0건이나 자료 없음으로 표시하지 않는다', () => {
  const html=renderResults({states:[state('calendar','loading',[])],query:''})
  assert.match(html,/불러오는 중/);assert.match(html,/현재 확인한 결과 0건/)
  assert(!html.includes('>검색 결과 0건'));assert(!html.includes('일치하는 업무가 없습니다'))
})
await test('부분 실패에서도 성공 결과와 실패 범위별 재시도를 함께 제공한다', () => {
  const html=renderResults({states:[state(),state('task','failed',[])],query:''})
  assert.match(html,/합성 학교 행사/);assert.match(html,/현재 확인한 결과 1건/);assert.match(html,/aria-label="내 업무 다시 불러오기"/)
  assert(!html.includes('aria-label="학교 일정 다시 불러오기"'))
})
await test('모든 조회 실패는 빈 검색 결과와 구분한다', () => {
  const html=renderResults({states:[state('calendar','failed',[])],query:''})
  assert.match(html,/실패한 범위를 다시 불러와 주세요/);assert(!html.includes('일치하는 업무가 없습니다'))
})
await test('전체 결과 수를 알리고 최대 50개만 표시한다', () => {
  const html=renderResults({states:[state('calendar','ready',Array.from({length:53},(_,n)=>item({id:`fixture-${n}`,title:`합성 행사 ${String(n).padStart(2,'0')}`})))],query:''})
  assert.match(html,/검색 결과 53건/);assert.match(html,/앞의 50건 표시/)
  assert.equal((html.match(/class="ws-search-result"/g)||[]).length,50)
})
await test('검색어 길이 제한 없이 한 글자·공백·한글 조합 형태를 공통 필터로 처리한다', () => {
  const states=[state('calendar','ready',[item({title:'가 나 행사'})])]
  for(const query of ['가','  가   나  ','가']) assert.match(renderResults({states,query}),/검색 결과 1건/)
})
await test('종류 필터는 해당 결과와 해당 조회 상태만 표시한다', () => {
  const html=renderResults({states:[state(),state('task','ready',[item({kind:'task',title:'합성 할 일'})])],query:'',kind:'task'})
  assert.match(html,/합성 할 일/);assert(!html.includes('합성 학교 행사'));assert.match(html,/검색 결과 1건/)
})
await test('발췌 뒤 원문은 숨은 DOM 속성에도 복제하지 않는다', () => {
  const html=renderResults({states:[state('calendar','ready',[item({description:'가'.repeat(155)+'SECRET-HIDDEN-BODY',meta:'나'.repeat(155)+'SECRET-HIDDEN-META'})])],query:''})
  assert(!html.includes('SECRET-HIDDEN-BODY'));assert(!html.includes('SECRET-HIDDEN-META'));assert(!html.includes('data-description'));assert.match(html,/…/)
})
await test('결과 문자열은 HTML로 실행하지 않고 잠긴 결과는 선택할 수 없다', () => {
  const html=renderResults({states:[state('calendar','ready',[item({title:'<img src=x onerror=alert(1)>',description:'<script>bad()</script>'})])],query:'',locked:true})
  assert(!html.includes('<img'));assert(!html.includes('<script>'));assert.match(html,/&lt;img/);assert.match(html,/class="ws-search-result"[^>]+disabled=""/)
})
await test('완료된 빈 범위와 조회할 범위가 없는 경우를 구분한다', () => {
  assert.match(renderResults({states:[state('calendar','ready',[])],query:''}),/일치하는 업무가 없습니다/)
  assert.match(renderResults({states:[],query:''}),/현재 찾을 수 있는 업무 범위가 없습니다/)
})
await test('조회 조정기는 시작 전 동작하지 않고 동기 예외도 다른 소스와 격리한다', async () => {
  let calls=0,latest=[]
  const loader=createWorkspaceSearchLoader(value=>{latest=value})
  assert.equal(calls,0)
  loader.start([{kind:'calendar',label:'학교 일정',load:()=>{calls++;throw new Error('SECRET-SERVER-ERROR')}},{kind:'task',label:'내 업무',load:async()=>[item({kind:'task'})]}])
  await tick();assert.equal(calls,1);assert.equal(latest[0].status,'failed');assert.equal(latest[1].status,'ready');assert(!JSON.stringify(latest).includes('SECRET-SERVER-ERROR'));loader.stop()
})
await test('같은 소스의 늦은 이전 재시도가 최신 재시도 결과를 덮지 않는다', async () => {
  let latest=[],count=0
  const first=deferred(),second=deferred(),loader=createWorkspaceSearchLoader(value=>{latest=value})
  loader.start([{kind:'calendar',label:'학교 일정',load:()=>++count===1?first.promise:second.promise}]);await tick()
  loader.retry('calendar');await tick();second.resolve([item({title:'새 결과'})]);await tick();first.resolve([item({title:'옛 결과'})]);await tick()
  assert.equal(latest[0].items[0].title,'새 결과');assert.equal(count,2);loader.stop()
})
await test('소스 교체는 기존 결과를 즉시 버리고 이전 응답을 무시한다', async () => {
  let latest=[]
  const first=deferred(),loader=createWorkspaceSearchLoader(value=>{latest=value})
  loader.start([{kind:'calendar',label:'학교 일정',load:()=>first.promise}]);await tick()
  loader.start([{kind:'task',label:'내 업무',load:async()=>[item({kind:'task',title:'다른 범위 결과'})]}]);assert.deepEqual(latest[0].items,[]);await tick()
  first.resolve([item({title:'이전 범위 자료'})]);await tick();assert.equal(latest.length,1);assert.equal(latest[0].kind,'task');assert.equal(latest[0].items[0].title,'다른 범위 결과');loader.stop()
})
await test('닫힘·해제 후 성공과 실패 응답은 다시 게시되지 않고 재시도도 중단한다', async () => {
  let writes=0,calls=0
  const first=deferred(),second=deferred(),loader=createWorkspaceSearchLoader(()=>{writes++})
  loader.start([{kind:'calendar',label:'학교 일정',load:()=>{calls++;return first.promise}},{kind:'task',label:'내 업무',load:()=>{calls++;return second.promise}}]);await tick();loader.stop()
  const before=writes;first.resolve([item()]);second.reject(new Error('late'));loader.retry('calendar');await tick()
  assert.equal(writes,before);assert.equal(calls,2)
})
await test('깨진 결과는 실패로 표시하고 응답 부수 필드·외부 객체 변경을 전파하지 않는다', async () => {
  let latest=[]
  const original=item({debugSecret:'SECRET-EXTRA'}),loader=createWorkspaceSearchLoader(value=>{latest=value})
  loader.start([{kind:'calendar',label:'학교 일정',load:async()=>[original]},{kind:'task',label:'내 업무',load:async()=>null}]);await tick()
  original.title='뒤늦은 외부 변경';assert.equal(latest[0].items[0].title,'합성 학교 행사');assert(!JSON.stringify(latest).includes('SECRET-EXTRA'));assert.equal(latest[1].status,'failed');loader.stop()
})
console.log(`업무 찾기 UI ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exit(1)
