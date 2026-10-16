import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, exact, object, validateLocalInput, identifier, isoDate, text, version, ServiceError } from '../services/scoped-rpc'

export type CollectionPhase = 'open' | 'closed' | 'archived'
export interface CollectionOperationsState {
 requestId:string; version:number; phase:CollectionPhase; dueDate:string; canManage:boolean
 totals:{total:number;missing:number;submitted:number;accepted:number;changesRequested:number}
 units:{id:string;label:string;responsibleMemberId:string;version:number;state:'missing'|'submitted'|'accepted'|'changes_requested'}[]
}
export type CollectionOperation =
 | {kind:'close'|'archive';requestId:string;expectedVersion:number;reason:string}
 | {kind:'reopen'|'extend';requestId:string;expectedVersion:number;reason:string;dueDate:string}
 | {kind:'remind';requestId:string;expectedVersion:number;reason:string;recipients:{unitId:string;memberId:string;expectedVersion:number}[]}
export interface CollectionOperationsServer {
 get(memberId:string,requestId:string):Promise<CollectionOperationsState>
 mutate(memberId:string,command:CollectionOperation,key:string):Promise<{requestKey:string;requestId:string;version:number;recordedAt:string}>
}
const fail=():never=>{throw new ServiceError('INVALID_RESPONSE')}
export function operationsState(raw:unknown,requestId:string):CollectionOperationsState {
 exact(raw,['requestId','version','phase','dueDate','canManage','totals','units'])
 if(raw.requestId!==requestId||!['open','closed','archived'].includes(String(raw.phase))||typeof raw.canManage!=='boolean'||!Array.isArray(raw.units)||raw.units.length>2000)fail()
 exact(raw.totals,['total','missing','submitted','accepted','changesRequested'])
 const totals=raw.totals as CollectionOperationsState['totals']
 if(Object.values(totals).some(n=>!Number.isSafeInteger(n)||n<0)||totals.total!==totals.missing+totals.submitted+totals.accepted+totals.changesRequested)fail()
 const ids=new Set<string>(), units=(raw.units as unknown[]).map(value=>{
  exact(value,['id','label','responsibleMemberId','version','state']);const id=identifier(value.id)
  if(ids.has(id)||!['missing','submitted','accepted','changes_requested'].includes(String(value.state)))fail();ids.add(id)
  return {id,label:text(value.label,160,true),responsibleMemberId:identifier(value.responsibleMemberId),version:version(value.version),state:value.state as CollectionOperationsState['units'][number]['state']}
 })
 if(raw.canManage&&units.length!==totals.total)fail()
 if(!raw.canManage&&units.length)fail()
 if(raw.canManage){for(const [key,state] of [['missing','missing'],['submitted','submitted'],['accepted','accepted'],['changesRequested','changes_requested']] as const)if(totals[key]!==units.filter(unit=>unit.state===state).length)fail()}
 return {requestId,version:version(raw.version),phase:raw.phase as CollectionPhase,dueDate:isoDate(raw.dueDate),canManage:raw.canManage as boolean,totals,units}
}
export function operation(raw:CollectionOperation):CollectionOperation {
 return validateLocalInput(()=>{
 if(!object(raw))throw new ServiceError('INVALID_INPUT')
 const common=['kind','requestId','expectedVersion','reason'];exact(raw,[...common,...(['reopen','extend'].includes(raw.kind)?['dueDate']:raw.kind==='remind'?['recipients']:[])])
 if(!['close','archive','reopen','extend','remind'].includes(raw.kind))throw new ServiceError('INVALID_INPUT')
 identifier(raw.requestId);version(raw.expectedVersion);text(raw.reason,1000,true)
 if('dueDate'in raw)isoDate(raw.dueDate)
 if(raw.kind==='remind'){
  if(!Array.isArray(raw.recipients)||!raw.recipients.length||raw.recipients.length>500)throw new ServiceError('INVALID_INPUT')
  const ids=new Set<string>();for(const recipient of raw.recipients){exact(recipient,['unitId','memberId','expectedVersion']);identifier(recipient.unitId);identifier(recipient.memberId);version(recipient.expectedVersion);if(ids.has(recipient.unitId))throw new ServiceError('INVALID_INPUT');ids.add(recipient.unitId)}
 }
 return structuredClone(raw)
 })
}
export function createCollectionOperations(connection:SupabaseConnection):CollectionOperationsServer {
 const rpc=createScopedRpc(connection,'collection-operations.v1')
 return {
  get(memberId,requestId){identifier(requestId);return rpc.call(memberId,'workhub_collection_operations_get',{p_request_id:requestId},raw=>operationsState(raw,requestId))},
  mutate(memberId,input,key){const command=operation(input);return rpc.call(memberId,'workhub_collection_operations_mutate',{p_command:command,p_request_key:key},raw=>{
   exact(raw,['requestKey','requestId','version','recordedAt']);if(raw.requestKey!==key||raw.requestId!==command.requestId||version(raw.version)!==command.expectedVersion+1||typeof raw.recordedAt!=='string'||!Number.isFinite(Date.parse(raw.recordedAt)))fail()
   return raw as unknown as {requestKey:string;requestId:string;version:number;recordedAt:string}
  },true)}
 }
}
