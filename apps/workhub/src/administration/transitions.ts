import schoolAdminLimits from '../setup/assets/school-admin.json'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {createScopedRpc,exact,object,validateLocalInput,identifier,isoDate,text,version,ServiceError} from '../services/scoped-rpc'
export type HandoverResource={kind:'duty'|'cooperation'|'collection';id:string;version:number;label:string}
export type TransitionPlan=
 | {kind:'handover';recipientMemberId:string;recipientVersion:number;resources:HandoverResource[];note:string}
 | {kind:'new_year';sourceYearId:string;targetYear:number;firstDay:string;lastDay:string;term1First:string;term1Last:string;term2First:string;term2Last:string;copyStructure:boolean}
export interface TransitionRecord{id:string;kind:TransitionPlan['kind'];title:string;version:number;state:'pending'|'accepted'|'rejected'|'cancelled'|'completed';canAccept:boolean;canCancel:boolean;summary:string[]}
export interface TransitionCatalog{canManageYear:boolean;years:{id:string;label:string;year:number}[];recipients:{memberId:string;name:string;version:number}[];resources:HandoverResource[];records:TransitionRecord[];nextCursor:string|null}
export interface TransitionPreview{fingerprint:string;expiresAt:string;summary:string[];excluded:string[];affectedCount:number}
export type TransitionCommand={kind:'apply';plan:TransitionPlan;fingerprint:string}|{kind:'accept'|'reject'|'cancel';recordId:string;expectedVersion:number;reason:string}
const fail=():never=>{throw new ServiceError('INVALID_RESPONSE')}
function lines(v:unknown,max=500):string[]{if(!Array.isArray(v)||v.length>max)fail();return(v as unknown[]).map(x=>text(x,1000,true))}
function resource(v:unknown):HandoverResource{exact(v,['kind','id','version','label']);if(!['duty','cooperation','collection'].includes(String(v.kind)))fail();return{kind:v.kind as HandoverResource['kind'],id:identifier(v.id),version:version(v.version),label:text(v.label,200,true)}}
export function transitionPlan(plan:TransitionPlan):TransitionPlan{
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
 }else throw new ServiceError('INVALID_INPUT')
 return structuredClone(plan)
 })
}
export function transitionCatalog(raw:unknown):TransitionCatalog{
 exact(raw,['canManageYear','years','recipients','resources','records','nextCursor'])
 if(typeof raw.canManageYear!=='boolean'||!Array.isArray(raw.years)||!Array.isArray(raw.recipients)||!Array.isArray(raw.resources)||!Array.isArray(raw.records)||raw.years.length>100||raw.recipients.length>500||raw.resources.length>200||raw.records.length>50)fail()
 const years=(raw.years as unknown[]).map(v=>{exact(v,['id','label','year']);if(!Number.isInteger(v.year)||(v.year as number)<schoolAdminLimits.schoolYearBounds.min||(v.year as number)>schoolAdminLimits.schoolYearBounds.max)fail();return{id:identifier(v.id),label:text(v.label,100,true),year:v.year as number}})
 const recipients=(raw.recipients as unknown[]).map(v=>{exact(v,['memberId','name','version']);return{memberId:identifier(v.memberId),name:text(v.name,100,true),version:version(v.version)}})
 const resources=(raw.resources as unknown[]).map(resource)
 const records=(raw.records as unknown[]).map(v=>{exact(v,['id','kind','title','version','state','canAccept','canCancel','summary']);if(!['handover','new_year'].includes(String(v.kind))||!['pending','accepted','rejected','cancelled','completed'].includes(String(v.state))||typeof v.canAccept!=='boolean'||typeof v.canCancel!=='boolean'||v.state!=='pending'&&(v.canAccept||v.canCancel))fail();return{id:identifier(v.id),kind:v.kind as TransitionRecord['kind'],title:text(v.title,200,true),version:version(v.version),state:v.state as TransitionRecord['state'],canAccept:v.canAccept as boolean,canCancel:v.canCancel as boolean,summary:lines(v.summary)}})
 for(const values of [years.map(x=>x.id),recipients.map(x=>x.memberId),resources.map(x=>x.kind+':'+x.id),records.map(x=>x.id)])if(new Set(values).size!==values.length)fail()
 return{canManageYear:raw.canManageYear as boolean,years,recipients,resources,records,nextCursor:raw.nextCursor===null?null:text(raw.nextCursor,1000,true)}
}
export function transitionCommand(raw:unknown):TransitionCommand{
 return validateLocalInput(()=>{
 if(!object(raw))throw new ServiceError('INVALID_INPUT')
 const command=raw as TransitionCommand
 if(command.kind==='apply'){exact(command,['kind','plan','fingerprint']);transitionPlan(command.plan);if(!/^[a-f0-9]{64}$/.test(command.fingerprint))throw new ServiceError('INVALID_INPUT')}else{exact(command,['kind','recordId','expectedVersion','reason']);if(!['accept','reject','cancel'].includes(command.kind))throw new ServiceError('INVALID_INPUT');identifier(command.recordId);version(command.expectedVersion);text(command.reason,1000,true)}
 return structuredClone(command)
 })
}
export function createTransitionService(connection:SupabaseConnection){
 const rpc=createScopedRpc(connection,'school-transitions.v1')
 return{
  list(memberId:string,cursor:string|null=null){if(cursor!==null)text(cursor,1000,true);return rpc.call(memberId,'workhub_school_transition_list',{p_cursor:cursor},transitionCatalog)},
  preview(memberId:string,input:TransitionPlan){const plan=transitionPlan(input);return rpc.call(memberId,'workhub_school_transition_preview',{p_plan:plan},raw=>{exact(raw,['fingerprint','expiresAt','summary','excluded','affectedCount']);if(typeof raw.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(raw.fingerprint)||typeof raw.expiresAt!=='string'||!Number.isFinite(Date.parse(raw.expiresAt))||!Number.isSafeInteger(raw.affectedCount)||(raw.affectedCount as number)<0)fail();return{fingerprint:raw.fingerprint as string,expiresAt:raw.expiresAt as string,summary:lines(raw.summary),excluded:lines(raw.excluded),affectedCount:raw.affectedCount as number}})},
  mutate(memberId:string,input:TransitionCommand,key:string){const command=transitionCommand(input);return rpc.call(memberId,'workhub_school_transition_mutate',{p_command:command,p_request_key:key},raw=>{exact(raw,['requestKey','recordId','version','state','recordedAt']);if(raw.requestKey!==key||!['pending','accepted','rejected','cancelled','completed'].includes(String(raw.state))||typeof raw.recordedAt!=='string'||!Number.isFinite(Date.parse(raw.recordedAt)))fail();identifier(raw.recordId);version(raw.version);if(command.kind!=='apply'&&(raw.recordId!==command.recordId||raw.version!==command.expectedVersion+1))fail();if(command.kind==='apply'&&(raw.version!==1||( command.plan.kind==='handover'&&raw.state!=='pending')||(command.plan.kind==='new_year'&&raw.state!=='completed')))fail();if(command.kind!=='apply'&&raw.state!==({accept:'accepted',reject:'rejected',cancel:'cancelled'} as const)[command.kind])fail();return{requestKey:key,recordId:raw.recordId as string,state:raw.state as string}},true)}
 }
}
export type TransitionService=ReturnType<typeof createTransitionService>
