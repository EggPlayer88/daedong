// 실제 연결 UI와 합성 접수 저장소로 응답 유실·재접속·이동 후 멱등 복구를 검사한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'
const bundle = buildSync({ stdin: { contents: `
  import React from 'react';import{createRoot}from'react-dom/client';
  import{ConnectedWorkspace}from'./apps/workhub/src/app/ConnectedWorkspace';
  import{createSupabaseConnection}from'./apps/workhub/src/connection/supabase-connection';
  import{createMemoryAdapter}from'./apps/workhub/src/preview/memory-adapter';
  import{fixtureData,relationLabels}from'./apps/workhub/src/preview/fixtures';
  import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
  let uid='fixture-soyeon',profileFailure=false,callback=()=>{},reject='',lose=false,rename=false;
  const calendar=createMemoryAdapter(fixtureData,0),tasks=createWorkflowStore({members:fixtureData.memberships,date:fixtureData.basisDate});
  for(let i=0;i<45;i++)tasks.createTask('gaon-soyeon',{title:'기존 업무 '+String(i).padStart(2,'0'),notes:'',dueDate:fixtureData.basisDate},'seed-'+i);
  const qa=window.qa={calls:[],contexts:0,rename(){rename=true},failProfile(value){profileFailure=value},lose(){lose=true},reject(value){reject=value},user(value){uid=value;callback({user:{id:uid}})},tasks(){return tasks.listTasks('gaon-soyeon')},events(){return calendar.exportState().data.events}};
  const services={
    async getSession(){return{user:{id:uid}}},
    async fetchMyProfile(id){if(profileFailure)throw new Error('합성 일시 조회실패');return{id,name:'합성 교사',email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}},
    onAuthStateChange(cb){callback=cb;return()=>callback=()=>{}},async signInWithGoogle(){},async signOut(){},
    async rpc(name,args){
      if(name==='workhub_context'){qa.contexts++;const info=calendar.info();if(rename){info.memberships.reverse();info.memberships.find(m=>m.id==='gaon-minjun').name='이름 변경 교사'}return{data:{...info,schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))},error:null}}
      if(name==='workhub_task_list')return{data:tasks.listTasks(args.p_member_id),error:null};
      if(name==='workhub_task_get')return{data:tasks.listTasks(args.p_member_id).find(t=>t.id===args.p_task_id),error:null};
      if(name==='workhub_calendar_list')return{data:await calendar.list(args.p_member_id),error:null};
      if(name==='workhub_calendar_get')return{data:await calendar.get(args.p_member_id,args.p_event_id),error:null};
      qa.calls.push({name,args:structuredClone(args)});
      if(reject)return{data:null,error:{message:reject}};
      let result;
      if(name==='workhub_task_mutate'){const c=args.p_command,k=args.p_request_key,m=args.p_member_id;result=c.kind==='create'?tasks.createTask(m,c.input,k):c.kind==='update'?tasks.updateTask(m,c.taskId,c.input,c.expectedVersion,k):tasks.setTaskStatus(m,c.taskId,c.status,c.expectedVersion,k)}
      else if(name==='workhub_calendar_save')result=await calendar.save(args.p_member_id,args.p_command);
      else return{data:null,error:{message:'UNKNOWN'}};
      if(lose){lose=false;throw new Error('접수 후 응답만 유실')}
      return{data:result,error:null};
    }
  };
  createRoot(document.getElementById('root')).render(<ConnectedWorkspace expectedUserId="fixture-soyeon" connection={createSupabaseConnection(services)}/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const errors = [], results = []
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
const menu = name => page.getByRole('navigation', { name: '신축 업무 메뉴' }).getByRole('button', { name, exact: true })
async function go(name) { await menu(name).click(); await page.getByRole('heading', { name: name === '오늘' ? '오늘' : name, level: 1, exact: true }).waitFor() }
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function boot() {
  await page.goto('http://127.0.0.1:5176/request-recovery-test')
  await page.addScriptTag({ content: bundle })
  await menu('내 업무').waitFor()
}
async function createTask(name) {
  await go('내 업무'); await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
  await page.getByLabel('해야 할 일', { exact: true }).fill(name)
  await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
}
async function reconnect() {
  await page.evaluate(() => qa.failProfile(false))
  await page.getByRole('button', { name: '학교 연결 다시 확인', exact: true }).click()
  await menu('내 업무').waitFor()
}
try {
  await page.route('**/request-recovery-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
  await boot()
  await test('빈 업무 입력창은 이동을 잠그지 않고 실제 입력 후에는 보호한다', async () => {
    await go('내 업무'); await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
    assert(await menu('학교 일정').isEnabled())
    await page.getByLabel('해야 할 일', { exact: true }).fill('작성 중')
    assert(await menu('학교 일정').isDisabled())
    await page.getByRole('button', { name: '편집 취소', exact: true }).click()
  })
  await test('46번째 신규 업무는 성공 안내에서 해당 쪽의 카드로 바로 이동한다', async () => {
    await createTask('추가한 마지막 업무')
    await page.getByRole('button', { name: '저장한 업무 보기', exact: true }).click()
    const card = page.getByRole('article', { name: '추가한 마지막 업무', exact: true })
    await card.waitFor()
    assert(await card.evaluate(node => node.getRootNode().activeElement === node))
    assert((await page.getByRole('navigation', { name: '내 업무 목록 페이지', exact: true }).innerText()).includes('3 / 3쪽'))
  })
  await test('업무 응답 유실 뒤 입력을 접고 다른 화면을 방문해도 원래 요청을 보관한다', async () => {
    await page.evaluate(() => qa.lose()); await createTask('복구할 업무')
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => qa.tasks().filter(t => t.title === '복구할 업무').length), 1)
    await page.getByRole('button', { name: '입력창 접고 목록 보기', exact: true }).click()
    assert(await menu('학교 일정').isEnabled())
    await go('학교 일정'); await go('내 업무')
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).waitFor()
    assert(await page.getByRole('button', { name: '할 일 등록', exact: true }).isDisabled())
  })
  await test('다른 교사의 이름과 명부 순서가 바뀌어도 보관 요청을 잃지 않는다', async () => {
    const count = await page.evaluate(() => qa.contexts)
    await page.evaluate(() => { qa.rename(); window.dispatchEvent(new Event('focus')) })
    await page.waitForFunction(count => qa.contexts > count, count)
    await page.getByRole('button', {name:'이전 요청 그대로 다시 확인',exact:true}).waitFor()
    assert(await page.getByRole('button', {name:'할 일 등록',exact:true}).isDisabled())
  })
  await test('일시 계정 조회 실패에는 자료를 숨기고 재검증 후 같은 저장 요청만 복구한다', async () => {
    await page.evaluate(() => { qa.failProfile(true); window.dispatchEvent(new Event('focus')) })
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다' }).waitFor()
    assert.equal(await page.getByRole('article').count(), 0)
    assert.equal(await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).count(), 0)
    await reconnect(); await go('내 업무')
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).click()
    await page.getByRole('button', { name: '저장한 업무 보기', exact: true }).waitFor()
    const attempts = await page.evaluate(() => qa.calls.filter(c => c.args.p_command?.input?.title === '복구할 업무'))
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1])
    assert.equal(await page.evaluate(() => qa.tasks().filter(t => t.title === '복구할 업무').length), 1)
  })
  await test('일정도 접어 둔 요청을 화면 이동·재접속 후 같은 키로 확인하여 한 번만 등록한다', async () => {
    await go('학교 일정'); await page.getByRole('button', { name: '일정 등록', exact: true }).click()
    assert(await menu('내 업무').isEnabled())
    await page.locator('input[name="title"]').fill('복구할 일정')
    assert(await menu('내 업무').isDisabled())
    await page.evaluate(() => qa.lose())
    await page.getByRole('dialog').getByRole('button', { name: '일정 등록', exact: true }).click()
    await page.getByRole('button', { name: '입력창 접고 목록 보기', exact: true }).click()
    await page.getByRole('button', { name: '보관한 일정 확인', exact: true }).waitFor()
    assert(await page.getByRole('region', {name:'보관한 일정 저장 요청'}).evaluate(node=>node.getRootNode().activeElement===node))
    await page.getByRole('button', {name:'수업 자료 정리 · 원본 v1 보기',exact:true}).click()
    assert(await page.getByRole('button', {name:'일정 수정',exact:true}).isDisabled())
    await page.getByRole('button', {name:'일정 상세 닫기',exact:true}).click()
    await go('내 업무'); await go('학교 일정')
    await page.evaluate(() => { qa.failProfile(true); window.dispatchEvent(new Event('focus')) })
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다' }).waitFor()
    await reconnect(); await go('학교 일정')
    await page.getByRole('button', { name: '보관한 일정 확인', exact: true }).click()
    assert.equal(await page.locator('input[name="title"]').inputValue(), '복구할 일정')
    await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const attempts = await page.evaluate(() => qa.calls.filter(c => c.args.p_command?.draft?.title === '복구할 일정'))
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1])
    assert.equal(await page.evaluate(() => qa.events().filter(t => t.title === '복구할 일정').length), 1)
  })
  await test('요청 번호 충돌도 입력을 접고 읽을 수 있으며 새 키로 자동 재전송하지 않는다', async () => {
    await page.evaluate(() => qa.reject('IDEMPOTENCY_CONFLICT')); await createTask('충돌한 요청')
    await page.getByRole('button', { name: '입력창 접고 목록 보기', exact: true }).click()
    await go('학교 일정'); await go('내 업무')
    assert(await page.getByRole('button', { name: '할 일 등록', exact: true }).isDisabled())
    assert.equal(await page.evaluate(() => qa.calls.filter(c => c.args.p_command?.input?.title === '충돌한 요청').length), 1)
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '이전 요청의 내용을' }).waitFor()
    const calls = await page.evaluate(() => qa.calls.filter(c => c.args.p_command?.input?.title === '충돌한 요청'))
    assert.deepEqual(calls[0], calls[1])
  })
  await test('다른 계정으로 바뀌면 보관한 명령도 폐기하고 원 계정 복귀 시 되살리지 않는다', async () => {
    await page.evaluate(() => { qa.reject(''); qa.user('fixture-minjun') })
    await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다' }).waitFor()
    await page.evaluate(() => qa.user('fixture-soyeon'))
    await menu('내 업무').waitFor(); await go('내 업무')
    await page.locator('.task-loading').waitFor({state:'detached'})
    assert.equal(await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).count(), 0)
    assert(await page.getByRole('button', { name: '할 일 등록', exact: true }).isEnabled())
  })
  assert.deepEqual(errors, [])
  console.log('저장 요청 복구 브라우저 ' + results.length + '개 통과')
} catch (error) { console.error(error); console.error((await page.locator('body').innerText()).slice(-4000)); process.exitCode = 1 }
finally { await browser.close() }
