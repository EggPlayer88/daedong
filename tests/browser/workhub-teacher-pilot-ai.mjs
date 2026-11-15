import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-teacher-pilot-ai-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), errors = [], external = []
const origin = 'http://127.0.0.1:5316/'
await context.route('**/*', route => { if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' }) })
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept())
let passed = 0
const field = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
const button = name => page.getByRole('button', { name, exact: true })
async function test(name, config, run) {
  await page.goto(origin + (config.view ? '?view=' + config.view : '')); await page.clock.setFixedTime(new Date('2026-11-16T03:00:00.000Z')); await page.evaluate(value => { window.pilotCase = value }, config); await page.addScriptTag({ content: bundle })
  try { await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []); passed++; console.log('  ✓ ' + name) }
  catch (error) { console.error(await page.locator('body').innerText()); console.error(await page.evaluate(() => window.qa?.calls)); throw error }
}
try {
  await test('명시된 일반 시험 교사는 같은 AI 업무 화면으로 들어가고 관리 기능은 보이지 않는다', {}, async () => {
    await field().waitFor(); assert.equal(await button('학교 관리').count(), 0); assert.equal(await page.getByText('학교 키·예산', { exact: true }).count(), 0)
    assert.equal(await page.getByText('개인 AI 기억', { exact: true }).count(), 0)
    const calls = await page.evaluate(() => window.qa.calls)
    assert(calls.filter(c => c.name === 'workhub_teacher_pilot_access').length >= 2)
    assert(calls.some(c => c.name === 'workhub_participant_context')); assert(!calls.some(c => c.name === 'workhub_context'))
  })
  await test('처음 연 AI를 닫으면 허용된 내 할 일로 돌아온다', {}, async () => {
    await field().waitFor(); await button('AI 비서 닫기').click()
    await page.getByRole('heading', { name: '내 업무', exact: true, level: 2 }).waitFor()
    assert.equal(await field().isVisible(), false)
    await button('AI 비서').first().click(); await field().waitFor()
  })
  for (const view of ['documents', 'knowledge'])
    await test('주소의 ' + view + ' 값으로 관리·문서 권한을 우회하지 못한다', { view }, async () => {
      await field().waitFor(); assert.equal(new URL(page.url()).searchParams.has('view'), false)
      const calls = await page.evaluate(() => window.qa.calls)
      assert.equal(calls.some(c => /school_admin|document|knowledge|credential|policy/.test(c.name)), false)
    })
  await test('기존 인계 주소는 인계 화면만 열고 학교 관리와 키 설정은 열지 않는다', { view: 'schoolAdmin' }, async () => {
    await page.getByRole('heading', { name: '업무 인계', exact: true }).waitFor()
    await page.locator('.school-transitions summary').click()
    await page.getByText('이 페이지에 표시할 인계 기록이 없습니다.', { exact: true }).waitFor()
    assert.equal(await button('학교 관리').count(), 0); assert.equal(await button('새 학년도 준비').count(), 0)
    assert.equal(await page.evaluate(() => window.qa.calls.some(c => /school_admin|credential|policy|annual/.test(c.name))), false)
    assert.equal(await page.evaluate(() => window.qa.calls.some(c => c.name === 'workhub_school_transition_list')), true)
  })
  await test('AI의 업무 인계 명령은 기존 교사 인계 패널로 이어진다', {}, async () => {
    await field().waitFor(); await field().fill('업무 인계 준비해줘'); await button('업무 시작').click()
    await page.getByText('이 페이지에 표시할 인계 기록이 없습니다.', { exact: true }).waitFor()
    assert.equal(await button('새 학년도 준비').count(), 0)
    assert.equal(await page.evaluate(() => window.qa.calls.some(c => /school_admin|credential|policy|annual/.test(c.name))), false)
  })
  for (const command of ['학교 관리 열어줘', '문서함 열어줘', '학교 자료 열어줘', '학교 기초 자료 보여줘', '교사 명부 보여줘', '교사 소속 연결 보여줘'])
    await test('AI 명령 ' + command + '도 허용 범위 밖 화면을 열지 않는다', {}, async () => {
      await field().waitFor(); await field().fill(command)
      await page.locator('.assistant-compose button[type="submit"]').click()
      await page.getByText(/(?:화면을|업무를) 열지 못했습니다|현재 계정에는 이 업무 메뉴가 열려 있지 않습니다/).waitFor()
      assert.equal(await field().inputValue(), command)
      const calls = await page.evaluate(() => window.qa.calls)
      assert.equal(calls.some(c => /school_admin|document|knowledge|credential|policy/.test(c.name)), false)
    })
  await test('AI 학교 자료 검색은 제외한 자료 API를 부르지 않는다', {}, async () => {
    await field().waitFor(); await field().fill('학교 자료에서 출장 찾아줘'); await button('자료 찾기').click()
    await page.getByText('현재 계정에는 이 자료 조회 메뉴가 열려 있지 않습니다. 입력은 유지했습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.qa.calls.some(c => /document|knowledge/.test(c.name))), false)
  })
  await test('교사 AI에서 기존 할 일을 선택·완료하고 원래 작업 어댑터로 저장한다', {}, async () => {
    await field().waitFor(); await page.evaluate(() => window.qa.qaTasks.seed())
    await field().fill('제출 자료 확인을 완료해줘'); await button('내 할 일 찾기').click()
    const choices = page.getByRole('region', { name: '변경할 내 할 일', exact: true })
    await choices.getByRole('button').filter({ hasText: '2026-10-28' }).click()
    const review = page.locator('.workspace-operation[data-operation-kind="taskChange"]'); await review.waitFor()
    assert.equal(await page.evaluate(() => window.qa.qaTasks.snapshot().writes), 0)
    await review.getByRole('button', { name: '확인한 할 일 완료', exact: true }).click()
    await page.waitForFunction(() => window.qa.qaTasks.snapshot().writes === 1)
    assert.equal(await page.evaluate(() => window.qa.qaTasks.snapshot().rows[1].status), 'done')
  })
  await test('교사 AI 일정은 빠진 시각을 이어 받아 검토까지 연결하고 자동 저장하지 않는다', {}, async () => {
    await field().waitFor(); await field().fill('내일 교과회의 일정 잡아줘'); await button('일정 초안 열기').click()
    await page.getByRole('region', { name: '작성 중인 일정', exact: true }).waitFor()
    await field().fill('오후 3시부터 4시'); await button('일정 정보 이어 입력').click()
    await page.getByRole('heading', { name: '새 일정을 검토해 주세요', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.qa.calls.some(c => c.name === 'workhub_calendar_save')), false)
  })
  for (const [command, label] of [['메시지 열어줘', '메시지 작성·확인'], ['수합 열어줘', '수합 작성·제출']])
    await test('교사 AI 대화가 ' + label + ' 화면으로 이어진다', {}, async () => {
      await field().waitFor(); await field().fill(command); await button('바로 이동').click()
      await page.getByRole('heading', { name: label, exact: true, level: 2 }).waitFor()
      assert.equal(await page.evaluate(() => window.qa.calls.some(c => /mutate|send|publish/.test(c.name))), false)
    })
  await test('참여 철회 뒤 작성 중 AI와 늦은 조회를 숨긴다', {}, async () => {
    await field().waitFor(); await field().fill('작성 중인 시험 입력'); await page.evaluate(() => window.qa.revoke())
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다', exact: true }).waitFor(); assert.equal(await field().count(), 0)
  })
  await test('서버가 작업 권한을 거절하면 성공·자동 재전송으로 바꾸지 않는다', { denyTask: true }, async () => {
    await field().waitFor(); await page.evaluate(() => window.qa.qaTasks.seed())
    await field().fill('제출 자료 확인을 완료해줘'); await button('내 할 일 찾기').click()
    await page.getByRole('region', { name: '변경할 내 할 일', exact: true }).getByRole('button').filter({ hasText: '2026-10-28' }).click()
    await page.locator('.workspace-operation[data-operation-kind="taskChange"]').getByRole('button', { name: '확인한 할 일 완료', exact: true }).click()
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다', exact: true }).waitFor()
    assert.equal(await field().count(), 0)
    assert.equal(await page.evaluate(() => window.qa.qaTasks.snapshot().writes), 0)
    assert.equal(await page.evaluate(() => window.qa.calls.filter(c => c.name === 'workhub_task_mutate').length), 1)
  })
  await test('다른 판의 허용은 기존 AI 화면에 조용히 재사용하지 않는다', {}, async () => {
    await field().waitFor(); await page.evaluate(() => window.qa.revise())
    await page.getByText('시험 참여 기간 또는 허용 범위가 변경됐습니다. 학교 업무 메뉴를 다시 열어 주세요.', { exact: true }).waitFor()
    assert.equal(await field().count(), 0)
  })
  for (const [name, config] of [['명단 밖 계정', { allowed: false }], ['TP1 미설치', { missing: true }]])
    await test(name + '은 기존 OP1 업무 화면만 사용한다', config, async () => {
      await page.locator('.participant-workspace').waitFor(); assert.equal(await field().count(), 0)
    })
  for (const [name, config] of [['권한 조회 실패', { failure: true }], ['다른 학교 응답', { capability: { schoolId: 'other-school' } }]])
    await test(name + '를 AI 허용으로 처리하지 않는다', config, async () => {
      await button('참여 범위 다시 확인').waitFor(); assert.equal(await field().count(), 0)
      assert.equal(await page.evaluate(() => window.qa.calls.some(c => c.name === 'workhub_participant_context')), false)
    })
  await test('시험 기간이 끝나면 추가 조작 없이 AI 화면이 닫힌다', { short: true }, async () => {
    await field().waitFor(); await page.getByText('시험 참여 기간이 끝났습니다. 관리자에게 참여 기간을 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await field().count(), 0)
  })
  console.log(`교사 한정 AI 연결 ${passed}/${passed} 통과 · 합성 인증/RPC · 실제 외부 및 유료 호출 0`)
} finally { await browser.close() }
