import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{FoundationPanel}from'./apps/workhub/src/timetable/FoundationPanel';
import{TimetablePreflightPanel}from'./apps/workhub/src/timetable/TimetablePreflightPanel';
import{timetablePracticeSnapshot}from'./apps/workhub/src/timetable/sample';
import css from './apps/workhub/src/timetable/timetable.css';
const style=document.createElement('style');style.textContent=css;document.head.append(style);
window.sample=()=>timetablePracticeSnapshot('2026-10-19').basis;
window.many=(n,unavailable)=>{const b=window.sample();b.resources=[{id:'room',kind:'room',label:'공유 실험실',capacity:1}];b.slots=[{id:'s1',label:'1교시',day:1,startMinute:540,endMinute:585,periods:1}];b.lessons=[];b.courseLoads=[];for(let i=1;i<=n;i++){b.resources.push({id:'t'+i,kind:'teacher',label:'교사 '+String(i).padStart(2,'0'),capacity:1},{id:'g'+i,kind:'class',label:'학급 '+i,capacity:1});b.lessons.push({id:'l'+i,courseId:'c'+i,label:'수업 '+String(i).padStart(2,'0'),periods:1,resourceIds:['t'+i,'g'+i,'room'],allowedSlotIds:['s1']});b.courseLoads.push({courseId:'c'+i,periods:1});if(unavailable)b.unavailable.push({resourceId:'t'+i,day:1,startMinute:540,endMinute:585})}return b};
window.root=createRoot(document.getElementById('root'));window.basis=window.sample();window.render=(foundation=false)=>window.root.render(foundation?<FoundationPanel basis={window.basis}/>:<TimetablePreflightPanel basis={window.basis}/>);window.render();
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], passed = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main class="timetable-workspace" style="padding:16px;max-width:100%;min-width:0"><div id="root"></div></main></body></html>' }))
async function start() { await page.goto('http://127.0.0.1:5179/preflight'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('region', { name: '계산 전 충돌 설명' }).waitFor() }
async function check(name, run) { await start(); await run(); passed.push(name); console.log('  ✓ ' + name) }
try {
  await check('가능 판정을 약속하지 않고 학교 고정 충돌의 교사·수업·시간을 펼쳐 본다', async () => {
    await page.getByText('확정 충돌 미발견 · 실제 계산과 결과 검사가 필요합니다.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '계산 전 충돌 설명', exact: true }).count(), 0)
    assert.equal(await page.getByText('현재 검사 범위에서 확정 충돌을 찾지 못했습니다. 편성 가능 여부는 아직 미판정입니다.', { exact: true }).isVisible(), false)
    await page.getByText('검사 범위와 한계', { exact: true }).click()
    await page.getByText('현재 검사 범위에서 확정 충돌을 찾지 못했습니다. 편성 가능 여부는 아직 미판정입니다.', { exact: true }).waitFor()
    await page.evaluate(() => { window.basis.fixed = window.basis.lessons.slice(0, 2).map(l => ({ lessonId: l.id, slotId: window.basis.slots[0].id })); window.basis = structuredClone(window.basis); window.before = JSON.stringify(window.basis); window.render(true) })
    await page.getByRole('heading', { name: '예시 교사 가의 고정 수업이 겹칩니다', exact: true }).waitFor()
    assert.equal(await page.getByText('기초 자료의 시수·배정·시간대 검사 통과', { exact: true }).count(), 0)
    const card = page.locator('.timetable-preflight .timetable-card').filter({ has: page.getByRole('heading', { name: '예시 교사 가의 고정 수업이 겹칩니다', exact: true }) })
    await card.getByText('관련 수업·대상·시간 보기', { exact: true }).click()
    await card.getByText('예시 1반 과학 2회 · 1차시', { exact: true }).waitFor(); await card.getByText('월 1교시 · 09:00–09:45 · 1차시', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.basis) === window.before), true)
    assert.equal(await card.getByRole('button', { name: /삭제|적용|수정/ }).count(), 0)
  })
  await check('충돌 종류·교사 검색과 쪽 이동을 제공하고 빈 검색으로 해결된 것처럼 표시하지 않는다', async () => {
    await page.evaluate(() => { window.basis = window.many(26, true); window.render() })
    await page.getByLabel('살펴볼 충돌', { exact: true }).selectOption('NO_AVAILABLE_SLOT')
    await page.getByText('충돌 설명 26건 · 1/3쪽', { exact: true }).waitFor(); assert.equal(await page.locator('.timetable-preflight .timetable-card').count(), 10)
    await page.getByRole('button', { name: '다음 충돌', exact: true }).click(); await page.getByText('충돌 설명 26건 · 2/3쪽', { exact: true }).waitFor()
    await page.getByLabel('충돌 설명 검색', { exact: true }).fill('교사 25'); await page.getByRole('heading', { name: '수업 25 · 배치할 시간 없음', exact: true }).waitFor()
    await page.getByText('충돌 설명 1건 · 1/1쪽', { exact: true }).waitFor()
    await page.getByLabel('충돌 설명 검색', { exact: true }).fill('없는 대상'); await page.getByText(/검색 조건에 맞는 충돌이 없습니다. 전체 충돌 .*건은 아직 남아 있습니다./).waitFor()
    assert.equal(await page.getByText(/편성 가능 여부는 아직 미판정입니다/).count(), 0)
  })
  await check('많은 관련 수업도 별도 쪽으로 보여주고 마지막 수업을 빠뜨리지 않는다', async () => {
    await page.evaluate(() => { window.basis = window.many(26, false); window.render() })
    await page.getByRole('heading', { name: '공유 실험실의 수업을 넣을 시간이 부족합니다', exact: true }).waitFor()
    await page.getByText('관련 수업·대상·시간 보기', { exact: true }).click()
    const next = page.getByRole('button', { name: '다음 관련 수업', exact: true }); await next.click(); await next.click()
    assert.equal(await next.isDisabled(), true); const text = await page.getByRole('navigation', { name: '관련 수업 쪽 이동' }).locator('..').innerText()
    assert.match(text, /수업 26/); assert.match(text, /3\/3쪽/)
    await page.getByLabel('충돌 설명 검색', { exact: true }).fill('교사 26'); await page.getByText('충돌 설명 1건 · 1/1쪽', { exact: true }).waitFor()
  })
  await check('입력 갱신 시 이전 충돌을 남기지 않고 미지원 조건과 형식 오류를 구별한다', async () => {
    await page.evaluate(() => { window.basis = window.many(2, true); window.render() }); await page.getByLabel('살펴볼 충돌', { exact: true }).waitFor()
    await page.evaluate(() => { window.basis = window.sample(); window.render() }); await page.getByText('확정 충돌 미발견 · 실제 계산과 결과 검사가 필요합니다.', { exact: true }).waitFor()
    assert.equal(await page.locator('.timetable-preflight .timetable-card').count(), 0)
    await page.evaluate(() => { window.basis = { ...window.sample(), unsupportedFeatures: ['선택과목 이동 시간'] }; window.render() })
    await page.getByText('미지원 조건: 선택과목 이동 시간', { exact: true }).waitFor(); assert.equal(await page.locator('.timetable-preflight .timetable-card').count(), 0)
    await page.evaluate(() => { window.basis = null; window.render() }); await page.getByText('입력 형식을 먼저 확인해야 충돌을 설명할 수 있습니다.', { exact: true }).waitFor()
  })
  await check('320px와 큰 글자에서도 충돌 안내·검색·시간 상세가 화면 밖으로 벗어나지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.evaluate(() => { window.basis = window.many(12, false); window.basis.resources[0].label = '매우긴특별교실이름'.repeat(10); window.render() })
    await page.getByText('관련 수업·대상·시간 보기', { exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.addStyleTag({ content: 'html{font-size:200%}input,select,button{font-size:inherit}' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.setViewportSize({ width: 1280, height: 900 })
  })
  assert.deepEqual(errors, []); console.log(`시간표 계산 전 충돌 설명 브라우저 검사: ${passed.length}개 통과`)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
