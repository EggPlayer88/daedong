import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-execution-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), errors = [], external = []
const origin = 'http://127.0.0.1:5304/', button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept())
await context.route('**/*', route => { if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }) })
const results = () => page.evaluate(() => window.results), writes = () => page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_execution_record'))
let passed = 0
async function edit(outcome = 'completed') { await button('실시 기록 작성하기').click(); await field('실시 결과').selectOption(outcome); await field('기록 메모').fill('결과에 복제하지 않을 실제 수업 메모') }
async function save() { await field('선택 수업과 실제 실시 여부를 직접 확인했습니다').check(); await button('확인한 실시 기록 저장').click() }
async function pending() { await button('원래 실시 기록 결과 확인').and(page.locator(':enabled')).waitFor() }
async function recover() { await button('원래 실시 기록 결과 확인').click() }
async function done(count = 1) { await page.waitForFunction(count => window.results.length === count && window.pending.count() === 0, count) }
async function resend() { await field('늦은 처리 가능성을 확인했고 같은 번호·같은 입력으로 다시 보냅니다').check(); await button('같은 번호로 실시 기록 다시 보내기').click() }
async function closable() {
  await edit(); await page.evaluate(() => { window.dropBefore = true }); await save(); await pending(); await recover()
  await button('같은 번호로 실시 기록 다시 보내기').waitFor(); await page.evaluate(() => { window.reject = 'CONFLICT' }); await resend(); await button('이 요청 닫기').waitFor()
}
async function close() { await button('이 요청 닫기').click(); await button('요청 닫기 확인').click() }
async function test(name, run) {
  await page.goto(origin); await page.clock.setFixedTime(new Date('2026-11-12T03:00:00.000Z')); await page.addScriptTag({ content: bundle })
  await page.locator('.timetable-execution-records > summary').click(); await button('실시 기록 작성하기').waitFor()
  try { await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []); passed++; console.log('  ✓ ' + name) }
  catch (error) { console.error(await page.locator('body').innerText()); console.error('결과', await results()); throw error }
}
function metadata(row, outcome = 'completed', version = 1) {
  assert.deepEqual(Object.keys(row).sort(), ['kind', 'action', 'scope', 'key', 'recordedAt', 'recordId', 'recordVersion', 'lessonId', 'lessonVersion', 'outcome'].sort())
  assert.equal(row.kind, 'execution'); assert.equal(row.action, version === 1 ? 'save' : 'correct'); assert.equal(row.recordId, 'record-lesson-one')
  assert.equal(row.recordVersion, version); assert.equal(row.lessonId, 'lesson-one'); assert.equal(row.lessonVersion, 1); assert.equal(row.outcome, outcome)
  assert.equal(row.recordedAt, '2026-11-12T03:00:00.000Z'); assert.equal(JSON.parse(row.scope)[0], 'user'); assert.equal(JSON.parse(row.scope)[2], 'member')
}
try {
  await test('현재 기록 조회와 명시 확인 전 입력은 결과를 알리지 않는다', async () => {
    assert.deepEqual(await results(), []); await edit(); assert.equal(await button('확인한 실시 기록 저장').isDisabled(), true); assert.equal((await writes()).length, 0)
    await button('실시 기록 입력 취소').click(); await button('실시 기록 작성하기').waitFor(); assert.deepEqual(await results(), [])
  })
  for (const outcome of ['completed', 'not_performed', 'needs_review']) await test(outcome + ' 신규 기록은 실시 상태와 검증된 최소 접수만 보낸다', async () => {
    await edit(outcome); await save(); await done(); metadata((await results())[0], outcome)
    assert.equal((await results())[0].key, (await writes())[0].args.p_request_key); assert.equal(await page.evaluate(() => window.sources['lesson-one'].lesson.state), 'scheduled')
  })
  await test('정정은 같은 기록의 다음 판이며 이유나 메모를 복제하지 않는다', async () => {
    await edit(); await save(); await done(); await button('실시 기록 정정하기').click(); await field('정정 사유').fill('결과에 복제하지 않을 정정 사유'); await field('실시 결과').selectOption('needs_review'); await save(); await done(2)
    const rows = await results(); metadata(rows[0]); metadata(rows[1], 'needs_review', 2); assert.notEqual(rows[0].key, rows[1].key); assert.equal(await page.evaluate(() => window.sources['lesson-one'].history.length), 2)
  })
  await test('메모·정정 사유 필수 검증 실패는 접수나 결과가 아니다', async () => {
    await edit('not_performed'); await field('기록 메모').fill(''); await save(); await page.getByRole('alert').waitFor(); assert.deepEqual(await results(), []); assert.equal((await writes()).length, 0)
    await field('기록 메모').fill('미실시 확인'); await save(); await done(); await button('실시 기록 정정하기').click(); await save(); await page.getByRole('alert').waitFor(); assert.equal((await results()).length, 1); assert.equal((await writes()).length, 1)
  })
  await test('결과·후속 갱신 콜백 예외는 접수와 복구 해제를 바꾸지 않는다', async () => {
    await edit(); await page.evaluate(() => { window.resultThrows = true; window.changedThrows = true }); await save(); await done(); await button('실시 기록 정정하기').waitFor()
    assert.equal(await page.getByRole('alert').count(), 0); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('성공 뒤 조회 실패는 저장 결과를 보존하고 재조회만 제공한다', async () => {
    await edit(); await page.evaluate(() => { window.failAfter = true }); await save(); await done(); await page.getByRole('alert').waitFor()
    assert.equal(await button('실시 기록 작성하기').count(), 0); await page.evaluate(() => { window.failGet = false }); await button('실시 기록 다시 확인').click(); await button('실시 기록 정정하기').waitFor(); assert.equal((await writes()).length, 1)
  })
  await test('응답 유실·재마운트는 원명령과 원키 조회로 한 번만 접수한다', async () => {
    await edit(); await page.evaluate(() => { window.dropOnce = true }); await save(); await pending(); assert.deepEqual(await results(), [])
    await page.evaluate(() => window.unmount()); await button('원래 실시 기록 결과 확인').waitFor({ state: 'detached' }); await page.evaluate(() => window.remount()); await pending(); await recover(); await done()
    const calls = await writes(); assert.equal(calls.length, 2); assert.equal(calls[1].args.p_recover_only, true); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('정정 접수 유실도 같은 원본 다음 판을 원키로 복구한다', async () => {
    await edit(); await save(); await done(); await button('실시 기록 정정하기').click(); await field('정정 사유').fill('기록 확인'); await field('실시 결과').selectOption('not_performed')
    await page.evaluate(() => { window.dropOnce = true }); await save(); await pending(); assert.equal((await results()).length, 1); await recover(); await done(2)
    metadata((await results())[1], 'not_performed', 2); const calls = await writes(); assert.deepEqual(calls[1].args.p_command, calls[2].args.p_command); assert.equal(calls[1].args.p_request_key, calls[2].args.p_request_key)
  })
  await test('미접수 조회 뒤 명시 재전송은 같은 번호와 입력만 사용한다', async () => {
    await edit(); await page.evaluate(() => { window.dropBefore = true }); await save(); await pending(); await recover(); await button('같은 번호로 실시 기록 다시 보내기').waitFor()
    assert.deepEqual(await results(), []); await resend(); await done(); const calls = await writes(); assert.equal(calls.length, 3); assert.equal(new Set(calls.map(row => row.args.p_request_key)).size, 1); assert.deepEqual(calls[0].args.p_command, calls[2].args.p_command)
  })
  await test('닫기에서 이미 저장된 기록은 닫기 응답 유실 복구 뒤에만 알린다', async () => {
    await closable(); await page.evaluate(() => { window.lateApplyOnClose = true; window.closeDrop = true }); await close(); await button('요청 닫기 결과 다시 확인').waitFor(); assert.deepEqual(await results(), [])
    await button('요청 닫기 결과 다시 확인').click(); await done(); metadata((await results())[0]); const calls = await page.evaluate(() => window.calls.filter(row => row.name.endsWith('_abandon'))); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('미반영 요청 닫힘은 실시 결과가 아니며 입력을 보관한다', async () => {
    await closable(); await close(); await page.waitForFunction(() => window.pending.count() === 0); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.writes), 0); assert.equal(await field('기록 메모').inputValue(), '결과에 복제하지 않을 실제 수업 메모')
  })
  for (const [fieldName, value, root] of [['requestKey', 'wrong-key', true], ['commandHash', 'f'.repeat(64), true], ['lessonId', 'lesson-two'], ['lessonVersion', 2], ['version', 2], ['outcome', 'not_performed'], ['recordedAt', 'bad-time'], ['recordedBy', { id: 'other-member', name: '다른 교사' }], ['note', '다른 메모']]) {
    await test('손상된 ' + fieldName + ' 접수는 원키로 검증하기 전 결과가 아니다', async () => {
      await edit(); await page.evaluate(([name, value, root]) => { window[root ? 'badReceipt' : 'badRecord'] = { [name]: value } }, [fieldName, value, root]); await save(); await pending(); assert.deepEqual(await results(), [])
      await page.evaluate(() => { window.badReceipt = undefined; window.badRecord = undefined }); await recover(); await done(); assert.equal(await page.evaluate(() => window.writes), 1)
    })
  }
  await test('정정의 다른 record ID 접수는 원기록 복구 전 결과가 아니다', async () => {
    await edit(); await save(); await done(); await button('실시 기록 정정하기').click(); await field('정정 사유').fill('정정 확인'); await page.evaluate(() => { window.badRecord = { id: 'other-record' } }); await save(); await pending(); assert.equal((await results()).length, 1)
    await page.evaluate(() => { window.badRecord = undefined }); await recover(); await done(2); metadata((await results())[1], 'completed', 2)
  })
  for (const change of ['unmount', 'replaceConnection', 'changeDate', 'switchAccount', 'changeSource']) await test(change + ' 뒤 늦은 저장을 현재 결과로 알리지 않고 원키를 보존한다', async () => {
    await edit(); await page.evaluate(() => { window.holdWrite = true }); await save(); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
    await page.evaluate(change => window[change](), change); await page.waitForFunction(change => change === 'unmount' ? !window.ui.mounted : change === 'replaceConnection' ? window.ui.epoch === 1 : change === 'changeDate' ? window.ui.date === '2026-11-13' : change === 'switchAccount' ? window.ui.memberId === 'other-member' : window.ui.selected === 'lesson-two', change)
    await page.evaluate(() => { window.holdWrite = false; window.releaseWrite() }); await page.waitForTimeout(100); assert.deepEqual(await results(), [])
    if (['replaceConnection', 'changeDate', 'changeSource'].includes(change)) {
      if (change === 'changeSource') await page.evaluate(() => window.restoreSource())
      assert.equal(await page.evaluate(() => window.pending.count()), 1); await pending(); await recover(); await done(); const calls = await writes(); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command)
    }
  })
  await test('저장 중 수신자 변경에도 요청 시작 때의 수신자만 호출한다', async () => {
    await edit(); await page.evaluate(() => { window.holdWrite = true }); await save(); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
    await page.evaluate(() => window.changeListener()); await page.waitForFunction(() => window.ui.listener === 'new'); await page.evaluate(() => { window.holdWrite = false; window.releaseWrite() }); await done(); assert.deepEqual(await page.evaluate(() => window.listeners), ['original'])
  })
  await test('처리 중 신원 권한 변경은 정상 접수처럼 알리지 않는다', async () => {
    await edit(); await page.evaluate(() => { window.holdWrite = true }); await save(); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
    await page.evaluate(() => { window.changedRole = 'calendar_manager'; window.releaseWrite() }); await pending(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
  })
  console.log(`시간표 실시 기록 결과 연결 ${passed}/${passed} 통과 · 실제 React/어댑터, 합성 RPC·외부 호출 0`)
} finally { await browser.close() }
