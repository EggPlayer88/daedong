// 운영 대신 합성 연결과 실제 ConnectedWorkspace를 사용해 브라우저 새로고침 경계를 시험한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
let contents=readFileSync(new URL('./workhub-assistant-daily-connected-fixture.tsx',import.meta.url),'utf8')
contents=contents.replace("import './reset-fixture-checkpoint'",'')
contents=`import {createTabCheckpoint} from '../../apps/workhub/src/app/tab-checkpoint';
import {recoveryScope} from '../../apps/workhub/src/app/pending-requests';\n`+contents
contents=contents.replace("id: 'member-01', userId: 'user-01'","id: new URLSearchParams(location.search).has('other')?'member-99':'member-01', userId: new URLSearchParams(location.search).has('other')?'user-99':'user-01'")
contents=contents.replace("if (name === 'workhub_context') return ok(context)","if(name==='workhub_context'){if(new URLSearchParams(location.search).has('hold'))await new Promise<void>(resolve=>w.releaseCheckpointContext=resolve);return ok(context)}")
contents=contents.replace("createRoot(document.getElementById('root')!).render",`w.seedPending=()=>createTabCheckpoint(teacher.userId).write('pending',recoveryScope(teacher),[{slot:'task',warn:true,value:{key:'checkpoint-original-key',command:{kind:'create',input:{title:'원래 요청 본문',notes:'새 번호 금지',dueDate:'2026-10-23'}}}}]);
createRoot(document.getElementById('root')!).render`)
const bundle=buildSync({stdin:{contents,loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
let collectionSource=readFileSync(new URL('./workhub-collection-create-fixture.tsx',import.meta.url),'utf8')
collectionSource=`import {createTabCheckpoint} from '../../apps/workhub/src/app/tab-checkpoint';
import {recoveryScope} from '../../apps/workhub/src/app/pending-requests';
`+collectionSource
collectionSource=collectionSource.replace('const memory = createEditDrafts(), pending = createPendingRequests(), receipts = new Map(), uploads = new Map()',`const checkpoint=createTabCheckpoint(members[0].userId),scope=recoveryScope(members[0] as any),memory=createEditDrafts(true,checkpoint),pending=createPendingRequests(checkpoint),receipts=new Map(),uploads=new Map();pending.retainScopes([scope]);memory.activate(scope);
w.markSaving=()=>{const slot=memory.bind<any>(scope,'collection-editor'),value=slot.initial;slot.save({...value,editor:{...value.editor,saving:true}})}`)
collectionSource=collectionSource.replace('function App() {',`function App() {
 const [restored,setRestored]=useState(!memory.restoreCount(scope));`)
collectionSource=collectionSource.replace('return visible && <CollectionServerPanel',`if(!restored)return <button onClick={()=>{memory.restore(scope);pending.restore(scope);setRestored(true)}}>수합 입력 복원</button>;
  return visible && <CollectionServerPanel`)
const collectionBundle=buildSync({stdin:{contents:collectionSource,loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],external=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5291/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true})
async function start(view='assistant'){await page.goto('http://127.0.0.1:5291/checkpoint?view='+view);await page.evaluate(()=>sessionStorage.clear());await page.addScriptTag({content:bundle});await button('업무 찾기').waitFor()}
async function reload(params=''){await page.evaluate(params=>{const url=new URL(location.href);url.searchParams.delete('hold');url.searchParams.delete('other');for(const [key,value]of new URLSearchParams(params))url.searchParams.set(key,value);history.replaceState(null,'',url)},params);await page.reload();await page.addScriptTag({content:bundle})}
let passed=0
async function test(name,run){try{await run();assert.deepEqual(errors,[]);passed++;console.log('  ✓ '+name)}catch(error){console.error(errors,await page.locator('.workhub-connected').count()?await page.locator('.workhub-connected').innerText():await page.locator('body').innerText());throw error}}
try{
 await test('실제 AI 입력을 새로고침해도 검증·복원 선택 전에는 노출하지 않고 이어쓰기로 복구한다',async()=>{
  await start();await input().and(page.locator(':enabled')).waitFor();await input().fill('보관할 업무 질문 123');
  await reload('hold=1');await page.getByRole('heading',{name:'학교 연결 확인 중',exact:true}).waitFor();assert.equal(await input().count(),0);assert.equal(await button('보관한 입력 이어쓰기').count(),0);
  await page.waitForFunction(()=>typeof window.releaseCheckpointContext==='function');await page.evaluate(()=>window.releaseCheckpointContext());
  await button('보관한 입력 이어쓰기').waitFor();assert.equal(await input().count(),0);await page.getByText('선택했던 파일은 다시 골라 주세요. 이전 AI 답변과 학생 근거는 다시 조회합니다.',{exact:true}).waitFor();
  await page.getByText('공용 PC에서는 사용을 마친 뒤 로그아웃해 주세요.',{exact:true}).waitFor();
  await button('보관한 입력 이어쓰기').click();await input().waitFor();assert.equal(await input().inputValue(),'보관할 업무 질문 123');
  assert.equal(await page.evaluate(()=>window.dailyConnected.calls.some(c=>/_ask$|_execute$|_mutate$|_save$/.test(c.name))),false)
 })
 await test('보관한 입력을 버리면 새로고침 후에도 되살아나지 않는다',async()=>{
  await reload();await button('보관한 입력 버리기').click();await input().waitFor();assert.equal(await input().inputValue(),'');
  await reload();await input().waitFor();assert.equal(await button('보관한 입력 이어쓰기').count(),0)
 })
 await test('메시지 입력 보관하고 접기는 새로고침 뒤 본문과 접은 상태를 유지한다',async()=>{
  await start('messages');await button('새 메시지').click();await page.getByLabel('메시지',{exact:true}).fill('접어둔 메시지 본문');await button('입력 접고 목록 보기').click();
  await reload();await button('보관한 입력 이어쓰기').click();await button('작성 계속하기').waitFor();await button('작성 계속하기').click();
  assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'접어둔 메시지 본문');assert.equal(await page.evaluate(()=>window.dailyConnected.calls.some(c=>/_mutate$/.test(c.name))),false)
 })
 await test('미확정 요청은 버리기 없이 원키 복구로 열고 클릭 전 자동 쓰기를 하지 않는다',async()=>{
  await start('tasks');await page.evaluate(()=>window.seedPending());await reload();await button('보관한 입력 이어쓰기').waitFor();assert.equal(await button('보관한 입력 버리기').count(),0);
  await button('보관한 입력 이어쓰기').click();await button('이전 요청 그대로 다시 확인').waitFor();
  assert.equal(await page.evaluate(()=>window.dailyConnected.calls.some(c=>/_mutate$|_create$|_update$|_set_status$/.test(c.name))),false);
  await button('이전 요청 그대로 다시 확인').click();await page.waitForFunction(()=>window.dailyConnected.calls.some(c=>c.args?.p_request_key==='checkpoint-original-key'));
  const call=await page.evaluate(()=>window.dailyConnected.calls.find(c=>c.args?.p_request_key==='checkpoint-original-key'));assert.match(JSON.stringify(call.args),/원래 요청 본문/);assert.match(JSON.stringify(call.args),/새 번호 금지/)
 })
 await test('동일 탭 계정 전환은 이전 사용자의 초안과 요청을 노출하지 않는다',async()=>{
  await start();await input().and(page.locator(':enabled')).waitFor();await input().fill('다른 계정에 보이면 안 됨');await reload('other=1');await input().waitFor();
  assert.equal(await input().inputValue(),'');assert.equal(await button('보관한 입력 이어쓰기').count(),0);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key==='workhub:tab-checkpoint:v1:user-01')),false)
 })
 await test('수합 새로고침은 제목·본문·기한·대상을 유지하고 파일 재선택을 요구하며 자동 저장하지 않는다',async()=>{
  await page.goto('http://127.0.0.1:5291/collection-checkpoint');await page.evaluate(()=>sessionStorage.clear());await page.addScriptTag({content:collectionBundle});
  await button('새 수합 만들기').click();await page.getByLabel('수합 제목',{exact:true}).fill('복구할 문서 수합');await page.getByLabel('안내 내용',{exact:true}).fill('줄바꿈\n보관할 안내');await page.getByLabel('제출 기한',{exact:true}).fill('2026-10-31');await page.getByRole('checkbox',{name:'김담당',exact:true}).check();
  await page.getByLabel('양식 파일 선택',{exact:true}).setInputFiles({name:'재선택.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from('PK synthetic HWPX')});await button('재선택.hwpx 선택 취소').waitFor();
  await page.evaluate(()=>window.markSaving());await page.reload();await page.addScriptTag({content:collectionBundle});await button('수합 입력 복원').click();
  await page.getByLabel('수합 제목',{exact:true}).waitFor();assert.equal(await page.getByLabel('수합 제목',{exact:true}).inputValue(),'복구할 문서 수합');assert.equal(await page.getByLabel('안내 내용',{exact:true}).inputValue(),'줄바꿈\n보관할 안내');assert.equal(await page.getByLabel('제출 기한',{exact:true}).inputValue(),'2026-10-31');assert.equal(await page.getByRole('checkbox',{name:'김담당',exact:true}).isChecked(),true);
  assert.equal(await button('재선택.hwpx 선택 취소').count(),0);assert.equal(await page.getByLabel('양식 파일 선택',{exact:true}).inputValue(),'');await button('수합 초안 저장').and(page.locator(':enabled')).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.length+window.fileCalls.length),0)
 })
 assert.deepEqual(external,[]);console.log('동일 탭 입력 복구 실제 새로고침 '+passed+'건 통과 · 유료 호출 0')
}finally{await browser.close()}
