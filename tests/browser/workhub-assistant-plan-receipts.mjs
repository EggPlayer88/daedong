// 실제 비서·실행기·응답 검증을 통과한 접수 결과만 계획에 기록한다. 어댑터는 합성이다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-assistant-operations-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const origin = 'http://127.0.0.1:5291/', errors = [], external = []
let passed = 0
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div></html>' })
})
const input = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
const button = name => page.getByRole('button', { name, exact: true })
const plan = () => page.getByRole('region', { name: '나누어 진행할 업무', exact: true })
const card = () => page.locator('.workspace-operation')
const task = '제출 자료 확인 메모를 검토 완료로 바꿔줘'
const calendar = '내일 오후 3시부터 4시까지 회의 일정 만들어줘'
async function request(text, label) { await input().fill(text); await button(label).click() }
async function build(first = task, second = calendar) { await request(first + ' 그리고 ' + second, '업무 나누기'); await plan().waitFor() }
async function chooseFirst() { await request('다음 업무', '업무 목록 확인') }
async function taskReview() {
  await button('내 할 일 찾기').click()
  await page.getByRole('region', { name: '변경할 내 할 일' }).getByRole('button').filter({ hasText: '변경 내용 보기' }).click()
  await card().getByRole('heading', { name: '할 일 변경을 검토해 주세요', exact: true }).waitFor()
}
async function saved() { await card().getByRole('heading', { name: '저장을 확인했습니다', exact: true }).waitFor() }
async function noConfirmed() { assert.doesNotMatch(await plan().innerText(), /서버 처리 확인/) }
async function test(name, run) {
  await page.goto(origin + 'plan-receipts'); await page.addScriptTag({ content: bundle }); await input().waitFor()
  try { await run(); assert.equal(await page.evaluate(() => window.aiCalls), 0); passed++; console.log('  ✓ ' + name) }
  catch (error) { console.error(await page.locator('#root').innerText()); throw error }
}
try {
  await test('할 일과 일정은 각각 검토·확정한 뒤 해당 단계에만 접수 결과를 남긴다', async () => {
    await build(); await chooseFirst(); await taskReview(); await noConfirmed()
    assert.equal(await page.evaluate(() => window.applied), 0)
    await button('확인한 변경 저장').click(); await saved()
    assert.match(await plan().locator('li').nth(0).innerText(), /서버 처리 확인/)
    assert.doesNotMatch(await plan().locator('li').nth(1).innerText(), /서버 처리 확인/)
    assert.equal(await page.evaluate(() => window.applied), 1)
    await request('다음 업무', '업무 목록 확인')
    assert.equal(await input().inputValue(), calendar); assert.equal(await page.evaluate(() => window.applied), 1)
    await button('일정 초안 열기').click(); await card().getByRole('heading', { name: '새 일정을 검토해 주세요' }).waitFor()
    await button('확인한 일정 등록').click(); await saved()
    assert.equal(await plan().getByText('서버 처리 확인', { exact: true }).count(), 2)
    assert.equal(await page.evaluate(() => window.applied), 2)
    await card().getByRole('button', { name: '확인', exact: true }).click()
    assert.equal(await plan().getByText('서버 처리 확인', { exact: true }).count(), 2)
    await request('다음 업무', '업무 목록 확인')
    assert.equal(await page.evaluate(() => window.applied), 2)
    assert.equal(await input().inputValue(), '다음 업무')
  })
  await test('응답 유실 중에는 완료로 표시하지 않고 재진입 후 원키 복구에만 결과를 붙인다', async () => {
    await build(); await chooseFirst(); await taskReview(); await page.evaluate(() => { window.unknown = true })
    await button('확인한 변경 저장').click(); await button('같은 요청으로 저장 결과 확인').waitFor(); await noConfirmed()
    const first = await page.evaluate(() => window.calls.find(row => row.kind === 'update'))
    assert.equal(await input().isDisabled(), true)
    await page.evaluate(() => window.setShow(false)); await input().waitFor({ state: 'detached' })
    await page.evaluate(() => window.setShow(true)); await button('같은 요청으로 저장 결과 확인').waitFor(); await noConfirmed()
    await button('같은 요청으로 저장 결과 확인').click(); await saved()
    assert.match(await plan().locator('li').nth(0).innerText(), /서버 처리 확인/)
    assert.deepEqual(await page.evaluate(() => window.calls.filter(row => row.kind === 'update')), [first, first])
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await test('처리 확인된 단계의 재선택과 전체 원문 복원은 새 중복 요청을 만들지 않는다', async () => {
    await build(); await chooseFirst(); await taskReview(); await button('확인한 변경 저장').click(); await saved()
    assert.equal(await plan().getByRole('button', { name: /^1단계 선택/ }).isDisabled(), true)
    await request('1번 단계', '업무 목록 확인')
    assert.equal(await input().inputValue(), '1번 단계'); assert.equal(await page.evaluate(() => window.applied), 1)
    await page.getByText('이미 서버 처리를 확인한 단계입니다. 처리 결과를 확인하고, 같은 업무가 다시 필요하면 새 요청으로 작성해 주세요.', { exact: true }).waitFor()
    await request('원문 다시 검토', '업무 목록 확인')
    assert.equal(await input().inputValue(), '원문 다시 검토')
    await page.getByText('이미 처리한 단계가 포함되어 있습니다. 전체 요청에서 처리 결과를 확인하고, 남은 업무만 새 요청으로 작성해 주세요.', { exact: true }).waitFor()
    await input().fill(''); await plan().locator('summary').click()
    await plan().getByRole('button', { name: '원문 다시 검토', exact: true }).click()
    assert.equal(await input().inputValue(), ''); assert.match(await plan().innerText(), /서버 처리 확인/)
    assert.equal(await page.evaluate(() => window.applied), 1)
    await request('다음 업무', '업무 목록 확인'); assert.equal(await input().inputValue(), calendar)
  })
  await test('검토 이후 원본 변경으로 거절되면 단계는 처리 완료가 되지 않는다', async () => {
    await build(); await chooseFirst(); await taskReview()
    await page.evaluate(() => { window.task.version++; window.task.notes = '다른 창의 정정' })
    await button('확인한 변경 저장').click(); await card().getByRole('alert').waitFor(); await noConfirmed()
    assert.equal(await page.evaluate(() => window.applied), 0)
    assert.equal(await page.evaluate(() => window.task.notes), '다른 창의 정정')
    await card().getByRole('button', { name: '닫기', exact: true }).click(); await noConfirmed()
  })
  await test('일정 누락 정보를 이어 채워도 최초 선택 단계와 접수 결과를 정확히 연결한다', async () => {
    const partial = '내일 회의 일정 잡아줘'
    await build(partial, '시간표 보여줘'); await chooseFirst(); await button('일정 초안 열기').click()
    await page.getByRole('region', { name: '작성 중인 일정', exact: true }).waitFor()
    await request('오후 3시부터 4시', '일정 정보 이어 입력')
    await card().getByRole('heading', { name: '새 일정을 검토해 주세요' }).waitFor(); await noConfirmed()
    assert.match(await card().innerText(), /2026-11-12[\s\S]*15:00–16:00/)
    await button('확인한 일정 등록').click(); await saved()
    assert.match(await plan().locator('li').nth(0).innerText(), /서버 처리 확인/)
    assert.match(await plan().locator('li').nth(0).innerText(), /내일 회의 일정 잡아줘/)
    assert.doesNotMatch(await plan().locator('li').nth(1).innerText(), /서버 처리 확인/)
    assert.equal(await page.evaluate(() => window.applied), 1)
  })
  await test('일정 누락 답변을 채운 뒤 응답이 유실되어도 원문 연결을 보존해 한 번만 저장한다', async () => {
    await build('내일 회의 일정 잡아줘', '시간표 보여줘'); await chooseFirst(); await button('일정 초안 열기').click()
    await request('오후 3시부터 4시', '일정 정보 이어 입력'); await button('확인한 일정 등록').waitFor()
    await page.evaluate(() => { window.unknown = true }); await button('확인한 일정 등록').click()
    await button('같은 요청으로 저장 결과 확인').waitFor(); await noConfirmed()
    const first = await page.evaluate(() => window.calls.find(row => row.kind === 'calendar'))
    await page.evaluate(() => window.setShow(false)); await input().waitFor({ state: 'detached' })
    await page.evaluate(() => window.setShow(true)); await button('같은 요청으로 저장 결과 확인').click(); await saved()
    assert.match(await plan().locator('li').nth(0).innerText(), /서버 처리 확인/)
    assert.deepEqual(await page.evaluate(() => window.calls.filter(row => row.kind === 'calendar')), [first, first])
    assert.equal(await page.evaluate(() => window.applied), 1)
  })
  await test('선택 원문을 다른 명령으로 고친 경우 성공해도 예전 단계를 완료로 만들지 않는다', async () => {
    await build(); await chooseFirst(); await input().fill('제출 자료 확인 메모를 다른 내용으로 바꿔줘'); await taskReview()
    await button('확인한 변경 저장').click(); await saved(); await noConfirmed()
    assert.equal(await page.evaluate(() => window.task.notes), '다른 내용'); assert.equal(await page.evaluate(() => window.applied), 1)
  })
  await test('기준일 변경 후 원키 복구는 성공해도 오래된 단계의 날짜를 새로 해석하지 않는다', async () => {
    await build(); await chooseFirst(); await taskReview(); await page.evaluate(() => { window.unknown = true })
    await button('확인한 변경 저장').click(); await button('같은 요청으로 저장 결과 확인').waitFor()
    await page.evaluate(() => window.advanceDate())
    await button('같은 요청으로 저장 결과 확인').click(); await saved(); await noConfirmed()
    assert.equal(await page.evaluate(() => window.applied), 1)
    await request('다음 업무', '업무 목록 확인')
    assert.equal(await input().inputValue(), '다음 업무')
    assert.equal(await page.evaluate(() => window.calls.filter(row => row.kind === 'calendar').length), 0)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`계획과 서버 접수 결과 연결 ${passed}건 통과 · 합성 어댑터·유료 호출 0`)
} finally { await browser.close() }
