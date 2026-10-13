// 수합 화면의 실제 키보드 경로·레이블 연결·좁은 화면을 합성 자료로 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const bundle = buildSync({ stdin: { contents: `
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';import{createWorkflowStore}from'./apps/workhub/src/workflows/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';import theme from './apps/workhub/src/style.css?inline';import workflow from './apps/workhub/src/workflows/workflows.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate;let fail=false,seq=0;const key=()=>String(++seq);const store=createWorkflowStore({members,date,onChange(){if(fail){fail=false;throw Error('합성 저장 오류')}}});
  let request=store.createCollection('gaon-minjun',{title:'키보드 수합',instructions:'키보드 검증을 위한 합성 수합입니다.',dueDate:'2026-10-21',reviewMode:'required',reviewerMemberId:'gaon-minjun',textLabel:'확인 내용',textRequired:true,numberLabel:'수량',numberRequired:true,units:Array.from({length:23},(_,i)=>({label:'합성 '+(i+1)+'반',responsibleMemberId:'gaon-soyeon',contributorMemberIds:['gaon-seojin']}))},key());request=store.publishCollection('gaon-minjun',request.id,request.version,key());const units=store.listUnits('gaon-minjun',request.id);for(const u of units.slice(0,2)){const d=store.saveDraft('gaon-soyeon',u.id,{text:'합성 제출 내용',number:0},0,key());store.submit('gaon-soyeon',u.id,d.version,u.version,key())}
  window.qa={request:request.id,fail(){fail=true},externalLatest(){const r=store.listCollections('gaon-minjun').find(r=>r.status==='draft');store.updateCollection('gaon-minjun',r.id,{...r,title:'다른 창에서 변경한 수합'},r.version,key())}};
  function App(){const[id,setId]=useState('gaon-minjun'),[locked,setLocked]=useState(false),[target,setTarget]=useState(request.id),[generation,setGeneration]=useState(0);window.qa.open=()=>{setTarget(request.id);setGeneration(n=>n+1);return generation+1};return <><style>{theme}{workflow}{'body{margin:0;background:#f5f7ef}main{padding:20px;max-width:1280px;margin:auto}'} </style><main data-generation={generation}><label>검증 소속<select aria-label="검증 소속" value={id} disabled={locked} onChange={e=>{setId(e.target.value);setGeneration(n=>n+1)}}>{members.filter(m=>m.active).map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><EditSession onLockChange={setLocked}><WorkflowPanel key={id+generation} store={store} member={members.find(m=>m.id===id)} members={members} date={date} page="collections" initialRequestId={target}/></EditSession></main></>}
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000)
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const form = () => page.getByRole('form', { name: '수합 만들기 양식', exact: true })
const unit = index => page.getByRole('article', { name: `합성 ${index}반 제출 단위`, exact: true })
const response = index => unit(index).getByRole('form', { name: `합성 ${index}반 응답 초안`, exact: true })
const workbench = () => page.getByRole('region', { name: '제출 단위 진행현황', exact: true })
async function keyboard(locator, key = 'Enter') { await locator.focus(); await page.keyboard.press(key) }
async function focused(locator) { await page.waitForFunction(element => element === document.activeElement, await locator.elementHandle()) }
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function original() { const generation = await page.evaluate(() => window.qa.open()); await page.waitForFunction(value => document.querySelector('main').dataset.generation === String(value), generation); await workbench().waitFor() }
try {
  await page.goto('http://127.0.0.1:5176/collection-accessibility'); await workbench().waitFor()
  await test('키보드로 양식을 열면 제목으로, 취소하면 원래 버튼으로 초점이 돌아온다', async () => {
    const create = page.getByRole('button', { name: '+ 수합 만들기', exact: true })
    await keyboard(create); await focused(form().getByLabel('수합 제목', { exact: true }))
    await keyboard(form().getByRole('button', { name: '취소', exact: true })); await focused(create)
    await keyboard(create)
  })
  await test('반복 단위 필드는 고유 id·label·fieldset 문맥을 갖추고 추가·제거 후 초점이 이어진다', async () => {
    await form().getByLabel('수합 제목', { exact: true }).fill('키보드로 만든 수합')
    await keyboard(form().getByRole('button', { name: '+ 제출 단위 추가', exact: true }))
    await focused(form().getByLabel('단위 2 이름', { exact: true }))
    const second = form().getByRole('group', { name: '제출 단위 2', exact: true })
    const box = second.getByLabel('한소연', { exact: true }); await keyboard(box, 'Space'); assert(await box.isChecked())
    const relationships = await form().evaluate(node => {
      const fields = [...node.querySelectorAll('.wf-unit-input input,.wf-unit-input select')]
      return { ids: fields.map(field => field.id), connected: fields.every(field => field.labels?.length > 0), descriptions: [...node.querySelectorAll('.wf-unit-input input[type=checkbox]')].every(field => document.getElementById(field.getAttribute('aria-describedby'))?.tagName === 'LEGEND') }
    })
    assert.equal(new Set(relationships.ids).size, relationships.ids.length); assert(relationships.ids.every(Boolean)); assert(relationships.connected); assert(relationships.descriptions)
    await keyboard(second.getByRole('button', { name: '이 제출 단위 제거', exact: true })); await focused(form().getByLabel('단위 1 이름', { exact: true }))
  })
  await test('저장 오류를 초점과 폼 설명으로 연결하고 같은 오류 재시도도 초점을 복원한다', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.evaluate(() => window.qa.fail()); await keyboard(form().getByRole('button', { name: '수합 초안 저장', exact: true }))
      const error = form().getByRole('alert'); await focused(error)
      assert.equal(await form().getAttribute('aria-describedby'), await error.getAttribute('id'))
      await page.keyboard.press('Tab'); await focused(form().getByLabel('수합 제목', { exact: true }))
      assert.equal(await form().getByLabel('수합 제목', { exact: true }).inputValue(), '키보드로 만든 수합')
    }
  })
  await test('저장·수정 취소·게시 후 사라진 버튼 대신 원본 제목 또는 수정 버튼으로 이동한다', async () => {
    await keyboard(form().getByRole('button', { name: '수합 초안 저장', exact: true }))
    const heading = page.locator('.wf-detail-heading h3'); await focused(heading)
    await keyboard(page.getByRole('button', { name: '초안 수정', exact: true })); await focused(form().getByLabel('수합 제목', { exact: true }))
    await page.evaluate(() => window.qa.externalLatest()); await keyboard(form().getByRole('button', { name: '수합 초안 저장', exact: true }))
    await keyboard(form().getByRole('button', { name: '최신 원본 비교 · 내 입력 유지', exact: true })); await focused(form().getByRole('heading', { name: '최신 원본 v2', exact: true }))
    assert.match(await form().getByRole('region', { name: '최신 수합 원본 비교' }).innerText(), /다른 창에서 변경한 수합/)
    await keyboard(form().getByRole('button', { name: '취소', exact: true })); await focused(page.getByRole('button', { name: '초안 수정', exact: true }))
    await keyboard(page.getByRole('button', { name: '대상 확인 · 게시', exact: true })); await focused(heading)
    await original()
  })
  await test('검색 초기화와 마지막 표 페이지 이동에서 초점이 사라지지 않는다', async () => {
    await page.getByLabel('수합 제목 찾기', { exact: true }).fill('키보드')
    await keyboard(page.getByRole('button', { name: '수합 필터 초기화', exact: true })); await focused(page.getByLabel('수합 제목 찾기', { exact: true }))
    await workbench().getByLabel('제출 단위 찾기', { exact: true }).fill('3반')
    await keyboard(workbench().getByRole('button', { name: '단위 필터 초기화', exact: true })); await focused(workbench().getByLabel('제출 단위 찾기', { exact: true }))
    await keyboard(workbench().getByRole('navigation').getByRole('button', { name: '다음', exact: true })); await focused(workbench().getByRole('region', { name: '제출 단위 진행표', exact: true }))
    assert.equal(await workbench().locator('tbody tr').count(), 3); await page.keyboard.press('Tab')
    await focused(workbench().getByRole('button', { name: '합성 21반 제출 단위 원본 보기', exact: true }))
    await page.keyboard.press('Enter'); await focused(unit(21))
  })
  await test('여러 응답 양식의 id와 안내 연결은 겹치지 않고 편집 종료 시 각 버튼으로 돌아온다', async () => {
    await page.getByLabel('검증 소속', { exact: true }).selectOption('gaon-soyeon'); await original()
    await keyboard(unit(3).getByRole('button', { name: '응답 초안 작성', exact: true })); await focused(response(3).getByLabel('확인 내용', { exact: true }))
    await keyboard(unit(4).getByRole('button', { name: '응답 초안 작성', exact: true })); await focused(response(4).getByLabel('확인 내용', { exact: true }))
    const fields = await page.locator('.wf-response-form input,.wf-response-form textarea').evaluateAll(nodes => nodes.map(node => ({ id: node.id, labelled: node.labels.length > 0, descriptions: node.getAttribute('aria-describedby').split(' ').every(id => document.getElementById(id)) })))
    assert.equal(new Set(fields.map(field => field.id)).size, fields.length); assert(fields.every(field => field.id && field.labelled && field.descriptions))
    await keyboard(unit(4).getByRole('button', { name: '편집 취소 · 닫기', exact: true })); await focused(unit(4).getByRole('button', { name: '응답 초안 작성', exact: true }))
    assert.equal(await response(3).count(), 1)
  })
  await test('응답 저장 실패 안내와 최종 제출 후 초점은 해당 단위 안에서 유지된다', async () => {
    await response(3).getByLabel('확인 내용', { exact: true }).fill('합성 키보드 응답'); await response(3).getByLabel('수량', { exact: true }).fill('0')
    await page.evaluate(() => window.qa.fail()); await keyboard(response(3).getByRole('button', { name: '초안 저장', exact: true })); await focused(response(3).getByRole('alert'))
    assert.equal(await response(3).getAttribute('aria-describedby'), await response(3).getByRole('alert').getAttribute('id'))
    await keyboard(response(3).getByRole('button', { name: '초안 저장', exact: true })); await keyboard(response(3).getByRole('button', { name: '최종 제출', exact: true }))
    await focused(unit(3).getByRole('button', { name: '정정·보완 초안 작성', exact: true }))
  })
  await test('반복 검토 양식에 단위 설명이 연결되고 검토 완료 후 원본 단위에 초점을 둔다', async () => {
    await page.getByLabel('검증 소속', { exact: true }).selectOption('gaon-minjun'); await original()
    const forms = page.locator('.wf-review-form'); assert.equal(await forms.count(), 3)
    const fields = await forms.locator('textarea,input').evaluateAll(nodes => nodes.map(node => ({ id: node.id, labelled: node.labels.length > 0, context: document.getElementById(node.getAttribute('aria-describedby'))?.textContent })))
    assert.equal(new Set(fields.map(field => field.id)).size, fields.length); assert(fields.every(field => field.labelled && field.context.startsWith('합성 ')))
    await unit(1).getByLabel('검토 의견', { exact: true }).fill('취소할 검토 의견')
    await keyboard(unit(1).getByRole('button', { name: '의견·사유 입력 취소', exact: true })); await focused(unit(1)); assert.equal(await unit(1).getByLabel('검토 의견', { exact: true }).inputValue(), '')
    await keyboard(unit(1).getByRole('button', { name: '이 버전 검토 완료', exact: true })); await focused(unit(1))
    assert.match(await unit(1).innerText(), /검토 완료/)
    if (output) await page.screenshot({ path: join(output, 'collection-accessibility-desktop.png') })
  })
  await test('320·390px 및 200% 확대에서도 수합 양식이 문서 가로 넘침 없이 입력된다', async () => {
    await keyboard(page.getByRole('button', { name: '+ 수합 만들기', exact: true }))
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await form().getByRole('group', { name: '제출 단위 1', exact: true }).scrollIntoViewIfNeeded()
      const sizes = await form().locator('.wf-unit-input .wf-checkbox').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height)); assert(sizes.every(height => height >= 40))
      if (output && width === 390) await page.screenshot({ path: join(output, 'collection-accessibility-mobile.png') })
    }
    await page.setViewportSize({ width: 1280, height: 1000 }); await page.evaluate(() => document.documentElement.style.zoom = '2')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await form().getByLabel('수합 제목', { exact: true }).fill('확대 화면에서도 입력'); assert.equal(await form().getByLabel('수합 제목', { exact: true }).inputValue(), '확대 화면에서도 입력')
  })
  assert.deepEqual(errors, []); assert.equal(external.length, 0)
  if (output) writeFileSync(join(output, 'collection-accessibility-results.json'), JSON.stringify({ passed: results.length, tests: results, errors, external }, null, 2))
  console.log(`\n수합 접근성 브라우저 검증: ${results.length}개 통과`)
} finally { await context.close(); await browser.close() }
