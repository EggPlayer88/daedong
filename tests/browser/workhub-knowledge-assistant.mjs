// 실제 학교 자료 서비스·parser와 React를 합성 RPC로 검증한다. 유료 AI 호출은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({entryPoints:[fileURLToPath(new URL('./workhub-knowledge-assistant-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1000,height:850}}),page=await context.newPage(),passed=[],errors=[],external=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',r=>{if(!r.request().url().startsWith('http://127.0.0.1:5179/')){external.push(r.request().url());return r.abort()}return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'})})
const citation=()=>page.getByRole('region',{name:'인용 원문 확인',exact:true})
async function test(name,run){await page.setViewportSize({width:1000,height:850});await page.goto('http://127.0.0.1:5179/knowledge');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('heading',{name:'학교 자료 원본',exact:true}).waitFor();try{await run()}catch(e){console.error('실패 화면:',await page.locator('body').innerText());throw e}passed.push(name);console.log('  ✓ '+name)}
async function open(){await page.evaluate(()=>window.qa.open({},true));await citation().getByText('인용한 7판의 확인된 원문',{exact:true}).waitFor()}
try{
await test('게시 원문은 질문 근거만 명시 전달하고 자동 저장이나 AI 요청을 만들지 않는다',async()=>{assert.deepEqual(await page.evaluate(()=>window.qa.asks),[]);await page.getByRole('button',{name:'이 자료로 질문',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.qa.asks),[{schoolId:'school-one',memberId:'member-one',sourceId:'source-one',sourceVersion:7,title:'학교 자료 원본',locator:'제3조'}]);assert.equal(await page.evaluate(()=>window.qa.calls.filter(c=>c.name.endsWith('_mutate')).length),0)})
for(const state of ['draft','retired','expired'])await test('현재 근거로 쓸 수 없는 자료의 질문 전달을 막는다: '+state,async()=>{await page.evaluate(state=>{if(state==='expired')window.qa.source.effectiveThrough='2026-10-18';else window.qa.source.status=state;window.qa.refresh()},state);await page.getByText(state==='draft'?'업무 안내 · 초안 · 7판':state==='retired'?'업무 안내 · 게시 종료 · 7판':'업무 안내 · 적용 기간 밖 · 7판',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'이 자료로 질문',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.qa.asks),[])})
await test('인용 번호와 판이 모두 같을 때만 원문을 표시하고 복귀 콜백을 제공한다',async()=>{await open();await citation().getByRole('button',{name:'비서 답변으로 돌아가기'}).click();assert.equal(await page.evaluate(()=>window.qa.returns),1);await citation().getByRole('button',{name:'이 자료로 질문',exact:true}).click();assert.equal(await page.evaluate(()=>window.qa.asks[0].sourceVersion),7)})
await test('다른 판 응답은 거절하며 게시 종료한 정확한 과거 원문은 현재 근거와 구분한다',async()=>{await page.evaluate(()=>{window.qa.source.version=8;window.qa.source.body='대체하면 안 되는 8판 본문';window.qa.open({},true)});await citation().getByRole('alert').waitFor();assert.doesNotMatch(await citation().innerText(),/대체하면 안 되는/);await page.evaluate(()=>{window.qa.revisions=[{...window.qa.source,version:7,status:'retired',body:'정확한 과거 종료 원문'}];window.qa.refresh()});await citation().getByText('정확한 과거 종료 원문',{exact:true}).waitFor();await citation().getByText(/과거에 보관한 원문/).waitFor();assert.equal(await citation().getByRole('button',{name:'이 자료로 질문',exact:true}).isDisabled(),true)})
await test('적용 기간 밖의 정확한 인용 원문은 기간을 알리고 현재 질문 근거로 다시 보내지 않는다',async()=>{await page.evaluate(()=>{window.qa.source.effectiveThrough='2026-10-18';window.qa.open({},true)});await citation().getByText('인용한 7판의 확인된 원문',{exact:true}).waitFor();await citation().getByText(/현재 적용 기간 밖/).waitFor();assert.equal(await citation().getByRole('button',{name:'이 자료로 질문',exact:true}).isDisabled(),true)})
await test('현재 목록에 없는 과거 원문도 정확한 ID·판으로 직접 조회한다',async()=>{await page.evaluate(()=>{window.qa.pages={first:{items:[],nextCursor:'second',canManage:false}};window.qa.open({},true)});await citation().getByText('인용한 7판의 확인된 원문',{exact:true}).waitFor();const calls=await page.evaluate(()=>window.qa.calls);assert.ok(calls.some(c=>c.name==='workhub_knowledge_get'&&c.args.p_source_id==='source-one'&&c.args.p_source_version===7));assert.equal(calls.filter(c=>c.args.p_cursor==='second').length,0)})
await test('누락된 RPC 응답도 최신 목록을 대신 원문으로 표시하지 않는다',async()=>{await page.evaluate(()=>{window.qa.fail=true;window.qa.open({},true)});await citation().getByRole('alert').waitFor();assert.doesNotMatch(await citation().innerText(),/인용한 7판의 확인된 원문/);assert.equal(await citation().getByRole('button',{name:'이 자료로 질문',exact:true}).count(),0)})
await test('읽기 실패와 다음 조회 세대는 이전 원문을 즉시 숨기고 늦은 응답을 버린다',async()=>{await open();for(const kind of ['revision','date','connection']){await page.evaluate(()=>window.qa.deferred=true);const text=await page.evaluate(kind=>window.qa.syncChange(kind),kind);assert.doesNotMatch(text,/인용한 7판의 확인된 원문/);await page.waitForFunction(()=>window.qa.releases.length>0);await page.evaluate(()=>{window.qa.fail=true;window.qa.releases.splice(0).forEach(f=>f())});await citation().getByRole('alert').waitFor();assert.doesNotMatch(await citation().innerText(),/인용한 7판의 확인된 원문/);await page.evaluate(()=>{window.qa.fail=false;window.qa.deferred=false})}})
await test('학교·계정 변경 뒤 이전 인용 요청이나 지연 응답을 표시하지 않는다',async()=>{await page.evaluate(()=>{window.qa.deferred=true;window.qa.open({},true)});await page.waitForFunction(()=>window.qa.releases.length>0);await page.evaluate(()=>window.qa.changeMember());await page.getByRole('alert').getByText(/현재 계정·학교와 맞지/).waitFor();await page.evaluate(()=>window.qa.releases.splice(0).forEach(f=>f()));assert.doesNotMatch(await page.locator('body').innerText(),/인용한 7판의 확인된 원문/)})
await test('작성 중 입력과 결과 미상 요청은 인용 열기가 덮어쓰지 않고 같은 키로 복구한다',async()=>{await page.getByRole('button',{name:'자료 초안 등록'}).click();await page.getByLabel('제목',{exact:true}).fill('작성 중 자료');await page.getByLabel('근거 위치',{exact:true}).fill('학교 공문');await page.getByLabel('확인한 원문',{exact:true}).fill('보존할 자료');await page.evaluate(()=>window.qa.open());await page.getByText(/인용 원문 확인을 기다리고/).waitFor();assert.equal(await page.getByLabel('제목',{exact:true}).inputValue(),'작성 중 자료');await page.evaluate(()=>window.qa.writeUnknown=true);await page.getByRole('button',{name:'초안 저장',exact:true}).click();await page.getByRole('button',{name:'원래 요청 결과 확인'}).waitFor();assert.equal(await page.evaluate(()=>window.qa.pending.count()),1);assert.equal(await citation().count(),0);await page.evaluate(()=>window.qa.writeUnknown=false);await page.getByRole('button',{name:'원래 요청 결과 확인'}).click();await citation().getByText('인용한 7판의 확인된 원문',{exact:true}).waitFor();const calls=await page.evaluate(()=>window.qa.calls.filter(c=>c.name.endsWith('_mutate')));assert.deepEqual(calls[0].args,calls[1].args);assert.equal(await page.evaluate(()=>window.qa.pending.count()),0)})
await test('320px 원문과 질문·복귀 버튼은 화면 안에 있고 키보드로 접근한다',async()=>{await page.setViewportSize({width:320,height:740});await page.evaluate(()=>window.qa.open());await citation().getByText('인용한 7판의 확인된 원문',{exact:true}).waitFor();await citation().getByRole('button',{name:'이 자료로 질문',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.qa.asks.length===1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,'knowledge-citation-320.png'),fullPage:true})}})
await test('이전 판 목록에서 과거 원문과 같은 판 HWPX 접근을 열고 최신 근거로 재사용하지 않는다',async()=>{
 await page.evaluate(()=>{window.qa.revisions=[window.qa.source,{...window.qa.source,version:2,title:'예전 학교 규정',body:'오래된 정확한 2판'}]})
 await page.getByRole('button',{name:'이전 판 보기',exact:true}).click()
 const history=page.getByRole('region',{name:'학교 자료 이전 판',exact:true})
 await history.getByRole('button',{name:'2판 · 예전 학교 규정',exact:true}).click()
 const original=history.getByRole('region',{name:'선택한 판 원문',exact:true})
 await original.getByText('오래된 정확한 2판',{exact:true}).waitFor()
 assert.equal(await original.getByRole('button',{name:'이 자료로 질문',exact:true}).isDisabled(),true)
 await original.getByRole('button',{name:/HWPX/}).click()
 await page.waitForFunction(()=>window.qa.calls.some(c=>c.name==='workhub_knowledge_original_access'))
 assert.equal(await page.evaluate(()=>window.qa.calls.find(c=>c.name==='workhub_knowledge_original_access').args.p_source_version),2)
 assert.equal(await page.evaluate(()=>window.qa.calls.filter(c=>c.name.endsWith('_mutate')).length),0)
})
await test('50판 뒤 이력도 중복 없이 넘기고 오류가 나면 이전 본문을 숨긴다',async()=>{
 await page.evaluate(()=>{window.qa.source.version=60;window.qa.revisions=Array.from({length:60},(_,n)=>({...window.qa.source,version:60-n,title:'규정 '+(60-n),body:'과거 '+(60-n)+'판 본문'}))})
 await page.getByRole('button',{name:'이전 판 보기',exact:true}).click()
 const history=page.getByRole('region',{name:'학교 자료 이전 판',exact:true})
 await history.getByRole('button',{name:'11판 · 규정 11',exact:true}).waitFor()
 await history.getByRole('button',{name:'더 오래된 판',exact:true}).click()
 await history.getByRole('button',{name:'1판 · 규정 1',exact:true}).click()
 await history.getByText('과거 1판 본문',{exact:true}).waitFor()
 assert.equal(await history.getByRole('button',{name:'더 오래된 판',exact:true}).isDisabled(),true)
 await page.evaluate(()=>{window.qa.readError='NOT_READY';window.qa.refresh()})
 await history.getByRole('alert').waitFor()
 assert.doesNotMatch(await history.innerText(),/과거 1판 본문/)
})
for(const code of ['NOT_FOUND','NOT_READY'])await test('권한 또는 미설치로 과거 판을 못 읽어도 최신 자료로 대체하지 않는다: '+code,async()=>{
 await page.evaluate(code=>{window.qa.readError=code;window.qa.open({},true)},code)
 await citation().getByRole('alert').waitFor()
 assert.doesNotMatch(await citation().innerText(),/인용한 7판의 확인된 원문/)
 assert.equal(await citation().getByRole('button',{name:'이 자료로 질문',exact:true}).count(),0)
})
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'knowledge-assistant-results.json'),JSON.stringify({passed,errors,external},null,2));console.log('학교 자료·인용 원문 브라우저 '+passed.length+'건 통과')
}finally{await browser.close()}
