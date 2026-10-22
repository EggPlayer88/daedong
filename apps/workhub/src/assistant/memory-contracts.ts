import limits from '../../../main/api/workhub-ai/_assets/memory-limits.json'
import type {Membership} from '../contracts'
import {exact,identifier,isoDate,object,ServiceError,text,validateLocalInput} from '../services/scoped-rpc'

export const MEMORY_LIMITS=limits
export const MEMORY_CONTRACT='memory.v1'
export type MemoryCategory='preference'|'routine'
export interface MemoryEntry{
 id:string;schoolId:string;memberId:string;version:number;title:string;body:string
 category:MemoryCategory;enabled:boolean;expiresOn:string|null;createdAt:string;updatedAt:string
}
interface MemoryFields{title:string;body:string;category:MemoryCategory;enabled:boolean;expiresOn:string|null}
export type MemoryCommand=({kind:'create';id:string;confirmed:true}&MemoryFields)
 |({kind:'update';id:string;expectedVersion:number;confirmed:true}&MemoryFields)
 |{kind:'delete';id:string;expectedVersion:number;confirmed:true}
export interface MemoryReference{id:string;version:number}
export interface MemoryReceipt{state:'applied';requestKey:string;kind:MemoryCommand['kind'];entryId:string;version:number}
export type MemoryResult=MemoryReceipt|{state:'missing';requestKey:string}|{state:'closed';requestKey:string}
export interface MemoryList{items:MemoryEntry[];today:string;canWrite:boolean}
export interface MemorySelection{items:MemoryEntry[];today:string}
export interface MemoryService{
 list(memberId:string):Promise<MemoryList>
 select(memberId:string,references:MemoryReference[]):Promise<MemorySelection>
 mutate(memberId:string,command:MemoryCommand,key:string):Promise<MemoryReceipt>
 recover(memberId:string,command:MemoryCommand,key:string):Promise<MemoryResult>
 close(memberId:string,command:MemoryCommand,key:string):Promise<MemoryReceipt|{state:'closed';requestKey:string}>
}
type Scope=Pick<Membership,'id'|'schoolId'>
function fail():never{throw new ServiceError('INVALID_RESPONSE')}
function version(raw:unknown){if(!Number.isSafeInteger(raw)||(raw as number)<1||(raw as number)>2147483647)fail();return raw as number}
function words(raw:unknown,max:number){const value=text(raw,max,true);for(const letter of value){const code=letter.charCodeAt(0);if(letter.length===1&&code>=0xd800&&code<=0xdfff)fail()}return value}
function day(raw:unknown){const value=isoDate(raw);if(value.startsWith('0000-'))fail();return value}
function bool(raw:unknown){if(typeof raw!=='boolean')fail();return raw}
function category(raw:unknown):MemoryCategory{if(raw!=='preference'&&raw!=='routine')fail();return raw}
function stamp(raw:unknown){const value=text(raw,40,true);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail();day(value.slice(0,10));return value}
function fields(raw:Record<string,unknown>):MemoryFields{return{title:words(raw.title,limits.titleCharacters),body:words(raw.body,limits.bodyCharacters),category:category(raw.category),enabled:bool(raw.enabled),expiresOn:raw.expiresOn===null?null:day(raw.expiresOn)}}

export function memoryCommand(raw:unknown):MemoryCommand{
 return validateLocalInput(()=>{
  if(!object(raw))fail()
  const kind=raw.kind
  if(kind!=='create'&&kind!=='update'&&kind!=='delete')fail()
  exact(raw,['kind','id',...(kind==='create'?[]:['expectedVersion']),...(kind==='delete'?[]:['title','body','category','enabled','expiresOn']),'confirmed'])
  if(raw.confirmed!==true)fail()
  const common={id:identifier(raw.id),confirmed:true as const}
  if(kind==='delete')return{kind,...common,expectedVersion:version(raw.expectedVersion)}
  if(kind==='update')return{kind,...common,expectedVersion:version(raw.expectedVersion),...fields(raw)}
  return{kind,...common,...fields(raw)}
 })
}
export function memoryReferences(raw:unknown):MemoryReference[]{
 return validateLocalInput(()=>{
  if(!Array.isArray(raw)||!raw.length||raw.length>limits.maxSelected)fail()
  const rows=raw.map(item=>{exact(item,['id','version']);return{id:identifier(item.id),version:version(item.version)}})
  if(new Set(rows.map(item=>item.id)).size!==rows.length)fail()
  return rows
 })
}
export function memoryEntry(raw:unknown,scope:Scope):MemoryEntry{
 exact(raw,['id','schoolId','memberId','version','title','body','category','enabled','expiresOn','createdAt','updatedAt'])
 const result={id:identifier(raw.id),schoolId:identifier(raw.schoolId),memberId:identifier(raw.memberId),version:version(raw.version),...fields(raw),createdAt:stamp(raw.createdAt),updatedAt:stamp(raw.updatedAt)}
 if(result.schoolId!==scope.schoolId||result.memberId!==scope.id||Date.parse(result.updatedAt)<Date.parse(result.createdAt))fail()
 return result
}
export function memoryUsable(entry:MemoryEntry,today:string){day(today);return entry.enabled&&(entry.expiresOn===null||entry.expiresOn>=today)}
export function memoryList(raw:unknown,scope:Scope):MemoryList{
 exact(raw,['items','today','canWrite'])
 if(!Array.isArray(raw.items)||raw.items.length>limits.maxEntries)fail()
 const items=raw.items.map(item=>memoryEntry(item,scope))
 if(items.some((item,index)=>index>0&&items[index-1].id>=item.id))fail()
 return{items,today:day(raw.today),canWrite:bool(raw.canWrite)}
}
export function memorySelection(raw:unknown,scope:Scope,references:MemoryReference[]):MemorySelection{
 exact(raw,['items','today'])
 const checked=memoryReferences(references),today=day(raw.today)
 if(!Array.isArray(raw.items)||raw.items.length!==checked.length)fail()
 const items=raw.items.map(item=>memoryEntry(item,scope))
 if(items.some((item,index)=>item.id!==checked[index].id||item.version!==checked[index].version||!memoryUsable(item,today)))fail()
 return{items,today}
}
export function memoryReceipt(raw:unknown,command:MemoryCommand,key:string):MemoryReceipt{
 exact(raw,['state','requestKey','kind','entryId','version'])
 if(raw.state!=='applied'||raw.requestKey!==key||raw.kind!==command.kind||raw.entryId!==command.id)fail()
 const next=version(raw.version)
 if(next!==(command.kind==='create'?1:command.expectedVersion+1))fail()
 return{state:'applied',requestKey:key,kind:command.kind,entryId:command.id,version:next}
}
export function memoryResult(raw:unknown,command:MemoryCommand,key:string,allowMissing=true):MemoryResult{
 if(object(raw)&&raw.state==='applied')return memoryReceipt(raw,command,key)
 exact(raw,['state','requestKey'])
 if(raw.requestKey!==key||(raw.state!=='closed'&&!(allowMissing&&raw.state==='missing')))fail()
 return raw.state==='missing'?{state:'missing',requestKey:key}:{state:'closed',requestKey:key}
}
