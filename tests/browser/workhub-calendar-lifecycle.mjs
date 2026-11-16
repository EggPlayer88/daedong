import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdirSync} from 'node:fs'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-calendar-lifecycle-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage(),origin='http://127.0.0.1:5288/',errors=[],external=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss())
await context.route('**/*',r=>r.request().url().startsWith(origin)?r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div></html>'}):(external.push(r.request().url()),r.abort()))
const button=name=>page.getByRole('button',{name,exact:true}),reason=()=>page.getByLabel('취소 사유',{exact:true}),confirmed=()=>page.getByLabel('위 일정과 취소 사유를 확인했습니다.',{exact:true}),pendingButton=()=>button('취소 결과 확인').and(page.locator(':enabled'))
let passed=0
async function check(name,run){await page.goto(origin);await page.addScriptTag({content:bundle});await page.getByRole('button',{name:/함께 여는 월요일.*원본 v1 보기/}).waitFor();try{await run()}catch(e){console.error(await page.locator('body').innerText());console.error(await page.locator('dialog').evaluateAll(es=>es.map(e=>({open:e.open,html:e.outerHTML,display:getComputedStyle(e).display}))));console.error(await page.evaluate(()=>({calls:window.qa.calls,pending:window.qa.pending(),results:window.qa.results})));throw e}passed++;console.log('  ✓ '+name)}
async function prepare(){await page.getByRole('button',{name:/함께 여는 월요일.*원본 v1 보기/}).click();await button('일정 취소').click();await reason().fill('회의 일정 변경');await confirmed().check()}
async function done(){await page.getByRole('status').filter({hasText:'일정을 취소했습니다'}).waitFor();assert.equal(await page.evaluate(()=>window.qa.pendingCount()),0);assert.equal(await page.evaluate(()=>window.qa.writes),1);assert.equal(await page.evaluate(()=>window.qa.results.length),1)}
const cancelCalls=()=>page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_calendar_cancel'))
try{
 await check('좁은 화면에서도 사유·확인을 유지하고 잘못된 사유는 전송하지 않는다',async()=>{
  await prepare();await page.setViewportSize({width:320,height:640});await reason().fill('가'.repeat(501));await confirmed().check();await button('이 일정 취소').click();await page.getByRole('alert').filter({hasText:'1~500자'}).waitFor();assert.equal((await cancelCalls()).length,0)
  const dimensions=await page.getByRole('dialog').evaluate(e=>({width:e.getBoundingClientRect().width,viewport:innerWidth}));assert.ok(dimensions.width<=dimensions.viewport)
  await reason().fill('회의 일정 변경');await confirmed().check();await button('이 일정 취소').click();await done();await page.setViewportSize({width:1280,height:950})
 })
 await check('일정 원본·사유 확인 전에는 취소하지 않고 완료 뒤 취소 이력을 조회한다',async()=>{
  await prepare();if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:process.env.WORKHUB_QA_OUTPUT+'/calendar-cancel.png',fullPage:true})}assert.equal(await page.evaluate(()=>window.qa.writes),0);await confirmed().uncheck();assert.equal(await button('이 일정 취소').isDisabled(),true);await confirmed().check();await button('이 일정 취소').click();await done()
  assert.equal(await page.getByRole('button',{name:/함께 여는 월요일.*보기/}).count(),0)
  await page.getByLabel('일정 상태',{exact:true}).selectOption('cancelled');await page.getByRole('button',{name:/함께 여는 월요일.*원본 v2 보기/}).click()
  await page.getByText('회의 일정 변경',{exact:true}).waitFor();assert.equal(await button('일정 수정').count(),0);assert.equal(await button('일정 취소').count(),0)
 })
 await check('판 충돌은 사유를 보존하고 최신 원본 확인·재확인 뒤 새 판으로 취소한다',async()=>{
  await prepare();await page.evaluate(()=>window.qa.conflict=true);await button('이 일정 취소').click();await page.getByRole('alert').waitFor();await reason().waitFor();assert.equal(await reason().inputValue(),'회의 일정 변경');assert.equal(await confirmed().isChecked(),false)
  await confirmed().check();await button('이 일정 취소').click();await done();const calls=await cancelCalls();assert.deepEqual(calls.map(c=>c.args.p_command.expectedVersion),[1,2]);assert.notEqual(calls[0].args.p_request_key,calls[1].args.p_request_key)
 })
 await check('접수 후 응답 유실·접기·재진입은 같은 번호의 조회만 하고 중복 취소하지 않는다',async()=>{
  await prepare();await page.evaluate(()=>window.qa.failAfter=true);await button('이 일정 취소').click();await pendingButton().waitFor();await button('요청 보관하고 닫기').click();await button('보관한 취소 요청 확인').click();await pendingButton().click();await done()
  const calls=await cancelCalls();assert.deepEqual(calls.map(c=>c.args.p_recover_only),[false,true]);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key)
 })
 await check('미접수 복구가 미확정이면 입력을 풀지 않고 명시 같은 번호 재전송만 허용한다',async()=>{
  await prepare();await page.evaluate(()=>window.qa.failBefore=true);await button('이 일정 취소').click();await pendingButton().waitFor();await pendingButton().click();await pendingButton().waitFor();assert.equal(await page.evaluate(()=>window.qa.pendingCount()),1);assert.equal(await page.evaluate(()=>window.qa.writes),0)
  await button('같은 취소 요청 다시 보내기').click();await done();const calls=await cancelCalls();assert.deepEqual(calls.map(c=>c.args.p_recover_only),[false,true,false]);assert.equal(new Set(calls.map(c=>c.args.p_request_key)).size,1)
 })
 await check('보관한 요청으로 다시 열면 취소 결과 확인만 가능하며 자동 쓰기를 하지 않는다',async()=>{
  await prepare();await page.evaluate(()=>window.qa.failAfter=true);await button('이 일정 취소').click();await pendingButton().waitFor();await page.evaluate(()=>window.qa.remount());await pendingButton().waitFor();assert.equal((await cancelCalls()).length,1);await pendingButton().click();await done()
 })
 for(const change of ['changeDate','changeService'])await check(`${change} 뒤 늦은 응답은 표시하지 않고 원키 복구를 계속할 수 있다`,async()=>{
  await prepare();await page.evaluate(()=>window.qa.hold=true);await button('이 일정 취소').click();await page.waitForFunction(()=>typeof window.qa.release==='function');await page.evaluate(method=>window.qa[method](),change);await pendingButton().waitFor();await page.evaluate(()=>window.qa.release());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.evaluate(()=>window.qa.results.length),0);await pendingButton().click();await done()
 })
 await check('결과 목록 표시 실패는 완료한 취소를 다시 보내지 않는다',async()=>{await prepare();await page.evaluate(()=>window.qa.resultThrows=true);await button('이 일정 취소').click();await done();assert.equal((await cancelCalls()).length,1)})
 await check('학교·계정 전환 전 응답은 새 화면에 남기지 않는다',async()=>{
  await prepare();await page.evaluate(()=>window.qa.hold=true);await button('이 일정 취소').click();await page.waitForFunction(()=>typeof window.qa.release==='function');await page.evaluate(()=>window.qa.changeScope());await page.evaluate(()=>window.qa.release());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.evaluate(()=>window.qa.results.length),0);assert.equal(await page.getByRole('dialog').count(),0)
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`\n일정 취소 브라우저 ${passed}건 통과`)
}finally{await browser.close()}
