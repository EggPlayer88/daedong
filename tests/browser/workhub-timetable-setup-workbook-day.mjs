import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

// 실제 준비 패널·XLSX·전송 어댑터를 사용하고 RPC만 합성한다. 기존 일괄 fixture는 수정하지 않는다.
const bundle = buildSync({ stdin: { contents: readFileSync(new URL('./workhub-timetable-setup-batch-fixture.tsx', import.meta.url), 'utf8'), loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const apply = () => button('선택한 항목 순서대로 저장'), confirmation = () => field('변경 내용과 일부만 저장될 수 있음을 확인했습니다')
const writes = () => page.evaluate(() => window.calls.filter(row => row.name === 'workhub_timetable_setup_execute'))
const dateNotice = () => page.getByRole('status').filter({ hasText: /파일 기준일.*2026-10-19.*현재 기준일.*2026-10-20/ })
async function upload(buffer) {
  await field('편집한 준비 입력 엑셀 가져오기').setInputFiles({ name: '어제편집한준비.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(buffer) })
  await page.waitForFunction(() => !document.body.textContent.includes('엑셀 파일과 현재 자료를 비교하고 있습니다'))
}
async function nextDay(change = 'date') {
  await page.evaluate(change => {
    window.view.referenceDay = '2026-10-20'
    if (change === 'teacher') window.view.courses[0].teacherLabels.push('새 교사')
    if (change === 'revision') window.view.sourceRevision++
    window.snapshot = structuredClone(window.view); window.render()
  }, change)
}
let count = 0
async function test(name, run) {
  await page.goto('http://127.0.0.1:5179/setup-workbook-day'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByText('엑셀로 공간·수업 연결 한 번에 준비', { exact: true }).click(); await button('준비 입력 엑셀 내려받기').waitFor()
  await run(); count++; console.log('  ✓ ' + name)
}
try {
  await test('어제 파일을 오늘 올리면 날짜 차이를 바로 알리고 확인 전에는 저장하지 않는다', async () => {
    const bytes = await page.evaluate(() => window.makeFile())
    await nextDay(); await upload(bytes); await dateNotice().waitFor(); await apply().waitFor()
    assert.equal(await apply().isDisabled(), true); assert.equal((await writes()).length, 0)
    await confirmation().check(); await apply().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.actualWrites), 2)
    const requests = await writes(); assert.equal(requests[0].args.p_command.expectedVersion, 1); assert.equal(requests[1].args.p_command.expectedVersion, null)
  })
  await test('변경 없는 어제 파일도 날짜 대조 안내만 하고 저장 명령을 만들지 않는다', async () => {
    const bytes = await page.evaluate(() => window.makeFile('none'))
    await nextDay(); await upload(bytes); await dateNotice().waitFor()
    await page.getByText('현재 자료와 같습니다. 저장할 변경이 없습니다.', { exact: true }).waitFor()
    assert.equal((await writes()).length, 0); assert.equal(await apply().count(), 0)
  })
  await test('미리보기 중 자정이 지나면 승인을 해제하고 보관 파일 재검사와 재확인 뒤 저장한다', async () => {
    await upload(await page.evaluate(() => window.makeFile())); await confirmation().check()
    await nextDay(); await button('보관한 파일 다시 검사').waitFor()
    assert.equal(await confirmation().isChecked(), false); assert.equal(await apply().isDisabled(), true)
    await button('보관한 파일 다시 검사').click(); await dateNotice().waitFor()
    assert.equal(await confirmation().isChecked(), false); assert.equal((await writes()).length, 0)
    await confirmation().check(); await apply().click(); await page.getByText('선택한 2건을 저장했습니다.', { exact: true }).waitFor()
  })
  await test('날짜와 함께 공식 교사가 바뀌면 이전 파일을 거절하고 저장하지 않는다', async () => {
    const bytes = await page.evaluate(() => window.makeFile())
    await nextDay('teacher'); await upload(bytes); await page.getByRole('alert').filter({ hasText: /원본대조/ }).waitFor()
    assert.equal((await writes()).length, 0); assert.equal(await apply().count(), 0); assert.equal(await dateNotice().count(), 0)
  })
  await test('날짜와 판이 바뀐 보관 파일은 재검사해도 승인할 수 없고 입력은 내려받을 수 있다', async () => {
    await upload(await page.evaluate(() => window.makeFile())); await confirmation().check()
    await nextDay('revision'); await button('보관한 파일 다시 검사').click()
    await page.getByRole('alert').filter({ hasText: /기준 시트/ }).waitFor()
    assert.equal(await apply().isDisabled(), true); assert.equal(await confirmation().isChecked(), false); assert.equal((await writes()).length, 0)
    await button('보관한 편집 파일 내려받기').click()
    assert.equal(await page.evaluate(async () => window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())).find(row => row.name === '공간').rows.find(row => row[0] === 'room-a')[3]), '2')
  })
  assert.deepEqual(errors, []); console.log(`시간표 준비 엑셀 날짜 변경 브라우저 검사: ${count}개 통과`)
} finally { await browser.close() }
