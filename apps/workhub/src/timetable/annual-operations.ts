import {createScopedRpc,exact,identifier,isoDate,ServiceError,text,version,validateLocalInput} from '../services/scoped-rpc'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {parseOperationLessonChange} from './operations-server'
import type {OperationLessonChange} from './operations-contracts'
export const closureLabels={vacation:'공식 방학',statutory_holiday:'법정 공휴일',school_trip:'수련회·현장 체험',temporary:'임시 휴업'} as const
export type ClosureClass=keyof typeof closureLabels
export interface PeriodInput {from:string;until:string;groupIds:string[];classification:ClosureClass;reason:string}
export interface PeriodPreview {id:string;fingerprint:string;expiresAt:string;plan:{days:{date:string;changes:OperationLessonChange[]}[];blockers:{date:string;code:string;message:string}[];changedCount:number;sourceHash:string}}
export type AnnualCommand={kind:'apply_period';previewId:string;fingerprint:string}|{kind:'close_makeup';lessonId:string;expectedVersion:number;reason:string}|{kind:'release_empty_day';changeId:string;reason:string}
export interface AnnualReview {makeup:{id:string;version:number;label:string;date:string;closedReason:string|null}[];days:{id:string;date:string;classification:ClosureClass;changedCount:number;released:boolean}[]}
const hash=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new ServiceError('INVALID_RESPONSE');return v}
const count=(v:unknown,max=3000)=>{if(!Number.isSafeInteger(v)||(v as number)<0||(v as number)>max)throw new ServiceError('INVALID_RESPONSE');return v as number}
export function periodInput(raw:PeriodInput):PeriodInput{return validateLocalInput(()=>{exact(raw,['from','until','groupIds','classification','reason']);const from=isoDate(raw.from),until=isoDate(raw.until);if(from>=until||Date.parse(until)-Date.parse(from)>62*86400000||!Object.hasOwn(closureLabels,raw.classification)||!Array.isArray(raw.groupIds)||!raw.groupIds.length||raw.groupIds.length>100||new Set(raw.groupIds).size!==raw.groupIds.length)throw new ServiceError('INVALID_INPUT');return{from,until,groupIds:raw.groupIds.map(identifier).sort(),classification:raw.classification,reason:text(raw.reason,500,true).trim()}})}
export function annualCommand(raw:unknown):AnnualCommand{return validateLocalInput(()=>{if(!raw||typeof raw!=='object')throw new ServiceError('INVALID_INPUT');const v=raw as AnnualCommand;if(v.kind==='apply_period'){exact(v,['kind','previewId','fingerprint']);identifier(v.previewId);hash(v.fingerprint)}else if(v.kind==='close_makeup'){exact(v,['kind','lessonId','expectedVersion','reason']);identifier(v.lessonId);version(v.expectedVersion);text(v.reason,500,true)}else if(v.kind==='release_empty_day'){exact(v,['kind','changeId','reason']);identifier(v.changeId);text(v.reason,500,true)}else throw new ServiceError('INVALID_INPUT');return structuredClone(v)})}
export function parsePeriodPreview(raw:unknown,input:PeriodInput):PeriodPreview{
 exact(raw,['id','fingerprint','expiresAt','plan']);exact(raw.plan,['days','blockers','changedCount','sourceHash'])
 if(typeof raw.expiresAt!=='string'||!Number.isFinite(Date.parse(raw.expiresAt))||!Array.isArray(raw.plan.days)||!Array.isArray(raw.plan.blockers))throw new ServiceError('INVALID_RESPONSE')
 const days=raw.plan.days.map((row,index)=>{exact(row,['date','changes']);const date=isoDate(row.date);if(Date.parse(date)!==Date.parse(input.from)+index*86400000||!Array.isArray(row.changes))throw new ServiceError('INVALID_RESPONSE');const changes=row.changes.map(parseOperationLessonChange);if(changes.some(c=>!c.before||c.after.state!=='cancelled'||c.after.id!==c.before.id||c.after.version!==c.before.version+1))throw new ServiceError('INVALID_RESPONSE');return{date,changes}})
 const ids=days.flatMap(d=>d.changes.map(c=>c.after.id)),changedCount=count(raw.plan.changedCount)
 if(days.length!==(Date.parse(input.until)-Date.parse(input.from))/86400000||ids.length!==changedCount||new Set(ids).size!==ids.length)throw new ServiceError('INVALID_RESPONSE')
 const blockers=raw.plan.blockers.map(b=>{exact(b,['date','code','message']);const date=isoDate(b.date);if(date<input.from||date>=input.until)throw new ServiceError('INVALID_RESPONSE');return{date,code:text(b.code,100,true),message:text(b.message,1000,true)}})
 return{id:identifier(raw.id),fingerprint:hash(raw.fingerprint),expiresAt:raw.expiresAt,plan:{days,blockers,changedCount,sourceHash:hash(raw.plan.sourceHash)}}
}
export function parseAnnualReview(raw:unknown,from:string,until:string):AnnualReview{
 exact(raw,['makeup','days']);if(!Array.isArray(raw.makeup)||!Array.isArray(raw.days))throw new ServiceError('INVALID_RESPONSE')
 const day=(v:unknown)=>{const d=isoDate(v);if(d<from||d>=until)throw new ServiceError('INVALID_RESPONSE');return d}
 const makeup=raw.makeup.map(m=>{exact(m,['id','version','label','date','closedReason']);return{id:identifier(m.id),version:version(m.version),label:text(m.label,200,true),date:day(m.date),closedReason:m.closedReason===null?null:text(m.closedReason,500,true)}})
 const days=raw.days.map(d=>{exact(d,['id','date','classification','changedCount','released']);if(!Object.hasOwn(closureLabels,String(d.classification))||typeof d.released!=='boolean')throw new ServiceError('INVALID_RESPONSE');return{id:identifier(d.id),date:day(d.date),classification:d.classification as ClosureClass,changedCount:count(d.changedCount),released:d.released}})
 if(new Set(makeup.map(m=>m.id)).size!==makeup.length||new Set(days.map(d=>d.id)).size!==days.length)throw new ServiceError('INVALID_RESPONSE');return{makeup,days}
}
export function createAnnualOperations(connection:SupabaseConnection){const rpc=createScopedRpc(connection,'annual-operations.v1');return{
 preview(memberId:string,raw:PeriodInput){const input=periodInput(raw);return rpc.call(memberId,'workhub_annual_operations',{p_operation:'preview',p_input:input,p_request_key:null},v=>parsePeriodPreview(v,input))},
 review(memberId:string,from:string,until:string){isoDate(from);isoDate(until);if(from>=until||Date.parse(until)-Date.parse(from)>62*86400000)throw new ServiceError('INVALID_INPUT');return rpc.call(memberId,'workhub_annual_operations',{p_operation:'review',p_input:{from,until},p_request_key:null},v=>parseAnnualReview(v,from,until))},
 execute(memberId:string,input:AnnualCommand,key:string){const command=annualCommand(input);return rpc.call(memberId,'workhub_annual_operations',{p_operation:'execute',p_input:command,p_request_key:key},v=>{exact(v,['requestKey','kind','id','changedCount']);const expected=command.kind==='apply_period'?command.previewId:command.kind==='close_makeup'?command.lessonId:command.changeId;if(v.requestKey!==key||v.kind!==command.kind||v.id!==expected)throw new ServiceError('INVALID_RESPONSE');return{id:identifier(v.id),changedCount:count(v.changedCount)}},true)}
}}
export type AnnualOperations=ReturnType<typeof createAnnualOperations>
