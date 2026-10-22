import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-collection-submission-list-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 320, height: 800 } }), page = await context.newPage(), errors = [], external = []
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5179/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' }) : (external.push(route.request().url()), route.abort()))
const bench = () => page.getByRole('region', { name: '제출 현황 찾기', exact: true })
const pages = () => page.getByRole('navigation', { name: '제출 현황 페이지', exact: true })
const unit = n => page.getByRole('article', { name: `${n}번 제출 단위 제출 현황`, exact: true })
const writes = () => page.evaluate(() => window.qa.calls.filter(c => c.name === 'workhub_collection_mutate'))
let count = 0
const output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
async function test(name, run) {
  await page.goto('http://127.0.0.1:5179/collections'); await page.addScriptTag({ content: bundle })
  await page.getByRole('button', { name: /45개 단위 운영 자료/ }).click(); await bench().waitFor()
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); throw error }
  count++; console.log('  ✓ ' + name)
}
async function openReview27() {
  await pages().getByRole('button', { name: '다음', exact: true }).click()
  await unit(27).getByRole('button', { name: '제출물 검토', exact: true }).click()
  await page.getByLabel('검토 의견', { exact: true }).fill('원래 제출에 남기는 검토 의견')
}
try {
  await test('45개 단위를 20·20·5개로 빠짐없이 표시하고 키보드로 페이지를 이동한다', async () => {
    const ids = await bench().locator('[data-collection-unit]').evaluateAll(items => items.map(item => item.dataset.collectionUnit))
    assert.equal(ids.length, 20)
    const next = pages().getByRole('button', { name: '다음', exact: true }); await next.focus(); await page.keyboard.press('Enter')
    ids.push(...await bench().locator('[data-collection-unit]').evaluateAll(items => items.map(item => item.dataset.collectionUnit)))
    await next.click(); ids.push(...await bench().locator('[data-collection-unit]').evaluateAll(items => items.map(item => item.dataset.collectionUnit)))
    assert.deepEqual(ids, Array.from({ length: 45 }, (_, i) => `unit-${i + 1}`)); assert.equal(new Set(ids).size, 45)
    assert.equal(await next.isDisabled(), true); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal((await writes()).length, 0)
  })
  await test('미제출·보완·검토대기·완료 집계는 전체 45개 최신 제출을 기준으로 한다', async () => {
    for (const [label, expected] of [['미제출', 9], ['보완 필요', 9], ['검토 대기', 18], ['완료', 9]]) {
      await bench().getByRole('button', { name: `${label} ${expected}`, exact: true }).click()
      assert.equal(await bench().locator('[data-collection-unit]').count(), expected)
    }
    await bench().getByRole('button', { name: '검토 대기 18', exact: true }).click(); assert.equal(await unit(5).count(), 1)
    assert.match(await unit(5).innerText(), /새 제출의 검토가 끝나기 전에는 완료본 v1이 유지됩니다/)
    assert.equal((await writes()).length, 0)
    if (output) await page.screenshot({ path: join(output, 'collection-submission-list-320.png'), fullPage: true })
  })
  await test('동명 교사 이름은 두 단위를 찾고 소속 번호는 정확한 한 단위를 찾는다', async () => {
    const search = bench().getByLabel('제출 단위·교사 찾기', { exact: true })
    await search.fill('김교사'); assert.equal(await bench().locator('[data-collection-unit]').count(), 2)
    await search.fill('member-27'); assert.equal(await bench().locator('[data-collection-unit]').count(), 1); assert.equal(await unit(27).count(), 1)
    await search.fill('없는 교사'); await bench().getByText('조건에 맞는 제출 단위가 없습니다.', { exact: false }).waitFor()
    await bench().getByRole('button', { name: '검색 조건 초기화', exact: true }).click(); assert.equal(await bench().locator('[data-collection-unit]').count(), 20)
    assert.equal((await writes()).length, 0)
  })
  await test('검토 작성 중 필터와 페이지를 잠그고 배경 재조회 후 해당 단위와 의견을 보존한다', async () => {
    await openReview27(); assert.equal(await bench().getByLabel('제출 단위·교사 찾기').isDisabled(), true)
    assert.equal(await pages().getByRole('button', { name: '다음', exact: true }).isDisabled(), true)
    await page.evaluate(() => window.qa.refresh()); await page.getByLabel('검토 의견', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('검토 의견', { exact: true }).inputValue(), '원래 제출에 남기는 검토 의견')
    assert.equal(await unit(27).count(), 1); assert.equal(await page.evaluate(() => window.qa.locked), true); assert.equal((await writes()).length, 0)
    await page.getByRole('button', { name: '검토 작성 취소', exact: true }).click(); assert.equal(await bench().getByLabel('제출 단위·교사 찾기').isDisabled(), false)
  })
  await test('검토 응답 유실과 화면 재연결 후 동일한 제출·의견·접수 번호로 한 번만 처리한다', async () => {
    await openReview27(); await page.evaluate(() => { window.qa.unknown = true }); await page.getByRole('button', { name: '검토 완료', exact: true }).click()
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).waitFor(); assert.equal(await bench().getByLabel('제출 단위·교사 찾기').isDisabled(), true)
    await page.evaluate(() => window.qa.unmount()); await bench().waitFor({ state: 'detached' }); await page.evaluate(() => window.qa.remount())
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).click(); await page.getByText(/검토 결과를 저장했습니다/).waitFor()
    const calls = await writes(); assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args); assert.equal(calls[1].args.p_command.unitId, 'unit-27'); assert.equal(await page.evaluate(() => window.qa.writes), 1)
    await bench().getByRole('button', { name: '완료 10', exact: true }).click(); assert.equal(await unit(27).count(), 1); assert.equal(await page.evaluate(() => window.qa.pending.count()), 0)
  })
  await test('확정 거절은 검토 의견을 남기고 자동 재전송하지 않으며 취소 후 목록을 다시 찾을 수 있다', async () => {
    await openReview27(); await page.evaluate(() => { window.qa.reject = true }); await page.getByRole('button', { name: '검토 완료', exact: true }).click(); await page.getByText(/서버가 이 작업을 허용하지 않았습니다/).waitFor()
    assert.equal(await page.getByLabel('검토 의견', { exact: true }).inputValue(), '원래 제출에 남기는 검토 의견'); assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.qa.pending.count()), 0)
    await page.getByRole('button', { name: '검토 작성 취소', exact: true }).click(); await bench().getByRole('button', { name: '보완 필요 9', exact: true }).click(); assert.equal(await bench().locator('[data-collection-unit]').count(), 9)
  })
  await test('원본 열람 권한이 없어지면 이전 단위 목록과 검토 입력을 숨긴다', async () => {
    await openReview27(); await page.evaluate(() => { window.qa.denyDetail = true; window.qa.refresh() }); await bench().waitFor({ state: 'detached' })
    assert.equal(await page.getByLabel('검토 의견', { exact: true }).count(), 0); assert.equal(await unit(27).count(), 0); assert.equal((await writes()).length, 0)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); if (output) writeFileSync(join(output, 'collection-submission-list-results.json'), JSON.stringify({ passed: count, errors, external }, null, 2)); console.log(`수합 제출 단위 찾기 브라우저 ${count}건 통과 · 실제 RPC/외부 접속 0`)
} finally { await context.close(); await browser.close() }
