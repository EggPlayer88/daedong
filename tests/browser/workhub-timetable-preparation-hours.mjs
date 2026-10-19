import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: readFileSync(new URL('./workhub-timetable-preparation-hours-fixture.tsx', import.meta.url), 'utf8'), loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-timetable-preparation-hours-')); mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
const apply = () => button('선택한 시수를 준비 초안에 반영'), confirm = () => field('선택한 시수와 기존 활동 합계를 확인했으며 준비 초안에 반영합니다')
let count = 0
async function start() { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5179/preparation-hours'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByText('엑셀로 주당 시수 한 번에 준비', { exact: true }).click(); await button('준비 시수 엑셀 내려받기').waitFor() }
async function test(name, run) { await start(); await run(); assert.equal(await page.evaluate(() => window.networkCalls), 0); count++; console.log('  ✓ ' + name) }
async function upload(kind = 'two', wait = true) { const buffer = Buffer.from(await page.evaluate(kind => window.makeFile(kind), kind)); await field('준비 시수 엑셀 불러오기').setInputFiles({ name: '준비시수.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }); if (wait) await page.waitForFunction(() => !document.body.textContent.includes('시수 엑셀과 준비 초안을 비교하고 있습니다')) }
try {
 await test('내려받은 실제 XLSX의 수업 ID·공식배정을 보존하며 무변경 왕복은 초안을 바꾸지 않는다', async () => {
  await button('준비 시수 엑셀 내려받기').click(); const sheets = await page.evaluate(async () => window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())))
  assert.equal(sheets.find(row => row.name === '주당시수').rows[1][0], 'course-a'); assert.ok(JSON.stringify(sheets).includes('김교사'))
  await upload('none'); await page.getByText('현재 시수와 같습니다. 반영할 변경이 없습니다.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.applied.length), 0); assert.equal(await page.evaluate(() => window.locked), false)
 })
 await test('변경 비교와 명시 확인 뒤 선택한 시수만 반영하고 일과·활동·제목은 보존한다', async () => {
  await upload(); await apply().waitFor(); assert.equal(await apply().isDisabled(), true); assert.equal(await page.evaluate(() => window.locked), true)
  await field('국어 [course-b]').uncheck(); await confirm().check(); await page.screenshot({ path: join(output, 'preparation-hours-desktop.png'), fullPage: true }); await apply().click()
  await page.getByText(/선택한 1개 수업의 시수를 준비 초안에 반영했습니다/).waitFor()
  const state = await page.evaluate(() => ({ draft: window.draft, before: window.before, applied: window.applied.length, locked: window.locked }))
  assert.equal(state.applied, 1); assert.equal(state.draft.plans[0].weeklyPeriods, 2); assert.equal(state.draft.plans[1].weeklyPeriods, 1); assert.deepEqual(state.draft.slots, state.before.slots); assert.equal(state.draft.title, state.before.title); assert.deepEqual(state.draft.plans.map(row => row.blocks), state.before.plans.map(row => row.blocks)); assert.equal(state.locked, false)
 })
 await test('빈칸·공식시수 수정·수업 삭제·타학교·공식배정 변조를 거부한다', async () => {
  for (const kind of ['invalid', 'fixed', 'deleted', 'foreign', 'teacher']) { await upload(kind); await page.getByRole('alert').first().waitFor(); assert.equal(await page.evaluate(() => window.applied.length), 0); assert.equal(await apply().count(), 0) }
 })
 await test('0시수는 명시 입력으로 미리 보이며 기존 활동을 자동 삭제하지 않는다', async () => {
  await upload('zero'); await confirm().check(); await apply().click(); const state = await page.evaluate(() => window.draft); assert.equal(state.plans[0].weeklyPeriods, 0); assert.equal(state.plans[0].blocks.length, 1)
 })
 await test('새 파일 오류 뒤 기존 파일·선택을 보관하고 재검사로만 반영 승인을 되살린다', async () => {
  await upload(); await field('국어 [course-b]').uncheck(); await confirm().check(); await upload('invalid'); await button('보관한 시수 파일 다시 검사').waitFor(); assert.equal(await confirm().isChecked(), false); assert.equal(await apply().isDisabled(), true); assert.equal(await field('국어 [course-b]').isChecked(), false)
  await button('보관한 시수 파일 내려받기').click(); assert.equal(await page.evaluate(async () => window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())).find(row => row.name === '주당시수').rows[1][6]), '2')
  await button('보관한 시수 파일 다시 검사').click(); assert.equal(await confirm().isChecked(), false); await confirm().check(); await apply().click(); await page.waitForFunction(() => window.applied.length === 1)
 })
 await test('재마운트와 자료 조회 실패에서도 미반영 선택을 보관하고 승인은 다시 받는다', async () => {
  await upload(); await field('국어 [course-b]').uncheck(); await confirm().check(); await page.evaluate(() => { window.root.unmount(); window.hideSource = true; window.disabled = true; window.mount() })
  await page.getByRole('region', { name: '준비 시수 변경 비교' }).waitFor(); assert.equal(await field('국어 [course-b]').isChecked(), false); assert.equal(await apply().isDisabled(), true); assert.equal(await confirm().isChecked(), false)
  await page.evaluate(() => { window.hideSource = false; window.disabled = false; window.render() }); await confirm().check(); await apply().click(); await page.waitForFunction(() => window.applied.length === 1)
 })
 await test('미리보기 이후 기준판 또는 준비 입력 변경은 원래 파일을 보존하고 적용을 막는다', async () => {
  await upload(); await confirm().check(); await page.evaluate(() => { window.draft = { ...window.draft, title: '다른 입력' }; window.render() }); await page.getByText(/학교 자료나 준비 초안이 바뀌어 반영을 멈췄습니다/).waitFor(); assert.equal(await apply().isDisabled(), true); assert.equal(await confirm().isChecked(), false); assert.equal(await page.evaluate(() => window.applied.length), 0)
 })
 await test('파일 읽는 동안 자료 변경은 늦은 파일의 미리보기와 반영을 차단한다', async () => {
  await page.evaluate(() => window.deferFile = true); await upload('two', false); await page.waitForFunction(() => Boolean(window.releaseFile)); assert.equal(await page.evaluate(() => window.locked), true)
  await page.evaluate(() => { window.source = { ...window.source, sourceRevision: 2 }; window.render() }); await page.evaluate(() => window.releaseFile()); await page.getByRole('alert').waitFor(); assert.equal(await apply().count(), 0); assert.equal(await page.evaluate(() => window.locked), false)
 })
 await test('읽는 동안 권한이 잠시 중단되었다 복구되어도 그 파일을 자동 승인하지 않는다', async () => {
  await page.evaluate(() => window.deferFile = true); await upload('two', false); await page.waitForFunction(() => Boolean(window.releaseFile)); await page.evaluate(() => { window.disabled = true; window.render() }); await page.getByText(/다른 편집을 마치거나 현재 자료를 확인한 뒤/).waitFor(); await page.evaluate(() => { window.disabled = false; window.render() }); await page.evaluate(() => window.releaseFile()); await page.getByRole('alert').waitFor(); assert.equal(await apply().count(), 0)
 })
 await test('다른 회원으로 바뀌면 이전 파일과 늦은 읽기 결과를 표시하지 않는다', async () => {
  await upload(); await page.evaluate(() => window.deferFile = true); await upload('two', false); await page.waitForFunction(() => Boolean(window.releaseFile)); await page.evaluate(() => { window.member = { ...window.member, id: 'member-b', userId: 'user-b' }; window.render() }); await page.evaluate(() => window.releaseFile()); await page.waitForFunction(() => !window.locked); assert.equal(await page.getByRole('region', { name: '준비 시수 변경 비교' }).count(), 0); assert.equal(await page.evaluate(() => window.applied.length), 0)
 })
 await test('마운트 해제 후 늦은 파일 응답은 저장하지 않고 기존 미반영 파일만 복원한다', async () => {
  await upload(); await page.evaluate(() => window.deferFile = true); await upload('zero', false); await page.waitForFunction(() => Boolean(window.releaseFile)); await page.evaluate(() => window.root.unmount()); await page.evaluate(() => window.releaseFile()); await page.evaluate(() => window.mount()); await button('보관한 시수 파일 다시 검사').waitFor(); await button('보관한 시수 파일 다시 검사').click(); assert.equal(await field('국어 [course-a]').isChecked(), true); assert.equal(await page.evaluate(() => window.applied.length), 0)
 })
 await test('검색·여러 쪽 이동 후 선택을 유지하며 선택한 한 수업만 반영한다', async () => {
  await page.evaluate(() => window.expand(45)); await upload('many'); await button('시수 선택 모두 해제').click(); await button('다음 시수 변경').click(); await field('시수 변경 수업 검색').fill('extra-041'); await field('동명 수업 [extra-041]').check(); await field('시수 변경 수업 검색').fill(''); await button('다음 시수 변경').click(); await field('시수 변경 수업 검색').fill('extra-041'); assert.equal(await field('동명 수업 [extra-041]').isChecked(), true); await confirm().check(); await apply().click()
  const changed = await page.evaluate(() => window.draft.plans.filter(row => row.weeklyPeriods === 2 && row.courseId !== 'course-fixed').map(row => row.courseId)); assert.deepEqual(changed, ['extra-041'])
 })
 await test('미반영 파일 정리는 확인을 거치고 현재 초안은 유지한다', async () => {
  await upload(); await button('시수 파일 미리보기 정리').click(); await button('시수 미리보기 계속 보기').click(); assert.equal(await apply().count(), 1); await button('시수 파일 미리보기 정리').click(); await button('미반영 시수 버리기').click(); await page.waitForFunction(() => !window.locked); assert.deepEqual(await page.evaluate(() => window.draft), await page.evaluate(() => window.before)); assert.equal(await apply().count(), 0)
 })
 await test('320px와 200% 글자 확대에서도 시수 비교와 키보드 선택을 사용할 수 있다', async () => {
  await upload(); await page.setViewportSize({ width: 320, height: 900 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%'); await field('국어 [course-a]').focus(); await page.keyboard.press('Space'); assert.equal(await field('국어 [course-a]').isChecked(), false); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)); await page.screenshot({ path: join(output, 'preparation-hours-mobile-200.png'), fullPage: true })
 })
 assert.deepEqual(errors, []); console.log(`시간표 준비 시수 엑셀 브라우저 검사: ${count}개 통과`)
} finally { await browser.close() }
