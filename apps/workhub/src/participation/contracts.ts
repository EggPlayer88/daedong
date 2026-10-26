import type { Membership } from '../contracts'
import { exact, identifier, text, version, ServiceError } from '../services/scoped-rpc'
import definitions from './scopes.json'

type Grant={memberId:string;name:string;scopes:string[];active:boolean;effective:boolean;expiresAt:string;revision:number}
export function participantAdministration(value:unknown,member:Membership){
 exact(value,['contract','schoolId','memberId','grants','timetableApprovers','interventionsReady'])
 if(value.contract!=='workhub.participant-admin.v1'||value.schoolId!==member.schoolId||value.memberId!==member.id||!Array.isArray(value.grants)||!Number.isSafeInteger(value.timetableApprovers)||(value.timetableApprovers as number)<0||typeof value.interventionsReady!=='boolean')throw new ServiceError('INVALID_RESPONSE')
 const seen=new Set<string>()
 const grants=value.grants.map(g=>{
  exact(g,['memberId','name','scopes','active','effective','expiresAt','revision'])
  const id=identifier(g.memberId);if(seen.has(id))throw new ServiceError('INVALID_RESPONSE');seen.add(id)
  if(!Array.isArray(g.scopes)||!g.scopes.length||new Set(g.scopes).size!==g.scopes.length||g.scopes.some(s=>!definitions.some(d=>d.id===s&&d.requires.every(r=>(g.scopes as unknown[]).includes(r))))||typeof g.active!=='boolean'||typeof g.effective!=='boolean'||(g.effective&&!g.active)||typeof g.expiresAt!=='string'||!Number.isFinite(Date.parse(g.expiresAt)))throw new ServiceError('INVALID_RESPONSE')
  return {memberId:id,name:text(g.name,200,true),scopes:g.scopes as string[],active:g.active,effective:g.effective,expiresAt:g.expiresAt,revision:version(g.revision)} as Grant
 })
 return {grants,timetableApprovers:value.timetableApprovers as number,interventionsReady:value.interventionsReady}
}
