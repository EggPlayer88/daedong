// 합성 읽기 응답과 실제 React·검증기를 사용한다. 운영 DB·AI 호출·저장은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ entryPoints: [join(root, 'tests/browser/fixtures/assistant-daily.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1200, height: 900 } }), page = await context.newPage()
const errors = [], external = [], passed = []
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5282/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' })
})
const tasks = () => page.getByRole('region', { name: '대화에서 내 할 일', exact: true })
const calendar = () => page.getByRole('region', { name: '대화에서 내 일정', exact: true })
const home = () => page.getByRole('region', { name: '확인할 학교 업무', exact: true })
const meals = () => page.getByRole('region', { name: '학교 급식', exact: true })
async function start(values = {}) {
  await page.goto('http://127.0.0.1:5282/daily'); await page.evaluate(values => { window.dailyInitial = values }, values)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
}
async function update(values) { await page.evaluate(values => window.qa.update(values), values) }
async function ready() { await tasks().getByRole('button', { name: '내 할 일 모두 보기', exact: true }).waitFor(); await calendar().getByRole('button', { name: '일정 모두 보기', exact: true }).waitFor(); await meals().getByText('중식', { exact: true }).waitFor() }
async function test(name, run) { await run(); passed.push(name); assert.deepEqual(errors, []); console.log('  ✓ ' + name) }
try {
  await test('홈 업무·내 할 일·관련 일정·급식을 같은 학교 기준일로 조회하고 원본 번호와 판을 열기 콜백에 보존', async () => {
    await start(); await ready()
    await home().getByRole('button', { name: '안 읽은 대화 7개 · 메시지 목록 열기', exact: true }).waitFor()
    assert.equal(await tasks().getByText('5개', { exact: true }).count(), 1)
    assert.equal(await tasks().locator('li').count(), 4)
    assert.equal(await calendar().getByText('1개', { exact: true }).count(), 1)
    assert.equal(await calendar().getByText('관련 없는 공개 일정', { exact: true }).count(), 0)
    await home().getByRole('button', { name: '확인 필요 · 원본 메시지 메시지 열기', exact: true }).click()
    await tasks().getByRole('button', { name: '원본 할 일 0 · 할 일 v2 열기', exact: true }).click()
    await calendar().getByRole('button', { name: '원본 일정 · 일정 v4 열기', exact: true }).click()
    const opened = await page.evaluate(() => window.qa.opened)
    assert.equal(opened[0].item.sourceId, 'thread-7'); assert.equal(opened[1].item.id, 'task-0'); assert.equal(opened[1].item.version, 2)
    assert.equal(opened[2].item.id, 'event-0'); assert.equal(opened[2].item.version, 4)
    assert.equal(await meals().getByLabel('급식 날짜', { exact: true }).inputValue(), '2026-10-20')
  })
  await test('여러 날 일정은 현재 날짜에 시작한다고 표시하지 않고 다가오는 일정과 전체목록 이동을 제공', async () => {
    const event = calendar().getByRole('button', { name: '원본 일정 · 일정 v4 열기', exact: true })
    assert.match(await event.innerText(), /10월 19일|10\/19|2026-10-19/)
    assert.match(await event.innerText(), /09:00/); assert.match(await event.innerText(), /15:00/)
    await calendar().getByText('다가오는 7일 · 1개', { exact: true }).click()
    await calendar().getByRole('button', { name: '원본 다음 일정 · 예정 일정 v9 열기', exact: true }).click()
    await home().getByRole('button', { name: '안 읽은 대화 7개 · 메시지 목록 열기', exact: true }).click()
    await tasks().getByRole('button', { name: '내 할 일 모두 보기', exact: true }).click()
    await calendar().getByRole('button', { name: '일정 모두 보기', exact: true }).click()
    const opened = await page.evaluate(() => window.qa.opened)
    assert.equal(opened[3].item.id, 'event-next'); assert.equal(opened[3].item.version, 9)
    assert.deepEqual(opened.slice(4).map(item => item.source), ['home-list', 'task-list', 'calendar-list'])
    assert.equal(opened[4].kind, 'message')
  })
  await test('기존 미확정 입력 잠금 동안 원본·전체목록 이동을 막고 쓰기 버튼은 만들지 않음', async () => {
    await update({ locked: true }); await page.waitForFunction(() => document.querySelector('.assistant-daily-card li button')?.disabled)
    for (const scope of [tasks(), calendar(), home()]) {
      const buttons = await scope.getByRole('button').all()
      for (const button of buttons) if (await button.isVisible()) assert.equal(await button.isDisabled(), true)
    }
    await update({ locked: false }); await ready()
  })
  await test('한 영역의 실패는 0건으로 표시하지 않으며 다른 영역은 유지하고 재조회로 회복', async () => {
    await update({ failed: ['tasks'] }); await tasks().getByRole('alert').waitFor()
    assert.equal(await tasks().getByText('현재 미완료 할 일이 없습니다.', { exact: true }).count(), 0)
    assert.equal(await tasks().getByText('0개', { exact: true }).count(), 0)
    await calendar().getByRole('button', { name: '원본 일정 · 일정 v4 열기', exact: true }).waitFor()
    await page.evaluate(() => { window.qa.failed = [] })
    await tasks().getByRole('button', { name: '할 일 다시 확인', exact: true }).click()
    await tasks().getByRole('button', { name: '원본 할 일 0 · 할 일 v2 열기', exact: true }).waitFor()
    await update({ failed: ['calendar'] }); await calendar().getByRole('alert').waitFor()
    assert.equal(await calendar().getByText('오늘 나와 관련된 일정이 없습니다.', { exact: true }).count(), 0)
    await page.evaluate(() => { window.qa.failed = [] })
    await calendar().getByRole('button', { name: '일정 다시 확인', exact: true }).click(); await ready()
  })
  await test('다른 소속의 할 일·다른 학교 일정 응답은 원문 노출 없이 거부', async () => {
    await update({ invalid: 'task' }); await tasks().getByRole('alert').waitFor()
    assert.equal(await tasks().getByRole('button', { name: /원본 할 일/ }).count(), 0)
    await update({ invalid: 'calendar' }); await calendar().getByRole('alert').waitFor()
    assert.equal(await calendar().getByRole('button', { name: /원본 일정/ }).count(), 0)
    await update({ invalid: '' }); await ready()
  })
  await test('급식 단독 조회는 명시한 내일·직접 선택 날짜를 사용하며 실제 기준일의 소속으로 검증', async () => {
    await start({ view: 'meals', mealDate: '2026-10-21' }); await meals().getByText('원본 2026-10-21 쌀밥\n미역국', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '오늘의 급식', exact: true }).count(), 0)
    assert.equal(await tasks().count(), 0); assert.equal(await calendar().count(), 0)
    await meals().getByLabel('급식 날짜', { exact: true }).fill('2026-10-22')
    await meals().getByText('원본 2026-10-22 쌀밥\n미역국', { exact: true }).waitFor()
    await update({ mealDate: '2027-01-01' }); await meals().getByText('원본 2027-01-01 쌀밥\n미역국', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.qa.date), '2026-10-20')
    assert.equal(await page.getByText('현재 학교 소속을 확인한 뒤 다시 열어 주세요.', { exact: true }).count(), 0)
  })
  await test('급식 미연결·조회 실패는 메뉴 없음과 구분하고 비용 호출 없이 기존 조회만 사용', async () => {
    await start({ view: 'meals', mealDate: '2026-10-21', unconfigured: true }); await meals().getByText('급식 연결 준비 중', { exact: true }).waitFor()
    assert.equal(await meals().getByText('이 날짜에 등록된 급식이 없습니다.', { exact: true }).count(), 0)
    await update({ failed: ['meals'], mealDate: '2026-10-22', unconfigured: false })
    await meals().getByText('자료를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await meals().getByText('이 날짜에 등록된 급식이 없습니다.', { exact: true }).count(), 0)
  })
  await test('확인된 빈 자료와 홈 일부 미준비를 구분', async () => {
    await start({ empty: true, homeUnavailable: true })
    await tasks().getByText('현재 미완료 할 일이 없습니다.', { exact: true }).waitFor()
    await calendar().getByText('오늘 나와 관련된 일정이 없습니다.', { exact: true }).waitFor()
    await meals().getByText('이 날짜에 등록된 급식이 없습니다.', { exact: true }).waitFor()
    await home().getByText('일부 연결 항목은 확인 중입니다. 확인되지 않은 항목은 건수에 포함하지 않았습니다.', { exact: true }).waitFor()
    assert.equal(await home().getByText('지금 표시할 추가 업무가 없습니다.', { exact: true }).count(), 0)
  })
  await test('기준일 변경 뒤 늦게 도착한 업무·일정·급식 응답을 표시하지 않음', async () => {
    await start({ defer: ['tasks', 'calendar', 'home', 'meals'], label: '이전날' })
    await page.waitForFunction(() => window.qa.waits.length >= 4)
    await update({ date: '2026-10-21', defer: [], label: '새날' }); await ready()
    await page.evaluate(() => window.qa.resolve())
    assert.doesNotMatch(await page.locator('.assistant-daily').innerText(), /이전날/)
    assert.match(await page.locator('.assistant-daily').innerText(), /새날/)
    assert.equal(await meals().getByLabel('급식 날짜', { exact: true }).inputValue(), '2026-10-21')
  })
  await test('소속 재연결 뒤 이전 응답을 버리고 새 소속의 원본만 표시', async () => {
    await start({ defer: ['tasks', 'calendar', 'home', 'meals'], label: '이전소속' })
    await page.waitForFunction(() => window.qa.waits.length >= 4)
    await page.evaluate(() => { window.qa.label = '새소속'; window.qa.defer = []; window.qa.switchMember() }); await ready()
    await page.evaluate(() => window.qa.resolve())
    assert.doesNotMatch(await page.locator('.assistant-daily').innerText(), /이전소속/)
    await tasks().getByRole('button', { name: '새소속 할 일 0 · 할 일 v2 열기', exact: true }).click()
    assert.equal(await page.evaluate(() => window.qa.opened.at(-1).item.ownerMemberId), 'second')
  })
  await test('잘못된 날짜와 종료된 소속은 조회를 시작하지 않음', async () => {
    await start(); await ready()
    const count = await page.evaluate(() => window.qa.calls.length)
    await update({ mealDate: '2026-02-30' }); await page.getByRole('alert').getByText('확인할 날짜를 다시 선택해 주세요.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.qa.calls.length), count)
    await page.evaluate(() => { window.qa.mealDate = undefined; window.qa.member = { ...window.qa.member, active: false }; window.qa.members = [window.qa.member]; window.qa.render() })
    await page.getByText('현재 학교 소속을 확인한 뒤 다시 열어 주세요.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.qa.calls.length), count)
  })
  await test('320px·200% 글자와 긴 제목에서도 정보와 이동 버튼이 가로 잘림 없이 유지', async () => {
    await start({ long: true }); await ready()
    await home().getByRole('button', { name: /안 읽은 대화 7개/ }).waitFor()
    for (const width of [1200, 640, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.locator('html').evaluate(element => { element.style.fontSize = '32px' })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, width + 'px 가로 넘침')
      for (const selector of ['.assistant-daily-card li button', '.assistant-daily-link', '.neis-meals input']) {
        for (const node of await page.locator(selector).all()) {
          if (!await node.isVisible()) continue
          const box = await node.boundingBox()
          assert(box.x >= 0 && box.x + box.width <= width + 1, selector + ' 화면 밖')
        }
      }
    }
    await tasks().getByRole('button', { name: '내 할 일 모두 보기', exact: true }).focus(); await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.qa.opened.at(-1).source), 'task-list')
    const output = process.env.WORKHUB_QA_OUTPUT
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'assistant-daily-320-large-text.png'), fullPage: true }) }
    await page.locator('.ws-shell').evaluate(element => { element.style.setProperty('--ui-surface', '#18212f'); element.style.setProperty('--ui-text', '#eef3f8'); element.style.setProperty('--ui-surface-muted', '#243044') })
    assert.equal(await tasks().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(24, 33, 47)')
    assert.equal(await tasks().evaluate(element => getComputedStyle(element).color), 'rgb(238, 243, 248)')
    assert.equal(await tasks().locator('li button').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(36, 48, 68)')
  })
  assert.deepEqual(external, [])
  assert((await page.evaluate(() => window.qa.calls)).every(call => ['tasks', 'calendar'].includes(call.source) || ['workhub_home_overview', 'workhub_neis_status'].includes(call.name)))
  console.log(passed.length + '개 AI 오늘 업무·급식 브라우저 시나리오 통과')
} finally { await browser.close() }
