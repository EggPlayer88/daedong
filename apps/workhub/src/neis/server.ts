import type { Membership } from '../contracts'
import type {SupabaseConnection} from '../connection/supabase-connection'
import type {LegacySession} from '../connection/contracts'
import {activeAt} from '../domain'
import {recoveryScope} from '../services/recovery-scope'
import {canonical} from '../services/service-values'
import {eventResponse} from '../connection/validation'
import {NeisError,record,snapshot,receipt,closed,type Range,type Selection} from './contracts'
export type RefreshHttp=(body:unknown,userId:string)=>Promise<unknown>
export function createNeisHttp(options:{getSession:()=>Promise<LegacySession|null>;fetch?:typeof fetch;timeoutMs?:number}):RefreshHttp{
 return async(body,userId)=>{
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,expired=false
  const timer=setTimeout(()=>{expired=true;controller.abort();void reader?.cancel().catch(()=>{})},options.timeoutMs??55000)
  const check=async()=>{if(expired)throw new NeisError('QUERY_FAILED');const s=await options.getSession();if(expired)throw new NeisError('QUERY_FAILED');if(!s?.access_token||s.user.id!==userId)throw new NeisError('CANCELLED');return s}
  try{
   const session=await check(),response=await (options.fetch??fetch)('/api/neis/data',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal:controller.signal})
   if(!response.body)throw new NeisError('QUERY_FAILED');reader=response.body.getReader()
   let size=0;const chunks:Uint8Array[]=[]
   while(true){const v=await reader.read();if(expired)throw new NeisError('QUERY_FAILED');if(v.done)break;size+=v.value.length;if(size>12000000)throw new NeisError('INVALID_RESPONSE');chunks.push(v.value)}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));await check()
   if(!response.ok)throw new NeisError(typeof raw?.error?.code==='string'?raw.error.code:'QUERY_FAILED')
   return raw
  }catch(e){await check();throw e instanceof NeisError?e:new NeisError('QUERY_FAILED')}
  finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{})}
 }
}
export function createNeisServer(connection:SupabaseConnection,http:RefreshHttp,timeoutMs=60000){
 function scope(member:Membership){const c=connection.info(),m=c.memberships.find(x=>x.id===member.id);if(!m||recoveryScope(m)!==recoveryScope(member)||!c.schools.some(x=>x.id===m.schoolId)||!activeAt(m,c.basisDate))throw new NeisError('CANCELLED');return c}
 async function call<T>(member:Membership,writing:boolean,run:()=>Promise<T>):Promise<T>{
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined
  const check=async()=>{if(expired)throw new NeisError(writing?'RESULT_UNKNOWN':'QUERY_FAILED');scope(member);const id=await connection.getIdentity();if(expired)throw new NeisError(writing?'RESULT_UNKNOWN':'QUERY_FAILED');scope(member);if(!id?.approved||id.userId!==member.userId)throw new NeisError('CANCELLED');return canonical(id)}
  const work=async()=>{const before=await check();try{const result=await run();if(await check()!==before)throw new NeisError('CANCELLED');return result}catch(error){if(await check()!==before)throw new NeisError('CANCELLED');const code=(error as {code?:string;rpcCode?:string})?.code;if((error as {rpcCode?:string})?.rpcCode==='PGRST202')throw new NeisError('NOT_READY');throw new NeisError(['FORBIDDEN','INACTIVE_MEMBERSHIP','CONFLICT','INVALID_INPUT','IDEMPOTENCY_CONFLICT','NOT_READY','KEY_MISSING','CANCELLED'].includes(code??'')?code!:writing?'RESULT_UNKNOWN':'QUERY_FAILED')}}
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new NeisError(writing?'RESULT_UNKNOWN':'QUERY_FAILED'))},timeoutMs)})])}finally{expired=true;clearTimeout(timer)}
 }
 return{
  read(member:Membership,r:Range){return call(member,false,async()=>snapshot(await connection.rpcVerified('workhub_neis_status',{p_member_id:member.id,p_kind:r.kind,p_year:r.year,p_from:r.from,p_to:r.to}),r,member,scope(member).memberships))},
  refresh(member:Membership,r:Range){return call(member,false,async()=>snapshot(record(await http({memberId:member.id,...r},member.userId)).data,r,member,scope(member).memberships))},
  events(member:Membership){return call(member,false,async()=>{const v=await connection.rpcVerified('workhub_calendar_list',{p_member_id:member.id});if(!Array.isArray(v)||v.length>20000)throw new NeisError('INVALID_RESPONSE');return v.map(x=>eventResponse(x,member.schoolId,scope(member).memberships))})},
  close(member:Membership,selections:Selection[],key:string){return call(member,true,async()=>closed(await connection.rpcVerified('workhub_neis_close',{p_member_id:member.id,p_selections:selections,p_request_key:key}),key,selections,member,scope(member).memberships))},
  apply(member:Membership,selections:Selection[],key:string){return call(member,true,async()=>receipt(await connection.rpcVerified('workhub_neis_apply',{p_member_id:member.id,p_selections:selections,p_request_key:key}),key,selections,member,scope(member).memberships))}
 }
}
export type NeisServer=ReturnType<typeof createNeisServer>
