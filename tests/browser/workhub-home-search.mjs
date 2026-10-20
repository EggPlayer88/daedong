import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
// 실제 공통 홈·검색·원본 화면을 미리보기와 연결 모드에서 검증한다. 외부 서버는 호출하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync,writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const bundle=buildSync({stdin:{contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{PreviewApp}from'./apps/workhub/src/preview/PreviewApp';
 import{ConnectedWorkspace}from'./apps/workhub/src/app/ConnectedWorkspace';
 import{createSupabaseConnection}from'./apps/workhub/src/connection/supabase-connection';
 import{createMemoryAdapter}from'./apps/workhub/src/preview/memory-adapter';
 import{createDemoPersistence}from'./apps/workhub/src/preview/persistence';
 import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
 import{fixtureData,relationLabels}from'./apps/workhub/src/preview/fixtures';
 import theme from './apps/workhub/src/style.css?inline';
 import preview from './apps/workhub/src/preview/preview.css?inline';
 import workflow from './apps/workhub/src/workflows/workflows.css?inline';
 import students from './apps/workhub/src/students/students.css?inline';
 const date=fixtureData.basisDate,store=createWorkflowStore({members:fixtureData.memberships,date});
 const seed=(title,dueDate,member='gaon-soyeon')=>store.createTask(member,{title,dueDate,notes:'합성 메모 '+title},title);
 const past=seed('지난 준비 업무','2026-10-18'),today=seed('오늘 준비 업무',date),future=seed('다음 준비 업무','2026-10-20'),none=seed('기한 없는 준비','');
 const done=seed('완료한 준비 업무',date);store.setTaskStatus('gaon-soyeon',done.id,'done',done.version,'done');
 seed('다른 교사의 비공개 할 일',date,'gaon-minjun');seed('누리에서 할 일',date,'nuri-soyeon');
 const draft=store.createCollection('gaon-minjun',{title:'학급별 준비 수합',instructions:'합성 준비 내용을 확인합니다',dueDate:'2026-10-21',reviewMode:'required',reviewerMemberId:'gaon-minjun',textLabel:'준비 내용',textRequired:true,numberLabel:'',numberRequired:false,units:[{label:'첫 번째 단위',responsibleMemberId:'gaon-soyeon',contributorMemberIds:['gaon-seojin']},{label:'두 번째 단위',responsibleMemberId:'gaon-soyeon',contributorMemberIds:['gaon-seojin']}]},'collection');
 const request=store.publishCollection('gaon-minjun',draft.id,draft.version,'publish'),units=store.listUnits('gaon-soyeon',request.id);
 const response=store.saveDraft('gaon-soyeon',units[1].id,{text:'제출한 합성 자료',number:null},0,'answer');
 store.submit('gaon-soyeon',units[1].id,response.version,units[1].version,'submit','');
 const saved=new Map();const persistence=createDemoPersistence({getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)});persistence.replaceAll({workflows:store.exportState()});
 const memory=createMemoryAdapter(fixtureData,0);let callback=()=>{},denied=false;
 window.qa={ids:{past:past.id,today:today.id,done:done.id,unit:units[1].id},failTasks:false,deny(){denied=true;callback({user:{id:'fixture-soyeon'}})}};
 const services={async getSession(){return {user:{id:'fixture-soyeon'}}},async fetchMyProfile(id){return{id,name:'합성 기존 회원',email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:!denied}},onAuthStateChange(cb){callback=cb;return()=>{}},async signInWithGoogle(){},async signOut(){},async rpc(name,args){
  if(name==='workhub_context')return{error:null,data:{...memory.info(),schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}};
  try{
   if(name==='workhub_task_list'){if(window.qa.failTasks){window.qa.failTasks=false;throw {code:'QUERY_FAILED'}};return{error:null,data:store.listTasks(args.p_member_id)}};
   if(name==='workhub_task_get'){const value=store.listTasks(args.p_member_id).find(t=>t.id===args.p_task_id);return{error:value?null:{message:'NOT_FOUND'},data:value}};
   if(name==='workhub_calendar_list')return{error:null,data:await memory.list(args.p_member_id)};
   if(name==='workhub_calendar_get')return{error:null,data:await memory.get(args.p_member_id,args.p_event_id)};
  }catch(e){return{data:null,error:{message:e.code}}};return{data:null,error:{message:'UNEXPECTED_WRITE'}}
 }};
 createRoot(document.getElementById('root')).render(location.pathname.includes('connected')?<ConnectedWorkspace legacyHomeHref="/" expectedUserId="fixture-soyeon" connection={createSupabaseConnection(services)}/>:<><style>{theme}{preview}{workflow}{students}</style><PreviewApp persistence={persistence}/></>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'http://localhost.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage()
const errors=[],results=[],external=[];const output=process.env.WORKHUB_QA_OUTPUT
if(output)mkdirSync(output,{recursive:true})
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5176/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>'})})
const dialog=()=>page.getByRole('dialog',{name:'업무 찾기',exact:true})
const home=()=>page.getByRole('heading',{name:'내 할 일',exact:true}).waitFor()
const nav=()=>page.getByRole('navigation',{name:/^(업무 메뉴|신축 업무 메뉴)$/})
async function menu(name){await clickWorkspaceMenu(page,name)}
async function search(q=''){await page.getByRole('button',{name:'업무 찾기',exact:true}).click();await dialog().getByLabel('검색어',{exact:true}).fill(q);await dialog().locator('.ws-search-source-loading').first().waitFor({state:'hidden'});}
async function test(name,fn){await fn();results.push(name);console.log('  ✓ '+name)}
try{
 await page.goto('http://127.0.0.1:5176/preview');await home();await page.getByRole('group',{name:'개인 업무 기한 요약'}).waitFor()
 await test('홈은 기한별 미완료 업무와 제출 후 검토 대기를 분리한다',async()=>{
  const tiles=page.getByRole('group',{name:'개인 업무 기한 요약'});assert.equal(await tiles.getByRole('button').count(),4)
  for(const b of await tiles.getByRole('button').all())assert.match(await b.getAttribute('aria-label'),/1개 보기/)
  assert.match(await page.locator('.wf-section-title').innerText(),/처리할 1건 · 검토 대기 1건/)
  assert.equal(await page.getByRole('region',{name:'제출 후 검토 대기'}).count(),1)
 })
 await test('수합 홈은 역할별 숫자를 접고 처리·대기 상태와 원본 행동을 남긴다',async()=>{
  const summary=page.getByRole('region',{name:'오늘 처리할 수합',exact:true})
  const details=summary.locator('.wf-home-details'),counts=details.locator('.wf-role-counts')
  assert.equal(await details.getAttribute('open'),null);assert.equal(await counts.isVisible(),false)
  assert.equal(await summary.locator('.wf-obligation').count(),2)
  assert.equal(await summary.locator('.wf-home-category').filter({hasText:'제출 후 검토 대기'}).isVisible(),true)
  assert.equal(await summary.getByRole('button',{name:/두 번째 단위.*접수 상태 확인/}).isVisible(),true)
  await details.locator('summary').focus();await page.keyboard.press('Enter')
  assert.equal(await counts.isVisible(),true);assert.match(await details.innerText(),/제출 책임자/)
  await page.keyboard.press('Enter');assert.equal(await counts.isVisible(),false)
 })
 await test('기한 요약을 누르면 해당 필터의 업무 목록으로 이동한다',async()=>{
  await page.getByRole('group',{name:'개인 업무 기한 요약'}).getByRole('button').first().click()
  await page.getByRole('heading',{name:'내 업무',level:1,exact:true}).waitFor();assert.equal(await page.getByLabel('기한 분류',{exact:true}).inputValue(),'overdue')
  assert.equal(await page.locator('.task-card').count(),1);assert.match(await page.locator('.task-card').innerText(),/지난 준비 업무/)
 })
 await test('검색으로 완료 업무를 찾아 최신 원본 카드에 초점을 둔다',async()=>{
  await search('완료한 준비');await dialog().locator('.ws-search-result').click()
  const id=await page.evaluate(()=>window.qa.ids.done);const card=page.locator('[data-task-id="'+id+'"]')
  await card.waitFor();await page.waitForFunction(id=>document.activeElement?.getAttribute('data-task-id')===id,id)
  assert.equal(await page.getByRole('form',{name:'내 업무 수정',exact:true}).count(),0)
 })
 await test('타인 개인자료와 타학교 결과를 검색에 포함하지 않는다',async()=>{
  await search('서진의 개인 준비');assert.equal(await dialog().locator('.ws-search-result').count(),0)
  await dialog().getByLabel('검색어',{exact:true}).fill('다른 교사의 비공개');assert.equal(await dialog().locator('.ws-search-result').count(),0)
  await dialog().getByLabel('검색어',{exact:true}).fill('누리');assert.equal(await dialog().locator('.ws-search-result').count(),0)
  await page.keyboard.press('Escape');assert.equal(await dialog().count(),0)
 })
 await test('검색은 고정 안내를 제외하고 원문의 띄어쓰기·장소·날짜를 찾는다',async()=>{
  await search('나만 보는 업무');assert.equal(await dialog().locator('.ws-search-result').count(),0)
  await dialog().getByLabel('검색어',{exact:true}).fill('교사 전체');assert.equal(await dialog().locator('.ws-search-result').count(),0)
  await dialog().getByLabel('검색어',{exact:true}).fill('체험 학습');assert.equal(await dialog().locator('.ws-search-result').count(),1)
  await dialog().getByLabel('검색어',{exact:true}).fill('2026-10-21');assert(await dialog().locator('.ws-search-result').count()>0)
  await page.keyboard.press('Escape')
 })
 await test('홈 검색에서 일정 원본을 열고 뒤로 가면 상세창도 닫힌다',async()=>{
  await menu('오늘');await home();await search('체험학습');await dialog().locator('.ws-search-result').click()
  await page.getByRole('dialog').getByRole('heading',{name:'2학년 체험학습 준비 협의',exact:true}).waitFor()
  await page.goBack();await home();assert.equal(await page.locator('dialog[open]').count(),0)
 })
 await test('입력 중에는 검색 진입과 기한별 이동을 잠가 초안을 보존한다',async()=>{
  await page.getByRole('button',{name:'할 일 등록',exact:true}).click();await page.getByLabel('해야 할 일',{exact:true}).fill('검색 중에도 보존할 초안')
  assert(await page.getByRole('button',{name:'업무 찾기',exact:true}).isDisabled())
  for(const b of await page.getByRole('group',{name:'개인 업무 기한 요약'}).getByRole('button').all())assert(await b.isDisabled())
  await page.getByRole('button',{name:'편집 취소',exact:true}).click()
 })
 await test('검토자 홈의 행동은 정확한 두 번째 제출 단위로 연결된다',async()=>{
  const tools=page.locator('.developer-panel');await tools.locator('summary').click();await page.getByLabel('가상 소속 계정').selectOption('gaon-minjun')
  await page.getByRole('button',{name:/학급별 준비 수합.*두 번째 단위.*제출판 검토하기/}).click()
  const id=await page.evaluate(()=>window.qa.ids.unit);const unit=page.locator('[data-wf-unit-id="'+id+'"]');await unit.waitFor()
  assert(await unit.evaluate(n=>n.classList.contains('wf-unit-target')))
  await page.waitForFunction(id=>document.activeElement?.getAttribute('data-wf-unit-id')===id,id)
 })
 await test('학교 전환 후 이전 검색어·개인 업무를 다시 표시하지 않는다',async()=>{
  await menu('오늘');await page.getByLabel('학교 선택').selectOption('fixture-school-nuri');await home()
  await search();assert.equal(await dialog().getByLabel('검색어',{exact:true}).inputValue(),'')
  assert(!(await dialog().innerText()).includes('학급별 준비 수합'));assert(!(await dialog().innerText()).includes('지난 준비 업무'))
  await dialog().getByLabel('검색어',{exact:true}).fill('누리');assert(await dialog().locator('.ws-search-result').count()>0)
  await page.keyboard.press('Escape')
 })
 await test('390px 홈·검색에 가로 넘침이 없고 검색어는 주소·저장소에 남지 않는다',async()=>{
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await search('주소에남기지않을검색');assert(!page.url().includes('주소'))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0)
  if(output){await dialog().getByLabel('검색어',{exact:true}).fill('누리');await page.screenshot({path:join(output,'search-mobile.png')})}
  await page.keyboard.press('Escape')
 })
 await page.setViewportSize({width:1440,height:1100});await page.goto('http://127.0.0.1:5176/connected');await home();await page.getByRole('group',{name:'개인 업무 기한 요약'}).waitFor()
 await test('실제 연결 UI의 검색은 준비된 일정·개인 업무만 조회한다',async()=>{
  await search('오늘 준비');assert.equal(await dialog().getByLabel('검색 범위',{exact:true}).locator('option').count(),3)
  assert(!(await dialog().locator('.ws-search-header').innerText()).includes('자료 수합'))
  await dialog().locator('.ws-search-result').click();await page.getByRole('heading',{name:'내 업무',level:1,exact:true}).waitFor()
  const id=await page.evaluate(()=>window.qa.ids.today);await page.locator('[data-task-id="'+id+'"].task-card-highlighted').waitFor()
 })
 await test('검색 일부 조회 실패 시 다른 결과는 유지하고 해당 범위만 재시도한다',async()=>{
  await page.evaluate(()=>{window.qa.failTasks=true});await search('준비')
  await dialog().getByRole('button',{name:'내 업무 다시 불러오기'}).waitFor()
  assert.match(await dialog().locator('.ws-search-count').innerText(),/일부 자료/)
  assert(await dialog().locator('.ws-search-result').count()>0)
  await dialog().getByRole('button',{name:'내 업무 다시 불러오기'}).click()
  await dialog().getByRole('button',{name:/오늘 준비 업무/}).waitFor()
  await page.keyboard.press('Escape')
 })
 await test('현재 계정의 승인 상실은 열린 검색과 이전 결과를 제거한다',async()=>{
  await search('준비');await page.evaluate(()=>window.qa.deny())
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor();assert.equal(await page.locator('dialog[open]').count(),0)
  assert.equal(await page.getByRole('button',{name:'업무 찾기',exact:true}).count(),0)
 })
 await page.goto('http://127.0.0.1:5176/preview');await home();await page.getByRole('group',{name:'개인 업무 기한 요약'}).waitFor()
 await page.locator('.loading-state,.task-loading').first().waitFor({state:'hidden'})
 if(output){await page.screenshot({path:join(output,'home-desktop.png'),fullPage:true});await search('준비');await page.screenshot({path:join(output,'search-desktop.png')});await page.keyboard.press('Escape');writeFileSync(join(output,'home-search-results.json'),JSON.stringify({results,errors,external},null,2))}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 console.log('\n'+results.length+'개 홈·검색 브라우저 시나리오 통과')
}finally{await browser.close()}
