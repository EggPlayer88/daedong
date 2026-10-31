import type {Membership} from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import { exact, identifier, isoDate, ServiceError, text } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
export const HOME_KINDS=['collection','supplement','message','student_followup','cooperation'] as const
export type HomeKind=typeof HOME_KINDS[number]
export interface HomeAction{id:string;kind:HomeKind;title:string;dueDate:string|null;sourceId:string;priority:'normal'|'urgent';label:string}
export interface HomeOverview{asOf:string;items:HomeAction[];counts:Record<HomeKind,number|null>;unavailable:HomeKind[]}
export function homeOverview(raw:unknown,_member:Membership):HomeOverview{
 exact(raw,['asOf','items','counts','unavailable'])
 if(typeof raw.asOf!=='string'||!Number.isFinite(Date.parse(raw.asOf))||!Array.isArray(raw.items)||raw.items.length>8||!Array.isArray(raw.unavailable)||!raw.unavailable.every(x=>HOME_KINDS.includes(x as HomeKind))||new Set(raw.unavailable).size!==raw.unavailable.length)throw new ServiceError('INVALID_RESPONSE')
 exact(raw.counts,HOME_KINDS)
 const unavailable=raw.unavailable as HomeKind[],counts={} as HomeOverview['counts']
 for(const kind of HOME_KINDS){const n=raw.counts[kind];if(unavailable.includes(kind)){if(n!==null)throw new ServiceError('INVALID_RESPONSE');counts[kind]=null}else{if(!Number.isSafeInteger(n)||(n as number)<0)throw new ServiceError('INVALID_RESPONSE');counts[kind]=n as number}}
 const items=raw.items.map(item=>{exact(item,['id','kind','title','dueDate','sourceId','priority','label']);if(!HOME_KINDS.includes(item.kind as HomeKind)||unavailable.includes(item.kind as HomeKind)||!['normal','urgent'].includes(item.priority as string))throw new ServiceError('INVALID_RESPONSE');return{id:identifier(item.id),kind:item.kind as HomeKind,title:text(item.title,200,true),dueDate:item.dueDate===null?null:isoDate(item.dueDate),sourceId:identifier(item.sourceId),priority:item.priority as HomeAction['priority'],label:text(item.label,120,true)}})
 if(new Set(items.map(item=>item.kind+':'+item.sourceId)).size!==items.length||items.some(item=>counts[item.kind]===0))throw new ServiceError('INVALID_RESPONSE')
 return{asOf:raw.asOf,items,counts,unavailable}
}
export function createHomeService(connection:SupabaseConnection){const rpc=createScopedRpc(connection,'home.v1');return{load:(memberId:string)=>rpc.call(memberId,'workhub_home_overview',{},homeOverview)}}
