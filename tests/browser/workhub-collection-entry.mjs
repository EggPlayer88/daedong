// 합성 자료로 요청 작성부터 게시, 공동 초안, 최종 제출과 충돌 복구까지 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const bundle = buildSync({ stdin: { contents: `
  import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';
  import{createWorkflowStore}from'./apps/workhub/src/workflows/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';
  import theme from './apps/workhub/src/style.css?inline';import workflow from './apps/workhub/src/workflows/workflows.css?inline';
  const members=fixtureData.memberships;let serial=0,openSerial=0,failWrite=false;const key=()=>String(++serial);
  const store=createWorkflowStore({members,date:fixtureData.basisDate,onChange(){if(failWrite){failWrite=false;throw Error('합성 저장 실패')}}});
  window.qa={snapshot:()=>store.exportState(),fail(){failWrite=true},externalRequest(id){const r=store.getCollection('gaon-minjun',id);store.updateCollection('gaon-minjun',id,{...r,title:'다른 창에서 바뀐 제목',textLabel:'바뀐 글 문항'},r.version,key())},externalAnswer(id){const d=store.getDraft('gaon-seojin',id);store.saveDraft('gaon-seojin',id,{text:'다른 작성자가 저장한 내용',number:9},d?.version??0,key())}};
  function App(){const[id,setId]=useState('gaon-minjun'),[locked,setLocked]=useState(false),[generation,setGeneration]=useState(0),[openToken,setOpenToken]=useState(0),[target,setTarget]=useState(),[date,setDate]=useState(fixtureData.basisDate);window.qa.open=id=>{const token=++openSerial;setTarget(id);setGeneration(n=>n+1);setOpenToken(token);return token};window.qa.date=d=>{store.setContext({members,date:d});setDate(d)};const member=members.find(m=>m.id===id);return <><style>{theme}{workflow}{'body{margin:0;background:#f5f7ef}main{padding:24px;max-width:1250px;margin:auto}'} </style><main data-qa-actor={id} data-qa-request={target??''} data-qa-open-token={openToken}><p>가상학교 수합 입력 검증 · 합성 자료</p><label>검증 소속<select aria-label="검증 소속" value={id} disabled={locked} onChange={e=>{setId(e.target.value);setGeneration(n=>n+1)}}>{members.filter(m=>m.active).map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><EditSession onLockChange={setLocked}><WorkflowPanel key={id+generation} store={store} member={member} members={members} date={date} page="collections" initialRequestId={target}/></EditSession></main></>}
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const form = () => page.getByRole('form', { name: '수합 만들기 양식', exact: true })
const unit = () => page.getByRole('article', { name: '2학년 1반 제출 단위', exact: true })
const response = () => unit().getByRole('form', { name: '2학년 1반 응답 초안', exact: true })
const state = () => page.evaluate(() => window.qa.snapshot())
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function actor(id, requestId) {
  await page.getByLabel('검증 소속', { exact: true }).selectOption(id)
  await page.waitForFunction(id => document.querySelector('main')?.dataset.qaActor === id, id)
  if (requestId) {
    // evaluate 반환은 React 반영 완료가 아니다. 같은 요청을 다시 열 때도 새 원본 화면의 commit을 기다린다.
    const openToken = await page.evaluate(requestId => window.qa.open(requestId), requestId)
    await page.waitForFunction(({ id, requestId, openToken }) => {
      const rendered = document.querySelector('main')?.dataset
      return rendered?.qaActor === id && rendered.qaRequest === requestId && Number(rendered.qaOpenToken) === openToken
    }, { id, requestId, openToken })
  }
}
let requestId, unitId
try {
  await page.goto('http://127.0.0.1:5176/collection-entry')
  await test('작성 단계와 저장 전 점검이 제목·문항·대상·완료 방식을 함께 안내한다', async () => {
    await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    for (const name of ['1. 무엇을 언제까지 받을까요?','2. 어떤 응답을 받을까요?','3. 누가 몇 부를 제출할까요?']) assert.equal(await form().getByRole('group', { name, exact: true }).count(), 1)
    await form().getByLabel('수합 제목', { exact: true }).fill('합성 학년 행사 준비')
    await form().getByLabel('목적·안내', { exact: true }).fill('학급별 준비 내용과 수량을 알려 주세요.')
    await form().getByLabel('마감일', { exact: true }).fill('2026-10-21')
    await form().getByLabel('검토 방식', { exact: true }).selectOption('required')
    await form().getByLabel('검토자', { exact: true }).selectOption('gaon-minjun')
    await form().getByLabel('글 응답 필수', { exact: true }).check()
    assert.match(await form().getByLabel('입력 확인 안내').innerText(), /검토자가 제출 책임자와 겹칩니다/)
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    assert.match(await form().getByRole('alert').innerText(), /자신의 제출/); assert.equal((await state()).requests.length, 0)
    assert.equal(await form().getByLabel('수합 제목', { exact: true }).inputValue(), '합성 학년 행사 준비')
  })
  await test('중복 대상 오류는 이름을 보존하고 수정 뒤 저장할 수 있다', async () => {
    await form().getByLabel('단위 1 이름', { exact: true }).fill('2학년 1반')
    await form().getByLabel('단위 1 최종 제출 책임자', { exact: true }).selectOption('gaon-soyeon')
    await form().getByRole('group', { name: '제출 단위 1', exact: true }).getByLabel('김서진', { exact: true }).check()
    await form().getByRole('button', { name: '+ 제출 단위 추가', exact: true }).click()
    await form().getByLabel('단위 2 이름', { exact: true }).fill('2학년 1반')
    await form().getByLabel('단위 2 최종 제출 책임자', { exact: true }).selectOption('gaon-soyeon')
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    assert.match(await form().getByRole('alert').innerText(), /중복/); assert.equal(await form().getByLabel('단위 2 이름', { exact: true }).inputValue(), '2학년 1반')
    await form().getByLabel('단위 2 이름', { exact: true }).fill('2학년 2반')
    await page.evaluate(() => window.qa.fail()); await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    assert.match(await form().getByRole('alert').innerText(), /합성 저장 실패/); assert.equal((await state()).requests.length, 0)
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    requestId = (await state()).requests[0].id; assert.equal((await state()).requests.length, 1)
  })
  await test('게시 전에는 저장된 대상·필수 문항·검토자·기한을 정확히 확인한다', async () => {
    const preview = page.getByRole('region', { name: '게시할 수합 미리보기', exact: true })
    await preview.getByText('제출 대상 확인 · 2부', { exact: true }).click()
    const text = await preview.innerText()
    for (const value of ['합성 학년 행사 준비','2026-10-21','이민준 · 검토 후 완료','최종 제출: 한소연','공동 작성: 김서진','2학년 2반']) assert(text.includes(value))
    if (output) await page.screenshot({ path: join(output, 'collection-entry-desktop.png'), fullPage: true })
  })
  await test('동시 수정 충돌에서 최신 내용을 실제 비교한 뒤 내 입력으로 저장한다', async () => {
    await page.getByRole('button', { name: '초안 수정', exact: true }).click()
    await form().getByLabel('수합 제목', { exact: true }).fill('내가 보존할 수정 제목')
    await page.evaluate(id => window.qa.externalRequest(id), requestId)
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click(); assert.match(await form().getByRole('alert').innerText(), /다른 창/)
    await form().getByRole('button', { name: '최신 원본 비교 · 내 입력 유지', exact: true }).click()
    const comparison = form().getByRole('region', { name: '최신 수합 원본 비교' })
    assert.match(await comparison.innerText(), /다른 창에서 바뀐 제목/); assert.match(await comparison.innerText(), /바뀐 글 문항/)
    assert.equal(await form().getByLabel('수합 제목', { exact: true }).inputValue(), '내가 보존할 수정 제목')
    assert.match(await comparison.innerText(), /저장 기준 원본 v1/)
    await comparison.getByRole('button', { name: '이 원본 확인 · 내 입력 유지', exact: true }).click()
    assert.match(await comparison.innerText(), /저장 기준 원본 v2/)
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    assert.equal((await state()).requests[0].title, '내가 보존할 수정 제목')
  })
  await test('초안은 작성 책임자에게 공개되지 않고 게시 후 응답할 수 있다', async () => {
    // 같은 소속에서 같은 요청을 다시 열어도 직전 화면을 검사하지 않는다.
    for (let attempt = 0; attempt < 2; attempt++) {
      await actor('gaon-soyeon', requestId); assert.match(await page.locator('.wf-request-detail').innerText(), /확인할 수 없습니다/)
    }
    await actor('gaon-minjun', requestId); await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    assert.equal((await state()).units.length, 2); unitId = (await state()).units[0].id
    await actor('gaon-soyeon', requestId); await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    assert.match(await response().innerText(), /내 역할: 최종 제출 책임자/)
  })
  await test('빈 필수 응답도 초안 저장은 가능하고 최종 제출은 준비 상태를 안내한다', async () => {
    await response().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert.equal((await state()).drafts.length, 1); assert.equal((await state()).submissions.length, 0)
    assert(await response().getByRole('button', { name: '최종 제출', exact: true }).isDisabled())
    assert.match(await response().innerText(), /공동 초안 v1 저장됨/)
    await response().getByLabel('안내 및 참고 사항', { exact: true }).fill('보존할 초안 내용')
    await response().getByLabel('필요 수량', { exact: true }).fill('0')
    assert(await response().getByRole('button', { name: '최종 제출', exact: true }).isDisabled())
    await response().getByRole('button', { name: '초안 저장', exact: true }).click()
    assert(!(await response().getByRole('button', { name: '최종 제출', exact: true }).isDisabled()))
    assert.equal((await state()).drafts[0].number, 0)
  })
  await test('공동 작성자는 초안 안내만 받고 최종 제출 권한을 추가하지 않는다', async () => {
    await unit().getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click()
    await actor('gaon-seojin', requestId); await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    assert.match(await response().innerText(), /내 역할: 공동 작성자/); assert.match(await response().innerText(), /한소연 교사가 합니다/)
    assert.equal(await response().getByRole('button', { name: '최종 제출', exact: true }).count(), 0)
    await unit().getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click(); await actor('gaon-soyeon', requestId)
    await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
  })
  await test('공동 초안 충돌 뒤 최신 본문을 보여주고 내 입력을 재저장한다', async () => {
    await response().getByLabel('안내 및 참고 사항', { exact: true }).fill('내가 작성 중인 내용')
    await page.evaluate(id => window.qa.externalAnswer(id), unitId)
    assert.match(await response().innerText(), /다른 작성자가 저장한 내용/)
    assert.equal(await response().getByLabel('안내 및 참고 사항', { exact: true }).inputValue(), '내가 작성 중인 내용')
    await response().getByRole('button', { name: '최신 내용 확인 · 내 입력 유지', exact: true }).click()
    assert(await response().getByRole('button', { name: '최종 제출', exact: true }).isDisabled())
    await response().getByRole('button', { name: '초안 저장', exact: true }).click()
    await response().getByRole('button', { name: '최종 제출', exact: true }).click()
    assert.equal((await state()).submissions.length, 1); assert.match(await unit().innerText(), /검토 대기/)
    assert.equal((await state()).units[0].effectiveSubmissionId, null)
  })
  await test('재제출 사유와 마감 후 허용 오류를 안내하고 입력을 보존한다', async () => {
    await unit().getByRole('button', { name: '정정·보완 초안 작성', exact: true }).click()
    assert(await response().getByRole('button', { name: '새 버전 제출', exact: true }).isDisabled())
    await response().getByLabel('정정·보완 사유', { exact: true }).fill('합성 내용 재확인')
    await page.evaluate(() => window.qa.date('2026-10-22'))
    await response().getByText(/정정 허용 기간이 필요/).waitFor()
    assert.match(await response().innerText(), /정정 허용 기간이 필요/)
    await response().getByRole('button', { name: '새 버전 제출', exact: true }).click()
    assert.match(await response().getByRole('alert').innerText(), /마감 후 정정/)
    assert.equal(await response().getByLabel('정정·보완 사유', { exact: true }).inputValue(), '합성 내용 재확인')
    assert.equal((await state()).submissions.length, 1)
    await unit().getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click()
  })
  await test('보완 기한이 지나도 해당 보완을 제출하고 원래 기한과 늦은 접수를 표시한다', async () => {
    await actor('gaon-minjun', requestId)
    await unit().getByLabel('검토 의견', { exact: true }).fill('본문을 보완해 주세요.')
    await unit().getByLabel('보완을 요청할 경우 기한', { exact: true }).fill('2026-10-23')
    await unit().getByRole('button', { name: '보완 요청', exact: true }).click()
    await page.evaluate(() => window.qa.date('2026-10-24'))
    await actor('gaon-soyeon', requestId)
    assert.match(await unit().innerText(), /보완 기한 초과/)
    await unit().getByRole('button', { name: '정정·보완 초안 작성', exact: true }).click()
    assert.match(await response().innerText(), /미완료 보완 요청에 응답할 수 있습니다/)
    assert.doesNotMatch(await response().innerText(), /정정 허용 기간이 필요/)
    await response().getByLabel('안내 및 참고 사항', { exact: true }).fill('보완한 제출 내용')
    await response().getByLabel('정정·보완 사유', { exact: true }).fill('검토 의견에 따른 보완')
    await response().getByRole('button', { name: '초안 저장', exact: true }).click()
    await response().getByRole('button', { name: '새 버전 제출', exact: true }).click()
    assert.equal((await state()).submissions.length, 2)
    const receipt = (await state()).submissions.at(-1), supplement = (await state()).supplements[0]
    assert.equal(supplement.fulfilledSubmissionId, receipt.id); assert.equal(supplement.dueDate, '2026-10-23')
    assert.equal(receipt.receiptDate, '2026-10-24')
    assert.match(await unit().innerText(), /보완 기한 2026-10-23 · 기한 후 제출 · 접수 2026-10-24/)
  })
  await test('선택 숫자에서 미완성 숫자 입력을 빈칸으로 잘못 제출하지 않는다', async () => {
    await actor('gaon-minjun'); await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    await form().getByLabel('수합 제목', { exact: true }).fill('선택 숫자 확인')
    await form().getByLabel('숫자 응답 필수 · 0도 유효한 응답', { exact: true }).uncheck()
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click(); await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    const optionalUnit = page.getByRole('article', { name: '내 제출 단위 제출 단위', exact: true })
    await optionalUnit.getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    const optionalForm = optionalUnit.getByRole('form'); await optionalForm.getByRole('button', { name: '초안 저장', exact: true }).click()
    const number = optionalForm.getByLabel('필요 수량', { exact: true }); await number.focus(); await number.pressSequentially('-')
    assert(await number.evaluate(node => node.validity.badInput)); assert(await optionalForm.getByRole('button', { name: '최종 제출', exact: true }).isDisabled())
    assert.match(await optionalForm.innerText(), /숫자 입력 형식/); assert(await page.getByLabel('검증 소속', { exact: true }).isDisabled())
    await number.fill('-2.5'); await optionalForm.getByRole('button', { name: '초안 저장', exact: true }).click()
    await optionalForm.getByRole('button', { name: '최종 제출', exact: true }).click()
    assert.equal((await state()).submissions.at(-1).number, -2.5)
  })
  await test('390px에서 입력 확인과 게시 미리보기가 화면 폭 안에 표시된다', async () => {
    await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click(); await form().getByLabel('수합 제목', { exact: true }).fill('모바일 행사 안내 수합')
    await page.setViewportSize({ width: 390, height: 844 }); await form().getByRole('region', { name: '저장 전 입력 확인', exact: true }).scrollIntoViewIfNeeded()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (output) await page.screenshot({ path: join(output, 'collection-entry-mobile.png') })
    assert.deepEqual(errors, []); assert.equal(external.length, 0)
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
  })
  if (output) writeFileSync(join(output, 'collection-entry-results.json'), JSON.stringify({ passed: results.length, tests: results, errors, external }, null, 2))
  console.log(`\n수합 입력 브라우저 검증: ${results.length}개 통과`)
} finally { await context.close(); await browser.close() }
