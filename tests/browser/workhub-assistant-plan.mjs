// 복합 요청을 단계로 나눠도 선택·전송을 자동으로 이어 실행하지 않는 실제 연결 셸 회귀.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-global-search-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage(),errors=[],external=[]
const origin='http://127.0.0.1:5280/'
let passed=0
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true}),plan=()=>page.getByRole('region',{name:'나누어 진행할 업무',exact:true})
const text='시간표 보여줘 그리고 교사 명부 보여줘'
async function noWrite(){assert.deepEqual(await page.evaluate(()=>window.qa.calls.filter(x=>/(?:_mutate|_execute|_commit|_ask|_confirm|_apply)$/.test(x.name))),[])}
async function build(value=text){await input().fill(value);await button('업무 나누기').click();await plan().waitFor()}
async function test(name,run){await page.setViewportSize({width:1280,height:950});await page.goto(origin+'plan');await page.addScriptTag({content:bundle});await button('AI 비서').first().click();await input().waitFor();try{await run();passed++;console.log('  ✓ '+name)}catch(error){console.error(await page.locator('.workhub-connected').innerText());throw error}}
try{
 await test('번호를 붙인 일반 질문은 실행 계획으로 바꾸지 않고 기존 AI 요청 경로에 남긴다',async()=>{
  const request='1. 협업이 어려운 이유를 설명해줘\n2. 개선 방법을 제안해줘';await input().fill(request)
  assert.equal(await button('업무 나누기').count(),0);assert.equal(await button('요청 확인').count(),0);assert.equal(await plan().count(),0)
  assert.equal(await button('AI에게 요청').isDisabled(),true);assert.equal(await input().inputValue(),request);await noWrite()
 })
 await test('명시적 복합 요청은 원문과 2단계만 보관하고 조회·유료 호출·쓰기를 실행하지 않는다',async()=>{
  await build();assert.equal(await plan().locator('li').count(),2);assert.equal(await input().inputValue(),'');assert.equal(await page.locator('.assistant-delivery-work').count(),0);await plan().locator('summary').click();assert.equal(await plan().locator('.assistant-text').innerText(),text);await noWrite()
 })
 await test('단계 선택은 입력만 채우며 각 실행 뒤에도 다음 단계는 자동 시작하지 않는다',async()=>{
  await build();await button('1단계 선택 · 시간표 열기').click();assert.equal(await input().inputValue(),'시간표 보여줘');assert.equal(await page.locator('.assistant-delivery-work').count(),0)
  await button('바로 이동').click();await page.locator('[data-timetable-presentation="assistant"]').waitFor();assert.equal(await page.locator('.school-administration-conversation').count(),0)
  await button('대화 보기').click();await plan().waitFor();assert.match(await plan().innerText(),/최근 선택/);await button('2단계 선택 · 교사 명부·배정').click();assert.equal(await input().inputValue(),'교사 명부 보여줘');await button('업무 시작').click();await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();await noWrite()
 })
 await test('새로 작성한 질문은 단계 선택과 원문 복원으로 덮어쓰지 않는다',async()=>{
  await build();await input().fill('보존할 새 질문');assert.equal(await button('1단계 선택 · 시간표 열기').isDisabled(),true);await plan().locator('summary').click();assert.equal(await button('원문 다시 검토').isDisabled(),true);await button('목록 닫기').click();assert.equal(await input().inputValue(),'보존할 새 질문');await noWrite()
 })
 await test('보관 목록이 있을 때 새 복합 요청을 보내도 기존 목록과 새 원문을 함께 유지한다',async()=>{
  await build();const next='학교 자료 열어줘 그리고 협업 열어줘';await input().fill(next);await button('업무 나누기').click();await page.getByText('보관한 업무 목록을 먼저 닫아 주세요. 새 요청은 입력칸에 유지했습니다.',{exact:true}).waitFor();assert.equal(await input().inputValue(),next);assert.match(await plan().innerText(),/교사 명부/);await noWrite()
 })
 await test('중간에 지원하지 않는 요청이 있으면 일부 단계만 실행하거나 유료 질문으로 보내지 않는다',async()=>{
  const request='시간표 보여줘 그리고 전교사 권한 바꿔줘';await input().fill(request);await button('요청 확인').click();assert.equal(await plan().count(),0);assert.equal(await input().inputValue(),request);await noWrite()
 })
 await test('기준일이 바뀌면 상대날짜 단계는 실행하지 않고 원문을 명시 복원한다',async()=>{
  const original='내일 오후 3시부터 4시까지 협의회 일정 만들어줘 그리고 교사 명부 보여줘';await build(original);await page.evaluate(()=>window.qa.setDate('2026-10-22'));await page.getByText('기준 날짜가 바뀌었습니다. 원문을 다시 검토해 주세요.',{exact:true}).waitFor();assert.equal(await plan().getByRole('button',{name:/1단계 선택/}).isDisabled(),true)
  await plan().locator('summary').click();await button('원문 다시 검토').click();assert.equal(await input().inputValue(),original);assert.equal(await plan().count(),0);await noWrite()
 })
 await test('새로고침 없는 연결 재확인에서도 단계 원문을 유지하고 실행하지 않는다',async()=>{
  await build();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await plan().waitFor();assert.equal(await plan().locator('li').count(),2);await noWrite()
 })
 await test('상대날짜 단계를 입력한 뒤 날짜가 바뀌어도 새 날짜로 자동 해석하지 않는다',async()=>{
  await build('내일 오후 3시부터 4시까지 협의회 일정 만들어줘 그리고 교사 명부 보여줘');await plan().getByRole('button',{name:/1단계 선택/}).click();const original=await input().inputValue()
  await page.evaluate(()=>window.qa.setDate('2026-10-22'));await page.getByText('기준 날짜가 바뀌었습니다. 원문을 다시 검토해 주세요.',{exact:true}).waitFor();assert.equal(await button('일정 초안 열기').isDisabled(),true);assert.equal(await input().inputValue(),original);await noWrite()
  await input().fill('');await plan().locator('summary').click();await button('원문 다시 검토').click();assert.match(await input().inputValue(),/그리고 교사 명부/);assert.equal(await plan().count(),0)
 })
 await test('일정 메뉴 지시는 AI 안의 기존 일정 편집기를 하나만 열고 등록하지 않는다',async()=>{
  await input().fill('일정 열어줘');await button('바로 이동').click();await page.getByRole('region',{name:'대화에서 일정 처리',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'assistant');assert.equal(await page.locator('.assistant-calendar-workspace').count(),1);assert.equal(await page.locator('#main-content').count(),1);await noWrite()
 })
 await test('소속 신원이 무효화되면 계획 원문과 실행 버튼을 숨긴다',async()=>{
  await build();await page.evaluate(()=>window.qa.deny());await page.locator('.connected-empty').waitFor();assert.equal(await plan().count(),0);await noWrite()
 })
 await test('320px·키보드 높이 축소에서 긴 단계와 선택 버튼이 잘리지 않는다',async()=>{
  await page.setViewportSize({width:320,height:430});await build('학교 자료에서 아주긴검색어반복'.replace('반복','반복'.repeat(15))+' 찾아줘 그리고 교사 명부 보여줘');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await plan().getByRole('button',{name:/1단계 선택/}).click();assert((await input().inputValue()).includes('아주긴검색어'));await noWrite()
  if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,'plan-mobile.png'),fullPage:true})}
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`복합 업무 계획 브라우저 ${passed}건 통과`)
}finally{await browser.close()}
