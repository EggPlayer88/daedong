// 실제 연결 화면·검색 서비스·대화 작업 카드를 합성 RPC로 연결한다. 운영 쓰기와 유료 AI는 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-global-search-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage(),errors=[],external=[]
let passed=0
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5179/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true})
async function open(){await page.getByRole('button',{name:'AI 비서',exact:true}).first().click();await input().waitFor();await page.waitForFunction(()=>{const host=document.querySelector('#root > div');const el=host?.shadowRoot?.querySelector('.assistant-compose textarea');return el&&!el.disabled})}
async function command(text,label){await input().fill(text);await page.getByRole('button',{name:label,exact:true}).click()}
async function test(name,run){await page.setViewportSize({width:1280,height:950});await page.goto('http://127.0.0.1:5179/assistant-connected');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'업무 찾기',exact:true}).waitFor();try{await run();passed++;console.log('  ✓ '+name)}catch(error){console.error(await page.locator('.workhub-connected').innerText());throw error}}
async function screenshot(name){if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name),fullPage:true})}}
async function findTwoTasks(text) {
  await page.evaluate(() => window.qa.qaTasks.seed())
  await open()
  await command(text, '내 할 일 찾기')
  const choices = page.getByRole('region', {name:'변경할 내 할 일',exact:true})
  await choices.waitFor()
  const matches = choices.getByRole('button').filter({hasText:'변경 내용 보기'})
  assert.equal(await matches.count(), 2, '동명 업무 2건을 모두 제시해야 합니다')
  assert.equal(await page.evaluate(() => window.qa.qaTasks.snapshot().writes), 0)
  return choices
}
async function chooseSecond(choices) {
  const row = choices.getByRole('button').filter({hasText:'2026-10-28'})
  assert.equal(await row.count(), 1, '기한으로 두 동명 업무를 구별할 수 있어야 합니다')
  await row.click()
}
const review = () => page.locator('.workspace-operation[data-operation-kind="taskChange"]')
const calendarReview = () => page.locator('.workspace-operation[data-operation-kind="calendarCreate"]')
async function checkCalendarReview(title) {
  const card = calendarReview()
  await card.getByRole('heading', {name:'새 일정을 검토해 주세요',exact:true}).waitFor()
  assert.equal(await card.getAttribute('data-operation-status'), 'review')
  assert.equal(await card.locator('.workspace-operation-target').innerText(), title)
  for (const text of ['2026-10-22', '15:00–16:00', '나만 보기', '내 일정 1건 새로 등록']) assert.match(await card.innerText(), new RegExp(text))
  assert.equal(await page.evaluate(() => window.qa.calls.some(row => /calendar_save/.test(row.name))), false)
  return card
}
const writes = () => page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_task_mutate').map(row => row.args))
const snapshot = () => page.evaluate(() => window.qa.qaTasks.snapshot())
const paid = []
page.on('request', request => {
  if (request.method() === 'POST') {
    try { if (request.postDataJSON()?.action === 'ask') paid.push(request.url()) } catch {}
  }
})
try{
 await test('AI 서버 미연결 상태에서도 대화로 기존 시간표 화면을 열고 쓰기를 하지 않는다',async()=>{await open();await command('시간표 열어줘','바로 이동');await page.getByRole('heading',{name:'시간표 요청·확인',exact:true,level:2}).waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'assistant');assert.equal(await page.locator('[data-timetable-presentation="assistant"]').count(),1);assert.equal(await page.evaluate(()=>window.qa.calls.some(c=>/mutate|confirm_task|calendar_save/.test(c.name))),false)})
 await test('대화 조회는 실제 문서 목록 query와 원본 ID·판으로 이어진다',async()=>{await open();await command('문서함에서 학교 행사 문서 02 찾아줘','자료 찾기');const results=page.getByRole('region',{name:'대화에서 찾은 자료',exact:true});await results.getByRole('button',{name:/학교 행사 문서 02/}).waitFor();await screenshot('assistant-resource-results.png');await results.getByRole('button',{name:/학교 행사 문서 02/}).click();await page.getByRole('region',{name:'선택한 문서',exact:true}).getByText('검색한 2번 문서의 정확한 2판',{exact:true}).waitFor();const calls=await page.evaluate(()=>window.qa.calls);assert(calls.some(c=>c.name==='workhub_document_list'&&c.args.p_query==='학교 행사 문서 02'));assert(calls.some(c=>c.name==='workhub_document_get'&&c.args.p_document_id==='doc-2'&&c.args.p_version===2))})
 await test('학교 자료 결과는 과거 원문의 정확한 판·위치를 기존 조회에 넘긴다',async()=>{await open();await command('학교 자료에서 학사 찾아줘','자료 찾기');await page.getByRole('region',{name:'대화에서 찾은 자료'}).getByRole('button',{name:/지난 학년도 학사 지침/}).click();await page.getByRole('region',{name:'인용 원문 확인'}).getByText('과거 원문 2판의 확정 내용',{exact:true}).waitFor();assert(await page.evaluate(()=>window.qa.calls.some(c=>c.name==='workhub_knowledge_get'&&c.args.p_source_id==='source-one'&&c.args.p_source_version===2)))})
 await test('일정 초안은 대화 카드에 날짜·시각·나만보기를 보여 주며 자동 저장하지 않는다',async()=>{await open();await command('내일 오후 3시부터 4시까지 회의 일정 초안 만들어줘','일정 초안 열기');await checkCalendarReview('회의');await screenshot('assistant-calendar-draft.png')})
 await test('초안 검토 중 메뉴 잠금을 유지하고 명시 취소 뒤 대화 이동이 가능하다',async()=>{await open();await command('내일 오후 3시부터 4시까지 회의 일정 초안 만들어줘','일정 초안 열기');const card=await checkCalendarReview('회의');assert.equal(await page.getByRole('button',{name:'시간표',exact:true}).first().isDisabled(),true);await card.getByRole('button',{name:'취소',exact:true}).click();await card.waitFor({state:'detached'});await command('수합 열어줘','바로 이동');await page.getByRole('heading',{name:'수합 작성·제출',exact:true,level:2}).waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'assistant');assert.equal(await page.locator('.collection-conversation').count(),1);assert.equal(await page.evaluate(()=>window.qa.calls.some(c=>/calendar_save|collection_mutate/.test(c.name))),false)})
 await test('조회 도중 권한이 철회되면 대화 자료와 늦은 결과를 숨긴다',async()=>{await open();await page.evaluate(()=>window.qa.defer=true);await command('문서함에서 학교 행사 찾아줘','자료 찾기');await page.waitForFunction(()=>window.qa.releases.length===1);await page.evaluate(()=>window.qa.deny());await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다',exact:true}).waitFor();await page.evaluate(()=>window.qa.releases.splice(0).forEach(release=>release()));assert.equal(await page.getByRole('region',{name:'대화에서 찾은 자료'}).count(),0)})
 await test('이어 답한 시각으로 대화의 개인 일정 검토 카드를 열고 자동 저장하지 않는다',async()=>{
   await open()
   await command('내일 교과회의 일정 잡아줘','일정 초안 열기')
   const follow=page.getByRole('region',{name:'작성 중인 일정',exact:true})
   await follow.waitFor()
   assert.match(await follow.innerText(), /교과회의/)
   await command('오후 3시부터 4시','일정 정보 이어 입력')
   await checkCalendarReview('교과회의')
 })
 await test('창 포커스가 돌아와 같은 소속을 재검증해도 작성 중인 후속 답변이 유지된다',async()=>{
   await open()
   await command('내일 교과회의 일정 잡아줘','일정 초안 열기')
   const follow=page.getByRole('region',{name:'작성 중인 일정',exact:true})
   await follow.waitFor()
   const reply='오후 3시부터 4시'
   await input().fill(reply)
   const initial = await page.evaluate(() => {
     const count = name => window.qa.calls.filter(row => row.name === name).length
     const before = {context:count('workhub_context'), tasks:count('workhub_task_list')}
     window.dispatchEvent(new Event('focus'))
     return before
   })
   await page.waitForFunction(before => {
     const count = name => window.qa.calls.filter(row => row.name === name).length
     return count('workhub_context') > before.context && count('workhub_task_list') > before.tasks
   }, initial)
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   assert.match(await follow.innerText(),/교과회의/)
   assert.equal(await input().inputValue(),reply)
   await page.getByRole('button',{name:'일정 정보 이어 입력',exact:true}).click()
   await checkCalendarReview('교과회의')
 })
 await test('동명 업무에서 선택한 한 건만 기한 변경하고 기존 메모와 다른 업무를 보존한다',async()=>{
   const choices=await findTwoTasks('제출 자료 확인을 금요일까지로 바꿔줘')
   await chooseSecond(choices)
   await review().waitFor()
   assert.match(await review().innerText(),/2026-10-28/)
   assert.match(await review().innerText(),/2026-10-23/)
   assert.deepEqual(await writes(),[])
   await screenshot('assistant-task-change-review.png')
   await review().getByRole('button',{name:'확인한 변경 저장',exact:true}).click()
   await page.waitForFunction(()=>window.qa.qaTasks.snapshot().writes===1)
   const [call]=await writes()
   assert.equal(call.p_member_id,'member-01')
   assert.deepEqual(call.p_command,{kind:'update',taskId:'task-b',input:{title:'제출 자료 확인',dueDate:'2026-10-23',notes:'2학년 자료'},expectedVersion:1})
   const [first,second]=(await snapshot()).rows
   assert.equal(first.version,1)
   assert.equal(first.dueDate,'2026-10-26')
   assert.equal(second.version,2)
 })
 await test('메모 변경을 취소하면 미리보기에서 확인한 두 업무 모두 그대로다',async()=>{
   const choices=await findTwoTasks('제출 자료 확인 메모를 배부 완료로 바꿔줘')
   await chooseSecond(choices)
   await review().waitFor()
   assert.match(await review().innerText(),/2학년 자료/)
   assert.match(await review().innerText(),/배부 완료/)
   await review().getByRole('button',{name:'취소',exact:true}).click()
   await review().waitFor({state:'detached'})
   assert.deepEqual(await writes(),[])
   assert.deepEqual((await snapshot()).rows.map(t=>[t.notes,t.version]),[['1학년 자료',1],['2학년 자료',1]])
 })
 await test('메모만 수정할 때 제목·기한·상태와 다른 업무의 메모까지 유지한다',async()=>{
   const choices=await findTwoTasks('제출 자료 확인 메모를 배부 완료로 바꿔줘')
   await chooseSecond(choices)
   await review().waitFor()
   await review().getByRole('button',{name:'확인한 변경 저장',exact:true}).click()
   await page.waitForFunction(()=>window.qa.qaTasks.snapshot().writes===1)
   const data=await snapshot()
   assert.equal(data.rows[0].notes,'1학년 자료')
   const second=data.rows[1]
   assert.deepEqual([second.id,second.title,second.notes,second.dueDate,second.status,second.version],['task-b','제출 자료 확인','배부 완료','2026-10-28','todo',2])
 })
 await test('검색 뒤 선택 전에 바뀐 업무는 새 판으로 조용히 적용하지 않는다',async()=>{
   const choices=await findTwoTasks('제출 자료 확인을 완료해줘')
   await page.evaluate(()=>window.qa.qaTasks.revise('task-b'))
   await chooseSecond(choices)
   await page.getByText(/업무가 변경되어.*다시 선택/).waitFor()
   assert.deepEqual(await writes(),[])
   assert.equal(await review().count(),0)
 })
 await test('미리보기 이후 판 충돌은 바뀐 업무를 완료하지 않고 다시 선택하게 한다',async()=>{
   const choices=await findTwoTasks('제출 자료 확인을 완료해줘')
   await chooseSecond(choices)
   await review().waitFor()
   await page.evaluate(()=>window.qa.qaTasks.revise('task-b'))
   await review().getByRole('button',{name:'확인한 할 일 완료',exact:true}).click()
   await page.getByText(/업무가 변경되어.*다시 선택/).waitFor()
   assert.equal((await snapshot()).writes,0)
   assert.equal((await snapshot()).rows[1].status,'todo')
   assert((await writes()).every(args => args.p_command.taskId === 'task-b' && args.p_command.expectedVersion === 1))
 })
 await test('확인 뒤 응답을 잃어도 같은 요청으로 복구하고 한 건만 완료한다',async()=>{
   const choices=await findTwoTasks('제출 자료 확인을 완료해줘')
   await chooseSecond(choices)
   await review().waitFor()
   await page.evaluate(()=>window.qa.qaTasks.loseNextReply())
   await review().getByRole('button',{name:'확인한 할 일 완료',exact:true}).evaluate(button=>{button.click();button.click()})
   const retry=page.getByRole('button',{name:'같은 요청으로 저장 결과 확인',exact:true})
   await retry.waitFor()
   const attempts=await writes()
   assert.equal(attempts.length,1)
   const first=attempts[0]
   assert.deepEqual(first.p_command,{kind:'status',taskId:'task-b',expectedVersion:1,status:'done'})
   await retry.click()
   await retry.waitFor({state:'detached'})
   assert.deepEqual(await writes(),[first,first])
   const data=await snapshot()
   assert.equal(data.writes,1)
   assert.deepEqual(data.rows.map(t=>[t.status,t.version]),[['todo',1],['done',2]])
 })
 await test('권한 철회 후 일정 보완이나 업무 변경을 이어갈 수 없다',async()=>{
   await open()
   await command('내일 교과회의 일정 잡아줘','일정 초안 열기')
   const follow=page.getByRole('region',{name:'작성 중인 일정',exact:true})
   await follow.waitFor()
   await page.evaluate(()=>window.qa.deny())
   await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다',exact:true}).waitFor()
   assert.equal(await follow.count(),0)
   assert.deepEqual(await writes(),[])
 })
 assert.deepEqual(paid,[])
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`대화 업무 연결 ${passed}건 통과 · 실제 외부 요청 0건`)
}finally{await browser.close()}
