import type { SupabaseConnection } from '../connection/supabase-connection'
import { identifier, ServiceError, text, validateLocalInput, version } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import { KNOWLEDGE_CONTRACT, knowledgeCommand, knowledgeHistory, knowledgeList, knowledgeReceipt, knowledgeRevision, type KnowledgeCommand } from './contracts'
export function createKnowledgeService(connection:SupabaseConnection){
 const rpc=createScopedRpc(connection,KNOWLEDGE_CONTRACT)
 const checkedVersion=(value:number)=>validateLocalInput(()=>{const v=version(value);if(v>2147483647)throw new ServiceError('INVALID_INPUT');return v})
 return{
  list(memberId:string,query:string,cursor:string|null=null){return rpc.call(memberId,'workhub_knowledge_list',{p_query:text(query,200),p_cursor:cursor===null?null:text(cursor,2000,true)},knowledgeList)},
  get(memberId:string,sourceId:string,sourceVersion:number){const id=identifier(sourceId),v=checkedVersion(sourceVersion);return rpc.call(memberId,'workhub_knowledge_get',{p_source_id:id,p_source_version:v},(raw,member)=>knowledgeRevision(raw,member,id,v))},
  history(memberId:string,sourceId:string,beforeVersion:number|null=null){const id=identifier(sourceId),before=beforeVersion===null?null:checkedVersion(beforeVersion);return rpc.call(memberId,'workhub_knowledge_history',{p_source_id:id,p_before_version:before},(raw,member)=>knowledgeHistory(raw,member,id,before))},
  mutate(memberId:string,command:KnowledgeCommand,key:string){const value=knowledgeCommand(command);return rpc.call(memberId,'workhub_knowledge_mutate',{p_command:value,p_request_key:key},raw=>knowledgeReceipt(raw,key,value),true)},
 }
}
export type KnowledgeService=ReturnType<typeof createKnowledgeService>
