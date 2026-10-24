import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
// 실제 연결 셸·홈·메신저 어댑터를 합성 RPC에 연결한다. 운영 DB와 외부 API에는 접근하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';
import{ConnectedWorkspace}from'./apps/workhub/src/app/ConnectedWorkspace';
import{ContractError}from'./apps/workhub/src/contracts';
import{createMemoryAdapter}from'./apps/workhub/src/preview/memory-adapter';
import{fixtureData,relationLabels}from'./apps/workhub/src/preview/fixtures';
import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
const data=structuredClone(fixtureData),calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate});
const ctx={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels};
const identity={userId:'fixture-soyeon',approved:true,profile:{id:'fixture-soyeon',name:'합성 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}};
let identityChanged=()=>{},invalidated=()=>{};
const now='2026-10-19T00:00:00Z',member='gaon-soyeon',school='fixture-school-gaon';
const recipient={memberId:'gaon-minjun',schoolId:school,name:'이민준',department:'교무부',version:1};
const thread=id=>({id,schoolId:school,kind:'direct',title:id==='home-thread'?'홈에서 선택한 대화':'목록의 다른 대화',participants:[{memberId:member,schoolId:school,name:'한소연',department:'',version:1},recipient],version:1,latestSequence:2,readSequence:0,unreadCount:1,updatedAt:now,canSend:true});
const message=id=>({id:'message-'+id,schoolId:school,threadId:id,senderMemberId:recipient.memberId,senderName:recipient.name,sequence:2,body:id==='home-thread'?'정확한 홈 원본 내용입니다.':'다른 대화 내용입니다.',createdAt:now,attachments:[]});
window.state={calls:[],writes:[],saved:new Map(),applied:0,fail:null,hold:false,listFail:false,refresh:()=>identityChanged(),revoke:()=>{identity.approved=false;identityChanged()},resolve:()=>{}};
const env=(value,ok=true)=>({contractVersion:1,schoolId:school,memberId:member,userId:identity.userId,ok,...(ok?{data:value}:{error:{code:value}})});
const connection={async getIdentity(){return structuredClone(identity)},async loadContext(){return structuredClone(ctx)},info(){return structuredClone(ctx)},subscribeIdentity(f){identityChanged=f;return()=>{}},subscribeInvalidation(f){invalidated=f;return()=>{}},async checkReadiness(){return{stage:'ready',code:'READY',checkedAt:now,readySchoolCount:2}},async rpcVerified(name,args){window.state.calls.push({name,args:structuredClone(args)});
if(name==='workhub_calendar_list')return calendar.list(args.p_member_id);
if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id);
if(name==='workhub_home_overview')return{contract:'home.v1',schoolId:school,memberId:member,data:{asOf:now,items:[{id:'home-message',kind:'message',title:'확인할 원본 메시지',dueDate:null,sourceId:'home-thread',priority:'normal',label:'안 읽은 메시지 1개'}],counts:{collection:0,supplement:0,message:1,student_followup:0,cooperation:0},unavailable:[]}};
if(name==='workhub_messaging_readiness')return env({available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:50},attachments:'not_configured'});
if(name==='workhub_message_threads'){if(window.state.listFail)throw new ContractError('QUERY_FAILED');return env({items:[thread('other-thread')],nextCursor:null})}
if(name==='workhub_message_recipients')return env({items:[recipient],nextCursor:null});
if(name==='workhub_inbox_list')return env({items:[],nextCursor:null});
if(name==='workhub_message_get'){const id=args.p_thread_id;if(window.state.hold&&id==='home-thread')await new Promise(resolve=>window.state.resolve=resolve);if(window.state.fail==='QUERY_FAILED')throw new ContractError('QUERY_FAILED');if(window.state.fail)return env(window.state.fail,false);return env({thread:thread(id),items:[message(id)],nextCursor:null})}
if(name==='workhub_message_mutate'){window.state.writes.push(structuredClone(args));const c=args.p_command,k=args.p_request_key;if(window.state.saved.has(k))return env(window.state.saved.get(k));const result={requestKey:k,kind:c.kind,recordedAt:now,deliveries:c.kind==='start'?[{threadId:'sent-thread',messageId:'sent-message',recipientMemberIds:c.recipients.map(x=>x.memberId),sequence:1}]:[],threadId:c.kind==='read_thread'?c.threadId:null,throughSequence:c.kind==='read_thread'?c.throughSequence:null,noticeId:null,version:null};window.state.saved.set(k,result);window.state.applied++;if(window.state.unknown&&!window.state.failed){window.state.failed=true;throw new Error('합성 응답 유실')}return env(result)}
throw new ContractError('QUERY_FAILED');}};
createRoot(document.getElementById('root')).render(<ConnectedWorkspace expectedUserId="fixture-soyeon" legacyHomeHref="/legacy" connection={connection}/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'http://localhost.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),passed=[],errors=[],external=[],output=process.env.WORKHUB_QA_OUTPUT
const fontCss=readFileSync(new URL('../../apps/workhub/src/typography.css',import.meta.url),'utf8'),fontBytes=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url))
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',route=>{const url=route.request().url();if(!url.startsWith('http://127.0.0.1:5187/')){external.push(url);return route.abort()}if(url.endsWith('/assets/fonts/PretendardVariable.woff2'))return route.fulfill({contentType:'font/woff2',body:fontBytes});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const sourceButton=()=>page.getByRole('button',{name:'확인할 원본 메시지 안 읽은 메시지 1개',exact:true}),detail=()=>page.getByRole('region',{name:'선택한 대화',exact:true})
async function boot(){await page.setViewportSize({width:1280,height:1000});await page.goto('http://127.0.0.1:5187/home');await page.addStyleTag({content:fontCss});await page.addScriptTag({content:bundle.outputFiles[0].text});await sourceButton().waitFor()}
async function test(name,run){await boot();try{await run()}catch(error){console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>window.state.calls));throw error}passed.push(name);console.log('  ✓ '+name)}
async function go(name){await clickWorkspaceMenu(page,name)}
async function open(){await sourceButton().click();await detail().getByText('정확한 홈 원본 내용입니다.',{exact:true}).waitFor()}
async function compose(){await go('메시지와 알림');await page.getByRole('button',{name:'새 메시지',exact:true}).click();await page.getByLabel('이민준 · 교무부',{exact:true}).check();await page.getByLabel('메시지',{exact:true}).fill('보관할 메시지 원문')}
try{
await test('홈 카드는 목록에 없는 정확한 대화를 조회하고 초점을 주며 읽음은 명시 버튼에서만 기록한다',async()=>{
 await open();assert.equal(await detail().getByRole('heading',{name:'홈에서 선택한 대화',exact:true}).evaluate(el=>el.getRootNode().activeElement===el),true)
 assert.equal(await page.getByRole('region',{name:'대화 목록'}).getByText('홈에서 선택한 대화',{exact:true}).count(),0)
 assert.equal(await page.evaluate(()=>window.state.writes.length),0)
 await page.getByRole('button',{name:'화면에 연 메시지까지 읽음 표시',exact:true}).click();await page.getByText('읽음으로 표시했습니다. 업무 처리나 문서 제출 상태는 바뀌지 않습니다.',{exact:true}).waitFor()
 assert.deepEqual(await page.evaluate(()=>window.state.writes.map(x=>x.p_command)),[{kind:'read_thread',threadId:'home-thread',throughSequence:2}])
 await page.getByRole('button',{name:'홈으로 돌아가기',exact:true}).click();await sourceButton().waitFor();assert.equal(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})).then(x=>x.local+x.session),0)
})
await test('홈 전체 대화 건수는 목록을 열고 읽음·발송 없이 홈 요약으로 돌아온다',async()=>{
 const count=page.getByRole('button',{name:'안 읽은 대화 1개 · 메시지 목록 열기',exact:true})
 await count.click();await page.getByRole('region',{name:'대화 목록',exact:true}).getByText('목록의 다른 대화',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.state.calls.filter(x=>x.name==='workhub_message_get').length),0)
 const back=page.getByRole('button',{name:'홈 업무 요약으로 돌아가기',exact:true});await back.waitFor()
 await page.getByRole('button',{name:'새 메시지',exact:true}).click();await page.getByLabel('메시지',{exact:true}).fill('홈 목록 이동 뒤 입력')
 // 입력 변경이 메신저에서 부모 셸의 이동 잠금으로 전달된 뒤 판정한다.
 await back.and(page.locator(':disabled')).waitFor({state:'attached'})
 assert.equal(await back.isDisabled(),true)
 await page.getByRole('button',{name:'입력 접고 목록 보기',exact:true}).click();await back.and(page.locator(':enabled')).waitFor({state:'attached'});await page.setViewportSize({width:320,height:760});await back.focus();await page.keyboard.press('Enter');await sourceButton().waitFor()
 assert.equal(await page.evaluate(()=>window.state.writes.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
})
await test('홈 선택 재렌더가 다른 대화 선택을 되돌리지 않고 목록으로 돌아갈 수 있다',async()=>{
 await open();await page.getByRole('button',{name:/목록의 다른 대화/}).click();await detail().getByText('다른 대화 내용입니다.',{exact:true}).waitFor();await page.evaluate(()=>window.state.refresh());await detail().getByText('다른 대화 내용입니다.',{exact:true}).waitFor()
 assert.equal(await detail().getByText('정확한 홈 원본 내용입니다.',{exact:true}).count(),0)
 await page.getByRole('button',{name:'대화 목록으로 돌아가기',exact:true}).click();await detail().getByText('대화를 선택해 주세요.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.state.writes.length),0)
})
await test('접어둔 작성 입력은 홈 원본 이동 뒤 그대로 복원하고 새 대화로 바꾸지 않는다',async()=>{
 await compose();await page.getByRole('button',{name:'입력 접고 목록 보기',exact:true}).click();await go('오늘');await open();await page.getByRole('button',{name:'작성 계속하기',exact:true}).click();assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'보관할 메시지 원문');assert.equal(await page.getByRole('form',{name:'새 메시지 작성',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'홈으로 돌아가기',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.state.writes.length),0)
})
await test('결과 미상 전송은 홈 대화 조회 후에도 원래 요청 번호와 원문으로만 복구한다',async()=>{
 await page.evaluate(()=>window.state.unknown=true);await compose();await page.getByRole('button',{name:'받는 사람과 내용 확인',exact:true}).click();await page.getByRole('button',{name:'확인한 내용 보내기',exact:true}).click();await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).waitFor();await page.getByRole('button',{name:'입력 접고 목록 보기',exact:true}).click();await go('오늘');await open();await page.getByRole('button',{name:'보관한 입력 보기',exact:true}).click();assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'보관할 메시지 원문');await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click();await page.getByText(/메시지를 보냈습니다/).waitFor();const writes=await page.evaluate(()=>window.state.writes);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(await page.evaluate(()=>window.state.applied),1)
})
for(const code of ['NOT_FOUND','QUERY_FAILED','FORBIDDEN'])await test('홈 원본 오류 '+code+' 발생 시 다른 대화를 대신 열지 않고 안전하게 돌아간다',async()=>{
 await page.evaluate(code=>window.state.fail=code,code);await sourceButton().click();await page.getByRole('heading',{name:'메시지와 알림',exact:true,level:2}).waitFor();await (code==='FORBIDDEN'?page.getByText('현재 학교의 메시지 이용 권한을 다시 확인해 주세요.',{exact:true}):page.getByRole('button',{name:'요청한 대화 다시 확인',exact:true})).waitFor();assert.equal(await page.getByText('다른 대화 내용입니다.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.state.writes.length),0);await page.getByRole('button',{name:'홈으로 돌아가기',exact:true}).click();await sourceButton().waitFor()
})
await test('먼저 요청한 대화의 늦은 응답이 다른 선택을 덮어쓰지 않는다',async()=>{
 await page.evaluate(()=>window.state.hold=true);await sourceButton().click();await page.getByRole('button',{name:/목록의 다른 대화/}).click();await detail().getByText('다른 대화 내용입니다.',{exact:true}).waitFor();await page.evaluate(()=>window.state.resolve());await page.waitForTimeout(50);assert.equal(await detail().getByText('정확한 홈 원본 내용입니다.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.state.writes.length),0)
})
await test('대화 조회 중 가입 권한 회수는 늦은 원본과 이전 내용을 숨긴다',async()=>{
 await page.evaluate(()=>window.state.hold=true);await sourceButton().click();await page.waitForFunction(()=>window.state.calls.some(x=>x.name==='workhub_message_get'));await page.evaluate(()=>window.state.revoke());await page.getByText(/현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다/).waitFor();await page.evaluate(()=>window.state.resolve());await page.waitForTimeout(50);assert.equal(await page.getByText('정확한 홈 원본 내용입니다.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.state.writes.length),0)
})
await test('목록 조회 실패와 무관하게 정확한 원본을 열고 320px에서 키보드로 돌아간다',async()=>{
 await page.evaluate(()=>window.state.listFail=true);await open();await page.getByRole('region',{name:'대화 목록'}).getByRole('alert').waitFor();await page.setViewportSize({width:320,height:760});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.getByRole('button',{name:'홈으로 돌아가기',exact:true}).focus();await page.keyboard.press('Enter');await sourceButton().waitFor();await sourceButton().focus();await page.keyboard.press('Enter');await detail().getByText('정확한 홈 원본 내용입니다.',{exact:true}).waitFor();if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'home-message-320.png'),fullPage:true})}
})
await test('실제 업무실 도움말에서 업무로 이동하고 320px 헤더가 넘치지 않는다',async()=>{
 await page.setViewportSize({width:320,height:760});await page.getByRole('button',{name:'사용 안내',exact:true}).click();const help=page.getByRole('dialog',{name:'업무실 도움말',exact:true});await help.getByLabel('어떤 일을 하시나요?').fill('할 일');await help.getByRole('button',{name:'내 할 일 정리하기',exact:true}).click();await help.getByRole('button',{name:'내 업무 열기',exact:true}).click();await page.getByRole('heading',{name:'내 업무',level:1,exact:true}).waitFor();assert.equal(await help.count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.evaluate(()=>window.state.writes.length),0)
})
await test('실제 작성 입력이 잠긴 동안 안내를 읽어도 메시지와 원래 화면을 유지한다',async()=>{
 await compose();await page.getByRole('button',{name:'사용 안내',exact:true}).click();const help=page.getByRole('dialog',{name:'업무실 도움말',exact:true});await help.getByLabel('어떤 일을 하시나요?').fill('인계');assert.equal(await help.getByRole('button',{name:'학교 관리 열기',exact:true}).isDisabled(),true);await help.getByRole('tab',{name:'기능 연결 점검',exact:true}).click();assert.equal(await help.getByRole('button',{name:'전체 연결 점검',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'보관할 메시지 원문');assert.equal(await page.evaluate(()=>window.state.writes.length),0)
})
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(output)writeFileSync(join(output,'home-message-results.json'),JSON.stringify({passed,pageErrors:errors,externalRequests:external,scope:'실제 React·ConnectedWorkspace·홈/메신저 어댑터, 합성 RPC; 운영 DB·Storage 연결 아님'},null,2));console.log('홈 메시지 원본 브라우저 검사: '+passed.length+'개 통과')
}finally{await browser.close()}
