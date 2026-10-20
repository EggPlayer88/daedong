import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: readFileSync(new URL('./workhub-timetable-setup-batch-fixture.tsx', import.meta.url), 'utf8'), loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-timetable-setup-batch-')); mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const apply = () => button('선택한 항목 순서대로 저장'), resume = () => button('남은 항목 다시 확인하고 이어 저장')
const confirmation = () => field('변경 내용과 일부만 저장될 수 있음을 확인했습니다')
let count = 0
async function start() { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5179/setup-batch'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByText('엑셀로 공간·수업 연결 한 번에 준비', { exact: true }).click(); await button('준비 입력 엑셀 내려받기').waitFor() }
async function test(name, run) { await start(); await run(); count++; console.log('  ✓ ' + name) }
async function upload(kind = 'two') { const buffer = Buffer.from(await page.evaluate(kind => window.makeFile(kind), kind)); await field('편집한 준비 입력 엑셀 가져오기').setInputFiles({ name: '학교준비.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }); await page.waitForFunction(() => !document.body.textContent.includes('엑셀 파일과 현재 자료를 비교하고 있습니다')) }
async function calls() { return page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_setup_execute')) }
async function reconcile(choices = {}) {
  await button('최신 자료로 남은 항목 다시 비교').click(); await field('국어 [course-a] 충돌 처리').waitFor()
  for (const select of await page.getByRole('region', { name: '충돌한 일괄 입력 다시 비교' }).getByRole('combobox').all()) { await select.selectOption('mine') }
  for (const [label, value] of Object.entries(choices)) await field(label + ' 충돌 처리').selectOption(value)
  await field('최신 자료와 내 입력의 차이 및 각 항목 선택을 확인했습니다').check(); await button('선택한 비교 결과 적용').click()
}
async function begin() { await confirmation().check(); await apply().click() }
try {
  await test('실제 내려받은 XLSX에서 학교·한글·빈 정원을 보존하고 다시 가져오면 변경이 없다', async () => {
    await button('준비 입력 엑셀 내려받기').click()
    const rows = await page.evaluate(async () => window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())).find(row => row.name === '공간').rows)
    assert.equal(rows.find(row => row[0] === 'room-b')[3], ''); assert.equal(rows.find(row => row[0] === 'room-a')[2], '과학실')
    await upload('none'); await page.getByText('현재 자료와 같습니다. 저장할 변경이 없습니다.', { exact: true }).waitFor(); assert.equal((await calls()).length, 0)
  })
  await test('변경 비교·명시 확인 뒤 공간과 수업 연결을 순차 저장하고 결과 파일을 만든다', async () => {
    await upload(); await apply().waitFor(); assert.equal(await apply().isDisabled(), true); assert.equal((await calls()).length, 0)
    assert.match(await page.getByRole('region', { name: '일괄 준비 변경 비교' }).innerText(), /class-a|1반/)
    await page.screenshot({ path: join(output, 'setup-batch-desktop.png'), fullPage: true }); await begin()
    await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.actualWrites), 2)
    const sent = await calls(); assert.equal(sent[0].args.p_command.kind, 'space_save'); assert.equal(sent[1].args.p_command.kind, 'course_link'); assert.notEqual(sent[0].args.p_request_key, sent[1].args.p_request_key)
    assert.deepEqual(await page.evaluate(() => window.view.courses[0].link.classIds), ['class-a']); assert.equal(await page.evaluate(() => window.locked), false)
    await button('일괄 저장 결과 내려받기').click(); const result = await page.evaluate(async () => window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer()))[0].rows)
    assert.equal(result.length, 3); assert.equal(result[1][3], '저장 완료'); assert.equal(result[2][4], sent[1].args.p_request_key)
  })
  await test('101개 이상 변경에서도 쪽·검색을 바꾼 선택을 보존하고 선택한 한 건만 보낸다', async () => {
    await page.evaluate(() => { for (let i = 1; i <= 105; i++) window.view.courses.push({ id: 'extra-' + String(i).padStart(3, '0'), label: '동명수업', inTimetable: true, teacherLabels: ['동명교사'], studentCount: 1, link: null }); window.snapshot = structuredClone(window.view); window.render() })
    await upload('many'); await button('다음 일괄 항목').waitFor(); await button('선택 모두 해제').click(); await button('다음 일괄 항목').click()
    await field('일괄 항목 검색').fill('extra-099'); const selected = page.getByRole('checkbox', { name: /동명수업.*extra-099/ }); await selected.check()
    await field('일괄 항목 검색').fill(''); await button('다음 일괄 항목').click(); await field('일괄 항목 검색').fill('extra-099'); assert.equal(await selected.isChecked(), true)
    await begin(); await page.getByText('선택한 1건을 저장했습니다.', { exact: true }).waitFor(); assert.equal((await calls()).length, 1); assert.equal((await calls())[0].args.p_command.courseId, 'extra-099')
  })
  await test('잘못된 정원·타학교·행 삭제·수식 파일은 저장하지 않고 한국어 오류로 안내한다', async () => {
    for (const kind of ['invalid', 'foreign', 'deleted', 'formula']) { await upload(kind); await page.getByRole('alert').first().waitFor(); assert.equal((await calls()).length, 0); assert.equal(await apply().count(), 0) }
  })
  await test('정원을 비워 둔 값은 1로 추정하지 않고 null로 저장한다', async () => {
    await upload('null'); await apply().waitFor(); await begin(); await page.getByText('선택한 1건을 저장했습니다.', { exact: true }).waitFor(); assert.equal((await calls())[0].args.p_command.input.capacity, null)
  })
  await test('새 파일 검사 실패는 이전 승인을 무효화하되 입력을 보관해 다시 검사할 수 있다', async () => {
    await upload(); await confirmation().check(); await upload('invalid'); await button('보관한 파일 다시 검사').waitFor(); assert.equal(await confirmation().isChecked(), false); assert.equal(await apply().isDisabled(), true)
    await button('보관한 파일 다시 검사').click(); await confirmation().waitFor(); assert.equal(await confirmation().isChecked(), false); await begin(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor()
  })
  await test('미리보기 후 원본 변경은 저장을 막고 편집 파일을 보관한다', async () => {
    await upload(); await confirmation().check(); await page.evaluate(() => { window.view.spaces[0].capacity = 3; window.view.spaces[0].version++; window.view.sourceRevision++; window.view.sourceFingerprint = 'b'.repeat(64); window.snapshot = structuredClone(window.view); window.render() })
    await page.getByText(/학교 자료가 바뀌어 이 파일의 저장 승인을 해제했습니다/).waitFor(); assert.equal(await apply().isDisabled(), true); assert.equal(await confirmation().isChecked(), false); assert.equal((await calls()).length, 0)
    await button('보관한 편집 파일 내려받기').click(); assert.equal(await page.evaluate(async () => window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())).find(row => row.name === '공간').rows.find(row => row[0] === 'room-a')[3]), '2')
  })
  await test('두 번째 항목의 실패는 첫 성공을 유지하고 재개 시 성공 항목을 다시 보내지 않는다', async () => {
    await upload(); await page.evaluate(() => window.rejectAt = 2); await begin(); await page.getByText('저장 완료 1건. 나머지 입력과 요청 번호를 보관했습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.actualWrites), 1); const before = await calls(); assert.equal(before.length, 2); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    await page.evaluate(() => window.rejectAt = 0); await reconcile(); await confirmation().check(); await resume().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor()
    const after = await calls(); assert.equal(after.length, 3); assert.notEqual(after[2].args.p_request_key, before[1].args.p_request_key); assert.equal(await page.evaluate(() => window.actualWrites), 2)
  })
  await test('U2 실제 공간 판 충돌을 최신 3-way 비교 후 새 키로 저장하고 미전송 수업 키는 유지한다', async () => {
    await upload(); await page.evaluate(() => { window.view.spaces[0].capacity = 9; window.view.spaces[0].version = 5 })
    await begin(); await button('최신 자료로 남은 항목 다시 비교').waitFor(); assert.equal((await calls()).length, 0); assert.equal(await resume().count(), 0)
    await button('최신 자료로 남은 항목 다시 비교').click(); await field('과학실 [room-a] 충돌 처리').waitFor(); const region = page.getByRole('region', { name: '충돌한 일괄 입력 다시 비교' })
    assert.match(await region.innerText(), /동시수업수: 9/); assert.equal(await button('선택한 비교 결과 적용').isDisabled(), true)
    await field('과학실 [room-a] 충돌 처리').selectOption('mine'); await field('국어 [course-a] 충돌 처리').selectOption('mine')
    await field('최신 자료와 내 입력의 차이 및 각 항목 선택을 확인했습니다').check(); await button('선택한 비교 결과 적용').click()
    assert.equal((await calls()).length, 0); assert.equal(await confirmation().isChecked(), false)
    await confirmation().check(); await resume().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor()
    const sent = await calls(); assert.equal(sent[0].args.p_command.expectedVersion, 5); assert.equal(sent[0].args.p_command.input.capacity, 2); assert.equal(await page.evaluate(() => window.actualWrites), 2)
  })
  await test('U2 현재 서버 값 유지 선택은 공간을 덮어쓰지 않고 남은 수업만 저장한다', async () => {
    await upload(); await page.evaluate(() => { window.view.spaces[0].capacity = 9; window.view.spaces[0].version = 5 }); await begin()
    await reconcile({ '과학실 [room-a]': 'server' }); await confirmation().check(); await resume().click()
    await page.getByText('선택한 1건을 저장했습니다.', { exact: true }).waitFor(); assert.equal((await calls()).length, 1); assert.equal((await calls())[0].args.p_command.kind, 'course_link'); assert.equal(await page.evaluate(() => window.view.spaces[0].capacity), 9)
  })
  await test('U2 비교 후 자료가 다시 바뀌면 재승인을 풀고 저장 없이 다시 충돌한다', async () => {
    await upload(); await page.evaluate(() => { window.view.spaces[0].capacity = 9; window.view.spaces[0].version = 5 }); await begin(); await reconcile()
    await page.evaluate(() => { window.view.spaces[0].capacity = 10; window.view.spaces[0].version = 6 }); await confirmation().check(); await resume().click()
    await button('최신 자료로 남은 항목 다시 비교').waitFor(); assert.equal((await calls()).length, 0)
  })
  await test('U2 충돌 3-way 비교도 320px·200% 확대에서 선택과 명시 확인을 사용할 수 있다', async () => {
    await upload(); await page.evaluate(() => { window.view.spaces[0].version = 5 }); await begin(); await button('최신 자료로 남은 항목 다시 비교').click()
    await field('과학실 [room-a] 충돌 처리').waitFor(); await page.setViewportSize({ width: 320, height: 900 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%')
    await field('과학실 [room-a] 충돌 처리').selectOption('server'); await field('국어 [course-a] 충돌 처리').selectOption('mine')
    await field('최신 자료와 내 입력의 차이 및 각 항목 선택을 확인했습니다').focus(); await page.keyboard.press('Space')
    assert.equal(await button('선택한 비교 결과 적용').isEnabled(), true); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
    await page.screenshot({ path: join(output, 'setup-conflict-mobile-200.png'), fullPage: true }); assert.equal((await calls()).length, 0)
  })
  await test('U2 최신 비교 도중 권한이 막히면 비교나 새 명령을 채택하지 않고 입력을 보관한다', async () => {
    await upload(); await page.evaluate(() => { window.view.spaces[0].version = 5 }); await begin(); await button('최신 자료로 남은 항목 다시 비교').waitFor()
    await page.evaluate(() => window.holdRead = true); await button('최신 자료로 남은 항목 다시 비교').click(); await page.waitForFunction(() => Boolean(window.releaseRead))
    await page.evaluate(() => { window.disabled = true; window.render(); window.releaseRead() }); await page.waitForTimeout(80)
    assert.equal(await page.getByRole('combobox').count(), 0); assert.equal((await calls()).length, 0); assert.equal(await page.evaluate(() => window.locked), true)
    await page.evaluate(() => { window.disabled = false; window.render() }); await reconcile(); assert.equal(await resume().isDisabled(), true)
  })
  await test('응답 유실·재마운트·조회 장애에도 원키 복구만 하고 나머지는 다시 확인 후 저장한다', async () => {
    await upload(); await page.evaluate(() => window.dropOnce = true); await begin(); await button('원래 일괄 저장 요청 결과 확인').waitFor(); assert.equal(await page.evaluate(() => window.actualWrites), 1); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.evaluate(() => { window.failRead = true; window.hideSource = true; window.root.unmount(); window.mount() }); await button('원래 일괄 저장 요청 결과 확인').waitFor()
    await page.evaluate(() => window.callsBefore = window.calls.length); await button('원래 일괄 저장 요청 결과 확인').click(); await page.waitForFunction(() => window.pending.count() === 0)
    assert.equal(await page.evaluate(() => window.calls[window.callsBefore].name), 'workhub_timetable_setup_execute'); const saved = await calls(); assert.equal(saved.length, 2); assert.equal(saved[1].args.p_recover_only, true); assert.equal(saved[0].args.p_request_key, saved[1].args.p_request_key)
    assert.equal(await page.evaluate(() => window.actualWrites), 1); await page.evaluate(() => { window.failRead = false; window.hideSource = false; window.snapshot = structuredClone(window.view); window.render() })
    await confirmation().check(); await resume().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.actualWrites), 2)
  })
  await test('접수 기록 없음은 자동 새 저장 없이 멈추고 확인 뒤 같은 요청 번호로 보낸다', async () => {
    await upload(); await page.evaluate(() => window.dropBeforeOnce = true); await begin(); await button('원래 일괄 저장 요청 결과 확인').waitFor(); const sent = await calls(); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    await button('원래 일괄 저장 요청 결과 확인').click(); await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await button('일괄 입력 정리').count(), 0); assert.equal(await page.evaluate(() => window.actualWrites), 0); assert.equal(await confirmation().isChecked(), false)
    await confirmation().check(); await resume().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor(); assert.equal((await calls())[2].args.p_request_key, sent[0].args.p_request_key)
  })
  await test('멈추기 요청은 현재 쓰기의 결과를 받은 뒤 다음 항목을 보내지 않는다', async () => {
    await upload(); await page.evaluate(() => window.holdAfterWrite = true); await begin(); await page.waitForFunction(() => Boolean(window.releaseWrite)); await button('현재 항목 처리 후 멈추기').click(); await page.evaluate(() => window.releaseWrite())
    await page.getByText('저장 완료 1건. 나머지 입력과 요청 번호를 보관했습니다.', { exact: true }).waitFor(); assert.equal((await calls()).length, 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    await confirmation().check(); await resume().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor()
  })
  await test('조회 대기 중 화면이 사라지면 다음 쓰기를 시작하지 않고 입력을 복원한다', async () => {
    await upload(); await page.evaluate(() => window.holdRead = true); await begin(); await page.waitForFunction(() => Boolean(window.releaseRead)); await page.evaluate(() => { window.root.unmount(); window.releaseRead() }); await page.waitForTimeout(80)
    assert.equal((await calls()).length, 0); await page.evaluate(() => window.mount()); await resume().waitFor(); assert.equal(await confirmation().isChecked(), false); assert.equal(await page.evaluate(() => window.locked), true)
  })
  await test('320px와 200% 글자 확대에서 비교·키보드 선택을 사용할 수 있다', async () => {
    await upload(); await page.setViewportSize({ width: 320, height: 900 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%')
    const selected = page.getByRole('checkbox', { name: /과학실.*room-a/ }); await selected.focus(); await page.keyboard.press('Space'); assert.equal(await selected.isChecked(), false)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)); await page.screenshot({ path: join(output, 'setup-batch-mobile-200.png'), fullPage: true }); assert.equal((await calls()).length, 0)
  })
  assert.deepEqual(errors, []); console.log(`시간표 준비 일괄 입력 브라우저 검사: ${count}개 통과`)
} finally { await browser.close() }
