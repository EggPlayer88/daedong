import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({
  entryPoints: [join(root, 'tests/browser/site-modular-shell-fixture.jsx')],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  define: {
    'import.meta.env': JSON.stringify({
      MODE: 'test',
      VITE_SUPABASE_URL: 'http://127.0.0.1:5179/fake',
      VITE_SUPABASE_ANON_KEY: 'synthetic',
    }),
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'silent',
})
const browser = await launchBrowser(),
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await context.newPage(),
  errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.setDefaultTimeout(10000)
await page.route('**/*', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>',
  }),
)
const button = (name) => page.getByRole('button', { name, exact: true }),
  menu = () => button('더보기').click()
async function start(path = '/admin/seasonal') {
  await page.goto('http://127.0.0.1:5179' + path)
  await page.addStyleTag({
    content:
      "@font-face{font-family:'Pretendard Variable';src:url(data:font/woff2;base64," +
      readFileSync(join(root, 'apps/workhub/src/assets/fonts/PretendardVariable.woff2')).toString(
        'base64',
      ) +
      ');font-weight:45 920}',
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByText('현재 상태: 메뉴에서 숨김').waitFor()
}
if (process.env.WORKHUB_QA_OUTPUT) mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
const results = []
async function check(name, fn) {
  await fn()
  results.push(name)
  console.log('  ✓ ' + name)
}
try {
  await start()
  await check('관리 화면도 공통 메뉴와 같은 틀로 열리고 기본 기간 업무 메뉴는 숨긴다', async () => {
    assert.equal(await page.locator('.ws-shell').count(), 1)
    assert.equal(await page.getByRole('link', { name: '평가계획서 작성', exact: true }).count(), 0)
    assert.equal(await page.getByText('기존 업무 메뉴', { exact: true }).count(), 0)
  })
  await check('관리자가 표시를 켜면 두 평가계획서 메뉴가 같은 사이트에 나타난다', async () => {
    await page.getByLabel('교사 메뉴에 평가계획서 업무 표시').check()
    await button('메뉴 표시 저장').click()
    await page.getByText('현재 상태: 메뉴에 표시 중').waitFor()
    await page.getByRole('link', { name: '평가계획서 작성', exact: true }).click()
    await page.getByRole('heading', { name: '평가계획서 작성', exact: true }).waitFor()
    assert.equal(await page.locator('.ws-shell').count(), 1)
    assert.equal(await page.getByLabel('보존할 문서 입력').inputValue(), '작성 중인 내용')
  })
  await check('더보기에서 기간 업무 관리로 돌아와 메뉴를 숨길 수 있다', async () => {
    await menu()
    await page.getByRole('link', { name: '기간 업무 관리', exact: true }).click()
    await page.getByLabel('교사 메뉴에 평가계획서 업무 표시').uncheck()
    await button('메뉴 표시 저장').click()
    await page.getByText('현재 상태: 메뉴에서 숨김').waitFor()
    assert.equal(await page.getByRole('link', { name: '평가계획서 제출', exact: true }).count(), 0)
  })
  await check('저장 응답 유실을 같은 요청 번호로 복구하고 중복 적용하지 않는다', async () => {
    await page.evaluate(() => {
      window.scenario.lose = true
    })
    await page.getByLabel('교사 메뉴에 평가계획서 업무 표시').check()
    await button('메뉴 표시 저장').click()
    await button('같은 요청으로 결과 확인').waitFor()
    await menu()
    await page.getByRole('link', { name: '내 계정', exact: true }).click()
    await menu()
    await page.getByRole('link', { name: '기간 업무 관리', exact: true }).click()
    await button('같은 요청으로 결과 확인').click()
    await page.getByText('현재 상태: 메뉴에 표시 중').waitFor()
    const writes = await page.evaluate(() => window.scenario.writes)
    assert.deepEqual(writes.at(-1), writes.at(-2))
    assert.equal(await button('같은 요청으로 결과 확인').count(), 0)
  })
  await check('메뉴 숨김 재조회는 현재 작성 중인 문서 입력을 지우지 않는다', async () => {
    await page.getByRole('link', { name: '평가계획서 작성', exact: true }).click()
    await page.getByLabel('보존할 문서 입력').fill('관리자가 숨겨도 보존할 입력')
    await page.evaluate(() => {
      window.scenario.change()
      window.dispatchEvent(new Event('focus'))
    })
    await page
      .getByRole('link', { name: '평가계획서 작성', exact: true })
      .waitFor({ state: 'hidden' })
    assert.equal(
      await page.getByLabel('보존할 문서 입력').inputValue(),
      '관리자가 숨겨도 보존할 입력',
    )
    await menu()
    await page.getByRole('link', { name: '기간 업무 관리', exact: true }).click()
    await page.getByLabel('교사 메뉴에 평가계획서 업무 표시').check()
    await button('메뉴 표시 저장').click()
    await page.getByText('현재 상태: 메뉴에 표시 중').waitFor()
  })
  if (process.env.WORKHUB_QA_OUTPUT) {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: join(process.env.WORKHUB_QA_OUTPUT, 'seasonal-admin-desktop.png'),
      fullPage: true,
    })
  }
  await check('360px 모바일 메뉴와 기간 업무 관리가 화면을 넘치지 않는다', async () => {
    await page.setViewportSize({ width: 360, height: 800 })
    await menu()
    await page.getByRole('link', { name: '평가계획서 제출', exact: true }).click()
    await page.getByRole('heading', { name: '평가계획서 제출', exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await menu()
    await page.getByRole('link', { name: '기간 업무 관리', exact: true }).click()
    await page.getByRole('heading', { name: '기간 업무 관리', exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  })
  await check(
    '일반 교사는 메뉴 설정 권한이 없고 기존 기능의 허용 범위를 늘리지 않는다',
    async () => {
      await page.evaluate(() => window.scenario.role('teacher'))
      await page.getByRole('alert').filter({ hasText: '관리자만' }).waitFor()
      await menu()
      assert.equal(await page.getByRole('link', { name: '기간 업무 관리', exact: true }).count(), 0)
      assert.equal(await page.getByRole('link', { name: '사용자 관리', exact: true }).count(), 0)
      assert.equal(await button('시간표').count(), 0)
      await page.getByRole('link', { name: '평가계획서 작성', exact: true }).click()
      await page.getByRole('heading', { name: '평가계획서 작성', exact: true }).waitFor()
    },
  )
  await check(
    '다른 관리자의 변경은 오래된 선택으로 덮지 않고 최신 설정을 다시 읽는다',
    async () => {
      await start()
      await page.getByLabel('교사 메뉴에 평가계획서 업무 표시').check()
      await page.evaluate(() => window.scenario.change())
      await button('메뉴 표시 저장').click()
      await page.getByText('현재 상태: 메뉴에 표시 중').waitFor()
      assert.equal(await button('같은 요청으로 결과 확인').count(), 0)
      assert.equal((await page.evaluate(() => window.scenario.writes)).length, 1)
    },
  )
  if (process.env.WORKHUB_QA_OUTPUT) {
    mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
    await page.screenshot({
      path: join(process.env.WORKHUB_QA_OUTPUT, 'site-modular-mobile.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: join(process.env.WORKHUB_QA_OUTPUT, 'site-modular-desktop.png'),
      fullPage: true,
    })
    writeFileSync(
      join(process.env.WORKHUB_QA_OUTPUT, 'site-modular-shell.json'),
      JSON.stringify({ results, errors }, null, 2),
    )
  }
  assert.deepEqual(errors, [])
  console.log('전부 통과')
} finally {
  await browser.close()
}
