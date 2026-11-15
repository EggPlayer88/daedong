import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-ai-review-usability-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],external=[]
const origin='http://127.0.0.1:5331/'
await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'})})
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000)
const input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true}),button=name=>page.getByRole('button',{name,exact:true})
let passed=0
async function test(name,config,run){await page.goto(origin);await page.evaluate(value=>window.reviewConfig=value,config);await page.addScriptTag({content:bundle});await input().waitFor();await button('연결 다시 확인').and(page.locator(':enabled')).waitFor();await run();passed++;console.log('  ✓ '+name)}
async function history(){await page.locator('.assistant-history summary').click();await button('검토용 답변').click();await page.getByText('첫 번째 일반 안내',{exact:true}).waitFor()}
try{
 await test('조회 권한 밖 예시는 숨기며 직접 입력해도 RPC·유료 호출 없이 원문을 유지한다',{},async()=>{
  await page.locator('.assistant-command-help summary').click();assert.equal(await button('학교 자료에서 출장 찾아줘').count(),0);assert.equal(await button('오늘 업무 요약해줘').count(),0)
  await input().fill('학교 자료에서 출장 찾아줘');await button('자료 찾기').click();await page.getByRole('alert').filter({hasText:'이 자료 조회 메뉴'}).waitFor();assert.equal(await input().inputValue(),'학교 자료에서 출장 찾아줘');assert.deepEqual(await page.evaluate(()=>qa.calls),[])
  await input().fill('다른 질문');assert.equal(await page.getByRole('alert').count(),0)
 })
 await test('할 일 검색 결과가 없을 때 원래 수정 요청이 남는다',{},async()=>{
  const prompt='할 일 없는 업무 기한을 11월 18일로 바꿔줘';await input().fill(prompt);await button('내 할 일 찾기').click();await page.getByText('이번 조회 범위에서 변경할 개인 할 일을 찾지 못했습니다.',{exact:true}).waitFor();assert.equal(await input().inputValue(),prompt)
 })
 await test('원본 없는 질문형 수합은 요청 종류와 전달 버튼으로 실패를 반복하지 않는다',{guided:true},async()=>{
  await page.locator('.assistant-request-settings summary').click();assert.equal(await page.getByLabel('요청 종류',{exact:true}).locator('option[value="guided_collection"]').count(),0)
  await history();assert.equal(await button('이 초안을 작성 화면으로 보내기').isDisabled(),true);await page.getByText(/이 답변에는 연결된 원본 양식이 없습니다/).waitFor();assert.equal(await page.evaluate(()=>qa.delivered),0)
 })
 await test('전달 오류를 AI 안에 표시하고 답변을 보존하며 일반 안내 배지는 한 번만 표시한다',{},async()=>{
  await history();assert.equal(await page.locator('.assistant-no-source').count(),1);await button('이 초안을 작성 화면으로 보내기').click();await page.locator('.assistant-workspace').getByRole('alert').filter({hasText:'원본 양식을 다시 선택'}).waitFor();assert.equal(await page.getByText('첫 번째 일반 안내',{exact:true}).count(),1);assert.deepEqual(errors,[])
 })
 await test('분야 선택창에서 Escape를 눌러도 AI를 닫지 않는다',{},async()=>{
  const select=page.locator('.assistant-focus-control select');await select.focus();await select.press('Escape');assert.equal(await page.evaluate(()=>qa.closed),0);assert.equal(await input().isVisible(),true)
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`AI 검토 사용성 ${passed}건 통과 · 외부·유료 호출 0`)
}catch(error){console.error(errors,await page.locator("body").innerText());throw error}finally{await context.close();await browser.close()}
