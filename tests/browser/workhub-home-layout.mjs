// 실제 홈을 바쁜 합성 자료로 검사한다. 운영 DB·인증·외부 서버는 사용하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const bundle = buildSync({ stdin: { contents: `
 import React from 'react';import{createRoot}from'react-dom/client';
 import{PreviewApp}from'./apps/workhub/src/preview/PreviewApp';
 import{fixtureData}from'./apps/workhub/src/preview/fixtures';
 import{createDemoPersistence}from'./apps/workhub/src/preview/persistence';
 import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
 import theme from './apps/workhub/src/style.css?inline';
 import preview from './apps/workhub/src/preview/preview.css?inline';
 import workflow from './apps/workhub/src/workflows/workflows.css?inline';
 import students from './apps/workhub/src/students/students.css?inline';
 const owner='gaon-soyeon',reviewer='gaon-minjun',base=fixtureData.events[0];
 for(let i=0;i<4;i++)fixtureData.events.push({...base,id:'layout-upcoming-'+i,title:'추가 관련 일정 '+i,startDate:'2026-10-'+(20+i),endDate:'2026-10-'+(20+i)});
 const store=createWorkflowStore({members:fixtureData.memberships,date:'2026-10-15'});
 for(let i=0;i<5;i++)store.createTask(owner,{title:'홈 배치 검증 업무 '+i,dueDate:'2026-10-'+(18+i),notes:'긴 합성 메모입니다. 화면에서 핵심 내용을 확인하고 전체 업무 화면으로 이어집니다. '.repeat(7)},'task-'+i);
 const draft=store.createCollection(reviewer,{title:'학급별 준비 수합',instructions:'합성 준비 내용',dueDate:'2026-10-21',reviewMode:'required',reviewerMemberId:reviewer,textLabel:'준비 내용',textRequired:true,numberLabel:'',numberRequired:false,units:[{label:'보완 대상 단위',responsibleMemberId:owner,contributorMemberIds:['gaon-seojin']},{label:'검토 대기 단위',responsibleMemberId:owner,contributorMemberIds:[]}]},'collection');
 const request=store.publishCollection(reviewer,draft.id,draft.version,'publish'),units=store.listUnits(owner,request.id);
 const submit=(unit,key)=>{const existing=store.getDraft(owner,unit.id);const d=store.saveDraft(owner,unit.id,{text:'합성 응답',number:null},existing?.version??0,key+'-draft');return store.submit(owner,unit.id,d.version,store.unitSummary(owner,unit.id).unit.version,key,'합성 변경 사유')};
 const first=submit(units[0],'first');store.review(reviewer,units[0].id,first.id,'accepted','','',store.unitSummary(reviewer,units[0].id).unit.version,'accept');
 const second=submit(units[0],'second');store.review(reviewer,units[0].id,second.id,'changes_requested','보완 내용을 확인해 주세요','2026-10-18',store.unitSummary(reviewer,units[0].id).unit.version,'changes');
 store.withdraw(owner,units[0].id,store.unitSummary(owner,units[0].id).unit.version,'합성 보완 재확인','withdraw');submit(units[1],'waiting');
 const saved=new Map();const persistence=createDemoPersistence({getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)});persistence.replaceAll({workflows:store.exportState()});
 createRoot(document.getElementById('root')).render(<><style>{theme}{preview}{workflow}{students}</style><PreviewApp persistence={persistence}/></>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage()
const errors = [], external = [], results = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
async function settle() { await page.waitForFunction(() => !document.querySelector('.loading-state,.task-loading')); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function test(name, action) { await action(); results.push(name); console.log('  ✓ ' + name) }
async function screenshot(name) { if (output) await page.screenshot({ path: join(output, name + '.png'), fullPage: true }) }
async function home() { await page.getByRole('navigation', { name: '업무 메뉴', exact: true }).getByRole('button', { name: '오늘', exact: true }).click(); await page.getByRole('heading', { name: '오늘', level: 1, exact: true }).waitFor(); await settle() }
async function assertFits(label) { const value = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert(value.width <= value.viewport + 1, label + ': ' + JSON.stringify(value)) }
async function assertOrder() {
  const value = await page.locator('.home-dashboard').evaluate(element => {
    const selectors = ['.home-priority', '.home-today', '.home-work-column', '.home-upcoming']; const nodes = selectors.map(selector => element.querySelector(selector))
    return { dom: nodes.slice(1).every((node, index) => Boolean(nodes[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)), tops: nodes.map(node => Math.round(node.getBoundingClientRect().top + scrollY)) }
  })
  assert.equal(value.dom, true); if (page.viewportSize().width <= 820) assert.deepEqual(value.tops, [...value.tops].sort((a, b) => a - b))
}
try {
  await page.goto('http://127.0.0.1:5176/home-layout'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: '다가오는 7일', exact: true }).waitFor(); await settle()
  await test('홈은 처리할 수합을 먼저 보여 주고 일정·내 할 일·다가오는 일정으로 이어진다', async () => {
    await assertOrder(); await screenshot('home-layout-desktop')
    await page.setViewportSize({ width: 390, height: 844 }); await settle(); await assertOrder(); await assertFits('390px')
    const top = await page.locator('.home-priority h2').evaluate(element => element.getBoundingClientRect().top + scrollY)
    assert(top < 844, '처리할 수합 제목이 모바일 첫 화면에 표시되어야 합니다: ' + top)
    await page.evaluate(() => scrollTo(0, 0)); await screenshot('home-layout-mobile')
  })
  await test('오늘 일정은 세 개부터 펼치며 숨겨진 원본도 열고 다시 돌아온다', async () => {
    const today = page.locator('.home-today'); assert.equal(await today.locator('.event-card').count(), 3)
    const more = today.getByRole('button', { name: '오늘 일정 4개 모두 보기', exact: true }); await more.click()
    assert.equal(await today.locator('.event-card').count(), 4); assert.equal(await today.getByRole('button', { name: '오늘 일정 접기', exact: true }).getAttribute('aria-expanded'), 'true')
    await today.getByRole('button', { name: '수업 자료 정리 · 원본 v1 보기', exact: true }).click()
    const detail = page.getByRole('dialog'); await detail.getByRole('heading', { name: '수업 자료 정리', exact: true }).waitFor()
    await page.keyboard.press('Escape'); await detail.waitFor({ state: 'detached' })
    await today.getByRole('button', { name: '오늘 일정 접기', exact: true }).click(); assert.equal(await today.locator('.event-card').count(), 3)
  })
  await test('다가오는 일정은 전체 건수와 생략 안내를 유지하고 전체 원본으로 연결된다', async () => {
    const upcoming = page.locator('.home-upcoming'); assert.equal(await upcoming.locator('.event-card').count(), 3)
    assert.match(await upcoming.innerText(), /5개 중 먼저 3개 표시/)
    await upcoming.getByRole('button', { name: '관련 일정 모두 보기', exact: true }).click()
    await page.getByRole('heading', { name: '학교 일정', level: 1, exact: true }).waitFor(); await settle()
    assert.equal(await page.getByLabel('조회 기간', { exact: true }).inputValue(), 'all'); await page.getByRole('button', { name: '추가 관련 일정 3 · 원본 v1 보기', exact: true }).waitFor(); await home()
  })
  await test('바쁜 홈에서도 마감·완료본·미해결 보완과 검토 대기를 숨기지 않는다', async () => {
    assert.match(await page.locator('.task-list-heading').innerText(), /진행할 업무 5개 · 먼저 4개 표시/)
    assert.match(await page.locator('.task-card').first().innerText(), /기한 지남/)
    const collections = page.getByRole('region', { name: '오늘 처리할 수합', exact: true })
    assert.match(await collections.locator('.wf-home-heading').innerText(), /처리할 1건 · 검토 대기 1건/)
    assert.equal(await collections.locator('.wf-role-counts').isVisible(), false)
    const correction = collections.locator('.wf-obligation').filter({ hasText: '보완 대상 단위' })
    for (const label of ['완료본 v1', '보완 제출 필요', '남은 보완 1건', '2026-10-18까지', '보완 기한 초과']) assert((await correction.innerText()).includes(label), label)
    assert.equal(await correction.getByRole('button', { name: /보완 제출하기/ }).isVisible(), true)
    assert.equal(await collections.locator('.wf-home-waiting .wf-home-category').innerText(), '제출 후 검토 대기')
  })
  await test('일정 조회가 실패해도 업무·수합을 유지하고 0건으로 오해시키지 않는다', async () => {
    await page.locator('.developer-panel>summary').click(); await page.getByRole('button', { name: '다음 조회 실패', exact: true }).click()
    await page.getByRole('heading', { name: '일정을 확인할 수 없어요', exact: true }).waitFor(); await settle()
    assert.equal(await page.locator('.home-today .count').count(), 0); assert.equal(await page.locator('.home-upcoming').count(), 0)
    assert.equal(await page.locator('.task-card').count(), 4); assert.equal(await page.locator('.wf-obligation').count(), 2)
    assert.match(await page.locator('.wf-home-heading').innerText(), /처리할 1건 · 검토 대기 1건/)
    await screenshot('home-layout-calendar-error')
    await page.getByRole('button', { name: '다시 불러오기', exact: true }).click(); await settle(); await page.getByRole('heading', { name: '다가오는 7일', exact: true }).waitFor()
    await page.locator('.developer-panel>summary').click()
  })
  await test('320px와 390px 큰 글자에서도 순서·원본 행동과 가로 화면을 지킨다', async () => {
    await page.getByRole('navigation', { name: '업무 메뉴', exact: true }).getByRole('button', { name: '더보기', exact: true }).click()
    await page.getByRole('dialog', { name: '더보기', exact: true }).getByRole('button', { name: '화면 설정', exact: true }).click()
    const appearance = page.getByRole('dialog', { name: '화면 설정', exact: true }); await appearance.locator('input[value="large"]').check(); await appearance.getByRole('button', { name: '완료', exact: true }).click()
    for (const width of [320, 390]) { await page.setViewportSize({ width, height: 844 }); await settle(); await assertOrder(); await assertFits(width + 'px 큰 글자'); assert.equal(await page.getByRole('button', { name: /보완 대상 단위.*보완 제출하기/ }).isVisible(), true); const cardLayout = await page.locator('.wf-obligation').filter({ hasText: '보완 대상 단위' }).evaluate(element => ({ contentBottom: element.firstElementChild.getBoundingClientRect().bottom, buttonTop: element.querySelector('button').getBoundingClientRect().top })); assert(cardLayout.buttonTop >= cardLayout.contentBottom, '좁은 화면에서는 보완 안내 뒤에 버튼을 배치합니다'); await page.evaluate(() => scrollTo(0, 0)); await screenshot('home-layout-large-' + width) }
  })
  await test('화면 검사는 운영 요청과 브라우저 실행 오류를 만들지 않는다', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []) })
  if (output) writeFileSync(join(output, 'home-layout-results.json'), JSON.stringify({ results, errors, external }, null, 2))
  console.log('\n' + results.length + '개 홈 배치 브라우저 시나리오 통과')
} finally { await browser.close() }
