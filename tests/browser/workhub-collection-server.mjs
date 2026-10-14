// 실제 React 화면의 비동기 수합·파일 복구를 합성 서버로 검증한다. 운영 DB에는 연결하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{CollectionServerPanel}from'./apps/workhub/src/collections/CollectionServerPanel';
import{CollectionServerError}from'./apps/workhub/src/collections/contracts';
import{createEditDrafts,EditDraftsProvider}from'./apps/workhub/src/app/edit-drafts';
import{createPendingRequests,PendingRequestsProvider,recoveryScope}from'./apps/workhub/src/app/pending-requests';
const clone=value=>structuredClone(value),memory=createEditDrafts(),pending=createPendingRequests();
const members=['담당교사','검토교사','다른학교 교사'].map((name,index)=>({id:'member-'+index,userId:'user-'+index,schoolId:index===2?'school-other':'school',name,role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}));
const policy={extensions:['pdf'],maxFileBytes:1024*1024,maxFiles:3},state={request:null,unit:null,draft:null,submissions:[],reviews:[],supplements:[],withdrawals:[]},receipts=new Map(),uploads=new Map(),gates=[];
window.mode='normal';window.fileMode='ready';window.calls=[];window.uploadCalls=[];window.applied=0;window.release=()=>{while(gates.length)gates.shift()()};
const wait=()=>new Promise(resolve=>gates.push(resolve));const now='2026-10-15T08:00:00Z';
function seed(){state.request={id:'request-1',schoolId:'school',managerMemberId:'member-0',status:'published',version:2,publishedAt:now,title:'서버 수합',instructions:'안내',dueDate:'2026-10-31',reviewMode:'required',reviewerMemberId:'member-1',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:[{label:'담당교사',responsibleMemberId:'member-0',contributorMemberIds:[]}],fileCollection:{policy:{...policy,maxFiles:1},required:true,templates:[]}};state.unit={id:'unit-1',requestId:'request-1',schoolId:'school',label:'담당교사',responsibleMemberId:'member-0',members:[{id:'member-0',userId:'user-0',name:'담당교사'}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''}}
if(window.initial==='published'||window.initial==='review'||window.initial==='duplicate')seed();
if(window.initial==='review'){const file={id:'file-seed',name:'제출.pdf',extension:'pdf',bytes:17,sha256:'a'.repeat(64)};uploads.set(file.id,{file,parent:{kind:'draft',requestId:'request-1',unitId:'unit-1',version:0},blob:new Blob(['%PDF-1.7\\nresult']),state:'ready'});state.draft={id:'draft-1',unitId:'unit-1',lastEditorMemberId:'member-0',version:1,text:'',number:null,files:[file]};state.unit.currentSubmissionId='submission-1';state.submissions=[{id:'submission-1',unitId:'unit-1',revision:1,submittedBy:'member-0',receiptAt:now,receiptDate:'2026-10-15',dueSnapshot:'2026-10-31',initiallyLate:false,correctionReason:'',previousSubmissionId:null,reviewMode:'required',requestKey:'seed',text:'',number:null,files:[file]}]}
if(window.initial==='duplicate')members[1].name='담당교사';
window.state=state;
const server={
async readiness(){return window.readinessReason?{available:false,reason:window.readinessReason,policy:null}:window.initial==='missing'?{available:false,reason:'database_missing',policy:null}:{available:true,reason:'ready',policy}},
async list(member,cursor){if(member==='member-2')return{items:[],nextCursor:null};return{items:state.request?[clone(state.request)]:[],nextCursor:null}},
async detail(member,id){if(window.mode==='read-denied'||member==='member-2')throw new CollectionServerError('FORBIDDEN','private-secret');if(window.mode==='detail-delay')await wait();if(!state.request)throw new CollectionServerError('NOT_FOUND','missing');return clone({request:state.request,units:state.unit?[state.unit]:[],submissions:state.submissions,reviews:state.reviews,supplements:state.supplements,withdrawals:state.withdrawals})},
async draft(){if(window.mode==='draft-denied')throw new CollectionServerError('FORBIDDEN','private-secret');return clone(state.draft)},
async mutate(member,command,key){window.calls.push(clone({member,command,key}));if(window.mode==='delay')await wait();if(receipts.has(key))return clone(receipts.get(key));if(window.mode==='conflict'){window.mode='normal';state.request={...state.request,version:state.request.version+1,instructions:'다른 교사의 최신 안내'};throw new CollectionServerError('CONFLICT','version');}let version=1,id='request-1';
if(command.kind==='create'){state.request={...clone(command.input),id,schoolId:'school',managerMemberId:member,status:'draft',version:1,publishedAt:null};}
if(command.kind==='update'){if(command.expectedVersion!==state.request.version)throw new CollectionServerError('CONFLICT','version');state.request={...state.request,...clone(command.input),version:state.request.version+1};version=state.request.version;}
if(command.kind==='publish'){state.request={...state.request,status:'published',publishedAt:now,version:state.request.version+1};state.unit={id:'unit-1',requestId:'request-1',schoolId:'school',label:state.request.units[0].label,responsibleMemberId:state.request.units[0].responsibleMemberId,members:[{id:'member-0',userId:'user-0',name:'담당교사'}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''};version=state.request.version;}
if(command.kind==='save_draft'){state.draft={...clone(command.input),id:'draft-1',unitId:command.unitId,lastEditorMemberId:member,version:(state.draft?.version??0)+1};id=state.draft.id;version=state.draft.version;}
if(command.kind==='submit'){id='submission-'+(state.submissions.length+1);const submission={...clone(state.draft),id,unitId:command.unitId,revision:state.submissions.length+1,submittedBy:member,receiptAt:now,receiptDate:'2026-10-15',dueSnapshot:state.request.dueDate,initiallyLate:false,correctionReason:command.reason,previousSubmissionId:state.unit.currentSubmissionId,reviewMode:state.request.reviewMode,requestKey:key};state.submissions.push(submission);state.unit={...state.unit,version:state.unit.version+1,currentSubmissionId:id,effectiveSubmissionId:state.request.reviewMode==='none'?id:state.unit.effectiveSubmissionId};if(command.correctionRequestId){const supplement=state.supplements.find(value=>value.id===command.correctionRequestId);if(supplement){supplement.fulfilledSubmissionId=id;supplement.fulfilledAt=now;}}version=state.unit.version;}
if(command.kind==='review'){id='review-'+(state.reviews.length+1);state.reviews.push({id,unitId:command.unitId,submissionId:command.submissionId,reviewerMemberId:member,decision:command.decision,note:command.note,recordedAt:now});state.unit.version++;if(command.decision==='changes_requested')state.supplements.push({id:'supplement-1',unitId:command.unitId,submissionId:command.submissionId,dueDate:command.dueDate,fulfilledSubmissionId:null,fulfilledAt:null});else state.unit.effectiveSubmissionId=command.submissionId;version=state.unit.version;}
window.applied++;const receipt={requestId:'request-1',resourceId:id,resourceVersion:version,recordedAt:now,requestKey:key};receipts.set(key,receipt);if(window.mode==='unknown'){window.mode='normal';throw new CollectionServerError('RESULT_UNKNOWN','secret-trace')}return clone(receipt)},
async prepareUpload(member,parent,file,filePolicy,key){window.uploadCalls.push(clone({kind:'prepare',member,parent,policy:filePolicy,key}));if(window.fileMode==='prepare-delay')await wait();let found=[...uploads.values()].find(value=>value.key===key);if(!found){const id='file-'+(uploads.size+1);found={key,parent,file:{id,name:file.name,extension:'pdf',bytes:file.size,sha256:'a'.repeat(64)},blob:file,state:'awaiting_upload'};uploads.set(id,found)}return{fileId:found.file.id,bucket:'private',path:found.file.id,expiresAt:'2099-01-01T00:00:00Z',state:found.state}},
async upload(member,intent,file){window.uploadCalls.push({kind:'upload',id:intent.fileId});uploads.get(intent.fileId).blob=file},
async completeUpload(member,id,key){window.uploadCalls.push({kind:'complete',id,key});if(window.fileMode==='reject')throw new CollectionServerError('FILE_FAILED','private-trace');const entry=uploads.get(id);entry.state=window.fileMode==='pending'?'pending_verification':'ready';if(window.fileMode==='unknown'){window.fileMode='ready';throw new CollectionServerError('RESULT_UNKNOWN','private-trace')}return{fileId:id,state:entry.state,file:entry.state==='ready'?clone(entry.file):null}},
async fileStatus(member,id){const entry=uploads.get(id);if(window.fileMode==='ready')entry.state='ready';return{fileId:id,state:entry.state,file:entry.state==='ready'?clone(entry.file):null}},
async download(member,parent,file){window.downloadParent=clone(parent);return uploads.get(file.id).blob}
};
function App(){const[visible,setVisible]=useState(true),[actor,setActor]=useState(0),[locked,setLocked]=useState(false),[revision,setRevision]=useState(0);window.refresh=()=>setRevision(value=>value+1);window.setVisible=setVisible;window.setActor=value=>{memory.clear();memory.activate(recoveryScope(members[value]));pending.clear();setActor(value)};return <><output data-lock>{String(locked)}</output><EditDraftsProvider store={memory}><PendingRequestsProvider store={pending}>{visible&&<CollectionServerPanel server={server} member={members[actor]} members={members} date="2026-10-15" revision={revision} onNavigationLockChange={setLocked}/>}</PendingRequestsProvider></EditDraftsProvider></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage()
const results = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
const file = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + name + '\n%%EOF') })
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function reset(initial = '') {
  await page.goto('http://127.0.0.1:5179/collections'); await page.evaluate(value => { window.initial = value }, initial)
  await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: '문서 수합', exact: true }).waitFor(); await settle()
}
async function test(name, action, initial = '') { await reset(initial); try { await action() } catch (error) { console.error('실패 화면:', await page.locator('body').innerText()); throw error } results.push(name); console.log('  ✓ ' + name) }
async function createInput() { await page.getByRole('button', { name: '새 수합 만들기' }).click(); await page.getByLabel('수합 제목', { exact: true }).fill('학급 운영계획'); await page.getByLabel('제출 기한', { exact: true }).fill('2026-10-31'); await page.getByRole('checkbox', { name: '담당교사', exact: true }).check() }
async function openRequest() { await page.getByRole('button', { name: /서버 수합/ }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor() }
async function remount() { await page.evaluate(() => window.setVisible(false)); await settle(); await page.evaluate(() => window.setVisible(true)); await page.getByRole('heading', { name: '문서 수합', exact: true }).waitFor(); await settle() }
try {
  await test('DB가 없으면 준비 안내를 표시하고 수합 없음·저장 성공으로 바꾸지 않는다', async () => {
    await page.getByRole('heading', { name: '문서 수합 연결 준비가 필요합니다' }).waitFor()
    assert.match(await page.locator('body').innerText(), /DB 함수가 아직 준비/)
    assert.equal(await page.getByRole('button', { name: '새 수합 만들기' }).count(), 0)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'missing')
  await test('저장 중 이동을 잠그고 응답 미확정은 같은 내용·요청 번호로 재확인한다', async () => {
    await createInput(); await page.evaluate(() => { window.mode = 'delay' }); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    assert.equal(await page.locator('[data-lock]').innerText(), 'true')
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).isDisabled(), true)
    await page.evaluate(() => { window.mode = 'unknown'; window.release() }); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '학급 운영계획')
    assert.doesNotMatch(await page.locator('body').innerText(), /secret-trace/)
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    const values = await page.evaluate(() => ({ calls: window.calls, applied: window.applied }))
    assert.equal(values.calls.length, 2); assert.deepEqual(values.calls[0], values.calls[1]); assert.equal(values.applied, 1)
  })
  await test('연결 오류로 화면이 교체되어도 미저장 입력과 미확정 요청을 복구한다', async () => {
    await createInput(); await remount(); assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '학급 운영계획')
    await page.evaluate(() => { window.mode = 'delay' }); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.evaluate(() => window.setVisible(false)); await settle(); await page.evaluate(() => { window.mode = 'normal'; window.release() }); await settle()
    await page.evaluate(() => window.setVisible(true)); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '학급 운영계획')
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls[0].key === window.calls[1].key), true)
  })
  await test('동명이인 대상 선택은 구분되고 제출 단위 이름도 구분된다', async () => {
    await page.getByRole('button', { name: '새 수합 만들기' }).click()
    await page.getByRole('checkbox', { name: '담당교사 · 동명이인 1', exact: true }).check(); await page.getByRole('checkbox', { name: '담당교사 · 동명이인 2', exact: true }).check()
    await page.getByLabel('수합 제목', { exact: true }).fill('동명이인 수합'); await page.getByLabel('제출 기한', { exact: true }).fill('2026-10-31'); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).command.input.units.map(unit => unit.label)), ['담당교사 · 동명이인 1', '담당교사 · 동명이인 2'])
  }, 'duplicate')
  await test('수합 생성·양식 업로드·공개·파일 초안·최종 제출·다운로드가 이어진다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click()
    await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(file('양식.pdf')); await page.getByRole('button', { name: '양식.pdf 제거', exact: true }).waitFor()
    await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '대상 교사에게 공개' }).click(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click()
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('작성본.pdf')); await page.getByRole('button', { name: '작성본.pdf 제거', exact: true }).waitFor()
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '저장한 파일 최종 제출' }).waitFor(); await page.getByRole('button', { name: '저장한 파일 최종 제출' }).click()
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '작성본.pdf 다운로드', exact: true }).click(); assert.deepEqual(readFileSync(await (await download).path()), file('작성본.pdf').buffer)
    assert.equal(await page.evaluate(() => window.downloadParent.kind), 'submission'); assert.match(await page.locator('body').innerText(), /서버 접수 2026-10-15T08:00:00Z/)
    assert.equal(await page.locator('[data-lock]').innerText(), 'false')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'connected-collection-mobile.png'), fullPage: true })
  })
  await test('파일 확인 대기는 저장·제출을 막고 확정된 대기는 첨부 선택을 취소할 수 있다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'pending' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('확인중.pdf')); await page.getByRole('button', { name: '첨부 선택 취소' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '제출 초안 저장', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '확인중.pdf 제거', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.uploadCalls.find(call => call.kind === 'prepare').policy.maxFiles), 1, '기본 정책 대신 현재 수합 정책을 사용')
    await page.getByRole('button', { name: '첨부 선택 취소' }).click(); assert.equal(await page.getByRole('button', { name: '제출 초안 저장', exact: true }).isDisabled(), false)
  }, 'published')
  await test('업로드 응답 유실은 같은 intent·완료 키로 확인하고 화면 재연결 뒤에도 복구한다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'unknown' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('응답유실.pdf')); await page.getByRole('button', { name: '같은 파일 상태 다시 확인' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '첨부 선택 취소' }).count(), 0)
    await remount(); await page.getByRole('button', { name: '같은 파일 상태 다시 확인' }).click(); await page.getByRole('button', { name: '응답유실.pdf 제거', exact: true }).waitFor()
    const calls = await page.evaluate(() => window.uploadCalls); assert.equal(calls.filter(call => call.kind === 'prepare').length, 1); assert.equal(calls.filter(call => call.kind === 'upload').length, 1)
    assert.deepEqual(calls.filter(call => call.kind === 'complete')[0], calls.filter(call => call.kind === 'complete')[1])
  }, 'published')
  await test('예약 후 서버의 확정 파일 거절은 선택 해제가 가능하며 화면을 잠그지 않는다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'reject' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('거절.pdf')); await page.getByRole('button', { name: '거부된 파일 선택 해제' }).click()
    await page.getByRole('button', { name: '작성 닫기' }).click(); assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.doesNotMatch(await page.locator('body').innerText(), /private-trace/)
  }, 'published')
  await test('버전 충돌 때 입력을 유지하고 최신 원본 비교를 확인한 뒤에만 다시 저장한다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click(); await page.getByLabel('안내 내용', { exact: true }).fill('내가 바꾼 안내')
    await page.evaluate(() => { window.mode = 'conflict' }); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '최신 원본과 비교' }).click()
    await page.getByText('다른 교사의 최신 안내', { exact: true }).waitFor(); assert.equal(await page.getByLabel('안내 내용', { exact: true }).inputValue(), '내가 바꾼 안내')
    await page.getByRole('button', { name: '최신 버전 확인 · 내 입력 유지' }).click(); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.at(-1).command.expectedVersion), 2)
  })
  await test('검토 의견은 재연결 후에도 남고 보완 요청→지정 보완 건 재제출이 이어진다', async () => {
    await page.evaluate(() => window.setActor(1)); await openRequest(); await page.getByRole('button', { name: '제출물 검토' }).click(); await page.getByLabel('검토 의견', { exact: true }).fill('근거 자료를 보완해 주세요'); await page.getByLabel('보완 기한', { exact: true }).fill('2026-11-03')
    assert.equal(await page.locator('[data-lock]').innerText(), 'true'); await remount(); assert.equal(await page.getByLabel('검토 의견', { exact: true }).inputValue(), '근거 자료를 보완해 주세요')
    await page.getByRole('button', { name: '보완 요청', exact: true }).click(); await page.getByText(/보완 요청 1건/).waitFor()
    await page.evaluate(() => window.setActor(0)); await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.getByLabel('재제출 사유', { exact: true }).fill('근거 자료 보완'); await page.getByLabel('응답할 보완 요청', { exact: true }).selectOption('supplement-1')
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '저장한 파일 다시 제출' }).waitFor()
    await page.waitForFunction(() => !document.querySelector('form[aria-label="제출 파일 작성"] fieldset').disabled)
    assert.equal(await page.getByLabel('재제출 사유', { exact: true }).inputValue(), '근거 자료 보완'); assert.equal(await page.getByLabel('응답할 보완 요청', { exact: true }).inputValue(), 'supplement-1')
    await page.getByRole('button', { name: '저장한 파일 다시 제출' }).click(); await page.getByText(/제출 v2/).waitFor(); assert.equal(await page.evaluate(() => window.calls.at(-1).command.correctionRequestId), 'supplement-1')
  }, 'review')
  await test('실제 소속 변경은 보관 입력을 제거하고 이전 소속의 늦은 파일 응답을 반영하지 않는다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'prepare-delay' }); await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('이전학교.pdf'))
    await page.evaluate(() => window.setActor(2)); await page.getByText('현재 볼 수 있는 수합이 없습니다.').waitFor(); await page.evaluate(() => { window.fileMode = 'ready'; window.release() }); await settle()
    assert.doesNotMatch(await page.locator('body').innerText(), /이전학교.pdf|서버 수합|제출 준비/); assert.equal(await page.evaluate(() => window.uploadCalls.filter(call => call.kind === 'upload').length), 0)
  }, 'published')
  await test('복원 시 권한이 사라지면 원본과 이전 입력을 표시하지 않는다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.mode = 'read-denied' }); await remount()
    await page.getByRole('button', { name: '연결과 원본 다시 확인' }).waitFor(); assert.equal(await page.getByRole('form', { name: '제출 파일 작성' }).count(), 0); assert.doesNotMatch(await page.locator('body').innerText(), /private-secret/)
  }, 'published')
  await test('탭 재확인은 최신 원본을 갱신하고 작성 중 입력을 그대로 유지한다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click(); await page.getByLabel('안내 내용', { exact: true }).fill('작성하던 안내')
    await page.evaluate(() => { window.state.request.instructions = '서버에 추가된 안내'; window.state.request.version++; window.refresh() })
    await page.getByRole('region', { name: '수합 상세', exact: true }).getByText('서버에 추가된 안내', { exact: true }).waitFor(); assert.equal(await page.getByLabel('안내 내용', { exact: true }).inputValue(), '작성하던 안내')
    assert.equal(await page.locator('[data-lock]').innerText(), 'true')
  })
  await test('준비 상태가 해제되어도 미확정 요청 없는 입력은 명시적으로 버리고 이동할 수 있다', async () => {
    await createInput(); if (output) await page.screenshot({ path: join(output, 'connected-collection-create.png'), fullPage: true })
    await page.evaluate(() => { window.readinessReason = 'policy_missing'; window.refresh() }); await page.getByRole('button', { name: '입력 버리고 닫기' }).click()
    assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.match(await page.locator('body').innerText(), /학교의 파일 허용 정책/)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) writeFileSync(join(output, 'results.json'), JSON.stringify({ passed: results, pageErrors: errors, externalRequests: external }, null, 2))
  console.log('서버 문서 수합 브라우저 검사: ' + results.length + '개 통과')
} finally { await browser.close() }
