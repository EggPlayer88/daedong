import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'

const bundle = buildSync({entryPoints: [fileURLToPath(new URL('./workhub-calendar-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: {'.css': 'text'}, define: {'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"'}, logLevel: 'silent'}).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({viewport: {width: 1280, height: 950}}), page = await context.newPage()
const passed = [], errors = [], external = [], origin = 'http://127.0.0.1:5286/'
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'})
})
const button = name => page.getByRole('button', {name, exact: true}), label = name => page.getByLabel(name, {exact: true}), dialog = () => page.getByRole('dialog')
const results = () => page.evaluate(() => window.qa.results)
const waitSettled = () => page.waitForFunction(() => window.qa.pendingCount() === 0)
const recoveryButton = kind => button(kind === 'single' ? '같은 요청으로 저장 결과 확인' : '같은 일괄 요청으로 결과 다시 확인')
const savedNotice = kind => kind === 'single' ? page.getByText(/등록 완료|수정 완료/).first() : page.getByRole('heading', {name: '2개 일정 저장 확인', exact: true})
async function check(name, run) {
  await page.goto(origin); await page.addScriptTag({content: bundle}); await button('시트에서 가져오기').and(page.locator(':enabled')).waitFor()
  assert.deepEqual(await results(), [])
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); console.error(await page.evaluate(() => ({results: window.qa.results, calls: window.qa.calls, pending: window.qa.pending()}))); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
async function singleInput() { await button('일정 등록').click(); await page.locator('input[name=title]').fill('결과를 연결할 일정') }
async function batchInput() {
  await button('시트에서 가져오기').click(); await label('원본 묶음 ID').fill('calendar-result'); await label('원본 묶음 이름').fill('결과 확인 자료')
  await label('원본 표 붙여넣기').fill('원본 ID,제목,시작일,종료일\nA-1,검토 연수,2026-10-20,2026-10-21\nA-2,자료 점검,2026-10-22,2026-10-22')
  await button('열 연결 확인').click(); await button('서버 원본과 비교').click(); await page.getByRole('heading', {name: '저장 전 전체 비교', exact: true}).waitFor()
}
async function selectBatch() { await label('검토 연수 저장 대상으로 선택').check(); await label('자료 점검 저장 대상으로 선택').check(); await label('선택한 2개 일정의 내용·공개 범위와 보류 행을 확인했습니다.').check() }
async function prepare(kind) { if (kind === 'single') await singleInput(); else { await batchInput(); await selectBatch() } }
const save = kind => kind === 'single' ? dialog().getByRole('button', {name: '일정 등록', exact: true}).click() : button('선택한 일정 한 번에 저장').click()
async function verify(result) {
  assert.deepEqual(JSON.parse(result.scope).slice(0, 3), ['fixture-minjun', 'fixture-school-gaon', 'gaon-minjun'])
  const saved = await page.evaluate(key => window.qa.receipt(key), result.key)
  assert.ok(Number.isFinite(Date.parse(result.recordedAt)))
  if (result.kind === 'calendar') {
    assert.equal(result.eventId, saved.id); assert.equal(result.eventVersion, saved.version); assert.equal(result.recordedAt, saved.updatedAt)
    assert.deepEqual(Object.keys(result).sort(), ['action', 'eventId', 'eventVersion', 'key', 'kind', 'recordedAt', 'scope'])
  } else {
    assert.equal(result.prepareId, saved.prepareId); assert.equal(result.recordedAt, saved.appliedAt)
    assert.deepEqual(result.events, saved.items.map(item => ({eventId: item.eventId, eventVersion: item.version})))
    assert.deepEqual(Object.keys(result).sort(), ['action', 'events', 'key', 'kind', 'prepareId', 'recordedAt', 'scope'])
  }
}
async function verifyRecovery(kind) {
  const state = await page.evaluate(value => ({calls: window.qa.calls.filter(call => call.name === (value === 'single' ? 'workhub_calendar_save' : 'workhub_calendar_batch_commit')), result: window.qa.results[0], writes: value === 'single' ? window.qa.snapshot().data.events.filter(row => row.title === '결과를 연결할 일정').length : window.qa.batchSaves.length}), kind)
  assert.equal(state.calls.length, 2); assert.deepEqual(state.calls[0].args, state.calls[1].args)
  assert.equal(state.result.key, kind === 'single' ? state.calls[0].args.p_command.idempotencyKey : state.calls[0].args.p_request_key)
  assert.equal(state.writes, kind === 'single' ? 1 : 2)
}
try {
  await check('일정 조회·새 입력은 결과를 만들지 않고 직접 등록한 원본 판과 시각만 기록한다', async () => {
    await singleInput(); await page.locator('input[name=endDate]').fill('2026-10-21'); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.qa.saves.length), 0)
    await save('single'); await savedNotice('single').waitFor(); const [result] = await results(); assert.equal(result.kind, 'calendar'); assert.equal(result.action, 'create'); await verify(result)
  })
  await check('일정 수정 충돌은 결과로 기록하지 않고 최신 판 확인 뒤 정확한 다음 판만 연결한다', async () => {
    await page.getByRole('button', {name: /함께 여는 월요일.*원본 v1 보기/}).click(); await button('일정 수정').click(); await page.locator('input[name=title]').fill('검토 후 변경한 제목')
    await page.evaluate(() => window.qa.concurrent()); await button('수정 저장').click(); await page.getByRole('heading', {name: '원본이 v2으로 바뀌었습니다', exact: true}).waitFor(); assert.deepEqual(await results(), [])
    await button('변경 확인 · 내 입력 유지').click(); await button('수정 저장').click(); await savedNotice('single').waitFor(); const [result] = await results(); assert.equal(result.action, 'update'); assert.equal(result.eventId, 'fixture-event-morning'); assert.equal(result.eventVersion, 3); await verify(result)
  })
  await check('일괄 비교·선택 확인 전에는 결과 없이 대기하고 전체 접수 행을 한 결과로 기록한다', async () => {
    await batchInput(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.qa.batchSaves.length), 0); await selectBatch(); assert.deepEqual(await results(), [])
    await save('batch'); await savedNotice('batch').waitFor(); const [result] = await results(); assert.equal(result.kind, 'calendar_batch'); assert.equal(result.action, 'commit'); assert.equal(result.events.length, 2); await verify(result)
  })
  await check('일괄 수정과 신규가 섞여도 각 원본의 검증된 판을 그대로 전달한다', async () => {
    await page.evaluate(() => { window.qa.batchUpdate = true }); await prepare('batch'); await save('batch'); await savedNotice('batch').waitFor(); const [result] = await results()
    assert.deepEqual(result.events.map(row => row.eventVersion), [2, 1]); assert.equal(result.events[0].eventId, 'fixture-event-morning'); await verify(result)
  })
  for (const kind of ['single', 'batch']) {
    await check(`${kind}: 응답 유실·재진입 뒤 같은 번호로 복구해 한 번만 결과를 알린다`, async () => {
      await prepare(kind); await page.evaluate(() => { window.qa.failAfter = true }); await save(kind); await recoveryButton(kind).and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
      await page.evaluate(() => { window.qa.forgetDrafts(); window.qa.remount() }); await recoveryButton(kind).click(); await savedNotice(kind).waitFor(); await waitSettled()
      assert.equal((await results()).length, 1); await verify((await results())[0]); await verifyRecovery(kind)
    })
    await check(`${kind}: 결과 콜백 오류가 확인한 저장을 미확정으로 되돌리지 않는다`, async () => {
      await prepare(kind); await page.evaluate(() => { window.qa.resultThrows = true }); await save(kind); await savedNotice(kind).waitFor(); await waitSettled()
      assert.equal((await results()).length, 1); assert.equal(await recoveryButton(kind).count(), 0)
    })
    for (const change of ['changeService', 'changeDate']) await check(`${kind}: ${change} 이전 늦은 응답은 원키를 지우거나 결과를 붙이지 않는다`, async () => {
      await prepare(kind); await page.evaluate(() => { window.qa.hold = true }); await save(kind); await page.waitForFunction(() => typeof window.qa.release === 'function')
      await page.evaluate(action => window.qa[action](), change); await recoveryButton(kind).and(page.locator(':enabled')).waitFor(); await page.evaluate(() => window.qa.release())
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.qa.pendingCount()), 1)
      await recoveryButton(kind).click(); await savedNotice(kind).waitFor(); assert.equal((await results()).length, 1); await verifyRecovery(kind)
    })
    await check(`${kind}: 콜백 교체 뒤에도 전송을 시작한 수신자만 결과를 받는다`, async () => {
      await prepare(kind); await page.evaluate(() => { window.qa.hold = true }); await save(kind); await page.waitForFunction(() => typeof window.qa.release === 'function')
      await page.evaluate(() => window.qa.changeListener()); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); await page.evaluate(() => window.qa.release())
      await savedNotice(kind).waitFor(); assert.deepEqual(await page.evaluate(() => window.qa.targets), ['original'])
    })
    await check(`${kind}: 학교 전환 전 응답은 새 소속의 결과에 표시하지 않는다`, async () => {
      await prepare(kind); await page.evaluate(() => { window.qa.hold = true }); await save(kind); await page.waitForFunction(() => typeof window.qa.release === 'function')
      await page.evaluate(() => window.qa.changeScope()); await button('시트에서 가져오기').and(page.locator(':enabled')).waitFor(); await page.evaluate(() => window.qa.release())
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.deepEqual(await results(), [])
    })
  }
  for (const [badField, badValue] of [['version', 99], ['title', '다른 저장 내용'], ['authorMemberId', 'gaon-soyeon']]) await check(`단일 일정의 ${badField}가 요청과 어긋나면 보조 결과에 포함하지 않는다`, async () => {
    await prepare('single'); await page.evaluate(value => Object.assign(window.qa, value), {badField, badValue}); await save('single'); await savedNotice('single').waitFor(); assert.deepEqual(await results(), [])
  })
  await check('다른 원본 번호의 수정 결과는 이전 일정의 처리 결과로 연결하지 않는다', async () => {
    await page.getByRole('button', {name: /함께 여는 월요일.*원본 v1 보기/}).click(); await button('일정 수정').click(); await page.locator('input[name=title]').fill('수정할 일정')
    await page.evaluate(() => { window.qa.badField = 'id'; window.qa.badValue = 'unrelated-event' }); await button('수정 저장').click(); await savedNotice('single').waitFor(); assert.deepEqual(await results(), [])
  })
  await check('일반 일정 서버 거부는 원본 저장 결과를 만들지 않는다', async () => {
    await prepare('single'); await page.evaluate(() => { window.qa.reject = true }); await save('single'); await page.getByRole('alert').waitFor(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.qa.snapshot().data.events.some(row => row.title === '결과를 연결할 일정')), false)
  })
  for (const fault of ['partialBatch', 'wrongBatchEvent']) await check(`일괄 ${fault} 응답은 기록하지 않고 정확한 원키 복구를 기다린다`, async () => {
    await page.evaluate(() => { window.qa.batchUpdate = true }); await prepare('batch'); await page.evaluate(key => { window.qa[key] = true }, fault); await save('batch')
    await recoveryButton('batch').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
    await page.evaluate(key => { window.qa[key] = false }, fault); await recoveryButton('batch').click(); await savedNotice('batch').waitFor(); assert.equal((await results()).length, 1); await verifyRecovery('batch')
  })
  await check('일괄 접수 뒤 권한 철회는 원키를 유지하고 결과로 표시하지 않는다', async () => {
    await prepare('batch'); await page.evaluate(() => { window.qa.hold = true }); await save('batch'); await page.waitForFunction(() => typeof window.qa.release === 'function')
    await page.evaluate(() => { window.qa.revoked = true; window.qa.release() }); await recoveryButton('batch').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.qa.pendingCount()), 1)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`\n일정 결과 연결 브라우저 ${passed.length}건 통과`)
} finally { await browser.close() }
