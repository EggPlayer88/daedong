import type { SupabaseConnection } from '../connection/supabase-connection'
import { createVerifiedTransport, ModuleError, envelope, object, text, id, date, timestamp, integer, array, unique, exact, invalid, type Scope } from './protocol'
import { COOPERATION_CONTRACT as CONTRACT, COOPERATION_LIMITS as LIMITS, statusLabels, actionLabels, historyLabels, allowedActions, nextCooperationStatus, type CooperationHistory, type CooperationRequest, type CooperationCatalog, type CooperationDetail, type CooperationFilter, type CooperationCommand, type CooperationReceipt, type CooperationAdapter } from './contracts'
export function validateCooperationCommand(raw:unknown):CooperationCommand{const c=object(raw);if(c.kind==='create'){exact(c,['kind','recipientMemberId','title','description','dueDate','sourceTask']);id(c.recipientMemberId);text(c.title,LIMITS.title);text(c.description,LIMITS.body,true);if(c.dueDate!=='')date(c.dueDate);if(c.sourceTask!==null){const t=object(c.sourceTask);exact(t,['id','expectedVersion']);id(t.id);integer(t.expectedVersion)}}else if(c.kind==='transition'){exact(c,['kind','requestId','expectedVersion','action','comment']);id(c.requestId);integer(c.expectedVersion);if(!Object.hasOwn(actionLabels,String(c.action)))invalid();text(c.comment,LIMITS.reason,c.action==='accept'||c.action==='confirm_completion')}else invalid();return structuredClone(c) as CooperationCommand}
export function validateFilter(raw:CooperationFilter):CooperationFilter{const f=object(raw);exact(f,['box','status','query','cursor']);if(!['received','sent'].includes(String(f.box))||(f.status!=='all'&&!Object.hasOwn(statusLabels,String(f.status))))invalid();text(f.query,200,true);if(f.cursor!==null)text(f.cursor,1024);return structuredClone(f) as CooperationFilter}
export function requestValue(raw:unknown,s:Scope):CooperationRequest{const r=object(raw);if(r.schoolId!==s.schoolId||![r.senderMemberId,r.recipientMemberId].includes(s.memberId)||r.senderMemberId===r.recipientMemberId)invalid('현재 학교와 요청 당사자의 자료가 아닙니다.');id(r.id);integer(r.version);id(r.senderMemberId);id(r.recipientMemberId);text(r.senderName,120);text(r.recipientName,120);text(r.title,LIMITS.title);text(r.description,LIMITS.body,true);if(r.dueDate!=='')date(r.dueDate);timestamp(r.createdAt);timestamp(r.updatedAt);if(!Object.hasOwn(statusLabels,String(r.status)))invalid();if(r.taskLink!==null){const link=object(r.taskLink);exact(link,['taskId','ownerUserId']);id(link.taskId);if(link.ownerUserId!==s.ownerUserId)invalid('다른 교사의 개인 업무 연결은 열 수 없습니다.')}return structuredClone(r) as unknown as CooperationRequest}
export function catalogResponse(raw:unknown,s:Scope):CooperationCatalog{const v=envelope(raw,s,CONTRACT);const recipients=unique(array(v.recipients,LIMITS.catalog).map(raw=>{const r=object(raw);exact(r,['memberId','name','description']);id(r.memberId);if(r.memberId===s.memberId)invalid();text(r.name,120);text(r.description,160,true);return r}),r=>String(r.memberId));const sourceTasks=unique(array(v.sourceTasks,LIMITS.page).map(raw=>{const r=object(raw);exact(r,['id','title','version']);id(r.id);text(r.title,LIMITS.title);integer(r.version);return r}),r=>String(r.id));if(v.nextTaskCursor!==null)text(v.nextTaskCursor,1024);return {recipients,sourceTasks,nextTaskCursor:v.nextTaskCursor} as unknown as CooperationCatalog}
export function listResponse(raw:unknown,s:Scope,filter:CooperationFilter){const v=envelope(raw,s,CONTRACT);const items=unique(array(v.items,LIMITS.page).map(r=>requestValue(r,s)),r=>r.id);if(items.some(r=>(filter.box==='received'?r.recipientMemberId:r.senderMemberId)!==s.memberId||(filter.status!=='all'&&r.status!==filter.status)))invalid();if(v.nextCursor!==null)text(v.nextCursor,1024);return {items,nextCursor:v.nextCursor as string|null}}
export function detailResponse(raw:unknown,s:Scope,requestId:string):CooperationDetail{
  const v=envelope(raw,s,CONTRACT),request=requestValue(v.request,s)
  if(request.id!==requestId)invalid()
  const rows=array(v.history,1000).map(object)
  const recipientFields=['actorName','recipientMemberId','previousRecipientMemberId'] as const
  // 새 필드가 하나라도 있으면 모든 행을 새 계약으로 검사한다. 일부만 있는 혼합 응답은 구계약으로 우회하지 않는다.
  const hasRecipientHistory=rows.some(row=>recipientFields.some(key=>Object.hasOwn(row,key)))
  const history=unique(rows.map(r=>{
    exact(r,['id','action','actorMemberId','comment','recordedAt','version',...(hasRecipientHistory?recipientFields:[])])
    id(r.id);id(r.actorMemberId)
    if(!Object.hasOwn(historyLabels,String(r.action)))invalid()
    text(r.comment,LIMITS.reason,true);timestamp(r.recordedAt);integer(r.version,1,request.version)
    if(hasRecipientHistory){
      text(r.actorName,120);id(r.recipientMemberId)
      if(r.action==='handover')id(r.previousRecipientMemberId)
      else if(r.previousRecipientMemberId!==null)invalid()
    }else if(r.action==='handover')invalid('인계 전후 담당자 정보를 확인하지 못했습니다. 최신 협업 이력 조회 기능을 확인해 주세요.')
    return structuredClone(r) as unknown as CooperationHistory
  }),r=>r.id)
  if(history.length!==request.version||history[0]?.action!=='create'||history[0]?.actorMemberId!==request.senderMemberId)invalid()
  // 구형 P2는 인계가 없는 경우만 호환한다. 인계 응답에서 새 필드를 모두 없애도 약한 추론 검사로 내려가지 않는다.
  let recipient=hasRecipientHistory?history[0].recipientMemberId!:request.recipientMemberId
  if(recipient===request.senderMemberId)invalid()
  let state:CooperationRequest['status']='requested'
  for(let i=0;i<history.length;i++){
    const h=history[i]
    if(h.version!==i+1)invalid()
    if(i===0)continue
    if(h.action==='create')return invalid()
    if(h.action==='handover'){
      // P7 인계는 새 수신자가 수락한 행동이다. 이전 수신자와 행 이후 수신자를 이어서 확인하고 상태는 유지한다.
      if(!hasRecipientHistory||!['requested','accepted','completion_requested'].includes(state)||h.previousRecipientMemberId!==recipient||h.actorMemberId!==h.recipientMemberId||h.actorMemberId===recipient||h.actorMemberId===request.senderMemberId)invalid()
      recipient=h.recipientMemberId!
      continue
    }
    if(hasRecipientHistory&&h.recipientMemberId!==recipient)invalid()
    if(!allowedActions({...request,status:state,recipientMemberId:recipient},{id:h.actorMemberId,schoolId:s.schoolId}).includes(h.action))invalid()
    state=nextCooperationStatus(h.action)
  }
  if(state!==request.status||recipient!==request.recipientMemberId)invalid()
  return {request,history}
}
export function receiptResponse(raw:unknown,s:Scope,c:CooperationCommand,key:string):CooperationReceipt{const v=envelope(raw,s,CONTRACT);if(v.requestKey!==key||v.commandKind!==c.kind||!['applied','replayed'].includes(String(v.outcome)))invalid();id(v.entityId);integer(v.version);timestamp(v.appliedAt);if(c.kind==='transition'&&(v.entityId!==c.requestId||v.version!==c.expectedVersion+1))invalid();if(c.kind==='create'&&v.version!==1)invalid();return structuredClone(v) as unknown as CooperationReceipt}
export function createCooperationAdapter(connection:SupabaseConnection,options:{timeoutMs?:number}={}):CooperationAdapter{const t=createVerifiedTransport(connection,CONTRACT,options.timeoutMs);return {catalog:(memberId,cursor=null)=>{if(cursor!==null)text(cursor,1024);return t.call(memberId,'workhub_cooperation_catalog',{p_task_cursor:cursor},catalogResponse)},list:(memberId,filter)=>{const f=validateFilter(filter);return t.call(memberId,'workhub_cooperation_list',{p_filter:f},(r,s)=>listResponse(r,s,f))},detail:(memberId,requestId)=>t.call(memberId,'workhub_cooperation_get',{p_request_id:id(requestId)},(r,s)=>{try{return detailResponse(r,s,requestId)}catch(error){if(error instanceof ModuleError&&error.code==='INVALID_INPUT')throw new ModuleError('QUERY_FAILED','서버의 협업 처리 이력을 확인하지 못했습니다. 자료를 다시 불러와 주세요.');throw error}}),async mutate(memberId,command,key){const c=validateCooperationCommand(command);if(c.kind==='create'&&c.recipientMemberId===memberId)invalid('본인에게 협업 요청을 보낼 수 없습니다.');await t.remember(memberId,key,c);return t.call(memberId,'workhub_cooperation_mutate',{p_command:c,p_request_key:key},(r,s)=>receiptResponse(r,s,c,key),true)}}}
