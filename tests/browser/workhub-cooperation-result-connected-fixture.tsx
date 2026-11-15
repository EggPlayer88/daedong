import './reset-fixture-checkpoint'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {createSupabaseConnection} from '../../apps/workhub/src/connection/supabase-connection'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'
import {nextCooperationStatus,allowedActions} from '../../apps/workhub/src/cooperation/contracts'

// 실제 연결 셸·협업 어댑터와 메모리 RPC. 운영 계정·서버·유료 AI는 호출하지 않는다.
const w=window as any, clone=structuredClone, date='2026-11-12', stamp=date+'T03:00:00.000Z'
const params=new URLSearchParams(location.search),sender=params.get('role')==='sender'
const self={...fixtureData.memberships[0],id:'member-one',userId:'user-one',name:'가상 관리자',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31'}
const other={...self,id:'member-two',userId:'user-two',name:'가상 교사'}
const context={schools:fixtureData.schools,memberships:[self,other],basisDate:date,schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}
const requests:any[]=[], histories=new Map<string,any[]>(), receipts=new Map<string,any>()
const envelope=()=>({ok:true,contractVersion:'cooperation.v1',schoolId:self.schoolId,memberId:self.id,ownerUserId:self.userId})
function add(id:string,title:string,sent=sender){
 const from=sent?self:other,to=sent?other:self
 const row={id,schoolId:self.schoolId,version:1,senderMemberId:from.id,recipientMemberId:to.id,senderName:from.name,recipientName:to.name,title,description:'합성 협업 본문',dueDate:'2026-11-20',status:'requested',createdAt:stamp,updatedAt:stamp,taskLink:null}
 requests.push(row);histories.set(id,[{id:id+'-h1',action:'create',actorMemberId:from.id,comment:'',recordedAt:stamp,version:1}]);return row
}
function advance(row:any,action:any,actor:string,comment='합성 처리'){
 row.version++;row.status=nextCooperationStatus(action);histories.get(row.id)!.push({id:row.id+'-h'+row.version,action,actorMemberId:actor,comment,recordedAt:stamp,version:row.version})
}
for(let i=1;i<=2;i++){
 const row=add('cooperation-'+i,'검토 요청 '+i)
 if(['accepted','completion_requested'].includes(params.get('state')??''))advance(row,'accept',row.recipientMemberId)
 if(params.get('state')==='completion_requested')advance(row,'request_completion',row.recipientMemberId)
}
let notify=()=>{},denied=false
w.qa={calls:[],writes:0,unknown:false,malformed:false,failGet:false,hold:false,release:()=>{},deny(){denied=true;notify()},setDate(value:string){context.basisDate=value;notify()},requests}
const services:any={getSession:async()=>({user:{id:self.userId}}),fetchMyProfile:async()=>({id:self.userId,name:self.name,email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:!denied}),onAuthStateChange(cb:any){notify=()=>cb({user:{id:self.userId}});return()=>{}},async signOut(){},async signInWithGoogle(){},
 async rpc(name:string,args:any){
  w.qa.calls.push(clone({name,args}));const ok=(data:any)=>({data:clone(data),error:null})
  if(name==='workhub_context')return ok(context)
  if(name==='workhub_calendar_list'||name==='workhub_task_list')return ok([])
  if(name==='workhub_cooperation_catalog')return ok({...envelope(),recipients:[{memberId:other.id,name:other.name,description:''}],sourceTasks:[],nextTaskCursor:null})
  if(name==='workhub_cooperation_list'){const f=args.p_filter;return ok({...envelope(),items:requests.filter(r=>(f.box==='received'?r.recipientMemberId:r.senderMemberId)===self.id&&(f.status==='all'||r.status===f.status)),nextCursor:null})}
  if(name==='workhub_cooperation_get'){if(w.qa.failGet)throw Error('합성 후속 조회 실패');return ok({...envelope(),request:requests.find(r=>r.id===args.p_request_id),history:histories.get(args.p_request_id)})}
  if(name==='workhub_cooperation_mutate'){
   const c=args.p_command,key=args.p_request_key
   if(receipts.has(key))return ok({...receipts.get(key),outcome:'replayed'})
   let row:any
   if(c.kind==='create'){row=add('created-'+(requests.length+1),c.title,true);Object.assign(row,{description:c.description,dueDate:c.dueDate})}
   else{row=requests.find(r=>r.id===c.requestId);if(!row||row.version!==c.expectedVersion||!allowedActions(row,self).includes(c.action))throw Error('합성 명령 거절');advance(row,c.action,self.id,c.comment)}
   const receipt={...envelope(),requestKey:key,commandKind:c.kind,entityId:row.id,version:row.version,outcome:'applied',appliedAt:stamp}
   receipts.set(key,receipt);w.qa.writes++
   if(w.qa.hold)await new Promise<void>(resolve=>{w.qa.release=resolve})
   if(w.qa.unknown){w.qa.unknown=false;throw Error('합성 응답 유실')}
   return ok(w.qa.malformed?{...receipt,version:999}:receipt)
  }
  return {data:null,error:{message:'NOT_READY'}}
 }
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={self.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)}/> )
