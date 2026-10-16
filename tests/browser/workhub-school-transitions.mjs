import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'
const yearBounds=JSON.parse(readFileSync(new URL('../../apps/workhub/src/setup/assets/school-admin.json',import.meta.url),'utf8')).schoolYearBounds
const bundle=buildSync({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{SchoolTransitions}from'./apps/workhub/src/administration/SchoolTransitions';import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';import{PendingRequestsProvider,createPendingRequests,recoveryScope}from'./apps/workhub/src/app/pending-requests';
const member={id:'m',schoolId:'s',userId:'u',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};window.member=member;window.calls=[];window.mode='ok';window.failRead=false;window.resourceVersion=3;window.legacy=false;window.approvalReady=true;window.oldDutyReceipt=false;window.withDuty=false;window.incomingState='pending';window.incomingVersion=1;window.incomingDuty=false;window.requester='sender';window.pending=createPendingRequests();window.drafts=createEditDrafts();
window.seedPending=(request)=>window.pending.put(recoveryScope(member),'handover',request);
const envelope=data=>({contract:'school-transitions.v1',schoolId:'s',memberId:'m',data});
const connection={info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-10-16'}),getIdentity:async()=>({userId:'u',approved:true}),rpcVerified:async(name,args)=>{
 window.calls.push({name,args:structuredClone(args)});
 if(name.endsWith('_list')){
  if(window.failRead)throw Error('private');
  const record={id:'incoming',kind:'handover',title:'받은 인계',version:window.incomingVersion,state:window.incomingState,canAccept:window.incomingState==='pending',canCancel:false,summary:['공식 업무 1건'],...(!window.legacy?{requesterMemberId:window.requester,requiresAdminReview:window.incomingDuty,canAdminReview:window.incomingState==='awaiting_admin'&&window.requester!=='m',adminReview:window.incomingDuty&&window.incomingState==='pending'?{memberId:'admin',name:'관리자 김교사',decision:'confirmed',reason:'공식 담당과 대상 확인',recordedAt:'2026-10-16T01:00:00Z'}:null}:{})};
  return envelope({canManageYear:true,...(!window.legacy?{dutyApproval:window.approvalReady?'admin_review_v1':null}:{}),years:[{id:'y26',year:2026,label:'2026학년도'}],recipients:[{memberId:'next',name:'인수 교사',version:2}],resources:[{kind:'collection',id:'c1',version:window.resourceVersion,label:'평가 자료'},...(window.withDuty?[{kind:'duty',id:'d1',version:2,label:'과학 담당'}]:[])],records:[record],nextCursor:null})
 }
 if(name.endsWith('_preview'))return envelope({fingerprint:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',summary:['확인한 공식 구조 1건'],excluded:['개인 상담과 학생 자료'],affectedCount:1});
 if(window.mode==='unknown')throw Error('private');if(window.mode==='deferred')await new Promise(resolve=>window.release=resolve);
 const cmd=args.p_command;
 return envelope({requestKey:args.p_request_key,recordId:cmd.recordId??'new',version:cmd.expectedVersion?cmd.expectedVersion+1:1,state:cmd.kind==='apply'?(cmd.plan.kind==='handover'?(cmd.plan.resources.some(r=>r.kind==='duty')&&!window.oldDutyReceipt?'awaiting_admin':'pending'):'completed'):cmd.kind==='accept'?'accepted':cmd.kind==='admin_confirm'?'pending':['reject','admin_reject'].includes(cmd.kind)?'rejected':'cancelled',recordedAt:'2026-10-16T01:00:00Z'})
}};
function Harness(){const[revision,refresh]=useState(0);window.refresh=()=>refresh(x=>x+1);return <EditDraftsProvider store={window.drafts}><PendingRequestsProvider store={window.pending}><SchoolTransitions connection={connection} member={member} revision={revision}/></PendingRequestsProvider></EditDraftsProvider>};window.mount=(clear=false)=>{if(clear)window.drafts=createEditDrafts();window.root=createRoot(document.getElementById('root'));window.root.render(<Harness/>)};window.mount();`,loader:'tsx',resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),passed=[],errors=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000)
await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'}))
async function start(){await page.goto('http://127.0.0.1:5179/knowledge');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByText('업무 인계와 새 학년도 준비',{exact:true}).click();await page.getByRole('button',{name:'업무 인계 준비',exact:true}).waitFor()}
async function test(name,run){await start();await run();passed.push(name);console.log('  ✓ '+name)}
async function prepareHandover(){await page.getByRole('button',{name:'업무 인계 준비'}).click();await page.getByLabel('인수 교사',{exact:true}).selectOption('next');await page.getByLabel('평가 자료 · 3판').check();await page.getByLabel('인계 내용',{exact:true}).fill('담당 업무 변경');await page.getByRole('button',{name:'변경 대상 미리보기'}).click();await page.getByRole('region',{name:'인계 변경 미리보기'}).waitFor()}
try{
await test('받은 인계는 수신 교사의 사유와 확인 후 인수한다',async()=>{await page.getByRole('button',{name:'인수 확인',exact:true}).click();assert.equal(await page.getByRole('button',{name:'확인한 변경 요청'}).isDisabled(),true);await page.getByLabel('확인·반려·취소 사유').fill('자료 확인');await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByText('확인한 변경을 서버에 반영했습니다.').waitFor();assert.equal(await page.evaluate(()=>window.calls.find(x=>x.name.endsWith('_mutate')).args.p_command.kind),'accept')})
await test('인계는 미리보기와 제외 자료를 보여 주고 자동 수락하지 않는다',async()=>{await prepareHandover();assert.match(await page.locator('body').innerText(),/개인 상담과 학생 자료/);assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')).length),0);await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').waitFor()})
await test('인계 내용이 바뀌면 이전 미리보기와 확인을 무효화한다',async()=>{await prepareHandover();await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.getByLabel('인계 내용',{exact:true}).fill('변경된 인계');assert.equal(await page.getByRole('region',{name:'인계 변경 미리보기'}).count(),0);assert.equal(await page.getByRole('button',{name:'확인한 변경 요청'}).isDisabled(),true)})
await test('새 학년도 공식 날짜 여섯 칸은 빈칸으로 시작한다',async()=>{await page.getByRole('button',{name:'새 학년도 준비',exact:true}).click();assert.equal(await page.locator('input[type=date]').count(),6);for(const element of await page.locator('input[type=date]').all())assert.equal(await element.inputValue(),'');assert.match(await page.locator('body').innerText(),/학생 진급·교사 배정·성적·누가기록은 복사하지 않습니다/)})
await test('결과 미확정 인계는 입력을 보존하고 같은 요청으로 재확인한다',async()=>{await prepareHandover();await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.evaluate(()=>{window.mode='unknown'});await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);await page.evaluate(()=>{window.mode='ok'});await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').waitFor();const calls=await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')));assert.deepEqual(calls[0].args,calls[1].args)})
await test('320px에서 학년도 입력이 가로로 넘치지 않는다',async()=>{await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'새 학년도 준비',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)})

await test('인계 대상 재조회 실패 중에는 이전 원문을 숨기고 재연결 뒤 복원한다',async()=>{await prepareHandover();await page.evaluate(()=>{window.failRead=true;window.refresh()});await page.getByText('현재 인계 권한과 대상을 다시 확인할 때까지 보관한 입력을 숨깁니다.',{exact:true}).waitFor();assert.equal(await page.getByLabel('인계 내용',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'확인한 변경 요청'}).count(),0);await page.evaluate(()=>{window.failRead=false});await page.getByRole('button',{name:'인계 서버 다시 확인'}).click();await page.getByLabel('인계 내용',{exact:true}).waitFor();assert.equal(await page.getByLabel('인계 내용',{exact:true}).inputValue(),'담당 업무 변경')})
await test('공식 업무의 판이 바뀌면 오래된 미리보기와 최종 확인을 폐기한다',async()=>{await prepareHandover();await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.evaluate(()=>{window.resourceVersion=4;window.refresh()});await page.getByLabel('평가 자료 · 4판').waitFor();assert.equal(await page.getByRole('region',{name:'인계 변경 미리보기'}).count(),0);assert.equal(await page.getByRole('button',{name:'확인한 변경 요청'}).isDisabled(),true)})
await test('편집 기억이 없어져도 미확정 인계는 원래 명령과 키로 조회한다',async()=>{await prepareHandover();await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.evaluate(()=>{window.mode='unknown'});await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).waitFor();await page.evaluate(()=>{window.mode='ok';window.root.unmount();window.mount(true)});await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).waitFor();await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').waitFor();const calls=await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')));assert.deepEqual(calls[0].args,calls[1].args)})

await test('인계 미리보기의 입력 오류는 서버 오류로 표시하지 않고 입력을 보존한다',async()=>{
 await page.getByRole('button',{name:'업무 인계 준비'}).click();await page.getByLabel('인수 교사',{exact:true}).selectOption('next');await page.getByLabel('평가 자료 · 3판').check()
 const note=page.getByLabel('인계 내용',{exact:true});await note.fill('보존할 인계 내용\u0007');await page.getByRole('button',{name:'변경 대상 미리보기'}).click()
 await page.getByRole('alert').filter({hasText:'입력 내용과 형식을 확인해 주세요.'}).waitFor()
 assert.equal(await note.inputValue(),'보존할 인계 내용\u0007');assert.equal(await page.getByLabel('인수 교사',{exact:true}).inputValue(),'next');assert.equal(await page.getByLabel('평가 자료 · 3판').isChecked(),true)
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_preview')||x.name.endsWith('_mutate')).length),0)
 assert.equal(await page.evaluate(()=>window.pending.count()),0);assert.doesNotMatch(await page.locator('body').innerText(),/서버 자료의 형식/)
 await note.fill('정정한 인계 내용');await page.getByRole('button',{name:'변경 대상 미리보기'}).click();await page.getByRole('region',{name:'인계 변경 미리보기'}).waitFor()
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_preview')).length),1)
})
await test('학교관리와 새 학년도 화면이 같은 학년도 입력 범위를 사용한다',async()=>{
 await page.getByRole('button',{name:'새 학년도 준비',exact:true}).click();const target=page.getByLabel('새 학년도',{exact:true})
 assert.equal(await target.getAttribute('min'),String(yearBounds.min));assert.equal(await target.getAttribute('max'),String(yearBounds.max))
})
await test('서버의 잘못된 인계 대상 판은 입력 오류로 바꾸지 않는다',async()=>{
 await page.evaluate(()=>{window.resourceVersion=0;window.refresh()})
 await page.getByRole('alert').filter({hasText:'서버 자료의 형식을 확인하지 못했습니다.'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'업무 인계 준비',exact:true}).count(),0)
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')).length),0)
})

await test('공식 담당은 관리자 확인 대기로 접수하고 자동으로 인수하지 않는다',async()=>{
 await page.evaluate(()=>{window.withDuty=true;window.refresh()});await page.getByRole('button',{name:'업무 인계 준비'}).click()
 await page.getByLabel('인수 교사',{exact:true}).selectOption('next');await page.getByLabel('과학 담당 · 2판',{exact:true}).check();await page.getByLabel('인계 내용',{exact:true}).fill('교과 담당 교체')
 await page.getByRole('button',{name:'변경 대상 미리보기'}).click();await page.getByRole('region',{name:'인계 변경 미리보기'}).waitFor();await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.getByRole('button',{name:'확인한 변경 요청'}).click()
 await page.getByText('인계 요청을 저장했습니다. 관리자 확인 후 받는 교사가 인수할 수 있습니다.').waitFor()
 const writes=await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')));assert.equal(writes.length,1);assert.equal(writes[0].args.p_command.kind,'apply')
})
await test('관리자 확인·반려는 별도 사유와 확인을 거치고 관리자 확인 후에도 수락을 기다린다',async()=>{
 await page.evaluate(()=>{window.incomingState='awaiting_admin';window.incomingDuty=true;window.refresh()});await page.getByRole('button',{name:'관리자 확인',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'인수 확인',exact:true}).count(),0)
 await page.getByRole('button',{name:'관리자 확인',exact:true}).click();assert.match(await page.getByRole('region',{name:'확인할 인계'}).innerText(),/받은 인계[\s\S]*관리자 확인 대기 · 1판[\s\S]*공식 업무 1건/);await page.getByLabel('확인·반려·취소 사유').fill('현재 담당 확인 완료');assert.equal(await page.getByRole('button',{name:'확인한 변경 요청'}).isDisabled(),true)
 await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').waitFor()
 assert.equal(await page.evaluate(()=>window.calls.find(x=>x.name.endsWith('_mutate')).args.p_command.kind),'admin_confirm')
 await page.evaluate(()=>{window.incomingState='pending';window.incomingVersion=2;window.refresh()});await page.getByRole('region',{name:'관리자 확인 이력'}).waitFor();assert.match(await page.getByRole('region',{name:'관리자 확인 이력'}).innerText(),/관리자 김교사/);await page.getByRole('button',{name:'인수 확인',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')).length),1)
})
await test('관리자 반려도 요청 번호와 예상 판을 포함해 반려 명령으로 보낸다',async()=>{
 await page.evaluate(()=>{window.incomingState='awaiting_admin';window.incomingDuty=true;window.refresh()});await page.getByRole('button',{name:'관리자 반려',exact:true}).click()
 await page.getByLabel('확인·반려·취소 사유').fill('대상 담당 재확인 필요');await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByText('확인한 변경을 서버에 반영했습니다.').waitFor()
 const command=await page.evaluate(()=>window.calls.find(x=>x.name.endsWith('_mutate')).args.p_command);assert.deepEqual(command,{kind:'admin_reject',recordId:'incoming',expectedVersion:1,reason:'대상 담당 재확인 필요'})
})
await test('자기 인계 요청에는 관리자 확인·반려 버튼이 나오지 않는다',async()=>{
 await page.evaluate(()=>{window.incomingState='awaiting_admin';window.incomingDuty=true;window.requester='m';window.refresh()});await page.getByRole('heading',{name:'받은 인계 · 관리자 확인 대기'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'관리자 확인',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'관리자 반려',exact:true}).count(),0)
})
await test('구 SQL에서는 공식 담당 선택과 인수·반려를 막고 기존 기록은 읽을 수 있다',async()=>{
 await page.evaluate(()=>{window.legacy=true;window.withDuty=true;window.refresh()});await page.getByText('공식 담당 인계의 관리자 확인 기능을 준비 중입니다.',{exact:false}).waitFor()
 await page.getByRole('heading',{name:'받은 인계 · 인수 확인 대기'}).waitFor();assert.equal(await page.getByRole('button',{name:'인수 확인',exact:true}).count(),0)
 await page.getByRole('button',{name:'업무 인계 준비'}).click();assert.equal(await page.getByLabel('과학 담당 · 2판 · 관리자 확인 준비 중').isDisabled(),true);assert.equal(await page.getByLabel('평가 자료 · 3판').isDisabled(),false)
})
await test('결과 미상 관리자 확인은 서버 준비가 사라져도 원키·사유를 보존하고 복구한다',async()=>{
 await page.evaluate(()=>{window.incomingState='awaiting_admin';window.incomingDuty=true;window.refresh()});await page.getByRole('button',{name:'관리자 확인',exact:true}).click();await page.getByLabel('확인·반려·취소 사유').fill('보존할 검토 사유');await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check()
 await page.evaluate(()=>{window.mode='unknown'});await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).waitFor()
 await page.evaluate(()=>{window.approvalReady=false;window.root.unmount();window.mount(true)});await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click();await page.getByRole('alert').filter({hasText:'서버 연결을 준비 중'}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1)
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')).length),1)
 await page.evaluate(()=>{window.approvalReady=true;window.mode='ok';window.refresh()});await page.getByLabel('확인·반려·취소 사유').waitFor();assert.equal(await page.getByLabel('확인·반려·취소 사유').inputValue(),'보존할 검토 사유')
 await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').waitFor();const writes=await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')));assert.deepEqual(writes[0].args,writes[1].args)
})
await test('관리자 검토 중 배경 조회 실패는 입력을 숨겨 보존하고 재조회로 복구한다',async()=>{
 await page.evaluate(()=>{window.incomingState='awaiting_admin';window.incomingDuty=true;window.refresh()});await page.getByRole('button',{name:'관리자 확인',exact:true}).click();await page.getByLabel('확인·반려·취소 사유').fill('작성 중인 검토');await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check()
 await page.evaluate(()=>{window.failRead=true;window.refresh()});await page.getByText('현재 인계 권한과 대상을 다시 확인할 때까지 보관한 입력을 숨깁니다.',{exact:true}).waitFor();assert.equal(await page.getByLabel('확인·반려·취소 사유').count(),0)
 await page.evaluate(()=>{window.failRead=false});await page.getByRole('button',{name:'인계 서버 다시 확인'}).click();await page.getByLabel('확인·반려·취소 사유').waitFor();assert.equal(await page.getByLabel('확인·반려·취소 사유').inputValue(),'작성 중인 검토')
})
await test('학년도 숫자와 시작 연도가 다르면 구체 안내와 입력을 남기고 미리보기하지 않는다',async()=>{
 await page.getByRole('button',{name:'새 학년도 준비',exact:true}).click();await page.getByLabel('기준 학년도',{exact:true}).selectOption('y26');await page.getByLabel('새 학년도',{exact:true}).fill('2026')
 for(const [label,value]of [['학년도 시작일','2027-03-01'],['학년도 마지막 날','2028-02-29'],['1학기 시작일','2027-03-01'],['1학기 마지막 날','2027-08-12'],['2학기 시작일','2027-08-13'],['2학기 마지막 날','2028-02-29']])await page.getByLabel(label,{exact:true}).fill(value)
 await page.getByRole('button',{name:'변경 대상 미리보기'}).click();await page.getByRole('alert').filter({hasText:'학년도 숫자와 학년도 시작일의 연도가 같아야 합니다.'}).waitFor();assert.equal(await page.getByLabel('새 학년도',{exact:true}).inputValue(),'2026');assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_preview')).length),0)
 await page.getByLabel('새 학년도',{exact:true}).fill('2027');await page.getByRole('button',{name:'변경 대상 미리보기'}).click();await page.getByRole('region',{name:'인계 변경 미리보기'}).waitFor()
})
await test('구 SQL의 공식 담당 접수증은 복구에서만 읽고 현재 승인 완료로 안내하지 않는다',async()=>{
 const command={kind:'apply',fingerprint:'a'.repeat(64),plan:{kind:'handover',recipientMemberId:'next',recipientVersion:2,resources:[{kind:'duty',id:'d1',version:2,label:'과학 담당'}],note:'이전 접수'}}
 await page.evaluate(command=>{window.oldDutyReceipt=true;window.root.unmount();window.seedPending({command,key:'legacy-duty-key'});window.mount(true)},command);await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click()
 await page.getByText('이전 인계 요청의 접수 결과를 확인했습니다. 현재 관리자 확인·인수 상태는 새로 조회한 기록에서 확인해 주세요.').waitFor()
 assert.equal(await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').count(),0);const writes=await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')));assert.equal(writes.length,1);assert.deepEqual(writes[0].args.p_command,command)
})
await test('과거에 이미 보낸 학년도 요청은 새 연도 검사로 지우지 않고 원키 그대로 복원한다',async()=>{
 const command={kind:'apply',fingerprint:'a'.repeat(64),plan:{kind:'new_year',sourceYearId:'y26',targetYear:2026,firstDay:'2027-03-01',lastDay:'2028-02-29',term1First:'2027-03-01',term1Last:'2027-08-12',term2First:'2027-08-13',term2Last:'2028-02-29',copyStructure:true}}
 await page.evaluate(command=>{window.root.unmount();window.seedPending({command,key:'legacy-year-key'});window.mount(true)},command);await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click();await page.getByText('확인한 변경을 서버에 반영했습니다.').waitFor()
 const args=await page.evaluate(()=>window.calls.find(x=>x.name.endsWith('_mutate')).args);assert.deepEqual(args.p_command,command);assert.equal(args.p_request_key,'legacy-year-key')
})
await test('이전 화면의 늦은 관리자 응답은 새 화면의 미확정 요청을 지우지 않는다',async()=>{
 await page.evaluate(()=>{window.incomingState='awaiting_admin';window.incomingDuty=true;window.refresh()});await page.getByRole('button',{name:'관리자 확인',exact:true}).click();await page.getByLabel('확인·반려·취소 사유').fill('늦은 응답 검토');await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check();await page.evaluate(()=>{window.mode='deferred'})
 await page.getByRole('button',{name:'확인한 변경 요청'}).click();await page.waitForFunction(()=>typeof window.release==='function');await page.evaluate(()=>{window.root.unmount();window.mount(true)});await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).waitFor();await page.evaluate(()=>{window.release();window.mode='ok'});await page.waitForTimeout(100)
 assert.equal(await page.evaluate(()=>window.pending.count()),1);assert.equal(await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').count(),0)
 await page.getByRole('button',{name:'원래 인계 요청 결과 확인'}).click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.').waitFor();const writes=await page.evaluate(()=>window.calls.filter(x=>x.name.endsWith('_mutate')));assert.deepEqual(writes[0].args,writes[1].args)
})

assert.deepEqual(errors,[]);if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'results.json'),JSON.stringify({passed,errors},null,2))
}finally{await browser.close()}
