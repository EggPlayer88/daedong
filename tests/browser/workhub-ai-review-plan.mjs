// Claude B1 재현: 실제 비서 화면과 합성 AI·저장 응답으로 계획 연결을 확인한다. 유료 호출은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-ai-review-plan-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage()
const origin='http://127.0.0.1:5307/',external=[],errors=[]
await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'})})
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
const input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true}),button=name=>page.getByRole('button',{name,exact:true}),plan=()=>page.getByRole('region',{name:'나누어 진행할 업무',exact:true})
const first='안내장 준비 할 일로 넣어 줄래?',second='시간표 열어줘'
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function request(text,label){await input().fill(text);await button(label).click()}
async function build(){await request(first+' 그리고 '+second,'업무 나누기');await plan().waitFor()}
async function propose(){await build();await plan().getByRole('button',{name:/^1단계 선택/}).click();await button('AI에게 요청').click();await button('할 일 제안 검토').waitFor()}
async function confirm(){await button('할 일 제안 검토').click();await button('추가할 내용 확인').click();await button('확인한 할 일 추가').click()}
async function remount(dropThread=false){await page.evaluate(()=>window.qa.setShow(false));await input().waitFor({state:'detached'});if(dropThread)await page.evaluate(()=>window.qa.dropThread());await page.evaluate(()=>window.qa.setShow(true));await input().waitFor()}
let count=0
async function test(name,run){await page.goto(origin+'plan');await page.addScriptTag({content:bundle});try{await input().waitFor();await run();count++;console.log('  ✓ '+name)}catch(error){console.error(errors,await page.locator('#root').innerText());throw error}}
try{
  await test('AI 제안 접수만으로 완료하지 않고 확정 접수 뒤 원래 단계만 잠근다',async()=>{
    await propose();assert.equal(await page.evaluate(()=>window.qa.applied),0);assert.doesNotMatch(await plan().innerText(),/서버 처리 확인/)
    await confirm();await page.getByText('개인 할 일에 추가했습니다.',{exact:true}).waitFor()
    assert.match(await plan().locator('li').nth(0).innerText(),/서버 처리 확인/)
    assert.doesNotMatch(await plan().locator('li').nth(1).innerText(),/서버 처리 확인/)
    assert.equal(await plan().getByRole('button',{name:/^1단계 선택/}).isDisabled(),true)
    await request('1번 단계','업무 목록 확인');assert.equal(await input().inputValue(),'1번 단계')
    assert.equal(await page.evaluate(()=>window.qa.applied),1);assert.equal(await page.evaluate(()=>window.qa.aiCalls),1)
    await button('질문 비우기').click();await plan().getByRole('button',{name:'처리된 업무 열기',exact:true}).click()
    assert.deepEqual(await page.evaluate(()=>window.qa.opened),['task-1'])
    await request('다음 업무','업무 목록 확인');assert.equal(await input().inputValue(),second)
  })
  await test('확정 응답 유실 뒤 thread가 없어도 원키·제안 출처를 복구하여 단계에 한 번만 기록한다',async()=>{
    await propose();await page.evaluate(()=>window.qa.unknown=true);await confirm();await button('같은 요청으로 결과 확인').waitFor()
    const before=await page.evaluate(()=>window.qa.calls.find(x=>x.kind==='confirmTask'))
    assert.doesNotMatch(await plan().innerText(),/서버 처리 확인/)
    await remount(true);await button('같은 요청으로 결과 확인').click();await page.getByText('개인 할 일에 추가했습니다.',{exact:true}).waitFor()
    assert.match(await plan().locator('li').nth(0).innerText(),/서버 처리 확인/)
    assert.deepEqual(await page.evaluate(()=>window.qa.calls.filter(x=>x.kind==='confirmTask')),[before,before])
    assert.equal(await page.evaluate(()=>window.qa.pending()),0);assert.equal(await page.evaluate(()=>window.qa.applied),1)
  })
  await test('확정 후 새 목록을 만든 뒤 도착한 옛 응답은 새 계획이나 새 입력을 바꾸지 않는다',async()=>{
    await propose();await page.evaluate(()=>window.qa.deferred=true);await confirm();await page.waitForFunction(()=>typeof window.qa.release==='function')
    const old=await page.evaluate(()=>window.qa.snapshot().workspacePlan.instanceId)
    await remount();await button('같은 요청으로 결과 확인').click();await page.getByText('개인 할 일에 추가했습니다.',{exact:true}).waitFor()
    await plan().getByRole('button',{name:'목록 닫기',exact:true}).click();await build()
    const fresh=await page.evaluate(()=>window.qa.snapshot().workspacePlan.instanceId);assert.notEqual(fresh,old)
    await input().fill('새 요청 입력 유지');await page.evaluate(()=>window.qa.release());await settle()
    assert.equal(await input().inputValue(),'새 요청 입력 유지');assert.doesNotMatch(await plan().innerText(),/서버 처리 확인/)
    assert.equal(await page.evaluate(()=>window.qa.snapshot().workspacePlan.instanceId),fresh)
    assert.equal(await page.evaluate(()=>window.qa.applied),1)
  })
  assert.deepEqual(external,[]);assert.deepEqual(errors,[])
  console.log(`\nAI 계획 확정 실사용 회귀: ${count}흐름 통과, 외부 호출 0`)
}finally{await browser.close()}
