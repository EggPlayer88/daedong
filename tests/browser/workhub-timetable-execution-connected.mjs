import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ stdin: { contents: readFileSync(new URL('./workhub-timetable-execution-connected-fixture.tsx', import.meta.url), 'utf8'), loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-timetable-execution-connected-')); mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), confirm = () => page.getByRole('checkbox', { name: '선택 수업과 실제 실시 여부를 직접 확인했습니다', exact: true }), writes = () => page.evaluate(() => window.calls.filter(c => c.name === 'workhub_timetable_execution_record')), lessonButton = label => page.locator('.ttboard-lesson').filter({ hasText: label })
let count = 0
async function start() { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5179/execution-connected'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await button('시간표 보기').click(); await lessonButton('국어 1반').click(); await page.locator('.timetable-execution-records > summary').click(); await button('실시 기록 작성하기').waitFor() }
async function test(name, run) { await start(); await run(); count++; console.log('  ✓ ' + name) }
async function edit() { await button('실시 기록 작성하기').click(); await page.getByLabel('기록 메모', { exact: true }).fill('전체 화면에서 확인한 기록'); await page.waitForFunction(() => window.locked) }
async function save() { await confirm().check(); await button('확인한 실시 기록 저장').click() }
try {
  await test('전체 시간표에서 실시입력은 자기 자신을 잠그지 않고 다른 수업·탭·필터를 잠근다', async () => {
    await edit(); assert.equal(await page.getByLabel('기록 메모', { exact: true }).isEnabled(), true); assert.equal(await confirm().isEnabled(), true)
    for (const name of ['편성 관리', '시간표 확정', '교환·변경 요청', '수업 상세 닫기', '다음 주']) assert.equal(await button(name).isDisabled(), true, name)
    assert.equal(await lessonButton('영어 1반').isDisabled(), true); await page.getByText('교사·학급·날짜 선택', { exact: true }).click(); assert.equal(await page.getByLabel('교사로 보기', { exact: true }).isDisabled(), true); assert.equal(await page.getByLabel('학급으로 보기', { exact: true }).isDisabled(), true)
    await page.screenshot({ path: join(output, 'execution-connected-edit.png'), fullPage: true }); await button('실시 기록 입력 취소').click(); await page.waitForFunction(() => !window.locked); assert.equal(await button('편성 관리').isEnabled(), true); await lessonButton('영어 1반').click(); assert.equal(await page.getByRole('region', { name: '선택한 수업', exact: true }).getByText('영어 1반', { exact: true }).count(), 1)
  })
  await test('저장 응답 유실 뒤 상위 운영 조회 실패·재진입 중에도 원번호 복구를 제공한다', async () => {
    await edit(); await page.evaluate(() => window.dropOnce = true); await save(); await button('원래 실시 기록 결과 확인').waitFor(); const original = (await writes())[0]
    await page.evaluate(() => { window.failOperations = true; window.refresh() }); await page.getByRole('heading', { name: '시간표 운영 자료를 불러오지 못했습니다', exact: true }).waitFor(); assert.equal(await page.locator('.ttboard').count(), 0); assert.equal(await button('원래 실시 기록 결과 확인').isEnabled(), true)
    await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('원래 실시 기록 결과 확인').waitFor(); assert.equal(await button('편성 관리').isDisabled(), true); await button('원래 실시 기록 결과 확인').click(); await page.waitForFunction(() => window.pending.count() === 0)
    const recovered = (await writes())[1]; assert.deepEqual(recovered.args.p_command, original.args.p_command); assert.equal(recovered.args.p_request_key, original.args.p_request_key); assert.equal(recovered.args.p_recover_only, true); assert.equal(await page.evaluate(() => window.writes), 1)
    await page.evaluate(() => window.failOperations = false); await button('운영 연결 다시 확인').click(); await page.getByRole('region', { name: '선택한 수업', exact: true }).waitFor(); assert.match(await page.getByRole('region', { name: '선택한 수업', exact: true }).innerText(), /국어 1반/); await page.waitForFunction(() => !window.locked); await page.screenshot({ path: join(output, 'execution-connected-restored.png'), fullPage: true })
  })
  await test('미저장 메모도 상위 조회 실패와 복원 뒤 선택 수업·입력을 보존한다', async () => {
    await edit(); await page.evaluate(() => { window.failOperations = true; window.refresh() }); await page.getByRole('heading', { name: '시간표 운영 자료를 불러오지 못했습니다', exact: true }).waitFor(); assert.equal(await page.getByLabel('기록 메모', { exact: true }).inputValue(), '전체 화면에서 확인한 기록')
    await page.evaluate(() => window.failOperations = false); await button('운영 연결 다시 확인').click(); await page.getByRole('region', { name: '선택한 수업', exact: true }).waitFor(); assert.match(await page.getByRole('region', { name: '선택한 수업', exact: true }).innerText(), /국어 1반/); assert.equal(await page.getByLabel('기록 메모', { exact: true }).inputValue(), '전체 화면에서 확인한 기록'); await save(); await button('실시 기록 정정하기').waitFor(); await page.waitForFunction(() => !window.locked); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('결과미상 원장없음 상태에서는 전체 화면 재진입 뒤에도 원키 재전송만 한다', async () => {
    await edit(); await page.evaluate(() => window.dropBefore = true); await save(); const original = (await writes())[0]; await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('원래 실시 기록 결과 확인').click(); await button('같은 번호로 실시 기록 다시 보내기').waitFor(); assert.equal(await button('편성 관리').isDisabled(), true)
    await page.getByRole('checkbox', { name: '늦은 처리 가능성을 확인했고 같은 번호·같은 입력으로 다시 보냅니다', exact: true }).check(); await button('같은 번호로 실시 기록 다시 보내기').click(); await page.waitForFunction(() => window.pending.count() === 0 && window.writes === 1); const calls = await writes(); assert.equal(new Set(calls.map(c => c.args.p_request_key)).size, 1); assert.deepEqual(calls.at(-1).args.p_command, original.args.p_command); await button('실시 기록 정정하기').waitFor()
  })
  await test('320px 전체 연결 화면에서도 실시 입력과 취소·탭 잠금이 동작한다', async () => {
    await page.setViewportSize({ width: 320, height: 800 }); await edit(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.screenshot({ path: join(output, 'execution-connected-mobile.png'), fullPage: true }); await button('실시 기록 입력 취소').click(); await page.waitForFunction(() => !window.locked); await button('교환·변경 요청').click(); assert.equal(await button('교환·변경 요청').getAttribute('aria-pressed'), 'true')
  })
  assert.deepEqual(errors, []); writeFileSync(join(output, 'results.json'), JSON.stringify({ scenarios: count, failures: 0 }, null, 2)); console.log('시간표 실시 기록 전체 연결 브라우저 검사: ' + count + '개 통과 · 화면: ' + output)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
