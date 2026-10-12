// 합성 수합을 실제 화면에서 다룬다. 외부 서비스·실제 개인정보는 사용하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const bundle = buildSync({ stdin: { contents: `
  import React, {useState} from 'react';import{createRoot}from'react-dom/client';
  import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';
  import{EditSession}from'./apps/workhub/src/app/EditSession';
  import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
  import{fixtureData}from'./apps/workhub/src/preview/fixtures';
  import theme from './apps/workhub/src/style.css?inline';import workflow from './apps/workhub/src/workflows/workflows.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate,store=createWorkflowStore({members,date});let seq=0;const key=()=>String(++seq);
  function create(title,labels,publish=true){let r=store.createCollection('gaon-minjun',{title,instructions:'교사별 준비 내용을 모읍니다. 합성 자료만 사용합니다.',dueDate:'2026-10-21',reviewMode:'required',reviewerMemberId:'gaon-minjun',textLabel:'준비 내용',textRequired:true,numberLabel:'수량',numberRequired:true,units:labels.map(label=>({label,responsibleMemberId:'gaon-soyeon',contributorMemberIds:[]}))},key());return publish?store.publishCollection('gaon-minjun',r.id,r.version,key()):r}
  const request=create('학교 행사 준비 수합',['미제출 단위','검토 대기 단위','보완 대상 단위','완료한 단위','새 판 단위']),units=store.listUnits('gaon-minjun',request.id);
  function submit(unit,number){const old=store.getDraft('gaon-soyeon',unit.id),d=store.saveDraft('gaon-soyeon',unit.id,{text:'합성 제출 본문',number},old?.version??0,key());store.submit('gaon-soyeon',unit.id,d.version,store.unitSummary('gaon-soyeon',unit.id).unit.version,key(),old?'합성 정정 사유':'')}
  function review(unit,decision='accepted'){const s=store.unitSummary('gaon-minjun',unit.id);store.review('gaon-minjun',unit.id,s.current.id,decision,decision==='changes_requested'?'합성 보완 요청':'',decision==='changes_requested'?'2026-10-22':'',s.unit.version,key())}
  submit(units[1],5);submit(units[2],15);review(units[2],'changes_requested');submit(units[3],0);review(units[3]);submit(units[4],10);review(units[4]);submit(units[4],100);
  store.saveDraft('gaon-soyeon',units[0].id,{text:'관리자에게 보이면 안 되는 초안',number:20},0,key());
  const large=create('학급별 자료 수합',Array.from({length:23},(_,i)=>'합성 '+(i+1)+'반'));
  create('학기말 비공개 수합 초안',['초안 단위'],false);
  window.qa={request:request.id,units:units.map(u=>u.id),large:large.id};
  function App(){const[id,setId]=useState('gaon-minjun'),[locked,setLocked]=useState(false),[generation,setGeneration]=useState(0);const member=members.find(m=>m.id===id);window.qa.change=id=>{setId(id);setGeneration(n=>n+1)};return <><style>{theme}{workflow}{'body{margin:0;background:#f5f7ef}main{padding:28px;max-width:1440px;margin:auto}'} </style><main><p>가상학교 수합 작업현황 · 합성 자료</p><label>검증 소속<select aria-label="검증 소속" value={id} disabled={locked} onChange={e=>{setId(e.target.value);setGeneration(n=>n+1)}}>{members.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><EditSession onLockChange={setLocked}><WorkflowPanel key={id+generation} store={store} member={member} members={members} date={date} page="collections" initialRequestId={id.startsWith('gaon-')?request.id:undefined}/></EditSession></main></>}
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1250 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const workbench = () => page.getByRole('region', { name: '제출 단위 진행현황', exact: true })
const rows = () => workbench().locator('tbody tr')
const unit = name => page.getByRole('article', { name: name + ' 제출 단위', exact: true })
const filters = () => workbench().getByRole('group', { name: '제출 단위 상태 필터' })
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function openMain() { await page.getByRole('button', { name: '받은 수합', exact: true }).click(); await page.locator('.wf-request-card').filter({ hasText: '학교 행사 준비 수합' }).click(); await workbench().waitFor() }
try {
  await page.goto('http://127.0.0.1:5176/collection-workbench'); await workbench().waitFor()
  await test('다섯 진행상태와 완료본의 숫자 집계가 서로 구분된다', async () => {
    assert.equal(await rows().count(), 5)
    for (const name of ['미제출 1','검토 대기 1','보완 필요 1','완료 1','완료본 · 새 판 처리 중 1']) assert.equal(await filters().getByRole('button', { name, exact: true }).count(), 1)
    assert.match(await page.locator('.wf-request-detail').innerText(), /수량 합계: 10/)
    assert(!await workbench().innerText().then(text => text.includes('합성 제출 본문') || text.includes('관리자에게 보이면 안 되는 초안')))
    if (output) await page.screenshot({ path: join(output, 'collection-desktop.png') })
  })
  await test('본인이 만든 비공개 초안을 제목과 게시 상태로 찾고 원본은 유지한다', async () => {
    await page.getByRole('button', { name: '내가 만든 수합', exact: true }).click()
    await page.getByLabel('수합 제목 찾기', { exact: true }).fill('학기말'.normalize('NFD'))
    await page.getByLabel('수합 게시 상태', { exact: true }).selectOption('draft')
    assert.equal(await page.locator('.wf-request-card').count(), 1)
    await page.locator('.wf-request-card').click(); assert.equal(await page.getByRole('heading', { name: '게시 전 대상 확인' }).count(), 1)
    await page.getByLabel('수합 게시 상태', { exact: true }).selectOption('published')
    assert.equal(await page.locator('.wf-request-card').count(), 0); assert.match(await page.locator('.wf-request-detail').innerText(), /확인 중인 원본은 그대로 유지/)
    await openMain()
  })
  await test('상태와 책임자 필터가 원본·완료본 집계를 변경하지 않는다', async () => {
    await filters().getByRole('button', { name: '검토 대기 1', exact: true }).click()
    await workbench().getByLabel('제출 단위 찾기', { exact: true }).fill('한소연')
    assert.equal(await rows().count(), 1); assert.match(await rows().innerText(), /검토 대기 단위/)
    assert.equal(await page.locator('.wf-unit').count(), 5); assert.match(await page.locator('.wf-request-detail').innerText(), /수량 합계: 10/)
    await workbench().getByLabel('기한 초과만', { exact: true }).check(); assert.equal(await rows().count(), 0)
    await workbench().getByRole('button', { name: '단위 필터 초기화' }).click(); assert.equal(await rows().count(), 5)
  })
  await test('표에서 정확한 제출 단위로 이동하고 같은 단위 재선택에도 초점을 복원한다', async () => {
    const id = (await page.evaluate(() => window.qa.units))[4]
    for (let i = 0; i < 2; i++) {
      await workbench().getByRole('button', { name: '새 판 단위 제출 단위 원본 보기' }).click()
      await page.waitForFunction(id => document.activeElement?.getAttribute('data-wf-unit-id') === id, id)
      assert.match(await unit('새 판 단위').getAttribute('class'), /wf-unit-target/)
    }
  })
  await test('검토 의견을 입력하는 동안 단위 이동과 검색·필터로 입력을 잃지 않는다', async () => {
    const pending = unit('검토 대기 단위'); await pending.getByLabel('검토 의견', { exact: true }).fill('보존할 검토 의견')
    await filters().getByRole('button', { name: '미제출 1', exact: true }).click()
    assert.equal(await filters().getByRole('button', { name: '전체 5', exact: true }).getAttribute('aria-pressed'), 'true')
    await workbench().getByLabel('제출 단위 찾기', { exact: true }).fill('미제출'); assert.equal(await workbench().getByLabel('제출 단위 찾기', { exact: true }).inputValue(), '')
    await page.getByLabel('수합 제목 찾기', { exact: true }).fill('다른 요청'); assert.equal(await page.getByLabel('수합 제목 찾기', { exact: true }).inputValue(), '')
    await workbench().getByRole('button', { name: '미제출 단위 제출 단위 원본 보기' }).click(); assert.equal(await unit('미제출 단위').locator('.wf-target-mark').count(), 0)
    assert.equal(await pending.getByLabel('검토 의견', { exact: true }).inputValue(), '보존할 검토 의견')
    assert.match(await page.locator('.notice-box').innerText(), /저장하거나 편집을 취소/)
    await pending.getByRole('button', { name: '의견·사유 입력 취소', exact: true }).click()
  })
  await test('검토 완료하면 진행표와 완료본 합계가 바로 갱신된다', async () => {
    await unit('검토 대기 단위').getByRole('button', { name: '이 버전 검토 완료', exact: true }).click()
    assert.equal(await filters().getByRole('button', { name: '완료 2', exact: true }).count(), 1)
    assert.match(await page.locator('.wf-request-detail').innerText(), /수량 합계: 15/)
  })
  await test('23개 단위를 페이지별로 찾으며 마지막 단위도 정확히 연다', async () => {
    await page.locator('.wf-request-card').filter({ hasText: '학급별 자료 수합' }).click()
    assert.equal(await rows().count(), 20)
    const pagination = workbench().getByRole('navigation', { name: '제출 단위 표 페이지' })
    await pagination.getByRole('button', { name: '다음', exact: true }).click(); assert.equal(await rows().count(), 3)
    await workbench().getByRole('button', { name: '합성 23반 제출 단위 원본 보기' }).click()
    assert.equal(await unit('합성 23반').evaluate(node => document.activeElement === node), true)
    await filters().getByRole('button', { name: '완료 0', exact: true }).click(); assert.equal(await rows().count(), 0)
    await workbench().getByRole('button', { name: '단위 필터 초기화' }).click(); assert.equal(await rows().count(), 20)
    await openMain()
  })
  await test('390px 화면은 표 안에서만 가로 스크롤하고 원본 이동을 제공한다', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await workbench().scrollIntoViewIfNeeded()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const overflow = await workbench().locator('.wf-workbench-scroll').evaluate(node => node.scrollWidth > node.clientWidth); assert(overflow)
    if (output) await page.screenshot({ path: join(output, 'collection-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1250 })
  })
  await test('제출 책임자의 공동초안 편집도 표 이동과 요청 전환을 보호한다', async () => {
    await page.getByLabel('검증 소속', { exact: true }).selectOption('gaon-soyeon')
    const missing = unit('미제출 단위'); await missing.getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    await missing.getByLabel('준비 내용', { exact: true }).fill('보존할 공동초안')
    await filters().getByRole('button', { name: '보완 필요 1', exact: true }).click(); assert.equal(await filters().getByRole('button', { name: '전체 5', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: '내가 만든 수합', exact: true }).click(); assert.equal(await page.getByRole('button', { name: '받은 수합', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await missing.getByLabel('준비 내용', { exact: true }).inputValue(), '보존할 공동초안')
    await missing.getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click()
  })
  await test('다른 학교로 바꾸면 이전 수합과 검색·단위 현황을 남기지 않는다', async () => {
    await page.getByLabel('수합 제목 찾기', { exact: true }).fill('학교 행사')
    await page.getByLabel('검증 소속', { exact: true }).selectOption('nuri-soyeon')
    assert.equal(await page.getByLabel('수합 제목 찾기', { exact: true }).inputValue(), '')
    assert.equal(await workbench().count(), 0); assert.equal(await page.locator('.wf-unit').count(), 0)
    assert(!await page.locator('.wf-panel').innerText().then(text => text.includes('학교 행사 준비 수합')))
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
    assert.equal(external.length, 0); assert.deepEqual(errors, [])
  })
  if (output) writeFileSync(join(output, 'collection-workbench-results.json'), JSON.stringify({ passed: results.length, tests: results, errors, external }, null, 2))
  console.log(`\n수합 작업현황 브라우저 검증: ${results.length}개 통과`)
} finally { await context.close(); await browser.close() }
