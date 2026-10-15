// 실제 연결 화면의 ZIP 흐름을 합성 서버로 검증한다. DB·Storage에는 연결하지 않는다.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildSync } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bodies = ['완료 원본', '최신 정정', '다른 교사'].map(text => '%PDF-1.7\n' + text + '\n%%EOF')
const files = bodies.map((body, index) => ({ id: 'file-' + index, name: '=동일이름.pdf', extension: 'pdf', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') }))
const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{CollectionServerPanel}from'./apps/workhub/src/collections/CollectionServerPanel';
import{CollectionServerError}from'./apps/workhub/src/collections/contracts';
import{createEditDrafts,EditDraftsProvider}from'./apps/workhub/src/app/edit-drafts';
import{createPendingRequests,PendingRequestsProvider}from'./apps/workhub/src/app/pending-requests';
import theme from'./apps/workhub/src/style.css?inline';
const clone=value=>structuredClone(value),memory=createEditDrafts(),pending=createPendingRequests();
const members=['업무 담당','1반 교사','2반 교사','미제출 교사'].map((name,i)=>({id:'member-'+i,userId:'user-'+i,schoolId:'school',name,role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}));
const policy={extensions:['pdf'],maxFileBytes:1048576,maxFiles:3},now='2026-10-15T08:00:00Z',files=${JSON.stringify(files)},bodies=${JSON.stringify(bodies)};
const units=members.slice(1).map((member,i)=>({id:'unit-'+i,requestId:'request',schoolId:'school',label:i===0?'=1반':member.name,responsibleMemberId:member.id,members:[{id:member.id,userId:member.userId,name:member.name}],version:3,currentSubmissionId:i===0?'submission-1':i===1?'submission-2':null,effectiveSubmissionId:i===0?'submission-0':i===1?'submission-2':null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''}));
const request={id:'request',schoolId:'school',managerMemberId:'member-0',status:'published',version:2,publishedAt:now,title:'학급 계획 수합',instructions:'담당자용 전체 파일 내려받기',dueDate:'2026-10-31',reviewMode:'required',reviewerMemberId:'member-0',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:units.map(unit=>({label:unit.label,responsibleMemberId:unit.responsibleMemberId,contributorMemberIds:[]})),fileCollection:{policy,required:true,templates:[]}};
const submissions=files.map((file,i)=>({id:'submission-'+i,unitId:i<2?'unit-0':'unit-1',revision:i===1?2:1,submittedBy:i<2?'member-1':'member-2',receiptAt:now,receiptDate:'2026-10-15',dueSnapshot:'2026-10-31',initiallyLate:false,correctionReason:i===1?'수정':'',previousSubmissionId:i===1?'submission-0':null,reviewMode:'required',requestKey:'request-key-'+i,text:'',number:null,files:[file]}));
const reviews=[0,2].map(i=>({id:'review-'+i,unitId:i===0?'unit-0':'unit-1',submissionId:'submission-'+i,reviewerMemberId:'member-0',decision:'accepted',note:'',recordedAt:now}));
const state={request,units,submissions,reviews,supplements:[],withdrawals:[]},gates=[];
window.state=state;window.mode='normal';window.calls=[];window.details=0;window.failIds=[];window.downloadCount=0;window.release=()=>{while(gates.length)gates.shift()()};
if(window.initial==='empty'){state.submissions=[];state.reviews=[];for(const unit of units){unit.currentSubmissionId=null;unit.effectiveSubmissionId=null}}
if(window.initial==='partial')state.units=units.slice(0,2);
const server={async readiness(){return{available:true,reason:'ready',policy}},async list(){return{items:[clone(request)],nextCursor:null}},async detail(){window.details++;if(window.mode==='detail-denied')throw new CollectionServerError('FORBIDDEN','private-sql-secret');return clone(state)},async draft(){return null},async mutate(){throw Error('이 시험은 저장하지 않는다')},async download(member,parent,file){window.calls.push(clone({member,parent,file}));if(window.mode==='delay')await new Promise(resolve=>gates.push(resolve));if(window.mode==='denied')throw new CollectionServerError('FORBIDDEN','private-sql-secret');if(window.failIds.includes(file.id))throw new CollectionServerError('QUERY_FAILED','private-storage-secret');return new Blob([bodies[Number(file.id.slice(5))]])}};
function App(){const[visible,setVisible]=useState(true),[actor,setActor]=useState(window.initial==='participant'?1:0),[locked,setLocked]=useState(false),[revision,setRevision]=useState(0);window.setVisible=setVisible;window.setActor=setActor;window.refresh=()=>setRevision(n=>n+1);return <><style>{theme}{'body{margin:0;padding:12px}main{max-width:920px;margin:auto}'} </style><main><output data-lock>{String(locked)}</output><EditDraftsProvider store={memory}><PendingRequestsProvider store={pending}>{visible&&<CollectionServerPanel server={server} member={members[actor]} members={members} date="2026-10-15" revision={revision} onNavigationLockChange={setLocked}/>}</PendingRequestsProvider></EditDraftsProvider></main></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage()
const results = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5180/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
let downloads = 0
page.on('download', () => downloads++)
const prepare = () => page.getByRole('button', { name: '최신 현황으로 묶음 준비', exact: true })
const zipButton = () => page.getByRole('button', { name: 'ZIP 내려받기', exact: true })
const cancel = () => page.getByRole('button', { name: '묶음 준비 취소', exact: true })
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function test(name, run, initial = '') {
  await page.goto('http://127.0.0.1:5180/collections'); await page.evaluate(value => { window.initial = value }, initial); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: /학급 계획 수합/ }).click(); await page.getByRole('region', { name: '수합 상세', exact: true }).waitFor()
  if (initial !== 'participant') await page.getByText('제출 파일 모아 받기', { exact: true }).click()
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); throw error }
  results.push(name); console.log('  ✓ ' + name)
}
function unzip(bytes) {
  const entries = []; let offset = 0
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0)
    const size = bytes.readUInt32LE(offset + 18), names = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28), start = offset + 30 + names + extra
    entries.push({ name: bytes.subarray(offset + 30, offset + 30 + names).toString('utf8'), bytes: bytes.subarray(start, start + size) }); offset = start + size
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50); assert.equal(bytes.readUInt16LE(bytes.length - 12), entries.length)
  return entries
}
async function receive() { const wait = page.waitForEvent('download'); await zipButton().click(); const file = await wait; assert.equal(await file.failure(), null); return { name: file.suggestedFilename(), entries: unzip(readFileSync(await file.path())) } }
try {
  await test('완료본 ZIP의 원본 바이트·한글 이름·CSV 제외 현황·정확한 제출 부모가 일치한다', async () => {
    await prepare().click(); await zipButton().waitFor(); const result = await receive()
    assert.match(result.name, /완료본\.zip$/); assert.equal(result.entries.length, 3)
    assert.deepEqual(result.entries.slice(1).map(entry => entry.bytes), [Buffer.from(bodies[0]), Buffer.from(bodies[2])])
    const csv = result.entries[0].bytes.toString('utf8'); assert.equal(csv.charCodeAt(0), 0xfeff); assert.match(csv, /미제출 교사/); assert.match(csv, /완료본 없음/); assert.match(csv, /"'=1반"/)
    for (const entry of result.entries.slice(1)) assert.ok(csv.includes(entry.name))
    const calls = await page.evaluate(() => window.calls)
    assert.equal(calls.length, 4); assert.deepEqual(calls.map(call => call.parent.submissionId), ['submission-0', 'submission-2', 'submission-0', 'submission-2'])
    assert.ok(calls.every(call => call.parent.kind === 'submission' && call.parent.requestId === 'request'))
  })
  await test('최신 제출본 선택은 검토 중인 정정판을 포함하고 이전 ZIP을 버린다', async () => {
    await prepare().click(); await zipButton().waitFor(); await page.getByLabel('모을 파일 기준', { exact: true }).selectOption('current'); assert.equal(await zipButton().count(), 0)
    await prepare().click(); await zipButton().waitFor(); const result = await receive()
    assert.match(result.name, /현재 제출본\.zip$/); assert.deepEqual(result.entries.slice(1).map(entry => entry.bytes), [Buffer.from(bodies[1]), Buffer.from(bodies[2])]); assert.match(result.entries[0].bytes.toString('utf8'), /검토 대기/)
  })
  await test('파일 하나 실패하면 ZIP을 제공하지 않고 실패 파일만 다시 준비한다', async () => {
    await page.evaluate(() => { window.failIds = ['file-2'] }); await prepare().click(); const retry = page.getByRole('button', { name: '실패한 파일 다시 확인', exact: true }); await retry.waitFor()
    assert.equal(await zipButton().count(), 0); assert.doesNotMatch(await page.locator('body').innerText(), /private-storage-secret/)
    await page.evaluate(() => { window.failIds = [] }); await retry.click(); await zipButton().waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.file.id)), ['file-0', 'file-2', 'file-2']); await receive()
  })
  await test('다운로드 직전 제출 상태가 바뀌면 기존 묶음을 제공하지 않는다', async () => {
    await prepare().click(); await zipButton().waitFor(); const before = downloads
    await page.evaluate(() => { window.state.units[0].version++ }); await zipButton().click(); await page.getByRole('alert').waitFor()
    assert.equal(await zipButton().count(), 0); assert.equal(downloads, before); assert.match(await page.locator('body').innerText(), /다시 준비/)
  })
  await test('파일 접근이 거부되면 캐시한 ZIP도 제공하지 않고 서버 원문을 숨긴다', async () => {
    await prepare().click(); await zipButton().waitFor(); const before = downloads
    await page.evaluate(() => { window.mode = 'denied' }); await zipButton().click(); await page.getByRole('alert').waitFor()
    assert.equal(await zipButton().count(), 0); assert.equal(downloads, before); assert.doesNotMatch(await page.locator('body').innerText(), /private-sql-secret/)
  })
  await test('준비 중 이동을 잠그고 취소하면 늦게 도착한 파일을 버린다', async () => {
    await page.evaluate(() => { window.mode = 'delay' }); await prepare().click(); await cancel().waitFor()
    assert.equal(await page.locator('[data-lock]').innerText(), 'true'); assert.equal(await page.getByRole('button', { name: '목록으로', exact: true }).isDisabled(), true); assert.equal(await page.getByRole('button', { name: '새로 확인', exact: true }).isDisabled(), true)
    await cancel().click(); assert.equal(await page.locator('[data-lock]').innerText(), 'false'); await page.evaluate(() => { window.mode = 'normal'; window.release() }); await settle()
    assert.equal(await zipButton().count(), 0); assert.equal(await prepare().isEnabled(), true)
  })
  await test('계정 전환 뒤 이전 계정의 늦은 묶음 결과를 표시하지 않는다', async () => {
    await page.evaluate(() => { window.mode = 'delay' }); await prepare().click(); await cancel().waitFor(); const before = downloads
    await page.evaluate(() => window.setActor(1)); await settle(); await page.evaluate(() => { window.mode = 'normal'; window.release() }); await settle()
    assert.equal(await zipButton().count(), 0); assert.equal(await prepare().count(), 0); assert.equal(downloads, before); assert.equal(await page.locator('[data-lock]').innerText(), 'false')
  })
  await test('다운로드 최종 재확인 중 계정을 바꾸면 늦은 응답으로 다운로드하지 않는다', async () => {
    await prepare().click(); await zipButton().waitFor(); const before = downloads
    await page.evaluate(() => { window.mode = 'delay' }); await zipButton().click(); await cancel().waitFor()
    await page.evaluate(() => window.setActor(1)); await settle(); await page.evaluate(() => { window.mode = 'normal'; window.release() }); await settle()
    assert.equal(downloads, before); assert.equal(await zipButton().count(), 0); assert.equal(await page.locator('[data-lock]').innerText(), 'false')
  })
  await test('관리 입력을 열면 준비한 ZIP을 버리고 작성 취소 후 다시 준비할 수 있다', async () => {
    await prepare().click(); await zipButton().waitFor(); await page.getByRole('button', { name: '정정 기간 설정', exact: true }).first().click()
    assert.equal(await zipButton().count(), 0); assert.equal(await prepare().isDisabled(), true)
    await page.getByRole('button', { name: '관리 작성 취소', exact: true }).click(); assert.equal(await prepare().isEnabled(), true)
    await prepare().click(); await zipButton().waitFor()
  })
  await test('파일이 없는 수합은 모든 단위 현황을 담은 CSV만 내려받는다', async () => {
    await prepare().click(); await zipButton().waitFor(); const result = await receive(); assert.equal(result.entries.length, 1)
    assert.match(result.entries[0].bytes.toString('utf8'), /미제출 교사/); assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'empty')
  await test('일부 제출 단위만 조회된 응답은 전체 ZIP으로 만들지 않는다', async () => {
    await prepare().click(); await page.getByRole('alert').waitFor(); assert.equal(await zipButton().count(), 0); assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'partial')
  await test('담당자가 아닌 교사에게 전체 묶음 버튼을 표시하지 않는다', async () => {
    assert.equal(await page.getByText('제출 파일 모아 받기', { exact: true }).count(), 0); assert.equal(await prepare().count(), 0)
  }, 'participant')
  await test('320px 화면에서 가로 넘침 없이 키보드로 묶음 준비를 시작한다', async () => {
    await page.setViewportSize({ width: 320, height: 900 }); await prepare().focus(); await page.keyboard.press('Enter'); await zipButton().waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (output) await page.screenshot({ path: join(output, 'collection-export-320.png'), fullPage: true })
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
} finally {
  if (output) writeFileSync(join(output, 'results.json'), JSON.stringify({ results, errors, external }, null, 2))
  await browser.close()
}
console.log('\n연결 수합 ZIP 브라우저 검사: ' + results.length + '개 통과')
