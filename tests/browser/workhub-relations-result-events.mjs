import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
import { openTeachingTools } from './teaching-tools.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-relations-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false,
  format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await context.newPage()
const errors = [], external = [], origin = 'http://127.0.0.1:5299/', passed = []
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const results = () => page.evaluate(() => window.results), writes = () => page.evaluate(() => window.calls.filter(row => row.name === 'workhub_teaching_relation_commit'))
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function start(query = '') {
  await page.goto(origin + query); await page.addScriptTag({ content: bundle })
  if (query) {
    await field('수업 선택').selectOption('course-a'); await openTeachingTools(page, 'roster')
    await button('담당·수강 관계 관리').click()
  }
  await page.getByText('기준일 2026-10-16 · 도덕 · 수업 8판', { exact: true }).waitFor()
}
const actions = { assignment_end: '담당 종료 · 현재 교사', assignment_replace: '담당 교체 · 현재 교사', membership_end: '수강 종료 · 합성 학생', student_transfer_out: '전출 처리 · 합성 학생' }
async function ready(kind = 'assignment_replace') {
  await button(actions[kind]).click()
  if (kind === 'assignment_replace') await field('새 담당 교사').selectOption('member-b')
  await field('변경 사유').fill('본문에 복제하지 않을 합성 변경 사유')
  await button('변경 영향 미리보기').click()
  await page.getByRole('region', { name: '관계 변경 영향 미리보기', exact: true }).waitFor()
}
async function commit() {
  await field('대상·기간·전체 영향과 기존 기록 보존을 확인했습니다.').check()
  await button('확인한 관계 변경 적용').click()
}
async function pending() { await button('같은 관계 변경 요청으로 결과 확인').and(page.locator(':enabled')).waitFor() }
async function done() { await page.waitForFunction(() => window.results.length === 1 && window.pending.count() === 0) }
async function recover() { await button('같은 관계 변경 요청으로 결과 확인').click(); await done() }
async function verify(kind) {
  const all = await results(), calls = await writes(), result = all[0], command = calls[0].args.p_command
  const receipt = await page.evaluate(key => window.receipts[key], calls[0].args.p_request_key)
  const target = receipt.changes.find(row => row.id === command.intent.relationId)
  assert.equal(all.length, 1)
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'action', 'scope', 'key', 'recordedAt', 'courseId', 'relationId', 'relationVersion', 'changedCount', ...(kind === 'assignment_replace' ? ['replacementAssignmentId'] : [])].sort())
  assert.equal(result.kind, 'relations'); assert.equal(result.action, kind); assert.equal(result.key, receipt.requestKey)
  assert.equal(result.courseId, 'course-a'); assert.equal(result.relationId, command.intent.relationId); assert.equal(result.relationVersion, target.version)
  assert.equal(result.changedCount, kind === 'student_transfer_out' ? 3 : 1); assert.equal(result.recordedAt, receipt.appliedAt)
  if (kind === 'assignment_replace') assert.equal(result.replacementAssignmentId, 'assignment-new')
  assert.deepEqual(JSON.parse(result.scope).slice(0, 3), ['user-a', 'school-a', 'member-a'])
  assert.doesNotMatch(JSON.stringify(result), /합성 학생|현재 교사|새 교사|변경 사유|school-student|기록 본문/)
  assert.equal(await page.evaluate(() => window.applied), 1)
}
async function verifyReplay() {
  const calls = await writes()
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1])
  assert.equal(await page.evaluate(() => window.applied), 1)
}
async function test(name, run, query = '') {
  await start(query)
  try { await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []) }
  catch (error) { console.error(await page.locator('body').innerText()); console.error('결과', await results()); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
try {
  for (const kind of Object.keys(actions)) {
    await test(kind + ': 영향 미리보기·확인란만으로 접수 결과를 만들지 않는다', async () => {
      await ready(kind); await field('대상·기간·전체 영향과 기존 기록 보존을 확인했습니다.').check()
      assert.deepEqual(await results(), []); assert.deepEqual(await writes(), [])
    })
    await test(kind + ': 원대상·다음 판·서버 시각과 전체 변경 건수만 알린다', async () => {
      await ready(kind); await commit(); await done(); await verify(kind)
      assert.equal((await writes()).length, 1)
    })
    await test(kind + ': 응답 유실·재진입 뒤 같은 명령·원키의 재접수만 기록한다', async () => {
      await ready(kind); await page.evaluate(() => window.failAfter = true); await commit(); await pending()
      assert.deepEqual(await results(), []); const original = await page.evaluate(() => window.pendingRow())
      await page.evaluate(() => window.unmount()); await button('같은 관계 변경 요청으로 결과 확인').waitFor({ state: 'detached' })
      await page.evaluate(() => { window.unavailable = true; window.remount() }); await pending()
      assert.deepEqual(await page.evaluate(() => window.pendingRow()), original)
      await recover(); await verifyReplay(); await verify(kind)
    })
  }
  for (const [name, patch] of [
    ['요청 번호', { requestKey: 'other-request' }], ['미리보기 번호', { previewId: 'other-preview' }], ['미리보기 지문', { previewFingerprint: 'b'.repeat(64) }],
    ['동작 종류', { intentKind: 'assignment_end' }], ['다른 학교', { schoolId: 'other-school' }], ['다른 소속', { memberId: 'other-member' }],
    ['다른 계정', { ownerUserId: 'other-user' }], ['접수 시각', { appliedAt: 'bad-date' }], ['처리 상태', { outcome: 'pending' }],
    ['빈 영향', { changes: [] }], ['다른 원대상', { changes: [{ kind: 'assignment', id: 'other-assignment', version: 3 }] }],
    ['다음 판', { changes: [{ kind: 'assignment', id: 'assignment-a', version: 2 }] }], ['교체 원본 누락', { replacementAssignmentId: null }],
    ['교체 원본 재사용', { replacementAssignmentId: 'assignment-a' }], ['추가 사유 필드', { reason: '접수에 없어야 할 사유' }],
  ]) {
    await test('손상된 ' + name + ' 응답은 결과 없이 원키를 남기고 정확한 재접수로 복구한다', async () => {
      await ready(); await page.evaluate(patch => window.badReceipt = patch, patch); await commit(); await pending()
      assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
      await page.evaluate(() => window.badReceipt = undefined); await recover(); await verifyReplay(); await verify('assignment_replace')
    })
  }
  await test('전출 영향 일부가 빠진 접수는 다른 수업을 누락한 완료로 표시하지 않는다', async () => {
    await ready('student_transfer_out'); await page.evaluate(() => window.badReceipt = { changes: [{ kind: 'enrollment', id: 'enrollment-a', version: 4 }] })
    await commit(); await pending(); assert.deepEqual(await results(), [])
    await page.evaluate(() => window.badReceipt = undefined); await recover(); await verify('student_transfer_out')
  })
  await test('전출 영향 미리보기의 알려진 수강 누락은 확정 전에 거부한다', async () => {
    await page.evaluate(() => window.omitImpact = true); await button(actions.student_transfer_out).click(); await field('변경 사유').fill('영향 누락 검사')
    await button('변경 영향 미리보기').click(); await page.getByRole('alert').waitFor()
    assert.deepEqual(await results(), []); assert.deepEqual(await writes(), [])
  })
  for (const action of ['replaceAdapter', 'changeDate', 'switchMember', 'unmount']) {
    await test(action + ': 늦은 성공이 새 화면 결과나 원래 요청을 지우지 않는다', async () => {
      await ready(); await page.evaluate(() => window.holdCommit = true); await commit(); await page.waitForFunction(() => typeof window.releaseCommit === 'function')
      const original = await page.evaluate(() => window.pendingRow())
      await page.evaluate(action => window[action](), action); await settled()
      await page.evaluate(() => window.releaseCommit()); await settled()
      assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
      if (['replaceAdapter', 'changeDate'].includes(action)) {
        assert.deepEqual(await page.evaluate(() => window.pendingRow()), original)
        await pending(); await recover(); await verifyReplay(); await verify('assignment_replace')
      }
    })
  }
  await test('조회 차단 중 도착한 접수는 원키를 보존하고 차단 해제 후 같은 요청으로 확인한다', async () => {
    await ready(); await page.evaluate(() => window.holdCommit = true); await commit(); await page.waitForFunction(() => typeof window.releaseCommit === 'function')
    await page.evaluate(() => window.setBlocked('현재 수업을 다시 확인하고 있습니다.')); await settled()
    await page.evaluate(() => window.releaseCommit()); await settled(); assert.deepEqual(await results(), [])
    assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.evaluate(() => window.setBlocked('')); await pending(); await recover(); await verifyReplay()
  })
  await test('처리 중 신원 역할 변경은 결과를 기록하지 않고 원래 요청을 보존한다', async () => {
    await ready(); await page.evaluate(() => window.holdCommit = true); await commit(); await page.waitForFunction(() => typeof window.releaseCommit === 'function')
    await page.evaluate(() => { window.identityRole = 'admin'; window.releaseCommit() }); await pending()
    assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await recover(); await verifyReplay()
  })
  await test('결과 수신자가 교체돼도 전송 시작 때의 수신자만 호출한다', async () => {
    await ready(); await page.evaluate(() => window.holdCommit = true); await commit(); await page.waitForFunction(() => typeof window.releaseCommit === 'function')
    await page.evaluate(() => window.changeListener()); await settled(); await page.evaluate(() => window.releaseCommit()); await done()
    assert.deepEqual(await page.evaluate(() => window.listeners), ['original'])
  })
  await test('결과 콜백·후속 화면·재조회 실패는 확인한 접수나 원키 정리를 되돌리지 않는다', async () => {
    await ready(); await page.evaluate(() => { window.resultThrows = true; window.savedThrows = true; window.failSnapshot = true }); await commit(); await done()
    await page.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => window.saved), 1)
    assert.equal(await button('같은 관계 변경 요청으로 결과 확인').count(), 0); await verify('assignment_replace')
  })
  await test('명시 거절은 결과 없이 사유를 보존하고 새 요청을 자동 전송하지 않는다', async () => {
    await ready(); await page.evaluate(() => window.reject = 'CONFLICT'); await commit(); await page.getByRole('alert').waitFor()
    assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await field('변경 사유').inputValue(), '본문에 복제하지 않을 합성 변경 사유'); assert.equal((await writes()).length, 1)
  })
  await test('날짜가 바뀐 뒤 도착한 미리보기는 반영하거나 접수로 표시하지 않는다', async () => {
    await button(actions.assignment_replace).click(); await field('새 담당 교사').selectOption('member-b'); await field('변경 사유').fill('늦은 미리보기')
    await page.evaluate(() => window.holdPreview = true); await button('변경 영향 미리보기').click(); await page.waitForFunction(() => typeof window.releasePreview === 'function')
    await page.evaluate(() => window.changeDate()); await settled(); await page.evaluate(() => window.releasePreview()); await settled()
    assert.equal(await page.getByRole('region', { name: '관계 변경 영향 미리보기', exact: true }).count(), 0)
    assert.deepEqual(await results(), []); assert.deepEqual(await writes(), [])
  })
  await test('실제 수업 화면에서 관계 관리로 전달한 콜백도 같은 정확한 접수를 받는다', async () => {
    await ready('membership_end'); await commit(); await done(); await verify('membership_end')
    assert.equal((await writes()).length, 1)
  }, '?workspace')
  console.log(`\n수업 관계 결과 연결 ${passed.length}/${passed.length} 통과 · 실제 React/어댑터, 합성 RPC`)
} finally { await context.close(); await browser.close() }
