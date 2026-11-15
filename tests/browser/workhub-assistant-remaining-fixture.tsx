import './reset-fixture-checkpoint'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'
import { allowedActions, nextCooperationStatus } from '../../apps/workhub/src/cooperation/contracts'
import { canonical, sha256 } from '../../apps/workhub/src/cooperation/protocol'
import { createDialogueTaskFixture } from './workhub-dialogue-task-fixture'

// 실제 연결 셸·어댑터·파서를 통과하는 합성 학교. RPC 수신·재전송·자료 판만 메모리에서 흉내 낸다.
const w=window as any, clone=structuredClone, date='2026-10-21', now='2026-10-21T03:00:00Z'
const teacher={...fixtureData.memberships[0],id:'member-01',userId:'user-01',schoolId:fixtureData.schools[0].id,name:'가상 교사 01',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31'}
const other={...teacher,id:'member-02',userId:'user-02',name:'가상 교사 02'},members=[teacher,other]
const context={schools:fixtureData.schools,memberships:members,basisDate:date,schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}
const env=(contract:string,data:any)=>({contract,schoolId:teacher.schoolId,memberId:teacher.id,data})
const coopEnv=()=>({ok:true,contractVersion:'cooperation.v1',schoolId:teacher.schoolId,memberId:teacher.id,ownerUserId:teacher.userId})
const oldSource={id:'source-old',schoolId:teacher.schoolId,authorMemberId:teacher.id,version:2,status:'retired',title:'지난 학년도 학사 지침',body:'과거 원문 2판의 확정 내용',kind:'school_guide',locator:'학사 지침 3쪽',effectiveFrom:'2025-03-01',effectiveThrough:'2026-02-28',updatedAt:now}
const sources:any[]=[oldSource], requests:any[]=[{id:'received-1',schoolId:teacher.schoolId,version:1,senderMemberId:other.id,recipientMemberId:teacher.id,senderName:other.name,recipientName:teacher.name,title:'받은 학년 협의 자료 요청',description:'수업 활동 자료를 확인해 주세요.',dueDate:'2026-10-28',status:'requested',createdAt:now,updatedAt:now,taskLink:null}]
const histories=new Map<string,any[]>([['received-1',[{id:'received-1:h1',action:'create',actorMemberId:other.id,comment:'',version:1,recordedAt:now}]]])
const receipts=new Map<string,{command:string;result:any}>(), qaTasks=createDialogueTaskFixture(teacher)
let denied=false, authChanged=()=>{}
w.remaining={calls:[],sources,requests,histories,cooperationWrites:0,knowledgeWrites:0,loseNext:'',deny(){denied=true;authChanged()}}
const services:any={getSession:async()=>({user:{id:teacher.userId}}),fetchMyProfile:async()=>({id:teacher.userId,name:teacher.name,email:'virtual@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:!denied}),onAuthStateChange(cb:any){authChanged=()=>cb({user:{id:teacher.userId}});return()=>{}},async signOut(){},async signInWithGoogle(){},async rpc(name:string,args:any){
  w.remaining.calls.push(clone({name,args}));const ok=(data:any)=>({data:clone(data),error:null}), failure=(message:string)=>({data:null,error:{message}})
  if(name==='workhub_context')return ok(context)
  if(name==='workhub_calendar_list')return ok([])
  if(['workhub_task_list','workhub_task_get','workhub_task_mutate'].includes(name))return qaTasks.rpc(name,args)
  if(name==='workhub_collection_list')return ok({contractVersion:1,schoolId:teacher.schoolId,memberId:teacher.id,error:{code:'NOT_READY'}})
  if(name==='workhub_cooperation_catalog')return ok({...coopEnv(),recipients:[{memberId:other.id,name:other.name,description:'가상 시험 교사'}],sourceTasks:[],nextTaskCursor:null})
  if(name==='workhub_cooperation_list')return ok({...coopEnv(),items:requests.filter(r=>(args.p_filter.box==='received'?r.recipientMemberId:r.senderMemberId)===teacher.id&&(args.p_filter.status==='all'||r.status===args.p_filter.status)&&(!args.p_filter.query||(r.title+r.description).includes(args.p_filter.query))),nextCursor:null})
  if(name==='workhub_cooperation_get'){const request=requests.find(r=>r.id===args.p_request_id);return request?ok({...coopEnv(),request,history:histories.get(request.id)}):ok({...coopEnv(),ok:false,code:'NOT_FOUND'})}
  if(name==='workhub_cooperation_mutate'){
    const c=args.p_command,key='cooperation:'+args.p_request_key,prior=receipts.get(key)
    const reject=async(code:string)=>ok({...coopEnv(),ok:false,code,requestKey:args.p_request_key,commandHash:await sha256(canonical(c)),outcome:'rejected'})
    if(prior)return prior.command===canonical(c)?ok({...prior.result,outcome:'replayed'}):reject('IDEMPOTENCY_CONFLICT')
    let row:any
    if(c.kind==='create'){
      if(c.recipientMemberId!==other.id)return reject('FORBIDDEN')
      row={id:'created-'+(requests.length+1),schoolId:teacher.schoolId,version:1,senderMemberId:teacher.id,recipientMemberId:other.id,senderName:teacher.name,recipientName:other.name,title:c.title,description:c.description,dueDate:c.dueDate,status:'requested',createdAt:now,updatedAt:now,taskLink:null};requests.push(row);histories.set(row.id,[{id:row.id+':h1',action:'create',actorMemberId:teacher.id,comment:'',version:1,recordedAt:now}])
    }else{
      row=requests.find(r=>r.id===c.requestId);if(!row||!allowedActions(row,teacher).includes(c.action))return reject('FORBIDDEN');if(c.expectedVersion!==row.version)return reject('CONFLICT')
      row.version++;row.status=nextCooperationStatus(c.action);histories.get(row.id)!.push({id:row.id+':h'+row.version,action:c.action,actorMemberId:teacher.id,comment:c.comment,version:row.version,recordedAt:now})
    }
    w.remaining.cooperationWrites++;const receipt={...coopEnv(),requestKey:args.p_request_key,commandKind:c.kind,entityId:row.id,version:row.version,outcome:'applied',appliedAt:now};receipts.set(key,{command:canonical(c),result:clone(receipt)})
    if(w.remaining.loseNext==='cooperation'){w.remaining.loseNext='';return failure('응답 유실')}return ok(receipt)
  }
  if(name==='workhub_knowledge_list')return ok(env('knowledge.v1',{items:sources.filter(s=>!args.p_query||(s.title+s.body).includes(args.p_query)),nextCursor:null,canManage:true}))
  if(name==='workhub_knowledge_get'){const source=sources.find(s=>s.id===args.p_source_id&&s.version===args.p_source_version);return source?ok(env('knowledge.v1',{source,isCurrent:source.id!==oldSource.id,canManage:true})):failure('NOT_FOUND')}
  if(name==='workhub_knowledge_history'){const source=sources.find(s=>s.id===args.p_source_id);return source?ok(env('knowledge.v1',{sourceId:source.id,authorMemberId:teacher.id,items:[{version:source.version,status:source.status,title:source.title,recordedAt:now,isCurrent:source.id!==oldSource.id}],nextBeforeVersion:null,canManage:true})):failure('NOT_FOUND')}
  if(name==='workhub_knowledge_mutate'){
    const c=args.p_command,key='knowledge:'+args.p_request_key,prior=receipts.get(key)
    if(prior)return prior.command===canonical(c)?ok(prior.result):failure('IDEMPOTENCY_CONFLICT')
    let row:any
    if(c.kind==='create'){row={...clone(c.input),id:'source-'+(sources.length+1),schoolId:teacher.schoolId,authorMemberId:teacher.id,version:1,status:'draft',updatedAt:now};sources.push(row)}
    else{row=sources.find(s=>s.id===c.id);if(!row||row.version!==c.expectedVersion)return failure('CONFLICT');row.version++;if(c.kind==='update')Object.assign(row,clone(c.input));else row.status=c.kind==='publish'?'published':'retired'}
    w.remaining.knowledgeWrites++;const receipt=env('knowledge.v1',{id:row.id,version:row.version,requestKey:args.p_request_key,recordedAt:now});receipts.set(key,{command:canonical(c),result:clone(receipt)})
    if(w.remaining.loseNext==='knowledge'){w.remaining.loseNext='';return failure('응답 유실')}return ok(receipt)
  }
  return failure('NOT_READY')
}}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={teacher.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)}/> )
