import {createCollectionPresentation} from '../collections/presentation'
import type {LegacySession} from '../connection/contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../services/recovery-scope'
import { exact, identifier, object, ServiceError, text, version } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import { createScopedFileOperation } from '../services/scoped-file-operation'
import fileLimits from '../../../main/api/collections/_assets/hwpx-basic.json'
import { publicationTargets, artifact, detail, GUIDED_BUCKET, GUIDED_CONTRACT, guidedCommand, guidedReceipt, inspection, sha, template, type CollectionTarget, type GuidedCommand, type GuidedHttpInput } from './guided-contracts'

export interface GuidedPort {upload(path:string,file:File):Promise<void>;download(path:string):Promise<Blob>;run(input:GuidedHttpInput,userId:string):Promise<unknown>}
export function createGuidedHttp(options:{getSession:()=>Promise<LegacySession|null>;fetch?:typeof fetch;route?:'/api/workhub-documents/guided'|'/api/workhub-documents/extract-knowledge'}){
 if(options.route&&!['/api/workhub-documents/guided','/api/workhub-documents/extract-knowledge'].includes(options.route))throw new ServiceError('INVALID_INPUT')
 return async(input:GuidedHttpInput|{memberId:string;fileId:string;requestKey:string},userId:string):Promise<unknown>=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,stopped=false
  const identity=async()=>{const session=await options.getSession();if(stopped)throw new ServiceError('RESULT_UNKNOWN');if(!session?.access_token||session.user.id!==userId)throw new ServiceError('CANCELLED');return session}
  async function run(){const session=await identity();const response=await(options.fetch??fetch)(options.route??'/api/workhub-documents/guided',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});await identity();if(!response.body)throw new ServiceError('RESULT_UNKNOWN');reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;while(true){const next=await reader.read();if(stopped)throw new ServiceError('RESULT_UNKNOWN');if(next.done)break;bytes+=next.value.length;if(bytes>4*1024*1024)throw new ServiceError('INVALID_RESPONSE');chunks.push(next.value)}const raw=new Uint8Array(bytes);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length}const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));await identity();if(!response.ok){if(response.status===401||response.status===403)throw new ServiceError('FORBIDDEN');if(object(result)&&Object.keys(result).length===1&&object(result.error)&&Object.keys(result.error).length===1&&['NOT_READY','CONFLICT','INVALID_INPUT','NOT_FOUND','IDEMPOTENCY_CONFLICT'].includes(String(result.error.code)))throw new ServiceError(result.error.code as ServiceError['code']);throw new ServiceError('RESULT_UNKNOWN')}return result}
  try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{stopped=true;controller.abort();reject(new ServiceError('RESULT_UNKNOWN'))},55000)})])}catch(error){throw error instanceof ServiceError?error:new ServiceError('RESULT_UNKNOWN')}finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{})}
 }
}
export const legacyGuidedPort:GuidedPort={
 async upload(path,file){const{supabase}=await import('@daedong/shared');const{error}=await supabase.storage.from(GUIDED_BUCKET).upload(path,file,{upsert:false,cacheControl:'0',contentType:'application/hwp+zip'});if(error)throw new ServiceError('RESULT_UNKNOWN')},
 async download(path){const{supabase}=await import('@daedong/shared');const{data,error}=await supabase.storage.from(GUIDED_BUCKET).download(path);if(error||!(data instanceof Blob))throw new ServiceError('QUERY_FAILED');return data},
 run:createGuidedHttp({getSession:async()=>(await import('@daedong/shared')).getSession()}),
}
export const blobSha=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('')
export function createGuidedService(connection:SupabaseConnection,port:GuidedPort=legacyGuidedPort,options:{timeoutMs?:number}={}){
 const extra=createCollectionPresentation(connection).rpc
 const rpc=createScopedRpc(connection,GUIDED_CONTRACT),reservations=new Map<string,{path:string;sha256:string;bytes:number;scope:string}>()
 const bounded=createScopedFileOperation(connection,options)
 const member=(memberId:string)=>{const current=connection.info().memberships.find(m=>m.id===memberId);if(!current)throw new ServiceError('INACTIVE_MEMBERSHIP');return current}
 async function run(input:GuidedHttpInput){const original=member(input.memberId),scope=recoveryScope(original);const raw=await port.run(input,original.userId);let current;try{current=await connection.getIdentity()}catch{throw new ServiceError('CANCELLED')}if(!current?.approved||current.userId!==original.userId||recoveryScope(member(input.memberId))!==scope)throw new ServiceError('CANCELLED');if(!object(raw)||raw.contract!==GUIDED_CONTRACT||raw.schoolId!==original.schoolId||raw.memberId!==original.id)throw new ServiceError('INVALID_RESPONSE');exact(raw,['contract','schoolId','memberId','data']);return raw.data}
 return{
  list(memberId:string,cursor:string|null=null){return rpc.call(memberId,'workhub_template_list',{p_cursor:cursor===null?null:text(cursor,2000,true)},(value,m)=>{exact(value,['items','nextCursor','canCreate']);if(!Array.isArray(value.items)||value.items.length>50||typeof value.canCreate!=='boolean')throw new ServiceError('INVALID_RESPONSE');const items=value.items.map(v=>template(v,m));if(new Set(items.map(t=>t.id)).size!==items.length)throw new ServiceError('INVALID_RESPONSE');const next=value.nextCursor===null?null:text(value.nextCursor,2000,true);if(cursor&&cursor===next)throw new ServiceError('INVALID_RESPONSE');return{items,nextCursor:next,canCreate:value.canCreate}})},
  get(memberId:string,id:string){return rpc.call(memberId,'workhub_template_get',{p_template_id:identifier(id)},(value,m)=>detail(value,m,id))},
  targets(memberId:string){return rpc.call(memberId,'workhub_template_collection_targets',{},value=>{exact(value,['items']);if(!Array.isArray(value.items)||value.items.length>200)throw new ServiceError('INVALID_RESPONSE');const items:CollectionTarget[]=value.items.map(v=>{exact(v,['requestId','title','version']);return{requestId:identifier(v.requestId),title:text(v.title,200,true),version:version(v.version)}});if(new Set(items.map(t=>t.requestId)).size!==items.length)throw new ServiceError('INVALID_RESPONSE');return items})},
  publicationTargets(memberId:string){return extra.call(memberId,'workhub_collection_presentation',{p_operation:'targets',p_input:{},p_request_key:null},publicationTargets)},
  async prepare(memberId:string,file:File,title:string,key:string,replayOnly=false){
   if(!/\.hwpx$/i.test(file.name)||/[<>:"/\\|?*\u0000-\u001f]/.test(file.name)||!file.size||file.size>fileLimits.maxFileBytes)throw new ServiceError('INVALID_INPUT')
   return bounded(async guard=>{
    const hash=await blobSha(file);guard()
    const result=await rpc.call(memberId,replayOnly?'workhub_template_prepare_get':'workhub_template_prepare',{p_file:{name:file.name,bytes:file.size,sha256:hash},p_title:text(title,200,true),p_request_key:key},(value,m)=>{guard();exact(value,['templateId','templateVersion','bucket','path','bytes','sha256','uploaded']);const id=identifier(value.templateId),path=`${m.schoolId}/${m.id}/${id}/source.hwpx`;if(value.bucket!==GUIDED_BUCKET||value.path!==path||value.bytes!==file.size||value.sha256!==hash||typeof value.uploaded!=='boolean')throw new ServiceError('INVALID_RESPONSE');reservations.set(m.id+':'+id,{path,bytes:file.size,sha256:hash,scope:recoveryScope(m)});return{templateId:id,templateVersion:version(value.templateVersion),path,uploaded:value.uploaded}},!replayOnly,guard)
    guard();return result
   },replayOnly?'QUERY_FAILED':'RESULT_UNKNOWN',memberId)
  },
  async upload(memberId:string,templateId:string,file:File){return bounded(async guard=>{
   const original=member(memberId),scope=recoveryScope(original),reservation=reservations.get(memberId+':'+templateId)
   if(!reservation||reservation.scope!==scope||file.size!==reservation.bytes)throw new ServiceError('INVALID_INPUT')
   const hash=await blobSha(file);guard();if(hash!==reservation.sha256)throw new ServiceError('INVALID_INPUT')
   const identity=await connection.getIdentity();guard();if(!identity?.approved||identity.userId!==original.userId||recoveryScope(member(memberId))!==scope)throw new ServiceError('CANCELLED')
   await port.upload(reservation.path,file);guard()
   let current;try{current=await connection.getIdentity()}catch{throw new ServiceError('CANCELLED')}
   guard();if(!current?.approved||current.userId!==original.userId||recoveryScope(member(memberId))!==scope)throw new ServiceError('CANCELLED')
  },'RESULT_UNKNOWN',memberId)},
  async inspect(memberId:string,id:string,expectedVersion:number,key:string){const value=await run({action:'inspect',memberId,templateId:identifier(id),templateVersion:version(expectedVersion),responseId:null,responseVersion:null,requestKey:identifier(key)});exact(value,['templateId','templateVersion','inspection']);if(value.templateId!==id||value.templateVersion!==expectedVersion)throw new ServiceError('INVALID_RESPONSE');return inspection(value.inspection)},
  mutate(memberId:string,command:GuidedCommand,key:string){const checked=guidedCommand(command);if(checked.kind==='publish_collection')return extra.call(memberId,'workhub_collection_presentation',{p_operation:'publish',p_input:checked,p_request_key:key},value=>guidedReceipt(value,key,checked),true);return rpc.call(memberId,'workhub_template_mutate',{p_command:checked,p_request_key:key},value=>guidedReceipt(value,key,checked),true)},
  recover(memberId:string,command:GuidedCommand,key:string){const checked=guidedCommand(command);if(checked.kind==='publish_collection')return extra.call(memberId,'workhub_collection_presentation',{p_operation:'recover',p_input:checked,p_request_key:key},value=>guidedReceipt(value,key,checked));return rpc.call(memberId,'workhub_template_request_get',{p_command:checked,p_request_key:key},value=>guidedReceipt(value,key,checked))},
  recoverOperation(memberId:string,input:Omit<GuidedHttpInput,'memberId'>){return rpc.call(memberId,'workhub_template_operation_get',{p_operation:input},value=>{if(input.action==='inspect'){exact(value,['templateId','templateVersion','inspection']);if(value.templateId!==input.templateId||value.templateVersion!==input.templateVersion)throw new ServiceError('INVALID_RESPONSE');inspection(value.inspection);return value}const result=artifact(value);if(result.templateId!==input.templateId||result.templateVersion!==input.templateVersion||result.responseId!==input.responseId||result.responseVersion!==input.responseVersion)throw new ServiceError('INVALID_RESPONSE');return result})},
  async render(memberId:string,templateId:string,templateVersion:number,responseId:string,responseVersion:number,key:string){const value=artifact(await run({action:'render',memberId,templateId:identifier(templateId),templateVersion:version(templateVersion),responseId:identifier(responseId),responseVersion:version(responseVersion),requestKey:identifier(key)}));if(value.templateId!==templateId||value.templateVersion!==templateVersion||value.responseId!==responseId||value.responseVersion!==responseVersion)throw new ServiceError('INVALID_RESPONSE');return value},
  async download(memberId:string,artifactId:string){
   const access=(guard:()=>void)=>rpc.call(memberId,'workhub_document_artifact_access',{p_artifact_id:identifier(artifactId)},(value,m)=>{exact(value,['artifact','bucket','path','ownerMemberId']);const a=artifact(value.artifact);if(a.artifactId!==artifactId||value.bucket!==GUIDED_BUCKET||value.path!==`${m.schoolId}/${identifier(value.ownerMemberId)}/${artifactId}/output.hwpx`)throw new ServiceError('INVALID_RESPONSE');return{artifact:a,path:value.path as string,ownerMemberId:value.ownerMemberId}},false,guard)
   return bounded(async guard=>{
    const first=await access(guard);guard();const blob=await port.download(first.path);guard()
    if(!(blob instanceof Blob)||blob.size!==first.artifact.bytes)throw new ServiceError('CONFLICT')
    const hash=await blobSha(blob);guard();if(hash!==first.artifact.sha256)throw new ServiceError('CONFLICT')
    const second=await access(guard);guard();if(JSON.stringify(first)!==JSON.stringify(second))throw new ServiceError('CONFLICT');return blob
   },'QUERY_FAILED',memberId)
  },
 }
}
export type GuidedService=ReturnType<typeof createGuidedService>
