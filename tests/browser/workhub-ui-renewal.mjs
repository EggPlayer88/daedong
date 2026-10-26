// 실제 셸·모듈·parser를 사용하고 전송만 합성한다. 운영 DB·유료 AI 호출은 없다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchBrowser } from './launch-browser.mjs'
import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = await build({ entryPoints: [join(root, 'tests/browser/workhub-cross-module-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent', plugins: [{ name: 'ui-review-fixture', setup(builder) {
  builder.onLoad({ filter: /assistant[\\/]legacy-http\.ts$/ }, () => ({ contents: 'export const legacyAssistantHttp={send:payload=>window.cross.assistantHttp(payload)};export const legacySchoolAiHttp={send:async()=>{throw Error("synthetic settings unavailable")}};export const legacySchoolAiOperationsHttp={send:async()=>{throw Error("synthetic operations unavailable")}}', loader: 'ts' }))
  builder.onLoad({ filter: /workhub-cross-module-fixture\.tsx$/ }, args => {
    let contents = readFileSync(args.path, 'utf8')
    contents = contents.replace('const calendar=createMemoryAdapter', "data.events=data.events.map((e,i)=>({...e,startDate:offset(data.basisDate,i<3?0:2),endDate:offset(data.basisDate,i<3?0:2)}));\nconst calendar=createMemoryAdapter")
    contents = contents.replace("label:'안 읽은 메시지 1개'}]", "label:'안 읽은 메시지 1개'},{id:'urgent',kind:'collection',title:'다음 주 수업 자료 제출',dueDate:data.basisDate,sourceId:'collection-source',priority:'urgent',label:'오늘까지 제출'},{id:'review',kind:'cooperation',title:'학년 협의 자료 확인',dueDate:null,sourceId:'cooperation-source',priority:'normal',label:'검토 요청'}]")
    contents = contents.replace('counts:{collection:0,supplement:0,message:', 'counts:{collection:1,supplement:0,message:').replace('student_followup:0,cooperation:0}', 'student_followup:0,cooperation:1}')
    return { contents, loader: 'tsx' }
  })
} }] })
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-renewal-'))
mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1600, height: 1060 } }), page = await context.newPage()
const errors = [], external = [], results = []
page.setDefaultTimeout(16000); page.on('pageerror', e => errors.push(e.message))
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin !== 'http://127.0.0.1:5187') { external.push(url.href); return route.abort() }
  const match = url.pathname.match(/(PretendardVariable|TossFaceFontMac-0[789])\.woff2$/)
  if (match) return route.fulfill({ contentType: 'font/woff2', body: readFileSync(join(root, 'apps/workhub/src/assets/fonts', match[1].startsWith('Toss') ? 'tossface' : '', match[0])) })
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const go = name => clickWorkspaceMenu(page, name)
const ai = () => page.getByRole('dialog', { name: 'AI 옆자리', exact: true })
async function start() {
  await page.goto('http://127.0.0.1:5187/ui-renewal')
  await page.addStyleTag({ content: readFileSync(join(root, 'apps/workhub/src/typography.css'), 'utf8') + readFileSync(join(root, 'apps/workhub/src/assets/fonts/tossface/tossface.css'), 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('heading', { name: '오늘', level: 1, exact: true }).waitFor()
  await page.getByRole('button', { name: /다음 주 수업 자료 제출/ }).waitFor()
  await page.evaluate(async () => { await document.fonts.load('24px Tossface', '🏠📋💬'); await document.fonts.ready })
}
async function screenshot(name) { await page.screenshot({ path: join(output, name + '.png'), fullPage: false }) }
async function fits() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '문서 전체 가로 넘침') }
async function check(name, action) { await action(); results.push(name); console.log('  ✓ ' + name) }
try {
  await start()
  await check('홈은 핵심 메뉴 4개와 긴급 업무·수업·일정을 같은 첫 화면에 제공한다', async () => {
    assert.deepEqual(await page.locator('.ws-primary-menus button').allTextContents(), ['🏠홈', '🗓시간표', '📋업무', '📁자료'])
    assert(await page.locator('.home-priority').isVisible()); assert(await page.locator('.home-timetable-section').isVisible())
    assert((await page.locator('.home-timetable-section').boundingBox()).y < 500)
    assert.match(await page.locator('.home-priority').innerText(), /확인 필요/)
    assert(await page.evaluate(() => document.fonts.check('24px Tossface', '🏠📋💬')))
    await fits(); await screenshot('01-home-desktop')
  })
  await check('작성 중인 메시지 옆에 AI를 열어도 양쪽 입력을 지우거나 자동 전송하지 않는다', async () => {
    await go('메시지와 알림'); await page.getByRole('button', { name: '새 메시지', exact: true }).click()
    await page.getByLabel('메시지', { exact: true }).fill('교사가 작성 중인 원래 안내')
    await go('AI 비서'); await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).fill('보관할 AI 질문')
    await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '교사가 작성 중인 원래 안내')
    await go('AI 비서'); assert.equal(await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).inputValue(), '보관할 AI 질문')
    assert.equal(await page.evaluate(() => window.cross.aiCalls.length), 0)
    assert.deepEqual(await page.evaluate(() => window.cross.writes), [])
    await screenshot('03-ai-beside-message')
    await ai().getByRole('button', { name: '질문 비우기', exact: true }).click(); await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
    await page.getByRole('button', { name: '작성 닫기', exact: true }).click(); await page.getByRole('button', { name: '작성한 입력 버리고 닫기', exact: true }).click()
  })
  await check('시간표는 확정표부터 열리고 수업 상세가 표 옆에 연결된다', async () => {
    await go('시간표'); await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '시간표 보기', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('region', { name: '주간 시간표', exact: true }).getByRole('button').first().click()
    await page.getByRole('complementary', { name: '수업 상세와 작업', exact: true }).waitFor()
    await page.getByRole('region', { name: '선택한 수업', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '이 수업 변경 요청', exact: true }).count(), 1)
    await fits(); await screenshot('02-timetable-desktop')
  })
  await check('결과를 모르는 AI 요청을 닫았다 열어도 같은 번호로만 복구하고 화면을 몰래 옮기지 않는다', async () => {
    await go('AI 비서'); await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).fill('응답 유실 뒤 보관할 질문')
    await page.evaluate(() => { const original = window.cross.assistantHttp; let lost = false; window.cross.assistantHttp = async payload => { const result = await original(payload); if (payload.action === 'ask' && !lost) { lost = true; throw Error('합성 응답 유실') } return result } })
    await ai().getByRole('button', { name: 'Claude에게 요청', exact: true }).click()
    await ai().getByRole('button', { name: '같은 요청으로 결과 확인', exact: true }).waitFor()
    const original = await page.evaluate(() => window.cross.aiCalls[0])
    await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
    assert(await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).isVisible())
    assert(await page.getByRole('button', { name: '홈', exact: true }).isDisabled())
    await page.getByRole('button', { name: '작성 중인 AI 대화 열기', exact: true }).click()
    assert.equal(await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).inputValue(), '응답 유실 뒤 보관할 질문')
    assert.equal(await page.evaluate(() => window.cross.aiCalls.length), 1)
    await ai().getByRole('button', { name: '같은 요청으로 결과 확인', exact: true }).click()
    await ai().getByRole('heading', { name: 'Claude 답변', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.cross.aiCalls[1]), original)
    assert.equal(await ai().getByRole('heading', { name: 'Claude 답변', exact: true }).count(), 1)
    await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
  })
  await check('휴대폰 AI는 modal로 열리고 Escape로 닫아 원래 버튼에 초점을 돌린다', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'AI 비서 열기', exact: true }).click()
    await ai().waitFor(); assert(await ai().evaluate(element => element.matches(':modal')))
    await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).fill('휴대폰에서 작성한 질문')
    await screenshot('05-ai-mobile'); await page.keyboard.press('Escape'); assert.equal(await ai().isVisible(), false)
    assert(await page.getByRole('button', { name: 'AI 비서 열기', exact: true }).evaluate(element => element.getRootNode().activeElement === element))
    await page.getByRole('button', { name: 'AI 비서 열기', exact: true }).click()
    assert.equal(await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).inputValue(), '휴대폰에서 작성한 질문')
    await ai().getByRole('button', { name: '질문 비우기', exact: true }).click(); await page.keyboard.press('Escape'); await fits()
  })
  await check('열린 AI의 화면 크기를 바꾸어도 같은 입력을 유지하고 보이는 버튼으로 초점을 돌린다', async () => {
    await page.setViewportSize({ width: 1600, height: 1060 }); await go('AI 비서')
    await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).fill('창 크기를 바꿔도 보관')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => [...document.querySelectorAll('*')].some(element => element.shadowRoot?.querySelector('.ws-ai-dock:modal') || element.matches?.('.ws-ai-dock:modal')))
    assert.equal(await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).inputValue(), '창 크기를 바꿔도 보관')
    await page.keyboard.press('Escape')
    assert(await page.getByRole('button', { name: 'AI 비서 열기', exact: true }).evaluate(element => element.getRootNode().activeElement === element))
    await page.getByRole('button', { name: 'AI 비서 열기', exact: true }).click()
    await ai().getByRole('button', { name: '질문 비우기', exact: true }).click(); await page.keyboard.press('Escape')
  })
  await check('작은 화면과 큰 글씨에서도 긴급 업무·메뉴가 잘리지 않는다', async () => {
    await go('오늘'); await page.getByRole('heading', { name: '오늘', level: 1, exact: true }).waitFor(); await fits(); await screenshot('04-home-mobile')
    await page.setViewportSize({ width: 320, height: 740 }); await fits()
    await page.setViewportSize({ width: 800, height: 900 }); await page.locator('.ws-shell').evaluate(element => { element.dataset.textSize = 'large'; element.dataset.theme = 'dark' })
    await fits(); await screenshot('06-dark-large')
  })
  await check('사용 안내의 AI 전체 화면과 옆자리를 오가도 같은 답변을 보존한다', async () => {
    await page.setViewportSize({ width: 1600, height: 1060 })
    await page.getByRole('button', { name: '사용 안내', exact: true }).click()
    const help = page.getByRole('dialog', { name: '업무실 도움말', exact: true })
    await help.getByLabel('어떤 일을 하시나요?', { exact: true }).fill('AI')
    await help.getByRole('button', { name: 'AI 답변 받고 필요한 부분 정밀 검토하기', exact: true }).click()
    await help.getByRole('button', { name: 'AI 비서 열기', exact: true }).click()
    await ai().getByRole('heading', { name: 'AI 옆자리', level: 1, exact: true }).waitFor()
    assert(await ai().getByText('검토 후 한 번 보낸 AI 초안', { exact: true }).isVisible())
    await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
    assert.equal(await ai().isVisible(), false)
    await go('AI 비서'); assert(await ai().getByText('검토 후 한 번 보낸 AI 초안', { exact: true }).isVisible())
    assert.equal(await page.evaluate(() => window.cross.aiCalls.length), 2)
    await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
  })
  await check('학교를 바꾸면 닫아 둔 AI도 이전 학교 답변을 다시 표시하지 않는다', async () => {
    await page.setViewportSize({ width: 1600, height: 1060 })
    await page.getByLabel('사용할 학교').selectOption('nuri-soyeon')
    await page.getByRole('heading', { name: '오늘', level: 1, exact: true }).waitFor()
    await go('AI 비서'); await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).waitFor()
    assert.equal(await ai().getByText('검토 후 한 번 보낸 AI 초안', { exact: true }).count(), 0)
    assert.equal(await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).inputValue(), '')
    assert.equal(await page.evaluate(() => window.cross.aiCalls.length), 2)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
} catch (error) {
  await screenshot('failure'); console.error((await page.locator('body').innerText()).slice(-7000)); throw error
} finally {
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ results, errors, external }, null, 2)); await browser.close()
}
console.log(`UI 개편 브라우저 ${results.length}건 통과 · ${output}`)
