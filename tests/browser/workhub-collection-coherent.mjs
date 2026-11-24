import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ entryPoints: [join(root, 'tests/browser/workhub-collection-conversation-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const font = readFileSync(join(root, 'apps/workhub/src/assets/fonts/PretendardVariable.woff2')).toString('base64')
const typography = readFileSync(join(root, 'apps/workhub/src/typography.css'), 'utf8')
  .replace("./assets/fonts/PretendardVariable.woff2", `data:font/woff2;base64,${font}`)
const shellStyles = ['workspace-shell.css', 'workspace-renewal.css', 'site-experience.css']
  .map(file => readFileSync(join(root, 'apps/workhub/src/app', file), 'utf8')).join('\n')
// 실제 공통 토큰과 원본 글꼴을 로컬로 주입한다. 화면 계약과 합성 서버는 기존 회귀와 같다.
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${typography}${shellStyles}*{box-sizing:border-box}body{margin:0;padding:16px;background:#f6f7f9;font-family:'Pretendard Variable',sans-serif}#root{max-width:1120px;margin:auto;min-height:0}</style><div id="root" class="ws-shell" data-theme="light"></div></html>`
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1080, height: 850 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
page.setDefaultTimeout(15000)
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: html })
})
const button = name => page.getByRole('button', { name, exact: true })
const review = () => page.getByRole('region', { name: '대화 수합 최종 제출 확인', exact: true })
const hwpx = name => ({ name, mimeType: 'application/hwp+zip', buffer: Buffer.from('PK synthetic HWPX') })
const writes = () => page.evaluate(() => window.calls.map(value => value.command.kind))
async function reset(options = {}) {
  await page.goto('http://127.0.0.1:5179/coherent')
  await page.evaluate(options => { window.withCompose = options.compose; window.presentation = options.presentation ?? 'assistant' }, options)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Pretendard Variable"')), true)
  assert.match(await page.locator('.collection-coherent').evaluate(node => getComputedStyle(node).fontFamily), /Pretendard Variable/)
  await page.getByRole('heading', { name: options.presentation === 'page' ? '문서 수합' : '수합 작업', exact: true }).waitFor()
}
async function input() {
  await button('새 수합 만들기').click()
  await page.getByLabel('수합 제목', { exact: true }).fill('수합 흐름 확인')
  await page.getByLabel('제출 기한', { exact: true }).fill('2026-11-20')
  await page.getByRole('checkbox', { name: '담당교사', exact: true }).check()
}
async function published() {
  await input(); await button('수합 초안 저장').click(); await button('대상 교사에게 공개').click()
  assert.equal((await writes()).includes('publish'), false)
  await button('대상·양식 확인 후 공개').click(); await button('내 제출 파일 작성').waitFor()
}
async function answer() {
  await published(); await button('내 제출 파일 작성').click()
  await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('최종확인.hwpx'))
  await page.getByText(/파일 준비가 완료되었습니다/).waitFor()
}
async function save() { await button('제출 초안 저장').click(); await button('확인한 파일 최종 제출').and(page.locator(':enabled')).waitFor() }
async function test(name, action, options) {
  await reset(options)
  try { await action() } catch (error) { console.error(await page.locator('body').innerText()); throw error }
  results.push(name); console.log('  ✓ ' + name)
}
try {
  await test('AI 선택 초안을 중복 진입 없이 열고 대상 요약·필드·미저장 상태를 보존한다', async () => {
    await page.getByLabel('수합 제목', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), 'AI로 준비한 수합')
    assert.equal(await page.getByLabel('제출 기한', { exact: true }).inputValue(), '2026-11-20')
    assert.equal(await button('수합 초안 사용').count(), 0)
    assert.match(await page.getByRole('list', { name: '선택한 제출 대상', exact: true }).innerText(), /담당교사/)
    assert.equal(await page.getByText('제출 대상 변경', { exact: true }).evaluate(node => node.parentElement.open), false)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'collection-coherent-compose.png'), fullPage: true }) }
    await page.getByText('제출 대상 변경', { exact: true }).click()
    assert.equal(await page.getByRole('checkbox', { name: '담당교사', exact: true }).isChecked(), true)
    assert.deepEqual(await writes(), [])
    await button('작성 취소').click(); await button('새 수합 만들기').and(page.locator(':enabled')).waitFor()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).count(), 0)
    assert.deepEqual(await writes(), [])
  }, { compose: true })
  await test('일반 메뉴에서 받은 초안은 기존 사용·닫기 선택을 유지한다', async () => {
    await button('수합 초안 사용').and(page.locator(':enabled')).waitFor()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).count(), 0)
    await button('전달받은 수합 초안 닫기').click()
    assert.equal(await button('수합 초안 사용').count(), 0); assert.deepEqual(await writes(), [])
  }, { compose: true, presentation: 'page' })
  await test('새 AI 초안은 작성 중인 수합·기한·대상을 덮어쓰지 않는다', async () => {
    await input()
    await page.evaluate(() => window.provideCompose({ id: 'late-compose', schoolId: 'school', memberId: 'member-0', basisDate: '2026-11-11', title: '다른 초안', instructions: '다른 내용', dueDate: '2026-11-25', targetMemberIds: ['member-1'] }))
    await button('수합 초안 사용').waitFor(); assert.equal(await button('수합 초안 사용').isDisabled(), true)
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '수합 흐름 확인')
    assert.equal(await page.getByLabel('제출 기한', { exact: true }).inputValue(), '2026-11-20')
    assert.equal(await page.getByRole('checkbox', { name: '담당교사', exact: true }).isChecked(), true)
    await button('전달받은 수합 초안 닫기').click(); assert.deepEqual(await writes(), [])
  })
  await test('저장 접수와 최신 판 확인 뒤 검토 카드만 자동 표시하고 최종 버튼 전에는 제출하지 않는다', async () => {
    await answer(); await save()
    assert.equal(await review().count(), 1); assert.equal(await button('최종 제출 내용 확인').count(), 0)
    assert.match(await review().innerText(), /최종확인.hwpx/)
    assert.deepEqual(await writes(), ['create', 'publish', 'save_draft'])
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'collection-coherent-review.png'), fullPage: true }) }
    await button('확인한 파일 최종 제출').click(); await page.getByText(/최종 제출을 접수했습니다/).waitFor()
    assert.deepEqual(await writes(), ['create', 'publish', 'save_draft', 'submit'])
  })
  await test('저장 응답 유실에는 검토를 열지 않고 원래 번호 복구 뒤에만 연다', async () => {
    await answer(); await page.evaluate(() => { window.unknown = 'save_draft' }); await button('제출 초안 저장').click()
    await button('이전 요청 그대로 다시 확인').waitFor(); assert.equal(await review().count(), 0)
    await button('이전 요청 그대로 다시 확인').click(); await review().waitFor()
    const calls = await page.evaluate(() => window.calls.filter(value => value.command.kind === 'save_draft'))
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal((await writes()).includes('submit'), false)
  })
  await test('접수 뒤 다른 초안 판이 생기면 자동 검토 대신 충돌을 보인다', async () => {
    await answer()
    await page.evaluate(() => { const original = window.server.mutate; window.server.mutate = async (...args) => { const result = await original(...args); if (args[1].kind === 'save_draft') { window.state.draft.version++; window.state.draft.text = '다른 작성자의 변경' } return result } })
    await button('제출 초안 저장').click()
    await page.getByText('초안 저장 뒤 다른 변경이 확인되었습니다. 최신 내용과 내 입력을 비교해 주세요.', { exact: true }).waitFor()
    assert.equal(await review().count(), 0); assert.equal((await writes()).includes('submit'), false)
  })
  await test('검토 후 파일을 바꾸면 기존 최종 버튼이 잠기고 변경 안내를 표시한다', async () => {
    await answer(); await save(); await button('최종확인.hwpx 제거').click()
    await page.getByText('입력이나 저장한 판이 달라졌습니다. 확인을 닫고 현재 내용을 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await button('확인한 파일 최종 제출').isDisabled(), true); assert.equal((await writes()).includes('submit'), false)
  })
  await test('닫은 검토는 같은 판 재조회로 다시 열지 않고 직접 다시 확인할 수 있다', async () => {
    await answer(); await save(); await button('제출 확인 닫기').click(); await page.evaluate(() => window.refresh())
    await button('최종 제출 내용 확인').and(page.locator(':enabled')).waitFor(); assert.equal(await review().count(), 0)
    await button('최종 제출 내용 확인').click(); await review().waitFor(); assert.equal((await writes()).includes('submit'), false)
  })
  await test('파일 검사 미확정 상태에는 저장·자동 최종 검토를 진행하지 않는다', async () => {
    await published(); await button('내 제출 파일 작성').click(); await page.evaluate(() => { window.fileMode = 'pending' })
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('대기.hwpx'))
    await button('같은 파일 상태 다시 확인').waitFor()
    assert.equal(await button('제출 초안 저장').isDisabled(), true); assert.equal(await review().count(), 0)
    assert.equal((await writes()).includes('save_draft'), false)
  })
  await test('공동 작성자는 초안을 저장해도 책임자의 최종 제출 검토가 열리지 않는다', async () => {
    await published()
    await page.evaluate(() => { window.state.units[0].responsibleMemberId = 'member-1'; window.state.units[0].contributorMemberIds = ['member-0']; window.refresh() })
    await button('내 제출 파일 작성').click()
    await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('공동작성.hwpx'))
    await page.getByText(/파일 준비가 완료되었습니다/).waitFor(); await button('제출 초안 저장').click()
    await page.waitForFunction(() => window.state.draft?.version === 1)
    await page.getByText(/초안을 저장했습니다/).waitFor()
    assert.equal(await review().count(), 0); assert.equal(await button('확인한 파일 최종 제출').count(), 0)
    assert.equal((await writes()).includes('submit'), false)
  })
  await test('저장 중 마감된 수합은 최신 상태를 읽은 뒤 최종 제출 검토를 자동으로 열지 않는다', async () => {
    await answer()
    await page.evaluate(() => { const original = window.server.mutate; window.server.mutate = async (...args) => { const result = await original(...args); if (args[1].kind === 'save_draft') window.phase = 'closed'; return result } })
    await button('제출 초안 저장').click(); await page.getByText(/마감된 수합입니다/).first().waitFor()
    assert.equal(await review().count(), 0); assert.equal((await writes()).includes('submit'), false)
  })
  await test('320px·큰 글자에서도 검토·오류·대상 변경 조작이 화면 안에 남는다', async () => {
    await page.setViewportSize({ width: 320, height: 850 }); await answer(); await save()
    await page.addStyleTag({ content: 'html{font-size:200%}button,input,select,textarea{font:inherit}' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) await page.screenshot({ path: join(output, 'collection-coherent-mobile.png'), fullPage: true })
    assert.equal(await button('확인한 파일 최종 제출').isEnabled(), true)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`수합 연결 정리 브라우저 ${results.length}건 통과`)
} finally { await browser.close() }
