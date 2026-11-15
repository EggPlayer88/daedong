import './reset-fixture-checkpoint'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'

// 실제 연결 셸·수합/메시지 파서를 사용한다. 서버·계정·자료는 메모리 합성이며 외부 호출은 없다.
const w = window as any, clone = structuredClone, date = '2026-11-12', now = date + 'T03:00:00.000Z'
const self = {...fixtureData.memberships[0], id:'member-one', userId:'user-one', name:'가상 교사 01', active:true, validFrom:'2026-01-01', validThrough:'2027-12-31'}
const members = [self, {...self,id:'member-two',userId:'user-two',name:'가상 교사 02'}]
const context = {schools:fixtureData.schools,memberships:members,basisDate:date,schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}
const person = (id:string) => ({memberId:id,schoolId:self.schoolId,name:members.find(m=>m.id===id)?.name ?? '가상 교사',department:'',version:1})
const me = (data:unknown) => ({contractVersion:1,schoolId:self.schoolId,memberId:self.id,userId:self.userId,ok:true,data})
const ce = (data:unknown) => ({contractVersion:1,schoolId:self.schoolId,memberId:self.id,data})
const receipts = new Map<string,any>(), threads = new Map<string,any>(), messages = new Map<string,any[]>(), requests:any[] = []
let authChanged = () => {}, denied = false
w.workflow = {calls:[],writes:0,unknown:'',requests,deny(){denied=true;authChanged()},setDate(value:string){context.basisDate=value;authChanged()}}
const services:any = {
  getSession:async()=>({user:{id:self.userId}}),
  fetchMyProfile:async()=>({id:self.userId,name:self.name,email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:!denied}),
  onAuthStateChange(cb:any){authChanged=()=>cb({user:{id:self.userId}});return()=>{}},async signOut(){},async signInWithGoogle(){},
  async rpc(name:string,args:any){
    w.workflow.calls.push(clone({name,args}));const ok=(data:any)=>({data:clone(data),error:null})
    if(name==='workhub_context') return ok(context)
    if(name==='workhub_calendar_list'||name==='workhub_task_list')return ok([])
    if(name==='workhub_messaging_readiness')return ok(me({available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:50},attachments:'not_configured'}))
    if(name==='workhub_message_recipients')return ok(me({items:members.filter(m=>m.id!==self.id).map(m=>person(m.id)),nextCursor:null}))
    if(name==='workhub_message_threads'||name==='workhub_inbox_list')return ok(me({items:[],nextCursor:null}))
    if(name==='workhub_message_get'){const thread=threads.get(args.p_thread_id);return ok(me({thread,items:messages.get(thread.id),nextCursor:null}))}
    if(name==='workhub_message_mutate'){
      const c=args.p_command,key=args.p_request_key
      if(receipts.has(key))return ok(me(receipts.get(key)))
      const ids=c.kind==='start'?c.recipients.map((p:any)=>p.memberId):c.recipientMemberIds
      const deliveries=c.kind==='start'?c.mode==='individual'?ids.map((id:string)=>({threadId:'thread-'+id,messageId:'msg-'+key+'-'+id,recipientMemberIds:[id],sequence:1})):[{threadId:'thread-new',messageId:'msg-'+key,recipientMemberIds:ids,sequence:1}]:c.kind==='reply'?[{threadId:c.threadId,messageId:'msg-'+key,recipientMemberIds:ids,sequence:2}]:[]
      for(const d of deliveries){threads.set(d.threadId,{id:d.threadId,schoolId:self.schoolId,kind:d.recipientMemberIds.length>1?'group':'direct',title:c.title||'',participants:[person(self.id),...d.recipientMemberIds.filter((id:string)=>id!==self.id).map(person)],version:1,latestSequence:d.sequence,readSequence:0,unreadCount:0,updatedAt:now,canSend:true});messages.set(d.threadId,[{id:d.messageId,schoolId:self.schoolId,threadId:d.threadId,senderMemberId:self.id,senderName:self.name,sequence:d.sequence,body:c.body,createdAt:now,attachments:[]}])}
      const receipt={requestKey:key,kind:c.kind,recordedAt:now,deliveries,threadId:['reply','read_thread'].includes(c.kind)?c.threadId:null,throughSequence:c.kind==='read_thread'?c.throughSequence:null,noticeId:null,version:null}
      receipts.set(key,receipt);w.workflow.writes++
      if(w.workflow.unknown==='message'){w.workflow.unknown='';throw Error('합성 응답 유실')}
      return ok(me(receipt))
    }
    if(name==='workhub_collection_basic_readiness')return ok(ce({available:true,reason:'ready',policy:{extensions:['hwpx'],maxFileBytes:1024,maxFiles:3}}))
    if(name==='workhub_collection_list')return ok(ce({items:requests,nextCursor:null}))
    if(name==='workhub_collection_get'){
      const request=requests.find(r=>r.id===args.p_request_id)
      const units=request.status==='published'?request.units.map((u:any,i:number)=>({id:'unit-'+i,requestId:request.id,schoolId:self.schoolId,label:u.label,responsibleMemberId:u.responsibleMemberId,members:members.filter(m=>[u.responsibleMemberId,...u.contributorMemberIds].includes(m.id)).map(({id,userId,name})=>({id,userId,name})),version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''})):[]
      return ok(ce({request,units,submissions:[],reviews:[],supplements:[],withdrawals:[]}))
    }
    if(name==='workhub_collection_mutate'){
      const c=args.p_command,key=args.p_request_key
      if(receipts.has(key))return ok(ce(receipts.get(key)))
      let request:any
      if(c.kind==='create'){request={...clone(c.input),id:'collection-'+(requests.length+1),schoolId:self.schoolId,managerMemberId:self.id,status:'draft',version:1,publishedAt:null};requests.push(request)}
      else {request=requests.find(r=>r.id===c.requestId);if(!request||request.version!==c.expectedVersion)return ok({contractVersion:1,schoolId:self.schoolId,memberId:self.id,error:{code:'CONFLICT'}});if(c.kind==='publish'){request.status='published';request.publishedAt=now}else if(c.kind==='update')Object.assign(request,clone(c.input));else throw Error('미지원 명령');request.version++}
      const receipt={requestKey:key,requestId:request.id,resourceId:request.id,resourceVersion:request.version,recordedAt:now}
      receipts.set(key,receipt);w.workflow.writes++
      if(w.workflow.unknown==='collection'){w.workflow.unknown='';throw Error('합성 응답 유실')}
      return ok(ce(receipt))
    }
    return {data:null,error:{message:'NOT_READY'}}
  }
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={self.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)}/> )
