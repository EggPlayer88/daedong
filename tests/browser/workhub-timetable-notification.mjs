// 실제 연결 셸·메시지·시간표 어댑터를 합성 RPC로 왕복한다. 운영 DB 호출은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-notification-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), passed = [], errors = [], external = []
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5187/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const notice = () => page.getByRole('region', { name: '내 업무 알림', exact: true }).locator('article').filter({ hasText: '확인할 수업 교환 요청' })
const sourceButton = () => notice().getByRole('button', { name: '시간표 변경 요청 원본 열기', exact: true })
const openedNotice = () => page.getByRole('status', { name: '선택한 변경 요청 안내', exact: true })
const exactCard = () => page.locator('article[data-request-id="request-24"]')
async function go(name) { await page.getByRole('navigation', { name: '신축 업무 메뉴', exact: true }).getByRole('button', { name, exact: true }).click() }
async function boot() { await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('http://127.0.0.1:5187/home'); await page.addScriptTag({ content: bundle }); await page.getByRole('region', { name: '내 수업', exact: true }).getByRole('button', { name: /가온 원본 수업/ }).waitFor(); await go('메시지와 알림'); await page.getByRole('group', { name: '메시지 분류' }).getByRole('button', { name: '업무 알림', exact: true }).click(); await sourceButton().waitFor() }
async function check(name, run) { await boot(); try { await run() } catch (error) { console.error(await page.locator('body').innerText()); console.error(await page.evaluate(() => window.state.calls)); throw error } passed.push(name); console.log('  ✓ ' + name) }
try {
  await check('메시지 알림에서 첫20건 밖의 정확한 요청을 열고 읽음·동의 없이 메시지로 돌아간다', async () => {
    await sourceButton().click(); await exactCard().waitFor(); await openedNotice().waitFor()
    assert.match(await exactCard().innerText(), /정확한 요청 24/); assert.equal(await exactCard().evaluate(element => element === element.getRootNode().activeElement), true)
    assert.equal(await page.getByRole('button', { name: /^교환·변경 요청/ }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('article[data-request-id="notice-distinct-id"]').count(), 0)
    assert.equal(await page.evaluate(() => window.state.writes.length), 0)
    const calls = await page.evaluate(() => window.state.calls.filter(call => call.name === 'workhub_timetable_operations_get'))
    assert.ok(calls.length > 0); assert.ok(calls.every(call => call.args.p_member_id === 'gaon-soyeon'))
    await page.getByRole('button', { name: '메시지·알림으로 돌아가기', exact: true }).click(); await page.getByRole('group', { name: '메시지 분류' }).getByRole('button', { name: '업무 알림', exact: true }).click(); await notice().waitFor()
    assert.equal(await notice().getByRole('button', { name: '읽음으로 표시', exact: true }).count(), 1); assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  })
  await check('알림 원본이 조회 범위에 없으면 다른 요청을 대신 선택하지 않고 복귀한다', async () => {
    await page.evaluate(() => window.state.omitSelected = true); await sourceButton().click(); await openedNotice().waitFor()
    assert.match(await openedNotice().innerText(), /찾지 못했습니다/); assert.match(await openedNotice().innerText(), /request-24/)
    assert.equal(await exactCard().count(), 0); assert.equal(await page.locator('.timetable-exchange-pinned').count(), 0)
    assert.equal(await page.getByRole('region', { name: '변경 요청 응답 확인', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.state.writes.length), 0)
    await page.getByRole('button', { name: '메시지·알림으로 돌아가기', exact: true }).click(); await page.getByRole('heading', { name: '메시지와 알림', exact: true, level: 2 }).waitFor()
  })
  await check('서버가 확인한 교환 원본으로 이동하고 다른 학교·권한 오류에는 종전 ID를 대입하지 않는다', async () => {
    await page.evaluate(() => window.state.resolvedSource = { kind: 'exchange', requestId: 'request-24', schoolDayChangeId: null, date: window.state.basisDate, lessonId: null })
    await sourceButton().click(); await exactCard().waitFor()
    await page.getByRole('button', { name: '메시지·알림으로 돌아가기', exact: true }).click()
    await page.getByRole('group', { name: '메시지 분류' }).getByRole('button', { name: '업무 알림', exact: true }).click()
    await page.evaluate(() => window.state.resolveFailure = 'FORBIDDEN')
    await sourceButton().click(); await page.getByText('알림의 시간표 원본을 확인하지 못했습니다. 다른 요청으로 연결하지 않았습니다.', { exact: false }).waitFor()
    assert.equal(await openedNotice().count(), 0); assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  })
  await check('접어 둔 메시지 초안은 알림→시간표→복귀 뒤 보존되고320px에서 키보드 이동이 된다', async () => {
    await page.getByRole('button', { name: '새 메시지', exact: true }).click(); await page.getByLabel('메시지', { exact: true }).fill('보존할 메시지 초안')
    await page.getByRole('button', { name: '입력 접고 목록 보기', exact: true }).click(); await page.getByRole('group', { name: '메시지 분류' }).getByRole('button', { name: '업무 알림', exact: true }).click()
    await sourceButton().click(); await exactCard().waitFor(); await page.setViewportSize({ width: 320, height: 760 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    const back = page.getByRole('button', { name: '메시지·알림으로 돌아가기', exact: true }); await back.focus(); await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '작성 계속하기', exact: true }).click(); assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '보존할 메시지 초안')
    assert.equal(await page.evaluate(() => window.state.writes.length), 0); assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 })
    if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'timetable-notification-return-320.png'), fullPage: true }) }
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'timetable-notification-results.json'), JSON.stringify({ passed, errors, external, scope: '실제 연결 셸·메신저·시간표 어댑터, 합성 RPC' }, null, 2)) }
  console.log('시간표 알림 실제 화면 연결 검사: ' + passed.length + '개 통과')
} finally { await browser.close() }
