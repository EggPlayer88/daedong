// HWPX 전용 화면의 새 업로드 제한과 기존 파일 보존을 합성 서버에서 확인한다.
// 이 시험은 서버의 HWPX 본문 검사나 실제 Storage 검증을 대신하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{CollectionServerPanel}from'./apps/workhub/src/collections/CollectionServerPanel';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
const clone=value=>structuredClone(value),now='2026-10-15T08:00:00Z';
const members=['담당교사','검토교사'].map((name,index)=>({id:'member-'+index,userId:'user-'+index,schoolId:'school',name,role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}));
const policy={extensions:window.scenario==='policy-missing'?['pdf']:['pdf','hwpx'],maxFileBytes:1024,maxFiles:3};
const oldFile={id:'old-pdf',name:'기존 양식.pdf',extension:'pdf',bytes:10,sha256:'a'.repeat(64)};
const request={id:'request-1',schoolId:'school',managerMemberId:'member-0',title:'기존 수합',instructions:'기존 안내',dueDate:'2026-10-31',reviewMode:'none',reviewerMemberId:'',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:[{label:'담당교사',responsibleMemberId:'member-0',contributorMemberIds:[]}],fileCollection:{policy:window.scenario==='old-only'?{...policy,extensions:['pdf']}:policy,required:true,templates:[oldFile]},status:window.scenario==='answer'?'published':'draft',version:1,publishedAt:window.scenario==='answer'?now:null};
const unit={id:'unit-1',requestId:'request-1',schoolId:'school',label:'담당교사',responsibleMemberId:'member-0',members:[{id:'member-0',userId:'user-0',name:'담당교사'}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''};
const drafts={id:'draft-1',unitId:'unit-1',version:1,lastEditorMemberId:'member-0',text:'기존 메모',number:null,files:[{...oldFile,id:'old-answer',name:'기존 작성본.pdf'}]};
let latestFile;window.calls=[];window.prepares=[];window.downloads=[];window.completes=[];window.fileMode='ready';
const server={async readiness(){return window.scenario==='missing'?{available:false,reason:'verification_missing',policy:null}:{available:true,reason:'ready',policy:clone(policy)}},async list(){return{items:[clone(request)],nextCursor:null}},async detail(){return{request:clone(request),units:[clone(unit)],submissions:[],reviews:[],supplements:[],withdrawals:[]}},async draft(){return clone(drafts)},async mutate(member,command,key){window.calls.push(clone({member,command,key}));if(command.kind==='create'||command.kind==='update'){Object.assign(request,clone(command.input));request.version++}return{requestId:'request-1',resourceId:'request-1',resourceVersion:request.version,recordedAt:now,requestKey:key}},async prepareUpload(member,parent,file,selectedPolicy,key){window.prepares.push(clone({parent,policy:selectedPolicy,key}));latestFile={id:'new-file',name:file.name,extension:'hwpx',bytes:file.size,sha256:'b'.repeat(64)};return{fileId:'new-file',bucket:'private',path:'new-file',expiresAt:'2099-01-01T00:00:00Z',state:'awaiting_upload'}},async upload(){},async completeUpload(member,id,key){window.completes.push({id,key});return{fileId:'new-file',state:window.fileMode==='pending'?'pending_verification':'ready',file:window.fileMode==='pending'?null:clone(latestFile)}},async fileStatus(){throw Error('예상하지 않은 상태 조회')},async download(member,parent,file){window.downloads.push(clone({parent,file}));return new Blob(['기존 PDF'])}};
createRoot(document.getElementById('root')).render(<EditDraftsProvider store={createEditDrafts()}><PendingRequestsProvider store={createPendingRequests()}><CollectionServerPanel server={server} member={members[0]} members={members} date="2026-10-15"/></PendingRequestsProvider></EditDraftsProvider>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage()
const passed = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
async function start(scenario = '') {
  await page.goto('http://127.0.0.1:5179/collections'); await page.evaluate(value => { window.scenario = value }, scenario)
  await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: '문서 수합', exact: true }).waitFor()
}
async function test(name, action, scenario = '') { await start(scenario); await action(); passed.push(name); console.log('  ✓ ' + name) }
async function openEditor() { await page.getByRole('button', { name: /기존 수합/ }).click(); await page.getByRole('button', { name: '양식 추가·초안 수정', exact: true }).click() }
const hwpx = { name: '새 양식.hwpx', mimeType: 'application/hwp+zip', buffer: Buffer.from('PK synthetic UI upload') }
try {
  await test('연결 전에는 HWPX 준비 안내를 표시하고 새 수합을 열지 않는다', async () => {
    await page.getByText('HWPX 전용 수합 연결을 준비 중입니다.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '새 수합 만들기', exact: true }).count(), 0)
    assert.doesNotMatch(await page.locator('body').innerText(), /악성코드 검사 완료|바이러스 검사 완료/)
  }, 'missing')
  await test('새 수합은 HWPX만 저장하고 서버의 파일 크기와 개수는 유지한다', async () => {
    await page.getByRole('button', { name: '새 수합 만들기', exact: true }).click()
    assert.equal(await page.locator('.cs-optional').evaluate(element => element.open), false)
    await page.getByLabel('수합 제목', { exact: true }).fill('새 수합'); await page.getByLabel('제출 기한', { exact: true }).fill('2026-10-31')
    await page.getByRole('checkbox', { name: '담당교사', exact: true }).check()
    await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.waitForFunction(() => window.calls.length === 1)
    assert.deepEqual(await page.evaluate(() => window.calls[0].command.input.fileCollection.policy), { extensions: ['hwpx'], maxFileBytes: 1024, maxFiles: 3 })
  })
  await test('선택기 제한을 우회한 PDF·빈 파일·용량 초과는 업로드 예약 전에 막는다', async () => {
    await openEditor(); const picker = page.getByLabel('양식 파일 선택', { exact: true }); assert.equal(await picker.getAttribute('accept'), '.hwpx')
    await picker.setInputFiles({ name: '잘못된 양식.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') })
    await page.getByText('HWPX 파일만 새로 올릴 수 있습니다. 한글에서 HWPX 형식으로 저장해 주세요.', { exact: true }).waitFor()
    await picker.setInputFiles({ ...hwpx, buffer: Buffer.alloc(0) }); await page.getByText('파일 크기가 허용 범위를 벗어났습니다.', { exact: true }).waitFor()
    await picker.setInputFiles({ ...hwpx, buffer: Buffer.alloc(1025) }); assert.equal(await page.evaluate(() => window.prepares.length), 0)
    assert.equal(await page.getByRole('region', { name: '서버 파일 확인', exact: true }).count(), 0)
  })
  await test('HWPX 새 첨부를 저장해도 기존 PDF 양식·파일 규칙을 바꾸지 않는다', async () => {
    await openEditor(); await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx)
    await page.getByRole('button', { name: '새 양식.hwpx 제거', exact: true }).waitFor(); await page.getByRole('button', { name: '수합 초안 변경 저장', exact: true }).click()
    await page.waitForFunction(() => window.calls.length === 1)
    const values = await page.evaluate(() => ({ command: window.calls[0].command, prepare: window.prepares[0] }))
    assert.deepEqual(values.prepare.policy, { extensions: ['hwpx'], maxFileBytes: 1024, maxFiles: 3 })
    assert.deepEqual(values.command.input.fileCollection.policy.extensions, ['pdf', 'hwpx'])
    assert.deepEqual(values.command.input.fileCollection.templates.map(file => file.name), ['기존 양식.pdf', '새 양식.hwpx'])
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '기존 양식.pdf 다운로드', exact: true }).click(); await downloaded
    assert.equal(await page.evaluate(() => window.downloads[0].file.extension), 'pdf')
  })
  await test('기본 확인이 대기 중이면 같은 완료 요청 번호로 다시 확인해 멈춤을 복구한다', async () => {
    await openEditor(); await page.evaluate(() => { window.fileMode = 'pending' })
    await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx)
    const retry = page.getByRole('button', { name: '같은 파일 상태 다시 확인', exact: true }); await retry.waitFor()
    assert.equal(await page.evaluate(() => window.completes.length), 1)
    await page.evaluate(() => { window.fileMode = 'ready' }); await retry.click(); await page.getByRole('button', { name: '새 양식.hwpx 제거', exact: true }).waitFor()
    const values = await page.evaluate(() => ({ completes: window.completes, prepares: window.prepares }))
    assert.equal(values.prepares.length, 1); assert.equal(values.completes.length, 2); assert.deepEqual(values.completes[0], values.completes[1])
  })
  await test('기존 PDF 전용 수합은 새 업로드 안내만 표시하고 기존 다운로드는 유지한다', async () => {
    await openEditor(); assert.equal(await page.getByLabel('양식 파일 선택', { exact: true }).count(), 0)
    await page.getByText(/이 수합의 파일 규칙에는 HWPX가 포함되어 있지 않습니다/).waitFor()
    assert.equal(await page.getByRole('button', { name: '기존 양식.pdf 다운로드', exact: true }).isEnabled(), true)
    assert.equal(await page.evaluate(() => window.prepares.length), 0)
  }, 'old-only')
  await test('제출 파일 선택도 HWPX만 허용하고 기존 초안 파일은 그대로 남긴다', async () => {
    await page.getByRole('button', { name: /기존 수합/ }).click(); await page.getByRole('button', { name: '내 제출 파일 작성', exact: true }).click()
    const picker = page.getByLabel('제출 파일 선택', { exact: true }); assert.equal(await picker.getAttribute('accept'), '.hwpx')
    await picker.setInputFiles({ ...hwpx, name: '작성본.hwpx' }); await page.getByRole('button', { name: '작성본.hwpx 제거', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '기존 작성본.pdf 제거', exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => window.prepares[0].parent.kind), 'draft')
    await page.setViewportSize({ width: 320, height: 740 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'hwpx-submission-320.png'), fullPage: true }) }
  }, 'answer')
  await test('학교 규칙에 HWPX가 없으면 새 수합을 막되 기존 목록은 표시한다', async () => {
    await page.getByText('HWPX 수합 규칙을 먼저 연결해야 새 수합을 만들 수 있습니다. 기존 기록은 확인할 수 있습니다.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '새 수합 만들기', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: /기존 수합/ }).count(), 1)
  }, 'policy-missing')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) { mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'results.json'), JSON.stringify({ passed, pageErrors: errors, externalRequests: external }, null, 2)) }
  console.log('HWPX 전용 문서 수합 브라우저 검사: ' + passed.length + '개 통과')
} finally { await browser.close() }
