// M1: 공손한 요청도 실제 연결 셸에서 기존 업무 경로로 간다. RPC·AI HTTP는 합성만 사용한다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
import { launchBrowser } from './launch-browser.mjs'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./workhub-cross-module-fixture.tsx', import.meta.url))],
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  plugins: [{ name: 'polite-request-synthetic-transport', setup(builder) {
    builder.onLoad({ filter: /collections[\\/]legacy-storage\.ts$/ }, () => ({ contents: 'export const legacyStorage={upload:async(...args)=>{window.cross.storageCalls.push(args);throw Error("unexpected upload")},download:async(...args)=>{window.cross.storageCalls.push(args);throw Error("unexpected download")}}', loader: 'ts' }))
    builder.onLoad({ filter: /assistant[\\/]legacy-http\.ts$/ }, () => ({ contents: 'export const legacyAssistantHttp={send:payload=>window.cross.assistantHttp(payload)};export const legacySchoolAiHttp={send:async()=>{throw Error("synthetic settings unavailable")}};export const legacySchoolAiOperationsHttp={send:async()=>{throw Error("synthetic operations unavailable")}}', loader: 'ts' }))
  } }],
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
})
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const errors = [], external = [], origin = 'http://127.0.0.1:5332/'
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const region = name => page.getByRole('region', { name, exact: true })
const input = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
let count = 0
async function test(name, run) {
  await page.goto(origin); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: '확인할 원본 메시지 안 읽은 메시지 1개', exact: true }).waitFor()
  await clickWorkspaceMenu(page, 'AI 비서'); await input().waitFor()
  try { await run(); assert.deepEqual(errors, []); assert.deepEqual(external, []); count++; console.log('  ✓ ' + name) }
  catch (error) { console.error((await page.locator('.workhub-connected').innerText()).slice(-5000)); throw error }
}
async function request(text, action) { await input().fill(text); await button(action).click() }
async function noWrite(askCount = 0) {
  const value = await page.evaluate(() => ({ writes: window.cross.writes, storage: window.cross.storageCalls, asks: window.cross.aiCalls }))
  assert.deepEqual(value.writes, []); assert.deepEqual(value.storage, []); assert.equal(value.asks.length, askCount)
  assert.equal(value.asks.some(call => call.input.intent !== 'personal_assistant'), false, '일반 유료 답변으로 우회하면 안 됩니다')
}
async function tomorrow() { return page.evaluate(() => new Date(Date.parse(window.cross.basisDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) }
async function chooseTeacher(cardName) {
  const card = region(cardName), candidates = region('교사 검색 결과')
  await candidates.waitFor()
  assert.match(await card.innerText(), /(?:받는 사람|제출 대상) · 0명/)
  assert.equal(await button('첨부·최종 검토로 계속').isDisabled(), true)
  await noWrite()
  await candidates.getByRole('button', { name: /이민준.*교무부.*선택/ }).click()
  assert.match(await card.innerText(), /(?:받는 사람|제출 대상) · 1명/)
  await button('첨부·최종 검토로 계속').click()
}
try {
  for (const ending of ['주실 수 있나요', '주실 수 있을까요', '줄 수 있을까요']) {
    await test(`할 일 '${ending}'는 일반 답변 대신 기존 개인 제안으로 연결하고 확정하지 않는다`, async () => {
      const text = `제출 자료 확인을 할 일로 추가해 ${ending}?`
      await request(text, 'AI에게 요청')
      await page.waitForFunction(() => window.cross.aiCalls.length === 1)
      const ask = await page.evaluate(() => window.cross.aiCalls[0].input)
      assert.equal(ask.mode, 'personal'); assert.equal(ask.intent, 'personal_assistant'); assert.equal(ask.quality, 'quick')
      assert.ok(ask.prompt.includes(text), '원 요청 문장을 개인 제안에 전달해야 합니다')
      await button('할 일 제안 검토').click()
      assert.equal(await page.getByLabel('할 일 제목', { exact: true }).inputValue(), '제출 자료 확인')
      await button('추가할 내용 확인').click(); await button('확인한 할 일 추가').waitFor()
      await noWrite(1)
    })
    await test(`일정 '${ending}'는 날짜·제목 원문을 보관하고 시각만 이어 받는다`, async () => {
      const text = `내일 회의 일정 잡아 ${ending}?`, date = await tomorrow()
      await request(text, '일정 초안 열기')
      const follow = region('작성 중인 일정'); await follow.waitFor()
      await follow.getByText(text, { exact: true }).waitFor()
      assert.match(await follow.innerText(), /회의/); assert.ok((await follow.innerText()).includes(date)); await noWrite()
      await request('오후 3시부터 4시', '일정 정보 이어 입력')
      const review = page.locator('.workspace-operation[data-operation-kind="calendarCreate"]'); await review.waitFor()
      assert.equal(await review.locator('.workspace-operation-target').innerText(), '회의')
      assert.ok((await review.innerText()).includes(date)); assert.match(await review.innerText(), /15:00–16:00/)
      await button('확인한 일정 등록').waitFor(); await noWrite()
    })
    await test(`메시지 '${ending}'는 수신자 직접 선택 뒤 여러 줄 본문을 기존 작성 화면에 전달한다`, async () => {
      const body = '내일 제출 자료를 확인해 주세요.\n수정한 항목도 알려 주세요.'
      await request(`이민준 선생님에게 “${body}”라는 메시지 초안 만들어 ${ending}?`, '메시지 초안 확인')
      await region('작성 중인 메시지').getByText(body, { exact: true }).waitFor()
      await chooseTeacher('작성 중인 메시지')
      const form = page.getByRole('form', { name: '새 메시지 작성', exact: true }); await form.waitFor()
      const detail = form.locator('.messaging-recipient-editor'); if (!await detail.evaluate(node => node.open)) await detail.locator('summary').first().click()
      assert.equal(await form.getByLabel('메시지', { exact: true }).inputValue(), body)
      assert.equal(await form.getByRole('checkbox', { checked: true }).count(), 1)
      assert.equal(await form.getByLabel('이민준 · 교무부', { exact: true }).isChecked(), true)
      await noWrite()
    })
    await test(`수합 '${ending}'는 기한·제목·안내를 유지하고 선택한 교사만 기존 초안에 넣는다`, async () => {
      const instructions = '누락된 항목을 확인해 주세요.\n변경한 부분을 적어 주세요.', date = await tomorrow()
      await request(`내일까지 이민준 선생님에게 “제출 자료 확인” 안내는 “${instructions}” 수합 초안 만들어 ${ending}?`, '수합 초안 확인')
      const card = region('작성 중인 수합'); await card.getByText(date, { exact: true }).waitFor()
      await card.getByText(instructions, { exact: true }).waitFor(); await chooseTeacher('작성 중인 수합')
      await button('수합 초안 사용').click()
      const form = page.getByRole('form', { name: '수합 초안 작성', exact: true }); await form.waitFor()
      assert.equal(await form.getByLabel('수합 제목', { exact: true }).inputValue(), '제출 자료 확인')
      assert.equal(await form.getByLabel('안내 내용', { exact: true }).inputValue(), instructions)
      assert.equal(await form.getByLabel('제출 기한', { exact: true }).inputValue(), date)
      assert.equal(await form.getByLabel('책임 교사 1', { exact: true }).inputValue(), 'gaon-minjun')
      assert.equal(await form.getByLabel('양식 파일 선택', { exact: true }).evaluate(node => node.files.length), 0)
      await noWrite()
    })
  }
  console.log(`공손한 업무 요청 연결 ${count}건 통과 · 합성 개인 할 일 제안 3회 · 일반 답변·자동 저장·실제 외부 유료 호출 0`)
} finally { await context.close(); await browser.close() }
