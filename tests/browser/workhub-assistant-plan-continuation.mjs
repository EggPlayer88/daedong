// 실제 연결 셸에서 목록 제어가 업무 실행·유료 호출·쓰기를 대신하지 않는지 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-global-search-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const font = process.env.WORKHUB_QA_OUTPUT ? readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64') : undefined
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 950 } }), page = await context.newPage()
const errors = [], external = [], names = [], origin = 'http://127.0.0.1:5290/'
const input = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
const button = name => page.getByRole('button', { name, exact: true })
const plan = () => page.getByRole('region', { name: '나누어 진행할 업무', exact: true })
const original = '시간표 보여줘 그리고 교사 명부 보여줘'
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
async function noWrite() {
  assert.deepEqual(await page.evaluate(() => window.qa.calls.filter(row => /(?:_mutate|_execute|_commit|_ask|_confirm|_apply)$/.test(row.name))), [])
}
async function build(text = original) {
  await input().fill(text); await button('업무 나누기').click(); await plan().waitFor()
}
async function control(text) {
  await input().fill(text); await button('업무 목록 확인').click()
}
async function test(name, run) {
  await page.setViewportSize({ width: 1280, height: 950 }); await page.goto(origin + 'plan-continuation')
  if (font) await page.evaluate(async bytes => { const face = new FontFace('Pretendard Variable', `url(data:font/woff2;base64,${bytes})`, { weight: '100 900' }); document.fonts.add(await face.load()) }, font)
  await page.addScriptTag({ content: bundle }); await button('AI 비서').first().click(); await input().waitFor()
  try { await run(); await noWrite(); names.push(name); console.log('  ✓ ' + name) }
  catch (error) { console.error(await page.locator('.workhub-connected').innerText()); throw error }
}
try {
  await test('목록 없이 다음 업무를 요청해도 유료 질문이나 임의 업무로 바꾸지 않는다', async () => {
    await control('다음 업무')
    await page.getByText('보관한 업무 목록이 없습니다. 먼저 여러 업무를 나누어 주세요.', { exact: true }).waitFor()
    assert.equal(await input().inputValue(), '다음 업무'); assert.equal(await plan().count(), 0)
    assert.equal(await page.locator('.assistant-delivery-work').count(), 0)
  })
  await test('다음 업무는 첫 단계 원문만 준비하고 화면을 자동 실행하지 않는다', async () => {
    await build(); await control('다음 업무')
    assert.equal(await input().inputValue(), '시간표 보여줘')
    assert.equal(await page.locator('.assistant-delivery-work').count(), 0)
    assert.match(await plan().innerText(), /최근 선택/)
    assert.doesNotMatch(await plan().innerText(), /화면 연결됨|서버 처리 확인/)
  })
  await test('화면을 연 단계는 연결로만 표시하고 대화로 다음 업무를 이어서 준비한다', async () => {
    await build(); await control('다음 업무'); await button('바로 이동').click()
    await page.locator('[data-timetable-presentation="assistant"]').waitFor()
    assert.equal(await page.locator('.school-administration-conversation').count(), 0)
    await button('대화 보기').click(); await plan().waitFor()
    assert.match(await plan().locator('li').nth(0).innerText(), /화면 연결됨/)
    assert.doesNotMatch(await plan().innerText(), /서버 처리 확인/)
    await control('다음 단계')
    assert.equal(await input().inputValue(), '교사 명부 보여줘')
    assert.equal(await page.locator('.school-administration-conversation').count(), 0)
    if (process.env.WORKHUB_QA_OUTPUT) {
      await input().fill(''); mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
      await plan().screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'plan-desktop.png') })
    }
  })
  await test('번호로 선택해도 다음 단계 실행이나 앞선 단계 완료를 추정하지 않는다', async () => {
    await build(); await control('2번 단계')
    assert.equal(await input().inputValue(), '교사 명부 보여줘')
    assert.doesNotMatch(await plan().locator('li').nth(0).innerText(), /최근 선택|화면 연결됨|서버 처리 확인/)
    assert.match(await plan().locator('li').nth(1).innerText(), /최근 선택/)
    assert.equal(await page.locator('.assistant-delivery-work').count(), 0)
  })
  await test('마지막 다음 요청은 처음으로 돌리지 않고 원문을 유지한다', async () => {
    await build(); await control('2번 단계'); await input().fill(''); await control('다음 업무')
    await page.getByText('마지막 단계입니다. 각 업무의 처리 결과를 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await input().inputValue(), '다음 업무'); assert.equal(await page.locator('.assistant-delivery-work').count(), 0)
  })
  await test('범위 밖 번호는 보관한 단계를 바꾸거나 실행하지 않는다', async () => {
    await build(); await control('9번 단계')
    await page.getByText('이 목록은 2단계까지 있습니다. 단계 번호를 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await input().inputValue(), '9번 단계'); assert.equal(await plan().locator('li').count(), 2)
    assert.doesNotMatch(await plan().innerText(), /최근 선택|화면 연결됨|서버 처리 확인/)
  })
  await test('업무 목록 조회는 새 목록을 만들지 않고 원문과 선택 상태를 보존한다', async () => {
    await build(); await control('2번 단계'); await input().fill(''); await control('업무 목록 보여줘')
    assert.equal(await input().inputValue(), ''); assert.equal(await plan().locator('li').count(), 2)
    assert.match(await plan().locator('li').nth(1).innerText(), /최근 선택/)
    await plan().locator('summary').click(); assert.equal(await plan().locator('.assistant-text').innerText(), original)
  })
  await test('원문 재검토 명령은 기존 원문을 복원할 뿐 실행하지 않는다', async () => {
    await build(); await control('원문 다시 검토')
    assert.equal(await input().inputValue(), original); assert.equal(await plan().count(), 0)
    assert.equal(await page.locator('.assistant-delivery-work').count(), 0)
  })
  await test('목록 닫기는 보관 목록만 닫고 업무 변경을 호출하지 않는다', async () => {
    await build(); await control('업무 목록 닫아줘')
    assert.equal(await plan().count(), 0); assert.equal(await input().inputValue(), '')
    assert.equal(await page.locator('.assistant-delivery-work').count(), 0)
  })
  await test('다른 새 입력은 단계 버튼으로 덮어쓰지 않는다', async () => {
    await build(); await input().fill('지우면 안 되는 새 질문')
    assert.equal(await button('1단계 선택 · 시간표 열기').isDisabled(), true)
    await plan().locator('summary').click(); assert.equal(await button('원문 다시 검토').isDisabled(), true)
    await button('목록 닫기').click(); assert.equal(await input().inputValue(), '지우면 안 되는 새 질문')
  })
  await test('기준일이 바뀐 목록은 다음 업무로 재해석하지 않고 명시 원문 복원을 지원한다', async () => {
    const request = '내일 오후 3시부터 4시까지 협의회 일정 만들어줘 그리고 교사 명부 보여줘'
    await build(request); await page.evaluate(() => window.qa.setDate('2026-10-22'))
    await page.getByText('기준 날짜가 바뀌었습니다. 원문을 다시 검토해 주세요.', { exact: true }).waitFor()
    await control('다음 업무'); assert.equal(await input().inputValue(), '다음 업무')
    assert.equal(await page.locator('.workspace-operation').count(), 0)
    await control('원문 다시 검토'); assert.equal(await input().inputValue(), request); assert.equal(await plan().count(), 0)
  })
  await test('누락 일정 정보에 쓴 다음 업무는 현재 일정의 답변으로만 다룬다', async () => {
    await build('내일 협의회 일정 만들어줘 그리고 교사 명부 보여줘')
    await control('다음 업무'); await button('일정 초안 열기').click()
    await input().fill('다음 업무')
    assert.equal(await button('업무 목록 확인').count(), 0)
    await button('일정 정보 이어 입력').click()
    assert.equal(await input().inputValue(), '다음 업무'); assert.equal(await page.locator('.school-administration-conversation').count(), 0)
    assert.match(await plan().locator('li').nth(0).innerText(), /최근 선택/)
    assert.doesNotMatch(await plan().locator('li').nth(1).innerText(), /최근 선택/)
  })
  await test('할 일 검토 중에는 목록 조작을 잠그고 취소 후 원문을 유지한다', async () => {
    await page.evaluate(() => window.qa.qaTasks.seed())
    const request = '내 할 일 제출 자료 확인 제목을 자료 점검으로 바꿔줘'
    await build(request + ' 그리고 교사 명부 보여줘'); await control('다음 업무'); await button('내 할 일 찾기').click()
    const choices = page.getByRole('region', { name: '변경할 내 할 일', exact: true })
    await choices.getByRole('button').filter({ hasText: '2026-10-28' }).click()
    const review = page.locator('.workspace-operation[data-operation-kind="taskChange"]')
    await review.getByRole('heading', { name: '할 일 변경을 검토해 주세요', exact: true }).waitFor()
    assert.equal(await input().isDisabled(), true)
    assert.equal(await button('2단계 선택 · 교사 명부·배정').isDisabled(), true)
    assert.equal(await button('목록 닫기').isDisabled(), true)
    assert.doesNotMatch(await plan().innerText(), /서버 처리 확인/)
    await review.getByRole('button', { name: '취소', exact: true }).click()
    await review.waitFor({ state: 'detached' }); assert.equal(await input().isDisabled(), false)
    assert.equal(await input().inputValue(), '')
    await plan().locator('summary').click()
    assert.equal(await plan().locator('.assistant-text').innerText(), request + ' 그리고 교사 명부 보여줘')
    assert.match(await plan().locator('li').nth(0).innerText(), /최근 선택/)
  })
  await test('인용과 부정 요청은 보관 업무 제어로 가로채지 않는다', async () => {
    await build()
    for (const request of ['“다음 업무”', '다음 업무로 넘어가지 마', '업무 목록을 어떻게 만들면 좋을까?']) {
      await input().fill(request); assert.equal(await button('업무 목록 확인').count(), 0)
      assert.equal(await button('AI에게 요청').isDisabled(), true)
      assert.equal(await input().inputValue(), request); assert.equal(await plan().locator('li').count(), 2)
    }
  })
  await test('권한이 무효화되면 보관한 목록과 제어 입력을 노출하지 않는다', async () => {
    await build(); await control('다음 업무'); await page.evaluate(() => window.qa.deny())
    await page.locator('.connected-empty').waitFor(); assert.equal(await plan().count(), 0)
    assert.equal(await input().count(), 0)
  })
  await test('320px와 키보드 높이 화면에서 대화 단계 선택과 원문 보기가 넘치지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 430 }); await build()
    await control('다음 업무'); assert.equal(await input().inputValue(), '시간표 보여줘')
    await input().fill(''); await control('업무 목록 보여줘'); await plan().locator('summary').click()
    assert.equal(await plan().locator('.assistant-text').innerText(), original)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (process.env.WORKHUB_QA_OUTPUT) {
      mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
      await page.setViewportSize({ width: 320, height: 900 })
      await plan().screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'plan-mobile.png') })
    }
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`복합 업무 이어가기 브라우저 ${names.length}건 통과 · 외부·쓰기·유료 요청 0`)
} finally { await browser.close() }
