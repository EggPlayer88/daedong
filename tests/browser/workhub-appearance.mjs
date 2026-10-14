// 실제 Vite 미리보기에서 스킨·설정 보존·입력 보호·반응형 화면을 검증한다.
// 실행 전 npm run dev:workhub, 다른 주소는 WORKHUB_QA_URL로 지정한다.
import assert from 'node:assert/strict'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const browser = await launchBrowser()
const url = process.env.WORKHUB_QA_URL || 'http://127.0.0.1:5176/'
const output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
const errors = [], results = [], commandRequests = []
let context, page
const key = 'workhub:appearance:v1'
const defaults = { theme: 'light', density: 'comfortable', textSize: 'standard' }

async function createContext(storageState) {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(storageState ? { storageState } : {}) })
  context.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) commandRequests.push({ method: request.method(), url: request.url() }) })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
}
const shell = () => page.locator('.ws-shell')
const dialog = () => page.getByRole('dialog', { name: '화면 설정', exact: true })
const trigger = () => page.getByRole('button', { name: '화면 설정', exact: true })
async function settle() {
  await page.waitForFunction(() => !document.querySelector('.loading-state,.task-loading'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
// CSS의 media 적용과 React의 matchMedia 상태 반영은 같은 순간에 끝나지 않는다.
// 설정 진입 방식을 고르기 전에 현재 화면 폭에 맞는 버튼 DOM까지 준비됐는지 확인한다.
async function resize(viewport) {
  await page.setViewportSize(viewport)
  await page.waitForFunction(() => {
    const mobile = window.matchMedia('(max-width: 720px)').matches
    const desktopSettings = document.querySelector('.ws-utilities .appearance-trigger')
    const more = document.querySelector('.ws-more-button')
    return mobile
      ? !desktopSettings && Boolean(more?.getClientRects().length)
      : Boolean(desktopSettings?.getClientRects().length) && !more?.getClientRects().length
  })
}
async function test(name, action) { await action(); results.push(name); console.log('  ✓ ' + name) }
async function home() { await page.getByRole('heading', { name: '내 할 일', exact: true }).waitFor(); await settle() }
async function heading(name) { await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor(); await settle() }
async function menu(name) {
  const navigation = page.getByRole('navigation', { name: '업무 메뉴', exact: true })
  const button = navigation.getByRole('button', { name, exact: true })
  if (!await button.isVisible()) await navigation.getByRole('button', { name: '더보기', exact: true }).click()
  await button.click()
  await heading(name)
}
async function openSettings() { if (!await trigger().isVisible()) await page.getByRole('button', { name: '더보기', exact: true }).click(); await trigger().click(); await dialog().waitFor(); await settle() }
async function choose(value) { await dialog().locator(`input[type="radio"][value="${value}"]`).check(); await settle() }
async function closeSettings() { await dialog().getByRole('button', { name: '완료', exact: true }).click(); await dialog().waitFor({ state: 'detached' }) }
async function preferences() { return shell().evaluate(element => ({ theme: element.dataset.theme, density: element.dataset.density, textSize: element.dataset.textSize })) }
// 전체 페이지 캡처의 임시 화면 폭 변경이 반응형 모달을 닫지 않도록 지정한 뷰포트를 그대로 촬영한다.
async function screenshot(name) { if (output) await page.screenshot({ path: join(output, name + '.png'), fullPage: false }) }
async function assertFocus(locator) { assert.equal(await locator.evaluate(element => element === document.activeElement), true) }
async function assertFits(label) {
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }))
  assert(bounds.width <= bounds.viewport + 1, `${label}: ${bounds.width}px > ${bounds.viewport}px`)
  for (const modal of await page.locator('dialog[open]').all()) {
    const metrics = await modal.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.scrollWidth, inner: element.clientWidth, viewport: innerWidth }))
    assert(metrics.left >= -1 && metrics.right <= metrics.viewport + 1 && metrics.width <= metrics.inner + 1, `${label}: 대화상자 가로 넘침 ${JSON.stringify(metrics)}`)
  }
}
async function colors() {
  return shell().evaluate(element => {
    const root = getComputedStyle(element), card = getComputedStyle(element.querySelector('.task-card'))
    let background = element.querySelector('.task-card')
    while (background && ['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(background).backgroundColor)) background = background.parentElement
    return { surface: root.backgroundColor, text: root.color, card: background ? getComputedStyle(background).backgroundColor : card.backgroundColor }
  })
}

try {
  await createContext()
  await page.goto(url)
  await home()
  await test('화이트 기본형은 간결한 홈과 실제 합성 자료 안내를 유지한다', async () => {
    assert.equal(await shell().getAttribute('data-workspace-mode'), 'preview')
    assert.deepEqual(await preferences(), defaults)
    await heading('오늘')
    assert.equal(await page.locator('.overview-grid,.quiet-card,.section-index').count(), 0)
    assert.equal(await page.getByRole('group', { name: '개인 업무 기한 요약' }).count(), 0)
    assert.match(await page.locator('.ws-mode-banner').innerText(), /합성 자료/)
    assert.equal(await page.locator('.home-work-column').count(), 1)
    await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
    await page.getByLabel('해야 할 일', { exact: true }).fill('합성 검증 · 학급 안내문 검토')
    await page.getByLabel('기한 (선택)', { exact: true }).fill('2026-10-19')
    await page.getByLabel('나만 보는 메모', { exact: true }).fill('화면 검증을 위한 가상 업무입니다.')
    await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
    await page.getByRole('article', { name: '합성 검증 · 학급 안내문 검토', exact: true }).waitFor(); await settle()
    assert.equal(await page.getByRole('group', { name: '개인 업무 기한 요약' }).getByRole('button').count(), 4)
    await page.reload(); await home()
    await screenshot('appearance-white-desktop')
  })
  await test('화이트·웜 페이퍼·차콜은 실제 바탕·카드·글자 색을 바꾼다', async () => {
    const light = await colors()
    await openSettings(); await choose('warm')
    assert.equal((await preferences()).theme, 'warm')
    const warm = await colors()
    assert.notEqual(warm.surface, light.surface)
    await closeSettings(); await screenshot('appearance-warm-desktop')
    await openSettings(); await choose('dark')
    const dark = await colors()
    assert.equal((await preferences()).theme, 'dark')
    assert.notEqual(dark.surface, light.surface); assert.notEqual(dark.card, light.card); assert.notEqual(dark.text, light.text)
    assert.equal(await dialog().locator('input[value="dark"]').isChecked(), true)
    await closeSettings(); await screenshot('appearance-charcoal-desktop')
  })
  await test('정보 간격과 글자 크기는 실제 카드에 즉시 적용된다', async () => {
    const sample = page.locator('.task-card').first()
    const before = await sample.evaluate(element => ({ padding: parseFloat(getComputedStyle(element).paddingTop), font: parseFloat(getComputedStyle(element.querySelector('h3')).fontSize) }))
    await openSettings(); await choose('compact'); await choose('large')
    const after = await sample.evaluate(element => ({ padding: parseFloat(getComputedStyle(element).paddingTop), font: parseFloat(getComputedStyle(element.querySelector('h3')).fontSize) }))
    assert(after.padding < before.padding, `간격: ${before.padding} → ${after.padding}`)
    assert(after.font > before.font, `글자: ${before.font} → ${after.font}`)
    assert.deepEqual(await preferences(), { theme: 'dark', density: 'compact', textSize: 'large' })
    await closeSettings()
  })
  await test('설정은 세 표시값만 저장하고 새로고침과 새 브라우저 문맥에서 복원한다', async () => {
    const expected = { theme: 'dark', density: 'compact', textSize: 'large' }
    assert.deepEqual(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)), key), expected)
    await page.reload(); await home(); assert.deepEqual(await preferences(), expected)
    const storageState = await context.storageState()
    await context.close(); await createContext(storageState)
    await page.goto(url); await home(); assert.deepEqual(await preferences(), expected)
  })
  await test('키보드 선택·Escape·닫기·완료 후 화면 설정 버튼으로 초점이 돌아온다', async () => {
    await openSettings(); const selected = dialog().locator('input[value="dark"]')
    await assertFocus(selected); await page.keyboard.press('ArrowLeft'); await settle()
    assert.equal((await preferences()).theme, 'warm')
    await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'detached' }); await assertFocus(trigger())
    await openSettings(); await dialog().getByRole('button', { name: '화면 설정 닫기', exact: true }).click(); await assertFocus(trigger())
    await openSettings(); await closeSettings(); await assertFocus(trigger())
  })
  await test('기본 설정으로 되돌리면 화면과 저장된 설정이 함께 초기화된다', async () => {
    await openSettings(); await dialog().getByRole('button', { name: '기본 설정으로', exact: true }).click(); await settle()
    assert.deepEqual(await preferences(), defaults)
    assert.deepEqual(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)), key), defaults)
    assert.match(await dialog().getByRole('status').innerText(), /기본 화면 설정을 적용했습니다/)
    await closeSettings()
  })
  await test('작성 중 설정 변경은 입력을 보존하고 AI 이동은 잠근다', async () => {
    await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
    await page.getByLabel('해야 할 일', { exact: true }).fill('화면 설정 중 보존할 합성 초안')
    const before = page.url()
    assert.equal(await page.getByRole('button', { name: 'AI 비서 준비 중', exact: true }).isDisabled(), true)
    await openSettings(); await choose('dark'); await choose('large'); await closeSettings()
    assert.equal(page.url(), before)
    assert.equal(await page.getByLabel('해야 할 일', { exact: true }).inputValue(), '화면 설정 중 보존할 합성 초안')
    await page.getByRole('button', { name: '편집 취소', exact: true }).click(); await settle()
  })
  await test('AI 비서는 준비 상태를 밝히고 전송 없이 기존 업무 화면으로 연결한다', async () => {
    const before = commandRequests.length
    const ai = page.getByRole('button', { name: 'AI 비서 준비 중', exact: true })
    await ai.click(); const assistant = page.getByRole('dialog', { name: 'AI 비서', exact: true })
    assert.match(await assistant.innerText(), /CLAUDE · 연결 준비 중/)
    assert.match(await assistant.innerText(), /현재는 대화를 전송하거나 AI 작업을 실행할 수 없습니다/)
    assert.equal(await assistant.locator('textarea,input').count(), 0)
    await assistant.getByRole('button', { name: '내 업무 열기', exact: true }).click(); await heading('내 업무')
    await ai.click(); await page.keyboard.press('Escape'); await assertFocus(ai)
    assert.equal(commandRequests.length, before)
    await menu('오늘'); await home()
  })
  await test('잘못 저장된 설정은 기본값과 명시적 안내로 복구한다', async () => {
    await page.evaluate(storageKey => localStorage.setItem(storageKey, '{깨진 설정'), key)
    await page.reload(); await home(); assert.deepEqual(await preferences(), defaults)
    await openSettings(); assert.match(await dialog().getByRole('alert').innerText(), /저장된 화면 설정을 읽지 못해/)
    await choose('warm'); assert.equal(await dialog().getByRole('alert').count(), 0); await closeSettings()
  })
  await test('저장소가 막혀도 표시 변경은 적용하고 보존 실패를 숨기지 않는다', async () => {
    await page.evaluate(storageKey => {
      window.__appearanceSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (itemKey, value) { if (itemKey === storageKey) throw new DOMException('합성 저장 실패', 'QuotaExceededError'); return window.__appearanceSetItem.call(this, itemKey, value) }
    }, key)
    await openSettings(); await choose('dark')
    assert.equal((await preferences()).theme, 'dark')
    assert.match(await dialog().getByRole('alert').innerText(), /화면은 바뀌었지만 이 브라우저에 설정을 저장하지 못했습니다/)
    await page.evaluate(() => { Storage.prototype.setItem = window.__appearanceSetItem; delete window.__appearanceSetItem })
    await dialog().getByRole('button', { name: '기본 설정으로', exact: true }).click(); await closeSettings()
  })
  await test('320·390·1440px에서 세 스킨·큰 글씨의 홈과 설정이 가로로 넘치지 않는다', async () => {
    for (const width of [320, 390, 1440]) {
      await resize({ width, height: width < 500 ? 850 : 1000 })
      for (const theme of ['light', 'warm', 'dark']) {
        await openSettings(); await choose(theme); await choose('large'); await choose('compact')
        await assertFits(`${width}px ${theme} 설정`)
        await screenshot(`appearance-${width}-${theme}-settings`)
        await closeSettings(); await assertFits(`${width}px ${theme} 홈`)
        await screenshot(`appearance-${width}-${theme}-home`)
      }
    }
  })
  await test('좁은 화면에서도 기존 다섯 화면의 메뉴·핵심 행동을 유지한다', async () => {
    await resize({ width: 320, height: 850 })
    for (const name of ['학교 일정', '내 업무', '자료 수합', '수업과 학생', '오늘']) {
      await menu(name); await assertFits(`320px ${name}`)
      assert.equal(await page.getByRole('navigation', { name: '업무 메뉴', exact: true }).locator('[aria-current="page"]').innerText(), name)
    }
    await home(); await openSettings(); await dialog().getByRole('button', { name: '기본 설정으로', exact: true }).click(); await closeSettings()
    await resize({ width: 1440, height: 1000 }); await screenshot('appearance-final-white-home')
  })
  await test('화면 설정과 준비 중 AI가 서버 변경 요청이나 브라우저 오류를 만들지 않는다', async () => {
    assert.deepEqual(commandRequests, []); assert.deepEqual(errors, [])
  })
  console.log(`화면 설정·홈 UI ${results.length}개 통과`)
  if (output) writeFileSync(join(output, 'appearance-browser-results.json'), JSON.stringify({ url, results, commandRequests, errors }, null, 2))
} catch (error) {
  console.error(error)
  if (page && !page.isClosed()) { console.error((await page.locator('body').innerText()).slice(-4000)); await screenshot('appearance-failure') }
  process.exitCode = 1
} finally { await context?.close(); await browser.close() }
