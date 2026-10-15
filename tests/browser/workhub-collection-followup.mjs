// 실제 수합 화면에서 교사별 대상 추가와 제출판별 보완 이력을 함께 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
  import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';
  import{createWorkflowStore}from'./apps/workhub/src/workflows/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';
  import theme from'./apps/workhub/src/style.css?inline';import workflow from'./apps/workhub/src/workflows/workflows.css?inline';
  const members=[...fixtureData.memberships,{...fixtureData.memberships[0],id:'gaon-jimin',userId:'fixture-jimin',name:'박지민'}];
  const store=createWorkflowStore({members,date:fixtureData.basisDate});let openSerial=0;
  window.qa={snapshot:()=>store.exportState()};
  function App(){const[id,setId]=useState('gaon-minjun'),[locked,setLocked]=useState(false),[generation,setGeneration]=useState(0),[target,setTarget]=useState(),[token,setToken]=useState(0);
    window.qa.open=requestId=>{const value=++openSerial;setTarget(requestId);setGeneration(n=>n+1);setToken(value);return value};
    const member=members.find(value=>value.id===id);
    return <><style>{theme}{workflow}{'body{margin:0;background:#f5f7ef}main{padding:20px;max-width:1250px;margin:auto}'} </style>
      <main data-qa-actor={id} data-qa-request={target??''} data-qa-open-token={token}><p>수합 대상·보완 흐름 검증 · 합성 자료</p>
      <label>검증 소속<select aria-label="검증 소속" value={id} disabled={locked} onChange={event=>{setId(event.target.value);setTarget(undefined);setGeneration(n=>n+1)}}>{members.filter(value=>value.active).map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <EditSession onLockChange={setLocked}><WorkflowPanel key={id+generation} store={store} member={member} members={members} date={fixtureData.basisDate} page="collections" initialRequestId={target}/></EditSession></main></>}
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })

const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const form = () => page.getByRole('form', { name: '수합 만들기 양식', exact: true })
const recipients = () => form().getByRole('region', { name: '교사마다 1부씩 추가', exact: true })
const search = () => recipients().getByRole('searchbox', { name: '교사 이름 검색', exact: true })
const unit = () => page.getByRole('article', { name: '한소연 제출 단위', exact: true })
const answer = () => unit().getByRole('form', { name: '한소연 응답 초안', exact: true })
const currentReview = () => unit().getByRole('region', { name: '현재 제출판 검토 결과', exact: true })
const history = () => unit().locator('details.wf-review-history')
const state = () => page.evaluate(() => window.qa.snapshot())
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function actor(id, requestId) {
  await page.getByLabel('검증 소속', { exact: true }).selectOption(id)
  await page.waitForFunction(id => document.querySelector('main')?.dataset.qaActor === id, id)
  if (requestId) {
    // 소속 전환과 같은 요청 재열기 모두 실제 새 화면의 commit 뒤에 검사한다.
    const token = await page.evaluate(id => window.qa.open(id), requestId)
    await page.waitForFunction(({ id, requestId, token }) => {
      const rendered = document.querySelector('main')?.dataset
      return rendered?.qaActor === id && rendered.qaRequest === requestId && Number(rendered.qaOpenToken) === token
    }, { id, requestId, token })
  }
}
async function keyboardChoose(name) {
  await search().fill(name)
  const checkbox = recipients().getByRole('checkbox', { name, exact: true })
  await checkbox.focus(); await checkbox.press('Space')
  assert(await checkbox.isChecked())
}
async function noOverflow() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '390px 화면에 가로 넘침이 없어야 한다') }
let requestId, unitId, firstSubmissionId, secondSubmissionId
const existingLabel = '기존 학년 공동 제출 단위', firstNote = 'v1의 행사 장소와 안전 인원을 구체적으로 보완해 주세요.', secondNote = 'v2의 보완 내용과 담당 인원을 확인했습니다.'
try {
  await page.goto('http://127.0.0.1:5176/collection-followup')
  await test('현재 학교의 교사만 검색하고 두 검색에서 고른 대상이 함께 유지된다', async () => {
    await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    await form().getByLabel('수합 제목', { exact: true }).fill('합성 학교 행사 담당 자료 수합')
    await form().getByLabel('목적·안내', { exact: true }).fill('담당 교사는 행사 준비 내용과 안전 인원 수를 작성해 주세요.')
    await form().getByLabel('마감일', { exact: true }).fill('2026-10-21')
    await form().getByLabel('검토 방식', { exact: true }).selectOption('required')
    await form().getByLabel('검토자', { exact: true }).selectOption('gaon-jimin')
    await form().getByLabel('글 응답 필수', { exact: true }).check()
    await form().getByLabel('단위 1 이름', { exact: true }).fill(existingLabel)
    await form().getByRole('group', { name: '제출 단위 1', exact: true }).getByRole('checkbox', { name: '김서진', exact: true }).check()
    const candidates = recipients().getByRole('group', { name: '추가 가능한 교사', exact: true })
    assert.equal(await candidates.getByRole('checkbox').count(), 2)
    for (const excluded of ['이민준', '박지민', '전출 교사', '한소연 (겸임)', '윤하린']) assert.equal(await candidates.getByRole('checkbox', { name: excluded, exact: true }).count(), 0)
    await keyboardChoose('한소연'); await keyboardChoose('김서진')
    await recipients().getByRole('button', { name: '선택한 교사 2명 추가', exact: true }).waitFor()
    await search().fill('한소연')
    await search().press('Enter')
    assert.equal(await form().count(), 1); assert.equal((await state()).requests.length, 0)
    assert(await recipients().getByRole('checkbox', { name: '한소연', exact: true }).isChecked())
    assert(await page.getByLabel('검증 소속', { exact: true }).isDisabled())
    await noOverflow()
    if (output) await page.screenshot({ path: join(output, 'collection-followup-recipients-390.png') })
  })
  await test('키보드로 일괄 추가하면 기존 단위를 보존하고 첫 새 단위로 초점이 이동한다', async () => {
    const add = recipients().getByRole('button', { name: '선택한 교사 2명 추가', exact: true })
    await add.focus(); await add.press('Enter')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-wf-unit-name') === '1')
    assert.equal(await form().getByLabel('단위 1 이름', { exact: true }).inputValue(), existingLabel)
    assert.equal(await form().getByLabel('단위 1 최종 제출 책임자', { exact: true }).inputValue(), 'gaon-minjun')
    assert(await form().getByRole('group', { name: '제출 단위 1', exact: true }).getByRole('checkbox', { name: '김서진', exact: true }).isChecked())
    assert.deepEqual(await form().locator('[data-wf-unit-name]').evaluateAll(nodes => nodes.map(node => node.value)), [existingLabel, '김서진', '한소연'])
    await search().fill('')
    assert.equal(await recipients().getByRole('checkbox').count(), 0)
    assert(await recipients().getByRole('button', { name: '선택한 교사 0명 추가', exact: true }).isDisabled())
    await noOverflow()
  })
  await test('저장·게시한 제출 단위에 중복 책임자를 만들지 않고 기존 공동 구성원을 유지한다', async () => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    const draft = (await state()).requests[0]; requestId = draft.id
    assert.equal(draft.units.length, 3)
    assert.deepEqual(draft.units[0], { label: existingLabel, responsibleMemberId: 'gaon-minjun', contributorMemberIds: ['gaon-seojin'] })
    assert.equal(new Set(draft.units.map(value => value.responsibleMemberId)).size, 3)
    await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    const published = await state(); assert.equal(published.units.length, 3)
    unitId = published.units.find(value => value.responsibleMemberId === 'gaon-soyeon').id
    assert.deepEqual(published.units.map(value => value.label), [existingLabel, '김서진', '한소연'])
    await actor('gaon-soyeon', requestId)
    assert.equal(await page.getByRole('article', { name: existingLabel + ' 제출 단위', exact: true }).count(), 0)
    assert.equal(await unit().count(), 1)
  })
  await test('첫 제출에 보완을 요청하면 그 판의 의견·검토자·기한을 함께 안내한다', async () => {
    await unit().getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    await answer().getByLabel('안내 및 참고 사항', { exact: true }).fill('행사 준비 초안입니다.')
    await answer().getByLabel('필요 수량', { exact: true }).fill('2')
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    await answer().getByRole('button', { name: '최종 제출', exact: true }).click()
    firstSubmissionId = (await state()).submissions[0].id
    await actor('gaon-jimin', requestId)
    await unit().getByLabel('검토 의견', { exact: true }).fill(firstNote)
    await unit().getByLabel('보완을 요청할 경우 기한', { exact: true }).fill('2026-10-23')
    await unit().getByRole('button', { name: '보완 요청', exact: true }).click()
    await currentReview().getByText(firstNote, { exact: true }).waitFor()
    assert.match(await currentReview().innerText(), /v1/)
    const remaining = unit().getByRole('region', { name: '남은 보완 요청', exact: true })
    for (const value of [firstNote, '2026-10-23', 'v1']) assert((await remaining.innerText()).includes(value))
    const snapshot = await state(); assert.equal(snapshot.reviews[0].submissionId, firstSubmissionId)
    assert.equal(snapshot.reviews[0].reviewerMemberId, 'gaon-jimin'); assert.equal(snapshot.supplements[0].fulfilledSubmissionId, null)
  })
  await test('v2 재제출 후 v1 보완 의견을 현재 검토 결과로 표시하지 않는다', async () => {
    await actor('gaon-soyeon', requestId)
    await unit().getByRole('button', { name: '정정·보완 초안 작성', exact: true }).click()
    await answer().getByLabel('안내 및 참고 사항', { exact: true }).fill('체육관 행사이며 안전 담당 교사 3명을 배정합니다.')
    await answer().getByLabel('필요 수량', { exact: true }).fill('3')
    await answer().getByLabel('정정·보완 사유', { exact: true }).fill('v1 검토 의견에 따라 장소와 안전 인원을 보완했습니다.')
    await answer().getByRole('button', { name: '초안 저장', exact: true }).click()
    await answer().getByRole('button', { name: '새 버전 제출', exact: true }).click()
    await currentReview().getByText('현재 제출 v2 · 검토 대기', { exact: true }).waitFor()
    const current = await currentReview().innerText()
    assert(current.includes('이 제출판에는 아직 검토 의견이 없습니다.')); assert(!current.includes(firstNote))
    assert.equal(await unit().getByRole('region', { name: '남은 보완 요청', exact: true }).count(), 0)
    const snapshot = await state(); secondSubmissionId = snapshot.submissions.at(-1).id
    assert.equal(snapshot.submissions.length, 2); assert.equal(snapshot.supplements[0].fulfilledSubmissionId, secondSubmissionId)
    assert.equal(snapshot.units.find(value => value.id === unitId).effectiveSubmissionId, null)
  })
  await test('검토 이력은 v1의 보완 요청과 v2의 보완 응답을 별개 사건으로 설명한다', async () => {
    const toggle = history().locator('summary')
    await toggle.focus(); await toggle.press('Enter')
    assert.equal(await history().getAttribute('open'), '')
    const text = await history().innerText()
    for (const value of ['v1 · 보완 요청', firstNote, '박지민', '2026-10-23', 'v1 보완에 v2 제출', '해당 제출판의 검토 결과는 별도입니다.']) assert(text.includes(value), '이력에 누락된 정보: ' + value)
    assert.equal((await state()).reviews.length, 1)
    await page.setViewportSize({ width: 390, height: 844 }); await history().scrollIntoViewIfNeeded()
    await noOverflow()
    if (output) await page.screenshot({ path: join(output, 'collection-followup-history-390.png') })
  })
  await test('검토자가 v2를 확인하면 현재 판의 의견만 완료 결과에 표시한다', async () => {
    await page.setViewportSize({ width: 1440, height: 1100 }); await actor('gaon-jimin', requestId)
    await unit().getByLabel('검토 의견', { exact: true }).fill(secondNote)
    await unit().getByRole('button', { name: '이 버전 검토 완료', exact: true }).click()
    await currentReview().getByText(secondNote, { exact: true }).waitFor()
    const current = await currentReview().innerText()
    assert(current.includes('v2')); assert(current.includes('검토 완료')); assert(!current.includes(firstNote))
    const snapshot = await state(); assert.equal(snapshot.reviews.length, 2)
    assert.equal(snapshot.reviews[1].submissionId, secondSubmissionId)
    assert.equal(snapshot.units.find(value => value.id === unitId).effectiveSubmissionId, secondSubmissionId)
    if (output) await page.screenshot({ path: join(output, 'collection-followup-review-desktop.png') })
  })
  await test('겸임 소속을 전환하면 다른 학교의 수합과 기존 대상 선택이 섞이지 않는다', async () => {
    await actor('nuri-soyeon', requestId)
    assert.match(await page.locator('.wf-request-detail').innerText(), /확인할 수 없습니다/)
    await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    assert.equal(await recipients().getByRole('checkbox').count(), 1)
    assert.equal(await recipients().getByRole('checkbox', { name: '윤하린', exact: true }).count(), 1)
    assert.equal(await recipients().getByRole('checkbox', { name: '김서진', exact: true }).count(), 0)
    await keyboardChoose('윤하린')
    assert(await page.getByLabel('검증 소속', { exact: true }).isDisabled())
    await form().getByRole('button', { name: '취소', exact: true }).click()
    await actor('gaon-minjun')
    await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    assert.equal(await search().inputValue(), '')
    assert(await recipients().getByRole('button', { name: '선택한 교사 0명 추가', exact: true }).isDisabled())
    assert.equal(await recipients().getByRole('checkbox', { name: '윤하린', exact: true }).count(), 0)
    assert.equal((await state()).requests.length, 1)
    await form().getByRole('button', { name: '취소', exact: true }).click()
  })
  await test('전체 흐름에서 외부 요청·브라우저 오류·영구 저장을 발생시키지 않는다', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
  })
  if (output) writeFileSync(join(output, 'collection-followup-results.json'), JSON.stringify({ passed: results.length, tests: results, errors, external }, null, 2))
  console.log(`\n수합 대상·보완 브라우저 검증: ${results.length}개 통과`)
} finally { await context.close(); await browser.close() }
