import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'
const bundle=buildSync({stdin:{contents:`
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ConnectedWorkspace} from './apps/workhub/src/app/ConnectedWorkspace';
  import {createSupabaseConnection} from './apps/workhub/src/connection/supabase-connection';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  import {createWorkflowStore} from './apps/workhub/src/workflows/store';
  let uid='fixture-soyeon', denied=false, profileError=false, delay=40, callback=()=>{};
  const memory=createMemoryAdapter(fixtureData,0);
  const tasks=createWorkflowStore({members:fixtureData.memberships,date:fixtureData.basisDate});
  tasks.createTask('gaon-soyeon',{title:'가온 학교의 내 업무',notes:'합성 개인 자료',dueDate:'2026-10-19'},'seed-gaon');
  tasks.createTask('nuri-soyeon',{title:'누리 학교의 내 업무',notes:'다른 학교 합성 자료',dueDate:''},'seed-nuri');
  let taskDelay=0,collectionReason=null;
  const scenario={contextCalls:0,taskCalls:0,initialEvents:0,invalidations:[],token(){callback({user:{id:uid}})},switchUser(id){uid=id;callback({user:{id:uid}})},deny(){denied=true},profileError(value){profileError=value},delay(value){delay=value},taskDelay(value){taskDelay=value},collectionReason(value){collectionReason=value}};
  window.scenario=scenario;
  const services={async getSession(){return {user:{id:uid}}},async fetchMyProfile(id){if(delay) await new Promise(r=>setTimeout(r,delay));if(profileError)throw new Error('synthetic query failure');return {id,name:'가상 기존 회원',email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}},onAuthStateChange(cb){callback=cb;const timer=setTimeout(()=>{scenario.initialEvents++;cb({user:{id:uid}},'INITIAL_SESSION')},0);return()=>{clearTimeout(timer);callback=()=>{}}},async signInWithGoogle(){},async signOut(){},async rpc(name,args){
    if(name==='workhub_context'){scenario.contextCalls++;return {error:null,data:{...memory.info(),schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}}}
    if(denied)return {data:null,error:{message:'INACTIVE_MEMBERSHIP'}};
    if(name==='workhub_collection_basic_readiness'){
      if(!collectionReason)return {data:null,error:{code:'PGRST202',message:'synthetic missing function'}};
      const actor=fixtureData.memberships.find(member=>member.id===args.p_member_id);
      return {error:null,data:{contractVersion:1,schoolId:actor.schoolId,memberId:actor.id,data:{available:false,reason:collectionReason,policy:null}}};
    }
    if(name.startsWith('workhub_task_')){
      scenario.taskCalls++;
      if(taskDelay)await new Promise(resolve=>setTimeout(resolve,taskDelay));
      try{
        if(name==='workhub_task_list')return {data:tasks.listTasks(args.p_member_id),error:null};
        if(name==='workhub_task_get')return {data:tasks.listTasks(args.p_member_id).find(task=>task.id===args.p_task_id),error:null};
        const c=args.p_command,k=args.p_request_key,m=args.p_member_id;
        return {data:c.kind==='create'?tasks.createTask(m,c.input,k):c.kind==='update'?tasks.updateTask(m,c.taskId,c.input,c.expectedVersion,k):tasks.setTaskStatus(m,c.taskId,c.status,c.expectedVersion,k),error:null};
      }catch(error){return {data:null,error:{message:error.code==='VERSION_CONFLICT'?'CONFLICT':error.code}}}
    }
    try { if(name==='workhub_calendar_list')return {data:await memory.list(args.p_member_id),error:null};if(name==='workhub_calendar_get')return {data:await memory.get(args.p_member_id,args.p_event_id),error:null};if(name==='workhub_calendar_save')return {data:await memory.save(args.p_member_id,args.p_command),error:null}; } catch(e){return {data:null,error:{message:e.code}}}
    return {data:null,error:{message:'UNKNOWN'}};
  }};
  const connection=createSupabaseConnection(services);
  connection.subscribeInvalidation(reason=>scenario.invalidations.push(reason.code));
  createRoot(document.getElementById('root')).render(<ConnectedWorkspace legacyHomeHref="/" expectedUserId="fixture-soyeon" connection={connection}/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'http://localhost.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser()
const context=await browser.newContext({viewport:{width:1280,height:1000}})
const page=await context.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
await page.route('**/connection-contract-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>'}))
async function boot(){await page.goto('http://127.0.0.1:5176/connection-contract-test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'일정 등록',exact:true}).waitFor();await page.getByRole('button',{name:'일정 등록',exact:true}).click();await page.locator('input[name="title"]').fill('보존해야 하는 미저장 초안')}
try{
  await boot()
  assert.deepEqual(await page.evaluate(()=>({initialEvents:window.scenario.initialEvents,invalidations:window.scenario.invalidations})),{initialEvents:1,invalidations:[]})
  await page.evaluate(()=>window.scenario.delay(0))
  console.log('  ✓ 첫 INITIAL_SESSION과 느린 프로필이 겹쳐도 초기 학교 연결을 무효화하지 않음')
  assert(await page.locator('.dialog-body').evaluate(node => parseFloat(getComputedStyle(node).paddingTop)) > 0)
  assert.equal(await page.getByLabel('사용할 학교').locator('option').count(),2)
  assert.equal(await page.getByRole('button',{name:'다른 교사 수정 발생'}).count(),0)
  let count=await page.evaluate(()=>window.scenario.contextCalls)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(old=>window.scenario.contextCalls>old,count)
  assert.equal(await page.locator('input[name="title"]').inputValue(),'보존해야 하는 미저장 초안')
  console.log('  ✓ 같은 계정의 포커스 재검증에서 미저장 초안 유지')
  count=await page.evaluate(()=>window.scenario.contextCalls)
  await page.evaluate(()=>window.scenario.token())
  await page.waitForFunction(old=>window.scenario.contextCalls>old,count)
  assert.equal(await page.locator('input[name="title"]').inputValue(),'보존해야 하는 미저장 초안')
  console.log('  ✓ 동일 UID 토큰 갱신에서 미저장 초안 유지')
  await page.evaluate(() => {
    const root = [...document.querySelectorAll('*')].find(node=>node.shadowRoot).shadowRoot;
    window.focusBlanks = 0;
    window.focusObserver = new MutationObserver(() => { if (root.querySelector('.connected-empty')) window.focusBlanks++ });
    window.focusObserver.observe(root, {childList:true, subtree:true});
    window.scenario.delay(120); window.dispatchEvent(new Event('focus'));
    setTimeout(() => window.scenario.token(), 30);
  })
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(()=>window.focusBlanks),0,'포커스와 같은 계정 토큰 갱신이 겹쳐도 빈 연결 화면이 되지 않습니다')
  await page.evaluate(()=>{window.focusObserver.disconnect();window.scenario.delay(0)})
  console.log('  ✓ 포커스·동일 계정 갱신이 겹친 경우에도 연결 화면 유지')
  await page.evaluate(()=>window.scenario.deny())
  await page.getByRole('dialog').getByRole('button',{name:'일정 등록',exact:true}).click()
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  assert.equal(await page.getByText('보존해야 하는 미저장 초안',{exact:true}).count(),0)
  console.log('  ✓ 서버의 소속 종료 거부 즉시 목록·편집창 폐기')
  await boot();await page.evaluate(()=>{window.scenario.delay(200);window.scenario.switchUser('fixture-minjun')})
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  console.log('  ✓ 다른 계정 전환에서 이전 자료 즉시 폐기')
  await boot();await page.evaluate(()=>{window.scenario.profileError(true);window.scenario.token()})
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  console.log('  ✓ 계정 확인 실패에서 이전 업무 화면 재사용 차단')

  await boot();await page.getByRole('button',{name:'일정 편집 닫기'}).click()
  await page.getByText('가온 학교의 내 업무',{exact:true}).waitFor()
  await page.evaluate(() => {
    const root = [...document.querySelectorAll('*')].find(node=>node.shadowRoot).shadowRoot;
    window.keptEvents = root.querySelector('.event-list'); window.keptTasks = root.querySelector('.task-list');
    window.scenario.taskDelay(600); window.dispatchEvent(new Event('focus'));
  })
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(()=>window.keptEvents.isConnected && window.keptTasks.isConnected),true,'창 복귀 중 홈의 일정·업무 DOM을 제거하지 않습니다')
  await page.waitForTimeout(700)
  await page.evaluate(()=>window.scenario.taskDelay(0))
  console.log('  ✓ 창 복귀 재조회 중 홈 일정·내 업무 목록 DOM 유지')
  await clickWorkspaceMenu(page,'내 업무')
  await page.getByRole('heading',{name:'내 업무',exact:true,level:1}).waitFor()
  await page.getByText('가온 학교의 내 업무',{exact:true}).waitFor()
  assert.equal(await page.getByText('누리 학교의 내 업무',{exact:true}).count(),0)
  console.log('  ✓ 실제 연결 홈·내 업무가 같은 RPC 자료를 조회하며 다른 학교 자료를 표시하지 않음')
  await page.getByRole('button',{name:'할 일 등록',exact:true}).click()
  await page.getByLabel('해야 할 일',{exact:true}).fill('기존 로그인으로 연결한 업무')
  assert.equal(await page.getByLabel('사용할 학교').isDisabled(),true)
  const lockedNavigation=page.getByRole('navigation',{name:'신축 업무 메뉴'})
  for(const button of await lockedNavigation.locator('.ws-menu-button:not(.ws-assistant-trigger)').all()) assert.equal(await button.isDisabled(),true)
  assert.equal(await lockedNavigation.getByRole('button',{name:'더보기',exact:true}).isEnabled(),true)
  await lockedNavigation.getByRole('button',{name:'더보기',exact:true}).click()
  const lockedMore=page.getByRole('dialog',{name:'더보기',exact:true})
  for(const button of await lockedMore.locator('.ws-menu-button').all()) assert.equal(await button.isDisabled(),true)
  assert.equal(await lockedMore.getByRole('button',{name:'AI 비서',exact:true}).isEnabled(),true)
  assert.equal(await lockedMore.getByRole('button',{name:'화면 설정',exact:true}).isEnabled(),true)
  await page.keyboard.press('Escape')
  count=await page.evaluate(()=>window.scenario.contextCalls)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(old=>window.scenario.contextCalls>old,count)
  assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'기존 로그인으로 연결한 업무')
  await page.getByRole('button',{name:'내 업무에 추가',exact:true}).click()
  await page.getByRole('article',{name:'기존 로그인으로 연결한 업무',exact:true}).waitFor()
  await clickWorkspaceMenu(page,'오늘')
  await page.getByRole('article',{name:'기존 로그인으로 연결한 업무',exact:true}).getByRole('button',{name:'완료',exact:true}).click()
  await page.getByRole('article',{name:'기존 로그인으로 연결한 업무',exact:true}).waitFor({state:'detached'})
  console.log('  ✓ 실제 앱에서 편집 중 이동 잠금·포커스 입력 보존·등록 후 홈 완료 RPC 왕복')
  await clickWorkspaceMenu(page,'오늘')
  await page.getByText('가온 학교의 내 업무',{exact:true}).waitFor()
  await page.evaluate(()=>window.scenario.taskDelay(350))
  await clickWorkspaceMenu(page,'내 업무')
  await page.getByLabel('사용할 학교').selectOption('nuri-soyeon')
  await page.getByText('누리 학교의 내 업무',{exact:true}).waitFor()
  assert.equal(await page.getByText('가온 학교의 내 업무',{exact:true}).count(),0)
  console.log('  ✓ 학교 전환 중 이전 학교의 늦은 업무 조회 결과 폐기')
  await clickWorkspaceMenu(page,'자료 수합')
  await page.getByText('현재 연결을 확인하지 못해 원인을 확정할 수 없습니다.',{exact:true}).waitFor()
  await page.getByText('수합 목록을 확인하지 못했습니다. 빈 목록으로 판단하지 않습니다. 다시 확인해 주세요.',{exact:true}).waitFor()
  assert.equal(await page.getByText('현재 볼 수 있는 수합이 없습니다.',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'새 수합 만들기',exact:true}).count(),0)
  console.log('  ✓ 현재 R0에 수합 RPC가 없어도 빈 목록·저장 성공으로 바꾸지 않고 별도 안내한다')
  await page.evaluate(()=>window.scenario.collectionReason('verification_missing'))
  await page.getByRole('button',{name:'연결과 원본 다시 확인',exact:true}).click()
  await page.getByText('HWPX 파일의 기본 확인 기능이 아직 연결되지 않았습니다.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'새 수합 만들기',exact:true}).count(),0)
  console.log('  ✓ 실제 연결 셸에서도 서버 파일 검사 준비 전 등록·업로드를 열지 않는다')
  await clickWorkspaceMenu(page,'내 업무')
  await page.setViewportSize({width:360,height:800})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await clickWorkspaceMenu(page,'내 업무')
  await page.getByText('누리 학교의 내 업무',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  console.log('  ✓ 360px 모바일에서 실제 앱 업무 메뉴·내 업무 가로 넘침 없음')
  await page.evaluate(()=>window.scenario.switchUser('fixture-minjun'))
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByText('누리 학교의 내 업무',{exact:true}).count(),0)
  console.log('  ✓ 실제 계정 연결 변경 즉시 개인 업무 화면 폐기')
  assert.deepEqual(errors,[])
  console.log('  ✓ 실제 연결 JSX·Shadow DOM에서 런타임 오류 없음 (합성 전송 계층)')
}catch(e){console.error(e);console.error((await page.locator('body').innerText()).slice(-3000));process.exitCode=1}
finally{await context.close();await browser.close()}
