// 실제 React·전송 어댑터에 합성 RPC만 연결해 닫기 확인, 결과 미상, 원키 보존을 검증한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ stdin: { contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {TimetableOperationsWorkspace} from './apps/workhub/src/timetable/TimetableOperationsWorkspace';
import {EditDraftsProvider,createEditDrafts} from './apps/workhub/src/app/edit-drafts';
import {PendingRequestsProvider,createPendingRequests,recoveryScope} from './apps/workhub/src/app/pending-requests';
import {canonical} from './apps/workhub/src/services/scoped-rpc';
import {schoolDayCommitCommand} from './apps/workhub/src/timetable/school-day-execution-server';
import styles from './apps/workhub/src/style.css?inline';
const w=window,copy=value=>structuredClone(value),stamp=()=>new Date().toISOString(),offset=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
w.member={id:'member',schoolId:'school',userId:'user',name:'합성 교사',role:'admin',active:true,validFrom:'2026-01-01',validThrough:'2099-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
w.identity='user';w.pending=createPendingRequests();w.drafts=createEditDrafts();w.calls=[];w.closeResults={};w.receipts={};w.originals={};w.writes=0;w.closeWrites=0;w.locked=false;w.date=offset(0);w.future=offset(3);w.past=offset(-1);w.asOf=stamp();
const time=(day,hour)=>({startsAt:day+'T'+hour+':00:00.000Z',endsAt:day+'T'+hour+':45:00.000Z'});
w.lesson={id:'future-lesson',version:1,label:'미래 국어 1반',time:time(w.future,'00'),teachers:[{id:'member',name:'합성 교사'}],groupNames:['1반'],roomNames:['교실'],state:'scheduled',canRequest:true,allowedTargets:[time(w.future,'00'),time(w.future,'01')]};
w.pastLesson={...copy(w.lesson),id:'past-lesson',label:'실시 국어 1반',time:time(w.past,'00'),canRequest:false,allowedTargets:[]};
w.source={asOf:w.asOf,timeZone:'Asia/Seoul',lesson:{id:w.pastLesson.id,version:1,label:w.pastLesson.label,startsAt:w.pastLesson.time.startsAt,endsAt:w.pastLesson.time.endsAt,state:'scheduled',teacherIds:['member']},allowedOutcomes:['completed','not_performed','needs_review'],current:null,history:[],nextCursor:null};
const view=(from,until)=>({asOf:w.asOf,timeZone:'Asia/Seoul',from,until,canPublish:true,canRequest:true,drafts:[{id:'draft',version:2,title:'학교 초안'}],lessons:[w.lesson,w.pastLesson].filter(row=>row.time.startsAt.slice(0,10)>=from&&row.time.startsAt.slice(0,10)<until),requests:[],publications:[]});
const references=v=>({asOf:v.asOf,from:v.from,until:v.until,lessons:v.lessons.map(row=>({lessonId:row.id,version:row.version,groups:[{id:'group',name:'1반'}],rooms:[{id:'room',name:'교실'}]}))});
w.scope=()=>recoveryScope(w.member);w.slot=()=>w.kind==='execution'?'timetableExecutionRecords':'timetableOperations';w.saved=()=>copy(w.drafts.bind(w.scope(),w.kind==='execution'?'timetable-execution-records':w.kind==='publication'?'timetable-publish':w.kind==='school_day'?'timetable-school-day':'timetable-exchanges').initial);w.pendingRow=()=>copy(w.pending.get(w.scope(),w.slot()));
async function receipt(kind,command,key){
 const commandHash=await digest(command),recordedAt=stamp();
 if(kind==='execution'){const record={id:'record',version:command.expectedRecordVersion+1,lessonId:command.lessonId,lessonVersion:command.expectedLessonVersion,outcome:command.outcome,note:command.note,correctionReason:command.correctionReason,recordedBy:{id:'member',name:'합성 교사'},recordedAt};w.source.current=copy(record);w.source.history=[copy(record)];w.source.asOf=recordedAt;return{requestKey:key,commandHash,record}}
 if(kind==='publication')return{requestKey:key,commandHash,kind:'publish_manifest',entityId:'publication',version:1,status:'published',recordedAt,manifestHash:command.manifestHash,basisFingerprint:command.basisFingerprint,changedCount:command.totalChanges};
 if(kind==='school_day')return{requestKey:key,commandHash,kind:'school_day',entityId:'school-day',version:1,status:'applied',recordedAt,changedLessonCount:1,changesHash:await digest([{id:w.lesson.id,version:2}]),lostLessonCount:1};
 return{requestKey:key,commandHash,kind:command.kind,entityId:'request',version:1,status:'awaiting_approval',recordedAt,changedLessons:[]};
}
const contracts={operations:'timetable-operations.v1',publication:'timetable-publication.v1',school_day:'timetable-school-day.v1',execution:'timetable.execution-records.v1'};
const env=(contract,data)=>({contract,schoolId:'school',memberId:'member',data}),error=(contract,code)=>({contract,schoolId:'school',memberId:'member',error:{code}});
const connection={info:()=>({memberships:[w.member],schools:[{id:'school'},{id:'other'}],basisDate:w.date}),getIdentity:async()=>({userId:w.identity,approved:true}),rpcVerified:async(name,args)=>{
 w.calls.push({name,args:copy(args)});
 if(name==='workhub_timetable_operations_readiness')return env(contracts.operations,w.notReady?{available:false,reason:'not_installed'}:{available:true});
 if(name==='workhub_timetable_operations_get')return env(contracts.operations,view(args.p_from,args.p_until));
 if(name==='workhub_timetable_operations_references')return env('timetable-operations.next.v1',references(view(args.p_from,args.p_until)));
 if(name==='workhub_timetable_execution_get')return env(contracts.execution,copy(w.source));
 if(name==='workhub_timetable_operations_exchange_preview'){const before=copy(w.lesson),input=copy(args.p_input);return env(contracts.operations,{previewId:'preview-'+w.calls.length,previewHash:'a'.repeat(64),createdAt:stamp(),expiresAt:new Date(Date.now()+600000).toISOString(),input,complete:true,changes:[{before,after:{...copy(before),version:2,time:copy(input.target)}}],participants:copy(before.teachers),blockers:[]})}
 if(name==='workhub_timetable_operations_abandon'){
  const {p_kind:kind,p_request_key:key,p_command:command}=args,hash=await digest(command),contract='timetable-operations.abandon.v1';
  if(w.closeError)return error(contract,w.closeError);
  if(!w.closeResults[key]){if(w.applyOnClose){w.receipts[key]=await receipt(kind,w.originals[key],key);w.writes++}w.closeResults[key]={kind,requestKey:key,commandHash:hash,outcome:w.receipts[key]?'applied':'abandoned',receipt:w.receipts[key]??null,decidedAt:stamp()};w.closeWrites++}
  const result=copy(w.closeResults[key]);if(w.tamperClose)result.commandHash='f'.repeat(64);
  if(w.holdClose)await new Promise(resolve=>w.releaseClose=resolve);
  if(w.dropClose){w.dropClose=false;throw Error('닫기 응답 유실')}
  return env(contract,result);
 }
 const kind=name==='workhub_timetable_operations_execute'?'operations':name==='workhub_timetable_publication_execute'?'publication':name==='workhub_timetable_school_day_execute'?'school_day':name==='workhub_timetable_execution_record'?'execution':null;
 if(!kind)throw Error('미정의 RPC '+name);
 const key=args.p_request_key,command=args.p_command,contract=contracts[kind];w.originals[key]=copy(command);
 if(w.closeResults[key]?.outcome==='abandoned')return error(contract,'CONFLICT');
 if(w.receipts[key])return env(contract,copy(w.receipts[key]));
 if(args.p_recover_only)return error(contract,'NOT_FOUND');
 if(w.dropBefore){w.dropBefore=false;throw Error('원요청 응답 유실')}
 if(w.rejectWrites!==false)return error(contract,'CONFLICT');
 w.receipts[key]=await receipt(kind,command,key);w.writes++;return env(contract,copy(w.receipts[key]));
}};
w.init=async(kind,seed=true)=>{
 w.kind=kind;w.originalKey='original-'+kind+'-request';let command,draft;
 if(kind==='execution'){command={lessonId:w.pastLesson.id,expectedLessonVersion:1,expectedRecordVersion:0,expectedRecordId:null,outcome:'completed',note:'보존할 실시 메모',correctionReason:null};draft={kind:'editing',command:copy(command)}}
 else if(kind==='publication'){
 const raw={previewId:'publication-preview',previewHash:'a'.repeat(64),input:{draftId:'draft',draftVersion:2,from:w.future,until:offset(4)},timeZone:'Asia/Seoul',createdAt:w.asOf,expiresAt:new Date(Date.now()+600000).toISOString(),basisFingerprint:'b'.repeat(64),totalChanges:1,pageSize:200,pageHashes:['c'.repeat(64)],blockerCount:0,complete:true,preserved:{pastRecords:true,outsideRange:true,existingChanges:'retained'}};
 command={kind:'publish_manifest',manifest:{...raw,manifestHash:await digest(raw)}};draft={draftId:'draft',draftVersion:2,from:w.future,lastDay:w.future,dirty:true};
 }else if(kind==='school_day'){
 const current=view(w.date,offset(14)),refs=references(current),input={kind:'closure',date:w.future,groupIds:['group'],reason:'보존할 학사 사유',bells:[]},before=copy(w.lesson),changes=[{before,after:{...copy(before),version:2,state:'cancelled',canRequest:false,allowedTargets:[]}}];
 const raw={input,sourceAsOf:current.asOf,previewId:'school-day-preview',createdAt:w.asOf,expiresAt:new Date(Date.now()+600000).toISOString(),complete:true,coverage:{date:input.date,groupIds:input.groupIds,complete:true,existingRequests:'complete'},affectedLessons:[{lessonId:before.id,version:1}],changes,requestEffects:[],blockers:[],preserved:{pastRecords:true,outsideTarget:true,existingChanges:'retained'},lostLessonCount:1,lostSeconds:2700,changesActualSchedule:false};
 command=schoolDayCommitCommand({...raw,previewHash:await digest(raw)},current,refs);draft={...input,bells:{}};
 }else{const input={kind:'move',lessonId:w.lesson.id,expectedVersion:1,target:time(w.future,'01'),reason:'보존할 교환 사유'};command={kind:'submit',preview:{previewId:'original-preview',previewHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),input}};draft={kind:'move',lessonId:w.lesson.id,targetKey:input.target.startsAt+'|'+input.target.endsAt,otherLessonId:'',reason:input.reason}}
 w.seeded=copy(command);if(seed){w.drafts.bind(w.scope(),kind==='execution'?'timetable-execution-records':kind==='publication'?'timetable-publish':kind==='school_day'?'timetable-school-day':'timetable-exchanges').save(draft);w.pending.put(w.scope(),w.slot(),{command,key:w.originalKey})}
};
function Harness(){const[revision,revise]=useState(0);w.refresh=()=>revise(value=>value+1);return <EditDraftsProvider store={w.drafts}><PendingRequestsProvider store={w.pending}><style>{styles}</style><main><TimetableOperationsWorkspace connection={connection} member={w.member} date={w.date} initialDate={w.kind==='execution'?w.past:w.future} initialLessonId={w.kind==='execution'?w.pastLesson.id:undefined} revision={revision} onNavigationLockChange={locked=>w.locked=locked}/></main></PendingRequestsProvider></EditDraftsProvider>}
w.mount=()=>{w.root=createRoot(document.getElementById('root'));w.root.render(<Harness/>)};
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text

const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], external = [], passed = []
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => { if (!route.request().url().startsWith('http://127.0.0.1:5193/')) { external.push(route.request().url()); return route.abort() } return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>' }) })
const button = name => page.getByRole('button', { name, exact: true }), closes = () => page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_operations_abandon'))
async function start(kind, options = {}, seed = true) { await page.goto('http://127.0.0.1:5193/request-close'); await page.addScriptTag({ content: bundle }); await page.evaluate(async ({ kind, options, seed }) => { await window.init(kind, seed); Object.assign(window, options); window.mount() }, { kind, options, seed }); await page.getByRole('heading', { name: '시간표 운영', exact: true }).waitFor() }
async function check(name, run) { await run(); passed.push(name); console.log('  ✓ ' + name) }
async function offerClose(kind) {
 await button(kind === 'execution' ? '원래 실시 기록 결과 확인' : '원래 요청 결과만 다시 확인').click()
 const resend = button(kind === 'execution' ? '같은 번호로 실시 기록 다시 보내기' : '같은 번호·같은 내용으로 다시 보내기')
 await resend.waitFor(); await page.getByRole('checkbox', { name: kind === 'execution' ? '늦은 처리 가능성을 확인했고 같은 번호·같은 입력으로 다시 보냅니다' : '늦은 처리 가능성을 확인했고 같은 번호·같은 내용으로 다시 보냅니다', exact: true }).check(); await resend.click(); await button('이 요청 닫기').waitFor()
}
async function confirmClose() { await button('이 요청 닫기').click(); await button('요청 닫기 확인').click() }
try {
 for (const kind of ['operations', 'execution']) await check(kind + ': 최초 화면 전송 유실부터 닫기까지 원문·번호를 유지한다', async () => {
  await start(kind, { dropBefore: true }, false)
  if (kind === 'operations') {
   await button('교환·변경 요청').click(); await page.getByLabel('요청할 변경 종류', { exact: true }).selectOption('move'); await page.getByLabel('변경할 내 수업', { exact: true }).selectOption('future-lesson'); await page.getByLabel('이동할 공식 시간', { exact: true }).selectOption({ index: 1 }); await page.getByLabel('변경 요청 사유', { exact: true }).fill('최초 전송부터 보존할 사유'); await button('변경 전후 미리보기').click(); await page.getByRole('region', { name: '수업 변경 미리보기', exact: true }).waitFor(); await page.getByRole('checkbox', { name: '변경되는 수업·시간·관련 교사를 확인했으며 나는 이 변경안에 동의합니다', exact: true }).check(); await button('내 동의와 변경 요청 보내기').click()
  } else {
   await page.locator('.timetable-execution-records > summary').click(); await button('실시 기록 작성하기').click(); await page.getByLabel('기록 메모', { exact: true }).fill('최초 전송부터 보존할 메모'); await page.getByRole('checkbox', { name: '선택 수업과 실제 실시 여부를 직접 확인했습니다', exact: true }).check(); await button('확인한 실시 기록 저장').click()
  }
  await button(kind === 'execution' ? '원래 실시 기록 결과 확인' : '원래 요청 결과만 다시 확인').waitFor(); const before = await page.evaluate(() => ({ request: window.pendingRow(), draft: window.saved() })); assert.equal(await button('이 요청 닫기').count(), 0)
  await offerClose(kind); await confirmClose(); await page.waitForFunction(() => window.pending.count() === 0); assert.deepEqual(await page.evaluate(() => window.saved()), before.draft)
  const rpc = kind === 'execution' ? 'workhub_timetable_execution_record' : 'workhub_timetable_operations_execute', originalCalls = await page.evaluate(name => window.calls.filter(row => row.name === name), rpc), closeCalls = await closes()
  assert.deepEqual(originalCalls.map(row => row.args.p_recover_only), [false, true, false]); assert.equal(new Set(originalCalls.map(row => row.args.p_request_key)).size, 1); assert.equal(closeCalls[0].args.p_request_key, before.request.key); assert.deepEqual(closeCalls[0].args.p_command, originalCalls[0].args.p_command); assert.equal(await page.evaluate(() => window.writes), 0)
 })
 for (const kind of ['operations', 'publication', 'school_day', 'execution']) await check(kind + ': 명시 확인 전에 전송하지 않고 닫힌 번호 확인 뒤 입력을 보존한다', async () => {
  await start(kind); const before = await page.evaluate(() => window.saved()); assert.equal(await button('이 요청 닫기').count(), 0); await offerClose(kind)
  assert.equal(await page.evaluate(() => window.pending.count()), 1, '재전송 CONFLICT만으로 잠금 해제 금지'); assert.equal((await closes()).length, 0)
  await button('이 요청 닫기').click(); await button('요청 닫기 확인').waitFor(); assert.equal((await closes()).length, 0, '설명 열기만으로 닫지 않음')
  await button('요청 닫기 확인').click(); await page.waitForFunction(() => window.pending.count() === 0)
  assert.deepEqual(await page.evaluate(() => window.saved()), before); const calls = await closes(); assert.equal(calls.length, 1); assert.equal(calls[0].args.p_kind, kind); assert.equal(calls[0].args.p_request_key, 'original-' + kind + '-request'); assert.equal(await page.evaluate(() => window.writes), 0)
  assert.equal(await button(kind === 'execution' ? '원래 실시 기록 결과 확인' : '원래 요청 결과만 다시 확인').count(), 0)
  if (kind === 'execution') { await page.getByLabel('기록 메모', { exact: true }).waitFor({ state: 'visible' }); assert.equal(await page.getByLabel('기록 메모', { exact: true }).isEnabled(), true); assert.equal(await page.getByLabel('기록 메모', { exact: true }).inputValue(), '보존할 실시 메모') }
  if (kind === 'operations') { assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '보존할 교환 사유'); assert.equal(await button('내 동의와 변경 요청 보내기').count(), 0, '닫은 뒤 이전 미리보기 재사용 금지') }
 })
 for (const kind of ['operations', 'publication', 'school_day', 'execution']) await check(kind + ': 닫기 응답 유실은 재진입 뒤 닫기 조회만 허용하고 같은 번호로 확인한다', async () => {
  await start(kind, { dropClose: true }); await offerClose(kind); const before = await page.evaluate(() => window.saved()); await confirmClose(); await button('요청 닫기 결과 다시 확인').waitFor()
  assert.equal(await page.evaluate(() => window.pendingRow().closeState), 'closing'); assert.equal(await button(kind === 'execution' ? '원래 실시 기록 결과 확인' : '원래 요청 결과만 다시 확인').count(), 0)
  assert.equal(await button(kind === 'execution' ? '같은 번호로 실시 기록 다시 보내기' : '같은 번호·같은 내용으로 다시 보내기').count(), 0)
  await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('요청 닫기 결과 다시 확인').click(); await page.waitForFunction(() => window.pending.count() === 0)
  const calls = await closes(); assert.equal(calls.length, 2); assert.deepEqual(calls[1].args, calls[0].args); assert.equal(await page.evaluate(() => window.closeWrites), 1); assert.deepEqual(await page.evaluate(() => window.saved()), before)
 })
 for (const kind of ['operations', 'publication', 'school_day', 'execution']) await check(kind + ': 먼저 처리된 접수증이면 닫힘으로 오인하지 않고 기존 성공을 반영한다', async () => {
  await start(kind, { applyOnClose: true }); await offerClose(kind); await confirmClose(); await page.waitForFunction(() => window.pending.count() === 0)
  assert.equal(await page.evaluate(() => window.writes), 1); assert.equal(await page.evaluate(() => window.closeResults[window.originalKey].outcome), 'applied')
  if (kind === 'operations') { await page.waitForFunction(() => window.saved() === undefined); await page.getByText('원래 요청이 이미 처리된 것을 확인했습니다. 수업 변경 요청의 처리 결과를 확인했습니다. 요청 현황에서 다음 단계를 확인해 주세요.', { exact: true }).waitFor() }
  else if (kind === 'execution') { await button('실시 기록 정정하기').waitFor(); assert.equal(await page.evaluate(() => window.source.current.note), '보존할 실시 메모') } else { await page.waitForFunction(() => window.saved() === undefined); await page.getByText(/원래 요청이 이미 처리된 것을 확인했습니다/).waitFor() }
 })
 await check('모듈 중지 후에도 원래 본인 요청은 닫을 수 있고 다른 작업을 새로 만들지 않는다', async () => {
  await start('operations'); await offerClose('operations'); await page.evaluate(() => { window.notReady = true; window.refresh() }); await page.getByRole('heading', { name: '시간표 운영 연결 준비 중', exact: true }).waitFor(); await confirmClose(); await page.waitForFunction(() => window.pending.count() === 0); assert.equal((await closes()).length, 1); assert.equal(await page.evaluate(() => window.writes), 0)
 })
 await check('닫기 거절·변조 응답은 원키와 입력을 보관하고 닫기만 재시도한다', async () => {
  await start('operations', { closeError: 'CONFLICT' }); await offerClose('operations'); const before = await page.evaluate(() => window.saved()); await confirmClose(); await button('요청 닫기 결과 다시 확인').waitFor(); assert.equal(await page.evaluate(() => window.pending.count()), 1)
  await page.evaluate(() => { window.closeError = ''; window.tamperClose = true }); await button('요청 닫기 결과 다시 확인').click(); await page.waitForFunction(() => window.calls.filter(row => row.name === 'workhub_timetable_operations_abandon').length === 2); await button('요청 닫기 결과 다시 확인').waitFor(); assert.equal(await page.evaluate(() => window.pending.count()), 1); assert.deepEqual(await page.evaluate(() => window.saved()), before)
  await page.evaluate(() => window.tamperClose = false); await button('요청 닫기 결과 다시 확인').click(); await page.waitForFunction(() => window.pending.count() === 0)
 })
 await check('이전 학교의 늦은 닫기 응답은 새 학교 입력이나 요청을 지우지 않는다', async () => {
  await start('operations', { holdClose: true }); await offerClose('operations'); await confirmClose(); await page.waitForFunction(() => typeof window.releaseClose === 'function')
  await page.evaluate(() => { window.oldScope = window.scope(); window.root.unmount(); window.member = { ...window.member, id: 'other-member', schoolId: 'other', name: '다른 학교 교사' }; window.drafts.bind(window.scope(), 'timetable-exchanges').save({ kind: 'move', lessonId: '', targetKey: '', otherLessonId: '', reason: '새 학교 입력' }); window.mount() })
  await page.evaluate(() => window.releaseClose()); await page.getByRole('heading', { name: '시간표 운영 자료를 불러오지 못했습니다', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.pending.get(window.oldScope, 'timetableOperations')?.closeState), 'closing'); assert.equal(await page.evaluate(() => window.saved().reason), '새 학교 입력'); assert.equal(await button('요청 닫기 결과 다시 확인').count(), 0); assert.equal((await closes()).length, 1)
 })
 await check('닫은 교환은 새 미리보기와 새 요청 번호로만 재작성하고 사유를 유지한다', async () => {
  await start('operations'); await offerClose('operations'); await confirmClose(); await page.waitForFunction(() => window.pending.count() === 0); await page.getByLabel('변경 요청 사유', { exact: true }).waitFor({ state: 'visible' }); await page.evaluate(() => window.rejectWrites = false)
  await button('변경 전후 미리보기').click(); await page.getByRole('region', { name: '수업 변경 미리보기', exact: true }).waitFor(); await page.getByRole('checkbox', { name: '변경되는 수업·시간·관련 교사를 확인했으며 나는 이 변경안에 동의합니다', exact: true }).check(); await button('내 동의와 변경 요청 보내기').click(); await page.waitForFunction(() => window.writes === 1)
  const commands = await page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_operations_execute' && !row.args.p_recover_only)); assert.equal(commands.length, 2); assert.notEqual(commands[1].args.p_request_key, commands[0].args.p_request_key); assert.equal(commands[1].args.p_command.preview.input.reason, '보존할 교환 사유'); assert.equal(await page.evaluate(() => window.pending.count()), 0)
 })
 await check('실시 기록도 닫기 뒤 같은 입력을 새 번호로 저장하며 중복 반영하지 않는다', async () => {
  await start('execution'); await offerClose('execution'); await confirmClose(); await page.waitForFunction(() => window.pending.count() === 0); await page.evaluate(() => window.rejectWrites = false)
  await page.getByRole('checkbox', { name: '선택 수업과 실제 실시 여부를 직접 확인했습니다', exact: true }).check(); await button('확인한 실시 기록 저장').click(); await page.waitForFunction(() => window.writes === 1); await button('실시 기록 정정하기').waitFor()
  const commands = await page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_execution_record' && !row.args.p_recover_only)); assert.equal(commands.length, 2); assert.notEqual(commands[1].args.p_request_key, commands[0].args.p_request_key); assert.deepEqual(commands[1].args.p_command, commands[0].args.p_command)
 })
 await check('320px 키보드 확인에서도 닫기 단계와 원번호 안내가 화면에 들어온다', async () => {
  await page.setViewportSize({ width: 320, height: 800 }); await start('operations'); await offerClose('operations'); await button('이 요청 닫기').focus(); await page.keyboard.press('Enter'); await button('요청 닫기 확인').waitFor(); assert.equal((await closes()).length, 0); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'request-close-mobile.png'), fullPage: true }) }
  await button('요청 닫기 확인').focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => window.pending.count() === 0); await page.setViewportSize({ width: 1280, height: 900 })
 })
 assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 })
 if (process.env.WORKHUB_QA_OUTPUT) writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'results.json'), JSON.stringify({ scenarios: passed.length, failures: 0, externalRequests: external.length }, null, 2))
 console.log('시간표 요청 닫기 실제 화면·어댑터 브라우저: ' + passed.length + '개 통과')
} catch (error) { console.error(await page.locator('body').innerText()); console.error(JSON.stringify(await page.evaluate(() => window.calls), null, 2)); throw error } finally { await browser.close() }
