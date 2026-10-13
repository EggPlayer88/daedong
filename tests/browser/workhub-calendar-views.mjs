// 실제 CalendarPanel을 합성 어댑터로 조작한다. 서버·인증·실자료를 사용하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const bundle = buildSync({ stdin: { contents: `
  import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {CalendarPanel} from './apps/workhub/src/calendar/CalendarPanel';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  import theme from './apps/workhub/src/style.css?inline';
  const data=structuredClone(fixtureData),base=data.events[0];
  data.events.push({...base,id:'boundary',title:'월 경계 장기 일정',startDate:'2026-09-30',endDate:'2026-10-02',allDay:true,startTime:'',endTime:''});
  data.events.push({...base,id:'next-month',title:'다음 달 일정',startDate:'2026-11-02',endDate:'2026-11-02'});
  data.events.push({...base,id:'very-far',title:'7일 밖의 일정',startDate:'2026-10-27',endDate:'2026-10-27'});
  for(let i=0;i<5;i++)data.events.push({...base,id:'many-'+i,title:'추가 관련 일정 '+i,startDate:'2026-10-'+(22+i),endDate:'2026-10-'+(22+i)});
  const adapter=createMemoryAdapter(data,15),member=data.memberships[0];
  const scenario={adapter,locked:false,revision:0,page:'home',refresh(){this.revision++;render()},unmount(){root.unmount()}};window.scenario=scenario;
  const root=createRoot(document.getElementById('root'));const lock=value=>{scenario.locked=value};
  function App(){const [page,setPage]=useState('home');return <><style>{theme}</style><nav><button onClick={()=>setPage('home')}>시험 홈</button><button onClick={()=>setPage('calendar')}>시험 일정</button></nav><CalendarPanel member={member} members={data.memberships} schoolName="가상 검증 학교" date={data.basisDate} adapter={adapter} revision={scenario.revision} page={page} onPageChange={setPage} relationOptions={relationLabels} demo onNavigationLockChange={lock} homeExtras={<p>독립 업무 카드</p>}/></>}
  function render(){root.render(<App/>)}render();
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' }))
async function boot() {
  await page.goto('http://127.0.0.1:5176/calendar-contract-test')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('heading', { name: '다가오는 7일', exact: true }).waitFor()
}
async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function screenshot(name) { if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, name + '.png'), fullPage: true }) } }
try {
  await boot()
  const upcoming = page.locator('.home-upcoming')
  assert.equal(await upcoming.locator('.event-card').count(), 3)
  assert.ok((await upcoming.innerText()).includes('6개 중 먼저 3개 표시'))
  assert.equal(await upcoming.getByText('7일 밖의 일정').count(), 0)
  await page.getByRole('button', { name: '전체 관련 일정 보기' }).click()
  assert.equal(await page.getByLabel('조회 기간', { exact: true }).inputValue(), 'all')
  assert.equal(await page.getByLabel('표시할 일정', { exact: true }).inputValue(), 'related')
  await page.getByRole('button', { name: '다음 달 일정 · 원본 v1 보기', exact: true }).waitFor()
  await page.getByRole('button', { name: '오늘로', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '다음 달 일정 · 원본 v1 보기', exact: true }).count(), 0)
  await page.getByRole('button', { name: '월 경계 장기 일정 · 원본 v1 보기', exact: true }).waitFor()
  await page.getByLabel('표시할 일정', { exact: true }).selectOption('all')
  await page.getByRole('button', { name: '연구부 자료 검토 · 원본 v1 보기', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /서진의 개인 준비.*보기/ }).count(), 0)
  await page.getByLabel('일정 검색', { exact: true }).fill('없는 검색어')
  await page.getByRole('heading', { name: '현재 기간·필터에 맞는 일정이 없어요' }).waitFor()
  await page.getByRole('button', { name: '검색·관련 필터 지우기' }).click()
  await page.getByRole('button', { name: '다음 달', exact: true }).click()
  await page.getByRole('button', { name: '다음 달 일정 · 원본 v1 보기', exact: true }).waitFor()
  await page.getByRole('button', { name: '오늘로', exact: true }).click()
  await page.getByRole('button', { name: '주', exact: true }).click()
  assert.equal(await page.locator('.cv-week-day').count(), 7)
  assert.equal(await page.getByRole('button', { name: '도서관 독서 주간 · 원본 v1 보기', exact: true }).count(), 5)
  await page.getByRole('button', { name: '다음 주', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '도서관 독서 주간 · 원본 v1 보기', exact: true }).count(), 0)
  await page.getByRole('button', { name: '오늘로', exact: true }).click()
  await page.getByRole('button', { name: '월', exact: true }).click()
  const initialDay = page.locator('[data-calendar-day="2026-10-19"]')
  await initialDay.focus(); await page.keyboard.press('ArrowRight'); await settled()
  assert.equal(await page.locator('[data-calendar-day="2026-10-20"]').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.calendarDay), '2026-10-20')
  await page.keyboard.press('PageDown'); await settled()
  assert.equal(await page.evaluate(() => document.activeElement.dataset.calendarDay), '2026-11-20')
  await page.getByRole('button', { name: '이전 달', exact: true }).click()
  await page.locator('[data-calendar-day="2026-10-02"]').click()
  await page.locator('.cv-selected-day').getByRole('button', { name: '월 경계 장기 일정 · 원본 v1 보기' }).waitFor()
  await page.locator('[data-calendar-day="2026-10-03"]').click()
  assert.equal(await page.locator('.cv-selected-day').getByRole('button', { name: '월 경계 장기 일정 · 원본 v1 보기' }).count(), 0)
  await page.getByRole('button', { name: '오늘로', exact: true }).click()
  await page.locator('.cv-selected-day').getByRole('button', { name: '수업 자료 정리 · 원본 v1 보기', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: '수업 자료 정리' }).waitFor()
  await page.getByRole('button', { name: '일정 수정', exact: true }).click()
  await page.locator('.editor-dialog').waitFor(); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), false)
  await page.locator('.editor-dialog input[name=title]').fill('수업 자료 정리 · 변경 검증'); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), true)
  await page.keyboard.press('Escape'); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), false)
  await page.getByRole('button', { name: '일정 등록', exact: true }).click()
  await page.locator('.editor-dialog').waitFor(); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), false)
  await page.locator('.editor-dialog input[name=title]').fill('입력 후 이동 보호 검증'); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), true)
  await page.keyboard.press('Escape'); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), false)
  assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('일정 등록')), true)
  await page.getByRole('button', { name: '시트에서 가져오기', exact: true }).click()
  const importing = page.getByRole('dialog', { name: '시트에서 일정 가져오기', exact: true })
  await importing.getByLabel('원본 표 붙여넣기', { exact: true }).fill('제목\t시작일\n학교 화면에서 가져온 일정\t2026-10-20')
  assert.equal(await page.evaluate(() => window.scenario.locked), true)
  await importing.getByRole('button', { name: '열 연결 확인', exact: true }).click()
  await importing.getByRole('button', { name: '행 검사 · 기존 일정과 비교', exact: true }).click()
  await importing.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '일정 등록', exact: true })
  await editor.getByRole('button', { name: '일정 등록', exact: true }).click()
  await importing.getByText('등록 완료 · 학교 화면에서 가져온 일정 · 원본 v1', { exact: true }).waitFor()
  await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), true)
  assert.equal(await importing.getByLabel('원본 표 붙여넣기', { exact: true }).isDisabled(), true)
  await importing.getByRole('button', { name: '검토 마치기', exact: true }).click()
  await importing.getByRole('button', { name: '가져오기 종료', exact: true }).click()
  await importing.waitFor({ state: 'detached' }); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), false)
  assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('시트에서 확인한 일정 1개')), true)
  assert.equal(await page.evaluate(() => window.scenario.adapter.exportState().data.events.filter(row => row.title === '학교 화면에서 가져온 일정').length), 1)
  await page.evaluate(() => { window.scenario.adapter.failNextQuery(); window.scenario.refresh() })
  await page.getByRole('heading', { name: '일정을 확인할 수 없어요' }).waitFor()
  assert.ok((await page.locator('.cv-filter-summary').innerText()).includes('건수 확인 안 됨'))
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await page.locator('.cv-month-grid').waitFor()
  await screenshot('calendar-desktop-month')
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    for (const view of ['목록', '주', '월']) {
      await page.getByRole('button', { name: view, exact: true }).click(); await settled()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${width}px ${view} 가로 넘침`)
      assert.equal(await page.getByRole('button', { name: '일정 등록', exact: true }).isVisible(), true)
    }
  }
  await screenshot('calendar-mobile-month')
  await page.evaluate(() => window.scenario.unmount()); await settled()
  assert.equal(await page.evaluate(() => window.scenario.locked), false)
  assert.deepEqual(errors, [])
  console.log('일정 브라우저 검증 통과: 홈 제한·전체 연결·기간/필터·주 다일표시·월 키보드·원본·편집 잠금·시트 등록 왕복·조회 복구·360/390px')
} finally { await context.close(); await browser.close() }
