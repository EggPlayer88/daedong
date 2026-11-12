import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ entryPoints: [join(root, 'tests/browser/workhub-collection-conversation-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1000, height: 900 }, acceptDownloads: true }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
page.on('pageerror', error => errors.push(error.message)); page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
page.setDefaultTimeout(15000)
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#f5f7fa;font-family:Arial,"Malgun Gothic",sans-serif}*{box-sizing:border-box}</style><div id="root"></div></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const hwpx = name => ({ name, mimeType: 'application/hwp+zip', buffer: Buffer.from('PK synthetic HWPX') })
const writeCalls = () => page.evaluate(() => window.calls.map(value => value.command.kind))
async function reset(compose = false) { await page.goto('http://127.0.0.1:5179/conversation'); await page.evaluate(value => { window.withCompose = value }, compose); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: '수합 작업', exact: true }).waitFor() }
async function input() { await button('새 수합 만들기').click(); await page.getByLabel('수합 제목', { exact: true }).fill('대화 수합 시험'); await page.getByLabel('제출 기한', { exact: true }).fill('2026-11-20'); await page.getByRole('checkbox', { name: '담당교사', exact: true }).check() }
async function draft() { await input(); await button('수합 초안 저장').click(); await button('대상 교사에게 공개').waitFor() }
async function published() { await draft(); await button('대상 교사에게 공개').click(); await button('대상·양식 확인 후 공개').click(); await button('내 제출 파일 작성').waitFor() }
async function answer() { await published(); await button('내 제출 파일 작성').click(); await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('제출.hwpx')); await page.getByText(/파일 준비가 완료되었습니다/).waitFor(); await button('제출 초안 저장').click(); await button('최종 제출 내용 확인').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '최종 제출 내용 확인' && !b.disabled)) }
async function test(name, action, compose = false) { await reset(compose); try { await action() } catch (error) { console.error(await page.locator('body').innerText()); throw error } results.push(name); console.log('  ✓ ' + name) }
try {
  await test('AI 초안의 제목·기한·대상을 보존하고 사용자 확인 전 쓰기 없이 대화 작업을 연다', async () => {
    assert.deepEqual(await writeCalls(), []); await button('수합 초안 사용').click()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), 'AI로 준비한 수합')
    assert.equal(await page.getByLabel('제출 기한', { exact: true }).inputValue(), '2026-11-20')
    assert.equal(await page.getByRole('checkbox', { name: '담당교사', exact: true }).isChecked(), true)
    assert.deepEqual(await writeCalls(), [])
  }, true)
  await test('HWPX 양식은 원래 검사 경로를 거쳐 비공개 저장하고 별도 확인 뒤에만 공개한다', async () => {
    await input(); await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx('배부.hwpx')); assert.deepEqual(await writeCalls(), [])
    await button('수합 초안 저장').click(); await button('대상 교사에게 공개').waitFor()
    assert.deepEqual(await writeCalls(), ['create', 'update']); assert.equal(await page.evaluate(() => window.state.request.fileCollection.templates.length), 1)
    await button('대상 교사에게 공개').click(); assert.deepEqual(await writeCalls(), ['create', 'update'])
    await button('대상·양식 확인 후 공개').click(); await button('내 제출 파일 작성').waitFor(); assert.deepEqual(await writeCalls(), ['create', 'update', 'publish'])
  })
  await test('공개 검토 뒤 판이 달라지면 이전 확인으로 공개하지 않는다', async () => {
    await draft(); await button('대상 교사에게 공개').click(); await page.evaluate(() => { window.state.request.version++; window.state.request.instructions = '바뀐 안내'; window.refresh() })
    await page.getByText('초안이 변경되었습니다. 확인을 닫고 최신 내용을 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await button('대상·양식 확인 후 공개').isDisabled(), true); assert.deepEqual(await writeCalls(), ['create'])
  })
  await test('초안 저장 유실은 원래 번호로 복구하고 공개를 자동 실행하지 않는다', async () => {
    await input(); await page.evaluate(() => { window.unknown = 'create' }); await button('수합 초안 저장').click(); await button('이전 요청 그대로 다시 확인').click(); await button('대상 교사에게 공개').waitFor()
    const calls = await page.evaluate(() => window.calls); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.state.request.status), 'draft')
  })
  await test('작성 중 수합을 명시적으로 접고 돌아와도 제목·기한·선택 파일을 보존한다', async () => {
    await input(); await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx('이어쓰기.hwpx'))
    await button('입력 보관하고 접기').click(); await button('보관한 입력과 요청 다시 열기').waitFor()
    assert.equal(await page.evaluate(() => window.locked), false); assert.deepEqual(await writeCalls(), [])
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).count(), 0)
    await button('보관한 입력과 요청 다시 열기').click()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '대화 수합 시험'); assert.equal(await page.getByLabel('제출 기한', { exact: true }).inputValue(), '2026-11-20')
    assert.equal(await button('이어쓰기.hwpx 선택 취소').count(), 1); assert.deepEqual(await writeCalls(), [])
  })
  await test('파일 검사 대기 중에는 새 대화 접기 버튼으로 파일 처리를 버리지 않는다', async () => {
    await published(); await button('내 제출 파일 작성').click(); await page.evaluate(() => { window.fileMode = 'pending' }); await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('검사중.hwpx'))
    await button('같은 파일 상태 다시 확인').waitFor(); assert.equal(await button('입력 보관하고 접기').isDisabled(), true)
    assert.equal(await page.evaluate(() => window.locked), true); assert.equal((await writeCalls()).includes('save_draft'), false)
  })
  await test('파일 초안 저장 뒤 최종 제출 카드에서 파일·단위를 확인하기 전에는 제출하지 않는다', async () => {
    await answer(); assert.equal((await writeCalls()).includes('submit'), false); await button('최종 제출 내용 확인').click()
    const review = page.getByRole('region', { name: '대화 수합 최종 제출 확인', exact: true }); await review.waitFor(); assert.match(await review.innerText(), /제출.hwpx/); assert.match(await review.innerText(), /담당교사/)
    assert.equal((await writeCalls()).includes('submit'), false)
    if (output) { mkdirSync(output, { recursive: true }); await review.screenshot({ path: join(output, 'collection-submit-review.png') }) }
    await button('확인한 파일 최종 제출').click(); await page.getByText(/최종 제출을 접수했습니다/).waitFor(); assert.equal(await page.evaluate(() => window.state.submissions.length), 1)
  })
  await test('최종 제출 응답 유실 뒤 같은 요청으로 복구해 중복 접수를 막는다', async () => {
    await answer(); await button('최종 제출 내용 확인').click(); await page.evaluate(() => { window.unknown = 'submit' }); await button('확인한 파일 최종 제출').click(); await button('이전 요청 그대로 다시 확인').click(); await page.getByText(/최종 제출을 접수했습니다/).waitFor()
    const calls = await page.evaluate(() => window.calls.filter(value => value.command.kind === 'submit')); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.state.submissions.length), 1)
  })
  await test('최종 확인 이후 수합 제목·기한·판 변경은 기존 확인을 무효화한다', async () => {
    await answer(); await button('최종 제출 내용 확인').click(); await page.evaluate(() => { window.state.request.title = '바뀐 수합'; window.state.request.dueDate = '2026-11-22'; window.state.request.version++; window.refresh() })
    await page.getByText('입력이나 저장한 판이 달라졌습니다. 확인을 닫고 현재 내용을 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await button('확인한 파일 최종 제출').isDisabled(), true); assert.equal((await writeCalls()).includes('submit'), false)
  })
  await test('생성 문서도 별도 수합 파일 예약·검사·초안 저장 뒤 명시 확인으로 제출한다', async () => {
    await published(); await page.evaluate(() => window.provideGenerated()); await button('내 제출 파일 작성').click(); await button('문서함에서 만든 HWPX 첨부').click(); await page.getByText(/파일 준비가 완료되었습니다/).waitFor()
    assert.deepEqual(await page.evaluate(() => window.uploads.map(value => value.kind)), ['prepare', 'upload', 'complete']); assert.equal((await writeCalls()).includes('save_draft'), false)
    await button('제출 초안 저장').click(); await button('최종 제출 내용 확인').click(); await button('확인한 파일 최종 제출').click(); await page.getByText(/최종 제출을 접수했습니다/).waitFor()
    assert.equal(await page.evaluate(() => window.state.submissions[0].files[0].name), '질문답변.hwpx'); assert.notEqual(await page.evaluate(() => window.state.submissions[0].files[0].id), 'document-artifact-1')
  })
  for (const cause of ['FORBIDDEN', 'NOT_FOUND', 'no-unit']) await test(`생성물 대상 수합을 사용할 수 없어도 전달 선택만 해제하고 원본을 유지한다: ${cause}`, async () => {
    await published(); await page.evaluate(cause => { window.provideGenerated(); if (cause === 'no-unit') window.state.units = []; else window.denied = cause; window.refresh() }, cause)
    const discard = button('전달받은 생성 파일 사용 안 함'); await discard.waitFor()
    if (cause !== 'no-unit') await page.getByText('수합 원본의 접근 권한과 최신 상태를 확인하지 못했습니다. 보관한 입력은 확인 전까지 표시하지 않습니다.', { exact: true }).waitFor()
    else await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent === '내 제출 파일 작성'))
    const before = await writeCalls(); await discard.click(); assert.equal(await page.getByRole('region', { name: '전달받은 생성 파일', exact: true }).count(), 0)
    assert.deepEqual(await writeCalls(), before); assert.deepEqual(await page.evaluate(() => window.uploads), []); assert.equal(await page.evaluate(() => window.state.request.status), 'published')
  })
  await test('미확정 제출 중 전달된 파일 선택은 원래 접수 결과를 확인하기 전 해제하지 않는다', async () => {
    await answer(); await button('최종 제출 내용 확인').click(); await page.evaluate(() => { window.unknown = 'submit' }); await button('확인한 파일 최종 제출').click(); await page.getByText('이전 저장 결과 확인이 필요합니다', { exact: true }).waitFor()
    await page.evaluate(() => window.provideGenerated()); assert.equal(await button('전달받은 생성 파일 사용 안 함').isDisabled(), true)
    await button('이전 요청 그대로 다시 확인').click(); await page.getByText(/최종 제출을 접수했습니다/).waitFor(); await button('전달받은 생성 파일 사용 안 함').click()
    assert.equal(await page.evaluate(() => window.state.submissions.length), 1)
  })
  await test('접힌 관리 영역에서도 마감 상태를 조회하고 새 제출 작성을 막는다', async () => {
    await published(); await page.evaluate(() => { window.phase = 'closed'; window.refresh() }); await page.getByText(/마감된 수합입니다/).waitFor()
    assert.equal(await button('내 제출 파일 작성').isDisabled(), true); assert.equal(await page.getByText('접수 상태·마감 관리', { exact: true }).evaluate(node => node.parentElement.open), false)
  })
  await test('390px·큰 글씨에서 제출 확인과 복구 조작이 가로로 넘치지 않는다', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await answer(); await button('최종 제출 내용 확인').click(); await page.addStyleTag({ content: 'html{font-size:200%}button,input,select,textarea{font:inherit}' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'collection-conversation-mobile.png'), fullPage: true }) }
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`대화 수합 브라우저 ${results.length}건 통과`)
} finally { await browser.close() }
