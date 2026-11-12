import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-cooperation-result-connected-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),origin='http://127.0.0.1:5297/',errors=[],external=[]
let count=0
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await context.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort()}return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),plan=()=>page.getByRole('region',{name:'나누어 진행할 업무',exact:true})
async function begin(){await page.getByLabel('질문 또는 부탁할 일',{exact:true}).fill('1. 협업 열어줘\n2. 시간표 보여줘');await button('업무 나누기').click();await plan().getByRole('button',{name:/^1단계 선택/}).click();await button('바로 이동').click();await page.getByLabel('요청함',{exact:true}).waitFor()}
async function open(sent=false,n=1){if(sent)await page.getByLabel('요청함',{exact:true}).selectOption('sent');await page.getByRole('region',{name:'협업 요청 목록',exact:true}).getByRole('button',{name:new RegExp('검토 요청 '+n)}).click();await page.getByRole('article',{name:'선택한 협업 요청',exact:true}).waitFor()}
async function act(name){await button(name).click();await page.getByLabel('처리 내용·사유',{exact:true}).fill('확인한 시험 처리');await page.getByRole('checkbox',{name:'현재 요청 상태와 처리 내용을 확인했습니다.',exact:true}).check();await button('확인한 처리 저장').click()}
async function done(){await page.getByText('서버에 저장했습니다.',{exact:true}).waitFor()}
async function talk(){await button('대화 보기').click();await plan().waitFor()}
async function test(name,url,run){await page.setViewportSize({width:1280,height:1000});await page.goto(origin+url);await page.addScriptTag({content:bundle});await button('AI 비서').first().click();try{await begin();await run();count++;console.log('  ✓ '+name)}catch(e){console.error(await page.locator('.workhub-connected').innerText());throw e}}
try{
 await test('협업 수락과 완료 확인 요청을 실제 완료와 구분하고 같은 원본 이력을 보존한다','',async()=>{await open();await act('수락');await done();await act('완료 확인 요청');await done();await talk();assert.match(await plan().innerText(),/협업 완료 확인 요청 · 확인 대기/);assert.doesNotMatch(await plan().innerText(),/협업 완료 확인\n/);await plan().getByText('이전 처리 1건',{exact:true}).click();assert.match(await plan().innerText(),/협업 수락 · 진행 중/);assert.equal(await page.evaluate(()=>window.qa.writes),2)})
 for(const [name,url,action,label] of [
  ['발신자의 완료 확인만 완료 결과다','?role=sender&state=completion_requested','완료 확인','협업 완료 확인'],
  ['보완 요청은 완료가 아니다','?role=sender&state=completion_requested','보완 요청','협업 보완 요청'],
  ['받는 사람의 반려를 구분한다','','반려','협업 요청 반려'],
  ['완료 요청 철회는 실제 취소와 구분한다','?state=completion_requested','완료 요청 철회','협업 완료 요청 철회'],
  ['발신자의 요청 취소를 기록한다','?role=sender','요청 취소','협업 요청 취소'],
 ])await test(name,url,async()=>{await open(url.includes('role=sender'));await act(action);await done();await talk();assert.match(await plan().innerText(),new RegExp(label));assert.equal(await page.evaluate(()=>window.qa.writes),1)})
 await test('새 협업 요청은 받은 사람 응답 전으로 표시한다','',async()=>{await button('새 협업 요청').click();await page.getByLabel('받는 선생님',{exact:true}).selectOption('member-two');await page.getByLabel('요청 제목',{exact:true}).fill('새 시험 협업');await page.getByLabel('요청 내용',{exact:true}).fill('원문 보존');await page.getByRole('checkbox',{name:/보낼 내용과 기한을 확인/}).check();await button('확인한 요청 보내기').click();await done();await talk();assert.match(await plan().innerText(),/협업 요청 접수 · 응답 대기/)})
 await test('응답 유실은 같은 요청으로 복구하고 쓰기는 한 번만 한다','',async()=>{await open();await page.evaluate(()=>window.qa.unknown=true);await act('수락');await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal(await plan().locator('[data-outcome="recorded"]').count(),0);await button('같은 요청으로 결과 다시 확인').click();await page.getByText('이전 요청이 저장된 것을 확인했습니다.',{exact:true}).waitFor();await talk();assert.match(await plan().innerText(),/협업 수락/);const calls=await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_cooperation_mutate'));assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.qa.writes),1)})
 await test('잘못된 판의 접수는 결과로 남기지 않고 원래 번호로 확인한다','',async()=>{await open();await page.evaluate(()=>window.qa.malformed=true);await act('수락');await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal(await plan().locator('[data-outcome="recorded"]').count(),0);await button('같은 요청으로 결과 다시 확인').click();await page.getByText('이전 요청이 저장된 것을 확인했습니다.',{exact:true}).waitFor();await talk();assert.match(await plan().innerText(),/협업 수락/);assert.equal(await page.evaluate(()=>window.qa.writes),1)})
 await test('같은 화면의 다른 협업 요청은 원래 단계에 붙지 않는다','',async()=>{await open();await act('수락');await done();await open(false,2);await act('반려');await done();await talk();assert.match(await plan().innerText(),/협업 수락 · 진행 중/);assert.doesNotMatch(await plan().innerText(),/협업 요청 반려|이전 처리/);await page.setViewportSize({width:320,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))})
 await test('후속 조회가 실패해도 이미 접수한 협업 결과는 남는다','',async()=>{await open();await page.evaluate(()=>window.qa.failGet=true);await act('수락');await done();await talk();assert.match(await plan().innerText(),/협업 수락/);assert.equal(await page.evaluate(()=>window.qa.writes),1)})
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`실제 연결 셸 협업 결과 ${count}건 통과 · 합성 RPC·유료 호출 0`)
}finally{await browser.close()}
