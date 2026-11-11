import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-plan-approval-connected-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),origin='http://127.0.0.1:5295/',errors=[],external=[]
let passed=0
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await context.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort()}return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true}),plan=()=>page.getByRole('region',{name:'나누어 진행할 업무',exact:true})
async function begin(first,go='바로 이동'){await input().fill(`1. ${first}\n2. 시간표 보여줘`);await button('업무 나누기').click();await plan().waitFor();await plan().getByRole('button',{name:/^1단계 선택/}).click();await button(go).click()}
async function talk(){await button('대화 보기').click();await plan().waitFor()}
async function compose(title='검토할 안내'){await button('새 문서 작성').click();await page.getByLabel('문서 제목',{exact:true}).fill(title);await page.getByLabel('문서 본문',{exact:true}).fill('확인할 내용');await button('초안 저장').click()}
async function saved(version=1){await page.getByText(new RegExp(`문서 v${version}을 저장했습니다`)).waitFor()}
async function act(name){await page.locator('[data-transition-id="handover-1"]').getByRole('button',{name,exact:true}).click();await page.getByLabel('확인·반려·취소 사유',{exact:true}).fill('시험 대상과 범위를 확인했습니다');await page.getByRole('checkbox',{name:'현재 대상과 변경 내용을 확인했습니다',exact:true}).check();await button('확인한 변경 요청').click()}
async function test(name,run){await page.setViewportSize({width:1280,height:1000});await page.goto(origin);await page.addScriptTag({content:bundle});await button('AI 비서').first().click();await input().waitFor();try{await run();passed++;console.log('  ✓ '+name)}catch(e){console.error(await page.locator('.workhub-connected').innerText());throw e}}
try{
 await test('문서 초안과 내용 확인은 접수된 판으로 이력에 남고 최종 제출로 표시하지 않는다',async()=>{
  await begin('문서함 열어줘');await compose();await saved();assert.equal(await page.evaluate(()=>window.qa.writes),1);await talk();assert.match(await plan().innerText(),/문서 초안 저장 · 제출 전/);await button('작성하던 업무 보기').click();await button('내용 확인 완료').click();await saved(2);await talk();assert.match(await plan().innerText(),/문서 내용 확인 · 제출 전/);assert.equal(await plan().locator('[data-outcome="recorded"]').count(),1);await plan().getByText('이전 처리 1건',{exact:true}).click();assert.match(await plan().innerText(),/문서 초안 저장 · 제출 전/)
 })
 await test('문서 응답 유실은 원래 key 복구 뒤 한 번만 반영하고 입력을 보존한다',async()=>{
  await begin('문서함 열어줘');await page.evaluate(()=>window.qa.unknown='document');await compose();await button('같은 문서 요청 다시 확인').waitFor();assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(),0);await button('같은 문서 요청 다시 확인').click();await saved();await talk();assert.match(await plan().innerText(),/문서 초안 저장/);assert.equal(await page.evaluate(()=>window.qa.writes),1);const calls=await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_document_mutate'));assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1])
 })
 await test('한 문서의 처리 뒤 같은 패널에서 만든 다른 문서는 원래 단계에 붙지 않는다',async()=>{
  await begin('문서함 열어줘');await compose('처음 문서');await saved();await compose('별도 문서');await saved();await talk();assert.match(await plan().innerText(),/문서 초안 저장/);assert.equal(await plan().getByText(/이전 처리/).count(),0);assert.equal(await page.evaluate(()=>window.qa.writes),2)
 })
 await test('공식 인계는 관리자 확인과 받는 사람 수락을 별개 접수로 기록한다',async()=>{
  await begin('공식 담당 인계 준비해줘','업무 시작');await act('관리자 확인');await page.locator('[data-transition-id="handover-1"]').getByRole('button',{name:'인수 확인',exact:true}).waitFor();await talk();assert.match(await plan().innerText(),/인계 관리자 확인 · 받는 사람 수락 대기/);assert.doesNotMatch(await plan().innerText(),/인계 수락 · 반영 확인/);await button('작성하던 업무 보기').click();await act('인수 확인');await page.locator('[data-transition-id="handover-1"] [data-state="accepted"]').waitFor();await talk();assert.match(await plan().innerText(),/인계 수락 · 반영 확인/);await plan().getByText('이전 처리 1건',{exact:true}).click();assert.match(await plan().innerText(),/관리자 확인 · 받는 사람 수락 대기/);assert.equal(await page.evaluate(()=>window.qa.writes),2);await page.setViewportSize({width:320,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 })
 await test('인계 응답 유실 복구는 같은 번호를 사용하고 자동 수락하지 않는다',async()=>{
  await begin('공식 담당 인계 준비해줘','업무 시작');await page.evaluate(()=>window.qa.unknown='transition');await act('관리자 확인');await button('원래 인계 요청 결과 확인').waitFor();assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(),0);await button('원래 인계 요청 결과 확인').click();await page.locator('[data-transition-id="handover-1"]').getByRole('button',{name:'인수 확인',exact:true}).waitFor();await talk();assert.match(await plan().innerText(),/인계 관리자 확인 · 받는 사람 수락 대기/);assert.equal(await page.evaluate(()=>window.qa.writes),1);const calls=await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_school_transition_mutate'));assert.deepEqual(calls[0],calls[1])
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`실제 연결 셸 문서·인계 결과 ${passed}건 통과 · 합성 RPC·유료 호출 0`)
}finally{await browser.close()}
