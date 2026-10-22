import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
import { teachingRosterFixture } from '../fixtures/teaching-roster-import.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-roster-import-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1000, height: 900 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:12px"><div id="root"></div></body></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), fileInput = () => page.getByLabel('CSV 파일', { exact: true })
const confirm = () => page.getByLabel('명부 차이와 수강 기간을 확인했으며 기존 학생과 기록을 유지합니다.', { exact: true })
const row = teachingRosterFixture().row, course = teachingRosterFixture().course
let passed = 0
async function boot() { await page.goto('http://127.0.0.1:5191/roster'); await page.addScriptTag({ content: bundle }); await button('빈 명부 엑셀 양식').waitFor() }
async function csv(rows, name = '명부.csv') {
  const content = await page.evaluate(rows => window.csv(rows), rows)
  await fileInput().setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })
}
async function loaded() { await page.getByText('파일을 읽었습니다. 현재 수업 명부와 비교한 뒤 저장해 주세요.', { exact: true }).waitFor() }
async function test(name, run) {
  try { await boot(); await run(); passed++; console.log('  ✓', name) }
  catch (error) { console.error(await page.locator('body').innerText(), errors); throw error }
}
try {
  await test('CSV에서 공식 학생번호 일치·새 연결·누락 유지와 저장 전 확인을 표시', async () => {
    await csv([course.students[0], row]); await loaded()
    for (const value of ['새 연결 후보 1명', '현재 명부와 일치 1명', '파일에 없는 기존 학생 1명 유지']) await page.getByText(value, { exact: true }).waitFor()
    assert.equal(await button('확인한 자료 저장').isDisabled(), true)
    await confirm().check(); await button('확인한 자료 저장').click()
    const saved = await page.evaluate(() => window.saved)
    assert.equal(saved.length, 1); assert.equal(saved[0].roster[0].schoolStudentKey, '001001'); assert.equal(saved[0].expectedVersion, 3)
  })
  await test('실제 XLSX 읽기로 앞자리 0과 문자열 이름을 보존', async () => {
    const named = { ...row, name: '=1+1,"합성 학생"' }, bytes = await page.evaluate(row => window.file([row]), named)
    await fileInput().setInputFiles({ name: '명부.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) }); await loaded()
    assert.equal(await page.getByRole('cell', { name: '001003', exact: true }).count(), 1)
    assert.equal(await page.getByRole('cell', { name: named.name, exact: true }).count(), 1)
    await confirm().check(); await button('확인한 자료 저장').click()
    assert.equal(await page.evaluate(() => window.saved[0].file.format), 'xlsx')
  })
  await test('다른 학교의 XLSX는 거부하고 이전 파일을 유지', async () => {
    await csv([row]); await loaded()
    const bytes = await page.evaluate(row => window.file([row], true), row)
    await fileInput().setInputFiles({ name: '다른학교.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) })
    await page.getByRole('alert').filter({ hasText: '다른 학교 또는 수업의 명부 양식' }).waitFor()
    assert.equal(await page.getByRole('cell', { name: '001003', exact: true }).count(), 1); assert.equal(await button('확인한 자료 저장').isDisabled(), true)
  })
  await test('기존 학생 정보 변경은 전후 비교와 정정 필요로 저장 차단', async () => {
    await csv([{ ...course.students[0], name: '다른 이름' }, row]); await loaded()
    await page.getByText('정정 필요 1명', { exact: true }).waitFor()
    await page.getByText('이름: 현재 합성 학생 가 → 파일 다른 이름', { exact: true }).waitFor()
    assert.equal(await confirm().isDisabled(), true); assert.equal(await button('확인한 자료 저장').isDisabled(), true)
    await page.getByLabel('명부 비교 상태', { exact: true }).selectOption('correction')
    assert.equal(await page.getByRole('cell', { name: '001003', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.course.students[0].name), '합성 학생 가')
  })
  await test('수강 기간이 수업 밖이거나 기존 수강기간과 다르면 저장 차단', async () => {
    await csv([course.students[0]]); await loaded()
    await page.getByLabel('수강 시작일', { exact: true }).fill('2026-03-01')
    await page.getByRole('alert').filter({ hasText: '수강 기간은 수업 기간' }).waitFor()
    assert.equal(await confirm().isDisabled(), true)
    await page.getByLabel('수강 시작일', { exact: true }).fill('2026-03-04')
    await page.getByText('정정 필요 1명', { exact: true }).waitFor(); assert.equal(await confirm().isDisabled(), true)
  })
  await test('파일 오류 뒤에는 이전 확인을 폐기하고 명시적으로 이전 파일 재비교', async () => {
    await csv([row]); await loaded(); await confirm().check()
    await fileInput().setInputFiles({ name: '깨진명부.csv', mimeType: 'text/csv', buffer: Buffer.from('잘못된,열\n1,2') })
    await page.getByRole('alert').filter({ hasText: '이전에 읽은 입력은 유지' }).waitFor()
    assert.equal(await button('확인한 자료 저장').isDisabled(), true); assert.equal(await confirm().isChecked(), false)
    assert.equal(await page.evaluate(() => window.draft.file.name), '명부.csv')
    await button('보관한 이전 파일 다시 비교').click(); await confirm().check(); await button('확인한 자료 저장').click()
    assert.equal(await page.evaluate(() => window.saved.length), 1)
  })
  await test('서버 판이 바뀌면 파일 유지·재대조·재확인 후 새 판으로 저장', async () => {
    await csv([row]); await loaded(); await confirm().check()
    await page.evaluate(() => { const c = structuredClone(window.course); c.course.version++; window.updateCourse(c) })
    await page.getByText('현재 수업 명부가 바뀌었습니다.', { exact: true }).waitFor()
    assert.equal(await button('확인한 자료 저장').isDisabled(), true)
    await button('입력 유지하고 최신 명부와 비교').click()
    assert.equal(await confirm().isChecked(), false); await confirm().check(); await button('확인한 자료 저장').click()
    assert.equal(await page.evaluate(() => window.saved[0].expectedVersion), 4)
  })
  await test('수업 판이 같아도 학생 내용 변경을 감지하고 정정 상태를 보존', async () => {
    await csv([course.students[0]]); await loaded(); await confirm().check()
    await page.evaluate(() => { const c = structuredClone(window.course); c.students[0].name = '서버 정정 이름'; window.updateCourse(c) })
    await button('입력 유지하고 최신 명부와 비교').click()
    await page.getByText('이름: 현재 서버 정정 이름 → 파일 합성 학생 가', { exact: true }).waitFor()
    assert.equal(await confirm().isDisabled(), true); assert.equal(await page.evaluate(() => window.draft.roster[0].name), '합성 학생 가')
  })
  await test('파일 읽는 중 원본이 바뀌면 늦은 결과를 채택하지 않음', async () => {
    await csv([row]); await loaded()
    await page.evaluate(() => window.delayNext = true); await csv([{ ...row, name: '늦은 새 파일' }], '늦은파일.csv')
    await page.waitForFunction(() => Boolean(window.releaseRead))
    await page.evaluate(() => { const c = structuredClone(window.course); c.course.version++; window.updateCourse(c) })
    await page.evaluate(() => window.releaseRead())
    await page.getByRole('alert').filter({ hasText: '파일을 읽는 동안' }).waitFor()
    assert.equal(await page.evaluate(() => window.draft.file.name), '명부.csv'); assert.equal(await page.evaluate(() => window.draft.roster[0].name), row.name)
  })
  await test('읽기 취소 후 늦은 파일 응답은 이전 입력을 덮어쓰지 않음', async () => {
    await csv([row]); await loaded()
    await page.evaluate(() => window.delayNext = true); await csv([{ ...row, name: '취소된 파일' }], '취소파일.csv')
    await page.waitForFunction(() => Boolean(window.releaseRead)); await button('파일 읽기 취소').click()
    const before = await page.evaluate(() => window.changes.length)
    await page.evaluate(() => window.releaseRead()); await page.waitForTimeout(80)
    assert.equal(await page.evaluate(() => window.changes.length), before)
    assert.equal(await page.evaluate(() => window.draft.roster[0].name), row.name)
  })
  await test('컴포넌트가 사라진 뒤 파일 응답은 부모 입력에 쓰지 않음', async () => {
    await page.evaluate(() => window.delayNext = true); await csv([row])
    await page.waitForFunction(() => Boolean(window.releaseRead)); await page.evaluate(() => window.hide())
    await page.getByText('가져오기를 닫았습니다.', { exact: true }).waitFor()
    const before = await page.evaluate(() => window.changes.length)
    await page.evaluate(() => window.releaseRead()); await page.waitForTimeout(80)
    assert.equal(await page.evaluate(() => window.changes.length), before)
  })
  await test('320px에서 비교표만 내부 스크롤하고 문서 전체는 넘치지 않음', async () => {
    await page.setViewportSize({ width: 320, height: 850 }); await csv([row]); await loaded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.equal(await page.getByRole('region', { name: '명부 비교 표', exact: true }).evaluate(node => getComputedStyle(node).overflowX), 'auto')
  })
  assert.deepEqual(errors, []); console.log(`학생 명부 파일·비교 브라우저 ${passed}개 통과 · 페이지 오류 0`)
} finally { await browser.close() }
