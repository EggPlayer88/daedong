import { canonical, exact, identifier, object } from '../services/service-values'
import { ASSISTANT_ROUTING, AssistantError, assistantLocalInput } from './contracts'
export const SCHOOL_AI_CONTRACT = 'assistant.school.v1'
export interface SchoolAiStatus {
 contract: typeof SCHOOL_AI_CONTRACT; schoolId: string; memberId: string; policyVersion: number; canManage: boolean;
 credential: {configured: boolean; version: number; maskedSuffix: string|null; updatedAt: string|null};
 budget: {month: string; timeZone: string; currency: 'USD'; limitMicroUsd: number; settledMicroUsd: number; reservedMicroUsd: number; availableMicroUsd: number};
 models: {quick: {id:string;label:string}; review: {id:string;label:string}};
 status: 'ready'|'key_missing'|'policy_missing'|'budget_exhausted'|'disabled'
}
export interface SchoolAiReceipt {contract: typeof SCHOOL_AI_CONTRACT; schoolId:string;memberId:string;requestKey:string;state:'applied'|'pending'|'closed';credentialVersion:number|null}
export interface SchoolAiKeyCommand {expectedCredentialVersion:number}
export interface SchoolAiSettingsServer {
 status(memberId:string):Promise<SchoolAiStatus>;
 saveKey(memberId:string,command:SchoolAiKeyCommand,key:string,apiKey:string):Promise<SchoolAiReceipt>;
 recoverKey(memberId:string,command:SchoolAiKeyCommand,key:string):Promise<SchoolAiReceipt>;
 closeKey(memberId:string,command:SchoolAiKeyCommand,key:string):Promise<SchoolAiReceipt>
}
function fail():never {throw new AssistantError('INVALID_RESPONSE')}
function integer(raw:unknown,min=0):number {if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<min)fail();return raw}
function text(raw:unknown,max:number):string {if(typeof raw!=='string'||!raw.trim()||raw.length>max||/[\u0000-\u001f\u007f-\u009f]/.test(raw))fail();return raw}
function scope(raw:unknown,expected:{schoolId:string;memberId:string}) {if(!object(raw)||raw.contract!==SCHOOL_AI_CONTRACT||raw.schoolId!==expected.schoolId||raw.memberId!==expected.memberId)fail();return raw}
export function schoolAiStatus(raw:unknown,expected:{schoolId:string;memberId:string}):SchoolAiStatus {
 const value=scope(raw,expected);exact(value,['contract','schoolId','memberId','policyVersion','canManage','credential','budget','models','status']);
 const c=value.credential,b=value.budget,m=value.models;exact(c,['configured','version','maskedSuffix','updatedAt']);exact(b,['month','timeZone','currency','limitMicroUsd','settledMicroUsd','reservedMicroUsd','availableMicroUsd']);exact(m,['quick','review']);
 if(typeof value.canManage!=='boolean'||typeof c.configured!=='boolean')fail();
 const version=integer(c.version),policyVersion=integer(value.policyVersion);
 const suffix=c.maskedSuffix===null?null:text(c.maskedSuffix,8),updatedAt=c.updatedAt===null?null:text(c.updatedAt,40);
 if(suffix!==null&&!/^[A-Za-z0-9_-]{4,8}$/.test(suffix))fail();
 if(c.configured!==(version>0)||c.configured!==(suffix!==null)||c.configured!==(updatedAt!==null))fail();
 if(updatedAt!==null&&(!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt)||!Number.isFinite(Date.parse(updatedAt))))fail();
 const budget={month:text(b.month,7),timeZone:text(b.timeZone,100),currency:'USD' as const,limitMicroUsd:integer(b.limitMicroUsd,1),settledMicroUsd:integer(b.settledMicroUsd),reservedMicroUsd:integer(b.reservedMicroUsd),availableMicroUsd:integer(b.availableMicroUsd)};
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(budget.month)||b.currency!=='USD'||budget.limitMicroUsd!==ASSISTANT_ROUTING.schoolMonthlyLimitMicroUsd||budget.availableMicroUsd!==Math.max(0,budget.limitMicroUsd-budget.settledMicroUsd-budget.reservedMicroUsd))fail();
 try{new Intl.DateTimeFormat('ko-KR',{timeZone:budget.timeZone})}catch{fail()}
 function model(raw:unknown){exact(raw,['id','label']);return{id:text(raw.id,150),label:text(raw.label,80)}}
 const models={quick:model(m.quick),review:model(m.review)};
 if(models.quick.id!==ASSISTANT_ROUTING.models.quick.id||models.review.id!==ASSISTANT_ROUTING.models.review.id)fail();
 if(!['ready','key_missing','policy_missing','budget_exhausted','disabled'].includes(value.status as string))fail();
 const status=value.status as SchoolAiStatus['status'];
 if(status==='ready'&&(!c.configured||policyVersion===0||budget.availableMicroUsd===0))fail();
 if(status==='key_missing'&&c.configured||status==='policy_missing'&&policyVersion!==0)fail();
 return{contract:SCHOOL_AI_CONTRACT,...expected,policyVersion,canManage:value.canManage,credential:{configured:c.configured,version,maskedSuffix:suffix,updatedAt},budget,models,status}
}
export function schoolAiKeyCommand(raw:unknown):SchoolAiKeyCommand {return assistantLocalInput(()=>{exact(raw,['expectedCredentialVersion']);return{expectedCredentialVersion:integer(raw.expectedCredentialVersion)}})}
export function schoolAiReceipt(raw:unknown,expected:{schoolId:string;memberId:string},command:SchoolAiKeyCommand,key:string):SchoolAiReceipt {
 const value=scope(raw,expected);exact(value,['contract','schoolId','memberId','requestKey','state','credentialVersion']);if(value.requestKey!==key||!['applied','pending','closed'].includes(value.state as string))fail();
 if(value.state==='applied'&&value.credentialVersion!==command.expectedCredentialVersion+1||value.state!=='applied'&&value.credentialVersion!==null)fail();
 return{contract:SCHOOL_AI_CONTRACT,...expected,requestKey:key,state:value.state as SchoolAiReceipt['state'],credentialVersion:value.credentialVersion as number|null}
}
export function schoolAiRequestKey(raw:unknown):string{return assistantLocalInput(()=>{const key=identifier(raw);if(key.length<8)fail();return key})}
export function schoolAiRawKey(raw:unknown):string{return assistantLocalInput(()=>{if(typeof raw!=='string'||raw.length<20||raw.length>512||!/^sk-ant-[A-Za-z0-9_-]+$/.test(raw))fail();return raw})}
export const schoolAiMoney=(micro:number)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(micro/1000000)
export const schoolAiStatusLabel:Record<SchoolAiStatus['status'],string>={ready:'이용 가능',key_missing:'학교 API 키 등록 필요',policy_missing:'학교 이용 정책 준비 중',budget_exhausted:'이번 달 예산 소진',disabled:'학교 AI 사용 중지'}
