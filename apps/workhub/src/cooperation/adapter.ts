import type { SupabaseConnection } from '../connection/supabase-connection'
import { createVerifiedTransport, envelope, object, text, id, date, timestamp, integer, array, unique, exact, invalid, type Scope } from './protocol'
import { COOPERATION_CONTRACT as CONTRACT, COOPERATION_LIMITS as LIMITS, statusLabels, actionLabels, historyLabels, allowedActions, nextCooperationStatus, type CooperationHistory, type CooperationRequest, type CooperationCatalog, type CooperationDetail, type CooperationFilter, type CooperationCommand, type CooperationReceipt, type CooperationAdapter } from './contracts'
export function validateCooperationCommand(raw:unknown):CooperationCommand{const c=object(raw);if(c.kind==='create'){exact(c,['kind','recipientMemberId','title','description','dueDate','sourceTask']);id(c.recipientMemberId);text(c.title,LIMITS.title);text(c.description,LIMITS.body,true);if(c.dueDate!=='')date(c.dueDate);if(c.sourceTask!==null){const t=object(c.sourceTask);exact(t,['id','expectedVersion']);id(t.id);integer(t.expectedVersion)}}else if(c.kind==='transition'){exact(c,['kind','requestId','expectedVersion','action','comment']);id(c.requestId);integer(c.expectedVersion);if(!Object.hasOwn(actionLabels,String(c.action)))invalid();text(c.comment,LIMITS.reason,c.action==='accept'||c.action==='confirm_completion')}else invalid();return structuredClone(c) as CooperationCommand}
export function validateFilter(raw:CooperationFilter):CooperationFilter{const f=object(raw);exact(f,['box','status','query','cursor']);if(!['received','sent'].includes(String(f.box))||(f.status!=='all'&&!Object.hasOwn(statusLabels,String(f.status))))invalid();text(f.query,200,true);if(f.cursor!==null)text(f.cursor,1024);return structuredClone(f) as CooperationFilter}
export function requestValue(raw:unknown,s:Scope):CooperationRequest{const r=object(raw);if(r.schoolId!==s.schoolId||![r.senderMemberId,r.recipientMemberId].includes(s.memberId)||r.senderMemberId===r.recipientMemberId)invalid('현재 학교와 요청 당사자의 자료가 아닙니다.');id(r.id);integer(r.version);id(r.senderMemberId);id(r.recipientMemberId);text(r.senderName,120);text(r.recipientName,120);text(r.title,LIMITS.title);text(r.description,LIMITS.body,true);if(r.dueDate!=='')date(r.dueDate);timestamp(r.createdAt);timestamp(r.updatedAt);if(!Object.hasOwn(statusLabels,String(r.status)))invalid();if(r.taskLink!==null){const link=object(r.taskLink);exact(link,['taskId','ownerUserId']);id(link.taskId);if(link.ownerUserId!==s.ownerUserId)invalid('다른 교사의 개인 업무 연결은 열 수 없습니다.')}return structuredClone(r) as unknown as CooperationRequest}
export function catalogResponse(raw:unknown,s:Scope):CooperationCatalog{const v=envelope(raw,s,CONTRACT);const recipients=unique(array(v.recipients,LIMITS.catalog).map(raw=>{const r=object(raw);exact(r,['memberId','name','description']);id(r.memberId);if(r.memberId===s.memberId)invalid();text(r.name,120);text(r.description,160,true);return r}),r=>String(r.memberId));const sourceTasks=unique(array(v.sourceTasks,LIMITS.page).map(raw=>{const r=object(raw);exact(r,['id','title','version']);id(r.id);text(r.title,LIMITS.title);integer(r.version);return r}),r=>String(r.id));if(v.nextTaskCursor!==null)text(v.nextTaskCursor,1024);return {recipients,sourceTasks,nextTaskCursor:v.nextTaskCursor} as unknown as CooperationCatalog}
export function listResponse(raw:unknown,s:Scope,filter:CooperationFilter){const v=envelope(raw,s,CONTRACT);const items=unique(array(v.items,LIMITS.page).map(r=>requestValue(r,s)),r=>r.id);if(items.some(r=>(filter.box==='received'?r.recipientMemberId:r.senderMemberId)!==s.memberId||(filter.status!=='all'&&r.status!==filter.status)))invalid();if(v.nextCursor!==null)text(v.nextCursor,1024);return {items,nextCursor:v.nextCursor as string|null}}
export function detailResponse(raw:unknown,s:Scope,requestId:string):CooperationDetail{
  const v=envelope(raw,s,CONTRACT),request=requestValue(v.request,s)
  if(request.id!==requestId)invalid()
  const history=unique(array(v.history,1000).map(raw=>{
    const r=object(raw)
    id(r.id);id(r.actorMemberId)
    if(!Object.hasOwn(historyLabels,String(r.action)))invalid()
    text(r.comment,LIMITS.reason,true);timestamp(r.recordedAt);integer(r.version,1,request.version)
    return structuredClone(r) as unknown as CooperationHistory
  }),r=>r.id)
  if(history.length!==request.version||history[0]?.action!=='create'||history[0]?.actorMemberId!==request.senderMemberId)invalid()
  // P2 응답은 현재 수신자로 재생한다. P7은 인계별 담당자 구간을 보존한다.
  // 첫 인계 이전 담당자 ID는 DTO에 없으므로 그 구간의 수신자 행동이 있을 때만 식별한다.
  // 과거 표시 이름이나 명시되지 않은 인계 전 ID를 현재 담당자 정보로 메우지 않는다.
  let recipient:string|undefined=history.some(h=>h.action==='handover')?undefined:request.recipientMemberId
  let state:CooperationRequest['status']='requested'
  const recipientActions=new Set(['accept','decline','request_completion','retract_completion'])
  for(let i=0;i<history.length;i++){
    const h=history[i]
    if(h.version!==i+1)invalid()
    if(i===0)continue
    if(h.action==='create')return invalid()
    if(h.action==='handover'){
      // P7-02의 인계 이력 actor는 인계를 수락한 새 수신자이며 기존 상태는 유지된다.
      if(!['requested','accepted','completion_requested'].includes(state)||h.actorMemberId===request.senderMemberId||h.actorMemberId===recipient)invalid()
      recipient=h.actorMemberId
      continue
    }
    if(recipientActions.has(h.action)){
      if(h.actorMemberId===request.senderMemberId)invalid()
      recipient??=h.actorMemberId
    }
    if(!allowedActions({...request,status:state,recipientMemberId:recipient??''},{id:h.actorMemberId,schoolId:s.schoolId}).includes(h.action))invalid()
    state=nextCooperationStatus(h.action)
  }
  if(state!==request.status||recipient!==request.recipientMemberId)invalid()
  return {request,history}
}
export function receiptResponse(raw:unknown,s:Scope,c:CooperationCommand,key:string):CooperationReceipt{const v=envelope(raw,s,CONTRACT);if(v.requestKey!==key||v.commandKind!==c.kind||!['applied','replayed'].includes(String(v.outcome)))invalid();id(v.entityId);integer(v.version);timestamp(v.appliedAt);if(c.kind==='transition'&&(v.entityId!==c.requestId||v.version!==c.expectedVersion+1))invalid();if(c.kind==='create'&&v.version!==1)invalid();return structuredClone(v) as unknown as CooperationReceipt}
export function createCooperationAdapter(connection:SupabaseConnection,options:{timeoutMs?:number}={}):CooperationAdapter{const t=createVerifiedTransport(connection,CONTRACT,options.timeoutMs);return {catalog:(memberId,cursor=null)=>{if(cursor!==null)text(cursor,1024);return t.call(memberId,'workhub_cooperation_catalog',{p_task_cursor:cursor},catalogResponse)},list:(memberId,filter)=>{const f=validateFilter(filter);return t.call(memberId,'workhub_cooperation_list',{p_filter:f},(r,s)=>listResponse(r,s,f))},detail:(memberId,requestId)=>t.call(memberId,'workhub_cooperation_get',{p_request_id:id(requestId)},(r,s)=>detailResponse(r,s,requestId)),async mutate(memberId,command,key){const c=validateCooperationCommand(command);if(c.kind==='create'&&c.recipientMemberId===memberId)invalid('본인에게 협업 요청을 보낼 수 없습니다.');await t.remember(memberId,key,c);return t.call(memberId,'workhub_cooperation_mutate',{p_command:c,p_request_key:key},(r,s)=>receiptResponse(r,s,c,key),true)}}}
