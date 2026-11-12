// 대화 분야를 바꿔도 자료 범위·비용·미확정 요청이 조용히 바뀌지 않는지 실제 화면에서 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL('./workhub-ai-school-policy-fixture.tsx', import.meta.url))],
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"development"' },
  logLevel: 'silent',
}).outputFiles[0].text
const font = readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64')
const shellStyles = ['workspace-shell.css', 'workspace-renewal.css', 'site-experience.css']
  .map(file => readFileSync(new URL('../../apps/workhub/src/app/' + file, import.meta.url), 'utf8')).join('\n')
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${shellStyles}@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:45 920}*{box-sizing:border-box}body{margin:0;padding:20px;font-family:Pretendard,sans-serif;background:#f6f7f9}#root{max-width:1120px;margin:auto;min-height:0}</style><div id="root" class="ws-shell" data-theme="light"></div></html>`
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage()
const errors = [], external = [], passed = []
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5196/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: html })
})
const field = name => page.getByLabel(name, { exact: true }), button = name => page.getByRole('button', { name, exact: true })
const focus = () => field('대화 분야'), prompt = () => field('질문 또는 부탁할 일')
async function start() {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:5196/ai-foundation')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(() => document.fonts.ready)
  await focus().waitFor()
  await page.waitForFunction(() => !document.querySelector('[id$="-focus"]').disabled)
}
async function check(name, run) { await start(); await run(); passed.push(name); console.log('  ✓ ' + name) }
async function fits() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true) }
async function capture(name) {
  if (!process.env.WORKHUB_QA_OUTPUT) return
  mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
  await page.locator('#root').screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, name + '.png') })
}

try {
  await check('처음에는 자동 대화·입력·세 예시를 보이고 자료 범위와 요청 설정은 직접 펼친다', async () => {
    assert.equal(await focus().inputValue(), 'auto')
    assert.equal(await focus().locator('option').count(), 8)
    assert.match(await page.locator('.assistant-scope-current').innerText(), /학교 공통 자료/)
    assert.equal(await button('내 개인 비서').isVisible(), false)
    assert.equal(await field('요청 종류').isVisible(), false)
    assert.equal(await page.locator('.assistant-starters button').count(), 3)
    assert(await page.locator('.assistant-compose').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.assistant-starters')) & Node.DOCUMENT_POSITION_FOLLOWING)))
    await page.getByText('자료 범위 변경', { exact: true }).click()
    assert.equal(await button('학교 업무 안내').getAttribute('aria-pressed'), 'true')
    await page.locator('.assistant-request-settings summary').click()
    assert.equal(await field('요청 종류').inputValue(), 'school_advice')
    assert.equal(await page.evaluate(() => window.calls.length), 0)
    await capture('ai-foundation-start')
  })
  await check('전문 분야 선택은 작성 중 원문과 자료 범위·요청 종류를 유지하며 호출하지 않는다', async () => {
    await prompt().fill('아직 정리 중인 시간표 고민')
    await focus().selectOption('timetable')
    assert.equal(await prompt().inputValue(), '아직 정리 중인 시간표 고민')
    assert.equal(await field('요청 종류').inputValue(), 'school_advice')
    assert.match(await page.locator('.assistant-scope-current').innerText(), /학교 공통 자료/)
    await page.getByText('자료 범위 변경', { exact: true }).click()
    assert.equal(await button('내 개인 비서').isDisabled(), true)
    assert.equal(await page.locator('.assistant-starters button:disabled').count(), 3)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await check('시작 예시는 선택한 문장만 채우며 다른 예시로 원문을 덮어쓰거나 전송하지 않는다', async () => {
    await focus().selectOption('collaboration')
    const example = page.locator('.assistant-starters button').first(), text = await example.innerText()
    await example.click()
    assert.equal(await prompt().inputValue(), text)
    assert.equal(await page.locator('.assistant-starters button:disabled').count(), 3)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
    await button('질문 비우기').click()
    assert.equal(await page.locator('.assistant-starters button:disabled').count(), 0)
  })
  await check('전문 대화의 질문은 읽기 쉬운 원문으로 표시하고 정밀 검토는 비용 확인 후 원요청을 쓴다', async () => {
    const text = '시간표 조정의 대안을 비교해 주세요.'
    await focus().selectOption('timetable'); await prompt().fill(text); await button('AI에게 요청').click()
    await page.getByText('Haiku 기본 답변', { exact: true }).waitFor()
    const first = await page.evaluate(() => window.calls[0])
    assert.equal(first.input.mode, 'school'); assert.equal(first.input.intent, 'school_advice'); assert.equal(first.input.quality, 'quick')
    assert.equal(first.input.prompt, text + '\n\n[[:4:]]')
    assert.equal(await page.locator('.assistant-question .assistant-text').innerText(), text)
    await button('이 답변 정밀 검토').click()
    assert.match(await page.getByRole('group', { name: '정밀 검토 비용 확인', exact: true }).innerText(), /학교 예산/)
    assert.equal(await page.evaluate(() => window.calls.length), 1)
    await button('비용 사용 확인하고 정밀 검토').click(); await page.getByText('Sonnet 정밀 검토', { exact: true }).waitFor()
    const review = await page.evaluate(() => window.calls[1])
    assert.equal(review.input.prompt, first.input.prompt); assert.equal(review.input.reviewOf.requestKey, first.requestKey)
    await capture('ai-foundation-answer')
  })
  await check('전문 분야 표식을 포함한 글자 한도는 화면과 서버 검증이 같고 초과 입력을 자르지 않는다', async () => {
    await focus().selectOption('timetable')
    await prompt().fill('가'.repeat(3991))
    assert.equal(await button('AI에게 요청').isDisabled(), false)
    assert.match(await page.locator('[id$="-prompt-hint"]').innerText(), /3991 \/ 3991자/)
    await prompt().fill('가'.repeat(3992))
    assert.equal(await button('AI에게 요청').isDisabled(), true)
    assert.equal(await prompt().inputValue(), '가'.repeat(3992))
    assert.equal(await prompt().getAttribute('aria-invalid'), 'true')
    await focus().selectOption('general')
    assert.equal(await button('AI에게 요청').isDisabled(), false)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await check('전문 대화 결과 미상과 재진입에서는 원문·분야·원요청 번호를 유지해 복구한다', async () => {
    await focus().selectOption('documents'); await prompt().fill('원문을 유지한 문서 검토')
    await page.evaluate(() => { window.aiMissing = true }); await button('AI에게 요청').click()
    await button('같은 요청으로 결과 확인').waitFor()
    const first = await page.evaluate(() => window.calls[0])
    assert.equal(await focus().isDisabled(), true); assert.equal(await prompt().isDisabled(), true)
    await page.evaluate(() => window.setShow(false)); await prompt().waitFor({ state: 'hidden' })
    await page.evaluate(() => window.setShow(true)); await button('같은 요청으로 결과 확인').waitFor()
    assert.equal(await prompt().inputValue(), '원문을 유지한 문서 검토')
    assert.equal(await focus().inputValue(), 'documents')
    assert.equal(await page.getByRole('region', { name: '미확정 요청', exact: true }).isVisible(), true)
    await page.evaluate(() => { window.aiMissing = false }); await button('같은 요청으로 결과 확인').click()
    await page.getByText('Haiku 기본 답변', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls[1]), first)
    assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await check('390px 첫 화면에서 요청 버튼에 닿고 320px·두 배 글자에서도 선택과 입력이 넘치지 않는다', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await fits()
    const submit = await button('AI에게 요청').boundingBox()
    assert(submit.y >= 0 && submit.y + submit.height <= 844)
    await capture('ai-foundation-mobile')
    await page.setViewportSize({ width: 320, height: 820 })
    await page.locator('#root').evaluate(el => { el.style.setProperty('--ui-body-size', '30px'); el.style.setProperty('--ui-small-size', '26px') })
    await page.getByText('자료 범위 변경', { exact: true }).click(); await page.locator('.assistant-request-settings summary').click()
    await focus().selectOption('administration'); await prompt().fill('두 배 글자에서도 보존할 질문')
    await fits()
    await focus().focus(); assert.equal(await focus().evaluate(el => document.activeElement === el), true)
    const scope = await page.getByRole('group', { name: '비서의 자료 범위', exact: true }).boundingBox()
    for (const name of ['학교 업무 안내', '내 개인 비서']) {
      const box = await button(name).boundingBox()
      assert(box.x >= scope.x - 1 && box.x + box.width <= scope.x + scope.width + 1)
    }
    assert.equal(await prompt().inputValue(), '두 배 글자에서도 보존할 질문'); assert.equal(await page.evaluate(() => window.calls.length), 0)
    await capture('ai-foundation-200-percent')
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (process.env.WORKHUB_QA_OUTPUT) writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'ai-foundation-results.json'), JSON.stringify({ passed, errors, external }, null, 2))
  console.log(`AI 업무실 1차 브라우저 ${passed.length}개 통과 · 실제 외부 호출 0건`)
} finally { await browser.close() }
