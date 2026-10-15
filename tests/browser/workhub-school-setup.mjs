// 운영 서버 없이 실제 초기 설정 화면의 파일 보관·입력 보호·검토 흐름을 실행한다.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({
  stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BrowserRouter,Routes,Route,Link,useLocation} from 'react-router-dom';
    import {SchoolSetupWorkspace} from './apps/workhub/src/setup/SchoolSetupWorkspace';
    import hostStyles from './apps/main/src/styles.css';
    function Frame(){const location=useLocation();return <><style>{hostStyles}</style><header style={{padding:16,display:'flex',gap:16,flexWrap:'wrap'}}><Link to="/legacy">기존 메뉴</Link><Link to="/workhub/setup">학교 설정 준비</Link><output data-testid="router-location">{location.pathname+location.search}</output></header><Routes><Route path="/workhub/setup" element={<main className="content"><SchoolSetupWorkspace/></main>}/><Route path="*" element={<main><h1>기존 학교 메뉴</h1></main>}/></Routes></>}
    createRoot(document.getElementById('root')).render(<BrowserRouter><Frame/></BrowserRouter>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
}).outputFiles[0].text
const origin = 'http://127.0.0.1:5176', output = process.env.WORKHUB_QA_OUTPUT
const browser = await launchBrowser()
let passed = 0, failed = 0
const results = []
const schoolName = page => page.getByLabel('학교명', { exact: true })
const button = (page, name) => page.getByRole('button', { name, exact: true })
const dialog = page => page.getByRole('dialog')
const confirmImport = page => button(page, '불러온 초안으로 바꾸기')
const fileInput = page => page.locator('input[type=file]')
const field = (page, path) => page.locator(`[data-setup-path="${path}"]`)
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const envelope = input => JSON.stringify({ kind: 'school-setup-draft', schemaVersion: 1, deploymentState: 'not_applied', input })
function completeDraft(count = 1) {
  return { draftId: 'draft-school-qa', schoolName: '가상초등학교', schoolCode: 'qa-school', schoolType: 'elementary', gradeCount: '6', schoolYear: '2028', startsOn: '2028-01-01', lastDay: '2028-12-31',
    terms: [{ id: 'draft-term-qa', termNo: '1', name: '봄학기', startsOn: '2028-02-01', lastDay: '2028-02-29' }],
    departments: [{ id: 'draft-department-qa', name: '교무부' }],
    classes: Array.from({ length: count }, (_, index) => ({ id: 'draft-class-' + index, grade: '1', classNo: '', name: '1학년 ' + (index + 1) + '반', kind: 'multigrade' })),
  }
}
async function file(page, contents, name = '학교설정_초안.json') {
  await fileInput(page).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents) })
}
async function importDraft(page, draft) { await file(page, envelope(draft)); await confirmImport(page).click(); await dialog(page).waitFor({ state: 'hidden' }) }
async function download(page, name) {
  const pending = page.waitForEvent('download'); await button(page, name).click(); const result = await pending
  assert.equal(await result.failure(), null)
  return { fileName: result.suggestedFilename(), contents: await readFile(await result.path(), 'utf8') }
}
async function screenshot(page, name) { if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, name), fullPage: true }) } }
async function test(name, run, viewport = { width: 1280, height: 1000 }) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], unexpectedRequests = []
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', entry => entry.accept())
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || request.method() !== 'GET' || url.pathname.startsWith('/api')) { unexpectedRequests.push({ method: request.method(), url: request.url() }); return route.abort() }
    return route.fulfill(url.pathname === '/__setup.js' ? { contentType: 'text/javascript', body: bundle } : { contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/__setup.js"></script></body></html>' })
  })
  try {
    await page.goto(origin + '/legacy'); await page.getByRole('link', { name: '학교 설정 준비', exact: true }).click()
    await page.getByRole('heading', { name: '학교 초기 설정 준비', exact: true }).waitFor()
    await run(page)
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedRequests, [])
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [])
    passed++; results.push({ name, passed: true }); console.log('  ✓ ' + name)
  } catch (error) {
    failed++; results.push({ name, passed: false, error: error.stack }); console.error('  ✗ ' + name + ': ' + error.stack)
    console.error((await page.locator('body').innerText()).slice(-2600))
  } finally { await context.close() }
}
async function fillComplete(page) {
  await schoolName(page).fill('가상초등학교'); await page.getByLabel('학교 구분 코드', { exact: true }).fill('qa-school')
  await page.getByLabel('학교급', { exact: true }).selectOption('elementary'); await page.getByLabel('운영 학년 수', { exact: true }).fill('6')
  await page.getByLabel('학년도', { exact: true }).fill('2028'); await page.getByLabel('학년도 시작일', { exact: true }).fill('2028-01-01'); await page.getByLabel('학년도 마지막 날 (포함)', { exact: true }).fill('2028-12-31')
  await button(page, '학기 추가').click(); await page.getByLabel('학기 번호', { exact: true }).fill('1'); await page.getByLabel('학기 이름', { exact: true }).fill('봄학기')
  await page.getByLabel('학기 시작일', { exact: true }).fill('2028-02-01'); await page.getByLabel('학기 마지막 날 (포함)', { exact: true }).fill('2028-02-29')
  await button(page, '부서 추가').click(); await page.getByLabel('부서 이름', { exact: true }).fill('교무부')
  await button(page, '학급 추가').click(); await page.getByLabel('학년', { exact: true }).fill('1'); await page.getByLabel('학급 이름', { exact: true }).fill('1학년 가반'); await page.getByLabel('학급 유형', { exact: true }).selectOption('multigrade')
}

try {
  await test('빈 입력의 오류 요약·필드 설명 연결과 해당 항목 초점을 제공한다', async page => {
    await button(page, '입력 내용 검사').click(); await field(page, 'review').waitFor(); await settle(page)
    assert.equal(await field(page, 'review').evaluate(element => element === document.activeElement), true)
    assert.equal(await schoolName(page).getAttribute('aria-invalid'), 'true')
    const references = await schoolName(page).getAttribute('aria-describedby')
    assert.ok(references); assert.match(await page.locator(`[id="${references}"]`).innerText(), /학교 이름/)
    await button(page, '학교 이름은(는) 1~100자로 입력해 주세요.').click(); await settle(page)
    assert.equal(await schoolName(page).evaluate(element => element === document.activeElement), true)
    assert.equal(await button(page, '검토용 계획 내려받기').count(), 0)
  })
  await test('실제 필드를 입력해 윤년 마지막 날을 종료일 미포함 계획 파일로 내려받는다', async page => {
    await fillComplete(page); await button(page, '입력 내용 검사').click()
    const result = await download(page, '검토용 계획 내려받기'), plan = JSON.parse(result.contents)
    assert.match(result.fileName, /검토용계획/); assert.equal(plan.kind, 'school-setup-plan'); assert.equal(plan.deploymentState, 'not_applied')
    assert.equal(plan.terms[0].endsBefore, '2028-03-01'); assert.equal(plan.academicYear.endsBefore, '2029-01-01')
    assert.equal(plan.classes[0].classNo, null); assert.equal(plan.classes[0].kind, 'multigrade')
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented }), true)
    await screenshot(page, 'school-setup-desktop.png')
  })
  await test('미완성 작성 초안은 내려받고 다시 불러와 같은 입력과 빈칸을 복원한다', async page => {
    await schoolName(page).fill('작성 중인 학교')
    const result = await download(page, '작성 초안 내려받기'), stored = JSON.parse(result.contents)
    assert.equal(stored.kind, 'school-setup-draft'); assert.equal(stored.input.schoolYear, '')
    await schoolName(page).fill('바뀐 임시 이름'); await file(page, result.contents)
    assert.equal(await schoolName(page).inputValue(), '바뀐 임시 이름'); await confirmImport(page).click()
    assert.equal(await schoolName(page).inputValue(), '작성 중인 학교'); assert.equal(await page.getByLabel('학년도', { exact: true }).inputValue(), '')
  })
  await test('손상 JSON·검토용 계획·큰 파일을 거부해도 현재 입력은 유지한다', async page => {
    await schoolName(page).fill('유지할 현재 입력')
    for (const [contents, message] of [ ['{', 'JSON 파일을 읽지 못했습니다'], [JSON.stringify({ kind: 'school-setup-plan' }), '지원하는 학교 설정 초안 파일이 아닙니다'], [Buffer.alloc(1_000_001, 'a'), '파일은 1,000KB 이내'] ]) {
      await file(page, contents); await page.getByRole('alert').filter({ hasText: message }).waitFor()
      assert.equal(await schoolName(page).inputValue(), '유지할 현재 입력'); assert.equal(await schoolName(page).isDisabled(), false)
      assert.equal(await dialog(page).isVisible(), false)
    }
  })
  await test('정상 파일도 교체 확인을 먼저 거치며 취소는 현재 초안을 그대로 남긴다', async page => {
    await schoolName(page).fill('현재 학교'); await file(page, envelope(completeDraft()))
    await dialog(page).waitFor(); await settle(page)
    assert.equal(await button(page, '현재 초안 유지').evaluate(element => element === document.activeElement), true)
    assert.equal(await schoolName(page).inputValue(), '현재 학교')
    await button(page, '현재 초안 유지').click(); assert.equal(await schoolName(page).inputValue(), '현재 학교')
    await file(page, envelope(completeDraft())); await confirmImport(page).click()
    assert.equal(await schoolName(page).inputValue(), '가상초등학교'); assert.equal(await field(page, 'review').count(), 0)
  })
  await test('파일 읽기 실패와 지연에서는 현재 입력을 보존하고 확인 전 교체를 막는다', async page => {
    await schoolName(page).fill('파일 실패에도 보관')
    await page.evaluate(() => { window.setupOriginalText = File.prototype.text; File.prototype.text = () => Promise.reject(new Error('합성 파일 읽기 실패')) })
    await file(page, envelope(completeDraft())); await page.getByRole('alert').filter({ hasText: '합성 파일 읽기 실패' }).waitFor()
    assert.equal(await schoolName(page).inputValue(), '파일 실패에도 보관'); assert.equal(await schoolName(page).isDisabled(), false)
    await page.evaluate(() => { File.prototype.text = function() { const current = this; return new Promise((resolve, reject) => { window.releaseSetupFile = () => window.setupOriginalText.call(current).then(resolve, reject) }) } })
    await file(page, envelope(completeDraft())); await page.getByRole('status').filter({ hasText: '초안 파일을 확인하는 중' }).waitFor()
    assert.equal(await schoolName(page).isDisabled(), true); assert.equal(await button(page, '초안 파일 불러오기').isDisabled(), true)
    assert.equal(await schoolName(page).inputValue(), '파일 실패에도 보관')
    await page.evaluate(() => window.releaseSetupFile()); await dialog(page).waitFor()
    assert.equal(await schoolName(page).inputValue(), '파일 실패에도 보관'); await button(page, '현재 초안 유지').click()
    assert.equal(await schoolName(page).inputValue(), '파일 실패에도 보관'); assert.equal(await schoolName(page).isDisabled(), false)
  })
  await test('파일 내려받기 실패를 알리고 현재 입력과 이동 보호를 유지한다', async page => {
    await schoolName(page).fill('내려받기 실패에도 보관')
    await page.evaluate(() => { URL.createObjectURL = () => { throw Error('합성 내보내기 실패') } })
    await button(page, '작성 초안 내려받기').click(); await page.getByRole('alert').filter({ hasText: '합성 내보내기 실패' }).waitFor()
    assert.equal(await schoolName(page).inputValue(), '내려받기 실패에도 보관')
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented }), true)
  })
  await test('검사 이후 수정하면 이전 검토 결과와 계획 다운로드를 해제한다', async page => {
    await importDraft(page, completeDraft()); await button(page, '입력 내용 검사').click(); await button(page, '검토용 계획 내려받기').waitFor()
    await schoolName(page).fill('수정한 학교'); assert.equal(await button(page, '검토용 계획 내려받기').count(), 0)
    assert.equal(await field(page, 'review').count(), 0)
    await button(page, '입력 내용 검사').click(); await button(page, '검토용 계획 내려받기').waitFor()
    await button(page, '학급 1 삭제').click(); assert.equal(await field(page, 'review').count(), 0)
    assert.equal(await field(page, 'add-classes').evaluate(element => element === document.activeElement), true)
  })
  await test('20행을 넘는 학급의 숨은 오류도 해당 페이지와 입력으로 바로 이동한다', async page => {
    const draft = completeDraft(45); draft.classes[24].name = ''
    await importDraft(page, draft)
    assert.equal(await page.locator('.setup-class-row').count(), 20)
    assert.equal(await field(page, 'classes.24.name').count(), 0)
    await button(page, '입력 내용 검사').click(); await button(page, '학급 이름은(는) 1~30자로 입력해 주세요.').click(); await settle(page)
    assert.equal(await field(page, 'classes.24.name').evaluate(element => element === document.activeElement), true)
    assert.equal(await field(page, 'classes.24.name').getAttribute('aria-invalid'), 'true')
    const references = await field(page, 'classes.24.name').getAttribute('aria-describedby')
    assert.match(await page.locator(`[id="${references}"]`).innerText(), /학급 이름/)
    assert.equal(await page.locator('.setup-class-row').count(), 20)
    assert.match(await page.getByRole('navigation', { name: '학급 목록 페이지', exact: true }).innerText(), /2 \/ 3쪽/)
  })
  await test('초안 비우기를 취소하면 보관하고 확인하면 입력과 이동 잠금을 정리한다', async page => {
    await schoolName(page).fill('비우기 전에 확인'); await button(page, '현재 초안 비우기').click(); await button(page, '현재 초안 유지').click()
    assert.equal(await schoolName(page).inputValue(), '비우기 전에 확인')
    await button(page, '현재 초안 비우기').click(); await button(page, '초안 비우기').click()
    assert.equal(await schoolName(page).inputValue(), ''); assert.equal(await button(page, '현재 초안 비우기').isDisabled(), true)
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented }), false)
    await page.getByRole('link', { name: '기존 메뉴', exact: true }).click(); await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
  })
  await test('실제 SPA 링크·뒤로가기는 미저장 입력과 차단 안내를 보존하고 비운 뒤 이동한다', async page => {
    await schoolName(page).fill('이동해도 유실되면 안 되는 입력'); const before = page.url()
    await page.getByRole('link', { name: '기존 메뉴', exact: true }).click(); await settle(page); assert.equal(page.url(), before)
    await page.getByRole('status').filter({ hasText: '현재 입력을 보호하기 위해 이동을 멈췄습니다' }).waitFor()
    await page.goBack(); await page.waitForURL(before); assert.equal(await schoolName(page).inputValue(), '이동해도 유실되면 안 되는 입력')
    await button(page, '현재 초안 비우기').click(); await button(page, '초안 비우기').click()
    await page.getByRole('link', { name: '기존 메뉴', exact: true }).click(); await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
  })
  await test('작은 화면에서 키보드·Escape로 확인창을 취소하고 가로 넘침 없이 입력한다', async page => {
    await fillComplete(page); await button(page, '입력 내용 검사').click(); await button(page, '검토용 계획 내려받기').waitFor()
    await screenshot(page, 'school-setup-390.png')
    await page.setViewportSize({ width: 320, height: 800 })
    await button(page, '현재 초안 비우기').focus(); await page.keyboard.press('Enter'); await dialog(page).waitFor(); await settle(page)
    assert.equal(await button(page, '현재 초안 유지').evaluate(element => element === document.activeElement), true)
    await page.keyboard.press('Escape'); await dialog(page).waitFor({ state: 'hidden' }); await settle(page)
    assert.equal(await button(page, '현재 초안 비우기').evaluate(element => element === document.activeElement), true)
    assert.equal(await schoolName(page).inputValue(), '가상초등학교')
    const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes))
  }, { width: 390, height: 844 })
} finally { await browser.close(); if (output) { await mkdir(output, { recursive: true }); await writeFile(join(output, 'results.json'), JSON.stringify({ passed, failed, results }, null, 2)) } }
console.log('\n학교 초기 설정 브라우저 ' + passed + '개 통과, ' + failed + '개 실패')
if (failed) process.exitCode = 1
