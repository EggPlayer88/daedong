import { exact, identifier, isoDate, object, ServiceError, text, version } from '../services/scoped-rpc'
import type { Membership } from '../contracts'
export const KNOWLEDGE_CONTRACT='knowledge.v1'
export const SOURCE_KINDS=['regulation','annual_plan','school_guide','other'] as const
export type SourceKind=typeof SOURCE_KINDS[number]
export const sourceLabels:Record<SourceKind,string>={regulation:'학교 규정',annual_plan:'연간 계획',school_guide:'업무 안내',other:'기타 자료'}
export interface SourceInput {title:string;kind:SourceKind;body:string;locator:string;effectiveFrom:string;effectiveThrough:string}
export interface KnowledgeSource extends SourceInput {id:string;schoolId:string;authorMemberId:string;version:number;status:'draft'|'published'|'retired';updatedAt:string}
export interface KnowledgeList {items:KnowledgeSource[];nextCursor:string|null;canManage:boolean}
export interface KnowledgeRevision {source:KnowledgeSource;isCurrent:boolean;canManage:boolean}
export interface KnowledgeHistoryItem {version:number;status:KnowledgeSource['status'];title:string;recordedAt:string;isCurrent:boolean}
export interface KnowledgeHistory {sourceId:string;authorMemberId:string;items:KnowledgeHistoryItem[];nextBeforeVersion:number|null;canManage:boolean}
export type KnowledgeCommand={kind:'create';input:SourceInput}|{kind:'update';id:string;expectedVersion:number;input:SourceInput}|{kind:'publish'|'retire';id:string;expectedVersion:number;reason:string}
export interface KnowledgeReceipt {id:string;version:number;requestKey:string;recordedAt:string}
export const blankSource=():SourceInput=>({title:'',kind:'school_guide',body:'',locator:'',effectiveFrom:'',effectiveThrough:''})
export function sourceInput(value:unknown):SourceInput{
 exact(value,['title','kind','body','locator','effectiveFrom','effectiveThrough'])
 const title=text(value.title,200,true).trim(),body=text(value.body,100000,true),locator=text(value.locator,500,true).trim()
 if(!SOURCE_KINDS.includes(value.kind as SourceKind))throw new ServiceError('INVALID_INPUT')
 const effectiveFrom=isoDate(value.effectiveFrom),effectiveThrough=value.effectiveThrough===''?'':isoDate(value.effectiveThrough)
 if(effectiveThrough&&effectiveThrough<effectiveFrom)throw new ServiceError('INVALID_INPUT')
 return{title,kind:value.kind as SourceKind,body,locator,effectiveFrom,effectiveThrough}
}
export function knowledgeSource(raw:unknown,member:Membership):KnowledgeSource{
 exact(raw,['id','schoolId','authorMemberId','version','status','updatedAt','title','kind','body','locator','effectiveFrom','effectiveThrough'])
 if(raw.schoolId!==member.schoolId||!['draft','published','retired'].includes(raw.status as string)||typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt)))throw new ServiceError('INVALID_RESPONSE')
 const input=sourceInput(Object.fromEntries(['title','kind','body','locator','effectiveFrom','effectiveThrough'].map(key=>[key,raw[key]])))
 return{...input,id:identifier(raw.id),schoolId:member.schoolId,authorMemberId:identifier(raw.authorMemberId),version:version(raw.version),status:raw.status as KnowledgeSource['status'],updatedAt:raw.updatedAt}
}
export function knowledgeList(raw:unknown,member:Membership):KnowledgeList{
 exact(raw,['items','nextCursor','canManage'])
 if(!Array.isArray(raw.items)||raw.items.length>50||typeof raw.canManage!=='boolean')throw new ServiceError('INVALID_RESPONSE')
 const items=raw.items.map(value=>knowledgeSource(value,member))
 if(new Set(items.map(item=>item.id)).size!==items.length||(!raw.canManage&&items.some(item=>item.status==='draft'&&item.authorMemberId!==member.id)))throw new ServiceError('INVALID_RESPONSE')
 return{items,canManage:raw.canManage,nextCursor:raw.nextCursor===null?null:text(raw.nextCursor,2000,true)}
}
// 과거 판은 최신 목록으로 대체하지 않는다. 요청한 ID·판과 서버의 접근 범위를 함께 확인한다.
export function knowledgeRevision(raw:unknown,member:Membership,sourceId:string,sourceVersion:number):KnowledgeRevision{
 exact(raw,['source','isCurrent','canManage'])
 if(typeof raw.isCurrent!=='boolean'||typeof raw.canManage!=='boolean')throw new ServiceError('INVALID_RESPONSE')
 const source=knowledgeSource(raw.source,member)
 if(source.id!==sourceId||source.version!==sourceVersion||(!raw.canManage&&source.status==='draft'&&source.authorMemberId!==member.id))throw new ServiceError('INVALID_RESPONSE')
 return{source,isCurrent:raw.isCurrent,canManage:raw.canManage}
}
export function knowledgeHistory(raw:unknown,member:Membership,sourceId:string,beforeVersion:number|null):KnowledgeHistory{
 exact(raw,['sourceId','authorMemberId','items','nextBeforeVersion','canManage'])
 if(raw.sourceId!==sourceId||!Array.isArray(raw.items)||raw.items.length>50||typeof raw.canManage!=='boolean')throw new ServiceError('INVALID_RESPONSE')
 const authorMemberId=identifier(raw.authorMemberId)
 let previous=beforeVersion??Number.MAX_SAFE_INTEGER,hasCurrent=false
 const items=raw.items.map(value=>{
  exact(value,['version','status','title','recordedAt','isCurrent'])
  const v=version(value.version)
  if(v>=previous||!['draft','published','retired'].includes(value.status as string)||typeof value.isCurrent!=='boolean'||typeof value.recordedAt!=='string'||!Number.isFinite(Date.parse(value.recordedAt))||(!raw.canManage&&value.status==='draft'&&authorMemberId!==member.id))throw new ServiceError('INVALID_RESPONSE')
  if(value.isCurrent&&(hasCurrent||beforeVersion!==null||previous!==Number.MAX_SAFE_INTEGER))throw new ServiceError('INVALID_RESPONSE')
  hasCurrent ||= value.isCurrent;previous=v
  return{version:v,status:value.status as KnowledgeSource['status'],title:text(value.title,200,true),recordedAt:value.recordedAt,isCurrent:value.isCurrent}
 })
 const nextBeforeVersion=raw.nextBeforeVersion===null?null:version(raw.nextBeforeVersion)
 if(nextBeforeVersion!==null&&(items.length!==50||nextBeforeVersion!==items.at(-1)?.version))throw new ServiceError('INVALID_RESPONSE')
 return{sourceId,authorMemberId,items,nextBeforeVersion,canManage:raw.canManage}
}
export function knowledgeCommand(raw:unknown):KnowledgeCommand{
 if(!object(raw))throw new ServiceError('INVALID_INPUT')
 if(raw.kind==='create'){exact(raw,['kind','input']);return{kind:'create',input:sourceInput(raw.input)}}
 if(raw.kind==='update'){exact(raw,['kind','id','expectedVersion','input']);return{kind:'update',id:identifier(raw.id),expectedVersion:version(raw.expectedVersion),input:sourceInput(raw.input)}}
 exact(raw,['kind','id','expectedVersion','reason']);if(raw.kind!=='publish'&&raw.kind!=='retire')throw new ServiceError('INVALID_INPUT')
 return{kind:raw.kind,id:identifier(raw.id),expectedVersion:version(raw.expectedVersion),reason:text(raw.reason,1000,true).trim()}
}
export function knowledgeReceipt(raw:unknown,key:string,command:KnowledgeCommand):KnowledgeReceipt{
 exact(raw,['id','version','requestKey','recordedAt'])
 if(raw.requestKey!==key||('id'in command&&raw.id!==command.id)||typeof raw.recordedAt!=='string'||!Number.isFinite(Date.parse(raw.recordedAt)))throw new ServiceError('INVALID_RESPONSE')
 const v=version(raw.version);if('expectedVersion'in command&&v!==command.expectedVersion+1)throw new ServiceError('INVALID_RESPONSE')
 return{id:identifier(raw.id),version:v,requestKey:key,recordedAt:raw.recordedAt}
}
export function sourceEffective(source:KnowledgeSource,date:string):boolean{return source.status==='published'&&source.effectiveFrom<=date&&(!source.effectiveThrough||date<=source.effectiveThrough)}
