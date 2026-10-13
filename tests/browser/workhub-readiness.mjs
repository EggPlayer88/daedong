// 실제 연결 화면과 진단 UI를 합성 전송 계층으로 실행한다. 외부 서버에는 접속하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const bundle = buildSync({ stdin: { contents: `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {ConnectedWorkspace} from './apps/workhub/src/app/ConnectedWorkspace';
  import {ConnectionReadinessPanel} from './apps/workhub/src/app/ConnectionReadinessPanel';
  import {createSupabaseConnection} from './apps/workhub/src/connection/supabase-connection';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  const query=new URL(location.href).searchParams;
  let mode=query.get('case')||'missing', uid='fixture-soyeon', owner=uid, callback=()=>{}, held=false, resolveHeld;
  const memory=createMemoryAdapter(fixtureData,0);
  const root=createRoot(document.getElementById('root'));
  const scenario={checks:0,sessionReads:0,contextReads:0,writes:0,downloads:[],setMode(value){mode=value},setHeld(value){held=value},release(){if(resolveHeld){resolveHeld({stage:'ready',code:'CONTEXT_READY',checkedAt:'2026-10-11T00:00:00.000Z',readySchoolCount:2});resolveHeld=undefined}},switchUser(value){uid=value;owner=value;callback({user:{id:uid}});render()},unmount(){root.unmount()}};
  window.scenario=scenario;
  const services={
    async getSession(){scenario.sessionReads++;return mode==='logged_out'?null:{user:{id:uid}}},
    async fetchMyProfile(id){return mode==='profile_missing'?null:{id,name:'PRIVATE-NAME',email:'PRIVATE-EMAIL@example.invalid',role:mode==='forbidden'?'teacher':'superadmin',extra_permissions:[],department_id:null,is_active:mode!=='pending'}},
    onAuthStateChange(cb){callback=cb;return()=>{callback=()=>{}}},
    async signInWithGoogle(){scenario.writes++;throw new Error('진단은 로그인을 시작하지 않아야 한다')},
    async signOut(){scenario.writes++;throw new Error('진단은 로그아웃하지 않아야 한다')},
    async rpc(name,args){
      if(name==='workhub_context'){
        scenario.contextReads++;
        if(mode==='missing')return {data:null,error:{code:'PGRST202',message:'SECRET-RAW-ERROR'}};
        if(mode==='network')throw new Error('SECRET-NETWORK-TOKEN');
        if(mode==='server_forbidden')return {data:null,error:{message:'FORBIDDEN'}};
        if(mode==='empty')return {error:null,data:{schools:[],memberships:[],basisDate:fixtureData.basisDate,relationLabels,schoolLabels:{}}};
        return {error:null,data:{...memory.info(),schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}};
      }
      if(name==='workhub_calendar_list')return {data:await memory.list(args.p_member_id),error:null};
      if(name==='workhub_calendar_get')return {data:await memory.get(args.p_member_id,args.p_event_id),error:null};
      scenario.writes++;throw new Error('진단은 쓰기 API를 호출하지 않아야 한다');
    }
  };
  const connection=createSupabaseConnection(services);
  const actualCheck=connection.checkReadiness;
  connection.checkReadiness=async()=>{
    scenario.checks++;
    if(held)return new Promise(resolve=>{resolveHeld=resolve});
    return actualCheck();
  };
  const runCheck=()=>mode==='unexpected_error'?Promise.reject(new Error('SECRET-UNEXPECTED-TOKEN')):connection.checkReadiness();
  function render(){root.render(query.get('mode')==='panel'
    ?<ConnectionReadinessPanel runCheck={runCheck} expectedUserId={owner} onDownload={(json,filename)=>{scenario.downloads.push({json,filename})}}/>
    :<ConnectedWorkspace expectedUserId={owner} connection={connection}/>)}
  render();
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#f7f8f4}button{font:inherit}</style><body><div id="root"></div></body></html>' }))
const panel = () => page.locator('.connection-readiness')
const button = () => panel().getByRole('button', { name: /^연결 상태 (다시 )?확인$/ })
const stage = value => panel().locator(`[data-readiness-stage="${value}"]`)
async function boot(mode = 'panel', state = 'ready') {
  await context.setOffline(false)
  await page.goto(`http://127.0.0.1:5176/readiness-contract-test?mode=${mode}&case=${state}`)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await button().waitFor()
}
async function runAndExpect(expected) { await button().click(); await stage(expected).waitFor() }
async function snapshot(name) {
  if (!process.env.WORKHUB_QA_OUTPUT) return
  mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
  await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, name + '.png'), fullPage: true })
}
try {
  await boot('connected', 'missing')
  await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다' }).waitFor()
  assert.equal(await page.evaluate(() => window.scenario.checks), 0)
  assert.equal(await panel().locator('[data-readiness-stage]').count(), 0)
  await runAndExpect('foundation_missing')
  assert.match(await panel().innerText(), /학교 조회 기능의 준비 상태/)
  assert(!((await panel().innerText()).includes('SECRET-RAW-ERROR')))
  assert.equal(await panel().locator('details[open]').count(), 0)
  await snapshot('readiness-desktop-missing')
  console.log('  ✓ 실제 ConnectedWorkspace에서 자동 진단 없이 조회 기능 부재 PGRST202 안내')

  await page.evaluate(() => window.scenario.setMode('ready'))
  await runAndExpect('ready')
  assert.match(await panel().innerText(), /확인된 학교 소속: 2곳/)
  const downloadPromise = page.waitForEvent('download')
  await panel().getByRole('button', { name: '지원용 진단 파일 내려받기' }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'workhub-connection-readiness.json')
  const stream = await download.createReadStream()
  let downloaded = ''
  for await (const part of stream) downloaded += part.toString()
  const safe = JSON.parse(downloaded)
  assert.deepEqual(Object.keys(safe).sort(), ['checkedAt', 'code', 'readySchoolCount', 'stage'])
  assert.equal(safe.readySchoolCount, 2)
  assert.equal(safe.code, 'CONTEXT_READY')
  assert(!/PRIVATE|fixture-soyeon|SECRET|ga(o|n)on/.test(downloaded))
  assert.equal(await page.evaluate(() => window.scenario.writes), 0)
  console.log('  ✓ 설정 변경 없이 재진단 복구·학교 수 확인·실제 다운로드의 개인정보 없는 4필드')

  for (const [state, expected, text] of [['empty', 'no_membership', '현재 이용할 학교 소속이 없습니다'], ['network', 'unavailable', '지금은 연결 상태를 확인하지 못했습니다']]) {
    await page.evaluate(value => window.scenario.setMode(value), state)
    await runAndExpect(expected)
    assert((await panel().innerText()).includes(text))
    assert(!/SECRET|PRIVATE/.test(await panel().innerText()))
  }
  console.log('  ✓ 실제 연결 화면에서 소속 없음과 연결 실패를 서로 다르게 안내')

  for (const [state, expected] of [['logged_out', 'logged_out'], ['pending', 'pending'], ['profile_missing', 'profile_missing'], ['forbidden', 'forbidden'], ['server_forbidden', 'forbidden'], ['unexpected_error', 'unavailable']]) {
    await boot('panel', state)
    assert.equal(await page.evaluate(() => window.scenario.sessionReads), 0)
    await runAndExpect(expected)
    assert(!/SECRET|PRIVATE/.test(await panel().innerText()))
    assert.equal(await page.evaluate(() => window.scenario.writes), 0)
  }
  console.log('  ✓ 미로그인·승인 대기·회원 정보 없음·권한 거부·예외를 안전하게 구분')

  await boot('panel')
  await context.setOffline(true)
  await runAndExpect('unavailable')
  assert.match(await panel().innerText(), /오프라인 상태여서/)
  assert.equal(await page.evaluate(() => window.scenario.checks), 0)
  await context.setOffline(false)
  await runAndExpect('ready')
  console.log('  ✓ 오프라인에서는 요청 없이 안내하고 연결 복구 후 명시적으로 재확인')

  await boot('panel')
  await page.evaluate(() => window.scenario.setHeld(true))
  await button().click()
  const running = panel().getByRole('button', { name: '연결 상태 확인 중…' })
  assert.equal(await running.isDisabled(), true)
  await running.evaluate(node => { node.click(); node.click() })
  assert.equal(await page.evaluate(() => window.scenario.checks), 1)
  assert.equal(await panel().locator('[data-readiness-stage]').count(), 0)
  await page.evaluate(() => window.scenario.release())
  await stage('ready').waitFor()
  console.log('  ✓ 진단 실행 중 중복 클릭 차단·진행 상태 표시·결과 도착 후 표시')

  await page.evaluate(() => window.scenario.setHeld(true))
  await button().click()
  await page.evaluate(() => window.scenario.switchUser('fixture-another'))
  await button().waitFor()
  assert.equal(await panel().locator('[data-readiness-stage]').count(), 0)
  await page.evaluate(() => window.scenario.release())
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction(() => document.querySelector('.readiness-idle')?.textContent?.includes('아직 확인하지 않았습니다'))
  assert.equal(await panel().locator('[data-readiness-stage]').count(), 0)
  assert.equal(await panel().getByRole('button', { name: '지원용 진단 파일 내려받기' }).count(), 0)
  console.log('  ✓ 같은 컴포넌트의 계정 변경 후 늦은 성공 응답·이전 다운로드 모두 폐기')

  await page.evaluate(() => window.scenario.setHeld(true))
  await button().click()
  await page.evaluate(() => { window.scenario.unmount(); window.scenario.release() })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await panel().count(), 0)
  console.log('  ✓ unmount 이후 늦은 응답을 화면에 복원하지 않음')

  await page.setViewportSize({ width: 360, height: 800 })
  await boot('connected', 'missing')
  await runAndExpect('foundation_missing')
  await panel().getByText('관리자용 진단 정보', { exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await panel().evaluate(node => node.scrollWidth <= node.clientWidth), true)
  await snapshot('readiness-mobile-missing')
  assert.equal(await page.evaluate(() => window.scenario.writes), 0)
  assert.deepEqual(errors, [])
  console.log('  ✓ 360px 모바일·관리자 상세 펼침 가로 넘침 없음·console/page 오류 없음')
} catch (error) {
  console.error(error)
  console.error((await page.locator('body').innerText()).slice(-2200))
  process.exitCode = 1
} finally { await context.close(); await browser.close() }
