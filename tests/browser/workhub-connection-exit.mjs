import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
// 실제 연결 화면과 바깥 SPA 메뉴 사이의 이탈을 합성 RPC로 검사한다. 운영 서버에는 접속하지 않는다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = (await build({
  stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BrowserRouter,Routes,Route,Link,useLocation} from 'react-router-dom';
    import './apps/workhub/src/app/navigation-bridge';
    import {ConnectedWorkspace} from './apps/workhub/src/app/ConnectedWorkspace';
    import WorkhubPage from './apps/main/src/pages/WorkhubPage';
    import {AuthContext} from './apps/main/src/lib/AuthContext';
    import {MODULES} from './apps/main/src/lib/modules';
    import {createSupabaseConnection} from './apps/workhub/src/connection/supabase-connection';
    import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
    import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
    import {createWorkflowStore} from './apps/workhub/src/workflows/store';
    const clone=value=>structuredClone(value),calendar=createMemoryAdapter(fixtureData,0);
    const tasks=createWorkflowStore({members:fixtureData.memberships,date:fixtureData.basisDate});
    const original=tasks.createTask('gaon-soyeon',{title:'원본 업무',notes:'저장 결과를 확인할 업무',dueDate:'2026-10-19'},'seed-task');
    let failContext=false,holdContext=false,releaseContext,role='superadmin',loseReply='';
    const qa=window.qa={contexts:0,writes:[],originalTaskId:original.id,
      fail(value){failContext=value},hold(){holdContext=true},release(){releaseContext?.();releaseContext=undefined},
      role(value){role=value},lose(kind){loseReply=kind},
      rows(kind){return kind==='calendar'?calendar.exportState().data.events:tasks.listTasks('gaon-soyeon')},
    };
    const services={
      async getSession(){return {user:{id:'fixture-soyeon'}}},
      async fetchMyProfile(id){return {id,name:'합성 교사',email:'test@example.invalid',role,extra_permissions:[],department_id:null,is_active:true}},
      onAuthStateChange(){return()=>{}},async signInWithGoogle(){},async signOut(){},
      async rpc(name,args){
        if(name==='workhub_context'){
          qa.contexts++;
          if(holdContext){holdContext=false;await new Promise(resolve=>{releaseContext=resolve})}
          return failContext?{data:null,error:{message:'QUERY_FAILED'}}:{error:null,data:{...calendar.info(),memberships:clone(fixtureData.memberships),schoolLabels:Object.fromEntries(fixtureData.schools.map(school=>[school.id,relationLabels]))}};
        }
        try{
          if(name==='workhub_calendar_list')return {data:await calendar.list(args.p_member_id),error:null};
          if(name==='workhub_calendar_get')return {data:await calendar.get(args.p_member_id,args.p_event_id),error:null};
          if(name==='workhub_task_list')return {data:tasks.listTasks(args.p_member_id),error:null};
          if(name==='workhub_task_get')return {data:tasks.listTasks(args.p_member_id).find(row=>row.id===args.p_task_id),error:null};
          // 이 시험에 없는 조회 모듈을 할 일 저장으로 잘못 계수하지 않는다.
          if(name==='workhub_timetable_operations_readiness')return {data:null,error:{code:'PGRST202',message:'not installed'}};
          qa.writes.push({name,args:clone(args)});
          const kind=name==='workhub_calendar_save'?'calendar':'task';
          let saved;
          if(kind==='calendar')saved=await calendar.save(args.p_member_id,args.p_command);
          else{
            const command=args.p_command,id=args.p_member_id,key=args.p_request_key;
            saved=command.kind==='create'?tasks.createTask(id,command.input,key):command.kind==='update'?tasks.updateTask(id,command.taskId,command.input,command.expectedVersion,key):tasks.setTaskStatus(id,command.taskId,command.status,command.expectedVersion,key);
          }
          if(loseReply===kind){loseReply='';throw Error('합성 접수 후 응답만 유실')}
          return {data:saved,error:null};
        }catch(error){return {data:null,error:{message:error.code||'QUERY_FAILED'}}}
      },
    };
    window.qaServices=services;
    const connection=createSupabaseConnection(services),query=new URL(window.location.href).searchParams;
    const actualGate=query.has('actual-gate'),basename=query.get('basename')||'',legacyHomeHref=query.get('legacy-home')||'/';
    // 시험에서만 메뉴 표의 주소를 바꾸어 루트 경로 하드코딩 회귀를 잡는다.
    if(query.has('dashboard-path'))MODULES.find(module=>module.key==='dashboard').to=query.get('dashboard-path');
    const auth={session:{user:{id:'fixture-soyeon'}},profile:{id:'fixture-soyeon',role:'superadmin',is_active:true},profileLoading:false,profileError:null};
    function Frame(){const location=useLocation();return <><header><Link to="/legacy">기존 메뉴</Link> <Link to="/workhub?view=tasks">신축 업무실</Link><output data-testid="router-location">{location.pathname+location.search}</output></header><Routes><Route path="/workhub" element={actualGate?<AuthContext.Provider value={auth}><WorkhubPage/></AuthContext.Provider>:<ConnectedWorkspace expectedUserId="fixture-soyeon" legacyHomeHref={legacyHomeHref} connection={connection}/>}/><Route path="*" element={<main><h1>기존 학교 메뉴</h1></main>}/></Routes></>}
    createRoot(document.getElementById('root')).render(<BrowserRouter basename={basename}><Frame/></BrowserRouter>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-key' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  // 실제 WorkhubPage의 기본 연결 경로는 유지하고 인증·RPC 전송 경계만 합성한다.
  plugins: [{ name: 'synthetic-legacy-services', setup(plugin) {
    plugin.onLoad({ filter: /[\\/]connection[\\/]legacy-client\.ts$/ }, () => ({ contents: 'export const legacyServices = window.qaServices', loader: 'ts' }))
  } }],
})).outputFiles[0].text

const browser = await launchBrowser(), origin = 'http://127.0.0.1:5176'
let passed = 0, failures = 0
async function test(name, run, viewport = { width: 1280, height: 1000 }, options = {}) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await context.route(origin + '/**', route => route.fulfill(new URL(route.request().url()).pathname === '/__connection-exit.js'
    ? { contentType: 'text/javascript', body: bundle }
    : { contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/__connection-exit.js"></script></body></html>' }))
  try {
    const query = new URLSearchParams()
    if (options.actualGate) query.set('actual-gate', 'true')
    if (options.basename) query.set('basename', options.basename)
    if (options.legacyHomeHref) query.set('legacy-home', options.legacyHomeHref)
    if (options.dashboardPath) query.set('dashboard-path', options.dashboardPath)
    await page.goto(origin + (options.basename || '') + '/legacy' + (query.size ? '?' + query : ''))
    await page.getByRole('link', { name: '신축 업무실', exact: true }).click()
    await page.getByRole('article', { name: '원본 업무', exact: true }).waitFor()
    await run(page, context)
    assert.deepEqual(errors, []); passed++; console.log('  ✓ ' + name)
  } catch (error) {
    failures++; console.error('  ✗ ' + name + ': ' + error.stack)
    const visible = page.locator('.workhub-connected')
    console.error((await (await visible.count() ? visible : page.locator('body')).innerText()).slice(-2500))
  } finally { await context.close() }
}
const legacyLink = page => page.getByRole('link', { name: '기존 메뉴', exact: true })
const failureHeading = page => page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다', exact: true })
const retry = page => page.getByRole('button', { name: '학교 연결 다시 확인', exact: true })
const discard = page => page.getByRole('button', { name: '임시 입력 버리기', exact: true })
const confirmDiscard = page => page.getByRole('button', { name: '입력 버리고 메뉴 이용', exact: true })
const taskTitle = page => page.getByLabel('해야 할 일', { exact: true })
const menu = (page, name) => page.getByRole('navigation', { name: '신축 업무 메뉴' }).getByRole('button', { name, exact: true })
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function screenshot(page, name) {
  if (!process.env.WORKHUB_QA_OUTPUT) return
  await mkdir(process.env.WORKHUB_QA_OUTPUT, { recursive: true })
  await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, name), fullPage: true })
}
async function draftTask(page, title = '연결 오류에도 보관할 입력') {
  await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
  await taskTitle(page).fill(title)
  await page.getByLabel('나만 보는 메모', { exact: true }).fill('두 번째 줄까지 보관할 합성 메모')
}
async function fail(page) {
  await page.evaluate(() => { qa.fail(true); window.dispatchEvent(new Event('focus')) })
  await failureHeading(page).waitFor()
  assert.equal(await taskTitle(page).isVisible(), false)
}
async function reconnect(page) {
  await page.evaluate(() => qa.fail(false)); await retry(page).click()
  await page.getByRole('heading', { name: '내 업무', level: 1, exact: true }).waitFor(); await settle(page)
}
async function blockedAnnouncement(page) {
  const status = page.locator('[aria-live]').filter({ hasText: '이동을 막았습니다' })
  await status.first().waitFor()
  assert.match(await status.first().getAttribute('aria-live'), /polite|assertive/)
}
async function blockedLink(page) {
  const before = page.url(); await legacyLink(page).click(); await settle(page)
  assert.equal(page.url(), before)
  await blockedAnnouncement(page)
  assert.equal(await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).count(), 0)
}
async function blockedBack(page) {
  const before = page.url(); await page.goBack(); await page.waitForURL(before); await blockedAnnouncement(page)
  assert.equal(await page.getByTestId('router-location').textContent(), new URL(before).pathname + new URL(before).search)
}
async function pendingTaskStatus(page) {
  await page.evaluate(() => qa.lose('task'))
  await page.getByRole('article', { name: '원본 업무', exact: true }).getByRole('button', { name: '완료', exact: true }).click()
  await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).waitFor()
  assert.equal(await taskTitle(page).count(), 0)
}

try {
  await test('초안 오류 화면에서 바깥 SPA 링크·뒤로가기를 차단하고 보이는 live 안내를 제공한다', async page => {
    await draftTask(page); await fail(page)
    await blockedLink(page); await blockedBack(page)
    await screenshot(page, 'draft-error-390.png')
    await discard(page).click(); await confirmDiscard(page).waitFor()
    await settle(page)
    assert.equal(await page.getByRole('button', { name: '계속 보관', exact: true }).evaluate(element => element.getRootNode().activeElement === element), true)
    await screenshot(page, 'draft-discard-confirm-390.png')
    await page.getByRole('button', { name: '계속 보관', exact: true }).click()
    await settle(page)
    assert.equal(await confirmDiscard(page).count(), 0)
    assert.equal(await discard(page).evaluate(element => element.getRootNode().activeElement === element), true)
    await blockedLink(page); await reconnect(page)
    assert.equal(await taskTitle(page).inputValue(), '연결 오류에도 보관할 입력')
    assert.equal(await page.getByLabel('나만 보는 메모', { exact: true }).inputValue(), '두 번째 줄까지 보관할 합성 메모')
    assert.deepEqual(await page.evaluate(() => qa.writes), [])
  }, { width: 390, height: 844 })

  await test('초안 폐기를 확인하면 자동 이동하지 않고 잠금만 풀며 재접속에서 지난 입력이 부활하지 않는다', async page => {
    await draftTask(page, '명시적으로 버릴 입력'); await fail(page)
    const before = page.url()
    await discard(page).click(); await confirmDiscard(page).click(); await settle(page)
    assert.equal(page.url(), before); await failureHeading(page).waitFor()
    await page.getByRole('status').filter({ hasText: '임시 입력을 버렸습니다. 이제 기존 업무 메뉴로 이동할 수 있습니다.' }).waitFor()
    assert.equal(await page.getByText('상단의', { exact: false }).count(), 0)
    assert.equal(await discard(page).count(), 0)
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }), false)
    await legacyLink(page).click(); await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
    await page.evaluate(() => qa.fail(false))
    await page.getByRole('link', { name: '신축 업무실', exact: true }).click()
    await page.getByRole('article', { name: '원본 업무', exact: true }).waitFor()
    await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
    assert.equal(await taskTitle(page).inputValue(), '')
    assert.deepEqual(await page.evaluate(() => qa.writes), [])
  })

  await test('초안을 보관한 연결 재시도 로딩에서도 링크·POP 안내와 취소 후 복구를 유지한다', async page => {
    await draftTask(page, '로딩 중에도 지킬 입력'); await fail(page)
    await page.evaluate(() => { qa.fail(false); qa.hold() }); await retry(page).click()
    await page.getByRole('heading', { name: '학교 연결 확인 중', exact: true }).waitFor()
    await blockedLink(page); await blockedBack(page)
    await discard(page).click(); await page.getByRole('button', { name: '계속 보관', exact: true }).click()
    await page.evaluate(() => qa.release()); await taskTitle(page).waitFor()
    assert.equal(await taskTitle(page).inputValue(), '로딩 중에도 지킬 입력')
    assert.deepEqual(await page.evaluate(() => qa.writes), [])
  })

  await test('미확정 요청만 남은 오류·로딩도 잠그고 새 탭을 허용하며 같은 키로 한 번만 저장한다', async (page, context) => {
    await pendingTaskStatus(page); await fail(page)
    await blockedLink(page); await blockedBack(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await screenshot(page, 'pending-error-390.png')
    assert.equal(await discard(page).count(), 0); assert.equal(await confirmDiscard(page).count(), 0)
    const newTabLink = page.getByRole('link', { name: '기존 메뉴를 새 탭에서 이용', exact: true })
    assert.equal(await newTabLink.getAttribute('target'), '_blank')
    assert.equal(await newTabLink.getAttribute('rel'), 'noopener noreferrer')
    assert.equal(await newTabLink.getAttribute('href'), '/legacy')
    const before = page.url(), popupPromise = context.waitForEvent('page')
    await newTabLink.click(); const popup = await popupPromise
    await popup.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
    assert.equal(popup.url(), origin + '/legacy')
    assert.equal(await popup.evaluate(() => window.opener), null)
    assert.equal(page.url(), before); await failureHeading(page).waitFor(); await popup.close()
    await page.evaluate(() => { qa.fail(false); qa.hold() }); await retry(page).click()
    await page.getByRole('heading', { name: '학교 연결 확인 중', exact: true }).waitFor()
    await blockedLink(page); assert.equal(await discard(page).count(), 0)
    await page.evaluate(() => qa.release())
    const resume = page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true })
    await resume.waitFor(); await resume.click(); await resume.waitFor({ state: 'detached' })
    const writes = await page.evaluate(() => qa.writes)
    assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1])
    const saved = await page.evaluate(() => qa.rows('task').find(row => row.id === qa.originalTaskId))
    assert.equal(saved.status, 'done'); assert.equal(saved.version, 2)
    await legacyLink(page).click(); await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
  }, undefined, { legacyHomeHref: '/legacy' })

  await test('일정 미확정 요청과 업무 초안이 함께 있으면 폐기하지 않고 둘을 각각 복구한다', async page => {
    await clickWorkspaceMenu(page,'학교 일정')
    await page.getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.locator('input[name=title]').fill('한 번만 등록할 보관 일정')
    await page.evaluate(() => qa.lose('calendar'))
    await page.getByRole('dialog', { name: '일정 등록', exact: true }).getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.getByRole('button', { name: '입력창 접고 목록 보기', exact: true }).click()
    await clickWorkspaceMenu(page,'내 업무'); await draftTask(page, '미확정 일정과 별개의 업무 초안')
    await fail(page); await blockedLink(page)
    assert.equal(await discard(page).count(), 0)
    await reconnect(page)
    assert.equal(await taskTitle(page).inputValue(), '미확정 일정과 별개의 업무 초안')
    await page.getByRole('button', { name: '편집 취소', exact: true }).click()
    await clickWorkspaceMenu(page,'학교 일정')
    await page.getByRole('button', { name: '보관한 일정 확인', exact: true }).click()
    assert.equal(await page.locator('input[name=title]').inputValue(), '한 번만 등록할 보관 일정')
    const resume = page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true })
    await resume.click(); await resume.waitFor({ state: 'detached' })
    const writes = await page.evaluate(() => qa.writes)
    assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1])
    assert.equal(await page.evaluate(() => qa.rows('calendar').filter(row => row.title === '한 번만 등록할 보관 일정').length), 1)
    await legacyLink(page).click(); await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
  })

  for (const navigation of ['link', 'back']) {
    await test('보관한 입력·요청이 없는 오류 화면에서는 ' + navigation + ' 이동을 막지 않는다', async page => {
      await fail(page)
      assert.equal(await discard(page).count(), 0)
      if (navigation === 'link') await legacyLink(page).click()
      else await page.goBack()
      await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/legacy')
    })
  }

  await test('확정된 이용 권한 회수는 초안을 폐기하고 기존 메뉴 이동을 허용한다', async page => {
    await draftTask(page, '권한 회수 후 폐기할 내용')
    await page.evaluate(() => { qa.role('teacher'); window.dispatchEvent(new Event('focus')) })
    await failureHeading(page).waitFor()
    assert.equal(await discard(page).count(), 0)
    await legacyLink(page).click(); await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => qa.writes), [])
  })

  await test('320px 화면에서도 키보드로 차단 안내·폐기 취소·확정 후 메뉴 이용이 가능하다', async page => {
    await draftTask(page); await fail(page)
    await legacyLink(page).focus(); await page.keyboard.press('Enter'); await blockedAnnouncement(page)
    await discard(page).focus(); await page.keyboard.press('Enter'); await confirmDiscard(page).waitFor()
    await page.getByRole('button', { name: '계속 보관', exact: true }).focus(); await page.keyboard.press('Enter')
    await discard(page).focus(); await page.keyboard.press('Enter')
    await confirmDiscard(page).focus(); await page.keyboard.press('Enter'); await settle(page)
    const width = await page.locator('.connected-empty').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
    assert.ok(width.scroll <= width.width + 1, JSON.stringify(width))
    await legacyLink(page).focus(); await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
  }, { width: 320, height: 800 })
  for (const { basename, dashboardPath, expectedHref } of [
    { basename: '', expectedHref: '/' },
    { basename: '/school', expectedHref: '/school' },
    { basename: '/school', dashboardPath: '/legacy-home', expectedHref: '/school/legacy-home' },
  ]) {
    await test('실제 WorkhubPage가 메뉴 표와 Router 기준 경로를 새 탭 주소까지 전달한다: ' + expectedHref, async (page, context) => {
      await draftTask(page, '실제 진입점에서 보관할 입력'); await fail(page); await blockedLink(page)
      const link = page.getByRole('link', { name: '기존 메뉴를 새 탭에서 이용', exact: true })
      assert.equal(await link.getAttribute('href'), expectedHref)
      assert.equal(await link.getAttribute('target'), '_blank')
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer')
      const before = page.url(), popupPromise = context.waitForEvent('page')
      await link.click(); const popup = await popupPromise
      await popup.getByRole('heading', { name: '기존 학교 메뉴', exact: true }).waitFor()
      assert.equal(popup.url(), origin + expectedHref)
      assert.equal(await popup.evaluate(() => window.opener), null)
      assert.equal(page.url(), before); await failureHeading(page).waitFor(); await popup.close()
      await reconnect(page)
      assert.equal(await taskTitle(page).inputValue(), '실제 진입점에서 보관할 입력')
      assert.deepEqual(await page.evaluate(() => qa.writes), [])
    }, undefined, { actualGate: true, basename, dashboardPath })
  }
} finally { await browser.close() }
console.log('\n연결 오류 이탈 브라우저 ' + passed + '개 통과, ' + failures + '개 실패')
if (failures) process.exitCode = 1
