import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-messaging-coherent-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin !== 'http://127.0.0.1:5183') { external.push(url.href); return route.abort() }
  const font = url.pathname.match(/(PretendardVariable|TossFaceFontMac-0[789])\.woff2$/)
  if (font) return route.fulfill({ contentType: 'font/woff2', body: readFileSync(new URL('../../apps/workhub/src/assets/fonts/' + (font[1].startsWith('Toss') ? 'tossface/' : '') + font[0], import.meta.url)) })
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const form = () => page.getByRole('form', { name: '새 메시지 작성', exact: true })
const picker = () => page.locator('.messaging-recipient-editor')
async function start(theme = 'light', textSize = 'standard') {
  await page.goto('http://127.0.0.1:5183/messages')
  await page.evaluate(({ theme, textSize }) => localStorage.setItem('workhub:appearance:v1', JSON.stringify({ theme, textSize, density: 'comfortable' })), { theme, textSize })
  await page.addStyleTag({ content: readFileSync(new URL('../../apps/workhub/src/typography.css', import.meta.url), 'utf8') + readFileSync(new URL('../../apps/workhub/src/assets/fonts/tossface/tossface.css', import.meta.url), 'utf8') })
  await page.addScriptTag({ content: bundle })
  try { await button('새 메시지').waitFor() } catch (error) { console.error('초기 오류', errors, await page.locator('body').innerText()); throw error }
}
async function test(name, run) { await start(); try { await run() } catch (error) { console.error(await page.locator('body').innerText()); throw error } results.push(name); console.log('  ✓ ' + name) }
async function compose() {
  await button('새 메시지').click(); await page.getByLabel('보내는 방식').selectOption('individual')
  await page.getByLabel('김민준 · 교무부', { exact: true }).check(); await page.getByLabel('이소연 · 교육연구부', { exact: true }).check()
  await page.getByLabel('메시지', { exact: true }).fill('다음 주 학년 협의회 자료를 확인해 주세요.\n검토 의견은 금요일까지 부탁드립니다.')
}
async function capture(name) { if (output) { mkdirSync(output, { recursive: true }); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: join(output, name + '.png'), fullPage: true }) } }
async function fits() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true) }
try {
  await test('목록과 상세의 참여자·원본 정보를 열어도 읽음 명령을 보내지 않는다', async () => {
    await page.getByRole('region', { name: '대화 목록' }).getByRole('button', { name: /학년 협의회 준비/ }).click()
    const detail = page.getByRole('region', { name: '선택한 대화' })
    await detail.getByText('자료 확인했습니다. 학급별 준비 사항을 정리해서 공유하겠습니다.', { exact: true }).waitFor()
    assert.equal(await detail.getByText(/대화 번호:/).isVisible(), false)
    await detail.getByText('참여자·대화 정보', { exact: true }).click(); assert.equal(await detail.getByText(/대화 번호: thread-planning/).isVisible(), true)
    assert.deepEqual(await page.evaluate(() => window.qa.writes), [])
    await capture('messaging-detail-desktop'); await fits()
    await button('화면에 연 메시지까지 읽음 표시').click()
    assert.deepEqual(await page.evaluate(() => window.qa.writes.map(row => row.command)), [{ kind: 'read_thread', threadId: 'thread-planning', throughSequence: 2 }])
  })
  await test('수신자 요약을 접고 변경해도 선택과 입력을 보존하며 확인 전에는 전송하지 않는다', async () => {
    await compose(); await button('선택 완료').click()
    assert.equal(await picker().evaluate(el => el.open), false)
    assert.match(await form().locator('.messaging-recipient-summary').innerText(), /2명[\s\S]*김민준[\s\S]*이소연[\s\S]*각자에게 개별 전송/)
    assert.equal(await page.getByLabel('교사 이름·부서 검색').isVisible(), false)
    assert.equal(await page.getByLabel('메시지', { exact: true }).isVisible(), true)
    await capture('messaging-compose-desktop')
    await picker().locator('summary').first().focus(); await page.keyboard.press('Enter')
    assert.equal(await page.getByLabel('김민준 · 교무부', { exact: true }).isChecked(), true)
    assert.equal(await page.getByLabel('이소연 · 교육연구부', { exact: true }).isChecked(), true)
    await button('선택 완료').click(); await button('받는 사람과 내용 확인').click()
    const preview = page.getByRole('region', { name: '보내기 전 확인' })
    assert.equal(await form().isVisible(), false); assert.match(await preview.innerText(), /받는 사람끼리는 서로의 명단을 보지 않습니다/)
    assert.equal(await preview.getByText('소속 번호: peer-kim', { exact: true }).isVisible(), false)
    await preview.getByText('받는 사람 소속 정보', { exact: true }).click(); assert.equal(await preview.getByText('소속 번호: peer-kim', { exact: true }).isVisible(), true)
    assert.deepEqual(await page.evaluate(() => window.qa.writes), [])
    await button('내용 수정').click(); assert.match(await page.getByLabel('메시지', { exact: true }).inputValue(), /검토 의견은 금요일/)
  })
  await test('수신자를 접어도 단체 대화 필수 제목은 보이며 누락 시 초점과 검증 안내를 제공한다', async () => {
    await compose(); await page.getByLabel('보내는 방식').selectOption('group'); await button('선택 완료').click()
    const title = page.getByLabel('대화 제목', { exact: true })
    assert.equal(await picker().evaluate(el => el.open), false); assert.equal(await title.isVisible(), true)
    await button('받는 사람과 내용 확인').click()
    assert.equal(await title.evaluate(el => el === document.activeElement), true)
    assert.equal(await title.evaluate(el => el.validity.valueMissing && Boolean(el.validationMessage)), true)
    assert.equal(await page.getByRole('region', { name: '보내기 전 확인' }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.qa.writes), [])
    await title.fill('학년 협의회 준비'); await button('받는 사람과 내용 확인').click()
    await page.getByRole('region', { name: '보내기 전 확인' }).getByText('학년 협의회 준비', { exact: true }).waitFor()
    await button('확인한 내용 보내기').click(); await page.getByRole('region', { name: '최근 발송 결과' }).waitFor()
    const writes = await page.evaluate(() => window.qa.writes)
    assert.equal(writes.length, 1); assert.equal(writes[0].command.mode, 'group'); assert.equal(writes[0].command.title, '학년 협의회 준비')
    assert.deepEqual(writes[0].command.recipients.map(person => person.memberId), ['peer-kim', 'peer-lee'])
  })
  await test('수신자 선택을 접어도 조회 오류와 재조회 버튼은 그대로 보인다', async () => {
    await compose(); await page.evaluate(() => { window.qa.recipientFailure = true }); await button('교사 찾기').click()
    await button('받는 사람 다시 조회').waitFor(); await button('선택 완료').click()
    assert.equal(await picker().evaluate(el => el.open), false); assert.equal(await button('받는 사람 다시 조회').isVisible(), true)
    assert.equal(await page.getByRole('alert').filter({ hasText: '서버에 연결하지 못했습니다' }).isVisible(), true)
    await page.evaluate(() => { window.qa.recipientFailure = false }); await button('받는 사람 다시 조회').click()
    await button('받는 사람 다시 조회').waitFor({ state: 'detached' }); assert.deepEqual(await page.evaluate(() => window.qa.writes), [])
  })
  await test('결과 미확정 요청은 입력을 접고 재진입해도 드러나며 원키·원문으로만 복구한다', async () => {
    await compose(); await button('선택 완료').click(); await button('받는 사람과 내용 확인').click()
    await page.evaluate(() => { window.qa.unknown = true }); await button('확인한 내용 보내기').click(); await button('이전 요청 그대로 다시 확인').waitFor()
    const first = await page.evaluate(() => window.qa.writes[0])
    await page.getByRole('region', { name: '이전 메시지 요청 확인' }).getByRole('button', { name: '입력 접고 목록 보기', exact: true }).click()
    assert.equal(await button('이전 요청 그대로 다시 확인').isVisible(), true); assert.equal(await form().isVisible(), false)
    await page.evaluate(() => window.qa.setVisible(false)); await page.locator('.messaging-workspace').waitFor({ state: 'detached' })
    await page.evaluate(() => window.qa.setVisible(true)); await button('이전 요청 그대로 다시 확인').waitFor()
    await button('이전 요청 그대로 다시 확인').click(); await page.getByRole('region', { name: '최근 발송 결과' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.qa.writes[1]), first); assert.equal(await page.evaluate(() => window.qa.applied), 1)
    assert.equal(await page.evaluate(() => window.qa.pending.count()), 0)
  })
  await test('320px·다크·큰 글씨에서도 수신자 요약과 확인 화면이 잘리지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 844 }); await start('dark', 'large'); await compose(); await button('선택 완료').click()
    await fits(); assert.equal(await picker().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    await capture('messaging-compose-mobile-dark')
    await button('받는 사람과 내용 확인').click(); await fits(); await capture('messaging-preview-mobile-dark')
    const primary = page.getByRole('region', { name: '보내기 전 확인' }).getByRole('button', { name: '확인한 내용 보내기' })
    assert.equal(await primary.evaluate(el => getComputedStyle(el).color), 'rgb(23, 39, 67)')
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`메신저 화면 통일 브라우저 ${results.length}건 통과 · 외부 호출 0건`)
} finally {
  if (output) { mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'messaging-coherent-results.json'), JSON.stringify({ results, errors, external }, null, 2)) }
  await context.close(); await browser.close()
}
