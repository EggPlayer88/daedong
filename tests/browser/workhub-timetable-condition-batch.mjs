import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ConditionBatchPanel}from'./apps/workhub/src/timetable/ConditionBatchPanel';import{initialConditionBatch,conditionBatchSourceKey}from'./apps/workhub/src/timetable/condition-batch';
import{TimetableWorkspacePanel}from'./apps/workhub/src/timetable/TimetableWorkspace';import{timetablePracticeSnapshot}from'./apps/workhub/src/timetable/sample';import{solveTimetable}from'./packages/timetable/src/solver';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
import css from'./apps/workhub/src/timetable/timetable.css';const style=document.createElement('style');style.textContent=css;document.head.append(style);
window.member={id:'m',schoolId:'s',userId:'u',name:'합성교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};window.snapshot=timetablePracticeSnapshot('2026-10-19');window.snapshot.canSave=true;window.snapshot.basis.schoolId='s';window.basis=window.snapshot.basis;window.conditions={fixed:[],unavailable:[],preferences:[]};window.state=initialConditionBatch();window.applied=[];window.drafts=createEditDrafts();window.pending=createPendingRequests();window.fail=false;window.solves=0;window.saves=0;
window.server={readiness:async()=>({available:true}),get:async()=>{if(window.fail)throw Error('offline');return structuredClone(window.snapshot)},save:async()=>{window.saves++;throw Error('must not save')},recover:async()=>{throw Error('must not recover')}};
const runSolver=b=>{window.solves++;return{promise:Promise.resolve(solveTimetable(b)),cancel(){}}};
function Solo(){const[,setTick]=useState(0);window.refresh=()=>setTick(x=>x+1);return <ConditionBatchPanel basis={window.basis} conditions={window.conditions} state={window.state} disabled={false} onStateChange={s=>{window.state=s;window.refresh()}} onApply={(next,key)=>{if(key!==conditionBatchSourceKey(window.basis,window.conditions))return false;window.applied.push(next);window.conditions=next;window.state=initialConditionBatch();window.refresh();return true}}/>}
function Work(){const[revision,setRevision]=useState(0);window.refresh=()=>setRevision(x=>x+1);return <EditDraftsProvider store={window.drafts}><PendingRequestsProvider store={window.pending}><TimetableWorkspacePanel member={window.member} server={window.server} date="2026-10-19" revision={revision} runSolver={runSolver} onNavigationLockChange={value=>window.locked=value}/></PendingRequestsProvider></EditDraftsProvider>}
window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.root.render(window.mode==='workspace'?<Work/>:<Solo/>)};window.mount();
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><main class="timetable-workspace"><div id="root"></div></main></body></html>' }))
let n = 0
async function start(mode = 'solo') { await page.goto('http://127.0.0.1:5179/batch'); await page.evaluate(mode => window.mode = mode, mode); await page.addScriptTag({ content: bundle.outputFiles[0].text }); if (mode === 'workspace') { await page.getByRole('button', { name: '시간표 만들기', exact: true }).click(); await page.getByRole('button', { name: /조건 정리$/ }).click() }; await page.getByText('여러 대상·요일에 조건 한 번에 추가', { exact: true }).click() }
async function select() { if (!await page.getByLabel('일괄 대상 예시 교사 가', { exact: true }).isVisible()) await page.getByText('여러 대상·요일에 조건 한 번에 추가', { exact: true }).click(); await page.getByLabel('일괄 대상 예시 교사 가', { exact: true }).check(); await page.getByLabel('일괄 월요일', { exact: true }).check(); await page.getByLabel('일괄 시작 시각', { exact: true }).fill('09:10'); await page.getByLabel('일괄 종료 시각', { exact: true }).fill('09:30') }
async function preview() { await page.getByRole('button', { name: '일괄 조건 미리보기', exact: true }).click(); await page.getByRole('region', { name: '일괄 조건 검토 결과', exact: true }).waitFor() }
async function apply() { await page.getByLabel('매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다', { exact: true }).check(); await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).click() }
async function check(name, run, mode = 'solo') { await start(mode); await run(); n++; console.log('  ✓ ' + name) }
try {
  await check('여러 교사와 요일의 실제 시각을 확인한 뒤에만 조건을 반영한다', async () => {
    await select(); await page.getByLabel('일괄 대상 예시 교사 나', { exact: true }).check(); await page.getByLabel('일괄 수요일', { exact: true }).check(); await preview()
    await page.getByRole('heading', { name: '추가·강화 4건 · 기존 유지 0건', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.applied.length), 0)
    assert.equal(await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).isDisabled(), true); await apply()
    assert.equal(await page.evaluate(() => window.applied[0].unavailable.length), 4); assert.equal(await page.evaluate(() => window.state.resourceIds.length), 0)
  })
  await check('대상 검색·종류·쪽을 바꿔도 선택을 유지하고 긴 변경 목록은 끝까지 볼 수 있다', async () => {
    await page.evaluate(() => { for (let i = 1; i <= 45; i++) window.basis.resources.push({ id: 'extra' + i, kind: 'teacher', label: '추가 교사 ' + String(i).padStart(2, '0'), capacity: 1 }); window.basis = structuredClone(window.basis); window.refresh() })
    await page.getByRole('button', { name: '검색된 조건 대상 모두 선택 (47)', exact: true }).click(); await page.getByRole('button', { name: '다음 조건 대상', exact: true }).click(); await page.getByRole('button', { name: '다음 조건 대상', exact: true }).click(); await page.getByLabel('일괄 대상 추가 교사 45', { exact: true }).waitFor(); assert.equal(await page.getByLabel('일괄 대상 추가 교사 45', { exact: true }).isChecked(), true)
    await page.getByLabel('일괄 조건 대상 검색', { exact: true }).fill('없는 대상'); await page.getByText('검색된 대상이 없습니다. 다른 검색에서 선택한 대상은 유지합니다.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.state.resourceIds.length), 47)
    await page.getByLabel('일괄 월요일', { exact: true }).check(); await page.getByLabel('일괄 시작 시각', { exact: true }).fill('07:00'); await page.getByLabel('일괄 종료 시각', { exact: true }).fill('08:00'); await preview()
    await page.getByText('일괄 조건 변경 내용 · 47건', { exact: true }).click(); await page.getByRole('button', { name: '다음 일괄 조건 변경 내용', exact: true }).click(); await page.getByRole('button', { name: '다음 일괄 조건 변경 내용', exact: true }).click(); await page.getByText('추가 교사 45 · 월 07:00–08:00 · 필수 불가 추가', { exact: true }).waitFor()
  })
  await check('미리보기 뒤 자료가 바뀌면 확인을 취소하되 대상과 시간 입력은 보존한다', async () => {
    await select(); await preview(); await page.getByLabel('매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다', { exact: true }).check()
    await page.evaluate(() => { window.basis = { ...window.basis, revision: 2 }; window.refresh() }); await page.getByText('기초 자료나 현재 조건이 바뀌어 미리보기를 닫았습니다. 입력은 보관했으니 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).count(), 0); assert.equal(await page.getByLabel('일괄 대상 예시 교사 가', { exact: true }).isChecked(), true); assert.equal(await page.getByLabel('일괄 시작 시각', { exact: true }).inputValue(), '09:10'); assert.equal(await page.evaluate(() => window.applied.length), 0)
  })
  await check('고정 수업과 겹치는 불가의 충돌을 설명하고 학교 필수조건은 지우지 않는다', async () => {
    await page.evaluate(() => { const fixed = [{ lessonId: window.basis.lessons[0].id, slotId: window.basis.slots[0].id }]; window.basis = { ...window.basis, fixed }; window.conditions = { ...window.conditions, fixed: structuredClone(fixed) }; window.refresh() })
    await select(); await preview(); await page.getByText(/반영 후 확정 충돌 1건이 남아 계산이 막힙니다/).waitFor(); await apply(); assert.equal(await page.evaluate(() => window.applied[0].fixed[0].lessonId), 'practice-lesson-a1')
  })
  await check('일괄 입력 중에는 단일 조건·계산·저장을 막고 화면을 다시 열어도 입력을 보존한다', async () => {
    await select(); assert.equal(await page.getByLabel('조건 종류', { exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: /배치·비교/ }).click(); assert.equal(await page.getByRole('button', { name: '배치 만들기', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: '공개 검토', exact: true }).click(); assert.equal(await page.getByRole('button', { name: '새 초안으로 서버에 저장', exact: true }).isDisabled(), true)
    await page.evaluate(() => { window.root.unmount(); window.mount() }); await page.getByRole('button', { name: /조건 정리$/ }).click(); assert.equal(await page.getByLabel('일괄 대상 예시 교사 가', { exact: true }).isChecked(), true); assert.equal(await page.getByLabel('일괄 시작 시각', { exact: true }).inputValue(), '09:10')
    await preview(); await apply(); await page.getByRole('heading', { name: '사용할 수 없는 시간 · 1건', exact: true }).waitFor(); await page.getByRole('button', { name: /배치·비교/ }).click(); await page.getByRole('button', { name: '배치 만들기', exact: true }).click(); await page.getByText('전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.solves), 1); assert.equal(await page.evaluate(() => window.saves), 0)
  }, 'workspace')
  await check('조회 실패 중 입력을 숨긴 뒤 복구하고 기존 배치는 일괄 변경 뒤 다시 검사한다', async () => {
    await page.getByRole('button', { name: /배치·비교/ }).click(); await page.getByRole('button', { name: '배치 만들기', exact: true }).click(); await page.getByText('전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인', { exact: true }).waitFor(); await page.getByRole('button', { name: /조건 정리$/ }).click(); await select(); await page.getByLabel('일괄 조건 종류', { exact: true }).selectOption('preferences')
    await page.evaluate(() => { window.fail = true; window.refresh() }); await page.getByRole('heading', { name: '시간표 연결을 다시 확인해 주세요', exact: true }).waitFor(); assert.equal(await page.getByLabel('일괄 시작 시각', { exact: true }).count(), 0)
    await page.evaluate(() => window.fail = false); await page.getByRole('button', { name: '시간표 연결 다시 확인', exact: true }).click(); await page.getByLabel('일괄 시작 시각', { exact: true }).waitFor(); assert.equal(await page.getByLabel('일괄 시작 시각', { exact: true }).inputValue(), '09:10')
    await preview(); await apply(); await page.getByRole('button', { name: /배치·비교/ }).click(); await page.getByText('조건 변경 전의 배치를 보관하고 있습니다. 다시 검사하면 기존 배치를 보며 조정할 수 있습니다.', { exact: true }).waitFor(); await page.getByRole('button', { name: '보관한 배치 다시 검사', exact: true }).click(); await page.getByText('전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.solves), 1)
  }, 'workspace')
  await check('320px·200% 글자에서도 선택·시간·미리보기를 읽고 키보드로 반영한다', async () => {
    await page.setViewportSize({ width: 320, height: 800 }); await page.addStyleTag({ content: 'html{font-size:200%}input,select,button{font-size:inherit!important}' }); await select(); await preview()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await page.getByLabel('매주 적용할 대상·시간·조건과 충돌 안내를 확인했습니다', { exact: true }).focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: '확인한 일괄 조건 반영', exact: true }).focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.applied.length), 1)
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0])
  })
  assert.deepEqual(errors, []); console.log(`시간표 조건 일괄 입력 브라우저 검사: ${n}개 통과`)
} catch (error) { console.log(await page.locator('body').innerText()); throw error } finally { await browser.close() }
