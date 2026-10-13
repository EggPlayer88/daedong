// 실제 수합 컴포넌트에 검증된 합성 snapshot을 넣어 대량 목록과 입력 보호를 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const bundle = buildSync({ stdin: { contents: `
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';import{createWorkflowStore}from'./apps/workhub/src/workflows/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';import theme from './apps/workhub/src/style.css?inline';import workflow from './apps/workhub/src/workflows/workflows.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate,manager='gaon-minjun',author='gaon-soyeon';let serial=0;const key=()=>String(++serial),seed=createWorkflowStore({members,date});
  let request=seed.createCollection(manager,{title:'대량 단위 수합',instructions:'합성 자료',dueDate:'2026-10-21',reviewMode:'none',reviewerMemberId:'',textLabel:'확인 내용',textRequired:true,numberLabel:'수량',numberRequired:true,units:Array.from({length:100},(_,i)=>({label:'합성 '+(i+1)+'반',responsibleMemberId:author,contributorMemberIds:[]}))},key());request=seed.publishCollection(manager,request.id,request.version,key());
  const units=seed.listUnits(manager,request.id),first=units[0];for(let revision=1;revision<=3;revision++){const prior=seed.getDraft(author,first.id),draft=seed.saveDraft(author,first.id,{text:'합성 제출 '+revision,number:revision},prior?.version??0,key());seed.submit(author,first.id,draft.version,seed.unitSummary(author,first.id).unit.version,key(),revision>1?'합성 정정 사유 '+revision:'')}
  const snapshot=seed.exportState(),template=snapshot.submissions;snapshot.drafts=[];snapshot.receipts=[];snapshot.submissions=snapshot.units.flatMap((unit,i)=>template.map((s,j)=>({...s,id:'판-'+i+'-'+j,unitId:unit.id,previousSubmissionId:j?'판-'+i+'-'+(j-1):null,requestKey:'접수-'+i+'-'+j})));snapshot.units=snapshot.units.map((unit,i)=>({...unit,version:4,currentSubmissionId:'판-'+i+'-2',effectiveSubmissionId:'판-'+i+'-2'}));
  snapshot.requests.push(...Array.from({length:999},(_,i)=>({...request,id:'요청-'+i,title:'합성 요청 '+String(i).padStart(4,'0'),status:'draft',publishedAt:null,units:request.units.slice(0,1)})));
  const store=createWorkflowStore({members,date,snapshot});let requestLimit=Infinity,unitLimit=Infinity;const listRequests=store.listCollections,listUnits=store.listUnits;store.listCollections=id=>listRequests(id).slice(0,requestLimit);store.listUnits=(id,requestId)=>listUnits(id,requestId).slice(0,unitLimit);
  window.qa={request:request.id,units:units.map(u=>u.id),limitRequests(n){requestLimit=n;store.setContext({members,date})},limitUnits(n){unitLimit=n;store.setContext({members,date})},state(){return store.exportState()}};
  function App(){const[id,setId]=useState(manager),[locked,setLocked]=useState(false),[generation,setGeneration]=useState(0),[target,setTarget]=useState(),[unitTarget,setUnitTarget]=useState();window.qa.open=(r=request.id,u)=>{setTarget(r);setUnitTarget(u);setGeneration(n=>n+1)};return <><style>{theme}{workflow}{'body{margin:0;background:#f5f7ef}main{padding:20px;max-width:1280px;margin:auto}'} </style><main><label>검증 소속<select aria-label="검증 소속" value={id} disabled={locked} onChange={e=>{setId(e.target.value);setGeneration(n=>n+1)}}>{members.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><EditSession onLockChange={setLocked}><WorkflowPanel key={id+generation} store={store} member={members.find(m=>m.id===id)} members={members} date={date} page="collections" initialRequestId={target} initialUnitId={unitTarget}/></EditSession></main></>};createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await chromium.launch({ channel: 'chrome', headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage()
const errors = [], external = [], results = [], metrics = {}, output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000)
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const requests = () => page.getByRole('navigation', { name: '수합 요청 목록 페이지', exact: true })
const details = () => page.getByRole('navigation', { name: '제출 단위 원본 페이지', exact: true })
const unit = number => page.getByRole('article', { name: `합성 ${number}반 제출 단위`, exact: true })
const workbench = () => page.getByRole('region', { name: '제출 단위 진행현황', exact: true })
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function focused(locator) { await page.waitForFunction(node => node === document.activeElement, await locator.elementHandle()) }
async function open(unitIndex) { await page.evaluate(index => window.qa.open(window.qa.request, index === undefined ? undefined : window.qa.units[index]), unitIndex); await workbench().waitFor() }
try {
  await page.goto('http://127.0.0.1:5176/collection-paging')
  await test('1000개 수합 요청은 20개 카드와 전체 건수만 먼저 표시한다', async () => {
    await page.getByRole('button', { name: '내가 만든 수합', exact: true }).click(); await requests().waitFor()
    assert.equal(await page.locator('.wf-request-card').count(), 20)
    assert.match(await requests().innerText(), /1,000개 중 1–20개 표시/)
    metrics.requestCards = await page.locator('.wf-request-card').count(); metrics.requestDom = await page.locator('#root *').count()
  })
  await test('마지막 요청 페이지와 검색 초기화는 목록 초점과 전체 필터 결과를 유지한다', async () => {
    await requests().getByRole('button', { name: '마지막', exact: true }).click(); await focused(page.getByRole('region', { name: '수합 요청 목록', exact: true }))
    assert.match(await requests().innerText(), /981–1,000/)
    await page.getByLabel('수합 제목 찾기', { exact: true }).fill('합성 요청 0998'); assert.equal(await page.locator('.wf-request-card').count(), 1)
    await page.getByRole('button', { name: '수합 필터 초기화', exact: true }).click(); assert.match(await requests().innerText(), /1–20/)
    await focused(page.getByLabel('수합 제목 찾기', { exact: true }))
  })
  await test('요청 수가 줄어 마지막 쪽이 보정된 뒤 다시 늘어도 첫 쪽을 유지한다', async () => {
    await requests().getByRole('button', { name: '마지막', exact: true }).click()
    await page.evaluate(() => window.qa.limitRequests(3)); await page.waitForFunction(() => document.querySelectorAll('.wf-request-card').length === 3)
    await page.evaluate(() => window.qa.limitRequests(1000)); await requests().waitFor(); assert.match(await requests().innerText(), /1–20/)
  })
  await test('마지막 초기 요청은 정확한 50쪽에서 선택되며 저장 후에도 선택을 유지한다', async () => {
    await page.evaluate(() => window.qa.open('요청-998')); await page.getByRole('button', { name: '초안 수정', exact: true }).waitFor(); assert.match(await requests().innerText(), /50 \/ 50쪽/)
    assert.match(await page.locator('.wf-request-card[aria-pressed=true]').innerText(), /합성 요청 0998/)
    await page.getByRole('button', { name: '초안 수정', exact: true }).click(); await page.getByLabel('수합 제목', { exact: true }).fill('저장한 마지막 수합')
    await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await focused(page.locator('.wf-detail-heading h3'))
    assert.match(await requests().innerText(), /50 \/ 50쪽/); assert.match(await page.locator('.wf-request-card[aria-pressed=true]').innerText(), /저장한 마지막 수합/)
  })
  await test('100개 제출 단위는 20개 원본만 표시하고 전체 완료본 합계 300을 유지한다', async () => {
    await open(); assert.equal(await page.locator('[data-wf-unit-id]').count(), 20)
    assert.match(await page.locator('.wf-request-detail').innerText(), /수량 합계: 300/)
    assert.equal(await page.locator('.wf-history>div').count(), 0)
    metrics.unitCards = await page.locator('[data-wf-unit-id]').count(); metrics.unitDom = await page.locator('#root *').count(); metrics.closedHistory = await page.locator('.wf-history>div').count()
  })
  await test('닫힌 제출 이력은 DOM에 없고 키보드로 펼친 해당 이력만 보여 준다', async () => {
    const summary = unit(1).locator('.wf-history summary'); await summary.focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('.wf-history>div').length === 3)
    assert.match(await unit(1).locator('.wf-history').innerText(), /합성 제출 1/)
    await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelectorAll('.wf-history>div').length === 0)
  })
  await test('표 검색은 합계나 상세 쪽을 바꾸지 않으며 100번째 원본을 정확히 연다', async () => {
    await workbench().getByLabel('제출 단위 찾기', { exact: true }).fill('100반')
    assert.equal(await page.locator('[data-wf-unit-id]').count(), 20); assert.match(await details().innerText(), /1 \/ 5쪽/)
    assert.match(await page.locator('.wf-request-detail').innerText(), /수량 합계: 300/)
    await workbench().getByRole('button', { name: '합성 100반 제출 단위 원본 보기', exact: true }).click(); await focused(unit(100)); assert.match(await details().innerText(), /5 \/ 5쪽/)
    await workbench().getByRole('button', { name: '합성 100반 제출 단위 원본 보기', exact: true }).click(); await focused(unit(100))
  })
  await test('상세 마지막 쪽 이동은 목록 초점을 유지하고 감소 후 증가에도 보정된 쪽을 유지한다', async () => {
    await details().getByRole('button', { name: '이전', exact: true }).click(); await focused(page.locator('.wf-unit-list'))
    await page.evaluate(() => window.qa.limitUnits(3)); await page.waitForFunction(() => document.querySelectorAll('[data-wf-unit-id]').length === 3)
    await page.evaluate(() => window.qa.limitUnits(100)); await details().waitFor(); assert.match(await details().innerText(), /1 \/ 5쪽/)
  })
  await test('기존 진행표도 자료 감소 후 다시 늘어날 때 보정된 첫 쪽을 유지한다', async () => {
    await workbench().getByRole('button', { name: '단위 필터 초기화', exact: true }).click()
    const tablePages = workbench().getByRole('navigation', { name: '제출 단위 표 페이지', exact: true })
    for (let i = 0; i < 4; i++) await tablePages.getByRole('button', { name: '다음', exact: true }).click()
    assert.match(await tablePages.innerText(), /5 \/ 5쪽/)
    await page.evaluate(() => window.qa.limitUnits(3)); await page.waitForFunction(() => document.querySelectorAll('[data-wf-progress-unit]').length === 3)
    await page.evaluate(() => window.qa.limitUnits(100)); await tablePages.waitFor(); assert.match(await tablePages.innerText(), /1 \/ 5쪽/)
  })
  await test('직접 연 마지막 단위와 없는 단위는 각각 정확한 원본·명시적 안내를 표시한다', async () => {
    await open(99); await focused(unit(100)); assert.match(await details().innerText(), /5 \/ 5쪽/)
    await page.evaluate(() => window.qa.open(window.qa.request, '없는-단위')); await page.locator('.wf-unit-unavailable').waitFor()
    assert.equal(await page.locator('.wf-unit-target').count(), 0); await focused(page.locator('.wf-unit-unavailable'))
  })
  await test('사유 입력 중 요청·상세 페이지 전환을 막고 취소 후 다시 이동할 수 있다', async () => {
    await open()
    const correction = unit(1).locator('.wf-secondary-action'); await correction.locator('summary').click()
    await correction.getByLabel('허용 사유', { exact: true }).fill('보존할 정정 허용 사유')
    await requests().getByRole('button', { name: '마지막', exact: true }).click(); assert.match(await requests().innerText(), /1 \/ 50쪽/)
    await details().getByRole('button', { name: '마지막', exact: true }).click(); assert.match(await details().innerText(), /1 \/ 5쪽/)
    assert.equal(await correction.getByLabel('허용 사유', { exact: true }).inputValue(), '보존할 정정 허용 사유')
    await unit(1).getByRole('button', { name: '의견·사유 입력 취소', exact: true }).click()
    await requests().getByRole('button', { name: '마지막', exact: true }).click(); assert.match(await requests().innerText(), /50 \/ 50쪽/)
  })
  await test('응답 입력 중 상세 페이지·표 원본 전환을 막고 입력을 유지한다', async () => {
    await page.getByLabel('검증 소속', { exact: true }).selectOption('gaon-soyeon'); await open()
    await unit(1).getByRole('button', { name: '정정·보완 초안 작성', exact: true }).click()
    const form = unit(1).getByRole('form', { name: '합성 1반 응답 초안', exact: true }); await form.getByLabel('확인 내용', { exact: true }).fill('페이지 전환에서 보호할 입력')
    await details().getByRole('button', { name: '마지막', exact: true }).click(); assert.match(await details().innerText(), /1 \/ 5쪽/)
    await workbench().getByRole('button', { name: '합성 2반 제출 단위 원본 보기', exact: true }).click(); assert.equal(await page.locator('.wf-unit-target').count(), 0)
    assert.equal(await form.getByLabel('확인 내용', { exact: true }).inputValue(), '페이지 전환에서 보호할 입력'); assert.match(await page.locator('.notice-box').innerText(), /저장하거나 편집을 취소/)
    await unit(1).getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click(); await details().getByRole('button', { name: '마지막', exact: true }).click(); assert.match(await details().innerText(), /5 \/ 5쪽/)
  })
  await test('학교 전환으로 기존 단위와 본문이 제거되며 320·390px 화면에 넘침이 없다', async () => {
    for (const width of [320, 390]) { await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) }
    if (output) await page.screenshot({ path: join(output, 'collection-paging-mobile.png') })
    await page.getByLabel('검증 소속', { exact: true }).selectOption('nuri-soyeon'); assert.equal(await page.locator('[data-wf-unit-id]').count(), 0); assert(!await page.locator('main').innerText().then(text => text.includes('합성 제출 3')))
  })
  assert.deepEqual(errors, []); assert.equal(external.length, 0)
  if (output) writeFileSync(join(output, 'collection-paging-results.json'), JSON.stringify({ passed: results.length, tests: results, metrics, errors, external }, null, 2))
  console.log(`\n수합 페이지 브라우저 검증: ${results.length}개 통과`)
} finally { await context.close(); await browser.close() }
