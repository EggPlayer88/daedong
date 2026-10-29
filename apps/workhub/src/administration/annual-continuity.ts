import { createScopedRpc, exact, identifier, isoDate, ServiceError, text, version } from '../services/scoped-rpc'
import type { SupabaseConnection } from '../connection/supabase-connection'
export interface AnnualReadiness {
  from:string; until:string; today:string; adminGaps:{from:string;until:string}[]
  members:{id:string;name:string;status:'active'|'suspended'|'left';from:string;until:string|null;version:number}[]
  assignmentCount:number
}
export function parseAnnualReadiness(raw:unknown,from:string,until:string):AnnualReadiness {
  exact(raw,['from','until','today','adminGaps','members','assignmentCount'])
  if(raw.from!==from||raw.until!==until||!Array.isArray(raw.adminGaps)||!Array.isArray(raw.members)||!Number.isSafeInteger(raw.assignmentCount)||(raw.assignmentCount as number)<0)throw new ServiceError('INVALID_RESPONSE')
  const adminGaps=raw.adminGaps.map(row=>{exact(row,['from','until']);const a=isoDate(row.from),b=isoDate(row.until);if(a<from||b>until||a>=b)throw new ServiceError('INVALID_RESPONSE');return{from:a,until:b}})
  const members=raw.members.map(row=>{exact(row,['id','name','status','from','until','version']);if(!['active','suspended','left'].includes(String(row.status)))throw new ServiceError('INVALID_RESPONSE');const a=isoDate(row.from),b=row.until===null?null:isoDate(row.until);if(b&&a>=b)throw new ServiceError('INVALID_RESPONSE');return{id:identifier(row.id),name:text(row.name,100,true),status:row.status as AnnualReadiness['members'][number]['status'],from:a,until:b,version:version(row.version)}})
  if(new Set(members.map(m=>m.id)).size!==members.length)throw new ServiceError('INVALID_RESPONSE')
  return{from,until,today:isoDate(raw.today),adminGaps,members,assignmentCount:raw.assignmentCount as number}
}
export function createAnnualService(connection:SupabaseConnection){
 const rpc=createScopedRpc(connection,'school-annual.v1')
 return{read(memberId:string,from:string,until:string){isoDate(from);isoDate(until);if(from>=until||(Date.parse(until)-Date.parse(from))/86400000>400)throw new ServiceError('INVALID_INPUT');return rpc.call(memberId,'workhub_annual_readiness',{p_from:from,p_until:until},raw=>parseAnnualReadiness(raw,from,until))}}
}
