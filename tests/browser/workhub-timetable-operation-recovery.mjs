// 부모 작업창의 공통 잠금·복구 분기를 검사한다. 개별 어댑터의 실제 응답 검증은 별도 계약 시험에서 다룬다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-operation-recovery-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], passed = []
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000)
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }))
async function start(kind, options = {}) { await page.goto('http://127.0.0.1:5187/operation-recovery'); await page.addScriptTag({ content: bundle }); await page.evaluate(({ kind, options }) => { Object.assign(window, options); if (kind) window.seed(kind); window.mount() }, { kind, options }); await page.getByRole('heading', { name: '시간표 운영', exact: true }).waitFor() }
const recovery = () => page.getByRole('button', { name: '원래 요청 결과만 다시 확인', exact: true })
async function check(name, run) { await run(); passed.push(name); console.log('  ✓ ' + name) }
try {
  for (const kind of ['publish_manifest', 'school_day']) await check(kind + ': 조회 실패와 재진입 뒤에도 원래 명령·번호로 맞는 복구 계약을 부른다', async () => {
    await start(kind, { failRead: true }); await recovery().waitFor(); await page.getByRole('heading', { name: '시간표 운영 자료를 불러오지 못했습니다' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '공유 시간표', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: /^교환·변경 요청/ }).isDisabled(), true)
    await page.evaluate(() => { window.root.unmount(); window.mount() }); await recovery().click(); await page.waitForFunction(() => window.pending.count() === 0)
    const state = await page.evaluate(() => ({ calls: window.calls, seeded: window.seeded, saved: window.saved() }))
    assert.deepEqual(state.calls, [{ method: kind === 'publish_manifest' ? 'publication.recover' : 'schoolDay.recover', command: state.seeded, key: 'original-request-123' }])
    assert.equal(state.saved['timetable-exchanges'].reason, '교환 입력 유지')
    assert.equal(state.saved[kind === 'publish_manifest' ? 'timetable-publish' : 'timetable-school-day'], undefined)
    assert.ok(state.saved[kind === 'publish_manifest' ? 'timetable-school-day' : 'timetable-publish'])
  })
  for (const kind of ['publish_manifest', 'school_day']) await check(kind + ': 미실행 확인 뒤 입력을 보존하고 자동 새 요청을 만들지 않는다', async () => {
    await start(kind, { recoveryError: 'NOT_FOUND', failRead: true }); const before = await page.evaluate(() => window.saved()); await recovery().click(); await page.waitForFunction(() => window.pending.count() === 0)
    assert.deepEqual(await page.evaluate(() => window.saved()), before); assert.equal(await page.evaluate(() => window.calls.length), 1)
    await page.getByText('원래 요청이 실행되지 않았음을 확인했습니다. 입력은 유지했습니다. 최신 내용을 다시 검토해 주세요.', { exact: true }).waitFor()
  })
  await check('복구 권한 오류는 원래 요청과 입력을 지우지 않는다', async () => {
    await start('school_day', { recoveryError: 'FORBIDDEN' }); const before = await page.evaluate(() => window.saved()); await recovery().click(); await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 1); assert.deepEqual(await page.evaluate(() => window.saved()), before); assert.equal(await page.getByRole('button', { name: '보관한 입력 정리', exact: true }).count(), 0)
  })
  await check('복구가 진행되는 동안 중복 클릭과 다른 변경을 막는다', async () => {
    await start('publish_manifest', { delayRecovery: true }); await recovery().click(); await page.waitForFunction(() => Boolean(window.releaseRecovery))
    assert.equal(await page.getByRole('button', { name: '처리 결과 확인 중…', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: /^교환·변경 요청/ }).isDisabled(), true)
    await page.evaluate(() => window.releaseRecovery()); await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await page.evaluate(() => window.calls.length), 1)
  })
  await check('전체 검증은 다른 작업을 잠그며 응답 유실은 같은 요청 번호 복구로 이어진다', async () => {
    await start(undefined, { failWrite: true, delayPage: true }); await page.getByRole('button', { name: /^시간표 확정/ }).click()
    await page.getByLabel('확정할 저장 초안', { exact: true }).selectOption('draft@2')
    await page.getByLabel('적용 시작일', { exact: true }).fill(await page.evaluate(() => window.future))
    await page.getByLabel('적용 마지막 날', { exact: true }).fill(await page.evaluate(() => window.future))
    await page.getByText('학기 전체 시간표 확인·확정', { exact: true }).click(); await page.getByRole('button', { name: '전체 변경 목록 확인', exact: true }).click()
    await page.getByRole('button', { name: '전체 변경 자동 검증', exact: true }).click(); await page.waitForFunction(() => Boolean(window.releasePage))
    assert.equal(await page.getByRole('button', { name: /^교환·변경 요청/ }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '최신 시간표 확인', exact: true }).isDisabled(), true)
    await page.evaluate(() => window.releasePage()); await page.getByLabel(/전체 변경 1건과 적용 기간을 확인/).check()
    await page.getByRole('button', { name: '검증한 학기 시간표 확정', exact: true }).click(); await recovery().waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.evaluate(() => { window.failRead = true; window.root.unmount(); window.mount() }); await recovery().click(); await page.waitForFunction(() => window.pending.count() === 0)
    const calls = await page.evaluate(() => window.calls); assert.equal(calls.length, 2); assert.equal(calls[0].method, 'publication.execute'); assert.equal(calls[1].method, 'publication.recover'); assert.equal(calls[0].key, calls[1].key); assert.deepEqual(calls[0].command, calls[1].command)
  })
  assert.deepEqual(errors, []); console.log(`시간표 공통 운영 복구 브라우저: ${passed.length}개 통과`)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
