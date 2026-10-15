// 실제 화면·브라우저 파일 선택·다운로드를 합성 문서와 현재 탭 저장소로 검증한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
  import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';
  import{createWorkflowStore}from'./apps/workhub/src/workflows/store';import{persistentWorkflowSnapshot}from'./apps/workhub/src/workflows/file-persistence';
  import{createPreviewFileRepository}from'./apps/workhub/src/files/preview-repository';import{fixtureData}from'./apps/workhub/src/preview/fixtures';
  import{FileError}from'./apps/workhub/src/files/contracts';
  import theme from'./apps/workhub/src/style.css?inline';import workflow from'./apps/workhub/src/workflows/workflows.css?inline';import filesStyle from'./apps/workhub/src/files/files.css?inline';
  const members=fixtureData.memberships,policy={extensions:['pdf'],maxFileBytes:2048,maxFiles:3},originalFiles=createPreviewFileRepository();let failWrite=false,failFile=false,serial=0;
  const files={...originalFiles,read(...args){if(failFile){failFile=false;return Promise.reject(new FileError('FILE_READ_FAILED'))}return originalFiles.read(...args)}};
  const store=createWorkflowStore({members,date:fixtureData.basisDate,files,onChange(value){if(failWrite){failWrite=false;throw Error('합성 저장 실패')}localStorage.setItem('qa-workflow',JSON.stringify(persistentWorkflowSnapshot(value)))}});
  window.qa={snapshot:()=>store.exportState(),fail(){failWrite=true},failFile(){failFile=true},async externalAnswer(unitId){const ref=await files.stage(new File(['%PDF-1.4\\n합성 외부 수정\\n%%EOF'],'다른 작성자 추가.pdf',{type:'application/pdf'}),policy,{schoolId:'fixture-school-gaon',memberId:'gaon-seojin'});const draft=store.getDraft('gaon-seojin',unitId);store.saveDraft('gaon-seojin',unitId,{text:'다른 작성자의 수정 내용',number:null,files:[...draft.files,ref]},draft.version,'external-'+(++serial))},async externalSubmission(unitId){const ref=await files.stage(new File(['%PDF-1.4\\n합성 문서 외부 정정 제출.pdf\\n%%EOF'],'외부 정정 제출.pdf',{type:'application/pdf'}),policy,{schoolId:'fixture-school-gaon',memberId:'gaon-soyeon'});const draft=store.getDraft('gaon-soyeon',unitId),saved=store.saveDraft('gaon-soyeon',unitId,{text:'외부 정정',number:null,files:[ref]},draft.version,'external-draft-'+(++serial));store.submit('gaon-soyeon',unitId,saved.version,store.unitSummary('gaon-soyeon',unitId).unit.version,'external-submit-'+(++serial),'다른 창의 합성 정정')}};
  function App(){const[id,setId]=useState('gaon-minjun'),[locked,setLocked]=useState(false),[generation,setGeneration]=useState(0),[target,setTarget]=useState();window.qa.open=id=>{setTarget(id);setGeneration(n=>n+1)};const member=members.find(m=>m.id===id);return <><style>{theme}{workflow}{filesStyle}{'body{margin:0;background:#f5f7ef}main{padding:20px;max-width:1250px;margin:auto}'} </style><main><p>파일 수합 브라우저 검증 · 합성 자료</p><label>검증 소속<select aria-label="검증 소속" value={id} disabled={locked} onChange={e=>{setId(e.target.value);setGeneration(n=>n+1)}}>{members.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><EditSession onLockChange={setLocked}><WorkflowPanel key={id+generation} store={store} files={files} filePolicy={policy} member={member} members={members} date={fixtureData.basisDate} page="collections" initialRequestId={target}/></EditSession></main></>}
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const payload = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n합성 문서 ${name}\n%%EOF`) })
const template = payload('합성 수합 양식.pdf'), shared = payload('공동 작성 파일.pdf'), extra = payload('책임자 추가 파일.pdf')
const form = () => page.getByRole('form', { name: '수합 만들기 양식', exact: true })
const unit = () => page.getByRole('article', { name: '2학년 1반 제출 단위', exact: true })
const answer = () => unit().getByRole('form', { name: '2학년 1반 응답 초안', exact: true })
const confirmation = () => answer().getByRole('checkbox', { name: '저장한 파일 목록과 내용을 확인했습니다', exact: true })
const submit = () => answer().getByRole('button', { name: '최종 제출', exact: true })
const state = () => page.evaluate(() => window.qa.snapshot())
const picked = (scope, label) => scope.getByRole('region', { name: label, exact: true })
async function actor(memberId, requestId) { await page.getByLabel('검증 소속', { exact: true }).selectOption(memberId); if (requestId) await page.evaluate(id => window.qa.open(id), requestId) }
async function upload(scope, label, value) { await scope.getByLabel(label + ' 선택', { exact: true }).setInputFiles(value); await picked(scope, label).getByText('기본 검사 완료 · 현재 창에 보관', { exact: true }).waitFor() }
async function receiveDownload(button) {
  const received = page.waitForEvent('download'); await button.click(); const file = await received
  const chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk)
  assert.equal(await file.failure(), null)
  return { name: file.suggestedFilename(), buffer: Buffer.concat(chunks) }
}
async function download(button, expected) { assert.deepEqual(await receiveDownload(button), { name: expected.name, buffer: expected.buffer }) }
function zipEntries(bytes) {
  const entries = []; let offset = 0
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, '합성 ZIP은 압축 없는 문서 바이트를 유지한다')
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength
    entries.push({ name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), buffer: bytes.subarray(start, start + size) })
    offset = start + size
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50)
  assert.equal(bytes.readUInt16LE(bytes.length - 12), entries.length)
  return entries
}
function checkZip(received, expectedFile, mode, revision) {
  assert.equal(received.name, `합성 학교 파일 수합_${mode === 'effective' ? '완료본' : '최신제출본'}.zip`)
  const entries = zipEntries(received.buffer)
  assert.equal(entries.length, 2); assert.equal(entries[0].name, '001_수합현황.csv')
  assert(entries[1].name.endsWith(expectedFile.name)); assert.deepEqual(entries[1].buffer, expectedFile.buffer)
  const csv = entries[0].buffer.toString('utf8')
  for (const part of ['2학년 1반', mode === 'effective' ? '완료본' : '최신 제출본', 'v' + revision, expectedFile.name, entries[1].name]) assert(csv.includes(part))
}
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
let requestId, unitId
try {
  await page.goto('http://127.0.0.1:5176/file-collections')
  await test('양식 파일을 선택하고 파일 수합의 대상·필수·검토를 실제 양식에서 설정한다', async () => {
    await page.getByRole('button', { name: '+ 파일 수합 만들기', exact: true }).click()
    await form().getByLabel('수합 제목', { exact: true }).fill('합성 학교 파일 수합')
    await form().getByLabel('목적·안내', { exact: true }).fill('합성 양식을 내려받아 작성한 뒤 제출합니다.')
    await form().getByLabel('마감일', { exact: true }).fill('2026-10-21')
    await form().getByLabel('검토 방식', { exact: true }).selectOption('required')
    await form().getByLabel('검토자', { exact: true }).selectOption('gaon-minjun')
    await form().getByLabel('단위 1 이름', { exact: true }).fill('2학년 1반')
    await form().getByLabel('단위 1 최종 제출 책임자', { exact: true }).selectOption('gaon-soyeon')
    await form().getByRole('group', { name: '제출 단위 1', exact: true }).getByLabel('김서진', { exact: true }).check()
    await upload(form(), '양식 파일', template)
    assert(await form().getByRole('checkbox', { name: '제출 파일 필수', exact: true }).isChecked())
    assert.match(await form().innerText(), /새로고침하면 초기화/)
  })
  await test('요청 저장 실패가 양식 선택·제목·대상을 지우지 않고 재시도한다', async () => {
    await page.evaluate(() => window.qa.fail()); await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    assert.match(await form().getByRole('alert').innerText(), /합성 저장 실패/)
    assert.equal(await form().getByLabel('수합 제목', { exact: true }).inputValue(), '합성 학교 파일 수합')
    assert.equal(await picked(form(), '양식 파일').getByText(template.name, { exact: true }).count(), 1)
    assert.equal((await state()).requests.length, 0)
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    requestId = (await state()).requests[0].id
    assert.equal((await state()).requests[0].fileCollection.templates[0].name, template.name)
    await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    unitId = (await state()).units[0].id
    assert.equal((await state()).requests[0].status, 'published')
  })
  await test('대상 교사는 배포된 양식을 실제 파일로 내려받고 원본 바이트가 같다', async () => {
    await actor('gaon-soyeon', requestId)
    await download(page.getByRole('button', { name: template.name + ' 다운로드', exact: true }), template)
    await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
  })
  await test('빈 필수 파일도 초안은 저장하지만 확인 체크만으로 최종 제출하지 못한다', async () => {
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert.deepEqual((await state()).drafts[0].files, [])
    await confirmation().check(); assert(await submit().isDisabled())
    assert.equal((await state()).submissions.length, 0)
    await unit().getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click()
  })
  await test('공동 작성자가 올린 초안 파일이 책임자의 편집 화면에도 그대로 남는다', async () => {
    await actor('gaon-seojin', requestId); await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    assert.equal(await answer().getByRole('button', { name: '최종 제출', exact: true }).count(), 0)
    await upload(answer(), '제출 파일', shared)
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    await unit().getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click()
    await actor('gaon-soyeon', requestId); await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    assert.equal(await picked(answer(), '제출 파일').getByText(shared.name, { exact: true }).count(), 1)
    assert(!(await confirmation().isChecked())); assert(await submit().isDisabled())
    await download(answer().getByRole('button', { name: shared.name + ' 다운로드', exact: true }), shared)
  })
  await test('파일 추가·저장 실패 때 공동 파일과 새 파일·입력을 모두 보존한다', async () => {
    await confirmation().check(); assert(!(await submit().isDisabled()))
    await upload(answer(), '제출 파일', extra)
    assert(!(await confirmation().isChecked())); assert(await confirmation().isDisabled()); assert(await submit().isDisabled())
    await answer().getByLabel('전달 사항', { exact: true }).fill('저장 실패에도 보존할 전달 사항')
    await page.evaluate(() => window.qa.fail()); await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert.match(await answer().getByRole('alert').innerText(), /합성 저장 실패/)
    for (const name of [shared.name, extra.name]) assert.equal(await picked(answer(), '제출 파일').getByText(name, { exact: true }).count(), 1)
    assert.equal(await answer().getByLabel('전달 사항', { exact: true }).inputValue(), '저장 실패에도 보존할 전달 사항')
    assert.deepEqual((await state()).drafts[0].files.map(file => file.name), [shared.name])
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert.deepEqual((await state()).drafts[0].files.map(file => file.name), [shared.name, extra.name])
    assert(!(await confirmation().isChecked())); assert(await submit().isDisabled())
  })
  await test('다른 작성자가 초안을 바꾸면 확인 체크가 무효화되고 최신 파일과 비교한다', async () => {
    await confirmation().check(); await page.evaluate(id => window.qa.externalAnswer(id), unitId)
    await answer().getByText('최신 파일: ' + [shared.name, extra.name, '다른 작성자 추가.pdf'].join(', '), { exact: true }).waitFor()
    assert(!(await confirmation().isChecked())); assert(await confirmation().isDisabled()); assert(await submit().isDisabled())
    await answer().getByRole('button', { name: '최신 내용 확인 · 내 입력 유지', exact: true }).click()
    assert.equal(await answer().getByLabel('전달 사항', { exact: true }).inputValue(), '저장 실패에도 보존할 전달 사항')
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert.deepEqual((await state()).drafts[0].files.map(file => file.name), [shared.name, extra.name])
    assert(!(await confirmation().isChecked()))
  })
  await test('잘못된 확장자는 기존 선택을 보존하며 파일 제거·재저장 후 다시 확인한다', async () => {
    await answer().getByLabel('제출 파일 선택', { exact: true }).setInputFiles({ name: '합성 거부.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('합성 거부') })
    await picked(answer(), '제출 파일').getByRole('alert').waitFor()
    assert.match(await picked(answer(), '제출 파일').getByRole('alert').innerText(), /확장자/)
    for (const name of [shared.name, extra.name]) assert.equal(await picked(answer(), '제출 파일').getByText(name, { exact: true }).count(), 1)
    await confirmation().check()
    await answer().getByRole('button', { name: extra.name + ' 제거', exact: true }).click()
    assert(!(await confirmation().isChecked())); assert(await submit().isDisabled())
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert(!(await confirmation().isChecked())); await confirmation().check()
  })
  await test('최종 제출 실패 후 같은 파일과 확인 상태로 재시도해 한 판만 접수한다', async () => {
    await page.evaluate(() => window.qa.fail()); await submit().click()
    assert.match(await answer().getByRole('alert').innerText(), /합성 저장 실패/)
    assert(await confirmation().isChecked()); assert.equal((await state()).submissions.length, 0)
    await submit().click()
    assert.equal((await state()).submissions.length, 1)
    assert.deepEqual((await state()).submissions[0].files.map(file => file.name), [shared.name])
    assert.equal((await state()).units[0].effectiveSubmissionId, null)
    assert.match(await unit().innerText(), /검토 대기/)
  })
  await test('담당자가 현재 제출 파일을 내려받고 해당 판을 검토 완료로 확정한다', async () => {
    await actor('gaon-minjun', requestId)
    assert.equal(await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).count(), 0)
    await download(unit().getByRole('button', { name: shared.name + ' 다운로드', exact: true }), shared)
    await unit().getByLabel('검토 의견', { exact: true }).fill('합성 제출 파일을 확인했습니다.')
    await unit().getByRole('button', { name: '이 버전 검토 완료', exact: true }).click()
    const snapshot = await state(); assert.equal(snapshot.units[0].effectiveSubmissionId, snapshot.submissions[0].id)
    assert.equal(snapshot.reviews[0].decision, 'accepted')
    if (output) await page.screenshot({ path: join(output, 'file-collections-desktop.png'), fullPage: true })
  })
  await test('완료본 묶음은 실패 파일 재확인 후에만 내려받고 CSV와 원본 바이트를 담는다', async () => {
    await page.getByText('제출 파일 모아 받기', { exact: true }).click()
    const section = page.locator('.wf-file-export')
    assert.equal(await section.getByRole('combobox', { name: /모을 파일 기준/ }).inputValue(), 'effective')
    await page.evaluate(() => window.qa.failFile())
    await section.getByRole('button', { name: '최신 현황으로 묶음 준비', exact: true }).click()
    await section.getByRole('alert').waitFor(); assert.match(await section.getByRole('alert').innerText(), /모두 확인되기 전/)
    assert.equal(await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).count(), 0)
    await section.getByRole('button', { name: '실패한 파일 다시 확인', exact: true }).click()
    await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).waitFor()
    checkZip(await receiveDownload(section.getByRole('button', { name: 'ZIP 내려받기', exact: true })), shared, 'effective', 1)
  })
  await test('준비 뒤 바뀐 제출은 재준비를 요구하고 완료본과 최신 제출본을 서로 구분한다', async () => {
    const section = page.locator('.wf-file-export')
    await section.getByRole('combobox', { name: /모을 파일 기준/ }).selectOption('current')
    await section.getByRole('button', { name: '최신 현황으로 묶음 준비', exact: true }).click()
    await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).waitFor()
    await page.evaluate(id => window.qa.externalSubmission(id), unitId)
    await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).click()
    await section.getByRole('alert').waitFor(); assert.match(await section.getByRole('alert').innerText(), /상태가 바뀌었습니다/)
    assert.equal(await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).count(), 0)
    await section.getByRole('button', { name: '최신 현황으로 묶음 준비', exact: true }).click()
    await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).waitFor()
    checkZip(await receiveDownload(section.getByRole('button', { name: 'ZIP 내려받기', exact: true })), payload('외부 정정 제출.pdf'), 'current', 2)
    await section.getByRole('combobox', { name: /모을 파일 기준/ }).selectOption('effective')
    await section.getByRole('button', { name: '최신 현황으로 묶음 준비', exact: true }).click()
    await section.getByRole('button', { name: 'ZIP 내려받기', exact: true }).waitFor()
    checkZip(await receiveDownload(section.getByRole('button', { name: 'ZIP 내려받기', exact: true })), shared, 'effective', 1)
  })
  await test('파일 관련 식별자·이름·접수 본문은 영구 저장에 남지 않는다', async () => {
    const persistent = await page.evaluate(() => localStorage.getItem('qa-workflow'))
    for (const forbidden of [requestId, unitId, template.name, shared.name, extra.name, '저장 실패에도 보존할 전달 사항']) assert.equal(persistent.includes(forbidden), false)
    const snapshot = JSON.parse(persistent)
    for (const key of ['requests', 'units', 'drafts', 'submissions', 'reviews', 'supplements', 'withdrawals', 'receipts']) assert.deepEqual(snapshot[key], [])
  })
  await test('390px에서 긴 파일명·선택·확인 동선이 화면 폭을 벗어나지 않는다', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '+ 파일 수합 만들기', exact: true }).click()
    await form().getByLabel('수합 제목', { exact: true }).fill('모바일 합성 파일 수합')
    const long = payload('합성_학교행사_학년별_참여확인_안내자료_교사용_미리보기.pdf')
    await upload(form(), '양식 파일', long)
    await picked(form(), '양식 파일').scrollIntoViewIfNeeded()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (output) await page.screenshot({ path: join(output, 'file-collections-mobile.png') })
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
  })
  if (output) writeFileSync(join(output, 'file-collections-results.json'), JSON.stringify({ passed: results.length, tests: results, errors, external }, null, 2))
  console.log(`\n파일 수합 브라우저 검증: ${results.length}개 통과`)
} catch (failure) {
  if (output) {
    writeFileSync(join(output, 'file-collections-failure.json'), JSON.stringify({ passed: results.length, tests: results, error: String(failure), errors, external }, null, 2))
    await page.screenshot({ path: join(output, 'file-collections-failure.png'), fullPage: true })
  }
  throw failure
} finally { await context.close(); await browser.close() }
