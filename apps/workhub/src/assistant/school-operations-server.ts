import type {SupabaseConnection} from '../connection/supabase-connection'
import {recoveryScope} from '../app/pending-requests'
import {activeAt} from '../domain'
import {canonical,identifier} from '../services/scoped-rpc'
import {AssistantError,assistantError,assistantLocalInput} from './contracts'
import type {AssistantHttpPort} from './http'
import {operationsCursor,schoolAiOperations,schoolAiDiagnostics,type SchoolAiOperationsServer} from './school-operations-contracts'

// 목록과 진단은 읽기만 한다. 응답을 받기 전후 현재 계정·소속·권한을 확인한다.
export function createSchoolAiOperationsServer(connection:SupabaseConnection,http:AssistantHttpPort,options:{timeoutMs?:number}={}):SchoolAiOperationsServer {
 const timeoutMs=options.timeoutMs??55000
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new AssistantError('INVALID_INPUT')
 function scope(memberId:string){assistantLocalInput(()=>identifier(memberId));const context=connection.info(),member=context.memberships.find(m=>m.id===memberId);if(!member||!context.schools.some(s=>s.id===member.schoolId)||!activeAt(member,context.basisDate))throw new AssistantError('INACTIVE_MEMBERSHIP');return{member,fingerprint:recoveryScope(member)}}
 async function read<T>(memberId:string,payload:unknown,parse:(raw:unknown,expected:{schoolId:string;memberId:string})=>T):Promise<T>{
  const initial=scope(memberId);let expired=false,timer:ReturnType<typeof setTimeout>|undefined
  const guard=()=>{if(expired)throw new AssistantError('QUERY_FAILED')}
  async function current(){guard();const identity=await connection.getIdentity();guard();if(!identity?.approved||identity.userId!==initial.member.userId||scope(memberId).fingerprint!==initial.fingerprint)throw new AssistantError('CANCELLED');return canonical([identity.userId,identity.approved,identity.profile?.role,identity.profile?.is_active,identity.profile?.department_id,[...(identity.profile?.extra_permissions??[])].sort()])}
  async function run(){const before=await current();let raw:unknown;try{raw=await http.send(payload,initial.member.userId,false)}catch(error){if(await current()!==before)throw new AssistantError('CANCELLED');throw assistantError(error,'QUERY_FAILED')}guard();if(await current()!==before)throw new AssistantError('CANCELLED');try{return parse(raw,{schoolId:initial.member.schoolId,memberId})}catch{throw new AssistantError('INVALID_RESPONSE')}}
  try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new AssistantError('QUERY_FAILED'))},timeoutMs)})])}finally{expired=true;clearTimeout(timer)}
 }
 return{
  list(memberId,raw=null){const cursor=operationsCursor(raw);return read(memberId,{action:'list',memberId,cursor},(value,expected)=>schoolAiOperations(value,expected,cursor))},
  diagnostics(memberId){return read(memberId,{action:'diagnostics',memberId},schoolAiDiagnostics)},
 }
}
