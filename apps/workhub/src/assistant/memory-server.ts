import type {SupabaseConnection} from '../connection/supabase-connection'
import {canonical,createScopedRpc,identifier,ServiceError,validateLocalInput} from '../services/scoped-rpc'
import {MEMORY_CONTRACT,memoryCommand,memoryList,memoryReferences,memorySelection,memoryReceipt,memoryResult,type MemoryCommand,type MemoryService} from './memory-contracts'

export function createAiMemoryService(connection:SupabaseConnection,options:{timeoutMs?:number}={}):MemoryService{
 const rpc=createScopedRpc(connection,MEMORY_CONTRACT,options)
 const attempts=new Map<string,string>()
 function request(memberId:string,command:MemoryCommand,key:string){
  return validateLocalInput(()=>{
   const checked=memoryCommand(command)
   if(canonical(checked)!==canonical(command)||identifier(key).length<8)throw new ServiceError('INVALID_INPUT')
   const attempt=identifier(memberId)+':'+key,body=canonical(checked)
   if(attempts.has(attempt)&&attempts.get(attempt)!==body)throw new ServiceError('IDEMPOTENCY_CONFLICT')
   attempts.set(attempt,body)
   return{p_command:checked,p_request_key:key}
  })
 }
 return{
  list(memberId){return rpc.call(memberId,'workhub_ai_memory_list',{},memoryList)},
  select(memberId,references){const selected=memoryReferences(references);return rpc.call(memberId,'workhub_ai_memory_select',{p_references:selected},(raw,member)=>memorySelection(raw,member,selected))},
  mutate(memberId,command,key){const args=request(memberId,command,key);return rpc.call(memberId,'workhub_ai_memory_mutate',args,raw=>memoryReceipt(raw,args.p_command,key),true)},
  recover(memberId,command,key){const args=request(memberId,command,key);return rpc.call(memberId,'workhub_ai_memory_recover',args,raw=>memoryResult(raw,args.p_command,key))},
  close(memberId,command,key){const args=request(memberId,command,key);return rpc.call(memberId,'workhub_ai_memory_close',args,raw=>{
   const result=memoryResult(raw,args.p_command,key,false)
   if(result.state==='missing')throw new ServiceError('INVALID_RESPONSE')
   return result
  },true)},
 }
}
