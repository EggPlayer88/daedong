import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-assistant-lessons-connected-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 950 } }), page = await context.newPage()
const errors = [], external = []
const previewFont = process.env.WORKHUB_QA_OUTPUT ? readFileSync(fileURLToPath(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url))).toString('base64') : null
let passed = 0
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5285/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
async function today() {
  await button('AI 비서').first().click()
  const input = page.getByLabel('질문 또는 부탁할 일', { exact: true })
  await input.and(page.locator(':enabled')).waitFor()
  await input.fill('오늘 업무 요약해줘'); await button('확인하기').click()
  const lessons = page.getByRole('region', { name: '대화에서 오늘 수업', exact: true })
  await lessons.getByRole('button', { name: /정확한 교환 반영 수업/ }).waitFor()
  if (process.env.WORKHUB_QA_OUTPUT) {
    mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
    await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'assistant-today-lessons.png'), fullPage: true })
  }
  return lessons
}
async function board() {
  await page.locator('.assistant-delivery-work .ttboard').waitFor()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'assistant')
  assert.equal(await page.locator('.ttboard').count(), 1)
  assert.equal(await page.locator('.timetable-conversation').getAttribute('data-timetable-presentation'), 'assistant')
  assert.equal(await page.getByLabel('조회 시작일', { exact: true }).inputValue(), '2026-10-21')
  const calls = await page.evaluate(() => window.dailyConnected.calls.filter(call => call.name === 'workhub_timetable_operations_get'))
  assert(calls.some(call => call.args.p_from === '2026-10-21' && call.args.p_until === '2026-10-22'), '오늘 수업을 하루 범위로 읽어야 한다')
  assert(calls.some(call => call.args.p_from === '2026-10-19' && call.args.p_until > '2026-10-21'), '연결한 날짜가 든 주를 읽어야 한다')
  assert(calls.every(call => call.args.p_member_id === 'member-01'))
}
async function test(name, run) {
  await page.goto('http://127.0.0.1:5285/lessons-connected')
  if (previewFont) await page.evaluate(async bytes => { const font = new FontFace('Pretendard Variable', `url(data:font/woff2;base64,${bytes})`, { weight: '100 900' }); document.fonts.add(await font.load()) }, previewFont)
  await page.addScriptTag({ content: bundle }); await button('업무 찾기').waitFor()
  try {
    await run()
    assert.equal(await page.evaluate(() => window.dailyConnected.calls.some(call => /_mutate$|_save$|_prepare$|_commit$|_confirm|_ask$/.test(call.name))), false)
    assert.deepEqual(errors, []); passed++; console.log('  ✓ ' + name)
  } catch (error) { console.error(await page.locator('.workhub-connected').innerText()); throw error }
}
try {
  await test('실제 연결 셸에서 오늘 수업을 열면 AI 안에 정확한 수업 ID·날짜·현재 시각을 전달', async () => {
    const lessons = await today()
    await lessons.getByRole('button', { name: /정확한 교환 반영 수업/ }).click()
    await board()
    const detail = page.getByRole('region', { name: '선택한 수업', exact: true })
    await detail.getByText('정확한 교환 반영 수업', { exact: true }).waitFor()
    assert.match(await detail.innerText(), /09:40/)
    assert.match(await detail.innerText(), /10:25/)
    assert.equal(await detail.getByText('오늘 첫 수업', { exact: true }).count(), 0)
    assert(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_timetable_execution_get' && call.args.p_lesson_id === 'lesson-exchanged')))
  })
  await test('전체 시간표도 학교 기준 날짜를 유지하고 임의의 수업을 자동 선택하지 않음', async () => {
    const lessons = await today()
    await lessons.getByRole('button', { name: '시간표 전체 보기', exact: true }).click()
    await board()
    assert.equal(await page.getByRole('heading', { name: '선택한 수업', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.dailyConnected.calls.some(call => call.name === 'workhub_timetable_execution_get')), false)
    await page.locator('.ttboard').getByRole('button', { name: /정확한 교환 반영 수업/ }).waitFor()
  })
  assert.deepEqual(external, [])
  console.log(passed + '개 실제 연결 AI 오늘 수업→시간표 시나리오 통과 · 쓰기·유료 호출 0')
} finally { await browser.close() }
