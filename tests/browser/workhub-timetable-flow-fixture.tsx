import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TimetableWorkspace } from '../../apps/workhub/src/timetable/TimetableWorkspace'
import { timetablePracticeSnapshot } from '../../apps/workhub/src/timetable/sample'
import { solveTimetable } from '../../packages/timetable/src/solver'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests } from '../../apps/workhub/src/app/pending-requests'
const w = window as any, copy = (x: any) => structuredClone(x)
const member = { id:'m',schoolId:'s',userId:'u',name:'합성 담당자',role:'admin',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31',departmentIds:[],gradeIds:[],subjectIds:[] }
w.calls=[];w.saved=0;w.receipts={};w.drop=false;w.failRead=false;w.operationVersion=1;w.holdSolve=false;w.solveCount=0
w.drafts=createEditDrafts();w.pending=createPendingRequests();w.snapshot=timetablePracticeSnapshot('2026-10-19');w.snapshot.basis.schoolId='s';w.snapshot.canSave=true
// 계산 자체는 실제 알고리즘을 사용한다. 작업자 전달과 서버는 합성 경계이다.
class FixtureWorker {
  onmessage: any; onerror: any; onmessageerror: any; stopped=false
  postMessage(input: any) { w.solveCount++; const result=solveTimetable(input.basis); const deliver=()=>{if(!this.stopped)this.onmessage?.({data:{id:input.id,result}})}; if(w.holdSolve)w.deliverSolve=deliver;else queueMicrotask(deliver) }
  terminate(){this.stopped=true}
}
w.Worker=FixtureWorker
const connection:any={info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-10-19'}),getIdentity:async()=>({userId:'u',approved:true}),rpcVerified:async(name:string,args:any)=>{
 w.calls.push({name,args:copy(args)})
 const operation=name.startsWith('workhub_timetable_operations_'),contract=operation?'timetable-operations.v1':'timetable.v1'
 const env=(data:any)=>({contract,schoolId:'s',memberId:'m',data}),fail=(code:string)=>({contract,schoolId:'s',memberId:'m',error:{code}})
 if(name==='workhub_timetable_readiness')return env({available:true})
 if(name==='workhub_timetable_get'){if(w.failRead)throw Error('synthetic unavailable');return env(copy(w.snapshot))}
 if(name==='workhub_timetable_save_draft'){
  if(args.p_recover_only)return w.receipts[args.p_request_key]?env(w.receipts[args.p_request_key]):fail('NOT_FOUND')
  if(!w.receipts[args.p_request_key]){w.saved++;const id='saved-'+w.saved;w.receipts[args.p_request_key]={requestKey:args.p_request_key,draftId:id,version:1,basisRevision:args.p_input.basisRevision};w.snapshot.drafts.push({id,version:1,...copy(args.p_input)})}
  if(w.drop){w.drop=false;throw Error('synthetic response lost')};return env(w.receipts[args.p_request_key])
 }
 if(name==='workhub_timetable_operations_readiness')return env({available:true})
 if(name==='workhub_timetable_operations_get')return env({asOf:'2026-10-19T00:00:00.000Z',timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:true,canRequest:true,drafts:w.snapshot.drafts.map((x:any)=>({id:x.id,version:w.operationVersion,title:x.title})),lessons:[],requests:[],publications:[]})
 throw Error('unavailable synthetic '+name)
}}
function Harness(){const[revision,setRevision]=useState(0);w.refresh=()=>setRevision(x=>x+1);return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><TimetableWorkspace connection={connection} member={member as any} date="2026-10-19" revision={revision} onNavigationLockChange={value=>w.locked=value}/></PendingRequestsProvider></EditDraftsProvider>}
w.mount=()=>{w.root=createRoot(document.getElementById('root'));w.root.render(<Harness/>)};w.mount()
