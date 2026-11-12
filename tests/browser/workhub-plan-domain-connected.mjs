import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-plan-domain-connected-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), errors = [], external = [], diagnostics = [], origin = 'http://127.0.0.1:5306/'
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true }), plan = () => page.getByRole('region', { name: '나누어 진행할 업무', exact: true })
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept()); page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
await context.route('**/*', route => { if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' }) })
let passed = 0
async function begin(first, action) {
  await field('질문 또는 부탁할 일').fill(`1. ${first}\n2. 시간표 보여줘`); await button('업무 나누기').click(); await plan().waitFor(); await plan().getByRole('button', { name: /^1단계 선택/ }).click(); await button(action).click()
}
async function talk() { await button('대화 보기').click(); await plan().waitFor() }
async function configuration(name = '수정한 학교 이름') { await button('구성 수정').click(); await field('학교명').fill(name); await field('변경 사유').fill('목록에 복제하지 않을 구성 변경 사유'); await button('변경 내용 검토').click(); await button('확인한 내용 반영').waitFor() }
async function configSaved() { await button('구성 수정').and(page.locator(':enabled')).waitFor() }
async function createSource(title = '첫 번째 학교 자료') {
  await button('자료 초안 등록').click(); await field('제목').fill(title); await field('근거 위치').fill('제3조 2항'); await field('확인한 원문').fill('AI 목록에 옮기지 않을 자료 원문'); await button('초안 저장').click()
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).waitFor()
}
const article = title => page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
async function sourceAction(title, action) { await article(title).getByRole('button', { name: action === 'publish' ? '게시 검토' : '게시 종료', exact: true }).click(); await field('확인 근거 또는 사유').fill('목록에 옮기지 않을 게시 판단 사유'); await button('확인한 변경 적용').click() }
async function sourceSaved() { await button('자료 초안 등록').and(page.locator(':enabled')).waitFor() }
async function test(name, run) {
  try {
    await page.goto(origin); await page.clock.setFixedTime(new Date('2026-11-12T03:00:00.000Z')); await page.addScriptTag({ content: bundle }); await button('AI 비서').first().click(); await field('질문 또는 부탁할 일').waitFor()
    await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.evaluate(() => window.qa.calls.filter(row => /assistant.*(execute|generate|chat)|ai.*(generate|chat)/.test(row.name)).length), 0)
    passed++; console.log('  ✓ ' + name)
  } catch (error) { console.error(await page.locator('.workhub-connected').innerText()); console.error('화면 오류', errors, diagnostics); console.error('상태', await page.evaluate(() => ({ calls: window.qa.calls, writes: window.qa.writes }))); throw error }
}
try {
  await test('학교 기초 자료 전문단계는 검토만으로 완료하지 않고 구성 저장 접수를 표시한다', async () => {
    await begin('학교 기초 자료 보여줘', '업무 시작'); await configuration(); assert.equal(await page.evaluate(() => window.qa.configurationWrites), 0); assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0)
    await button('확인한 내용 반영').click(); await configSaved(); await talk(); assert.match(await plan().innerText(), /학교 기본 구성 저장/); assert.equal(await plan().locator('[data-outcome="recorded"]').count(), 1); assert.doesNotMatch(await plan().innerText(), /목록에 복제하지 않을|수정한 학교 이름/)
  })
  await test('학교 구성 접수 유실은 같은 명령·원키 복구 뒤 한 번만 목록에 반영한다', async () => {
    await begin('학교 기초 자료 보여줘', '업무 시작'); await configuration(); await page.evaluate(() => { window.qa.unknown = 'configuration' }); await button('확인한 내용 반영').click(); await button('같은 요청으로 결과 확인').waitFor()
    assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 0); await button('같은 요청으로 결과 확인').click(); await configSaved(); await talk(); assert.match(await plan().innerText(), /학교 기본 구성 저장/); assert.equal(await plan().getByText(/이전 처리/).count(), 0)
    const calls = await page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_school_admin_mutate')); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.qa.configurationWrites), 1)
  })
  await test('학교 구성의 다른 학년도·원본 저장은 처음 선택한 단계 결과에 합치지 않는다', async () => {
    await begin('학교 기초 자료 보여줘', '업무 시작'); await configuration(); await button('확인한 내용 반영').click(); await configSaved(); await talk(); await button('작성하던 업무 보기').click()
    await field('조회 학년도').selectOption('2027'); await button('구성 수정').and(page.locator(':enabled')).waitFor(); await configuration('다른 학년도 학교 이름'); await button('확인한 내용 반영').click(); await configSaved(); await talk()
    assert.match(await plan().innerText(), /학교 기본 구성 저장/); assert.equal(await plan().getByText(/이전 처리/).count(), 0); assert.equal(await page.evaluate(() => window.qa.configurationWrites), 2)
    const calls = await page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_school_admin_mutate')); assert.deepEqual(calls.map(row => row.args.p_command.configuration.schoolYear), ['2026', '2027']); assert.notEqual(calls[0].args.p_command.configuration.draftId, calls[1].args.p_command.configuration.draftId)
  })
  await test('학교 자료 초안·게시·게시 종료는 같은 원본의 서로 다른 접수로 돌아온다', async () => {
    await begin('학교 자료 열어줘', '바로 이동'); await createSource(); await sourceSaved(); await talk(); assert.match(await plan().innerText(), /학교 자료 초안 저장 · 게시 전/); assert.doesNotMatch(await plan().innerText(), /학교 자료 게시 · 적용 기간 별도/)
    await button('작성하던 업무 보기').click(); await sourceAction('첫 번째 학교 자료', 'publish'); await sourceSaved(); await talk(); assert.match(await plan().innerText(), /학교 자료 게시 · 적용 기간 별도/)
    await button('작성하던 업무 보기').click(); await sourceAction('첫 번째 학교 자료', 'retire'); await sourceSaved(); await talk(); assert.match(await plan().innerText(), /학교 자료 게시 종료/); await plan().getByText('이전 처리 2건', { exact: true }).click(); assert.match(await plan().innerText(), /학교 자료 초안 저장 · 게시 전/)
    assert.doesNotMatch(await plan().innerText(), /AI 목록에 옮기지 않을|목록에 옮기지 않을/); assert.equal(await page.evaluate(() => window.qa.knowledgeWrites), 3)
  })
  await test('학교 자료 게시 유실은 초안 상태를 보존하고 같은 원키 접수 뒤 게시를 표시한다', async () => {
    await begin('학교 자료 열어줘', '바로 이동'); await createSource(); await sourceSaved(); await page.evaluate(() => { window.qa.unknown = 'knowledge' }); await sourceAction('첫 번째 학교 자료', 'publish'); await button('원래 요청 결과 확인').waitFor()
    assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(), 1); await button('원래 요청 결과 확인').click(); await sourceSaved(); await talk(); assert.match(await plan().innerText(), /학교 자료 게시 · 적용 기간 별도/)
    await plan().getByText('이전 처리 1건', { exact: true }).click(); assert.match(await plan().innerText(), /학교 자료 초안 저장 · 게시 전/)
    const calls = await page.evaluate(() => window.qa.calls.filter(row => row.name === 'workhub_knowledge_mutate')); assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[2]); assert.equal(await page.evaluate(() => window.qa.knowledgeWrites), 2)
  })
  await test('같은 자료실에서 생성·게시한 다른 원본은 첫 자료의 업무 결과에 붙지 않는다', async () => {
    await begin('학교 자료 열어줘', '바로 이동'); await createSource(); await sourceSaved(); await talk(); assert.match(await plan().innerText(), /학교 자료 초안 저장 · 게시 전/); await button('작성하던 업무 보기').click()
    await createSource('두 번째 학교 자료'); await sourceSaved(); await sourceAction('두 번째 학교 자료', 'publish'); await sourceSaved(); await talk()
    assert.match(await plan().innerText(), /학교 자료 초안 저장 · 게시 전/); assert.doesNotMatch(await plan().innerText(), /학교 자료 게시 · 적용 기간 별도/); assert.equal(await plan().getByText(/이전 처리/).count(), 0); assert.equal(await page.evaluate(() => window.qa.knowledgeWrites), 3)
  })
  console.log(`실제 AI 연결 셸 학교 구성·자료 게시 결과 ${passed}/${passed} 통과 · 합성 RPC·외부 및 유료 호출 0`)
} finally { await browser.close() }
