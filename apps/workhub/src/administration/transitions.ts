import schoolAdminLimits from '../setup/assets/school-admin.json'
import {academicYearStartMatches} from '../setup/academic-year'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {createScopedRpc,exact,object,validateLocalInput,identifier,isoDate,text,version,ServiceError} from '../services/scoped-rpc'
export type HandoverResource={kind:'duty'|'cooperation'|'collection';id:string;version:number;label:string}
export type TransitionPlan=
 | {kind:'handover';recipientMemberId:string;recipientVersion:number;resources:HandoverResource[];note:string}
 | {kind:'new_year';sourceYearId:string;targetYear:number;firstDay:string;lastDay:string;term1First:string;term1Last:string;term2First:string;term2Last:string;copyStructure:boolean}
export interface TransitionAdminReview{memberId:string;name:string;decision:'confirmed'|'rejected';reason:string;recordedAt:string}
export interface TransitionRecord{id:string;kind:TransitionPlan['kind'];title:string;version:number;state:'awaiting_admin'|'pending'|'accepted'|'rejected'|'cancelled'|'completed';canAccept:boolean;canCancel:boolean;summary:string[];requesterMemberId:string|null;requiresAdminReview:boolean|null;canAdminReview:boolean;adminReview:TransitionAdminReview|null}
export interface TransitionCatalog{canManageYear:boolean;dutyApproval:'admin_review_v1'|null;years:{id:string;label:string;year:number}[];recipients:{memberId:string;name:string;version:number}[];resources:HandoverResource[];records:TransitionRecord[];nextCursor:string|null}
export interface TransitionPreview{fingerprint:string;expiresAt:string;summary:string[];excluded:string[];affectedCount:number}
export type TransitionCommand={kind:'apply';plan:TransitionPlan;fingerprint:string}|{kind:'accept'|'reject'|'cancel'|'admin_confirm'|'admin_reject';recordId:string;expectedVersion:number;reason:string}
const fail=():never=>{throw new ServiceError('INVALID_RESPONSE')}
function timestamp(v:unknown):string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)||!Number.isFinite(Date.parse(v)))return fail();isoDate(v.slice(0,10));return v}
function lines(v:unknown,max=500):string[]{if(!Array.isArray(v)||v.length>max)fail();return(v as unknown[]).map(x=>text(x,1000,true))}
function resource(v:unknown):HandoverResource{exact(v,['kind','id','version','label']);if(!['duty','cooperation','collection'].includes(String(v.kind)))fail();return{kind:v.kind as HandoverResource['kind'],id:identifier(v.id),version:version(v.version),label:text(v.label,200,true)}}
export const needsAdminReview=(plan:TransitionPlan)=>plan.kind==='handover'&&plan.resources.some(item=>item.kind==='duty')
export function transitionPlan(plan:TransitionPlan,options:{recovering?:boolean}={}):TransitionPlan{
 return validateLocalInput(()=>{
 if(!object(plan))throw new ServiceError('INVALID_INPUT')
 if(plan.kind==='handover'){
  exact(plan,['kind','recipientMemberId','recipientVersion','resources','note']);identifier(plan.recipientMemberId);version(plan.recipientVersion);text(plan.note,2000,true)
  if(!Array.isArray(plan.resources)||!plan.resources.length||plan.resources.length>200)throw new ServiceError('INVALID_INPUT')
  const ids=new Set<string>();for(const item of plan.resources){resource(item);const key=item.kind+':'+item.id;if(ids.has(key))throw new ServiceError('INVALID_INPUT');ids.add(key)}
 }else if(plan.kind==='new_year'){
  exact(plan,['kind','sourceYearId','targetYear','firstDay','lastDay','term1First','term1Last','term2First','term2Last','copyStructure']);identifier(plan.sourceYearId)
  if(!Number.isInteger(plan.targetYear)||plan.targetYear<schoolAdminLimits.schoolYearBounds.min||plan.targetYear>schoolAdminLimits.schoolYearBounds.max||typeof plan.copyStructure!=='boolean')throw new ServiceError('INVALID_INPUT')
  const dates=[plan.firstDay,plan.term1First,plan.term1Last,plan.term2First,plan.term2Last,plan.lastDay];dates.forEach(isoDate)
  if(dates.some((d,i)=>i>0&&d<dates[i-1])||plan.term1Last>=plan.term2First||plan.firstDay===plan.lastDay)throw new ServiceError('INVALID_INPUT')
  // 이미 보낸 요청의 복구는 기존 접수 결과를 읽는다. 새 학년도 입력을 보정하지 않는다.
  if(!options.recovering&&!academicYearStartMatches(plan.targetYear,plan.firstDay))throw new ServiceError('INVALID_INPUT')
 }else throw new ServiceError('INVALID_INPUT')
 return structuredClone(plan)
 })
}
const recordKeys=['id','kind','title','version','state','canAccept','canCancel','summary'] as const
const approvalKeys=['requesterMemberId','requiresAdminReview','canAdminReview','adminReview'] as const
function record(raw:unknown,modern:boolean,canManageYear:boolean,viewerMemberId?:string):TransitionRecord{
 exact(raw,modern?[...recordKeys,...approvalKeys]:recordKeys)
 if(!['handover','new_year'].includes(String(raw.kind))||!['pending','accepted','rejected','cancelled','completed',...(modern?['awaiting_admin']:[])].includes(String(raw.state))||typeof raw.canAccept!=='boolean'||typeof raw.canCancel!=='boolean')fail()
 const result:TransitionRecord={id:identifier(raw.id),kind:raw.kind as TransitionRecord['kind'],title:text(raw.title,200,true),version:version(raw.version),state:raw.state as TransitionRecord['state'],canAccept:raw.canAccept as boolean,canCancel:raw.canCancel as boolean,summary:lines(raw.summary),requesterMemberId:null,requiresAdminReview:null,canAdminReview:false,adminReview:null}
 if(result.canAccept&&result.state!=='pending'||result.canCancel&&!['pending','awaiting_admin'].includes(result.state))fail()
 if(!modern)return result
 if(typeof raw.requiresAdminReview!=='boolean'||typeof raw.canAdminReview!=='boolean')fail()
 result.requesterMemberId=identifier(raw.requesterMemberId);result.requiresAdminReview=raw.requiresAdminReview as boolean;result.canAdminReview=raw.canAdminReview as boolean
 if(raw.adminReview!==null){
  exact(raw.adminReview,['memberId','name','decision','reason','recordedAt'])
  const r=raw.adminReview
  if(!['confirmed','rejected'].includes(String(r.decision)))fail()
  result.adminReview={memberId:identifier(r.memberId),name:text(r.name,100,true),decision:r.decision as TransitionAdminReview['decision'],reason:text(r.reason,1000,true),recordedAt:timestamp(r.recordedAt)}
  if(result.adminReview?.memberId===result.requesterMemberId)fail()
 }
 if(result.kind==='handover'&&result.state==='completed')fail()
 if(result.kind==='new_year'&&(result.state!=='completed'||result.requiresAdminReview||result.adminReview||result.canAdminReview||result.canAccept||result.canCancel))fail()
 if(result.canAdminReview&&(result.state!=='awaiting_admin'||!result.requiresAdminReview||!canManageYear||result.requesterMemberId===viewerMemberId))fail()
 if(!result.requiresAdminReview&&(result.adminReview||result.canAdminReview||result.state==='awaiting_admin'))fail()
 if(result.requiresAdminReview){
  if(result.state==='completed')fail()
  if(result.state==='awaiting_admin'&&(result.version!==1||result.adminReview||result.canAccept))fail()
  if(['pending','accepted'].includes(result.state)&&result.adminReview?.decision!=='confirmed')fail()
  if(result.state==='pending'&&result.version!==2)fail()
  if(result.adminReview?.decision==='rejected'&&(result.state!=='rejected'||result.version!==2))fail()
  if(result.adminReview&&result.version<2)fail()
  if(result.state==='accepted'&&result.version!==3)fail()
  if(result.state==='rejected'&&(!result.adminReview||result.version!==(result.adminReview.decision==='rejected'?2:3)))fail()
  if(result.state==='cancelled'&&result.version!==(result.adminReview?3:2))fail()
 }
 return result
}
export function transitionCatalog(raw:unknown,viewerMemberId?:string):TransitionCatalog{
 const modern=object(raw)&&Object.hasOwn(raw,'dutyApproval')
 exact(raw,['canManageYear','years','recipients','resources','records','nextCursor',...(modern?['dutyApproval']:[])])
 if(typeof raw.canManageYear!=='boolean'||modern&&raw.dutyApproval!==null&&raw.dutyApproval!=='admin_review_v1'||!Array.isArray(raw.years)||!Array.isArray(raw.recipients)||!Array.isArray(raw.resources)||!Array.isArray(raw.records)||raw.years.length>100||raw.recipients.length>500||raw.resources.length>200||raw.records.length>50)fail()
 const years=(raw.years as unknown[]).map(v=>{exact(v,['id','label','year']);if(!Number.isInteger(v.year)||(v.year as number)<schoolAdminLimits.schoolYearBounds.min||(v.year as number)>schoolAdminLimits.schoolYearBounds.max)fail();return{id:identifier(v.id),label:text(v.label,100,true),year:v.year as number}})
 const recipients=(raw.recipients as unknown[]).map(v=>{exact(v,['memberId','name','version']);return{memberId:identifier(v.memberId),name:text(v.name,100,true),version:version(v.version)}})
 const resources=(raw.resources as unknown[]).map(resource)
 const records=(raw.records as unknown[]).map(v=>record(v,modern,raw.canManageYear as boolean,viewerMemberId))
 for(const values of [years.map(x=>x.id),recipients.map(x=>x.memberId),resources.map(x=>x.kind+':'+x.id),records.map(x=>x.id)])if(new Set(values).size!==values.length)fail()
 return{canManageYear:raw.canManageYear as boolean,dutyApproval:modern?raw.dutyApproval as TransitionCatalog['dutyApproval']:null,years,recipients,resources,records,nextCursor:raw.nextCursor===null?null:text(raw.nextCursor,1000,true)}
}
export function transitionCommand(raw:unknown,options:{recovering?:boolean}={}):TransitionCommand{
 return validateLocalInput(()=>{
 if(!object(raw))throw new ServiceError('INVALID_INPUT')
 const command=raw as TransitionCommand
 if(command.kind==='apply'){exact(command,['kind','plan','fingerprint']);transitionPlan(command.plan,options);if(!/^[a-f0-9]{64}$/.test(command.fingerprint))throw new ServiceError('INVALID_INPUT')}else{exact(command,['kind','recordId','expectedVersion','reason']);if(!['accept','reject','cancel','admin_confirm','admin_reject'].includes(command.kind))throw new ServiceError('INVALID_INPUT');identifier(command.recordId);version(command.expectedVersion);text(command.reason,1000,true)}
 return structuredClone(command)
 })
}
export function transitionActionAllowed(catalog:TransitionCatalog,command:Extract<TransitionCommand,{recordId:string}>):boolean{
 const target=catalog.records.find(item=>item.id===command.recordId&&item.version===command.expectedVersion)
 if(!target)return false
 if(command.kind==='cancel')return target.canCancel
 if(command.kind==='reject')return target.canAccept
 if(command.kind==='accept')return target.canAccept&&(target.requiresAdminReview!==true||catalog.dutyApproval==='admin_review_v1')
 return catalog.dutyApproval==='admin_review_v1'&&target.canAdminReview
}
export function createTransitionService(connection:SupabaseConnection){
 const rpc=createScopedRpc(connection,'school-transitions.v1')
 const list=(memberId:string,cursor:string|null=null)=>{if(cursor!==null)text(cursor,1000,true);return rpc.call(memberId,'workhub_school_transition_list',{p_cursor:cursor},(raw,member)=>transitionCatalog(raw,member.id))}
 async function requireApprovalContract(memberId:string){
  const catalog=await list(memberId)
  if(catalog.dutyApproval!=='admin_review_v1')throw new ServiceError('NOT_READY')
  return catalog
 }
 async function recordContext(memberId:string,recordId:string){
  let cursor:string|null=null
  const cursors=new Set<string>()
  for(let page=0;page<schoolAdminLimits.transitionLookupPages;page++){
   const catalog=await list(memberId,cursor),target=catalog.records.find(item=>item.id===recordId)
   if(target||catalog.nextCursor===null)return{catalog,target}
   if(cursors.has(catalog.nextCursor))throw new ServiceError('INVALID_RESPONSE')
   cursors.add(catalog.nextCursor);cursor=catalog.nextCursor
  }
  throw new ServiceError('QUERY_FAILED')
 }
 async function mutate(memberId:string,input:TransitionCommand,key:string,recovering=false){
  const command=transitionCommand(input,{recovering})
  // 복구는 원키·원문으로 서버의 접수 원장을 먼저 확인한다. 현재 목록/모듈 상태로 재생을 막지 않는다.
  if(!recovering){
   if(command.kind==='apply'&&needsAdminReview(command.plan))await requireApprovalContract(memberId)
   if(command.kind==='accept'||command.kind==='admin_confirm'||command.kind==='admin_reject'){
    const{catalog,target}=await recordContext(memberId,command.recordId)
    if(command.kind==='accept'){
     // 구 목록은 종류를 추측하지 않는다. 공식 담당으로 확인된 기록만 추가 준비 조건을 적용한다.
     if(target?.requiresAdminReview===true&&catalog.dutyApproval!=='admin_review_v1')throw new ServiceError('NOT_READY')
    }else{
     if(catalog.dutyApproval!=='admin_review_v1')throw new ServiceError('NOT_READY')
     if(!catalog.canManageYear||target?.requesterMemberId===memberId)throw new ServiceError('FORBIDDEN')
    }
   }
  }
  return rpc.call(memberId,'workhub_school_transition_mutate',{p_command:command,p_request_key:key},raw=>{
   exact(raw,['requestKey','recordId','version','state','recordedAt'])
   if(raw.requestKey!==key||!['awaiting_admin','pending','accepted','rejected','cancelled','completed'].includes(String(raw.state))||typeof raw.recordedAt!=='string'||!Number.isFinite(Date.parse(raw.recordedAt)))fail()
   identifier(raw.recordId);version(raw.version)
   if(command.kind!=='apply'&&(raw.recordId!==command.recordId||raw.version!==command.expectedVersion+1))fail()
   // 이전 SQL의 접수증은 복구에서만 읽고, 현재 승인 완료로 해석하지 않는다.
   const legacyDutyReceipt=recovering&&command.kind==='apply'&&needsAdminReview(command.plan)&&raw.state==='pending'
   if(command.kind==='apply'&&(raw.version!==1||!legacyDutyReceipt&&raw.state!==(command.plan.kind==='new_year'?'completed':needsAdminReview(command.plan)?'awaiting_admin':'pending')))fail()
   if(command.kind!=='apply'&&raw.state!==({accept:'accepted',reject:'rejected',cancel:'cancelled',admin_confirm:'pending',admin_reject:'rejected'} as const)[command.kind])fail()
   return{requestKey:key,recordId:raw.recordId as string,state:raw.state as string,legacyDutyReceipt}
  },true)
 }
 return{
  list,
  async preview(memberId:string,input:TransitionPlan){const plan=transitionPlan(input);if(needsAdminReview(plan))await requireApprovalContract(memberId);return rpc.call(memberId,'workhub_school_transition_preview',{p_plan:plan},raw=>{exact(raw,['fingerprint','expiresAt','summary','excluded','affectedCount']);if(typeof raw.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(raw.fingerprint)||typeof raw.expiresAt!=='string'||!Number.isFinite(Date.parse(raw.expiresAt))||!Number.isSafeInteger(raw.affectedCount)||(raw.affectedCount as number)<0)fail();return{fingerprint:raw.fingerprint as string,expiresAt:raw.expiresAt as string,summary:lines(raw.summary),excluded:lines(raw.excluded),affectedCount:raw.affectedCount as number}})},
  mutate:(memberId:string,input:TransitionCommand,key:string)=>mutate(memberId,input,key),
  // 접수증이 없으면 서버의 현재 권한·상태 검사 후 최초 실행될 수 있다. 읽기 전용 요청은 아니다.
  recover:(memberId:string,input:TransitionCommand,key:string)=>mutate(memberId,input,key,true)
 }
}
export type TransitionService=ReturnType<typeof createTransitionService>
