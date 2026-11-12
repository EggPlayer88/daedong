// 실제 연결 화면·후보 검색·기존 할 일 어댑터를 연결하며 DB와 유료 AI는 합성 응답으로 대체한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-global-search-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 950 } }), page = await context.newPage()
const errors = [], external = [], results = []
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const input = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
const review = () => page.locator('.workspace-operation[data-operation-kind="taskChange"]')
const button = name => page.getByRole('button', { name, exact: true })
const writes = () => page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_task_mutate').map(row => row.args))
const snapshot = () => page.evaluate(() => window.qa.qaTasks.snapshot())
async function test(name, run) {
  await page.goto('http://127.0.0.1:5179/assistant-daily-actions'); await page.addScriptTag({ content: bundle })
  await button('업무 찾기').waitFor()
  await page.evaluate(() => window.qa.qaTasks.seed())
  await button('AI 비서').first().click(); await input().waitFor()
  await page.waitForFunction(() => {
    const field = document.querySelector('#root > div')?.shadowRoot?.querySelector('.assistant-compose textarea')
    return field && !field.disabled
  })
  try {
    await run()
    assert.equal(await page.evaluate(() => window.qa.calls.some(row => /assistant_start|confirm_task|claude/.test(row.name))), false)
    results.push(name); console.log('  ✓ ' + name)
  }
  catch (error) { console.error(await page.locator('.workhub-connected').innerText()); throw error }
}
async function choose(text, status = 'todo') {
  // 시험 초기 상태만 바꾸며 실제 동작 검증은 모든 UI와 기존 RPC 어댑터를 거친다.
  await page.evaluate(status => { window.qa.qaTasks.snapshot().rows.find(row => row.id === 'task-b').status = status }, status)
  await input().fill(text); await button('내 할 일 찾기').click()
  const choices = page.getByRole('region', { name: '변경할 내 할 일', exact: true })
  await choices.waitFor()
  const matches = choices.getByRole('button').filter({ hasText: '변경 내용 보기' })
  assert.equal(await matches.count(), 2, '동명 업무를 자동 선택하지 않아야 합니다')
  assert.deepEqual(await writes(), [])
  await matches.filter({ hasText: '2026-10-28' }).click()
}
async function ready(text, status = 'todo') {
  await choose(text, status)
  await review().getByRole('heading', { name: '할 일 변경을 검토해 주세요', exact: true }).waitFor()
  assert.equal(await review().getAttribute('data-operation-status'), 'review')
  assert.deepEqual(await writes(), [])
  assert.equal(await input().isDisabled(), true)
  assert.match(await review().innerText(), /가상 교사 01[\s\S]*나만 보기[\s\S]*원본 v1/)
}
async function confirm(label) {
  await review().getByRole('button', { name: label, exact: true }).click()
  await review().getByRole('heading', { name: '저장을 확인했습니다', exact: true }).waitFor()
  assert.equal(await input().isDisabled(), false)
}
async function verifyPreserved(expected) {
  const data = await snapshot()
  assert.equal(data.writes, 1)
  const [first, second] = data.rows
  assert.deepEqual(first, { id: 'task-a', schoolId: second.schoolId, ownerMemberId: 'member-01', title: '제출 자료 확인', notes: '1학년 자료', dueDate: '2026-10-26', status: 'todo', version: 1 })
  assert.deepEqual(second, { id: 'task-b', schoolId: first.schoolId, ownerMemberId: 'member-01', title: '제출 자료 확인', notes: '2학년 자료', dueDate: '2026-10-28', status: 'todo', version: 2, ...expected })
}
async function capture(name) {
  if (!process.env.WORKHUB_QA_OUTPUT) return
  mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
  await review().screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, name + '.png') })
}
try {
  await test('제목 변경은 동명 두 업무 중 선택한 한 건만 검토하고 기존 내용·기한·상태를 유지한다', async () => {
    await ready('내 할 일 제출 자료 확인 제목을 보고서 점검으로 바꿔줘')
    assert.match(await review().innerText(), /제목[\s\S]*제출 자료 확인[\s\S]*보고서 점검/)
    await capture('assistant-task-title-review')
    await confirm('확인한 변경 저장'); await verifyPreserved({ title: '보고서 점검' })
    assert.deepEqual((await writes())[0].p_command, { kind: 'update', taskId: 'task-b', expectedVersion: 1, input: { title: '보고서 점검', notes: '2학년 자료', dueDate: '2026-10-28' } })
  })
  await test('상태 변경은 완료와 구별된 확인 버튼으로 선택한 업무의 대기 상태만 저장한다', async () => {
    await ready('내 할 일 제출 자료 확인 상태를 대기로 바꿔줘')
    assert.match(await review().innerText(), /상태[\s\S]*할 일[\s\S]*대기/)
    assert.equal(await review().getByRole('button', { name: '확인한 할 일 완료', exact: true }).count(), 0)
    await confirm('확인한 상태 변경'); await verifyPreserved({ status: 'waiting' })
    assert.deepEqual((await writes())[0].p_command, { kind: 'status', taskId: 'task-b', expectedVersion: 1, status: 'waiting' })
  })
  for (const status of ['done', 'cancelled']) await test(`${status === 'done' ? '완료' : '취소'} 업무도 후보로 확인하고 다시 시작하면 기존 할 일 상태로 복귀한다`, async () => {
    await ready('할 일 제출 자료 확인 다시 시작해줘', status)
    assert.match(await review().innerText(), status === 'done' ? /완료[\s\S]*할 일/ : /취소[\s\S]*할 일/)
    await capture('assistant-task-restart-' + status)
    await confirm('확인한 할 일 다시 시작'); await verifyPreserved({ status: 'todo' })
    assert.deepEqual((await writes())[0].p_command, { kind: 'status', taskId: 'task-b', expectedVersion: 1, status: 'todo' })
  })
  for (const scenario of [
    { name: '제목 수정', text: '할 일 제출 자료 확인 제목을 보고서 점검으로 바꿔줘', status: 'todo', label: '확인한 변경 저장', expected: { title: '보고서 점검' } },
    { name: '재개', text: '할 일 제출 자료 확인 재개해줘', status: 'cancelled', label: '확인한 할 일 다시 시작', expected: { status: 'todo' } },
    { name: '상태 변경', text: '할 일 제출 자료 확인 상태를 진행 중으로 바꿔줘', status: 'todo', label: '확인한 상태 변경', expected: { status: 'doing' } },
  ]) await test(`${scenario.name} 응답을 잃으면 입력을 잠그고 원래 요청 번호·명령으로 복구하여 중복 저장하지 않는다`, async () => {
    await ready(scenario.text, scenario.status)
    await page.evaluate(() => window.qa.qaTasks.loseNextReply())
    await review().getByRole('button', { name: scenario.label, exact: true }).evaluate(node => { node.click(); node.click() })
    const retry = button('같은 요청으로 저장 결과 확인'); await retry.waitFor()
    const attempts = await writes(); assert.equal(attempts.length, 1)
    assert.equal(typeof attempts[0].p_request_key, 'string'); assert(attempts[0].p_request_key.length > 0)
    assert.equal(await input().isDisabled(), true)
    const gets = await page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_task_get').length)
    await retry.click(); await review().getByRole('heading', { name: '저장을 확인했습니다', exact: true }).waitFor()
    assert.deepEqual(await writes(), [attempts[0], attempts[0]])
    assert.equal(await page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_task_get').length), gets, '복구는 최신 원본을 다시 읽어 명령을 바꾸지 않습니다')
    assert.equal(await input().isDisabled(), false); await verifyPreserved(scenario.expected)
  })
  await test('제목 확인 후 원본 판이 바뀌면 저장을 거절하고 다른 화면의 정정을 보존한다', async () => {
    await ready('할 일 제출 자료 확인 제목을 보고서 점검으로 바꿔줘')
    await page.evaluate(() => window.qa.qaTasks.revise('task-b'))
    await review().getByRole('button', { name: '확인한 변경 저장', exact: true }).click()
    await review().getByRole('alert').waitFor()
    assert.match(await review().getByRole('alert').innerText(), /최신 업무를 다시 선택/)
    assert.deepEqual(await writes(), [])
    const data = await snapshot(); assert.equal(data.writes, 0)
    assert.equal(data.rows[1].notes, '다른 화면에서 정정한 내용'); assert.equal(data.rows[1].title, '제출 자료 확인')
  })
  await test('이미 진행 가능한 할 일을 재개하려 하면 검토·쓰기 없이 다시 선택하게 한다', async () => {
    await choose('할 일 제출 자료 확인 다시 시작해줘')
    await page.getByText(/이미 진행 가능한 할 일/).waitFor()
    assert.equal(await review().count(), 0); assert.deepEqual(await writes(), [])
    assert.equal((await snapshot()).writes, 0)
  })
  await test('상태 변경 검토를 취소하면 두 업무 모두 유지하고 새 대화를 입력할 수 있다', async () => {
    await ready('할 일 제출 자료 확인 상태를 취소로 바꿔줘')
    await review().getByRole('button', { name: '취소', exact: true }).click()
    await review().waitFor({ state: 'detached' })
    assert.equal(await input().isDisabled(), false); assert.deepEqual(await writes(), [])
    assert.deepEqual((await snapshot()).rows.map(row => [row.id, row.status, row.version]), [['task-a', 'todo', 1], ['task-b', 'todo', 1]])
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`할 일 대화 실제 연결 브라우저 ${results.length}건 통과 · 외부 요청 0건`)
} finally {
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'daily-actions-results.json'), JSON.stringify({ results, errors, external }, null, 2)) }
  await browser.close()
}
