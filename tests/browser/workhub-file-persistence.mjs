// 실제 미리보기와 브라우저 저장소에서 파일 자료의 비영속성과 기존 업무 복원을 검증한다.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
  import React from 'react';import{createRoot}from'react-dom/client';
  import{DemoBootstrap}from'./apps/workhub/src/preview/DemoBootstrap';
  import theme from'./apps/workhub/src/style.css?inline';import preview from'./apps/workhub/src/preview/preview.css?inline';
  import workflow from'./apps/workhub/src/workflows/workflows.css?inline';import files from'./apps/workhub/src/files/files.css?inline';
  import fileExport from'./apps/workhub/src/workflows/file-export.css?inline';
  createRoot(document.getElementById('root')).render(<><style>{theme}{preview}{workflow}{files}{fileExport}</style><DemoBootstrap/></>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), page = await context.newPage()
const origin = 'http://127.0.0.1:5176', storageKey = 'workhub:synthetic:v3:workspace'
const results = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
// 원래 저장·식별자 생성을 그대로 실행하면서 관찰값만 시험 탭의 메모리에 남긴다.
await context.addInitScript(() => {
  window.qaPersistence = { writes: [], ids: [] }
  const setItem = Storage.prototype.setItem, uuid = crypto.randomUUID.bind(crypto)
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) window.qaPersistence.writes.push({ key: String(key), value: String(value) })
    return setItem.call(this, key, value)
  }
  crypto.randomUUID = (...args) => { const id = uuid(...args); window.qaPersistence.ids.push(id); return id }
})
await context.route('**/*', route => {
  const request = route.request()
  if (!request.url().startsWith(origin + '/') || request.method() !== 'GET') { external.push({ url: request.url(), method: request.method() }); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>' })
})
const taskTitle = '새로고침 후 남는 합성 개인 업무', taskNote = '개인 업무 보존 확인용 합성 메모'
const textTitle = '새로고침 후 남는 글 숫자 수합', textAnswer = '합성 준비 내용 그대로 복원'
const fileTitle = '새로고침 후 사라질 파일 수합', fileInstructions = '현재 탭 전용 합성 파일 안내'
const fileAnswer = '현재 탭 전용 합성 제출 본문', reviewNote = '현재 탭 전용 합성 파일 검토 의견'
const pdf = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nONLY_MEMORY_SYNTHETIC_BODY_' + name + '\n%%EOF') })
const template = pdf('ONLY_MEMORY_TEMPLATE.pdf'), response = pdf('ONLY_MEMORY_RESPONSE.pdf')
const form = () => page.getByRole('form', { name: '수합 만들기 양식', exact: true })
const unit = name => page.getByRole('article', { name: name + ' 제출 단위', exact: true })
const answer = name => unit(name).getByRole('form', { name: name + ' 응답 초안', exact: true })
const persisted = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey)
async function screen(name) { await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor() }
async function menu(name) { await page.getByRole('navigation', { name: '업무 메뉴' }).getByRole('button', { name, exact: true }).click(); await screen(name) }
async function actor(id) {
  const tools = page.locator('.developer-panel')
  if (!await tools.evaluate(node => node.open)) await tools.locator('summary').click()
  const picker = page.getByRole('combobox', { name: /^가상 소속 계정/ }), previous = await picker.inputValue()
  const previousScreen = await page.getByRole('heading', { level: 1 }).innerText()
  await picker.selectOption(id)
  // 소속 전환은 실제 앱 계약대로 홈으로 돌아온 뒤 같은 업무 메뉴를 다시 연다.
  if (previous !== id) { await screen('오늘'); if (previousScreen !== '오늘') await menu(previousScreen) }
}
async function selectRequest(title, tab) {
  await page.getByRole('button', { name: tab, exact: true }).click()
  await page.locator('.wf-request-card').filter({ hasText: title }).click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}
async function fillRequest(title, label, requiredReview = false) {
  await form().getByLabel('수합 제목', { exact: true }).fill(title)
  await form().getByLabel('마감일', { exact: true }).fill('2026-10-21')
  await form().getByLabel('검토 방식', { exact: true }).selectOption(requiredReview ? 'required' : 'none')
  if (requiredReview) await form().getByLabel('검토자', { exact: true }).selectOption('gaon-minjun')
  await form().getByLabel('단위 1 이름', { exact: true }).fill(label)
  await form().getByLabel('단위 1 최종 제출 책임자', { exact: true }).selectOption('gaon-soyeon')
}
async function upload(scope, label, payload) {
  await scope.getByLabel(label + ' 선택', { exact: true }).setInputFiles(payload)
  await scope.getByRole('region', { name: label, exact: true }).getByText('기본 검사 완료 · 현재 창에 보관', { exact: true }).waitFor()
}
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
let baseline, observedWrites = 0, generatedIds = 0
try {
  await page.goto(origin + '/workhub?view=tasks'); await screen('내 업무'); await actor('gaon-minjun')
  await test('실제 DemoBootstrap의 영속 저장으로 개인 업무를 만든다', async () => {
    assert.match(await page.locator('body').innerText(), /일정·업무·글·숫자 수합은 이 브라우저에 저장/)
    await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
    await page.getByLabel('해야 할 일', { exact: true }).fill(taskTitle)
    await page.getByLabel('나만 보는 메모', { exact: true }).fill(taskNote)
    await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
    await page.getByRole('heading', { name: taskTitle, exact: true }).waitFor()
    const saved = await persisted()
    assert.equal(saved.kind, 'synthetic-only'); assert.equal(saved.schema, 3)
    assert.equal(saved.sections.workflows.tasks[0].title, taskTitle)
    assert.equal(saved.sections.workflows.tasks[0].notes, taskNote)
  })
  await test('글·숫자 수합은 생성·게시·응답 완료까지 실제 저장한다', async () => {
    await menu('자료 수합'); await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    await fillRequest(textTitle, '보존할 제출 단위')
    await form().getByLabel('글 문항 (사용하지 않으면 비워 둠)', { exact: true }).fill('준비 내용')
    await form().getByLabel('숫자 문항 (사용하지 않으면 비워 둠)', { exact: true }).fill('합성 수량')
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    await actor('gaon-soyeon'); await selectRequest(textTitle, '받은 수합')
    await unit('보존할 제출 단위').getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    await answer('보존할 제출 단위').getByLabel('준비 내용', { exact: true }).fill(textAnswer)
    await answer('보존할 제출 단위').getByLabel('합성 수량', { exact: true }).fill('0')
    await answer('보존할 제출 단위').getByRole('button', { name: '초안 저장', exact: true }).click()
    await answer('보존할 제출 단위').getByRole('button', { name: '최종 제출', exact: true }).click()
    await unit('보존할 제출 단위').getByText('응답 완료 · 검토 없음', { exact: true }).waitFor()
    baseline = (await persisted()).sections.workflows
    assert.equal(baseline.requests.length, 1); assert.equal(baseline.submissions.length, 1)
    assert.equal(baseline.submissions[0].text, textAnswer); assert.equal(baseline.submissions[0].number, 0)
    assert.equal(baseline.units[0].effectiveSubmissionId, baseline.submissions[0].id)
    await actor('gaon-minjun')
    await page.evaluate(() => { window.qaPersistence.writes = []; window.qaPersistence.ids = [] })
  })
  await test('파일 양식과 응답 원본을 올려 게시·제출·검토하고 실제 내려받는다', async () => {
    await page.getByRole('button', { name: '+ 파일 수합 만들기', exact: true }).click()
    await fillRequest(fileTitle, '탭 전용 제출 단위', true)
    await form().getByLabel('목적·안내', { exact: true }).fill(fileInstructions)
    await upload(form(), '양식 파일', template)
    await form().getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    await actor('gaon-soyeon'); await selectRequest(fileTitle, '받은 수합')
    await unit('탭 전용 제출 단위').getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    await answer('탭 전용 제출 단위').getByLabel('전달 사항', { exact: true }).fill(fileAnswer)
    await upload(answer('탭 전용 제출 단위'), '제출 파일', response)
    await answer('탭 전용 제출 단위').getByRole('button', { name: '초안 저장', exact: true }).click()
    await answer('탭 전용 제출 단위').getByRole('checkbox', { name: '저장한 파일 목록과 내용을 확인했습니다', exact: true }).check()
    await answer('탭 전용 제출 단위').getByRole('button', { name: '최종 제출', exact: true }).click()
    await unit('탭 전용 제출 단위').getByText('검토 대기', { exact: true }).waitFor()
    await actor('gaon-minjun'); await selectRequest(fileTitle, '내가 만든 수합')
    await unit('탭 전용 제출 단위').getByLabel('검토 의견', { exact: true }).fill(reviewNote)
    await unit('탭 전용 제출 단위').getByRole('button', { name: '이 버전 검토 완료', exact: true }).click()
    await unit('탭 전용 제출 단위').getByText('검토 완료', { exact: true }).waitFor()
    const downloaded = page.waitForEvent('download')
    await unit('탭 전용 제출 단위').getByRole('button', { name: response.name + ' 다운로드', exact: true }).click()
    const file = await downloaded, chunks = []
    for await (const chunk of await file.createReadStream()) chunks.push(chunk)
    assert.equal(await file.failure(), null); assert.equal(file.suggestedFilename(), response.name)
    assert.deepEqual(Buffer.concat(chunks), response.buffer)
    if (output) await page.screenshot({ path: join(output, 'file-persistence-before-reload.png'), fullPage: true })
  })
  await test('모든 저장 호출에서 파일명·해시·새 참조·본문을 제외하고 기존 자료만 유지한다', async () => {
    const observed = await page.evaluate(() => ({ ...window.qaPersistence, stored: Object.entries(localStorage) }))
    observedWrites = observed.writes.filter(value => value.key === storageKey).length; generatedIds = observed.ids.length
    assert(observedWrites >= 5, '생성·게시·초안·제출·검토의 실제 저장 호출을 관찰한다')
    assert(generatedIds >= 2, '실제 파일과 연결 업무 식별자가 생성되었다')
    const forbidden = [fileTitle, fileInstructions, fileAnswer, reviewNote, '탭 전용 제출 단위', 'fileCollection', 'sha256', ...observed.ids,
      ...[template, response].flatMap(value => [value.name, createHash('sha256').update(value.buffer).digest('hex'), value.buffer.toString('utf8'), value.buffer.toString('base64')])]
    for (const { key, value } of observed.writes) {
      for (const marker of forbidden) assert.equal((key + value).includes(marker), false, '파일 자료가 쓰기 호출에 남지 않는다: ' + marker)
      if (key === storageKey) assert.deepEqual(JSON.parse(value).sections.workflows, baseline, '파일 작업 중 기존 업무만 저장한다')
    }
    for (const [key, value] of observed.stored) for (const marker of forbidden) assert.equal((key + value).includes(marker), false, '파일 자료가 브라우저 저장소에 남지 않는다: ' + marker)
    assert.deepEqual((await persisted()).sections.workflows, baseline)
  })
  await test('새로고침 후 파일형 수합은 사라지고 글·숫자 완료본과 개인 업무가 복원된다', async () => {
    await page.reload(); await screen('자료 수합'); await actor('gaon-minjun')
    await selectRequest(textTitle, '내가 만든 수합')
    assert.equal(await page.locator('.wf-request-card').count(), 1)
    assert.equal(await page.locator('.wf-request-card').filter({ hasText: fileTitle }).count(), 0)
    assert.equal(await page.getByRole('button', { name: response.name + ' 다운로드', exact: true }).count(), 0)
    assert.match(await unit('보존할 제출 단위').innerText(), /응답 완료 · 검토 없음/)
    assert.match(await unit('보존할 제출 단위').innerText(), new RegExp(textAnswer))
    assert.match(await unit('보존할 제출 단위').innerText(), /합성 수량: 0/)
    assert.deepEqual((await persisted()).sections.workflows, baseline)
    if (output) await page.screenshot({ path: join(output, 'file-persistence-after-reload.png'), fullPage: true })
    await menu('내 업무'); await page.getByRole('heading', { name: taskTitle, exact: true }).waitFor()
    assert.equal(await page.getByText(taskNote, { exact: true }).count(), 1)
    assert.deepEqual((await persisted()).sections.workflows, baseline)
    assert.deepEqual(errors, []); assert.deepEqual(external, [])
  })
  if (output) writeFileSync(join(output, 'file-persistence-results.json'), JSON.stringify({ passed: results.length, tests: results, observedWrites, generatedIds, errors, external }, null, 2))
  console.log(`\n파일 수합 영속 저장 브라우저 검증: ${results.length}개 통과`)
} catch (failure) {
  if (output) {
    writeFileSync(join(output, 'file-persistence-failure.json'), JSON.stringify({ passed: results.length, tests: results, error: String(failure), errors, external }, null, 2))
    await page.screenshot({ path: join(output, 'file-persistence-failure.png'), fullPage: true })
  }
  throw failure
} finally { await context.close(); await browser.close() }
