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
const makeupSummary = () => page.getByRole('region', { name: '시간표 확인할 일', exact: true })
const makeupOpen = () => makeupSummary().getByRole('button', { name: /홈에서 선택한 과학 수업 보강/ })
const intervention = () => page.getByRole('region', { name: '대강·휴강·보강', exact: true })
async function go(name) { await page.getByRole('navigation', { name: '신축 업무 메뉴', exact: true }).getByRole('button', { name, exact: true }).click() }
async function boot(options = {}) { await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('http://127.0.0.1:5187/home'); await page.evaluate(value => window.notificationFixtureOptions = value, options); await page.addScriptTag({ content: bundle }); await page.getByRole('region', { name: '내 수업', exact: true }).getByRole('button', { name: /가온 원본 수업/ }).waitFor(); if (options.t3) { await makeupOpen().waitFor(); return } await go('메시지와 알림'); await page.getByRole('group', { name: '메시지 분류' }).getByRole('button', { name: '업무 알림', exact: true }).click(); await sourceButton().waitFor() }
async function check(name, run, options = {}) { await boot(options); try { await run() } catch (error) { console.error(await page.getByRole('main').allInnerTexts()); console.error({ errors, external }); console.error(await page.evaluate(() => window.state.calls)); throw error } passed.push(name); console.log('  ✓ ' + name) }
async function selectedMakeup() {
  await intervention().getByLabel('처리할 일', { exact: true }).locator('option[value="makeup"]:checked').waitFor({ state: 'attached' })
  assert.equal(await intervention().getByLabel('대상 수업', { exact: true }).inputValue(), await page.evaluate(() => 'gaon-soyeon-' + window.state.selectedDate))
}
async function noAutomaticWrite() {
  assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  assert.equal(await page.evaluate(() => window.state.calls.filter(call => /_(preview|recommend|start|execute|mutate|close)$/.test(call.name)).length), 0)
}
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
  await check('홈 보강 요약은 선택한 날짜의 정확한 취소 수업을 열고 자동 전송 없이 홈으로 돌아간다', async () => {
    await makeupOpen().click(); await selectedMakeup()
    assert.equal(await page.getByRole('button', { name: /^교환·변경 요청/ }).getAttribute('aria-pressed'), 'true')
    assert.equal(await intervention().getByLabel('변경 사유', { exact: true }).inputValue(), '')
    assert.equal(await intervention().getByLabel('보강 시작 시각', { exact: true }).inputValue(), '')
    const state = await page.evaluate(() => ({ date: window.state.selectedDate, calls: window.state.calls.filter(call => call.name === 'workhub_timetable_interventions_get') }))
    assert.ok(state.calls.length > 0); assert.ok(state.calls.every(call => call.args.p_member_id === 'gaon-soyeon' && call.args.p_from <= state.date && call.args.p_until > state.date))
    await intervention().getByText('학교 행사에 따른 개별 휴강', { exact: true }).waitFor()
    await noAutomaticWrite()
    await page.getByRole('button', { name: '홈으로 돌아가기', exact: true }).click(); await makeupOpen().waitFor()
    await makeupOpen().click(); await selectedMakeup(); await noAutomaticWrite()
  }, { t3: true })
  await check('홈에서 보강 입력 후 복귀가 잠기고 재조회에도 입력을 지키며 명시 취소 뒤 복귀한다', async () => {
    await makeupOpen().click(); await selectedMakeup()
    const reason = '홈에서 연결한 보강의 작성 중 사유', start = await page.evaluate(() => window.state.selectedDate + 'T13:00')
    await intervention().getByLabel('변경 사유', { exact: true }).fill(reason)
    await intervention().getByLabel('보강 시작 시각', { exact: true }).fill(start)
    await intervention().getByRole('button', { name: '원수업 길이로 종료 시각 맞추기', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '홈으로 돌아가기', exact: true }).isDisabled(), true)
    await intervention().getByRole('button', { name: '최신 요청 확인', exact: true }).click()
    await intervention().getByText('현재 수업과 요청을 확인하고 있습니다.', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await intervention().getByLabel('변경 사유', { exact: true }).inputValue(), reason)
    assert.equal(await intervention().getByLabel('보강 시작 시각', { exact: true }).inputValue(), start)
    assert.equal(await intervention().getByLabel('보강 종료 시각', { exact: true }).inputValue(), start.slice(0, -5) + '13:45')
    await noAutomaticWrite()
    await intervention().getByRole('button', { name: '입력 취소', exact: true }).click()
    await page.getByRole('button', { name: '홈으로 돌아가기', exact: true }).click(); await makeupOpen().waitFor()
  }, { t3: true })
  await check('홈 보강의 원수업이 사라지면 다른 취소 수업으로 대체하지 않고 안내 후 복귀한다', async () => {
    await makeupOpen().click()
    await page.getByRole('region', { name: '홈에서 연 보강 입력', exact: true }).getByText('현재 조회에서 취소된 원수업을 확인하지 못했습니다. 입력을 바꾸지 않았으니 최신 요청을 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await intervention().getByLabel('처리할 일', { exact: true }).inputValue(), 'substitute')
    assert.equal(await page.getByRole('button', { name: '선택한 보강 입력으로 이동', exact: true }).isDisabled(), true)
    await noAutomaticWrite()
    await page.getByRole('button', { name: '기존 입력 계속 작성', exact: true }).click()
    await page.getByRole('button', { name: '홈으로 돌아가기', exact: true }).click(); await makeupOpen().waitFor()
  }, { t3: true, omitMakeup: true })
  await check('메시지 보관 입력은 홈→보강→홈 왕복 후 그대로 남고 모바일 키보드로 복귀한다', async () => {
    await go('메시지와 알림')
    await page.getByRole('button', { name: '새 메시지', exact: true }).click(); await page.getByLabel('메시지', { exact: true }).fill('보강을 확인한 뒤 이어 쓸 메시지')
    await page.getByRole('button', { name: '입력 접고 목록 보기', exact: true }).click()
    await go('오늘'); await makeupOpen().click(); await selectedMakeup()
    await page.setViewportSize({ width: 320, height: 760 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.getByRole('button', { name: '홈으로 돌아가기', exact: true }).focus(); await page.keyboard.press('Enter'); await makeupOpen().waitFor()
    await page.setViewportSize({ width: 1280, height: 1000 })
    await go('메시지와 알림'); await page.getByRole('button', { name: '작성 계속하기', exact: true }).click()
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '보강을 확인한 뒤 이어 쓸 메시지')
    await noAutomaticWrite()
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 })
  }, { t3: true })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'timetable-notification-results.json'), JSON.stringify({ passed, errors, external, scope: '실제 연결 셸·메신저·시간표 어댑터, 합성 RPC' }, null, 2)) }
  console.log('시간표 알림 실제 화면 연결 검사: ' + passed.length + '개 통과')
} finally { await browser.close() }
