import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {createClient} from '@supabase/supabase-js'
import {loadSecrets,SANDBOX_REF} from './environment.mjs'
const root=dirname(process.argv[2]),config=loadSecrets(process.argv[2]),people=JSON.parse(readFileSync(join(root,'accounts.json'))),school=JSON.parse(readFileSync(join(root,'school.json')))
const output=join(root,'message-tools.mjs')
await build({stdin:{contents:`export * from './apps/workhub/src/messaging/validation';export {messageFileReadiness,messageFileStatus} from './apps/workhub/src/messaging/files';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:output,define:{'import.meta.env':'{}'}})
const v=await import(pathToFileURL(resolve(output)).href)
async function actor(person){const client=createClient(`https://${SANDBOX_REF}.supabase.co`,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}}),{data,error}=await client.auth.signInWithPassword({email:person.email,password:person.password});assert.equal(error,null);return {person,client,token:data.session.access_token,scope:{schoolId:school.schoolId,memberId:person.memberId,userId:person.userId}}}
async function rpc(a,name,args={}){const {data,error}=await a.client.rpc(name,{p_member_id:a.person.memberId,...args});assert.equal(error,null);return v.envelope(data,a.scope)}
const sender=await actor(people.find(x=>x.role==='administrator_teacher')),receiver=await actor(people.find(x=>x.role==='teacher'))
const bytes=readFileSync('examples/예시_2026학년도_2학기_3학년_수학_평가계획서.hwpx'),sha=createHash('sha256').update(bytes).digest('hex')
const policy=v.messageFileReadiness(await rpc(sender,'workhub_message_file_readiness'));assert.equal(policy.reason,'ready')
const intent=await rpc(sender,'workhub_message_file_prepare',{p_file:{name:'가상학교_연결확인.hwpx',claimedBytes:bytes.length,claimedSha256:sha},p_request_key:'sandbox-file-smoke-prepare',p_replay_only:false})
if(intent.state==='awaiting_upload'){
 const {error}=await sender.client.storage.from(intent.bucket).upload(intent.path,bytes,{upsert:false,contentType:'application/octet-stream',cacheControl:'0'});assert.equal(error,null)
}
let file=v.messageFileStatus(await rpc(sender,'workhub_message_file_complete',{p_file_id:intent.fileId,p_request_key:'sandbox-file-smoke-complete'}),intent.fileId)
if(file.state==='pending_basic'){
 const response=await fetch('https://daedong-year-sandbox.vercel.app/api/messages/check-hwpx',{method:'POST',headers:{Authorization:'Bearer '+sender.token,'Content-Type':'application/json'},body:JSON.stringify({memberId:sender.person.memberId,fileId:intent.fileId,requestKey:'sandbox-file-smoke-complete'})}),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));file=v.messageFileStatus(v.envelope(data,sender.scope),intent.fileId)
}
assert.equal(file.state,'ready')
const recipients=await rpc(sender,'workhub_message_recipients',{p_query:receiver.person.name,p_cursor:null}),recipient=recipients.items.find(x=>x.memberId===receiver.person.memberId);assert.ok(recipient)
const command={kind:'start',mode:'direct',recipients:[{memberId:recipient.memberId,expectedVersion:recipient.version}],title:'복제 사이트 연결 확인',body:'준비 단계에서 보낸 시험 메시지입니다. 일반 교사 수신·읽음·HWPX 원본 확인용입니다.',attachmentIds:[file.file.id]},key='sandbox-message-smoke-send'
const sent=v.receipt(await rpc(sender,'workhub_message_mutate',{p_command:command,p_request_key:key,p_replay_only:false}),command,key,sender.person.memberId),delivery=sent.deliveries[0]
const page=v.messages(await rpc(receiver,'workhub_message_get',{p_thread_id:delivery.threadId,p_before_cursor:null}),receiver.scope,delivery.threadId);assert.equal(page.items[0].attachments[0].sha256,sha)
const access=await rpc(receiver,'workhub_message_file_access',{p_thread_id:delivery.threadId,p_message_id:delivery.messageId,p_file_id:file.file.id})
const downloaded=await receiver.client.storage.from(access.bucket).download(access.path);assert.equal(downloaded.error,null)
assert.equal(createHash('sha256').update(Buffer.from(await downloaded.data.arrayBuffer())).digest('hex'),sha)
const read={kind:'read_thread',threadId:delivery.threadId,throughSequence:delivery.sequence},readKey='sandbox-message-smoke-read'
v.receipt(await rpc(receiver,'workhub_message_mutate',{p_command:read,p_request_key:readKey,p_replay_only:false}),read,readKey,receiver.person.memberId)
const after=v.messages(await rpc(receiver,'workhub_message_get',{p_thread_id:delivery.threadId,p_before_cursor:null}),receiver.scope,delivery.threadId);assert.equal(after.thread.unreadCount,0)
const result={at:new Date().toISOString(),from:sender.person.teacherId,to:receiver.person.teacherId,threadId:delivery.threadId,messageId:delivery.messageId,fileId:file.file.id,bytes:bytes.length,sha256:sha,checks:['Storage 업로드','Vercel HWPX 확인','일반 교사 수신','일반 교사 다운로드','SHA-256 원본 일치','읽음 반영'],result:'PASS'}
writeFileSync(join(root,'live-files-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
