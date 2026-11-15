import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-assistant-daily-connected-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 950 } }), page = await context.newPage()
const errors = [], external = []
const previewFont = process.env.WORKHUB_QA_OUTPUT ? readFileSync(fileURLToPath(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url))).toString('base64') : null
let passed = 0
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5283/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const input = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
async function openAssistant() { await button('AI 비서').first().click(); await input().and(page.locator(':enabled')).waitFor() }
async function command(text) { await input().fill(text); await button('확인하기').click() }
async function single(selector) { assert.equal(new URL(page.url()).searchParams.get('view'), 'assistant'); assert.equal(await page.locator('.assistant-delivery-work ' + selector).count(), 1); assert.equal(await page.locator(selector).count(), 1) }
async function noWrites() { assert.equal(await page.evaluate(() => window.dailyConnected.calls.some(call => /_mutate$|_save$|_prepare$|_commit$|_confirm|_ask$/.test(call.name))), false); assert.deepEqual(await page.evaluate(() => window.dailyConnected.notices.map(item => item.readAt)), [null, null, null]) }
async function test(name, run) {
  await page.setViewportSize({ width: 1280, height: 950 }); await page.goto('http://127.0.0.1:5283/daily-connected')
  if (previewFont) await page.evaluate(async bytes => { const font = new FontFace('Pretendard Variable', `url(data:font/woff2;base64,${bytes})`, { weight: '100 900' }); document.fonts.add(await font.load()) }, previewFont)
  await page.addScriptTag({ content: bundle })
  await button('업무 찾기').waitFor()
  try { await run(); await noWrites(); assert.deepEqual(errors, []); passed++; console.log('  ✓ ' + name) }
  catch (error) { console.error(await page.locator('.workhub-connected').innerText()); throw error }
}
async function screenshot(name) { const output = process.env.WORKHUB_QA_OUTPUT; if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, name), fullPage: true }) } }
async function inbox() { await openAssistant(); await command('업무 알림 보여줘'); await page.getByRole('region', { name: '내 업무 알림', exact: true }).getByRole('heading', { name: '2학년 업무 확인', exact: true }).waitFor(); await single('.messaging-workspace') }
try {
  await test('오늘 업무 요약 대화가 실제 연결 패널과 기존 원본 할 일로 이어지고 일반 메뉴는 유지', async () => {
    await openAssistant(); await command('오늘 업무 요약해줘')
    const daily = page.getByRole('region', { name: '대화에서 오늘 업무 확인', exact: true })
    await daily.getByRole('button', { name: '제출 자료 확인 · 할 일 v2 열기', exact: true }).waitFor()
    await daily.getByText('2026-10-21 쌀밥\n미역국', { exact: true }).waitFor()
    await single('.assistant-daily'); await screenshot('assistant-daily-connected.png')
    await daily.getByRole('button', { name: '제출 자료 확인 · 할 일 v4 열기', exact: true }).click()
    const selected = page.locator('.task-card-highlighted[data-task-id="task-b"]')
    await selected.getByText('2학년 원본 업무', { exact: true }).waitFor()
    assert(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_task_get' && call.args.p_task_id === 'task-b')))
    await single('.task-panel')
    await button('작업 마치기').click(); await button('홈').first().click()
    assert.equal(new URL(page.url()).searchParams.get('view') ?? 'home', 'home')
    await page.getByRole('heading', { name: '오늘의 급식', exact: true }).waitFor()
  })
  await test('내일 급식 명령은 학교 기준일 다음 날을 골라 기존 급식 조회만 수행', async () => {
    await openAssistant(); await command('내일 급식 알려줘')
    const daily = page.getByRole('region', { name: '대화에서 급식 확인', exact: true })
    await daily.getByText('2026-10-22 쌀밥\n미역국', { exact: true }).waitFor()
    assert.equal(await daily.getByLabel('급식 날짜', { exact: true }).inputValue(), '2026-10-22')
    assert.equal(await daily.getByText('2026-10-21 쌀밥\n미역국', { exact: true }).count(), 0)
    await single('.assistant-daily')
    const calls = await page.evaluate(() => window.dailyConnected.calls.filter(call => call.name === 'workhub_neis_status'))
    assert(calls.length > 0); assert(calls.every(call => call.args.p_member_id === 'member-01' && call.args.p_kind === 'meals'))
  })
  await test('오늘 업무의 안 읽은 대화 전체목록은 AI 안 기존 목록을 열며 특정 대화를 자동 열지 않음', async () => {
    await openAssistant(); await command('오늘 업무 요약해줘')
    const daily = page.getByRole('region', { name: '대화에서 오늘 업무 확인', exact: true })
    await daily.getByRole('button', { name: '안 읽은 대화 1개 · 메시지 목록 열기', exact: true }).click()
    await page.locator('.messaging-workspace').getByText('알림 확인 대화', { exact: true }).waitFor()
    await single('.messaging-workspace')
    assert(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_message_threads')))
    assert.equal(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_message_get')), false)
  })
  await test('업무 알림 대화는 처음부터 알림 목록을 읽고 자동 읽음 없이 정확한 할 일 원본을 연다', async () => {
    await inbox()
    const notice = page.locator('.messaging-notice').filter({ has: page.getByRole('heading', { name: '2학년 업무 확인', exact: true }) })
    assert.equal(await notice.getAttribute('data-read'), 'false')
    await notice.getByRole('button', { name: '업무 원본 열기', exact: true }).click()
    await page.locator('.task-card-highlighted[data-task-id="task-b"]').getByText('2학년 원본 업무', { exact: true }).waitFor()
    await single('.task-panel')
    assert(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_task_get' && call.args.p_task_id === 'task-b')))
  })
  await test('AI 알림 새로고침과 읽지 않은 필터는 실제 조회에 적용하고 다른 탭 목록을 불필요하게 조회하지 않음', async () => {
    await inbox()
    const before = await page.evaluate(() => window.dailyConnected.calls.filter(call => call.name === 'workhub_inbox_list').length)
    await page.getByLabel('읽지 않은 항목만', { exact: true }).check()
    await page.waitForFunction(() => window.dailyConnected.calls.some(call => call.name === 'workhub_inbox_list' && call.args.p_unread_only))
    await button('새로고침').click()
    await page.waitForFunction(before => window.dailyConnected.calls.filter(call => call.name === 'workhub_inbox_list').length >= before + 2, before)
    assert.equal(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_message_threads')), false)
    assert.equal(await page.locator('.messaging-notice[data-read="false"]').count(), 3)
  })
  await test('알림의 일정 원본 ID가 AI 안 일정 상세로 연결되며 자동 저장·읽음 없이 원문과 판을 유지', async () => {
    await inbox()
    const notice = page.locator('.messaging-notice').filter({ has: page.getByRole('heading', { name: '교과 협의 일정 확인', exact: true }) })
    await notice.getByRole('button', { name: '일정 원본 열기', exact: true }).click()
    await page.getByRole('dialog').getByText('대화 알림으로 여는 원본 일정', { exact: true }).waitFor()
    await single('.assistant-calendar-workspace')
    assert(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_calendar_get' && call.args.p_event_id === 'event-a')))
  })
  await test('연결하지 않은 알림 종류는 원본 이동 버튼을 만들지 않고 좁은 화면에서도 지원 원본은 열 수 있다', async () => {
    await inbox(); await page.setViewportSize({ width: 320, height: 850 })
    const unsupported = page.locator('.messaging-notice').filter({ has: page.getByRole('heading', { name: '자료 안내', exact: true }) })
    assert.equal(await unsupported.getByRole('button', { name: /원본 열기/ }).count(), 0)
    const notice = page.locator('.messaging-notice').filter({ has: page.getByRole('heading', { name: '2학년 업무 확인', exact: true }) })
    await notice.getByRole('button', { name: '업무 원본 열기', exact: true }).focus(); await page.keyboard.press('Enter')
    await page.locator('.task-card-highlighted[data-task-id="task-b"]').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  })
  await test('일반 메신저 메뉴에서도 동일 알림 원본을 열고 AI 호출을 추가하지 않음', async () => {
    await page.getByRole('button', { name: '더보기', exact: true }).first().click()
    await page.getByRole('button', { name: /메시지와 알림|메시지/ }).filter({ hasText: '메시지' }).first().click()
    await page.getByRole('button', { name: '업무 알림', exact: true }).click()
    const notice = page.locator('.messaging-notice').filter({ has: page.getByRole('heading', { name: '2학년 업무 확인', exact: true }) })
    await notice.getByRole('button', { name: '업무 원본 열기', exact: true }).click()
    await page.locator('.task-card-highlighted[data-task-id="task-b"]').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('view'), 'tasks')
  })
  assert.deepEqual(external, [])
  console.log(passed + '개 실제 연결 AI 업무·급식·알림 시나리오 통과 · 쓰기·유료 호출 0')
} finally { await browser.close() }
