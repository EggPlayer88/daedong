import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-document-result-events-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true }), page = await context.newPage()
const origin = 'http://127.0.0.1:5292/', errors = [], external = [], passed = []
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}*{box-sizing:border-box}</style><div id="root"></div></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const results = () => page.evaluate(() => window.workflowResults)
const pending = () => page.evaluate(() => window.pending.count())
async function start(mode, manager = false) {
  await page.goto(origin + mode)
  await page.evaluate(value => Object.assign(window, value), { mode, manager })
  await page.addScriptTag({ content: bundle })
  if (mode === 'guided') await page.getByRole('button', { name: /결과 연결 양식/ }).waitFor()
  else await button('새 문서 작성').and(page.locator(':enabled')).waitFor()
  assert.deepEqual(await results(), [])
}
async function test(mode, name, run, manager = false) {
  await start(mode, manager)
  try { await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []) }
  catch (error) { console.error(await page.locator('body').innerText()); console.error('결과 이벤트', await results()); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
async function compose() {
  await button('새 문서 작성').click()
  await page.getByLabel('문서 제목', { exact: true }).fill('직접 작성한 문서')
  await page.getByLabel('문서 본문', { exact: true }).fill('업무목록에 복제하지 않을 본문')
}
async function openGuided() { await page.getByRole('button', { name: /결과 연결 양식/ }).click(); await button('저장한 답변으로 HWPX 생성').and(page.locator(':enabled')).waitFor() }
async function render() { await button('저장한 답변으로 HWPX 생성').click() }
async function saved(count = 1) { await page.waitForFunction(count => window.workflowResults.length === count, count) }
function checkedScope(result) { assert.deepEqual(JSON.parse(result.scope).slice(0, 3), ['user', 'school', 'teacher']); assert.ok(result.key.length >= 8) }
try {
  await test('documents', '문서 생성·수정·내용 확인·보관을 실제 접수증으로 구분하고 콜백 예외를 격리한다', async () => {
    await compose(); await page.evaluate(() => { window.resultThrows = true })
    await button('초안 저장').click(); await saved(); await button('이 문서 수정').and(page.locator(':enabled')).waitFor()
    await button('이 문서 수정').click(); await page.getByLabel('문서 본문', { exact: true }).fill('수정한 검토 본문')
    await button('초안 저장').click(); await saved(2); await button('내용 확인 완료').and(page.locator(':enabled')).waitFor()
    await button('내용 확인 완료').click(); await saved(3); await page.getByText('문서 작업 더보기', { exact: true }).click()
    await button('보관함으로 이동').click(); await saved(4)
    const rows = await results(); assert.deepEqual(rows.map(row => [row.kind, row.action, row.documentId, row.documentVersion]), [['document', 'create', 'doc', 1], ['document', 'update', 'doc', 2], ['document', 'confirm', 'doc', 3], ['document', 'archive', 'doc', 4]])
    for (const row of rows) { checkedScope(row); assert.equal(row.recordedAt, '2026-11-12T00:00:00Z'); assert.equal(Object.hasOwn(row, 'body'), false); assert.equal(Object.hasOwn(row, 'composeId'), false) }
    assert.equal(await pending(), 0); assert.equal(await page.evaluate(() => window.applied.length), 4)
  })
  await test('documents', 'AI 반영 출처와 원키를 재마운트·읽기 전용 복구 뒤에도 보존한다', async () => {
    await page.evaluate(() => { window.setAi(); window.unknown = true })
    await button('이 초안을 입력에 반영').click(); await button('초안 저장').click(); await button('같은 문서 요청 다시 확인').waitFor()
    assert.deepEqual(await results(), []); assert.equal(await pending(), 1)
    await page.evaluate(() => window.unmount()); await button('새 문서 작성').waitFor({ state: 'detached' })
    await page.evaluate(() => { window.listFail = true; window.remount() }); await button('문서함 다시 연결').waitFor()
    await button('같은 문서 요청 다시 확인').click(); await saved()
    const [row] = await results(), calls = await page.evaluate(() => window.calls)
    assert.equal(row.composeId, 'ai-request'); assert.equal(row.key, calls.find(call => call.name === 'workhub_document_mutate').args.p_request_key)
    assert.equal(calls.filter(call => call.name === 'workhub_document_mutate').length, 1)
    assert.equal(calls.filter(call => call.name === 'workhub_document_request_get').length, 1)
    assert.equal(await pending(), 0); assert.equal(await page.evaluate(() => window.applied.length), 1)
  })
  await test('documents', 'AI 초안 되돌리기 뒤 직접 저장은 AI 작성 출처를 붙이지 않는다', async () => {
    await compose(); await page.evaluate(() => window.setAi()); await button('이 초안을 입력에 반영').click()
    await button('AI 반영 전 입력으로 되돌리기').click(); await button('초안 저장').click(); await saved()
    assert.equal(Object.hasOwn((await results())[0], 'composeId'), false)
    assert.equal(await page.evaluate(() => window.applied[0].input.body), '업무목록에 복제하지 않을 본문')
  })
  await test('documents', '저장 후 원본·목록 조회 실패는 접수된 결과를 지우거나 재실행하지 않는다', async () => {
    await compose(); await page.evaluate(() => { window.getFail = true; window.listFail = true })
    await button('초안 저장').click(); await saved(); await page.getByText(/문서 v1 저장은 확인했습니다/).waitFor(); await button('문서함 다시 연결').waitFor()
    assert.equal(await pending(), 0); assert.equal(await page.evaluate(() => window.applied.length), 1)
  })
  await test('documents', '충돌 뒤 최신 원본을 선택하면 버린 AI 입력의 작성 출처도 지운다', async () => {
    await page.getByRole('button', { name: /문서 원본/ }).click(); await button('이 문서 수정').click()
    await page.evaluate(() => { window.setAi(); window.rejectCode = 'CONFLICT' }); await button('이 초안을 입력에 반영').click()
    await button('초안 저장').click(); await button('최신 원본 사용').click(); await page.evaluate(() => { window.rejectCode = undefined })
    await button('초안 저장').click(); await saved(); assert.equal(Object.hasOwn((await results())[0], 'composeId'), false)
    assert.equal(await page.evaluate(() => window.applied[0].input.body), '학교 내부 검토 본문')
  })
  await test('documents', '다른 요청 번호의 문서 접수증은 완료로 기록하지 않고 원키 복구한다', async () => {
    await compose(); await page.evaluate(() => { window.badField = 'requestKey'; window.badValue = 'wrong-request' })
    await button('초안 저장').click(); await button('같은 문서 요청 다시 확인').waitFor(); assert.deepEqual(await results(), [])
    await page.evaluate(() => { window.badField = undefined; window.listFail = true; window.refresh() }); await button('문서함 다시 연결').waitFor()
    await button('같은 문서 요청 다시 확인').click(); await saved(); assert.equal(await pending(), 0); assert.equal(await page.evaluate(() => window.applied.length), 1)
  })
  await test('documents', '거절된 저장은 문서 결과로 알리지 않는다', async () => {
    await compose(); await page.evaluate(() => { window.rejectCode = 'INVALID_INPUT' }); await button('초안 저장').click()
    await page.getByRole('alert').waitFor(); assert.deepEqual(await results(), []); assert.equal(await pending(), 0)
  })
  for (const mode of ['documents', 'guided']) {
    for (const change of ['unmount', 'changeService', 'changeScope']) await test(mode, `${mode}: ${change} 뒤 도착한 이전 요청은 새 화면 결과로 알리지 않는다`, async () => {
      if (mode === 'documents') await compose(); else await openGuided()
      await page.evaluate(() => { window.hold = true })
      await button(mode === 'documents' ? '초안 저장' : '저장한 답변으로 HWPX 생성').click(); await page.waitForFunction(() => typeof window.release === 'function')
      await page.evaluate(change => window[change](), change)
      await page.waitForFunction(change => change === 'unmount' ? !window.ui.mounted : change === 'changeService' ? window.ui.serviceId === 1 : window.ui.memberId === 'other-teacher', change)
      await page.evaluate(() => window.release()); await page.waitForTimeout(100)
      assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.applied.length), 1)
    })
    await test(mode, `${mode}: 요청 뒤 콜백이 바뀌어도 시작할 때 연결한 결과 수신자만 사용한다`, async () => {
      if (mode === 'documents') await compose(); else await openGuided()
      await page.evaluate(() => { window.hold = true }); await button(mode === 'documents' ? '초안 저장' : '저장한 답변으로 HWPX 생성').click()
      await page.waitForFunction(() => typeof window.release === 'function'); await page.evaluate(() => window.changeListener()); await page.waitForFunction(() => window.ui.listenerTarget === 'new')
      await page.evaluate(() => window.release()); await saved(); assert.deepEqual(await page.evaluate(() => window.listenerTargets), ['original'])
    })
  }
  await test('guided', '답변 저장·내려받기·다시 열기는 생성 결과를 만들지 않고 검증된 HWPX 생성만 한 번 기록한다', async () => {
    await openGuided(); await page.getByLabel('안내 내용 (필수)', { exact: true }).fill('수정 답변'); await button('답변 임시 저장').click()
    await button('저장한 답변으로 HWPX 생성').and(page.locator(':enabled')).waitFor(); assert.deepEqual(await results(), [])
    await page.evaluate(() => { window.resultThrows = true }); await render(); await saved(); await button('생성 HWPX 내려받기').waitFor()
    const [row] = await results(); checkedScope(row); assert.equal(row.kind, 'guided'); assert.equal(row.action, 'render'); assert.equal(row.templateId, 'template'); assert.equal(row.templateVersion, 2); assert.equal(row.responseId, 'response'); assert.equal(row.responseVersion, 4); assert.match(row.sha256, /^[0-9a-f]{64}$/); assert.ok(row.bytes > 0); assert.ok(Number.isFinite(Date.parse(row.observedAt))); assert.equal(Object.hasOwn(row, 'recordedAt'), false)
    await Promise.all([page.waitForEvent('download'), button('생성 HWPX 내려받기').click()]); assert.equal((await results()).length, 1)
    await page.evaluate(() => window.unmount()); await button('생성 HWPX 내려받기').waitFor({ state: 'detached' }); await page.evaluate(() => window.remount()); await button('생성 HWPX 내려받기').waitFor()
    assert.equal((await results()).length, 1); assert.equal(await pending(), 0)
  })
  await test('guided', '생성 응답 유실은 원번호 읽기 복구 뒤 기록하고 후속 조회 실패에도 유지한다', async () => {
    await openGuided(); await page.evaluate(() => { window.unknown = true }); await render(); await button('같은 양식 요청 다시 확인').waitFor(); assert.deepEqual(await results(), [])
    await page.evaluate(() => { window.listFail = true; window.getFail = true; window.refresh() }); await page.getByRole('alert').filter({ hasText: /준비/ }).waitFor()
    await button('같은 양식 요청 다시 확인').click(); await saved(); await page.getByText('처리는 확인했습니다. 목록에서 원본을 다시 열어 주세요.', { exact: true }).waitFor()
    const [row] = await results(), calls = await page.evaluate(() => window.calls), renders = await page.evaluate(() => window.renders)
    assert.equal(row.key, renders[0].requestKey); assert.equal(renders.length, 1); assert.equal(calls.filter(call => call.name === 'workhub_template_operation_get').length, 1); assert.equal(await pending(), 0)
  })
  for (const [field, value] of [['templateId', 'other-template'], ['templateVersion', 99], ['responseId', 'other-response'], ['responseVersion', 99], ['sha256', 'invalid-hash'], ['bytes', 0]]) await test('guided', `생성 응답의 ${field} 불일치는 기록하지 않고 정확한 원키 복구만 받는다`, async () => {
    await openGuided(); await page.evaluate(({ field, value }) => { window.badField = field; window.badValue = value }, { field, value }); await render()
    await button('같은 양식 요청 다시 확인').waitFor(); assert.deepEqual(await results(), []); assert.equal(await pending(), 1)
    await page.evaluate(() => { window.badField = undefined; window.listFail = true; window.refresh() }); await page.getByRole('alert').filter({ hasText: /준비/ }).waitFor()
    await button('같은 양식 요청 다시 확인').click(); await saved(); assert.equal(await pending(), 0); assert.equal(await page.evaluate(() => window.applied.length), 1)
  })
  await test('guided', '양식 업로드·검사는 HWPX 생성 결과로 기록하지 않는다', async () => {
    await page.getByText('새 HWPX 양식 등록', { exact: true }).click()
    await page.getByLabel('양식 이름', { exact: true }).fill('검사용 원본')
    await page.getByLabel('HWPX 양식 선택', { exact: true }).setInputFiles({ name: '양식.hwpx', mimeType: 'application/hwp+zip', buffer: Buffer.from('PK 합성 원본') })
    await page.getByText('양식의 실제 문단을 읽었습니다. 질문과 채울 칸을 직접 확인해 주세요.', { exact: true }).waitFor()
    assert.deepEqual(await results(), []); assert.equal(await page.evaluate(() => window.uploaded), true); assert.deepEqual(await page.evaluate(() => window.renders.map(value => value.action)), ['inspect'])
  }, true)
  console.log(`\n문서·생성물 결과 연결 ${passed.length}/${passed.length} 통과 · 실제 React/어댑터, 합성 RPC/파일 포트`)
} finally { await context.close(); await browser.close() }
