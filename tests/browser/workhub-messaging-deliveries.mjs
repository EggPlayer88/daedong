import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-messaging-deliveries-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 320, height: 800 } }), page = await context.newPage(), errors = [], external = []
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5179/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' }) : (external.push(route.request().url()), route.abort()))
let count = 0
const result = () => page.getByRole('region', { name: '최근 발송 결과', exact: true })
const writes = () => page.evaluate(() => window.qa.calls.filter(c => c.name === 'workhub_message_mutate'))
async function test(name, run) {
  await page.goto('http://127.0.0.1:5179/deliveries'); await page.addScriptTag({ content: bundle }); await page.getByText('조건에 맞는 대화가 없습니다.', { exact: true }).waitFor()
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); throw error }
  count++; console.log('  ✓ ' + name)
}
async function compose(mode = 'individual', body = '발송할 내용') {
  await page.getByRole('button', { name: '새 메시지', exact: true }).click()
  await page.getByLabel('보내는 방식').selectOption(mode)
  // 선택 순서와 서버 접수 순서를 다르게 고정한다.
  await page.getByLabel('김교사 · 교무부 [recipient-b]', { exact: true }).check()
  if (mode !== 'direct') await page.getByLabel('김교사 · 교무부 [recipient-a]', { exact: true }).check()
  if (mode === 'group') await page.getByLabel('대화 제목', { exact: true }).fill('함께 보는 협의')
  await page.getByLabel('메시지', { exact: true }).fill(body)
}
async function send() { await page.getByRole('button', { name: '받는 사람과 내용 확인', exact: true }).click(); await page.getByRole('button', { name: '확인한 내용 보내기', exact: true }).click() }
try {
  await test('동명이인 개별 발송 결과에서 목록에 없는 정확한 대화를 키보드로 연다', async () => {
    await compose(); await send(); await result().waitFor()
    assert.equal(await result().getByRole('button', { name: /대화 열기/ }).count(), 2)
    const open = result().getByRole('button', { name: '김교사 · 교무부 [recipient-a] 대화 열기', exact: true })
    await open.focus(); await page.keyboard.press('Enter')
    await page.getByText('발송할 내용 (thread-recipient-a)', { exact: true }).waitFor()
    const calls = await page.evaluate(() => window.qa.calls.filter(c => c.name === 'workhub_message_get'))
    assert.equal(calls.at(-1).args.p_thread_id, 'thread-recipient-a'); assert.equal((await writes()).length, 1)
    assert.equal(await page.getByRole('region', { name: '선택한 대화' }).getByRole('heading').evaluate(el => el === document.activeElement), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  })
  await test('수신자 검색은 발송된 대화만 좁히며 읽음·재전송하지 않는다', async () => {
    await compose(); await send(); await result().waitFor(); await result().getByLabel('발송 결과에서 받는 사람 찾기').fill('recipient-b')
    assert.equal(await result().getByRole('button', { name: /대화 열기/ }).count(), 1)
    await result().getByRole('button', { name: /recipient-b.*대화 열기/ }).click(); await page.getByText('발송할 내용 (thread-recipient-b)', { exact: true }).waitFor()
    assert.equal((await writes()).length, 1)
  })
  for (const mode of ['direct', 'group']) await test(`${mode} 발송은 수신자를 담은 하나의 대화로 연결한다`, async () => {
    await compose(mode); await send(); await result().waitFor(); assert.equal(await result().getByRole('button', { name: /대화 열기/ }).count(), 1)
    await result().getByRole('button', { name: /대화 열기/ }).click()
    await page.getByText(`발송할 내용 (${mode === 'group' ? 'thread-group' : 'thread-recipient-b'})`, { exact: true }).waitFor(); assert.equal((await writes()).length, 1)
  })
  await test('응답 유실 뒤 화면 복원과 같은 요청 확인으로 동일한 수신자별 접수를 되찾는다', async () => {
    await page.evaluate(() => { window.qa.unknown = true }); await compose(); await send(); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor()
    assert.equal(await result().count(), 0); await page.evaluate(() => window.qa.unmount()); await page.getByRole('heading', { name: '메시지와 알림' }).waitFor({ state: 'detached' }); await page.evaluate(() => window.qa.remount())
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await result().waitFor()
    const calls = await writes(); assert.deepEqual(calls[0].args, calls[1].args); assert.equal(await page.evaluate(() => window.qa.writes), 1)
    assert.equal(await result().getByRole('button', { name: /recipient-a.*대화 열기/ }).count(), 1)
    assert.equal(await result().getByRole('button', { name: /recipient-b.*대화 열기/ }).count(), 1)
    assert.equal(await page.evaluate(() => window.qa.pending.count()), 0)
  })
  await test('새 초안 입력과 수신자를 보관한 채 최근 발송 대화를 열고 다시 이어 쓴다', async () => {
    await compose(); await send(); await result().waitFor(); await compose('direct', '아직 보내지 않은 다음 초안')
    await result().getByRole('button', { name: /recipient-a.*입력 보관하고 대화 열기/ }).click(); await page.getByText('발송할 내용 (thread-recipient-a)', { exact: true }).waitFor()
    await page.getByRole('button', { name: '작성 계속하기', exact: true }).click()
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '아직 보내지 않은 다음 초안')
    assert.equal(await page.getByLabel('김교사 · 교무부 [recipient-b]', { exact: true }).isChecked(), true); assert.equal((await writes()).length, 1)
  })
  await test('최근 접수는 화면 재연결 후 유지하고 새 초안 폐기와 함께 지워지지 않는다', async () => {
    await compose(); await send(); await result().waitFor(); await compose('direct', '폐기할 초안')
    await page.getByRole('button', { name: '작성 닫기', exact: true }).click(); await page.getByRole('button', { name: '작성한 입력 버리고 닫기', exact: true }).click()
    await page.evaluate(() => window.qa.unmount()); await result().waitFor({ state: 'detached' }); await page.evaluate(() => window.qa.remount()); await result().waitFor()
    assert.equal(await page.evaluate(() => window.qa.drafts.count()), 0); assert.equal((await writes()).length, 1)
  })
  await test('다른 계정·학교로 전환하면 이전 접수와 대화 내용을 표시하지 않는다', async () => {
    await compose(); await send(); await result().waitFor(); await page.evaluate(() => window.qa.changeScope()); await result().waitFor({ state: 'detached' })
    assert.equal(await page.getByText(/발송할 내용/).count(), 0); assert.equal(await page.getByRole('button', { name: /recipient-a.*대화 열기/ }).count(), 0)
  })
  await test('대화 권한이 사라진 경우 이전 발송 결과를 숨기고 자동 재전송하지 않는다', async () => {
    await compose(); await send(); await result().waitFor(); await page.evaluate(() => { window.qa.denied = true })
    await result().getByRole('button', { name: /recipient-a.*대화 열기/ }).click(); await result().waitFor({ state: 'detached' }); await page.getByText('현재 학교의 메시지 이용 권한을 다시 확인해 주세요.', { exact: true }).waitFor(); assert.equal((await writes()).length, 1)
  })
  await test('연결 교체 전 전송의 늦은 응답은 표시하지 않고 원래 번호 복구를 남긴다', async () => {
    await page.evaluate(() => { window.qa.defer = true }); await compose(); await send(); await page.waitForFunction(() => typeof window.qa.release === 'function')
    await page.evaluate(() => window.qa.replaceConnection()); await page.waitForFunction(() => window.qa.calls.filter(c => c.name === 'workhub_messaging_readiness').length >= 3)
    await page.evaluate(() => window.qa.release()); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor()
    assert.equal(await result().count(), 0); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await result().waitFor()
    const calls = await writes(); assert.deepEqual(calls[0].args, calls[1].args); assert.equal(await page.evaluate(() => window.qa.writes), 1)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`메시지 발송 결과 브라우저 ${count}건 통과 · 실제 RPC/외부 접속 0`)
} finally { await context.close(); await browser.close() }
