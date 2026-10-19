// 실제 서버 패널의 작성 동선·초점·제출 안내를 합성 응답으로 확인한다.
// 운영 DB·파일 저장소에는 연결하지 않으며 HWPX 본문 검사를 대신하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{CollectionServerPanel}from'./apps/workhub/src/collections/CollectionServerPanel';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
const clone=value=>structuredClone(value),now='2026-10-16T08:00:00Z';
const members=Array.from({length:22},(_,index)=>({id:'member-'+index,userId:'user-'+index,schoolId:'school',name:index===0?'담당교사':index===1?'검토교사':'교사 '+index,role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}));
const policy={extensions:['hwpx'],maxFileBytes:1024,maxFiles:1};
const file={id:'file-1',name:'2026학년도_대동여자중학교_학교업무혁신시스템_학급운영계획_누가기록_학생활동_추가설명_최종작성본.hwpx',extension:'hwpx',bytes:100,sha256:'a'.repeat(64)};
const units=Array.from({length:20},(_,index)=>{const person=members[index===19?0:index+2];return{id:'unit-'+(index+1),requestId:'request-1',schoolId:'school',label:index===19?'내 학급':'학급 '+(index+1),responsibleMemberId:person.id,members:[{id:person.id,userId:person.userId,name:person.name}],version:1,currentSubmissionId:null,effectiveSubmissionId:null,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''}});
const request={id:'request-1',schoolId:'school',managerMemberId:'member-0',title:'학급 운영계획 수합',instructions:'필요한 내용을 입력하고 작성한 HWPX 파일을 제출해 주세요.',dueDate:'2026-10-31',reviewMode:window.scenario==='review'?'required':'none',reviewerMemberId:window.scenario==='review'?'member-1':'',textLabel:'작성 메모',textRequired:window.scenario==='required',numberLabel:'활동 횟수',numberRequired:window.scenario==='required',units:units.map(unit=>({label:unit.label,responsibleMemberId:unit.responsibleMemberId,contributorMemberIds:[]})),fileCollection:{policy,required:true,templates:[file]},status:window.scenario==='draft'?'draft':'published',version:1,publishedAt:window.scenario==='draft'?null:now};
const state={request,units,draft:window.scenario==='empty'?null:{id:'draft-1',unitId:'unit-20',version:1,lastEditorMemberId:'member-0',text:'',number:null,files:[file]},submissions:[],reviews:[],supplements:[],withdrawals:[]};
if(window.scenario==='review'){state.submissions.push({id:'submission-1',unitId:'unit-20',revision:1,submittedBy:'member-0',receiptAt:now,receiptDate:'2026-10-16',dueSnapshot:'2026-10-31',initiallyLate:false,correctionReason:'',previousSubmissionId:null,reviewMode:'required',requestKey:'seed',text:'작성 메모',number:1,files:[file]});units[19].currentSubmissionId='submission-1'}
window.calls=[];window.state=state;window.detailCalls=0;window.waitingDetails=0;window.deferDetail=false;const detailGates=[];window.releaseDetails=()=>{while(detailGates.length)detailGates.shift()()};
const server={async readiness(){return{available:true,reason:'ready',policy:clone(policy)}},async list(){return{items:[clone(request)],nextCursor:null}},async detail(){window.detailCalls++;if(window.deferDetail){window.waitingDetails++;await new Promise(resolve=>detailGates.push(resolve))}return clone({request:state.request,units:state.units,submissions:state.submissions,reviews:state.reviews,supplements:state.supplements,withdrawals:state.withdrawals})},async draft(){return clone(state.draft)},async mutate(member,command,key){window.calls.push(clone({member,command,key}));let id='request-1',version=state.request.version;
if(command.kind==='save_draft'){assertVersion(command.expectedVersion,state.draft?.version??0);state.draft={...clone(command.input),id:'draft-1',unitId:'unit-20',lastEditorMemberId:member,version:(state.draft?.version??0)+1};id='draft-1';version=state.draft.version}
else if(command.kind==='submit'){assertVersion(command.expectedDraftVersion,state.draft.version);assertVersion(command.expectedVersion,state.units[19].version);id='submission-'+(state.submissions.length+1);state.submissions.push({...clone(state.draft),id,unitId:'unit-20',revision:state.submissions.length+1,submittedBy:member,receiptAt:now,receiptDate:'2026-10-16',dueSnapshot:state.request.dueDate,initiallyLate:false,correctionReason:command.reason,previousSubmissionId:null,reviewMode:'none',requestKey:key});state.units[19].currentSubmissionId=id;state.units[19].effectiveSubmissionId=id;state.units[19].version++;version=state.submissions.length}
else throw Error('예상하지 않은 변경: '+command.kind);
return{requestId:'request-1',resourceId:id,resourceVersion:version,recordedAt:now,requestKey:key}},async prepareUpload(){throw Error('예상하지 않은 업로드 예약')},async upload(){throw Error('예상하지 않은 업로드')},async completeUpload(){throw Error('예상하지 않은 파일 확인')},async fileStatus(){throw Error('예상하지 않은 파일 조회')},async download(){return new Blob(['합성 HWPX'])}};
function assertVersion(actual,expected){if(actual!==expected)throw Error('시험 서버 버전 불일치')}
function App(){const[revision,setRevision]=useState(0);window.refresh=()=>setRevision(value=>value+1);return<><button type="button">수합 밖 버튼</button><EditDraftsProvider store={window.memory??=createEditDrafts()}><PendingRequestsProvider store={window.pending??=createPendingRequests()}><CollectionServerPanel server={server} member={members[window.scenario==='review'?1:0]} members={members} date="2026-10-16" revision={revision}/></PendingRequestsProvider></EditDraftsProvider></>}
const root=document.getElementById('root'),mount=window.scenario==='shadow'?root.attachShadow({mode:'open'}).appendChild(document.createElement('div')):root;createRoot(mount).render(<React.StrictMode><App/></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage()
const passed = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function start(scenario = '') {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('http://127.0.0.1:5179/collections'); await page.evaluate(value => { window.scenario = value }, scenario)
  await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('button', { name: /학급 운영계획 수합/ }).waitFor(); await settle()
}
async function test(name, action, scenario = '') { await start(scenario); try { await action() } catch (error) { console.error('실패 화면:', await page.locator('body').innerText()); throw error } passed.push(name); console.log('  ✓ ' + name) }
async function focused(locator) { await locator.waitFor(); await page.waitForFunction(element => element.getRootNode().activeElement === element, await locator.elementHandle()); assert.equal(await locator.evaluate(element => element === element.getRootNode().activeElement), true) }
async function keyboardActivate(locator) { await locator.focus(); await page.keyboard.press('Enter') }
async function openDetail() { await keyboardActivate(page.getByRole('button', { name: /학급 운영계획 수합/ })); await focused(page.getByRole('heading', { name: '학급 운영계획 수합', exact: true })) }
async function openAnswer() { await openDetail(); await page.getByRole('button', { name: '내 제출 파일 작성', exact: true }).click(); await focused(page.getByRole('heading', { name: '내 학급 · 제출 준비', exact: true })) }
const guide = () => page.getByRole('complementary', { name: '제출 준비 안내', exact: true })
try {
  await test('키보드로 새 수합을 열면 제목으로 이동하고 취소하면 원래 버튼으로 돌아온다', async () => {
    const create = page.getByRole('button', { name: '새 수합 만들기', exact: true }); await keyboardActivate(create)
    const heading = page.getByRole('heading', { name: '새 수합 초안', exact: true }); await focused(heading); assert.equal(await heading.getAttribute('tabindex'), '-1')
    await page.keyboard.press('Tab'); await focused(page.getByLabel('수합 제목', { exact: true }))
    await keyboardActivate(page.getByRole('button', { name: '작성 취소', exact: true })); await focused(create)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('상세·초안 수정·목록 복귀를 키보드만으로 오가며 원래 진입점을 유지한다', async () => {
    await openDetail(); const edit = page.getByRole('button', { name: '양식 추가·초안 수정', exact: true }); await keyboardActivate(edit)
    await focused(page.getByRole('heading', { name: '수합 초안 수정', exact: true })); await keyboardActivate(page.getByRole('button', { name: '작성 취소', exact: true })); await focused(edit)
    await keyboardActivate(page.getByRole('button', { name: '목록으로', exact: true })); await focused(page.getByRole('button', { name: /학급 운영계획 수합/ }))
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'draft')
  await test('320px·제출 단위 20개에서도 작성 폼이 보이고 긴 파일명이 가로로 넘치지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await openAnswer(); const heading = page.getByRole('heading', { name: '내 학급 · 제출 준비', exact: true })
    assert.equal(await page.locator('article.cs-unit').count(), 20)
    const rect = await heading.boundingBox(); assert.ok(rect && rect.y >= 0 && rect.y < 250); const pickerRect = await page.getByLabel('제출 파일 선택', { exact: true }).boundingBox(); assert.ok(pickerRect && pickerRect.y + pickerRect.height <= 740)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'collection-usability-320.png') }); await page.screenshot({ path: join(output, 'collection-usability-320-full.png'), fullPage: true }) }
    await page.getByRole('button', { name: '작성 닫기', exact: true }).click(); await focused(page.getByRole('button', { name: '내 제출 파일 작성', exact: true }))
  })
  await test('정정 관리 폼을 닫으면 선택한 제출 단위의 관리 버튼으로 복귀한다', async () => {
    await openDetail(); const unit = page.getByRole('article', { name: '내 학급 제출 현황', exact: true }), button = unit.getByRole('button', { name: '정정 기간 설정', exact: true })
    await keyboardActivate(button); await focused(page.getByRole('heading', { name: '내 학급 · 정정 기간 설정', exact: true }))
    await page.getByRole('button', { name: '관리 작성 취소', exact: true }).click(); await focused(button)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('검토 작성도 열린 제목으로 이동하고 취소하면 같은 검토 버튼에 돌아온다', async () => {
    await openDetail(); const button = page.getByRole('button', { name: '제출물 검토', exact: true }); await keyboardActivate(button)
    const heading = page.getByText('검토 대상: 제출 v1', { exact: true }); await focused(heading)
    await page.getByRole('button', { name: '검토 작성 취소', exact: true }).click(); await focused(button)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'review')
  await test('배경 재조회는 작성 중인 메모·커서 위치를 보존하고 제목으로 초점을 뺏지 않는다', async () => {
    await openAnswer(); const memo = page.getByLabel('작성 메모', { exact: true }); await memo.fill('아직 저장하지 않은 교사의 메모'); await memo.evaluate(element => { element.focus(); element.setSelectionRange(3, 8) })
    const previous = await page.evaluate(() => window.detailCalls); await page.evaluate(() => window.refresh()); await page.waitForFunction(count => window.detailCalls > count, previous); await settle()
    await focused(memo); assert.equal(await memo.inputValue(), '아직 저장하지 않은 교사의 메모')
    assert.deepEqual(await memo.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 8]); assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('재조회를 기다리는 동안 사용자가 다른 곳으로 옮긴 초점은 다시 빼앗지 않는다', async () => {
    await openAnswer(); const memo = page.getByLabel('작성 메모', { exact: true }); await memo.fill('조회 도중에도 남는 메모'); await memo.focus()
    await page.evaluate(() => { window.deferDetail = true; window.refresh() }); await page.waitForFunction(() => window.waitingDetails > 0)
    const other = page.getByRole('button', { name: '수합 밖 버튼', exact: true }); await other.focus()
    await page.evaluate(() => { window.deferDetail = false; window.releaseDetails() }); await memo.waitFor(); await settle()
    await focused(other); assert.equal(await memo.inputValue(), '조회 도중에도 남는 메모'); assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('업무실 격리 영역에서도 재조회 후 메모 초점과 선택 범위를 보존한다', async () => {
    await openAnswer(); const memo = page.getByLabel('작성 메모', { exact: true }); await memo.fill('격리된 화면에서 작성 중인 메모'); await memo.evaluate(element => { element.focus(); element.setSelectionRange(2, 6) })
    await page.evaluate(() => { window.deferDetail = true; window.refresh() }); await page.waitForFunction(() => window.waitingDetails > 0)
    await page.evaluate(() => { window.deferDetail = false; window.releaseDetails() }); await memo.waitFor(); await settle()
    await focused(memo); assert.deepEqual(await memo.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 6]); assert.equal(await memo.inputValue(), '격리된 화면에서 작성 중인 메모')
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'shadow')
  await test('파일 선택기에 HWPX·크기·개수·한도 도달 사유를 연결하고 제거 후 다시 선택할 수 있다', async () => {
    await openAnswer(); const picker = page.getByLabel('제출 파일 선택', { exact: true }), ids = (await picker.getAttribute('aria-describedby'))?.split(/\s+/).filter(Boolean)
    assert.ok(ids?.length); const description = await page.evaluate(ids => ids.map(id => document.getElementById(id)?.textContent ?? '').join(' '), ids)
    assert.match(description, /HWPX/); assert.match(description, /1\s*(KB|KiB)|1,?024\s*(바이트|B)/); assert.match(description, /1개/); assert.match(description, /제거/)
    assert.equal(await picker.isDisabled(), true)
    await page.getByRole('button', { name: /최종작성본\.hwpx 제거$/ }).click(); assert.equal(await picker.isEnabled(), true)
    assert.match(await page.getByRole('form', { name: '제출 파일 작성', exact: true }).innerText(), /첨부.*없|선택.*없|파일.*추가|파일.*선택/)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('필수 메모·수치가 빠진 저장 초안은 최종 제출을 막고 저장과 최종 제출을 구분한다', async () => {
    await openAnswer(); const submit = page.getByRole('button', { name: '저장한 파일 최종 제출', exact: true })
    assert.equal(await submit.isDisabled(), true); assert.match(await guide().innerText(), /작성 메모/); await guide().getByText('제출 전 확인할 사항 1개 더 보기', { exact: true }).click(); assert.match(await guide().innerText(), /활동 횟수/)
    await page.getByLabel('작성 메모', { exact: true }).fill('교사가 확인한 작성 메모'); await page.getByLabel('활동 횟수', { exact: true }).fill('0')
    assert.equal(await submit.isDisabled(), true); assert.match(await guide().innerText(), /저장/)
    await page.getByRole('button', { name: '제출 초안 저장', exact: true }).click(); await page.waitForFunction(() => window.calls.length === 1 && window.state.draft.version === 2)
    await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find(element => element.textContent === '저장한 파일 최종 제출'); return button && !button.disabled })
    assert.equal(await page.evaluate(() => window.state.submissions.length), 0); assert.match(await guide().innerText(), /최종 제출/)
    await submit.click(); await page.waitForFunction(() => window.state.submissions.length === 1); await page.getByText(/제출 v1 · 서버 접수/).waitFor()
    const calls = await page.evaluate(() => window.calls); assert.deepEqual(calls.map(value => value.command.kind), ['save_draft', 'submit'])
    assert.equal(calls[0].command.input.text, '교사가 확인한 작성 메모'); assert.equal(calls[0].command.input.number, 0)
    assert.equal(calls[1].command.draftId, 'draft-1'); assert.equal(calls[1].command.expectedDraftVersion, 2); assert.equal(calls[1].command.expectedVersion, 1)
    assert.notEqual(calls[0].key, calls[1].key); assert.equal(await page.getByRole('form', { name: '제출 파일 작성', exact: true }).count(), 0)
  }, 'required')
  await test('파일과 저장 초안이 없는 첫 작성은 다음 행동을 안내하고 최종 제출을 만들지 않는다', async () => {
    await openAnswer(); assert.match(await guide().innerText(), /파일/); assert.match(await guide().innerText(), /초안.*저장|저장.*초안/)
    assert.equal(await page.getByRole('button', { name: '저장한 파일 최종 제출', exact: true }).count(), 0); assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'empty')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) { mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'results.json'), JSON.stringify({ passed, pageErrors: errors, externalRequests: external }, null, 2)) }
  console.log('문서 수합 사용성 브라우저 검사: ' + passed.length + '개 통과')
} finally { await browser.close() }
