import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AssistantCalendarWorkspace } from '../../apps/workhub/src/assistant/AssistantCalendarWorkspace'
import { AssistantDeliveryFrame } from '../../apps/workhub/src/assistant/delivery-workspace'
import type { ResourceOpenRequest } from '../../apps/workhub/src/search/contracts'
import { createMemoryAdapter } from '../../apps/workhub/src/preview/memory-adapter'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'
import { EditDraftsProvider, createEditDrafts } from '../../apps/workhub/src/app/edit-drafts'
import { PendingRequestsProvider, createPendingRequests, recoveryScope } from '../../apps/workhub/src/app/pending-requests'
import { ContractError } from '../../apps/workhub/src/contracts'
import { canonical, sha256 } from '../../apps/workhub/src/cooperation/protocol'
import styles from '../../apps/workhub/src/style.css?inline'
const w = window as any, clone = structuredClone
const member = fixtureData.memberships.find(item => item.id === 'gaon-minjun')!, date = fixtureData.basisDate
const pending = createPendingRequests(), drafts = createEditDrafts(), memory = createMemoryAdapter(fixtureData,0)
const scope = recoveryScope(member), previews = new Map(), receipts = new Map()
let serial = 0
const qa = w.qa = {calls:[] as any[],saves:[] as any[],batchSaves:[] as any[],failAfter:false,batchFailAfter:false,listFail:false,locked:false,
  snapshot:()=>memory.exportState(),remount:()=>{},concurrent:()=>memory.simulateConcurrentEdit(member.id,'fixture-event-morning'),
  pending:()=>pending.get(scope,'calendarBatch') ?? pending.get(scope,'calendar'), forgetBatchDraft:()=>drafts.bind(scope,'calendar-batch').remove(),
  openDetail:(_key:string)=>{},
}
const envelope = () => ({ok:true,contractVersion:'calendar-batch.v1',schoolId:member.schoolId,memberId:member.id,ownerUserId:member.userId})
const connection:any = {
 info:()=>({...memory.info(),relationLabels}),
 getIdentity:async()=>({userId:member.userId,approved:true,profile:{id:member.userId,name:member.name,email:'calendar@example.invalid',role:'teacher',is_active:true,extra_permissions:[],department_id:null}}),
 async rpcVerified(name:string,args:any){
  qa.calls.push(clone({name,args}))
  if(name==='workhub_calendar_batch_prepare'){
   const input=args.p_input,rows=input.rows.map((row:any)=>({...row,incoming:clone(row.draft),state:'new',reason:'',eventId:null,expectedVersion:null,baseline:null,current:null}))
   const result={...envelope(),prepareId:'prepare-'+(++serial),previewHash:await sha256(canonical(rows)),sourceKey:input.sourceKey,fileHash:input.fileHash,expiresAt:'2030-01-01T00:00:00Z',rows}
   previews.set(result.prepareId,clone(result));return result
  }
  if(name==='workhub_calendar_batch_commit'){
   const key=args.p_request_key,command=args.p_command
   if(receipts.has(key))return {...clone(receipts.get(key)),outcome:'replayed'}
   const preview=previews.get(command.prepareId)
   const items=command.selections.map((selection:any)=>{const row=preview.rows.find((r:any)=>r.key===selection.key);qa.batchSaves.push(clone(row.incoming));return {key:selection.key,sourceId:selection.sourceId,eventId:'event-batch-'+(++serial),version:1}})
   const receipt={...envelope(),requestKey:key,prepareId:command.prepareId,previewHash:command.previewHash,outcome:'applied',appliedAt:'2026-10-19T01:00:00Z',items}
   receipts.set(key,clone(receipt));if(qa.batchFailAfter){qa.batchFailAfter=false;throw Error('합성 접수 뒤 응답 유실')}return receipt
  }
  throw Error('unexpected RPC '+name)
 },
}
const adapter={list:async(id:string)=>{if(qa.listFail)throw Error('합성 조회 실패');return memory.list(id)},get:(id:string,event:string)=>memory.get(id,event),save:async(id:string,command:any)=>{qa.saves.push(clone(command));const saved=await memory.save(id,command);if(qa.failAfter){qa.failAfter=false;throw new ContractError('SAVE_FAILED','합성 접수 뒤 응답 유실')}return saved}}
function App(){const [generation,setGeneration]=useState(0),[locked,setLocked]=useState(false),[talking,setTalking]=useState(false),[openRequest,setOpenRequest]=useState<ResourceOpenRequest>();const lock=useCallback((value:boolean)=>{qa.locked=value;setLocked(value)},[]);qa.remount=()=>setGeneration(value=>value+1);qa.openDetail=key=>setOpenRequest({key,id:'fixture-event-morning'});return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{styles}</style><div style={{padding:24,maxWidth:1100,margin:'auto'}}><header><h1>AI 비서 · 합성 일정 시험</h1></header><AssistantDeliveryFrame workspace={{scope,kind:'calendar',key:'calendar-workspace'}} talking={talking} locked={locked} onTalk={()=>setTalking(true)} onResume={()=>setTalking(false)} onClose={()=>{}} chat={<p>대화 입력 대기</p>}><AssistantCalendarWorkspace key={generation} connection={connection} adapter={adapter} member={member} members={fixtureData.memberships} schoolName="가온가상중학교" date={date} revision={0} relationOptions={relationLabels} openRequest={openRequest} onNavigationLockChange={lock} /></AssistantDeliveryFrame></div></PendingRequestsProvider></EditDraftsProvider>}
createRoot(document.getElementById('root')!).render(<App />)
