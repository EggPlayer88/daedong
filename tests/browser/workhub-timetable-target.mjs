import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ stdin: { contents: readFileSync(new URL('./workhub-timetable-target-fixture.tsx', import.meta.url), 'utf8'), loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-timetable-target-')); mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), select = () => page.getByRole('combobox', { name: '준비할 학기 선택', exact: true })
const confirm = () => page.getByRole('checkbox', { name: '학교 전체의 준비 대상이 바뀌며, 저장한 기존 학기 자료는 유지됨을 확인했습니다', exact: true })
const writes = () => page.evaluate(() => window.calls.filter(call => call.name.endsWith('_set')))
let count = 0
async function start(init) { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5179/target'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await select().waitFor(); if (init) { await page.evaluate(init); await button('준비 학기 다시 확인').click() } }
async function test(name, run) { await start(); await run(); count++; console.log('  ✓ ' + name) }
async function save() { await confirm().check(); await button('확인한 학기로 변경').click() }
try {
  await test('다음 학기를 학교 공통 선택으로 명시 확인한 뒤 exact 요청 한 번만 보낸다', async () => {
    assert.match(await page.locator('body').innerText(), /개인 설정이 아니라 학교의 모든 시간표 담당자/)
    assert.match(await select().innerText(), /2026학년도.*지금 학기.*기준판 있음.*준비 초안 있음/)
    await select().selectOption('next'); await page.waitForFunction(() => window.locked)
    assert.equal(await button('확인한 학기로 변경').isDisabled(), true); assert.equal((await writes()).length, 0)
    await page.screenshot({ path: join(output, 'target-desktop.png'), fullPage: true }); await save(); await page.waitForFunction(() => window.changed.length === 1)
    const calls = await writes(); assert.equal(calls.length, 1); assert.deepEqual(calls[0].args.p_input, { termId: 'next', expectedVersion: 0 }); assert.equal(calls[0].args.p_recover_only, false)
    assert.equal(await page.evaluate(() => window.changed[0].termId), 'next'); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await test('원래대로 선택은 null로 보내고 저장한 다른 학기의 자료는 지우지 않는다', async () => {
    await select().selectOption('next'); await save(); await page.waitForFunction(() => window.changed.length === 1)
    await select().selectOption(''); await save(); await page.waitForFunction(() => window.changed.length === 2)
    assert.deepEqual((await writes())[1].args.p_input, { termId: null, expectedVersion: 1 }); assert.equal(await page.evaluate(() => window.snapshot.terms.length), 2)
  })
  await test('선택 학기가 삭제되어 같은 판의 null no-op이 와도 성공 뒤 현재 대상을 다시 읽는다', async () => {
    await page.evaluate(() => { window.snapshot.termId = 'next'; window.snapshot.selectedTermId = 'next'; window.snapshot.version = 4 }); await button('준비 학기 다시 확인').click(); await page.waitForFunction(() => document.querySelector('select')?.value === 'next')
    await select().selectOption(''); await page.evaluate(() => { window.snapshot.termId = 'now'; window.snapshot.selectedTermId = null; window.snapshot.terms = window.snapshot.terms.filter(row => row.id !== 'next') }); await save(); await page.waitForFunction(() => window.changed.length === 1)
    assert.equal(await page.evaluate(() => window.changed[0].termId), 'now'); assert.equal(await page.evaluate(() => window.changed[0].version), 4); assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await test('삭제 뒤 자동 대상도 없어지면 같은 판 접수증을 보존하고 최신 재조회 전에는 잠금을 풀지 않는다', async () => {
    await page.evaluate(() => { window.snapshot.termId = 'next'; window.snapshot.selectedTermId = 'next'; window.snapshot.version = 4 }); await button('준비 학기 다시 확인').click(); await page.waitForFunction(() => document.querySelector('select')?.value === 'next')
    await select().selectOption(''); await page.evaluate(() => { window.snapshot = { termId: null, automaticTermId: null, selectedTermId: null, version: 4, terms: [] }; window.failGetAfter = true }); await save(); await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await page.evaluate(() => window.changed.length), 0); assert.equal(await page.evaluate(() => window.locked), true)
    await page.evaluate(() => window.failGet = false); await button('준비 학기 다시 확인').click(); await page.waitForFunction(() => window.changed.length === 1)
    assert.equal(await page.evaluate(() => window.changed[0].termId), null); assert.equal(await page.evaluate(() => window.changed[0].version), 4); assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.actualWrites), 0); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await test('부모의 미저장 입력 잠금 중 선택·확정은 차단하고 이미 고른 값은 보존한다', async () => {
    await select().selectOption('next'); await confirm().check(); await page.evaluate(() => { window.disabled = true; window.render() })
    await page.waitForFunction(() => document.querySelector('select').disabled); assert.equal(await select().inputValue(), 'next'); assert.equal(await button('확인한 학기로 변경').isDisabled(), true); assert.equal((await writes()).length, 0)
    await page.evaluate(() => { window.disabled = false; window.render() }); await page.waitForFunction(() => !document.querySelector('select').disabled)
    assert.equal(await select().inputValue(), 'next')
  })
  await test('선택만 한 상태도 재마운트 뒤 보존하고 확인 체크는 다시 받는다', async () => {
    await select().selectOption('next'); await confirm().check(); await page.evaluate(() => { window.root.unmount(); window.mount() })
    await confirm().waitFor(); assert.equal(await select().inputValue(), 'next'); assert.equal(await confirm().isChecked(), false); await page.waitForFunction(() => window.locked); assert.equal((await writes()).length, 0)
    await button('학기 선택 취소').click(); await page.waitForFunction(() => !window.locked); assert.equal(await select().inputValue(), '')
  })
  await test('다른 담당자 판 충돌은 재조회·최신 비교·새 확인 전 자동 재전송하지 않는다', async () => {
    await select().selectOption('next'); await page.evaluate(() => { window.snapshot.version = 1; window.snapshot.selectedTermId = 'now' }); await save()
    await button('최신 학기 기준으로 다시 확인').waitFor(); assert.equal(await select().inputValue(), 'next'); assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    await button('최신 학기 기준으로 다시 확인').click(); assert.equal(await confirm().isChecked(), false); await save(); await page.waitForFunction(() => window.changed.length === 1)
    const calls = await writes(); assert.equal(calls.length, 2); assert.notEqual(calls[0].args.p_request_key, calls[1].args.p_request_key); assert.equal(calls[1].args.p_input.expectedVersion, 1)
  })
  await test('응답 유실 뒤 재마운트해도 원키·원문·recover_only로 조회하여 이중 저장하지 않는다', async () => {
    await select().selectOption('next'); await page.evaluate(() => window.dropOnce = true); await save(); await button('원래 학기 변경 결과 확인').waitFor()
    const original = (await writes())[0]; await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('원래 학기 변경 결과 확인').click(); await page.waitForFunction(() => window.changed.length === 1)
    const recovered = (await writes())[1]; assert.equal(recovered.args.p_request_key, original.args.p_request_key); assert.deepEqual(recovered.args.p_input, original.args.p_input); assert.equal(recovered.args.p_recover_only, true); assert.equal(await page.evaluate(() => window.actualWrites), 1)
  })
  await test('복구 접수증 뒤 다른 담당자의 최신 학기로 바뀌었다면 과거 학기를 현재로 알리지 않는다', async () => {
    await select().selectOption('next'); await page.evaluate(() => window.dropOnce = true); await save(); await button('원래 학기 변경 결과 확인').waitFor()
    await page.evaluate(() => { window.snapshot.selectedTermId = null; window.snapshot.termId = 'now'; window.snapshot.version = 2 }); await button('원래 학기 변경 결과 확인').click(); await page.waitForFunction(() => window.changed.length === 1)
    assert.equal(await page.evaluate(() => window.changed[0].termId), 'now'); assert.match(await page.locator('body').innerText(), /그 뒤 다른 담당자가 학기를 바꿨거나/); assert.equal(await page.evaluate(() => window.actualWrites), 1)
  })
  await test('접수증 성공 후 재조회 실패는 접수증을 보관·잠금하고 조회만 다시 한다', async () => {
    await select().selectOption('next'); await page.evaluate(() => window.failGetAfter = true); await save(); await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.changed.length), 0); assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await page.evaluate(() => window.locked), true); assert.equal(await select().count(), 0)
    await page.evaluate(() => { window.root.unmount(); window.mount() }); await page.getByRole('alert').waitFor(); assert.equal(await page.evaluate(() => window.locked), true)
    await page.evaluate(() => window.failGet = false); await button('준비 학기 다시 확인').click(); await page.waitForFunction(() => window.changed.length === 1); assert.equal((await writes()).length, 1); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await test('복구 NOT_FOUND는 원키를 보존하고 정말 미접수인 명령만 같은 내용으로 재전송한다', async () => {
    await select().selectOption('next'); await page.evaluate(() => window.dropBefore = true); await save(); await button('원래 학기 변경 결과 확인').waitFor()
    await button('원래 학기 변경 결과 확인').click(); await button('같은 번호·같은 학기 선택으로 다시 보내기').waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 1); assert.equal(await select().isDisabled(), true); assert.equal((await writes()).length, 2); assert.equal(await page.evaluate(() => window.actualWrites), 0)
    assert.equal(await button('같은 번호·같은 학기 선택으로 다시 보내기').isDisabled(), true)
    await page.getByRole('checkbox', { name: '늦은 처리 가능성을 확인했고 원래 번호와 같은 선택으로만 다시 보냅니다', exact: true }).check(); await button('같은 번호·같은 학기 선택으로 다시 보내기').click(); await page.waitForFunction(() => window.changed.length === 1)
    const calls = await writes(); assert.equal(calls.length, 3); assert.equal(new Set(calls.map(row => row.args.p_request_key)).size, 1); assert.deepEqual(calls[2].args.p_input, calls[0].args.p_input); assert.equal(calls[2].args.p_recover_only, false); assert.equal(await page.evaluate(() => window.actualWrites), 1)
  })
  await test('NOT_FOUND 확인 뒤 최초 요청이 늦게 저장되면 원키 재전송은 그 접수증으로 완료한다', async () => {
    await select().selectOption('next'); await page.evaluate(() => window.dropBefore = true); await save(); await button('원래 학기 변경 결과 확인').click(); await button('같은 번호·같은 학기 선택으로 다시 보내기').waitFor()
    await page.evaluate(() => { const original = window.calls.find(row => row.name.endsWith('_set')); const key = original.args.p_request_key; window.snapshot.termId = 'next'; window.snapshot.selectedTermId = 'next'; window.snapshot.version = 1; window.actualWrites = 1; window.commands[key] = structuredClone(original.args.p_input); window.receipts[key] = { requestKey: key, termId: 'next', version: 1, effectiveTermId: 'next' } })
    await page.getByRole('checkbox', { name: '늦은 처리 가능성을 확인했고 원래 번호와 같은 선택으로만 다시 보냅니다', exact: true }).check(); await button('같은 번호·같은 학기 선택으로 다시 보내기').click(); await page.waitForFunction(() => window.changed.length === 1)
    assert.equal(await page.evaluate(() => window.actualWrites), 1); assert.equal(await page.evaluate(() => window.changed[0].version), 1); assert.equal(new Set((await writes()).map(row => row.args.p_request_key)).size, 1)
  })
  await test('닫힌 선택의 자동 복귀를 설명하고 준비 학기 없음도 오류로 만들지 않는다', async () => {
    await page.evaluate(() => { window.snapshot.selectedTermId = 'closed'; window.snapshot.version = 1 }); await button('준비 학기 다시 확인').click(); await page.getByText('고른 학기가 닫히거나 기간이 끝나 자동 선택으로 돌아왔습니다. 아래 현재 준비 대상을 확인해 주세요.', { exact: true }).waitFor()
    await page.evaluate(() => window.snapshot = { termId: null, automaticTermId: null, selectedTermId: null, version: 1, terms: [] }); await button('준비 학기 다시 확인').click(); await page.getByText('학교 관리에서 학년도와 공식 학기 날짜를 먼저 등록해 주세요. 아직 준비할 수 있는 학기가 없습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.states.at(-1).status), 'ready'); assert.equal((await writes()).length, 0)
  })
  await test('T1-07 미설치·미활성은 선택기 안내에 머물고 기존 메뉴를 가리지 않는다', async () => {
    await page.evaluate(() => window.missing = true); await button('준비 학기 다시 확인').click(); await page.getByText('준비 학기 선택 기능을 연결 중입니다. 기존 시간표 준비 기능은 현재 연결 상태에 따라 계속 사용할 수 있습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.states.at(-1).status), 'unavailable'); assert.equal(await button('합성 기존 메뉴').isEnabled(), true); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await test('불명확한 통신 실패를 미설치로 단정하지 않고 상태 오류로 전달한다', async () => {
    await page.evaluate(() => window.failGet = true); await button('준비 학기 다시 확인').click(); await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.states.at(-1).status), 'error'); assert.equal(await select().count(), 0); assert.equal((await writes()).length, 0)
  })
  await test('학교 변경 뒤 늦은 응답이 새 학교 선택에 채택되지 않는다', async () => {
    await select().selectOption('next'); await page.evaluate(() => window.holdWrite = true); await save(); await page.waitForFunction(() => typeof window.releaseWrite === 'function')
    await page.evaluate(() => { window.member = { ...window.member, schoolId: 'other' }; window.render(); window.releaseWrite() }); await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.changed.length), 0); assert.equal(await select().count(), 0)
  })
  await test('320px·글자 200%에서도 선택·확인·취소가 가로 스크롤 없이 보인다', async () => {
    await page.setViewportSize({ width: 320, height: 800 }); await page.evaluate(() => document.documentElement.style.fontSize = '200%'); await select().selectOption('next')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: join(output, 'target-mobile-200.png'), fullPage: true }); await confirm().check(); await button('학기 선택 취소').click(); await page.waitForFunction(() => !window.locked)
  })
  assert.deepEqual(errors, []); writeFileSync(join(output, 'results.json'), JSON.stringify({ scenarios: count, failures: 0 }, null, 2)); console.log('시간표 대상 학기 브라우저 검사: ' + count + '개 통과 · 화면: ' + output)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
