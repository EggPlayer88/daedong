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
const members=['담당교사','검토교사','다른학교 교사','공동교사','관리교사'].map((name,index)=>({id:'member-'+index,userId:'user-'+index,schoolId:index===2?'school-other':'school',name,role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}));
const policy={extensions:['hwpx'],maxFileBytes:1024*1024,maxFiles:3},state={request:null,unit:null,draft:null,submissions:[],reviews:[],supplements:[],withdrawals:[]},receipts=new Map(),uploads=new Map(),gates=[];
window.mode='normal';window.fileMode='ready';window.calls=[];window.uploadCalls=[];window.applied=0;window.release=()=>{while(gates.length)gates.shift()()};
const wait=()=>new Promise(resolve=>gates.push(resolve));const now='2026-10-15T08:00:00Z';
function seed(){state.request={id:'request-1',schoolId:'school',managerMemberId:'member-0',status:'published',version:2,publishedAt:now,title:'서버 수합',instructions:'안내',dueDate:'2026-10-31',reviewMode:'required',reviewerMemberId:'member-1',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:[{label:'담당교사',responsibleMemberId:'member-0',contributorMemberIds:[]}],fileCollection:{policy:{...policy,maxFiles:1},required:true,templates:[]}};state.unit={id:'unit-1',requestId:'request-1',schoolId:'school',label:'담당교사',responsibleMemberId:'member-0',members:[{id:'member-0',userId:'user-0',name:'담당교사'}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''}}
if(window.initial==='published'||window.initial==='review'||window.initial==='duplicate')seed();
if(window.initial==='review'){const file={id:'file-seed',name:'제출.pdf',extension:'pdf',bytes:17,sha256:'a'.repeat(64)};uploads.set(file.id,{file,parent:{kind:'draft',requestId:'request-1',unitId:'unit-1',version:0},blob:new Blob(['%PDF-1.7\\nresult']),state:'ready'});state.draft={id:'draft-1',unitId:'unit-1',lastEditorMemberId:'member-0',version:1,text:'',number:null,files:[file]};state.unit.currentSubmissionId='submission-1';state.submissions=[{id:'submission-1',unitId:'unit-1',revision:1,submittedBy:'member-0',receiptAt:now,receiptDate:'2026-10-15',dueSnapshot:'2026-10-31',initiallyLate:false,correctionReason:'',previousSubmissionId:null,reviewMode:'required',requestKey:'seed',text:'',number:null,files:[file]}]}
if(window.initial==='duplicate')members[1].name='담당교사';
window.state=state;window.members=members;window.draftCalls=0;window.pendingCount=()=>pending.count();
const server={
async readiness(){return window.readinessReason?{available:false,reason:window.readinessReason,policy:null}:window.initial==='missing'?{available:false,reason:'database_missing',policy:null}:{available:true,reason:'ready',policy}},
async list(member,cursor){if(member==='member-2')return{items:[],nextCursor:null};return{items:state.request?[clone(state.request)]:[],nextCursor:null}},
async detail(member,id){if(window.failDetail)throw new CollectionServerError('QUERY_FAILED','detail-failure');if(window.mode==='read-denied'||member==='member-2')throw new CollectionServerError('FORBIDDEN','private-secret');if(window.mode==='detail-delay')await wait();if(!state.request)throw new CollectionServerError('NOT_FOUND','missing');return clone({request:state.request,units:state.unit?[state.unit]:[],submissions:state.submissions,reviews:state.reviews,supplements:state.supplements,withdrawals:state.withdrawals})},
async draft(){window.draftCalls++;if(window.mode==='draft-denied')throw new CollectionServerError('FORBIDDEN','private-secret');return clone(state.draft)},
async mutate(member,command,key){window.calls.push(clone({member,command,key}));if(window.mode==='delay')await wait();if(window.mode==='idempotency-conflict')throw new CollectionServerError('IDEMPOTENCY_CONFLICT','private-trace');if(window.mode==='not-ready')throw new CollectionServerError('NOT_READY','private-trace');if(receipts.has(key)){if(window.mode==='unknown-always')throw new CollectionServerError('RESULT_UNKNOWN','secret-trace');return clone(receipts.get(key));}if(window.mode==='conflict'){window.mode='normal';state.request={...state.request,version:state.request.version+1,instructions:'다른 교사의 최신 안내'};throw new CollectionServerError('CONFLICT','version');}let version=1,id='request-1';
if(command.kind==='create'){state.request={...clone(command.input),id,schoolId:'school',managerMemberId:member,status:'draft',version:1,publishedAt:null};}
if(command.kind==='update'){if(command.expectedVersion!==state.request.version)throw new CollectionServerError('CONFLICT','version');state.request={...state.request,...clone(command.input),version:state.request.version+1};version=state.request.version;}
if(command.kind==='publish'){state.request={...state.request,status:'published',publishedAt:now,version:state.request.version+1};state.unit={id:'unit-1',requestId:'request-1',schoolId:'school',label:state.request.units[0].label,responsibleMemberId:state.request.units[0].responsibleMemberId,members:[{id:'member-0',userId:'user-0',name:'담당교사'}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''};version=state.request.version;}
if(command.kind==='save_draft'){if(command.expectedVersion!==(state.draft?.version??0))throw new CollectionServerError('CONFLICT','version');state.draft={...clone(command.input),id:'draft-1',unitId:command.unitId,lastEditorMemberId:member,version:(state.draft?.version??0)+1};id=state.draft.id;version=state.draft.version;}
if(command.kind==='submit'){if(state.submissions.length&&!command.reason.trim())throw new CollectionServerError('INVALID_INPUT','reason');id='submission-'+(state.submissions.length+1);const submission={...clone(state.draft),id,unitId:command.unitId,revision:state.submissions.length+1,submittedBy:member,receiptAt:now,receiptDate:'2026-10-15',dueSnapshot:state.request.dueDate,initiallyLate:false,correctionReason:command.reason,previousSubmissionId:state.unit.currentSubmissionId,reviewMode:state.request.reviewMode,requestKey:key};state.submissions.push(submission);state.unit={...state.unit,version:state.unit.version+1,currentSubmissionId:id,effectiveSubmissionId:state.request.reviewMode==='none'?id:state.unit.effectiveSubmissionId};if(command.correctionRequestId){const supplement=state.supplements.find(value=>value.id===command.correctionRequestId);if(supplement){supplement.fulfilledSubmissionId=id;supplement.fulfilledAt=now;}}version=submission.revision;}
if(command.kind==='review'){if(command.expectedVersion!==state.unit.version||command.submissionId!==state.unit.currentSubmissionId)throw new CollectionServerError('CONFLICT','version');id='review-'+(state.reviews.length+1);state.reviews.push({id,unitId:command.unitId,submissionId:command.submissionId,reviewerMemberId:member,decision:command.decision,note:command.note,recordedAt:now});state.unit.version++;if(command.decision==='changes_requested')state.supplements.push({id:'supplement-1',unitId:command.unitId,submissionId:command.submissionId,dueDate:command.dueDate,fulfilledSubmissionId:null,fulfilledAt:null});else state.unit.effectiveSubmissionId=command.submissionId;id=state.unit.id;version=state.unit.version;}
if(command.kind==='open_correction'){if(command.expectedVersion!==state.unit.version)throw new CollectionServerError('CONFLICT','version');state.unit.correctionUntil=command.dueDate;state.unit.correctionReason=command.reason;state.unit.version++;id=state.unit.id;version=state.unit.version;}
if(command.kind==='withdraw'){if(command.expectedVersion!==state.unit.version||command.submissionId!==state.unit.currentSubmissionId)throw new CollectionServerError('CONFLICT','version');state.unit.withdrawnSubmissionIds.push(command.submissionId);state.withdrawals.push({id:'withdrawal-'+(state.withdrawals.length+1),unitId:command.unitId,submissionId:command.submissionId,actorMemberId:member,reason:command.reason,recordedAt:now});for(const item of state.supplements)if(item.fulfilledSubmissionId===command.submissionId){item.fulfilledSubmissionId=null;item.fulfilledAt=null;}state.unit.currentSubmissionId=state.request.reviewMode==='required'?state.unit.effectiveSubmissionId:null;if(state.request.reviewMode==='none')state.unit.effectiveSubmissionId=null;state.unit.version++;id=state.unit.id;version=state.unit.version;}
window.applied++;const receipt={requestId:'request-1',resourceId:id,resourceVersion:version,recordedAt:now,requestKey:key};receipts.set(key,receipt);if(window.mode==='draft-after-receipt'&&command.kind==='save_draft'){window.mode='normal';state.draft={...state.draft,version:state.draft.version+1,text:'기존 메모',files:[{id:'receipt-race-file',name:'접수 후 다른 교사의 파일.pdf',extension:'pdf',bytes:23,sha256:'d'.repeat(64)}]};}if(window.mode==='unknown'||window.mode==='unknown-always'){if(window.mode==='unknown')window.mode='normal';throw new CollectionServerError('RESULT_UNKNOWN','secret-trace')}return clone(receipt)},
async prepareUpload(member,parent,file,filePolicy,key){window.uploadCalls.push(clone({kind:'prepare',member,parent,policy:filePolicy,key}));if(window.fileMode==='prepare-delay')await wait();let found=[...uploads.values()].find(value=>value.key===key);if(!found){const id='file-'+(uploads.size+1);found={key,parent,file:{id,name:file.name,extension:'hwpx',bytes:file.size,sha256:'a'.repeat(64)},blob:file,state:'awaiting_upload'};uploads.set(id,found)}return{fileId:found.file.id,bucket:'private',path:found.file.id,expiresAt:'2099-01-01T00:00:00Z',state:found.state}},
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
const file = name => ({ name, mimeType: 'application/hwp+zip', buffer: Buffer.from('PK\x03\x04\n' + name + '\n%%EOF') })
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
    assert.equal(await page.getByRole('button', { name: '입력 보관하고 다른 메뉴 이용' }).isDisabled(), true)
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
  await test('준비가 해제돼도 미확정 저장은 같은 요청으로 재확인하고 한 번만 처리한다', async () => {
    await createInput(); await page.evaluate(() => { window.mode = 'unknown' }); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor(); await page.evaluate(() => { window.readinessReason = 'verification_missing'; window.refresh() })
    await page.getByRole('heading', { name: '문서 수합 연결 준비가 필요합니다' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).isDisabled(), false)
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.waitForFunction(() => window.pendingCount() === 0 && document.querySelector('[data-lock]').textContent === 'false')
    const values = await page.evaluate(() => ({ calls: window.calls, applied: window.applied })); assert.deepEqual(values.calls[0], values.calls[1]); assert.equal(values.applied, 1)
  })
  await test('재확인도 계속 실패하면 입력과 요청을 보관해 다른 메뉴로 나갔다 다시 열 수 있다', async () => {
    await createInput(); await page.getByLabel('안내 내용', { exact: true }).fill('응답이 없어도 남아야 하는 안내')
    await page.evaluate(() => { window.mode = 'unknown-always' }); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor(); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click()
    await page.waitForFunction(() => window.calls.length === 2); await page.getByRole('button', { name: '입력 보관하고 다른 메뉴 이용' }).click()
    await page.getByRole('region', { name: '보관한 수합 작업', exact: true }).waitFor(); assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.equal(await page.evaluate(() => window.pendingCount()), 1)
    assert.equal(await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'collection-recovery-mobile.png'), fullPage: true })
    assert.equal(await page.getByRole('button', { name: '새 수합 만들기' }).count(), 0)
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }), true, '보관해도 탭 닫기 전 입력 유실 경고는 유지')
    await remount(); await page.getByRole('region', { name: '보관한 수합 작업', exact: true }).waitFor(); assert.equal(await page.locator('[data-lock]').innerText(), 'false')
    await page.getByRole('button', { name: '보관한 입력과 요청 다시 열기' }).click()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '학급 운영계획'); assert.equal(await page.getByLabel('안내 내용', { exact: true }).inputValue(), '응답이 없어도 남아야 하는 안내')
    assert.equal(await page.getByRole('button', { name: '수합 초안 저장', exact: true }).isDisabled(), true)
    await page.evaluate(() => { window.mode = 'normal' }); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    const values = await page.evaluate(() => ({ calls: window.calls, applied: window.applied, pending: window.pendingCount() })); assert.equal(values.calls.length, 3); assert.deepEqual(values.calls[0], values.calls[1]); assert.deepEqual(values.calls[0], values.calls[2]); assert.equal(values.applied, 1); assert.equal(values.pending, 0)
  })
  for (const failure of ['not-ready', 'idempotency-conflict']) await test('이전 요청 재확인의 ' + failure + '도 결과를 버리지 않고 보관·재개한다', async () => {
    await createInput(); await page.evaluate(() => { window.mode = 'unknown' }); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor(); await page.evaluate(value => { window.mode = value; window.readinessReason = 'policy_missing'; window.refresh() }, failure)
    await page.getByRole('heading', { name: '문서 수합 연결 준비가 필요합니다' }).waitFor(); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.waitForFunction(() => window.calls.length === 2)
    await page.getByRole('button', { name: '입력 보관하고 다른 메뉴 이용' }).click(); await remount(); assert.equal(await page.evaluate(() => window.pendingCount()), 1); assert.equal(await page.locator('[data-lock]').innerText(), 'false')
    await page.getByRole('button', { name: '보관한 입력과 요청 다시 열기' }).click(); assert.equal(await page.locator('[data-lock]').innerText(), 'true'); assert.equal(await page.getByRole('button', { name: '입력 버리고 닫기' }).count(), 0)
    await page.evaluate(() => { window.mode = 'normal'; window.readinessReason = ''; window.refresh() }); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    const values = await page.evaluate(() => ({ calls: window.calls, applied: window.applied })); assert.equal(values.calls.length, 3); assert.deepEqual(values.calls[0], values.calls[1]); assert.deepEqual(values.calls[0], values.calls[2]); assert.equal(values.applied, 1); assert.doesNotMatch(await page.locator('body').innerText(), /private-trace|secret-trace/)
  })
  await test('다른 학교로 바뀌면 보관한 수합 입력과 미확정 요청은 함께 제거한다', async () => {
    await createInput(); await page.evaluate(() => { window.mode = 'unknown-always' }); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '입력 보관하고 다른 메뉴 이용' }).click(); await page.evaluate(() => window.setActor(2)); await page.getByText('현재 볼 수 있는 수합이 없습니다.').waitFor()
    assert.equal(await page.evaluate(() => window.pendingCount()), 0); assert.equal(await page.getByRole('region', { name: '보관한 수합 작업', exact: true }).count(), 0); assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.doesNotMatch(await page.locator('body').innerText(), /학급 운영계획/)
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
    await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(file('양식.hwpx')); await page.getByRole('button', { name: '양식.hwpx 제거', exact: true }).waitFor()
    await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '대상 교사에게 공개' }).click(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click()
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('작성본.hwpx')); await page.getByRole('button', { name: '작성본.hwpx 제거', exact: true }).waitFor()
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '저장한 파일 최종 제출' }).waitFor(); await page.getByRole('button', { name: '저장한 파일 최종 제출' }).click()
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '작성본.hwpx 다운로드', exact: true }).click(); assert.deepEqual(readFileSync(await (await download).path()), file('작성본.hwpx').buffer)
    assert.equal(await page.evaluate(() => window.downloadParent.kind), 'submission'); assert.equal(await page.locator('.cs-unit > .cs-muted time').getAttribute('datetime'), '2026-10-15T08:00:00Z'); assert.match(await page.locator('.cs-unit > .cs-muted time').innerText(), /17:00/)
    assert.equal(await page.locator('[data-lock]').innerText(), 'false')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'connected-collection-mobile.png'), fullPage: true })
  })
  await test('파일 확인 대기는 저장·제출을 막고 확정된 대기는 첨부 선택을 취소할 수 있다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'pending' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('확인중.hwpx')); await page.getByRole('button', { name: '첨부 선택 취소' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '제출 초안 저장', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '확인중.hwpx 제거', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.uploadCalls.find(call => call.kind === 'prepare').policy.maxFiles), 1, '기본 정책 대신 현재 수합 정책을 사용')
    await page.getByRole('button', { name: '첨부 선택 취소' }).click(); assert.equal(await page.getByRole('button', { name: '제출 초안 저장', exact: true }).isDisabled(), false)
  }, 'published')
  await test('업로드 응답 유실은 같은 intent·완료 키로 확인하고 화면 재연결 뒤에도 복구한다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'unknown' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('응답유실.hwpx')); await page.getByRole('button', { name: '같은 파일 상태 다시 확인' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '첨부 선택 취소' }).count(), 0)
    await remount(); await page.getByRole('button', { name: '같은 파일 상태 다시 확인' }).click(); await page.getByRole('button', { name: '응답유실.hwpx 제거', exact: true }).waitFor()
    const calls = await page.evaluate(() => window.uploadCalls); assert.equal(calls.filter(call => call.kind === 'prepare').length, 1); assert.equal(calls.filter(call => call.kind === 'upload').length, 1)
    assert.deepEqual(calls.filter(call => call.kind === 'complete')[0], calls.filter(call => call.kind === 'complete')[1])
  }, 'published')
  await test('예약 후 서버의 확정 파일 거절은 선택 해제가 가능하며 화면을 잠그지 않는다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'reject' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('거절.hwpx')); await page.getByRole('button', { name: '거부된 파일 선택 해제' }).click()
    await page.getByRole('button', { name: '작성 닫기' }).click(); assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.doesNotMatch(await page.locator('body').innerText(), /private-trace/)
  }, 'published')
  await test('버전 충돌 때 입력을 유지하고 최신 원본 비교를 확인한 뒤에만 다시 저장한다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click(); await page.getByLabel('안내 내용', { exact: true }).fill('내가 바꾼 안내')
    await page.evaluate(() => { window.mode = 'conflict' }); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '최신 원본과 비교' }).click()
    await page.getByText('다른 교사의 최신 안내', { exact: true }).waitFor(); assert.equal(await page.getByLabel('안내 내용', { exact: true }).inputValue(), '내가 바꾼 안내')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'collection-conflict-mobile.png'), fullPage: true })
    assert.equal(await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).isDisabled(), true); await page.getByRole('radio', { name: '안내 내용 · 내 입력 사용', exact: true }).check()
    await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).click(); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.at(-1).command.expectedVersion), 2)
  })
  await test('비교를 마친 뒤 서버가 다시 바뀌면 이전 선택을 재사용하지 않고 다시 선택한다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click(); await page.getByLabel('안내 내용', { exact: true }).fill('내가 작성한 안내')
    await page.evaluate(() => { window.mode = 'conflict' }); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '최신 원본과 비교' }).click(); await page.getByRole('radio', { name: '안내 내용 · 내 입력 사용', exact: true }).check(); await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).click()
    await page.evaluate(() => { window.state.request.instructions = '비교 뒤 다시 바뀐 안내'; window.state.request.version++ }); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '최신 원본과 비교' }).click()
    assert.equal(await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).isDisabled(), true); assert.equal(await page.getByRole('radio', { name: '안내 내용 · 내 입력 사용', exact: true }).isChecked(), false)
    await page.getByRole('radio', { name: '안내 내용 · 현재 서버 내용 사용', exact: true }).check(); await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).click(); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click()
    await page.getByRole('button', { name: '양식 추가·초안 수정' }).waitFor(); assert.equal(await page.evaluate(() => window.calls.at(-1).command.expectedVersion), 3); assert.equal(await page.evaluate(() => window.state.request.instructions), '비교 뒤 다시 바뀐 안내')
  })
  await test('내가 바꾸지 않은 답변 조건·검토자·대상·파일 정책은 서버의 최신 변경을 유지한다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click()
    await page.getByLabel('수합 제목', { exact: true }).fill('내가 수정한 수합 제목')
    await page.evaluate(() => {
      const request = window.state.request; request.version++; request.instructions = '서버의 상세 안내'; request.dueDate = '2026-11-01'; request.reviewMode = 'required'; request.reviewerMemberId = 'member-1'; request.textLabel = '실행 결과 요약'; request.textRequired = true; request.numberLabel = '참여 인원'; request.numberRequired = true
      request.units = [{ label: '공동 계획', responsibleMemberId: 'member-0', contributorMemberIds: ['member-3'] }]
      request.fileCollection = { required: false, policy: { extensions: ['pdf'], maxFileBytes: 524288, maxFiles: 2 }, templates: [{ id: 'latest-template', name: '최신 양식.pdf', extension: 'pdf', bytes: 17, sha256: 'b'.repeat(64) }] }
    })
    await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '최신 원본과 비교' }).click()
    const comparison = page.getByRole('region', { name: '수합 변경 충돌', exact: true })
    for (const label of ['추가 답변 항목 이름', '추가 답변 필수 여부', '숫자 답변 항목 이름', '숫자 답변 필수 여부', '검토 교사', '제출 단위와 교사', '파일 수합 설정과 양식']) await comparison.getByRole('group', { name: label, exact: true }).waitFor()
    assert.match(await comparison.innerText(), /실행 결과 요약/); assert.match(await comparison.innerText(), /참여 인원/); assert.match(await comparison.innerText(), /검토교사/); assert.match(await comparison.innerText(), /공동교사/); assert.match(await comparison.innerText(), /최신 양식.pdf/)
    assert.equal(await comparison.getByRole('radio').count(), 0); assert.equal(await page.getByRole('button', { name: '수합 초안 변경 저장' }).isDisabled(), true)
    await page.setViewportSize({ width: 320, height: 740 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'collection-comparison-all-fields-320.png'), fullPage: true })
    await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).click(); await page.getByRole('button', { name: '수합 초안 변경 저장' }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).waitFor()
    const command = await page.evaluate(() => window.calls.at(-1).command)
    assert.equal(command.expectedVersion, 2); assert.equal(command.input.title, '내가 수정한 수합 제목'); assert.equal(command.input.instructions, '서버의 상세 안내'); assert.equal(command.input.dueDate, '2026-11-01'); assert.equal(command.input.reviewMode, 'required'); assert.equal(command.input.reviewerMemberId, 'member-1')
    assert.equal(command.input.textLabel, '실행 결과 요약'); assert.equal(command.input.textRequired, true); assert.equal(command.input.numberLabel, '참여 인원'); assert.equal(command.input.numberRequired, true)
    assert.deepEqual(command.input.units, [{ label: '공동 계획', responsibleMemberId: 'member-0', contributorMemberIds: ['member-3'] }]); assert.deepEqual(command.input.fileCollection, { required: false, policy: { extensions: ['pdf'], maxFileBytes: 524288, maxFiles: 2 }, templates: [{ id: 'latest-template', name: '최신 양식.pdf', extension: 'pdf', bytes: 17, sha256: 'b'.repeat(64) }] })
    await page.setViewportSize({ width: 390, height: 844 })
  })
  await test('공동 초안의 숫자 충돌은 명시적으로 선택하고 서버가 바꾼 파일과 내 답변은 함께 보존한다', async () => {
    await page.evaluate(() => { window.state.request.textLabel = '수업 메모'; window.state.request.numberLabel = '참여 인원'; window.state.draft.text = '기존 메모'; window.state.draft.number = 10 })
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.getByLabel('수업 메모', { exact: true }).fill('내가 작성한 메모'); await page.getByLabel('참여 인원', { exact: true }).fill('20')
    await page.evaluate(() => { window.state.draft.version++; window.state.draft.number = 30; window.state.draft.files = [{ id: 'newer-file', name: '다른 교사의 파일.pdf', extension: 'pdf', bytes: 19, sha256: 'c'.repeat(64) }] })
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '최신 원본과 비교' }).click()
    const comparison = page.getByRole('region', { name: '수합 변경 충돌', exact: true }); assert.match(await comparison.getByRole('group', { name: '참여 인원', exact: true }).innerText(), /30/); assert.match(await comparison.getByRole('group', { name: '참여 인원', exact: true }).innerText(), /20/)
    assert.match(await comparison.getByRole('group', { name: '제출 파일', exact: true }).innerText(), /다른 교사의 파일.pdf/); assert.equal(await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).isDisabled(), true)
    await page.getByRole('radio', { name: '참여 인원 · 현재 서버 내용 사용', exact: true }).check(); await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).click()
    assert.equal(await page.getByLabel('수업 메모', { exact: true }).inputValue(), '내가 작성한 메모'); assert.equal(await page.getByLabel('참여 인원', { exact: true }).inputValue(), '30')
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.waitForFunction(() => window.calls.length === 2 && window.state.draft.version === 3)
    const command = await page.evaluate(() => window.calls.at(-1).command); assert.equal(command.expectedVersion, 2); assert.equal(command.input.text, '내가 작성한 메모'); assert.equal(command.input.number, 30); assert.equal(command.input.files[0].id, 'newer-file')
  }, 'review')
  await test('초안 접수 직후 다른 교사가 되돌린 최신판은 접수된 입력을 기준으로 비교한다', async () => {
    await page.evaluate(() => { window.state.request.textLabel = '수업 메모'; window.state.draft.text = '기존 메모' }); await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click()
    await page.getByLabel('수업 메모', { exact: true }).fill('접수된 수정 메모'); await page.evaluate(() => { window.mode = 'draft-after-receipt' }); await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click()
    const comparison = page.getByRole('region', { name: '수합 변경 충돌', exact: true }); await comparison.waitFor(); await comparison.getByRole('group', { name: '수업 메모', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 1); assert.equal(await page.evaluate(() => window.state.draft.version), 3); assert.equal(await page.evaluate(() => window.pendingCount()), 0)
    const textGroup = comparison.getByRole('group', { name: '수업 메모', exact: true }); await textGroup.getByText('비교 기준 원본', { exact: true }).click()
    assert.equal(await textGroup.locator('details .csc-value').innerText(), '접수된 수정 메모')
    assert.match(await comparison.getByRole('group', { name: '제출 파일', exact: true }).innerText(), /접수 후 다른 교사의 파일.pdf/)
    await page.getByRole('button', { name: '비교한 내용으로 편집 계속' }).click(); assert.equal(await page.getByLabel('수업 메모', { exact: true }).inputValue(), '기존 메모')
    assert.equal(await page.evaluate(() => window.calls.length), 1, '비교만으로 저장하지 않음'); await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.waitForFunction(() => window.calls.length === 2 && window.state.draft.version === 4)
    const command = await page.evaluate(() => window.calls.at(-1).command); assert.equal(command.expectedVersion, 3); assert.equal(command.input.text, '기존 메모'); assert.equal(command.input.files[0].id, 'receipt-race-file')
  }, 'review')
  await test('검토 의견은 재연결 후에도 남고 보완 요청→지정 보완 건 재제출이 이어진다', async () => {
    await page.evaluate(() => window.setActor(1)); await openRequest(); await page.getByRole('button', { name: '제출물 검토' }).click(); await page.getByLabel('검토 의견', { exact: true }).fill('근거 자료를 보완해 주세요'); await page.getByLabel('보완 기한', { exact: true }).fill('2026-11-03')
    assert.equal(await page.locator('[data-lock]').innerText(), 'true'); await remount(); assert.equal(await page.getByLabel('검토 의견', { exact: true }).inputValue(), '근거 자료를 보완해 주세요')
    await page.getByRole('button', { name: '보완 요청', exact: true }).click(); await page.getByText(/보완 요청 1건이 있습니다/).waitFor()
    await page.evaluate(() => window.setActor(0)); await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.getByLabel('재제출 사유', { exact: true }).fill('근거 자료 보완'); await page.getByLabel('응답할 보완 요청', { exact: true }).selectOption('supplement-1')
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '저장한 파일 다시 제출' }).waitFor()
    await page.waitForFunction(() => !document.querySelector('form[aria-label="제출 파일 작성"] fieldset').disabled)
    assert.equal(await page.getByLabel('재제출 사유', { exact: true }).inputValue(), '근거 자료 보완'); assert.equal(await page.getByLabel('응답할 보완 요청', { exact: true }).inputValue(), 'supplement-1')
    await page.getByRole('button', { name: '저장한 파일 다시 제출' }).click(); await page.getByText(/제출 v2/).waitFor(); assert.equal(await page.evaluate(() => window.calls.at(-1).command.correctionRequestId), 'supplement-1')
  }, 'review')
  await test('실제 소속 변경은 보관 입력을 제거하고 이전 소속의 늦은 파일 응답을 반영하지 않는다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.fileMode = 'prepare-delay' }); await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(file('이전학교.hwpx'))
    await page.evaluate(() => window.setActor(2)); await page.getByText('현재 볼 수 있는 수합이 없습니다.').waitFor(); await page.evaluate(() => { window.fileMode = 'ready'; window.release() }); await settle()
    assert.doesNotMatch(await page.locator('body').innerText(), /이전학교.hwpx|서버 수합|제출 준비/); assert.equal(await page.evaluate(() => window.uploadCalls.filter(call => call.kind === 'upload').length), 0)
  }, 'published')
  await test('복원 시 권한이 사라지면 원본과 이전 입력을 표시하지 않는다', async () => {
    await openRequest(); await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.evaluate(() => { window.mode = 'read-denied' }); await remount()
    await page.getByRole('button', { name: '연결과 원본 다시 확인' }).waitFor(); assert.equal(await page.getByRole('form', { name: '제출 파일 작성' }).count(), 0); assert.doesNotMatch(await page.locator('body').innerText(), /private-secret/)
  }, 'published')
  await test('탭 재확인은 최신 원본을 갱신하고 작성 중 입력을 그대로 유지한다', async () => {
    await createInput(); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정' }).click(); await page.getByLabel('안내 내용', { exact: true }).fill('작성하던 안내')
    await page.evaluate(() => { window.state.request.instructions = '서버에 추가된 안내'; window.state.request.version++; window.refresh() })
    await page.waitForFunction(() => { const field = document.querySelector('textarea[aria-label="안내 내용"]'); return field && !field.disabled })
    assert.equal(await page.getByLabel('안내 내용', { exact: true }).inputValue(), '작성하던 안내')
    assert.equal(await page.locator('[data-lock]').innerText(), 'true')
    // 편집 중에는 상세를 중복 표시하지 않는다. 취소 뒤에는 재조회한 최신 원본을 연다.
    assert.equal(await page.getByRole('region', { name: '수합 상세', exact: true }).count(), 0)
    await page.getByRole('button', { name: '작성 취소', exact: true }).click()
    await page.getByRole('region', { name: '수합 상세', exact: true }).getByText('서버에 추가된 안내', { exact: true }).waitFor()
  })
  await test('준비 상태가 해제되어도 미확정 요청 없는 입력은 명시적으로 버리고 이동할 수 있다', async () => {
    await createInput(); if (output) await page.screenshot({ path: join(output, 'connected-collection-create.png'), fullPage: true })
    await page.evaluate(() => { window.readinessReason = 'policy_missing'; window.refresh() }); await page.getByRole('button', { name: '입력 버리고 닫기' }).click()
    assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.match(await page.locator('body').innerText(), /학교의 파일 허용 정책/)
  })
  await test('개인별 대상과 공동 제출 단위를 함께 저장하며 중복 이름은 저장 전에 안내한다', async () => {
    await createInput(); await page.getByRole('button', { name: '공동 제출 단위 추가' }).click()
    await page.getByLabel('제출 단위 2 이름', { exact: true }).fill('담당교사'); await page.getByLabel('책임 교사 2', { exact: true }).selectOption('member-0')
    await page.getByRole('checkbox', { name: '공동교사 · 공동 작성자 2', exact: true }).check()
    assert.equal(await page.getByRole('button', { name: '수합 초안 저장', exact: true }).isDisabled(), true)
    await page.getByLabel('제출 단위 2 이름', { exact: true }).fill('1학년 협의회'); await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).command.input.units), [{ label: '담당교사', responsibleMemberId: 'member-0', contributorMemberIds: [] }, { label: '1학년 협의회', responsibleMemberId: 'member-0', contributorMemberIds: ['member-3'] }])
    await page.getByRole('button', { name: '양식 추가·초안 수정' }).click(); assert.equal(await page.getByLabel('제출 단위 2 이름', { exact: true }).inputValue(), '1학년 협의회')
    assert.equal(await page.getByRole('checkbox', { name: '공동교사 · 공동 작성자 2', exact: true }).isChecked(), true)
  })
  await test('명부에서 사라진 공동 작성자는 입력을 보존하고 명시적으로 해제하기 전 저장을 막는다', async () => {
    await createInput(); await page.getByRole('button', { name: '공동 제출 단위 추가' }).click(); await page.getByLabel('책임 교사 2', { exact: true }).selectOption('member-0'); await page.getByRole('checkbox', { name: '공동교사 · 공동 작성자 2', exact: true }).check()
    await page.evaluate(() => { window.members[3].active = false; window.refresh() }); await page.getByRole('checkbox', { name: '명부에 없는 공동 작성자 1 · 제출 단위 2' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '수합 초안 저장', exact: true }).isDisabled(), true)
    await page.getByRole('checkbox', { name: '명부에 없는 공동 작성자 1 · 제출 단위 2' }).click(); assert.equal(await page.getByRole('checkbox', { name: '명부에 없는 공동 작성자 1 · 제출 단위 2' }).count(), 0); assert.equal(await page.getByRole('button', { name: '수합 초안 저장', exact: true }).isDisabled(), false)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('정정 기간은 확인 뒤 정확한 단위에 저장하고 응답 유실 후 같은 요청을 재확인한다', async () => {
    await openRequest(); await page.getByRole('button', { name: '정정 기간 설정', exact: true }).click()
    await page.getByLabel('정정 허용 사유', { exact: true }).fill('담당자 확인 후 수정 허용'); await page.getByLabel('정정 종료일').fill('2026-11-05')
    assert.equal(await page.getByRole('button', { name: '정정 기간 저장' }).isDisabled(), true)
    await page.getByRole('checkbox', { name: '대상과 처리 내용을 확인했습니다' }).check(); await page.evaluate(() => { window.mode = 'unknown' }); await page.getByRole('button', { name: '정정 기간 저장' }).click()
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor(); await page.evaluate(() => { window.failDetail = true }); await remount(); await page.getByRole('button', { name: '연결과 원본 다시 확인' }).waitFor(); assert.equal(await page.getByRole('button', { name: '입력 버리고 닫기' }).count(), 0); await page.evaluate(() => { window.failDetail = false }); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click()
    await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false')
    const calls = await page.evaluate(() => window.calls); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].command.kind, 'open_correction'); assert.equal(calls[0].command.unitId, 'unit-1'); assert.equal(calls[0].command.expectedVersion, 1)
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.state.request.dueDate), '2026-10-31'); assert.equal(await page.evaluate(() => window.state.unit.correctionUntil), '2026-11-05')
  }, 'published')
  await test('무검토 제출 철회는 같은 요청으로 한 번만 처리하고 이력을 남긴 채 사유를 넣어 재제출한다', async () => {
    await page.evaluate(() => { const s = window.state; s.request.reviewMode = 'none'; s.request.reviewerMemberId = ''; s.submissions[0].reviewMode = 'none'; s.unit.effectiveSubmissionId = s.unit.currentSubmissionId })
    await openRequest(); await page.getByRole('button', { name: '제출 철회', exact: true }).click(); await page.getByLabel('철회 사유', { exact: true }).fill('잘못 올린 파일을 정정합니다')
    assert.equal(await page.getByRole('button', { name: '확인한 제출 철회 요청' }).isDisabled(), true); assert.equal(await page.evaluate(() => window.calls.length), 0)
    await page.getByRole('checkbox', { name: '대상과 처리 내용을 확인했습니다' }).check(); await page.evaluate(() => { window.mode = 'unknown' }); await page.getByRole('button', { name: '확인한 제출 철회 요청' }).click()
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor(); await remount(); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false')
    assert.equal(await page.evaluate(() => window.state.unit.currentSubmissionId), null); assert.equal(await page.evaluate(() => window.state.unit.effectiveSubmissionId), null); assert.equal(await page.evaluate(() => window.state.withdrawals.length), 1)
    assert.deepEqual(await page.evaluate(() => window.calls[0]), await page.evaluate(() => window.calls[1]))
    await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.getByLabel('재제출 사유', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '저장한 파일 다시 제출' }).isDisabled(), true)
    await page.getByLabel('재제출 사유', { exact: true }).fill('철회 후 올바른 파일로 재제출'); await page.getByRole('button', { name: '저장한 파일 다시 제출' }).click(); await page.getByText(/제출 v2 · 서버 접수/).waitFor()
    assert.equal(await page.evaluate(() => window.state.submissions[1].previousSubmissionId), null); assert.equal(await page.evaluate(() => window.state.unit.effectiveSubmissionId), 'submission-2')
  }, 'review')
  await test('검토 중인 수정본을 철회해도 이전 완료본은 유지하며 완료본 직접 철회는 제공하지 않는다', async () => {
    await page.evaluate(() => { const s = window.state; s.reviews.push({ id: 'accepted-1', unitId: 'unit-1', submissionId: 'submission-1', reviewerMemberId: 'member-1', decision: 'accepted', note: '완료 확인', recordedAt: '2026-10-15T08:00:00Z' }); s.submissions.push({ ...structuredClone(s.submissions[0]), id: 'submission-2', revision: 2, previousSubmissionId: 'submission-1', correctionReason: '수정 제출' }); s.unit.currentSubmissionId = 'submission-2'; s.unit.effectiveSubmissionId = 'submission-1'; s.unit.version = 3 })
    await openRequest(); await page.getByText('새 제출의 검토가 끝나기 전에는 완료본 v1이 유지됩니다.').waitFor(); await page.getByRole('button', { name: '제출 철회', exact: true }).click(); await page.getByLabel('철회 사유', { exact: true }).fill('수정본 철회'); await page.getByRole('checkbox', { name: '대상과 처리 내용을 확인했습니다' }).check(); await page.getByRole('button', { name: '확인한 제출 철회 요청' }).click()
    await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false'); assert.equal(await page.evaluate(() => window.state.unit.currentSubmissionId), 'submission-1'); assert.equal(await page.evaluate(() => window.state.unit.effectiveSubmissionId), 'submission-1')
    assert.equal(await page.getByRole('button', { name: '제출 철회', exact: true }).count(), 0)
  }, 'review')
  await test('검토 중 새 제출판이 생기면 이전 의견을 새 제출에 자동 적용하지 않는다', async () => {
    await page.evaluate(() => window.setActor(1)); await openRequest(); await page.getByRole('button', { name: '제출물 검토' }).click(); await page.getByLabel('검토 의견', { exact: true }).fill('이전 제출에 관한 의견')
    await page.evaluate(() => { const s = window.state; s.submissions.push({ ...structuredClone(s.submissions[0]), id: 'submission-2', revision: 2, previousSubmissionId: 'submission-1' }); s.unit.currentSubmissionId = 'submission-2'; s.unit.version++; window.refresh() })
    await page.getByRole('region', { name: '수합 변경 충돌' }).waitFor(); assert.equal(await page.getByRole('button', { name: '최신 버전 확인 · 내 입력 유지' }).count(), 0); assert.equal(await page.getByRole('button', { name: '검토 완료', exact: true }).count(), 0)
    assert.match(await page.getByRole('region', { name: '수합 변경 충돌' }).innerText(), /이전 제출에 관한 의견/); assert.equal(await page.evaluate(() => window.calls.length), 0)
    await page.getByRole('button', { name: '내 변경 버리고 다시 열기' }).click(); await page.getByRole('button', { name: '제출물 검토' }).click(); assert.equal(await page.getByLabel('검토 의견', { exact: true }).inputValue(), '')
  }, 'review')
  await test('같은 제출의 상태판 충돌은 명시적 비교 뒤에만 최신 판으로 검토한다', async () => {
    await page.evaluate(() => window.setActor(1)); await openRequest(); await page.getByRole('button', { name: '제출물 검토' }).click(); await page.getByLabel('검토 의견', { exact: true }).fill('같은 원문 검토')
    await page.evaluate(() => { window.state.unit.version++; window.state.unit.correctionUntil = '2026-11-05'; window.refresh() }); await page.getByRole('button', { name: '최신 버전 확인 · 내 입력 유지' }).click(); await page.getByRole('button', { name: '검토 완료', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false'); const command = await page.evaluate(() => window.calls.at(-1).command)
    assert.equal(command.submissionId, 'submission-1'); assert.equal(command.expectedVersion, 2); assert.equal(command.note, '같은 원문 검토')
  }, 'review')
  await test('다른 창에서 이미 검토한 제출은 이전 의견을 유지해 다시 처리하지 않는다', async () => {
    await page.evaluate(() => window.setActor(1)); await openRequest(); await page.getByRole('button', { name: '제출물 검토' }).click(); await page.getByLabel('검토 의견', { exact: true }).fill('아직 보내지 않은 의견')
    await page.evaluate(() => { const s = window.state; s.reviews.push({ id: 'other-review', unitId: 'unit-1', submissionId: 'submission-1', reviewerMemberId: 'member-1', decision: 'accepted', note: '다른 창에서 처리', recordedAt: '2026-10-15T08:30:00Z' }); s.unit.effectiveSubmissionId = 'submission-1'; s.unit.version++; window.refresh() })
    await page.getByRole('region', { name: '수합 변경 충돌' }).waitFor(); assert.equal(await page.getByRole('button', { name: '최신 버전 확인 · 내 입력 유지' }).count(), 0); assert.equal(await page.evaluate(() => window.calls.length), 0)
    await page.getByRole('button', { name: '내 변경 버리고 다시 열기' }).click(); await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false'); assert.equal(await page.getByRole('button', { name: '제출물 검토' }).count(), 0)
  }, 'review')
  await test('철회 작성 중 새 제출판이 나타나면 확인했던 대상을 바꾸지 않고 작성을 멈춘다', async () => {
    await openRequest(); await page.getByRole('button', { name: '제출 철회', exact: true }).click(); await page.getByLabel('철회 사유', { exact: true }).fill('기존 제출 철회'); await page.getByRole('checkbox', { name: '대상과 처리 내용을 확인했습니다' }).check()
    await page.evaluate(() => { const s = window.state; s.submissions.push({ ...structuredClone(s.submissions[0]), id: 'submission-2', revision: 2, previousSubmissionId: 'submission-1' }); s.unit.currentSubmissionId = 'submission-2'; s.unit.version++; window.refresh() })
    await page.getByRole('region', { name: '수합 변경 충돌' }).waitFor(); assert.equal(await page.getByRole('button', { name: '최신 버전 확인 · 내 입력 유지' }).count(), 0); assert.equal(await page.getByRole('button', { name: '확인한 제출 철회 요청' }).isDisabled(), true); assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'review')
  await test('정정 관리 권한 회수는 보관한 사유를 폐기하고 이동 잠금을 해제한다', async () => {
    await openRequest(); await page.getByRole('button', { name: '정정 기간 설정', exact: true }).click(); await page.getByLabel('정정 허용 사유', { exact: true }).fill('회수되어야 할 사유')
    await page.evaluate(() => { window.state.request.managerMemberId = 'member-4'; window.refresh() }); await page.getByText('현재 변경 권한을 확인할 수 없어 보관한 관리 입력을 버렸습니다.').waitFor()
    assert.equal(await page.getByRole('form', { name: '제출 관리' }).count(), 0); assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.doesNotMatch(await page.locator('body').innerText(), /회수되어야 할 사유/)
  }, 'published')
  await test('공동 작성자는 초안을 저장할 수 있지만 최종 제출과 철회는 책임 교사에게만 보인다', async () => {
    await page.evaluate(() => { window.state.unit.members.push({ id: 'member-3', userId: 'user-3', name: '공동교사' }); window.setActor(3) }); await openRequest(); assert.equal(await page.getByRole('button', { name: '제출 철회', exact: true }).count(), 0)
    await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('form[aria-label="제출 파일 작성"] fieldset').disabled)
    assert.equal(await page.getByRole('button', { name: /저장한 파일 .*제출/ }).count(), 0); assert.equal(await page.evaluate(() => window.calls.at(-1).command.kind), 'save_draft')
  }, 'review')
  await test('제출 단위 밖의 수합 관리자는 초안을 조회하지 않고 정정 기간만 관리한다', async () => {
    await page.evaluate(() => { window.state.request.managerMemberId = 'member-4'; window.setActor(4) }); await openRequest(); assert.equal(await page.getByRole('button', { name: '내 제출 파일 작성' }).count(), 0); assert.equal(await page.evaluate(() => window.draftCalls), 0)
    await page.getByRole('button', { name: '정정 기간 설정', exact: true }).click(); assert.equal(await page.evaluate(() => window.draftCalls), 0)
  }, 'review')
  await test('과거 제출 다운로드는 선택한 제출판을 전달하고 철회판은 내려받기 버튼을 제공하지 않는다', async () => {
    await page.evaluate(() => { const s = window.state; s.submissions.push({ ...structuredClone(s.submissions[0]), id: 'submission-2', revision: 2, previousSubmissionId: 'submission-1' }); s.unit.currentSubmissionId = 'submission-2'; s.unit.version++ })
    await openRequest(); await page.locator('summary').filter({ hasText: '제출 이력 · 2판' }).click(); const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '제출 v1 제출.pdf 내려받기', exact: true }).click(); await downloaded
    assert.deepEqual(await page.evaluate(() => window.downloadParent), { kind: 'submission', requestId: 'request-1', unitId: 'unit-1', submissionId: 'submission-1' })
    await page.getByRole('button', { name: '제출 철회', exact: true }).click(); await page.getByLabel('철회 사유', { exact: true }).fill('새 제출 철회'); await page.getByRole('checkbox', { name: '대상과 처리 내용을 확인했습니다' }).check(); await page.getByRole('button', { name: '확인한 제출 철회 요청' }).click(); await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false')
    const history = page.locator('details.csh-details'); if (!(await history.evaluate(element => element.open))) await history.locator('summary').click()
    await page.getByRole('heading', { name: '제출 v2 · 철회됨', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '제출 v2 제출.pdf 내려받기', exact: true }).count(), 0)
    await page.setViewportSize({ width: 320, height: 740 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'collection-management-history-320.png'), fullPage: true })
  }, 'review')
  await test('상세 조회만 실패해 관리 폼이 숨겨져도 미전송 입력은 버리고 나갈 수 있다', async () => {
    await openRequest(); await page.getByRole('button', { name: '제출 철회', exact: true }).click(); await page.getByLabel('철회 사유', { exact: true }).fill('아직 전송하지 않은 철회 사유')
    await page.evaluate(() => { window.failDetail = true }); await page.getByRole('button', { name: '새로 확인', exact: true }).click(); await page.getByRole('button', { name: '입력 버리고 닫기', exact: true }).click()
    assert.equal(await page.locator('[data-lock]').innerText(), 'false'); assert.equal(await page.evaluate(() => window.calls.length), 0); await page.evaluate(() => { window.failDetail = false }); await openRequest(); assert.equal(await page.getByRole('form', { name: '제출 관리' }).count(), 0)
  }, 'review')
  await test('보완 응답판 철회로 현재 제출이 비어도 미완료 보완을 선택해 다시 제출할 수 있다', async () => {
    await page.evaluate(() => { const s = window.state; s.submissions.push({ ...structuredClone(s.submissions[0]), id: 'submission-2', revision: 2, previousSubmissionId: 'submission-1', correctionReason: '보완 응답' }); s.unit.currentSubmissionId = 'submission-2'; s.unit.version = 3; s.reviews.push({ id: 'review-1', unitId: 'unit-1', submissionId: 'submission-1', reviewerMemberId: 'member-1', decision: 'changes_requested', note: '근거 보완', recordedAt: '2026-10-15T08:00:00Z' }); s.supplements.push({ id: 'supplement-1', unitId: 'unit-1', submissionId: 'submission-1', dueDate: '2026-10-14', fulfilledSubmissionId: 'submission-2', fulfilledAt: '2026-10-15T08:00:00Z' }) })
    await openRequest(); await page.getByRole('button', { name: '제출 철회', exact: true }).click(); await page.getByLabel('철회 사유', { exact: true }).fill('보완 파일 교체'); await page.getByRole('checkbox', { name: '대상과 처리 내용을 확인했습니다' }).check(); await page.getByRole('button', { name: '확인한 제출 철회 요청' }).click(); await page.waitForFunction(() => document.querySelector('[data-lock]').textContent === 'false')
    assert.equal(await page.evaluate(() => window.state.unit.currentSubmissionId), null); assert.equal(await page.evaluate(() => window.state.supplements[0].fulfilledSubmissionId), null)
    await page.getByRole('button', { name: '내 제출 파일 작성' }).click(); await page.getByLabel('재제출 사유', { exact: true }).fill('보완 응답 다시 제출'); await page.getByLabel('응답할 보완 요청', { exact: true }).selectOption('supplement-1'); await page.getByRole('button', { name: '저장한 파일 다시 제출' }).click(); await page.getByText(/제출 v3 · 서버 접수/).waitFor()
    assert.equal(await page.evaluate(() => window.calls.at(-1).command.correctionRequestId), 'supplement-1'); assert.equal(await page.evaluate(() => window.state.supplements[0].fulfilledSubmissionId), 'submission-3')
  }, 'review')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) writeFileSync(join(output, 'results.json'), JSON.stringify({ passed: results, pageErrors: errors, externalRequests: external }, null, 2))
  console.log('서버 문서 수합 브라우저 검사: ' + results.length + '개 통과')
} finally { await browser.close() }
