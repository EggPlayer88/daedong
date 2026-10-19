import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-exchanges-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const font = readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64')
const html = `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:45 920}body{font-family:Pretendard,sans-serif;margin:0;padding:16px}*{box-sizing:border-box}</style><div id="root"></div></html>`
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), passed = [], errors = [], external = []
page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:5187/')) external.push(r.url()) })
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }))
const inbox = () => page.getByRole('region', { name: '관련 변경 요청', exact: true })
const confirm = () => page.getByRole('region', { name: '변경 요청 응답 확인', exact: true })
async function start() {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5187/exchange-inbox'); await page.addScriptTag({ content: bundle }); await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor(); await page.getByRole('button', { name: /^교환·변경 요청/ }).click(); await page.getByLabel('변경 요청 사유', { exact: true }).waitFor()
  await page.evaluate(() => {
    const copy = value => structuredClone(value)
    window.addRequest('incoming'); const incoming = { ...copy(window.view.requests[0]), id: 'incoming', reason: '교내 연수 A' }
    window.addRequest('manager'); const approval = { ...copy(window.view.requests[0]), id: 'approval', reason: '출장 B' }
    window.addRequest('own'); const own = { ...copy(window.view.requests[0]), id: 'own', reason: '내 요청 C' }
    const done = { ...copy(approval), id: 'done', state: 'applied', actions: [], reason: '완료 D' }
    const waiting = { ...copy(incoming), id: 'waiting', actions: [], reason: '다른 응답 대기 E' }
    window.view.requests = [done, waiting, own, approval, incoming]; window.refresh()
  })
  await inbox().getByText('전체 요청 5건 · 전체 5건', { exact: true }).waitFor()
}
async function check(name, run) { await start(); await run(); passed.push(name); console.log('  ✓ ' + name) }
const cards = () => inbox().locator('article.timetable-exchange-request')
try {
  await check('내 동의·담당자 승인·보낸 요청을 나누고 새 요청 입력을 유지한다', async () => {
    const range = await page.evaluate(() => { const call = window.calls.filter(row => row.name.endsWith('_get')).at(-1).args; return { from: call.p_from, last: new Date(Date.parse(call.p_until) - 86400000).toISOString().slice(0, 10) } })
    assert.match(await inbox().innerText(), new RegExp(`${range.from} ~ ${range.last}`))
    await page.getByLabel('변경 요청 사유', { exact: true }).fill('작성 중인 입력')
    for (const [label, reason] of [['내 동의 1건 보기', '교내 연수 A'], ['내 승인 1건 보기', '출장 B'], ['내 요청 1건 보기', '내 요청 C']]) {
      await inbox().getByRole('button', { name: label, exact: true }).click(); assert.equal(await cards().count(), 1); assert.match(await cards().innerText(), new RegExp(reason))
    }
    assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '작성 중인 입력'); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  })
  await check('여러 검색어로 교사·수업·사유를 찾고 검색 없음과 요청 없음 안내를 구분한다', async () => {
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('상대 교사 국어 연수'); assert.equal(await cards().count(), 1)
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('없는 요청'); await inbox().getByText('검색 조건에 맞는 요청이 없습니다. 검색어를 줄이거나 검색·필터를 초기화해 주세요.', { exact: true }).waitFor()
    await inbox().getByRole('button', { name: '검색·필터 초기화', exact: true }).click(); assert.equal(await cards().count(), 5)
    await page.evaluate(() => { window.view.requests = []; window.refresh() }); await inbox().getByText('현재 조회 기간에 확인할 변경 요청이 없습니다. 다른 기간의 요청은 조회 기간을 바꿔 확인해 주세요.', { exact: true }).waitFor()
  })
  await check('검색과 필터를 바꿔도 확인 중인 요청·동의 체크·원래 명령을 보존한다', async () => {
    const incoming = cards().filter({ hasText: '교내 연수 A' }), finished = cards().filter({ hasText: '완료 D' })
    assert.equal(await finished.locator('details').getAttribute('open'), null)
    await incoming.locator('summary').click(); assert.equal(await incoming.locator('details').getAttribute('open'), null)
    await inbox().getByRole('button', { name: '변경안에 동의', exact: true }).click(); await confirm().getByRole('checkbox').check()
    assert.notEqual(await incoming.locator('details').getAttribute('open'), null)
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('검색 결과 없음'); await page.getByLabel('요청 상태로 보기', { exact: true }).selectOption('finished')
    assert.equal(await confirm().getByRole('checkbox').isChecked(), true); assert.equal(await cards().count(), 1); await inbox().getByText(/확인 중인 요청은 검색·필터와 관계없이/).waitFor()
    await confirm().getByRole('button', { name: '확인한 응답 보내기', exact: true }).click(); await page.waitForFunction(() => window.actualWrites === 1 && window.pending.count() === 0)
    const call = await page.evaluate(() => window.calls.find(row => row.name.endsWith('_execute')).args.p_command)
    assert.deepEqual(call, { kind: 'action', requestId: 'incoming', expectedVersion: 1, proposalHash: 'a'.repeat(64), action: 'accept' })
    assert.equal(await page.evaluate(() => JSON.stringify(window.view.lessons) === JSON.stringify(window.originalLessons)), true)
  })
  await check('필터 밖에 유지한 요청도 서버 판이 바뀌면 이전 확인을 취소한다', async () => {
    await inbox().getByRole('button', { name: '변경안에 동의', exact: true }).click(); await confirm().getByRole('checkbox').check(); await page.getByLabel('변경 요청 검색', { exact: true }).fill('완료 D')
    await page.evaluate(() => { window.view.requests.find(row => row.id === 'incoming').version++; window.refresh() }); await confirm().waitFor({ state: 'detached' })
    assert.equal(await cards().count(), 1); assert.match(await cards().innerText(), /완료 D/); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  })
  await check('시간이 지나면 할 일 건수를 줄이고 확인 중인 만료 요청은 비활성으로 보존한다', async () => {
    await inbox().getByRole('button', { name: '내 동의 1건 보기', exact: true }).click(); await inbox().getByRole('button', { name: '변경안에 동의', exact: true }).click(); await confirm().getByRole('checkbox').check()
    await page.evaluate(() => { const later = Date.now() + 600001; Date.now = () => later }); await inbox().getByRole('button', { name: '내 동의 0건 보기', exact: true }).waitFor(); await inbox().getByRole('button', { name: '내 승인 0건 보기', exact: true }).waitFor()
    assert.equal(await confirm().getByRole('button', { name: '확인한 응답 보내기', exact: true }).isDisabled(), true); await inbox().getByText('응답 기한이 지났습니다. 요청 상태를 새로 확인해 주세요.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  })
  await check('다음 페이지에서 고른 요청도 검색을 지운 뒤 숨기지 않는다', async () => {
    await page.evaluate(() => { const incoming = window.view.requests.find(row => row.id === 'incoming'); window.view.requests = Array.from({ length: 25 }, (_, index) => ({ ...structuredClone(incoming), id: 'req-' + String(index).padStart(2, '0'), reason: '요청번호 ' + String(index).padStart(2, '0') })); window.refresh() })
    await inbox().getByText('전체 요청 25건 · 전체 25건', { exact: true }).waitFor(); assert.equal(await cards().count(), 20)
    await page.getByLabel('변경 요청 검색', { exact: true }).fill('요청번호 24'); await inbox().getByRole('button', { name: '변경안에 동의', exact: true }).click(); await page.getByLabel('변경 요청 검색', { exact: true }).fill('')
    assert.equal(await cards().count(), 21); assert.match(await cards().first().innerText(), /요청번호 24/); await confirm().getByRole('button', { name: '응답 확인 닫기', exact: true }).click(); assert.equal(await cards().count(), 20)
    await inbox().getByRole('button', { name: /변경 요청 20건 더 보기/ }).click(); assert.equal(await cards().count(), 25)
  })
  await check('결과 미상 복구가 검색 중에도 원래 요청 번호와 명령을 재사용한다', async () => {
    await inbox().getByRole('button', { name: '변경안에 동의', exact: true }).click(); await confirm().getByRole('checkbox').check(); await page.getByLabel('변경 요청 검색', { exact: true }).fill('완료 D'); await page.evaluate(() => window.failOnce = true)
    await confirm().getByRole('button', { name: '확인한 응답 보내기', exact: true }).click(); await page.getByRole('button', { name: '원래 요청 결과만 다시 확인', exact: true }).click(); await page.waitForFunction(() => window.pending.count() === 0)
    const calls = await page.evaluate(() => window.calls.filter(row => row.name.endsWith('_execute')))
    assert.equal(calls.length, 2); assert.equal(calls[1].args.p_recover_only, true); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command); assert.equal(await page.evaluate(() => window.actualWrites), 1)
  })
  await check('320px·큰 글씨에서도 검색과 상태 요약이 넘치지 않으며 키보드로 필터를 초기화한다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%'); await page.getByLabel('변경 요청 검색', { exact: true }).fill('없는 검색')
    const reset = inbox().getByRole('button', { name: '검색·필터 초기화', exact: true }); await reset.focus(); await page.keyboard.press('Enter'); assert.equal(await cards().count(), 5)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 })
    if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'exchange-inbox-320-large.png'), fullPage: true }); await page.evaluate(() => document.documentElement.style.fontSize = ''); await page.setViewportSize({ width: 1280, height: 900 }); await inbox().screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'exchange-inbox-1280.png') }) }
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'exchange-inbox-results.json'), JSON.stringify({ passed, errors, external }, null, 2)) }
  console.log('시간표 변경 요청 목록 브라우저 검사: ' + passed.length + '개 통과')
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
