import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

// 실제 운영 패널의 기간 이동·재조회·입력 저장소를 사용한다. 서버 응답은 합성이다.
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-operation-navigation-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage()
const errors = [], external = [], failures = []; let count = 0
page.setDefaultTimeout(5000)
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5240/')) external.push(request.url()) })
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px}*{box-sizing:border-box}</style><div id="root"></div></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true })
async function start({ canPublish = true } = {}) {
  await page.goto('http://127.0.0.1:5240/operations')
  // 새 응답 전에 남아 있는 관리자 화면을 일반 교사 결과로 세지 않도록 첫 조회부터 자격을 고정한다.
  await page.evaluate(value => { window.canPublish = value }, canPublish)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor()
  await page.waitForFunction(() => window.calls.some(row => row.method === 'interventions.get'))
  await button('교환·변경 요청').click()
}
async function draft() {
  await field('요청할 변경 종류').selectOption('move'); await field('변경할 내 수업').selectOption('scheduled')
  const target = await field('이동할 공식 시간').locator('option').nth(1).getAttribute('value')
  await field('이동할 공식 시간').selectOption(target); await field('변경 요청 사유').fill('기간을 바꿔도 보존할 시험 입력')
  return target
}
async function check(name, run, initial = {}) {
  try { await start(initial); await run(); assert.equal(await page.evaluate(() => window.writes), 0); count++; console.log('  ✓ ' + name) }
  catch (error) { failures.push(name); console.error('  ✗ ' + name + ': ' + (error.stack || error.message)) }
}
try {
  await check('수업이 없는 기간에서도 원수업·사유·이동 시각을 보존하며 돌아오면 이어 쓸 수 있다', async () => {
    const target = await draft(); await button('다음 조회 기간').click()
    await page.getByText('이 조회 기간에 변경을 요청할 수 있는 내 수업이 없습니다. 조회 기간이나 승인된 수업 배정을 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await field('변경 요청 사유').inputValue(), '기간을 바꿔도 보존할 시험 입력')
    assert.equal(await field('변경할 내 수업').inputValue(), 'scheduled'); assert.equal(await field('이동할 공식 시간').inputValue(), target)
    assert.equal(await button('변경 전후 미리보기').isDisabled(), true)
    await button('이전 조회 기간').click(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(row => row.textContent === '변경 전후 미리보기' && !row.disabled))
    assert.equal(await field('이동할 공식 시간').inputValue(), target); assert.equal(await field('변경 요청 사유').inputValue(), '기간을 바꿔도 보존할 시험 입력')
  })
  await check('빈 기간에서 보내지 않은 입력을 명시적으로 비우고 이동 잠금을 해제한다', async () => {
    await draft(); await button('다음 조회 기간').click()
    await button('보내지 않은 요청 입력 비우기').click(); await page.waitForFunction(() => !window.locked)
    assert.equal(await field('변경 요청 사유').count(), 0); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await check('새 조회에서 원수업의 요청 자격이 사라져도 입력 정리를 제공하고 재전송하지 않는다', async () => {
    await draft(); await page.evaluate(() => { window.lessons[0].canRequest = false; window.refresh() })
    await page.getByText('이 조회 기간에 변경을 요청할 수 있는 내 수업이 없습니다. 조회 기간이나 승인된 수업 배정을 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await field('변경 요청 사유').inputValue(), '기간을 바꿔도 보존할 시험 입력')
    assert.equal(await button('변경 전후 미리보기').isDisabled(), true)
    assert.equal(await button('가능한 교환안 추천받기').isDisabled(), true)
    await button('보내지 않은 요청 입력 비우기').click(); await page.waitForFunction(() => !window.locked)
  })
  await check('사라진 공식 이동 시각을 빈 선택으로 숨기지 않고 재선택 전 미리보기를 막는다', async () => {
    const target = await draft()
    const replacement = await page.evaluate(() => {
      const next = { startsAt: window.future + 'T02:00:00.000Z', endsAt: window.future + 'T02:45:00.000Z' }
      window.lessons[0].allowedTargets = [next]; window.refresh(); return next.startsAt + '|' + next.endsAt
    })
    await field('이동할 공식 시간').locator(`option[value="${replacement}"]`).waitFor({ state: 'attached' })
    assert.equal(await field('이동할 공식 시간').inputValue(), target)
    assert.match(await field('이동할 공식 시간').locator('option:checked').innerText(), /이전 시간.*재확인/)
    assert.equal(await button('변경 전후 미리보기').isDisabled(), true)
    await field('이동할 공식 시간').selectOption(replacement); assert.equal(await button('변경 전후 미리보기').isDisabled(), false)
    assert.equal(await field('변경 요청 사유').inputValue(), '기간을 바꿔도 보존할 시험 입력')
  })
  await check('처음부터 수업이 없는 기간에는 빈 작성 양식과 이동 잠금을 만들지 않는다', async () => {
    await button('다음 조회 기간').click()
    await page.getByText('이 조회 기간에 변경을 요청할 수 있는 내 수업이 없습니다. 조회 기간이나 승인된 수업 배정을 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await field('변경 요청 사유').count(), 0); assert.equal(await page.evaluate(() => window.locked), false)
  })
  await check('조회 실패 중에는 보관 입력을 숨기고 정상 재조회 뒤 같은 입력만 복원한다', async () => {
    const target = await draft(); await page.evaluate(() => { window.failOperations = true; window.refresh() })
    await page.getByText('현재 권한과 수업을 확인할 때까지 보관한 변경 요청 입력을 숨깁니다.', { exact: true }).waitFor()
    assert.equal(await field('변경 요청 사유').count(), 0)
    await page.evaluate(() => { window.failOperations = false; window.refresh() }); await field('변경 요청 사유').waitFor()
    assert.equal(await field('변경 요청 사유').inputValue(), '기간을 바꿔도 보존할 시험 입력')
    assert.equal(await field('이동할 공식 시간').inputValue(), target)
  })
  await check('새 요청 권한이 사라지면 보관 입력을 숨기고 기존 입력 정리만 허용한다', async () => {
    await draft(); await page.evaluate(() => { window.canRequest = false; window.refresh() })
    await page.getByText('현재 계정에는 새 수업 변경 요청 권한이 없습니다. 조회할 수 있는 요청은 아래에서 확인하세요.', { exact: true }).waitFor()
    assert.equal(await field('변경 요청 사유').count(), 0)
    await button('보관한 입력 정리').click(); await button('입력 버리고 메뉴 잠금 해제').click(); await page.waitForFunction(() => !window.locked)
    assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await check('320px 화면에서도 빈 기간의 보관 입력과 취소를 가로 넘침 없이 사용할 수 있다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await draft(); await button('다음 조회 기간').click()
    await button('보내지 않은 요청 입력 비우기').waitFor()
    assert.equal(await field('변경 요청 사유').inputValue(), '기간을 바꿔도 보존할 시험 입력')
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }))
    assert.ok(width.content <= width.viewport + 1, JSON.stringify(width))
    await button('보내지 않은 요청 입력 비우기').click(); await page.waitForFunction(() => !window.locked)
    await page.setViewportSize({ width: 1280, height: 900 })
  })
  for (const delayedRefresh of [false, true]) {
    await check(delayedRefresh ? '새 렌더가 늦어도 일반 교사 재조회 전·중·후 확정 탭이 나타나지 않는다' : '일반 교사 재조회 중 확정 관리 탭이 잠깐 나타나지 않는다', async () => {
      assert.equal(await button('시간표 확정').count(), 0); await button('공유 시간표').click()
      await page.evaluate(delayed => {
        window.holdOperations = true
        if (delayed) setTimeout(() => window.refresh(), 250)
        else window.refresh()
      }, delayedRefresh)
      await page.getByText('시간표 운영 연결을 확인하고 있습니다…', { exact: true }).waitFor()
      // 응답을 보류한 순간의 부재를 즉시 검사한다. 없어질 때까지 기다리면 원래 깜빡임을 놓친다.
      try { assert.equal(await button('시간표 확정').count(), 0) }
      finally { await page.evaluate(() => { window.holdOperations = false; window.resumeOperations() }) }
      await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor()
      assert.equal(await button('시간표 확정').count(), 0)
    }, { canPublish: false })
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`시간표 교환 입력 복구 브라우저 검사: ${count}개 통과 · ${failures.length}개 실패`)
  assert.deepEqual(failures, [])
} finally { await browser.close() }
