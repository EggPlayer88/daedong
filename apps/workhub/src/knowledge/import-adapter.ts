import type {SupabaseConnection} from '../connection/supabase-connection'
import {recoveryScope} from '../app/pending-requests'
import {createScopedRpc,exact,identifier,object,ServiceError,text,version} from '../services/scoped-rpc'
import {createScopedFileOperation} from '../services/scoped-file-operation'
import {blobSha,createGuidedHttp} from '../documents/guided-adapter'
import {sha} from '../documents/guided-contracts'
import fileLimits from '../../../main/api/collections/_assets/hwpx-basic.json'
import {KNOWLEDGE_FILE_BUCKET,KNOWLEDGE_IMPORT_CONTRACT,importCommit,importResult,type ImportCommit} from './import-contracts'
export interface KnowledgeImportPort{upload(path:string,file:File):Promise<void>;extract(input:{memberId:string;fileId:string;requestKey:string},userId:string):Promise<unknown>;download(path:string):Promise<Blob>}
export const legacyKnowledgeImportPort:KnowledgeImportPort={async upload(path,file){const{supabase}=await import('@daedong/shared');const{error}=await supabase.storage.from(KNOWLEDGE_FILE_BUCKET).upload(path,file,{upsert:false,cacheControl:'0',contentType:'application/hwp+zip'});if(error)throw new ServiceError('RESULT_UNKNOWN')},extract:createGuidedHttp({getSession:async()=>(await import('@daedong/shared')).getSession(),route:'/api/workhub-documents/extract-knowledge'}),async download(path){const{supabase}=await import('@daedong/shared');const{error,data}=await supabase.storage.from(KNOWLEDGE_FILE_BUCKET).download(path);if(error||!(data instanceof Blob))throw new ServiceError('QUERY_FAILED');return data}}
export function createKnowledgeImportService(connection:SupabaseConnection,port:KnowledgeImportPort=legacyKnowledgeImportPort,options:{timeoutMs?:number}={}){
 const rpc=createScopedRpc(connection,KNOWLEDGE_IMPORT_CONTRACT),reserved=new Map<string,{path:string;sha:string;bytes:number;scope:string}>()
 const bounded=createScopedFileOperation(connection,options)
 const member=(id:string)=>{const m=connection.info().memberships.find(m=>m.id===id);if(!m)throw new ServiceError('INACTIVE_MEMBERSHIP');return m}
 async function identity(id:string,scope:string){let current;try{current=await connection.getIdentity()}catch{throw new ServiceError('CANCELLED')}const m=member(id);if(!current?.approved||current.userId!==m.userId||recoveryScope(m)!==scope)throw new ServiceError('CANCELLED')}
 const receipt=(raw:unknown,key:string)=>{exact(raw,['id','version','requestKey','recordedAt']);if(raw.requestKey!==key||raw.version!==1||typeof raw.recordedAt!=='string'||!Number.isFinite(Date.parse(raw.recordedAt)))throw new ServiceError('INVALID_RESPONSE');return{id:identifier(raw.id),version:1,requestKey:key,recordedAt:raw.recordedAt}}
 return{
  ready(memberId:string){return rpc.call(memberId,'workhub_knowledge_import_readiness',{},raw=>{exact(raw,['available']);if(typeof raw.available!=='boolean')throw new ServiceError('INVALID_RESPONSE');return raw.available})},
  async prepare(memberId:string,file:File,key:string,replayOnly=false){
   if(!/\.hwpx$/i.test(file.name)||/[<>:"/\\|?*\u0000-\u001f]/.test(file.name)||!file.size||file.size>fileLimits.maxFileBytes)throw new ServiceError('INVALID_INPUT')
   return bounded(async guard=>{const hash=await blobSha(file);guard();return rpc.call(memberId,replayOnly?'workhub_knowledge_file_prepare_get':'workhub_knowledge_file_prepare',{p_file:{name:file.name,bytes:file.size,sha256:hash},p_request_key:key},(raw,m)=>{guard();exact(raw,['fileId','fileVersion','bucket','path','bytes','sha256','uploaded']);const fileId=identifier(raw.fileId),path=`${m.schoolId}/${m.id}/${fileId}/original.hwpx`;if(raw.bucket!==KNOWLEDGE_FILE_BUCKET||raw.path!==path||raw.bytes!==file.size||raw.sha256!==hash||typeof raw.uploaded!=='boolean')throw new ServiceError('INVALID_RESPONSE');reserved.set(memberId+':'+fileId,{path,bytes:file.size,sha:hash,scope:recoveryScope(m)});return{fileId,fileVersion:version(raw.fileVersion),uploaded:raw.uploaded}},!replayOnly,guard)},replayOnly?'QUERY_FAILED':'RESULT_UNKNOWN',memberId)
  },
  async upload(memberId:string,fileId:string,file:File){return bounded(async guard=>{
   const saved=reserved.get(memberId+':'+fileId);if(!saved||saved.scope!==recoveryScope(member(memberId))||file.size!==saved.bytes)throw new ServiceError('INVALID_INPUT')
   const hash=await blobSha(file);guard();if(hash!==saved.sha)throw new ServiceError('INVALID_INPUT')
   await identity(memberId,saved.scope);guard();await port.upload(saved.path,file);guard();await identity(memberId,saved.scope);guard()
  },'RESULT_UNKNOWN',memberId)},
  async extract(memberId:string,fileId:string,key:string,replayOnly=false){
   const check=(raw:unknown)=>{const value=importResult(raw,fileId),reservation=reserved.get(memberId+':'+fileId);if(reservation&&(reservation.sha!==value.extraction.fileSha256||reservation.scope!==recoveryScope(member(memberId))))throw new ServiceError('CONFLICT');return value}
   if(replayOnly)return rpc.call(memberId,'workhub_knowledge_file_extract_get',{p_file_id:identifier(fileId),p_request_key:key},check)
   return bounded(async guard=>{const original=member(memberId),scope=recoveryScope(original);await identity(memberId,scope);guard();const raw=await port.extract({memberId,fileId:identifier(fileId),requestKey:identifier(key)},original.userId);guard();await identity(memberId,scope);guard();if(!object(raw)||raw.contract!==KNOWLEDGE_IMPORT_CONTRACT||raw.schoolId!==original.schoolId||raw.memberId!==memberId)throw new ServiceError('INVALID_RESPONSE');exact(raw,['contract','schoolId','memberId','data']);return check(raw.data)},'RESULT_UNKNOWN',memberId,options.timeoutMs??fileLimits.checkTimeoutMs)
  },
  commit(memberId:string,input:ImportCommit,key:string,replayOnly=false){const checked=importCommit(input);return rpc.call(memberId,replayOnly?'workhub_knowledge_import_request_get':'workhub_knowledge_import_commit',{p_import:checked,p_request_key:key},raw=>receipt(raw,key),!replayOnly)},
  async original(memberId:string,sourceId:string,sourceVersion:number){
   return bounded(async guard=>{
    const access=()=>rpc.call(memberId,'workhub_knowledge_original_access',{p_source_id:identifier(sourceId),p_source_version:version(sourceVersion)},(raw,m)=>{if(object(raw)&&raw.available===false){exact(raw,['available']);return null}exact(raw,['available','sourceId','sourceVersion','fileId','fileVersion','ownerMemberId','bucket','path','name','bytes','sha256','extractionSha256']);const fileId=identifier(raw.fileId),owner=identifier(raw.ownerMemberId),name=text(raw.name,240,true);if(raw.available!==true||raw.sourceId!==sourceId||raw.sourceVersion!==sourceVersion||raw.bucket!==KNOWLEDGE_FILE_BUCKET||raw.path!==`${m.schoolId}/${owner}/${fileId}/original.hwpx`||typeof raw.bytes!=='number'||!Number.isSafeInteger(raw.bytes)||raw.bytes<1||raw.bytes>fileLimits.maxFileBytes||!/\.hwpx$/i.test(name)||/[<>:"/\\|?*\u0000-\u001f]/.test(name))throw new ServiceError('INVALID_RESPONSE');return{fileId,fileVersion:version(raw.fileVersion),name,path:raw.path as string,bytes:raw.bytes,sha256:sha(raw.sha256),extractionSha256:sha(raw.extractionSha256)}},false,guard)
    const first=await access();guard();if(!first)return null;const blob=await port.download(first.path);guard();if(!(blob instanceof Blob)||blob.size!==first.bytes)throw new ServiceError('CONFLICT');const hash=await blobSha(blob);guard();if(hash!==first.sha256)throw new ServiceError('CONFLICT');const second=await access();guard();if(JSON.stringify(first)!==JSON.stringify(second))throw new ServiceError('CONFLICT');return{blob,name:first.name,fileVersion:first.fileVersion}
   },'QUERY_FAILED',memberId)
  },
 }
}
export type KnowledgeImportService=ReturnType<typeof createKnowledgeImportService>
