// 실제 업무실 셸과 각 전송 어댑터에 같은 학교·교사의 합성 RPC/HTTP만 제공한다.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {ContractError} from '../../apps/workhub/src/contracts'
import {ASSISTANT_ROUTING} from '../../apps/workhub/src/assistant/contracts'
import {createMemoryAdapter} from '../../apps/workhub/src/preview/memory-adapter'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {createWorkflowStore} from '../../apps/workhub/src/workflows/store'

const w=window as any,copy=structuredClone,now=()=>new Date().toISOString()
const offset=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
const data=copy(fixtureData)
data.basisDate=offset(now().slice(0,10),3)
data.memberships.forEach(m=>{m.validFrom='2020-01-01';m.validThrough='2099-12-31'})
const calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate})
const ctx={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels}
const identity={userId:'fixture-soyeon',approved:true,profile:{id:'fixture-soyeon',name:'합성 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}}
const primary=ctx.memberships.find(m=>m.id==='gaon-soyeon')!
const actor=(id:string)=>{const m=ctx.memberships.find(m=>m.id===id);if(!m)throw Error('unknown synthetic member');return m}
const envelope=(member:any,contract:string,value:any)=>({contract,schoolId:member.schoolId,memberId:member.id,data:copy(value)})
const messaging=(member:any,value:any)=>({contractVersion:1,schoolId:member.schoolId,memberId:member.id,userId:identity.userId,ok:true,data:copy(value)})
const recipient=(member:any)=>({memberId:member.id==='gaon-soyeon'?'gaon-minjun':'nuri-doyun',schoolId:member.schoolId,name:member.id==='gaon-soyeon'?'이민준':'정도윤',department:'교무부',version:1})
const thread=(member:any,id:string)=>({id,schoolId:member.schoolId,kind:'direct',title:id==='home-thread'?'홈에서 선택한 정확한 대화':id==='sent-thread'?'방금 보낸 정확한 대화':'목록의 다른 대화',participants:[{memberId:member.id,schoolId:member.schoolId,name:member.name,department:'',version:1},recipient(member)],version:1,latestSequence:2,readSequence:0,unreadCount:1,updatedAt:now(),canSend:true})
const message=(member:any,id:string)=>({id:'message-'+id,schoolId:member.schoolId,threadId:id,senderMemberId:recipient(member).memberId,senderName:recipient(member).name,sequence:2,body:id==='home-thread'?'가온 홈 원본 내용':id==='sent-thread'?'검토 후 한 번 보낸 AI 초안':'목록의 다른 대화 내용',createdAt:now(),attachments:[]})
const span=(day:string,hour:number)=>({startsAt:day+'T'+String(hour).padStart(2,'0')+':00:00.000Z',endsAt:day+'T'+String(hour).padStart(2,'0')+':45:00.000Z'})
const lesson=(member:any,day:string)=>({id:member.id+'-'+day,version:1,label:day+' '+member.name+' 원본 수업',time:span(day,0),teachers:[{id:member.id,name:member.name}],groupNames:['1학년 1반'],roomNames:['1반 교실'],state:'scheduled',canRequest:true,allowedTargets:[span(day,0),span(day,1)]})
const anchors=[0,1].map(n=>({id:`Contents/section0.xml:p00000${n}`,section:'Contents/section0.xml',paragraph:n,sourceText:'원문',sourceHash:'a'.repeat(64),cell:null}))
const mapping={profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),questions:anchors.map((a,n)=>({id:`q${n}`,label:n?'참여 인원':'참여 계획',kind:n?'number':'longtext',required:true,maxLength:n?10:200,options:[],anchorId:a.id,sourceText:a.sourceText,sourceHash:a.sourceHash}))}
const template={id:'guided-template',schoolId:primary.schoolId,ownerMemberId:'gaon-minjun',title:'학교 행사 참여 원본 양식',version:2,state:'published',inspection:{profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors,unsupportedParagraphs:0},mapping,collectionRequestId:'collection-source',canManage:false}
let response={id:'guided-response',templateId:template.id,templateVersion:2,schoolId:primary.schoolId,ownerMemberId:primary.id,version:3,answers:{q0:'저장된 계획',q1:'3'},preview:false,artifact:null}
const receipts=new Map<string,any>(),aiThreads=new Map<string,any>()
w.cross={calls:[],writes:[],aiCalls:[],unknownMessage:false,unknownGuided:false,holdMessage:false,releaseMessage:null,heldSettled:false,appliedMessages:0,appliedGuided:0,basisDate:data.basisDate}
w.cross.assistantHttp=async(payload:any)=>{
 const member=actor(payload.memberId)
 if(payload.action==='readiness')return envelope(member,'assistant.v1',{available:true})
 if(payload.action!=='ask')throw Error('unexpected synthetic AI action '+payload.action)
 w.cross.aiCalls.push(copy(payload))
 const input=payload.input,prior=aiThreads.get(member.id)
 if(prior?.exchanges.some((e:any)=>e.requestKey===payload.requestKey))return envelope(member,'assistant.v1',{state:'completed',requestKey:payload.requestKey,thread:prior})
 const result={id:input.threadId??'assistant-'+member.id,mode:input.mode,version:input.expectedVersion+1,title:'같은 학교의 작성 도움',exchanges:[...(prior?.exchanges??[]),{id:'answer-'+payload.requestKey,requestKey:payload.requestKey,intent:input.intent,prompt:input.prompt,segments:[{text:input.intent==='guided_collection'?'AI가 제안한 참여 계획':'검토 후 한 번 보낸 AI 초안',citations:[]}],proposal:null,createdAt:now(),studentContext:null,...(input.quality?{execution:{quality:input.quality,model:ASSISTANT_ROUTING.models[input.quality as 'quick'|'review'].id,reviewOf:input.reviewOf}}:{})}],nextCursor:null}
 aiThreads.set(member.id,result)
 return envelope(member,'assistant.v1',{state:'completed',requestKey:payload.requestKey,thread:result})
}
const connection:any={getIdentity:async()=>copy(identity),loadContext:async()=>copy(ctx),info:()=>copy(ctx),subscribeIdentity:()=>()=>{},subscribeInvalidation:()=>()=>{},checkReadiness:async()=>({stage:'ready',code:'READY',checkedAt:now(),readySchoolCount:2}),rpcVerified:async(name:string,args:any)=>{
 const member=actor(args.p_member_id)
 w.cross.calls.push(copy({name,args}))
 if(/_(mutate|execute|close|render|publish|commit|save)$/.test(name))w.cross.writes.push(copy({name,args}))
 if(name==='workhub_calendar_list')return calendar.list(member.id)
 if(name==='workhub_calendar_get')return calendar.get(member.id,args.p_event_id)
 if(name==='workhub_task_list')return tasks.listTasks(member.id)
 if(name==='workhub_home_overview')return envelope(member,'home.v1',{asOf:now(),items:member.id===primary.id?[{id:'home-message',kind:'message',title:'확인할 원본 메시지',dueDate:null,sourceId:'home-thread',priority:'normal',label:'안 읽은 메시지 1개'}]:[],counts:{collection:0,supplement:0,message:member.id===primary.id?1:0,student_followup:0,cooperation:0},unavailable:[]})
 if(name==='workhub_messaging_readiness')return messaging(member,{available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:50},attachments:'not_configured'})
 if(name==='workhub_message_threads')return messaging(member,{items:[thread(member,'other-thread')],nextCursor:null})
 if(name==='workhub_message_recipients')return messaging(member,{items:[recipient(member)],nextCursor:null})
 if(name==='workhub_message_get'){
  const result=messaging(member,{thread:thread(member,args.p_thread_id),items:[message(member,args.p_thread_id)],nextCursor:null})
  if(w.cross.holdMessage&&args.p_thread_id==='home-thread'){await new Promise(resolve=>w.cross.releaseMessage=resolve);w.cross.heldSettled=true}
  return result
 }
 if(name==='workhub_message_mutate'){
  const key=member.id+':'+args.p_request_key,c=args.p_command
  if(receipts.has(key))return messaging(member,receipts.get(key))
  const result={requestKey:args.p_request_key,kind:c.kind,recordedAt:now(),deliveries:c.kind==='start'?[{threadId:'sent-thread',messageId:'sent-message',recipientMemberIds:c.recipients.map((r:any)=>r.memberId),sequence:1}]:[],threadId:c.kind==='read_thread'?c.threadId:null,throughSequence:c.kind==='read_thread'?c.throughSequence:null,noticeId:null,version:null}
  receipts.set(key,result);w.cross.appliedMessages++
  if(w.cross.unknownMessage){w.cross.unknownMessage=false;throw Error('synthetic lost message receipt')}
  return messaging(member,result)
 }
 if(name==='workhub_inbox_list')return messaging(member,{items:[{id:'notice-distinct-id',schoolId:member.schoolId,ownerMemberId:member.id,title:'정확한 시간표 변경 알림',body:'원본 요청을 확인하세요.',createdAt:now(),readAt:null,version:1,source:{module:'timetable',id:'notice-source-key'}}],nextCursor:null})
 if(name==='workhub_timetable_interventions_resolve')return envelope(member,'timetable-interventions.v1',{kind:'exchange',requestId:'request-24',schoolDayChangeId:null,date:data.basisDate,lessonId:null})
 if(name.startsWith('workhub_timetable_interventions_'))throw {code:'PGRST202'}
 if(name==='workhub_timetable_operations_readiness')return envelope(member,'timetable-operations.v1',{available:true})
 if(name==='workhub_timetable_operations_get'){
  const lessons=[];for(let date=args.p_from;date<args.p_until;date=offset(date,1))lessons.push(lesson(member,date))
  const before=lesson(member,data.basisDate),createdAt=new Date(Date.now()-60000).toISOString()
  const requests=Array.from({length:25},(_,i)=>({id:'request-'+String(i).padStart(2,'0'),version:1,proposalHash:'a'.repeat(64),state:'awaiting_approval',kind:'move',requester:{id:member.id,name:member.name},requesterIsViewer:true,createdAt,expiresAt:new Date(Date.now()+600000).toISOString(),reason:'정확한 변경 요청 '+i,changes:[{before,after:{...copy(before),version:2,time:span(data.basisDate,1)}}],participants:[{id:member.id,name:member.name,response:'accepted',respondedAt:createdAt}],actions:['withdraw']}))
  return envelope(member,'timetable-operations.v1',{asOf:now(),timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:false,canRequest:true,drafts:[],lessons,requests,publications:[]})
 }
 if(name==='workhub_timetable_operations_references')return envelope(member,'timetable-operations.next.v1',{asOf:args.p_source_as_of,from:args.p_from,until:args.p_until,lessons:Array.from({length:(Date.parse(args.p_until)-Date.parse(args.p_from))/86400000},(_,i)=>({lessonId:member.id+'-'+offset(args.p_from,i),version:1,groups:[{id:'class-'+member.id,name:'1학년 1반'}],rooms:[{id:'room-'+member.id,name:'1반 교실'}]}))})
 if(name==='workhub_document_list')return envelope(member,'documents.v1',{items:[],nextCursor:null,canShare:false})
 if(name==='workhub_template_list')return envelope(member,'guided.v1',{items:member.id===primary.id?[template]:[],nextCursor:null,canCreate:false})
 if(name==='workhub_template_get')return envelope(member,'guided.v1',{template,response})
 if(name==='workhub_template_mutate'||name==='workhub_template_request_get'){
  const key=member.id+':'+args.p_request_key
  if(receipts.has(key))return envelope(member,'guided.v1',receipts.get(key))
  response={...response,version:response.version+1,answers:copy(args.p_command.answers)}
  const result={requestKey:args.p_request_key,templateId:template.id,templateVersion:2,responseId:response.id,responseVersion:response.version}
  receipts.set(key,result);w.cross.appliedGuided++
  if(w.cross.unknownGuided){w.cross.unknownGuided=false;throw Error('synthetic lost guided receipt')}
  return envelope(member,'guided.v1',result)
 }
 if(name==='workhub_ai_policy_threads_list')return envelope(member,'assistant.v1',{items:[],nextCursor:null})
 if(name==='workhub_ai_policy_thread_get')return envelope(member,'assistant.v1',aiThreads.get(member.id))
 throw new ContractError('QUERY_FAILED','이 선택 기능은 교차 모듈 합성 시험에 포함하지 않습니다')
}}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ConnectedWorkspace expectedUserId={identity.userId} legacyHomeHref='/legacy' connection={connection}/></React.StrictMode>)
