// 실제 SQL의 과거판 접근 응답과 원문 바이트를 현재 앱 어댑터에 넣는다.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../../../../tests/helpers/load-browser-module.mjs'
const {createKnowledgeImportService,contextResponse}=await loadBrowserModule(`
export {createKnowledgeImportService} from '../apps/workhub/src/knowledge/import-adapter'
export {contextResponse} from '../apps/workhub/src/connection/validation'`,
{env:{MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
const c=JSON.parse(readFileSync(process.argv[2],'utf8')),bytes=Buffer.from(c.bytes,'base64')
const ctx=contextResponse(c.context,c.scope.schoolId)
let corrupt=false,changed=false,count=0
const connection={info:()=>structuredClone(ctx),getIdentity:async()=>({userId:c.scope.userId,approved:true}),rpcVerified:async(name,args)=>{
 assert.equal(name,'workhub_knowledge_original_access')
 assert.deepEqual(args,{p_member_id:c.scope.memberId,p_source_id:c.sourceId,p_source_version:c.sourceVersion})
 count++
 return changed&&count===2?{contract:c.access.contract,schoolId:c.scope.schoolId,memberId:c.scope.memberId,error:{code:'NOT_FOUND'}}:structuredClone(c.access)
}}
const service=createKnowledgeImportService(connection,{upload:async()=>{throw Error('읽기 중 쓰기')},extract:async()=>{throw Error('읽기 중 재추출')},download:async path=>{
 assert.equal(path,c.access.data.path);return new Blob([corrupt?Buffer.alloc(bytes.length):bytes])
}})
const get=()=>service.original(c.scope.memberId,c.sourceId,c.sourceVersion)
const result=await get()
assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),bytes)
assert.equal(count,2);assert.equal(result.name,c.access.data.name)
console.log('PASS 과거판 원본의 실제 SQL 응답·파일명·바이트 보존 및 전후 접근 재확인')
corrupt=true;count=0
await assert.rejects(get(),e=>e.code==='CONFLICT');console.log('PASS 원본 바이트 변조 거부')
corrupt=false;changed=true;count=0
await assert.rejects(get(),e=>e.code==='NOT_FOUND');console.log('PASS 다운로드 중 접근 회수 거부')
