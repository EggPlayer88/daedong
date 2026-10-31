import { exact, identifier, object } from '../services/service-values'
import {AssistantError,assistantLocalInput} from './contracts'

export const AI_OPERATION_STATES=['prepared','started','completed','rejected','unknown','failed','closed','resolved'] as const
export const AI_OPERATION_FEATURES=['assistant','evaluation'] as const
export const AI_OPERATION_QUALITIES=['quick','review','legacy'] as const
export const AI_OPERATION_ERRORS=['FORBIDDEN','INACTIVE_MEMBERSHIP','INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','BUDGET_EXCEEDED','NOT_READY','SCHOOL_NOT_LINKED','KEY_MISSING','POLICY_MISSING','DISABLED','OVER_RESERVATION','OUTPUT_INVALID','PROVIDER_REJECTED','TRUNCATED','COUNT_FAILED','INPUT_TOO_LARGE','CANCELLED','PROVIDER_UNKNOWN'] as const
export type OperationState=typeof AI_OPERATION_STATES[number]
export type OperationFeature=typeof AI_OPERATION_FEATURES[number]
export type OperationQuality=typeof AI_OPERATION_QUALITIES[number]
export type OperationCounts=Record<OperationState,number>
export interface OperationAggregate {requests:number;settledMicroUsd:number;reservedMicroUsd:number;states:OperationCounts}
export interface OperationsCursor {month:string;asOf:string;afterId:string}
export interface OperationItem {id:string;requestKey:string;feature:OperationFeature;quality:OperationQuality;state:OperationState;createdAt:string;updatedAt:string;model:string;reservedMicroUsd:number;settledMicroUsd:number|null;usage:{inputTokens:number;outputTokens:number}|null;errorCode:typeof AI_OPERATION_ERRORS[number]|null;observedOverage:boolean}
export interface SchoolAiOperations {
 contract:'assistant.operations.v1';schoolId:string;memberId:string;checkedAt:string;month:string;timeZone:string;asOf:string;
 totals:OperationAggregate;groups:(OperationAggregate&{feature:OperationFeature;quality:OperationQuality})[];
 unresolved:{requests:number;reservedMicroUsd:number;previousMonthRequests:number;previousMonthReservedMicroUsd:number;oldestCreatedAt:string|null;observedOverageRequests:number};
 items:OperationItem[];nextCursor:OperationsCursor|null;
}
export const DIAGNOSTIC_RULES={
 authorization:{AUTHORIZED:true},serviceConfiguration:{SERVICE_AUTHENTICATED:true},
 database:{SQL_READY:true,SQL_READ_UNAVAILABLE:null},
 policy:{POLICY_ENABLED:true,POLICY_MISSING:false,POLICY_DISABLED:false,OVERAGE_BLOCKED:false,SQL_READ_UNAVAILABLE:null},
 schoolKey:{KEY_PRESENT:true,KEY_MISSING:false},serverEncryption:{ENCRYPTION_CONFIGURED:true,ENCRYPTION_CONFIG_INVALID:false},
 keyDecryption:{KEY_DECRYPTABLE:true,KEY_UNAVAILABLE:false,KEY_MISSING:null,ENCRYPTION_CONFIG_INVALID:null,SQL_READ_UNAVAILABLE:null},
 providerConnection:{NOT_CHECKED:null},
} as const
export type DiagnosticId=keyof typeof DIAGNOSTIC_RULES
export interface DiagnosticCheck {id:DiagnosticId;ok:boolean|null;code:string}
export interface SchoolAiDiagnostics {contract:'assistant.school.diagnostics.v1';schoolId:string;memberId:string;checkedAt:string;providerContacted:false;checks:DiagnosticCheck[]}
export interface SchoolAiOperationsServer {list(memberId:string,cursor?:OperationsCursor|null):Promise<SchoolAiOperations>;diagnostics(memberId:string):Promise<SchoolAiDiagnostics>}

function invalid():never {throw new AssistantError('INVALID_RESPONSE')}
function number(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)invalid();return value}
function utc(value:unknown):string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)invalid();return value}
function month(value:unknown):string {if(typeof value!=='string'||!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value))invalid();return value}
function choice<T extends string>(raw:unknown,values:readonly T[]):T {if(typeof raw!=='string'||!values.includes(raw as T))invalid();return raw as T}
function scope(value:unknown,expected:{schoolId:string;memberId:string},contract:string){if(!object(value)||value.contract!==contract||value.schoolId!==expected.schoolId||value.memberId!==expected.memberId)invalid();return value}
function aggregate(raw:unknown):OperationAggregate {
 exact(raw,['requests','settledMicroUsd','reservedMicroUsd','states']);exact(raw.states,AI_OPERATION_STATES)
 const rawStates=raw.states
 const states=Object.fromEntries(AI_OPERATION_STATES.map(key=>[key,number(rawStates[key])])) as OperationCounts
 const requests=number(raw.requests);if(AI_OPERATION_STATES.reduce((sum,key)=>sum+states[key],0)!==requests)invalid()
 return{requests,states,settledMicroUsd:number(raw.settledMicroUsd),reservedMicroUsd:number(raw.reservedMicroUsd)}
}
export function operationsCursor(raw:unknown):OperationsCursor|null {if(raw===null||raw===undefined)return null;return assistantLocalInput(()=>{exact(raw,['month','asOf','afterId']);return{month:month(raw.month),asOf:utc(raw.asOf),afterId:identifier(raw.afterId)}})}
export function schoolAiOperations(raw:unknown,expected:{schoolId:string;memberId:string},cursor:OperationsCursor|null=null):SchoolAiOperations {
 const value=scope(raw,expected,'assistant.operations.v1')
 exact(value,['contract','schoolId','memberId','checkedAt','month','timeZone','asOf','totals','groups','unresolved','items','nextCursor'])
 const checkedAt=utc(value.checkedAt),asOf=utc(value.asOf),selectedMonth=month(value.month)
 if(asOf>checkedAt||cursor&&(cursor.asOf!==asOf||cursor.month!==selectedMonth))invalid()
 if(typeof value.timeZone!=='string'||value.timeZone.length>100)invalid()
 try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:value.timeZone,year:'numeric',month:'2-digit'}).formatToParts(new Date(asOf));if(`${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`!==selectedMonth)invalid()}catch{invalid()}
 const totals=aggregate(value.totals)
 if(!Array.isArray(value.groups)||value.groups.length!==6)invalid()
 const groups=value.groups.map((g,index)=>{exact(g,['feature','quality','requests','settledMicroUsd','reservedMicroUsd','states']);if(g.feature!==AI_OPERATION_FEATURES[Math.floor(index/3)]||g.quality!==AI_OPERATION_QUALITIES[index%3])invalid();const{feature,quality,...rest}=g;return{...aggregate(rest),feature:feature as OperationFeature,quality:quality as OperationQuality}})
 for(const key of ['requests','settledMicroUsd','reservedMicroUsd'] as const)if(groups.reduce((sum,g)=>sum+g[key],0)!==totals[key])invalid()
 for(const state of AI_OPERATION_STATES)if(groups.reduce((sum,g)=>sum+g.states[state],0)!==totals.states[state])invalid()
 exact(value.unresolved,['requests','reservedMicroUsd','previousMonthRequests','previousMonthReservedMicroUsd','oldestCreatedAt','observedOverageRequests'])
 const u=value.unresolved,unresolved={requests:number(u.requests),reservedMicroUsd:number(u.reservedMicroUsd),previousMonthRequests:number(u.previousMonthRequests),previousMonthReservedMicroUsd:number(u.previousMonthReservedMicroUsd),oldestCreatedAt:u.oldestCreatedAt===null?null:utc(u.oldestCreatedAt),observedOverageRequests:number(u.observedOverageRequests)}
 if(unresolved.previousMonthRequests>unresolved.requests||unresolved.previousMonthReservedMicroUsd>unresolved.reservedMicroUsd||unresolved.observedOverageRequests>unresolved.requests||(unresolved.requests===0)!==(unresolved.oldestCreatedAt===null)||unresolved.oldestCreatedAt&&unresolved.oldestCreatedAt>checkedAt)invalid()
 if(!Array.isArray(value.items)||value.items.length>25||value.items.length>totals.requests)invalid()
 const ids=new Set<string>();const items=value.items.map(item=>{
  exact(item,['id','requestKey','feature','quality','state','createdAt','updatedAt','model','reservedMicroUsd','settledMicroUsd','usage','errorCode','observedOverage'])
  const id=identifier(item.id),requestKey=identifier(item.requestKey),createdAt=utc(item.createdAt),updatedAt=utc(item.updatedAt)
  if(ids.has(id)||id===cursor?.afterId||requestKey.length<8||createdAt>asOf||updatedAt<createdAt||updatedAt>checkedAt)invalid();ids.add(id)
  if(typeof item.model!=='string'||!/^[A-Za-z0-9_.-]{1,150}$/.test(item.model)||typeof item.observedOverage!=='boolean')invalid()
  let usage:OperationItem['usage']=null;if(item.usage!==null){exact(item.usage,['inputTokens','outputTokens']);usage={inputTokens:number(item.usage.inputTokens),outputTokens:number(item.usage.outputTokens)}}
  const reservedMicroUsd=number(item.reservedMicroUsd),settledMicroUsd=item.settledMicroUsd===null?null:number(item.settledMicroUsd);if(settledMicroUsd!==null&&reservedMicroUsd!==0)invalid()
  return{id,requestKey,feature:choice(item.feature,AI_OPERATION_FEATURES),quality:choice(item.quality,AI_OPERATION_QUALITIES),state:choice(item.state,AI_OPERATION_STATES),createdAt,updatedAt,model:item.model,reservedMicroUsd,settledMicroUsd,usage,errorCode:item.errorCode===null?null:choice(item.errorCode,AI_OPERATION_ERRORS),observedOverage:item.observedOverage}
 })
 for(let i=1;i<items.length;i++)if(items[i].createdAt>items[i-1].createdAt)invalid()
 const nextCursor=operationsCursor(value.nextCursor)
 if(nextCursor&&(items.length!==25||nextCursor.month!==selectedMonth||nextCursor.asOf!==asOf||nextCursor.afterId!==items.at(-1)?.id))invalid()
 return{contract:'assistant.operations.v1',...expected,checkedAt,month:selectedMonth,timeZone:value.timeZone,asOf,totals,groups,unresolved,items,nextCursor}
}
export function schoolAiDiagnostics(raw:unknown,expected:{schoolId:string;memberId:string}):SchoolAiDiagnostics {
 const value=scope(raw,expected,'assistant.school.diagnostics.v1');exact(value,['contract','schoolId','memberId','checkedAt','providerContacted','checks'])
 if(value.providerContacted!==false||!Array.isArray(value.checks)||value.checks.length!==8)invalid()
 const ids=Object.keys(DIAGNOSTIC_RULES) as DiagnosticId[]
 const checks=value.checks.map((check,i)=>{exact(check,['id','ok','code']);if(check.id!==ids[i]||typeof check.code!=='string')invalid();const rules:Record<string,boolean|null>=DIAGNOSTIC_RULES[ids[i]];if(!Object.hasOwn(rules,check.code)||check.ok!==rules[check.code])invalid();return{id:ids[i],ok:check.ok as boolean|null,code:check.code}})
 return{contract:'assistant.school.diagnostics.v1',...expected,checkedAt:utc(value.checkedAt),providerContacted:false,checks}
}
// 지원용 파일은 허용 목록으로 새로 구성한다. 학교·회원·요청 식별자와 질문/키 정보는 포함하지 않는다.
export function schoolAiSupportReport(operations:SchoolAiOperations|null,diagnostics:SchoolAiDiagnostics|null){return{contract:'assistant.support.v1',generatedAt:new Date().toISOString(),providerContacted:false,operations:operations?{checkedAt:operations.checkedAt,month:operations.month,timeZone:operations.timeZone,totals:operations.totals,groups:operations.groups,unresolved:operations.unresolved}:null,diagnostics:diagnostics?{checkedAt:diagnostics.checkedAt,checks:diagnostics.checks}:null}}
