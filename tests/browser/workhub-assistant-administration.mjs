import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ entryPoints: [join(root, 'tests/browser/workhub-assistant-administration-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 980, height: 900 } }), page = await context.newPage(), results = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px/1.6 Arial,"Malgun Gothic",sans-serif;margin:0;padding:16px;background:#f6f8fa}*{box-sizing:border-box}button{font:inherit}</style><div id="root"></div></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const writes = () => page.evaluate(() => window.calls.filter(x => x.name.endsWith('_mutate')))
async function start(section = 'transitions') { await page.setViewportSize({ width: 980, height: 900 }); await page.goto('http://127.0.0.1:5179/administration'); await page.evaluate(section => { window.initialSection = section }, section); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await (section === 'settings' ? button('구성 수정') : button('업무 인계 준비')).waitFor() }
async function test(name, action, section) { await start(section); try { await action() } catch (error) { console.error(await page.locator('body').innerText()); throw error } results.push(name); console.log('  ✓ ' + name) }
async function prepare() { await button('업무 인계 준비').click(); await page.getByLabel('인수 교사', { exact: true }).selectOption('next'); await page.getByLabel('평가 자료 · 3판').check(); await page.getByLabel('인계 내용', { exact: true }).fill('담당 수합을 인계합니다.'); await button('변경 대상 미리보기').click(); await page.getByRole('region', { name: '인계 변경 미리보기' }).waitFor() }
async function savedHandover() {
  await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.', { exact: true }).waitFor()
  // 저장 안내보다 한 렌더 늦게 전달되는 부모 잠금까지 해제돼야 다음 업무를 고를 수 있다.
  await page.getByLabel('학교 관리 업무', { exact: true }).and(page.locator(':enabled')).waitFor()
  await page.waitForFunction(() => window.locked === false && window.pending.count() === 0)
}
try {
  await test('학교 관리 분야는 선택한 인계 작업을 대화 안에서 바로 조회하고 쓰지 않는다', async () => {
    assert.equal(await page.getByLabel('학교 관리 업무', { exact: true }).inputValue(), 'transitions'); assert.equal(await page.getByRole('group', { name: '학교 관리 구분' }).count(), 0)
    assert.deepEqual(await writes(), []); assert.equal(await page.getByRole('button', { name: '업무 인계 준비' }).count(), 1)
    assert.equal(await page.getByText('학교 준비 진행 안내', { exact: true }).isVisible(), false)
  })
  await test('인계는 최신 대상·제외 자료 미리보기와 별도 확인 후에만 요청한다', async () => {
    await prepare(); assert.deepEqual(await writes(), []); assert.equal(await button('확인한 변경 요청').isDisabled(), true)
    assert.match(await page.getByRole('region', { name: '인계 변경 미리보기' }).innerText(), /인수 교사/); assert.match(await page.locator('body').innerText(), /개인 상담과 학생 자료/)
    await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check(); await button('확인한 변경 요청').click(); await savedHandover()
    assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await test('대화로 접었다 돌아와도 인계 원문·선택·미리보기는 그대로다', async () => {
    await prepare(); await button('대화 화면 보기').click(); await page.getByText('질문 입력 화면', { exact: true }).waitFor(); await button('작성하던 학교 업무 보기').click()
    assert.equal(await page.getByLabel('인계 내용', { exact: true }).inputValue(), '담당 수합을 인계합니다.'); assert.equal(await page.getByLabel('인수 교사', { exact: true }).inputValue(), 'next')
    await page.getByRole('region', { name: '인계 변경 미리보기' }).waitFor(); assert.deepEqual(await writes(), [])
  })
  await test('작성 중 다른 분야 이동 요청은 원문을 버리지 않으며 취소 뒤에도 뒤늦게 이동하지 않는다', async () => {
    await prepare(); assert.equal(await page.getByLabel('학교 관리 업무', { exact: true }).isDisabled(), true)
    await page.evaluate(() => window.setSection('settings')); assert.equal(await page.getByLabel('인계 내용', { exact: true }).inputValue(), '담당 수합을 인계합니다.')
    await button('취소').click(); await button('업무 인계 준비').waitFor(); assert.equal(await page.getByLabel('학교 관리 업무', { exact: true }).inputValue(), 'transitions'); assert.deepEqual(await writes(), [])
  })
  await test('처리 중 이동 잠금과 결과 유실 후 원키 복구를 유지한다', async () => {
    await prepare(); await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check(); await page.evaluate(() => { window.mode = 'deferred' }); await button('확인한 변경 요청').click(); await page.waitForFunction(() => typeof window.release === 'function')
    assert.equal(await page.getByLabel('학교 관리 업무', { exact: true }).isDisabled(), true); assert.equal(await button('처리 결과 확인 중…').isDisabled(), true)
    await page.evaluate(() => { window.mode = 'lost_after_save'; window.release() }); await button('원래 인계 요청 결과 확인').waitFor(); assert.equal(await page.evaluate(() => window.applied), 1)
    await page.evaluate(() => { window.mode = 'ok' }); await button('원래 인계 요청 결과 확인').click(); await savedHandover()
    const calls = await writes(); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.applied), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await test('배경 원본 판 변경은 오래된 미리보기와 확인을 취소하고 입력은 남긴다', async () => {
    await prepare(); await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check(); await page.evaluate(() => { window.resourceVersion = 4; window.refresh() }); await page.getByLabel('평가 자료 · 4판').waitFor()
    assert.equal(await page.getByRole('region', { name: '인계 변경 미리보기' }).count(), 0); assert.equal(await button('확인한 변경 요청').isDisabled(), true); assert.equal(await page.getByLabel('인계 내용', { exact: true }).inputValue(), '담당 수합을 인계합니다.'); assert.deepEqual(await writes(), [])
  })
  await test('학교 구성도 기존 원본 비교와 명시 반영을 거쳐 한 번만 저장한다', async () => {
    await button('구성 수정').click(); await page.getByLabel('학교명', { exact: true }).fill('검토한 학교명'); await page.getByLabel('변경 사유', { exact: true }).fill('교무회의 확인 자료 반영'); await button('변경 내용 검토').click()
    assert.deepEqual(await writes(), []); assert.match(await page.locator('.school-admin-changes').innerText(), /합성 중학교/); assert.match(await page.locator('.school-admin-changes').innerText(), /검토한 학교명/)
    await button('확인한 내용 반영').click(); await page.getByText(/변경 반영을 확인했습니다/).waitFor(); assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.school.configuration.schoolName), '검토한 학교명')
  }, 'settings')
  await test('학교 구성에서 인계로 옮긴 뒤 재연결해도 인계 원문을 먼저 복원한다', async () => {
    await page.getByLabel('학교 관리 업무', { exact: true }).selectOption('transitions'); await prepare(); await page.evaluate(() => window.remount())
    await page.getByLabel('인계 내용', { exact: true }).waitFor(); assert.equal(await page.getByLabel('학교 관리 업무', { exact: true }).inputValue(), 'transitions')
    assert.equal(await page.getByLabel('인계 내용', { exact: true }).inputValue(), '담당 수합을 인계합니다.'); assert.deepEqual(await writes(), [])
  }, 'settings')
  await test('재연결 시 최초 메뉴보다 결과 미확정 인계를 먼저 열어 원키로 복구한다', async () => {
    await page.getByLabel('학교 관리 업무', { exact: true }).selectOption('transitions'); await prepare(); await page.getByLabel('현재 대상과 변경 내용을 확인했습니다').check()
    await page.evaluate(() => { window.mode = 'lost_after_save' }); await button('확인한 변경 요청').click(); await button('원래 인계 요청 결과 확인').waitFor()
    await page.evaluate(() => { window.mode = 'ok'; window.remount() }); await button('원래 인계 요청 결과 확인').waitFor()
    assert.equal(await page.getByLabel('학교 관리 업무', { exact: true }).inputValue(), 'transitions'); await button('원래 인계 요청 결과 확인').click()
    await savedHandover(); const calls = await writes(); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.applied), 1)
  }, 'settings')
  await test('조회 권한 실패 중 인계 입력을 숨겨 보존하고 재조회 후 복구한다', async () => {
    await prepare(); await page.evaluate(() => { window.failRead = true; window.refresh() }); await page.getByText('현재 인계 권한과 대상을 다시 확인할 때까지 보관한 입력을 숨깁니다.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('인계 내용', { exact: true }).count(), 0); assert.deepEqual(await writes(), [])
    await page.evaluate(() => { window.failRead = false }); await button('인계 서버 다시 확인').click(); await page.getByLabel('인계 내용', { exact: true }).waitFor(); assert.equal(await page.getByLabel('인계 내용', { exact: true }).inputValue(), '담당 수합을 인계합니다.')
  })
  await test('320px에서 대상·영향·최종 확인을 가로 넘침 없이 표시한다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await prepare(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'assistant-administration-mobile.png'), fullPage: true }) }
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`학교 관리 대화 브라우저 ${results.length}건 통과`)
} finally { await browser.close() }
