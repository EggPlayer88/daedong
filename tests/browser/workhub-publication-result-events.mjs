import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-publication-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false,
  format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const errors = [], external = [], origin = 'http://127.0.0.1:5298/', passed = []
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' })
})
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const results = () => page.evaluate(() => window.results), writes = () => page.evaluate(() => window.calls.filter(row => /_execute$/.test(row.name)))
async function start() {
  await page.goto(origin + 'publication'); await page.clock.setFixedTime(new Date('2026-10-18T00:00:00.000Z')); await page.addScriptTag({ content: bundle })
  await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor()
  await button('시간표 확정').click(); await field('확정할 저장 초안').selectOption('draft@2')
  await field('적용 시작일').fill('2026-10-19'); await field('적용 마지막 날').fill('2026-10-19')
}
async function inspect(kind) {
  if (kind === 'publish') { await button('적용 전 변경 영향 확인').click(); await button('확인한 시간표 확정').waitFor() }
  else { await page.getByText('학기 전체 시간표 확인·확정', { exact: true }).click(); await button('전체 변경 목록 확인').click(); await button('전체 변경 자동 검증').waitFor() }
}
async function ready(kind) {
  await inspect(kind)
  if (kind === 'publish_manifest') { await button('전체 변경 자동 검증').click(); await page.getByText('전체 검증 완료 · 1/1쪽 · 3/3건', { exact: true }).waitFor() }
}
async function confirm(kind) {
  await field(kind === 'publish' ? '적용 기간과 변경 수업을 확인했으며, 학교 시간표로 확정합니다.' : '전체 변경 3건과 적용 기간을 확인했으며 학교 시간표로 확정합니다.').check()
  await button(kind === 'publish' ? '확인한 시간표 확정' : '검증한 학기 시간표 확정').click()
}
async function pending() { await button('원래 요청 결과만 다시 확인').and(page.locator(':enabled')).waitFor() }
async function done() { await page.waitForFunction(() => window.results.length === 1); await page.waitForFunction(() => window.pending.count() === 0) }
async function recover() { await button('원래 요청 결과만 다시 확인').click() }
async function resend() {
  await field('늦은 처리 가능성을 확인했고 같은 번호·같은 내용으로 다시 보냅니다').check()
  await button('같은 번호·같은 내용으로 다시 보내기').click()
}
async function closable(kind) {
  await ready(kind); await page.evaluate(() => { window.failBeforeWrite = true }); await confirm(kind); await pending(); await recover()
  await field('늦은 처리 가능성을 확인했고 같은 번호·같은 내용으로 다시 보냅니다').waitFor()
  await page.evaluate(() => { window.reject = 'CONFLICT' }); await resend(); await button('이 요청 닫기').waitFor()
}
async function close() { await button('이 요청 닫기').click(); await button('요청 닫기 확인').click() }
async function test(name, run) {
  await start()
  try { await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []) }
  catch (error) { console.error(await page.locator('body').innerText()); console.error('결과', await results()); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
function metadata(row, kind, key) {
  assert.deepEqual(Object.keys(row).sort(), ['kind', 'action', 'scope', 'key', 'recordedAt', 'publicationId', 'publicationVersion', 'changedCount'].sort())
  assert.equal(row.kind, 'publication'); assert.equal(row.action, kind); assert.equal(row.key, key)
  assert.deepEqual(JSON.parse(row.scope).slice(0, 3), ['user', 'school', 'member'])
  assert.equal(row.publicationId, 'publication-1'); assert.equal(row.publicationVersion, kind === 'publish' ? 1 : 4)
  assert.equal(row.changedCount, kind === 'publish' ? 2 : 3); assert.equal(row.recordedAt, '2026-10-18T00:00:00.000Z')
}
try {
  for (const kind of ['publish', 'publish_manifest']) {
    await test(kind + ' 미리보기·전체 검증·확인란만으로 공개 결과를 만들지 않는다', async () => {
      await ready(kind); assert.deepEqual(await results(), []); assert.equal((await writes()).length, 0)
      assert.equal(await button(kind === 'publish' ? '확인한 시간표 확정' : '검증한 학기 시간표 확정').isDisabled(), true)
    })
    await test(kind + ' 검증된 공개 접수만 최소 필드와 서버 시각으로 알린다', async () => {
      await ready(kind); await confirm(kind); await done(); const calls = await writes(); metadata((await results())[0], kind, calls[0].args.p_request_key)
      assert.equal(calls.length, 1); assert.equal(await page.evaluate(() => window.saved), 1)
    })
    await test(kind + ' 콜백·후속 조회 실패가 공개 접수와 원키 정리를 바꾸지 않는다', async () => {
      await ready(kind); await page.evaluate(() => { window.resultThrows = true; window.failRead = true }); await confirm(kind); await done()
      await page.getByRole('heading', { name: '시간표 운영 자료를 불러오지 못했습니다', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.saved), 1)
    })
    await test(kind + ' 응답 유실은 만료·재마운트 뒤 원키 조회로 한 번만 기록한다', async () => {
      await ready(kind); await page.evaluate(() => { window.failOnce = true }); await confirm(kind); await pending(); assert.deepEqual(await results(), [])
      await page.clock.setFixedTime(new Date('2026-10-18T00:20:00.000Z')); await page.evaluate(() => { window.unmount() }); await button('원래 요청 결과만 다시 확인').waitFor({ state: 'detached' })
      await page.evaluate(() => { window.remount() }); await pending(); await recover(); await done()
      const calls = await writes(); assert.equal(calls.length, 2); assert.equal(calls[1].args.p_recover_only, true)
      assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command)
      metadata((await results())[0], kind, calls[0].args.p_request_key); assert.equal(await page.evaluate(() => window.saved), 1)
    })
    await test(kind + ' 미접수 확인 뒤 명시 재전송도 같은 번호·내용만 접수한다', async () => {
      await ready(kind); await page.evaluate(() => { window.failBeforeWrite = true }); await confirm(kind); await pending(); await recover()
      await field('늦은 처리 가능성을 확인했고 같은 번호·같은 내용으로 다시 보냅니다').waitFor(); assert.deepEqual(await results(), [])
      await resend(); await done(); const calls = await writes(); assert.equal(calls.length, 3)
      assert.equal(new Set(calls.map(row => row.args.p_request_key)).size, 1); assert.deepEqual(calls.map(row => row.args.p_command), Array(3).fill(calls[0].args.p_command))
    })
    await test(kind + ' 요청 닫기에서 이미 반영된 접수는 공개 결과로 보존한다', async () => {
      await closable(kind); await page.evaluate(() => { window.lateApplyOnClose = true; window.failCloseOnce = true }); await close()
      await button('요청 닫기 결과 다시 확인').waitFor(); assert.deepEqual(await results(), [])
      await button('요청 닫기 결과 다시 확인').click(); await done(); const calls = await writes(); metadata((await results())[0], kind, calls[0].args.p_request_key)
      const closes = await page.evaluate(() => window.calls.filter(row => row.name.endsWith('_abandon'))); assert.deepEqual(closes[0], closes[1]); assert.equal(await page.evaluate(() => window.saved), 1)
    })
    await test(kind + ' 미반영 요청 닫힘과 명시 거절은 공개 완료가 아니다', async () => {
      await closable(kind); await close(); await page.waitForFunction(() => window.pending.count() === 0); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.saved), 0)
    })
    for (const [fieldName, value] of [['requestKey', 'wrong-request'], ['kind', 'submit'], ['status', 'awaiting_approval'], ['recordedAt', 'bad-time'],
      ...(kind === 'publish' ? [['changedLessons', []], ['version', 2]] : [['changedCount', 2], ['manifestHash', 'd'.repeat(64)]])]) {
      await test(kind + ' 손상된 ' + fieldName + ' 접수는 원번호 검증 전 결과가 되지 않는다', async () => {
        await ready(kind); await page.evaluate(([field, value]) => { window.badReceipt = { [field]: value } }, [fieldName, value]); await confirm(kind); await pending()
        assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
        await page.evaluate(() => { window.badReceipt = undefined }); await recover(); await done(); assert.equal(await page.evaluate(() => window.saved), 1)
      })
    }
    for (const change of ['unmount', 'replaceConnection', 'changeDate', 'switchAccount']) {
      await test(kind + ' ' + change + ' 뒤 늦은 응답을 새 화면 결과로 옮기지 않는다', async () => {
        await ready(kind); await page.evaluate(() => { window.holdWrite = true }); await confirm(kind); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
        await page.evaluate(change => window[change](), change)
        await page.waitForFunction(change => change === 'unmount' ? !window.ui.mounted : change === 'replaceConnection' ? window.ui.epoch === 1 : change === 'changeDate' ? window.ui.date === '2026-10-19' : window.ui.memberId === 'other-member', change)
        await page.evaluate(() => { window.holdWrite = false; window.releaseWrite() }); await page.waitForTimeout(100); assert.deepEqual(await results(), [])
        if (['replaceConnection', 'changeDate'].includes(change)) {
          assert.equal(await page.evaluate(() => window.pending.count()), 1); await pending(); await recover(); await done()
          const calls = await writes(); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command)
        }
      })
    }
    await test(kind + ' 대기 중 수신자가 바뀌어도 요청 시작 때의 결과 수신자만 호출한다', async () => {
      await ready(kind); await page.evaluate(() => { window.holdWrite = true }); await confirm(kind); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
      await page.evaluate(() => window.changeListener()); await page.waitForFunction(() => window.ui.listener === 'new')
      await page.evaluate(() => { window.holdWrite = false; window.releaseWrite() }); await done(); assert.deepEqual(await page.evaluate(() => window.listeners), ['original'])
    })
    await test(kind + ' 처리 중 권한 신원 변경은 공개 결과로 연결하지 않는다', async () => {
      await ready(kind); await page.evaluate(() => { window.holdWrite = true }); await confirm(kind); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
      await page.evaluate(() => { window.changedRole = 'teacher'; window.releaseWrite() }); await pending(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    })
    await test(kind + ' 원본 초안 판 변경으로 폐기한 늦은 미리보기는 결과가 아니다', async () => {
      await page.evaluate(() => { window.holdPreview = true })
      if (kind === 'publish') await button('적용 전 변경 영향 확인').click()
      else { await page.getByText('학기 전체 시간표 확인·확정', { exact: true }).click(); await button('전체 변경 목록 확인').click() }
      await page.waitForFunction(() => typeof window.releasePreview === 'function'); await page.evaluate(() => { window.snapshot.drafts[0].version = 3; window.refresh() })
      await page.getByText('선택한 초안의 판이나 공개 권한이 바뀌었습니다. 최신 초안을 다시 선택해 주세요.', { exact: true }).waitFor()
      await page.evaluate(() => window.releasePreview()); await page.waitForTimeout(100); assert.deepEqual(await results(), []); assert.equal((await writes()).length, 0)
    })
  }
  await test('명세 상세가 변조되면 전체 검증과 공개 결과를 만들지 않는다', async () => {
    await page.evaluate(() => { window.badPage = true }); await inspect('publish_manifest'); await button('전체 변경 자동 검증').click()
    await page.getByRole('alert').filter({ hasText: '서버 자료의 형식을 확인하지 못했습니다.' }).waitFor(); assert.deepEqual(await results(), []); assert.equal((await writes()).length, 0)
  })
  console.log(`\n시간표 공개 결과 연결 ${passed.length}/${passed.length} 통과 · 실제 React/어댑터, 합성 RPC`)
} finally { await context.close(); await browser.close() }
