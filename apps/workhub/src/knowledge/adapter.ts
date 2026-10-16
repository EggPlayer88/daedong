import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, text } from '../services/scoped-rpc'
import { KNOWLEDGE_CONTRACT, knowledgeCommand, knowledgeList, knowledgeReceipt, type KnowledgeCommand } from './contracts'
export function createKnowledgeService(connection:SupabaseConnection){
 const rpc=createScopedRpc(connection,KNOWLEDGE_CONTRACT)
 return{
  list(memberId:string,query:string,cursor:string|null=null){return rpc.call(memberId,'workhub_knowledge_list',{p_query:text(query,200),p_cursor:cursor===null?null:text(cursor,2000,true)},knowledgeList)},
  mutate(memberId:string,command:KnowledgeCommand,key:string){const value=knowledgeCommand(command);return rpc.call(memberId,'workhub_knowledge_mutate',{p_command:value,p_request_key:key},raw=>knowledgeReceipt(raw,key,value),true)},
 }
}
export type KnowledgeService=ReturnType<typeof createKnowledgeService>
