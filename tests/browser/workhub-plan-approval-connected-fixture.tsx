import React from 'react'
import {createRoot} from 'react-dom/client'
import {ConnectedWorkspace} from '../../apps/workhub/src/app/ConnectedWorkspace'
import {createSupabaseConnection} from '../../apps/workhub/src/connection/supabase-connection'
import {fixtureData,relationLabels} from '../../apps/workhub/src/preview/fixtures'

// 실제 연결 셸·문서·인계 파서를 사용하며 계정과 모든 RPC 응답은 메모리 합성이다.
const w=window as any, date='2026-11-12', stamp=date+'T03:00:00.000Z', clone=structuredClone
const self={...fixtureData.memberships[0],id:'member-one',userId:'user-one',name:'가상 관리자',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31'}
const members=[self,{...self,id:'member-two',userId:'user-two',name:'가상 교사'}]
const context={schools:fixtureData.schools,memberships:members,basisDate:date,schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}
const envelope=(contract:string,data:any)=>({contract,schoolId:self.schoolId,memberId:self.id,data})
const documents:any[]=[], receipts=new Map<string,any>(), records:any[]=[1,2].map(n=>({id:'handover-'+n,kind:'handover',title:'공식 담당 인계 '+n,version:1,state:'awaiting_admin',canAccept:false,canCancel:false,summary:['선택한 공식 담당 1건'],requesterMemberId:'member-two',requiresAdminReview:true,canAdminReview:true,adminReview:null}))
let notify=()=>{}, denied=false
w.qa={calls:[],writes:0,unknown:'',failGet:false,deny(){denied=true;notify()},setDate(value:string){context.basisDate=value;notify()},documents,records}
const services:any={getSession:async()=>({user:{id:self.userId}}),fetchMyProfile:async()=>({id:self.userId,name:self.name,email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:!denied}),onAuthStateChange(cb:any){notify=()=>cb({user:{id:self.userId}});return()=>{}},async signOut(){},async signInWithGoogle(){},
 async rpc(name:string,args:any){
  w.qa.calls.push(clone({name,args})); const ok=(data:any)=>({data:clone(data),error:null}), doc=(data:any)=>ok(envelope('documents.v1',data)), transition=(data:any)=>ok(envelope('school-transitions.v1',data))
  if(name==='workhub_context')return ok(context)
  if(name==='workhub_calendar_list'||name==='workhub_task_list')return ok([])
  if(name==='workhub_document_list')return doc({items:documents.filter(d=>args.p_archived?d.status==='archived':d.status!=='archived'),nextCursor:null,canShare:true})
  if(name==='workhub_document_get'){if(w.qa.failGet)throw Error('합성 후속 조회 실패');return doc(documents.find(d=>d.id===args.p_document_id))}
  if(name==='workhub_document_history'){const d=documents.find(d=>d.id===args.p_document_id);return doc({documentId:d.id,versions:[{version:d.version,recordedAt:stamp,status:d.status}]})}
  if(name==='workhub_document_mutate'||name==='workhub_document_request_get'){
   const c=args.p_command,key=args.p_request_key;if(receipts.has(key))return doc(receipts.get(key))
   if(name==='workhub_document_request_get')throw Error('합성 접수 없음')
   let d:any
   if(c.kind==='create'){d={...clone(c.input),id:'document-'+(documents.length+1),schoolId:self.schoolId,ownerMemberId:self.id,version:1,latestVersion:1,status:'draft',updatedAt:stamp,canEdit:true,origin:c.origin};documents.push(d)}
   else{d=documents.find(d=>d.id===c.documentId);if(!d||c.expectedVersion!==d.version)throw Error('합성 원본 충돌');if(c.kind==='update')Object.assign(d,clone(c.input),{status:'draft'});else d.status=c.kind==='confirm'?'confirmed':'archived';d.version++;d.latestVersion=d.version}
   const receipt={documentId:d.id,version:d.version,requestKey:key,recordedAt:stamp};receipts.set(key,receipt);w.qa.writes++
   if(w.qa.unknown==='document'){w.qa.unknown='';throw Error('합성 응답 유실')}return doc(receipt)
  }
  if(name==='workhub_school_transition_list')return transition({canManageYear:true,dutyApproval:'admin_review_v1',years:[],recipients:[],resources:[],records,nextCursor:null})
  if(name==='workhub_school_transition_mutate'){
   const c=args.p_command,key=args.p_request_key;if(receipts.has(key))return transition(receipts.get(key))
   const r=records.find(r=>r.id===c.recordId);if(!r||r.version!==c.expectedVersion)throw Error('합성 판 충돌')
   r.version++;r.state=({admin_confirm:'pending',admin_reject:'rejected',accept:'accepted',reject:'rejected',cancel:'cancelled'} as any)[c.kind];r.canAdminReview=false;r.canAccept=r.state==='pending'
   if(c.kind==='admin_confirm'||c.kind==='admin_reject')r.adminReview={memberId:self.id,name:self.name,decision:c.kind==='admin_confirm'?'confirmed':'rejected',reason:c.reason,recordedAt:stamp}
   const receipt={requestKey:key,recordId:r.id,version:r.version,state:r.state,recordedAt:stamp};receipts.set(key,receipt);w.qa.writes++
   if(w.qa.unknown==='transition'){w.qa.unknown='';throw Error('합성 응답 유실')}return transition(receipt)
  }
  return {data:null,error:{message:'NOT_READY'}}
 }
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={self.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)}/> )
