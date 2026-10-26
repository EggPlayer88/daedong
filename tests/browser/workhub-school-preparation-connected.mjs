import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL('./workhub-school-preparation-connected-fixture.tsx', import.meta.url))],
  bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' }, logLevel: 'silent',
}).outputFiles[0].text
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1360, height: 1000 } }), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }))
const button = name => page.getByRole('button', { name, exact: true })
const summary = text => page.locator('summary').filter({ hasText: new RegExp(`^${text}$`) })
const guide = () => page.locator('.school-preparation')
let passed = 0
async function boot() {
  await page.goto('http://127.0.0.1:5187/workhub?view=schoolAdmin')
  await page.addScriptTag({ content: bundle })
  await button('구성 수정').waitFor()
}
async function openGuide() {
  await summary('학교 준비 진행 안내').click()
  await guide().locator('.school-preparation-overview').waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('*')].some(node => node.shadowRoot?.querySelector('.school-preparation[aria-busy="false"]')))
}
async function destination(name) {
  await openGuide(); await guide().getByRole('button', { name, exact: true }).click()
}
async function enterPractice() {
  await page.getByRole('navigation', { name: '신축 업무 메뉴', exact: true }).getByRole('button', { name: '시간표', exact: true }).click()
  await button('편성 관리').click()
  await button('예시로 편성 연습').click()
  await page.getByText('가상 자료로 편성 연습 중', { exact: true }).waitFor()
}
async function openSchoolMenu() {
  await button('더보기').click()
  await page.getByRole('dialog', { name: '더보기', exact: true }).getByRole('button', { name: '학교 관리', exact: true }).click()
  await button('구성 수정').waitFor()
}
async function test(name, run) {
  try {
    await boot(); await run()
    assert.deepEqual(await page.evaluate(() => window.writes), [])
    passed++; console.log('  ✓', name)
  } catch (error) {
    console.error('연결 화면:', await page.locator('.workhub-connected').innerText(), 'RPC:', await page.evaluate(() => window.calls), '페이지 오류:', errors)
    throw error
  }
}
try {
  await test('학교 관리 첫 진입에는 안내용 조회를 하지 않고 펼친 뒤에만 자료를 읽음', async () => {
    assert.equal(await page.locator('.school-preparation').count(), 0)
    assert.equal(await page.evaluate(() => window.calls.some(call => call.name === 'workhub_timetable_target_get')), false)
    await openGuide()
    assert.equal(await guide().locator('.school-preparation-steps>li').count(), 7)
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.name === 'workhub_timetable_target_get').length), 2)
  })
  await test('안내에서 실제 가입 교사 탭을 열고 학교 구성 탭으로 돌아옴', async () => {
    await destination('가입 교사 연결하기')
    await page.locator('.school-roster').getByRole('heading', { name: '가입 교사 연결', exact: true }).waitFor()
    assert.equal(await button('가입 교사 연결').getAttribute('aria-pressed'), 'true')
    await guide().getByRole('button', { name: '학교 구성 입력하기', exact: true }).click()
    await button('구성 수정').waitFor()
    assert.equal(await button('학교 구성·교사 담당').getAttribute('aria-pressed'), 'true')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'schoolAdmin')
  })
  await test('대상 학기 안내가 실제 시간표 학기 선택 화면을 열고 학교 관리로 복귀', async () => {
    await destination('대상 학기 선택하기')
    await page.getByRole('combobox', { name: '준비할 학기 선택', exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('view'), 'timetable')
    assert.equal(await page.getByRole('combobox', { name: '준비할 학기 선택', exact: true }).inputValue(), 'term-one')
    await button('학교 준비 안내로 돌아가기').click(); await button('구성 수정').waitFor()
    await guide().locator('.school-preparation-overview').waitFor()
    assert.equal(await page.locator('.school-preparation-disclosure').getAttribute('open'), '')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'schoolAdmin')
  })
  await test('공간 안내가 실제 공간 편집까지 펼치고 입력 중에는 부모 복귀를 막음', async () => {
    await destination('공간·학급 연결하기'); await button('공간 추가').click()
    await page.getByLabel('공간 이름', { exact: true }).fill('입력 중인 과학실')
    assert.equal(await button('학교 준비 안내로 돌아가기').isDisabled(), true)
    assert.equal(await page.getByLabel('공간 이름', { exact: true }).inputValue(), '입력 중인 과학실')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'timetable')
  })
  await test('시수 안내가 실제 준비 초안과 일과·시수 입력 단계를 펼침', async () => {
    await destination('시수·일과 입력하기')
    await page.getByRole('navigation', { name: '편성 준비 입력 이동', exact: true }).waitFor()
    assert.equal(await page.locator('.timetable-preparation-flow').getAttribute('open'), '')
    await page.getByRole('button', { name: /시수·수업/ }).click()
    await page.locator('summary').filter({ hasText: /^1반 국어 · 1 \/ 1차시$/ }).click()
    assert.equal(await page.getByLabel('주간 기준 시수', { exact: true }).inputValue(), '1')
  })
  await test('실제 가져오기 안내가 서버 자료가 채워진 파일 입력 화면에 연결됨', async () => {
    await destination('시간표 파일 확인하기')
    await page.getByRole('heading', { name: '실제 시간표 가져오기', exact: true }).waitFor()
    await button('엑셀 입력 양식 받기').waitFor()
    await page.getByLabel('시간표 파일(XLSX·CSV)', { exact: true }).waitFor()
    assert.equal(await button('공식 자료와 배치 비교').isDisabled(), true)
    assert.equal(await button('학교 준비 안내로 돌아가기').isDisabled(), false)
    await button('학교 준비 안내로 돌아가기').click(); await button('구성 수정').waitFor()
    await guide().locator('.school-preparation-overview').waitFor()
    assert.equal(await guide().getByRole('button', { name: '시간표 파일 확인하기', exact: true }).isVisible(), true)
  })
  await test('수업·학생 안내가 실제 수업 목록과 담당 등록 화면에 연결됨', async () => {
    await destination('수업·학생 입력하기')
    await button('수업·담당 등록').waitFor()
    const select = page.getByRole('combobox', { name: '수업 선택', exact: true })
    await select.waitFor(); assert.equal(await select.locator('option[value="course-one"]').count(), 1)
    assert.equal(new URL(page.url()).searchParams.get('view'), 'students')
  })
  await test('학교 구성 편집 중에는 안내의 이동 버튼만 잠겨 입력이 보존됨', async () => {
    await openGuide(); await button('구성 수정').click()
    await guide().getByText('작성 중인 입력이나 확인 중인 요청을 먼저 마무리하면 다음 화면으로 이동할 수 있습니다.', { exact: true }).waitFor()
    for (const name of ['가입 교사 연결하기', '대상 학기 선택하기', '시간표 파일 확인하기']) {
      assert.equal(await guide().getByRole('button', { name, exact: true }).isDisabled(), true)
    }
    assert.equal(await guide().getByRole('button', { name: '현황 다시 확인', exact: true }).isDisabled(), false)
    assert.equal(new URL(page.url()).searchParams.get('view'), 'schoolAdmin')
  })
  for (const [destinationName, expected] of [['대상 학기 선택하기', 'target'], ['공간·학급 연결하기', 'setup'], ['시수·일과 입력하기', 'preparation']]) {
    await test(`열어 보기만 한 편성 연습 뒤 ${destinationName}는 실제 준비 자료를 엶`, async () => {
      await enterPractice(); await openSchoolMenu(); await destination(destinationName)
      await page.getByRole('combobox', { name: '준비할 학기 선택', exact: true }).waitFor()
      assert.equal(await page.getByText('가상 자료로 편성 연습 중', { exact: true }).count(), 0)
      if (expected === 'setup') await button('공간 추가').waitFor()
      if (expected === 'preparation') await page.getByRole('navigation', { name: '편성 준비 입력 이동', exact: true }).waitFor()
      assert.equal(await page.getByRole('combobox', { name: '준비할 학기 선택', exact: true }).inputValue(), 'term-one')
    })
  }
  await test('수정한 연습 초안은 학교 관리 이동이 잠기고 재조회해도 입력을 보존', async () => {
    await enterPractice()
    await button('공개 검토').click()
    await page.getByRole('textbox', { name: '초안 이름', exact: true }).fill('보존해야 하는 연습 초안')
    await button('더보기').click()
    assert.equal(await page.getByRole('dialog', { name: '더보기', exact: true }).getByRole('button', { name: '학교 관리', exact: true }).isDisabled(), true)
    await button('더보기 닫기').click()
    await page.evaluate(() => window.refreshIdentity())
    await page.getByRole('textbox', { name: '초안 이름', exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '초안 이름', exact: true }).inputValue(), '보존해야 하는 연습 초안')
    assert.equal(await page.getByText('가상 자료로 편성 연습 중', { exact: true }).isVisible(), true)
    assert.equal(new URL(page.url()).searchParams.get('view'), 'timetable')
  })
  await test('Shadow DOM 안에 안내 스타일이 적용되며 320px에서도 가로 넘침 없음', async () => {
    await page.setViewportSize({ width: 1280, height: 1000 }); await openGuide()
    assert.equal(await guide().locator('.school-preparation-step-main').first().evaluate(node => getComputedStyle(node).display), 'grid')
    assert.equal(await guide().evaluate(node => getComputedStyle(node).borderRadius), '14px')
    const output = process.env.WORKHUB_QA_OUTPUT
    if (output) {
      await mkdir(output, { recursive: true })
      await page.screenshot({ path: join(output, '준비안내-1280.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 320, height: 860 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.equal(await guide().locator('.school-preparation-step-main').first().evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2)
    for (const name of ['가입 교사 연결하기', '학교 구성 입력하기', '시간표 파일 확인하기']) {
      const bounds = await guide().getByRole('button', { name, exact: true }).boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320)
    }
    if (output) await page.screenshot({ path: join(output, '준비안내-320.png'), fullPage: true })
  })
  assert.deepEqual(errors, [])
  console.log(`학교 준비 부모 연결 브라우저 ${passed} 통과 · 쓰기 RPC 0 · 페이지 오류 0`)
} finally { await browser.close() }
