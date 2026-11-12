import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-plan-publication-connected-fixture.tsx', import.meta.url))], bundle: true, write: false,
  format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const origin = 'http://127.0.0.1:5301/', errors = [], external = []
let passed = 0
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept())
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const plan = () => page.getByRole('region', { name: '나누어 진행할 업무', exact: true })
const writes = () => page.evaluate(() => window.qa.calls.filter(row => /_execute$/.test(row.name)))
async function begin() {
  await field('질문 또는 부탁할 일').fill('1. 시간표 공개 준비해줘\n2. 문서함 열어줘'); await button('업무 나누기').click(); await plan().waitFor()
  await plan().getByRole('button', { name: /^1단계 선택/ }).click(); await button('업무 시작').click(); await field('확정할 저장 초안').waitFor()
}
async function ready(kind) {
  await field('확정할 저장 초안').selectOption('draft-one@2'); await field('적용 시작일').fill('2026-11-13'); await field('적용 마지막 날').fill('2026-11-13')
  if (kind === 'publish') { await button('적용 전 변경 영향 확인').click(); await button('확인한 시간표 확정').waitFor() }
  else {
    const details = page.getByText('학기 전체 시간표 확인·확정', { exact: true }); if (!(await details.evaluate(node => node.parentElement.open))) await details.click()
    await button('전체 변경 목록 확인').click(); await button('전체 변경 자동 검증').click(); await page.getByText('전체 검증 완료 · 1/1쪽 · 3/3건', { exact: true }).waitFor()
  }
}
async function confirm(kind) {
  await field(kind === 'publish' ? '적용 기간과 변경 수업을 확인했으며, 학교 시간표로 확정합니다.' : '전체 변경 3건과 적용 기간을 확인했으며 학교 시간표로 확정합니다.').check()
  await button(kind === 'publish' ? '확인한 시간표 확정' : '검증한 학기 시간표 확정').click()
}
async function saved(kind) { await page.getByText(kind === 'publish' ? '학교 시간표 1판을 확정했습니다. 공유 화면에서 적용 기간을 확인할 수 있습니다.' : '전체 기간의 시간표 4판을 확정했습니다. 변경 수업 3건을 공유 화면에서 확인할 수 있습니다.', { exact: true }).waitFor() }
async function talk() { await button('대화 보기').click(); await plan().waitFor() }
function expected(kind) { return kind === 'publish' ? /시간표 공개 · 수업 2건 반영/ : /시간표 공개 · 수업 3건 반영/ }
async function test(name, run) {
  await page.goto(origin); await page.clock.setFixedTime(new Date('2026-11-12T03:00:00.000Z')); await page.addScriptTag({ content: bundle })
  await button('AI 비서').first().click(); await field('질문 또는 부탁할 일').waitFor()
  try {
    await run(); assert.deepEqual(errors, []); assert.deepEqual(external, [])
    assert.equal(await page.evaluate(() => window.qa.calls.filter(row => /assistant.*(execute|generate|chat)|ai.*(generate|chat)/.test(row.name)).length), 0)
    passed++; console.log('  ✓ ' + name)
  }
  catch (error) { console.error(await page.locator('.workhub-connected').innerText()); throw error }
}
try {
  for (const kind of ['publish', 'publish_manifest']) {
    await test(kind + ' 계획의 공개 전문 단계에서 확인한 접수가 AI 업무 목록으로 돌아온다', async () => {
      await begin(); await ready(kind); assert.equal((await writes()).length, 0); assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0)
      await confirm(kind); await saved(kind); await talk(); assert.match(await plan().innerText(), expected(kind)); assert.equal(await plan().locator('[data-outcome="recorded"]').count(), 1)
      assert.doesNotMatch(await plan().innerText(), /목록에 복제하지 않을 수업|합성 학급/); assert.equal(await page.evaluate(() => window.qa.writes), 1)
      assert.equal(await plan().getByRole('button', { name: /^2단계 선택/ }).isEnabled(), true)
    })
    await test(kind + ' 응답 유실은 공개 완료로 표시하지 않고 같은 원키 복구 뒤 한 번만 기록한다', async () => {
      await begin(); await ready(kind); await page.evaluate(() => { window.qa.unknown = true }); await confirm(kind)
      await button('원래 요청 결과만 다시 확인').waitFor(); assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0)
      await button('원래 요청 결과만 다시 확인').click(); await saved(kind); await talk(); assert.match(await plan().innerText(), expected(kind))
      assert.equal(await plan().getByText(/이전 처리/).count(), 0); assert.equal(await page.evaluate(() => window.qa.writes), 1)
      const calls = await writes(); assert.equal(calls.length, 2); assert.equal(calls[1].args.p_recover_only, true); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command)
    })
    await test(kind + ' 같은 전문 패널에서 공개한 다른 확정본은 첫 단계 결과에 섞이지 않는다', async () => {
      await begin(); await ready(kind); await confirm(kind); await saved(kind); await talk(); assert.match(await plan().innerText(), expected(kind))
      await button('작성하던 업무 보기').click(); await ready(kind); await confirm(kind); await page.waitForFunction(() => window.qa.writes === 2); await saved(kind); await talk()
      assert.match(await plan().innerText(), expected(kind)); assert.equal(await plan().locator('[data-outcome="recorded"]').count(), 1); assert.equal(await plan().getByText(/이전 처리/).count(), 0)
      const calls = await writes(); assert.equal(calls.length, 2); assert.notEqual(calls[0].args.p_request_key, calls[1].args.p_request_key)
    })
    await test(kind + ' 거절된 공개는 계획 결과가 되지 않으며 재검토 뒤 접수만 기록한다', async () => {
      await begin(); await ready(kind); await page.evaluate(() => { window.qa.reject = true }); await confirm(kind)
      await page.waitForFunction(() => window.qa.rejections === 1); await field('확정할 저장 초안').and(page.locator(':enabled')).waitFor()
      assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0); assert.equal(await page.evaluate(() => window.qa.writes), 0)
      await page.evaluate(() => { window.qa.reject = false }); await ready(kind); await confirm(kind); await saved(kind); await talk(); assert.match(await plan().innerText(), expected(kind)); assert.equal(await page.evaluate(() => window.qa.writes), 1)
    })
    await test(kind + ' 손상된 공개 접수는 검증된 원키 재조회 전 업무 완료가 아니다', async () => {
      await begin(); await ready(kind); await page.evaluate(() => { window.qa.badReceipt = true }); await confirm(kind); await button('원래 요청 결과만 다시 확인').waitFor()
      assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0); await page.evaluate(() => { window.qa.badReceipt = false })
      await button('원래 요청 결과만 다시 확인').click(); await saved(kind); await talk(); assert.match(await plan().innerText(), expected(kind)); assert.equal(await page.evaluate(() => window.qa.writes), 1)
    })
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  assert.equal(await page.evaluate(() => window.qa.calls.filter(row => /assistant.*(execute|generate|chat)|ai.*(generate|chat)/.test(row.name)).length), 0)
  console.log(`실제 연결 셸 시간표 공개 결과 ${passed}건 통과 · 합성 RPC·외부 및 유료 호출 0`)
} finally { await browser.close() }
