// 실제 관리자·참여자 셸과 메신저를 사용한다. NT1 모양의 합성 알림만 조회하며 외부 요청은 차단한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'

const bundle = buildSync({stdin:{contents:`
import './tests/browser/reset-fixture-checkpoint';
import React from 'react';import{createRoot}from'react-dom/client';
import{ConnectedWorkspace}from'./apps/workhub/src/app/ConnectedWorkspace';
import{ParticipantWorkspace}from'./apps/workhub/src/participation/ParticipantWorkspace';
import{ContractError}from'./apps/workhub/src/contracts';
import{createMemoryAdapter}from'./apps/workhub/src/preview/memory-adapter';
import{fixtureData,relationLabels}from'./apps/workhub/src/preview/fixtures';
import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
const data=structuredClone(fixtureData),calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate});
const now='2026-11-16T00:00:00Z',member='gaon-soyeon',school='fixture-school-gaon';
const base=calendar.info(),ctx={...base,schools:base.schools.filter(s=>s.id===school),memberships:base.memberships.filter(m=>m.schoolId===school),schoolLabels:{[school]:relationLabels},relationLabels};
const identity={userId:'fixture-soyeon',approved:true,profile:{id:'fixture-soyeon',name:'합성 교사',email:'test@example.invalid',role:window.mode==='participant'?'teacher':'superadmin',extra_permissions:[],department_id:null,is_active:true}};
let identityChanged=()=>{},invalidated=()=>{};
const recipient={memberId:'gaon-minjun',schoolId:school,name:'이민준',department:'교무부',version:1};
const thread=id=>({id,schoolId:school,kind:'direct',title:id==='notice-thread'?'알림의 정확한 대화':'다른 대화',participants:[{memberId:member,schoolId:school,name:'한소연',department:'',version:1},recipient],version:1,latestSequence:2,readSequence:0,unreadCount:2,updatedAt:now,canSend:true});
const message=id=>({id:'message-'+id,schoolId:school,threadId:id,senderMemberId:recipient.memberId,senderName:recipient.name,sequence:2,body:id==='notice-thread'?'알림에서 연 정확한 메시지입니다.':'다른 대화의 메시지입니다.',createdAt:now,attachments:[]});
const notices=[1,2].map(n=>({id:'notice-'+n,schoolId:school,ownerMemberId:member,title:n===1?'새 메시지 도착':'같은 대화의 새 답장',body:'받은 메시지 원본을 확인해 주세요.',createdAt:now,readAt:null,version:1,source:{module:'messages',id:'notice-thread'}}));
window.qa={calls:[],writes:[],fail:null,hold:false,releases:[],invalidate(){identity.approved=false;if(window.mode==='participant')invalidated(new ContractError('FORBIDDEN'));else identityChanged()},release(){window.qa.releases.splice(0).forEach(r=>r())}};
const env=(value,ok=true)=>({contractVersion:1,schoolId:school,memberId:member,userId:identity.userId,ok,...(ok?{data:value}:{error:{code:value}})});
const connection={async getIdentity(){return structuredClone(identity)},async loadContext(){return structuredClone(ctx)},info(){return structuredClone(ctx)},subscribeIdentity(f){identityChanged=f;return()=>{}},subscribeInvalidation(f){invalidated=f;return()=>{}},async checkReadiness(){return{stage:'ready',code:'READY',checkedAt:now,readySchoolCount:1}},async rpcVerified(name,args){window.qa.calls.push({name,args:structuredClone(args)});
if(name==='workhub_calendar_list')return calendar.list(args.p_member_id);
if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id);
if(name==='workhub_messaging_readiness')return env({available:true,reason:'ready',limits:{bodyCharacters:5000,titleCharacters:100,recipients:100},attachments:'not_configured'});
if(name==='workhub_message_threads')return env({items:[thread('other-thread')],nextCursor:null});
if(name==='workhub_message_recipients')return env({items:[recipient],nextCursor:null});
if(name==='workhub_inbox_list')return env({items:structuredClone(notices),nextCursor:null});
if(name==='workhub_message_get'){const id=args.p_thread_id;if(window.qa.hold&&id==='notice-thread')await new Promise(resolve=>window.qa.releases.push(resolve));if(window.qa.fail)return env(window.qa.fail,false);return env({thread:thread(id),items:[message(id)],nextCursor:null})}
if(/(?:_mutate|_execute|_commit|_ask|_confirm|_apply)$/.test(name)){window.qa.writes.push({name,args});throw new Error('자동 기록 금지: '+name)}
throw new ContractError('QUERY_FAILED');}};
createRoot(document.getElementById('root')).render(window.mode==='participant'?<ParticipantWorkspace access={{userId:identity.userId,schoolId:school,memberId:member,scopes:['messages'],expiresAt:'2099-12-31T00:00:00Z',revision:1}} connection={connection}/>:<ConnectedWorkspace expectedUserId={identity.userId} legacyHomeHref="/legacy" connection={connection}/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'http://localhost.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text

const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage()
const errors=[],external=[],origin='http://127.0.0.1:5294/'
let passed=0
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),detail=()=>page.getByRole('region',{name:'선택한 대화',exact:true})
const notice=title=>page.locator('.messaging-notice').filter({has:page.getByRole('heading',{name:title,exact:true})})
async function noWrite(){assert.deepEqual(await page.evaluate(()=>window.qa.writes),[])}
async function inbox(mode){
  if(mode==='assistant'){
    await button('AI 비서').first().click();const input=page.getByLabel('질문 또는 부탁할 일',{exact:true});await input.and(page.locator(':enabled')).waitFor();await input.fill('업무 알림 보여줘');await button('확인하기').click()
  }else{if(mode==='admin')await clickWorkspaceMenu(page,'메시지와 알림');await button('업무 알림').click()}
  await notice('새 메시지 도착').getByRole('button',{name:'메시지 원본 열기',exact:true}).waitFor()
}
async function boot(mode){await page.goto(origin+'notice-source');await page.evaluate(value=>window.mode=value,mode);await page.addScriptTag({content:bundle});if(mode==='participant')await page.getByRole('heading',{name:'메시지와 알림',level:2,exact:true}).waitFor();else await button('AI 비서').first().waitFor();await inbox(mode)}
async function test(mode,label,run){try{await boot(mode);await run();await noWrite();passed++;console.log('  ✓ '+mode+' · '+label)}catch(error){console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>window.qa.calls));console.error(errors);throw error}}
async function open(title='새 메시지 도착'){await notice(title).getByRole('button',{name:'메시지 원본 열기',exact:true}).click()}
async function returnInbox(mode){if(mode==='assistant'){await button('대화 보기').click();await page.getByLabel('질문 또는 부탁할 일',{exact:true}).fill('업무 알림 보여줘');await button('확인하기').click()}else await button('업무 알림').click();await notice('새 메시지 도착').waitFor()}
async function exactThread(){await detail().getByText('알림에서 연 정확한 메시지입니다.',{exact:true}).waitFor();assert.equal(await detail().getByText('다른 대화의 메시지입니다.',{exact:true}).count(),0);assert.equal(await detail().getByRole('heading',{name:'알림의 정확한 대화',exact:true}).count(),1)}
try{
 for(const mode of ['admin','assistant','participant']){
  await test(mode,'알림 목록 밖의 정확한 대화를 열고 같은 대화의 두 번째 알림도 재조회한다',async()=>{
    await open();await exactThread();assert.deepEqual(await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_message_get').map(c=>c.args.p_thread_id)),['notice-thread'])
    // 원본 열기는 읽음 표시와 다르다. 알림 2건 모두 미읽음 상태를 유지한다.
    await returnInbox(mode);assert.deepEqual(await page.locator('.messaging-notice').evaluateAll(items=>items.map(item=>item.dataset.read)),['false','false']);await open('같은 대화의 새 답장');await exactThread()
    assert.deepEqual(await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_message_get').map(c=>c.args.p_thread_id)),['notice-thread','notice-thread'])
  })
  for(const code of ['NOT_FOUND','FORBIDDEN'])await test(mode,code+'면 다른 대화를 대신 열거나 읽음을 기록하지 않는다',async()=>{
    await page.evaluate(value=>window.qa.fail=value,code);await open();await (code==='FORBIDDEN'?page.getByText('현재 학교의 메시지 이용 권한을 다시 확인해 주세요.',{exact:true}):button('요청한 대화 다시 확인')).waitFor();assert.equal(await page.getByText('알림에서 연 정확한 메시지입니다.',{exact:true}).count(),0);assert.equal(await page.getByText('다른 대화의 메시지입니다.',{exact:true}).count(),0)
  })
  await test(mode,'늦은 원본 응답은 이후에 선택한 대화를 덮지 않는다',async()=>{
    await page.evaluate(()=>window.qa.hold=true);await open();await page.waitForFunction(()=>window.qa.releases.length===1)
    // AI 원본을 불러오는 동안에도 일반 메시지 목록으로 이동할 수 있으며 늦은 응답은 새 선택을 덮지 않는다.
    if(mode==='assistant')await clickWorkspaceMenu(page,'메시지와 알림');await page.getByRole('button',{name:/다른 대화.*읽지/}).click();await detail().getByText('다른 대화의 메시지입니다.',{exact:true}).waitFor();await page.evaluate(()=>window.qa.release());await page.waitForTimeout(40)
    assert.equal(await detail().getByText('알림에서 연 정확한 메시지입니다.',{exact:true}).count(),0)
  })
  await test(mode,'조회 도중 신원·참여 권한이 무효화되면 늦은 원본을 다시 노출하지 않는다',async()=>{
    await page.evaluate(()=>window.qa.hold=true);await open();await page.waitForFunction(()=>window.qa.releases.length===1);await page.evaluate(()=>window.qa.invalidate());await page.getByText(mode==='participant'?'현재 참여 허용과 학교 소속을 다시 확인해 주세요.':/현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다/).waitFor();await page.evaluate(()=>window.qa.release());await page.waitForTimeout(40);assert.equal(await page.getByText('알림에서 연 정확한 메시지입니다.',{exact:true}).count(),0)
  })
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('메시지 알림 원본 연결 '+passed+'건 통과 · 운영 DB·유료 AI 호출 없음')
}finally{await browser.close()}
