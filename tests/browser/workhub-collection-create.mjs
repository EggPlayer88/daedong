import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ entryPoints: [join(root, 'tests/browser/workhub-collection-create-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const results = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } });
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) });
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#f3f5f9;font-family:Arial,"Malgun Gothic",sans-serif}*{box-sizing:border-box}</style><div id="root"></div></html>' })
})
const hwpx = name => ({ name, mimeType: 'application/hwp+zip', buffer: Buffer.from('PK synthetic HWPX') })
const picker = () => page.getByLabel('양식 파일 선택', { exact: true })
const button = name => page.getByRole('button', { name, exact: true })
async function input() {
  await button('새 수합 만들기').click()
  await page.getByLabel('수합 제목', { exact: true }).fill('1학기 학급 운영계획')
  await page.getByLabel('제출 기한', { exact: true }).fill('2026-10-31')
  await page.getByLabel('안내 내용', { exact: true }).fill('양식에 맞춰 작성해 주세요.')
  await page.getByRole('checkbox', { name: '김담당', exact: true }).check()
}
async function test(name, action) {
  if (process.env.COLLECTION_TEST_FILTER && !name.includes(process.env.COLLECTION_TEST_FILTER)) return
  await page.goto('http://127.0.0.1:5179/collections'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await input()
  try { await action() } catch (error) { console.error(error); console.error(await page.locator('body').innerText({timeout:1000}).catch(() => '화면 읽기 시간 초과')); console.error(errors); throw error }
  results.push(name); console.log('  ✓ ' + name)
}
async function saved(count = 1) {
  await button('대상 교사에게 공개').waitFor()
  assert.equal(await page.evaluate(() => window.request.status), 'draft')
  assert.equal(await page.evaluate(() => window.request.fileCollection.templates.length), count)
  assert.equal(await page.evaluate(() => window.calls.filter(v => v.command.kind === 'create').length), 1)
  assert.equal(await page.evaluate(() => window.calls.some(v => ['publish', 'submit'].includes(v.command.kind))), false)
}
async function retryFile() { await button('같은 파일 상태 다시 확인').click() }
try {
  await test('파일 전송 실패는 권한 오류로 표시하지 않고 같은 초안에서 다시 내려받는다', async () => {
    await picker().setInputFiles(hwpx('보존양식.hwpx')); await button('수합 초안 저장').click(); await saved()
    await page.evaluate(() => { window.downloadFailure = 'FILE_FAILED' })
    await button('보존양식.hwpx 다운로드').click()
    await page.getByRole('alert').filter({hasText:'파일을 전송하거나 내용을 확인하는 중 오류'}).waitFor()
    assert.equal(await button('보존양식.hwpx 다운로드').count(),1)
    assert.equal(await page.getByText('현재 권한으로 파일을 내려받지 못했습니다.',{exact:false}).count(),0)
    await page.evaluate(() => { window.downloadFailure = '' })
    const received=page.waitForEvent('download');await button('보존양식.hwpx 다운로드').click()
    assert.equal((await received).suggestedFilename(),'보존양식.hwpx')
    await saved()
  })
  await test('실제 파일 접근 거절은 이전 수합 상세를 감춘다', async () => {
    await picker().setInputFiles(hwpx('권한양식.hwpx')); await button('수합 초안 저장').click(); await saved()
    await page.evaluate(() => { window.downloadFailure = 'FORBIDDEN' })
    await button('권한양식.hwpx 다운로드').click()
    await page.getByRole('alert').filter({hasText:'현재 계정의 파일 열람 권한'}).waitFor()
    assert.equal(await page.getByRole('region',{name:'수합 상세',exact:true}).count(),0)
  })
  await test('창 복귀 재조회 중에도 수합 상세·입력 DOM과 스크롤을 보존한다', async () => {
    await button('수합 초안 저장').click(); await saved(0)
    const detail = page.getByRole('region', { name: '수합 상세', exact: true })
    await detail.evaluate(node => { window.keptDetail = node })
    await page.evaluate(() => { window.readDelay = 700; window.refresh() })
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => window.keptDetail.isConnected), true, '재조회 중 상세를 제거하지 않아야 합니다')
    await button('대상 교사에게 공개').isDisabled().then(value => assert.equal(value, true))
    await page.waitForFunction(() => !document.querySelector('[aria-label="수합 상세"] button:last-child')?.disabled)
    await button('양식 추가·초안 수정').click()
    const title = page.getByLabel('수합 제목', { exact: true })
    await title.fill('돌아와도 유지할 제목'); await picker().setInputFiles(hwpx('보존.hwpx'))
    await title.focus()
    await title.evaluate(node => { node.setSelectionRange(2, 5); window.keptInput = node; window.scrollTo(0, 150); window.keptScroll = window.scrollY })
    await page.evaluate(() => window.refresh()); await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => window.keptInput.isConnected && document.activeElement === window.keptInput), true)
    assert.equal(await page.evaluate(() => window.scrollY), await page.evaluate(() => window.keptScroll))
    assert.equal(await button('수합 초안 변경 저장').isDisabled(), true)
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(v => v.textContent === '수합 초안 변경 저장')?.disabled)
    assert.equal(await title.inputValue(), '돌아와도 유지할 제목')
    assert.deepEqual(await title.evaluate(node => [node.selectionStart, node.selectionEnd]), [2, 5])
    assert.equal(await button('보존.hwpx 제거').count(), 1)
    await page.evaluate(() => { window.failRead = true; window.refresh() })
    await page.getByText('수합 원본의 접근 권한과 최신 상태를 확인하지 못했습니다. 보관한 입력은 확인 전까지 표시하지 않습니다.', { exact: true }).waitFor()
    assert.equal(await title.count(), 0, '조회 실패 뒤에는 이전 입력을 표시하면 안 됩니다')
  })
  await test('파일을 처음에 선택하고 한 번 저장하면 검사된 양식과 비공개 초안이 연결된다', async () => {
    await picker().setInputFiles([hwpx('학급 운영계획.hwpx'), hwpx('안내.hwpx')])
    assert.equal(await page.evaluate(() => window.calls.length + window.fileCalls.length), 0)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'create-desktop.png'), fullPage: true }) }
    await button('수합 초안 저장').click(); await saved(2)
    assert.deepEqual(await page.evaluate(() => window.calls.map(v => v.command.kind)), ['create', 'update'])
    assert.equal(await page.evaluate(() => window.fileCalls.filter(v => v.kind === 'complete').length), 2)
    const downloading = page.waitForEvent('download'); await button('학급 운영계획.hwpx 다운로드').click(); assert.equal((await downloading).suggestedFilename(), '학급 운영계획.hwpx')
  })
  await test('파일 선택 취소와 형식·빈 파일·용량·개수 초과는 저장 전에 처리한다', async () => {
    await picker().setInputFiles(hwpx('취소.hwpx')); await button('취소.hwpx 선택 취소').click()
    for (const invalid of [{ ...hwpx('오류.pdf') }, { ...hwpx('빈.hwpx'), buffer: Buffer.alloc(0) }, { ...hwpx('큰.hwpx'), buffer: Buffer.alloc(1025) }]) {
      await picker().setInputFiles(invalid); assert.equal(await page.locator('[aria-label="선택한 양식"] li').count(), 0)
    }
    await picker().setInputFiles([1, 2, 3, 4].map(i => hwpx(`${i}.hwpx`)))
    await page.getByText('양식은 최대 3개까지 선택할 수 있습니다.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.length + window.fileCalls.length), 0)
    await button('수합 초안 저장').click(); await saved(0)
  })
  for (const stage of ['create', 'update']) await test(`${stage} 응답 유실은 같은 요청 번호로 복구하며 초안을 중복 생성하지 않는다`, async () => {
    await picker().setInputFiles(hwpx('복구.hwpx')); await page.evaluate(stage => { window.mode = `unknown-${stage}` }, stage)
    await button('수합 초안 저장').click(); await button('이전 요청 그대로 다시 확인').click(); await button('대상 교사에게 공개').waitFor()
    const calls = await page.evaluate(stage => window.calls.filter(v => v.command.kind === stage), stage)
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1])
    assert.equal(await page.evaluate(() => window.applied), 2)
    assert.equal(await page.evaluate(() => window.request.fileCollection.templates.length), 1)
  })
  for (const stage of ['prepare', 'complete']) await test(`파일 ${stage} 유실도 같은 파일 예약·완료 번호로 재확인한다`, async () => {
    await picker().setInputFiles(hwpx('파일복구.hwpx')); await page.evaluate(stage => { window.fileMode = `unknown-${stage}` }, stage)
    await button('수합 초안 저장').click(); await retryFile(); await saved()
    const calls = await page.evaluate(stage => window.fileCalls.filter(v => v.kind === stage), stage)
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1])
  })
  await test('검사 대기 중에는 저장·공개를 멈추고 동일 파일 확인 후 자동으로 마친다', async () => {
    await picker().setInputFiles(hwpx('대기.hwpx')); await page.evaluate(() => { window.fileMode = 'pending' })
    await button('수합 초안 저장').click(); await button('같은 파일 상태 다시 확인').waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 1)
    assert.equal(await button('대상 교사에게 공개').count(), 0)
    await page.evaluate(() => { window.fileMode = '' }); await retryFile(); await saved()
  })
  await test('두 번째 파일 거부 시 첫 파일·입력은 보존하고 실패한 선택만 바꿔 같은 초안에 저장한다', async () => {
    await picker().setInputFiles([hwpx('정상.hwpx'), hwpx('거부.hwpx')]); await page.evaluate(() => { window.fileMode = 'reject-second' })
    await button('수합 초안 저장').click(); await button('거부된 파일 선택 해제').click()
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '1학기 학급 운영계획')
    assert.equal(await button('거부.hwpx 선택 취소').count(), 0); await page.evaluate(() => { window.fileMode = '' }); await picker().setInputFiles(hwpx('교체.hwpx'))
    await button('수합 초안 변경 저장').click(); await saved(2)
    assert.deepEqual(await page.evaluate(() => window.request.fileCollection.templates.map(v => v.name)), ['정상.hwpx', '교체.hwpx'])
  })
  await test('생성 뒤 조회 실패는 생성 접수증과 파일을 보존하고 조회 성공 뒤 이어 저장한다', async () => {
    await picker().setInputFiles(hwpx('조회복구.hwpx')); await page.evaluate(() => { window.failRead = true })
    await button('수합 초안 저장').click(); await button('연결과 원본 다시 확인').waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 1)
    await page.evaluate(() => { window.failRead = false }); await button('연결과 원본 다시 확인').focus(); await page.keyboard.press('Enter'); await saved()
  })
  await test('양식 연결 시 판 충돌은 자동 재저장하지 않고 검사된 파일과 입력을 보존한다', async () => {
    await picker().setInputFiles(hwpx('판충돌.hwpx')); await page.evaluate(() => { window.mode = 'conflict' })
    await button('수합 초안 저장').click(); await page.getByRole('heading', { name: '최신 내용과 내 입력을 비교해 주세요' }).waitFor()
    await button('최신 원본과 비교').click(); await page.getByText('다른 곳에서 바꾼 안내', { exact: true }).first().waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 2)
    assert.equal(await page.evaluate(() => window.request.fileCollection.templates.length), 0)
    assert.equal(await page.getByLabel('수합 제목', { exact: true }).inputValue(), '1학기 학급 운영계획')
    assert.equal(await button('판충돌.hwpx 제거').count(), 1)
  })
  await test('검사 대기 선택 취소는 자동 재전송하지 않고 이미 만든 초안을 유지한다', async () => {
    await picker().setInputFiles(hwpx('취소할파일.hwpx')); await page.evaluate(() => { window.fileMode = 'pending' })
    await button('수합 초안 저장').click(); await button('첨부 선택 취소').click()
    assert.equal(await button('취소할파일.hwpx 선택 취소').count(), 0)
    assert.equal(await button('수합 초안 변경 저장').isEnabled(), true)
    await button('수합 초안 변경 저장').click(); await saved(0)
    assert.equal(await page.evaluate(() => window.fileCalls.filter(v => v.kind === 'prepare').length), 1)
  })
  await test('예약 응답 유실 뒤 재진입해도 대기 파일과 원래 요청 번호를 이어 쓴다', async () => {
    await picker().setInputFiles(hwpx('재진입.hwpx')); await page.evaluate(() => { window.fileMode = 'unknown-prepare' })
    await button('수합 초안 저장').click(); await button('같은 파일 상태 다시 확인').waitFor()
    await page.evaluate(() => window.remount(false)); await page.getByRole('heading', { name: '문서 수합', exact: true }).waitFor({ state: 'detached' })
    await page.evaluate(() => window.remount(true)); await retryFile(); await saved()
    const calls = await page.evaluate(() => window.fileCalls.filter(v => v.kind === 'prepare'))
    assert.deepEqual(calls[0], calls[1])
  })
  await test('준비 중지와 보관·재개 뒤에도 같은 생성 요청과 선택 양식을 복구한다', async () => {
    await picker().setInputFiles(hwpx('중지복구.hwpx')); await page.evaluate(() => { window.mode = 'unknown-create' })
    await button('수합 초안 저장').click(); await button('이전 요청 그대로 다시 확인').waitFor()
    await page.evaluate(() => { window.ready = false; window.refresh() })
    await page.getByRole('heading', { name: '문서 수합 연결 준비가 필요합니다' }).waitFor()
    await button('입력 보관하고 다른 메뉴 이용').click(); await button('보관한 입력과 요청 다시 열기').click()
    await button('이전 요청 그대로 다시 확인').click()
    assert.equal(await page.evaluate(() => window.fileCalls.length), 0)
    await page.evaluate(() => { window.ready = true; window.refresh() }); await button('대상 교사에게 공개').waitFor()
    const calls = await page.evaluate(() => window.calls.filter(v => v.command.kind === 'create'))
    assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.applied), 2)
  })
  await test('생성 직후 다른 수정이 있으면 양식을 자동으로 보내지 않고 비교를 요청한다', async () => {
    await picker().setInputFiles(hwpx('경합.hwpx')); await page.evaluate(() => { window.mode = 'race-after-create' })
    await button('수합 초안 저장').click(); await page.getByRole('heading', { name: '최신 내용과 내 입력을 비교해 주세요' }).waitFor()
    assert.equal(await page.evaluate(() => window.fileCalls.length), 0)
    assert.equal(await page.evaluate(() => window.request.instructions), '생성 직후 다른 변경')
  })
  await test('화면을 나갔다 돌아와도 선택 파일은 유지되고 계정 변경에는 이전 입력을 표시하지 않는다', async () => {
    await picker().setInputFiles(hwpx('보관.hwpx'))
    await page.evaluate(() => window.remount(false)); await page.getByRole('heading', { name: '문서 수합', exact: true }).waitFor({ state: 'detached' })
    await page.evaluate(() => window.remount(true)); await button('보관.hwpx 선택 취소').waitFor()
    await page.evaluate(() => window.switchMember(1)); await button('새 수합 만들기').waitFor()
    assert.equal(await page.getByText('보관.hwpx', { exact: true }).count(), 0)
  })
  await test('좁은 화면과 200%에 해당하는 폭에서도 입력·버튼이 가로로 넘치지 않는다', async () => {
    await picker().setInputFiles(hwpx('학교와 학년 이름이 아주 길게 포함된 학급 운영계획 양식.hwpx'))
    for (const width of [640, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      assert.equal(await page.locator('.cs-optional').evaluateAll(nodes => nodes.every(v => !v.open)), true)
      if (output && width === 390) await page.screenshot({ path: join(output, 'create-mobile.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 1280, height: 1000 })
  })
  if (output && !process.env.COLLECTION_TEST_FILTER) {
    await page.goto('http://127.0.0.1:5179/collections'); await page.evaluate(() => { window.showcase = true })
    await page.addScriptTag({ content: bundle.outputFiles[0].text }); await input(); await picker().setInputFiles(hwpx('학급 운영계획 양식.hwpx'))
    await page.screenshot({ path: join(output, 'create-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 900 }); await page.screenshot({ path: join(output, 'create-mobile.png'), fullPage: true })
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) writeFileSync(join(output, 'result.json'), JSON.stringify({ results, errors, external }, null, 2))
  console.log(`\n양식 포함 수합 생성: ${results.length} 통과`)
} finally { await browser.close() }
