import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-execution-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), errors = [], external = []
const origin = 'http://127.0.0.1:5305/', button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const plan = () => page.getByRole('region', { name: '나누어 진행할 업무', exact: true }), writes = () => page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_execution_record'))
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept())
await context.route('**/*', route => { if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' }) })
let passed = 0
async function begin(prompt = '날짜별 시간표 보여줘') {
  await field('질문 또는 부탁할 일').fill(`1. ${prompt}\n2. 문서함 열어줘`); await button('업무 나누기').click(); await plan().waitFor(); await plan().getByRole('button', { name: /^1단계 선택/ }).click()
  await button(prompt === '시간표 보여줘' ? '바로 이동' : '업무 시작').click(); await page.locator('.ttboard-lesson').filter({ hasText: '합성 국어' }).click()
  await page.locator('.timetable-execution-records > summary').click(); await button('실시 기록 작성하기').waitFor()
}
async function edit(outcome = 'completed') { await button('실시 기록 작성하기').click(); await field('실시 결과').selectOption(outcome); await field('기록 메모').fill('업무 목록에 옮기지 않을 수업 메모') }
async function save() { await field('선택 수업과 실제 실시 여부를 직접 확인했습니다').check(); await button('확인한 실시 기록 저장').click() }
async function saved() { await button('실시 기록 정정하기').waitFor() }
async function talk() { await button('대화 보기').click(); await plan().waitFor() }
async function test(name, run) {
  try {
    await page.goto(origin + '?connected=1'); await page.clock.setFixedTime(new Date('2026-11-12T03:00:00.000Z')); await page.addScriptTag({ content: bundle }); await button('AI 비서').first().click(); await field('질문 또는 부탁할 일').waitFor()
    await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.evaluate(() => window.calls.filter(row => /assistant.*(execute|generate|chat)|ai.*(generate|chat)/.test(row.name)).length), 0)
    passed++; console.log('  ✓ ' + name)
  } catch (error) { console.error(await page.locator('body').innerText()); console.error('화면 오류', errors); console.error('호출', await page.evaluate(() => window.calls)); throw error }
}
try {
  await test('전문 시간표 단계에서 선택한 수업의 확인 필요 기록을 목록에 정확히 표시한다', async () => {
    await begin(); await edit('needs_review'); assert.equal((await writes()).length, 0); await save(); await saved(); await talk()
    assert.match(await plan().innerText(), /실시 기록 저장 · 확인 필요/); assert.doesNotMatch(await plan().innerText(), /실시 완료|업무 목록에 옮기지 않을 수업 메모/)
    assert.equal(await plan().locator('[data-outcome="recorded"]').count(), 1); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('일반 시간표 메뉴 단계에서도 저장·정정은 같은 기록의 접수 이력으로 남는다', async () => {
    await begin('시간표 보여줘'); await edit(); await save(); await saved(); await talk(); assert.match(await plan().innerText(), /실시 기록 저장 · 실시 완료/)
    await button('작성하던 업무 보기').click(); await button('실시 기록 정정하기').click(); await field('실시 결과').selectOption('not_performed'); await field('정정 사유').fill('업무 목록에 옮기지 않을 정정 이유'); await save(); await saved(); await talk()
    assert.match(await plan().innerText(), /실시 기록 정정 · 미실시/); await plan().getByText('이전 처리 1건', { exact: true }).click(); assert.match(await plan().innerText(), /실시 기록 저장 · 실시 완료/)
    assert.doesNotMatch(await plan().innerText(), /업무 목록에 옮기지 않을/); assert.equal(await page.evaluate(() => window.writes), 2)
  })
  await test('접수 유실은 업무 완료로 추측하지 않고 원키 복구 뒤에만 목록에 남는다', async () => {
    await begin(); await edit(); await page.evaluate(() => { window.dropOnce = true }); await save(); await button('원래 실시 기록 결과 확인').waitFor()
    assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0); await button('원래 실시 기록 결과 확인').click(); await saved(); await talk()
    assert.match(await plan().innerText(), /실시 기록 저장 · 실시 완료/); assert.equal(await plan().getByText(/이전 처리/).count(), 0)
    const calls = await writes(); assert.equal(calls.length, 2); assert.equal(calls[1].args.p_recover_only, true); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('같은 시간표 패널에서 기록한 다른 수업은 첫 단계의 원본 결과에 합치지 않는다', async () => {
    await begin(); await edit(); await save(); await saved(); await talk(); assert.match(await plan().innerText(), /실시 기록 저장 · 실시 완료/)
    await button('작성하던 업무 보기').click(); await page.locator('.ttboard-lesson').filter({ hasText: '합성 영어' }).click(); await button('실시 기록 작성하기').waitFor(); await edit('needs_review'); await save(); await saved(); await talk()
    assert.match(await plan().innerText(), /실시 기록 저장 · 실시 완료/); assert.doesNotMatch(await plan().innerText(), /실시 기록 저장 · 확인 필요/); assert.equal(await plan().getByText(/이전 처리/).count(), 0); assert.equal(await page.evaluate(() => window.writes), 2)
  })
  await test('손상된 실시 접수는 검증된 원본 재조회 전 업무 결과가 아니다', async () => {
    await begin(); await edit(); await page.evaluate(() => { window.badRecord = { lessonId: 'lesson-two' } }); await save(); await button('원래 실시 기록 결과 확인').waitFor()
    assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0); await page.evaluate(() => { window.badRecord = undefined }); await button('원래 실시 기록 결과 확인').click(); await saved(); await talk()
    assert.match(await plan().innerText(), /실시 기록 저장 · 실시 완료/); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  console.log(`실제 AI 연결 셸 실시 기록 결과 ${passed}/${passed} 통과 · 합성 RPC·외부 및 유료 호출 0`)
} finally { await browser.close() }
