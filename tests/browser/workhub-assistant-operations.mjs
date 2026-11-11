// 실제 비서·공통 실행기를 합성 어댑터에 연결한다. 운영 DB·유료 AI는 호출하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-assistant-operations-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const font = readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64')
const shellStyles = readFileSync(new URL('../../apps/workhub/src/app/workspace-shell.css', import.meta.url), 'utf8')
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2')}*{box-sizing:border-box}body{margin:0;padding:24px;font-family:Pretendard,sans-serif;background:#f6f7f9;color:#202832}#root{max-width:1060px;margin:auto}@media(max-width:500px){body{padding:8px}}</style><div id="root"></div></html>`
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const errors = [], external = [], results = []
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5190/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: html })
})
const button = name => page.getByRole('button', { name, exact: true })
const input = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
const card = () => page.locator('.workspace-operation')
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function start() {
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('http://127.0.0.1:5190/assistant-operations')
  await page.addScriptTag({ content: bundle })
  try { await input().waitFor(); await settle() } catch (error) { console.error('초기 화면 오류:', errors, await page.locator('#root').innerText()); throw error }
}
async function request(text, label) { await input().fill(text); await button(label).click(); await settle() }
async function taskReview(text = '제출 자료 확인 메모를 검토 완료로 바꿔줘') {
  await request(text, '내 할 일 찾기')
  await page.getByRole('region', { name: '변경할 내 할 일' }).getByRole('button').filter({ hasText: '변경 내용 보기' }).click()
  await card().getByRole('heading', { name: '할 일 변경을 검토해 주세요' }).waitFor()
}
async function test(name, run) {
  await start()
  try { await run() } catch (error) { console.error('실패 화면:', await page.locator('#root').innerText()); throw error }
  results.push(name); console.log('  ✓ ' + name)
}
async function capture(name) {
  if (!process.env.WORKHUB_QA_OUTPUT) return
  mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.evaluate(() => document.fonts.ready)
  await card().screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, name + '.png') })
}
try {
  await test('대화에서 개인 할 일을 선택하고 변경 전후를 확인한 뒤 저장한다', async () => {
    assert.equal(await page.getByLabel('대화 분야', { exact: true }).inputValue(), 'auto')
    await taskReview()
    assert.equal(await page.evaluate(() => window.applied), 0)
    assert.match(await card().innerText(), /기존 메모[\s\S]*검토 완료/)
    assert.match(await card().innerText(), /합성 교사[\s\S]*나만 보기[\s\S]*원본 v2/)
    assert.equal(await input().isDisabled(), true); await page.waitForFunction(() => window.locked === true)
    await capture('assistant-task-operation-review')
    await card().getByRole('button', { name: '확인한 변경 저장', exact: true }).click()
    await card().getByRole('heading', { name: '저장을 확인했습니다' }).waitFor()
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.task.notes), '검토 완료')
    assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await input().isDisabled(), false)
    await card().getByRole('button', { name: '저장된 원본 보기' }).click()
    assert.deepEqual(await page.evaluate(() => window.opened.map(row => [row.kind, row.id, row.version])), [['task', 'task-one', 3]])
    assert.equal(await page.evaluate(() => window.aiCalls), 0)
  })
  await test('할 일 완료도 검토 버튼의 키보드 확인 이후에 한 번만 반영한다', async () => {
    await taskReview('제출 자료 확인을 완료해줘')
    assert.equal(await page.evaluate(() => window.task.status), 'doing')
    const confirm = card().getByRole('button', { name: '확인한 할 일 완료' })
    await confirm.focus(); await page.keyboard.press('Enter')
    await card().getByRole('heading', { name: '저장을 확인했습니다' }).waitFor()
    assert.equal(await page.evaluate(() => window.task.status), 'done'); assert.equal(await page.evaluate(() => window.applied), 1)
    assert.equal(await page.evaluate(() => window.calls.filter(row => row.kind === 'status').length), 1)
  })
  await test('미확정 할 일 저장은 재진입·날짜 변경 후에도 같은 키와 내용으로 복구한다', async () => {
    await taskReview(); await page.evaluate(() => { window.unknown = true })
    await button('확인한 변경 저장').click(); await button('같은 요청으로 저장 결과 확인').waitFor()
    const first = await page.evaluate(() => window.calls.find(row => row.kind === 'update'))
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.evaluate(() => window.setShow(false)); await input().waitFor({ state: 'detached' })
    await page.evaluate(() => { window.advanceDate(); window.setShow(true) }); await button('같은 요청으로 저장 결과 확인').waitFor()
    assert.equal(await input().isDisabled(), true); assert.equal(await button('확인한 변경 저장').count(), 0)
    await button('같은 요청으로 저장 결과 확인').click(); await card().getByRole('heading', { name: '저장을 확인했습니다' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.filter(row => row.kind === 'update')[1]), first)
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await page.evaluate(() => window.aiCalls), 0)
  })
  await test('검토 뒤 원본이 바뀌면 이전 변경을 덮어쓰지 않고 다시 선택하게 한다', async () => {
    await taskReview(); await page.evaluate(() => { window.task.version++; window.task.notes = '다른 창의 최신 메모' })
    await button('확인한 변경 저장').click()
    await card().getByRole('alert').waitFor()
    assert.match(await card().getByRole('alert').innerText(), /최신 업무를 다시 선택/)
    assert.equal(await page.evaluate(() => window.applied), 0); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await page.evaluate(() => window.task.notes), '다른 창의 최신 메모')
    await card().getByRole('button', { name: '닫기', exact: true }).click(); await card().waitFor({ state: 'detached' })
    assert.equal(await input().isDisabled(), false)
  })
  await test('일정의 빠진 시각을 대화로 채운 뒤 나만 보기 검토와 저장을 마친다', async () => {
    await request('내일 회의 일정 잡아줘', '일정 초안 열기')
    await page.getByRole('region', { name: '작성 중인 일정', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.applied), 0)
    await request('오후 3시부터 4시', '일정 정보 이어 입력')
    await card().getByRole('heading', { name: '새 일정을 검토해 주세요' }).waitFor()
    assert.match(await card().innerText(), /회의[\s\S]*나만 보기[\s\S]*2026-11-12[\s\S]*15:00–16:00/)
    assert.equal(await page.evaluate(() => window.applied), 0)
    await capture('assistant-calendar-operation-review')
    await button('확인한 일정 등록').click(); await card().getByRole('heading', { name: '저장을 확인했습니다' }).waitFor()
    const command = await page.evaluate(() => window.calls.find(row => row.kind === 'calendar').command)
    assert.equal(command.draft.visibility, 'private'); assert.deepEqual(command.draft.audience.includeMemberIds, ['member-one'])
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.aiCalls), 0)
    assert.equal(await page.getByRole('region', { name: '작성 중인 일정', exact: true }).count(), 0)
  })
  await test('일정 응답이 유실되면 원래 요청을 보존하고 중복 일정을 만들지 않는다', async () => {
    await request('내일 오후 3시부터 4시까지 회의 일정 초안 만들어줘', '일정 초안 열기')
    await card().getByRole('heading', { name: '새 일정을 검토해 주세요' }).waitFor()
    await page.evaluate(() => { window.unknown = true }); await button('확인한 일정 등록').click()
    await button('같은 요청으로 저장 결과 확인').waitFor()
    const first = await page.evaluate(() => window.calls.find(row => row.kind === 'calendar'))
    await page.evaluate(() => window.setShow(false)); await input().waitFor({ state: 'detached' })
    await page.evaluate(() => window.setShow(true)); await button('같은 요청으로 저장 결과 확인').waitFor()
    await button('같은 요청으로 저장 결과 확인').click(); await card().getByRole('heading', { name: '저장을 확인했습니다' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.filter(row => row.kind === 'calendar')[1]), first)
    assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await test('확인 전 취소는 저장하지 않고 새 작업을 입력할 수 있게 한다', async () => {
    await taskReview(); await card().getByRole('button', { name: '취소', exact: true }).click()
    await card().waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => window.applied), 0)
    assert.equal(await input().isDisabled(), false); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await test('저장 직전 조회 중 계정을 바꾸면 이전 계정의 변경을 실행하지 않는다', async () => {
    await taskReview(); await page.evaluate(() => { window.deferGet = true }); await button('확인한 변경 저장').click()
    await page.waitForFunction(() => typeof window.releaseGet === 'function')
    await page.evaluate(() => window.switchAccount()); await card().waitFor({ state: 'detached' })
    await page.evaluate(() => window.releaseGet()); await settle()
    assert.equal(await page.evaluate(() => window.applied), 0); assert.equal(await page.evaluate(() => window.calls.filter(row => row.kind === 'update').length), 0)
    assert.equal(await page.getByText('기존 메모', { exact: true }).count(), 0)
  })
  await test('작은 화면과 큰 글씨에서도 검토 카드·버튼이 가로로 넘치지 않는다', async () => {
    await taskReview(); await page.setViewportSize({ width: 320, height: 840 })
    await page.addStyleTag({ content: ':root{--ui-body-size:28px;--ui-small-size:24px}' }); await settle()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    assert.equal(await card().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    assert.equal(await card().getByRole('button', { name: '확인한 변경 저장' }).isVisible(), true)
    assert.equal(await card().locator('.workspace-operation-note').evaluate(el => getComputedStyle(el).fontSize), '24px')
    await capture('assistant-operation-mobile')
  })
  await test('어두운 테마와 큰 글씨의 기존 디자인 설정을 검토 카드에도 반영한다', async () => {
    await taskReview(); await page.addStyleTag({ content: shellStyles })
    await page.locator('#root').evaluate(el => { el.classList.add('ws-shell'); el.dataset.theme = 'dark'; el.dataset.textSize = 'large' })
    const palette = await card().evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, size: getComputedStyle(el).fontSize }))
    assert.deepEqual(palette, { color: 'rgb(231, 237, 246)', background: 'rgb(28, 36, 48)', size: '17px' })
    const primary = await card().getByRole('button', { name: '확인한 변경 저장' }).evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, size: getComputedStyle(el).fontSize }))
    assert.deepEqual(primary, { color: 'rgb(23, 39, 67)', background: 'rgb(154, 191, 255)', size: '15px' })
    await capture('assistant-operation-dark')
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`대화 공통 실행 브라우저 ${results.length}개 통과 · 외부 호출 0건`)
} finally {
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'results.json'), JSON.stringify({ results, errors, external }, null, 2)) }
  await browser.close()
}
