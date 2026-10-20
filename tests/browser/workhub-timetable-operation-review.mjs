import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-operation-review-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], passed = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:sans-serif}*{box-sizing:border-box}</style><div id="root"></div></html>' }))
async function start(mode = 'review') { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5187/review?mode=' + mode); await page.addScriptTag({ content: bundle.outputFiles[0].text }) }
async function check(name, mode, run) { await start(mode); await run(); passed.push(name); console.log('  ✓ ' + name) }
try {
await check('변경 검색은 20건 밖 마지막 수업도 찾고 전체 45건 요약을 유지한다', 'review', async () => {
  await page.getByText('이 목록 45건', { exact: true }).waitFor(); assert.equal(await page.locator('.ttops-changes > li').count(), 20)
  await page.getByText('이 목록에서 변경 수업 찾기', { exact: true }).click(); await page.getByLabel('변경 수업 검색', { exact: true }).fill('３학년 체육')
  await page.getByText('검색 결과 1건 · 현재 1건 표시 / 이 목록 전체 45건', { exact: true }).waitFor(); assert.equal(await page.locator('.ttops-changes > li').count(), 1); await page.getByText('김교사 [other] / 3학년 2반', { exact: true }).waitFor()
  await page.getByRole('button', { name: '변경 목록 검색 초기화', exact: true }).click(); await page.getByRole('button', { name: '변경 수업 20건 더 보기 (20/45)', exact: true }).click(); assert.equal(await page.locator('.ttops-changes > li').count(), 40)
})
await check('종류 검색은 표시만 줄이며 빈 결과와 키보드 초기화를 제공한다', 'review', async () => {
  await page.getByText('이 목록에서 변경 수업 찾기', { exact: true }).click(); await page.getByLabel('변경 종류', { exact: true }).selectOption('cancelled'); await page.getByText('조건에 맞는 변경 수업이 없습니다. 검색을 초기화해 전체 변경을 확인해 주세요.', { exact: true }).waitFor()
  await page.getByRole('button', { name: '변경 목록 검색 초기화', exact: true }).focus(); await page.keyboard.press('Enter'); assert.equal(await page.getByLabel('변경 종류', { exact: true }).inputValue(), 'all'); await page.setViewportSize({ width: 320, height: 740 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'operation-review-320.png') }); await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'operation-review-1280.png') }) }
})
await check('목록이 줄어도 이전 검색을 지우고 새 변경을 확인할 수 있다', 'review', async () => {
  await page.getByText('이 목록에서 변경 수업 찾기', { exact: true }).click(); await page.getByLabel('변경 수업 검색', { exact: true }).fill('체육'); await page.evaluate(() => { window.changes = window.changes.slice(0, 1); window.refresh() }); await page.getByRole('button', { name: '변경 목록 검색 초기화', exact: true }).click(); assert.equal(await page.locator('.ttops-changes > li').count(), 1)
})
await check('저장 초안 연결은 최신 ID와 판만 선택하고 자동 미리보기·확정하지 않는다', 'publish', async () => {
  const select = page.getByLabel('확정할 저장 초안', { exact: true }); await select.waitFor(); await page.waitForFunction(() => document.querySelector('[aria-label="확정할 저장 초안"]')?.value === 'draft-a@2'); assert.equal(await page.getByRole('button', { name: /^시간표 확정/ }).getAttribute('aria-pressed'), 'true'); assert.deepEqual(await page.evaluate(() => window.calls), ['readiness', 'get']); assert.equal(await page.evaluate(() => window.consumed), 1)
  await page.getByRole('button', { name: '확정 입력 정리', exact: true }).click(); await page.getByRole('button', { name: '확정 입력 비우기', exact: true }).click(); assert.equal(await select.inputValue(), ''); await page.evaluate(() => window.refresh()); await select.waitFor(); assert.equal(await select.inputValue(), '')
})
await check('저장 후 판이 바뀌면 최신 판으로 추정하지 않고 직접 선택을 안내한다', 'stale', async () => {
  await page.getByText('편성 화면에서 연결한 초안의 현재 판이나 확정 권한을 확인할 수 없습니다. 최신 저장 초안을 직접 선택해 주세요.', { exact: true }).waitFor(); assert.equal(await page.getByLabel('확정할 저장 초안', { exact: true }).inputValue(), ''); assert.equal(await page.getByRole('button', { name: '적용 전 변경 영향 확인', exact: true }).isDisabled(), true); assert.equal(await page.evaluate(() => window.calls.includes('preview')), false)
})
await check('기존 확정 입력과 날짜는 연결한 초안보다 우선 보존한다', 'draft', async () => {
  await page.getByText('보관한 입력과 원래 요청을 먼저 확인해 주세요. 편성 화면에서 연결한 초안으로 기존 입력을 바꾸지 않았습니다.', { exact: true }).waitFor(); await page.getByRole('button', { name: /^시간표 확정/ }).click(); const select = page.getByLabel('확정할 저장 초안', { exact: true }); await select.waitFor(); assert.equal(await select.inputValue(), 'existing@1'); assert.equal(await page.getByLabel('적용 시작일', { exact: true }).inputValue(), '2026-10-30'); assert.equal(await page.getByLabel('적용 마지막 날', { exact: true }).inputValue(), '2026-11-30')
})
await check('보관 입력을 정리한 뒤 새 초안 연결을 받을 수 있다', 'draft', async () => {
  await page.getByRole('button', { name: /^시간표 확정/ }).click(); await page.getByRole('button', { name: '확정 입력 정리', exact: true }).click(); await page.getByRole('button', { name: '확정 입력 비우기', exact: true }).click(); await page.evaluate(() => { window.view.drafts.push({ id: 'draft-b', version: 1, title: '다음 저장 초안' }); window.link = { id: 'draft-b', version: 1 }; window.refresh() }); await page.waitForFunction(() => document.querySelector('[aria-label="확정할 저장 초안"]')?.value === 'draft-b@1'); assert.equal(await page.evaluate(() => window.calls.includes('preview')), false)
})
await check('결과 미상 요청은 연결된 초안보다 우선하고 원래 번호를 유지한다', 'pending', async () => {
  await page.getByRole('button', { name: '원래 요청 결과만 다시 확인', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: /^교환·변경 요청/ }).getAttribute('aria-pressed'), 'true'); assert.equal(await page.getByRole('button', { name: /^시간표 확정/ }).isDisabled(), true); assert.equal(await page.evaluate(() => window.pending.count()), 1); assert.equal(await page.evaluate(() => window.calls.includes('execute')), false)
})
await check('확정 권한이 없으면 연결한 초안 정보를 화면에 표시하지 않는다', 'forbidden', async () => {
  await page.getByText('시간표 확정 담당 권한과 서버 준비 상태가 확인되어야 초안을 열 수 있습니다.', { exact: true }).waitFor(); assert.equal(await page.getByLabel('확정할 저장 초안', { exact: true }).count(), 0); assert.equal(await page.getByText('저장한 초안 · 2판', { exact: true }).count(), 0); assert.equal(await page.evaluate(() => window.calls.includes('execute')), false)
})
assert.deepEqual(errors, []); if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'operation-review-results.json'), JSON.stringify({ passed, errors }, null, 2)) }; console.log(`시간표 변경 검토·확정 연결 브라우저 검사: ${passed.length}개 통과`)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
