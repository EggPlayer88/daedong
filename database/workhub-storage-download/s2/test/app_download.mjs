// 격리 PG가 실제 생성한 파일·접근 응답을 현재 앱 다운로드 어댑터로 검증한다.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../../../../tests/helpers/load-browser-module.mjs'
const {createGuidedService,contextResponse}=await loadBrowserModule(`
export {createGuidedService} from '../apps/workhub/src/documents/guided-adapter'
export {contextResponse} from '../apps/workhub/src/connection/validation'`,
{env:{MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
const c=JSON.parse(readFileSync(process.argv[2],'utf8')),bytes=Buffer.from(c.bytes,'base64')
const ctx=contextResponse(c.context,c.scope.schoolId),calls=[]
let corrupt=false,changed=false,count=0
const connection={info:()=>structuredClone(ctx),getIdentity:async()=>({userId:c.scope.userId,approved:true}),rpcVerified:async(name,args)=>{
 assert.equal(name,'workhub_document_artifact_access');assert.deepEqual(args,{p_member_id:c.scope.memberId,p_artifact_id:c.access.data.artifact.artifactId})
 calls.push(name);count++
 return changed&&count===2?{contract:c.access.contract,schoolId:c.scope.schoolId,memberId:c.scope.memberId,error:{code:'NOT_FOUND'}}:structuredClone(c.access)
}}
const port={upload:async()=>{throw Error('다운로드에서 업로드 호출')},download:async path=>{
 assert.equal(path,c.access.data.path);return new Blob([corrupt?Buffer.alloc(bytes.length):bytes])
}}
const service=createGuidedService(connection,port)
const result=await service.download(c.scope.memberId,c.access.data.artifact.artifactId)
assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);console.log('PASS 실제 SQL 생성 파일을 앱이 동일 바이트로 다운로드')
assert.equal(calls.length,2);console.log('PASS 다운로드 전후 접근 권한 재확인')
corrupt=true;count=0
await assert.rejects(service.download(c.scope.memberId,c.access.data.artifact.artifactId),e=>e.code==='CONFLICT');console.log('PASS 변조된 파일 바이트 거부')
corrupt=false;changed=true;count=0
await assert.rejects(service.download(c.scope.memberId,c.access.data.artifact.artifactId),e=>e.code==='NOT_FOUND');console.log('PASS 다운로드 중 접근 회수 응답 거부')
