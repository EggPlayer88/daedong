import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'

const bundle = buildSync({entryPoints: [fileURLToPath(new URL('./workhub-approval-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: {'.css': 'text'}, define: {'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"'}, logLevel: 'silent'}).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({viewport: {width: 1280, height: 900}}), page = await context.newPage()
const errors = [], external = [], passed = [], origin = 'http://127.0.0.1:5285/'
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'})
})
const button = name => page.getByRole('button', {name, exact: true}), label = name => page.getByLabel(name, {exact: true})
const results = () => page.evaluate(() => window.results)
const settled = () => page.waitForFunction(() => window.pending.count() === 0)
async function start(kind, options = {}) {
  await page.goto(origin + kind); await page.evaluate(value => { window.fixtureOptions = value }, {kind, ...options}); await page.addScriptTag({content: bundle})
  if (kind === 'intervention') await button('최종 승인').waitFor()
  else await button('업무 인계 준비').waitFor()
  assert.deepEqual(await results(), [])
}
async function test(kind, name, run, options) {
  await start(kind, options)
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); console.error(await page.evaluate(() => ({results: window.results, calls: window.calls, pending: window.pendingRow()}))); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
async function prepareApproval(action = '최종 승인') { await button(action).click(); await label('이 요청의 처리 내용을 확인했습니다.').check() }
async function approve() { await prepareApproval(); await button('확인한 처리 반영').click() }
async function prepareTransition(action = 'accept') {
  const names = {admin_confirm: '관리자 확인', admin_reject: '관리자 반려', accept: '인수 확인', reject: '반려', cancel: '인계 요청 취소'}
  await button(names[action]).click(); await label('확인·반려·취소 사유').fill('검토한 처리 사유'); await label('현재 대상과 변경 내용을 확인했습니다').check()
}
async function prepareHandover() {
  await button('업무 인계 준비').click(); await label('인수 교사').selectOption('next'); await label('공식 담당 · 1판').check(); await label('인계 내용').fill('인수할 공식 업무 내용')
  await button('변경 대상 미리보기').click(); await page.getByRole('region', {name: '인계 변경 미리보기'}).waitFor()
}
const commitTransition = () => button('확인한 변경 요청').click()
async function assertReceipt(result) {
  const saved = await page.evaluate(key => window.receipts.get(key), result.key)
  assert.equal(result.recordedAt, saved.recordedAt); assert.deepEqual(JSON.parse(result.scope).slice(0, 3), ['user', 'school', 'manager'])
  if (result.kind === 'intervention') { assert.equal(result.requestVersion, saved.version); assert.equal(result.requestId, saved.entityId); assert.deepEqual(result.changedLessonIds, saved.changedLessons.map(row => row.id)) }
  else { assert.equal(result.recordVersion, saved.version); assert.equal(result.recordId, saved.recordId); assert.equal(result.state, saved.state) }
}
async function assertSameRecovery(kind) {
  const state = await page.evaluate(() => ({calls: window.calls.filter(call => /_(execute|mutate)$/.test(call.name)), result: window.results[0], writes: window.writes}))
  assert.equal(state.writes, 1); assert.equal(state.calls.length, 2); assert.deepEqual(state.calls[0].args.p_command, state.calls[1].args.p_command)
  assert.equal(state.calls[0].args.p_request_key, state.calls[1].args.p_request_key); assert.equal(state.result.key, state.calls[0].args.p_request_key)
  if (kind === 'intervention') assert.equal(state.calls[1].args.p_recover_only, true)
}
try {
  for (const operationKind of ['substitute', 'cancel', 'makeup', 'reopen']) await test('intervention', `${operationKind} 승인은 실제 반영 접수증의 수업·판·시각만 전달한다`, async () => {
    await prepareApproval(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.writes), 0)
    await button('확인한 처리 반영').click(); await settled(); const [result] = await results(); assert.equal(result.kind, 'intervention'); assert.equal(result.action, 'approve'); await assertReceipt(result)
    assert.deepEqual(Object.keys(result).sort(), ['action', 'changedLessonIds', 'key', 'kind', 'recordedAt', 'requestId', 'requestVersion', 'scope'])
  }, {operationKind})
  await test('intervention', '반려와 승인 중 판 만료는 반영 완료로 알리지 않는다', async () => {
    await prepareApproval('승인 반려'); await button('확인한 처리 반영').click(); await settled(); assert.deepEqual(await results(), [])
    await page.evaluate(() => { window.seedRequest(); window.resultState = 'stale' }); await button('최종 승인').waitFor(); await approve(); await settled(); assert.deepEqual(await results(), [])
  })
  await test('intervention', '응답 유실 후 재진입은 목록 밖 요청도 원키로 복구해 한 번 알린다', async () => {
    await page.evaluate(() => { window.dropAfter = true }); await approve(); await button('같은 요청 결과 확인').waitFor(); assert.deepEqual(await results(), [])
    await page.evaluate(() => { window.root.unmount(); window.omitRecords = true; window.mount() }); await button('같은 요청 결과 확인').click(); await settled()
    assert.equal((await results()).length, 1); await assertReceipt((await results())[0]); await assertSameRecovery('intervention')
  })
  for (const applied of [true, false]) await test('intervention', `요청 닫기는 ${applied ? '이미 반영된 접수증만' : '미처리 닫힘을 결과에 넣지 않고'} 처리한다`, async () => {
    await page.evaluate(saved => { if (saved) window.dropAfter = true; else window.dropBefore = true }, applied); await approve(); await button('같은 요청 결과 확인').waitFor()
    await label('이미 처리된 결과 또는 닫힘을 확인한 뒤 이 요청을 종료합니다.').check(); await button('이 요청 닫기').click(); await settled()
    assert.equal((await results()).length, applied ? 1 : 0); if (applied) await assertReceipt((await results())[0])
  })
  await test('intervention', '결과 표시 오류는 정상 승인과 원키 정리를 되돌리지 않는다', async () => {
    await page.evaluate(() => { window.resultThrows = true }); await approve(); await settled(); assert.equal((await results()).length, 1); assert.equal(await button('같은 요청 결과 확인').count(), 0)
  })
  await test('intervention', '서버 교체 전 늦은 승인은 표시하지 않고 새 연결에서 원키 복구한다', async () => {
    await page.evaluate(() => { window.hold = true }); await approve(); await page.waitForFunction(() => typeof window.release === 'function')
    await page.evaluate(() => window.replaceConnection()); await page.waitForFunction(() => window.calls.filter(call => call.name.endsWith('_get')).length >= 2)
    await page.evaluate(() => window.release()); await button('같은 요청 결과 확인').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
    await button('같은 요청 결과 확인').click(); await settled(); assert.equal((await results()).length, 1); await assertSameRecovery('intervention')
  })
  for (const kind of ['intervention', 'transition']) {
    await test(kind, `${kind} 위조 접수증은 완료 표시 없이 원래 요청으로만 회복한다`, async () => {
      await page.evaluate(() => { window.wrongReceipt = true }); if (kind === 'intervention') await approve(); else { await prepareTransition(); await commitTransition() }
      const recover = button(kind === 'intervention' ? '같은 요청 결과 확인' : '원래 인계 요청 결과 확인'); await recover.and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
      await page.evaluate(() => { window.wrongReceipt = false }); await recover.click(); await settled(); assert.equal((await results()).length, 1); await assertSameRecovery(kind)
    })
    await test(kind, `${kind} 접수 뒤 신원 철회는 결과를 표시하지 않는다`, async () => {
      await page.evaluate(() => { window.hold = true }); if (kind === 'intervention') await approve(); else { await prepareTransition(); await commitTransition() }
      await page.waitForFunction(() => typeof window.release === 'function'); await page.evaluate(() => { window.approved = false; window.release() })
      await button(kind === 'intervention' ? '같은 요청 결과 확인' : '원래 인계 요청 결과 확인').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    })
  }
  await test('transition', '공식 담당 요청은 관리자 대기로 표시하고 미리보기에는 결과를 만들지 않는다', async () => {
    await prepareHandover(); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.writes), 0)
    await label('현재 대상과 변경 내용을 확인했습니다').check(); await commitTransition(); await settled(); const [result] = await results()
    assert.equal(result.action, 'apply'); assert.equal(result.state, 'awaiting_admin'); await assertReceipt(result)
  })
  for (const action of ['admin_confirm', 'admin_reject', 'accept', 'reject', 'cancel']) await test('transition', `공식 인계 ${action} 결과를 실제 단계와 원본 판으로 구분한다`, async () => {
    await prepareTransition(action); assert.deepEqual(await results(), []); await commitTransition(); await settled(); const [result] = await results(); assert.equal(result.action, action); await assertReceipt(result)
    assert.equal(result.state, ({admin_confirm: 'pending', admin_reject: 'rejected', accept: 'accepted', reject: 'rejected', cancel: 'cancelled'})[action])
    assert.deepEqual(Object.keys(result).sort(), ['action', 'key', 'kind', 'recordId', 'recordVersion', 'recordedAt', 'scope', 'state'])
  }, action.startsWith('admin_') ? {transitionState: 'awaiting_admin', transitionVersion: 1} : {})
  await test('transition', '협업·수합 인계는 관리자 확인과 구분해 인수 대기로 기록한다', async () => {
    await prepareHandover(); await label('현재 대상과 변경 내용을 확인했습니다').check(); await commitTransition(); await settled(); const [result] = await results()
    assert.equal(result.action, 'apply'); assert.equal(result.state, 'pending'); await assertReceipt(result)
  }, {formal: false, transitionVersion: 1})
  await test('transition', '이전 공식 담당 접수증은 현재 승인·인수 결과로 승격하지 않는다', async () => {
    await prepareHandover(); await label('현재 대상과 변경 내용을 확인했습니다').check(); await page.evaluate(() => { window.legacyReceipt = true }); await commitTransition()
    await button('원래 인계 요청 결과 확인').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
    await button('원래 인계 요청 결과 확인').click(); await settled(); assert.deepEqual(await results(), []); await page.getByText(/이전 인계 요청의 접수 결과를 확인했습니다/).waitFor()
  })
  await test('transition', '인계 응답 유실과 목록 실패 뒤 원키 복구는 한 번의 인수만 기록한다', async () => {
    await prepareTransition(); await page.evaluate(() => { window.dropAfter = true }); await commitTransition(); await button('원래 인계 요청 결과 확인').waitFor(); assert.deepEqual(await results(), [])
    await page.evaluate(() => { window.root.unmount(); window.failRead = true; window.mount() }); await button('원래 인계 요청 결과 확인').click(); await settled()
    assert.equal((await results()).length, 1); await assertSameRecovery('transition'); await assertReceipt((await results())[0])
  })
  await test('transition', '인계 결과 콜백 예외는 성공 상태와 원키 정리를 유지한다', async () => {
    await prepareTransition(); await page.evaluate(() => { window.resultThrows = true }); await commitTransition(); await settled(); assert.equal((await results()).length, 1); assert.equal(await button('원래 인계 요청 결과 확인').count(), 0)
  })
  await test('transition', '연결 교체 전 늦은 인계 응답은 새 업무에 붙지 않는다', async () => {
    await prepareTransition(); await page.evaluate(() => { window.hold = true }); await commitTransition(); await page.waitForFunction(() => typeof window.release === 'function')
    await page.evaluate(() => window.replaceConnection()); await page.waitForFunction(() => window.calls.filter(call => call.name.endsWith('_list')).length >= 3)
    await page.evaluate(() => window.release()); await button('원래 인계 요청 결과 확인').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
    await button('원래 인계 요청 결과 확인').click(); await settled(); assert.equal((await results()).length, 1); await assertSameRecovery('transition')
  })
  await test('transition', '연결 교체 전 미리보기는 폐기하고 현재 연결에서 다시 확인한다', async () => {
    await button('업무 인계 준비').click(); await label('인수 교사').selectOption('next'); await label('공식 담당 · 1판').check(); await label('인계 내용').fill('보관할 인계 내용')
    await page.evaluate(() => { window.holdPreview = true }); await button('변경 대상 미리보기').click(); await page.waitForFunction(() => typeof window.releasePreview === 'function')
    await page.evaluate(() => window.replaceConnection()); await page.waitForFunction(() => window.calls.filter(call => call.name.endsWith('_list')).length >= 3)
    await page.evaluate(() => window.releasePreview()); await page.waitForFunction(() => window.previewDelivered)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole('region', {name: '인계 변경 미리보기'}).count(), 0); assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.writes), 0)
    await page.evaluate(() => { window.holdPreview = false }); await button('변경 대상 미리보기').click(); await page.getByRole('region', {name: '인계 변경 미리보기'}).waitFor()
    assert.equal(await label('인계 내용').inputValue(), '보관할 인계 내용'); assert.deepEqual(await results(), [])
  })
  await test('transition', '새 학년도 생성은 인계 인수와 구분해 기록한다', async () => {
    await button('새 학년도 준비').click(); await label('기준 학년도').selectOption('year'); await label('새 학년도').fill('2027')
    for (const [name, date] of [['학년도 시작일', '2027-03-01'], ['학년도 마지막 날', '2028-02-29'], ['1학기 시작일', '2027-03-01'], ['1학기 마지막 날', '2027-08-15'], ['2학기 시작일', '2027-08-16'], ['2학기 마지막 날', '2028-02-29']]) await label(name).fill(date)
    await button('변경 대상 미리보기').click(); await label('현재 대상과 변경 내용을 확인했습니다').check(); await commitTransition(); await settled()
    const [result] = await results(); assert.equal(result.action, 'apply'); assert.equal(result.state, 'completed'); await assertReceipt(result)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`\n승인·인계 결과 브라우저 ${passed.length}건 통과`)
} finally { await browser.close() }
