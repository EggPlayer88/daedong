
import React from 'react';import{createRoot}from'react-dom/client';
import{ConnectedWorkspace}from'../../apps/workhub/src/app/ConnectedWorkspace';
import{ContractError}from'../../apps/workhub/src/contracts';
import{createMemoryAdapter}from'../../apps/workhub/src/preview/memory-adapter';
import{fixtureData,relationLabels}from'../../apps/workhub/src/preview/fixtures';
import{createWorkflowStore}from'../../apps/workhub/src/workflows/store';
const copy=v=>structuredClone(v),offset=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),now=()=>new Date().toISOString();
const data=copy(fixtureData);data.basisDate=offset(now().slice(0,10),3);data.memberships.forEach(m=>{m.validFrom='2020-01-01';m.validThrough='2099-12-31'});
const calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate});
const ctx={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels};
const identity={userId:'fixture-soyeon',approved:true,profile:{id:'fixture-soyeon',name:'합성 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}};
let identityChanged=()=>{};
window.state={calls:[],writes:[],basisDate:data.basisDate,selectedDate:offset(data.basisDate,2),noticeRequestId:'request-24',omitSelected:false,holdOperations:false,failOperations:false,release:null,revoke:()=>{identity.userId='different-account';identity.profile.id='different-account';identityChanged()}};
const span=(day,hour)=>({startsAt:day+'T'+String(hour).padStart(2,'0')+':00:00.000Z',endsAt:day+'T'+String(hour).padStart(2,'0')+':45:00.000Z'});
const lesson=(member,day)=>({id:member.id+'-'+day,version:1,label:day+' '+(member.id==='gaon-soyeon'?'가온':'누리')+' 원본 수업',time:span(day,0),teachers:[{id:member.id,name:member.name}],groupNames:['1학년 1반'],roomNames:['1반 교실'],state:'scheduled',canRequest:true,allowedTargets:[span(day,0),span(day,1)]});
const connection={getIdentity:async()=>copy(identity),loadContext:async()=>copy(ctx),info:()=>copy(ctx),subscribeIdentity:f=>{identityChanged=f;return()=>{}},subscribeInvalidation:()=>()=>{},checkReadiness:async()=>({stage:'ready',code:'READY',checkedAt:now(),readySchoolCount:2}),rpcVerified:async(name,args)=>{
 window.state.calls.push({name,args:copy(args)});const member=ctx.memberships.find(m=>m.id===args.p_member_id),env=(data,contract='timetable-operations.v1')=>({contract,schoolId:member.schoolId,memberId:member.id,data});
 if(name==='workhub_calendar_list')return calendar.list(args.p_member_id);
 if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id);
 if(name==='workhub_home_overview')return env({asOf:now(),items:[],counts:{collection:0,supplement:0,message:0,student_followup:0,cooperation:0},unavailable:[]},'home.v1');
 if(name==='workhub_messaging_readiness')return {contractVersion:1,schoolId:member.schoolId,memberId:member.id,userId:identity.userId,ok:true,data:{available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:50},attachments:'not_configured'}};
 if(name==='workhub_message_threads'||name==='workhub_message_recipients')return {contractVersion:1,schoolId:member.schoolId,memberId:member.id,userId:identity.userId,ok:true,data:{items:[],nextCursor:null}};
 if(name==='workhub_inbox_list')return {contractVersion:1,schoolId:member.schoolId,memberId:member.id,userId:identity.userId,ok:true,data:{items:[{id:'notice-distinct-id',schoolId:member.schoolId,ownerMemberId:member.id,title:'확인할 수업 교환 요청',body:'현재 시간표 요청 원본을 확인해 주세요.',createdAt:now(),readAt:null,version:1,source:{module:'timetable',id:window.state.noticeRequestId}}],nextCursor:null}};
 if(name.startsWith('workhub_timetable_interventions_')){
  if(name.endsWith('_resolve')&&window.state.resolveFailure)return {contract:'timetable-interventions.v1',schoolId:member.schoolId,memberId:member.id,error:{code:window.state.resolveFailure}};
  if(name.endsWith('_resolve')&&window.state.resolvedSource)return env(copy(window.state.resolvedSource),'timetable-interventions.v1');
  throw {code:'PGRST202'};
 }
 if(name==='workhub_timetable_operations_readiness')return env({available:true});
 if(name==='workhub_timetable_operations_get'){
  if(window.state.failOperations)throw new ContractError('QUERY_FAILED');
  const lessons=[];for(let date=args.p_from;date<args.p_until;date=offset(date,1))lessons.push(lesson(member,date));
  const before=lesson(member,data.basisDate),createdAt=new Date(Date.now()-60000).toISOString();
  const requests=Array.from({length:25},(_,i)=>({id:'request-'+String(i).padStart(2,'0'),version:1,proposalHash:'a'.repeat(64),state:'awaiting_approval',kind:'move',requester:{id:member.id,name:member.name},requesterIsViewer:true,createdAt,expiresAt:new Date(Date.now()+600000).toISOString(),reason:'정확한 요청 '+i,changes:[{before,after:{...copy(before),version:2,time:span(data.basisDate,1)}}],participants:[{id:member.id,name:member.name,response:'accepted',respondedAt:createdAt}],actions:['withdraw']})).filter(row=>!window.state.omitSelected||row.id!=='request-24');
  const response=env({asOf:now(),timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:false,canRequest:true,drafts:[],lessons,requests,publications:[]});
  if(window.state.holdOperations&&args.p_until!==offset(args.p_from,1)&&member.id==='gaon-soyeon')await new Promise(resolve=>window.state.release=resolve);
  return response;
 }
 if(name==='workhub_timetable_operations_references')return env({asOf:args.p_source_as_of,from:args.p_from,until:args.p_until,lessons:Array.from({length:(Date.parse(args.p_until)-Date.parse(args.p_from))/86400000},(_,i)=>({lessonId:member.id+'-'+offset(args.p_from,i),version:1,groups:[{id:'class-'+member.id,name:'1학년 1반'}],rooms:[{id:'room-'+member.id,name:'1반 교실'}]}))},'timetable-operations.next.v1');
 if(name==='workhub_timetable_operations_recommend')return env({input:copy(args.p_input),sourceAsOf:args.p_source_as_of,coverage:{from:args.p_input.from,until:args.p_input.until,complete:true},status:'none_found',explanations:['합성 자료의 추천 후보가 없습니다.'],candidates:[]},'timetable-operations.next.v1');
 if(name==='workhub_timetable_operations_exchange_preview'){
  const input=args.p_input,day=input.lessonId.slice(-10),before=lesson(member,day);
  return env({previewId:'preview-selected',previewHash:'a'.repeat(64),createdAt:now(),expiresAt:new Date(Date.now()+600000).toISOString(),input:copy(input),complete:true,changes:[{before,after:{...copy(before),version:2,time:copy(input.target)}}],participants:copy(before.teachers),blockers:[]});
 }
 if(name.endsWith('_execute')||name.endsWith('_mutate'))window.state.writes.push({name,args:copy(args)});
 throw new ContractError('QUERY_FAILED');
}};
createRoot(document.getElementById('root')).render(<ConnectedWorkspace expectedUserId='fixture-soyeon' legacyHomeHref='/legacy' connection={connection}/>);
