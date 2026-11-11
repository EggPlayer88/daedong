// 실제 ConnectedWorkspace와 대화 분류기·검색·각 업무 컴포넌트를 합성 RPC로 연결한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-global-search-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage(),errors=[],external=[]
let passed=0
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5274/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true})
async function check(name,run){await page.setViewportSize({width:1280,height:950});await page.goto('http://127.0.0.1:5274/specialists');await page.addScriptTag({content:bundle});await button('AI 비서').first().click();await input().waitFor();await page.waitForFunction(()=>!document.querySelector('#root > div')?.shadowRoot?.querySelector('.assistant-compose textarea')?.disabled);try{await run();passed++;console.log('  ✓ '+name)}catch(error){console.error(await page.locator('.workhub-connected').innerText());throw error}}
async function command(text,label='업무 시작'){await input().fill(text);await button(label).click()}
async function isSingle(kind){assert.equal(await page.locator('.assistant-delivery-work').count(),1);assert.equal(new URL(page.url()).searchParams.get('view'),'assistant');if(kind)assert.equal(await page.locator(kind).count(),1)}
async function noWrite(){assert.deepEqual(await page.evaluate(()=>window.qa.calls.filter(x=>/(?:_mutate|_execute|_commit|_ask|_confirm|_apply)$/.test(x.name))),[])}
async function capture(name){if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png'),fullPage:true})}}
try{
 await check('시간표 교환 의도는 AI 안의 검토 절차로 연결하고 준비 안 된 서버를 성공처럼 표시하지 않는다',async()=>{
   await command('시간표 교환 요청 준비해줘');await page.getByRole('heading',{name:'교환 요청·승인',exact:true}).waitFor();await isSingle('[data-timetable-presentation="assistant"]');await page.locator('.assistant-specialist-plan summary').click();assert.match(await page.getByRole('list',{name:'업무 진행 순서'}).innerText(),/당사자 동의/);await noWrite()
 })
 await check('학교 명부와 가입 계정 연결은 서로 다른 기존 화면에 연결한다',async()=>{
   await command('교사 명부 보여줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();assert.equal(await page.getByLabel('학교 관리 업무',{exact:true}).inputValue(),'teachers');await isSingle('.school-administration-conversation')
   await button('대화 보기').click();await command('교사 소속 연결 준비해줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();assert.equal(await page.getByLabel('학교 관리 업무',{exact:true}).inputValue(),'roster');await noWrite()
 })
 await check('공식 인계 의도는 원본·미리보기·수락 절차를 열며 자동 인계하지 않는다',async()=>{
   await command('업무 인계 준비해줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();assert.equal(await page.getByLabel('학교 관리 업무',{exact:true}).inputValue(),'transitions');await page.locator('.assistant-specialist-plan summary').click();assert.match(await page.getByRole('list',{name:'업무 진행 순서'}).innerText(),/확인·수락/);await noWrite()
 })
 await check('수업 검색 후보를 직접 고르면 같은 수업 ID만 AI 작업에 전달한다',async()=>{
   await command('수업에서 국어 찾아줘','자료 찾기');await page.getByRole('button',{name:/가상 1학년 국어.*열기/}).click();await page.getByRole('heading',{name:'수업·기록 이어서',exact:true}).waitFor();await page.getByRole('heading',{name:'가상 1학년 국어',exact:true}).waitFor();await isSingle('.teaching-assistant')
   assert.deepEqual(await page.evaluate(()=>window.qa.calls.filter(x=>x.name==='workhub_teaching_course').map(x=>x.args.p_course_id)),['course-one']);await noWrite();await capture('assistant-teaching-work')
 })
 await check('수업 작업과 대화를 오가도 선택한 수업을 다시 조회하거나 편집기를 복제하지 않는다',async()=>{
   await command('수업에서 국어 찾아줘','자료 찾기');await page.getByRole('button',{name:/가상 1학년 국어.*열기/}).click();await page.getByRole('heading',{name:'가상 1학년 국어',exact:true}).waitFor()
   const before=await page.evaluate(()=>window.qa.calls.filter(x=>x.name==='workhub_teaching_course').length);await button('대화 보기').click();await input().fill('아직 보내지 않은 수업 질문');await button('작성하던 업무 보기').click();await page.getByRole('heading',{name:'가상 1학년 국어',exact:true}).waitFor();await isSingle('.teaching-assistant');assert.equal(await page.evaluate(()=>window.qa.calls.filter(x=>x.name==='workhub_teaching_course').length),before);await button('대화 보기').click();assert.equal(await input().inputValue(),'아직 보내지 않은 수업 질문');await noWrite()
 })
 await check('AI 연결이 준비되지 않아도 무료 전문 업무 요청은 실행한다',async()=>{
   await page.getByLabel('대화 분야',{exact:true}).selectOption('timetable');await command('시간표 교환 요청 준비해줘');await page.getByRole('heading',{name:'교환 요청·승인',exact:true}).waitFor();await noWrite()
 })
 await check('활동 CSV 대화 요청은 수업 선택 뒤 기존 가져오기 입력기를 열며 파일·저장은 직접 확인한다',async()=>{
   await command('활동 자료 가져오기 시작해줘');await page.getByLabel('수업 선택',{exact:true}).selectOption('course-one');await page.getByLabel('CSV 파일',{exact:true}).waitFor();assert.equal(await page.getByLabel('CSV 파일',{exact:true}).inputValue(),'');assert.equal(await button('확인한 자료 저장').isDisabled(),true);assert.equal(await button('대화 보기').isDisabled(),true);await noWrite();await capture('assistant-activity-import')
 })
 await check('수업 입력 중 새 업무 전환·작업 마침을 막고 명시 취소한 뒤만 이동한다',async()=>{
   await command('수업 기록 준비해줘');await page.getByText('수업 등록·자료 관리',{exact:true}).click();await button('수업·담당 등록').click();await page.getByLabel('수업 이름',{exact:true}).fill('보존할 수업 입력')
   // 자식 편집기의 effect가 부모 이동 잠금에 반영된 렌더를 기다린다. 잠금 기대값은 유지한다.
   await button('대화 보기').and(page.locator(':disabled')).waitFor()
   assert.equal(await button('대화 보기').isDisabled(),true);assert.equal(await button('작업 마치기').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'시간표',exact:true}).first().isDisabled(),true);assert.equal(await page.getByLabel('수업 이름',{exact:true}).inputValue(),'보존할 수업 입력');await noWrite();await button('취소').click();await button('대화 보기').click();await command('교사 명부 보여줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();assert.equal(await page.getByLabel('학교 관리 업무',{exact:true}).inputValue(),'teachers');await noWrite()
 })
 await check('업무 진입 뒤 신원이 무효화되면 작업 원문과 변경 버튼을 숨긴다',async()=>{
   await command('수업 기록 준비해줘');await page.getByRole('heading',{name:'수업·기록 이어서',exact:true}).waitFor();await page.evaluate(()=>window.qa.deny());await page.locator('.connected-empty').waitFor();assert.equal(await page.locator('.assistant-delivery-work').count(),0);await noWrite()
 })
 await check('320px에서 전문 단계·학교 관리 선택·대화 복귀를 사용할 수 있다',async()=>{
   await page.setViewportSize({width:320,height:800});await command('학교 기초 자료 보여줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await button('대화 보기').click();await input().waitFor();await noWrite();await capture('assistant-specialists-mobile')
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`\n전문 업무 연결 브라우저 ${passed}건 통과`)
}finally{await browser.close()}


