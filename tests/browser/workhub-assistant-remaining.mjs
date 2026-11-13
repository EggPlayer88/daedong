// 실제 연결 셸과 기존 협업·학교 자료 서비스를 AI 패널에서 사용한다. 외부 서비스에는 요청하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-assistant-remaining-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],external=[]
let passed=0
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{
  if(!route.request().url().startsWith('http://127.0.0.1:5277/')){external.push(route.request().url());return route.abort()}
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})
})
const button=name=>page.getByRole('button',{name,exact:true}), input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true})
const writes=module=>page.evaluate(module=>window.remaining.calls.filter(c=>c.name===`workhub_${module}_mutate`).map(c=>c.args),module)
const counts=()=>page.evaluate(()=>[window.remaining.cooperationWrites,window.remaining.knowledgeWrites])
async function test(name,run){await page.setViewportSize({width:1280,height:900});await page.goto('http://127.0.0.1:5277/remaining');await page.addScriptTag({content:bundle});await button('AI 비서').first().click();await input().and(page.locator(':enabled')).waitFor();try{await run();passed++;console.log('  ✓ '+name)}catch(error){console.error(await page.locator('.workhub-connected').innerText());throw error}}
async function command(text,label='바로 이동'){await input().fill(text);await button(label).click()}
async function single(selector){assert.equal(new URL(page.url()).searchParams.get('view'),'assistant');assert.equal(await page.locator('.assistant-delivery-work '+selector).count(),1);assert.equal(await page.locator(selector).count(),1)}
async function coop(){await command('협업 열어줘');await button('새 협업 요청').waitFor();await single('.cooperation-workspace')}
async function coopDraft(){await coop();await button('새 협업 요청').click();await page.getByLabel('받는 선생님',{exact:true}).selectOption('member-02');await page.getByLabel('요청 제목',{exact:true}).fill('대화에서 요청한 협의 자료');await page.getByLabel('요청 내용',{exact:true}).fill('최종 확인한 자료만 요청합니다.');await page.getByLabel('희망 기한 · 선택',{exact:true}).fill('2026-10-28')}
async function knowledge(){await command('학교 자료 열어줘');await button('자료 초안 등록').waitFor();await single('.knowledge')}
async function knowledgeDraft(){await knowledge();await button('자료 초안 등록').click();const form=page.getByRole('form',{name:'학교 자료 작성',exact:true});await form.getByLabel('제목',{exact:true}).fill('대화에서 확인한 학사 안내');await form.getByLabel('근거 위치',{exact:true}).fill('학사 안내 2쪽');await form.getByLabel('확인한 원문',{exact:true}).fill('교사가 검토한 가상 학교 자료입니다.\n줄바꿈을 보존합니다.');return form}
async function saveKnowledge(){await knowledgeDraft();await button('초안 저장').click();await page.getByText('서버에 1판으로 저장했습니다.',{exact:true}).waitFor();return page.locator('.knowledge-list article').filter({has:page.getByRole('heading',{name:'대화에서 확인한 학사 안내',exact:true})})}
async function publishKnowledge(article){await article.getByRole('button',{name:'게시 검토',exact:true}).click();await page.getByLabel('확인 근거 또는 사유',{exact:true}).fill('시험 자료의 원문과 적용 기간을 확인했습니다.');await button('확인한 변경 적용').click();await page.getByText('서버에 2판으로 저장했습니다.',{exact:true}).waitFor()}
async function capture(name){if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png'),fullPage:true})}}
try{
 await test('협업 대화는 수신자·내용을 직접 확인한 뒤 기존 요청을 한 번 접수한다',async()=>{
   await coopDraft();assert.deepEqual(await counts(),[0,0]);assert.equal(await button('확인한 요청 보내기').isDisabled(),true)
   await page.getByLabel('가상 교사 02에게 보낼 내용과 기한을 확인했습니다.',{exact:true}).check();await button('확인한 요청 보내기').click();await page.getByText('서버에 저장했습니다.',{exact:true}).waitFor()
   const calls=await writes('cooperation');assert.equal(calls.length,1);assert.deepEqual(calls[0].p_command,{kind:'create',recipientMemberId:'member-02',title:'대화에서 요청한 협의 자료',description:'최종 확인한 자료만 요청합니다.',dueDate:'2026-10-28',sourceTask:null});assert.deepEqual(await counts(),[1,0]);await page.getByRole('article',{name:'선택한 협업 요청',exact:true}).getByRole('heading',{name:'대화에서 요청한 협의 자료',exact:true}).waitFor();await single('.cooperation-workspace');await capture('assistant-cooperation-created')
 })
 await test('협업 접수 응답을 잃으면 입력·원키를 유지하고 다시 요청을 만들지 않는다',async()=>{
   await coopDraft();await page.getByLabel('가상 교사 02에게 보낼 내용과 기한을 확인했습니다.',{exact:true}).check();await page.evaluate(()=>window.remaining.loseNext='cooperation');await button('확인한 요청 보내기').click();const retry=button('같은 요청으로 결과 다시 확인');await retry.waitFor();const original=await writes('cooperation');assert.equal(original.length,1);await button('대화 보기').and(page.locator(':disabled')).waitFor();assert.equal(await page.getByLabel('요청 내용',{exact:true}).inputValue(),'최종 확인한 자료만 요청합니다.')
   await page.setViewportSize({width:390,height:650});await retry.click();await page.getByText('이전 요청이 저장된 것을 확인했습니다.',{exact:true}).waitFor();assert.deepEqual(await writes('cooperation'),[original[0],original[0]]);assert.deepEqual(await counts(),[1,0])
 })
 await test('받은 협업은 수락과 완료 확인 요청을 구분하고 발신자의 최종 확인을 대신하지 않는다',async()=>{
   await coop();await page.getByRole('button',{name:/받은 학년 협의 자료 요청/}).click();await button('수락').click();await page.getByLabel('현재 요청 상태와 처리 내용을 확인했습니다.',{exact:true}).check();await button('확인한 처리 저장').click();await page.getByText('서버에 저장했습니다.',{exact:true}).waitFor();await button('완료 확인 요청').click();await page.getByLabel('처리 내용·사유',{exact:true}).fill('원문 자료 검토를 마쳤습니다.');await page.getByLabel('현재 요청 상태와 처리 내용을 확인했습니다.',{exact:true}).check();await button('확인한 처리 저장').click();await page.getByText('요청한 선생님의 결과 확인을 기다리고 있습니다.',{exact:true}).waitFor();assert.equal(await button('완료 확인').count(),0)
   assert.deepEqual(await page.evaluate(()=>window.remaining.requests.find(r=>r.id==='received-1').status),'completion_requested');assert.deepEqual((await writes('cooperation')).map(c=>[c.p_command.action,c.p_command.expectedVersion]),[['accept',1],['request_completion',2]]);assert.deepEqual(await counts(),[2,0])
 })
 await test('협업 작성 중 다른 업무로 덮어쓰지 않고 취소 확인을 거쳐 원래 대화로 돌아온다',async()=>{
   await coopDraft();await button('대화 보기').and(page.locator(':disabled')).waitFor();assert.equal(await button('작업 마치기').isDisabled(),true);await button('작성 취소').click();await button('계속 작성').click();assert.equal(await page.getByLabel('요청 제목',{exact:true}).inputValue(),'대화에서 요청한 협의 자료');await button('작성 취소').click();await button('입력 버리기').click();await button('대화 보기').click();await input().waitFor();assert.deepEqual(await counts(),[0,0])
 })
 await test('학교 자료는 초안과 게시를 분리하고 현재 판·사유를 명시 확인한다',async()=>{
   const article=await saveKnowledge();assert.deepEqual(await counts(),[0,1]);assert.equal(await page.evaluate(()=>window.remaining.sources.at(-1).status),'draft');assert.equal(await article.getByRole('button',{name:'이 자료로 질문',exact:true}).isDisabled(),true)
   await publishKnowledge(article);const calls=await writes('knowledge');assert.equal(calls.length,2);assert.equal(calls[0].p_command.kind,'create');assert.deepEqual(calls[1].p_command,{kind:'publish',id:'source-2',expectedVersion:1,reason:'시험 자료의 원문과 적용 기간을 확인했습니다.'});assert.equal(await page.evaluate(()=>window.remaining.sources.at(-1).status),'published');assert.deepEqual(await counts(),[0,2]);await single('.knowledge');await capture('assistant-knowledge-published')
 })
 await test('학교 자료 저장 응답 유실 뒤 원래 요청으로 복구하며 초안을 중복 생성하지 않는다',async()=>{
   await knowledgeDraft();await page.evaluate(()=>window.remaining.loseNext='knowledge');await button('초안 저장').click();const retry=button('원래 요청 결과 확인');await retry.waitFor();await button('대화 보기').and(page.locator(':disabled')).waitFor();const original=await writes('knowledge');assert.equal(original.length,1);assert.equal(await page.getByLabel('확인한 원문',{exact:true}).inputValue(),'교사가 검토한 가상 학교 자료입니다.\n줄바꿈을 보존합니다.');await retry.click();await page.getByText('서버에 1판으로 저장했습니다.',{exact:true}).waitFor();assert.deepEqual(await writes('knowledge'),[original[0],original[0]]);assert.deepEqual(await counts(),[0,1]);assert.equal(await page.evaluate(()=>window.remaining.sources.filter(s=>s.id==='source-2').length),1)
 })
 await test('학교 자료 검색은 선택한 과거 판을 AI 안에 열고 대화 복귀 후에도 최신 판으로 바꾸지 않는다',async()=>{
   await command('학교 자료에서 학사 찾아줘','자료 찾기');await page.getByRole('region',{name:'대화에서 찾은 자료',exact:true}).getByRole('button',{name:/지난 학년도 학사 지침/}).click();const citation=page.getByRole('region',{name:'인용 원문 확인',exact:true});await citation.getByText('과거 원문 2판의 확정 내용',{exact:true}).waitFor();await single('.knowledge');const before=await page.evaluate(()=>window.remaining.calls.filter(c=>c.name==='workhub_knowledge_get').length)
   await button('대화 보기').click();await input().fill('원문과 비교 중인 질문');await button('작성하던 업무 보기').click();await citation.getByText('과거 원문 2판의 확정 내용',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.remaining.calls.filter(c=>c.name==='workhub_knowledge_get').length),before);assert.equal(await citation.getByRole('button',{name:'이 자료로 질문',exact:true}).isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.remaining.calls.filter(c=>c.name==='workhub_knowledge_get').map(c=>[c.args.p_source_id,c.args.p_source_version])),[['source-old',2]]);assert.deepEqual(await counts(),[0,0])
 })
 await test('게시 자료를 질문에 연결해도 원문 ID·판을 유지하고 유료 요청이나 문서 저장을 자동 실행하지 않는다',async()=>{
   const article=await saveKnowledge();await publishKnowledge(article);await article.getByRole('button',{name:'이 자료로 질문',exact:true}).click();await input().waitFor();assert.equal(await input().inputValue(),'');await button('전달받은 요청 사용').click();assert.match(await input().inputValue(),/대화에서 확인한 학사 안내.*2판/);assert.match(await input().inputValue(),/학사 안내 2쪽/);await page.getByText('학교 자료 · 2판',{exact:true}).waitFor();await page.getByText('연결 정보',{exact:true}).click();await page.getByText(/source-2/).waitFor();await button('작성하던 업무 보기').click();await single('.knowledge');await article.getByRole('button',{name:'게시 종료',exact:true}).waitFor();assert.deepEqual(await counts(),[0,2]);assert.equal(await page.evaluate(()=>window.remaining.calls.some(c=>c.name.endsWith('_ask'))),false)
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`\n대화 안 협업·학교 자료 ${passed}건 통과 · 실제 외부 요청 0건`)
}finally{await browser.close()}
