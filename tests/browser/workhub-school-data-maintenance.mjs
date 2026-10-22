import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-school-data-maintenance-fixture.tsx', import.meta.url))], bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message))
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), label = name => page.getByLabel(name, { exact: true })
let count = 0
async function boot() { await page.goto('http://127.0.0.1:5187/maintenance'); await page.addScriptTag({ content: bundle }); await button('수업 이름·기간 정정').waitFor() }
async function inspect() { await label('변경 근거').fill('학교 배정표의 입력 오류 정정'); await button('영향 확인').click(); await page.getByRole('region', { name: '정정 영향 미리보기', exact: true }).waitFor() }
async function save() { await label('변경 전후와 영향을 확인했습니다.').check(); await button('확인한 변경 반영').click() }
async function prepareName() { await button('수업 이름·기간 정정').click(); await label('수업 이름').fill('1반 국어 수정'); await inspect() }
async function test(name, fn) { try { await boot(); await fn() } catch (e) { console.error(await page.locator('body').innerText(), errors); throw e } count++; console.log('  ✓ ' + name) }
try {
  await test('미설정 상태는 입력을 숨기고 기존 수업으로 돌아갈 수 있음', async () => {
    await page.evaluate(() => window.notReady = true); await button('현재 자료 다시 확인').click()
    await page.getByText('학교 자료 정정 기능을 준비 중입니다. 기존 수업과 기록 조회는 계속 이용할 수 있습니다.', { exact: true }).waitFor()
    assert.equal(await button('수업 이름·기간 정정').count(), 0); await button('수업 화면으로 돌아가기').click(); assert.equal(await page.evaluate(() => window.didClose), true)
  })
  await test('수업 이름·기간 정정은 명시 확인 뒤 기존 ID·판을 보존하여 반영', async () => {
    await prepareName(); assert.equal(await button('확인한 변경 반영').isDisabled(), true); assert.equal(await page.evaluate(() => window.writes), 0)
    await save(); await button('수업 이름·기간 정정').waitFor(); assert.equal(await page.evaluate(() => window.course.id), 'course-one'); assert.equal(await page.evaluate(() => window.course.version), 2); assert.equal(await page.evaluate(() => window.course.fields.label), '1반 국어 수정')
  })
  await test('시작 전 담당 정정은 선택한 교사 목록과 전 기간을 비교하고 반영', async () => {
    await button('시작 전 수업 담당 정정').click()
    await page.getByRole('checkbox', { name: /기존 교사 \[teacher-a\]/ }).uncheck(); await page.getByRole('checkbox', { name: /새 교사 \[teacher-b\]/ }).check()
    await inspect(); await save(); await button('시작 전 수업 담당 정정').waitFor(); assert.deepEqual(await page.evaluate(() => window.course.teacherMemberIds), ['teacher-b'])
    assert.equal(await page.evaluate(() => window.course.fields.validFrom), '2027-03-01')
  })
  await test('응답 유실 후 재마운트에서도 원래 번호·정정 내용을 재사용', async () => {
    await prepareName(); await page.evaluate(() => window.dropAfter = true); await save(); await button('같은 요청으로 결과 확인').waitFor()
    const pending = await page.evaluate(() => window.pendingRow()); await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('같은 요청으로 결과 확인').click()
    await page.waitForFunction(() => window.pending.count() === 0); const calls = await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_commit')))
    assert.equal(calls.length, 2); assert.deepEqual(calls[1].args.p_command, pending.command); assert.equal(calls[1].args.p_request_key, pending.key); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('명시 닫기 응답이 유실되면 commit 대신 같은 닫기만 확인', async () => {
    await prepareName(); await page.evaluate(() => window.dropBefore = true); await save(); await button('이 요청 닫기').waitFor()
    await label('이 요청을 종료하고 입력을 다시 검토하겠습니다.').check(); await page.evaluate(() => window.dropClose = true); await button('이 요청 닫기').click()
    await page.waitForFunction(() => window.pendingRow()?.closeState === 'closing'); await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('같은 요청으로 결과 확인').click()
    await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await label('수업 이름').inputValue(), '1반 국어 수정')
    const calls = await page.evaluate(() => window.calls.filter(c => /_(commit|close)$/.test(c.name))); assert.deepEqual(calls.map(c => c.name.split('_').at(-1)), ['commit', 'close', 'close']); assert.equal(new Set(calls.map(c => c.args.p_request_key)).size, 1); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('거절된 정정은 입력을 유지하고 최신 판 재확인 없이 자동 재전송하지 않음', async () => {
    await prepareName(); await page.evaluate(() => window.conflict = true); await save(); await page.getByRole('alert').waitFor()
    await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await label('수업 이름').inputValue(), '1반 국어 수정'); assert.equal(await label('변경 근거').inputValue(), '학교 배정표의 입력 오류 정정'); assert.equal(await button('확인한 변경 반영').count(), 0)
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_commit')).length), 1)
  })
  await test('공개 수업 또는 작성 기록이 있으면 취소·담당 정정을 차단', async () => {
    await button('잘못 등록한 수업 취소').click(); await page.evaluate(() => window.blocked = 'IN_PUBLISHED_TIMETABLE'); await inspect()
    await page.getByText('공개 시간표에 연결되어 있습니다. 운영 이력을 유지하는 변경 절차를 이용하세요.', { exact: true }).waitFor(); assert.equal(await button('확인한 변경 반영').isDisabled(), true); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('학생 등록 취소와 복원은 같은 학생·수강 ID를 유지', async () => {
    await page.getByText('학생 자료 정정 (1명)', { exact: true }).click(); await button('잘못 등록한 학생 취소').click(); await inspect(); await save()
    await page.getByText('학생 자료 정정 (1명)', { exact: true }).click()
    const restore = page.getByRole('button', { name: /학생.*복원|등록 취소.*복원/ }); await restore.waitFor(); await restore.click(); await inspect(); await save()
    assert.equal(await page.evaluate(() => window.student.state), 'active'); assert.equal(await page.evaluate(() => window.student.id), 'student-one'); assert.equal(await page.evaluate(() => window.student.enrollment.id), 'enrollment-one'); assert.equal(await page.evaluate(() => window.student.version), 3)
  })
  await test('수업 보관 후 복원도 같은 수업 ID와 담당을 보존', async () => {
    await button('수업 보관').click(); await inspect(); await save(); await button('보관 수업 복원').waitFor(); await button('보관 수업 복원').click(); await inspect(); await save()
    await button('수업 보관').waitFor(); assert.equal(await page.evaluate(() => window.course.state), 'active'); assert.equal(await page.evaluate(() => window.course.id), 'course-one'); assert.deepEqual(await page.evaluate(() => window.course.teacherMemberIds), ['teacher-a'])
  })
  await test('소속 변경은 이전 정정 입력을 새 계정에 표시하지 않음', async () => {
    await prepareName(); await page.evaluate(() => window.switchMember()); await button('수업 이름·기간 정정').waitFor()
    assert.equal(await label('수업 이름').count(), 0); assert.equal(await label('변경 근거').count(), 0); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('조회 실패의 보관 입력은 명시 폐기로 나갈 수 있고 결과 미상은 폐기하지 않음', async () => {
    await prepareName(); await page.evaluate(() => window.failGet = true); await button('현재 자료 다시 확인').click()
    await page.getByText('보관한 입력 정리', { exact: true }).click(); await button('보관한 입력 버리고 돌아가기').waitFor()
    assert.equal(await button('보관한 입력 버리고 돌아가기').isDisabled(), true); await label('보관한 입력을 버리겠습니다.').check(); await button('보관한 입력 버리고 돌아가기').click()
    assert.equal(await page.evaluate(() => window.didClose), true)
    await boot(); await prepareName(); await page.evaluate(() => window.dropBefore = true); await save(); await button('같은 요청으로 결과 확인').waitFor()
    await page.evaluate(() => { window.failGet = true; window.root.unmount(); window.mount() }); await page.getByRole('alert').waitFor()
    assert.equal(await button('보관한 입력 버리고 돌아가기').count(), 0); assert.equal(await page.evaluate(() => window.pending.count()), 1)
  })
  await test('새 자료 재조회는 이전 영향 비교와 동의를 폐기하고 입력은 유지', async () => {
    await prepareName(); await label('변경 전후와 영향을 확인했습니다.').check(); await page.evaluate(() => window.course.version++)
    await button('현재 자료 다시 확인').click(); await page.getByRole('region', { name: '정정 영향 미리보기', exact: true }).waitFor({ state: 'hidden' }); await label('수업 이름').waitFor()
    assert.equal(await button('확인한 변경 반영').count(), 0); assert.equal(await label('수업 이름').inputValue(), '1반 국어 수정')
    await button('입력 보존하고 현재 판으로 다시 확인').click(); await inspect()
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview')).at(-1).args.p_intent.expectedVersion), 2); assert.equal(await button('확인한 변경 반영').isDisabled(), true)
  })
  assert.deepEqual(errors, []); console.log(`학교 자료 정정·보관 화면 ${count}개 통과`)
} finally { await browser.close() }
