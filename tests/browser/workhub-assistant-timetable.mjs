import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-assistant-timetable-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], external = []
page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5271/')) external.push(request.url()) }); page.setDefaultTimeout(10000)
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}*{box-sizing:border-box}</style><div id="root"></div></html>' }))
let count = 0
const button = name => page.getByRole('button', { name, exact: true })
async function start(tab = 'shared') { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5271/assistant'); await page.evaluate(tab => { window.deferTimetableFixture = true; window.initialOperationTab = tab }, tab); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: '시간표 업무', exact: true }).waitFor(); await page.waitForFunction(() => window.calls.some(call => call.name === 'workhub_timetable_operations_get')); await page.getByText('2개 수업 · 요청 0건', { exact: true }).waitFor() }
async function check(name, run, tab) { await start(tab); await run(); count++; console.log('  ✓ ' + name) }
async function compose() { await page.getByLabel('요청할 변경 종류', { exact: true }).selectOption('swap'); await page.getByLabel('변경할 내 수업', { exact: true }).selectOption('one'); await page.getByLabel('교환할 상대 수업', { exact: true }).selectOption('two'); await page.getByLabel('변경 요청 사유', { exact: true }).fill('업무 협의로 수업을 교환합니다') }
async function preview() { await button('변경 전후 미리보기').click(); await page.getByRole('region', { name: '수업 변경 미리보기', exact: true }).waitFor() }
async function submit() { await page.getByLabel('변경되는 수업·시간·관련 교사를 확인했으며 나는 이 변경안에 동의합니다', { exact: true }).check(); await button('내 동의와 변경 요청 보내기').click() }
try {
  await check('시간표 조회를 대화용 단일 작업 공간으로 열고 자동 변경하지 않는다', async () => {
    await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor(); assert.equal(await page.locator('[data-timetable-presentation="assistant"]').count(), 1)
    assert.equal(await page.getByRole('list', { name: '시간표 처리 순서' }).locator('li').count(), 4); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    assert.equal(await button('편성 관리').isEnabled(), true); assert.equal(await page.getByRole('heading', { level: 1 }).count(), 0)
  })
  await check('교환 의도로 들어오면 요청 입력부터 열고 교사와 원수업은 선택하게 한다', async () => {
    await page.getByLabel('변경할 내 수업', { exact: true }).waitFor(); assert.equal(await page.getByLabel('변경할 내 수업', { exact: true }).inputValue(), '')
    assert.match(await page.getByRole('list', { name: '시간표 처리 순서' }).innerText(), /당사자 동의·담당자 승인/); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  }, 'exchange')
  await check('입력 중 다른 편성으로 이동을 막고 원본 영향 비교와 명시 확인 뒤 한 번만 요청한다', async () => {
    await compose(); assert.equal(await button('편성 관리').isDisabled(), true); await preview()
    assert.equal(await button('내 동의와 변경 요청 보내기').isDisabled(), true); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    await submit(); await page.getByText('관련 교사 동의 대기', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.actualWrites), 1)
    assert.equal(await page.evaluate(() => JSON.stringify(window.view.lessons) === JSON.stringify(window.originalLessons)), true)
  }, 'exchange')
  await check('응답 유실과 재진입은 새 대화 목표보다 원 요청 복구를 우선하며 원키를 보존한다', async () => {
    await compose(); await preview(); await page.evaluate(() => window.failOnce = true); await submit(); await button('원래 요청 결과만 다시 확인').waitFor()
    assert.equal(await button('편성 관리').isDisabled(), true)
    await page.evaluate(() => { window.root.unmount(); window.initialOperationTab = 'publish'; window.initialOperationMode = 'interventions'; window.enableInterventions = true; window.mount() }); await button('원래 요청 결과만 다시 확인').waitFor()
    await button('원래 요청 결과만 다시 확인').click(); await page.getByText('관련 교사 동의 대기', { exact: true }).waitFor()
    const calls = await page.evaluate(() => window.calls.filter(call => call.name.endsWith('_execute'))); assert.equal(calls.length, 2); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command); assert.equal(calls[1].args.p_recover_only, true)
    assert.equal(await page.evaluate(() => window.actualWrites), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  }, 'exchange')
  await check('저장 전 교환 입력을 보관한 재진입은 다른 대화 목표로 덮어쓰지 않는다', async () => {
    await compose(); await page.evaluate(() => { window.root.unmount(); window.initialOperationTab = 'publish'; window.mount() })
    await page.getByLabel('변경 요청 사유', { exact: true }).waitFor(); assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '업무 협의로 수업을 교환합니다')
    assert.equal(await page.getByLabel('변경할 내 수업', { exact: true }).inputValue(), 'one'); assert.equal(await button('편성 관리').isDisabled(), true); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  }, 'exchange')
  await check('대화에서 시작해도 요청자는 자신이 만든 교환을 최종 승인할 수 없다', async () => {
    await page.evaluate(() => window.addRequest('own')); await page.getByRole('heading', { name: '내 교사 · 수업 교환', exact: true }).waitFor(); assert.equal(await button('승인하고 시간표에 반영').count(), 0); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  }, 'exchange')
  await check('대강 의도는 대강 입력을 열고 대상 수업·교사는 직접 선택하게 한다', async () => {
    await page.evaluate(() => { window.root.unmount(); window.initialOperationMode = 'interventions'; window.enableInterventions = true; window.mount() })
    await page.getByLabel('처리할 일', { exact: true }).waitFor(); assert.equal(await page.getByLabel('처리할 일', { exact: true }).inputValue(), 'substitute')
    assert.equal(await page.getByLabel('대상 수업', { exact: true }).inputValue(), ''); assert.equal(await button('대강·휴강·보강').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByLabel('변경할 내 수업', { exact: true }).isVisible(), false); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    await button('이동·교환').click(); await page.evaluate(() => window.refresh()); await page.getByLabel('변경할 내 수업', { exact: true }).waitFor(); assert.equal(await button('이동·교환').getAttribute('aria-pressed'), 'true')
  }, 'exchange')
  await check('새 대강 의도보다 작성 중 교환 입력을 먼저 복원한다', async () => {
    await compose(); await page.evaluate(() => { window.root.unmount(); window.initialOperationMode = 'interventions'; window.enableInterventions = true; window.mount() })
    await page.getByLabel('변경 요청 사유', { exact: true }).waitFor(); assert.equal(await page.getByLabel('변경 요청 사유', { exact: true }).inputValue(), '업무 협의로 수업을 교환합니다')
    assert.equal(await button('이동·교환').getAttribute('aria-pressed'), 'true'); assert.equal(await button('대강·휴강·보강').isDisabled(), true); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  }, 'exchange')
  await check('허용된 승인자는 현재 판·영향 확인 후에만 승인하며 수업 결과까지 돌아온다', async () => {
    await page.evaluate(() => window.addRequest('manager')); await button('승인하고 시간표에 반영').click()
    const review = page.getByRole('region', { name: '변경 요청 응답 확인', exact: true }); assert.equal(await review.getByRole('button', { name: '승인하고 시간표에 반영', exact: true }).isDisabled(), true)
    await review.getByLabel('현재 수업과 변경 내용을 확인했습니다', { exact: true }).check(); await review.getByRole('button', { name: '승인하고 시간표에 반영', exact: true }).click(); await page.getByText('시간표 반영 완료', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.view.lessons.map(row => row.version)), [2, 2]); assert.equal(await page.evaluate(() => window.actualWrites), 1)
  }, 'exchange')
  await check('서버가 읽기 권한을 거절하면 예전 시간표를 숨기고 새 변경을 보내지 않는다', async () => {
    await page.evaluate(() => { window.notAllowed = true; window.refresh() }); await page.getByText('현재 계정에는 시간표 운영 자료를 볼 권한이 없습니다.', { exact: true }).waitFor(); assert.equal(await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).count(), 0); assert.equal(await page.evaluate(() => window.actualWrites), 0)
  })
  await check('320px에서도 대화 요청의 입력·영향·확인 버튼을 가리지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 800 }); await compose(); await preview()
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(overflow.width <= overflow.viewport + 1, JSON.stringify(overflow))
    await button('내 동의와 변경 요청 보내기').scrollIntoViewIfNeeded(); assert.equal(await button('내 동의와 변경 요청 보내기').isVisible(), true)
    const output = process.env.ARTIFACT_DIR; if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'assistant-timetable-review-mobile.png'), fullPage: true }) }
  }, 'exchange')
  assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`\n시간표 대화 작업 브라우저 ${count}건 통과`)
} finally { await browser.close() }
