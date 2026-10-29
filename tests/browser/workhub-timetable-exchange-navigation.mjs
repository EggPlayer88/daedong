import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-exchange-navigation-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const font = readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64')
const html = `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:45 920}body{font-family:Pretendard,sans-serif;margin:0;padding:16px}*{box-sizing:border-box}</style><div id="root"></div></html>`
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), passed = [], errors = [], external = []
page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:5187/')) external.push(r.url()) })
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }))
const cards = () => page.locator('article.timetable-exchange-request')
const card = id => page.locator(`article[data-request-id="${id}"]`)
const notice = () => page.getByRole('status', { name: '선택한 변경 요청 안내', exact: true })
const confirm = () => page.getByRole('region', { name: '변경 요청 응답 확인', exact: true })
async function start() {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5187/exchange-navigation'); await page.addScriptTag({ content: bundle }); await page.evaluate(() => document.fonts.ready)
  await page.getByLabel('변경 요청 사유', { exact: true }).waitFor()
}
async function check(name, run) { await start(); await run(); passed.push(name); console.log('  ✓ ' + name) }
async function open(id, token) { await page.evaluate(({ id, token }) => window.openRequest(id, token), { id, token }); await notice().waitFor() }
try {
  await check('검색·필터·첫 20건 밖의 알림 요청을 정확히 표시하고 미전송 입력을 유지한다', async () => {
    await page.getByLabel('변경 요청 사유', { exact: true }).fill('작성 중인 사유')
    await page.getByLabel('요청 상태로 보기', { exact: true }).selectOption('finished'); await page.getByLabel('변경 요청 검색', { exact: true }).fill('찾을 수 없는 검색')
    await open('req-24', 1); await card('req-24').waitFor(); assert.equal(await cards().count(), 1)
    assert.equal(await card('req-24').getAttribute('tabindex'), '-1'); assert.equal(await page.evaluate(() => document.activeElement.dataset.requestId), 'req-24')
    assert.notEqual(await card('req-24').locator('details.timetable-exchange-details').getAttribute('open'), null)
    assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '작성 중인 사유')
    assert.equal(await page.getByLabel('요청 상태로 보기', { exact: true }).inputValue(), 'finished')
    assert.equal(await page.evaluate(() => window.consumed), 1); assert.deepEqual(await page.evaluate(() => window.commands), [])
    await page.getByRole('button', { name: '선택한 요청 표시 닫기', exact: true }).click(); assert.equal(await cards().count(), 0)
    assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '작성 중인 사유')
  })
  await check('없는 ID를 다른 요청으로 바꾸지 않고 조회 기간·권한 재확인을 안내한다', async () => {
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('아무것도 없음'); await open('absent-id', 2)
    assert.match(await notice().innerText(), /현재 조회 기간과 권한에서 찾지 못했습니다/); assert.match(await notice().innerText(), /absent-id/)
    assert.equal(await cards().count(), 0); assert.deepEqual(await page.evaluate(() => window.commands), [])
    await page.evaluate(() => { window.view.requests.push({ ...structuredClone(window.view.requests[0]), id: 'absent-id', reason: '나중 조회된 정확한 요청' }); window.refresh() })
    await card('absent-id').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.dataset.requestId), 'absent-id'); assert.equal(await page.evaluate(() => window.consumed), 1)
  })
  await check('응답 확인 중 다른 알림을 열어도 원래 확인과 명령을 바꾸지 않는다', async () => {
    await card('req-00').getByRole('button', { name: '변경안에 동의', exact: true }).click(); await confirm().getByRole('checkbox').check()
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('목록 없음'); await open('req-24', 3)
    assert.equal(await cards().count(), 2); assert.equal(await confirm().getByRole('checkbox').isChecked(), true)
    await confirm().getByRole('button', { name: /^(승인하고 시간표에 반영|확인한 변경에 동의|확인한 요청 철회|확인한 요청 반려)$/ }).click(); await page.waitForFunction(() => window.commands.length === 1)
    assert.deepEqual(await page.evaluate(() => window.commands[0]), { kind: 'action', requestId: 'req-00', expectedVersion: 1, proposalHash: 'a'.repeat(64), action: 'accept' })
    assert.equal(await card('req-24').count(), 1)
  })
  await check('목록을 읽는 동안 알림을 소비하지 않고 완료된 최신 목록에서만 연다', async () => {
    await page.evaluate(() => { window.loading = true; window.refresh(); window.openRequest('req-24', 4) })
    await page.getByText('현재 수업과 요청 권한을 확인하고 있습니다.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.consumed), 0)
    await page.evaluate(() => { window.view.requests = window.view.requests.filter(row => row.id !== 'req-24'); window.loading = false; window.refresh() })
    await notice().waitFor(); assert.match(await notice().innerText(), /찾지 못했습니다/); assert.equal(await card('req-24').count(), 0); assert.equal(await page.evaluate(() => window.consumed), 1)
  })
  await check('결과 미상 잠금 중에는 알림 소비를 미루고 해제 뒤 기존 요청을 읽기만 한다', async () => {
    await page.getByLabel('변경 요청 사유', { exact: true }).fill('보관할 입력')
    await page.evaluate(() => { window.locked = true; window.refresh(); window.openRequest('req-24', 5) })
    await page.waitForFunction(() => document.querySelector('fieldset').disabled); assert.equal(await page.evaluate(() => window.consumed), 0)
    await page.evaluate(() => { window.locked = false; window.refresh() }); await notice().waitFor(); assert.equal(await page.evaluate(() => window.consumed), 1)
    assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '보관할 입력'); assert.deepEqual(await page.evaluate(() => window.commands), [])
  })
  await check('같은 토큰은 다시 소비하지 않고 새 토큰으로 누른 같은 ID는 다시 집중한다', async () => {
    await open('req-24', 6); await page.getByLabel('변경 요청 사유', { exact: true }).focus()
    await page.evaluate(() => window.openRequest('req-24', 6)); assert.equal(await page.evaluate(() => window.consumed), 1)
    assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).evaluate(element => element === document.activeElement), true)
    await open('req-24', 7); await page.waitForFunction(() => window.consumed === 2); assert.equal(await page.evaluate(() => document.activeElement.dataset.requestId), 'req-24')
  })
  await check('열었던 요청이 재조회에서 사라지면 옛 카드·응답을 숨기고 입력은 보존한다', async () => {
    await page.getByLabel('변경 요청 사유', { exact: true }).fill('보존할 초안'); await open('req-24', 8)
    await card('req-24').getByRole('button', { name: '변경안에 동의', exact: true }).click(); await confirm().getByRole('checkbox').check()
    await page.evaluate(() => { window.view.requests = window.view.requests.filter(row => row.id !== 'req-24'); window.refresh() })
    await card('req-24').waitFor({ state: 'detached' }); assert.equal(await confirm().count(), 0); assert.match(await notice().innerText(), /찾지 못했습니다/)
    assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '보존할 초안'); assert.deepEqual(await page.evaluate(() => window.commands), [])
  })
  await check('응답 권한이 없는 대기 요청도 기한 경과를 실시간으로 알리며 서버 상태는 보존한다', async () => {
    await page.evaluate(() => { window.view.requests = [window.view.requests[0]]; window.view.requests[0].actions = []; window.refresh() })
    await cards().getByText('관련 교사 동의 대기', { exact: true }).waitFor()
    await page.evaluate(() => { const later = Date.now() + 600001; Date.now = () => later })
    await cards().getByText('응답 기한 지남 · 상태 확인 필요', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.view.requests[0].state), 'awaiting_consent'); assert.equal(await cards().locator('[data-state="current"]').count(), 0)
  })
  await check('동의·승인·반영 단계를 구별하고 적용 완료만 모든 단계를 완료로 표시한다', async () => {
    assert.equal(await card('req-00').locator('[data-state="complete"]').count(), 1)
    assert.equal(await card('req-00').locator('[aria-current="step"]').innerText(), '관련 교사 동의\n진행 중')
    assert.match(await card('req-00').innerText(), /동의 1\/2명 · 응답 대기 1명/)
    await page.getByLabel('요청 상태로 보기', { exact: true }).selectOption('finished'); await card('req-01').waitFor()
    assert.equal(await card('req-01').locator('[data-state="complete"]').count(), 4)
  })
  await check('추천 결과가 비어도 다음 행동을 안내하며 실제 요청은 보내지 않는다', async () => {
    await page.getByLabel('변경할 내 수업', { exact: true }).selectOption('one'); await page.getByLabel('변경 요청 사유', { exact: true }).fill('연수')
    await page.getByRole('button', { name: '가능한 교환안 추천받기', exact: true }).click(); await page.getByText('검사한 범위에 추천할 후보가 없습니다. 조회 기간이나 공식 허용 시간을 확인하고 직접 상대 수업을 선택할 수 있습니다.', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.commands), []); assert.equal(await page.evaluate(() => window.previewCalls), 0)
  })
  await check('320px·200%에서 정확한 요청·단계 표시가 넘치지 않고 키보드로 표시를 닫는다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%')
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('목록 없음'); await open('req-24', 11)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 })
    if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'exchange-navigation-320-large.png'), fullPage: true }); await page.evaluate(() => document.documentElement.style.fontSize = ''); await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'exchange-navigation-1280.png'), fullPage: true }) }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.body.style.zoom = '2' }); await page.setViewportSize({ width: 640, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    const close = page.getByRole('button', { name: '선택한 요청 표시 닫기', exact: true }); await close.focus(); await page.keyboard.press('Enter'); await notice().waitFor({ state: 'detached' }); assert.equal(await cards().count(), 0)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'exchange-navigation-results.json'), JSON.stringify({ passed, errors, external }, null, 2)) }
  console.log('시간표 교환 정확한 연결 브라우저 검사: ' + passed.length + '개 통과')
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
