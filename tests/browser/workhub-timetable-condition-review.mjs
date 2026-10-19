import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ConditionBatchPanel}from'./apps/workhub/src/timetable/ConditionBatchPanel';import{ConditionCards}from'./apps/workhub/src/timetable/ConditionCards';import{initialConditionBatch,conditionBatchSourceKey}from'./apps/workhub/src/timetable/condition-batch';import{timetablePracticeSnapshot}from'./apps/workhub/src/timetable/sample';
import css from'./apps/workhub/src/timetable/timetable.css';const style=document.createElement('style');style.textContent=css;document.head.append(style);
window.basis=timetablePracticeSnapshot('2026-10-19').basis;window.conditions={fixed:[],unavailable:[],preferences:[]};window.state=initialConditionBatch();window.applied=[];window.removed=[];window.disabled=false;
function App(){const[,setTick]=useState(0);window.refresh=()=>setTick(x=>x+1);return <><ConditionBatchPanel basis={window.basis} conditions={window.conditions} state={window.state} disabled={window.disabled} onStateChange={s=>{window.state=s;window.refresh()}} onApply={(next,key)=>{if(window.disabled||key!==conditionBatchSourceKey(window.basis,window.conditions))return false;window.applied.push(next);window.conditions=next;window.state=initialConditionBatch();window.refresh();return true}}/><ConditionCards basis={window.basis} conditions={window.conditions} disabled={window.disabled} onRemove={(kind,index)=>{window.removed.push({kind,index});window.conditions={...window.conditions,[kind]:window.conditions[kind].filter((_,i)=>i!==index)};window.refresh()}}/></>}
window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.root.render(<App/>)};window.mount();
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><main class="timetable-workspace"><div id="root"></div></main></body></html>' }))
let n = 0
async function check(name, run) { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5179/condition-review'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await run(); n++; console.log('  ✓ ' + name) }
async function slots() { await page.getByText('여러 대상·요일에 조건 한 번에 추가', { exact: true }).click(); await page.getByLabel('일괄 대상 예시 교사 가', { exact: true }).check(); await page.getByLabel('일괄 시간 선택 방식', { exact: true }).selectOption('slots') }
async function choose(day, id) { const input = page.getByRole('checkbox', { name: new RegExp('실제 시간 .*\\[' + id + '\\]$') }); if (!await input.isVisible()) await page.getByText(new RegExp('^' + day + '요일 · 선택')).click(); await input.check() }
async function preview() { await page.getByRole('button', { name: '일괄 조건 미리보기', exact: true }).click(); await page.getByRole('region', { name: '일괄 조건 검토 결과', exact: true }).waitFor() }
async function apply() { await page.getByLabel('매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다', { exact: true }).check(); await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).click() }
try {
  await check('서로 다른 요일·교시를 골라 검토·확인 뒤에만 두 불가 조건을 반영한다', async () => {
    await slots(); await choose('월', 'practice-1-1'); await choose('수', 'practice-3-2'); await preview(); assert.equal(await page.evaluate(() => window.applied.length), 0); await page.getByRole('heading', { name: '추가·강화 2건 · 기존 유지 0건', exact: true }).waitFor(); await apply()
    assert.deepEqual(await page.evaluate(() => window.conditions.unavailable.map(r => [r.day, r.startMinute, r.endMinute])), [[1, 540, 585], [3, 595, 640]])
  })
  await check('시간 선택 입력을 다시 열어도 보존하고 자료 변경은 확인만 취소한다', async () => {
    await slots(); await choose('월', 'practice-1-1'); await preview(); await page.evaluate(() => { window.root.unmount(); window.mount() }); await page.getByLabel('일괄 시간 선택 방식', { exact: true }).waitFor(); assert.equal(await page.getByRole('checkbox', { name: /실제 시간 .*\[practice-1-1\]$/ }).isChecked(), true)
    await page.evaluate(() => { window.basis = { ...window.basis, revision: 2 }; window.refresh() }); await page.getByText('기초 자료나 현재 조건이 바뀌어 미리보기를 닫았습니다. 입력은 보관했으니 다시 확인해 주세요.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.state.slotIds[0]), 'practice-1-1'); assert.equal(await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).count(), 0)
  })
  await check('권한·작업 잠금 중 선택·미리보기·반영을 모두 막고 입력은 유지한다', async () => {
    await slots(); await choose('월', 'practice-1-1'); await preview(); await page.getByLabel('매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다', { exact: true }).check(); await page.evaluate(() => { window.disabled = true; window.refresh() }); await page.waitForFunction(() => document.querySelector('fieldset')?.disabled === true)
    assert.equal(await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).isDisabled(), true); assert.equal(await page.getByRole('checkbox', { name: /실제 시간 .*\[practice-1-1\]$/ }).isDisabled(), true); assert.equal(await page.evaluate(() => window.applied.length), 0)
    await page.evaluate(() => { window.disabled = false; window.refresh() }); await apply(); assert.equal(await page.evaluate(() => window.applied.length), 1)
  })
  await check('시간대가 여러 쪽이어도 요일 전체 선택과 선택 유지가 누락되지 않는다', async () => {
    await page.evaluate(() => { window.basis = { ...window.basis, slots: [...window.basis.slots, ...Array.from({ length: 45 }, (_, i) => ({ id: 'extra-' + i, day: 1, label: '별도 일과 ' + i, startMinute: 700 + i, endMinute: 701 + i, periods: 1 }))] }; window.refresh() }); await slots(); await page.getByText(/^월요일 · 선택/).click(); await page.getByRole('button', { name: '월요일 시간 모두 선택', exact: true }).click()
    assert.equal(await page.evaluate(() => window.state.slotIds.length), 48); await page.getByRole('button', { name: '다음 월요일 시간', exact: true }).click(); await page.getByRole('button', { name: '다음 월요일 시간', exact: true }).click(); assert.equal(await page.getByRole('checkbox', { name: /실제 시간 .*\[extra-44\]$/ }).isChecked(), true)
    await page.getByRole('button', { name: '월요일 시간 해제', exact: true }).click(); assert.equal(await page.evaluate(() => window.state.slotIds.length), 0)
  })
  await check('동명 수업·교사 ID와 관련 학급 검색으로 정확한 고정 조건을 찾는다', async () => {
    await page.evaluate(() => { window.basis = { ...window.basis, lessons: window.basis.lessons.map(l => ['practice-lesson-a1', 'practice-lesson-b1'].includes(l.id) ? { ...l, label: '국어 1회' } : l) }; window.conditions.fixed = [{ lessonId: 'practice-lesson-a1', slotId: 'practice-1-1' }, { lessonId: 'practice-lesson-b1', slotId: 'practice-2-1' }]; window.refresh() })
    await page.getByLabel('등록한 조건 검색', { exact: true }).fill('practice-class-b'); const list = page.getByRole('region', { name: '반드시 이 시간에 목록', exact: true }); await list.getByText(/국어 1회 \[practice-lesson-b1\]/).waitFor(); assert.equal(await list.getByText(/국어 1회 \[practice-lesson-a1\]/).count(), 0)
    await list.getByRole('button', { name: /조건 삭제$/ }).click(); assert.deepEqual(await page.evaluate(() => window.removed), [{ kind: 'fixed', index: 1 }]); assert.equal(await page.evaluate(() => window.conditions.fixed[0].lessonId), 'practice-lesson-a1')
  })
  await check('검색된 조건의 둘째 쪽 삭제가 원래 행 번호를 사용하고 학교 필수조건은 보호한다', async () => {
    await page.evaluate(() => { window.basis = { ...window.basis, fixed: [{ lessonId: 'practice-lesson-a1', slotId: 'practice-1-1' }] }; window.conditions.fixed = structuredClone(window.basis.fixed); window.conditions.unavailable = Array.from({ length: 45 }, (_, i) => ({ resourceId: 'practice-teacher-a', day: 1, startMinute: i * 2, endMinute: i * 2 + 1 })); window.refresh() })
    assert.equal(await page.getByRole('region', { name: '반드시 이 시간에 목록', exact: true }).getByRole('button', { name: /조건 삭제$/ }).isDisabled(), true)
    const list = page.getByRole('region', { name: '사용할 수 없는 시간 목록', exact: true }); await list.getByRole('button', { name: '다음 사용할 수 없는 시간 조건', exact: true }).click(); await list.getByRole('button', { name: /조건 삭제$/ }).first().click(); assert.deepEqual(await page.evaluate(() => window.removed), [{ kind: 'unavailable', index: 20 }])
    await page.getByLabel('등록한 조건 출처', { exact: true }).selectOption('school'); assert.equal(await list.getByRole('button', { name: /조건 삭제$/ }).count(), 0)
  })
  await check('충돌에서 관련 고정·불가만 모아 보여 주고 선호를 원인으로 안내하지 않는다', async () => {
    await page.evaluate(() => { window.conditions = { fixed: [{ lessonId: 'practice-lesson-a1', slotId: 'practice-1-1' }], unavailable: [{ resourceId: 'practice-teacher-a', day: 1, startMinute: 550, endMinute: 560 }, { resourceId: 'practice-teacher-a', day: 2, startMinute: 550, endMinute: 560 }], preferences: [{ lessonId: 'practice-lesson-a1', slotId: 'practice-1-1', weight: 5 }] }; window.refresh() })
    await page.getByText(/계산 전에 확인할 충돌 .*관련 조건 찾기/).click(); await page.getByLabel('함께 확인할 충돌', { exact: true }).selectOption('domain:practice-lesson-a1')
    assert.equal(await page.getByRole('region', { name: '사용할 수 없는 시간 목록', exact: true }).getByRole('button', { name: /조건 삭제$/ }).count(), 1); assert.equal(await page.getByRole('region', { name: '가능하면 피할 시간 목록', exact: true }).getByRole('button', { name: /조건 삭제$/ }).count(), 0); await page.getByText(/한 조건을 지운다고 해결된다는 뜻은 아니며/).waitFor()
  })
  await check('320px·큰 글자에서 시간 선택·조건 검토를 읽고 키보드로 반영한다', async () => {
    await page.setViewportSize({ width: 320, height: 800 }); await page.addStyleTag({ content: 'html{font-size:200%}input,select,button{font-size:inherit!important}' }); await slots(); await choose('월', 'practice-1-1'); await preview()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.getByLabel('매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다', { exact: true }).focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.applied.length), 1)
    if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'condition-review-mobile.png'), fullPage: true }) }
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0])
  })
  assert.deepEqual(errors, []); console.log(`시간표 조건 선택·검토 브라우저 검사: ${n}개 통과`)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
