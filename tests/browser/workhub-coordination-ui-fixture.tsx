import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {WorkspaceShell} from '../../apps/workhub/src/app/WorkspaceShell'
import {CalendarBatchImportPanel} from '../../apps/workhub/src/calendar/CalendarBatchImport'
import type {CalendarBatchAdapter} from '../../apps/workhub/src/calendar/batch-contracts'
import {CalendarPanel} from '../../apps/workhub/src/calendar/CalendarPanel'
import {createMemoryAdapter} from '../../apps/workhub/src/preview/memory-adapter'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {CooperationWorkspacePanel} from '../../apps/workhub/src/cooperation/CooperationWorkspace'
import type {CooperationAdapter,CooperationRequest} from '../../apps/workhub/src/cooperation/contracts'
import {SchoolTransitions} from '../../apps/workhub/src/administration/SchoolTransitions'
import type {SupabaseConnection} from '../../apps/workhub/src/connection/supabase-connection'
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts'
import {createPendingRequests,PendingRequestsProvider} from '../../apps/workhub/src/app/pending-requests'
import base from '../../apps/workhub/src/style.css?inline'

// UI 배치와 입력 보존만 확인한다. 실제 학교·계정·서버에 연결하지 않는다.
const data=structuredClone(fixtureData),member=data.memberships.find(m=>m.id==='gaon-minjun')!,other=data.memberships.find(m=>m.schoolId===member.schoolId&&m.id!==member.id)!,time='2026-10-19T01:00:00Z'
const state={writes:[] as unknown[],previews:[] as unknown[],drop:false,receipts:new Map<string,unknown>()}
Object.assign(window,{coordination:state})
const memory=createMemoryAdapter(data,0),calendar={...memory,save:async(id:string,command:any)=>{state.writes.push(structuredClone(command));return memory.save(id,command)}}
const requests:CooperationRequest[]=[{id:'r1',schoolId:member.schoolId,version:1,senderMemberId:other.id,recipientMemberId:member.id,senderName:other.name,recipientName:member.name,title:'학년 협의회 자료 검토',description:'학급별 준비 내용을 검토하고 의견을 남겨 주세요.\n확인 후 다음 주 회의에서 함께 정리하겠습니다.',dueDate:'2026-10-30',status:'requested',createdAt:time,updatedAt:time,taskLink:null}]
const cooperation:CooperationAdapter={
 catalog:async()=>({recipients:[{memberId:other.id,name:other.name,description:'교무부'}],sourceTasks:[{id:'t1',title:'학년 협의회 준비',version:2}],nextTaskCursor:null}),
 list:async(_,filter)=>({items:requests.filter(r=>(filter.box==='received'?r.recipientMemberId:r.senderMemberId)===member.id),nextCursor:null}),
 detail:async(_,id)=>({request:structuredClone(requests.find(r=>r.id===id)!),history:[{id:'h1',version:1,action:'create',actorMemberId:other.id,comment:'',recordedAt:time}]}),
 mutate:async(_,command,key)=>{state.writes.push(structuredClone({command,key}));if(command.kind!=='create')throw Error('UI fixture only creates requests');requests.push({...requests[0],id:'created',senderMemberId:member.id,senderName:member.name,recipientMemberId:other.id,recipientName:other.name,title:command.title,description:command.description,dueDate:command.dueDate});return {requestKey:key,commandKind:command.kind,entityId:'created',version:1,outcome:'applied',appliedAt:time}}
}
const envelope=(value:unknown)=>({contract:'school-transitions.v1',schoolId:member.schoolId,memberId:member.id,data:value})
const connection={
 info:()=>({memberships:[member,other],schools:[{id:member.schoolId}],basisDate:data.basisDate}),getIdentity:async()=>({userId:member.userId,approved:true}),
 rpcVerified:async(name:string,args:any)=>{
  if(name.endsWith('_list'))return envelope({canManageYear:true,dutyApproval:'admin_review_v1',years:[{id:'y26',year:2026,label:'2026학년도'}],recipients:[{memberId:other.id,name:other.name,version:2}],resources:[{kind:'collection',id:'c1',label:'학급 운영계획 수합',version:3},{kind:'cooperation',id:'co1',label:'학년 협의회 준비',version:2}],records:[{id:'incoming',kind:'handover',title:'학년 협의회 담당 인계',version:2,state:'pending',canAccept:true,canCancel:false,summary:['협업 요청 1건 · 준비 중인 자료를 확인해 주세요.'],requesterMemberId:other.id,requiresAdminReview:false,canAdminReview:false,adminReview:null}],nextCursor:null})
  if(name.endsWith('_preview')){state.previews.push(structuredClone(args));return envelope({fingerprint:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',summary:['선택한 수합 1건의 담당자를 인계합니다.'],excluded:['개인 메모·상담·학생 기록은 포함하지 않습니다.'],affectedCount:1})}
  if(name.endsWith('_mutate')){state.writes.push(structuredClone(args));if(state.receipts.has(args.p_request_key))return envelope(state.receipts.get(args.p_request_key));const receipt={requestKey:args.p_request_key,recordId:'new',version:1,state:'pending',recordedAt:time};state.receipts.set(args.p_request_key,receipt);if(state.drop)throw Error('합성 응답 유실');return envelope(receipt)}
  throw Error('unexpected synthetic RPC '+name)
 }
} as unknown as SupabaseConnection
const batch:CalendarBatchAdapter={prepare:async()=>{throw Error('UI layout does not call prepare')},commit:async()=>{throw Error('UI layout does not write')}}
const drafts=createEditDrafts(),pending=createPendingRequests()
const screen=location.pathname.slice(1),pageId=['calendar','batch'].includes(screen)?'calendar':screen==='cooperation'?'cooperation':'schoolAdmin'
function App(){const [revision,setRevision]=useState(0);return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{base}</style><WorkspaceShell page={pageId} mode="connected" schoolName="가온중학교 · 합성 자료" memberName={member.name} onNavigate={()=>{}}>
 {screen==='calendar'?<CalendarPanel member={member} members={data.memberships} schoolName="가온중학교" date={data.basisDate} adapter={calendar} revision={revision} page="calendar" onPageChange={()=>{}} relationOptions={relationLabels}/>:<main className="main-content"><header className="page-header"><h1>{screen==='batch'?'학교 일정':screen==='cooperation'?'함께하는 업무':'학교 관리'}</h1></header>{screen==='batch'?<CalendarBatchImportPanel adapter={batch} member={member} members={data.memberships} date={data.basisDate} onClose={()=>{}}/>:screen==='cooperation'?<CooperationWorkspacePanel adapter={cooperation} member={member} date={data.basisDate}/>:<SchoolTransitions connection={connection} member={member}/>}</main>}
 </WorkspaceShell></PendingRequestsProvider></EditDraftsProvider>}
createRoot(document.getElementById('root')!).render(<App/> )
