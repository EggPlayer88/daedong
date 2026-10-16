// 실제 첨부 화면·전송 어댑터를 합성 P3 응답으로 검증한다. 운영 DB와 Storage를 호출하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{MessageAttachments}from'./apps/workhub/src/messaging/MessageAttachments';
import{createMessageFileServer}from'./apps/workhub/src/messaging/files';
import{PendingRequestsProvider,createPendingRequests,recoveryScope}from'./apps/workhub/src/app/pending-requests';
const member={id:'teacher',userId:'user',schoolId:'school',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
const policy={extensions:['hwpx'],maxFileBytes:1024,maxFiles:2},scope={schoolId:'school',memberId:'teacher',userId:'user'};
window.calls=[];window.uploads=0;window.checks=0;window.state='awaiting_upload';window.fileCount=0;window.failed=false;window.files=[];window.changes=0;
window.pending=createPendingRequests();window.pending.put(recoveryScope(member),'messaging',{key:'message-original-key',command:{body:'메시지 원문'}});
window.getAttempt=()=>window.pending.get(recoveryScope(member),'messagingFile');window.getMessage=()=>window.pending.get(recoveryScope(member),'messaging');
const ok=data=>({contractVersion:1,...scope,ok:true,data}),bad=code=>({contractVersion:1,...scope,ok:false,error:{code}});
const intent=()=>({fileId:window.fileId,bucket:'workhub-message-files',path:'school/teacher/'+window.fileId+'/original.hwpx',expiresAt:'2099-10-16T12:00:00Z',state:window.state});
function status(){return{fileId:window.fileId,state:window.state,storageObjectId:window.state==='awaiting_upload'?null:'object',file:window.state==='ready'?{id:window.fileId,name:window.metadata.name,bytes:window.metadata.claimedBytes,sha256:window.scenario==='wrong_metadata'?'a'.repeat(64):window.metadata.claimedSha256,profile:'hwpx_basic_v1'}:null}}
const connection={info:()=>({basisDate:'2026-10-16',schools:[{id:'school'}],memberships:[member]}),getIdentity:async()=>({userId:'user',approved:true}),rpcVerified:async(name,args)=>{
 window.calls.push({name,args:structuredClone(args)});
 if(name==='workhub_message_file_readiness')return ok({available:true,reason:'ready',policy});
 if(name==='workhub_message_file_prepare'){
  if(window.scenario==='before_accept'&&!window.preacceptFailed){window.preacceptFailed=true;throw Error('예약 접수 전 연결 중단')}
  if(args.p_replay_only&&!window.metadata)return bad('NOT_FOUND');
  if(!window.metadata){window.metadata=args.p_file;window.fileId='file-'+(++window.fileCount);window.prepareKey=args.p_request_key;
   if(window.scenario.startsWith('unknown_id')){window.state='rejected';throw Error('예약 응답 유실')}
   if(window.scenario==='late_prepare'){return new Promise(resolve=>window.release=()=>resolve(ok(intent())))}
  }
  if(args.p_request_key!==window.prepareKey){window.metadata=args.p_file;window.fileId='file-'+(++window.fileCount);window.prepareKey=args.p_request_key;window.state='awaiting_upload'}
  if(window.state==='rejected')return window.scenario==='unknown_id_wrong_scope'?{...bad('CONFLICT'),schoolId:'other'}:bad('CONFLICT');
  return ok(intent());
 }
 if(name==='workhub_message_file_complete'){
  if(window.state==='awaiting_upload')return ok(status());
  if(!window.failed&&window.scenario!=='before_accept'){window.failed=true;window.state=window.scenario==='known_rejected'?'rejected':window.scenario==='pending_retry'?'pending_basic':'ready';throw Error('확인 응답 유실')}
  if(window.scenario==='before_accept')window.state='ready';
  return ok(status());
 }
 if(name==='workhub_message_file_status'){
  if(window.scenario==='status_unknown')throw Error('상태 응답 유실');
  if(window.scenario==='status_timeout')return new Promise(()=>{});
  if(window.scenario==='status_conflict')return bad('CONFLICT');
  if(window.scenario==='status_not_found')return bad('NOT_FOUND');
  if(window.scenario==='late_status')return new Promise(resolve=>window.release=()=>resolve(ok(status())));
  return ok(status());
 }
 throw Error(name)
}};
const port={async upload(){window.uploads++;window.state='pending_basic'},async check(){window.checks++;window.state='ready';return ok(status())},async download(){throw Error('다운로드 불필요')}};
let server=createMessageFileServer(connection,{port,timeoutMs:window.scenario==='status_timeout'?150:5000});
function App(){const[files,setFiles]=useState([]),[mounted,setMounted]=useState(true),[text,setText]=useState('메시지 원문'),[current,setCurrent]=useState(member),[enabled,setEnabled]=useState(true);window.setEnabled=setEnabled;
 window.unmount=()=>setMounted(false);window.remount=()=>{server=createMessageFileServer(connection,{port,timeoutMs:window.scenario==='status_timeout'?150:5000});setMounted(true)};window.changeScope=()=>setCurrent({...member,id:'other',userId:'other-user',schoolId:'other-school'});
 window.files=files;return<PendingRequestsProvider store={window.pending}><label>메시지 본문<textarea value={text} onChange={e=>setText(e.target.value)}/></label>{mounted&&<MessageAttachments server={server} member={current} enabled={enabled} disabled={false} files={files} onChange={value=>{window.changes++;setFiles(value)}} onLockChange={value=>window.locked=value}/>}</PendingRequestsProvider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage()
const errors = [], external = [], passed = [], output = process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
const uploadFile={name:'학급자료.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from([80,75,3,4,1,2,3])}
async function start(scenario) { await page.goto('http://127.0.0.1:5179/files'); await page.evaluate(value=>window.scenario=value,scenario); await page.addScriptTag({content:bundle.outputFiles[0].text}); await page.getByLabel('첨부할 HWPX 파일',{exact:true}).waitFor() }
async function select() { await page.getByLabel('첨부할 HWPX 파일',{exact:true}).setInputFiles(uploadFile) }
async function pending() { await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).waitFor(); await page.waitForFunction(()=>!document.querySelector('.messaging-recovery button').disabled) }
async function verifyMessage(){assert.deepEqual(await page.evaluate(()=>window.getMessage()),{key:'message-original-key',command:{body:'메시지 원문'}});assert.equal(await page.getByLabel('메시지 본문').inputValue(),'메시지 원문')}
async function test(name, scenario, run){await start(scenario);try{await run();await verifyMessage()}catch(error){console.error('실패 화면:',await page.locator('body').innerText(),'브라우저 오류:',errors);throw error}passed.push(name);console.log('  ✓ '+name)}
try{
 await test('ID를 보존한 뒤 화면을 다시 열어도 상태부터 조회하고 거절 첨부만 종료한다','known_rejected',async()=>{
  await select();await pending();const before=await page.evaluate(()=>window.getAttempt());assert.equal(before.command.fileId,'file-1');
  await page.evaluate(()=>window.unmount());await page.getByRole('region',{name:'메시지 HWPX 첨부'}).waitFor({state:'detached'});await page.evaluate(()=>window.remount());await pending();
  await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.getByText(/확인에서 거절되었거나 업로드 기한/).waitFor();
  assert.equal(await page.evaluate(()=>window.getAttempt()),undefined);assert.equal(await page.evaluate(()=>window.files.length),0);assert.equal(await page.getByLabel('첨부할 HWPX 파일',{exact:true}).isEnabled(),true);
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c.name==='workhub_message_file_prepare').length,1);assert.equal(calls.filter(c=>c.name==='workhub_message_file_status').length,1);
  await select();await page.getByText(/기본 확인을 마쳤습니다/).waitFor();const keys=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_message_file_prepare').map(c=>c.args.p_request_key));assert.notEqual(keys[0],keys[1]);assert.equal(await page.evaluate(()=>window.files[0].id),'file-2');
 });
 await test('예약 응답을 잃어 ID가 없어도 검증된 prepare 종료만 원 첨부 시도를 끝낸다','unknown_id_rejected',async()=>{
  await select();await pending();const first=await page.evaluate(()=>window.getAttempt());assert.equal(first.command.fileId,undefined);
  await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.getByText(/확인에서 거절되었거나 업로드 기한/).waitFor();
  const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_message_file_prepare'));assert.equal(calls.length,2);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.equal(calls[1].args.p_replay_only,false);assert.equal(await page.evaluate(()=>window.getAttempt()),undefined);assert.equal(await page.evaluate(()=>window.uploads),0);
 });
 for(const scenario of ['unknown_id_wrong_scope','status_unknown','status_timeout','status_conflict','status_not_found','wrong_metadata'])await test('결과 미확정·일반 충돌·접근 오류는 원본과 두 키를 보존한다: '+scenario,scenario,async()=>{
  await select();await pending();const before=await page.evaluate(()=>{const r=window.getAttempt();return{key:r.key,prepare:r.command.prepareKey,complete:r.command.completeKey,fileId:r.command.fileId,fileName:r.command.file.name,fileBytes:r.command.file.size}});
  await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await pending();assert.deepEqual(await page.evaluate(()=>{const r=window.getAttempt();return{key:r.key,prepare:r.command.prepareKey,complete:r.command.completeKey,fileId:r.command.fileId,fileName:r.command.file.name,fileBytes:r.command.file.size}}),before);
  assert.equal(await page.getByLabel('첨부할 HWPX 파일',{exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.files.length),0);assert.doesNotMatch(await page.getByRole('alert').innerText(),/확인에서 거절되었거나/);
 });
 await test('확인 진행 중 복구는 ID 조회 뒤 기존 예약·완료 키를 쓰며 재업로드하지 않는다','pending_retry',async()=>{
  await select();await pending();const first=await page.evaluate(()=>window.getAttempt());await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.getByText(/기본 확인을 마쳤습니다/).waitFor();
  const calls=await page.evaluate(()=>window.calls),prepares=calls.filter(c=>c.name==='workhub_message_file_prepare'),completes=calls.filter(c=>c.name==='workhub_message_file_complete');assert.equal(prepares.length,2);assert.equal(prepares[1].args.p_replay_only,true);assert.equal(prepares[1].args.p_request_key,first.command.prepareKey);assert.deepEqual([...new Set(completes.map(c=>c.args.p_request_key))],[first.command.completeKey]);assert.equal(await page.evaluate(()=>window.uploads),1);assert.equal(await page.evaluate(()=>window.files.length),1);
 });
 await test('예약 접수 전 실패는 활성 상태에서 원래 키로 예약을 만들고 복구한다','before_accept',async()=>{
  await select();await pending();const before=await page.evaluate(()=>window.getAttempt());assert.equal(before.command.fileId,undefined);await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.getByText(/기본 확인을 마쳤습니다/).waitFor();
  const prepares=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_message_file_prepare'));assert.deepEqual(prepares[0].args,prepares[1].args);assert.equal(prepares[1].args.p_request_key,before.command.prepareKey);assert.equal(await page.evaluate(()=>window.fileCount),1);assert.equal(await page.evaluate(()=>window.uploads),1);
 });
 await test('미접수 요청의 조회 전용 NOT_FOUND는 보존하고 활성화 뒤 같은 키로 복구한다','before_accept',async()=>{
  await select();await pending();const before=await page.evaluate(()=>window.getAttempt());await page.evaluate(()=>window.setEnabled(false));await page.getByLabel('첨부할 HWPX 파일',{exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await pending();assert.equal(await page.evaluate(()=>window.getAttempt().key),before.key);assert.equal(await page.evaluate(()=>window.metadata),undefined);
  await page.evaluate(()=>window.setEnabled(true));await page.getByLabel('첨부할 HWPX 파일',{exact:true}).waitFor();await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.getByText(/기본 확인을 마쳤습니다/).waitFor();const prepares=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_message_file_prepare'));assert.deepEqual(prepares.map(c=>c.args.p_replay_only),[false,true,false]);assert.deepEqual([...new Set(prepares.map(c=>c.args.p_request_key))],[before.command.prepareKey]);assert.equal(await page.evaluate(()=>window.fileCount),1);
 });
 await test('준비 응답이 화면을 닫은 뒤 도착해도 복구 기록과 화면에 늦게 쓰지 않는다','late_prepare',async()=>{
  await select();await page.waitForFunction(()=>typeof window.release==='function');const before=await page.evaluate(()=>window.getAttempt());await page.evaluate(()=>window.unmount());await page.getByRole('region',{name:'메시지 HWPX 첨부'}).waitFor({state:'detached'});await page.evaluate(()=>window.release());await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.getAttempt().command.fileId),undefined);assert.equal(await page.evaluate(()=>window.getAttempt().key),before.key);assert.equal(await page.evaluate(()=>window.changes),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_message_file_complete').length),0);
 });
 await test('상태 응답이 화면 종료 뒤 도착해도 성공 첨부하거나 기존 요청을 지우지 않는다','late_status',async()=>{
  await select();await pending();const before=await page.evaluate(()=>window.getAttempt().key);await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.waitForFunction(()=>typeof window.release==='function');await page.evaluate(()=>window.unmount());await page.getByRole('region',{name:'메시지 HWPX 첨부'}).waitFor({state:'detached'});await page.evaluate(()=>window.release());await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.getAttempt().key),before);assert.equal(await page.evaluate(()=>window.changes),0);
 });
 await test('상태 응답을 기다리는 중 계정 범위가 바뀌면 이전 파일을 현재 화면에 넣지 않는다','late_status',async()=>{
  await select();await pending();await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.waitForFunction(()=>typeof window.release==='function');await page.evaluate(()=>window.changeScope());await page.evaluate(()=>window.release());await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.changes),0);assert.equal(await page.evaluate(()=>window.files.length),0);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 if(output){mkdirSync(output,{recursive:true});writeFileSync(join(output,'results.json'),JSON.stringify({passed,pageErrors:errors,externalRequests:external},null,2))}
 console.log('메신저 첨부 복구 브라우저 '+passed.length+'건 통과');
}finally{await browser.close()}
