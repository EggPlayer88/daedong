import type {SupabaseConnection} from '../connection/supabase-connection'
import {createScopedRpc,exact,identifier,isoDate,ServiceError,version} from '../services/scoped-rpc'
export interface CollectionStatus {requestId:string;version:number;status:'draft'|'published';phase:'open'|'closed'|'archived';dueDate:string}
export interface CollectionStatuses {today:string;items:CollectionStatus[]}
export function parseCollectionStatuses(raw:unknown,ids:string[]):CollectionStatuses {
 exact(raw,['today','items']);const today=isoDate(raw.today)
 if(!Array.isArray(raw.items)||raw.items.length!==ids.length)throw new ServiceError('INVALID_RESPONSE')
 const items=raw.items.map(v=>{exact(v,['requestId','version','status','phase','dueDate']);if(!ids.includes(String(v.requestId))||!['draft','published'].includes(String(v.status))||!['open','closed','archived'].includes(String(v.phase)))throw new ServiceError('INVALID_RESPONSE');return{requestId:identifier(v.requestId),version:version(v.version),status:v.status as CollectionStatus['status'],phase:v.phase as CollectionStatus['phase'],dueDate:isoDate(v.dueDate)}})
 if(new Set(items.map(v=>v.requestId)).size!==ids.length)throw new ServiceError('INVALID_RESPONSE')
 return{today,items}
}
// 날짜 경과와 담당자의 명시 마감은 서로 다른 상태다. 조회 실패를 접수 중으로 추정하지 않는다.
export function collectionStateLabel(status:'draft'|'published',dueDate:string,today:string,phase?:CollectionStatus['phase']):string {
 if(status==='draft')return '담당자 초안'
 if(phase==='archived')return '보관됨'
 if(phase==='closed')return '마감됨'
 if(!phase)return '공개됨 · 접수 상태 확인 필요'
 return dueDate<today?'기한 지남 · 접수 중':'접수 중'
}
export function createCollectionPresentation(connection:SupabaseConnection){
 const rpc=createScopedRpc(connection,'collection.presentation.v1')
 return{rpc,statuses(memberId:string,ids:string[]){if(ids.length>50||new Set(ids).size!==ids.length)throw new ServiceError('INVALID_INPUT');ids.forEach(identifier);return rpc.call(memberId,'workhub_collection_presentation',{p_operation:'statuses',p_input:{ids},p_request_key:null},v=>parseCollectionStatuses(v,ids))}}
}
