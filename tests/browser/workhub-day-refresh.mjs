import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({
  stdin: { contents: String.raw`
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { ConnectedWorkspace } from './apps/workhub/src/app/ConnectedWorkspace';
    import { createSupabaseConnection } from './apps/workhub/src/connection/supabase-connection';
    import { createMemoryAdapter } from './apps/workhub/src/preview/memory-adapter';
    import { fixtureData, relationLabels } from './apps/workhub/src/preview/fixtures';
    import { createWorkflowStore } from './apps/workhub/src/workflows/store';
    const clone=value=>structuredClone(value), data=clone(fixtureData);
    for (const day of ['20','21']) data.events.push({...data.events[0],id:'day-'+day,title:day+'일의 새 일정',startDate:'2026-10-'+day,endDate:'2026-10-'+day});
    const calendar=createMemoryAdapter(data,0), tasks=createWorkflowStore({members:data.memberships,date:data.basisDate});
    tasks.createTask('gaon-soyeon',{title:'자정 기한 업무',notes:'합성 기한 확인',dueDate:'2026-10-19'},'seed-day');
    let uid='fixture-soyeon', authCallback=()=>{}, members=clone(data.memberships), serverDate=data.basisDate;
    let holdNext=false, profileFailure=false, contextFailure=false, loseSaveReply=false;
    const releases=[];
    const qa=window.qa={
      calls:0, inFlight:0, maxConcurrent:0, responses:[], saveKeys:[],
      loseNextSaveReply(){loseSaveReply=true},
      setDate(value){serverDate=value}, hold(){holdNext=true}, release(){releases.shift()?.()},
      pending(){return releases.length}, failContext(value){contextFailure=value},
      expire(){members=members.map(member=>member.userId===uid?{...member,validThrough:'2026-10-19'}:member)},
      switchUser(){uid='fixture-minjun';authCallback({user:{id:uid}})},
      failProfile(){profileFailure=true},
      token(){authCallback({user:{id:uid}})},
    };
    const services={
      async getSession(){return {user:{id:uid}}},
      async fetchMyProfile(id){if(profileFailure)throw Error('합성 프로필 조회 실패');return {id,name:'합성 교사',email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}},
      onAuthStateChange(callback){authCallback=callback;return()=>{authCallback=()=>{}}},
      async signInWithGoogle(){},async signOut(){},
      async rpc(name,args){
        if(name==='workhub_context'){
          qa.calls++;qa.inFlight++;qa.maxConcurrent=Math.max(qa.maxConcurrent,qa.inFlight);
          const response={...calendar.info(),basisDate:serverDate,memberships:clone(members),schoolLabels:Object.fromEntries(data.schools.map(school=>[school.id,relationLabels]))};
          const fail=contextFailure,hold=holdNext;holdNext=false;
          try { if(hold)await new Promise(resolve=>releases.push(resolve));qa.responses.push(response.basisDate);return fail?{data:null,error:{message:'QUERY_FAILED'}}:{data:response,error:null} }
          finally {qa.inFlight--}
        }
        try {
          if(name==='workhub_calendar_list')return {data:await calendar.list(args.p_member_id),error:null};
          if(name==='workhub_calendar_get')return {data:await calendar.get(args.p_member_id,args.p_event_id),error:null};
          if(name==='workhub_calendar_save'){
            qa.saveKeys.push(args.p_command.idempotencyKey);
            const saved=await calendar.save(args.p_member_id,args.p_command);
            if(loseSaveReply){loseSaveReply=false;return {data:null,error:{message:'QUERY_FAILED'}}}
            return {data:saved,error:null};
          }
          if(name==='workhub_task_list')return {data:tasks.listTasks(args.p_member_id),error:null};
          if(name==='workhub_task_get')return {data:tasks.listTasks(args.p_member_id).find(task=>task.id===args.p_task_id),error:null};
          if(name==='workhub_task_mutate'){
            const command=args.p_command,id=args.p_member_id,key=args.p_request_key;
            return {data:command.kind==='create'?tasks.createTask(id,command.input,key):command.kind==='update'?tasks.updateTask(id,command.taskId,command.input,command.expectedVersion,key):tasks.setTaskStatus(id,command.taskId,command.status,command.expectedVersion,key),error:null};
          }
        } catch(error){return {data:null,error:{message:error.code||'QUERY_FAILED'}}}
        return {data:null,error:{message:'UNKNOWN'}};
      },
    };
    const connection=createSupabaseConnection(services),root=createRoot(document.getElementById('root'));
    qa.info=()=>connection.info();qa.unmount=()=>root.unmount();
    root.render(<ConnectedWorkspace expectedUserId="fixture-soyeon" connection={connection}/>);
  `, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const browser = await launchBrowser()
let passed = 0, failures = 0
async function test(name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Los_Angeles' })
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  try {
    await page.clock.install({ time: new Date('2026-10-19T14:59:20Z') })
    await page.route('**/day-refresh-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
    await page.goto('http://127.0.0.1:5176/day-refresh-test')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.getByRole('article', { name: '자정 기한 업무', exact: true }).waitFor()
    await run(page)
    assert.deepEqual(errors, [])
    passed++; console.log('  ✓ ' + name)
  } catch (error) {
    failures++; console.error('  ✗ ' + name + ': ' + error.stack)
    console.error((await page.locator('body').innerText()).slice(-1800))
  } finally { await context.close() }
}
async function advanceDay(page, day = '20') {
  await page.evaluate(value => qa.setDate('2026-10-' + value), day)
  await page.clock.setSystemTime(new Date('2026-10-' + (Number(day) - 1) + 'T15:00:10Z'))
  await page.clock.fastForward(60000)
  await page.waitForFunction(value => qa.info().basisDate === '2026-10-' + value, day)
}
const task = page => page.getByRole('article', { name: '자정 기한 업무', exact: true })
try {
  await test('포커스 없는 한국 자정에 서버 기준일·오늘 일정·업무 기한을 갱신한다', async page => {
    await page.getByRole('button', { name: '오늘까지 업무 1개 보기', exact: true }).waitFor()
    assert(!(await task(page).innerText()).includes('기한 지남'))
    const calls = await page.evaluate(() => qa.calls)
    await advanceDay(page)
    await page.getByText('20일의 새 일정', { exact: true }).waitFor()
    await page.getByRole('button', { name: '기한 지남 업무 1개 보기', exact: true }).waitFor()
    assert((await task(page).innerText()).includes('기한 지남'))
    assert.equal(await page.evaluate(() => qa.calls), calls + 1)
    assert.equal(await page.getByText('함께 여는 월요일 · 교직원 협의', { exact: true }).count(), 0)
  })
  await test('날짜 재검증은 일정과 업무의 미저장 입력·작성 날짜를 보존한다', async page => {
    await page.getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.locator('input[name="title"]').fill('자정 전에 쓰던 일정 초안')
    await advanceDay(page)
    assert.equal(await page.locator('input[name="title"]').inputValue(), '자정 전에 쓰던 일정 초안')
    assert.equal(await page.locator('input[name="startDate"]').inputValue(), '2026-10-19')
    await page.getByRole('button', { name: '일정 편집 닫기' }).click()
    await page.getByRole('navigation', { name: '신축 업무 메뉴' }).getByRole('button', { name: '내 업무', exact: true }).click()
    await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
    await page.getByLabel('해야 할 일', { exact: true }).fill('자정 전에 쓰던 업무 초안')
    await advanceDay(page, '21')
    assert.equal(await page.getByLabel('해야 할 일', { exact: true }).inputValue(), '자정 전에 쓰던 업무 초안')
    assert.equal(await page.getByLabel('사용할 학교').isDisabled(), true)
  })
  await test('숨김 탭은 자정 조회를 미루고 보이는 순간 서버 날짜를 재검증한다', async page => {
    const calls = await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      qa.setDate('2026-10-20')
      return qa.calls
    })
    await page.clock.setSystemTime(new Date('2026-10-19T15:00:10Z'))
    await page.clock.fastForward(120000)
    assert.equal(await page.evaluate(() => qa.calls), calls)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pageshow'))
    })
    await page.getByText('20일의 새 일정', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => qa.calls), calls + 1)
  })
  await test('응답이 끊긴 저장은 자정 이후에도 같은 요청 번호로 복구한다', async page => {
    await page.getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.locator('input[name="title"]').fill('응답만 잃은 자정 전 일정')
    await page.evaluate(() => qa.loseNextSaveReply())
    await page.getByRole('dialog').getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).waitFor()
    const key = await page.evaluate(() => qa.saveKeys[0])
    await advanceDay(page)
    assert.equal(await page.locator('input[name="title"]').inputValue(), '응답만 잃은 자정 전 일정')
    await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => qa.saveKeys), [key, key])
  })
  await test('기기 날짜가 서버와 달라도 표시 날짜를 덮어쓰거나 반복 조회하지 않는다', async page => {
    await page.evaluate(() => qa.setDate('2026-10-20'))
    await page.clock.setSystemTime(new Date('2026-10-24T03:00:00Z'))
    await page.clock.fastForward(60000)
    await page.waitForFunction(() => qa.info().basisDate === '2026-10-20')
    await page.getByText('20일의 새 일정', { exact: true }).waitFor()
    const calls = await page.evaluate(() => qa.calls)
    await page.clock.fastForward(300000)
    assert.equal(await page.evaluate(() => qa.calls), calls)
    assert.equal(await page.evaluate(() => qa.info().basisDate), '2026-10-20')
  })
  await test('기기 시계가 빠르면 이전 서버 날짜를 유지하고 한정 재확인으로 새 날짜를 받는다', async page => {
    const calls = await page.evaluate(() => qa.calls)
    await page.clock.setSystemTime(new Date('2026-10-19T15:00:10Z'))
    await page.clock.fastForward(60000)
    await page.waitForFunction(value => qa.calls === value + 1 && qa.inFlight === 0, calls)
    assert.equal(await page.evaluate(() => qa.info().basisDate), '2026-10-19')
    assert(!(await task(page).innerText()).includes('기한 지남'))
    await page.evaluate(() => qa.setDate('2026-10-20'))
    await page.clock.fastForward(60000)
    await page.getByText('20일의 새 일정', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => qa.info().basisDate), '2026-10-20')
    const completedCalls = await page.evaluate(() => qa.calls)
    await page.clock.fastForward(1200000)
    assert.equal(await page.evaluate(() => qa.calls), completedCalls)
  })
  await test('서버 날짜가 계속 같으면 추가 확인은 세 번으로 끝난다', async page => {
    const calls = await page.evaluate(() => qa.calls)
    await page.clock.setSystemTime(new Date('2026-10-24T03:00:00Z'))
    await page.clock.runFor(1200000)
    await page.waitForFunction(value => qa.calls === value + 4 && qa.inFlight === 0, calls)
    assert.equal(await page.evaluate(() => qa.info().basisDate), '2026-10-19')
    await page.clock.runFor(1200000)
    assert.equal(await page.evaluate(() => qa.calls), calls + 4)
  })
  await test('느린 context 중 날짜·여러 focus·동일 계정 갱신은 순차 후속 1건으로 반영한다', async page => {
    const calls = await page.evaluate(() => { qa.hold(); window.dispatchEvent(new Event('focus')); return qa.calls })
    await page.waitForFunction(() => qa.pending() === 1)
    const blockedCalls = await page.evaluate(() => qa.calls)
    await page.evaluate(() => { qa.setDate('2026-10-21'); for (let index = 0; index < 6; index++) window.dispatchEvent(new Event('focus')); qa.token() })
    await page.clock.setSystemTime(new Date('2026-10-20T15:00:10Z'))
    await page.clock.fastForward(60000)
    assert.equal(await page.evaluate(() => qa.calls), blockedCalls)
    await page.evaluate(() => qa.release())
    await page.waitForFunction(() => qa.info().basisDate === '2026-10-21' && qa.inFlight === 0)
    await page.getByText('21일의 새 일정', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => qa.maxConcurrent), 1)
    assert.equal(await page.evaluate(() => qa.calls), blockedCalls + 1)
    assert(blockedCalls > calls)
  })
  await test('계정 변경은 즉시 초안을 폐기하고 늦은 context 완료가 복원하지 않는다', async page => {
    await page.getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.locator('input[name="title"]').fill('다른 계정에 보이면 안 되는 초안')
    await page.evaluate(() => { qa.hold(); window.dispatchEvent(new Event('focus')) })
    await page.waitForFunction(() => qa.pending() === 1)
    await page.evaluate(() => qa.switchUser())
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다' }).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.evaluate(() => qa.release())
    await page.clock.fastForward(1000)
    await page.waitForFunction(() => qa.inFlight === 0)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.getByRole('article', { name: '자정 기한 업무', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => qa.info().memberships.length), 0)
  })
  await test('새 기준일에 내 모든 소속이 만료되면 이전 화면을 제거한다', async page => {
    await page.evaluate(() => qa.expire())
    await advanceDay(page)
    await page.getByRole('heading', { name: '연결된 학교 소속이 없습니다' }).waitFor()
    assert.equal(await page.getByRole('article', { name: '자정 기한 업무', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '일정 등록', exact: true }).count(), 0)
  })
  await test('자정 조회 실패는 오류를 표시하며 같은 날 자동 재시도 폭주를 만들지 않는다', async page => {
    await page.evaluate(() => { qa.failContext(true); qa.setDate('2026-10-20') })
    await page.clock.setSystemTime(new Date('2026-10-19T15:00:10Z'))
    await page.clock.fastForward(60000)
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다' }).waitFor()
    const calls = await page.evaluate(() => qa.calls)
    await page.clock.fastForward(300000)
    assert.equal(await page.evaluate(() => qa.calls), calls)
    await page.evaluate(() => qa.failContext(false))
    await page.getByRole('button', { name: '학교 연결 다시 확인', exact: true }).click()
    await page.getByText('20일의 새 일정', { exact: true }).waitFor()
  })
  await test('해제 후 타이머·focus·페이지 복귀는 context를 다시 요청하지 않는다', async page => {
    const calls = await page.evaluate(() => { qa.unmount(); return qa.calls })
    await page.clock.setSystemTime(new Date('2026-10-19T15:00:10Z'))
    await page.clock.fastForward(60000)
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')) })
    await page.clock.fastForward(1000)
    assert.equal(await page.evaluate(() => qa.calls), calls)
    assert.equal(await page.locator('#root').innerHTML(), '')
  })
} finally { await browser.close() }
console.log('\n실제 연결 기준일 갱신 ' + passed + '개 통과, ' + failures + '개 실패')
if (failures) process.exitCode = 1

