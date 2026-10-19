// 실제 React 도움말과 기본 조회 점검기를 사용한다. DB 응답은 합성이며 운영 접속·저장·AI 호출은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{WorkspaceHelp}from'./apps/workhub/src/support/WorkspaceHelp';import{checkModules}from'./apps/workhub/src/support/module-checks';import appearance from './apps/workhub/src/appearance/appearance.css?inline';
window.calls=[];window.rpcCalls=[];window.navigations=[];window.active=0;window.maxActive=0;window.aborted=[];window.hold=null;window.codes={};window.releases={};window.bad=false;window.allowNavigate=true;window.real=false;window.scope='scope-a';window.school='school';window.locked=false;window.theme='light';
const member=()=>({id:'member',schoolId:window.school,userId:'user',name:'비공개 교사',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]});
const connection={info:()=>({memberships:[member()],schools:[{id:window.school}],basisDate:'2026-10-16'}),getIdentity:async()=>({userId:'user',approved:true,profile:{id:'user',name:'비공개 교사',email:'private@example.invalid',role:'superadmin',is_active:true,department_id:null,extra_permissions:[]}}),rpcVerified:async(name,args)=>{window.rpcCalls.push({name,args});if(name==='workhub_calendar_list'||name==='workhub_task_list')return[];if(name==='workhub_school_admin_readiness')return{kind:'workhub-school-admin',schemaVersion:1,schoolId:window.school,memberId:'member',data:{available:false,reason:'not_installed'}};throw Error('private@example.invalid: 실제 연결 아님')}};
const runCheck=async(id,signal)=>{window.calls.push(id);window.active++;window.maxActive=Math.max(window.maxActive,window.active);signal.addEventListener('abort',()=>window.aborted.push(id),{once:true});if(window.hold===id)await new Promise(resolve=>window.releases[id]=resolve);else await new Promise(resolve=>setTimeout(resolve,3));window.active--;if(window.codes[id]==='THROW')throw Error('private@example.invalid');return{id:window.bad?'secret-student':id,code:window.codes[id]||'READ_CONFIRMED',checkedAt:'2026-10-16T00:00:00.000Z',secret:'private@example.invalid'}};
function Harness(){const[n,refresh]=useState(0);window.refresh=()=>refresh(x=>x+1);const dark=window.theme==='dark';return <div className="ws-shell" style={{fontFamily:'Arial,sans-serif',fontSize:window.large?'20px':'15px','--ui-body-size':window.large?'20px':'15px','--ui-surface':dark?'#20252d':'#ffffff','--ui-text':dark?'#edf1f6':'#20252d','--ui-muted':dark?'#bec9d7':'#596370','--ui-line':dark?'#536172':'#dce1e8','--ui-accent':dark?'#aacbfa':'#315e9b','--ui-on-accent':dark?'#14263f':'#ffffff','--ui-accent-soft':dark?'#2c3d53':'#edf3fb','--ui-surface-muted':dark?'#29313d':'#f4f6f8'}}><style>{appearance}</style><WorkspaceHelp connection={connection} memberId="member" scopeKey={window.scope} locked={window.locked} onNavigate={page=>{window.navigations.push(page);return window.allowNavigate}} runCheck={window.real?undefined:runCheck}/><button type="button">바깥 버튼</button></div>};window.expectedChecks=checkModules.map(x=>x.id);window.expectedRpcs=checkModules.map(x=>x.rpc);const host=document.getElementById('root');const shadow=host.attachShadow({mode:'open'});window.root=createRoot(shadow);window.root.render(<Harness/>);
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await context.newPage()
const errors = [], passed = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:8px}*{box-sizing:border-box}</style></head><body><div id="root"></div></body></html>' }))
const dialog = () => page.getByRole('dialog', { name: '업무실 도움말', exact: true })
const trigger = () => page.getByRole('button', { name: '사용 안내', exact: true })
const row = id => dialog().locator(`[data-check="${id}"]`)
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function start() { await page.goto('http://127.0.0.1:5181/help'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await trigger().waitFor(); await trigger().click(); await dialog().waitFor() }
async function checks() { await dialog().getByRole('tab', { name: '기능 연결 점검', exact: true }).click() }
async function test(name, run) { await start(); await run(); passed.push(name); console.log('  ✓ ' + name) }
try {
  await test('열람만으로 조회·저장·AI를 호출하지 않고 14개 안내와 세 단계를 보인다', async () => {
    assert.equal(await dialog().getByRole('navigation', { name: '업무별 사용 방법' }).getByRole('button').count(), 14)
    assert.equal(await dialog().locator('article ol li').count(), 3)
    assert.deepEqual(await page.evaluate(() => [window.calls, window.rpcCalls]), [[], []])
    assert.equal(await dialog().getByRole('searchbox').evaluate(element => element.getRootNode().activeElement === element), true)
    if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'help-desktop-light.png'), fullPage: true }) }
  })
  await test('검색으로 인쇄 안내를 찾고 없는 검색은 안전한 빈 결과를 보인다', async () => {
    await dialog().getByRole('searchbox').fill('인쇄')
    await dialog().getByRole('heading', { name: '학생 기록 남기고 출력하기' }).waitFor()
    assert.equal(await dialog().locator('article ol li').count(), 3)
    await dialog().getByRole('searchbox').fill('zzzz없는업무')
    await dialog().getByText('찾는 사용 방법이 없습니다.', { exact: false }).waitFor()
    assert.equal(await dialog().locator('article').count(), 0)
  })
  await test('메뉴 열기는 기존 PageId만 전달하고 성공할 때 닫는다', async () => {
    await dialog().getByRole('searchbox').fill('인쇄')
    await dialog().getByRole('button', { name: '수업과 학생 열기', exact: true }).click()
    await dialog().waitFor({ state: 'hidden' }); assert.deepEqual(await page.evaluate(() => window.navigations), ['students'])
  })
  await test('시간표 안내는 교사와 담당자 경로를 구분하고 서버 호출 없이 기존 시간표 메뉴를 연다', async () => {
    await dialog().getByRole('searchbox').fill('시간표')
    const guides = dialog().getByRole('navigation', { name: '업무별 사용 방법' })
    assert.equal(await guides.getByRole('button').count(), 2)
    await guides.getByRole('button', { name: '시간표 확인하고 수업 교환 요청하기', exact: true }).click()
    await dialog().getByText(/추천·동의만으로 시간표가 바뀌지 않습니다/).waitFor()
    await guides.getByRole('button', { name: '담당자의 시간표 편성 시작하기', exact: true }).click()
    await dialog().getByText(/연습용 예시는 학교에 저장하거나 공개하지 않습니다/).waitFor()
    await dialog().getByRole('button', { name: '시간표 열기', exact: true }).click()
    await dialog().waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => [window.navigations, window.calls, window.rpcCalls]), [['timetable'], [], []])
  })
  await test('메뉴 이동이 거절되면 도움말과 안내를 유지한다', async () => {
    await page.evaluate(() => { window.allowNavigate = false })
    await dialog().getByRole('button', { name: '오늘 열기', exact: true }).click()
    await dialog().getByText('현재 화면의 입력이나 처리 상태를 확인한 뒤 이동해 주세요.').waitFor(); assert.equal(await dialog().isVisible(), true)
  })
  await test('Escape로 닫으면 ShadowRoot 안 원래 버튼에 초점을 돌려준다', async () => {
    await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' })
    assert.equal(await trigger().evaluate(element => element.getRootNode().activeElement === element), true)
  })
  await test('탭 방향키와 Tab 이동은 열린 native dialog 안에 머문다', async () => {
    const guideTab = dialog().getByRole('tab', { name: '사용 방법', exact: true }); await guideTab.focus(); await page.keyboard.press('ArrowRight')
    assert.equal(await dialog().getByRole('tab', { name: '기능 연결 점검', exact: true }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Home'); assert.equal(await guideTab.getAttribute('aria-selected'), 'true')
    for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog().evaluate(element => element.contains(element.getRootNode().activeElement)), true, `Tab ${i}: ${await dialog().evaluate(element => element.getRootNode().activeElement?.outerHTML ?? document.activeElement?.outerHTML)}`) }
  })
  await test('입력 보관 중에도 안내를 읽고 검색할 수 있지만 이동·조회는 막는다', async () => {
    await page.evaluate(() => { window.locked = true; window.refresh() })
    await dialog().getByText('작성 중이거나 결과를 확인 중인 입력이 있습니다.', { exact: false }).waitFor()
    await dialog().getByRole('searchbox').fill('제출'); assert.equal(await dialog().locator('article button').isDisabled(), true)
    await checks(); assert.equal(await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).isDisabled(), true)
    assert.equal(await dialog().getByRole('button', { name: '학교 일정 확인', exact: true }).isDisabled(), true)
    assert.deepEqual(await page.evaluate(() => [window.calls, window.rpcCalls, window.navigations]), [[], [], []])
  })
  await test('전체 점검은 12항목을 순차 조회하고 준비 응답을 활성화 완료로 바꾸지 않는다', async () => {
    await page.evaluate(() => { window.codes.school = 'READY_RESPONSE'; window.codes.collections = 'VERIFICATION_MISSING'; window.codes.messaging = 'PARTIAL' })
    await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await dialog().getByText('요청한 항목의 조회를 마쳤습니다.', { exact: false }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls), await page.evaluate(() => window.expectedChecks)); assert.equal(await page.evaluate(() => window.maxActive), 1)
    assert.match(await row('school').innerText(), /준비 응답 확인/); assert.match(await row('collections').innerText(), /파일 확인 기능 준비 필요/)
    assert.match(await row('messaging').innerText(), /일부 준비 필요/); assert.match(await row('calendar').innerText(), /조회 확인/)
    assert.doesNotMatch(await dialog().innerText(), /전체.*준비 완료|모든 기능.*사용 가능/)
  })
  await test('한 항목 실패 뒤 나머지를 계속 확인하고 해당 항목만 재시도한다', async () => {
    await page.evaluate(() => { window.codes.tasks = 'THROW' }); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await dialog().getByText('요청한 항목의 조회를 마쳤습니다.', { exact: false }).waitFor(); assert.match(await row('tasks').innerText(), /조회하지 못함/)
    await page.evaluate(() => { delete window.codes.tasks }); await row('tasks').getByRole('button', { name: '내 업무 다시 확인' }).click()
    await row('tasks').getByText('조회 확인', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.calls.length), 13)
    assert.equal(await page.evaluate(() => window.calls.at(-1)), 'tasks'); assert.doesNotMatch(await dialog().innerText(), /private@example/)
  })
  for (const code of ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CANCELLED']) await test(`${code}이면 다음 기능 조회를 시작하지 않는다`, async () => {
    await page.evaluate(value => { window.codes.tasks = value }, code); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await dialog().getByText('현재 계정과 학교 연결을 확인하기 위해 나머지 점검을 멈췄습니다.', { exact: false }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls), ['calendar', 'tasks'])
  })
  await test('중지 뒤 늦게 온 성공은 폐기하고 재점검 결과만 표시한다', async () => {
    await page.evaluate(() => { window.hold = 'calendar' }); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await page.waitForFunction(() => !!window.releases.calendar); await dialog().getByRole('button', { name: '점검 중지', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.aborted), ['calendar'])
    await page.evaluate(() => { window.hold = null; window.codes.calendar = 'DATABASE_MISSING' }); await row('calendar').getByRole('button', { name: '학교 일정 확인', exact: true }).click()
    await row('calendar').getByText('조회 기능 준비 필요', { exact: true }).waitFor(); await page.evaluate(() => window.releases.calendar()); await settle()
    assert.match(await row('calendar').innerText(), /조회 기능 준비 필요/); assert.equal(await page.evaluate(() => window.calls.length), 2)
  })
  await test('탭을 바꾸면 진행 조회를 취소하고 늦은 결과를 반영하지 않는다', async () => {
    await page.evaluate(() => { window.hold = 'calendar' }); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await page.waitForFunction(() => !!window.releases.calendar); await dialog().getByRole('tab', { name: '사용 방법', exact: true }).click()
    await page.evaluate(() => window.releases.calendar()); await checks(); await settle(); assert.match(await row('calendar').innerText(), /아직 확인하지 않음/)
    assert.deepEqual(await page.evaluate(() => window.calls), ['calendar'])
  })
  await test('닫기는 진행 조회를 취소하고 다시 열 때 이전 결과를 노출하지 않는다', async () => {
    await page.evaluate(() => { window.hold = 'calendar' }); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await page.waitForFunction(() => !!window.releases.calendar); await dialog().getByRole('button', { name: '업무실 도움말 닫기', exact: true }).click()
    await page.evaluate(() => window.releases.calendar()); await trigger().click(); await checks(); await settle()
    assert.match(await row('calendar').innerText(), /아직 확인하지 않음/); assert.deepEqual(await page.evaluate(() => window.aborted), ['calendar'])
  })
  await test('학교 범위가 바뀌면 즉시 닫고 이전 응답을 폐기한다', async () => {
    await page.evaluate(() => { window.hold = 'calendar' }); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await page.waitForFunction(() => !!window.releases.calendar); await page.evaluate(() => { window.scope = 'scope-b'; window.school = 'school-b'; window.refresh() })
    await dialog().waitFor({ state: 'hidden' }); await page.evaluate(() => window.releases.calendar()); await trigger().click(); await checks(); await settle()
    assert.match(await row('calendar').innerText(), /아직 확인하지 않음/); assert.deepEqual(await page.evaluate(() => window.aborted), ['calendar'])
  })
  await test('점검 중 입력 잠금이 생기면 취소하고 추가 조회를 멈춘다', async () => {
    await page.evaluate(() => { window.hold = 'calendar' }); await checks(); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click()
    await page.waitForFunction(() => !!window.releases.calendar); await page.evaluate(() => { window.locked = true; window.refresh() })
    await dialog().getByText('입력 처리가 끝날 때까지 연결 점검을 멈춥니다.', { exact: false }).waitFor(); await page.evaluate(() => window.releases.calendar()); await settle()
    assert.deepEqual(await page.evaluate(() => window.calls), ['calendar']); assert.match(await row('calendar').innerText(), /아직 확인하지 않음/)
  })
  await test('지원용 JSON은 고정 코드·시각만 담고 추가 필드나 검색어를 넣지 않는다', async () => {
    await dialog().getByRole('searchbox').fill('비공개검색학생'); await checks(); await row('calendar').getByRole('button', { name: '학교 일정 확인', exact: true }).click(); await row('calendar').getByText('조회 확인', { exact: true }).waitFor()
    const pending = page.waitForEvent('download'); await dialog().getByRole('button', { name: '지원용 JSON 내려받기', exact: true }).click(); const download = await pending
    const raw = readFileSync(await download.path(), 'utf8'), value = JSON.parse(raw)
    assert.deepEqual(value, { format: 'workhub-module-check.v1', scope: 'read_only', checks: [{ id: 'calendar', code: 'READ_CONFIRMED', checkedAt: '2026-10-16T00:00:00.000Z' }] })
    assert.doesNotMatch(raw, /private|비공개|schoolId|memberId|secret|student/)
  })
  await test('다른 항목의 잘못된 응답은 성공으로 표시하지 않는다', async () => {
    await page.evaluate(() => { window.bad = true }); await checks(); await row('calendar').getByRole('button', { name: '학교 일정 확인', exact: true }).click()
    await row('calendar').getByText('응답 확인 필요', { exact: true }).waitFor(); assert.doesNotMatch(await dialog().innerText(), /secret-student|private@example/)
  })
  await test('기본 점검기는 실제 앱 어댑터를 통해 허용된 12개 조회만 보낸다', async () => {
    await dialog().getByRole('button', { name: '닫기', exact: true }).click(); await page.evaluate(() => { window.real = true; window.refresh() }); await trigger().click(); await checks()
    assert.equal(await page.evaluate(() => window.rpcCalls.length), 0); await dialog().getByRole('button', { name: '전체 연결 점검', exact: true }).click(); await dialog().getByText('요청한 항목의 조회를 마쳤습니다.', { exact: false }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.rpcCalls.map(call => call.name)), await page.evaluate(() => window.expectedRpcs))
    assert.equal(await page.evaluate(() => window.calls.length), 0); assert.match(await row('school').innerText(), /조회 기능 준비 필요/)
    assert.equal(await page.evaluate(() => window.rpcCalls.some(call => /mutate|prepare|read_thread|inspect|download|assistant|cleanup/.test(call.name))), false)
  })
  await test('320px·큰 글자·차콜 스킨에서도 넘침 없이 기존 색상을 상속한다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await page.evaluate(() => { window.large = true; window.theme = 'dark'; window.refresh() }); await settle()
    assert.equal(await dialog().evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(32, 37, 45)')
    assert.equal(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await checks(); await settle(); assert.equal(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'help-mobile-dark.png'), fullPage: true }) }
  })
  assert.deepEqual(errors, [])
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'workhub-help.json'), JSON.stringify({ passed, errors, boundary: '실제 React·조회 어댑터 + 합성 응답. 실제 Supabase 검증 아님.' }, null, 2)) }
  console.log(`업무실 도움말 브라우저 ${passed.length}건 통과`)
} finally { await context.close(); await browser.close() }
