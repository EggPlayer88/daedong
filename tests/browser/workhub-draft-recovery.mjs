// 실제 연결 화면에서 미저장 초안과 서버에 보낸 명령의 복구를 구분한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({
  stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ConnectedWorkspace} from './apps/workhub/src/app/ConnectedWorkspace';
    import {createSupabaseConnection} from './apps/workhub/src/connection/supabase-connection';
    import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
    import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
    import {createWorkflowStore} from './apps/workhub/src/workflows/store';
    const clone=value=>structuredClone(value),calendar=createMemoryAdapter(fixtureData,0);
    const tasks=createWorkflowStore({members:fixtureData.memberships,date:fixtureData.basisDate});
    const existing=tasks.createTask('gaon-soyeon',{title:'원본 업무',notes:'원본 메모',dueDate:'2026-10-19'},'seed-task');
    let uid='fixture-soyeon',role='superadmin',members=clone(fixtureData.memberships),callback=()=>{},profileFailure=false,contextFailure=false,loseReply='';
    const originalFailure={calendar:'',task:''};
    const qa=window.qa={
      blockOriginal(kind,value){originalFailure[kind]=value},
      contexts:0,writes:[],existingTaskId:existing.id,
      renamePeer(){members=members.map(member=>member.id==='gaon-minjun'?{...member,name:'변경된 동료 이름'}:member)},
      reverseRoster(){members.reverse()},
      failProfile(value){profileFailure=value},failContext(value){contextFailure=value},
      memberRole(value){members=members.map(member=>member.id==='gaon-soyeon'?{...member,role:value}:member)},
      memberActive(value){members=members.map(member=>member.id==='gaon-soyeon'?{...member,active:value}:member)},
      profileRole(value){role=value},
      user(value){uid=value;callback({user:{id:uid}})},
      lose(kind){loseReply=kind},
      advanceSource(kind){
        if(kind==='calendar')calendar.simulateConcurrentEdit('gaon-soyeon','fixture-event-my');
        else{const row=tasks.listTasks('gaon-soyeon').find(task=>task.id===existing.id);tasks.updateTask('gaon-soyeon',row.id,{title:row.title,notes:'다른 창에서 바뀐 메모',dueDate:row.dueDate},row.version,'other-editor')}
      },
      rows(kind){return kind==='task'?tasks.listTasks('gaon-soyeon'):calendar.exportState().data.events},
    };
    const services={
      async getSession(){return {user:{id:uid}}},
      async fetchMyProfile(id){if(profileFailure)throw Error('합성 일시 프로필 조회 실패');return {id,name:'합성 교사',email:'test@example.invalid',role,extra_permissions:[],department_id:null,is_active:true}},
      onAuthStateChange(next){callback=next;return()=>{callback=()=>{}}},
      async signInWithGoogle(){},async signOut(){},
      async rpc(name,args){
        if(name==='workhub_context'){
          qa.contexts++;
          return contextFailure?{data:null,error:{message:'QUERY_FAILED'}}:{error:null,data:{...calendar.info(),memberships:clone(members),schoolLabels:Object.fromEntries(fixtureData.schools.map(school=>[school.id,relationLabels]))}};
        }
        try{
          const originalKind=name==='workhub_calendar_get'?'calendar':name==='workhub_task_get'?'task':undefined;
          if(originalKind&&originalFailure[originalKind])return {data:null,error:{message:originalFailure[originalKind]}};
          if(name==='workhub_calendar_list')return {data:await calendar.list(args.p_member_id),error:null};
          if(name==='workhub_calendar_get')return {data:await calendar.get(args.p_member_id,args.p_event_id),error:null};
          if(name==='workhub_task_list')return {data:tasks.listTasks(args.p_member_id),error:null};
          if(name==='workhub_task_get')return {data:tasks.listTasks(args.p_member_id).find(row=>row.id===args.p_task_id),error:null};
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
        }catch(error){
          const code=error.code==='VERSION_CONFLICT'?'CONFLICT':error.code||'QUERY_FAILED';
          const current=error.current||(code==='CONFLICT'&&name==='workhub_task_mutate'?tasks.listTasks(args.p_member_id).find(row=>row.id===args.p_command.taskId):undefined);
          return {data:null,error:{message:code,...(current?{details:JSON.stringify(current)}:{})}};
        }
      },
    };
    const connection=createSupabaseConnection(services);
    qa.info=()=>connection.info();
    createRoot(document.getElementById('root')).render(<ConnectedWorkspace legacyHomeHref="/" expectedUserId="fixture-soyeon" connection={connection}/>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
}).outputFiles[0].text

const browser = await launchBrowser()
let passed = 0, failures = 0
async function test(name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  try {
    await page.route('**/draft-recovery-test*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
    await page.goto('http://127.0.0.1:5176/draft-recovery-test')
    await page.addScriptTag({ content: bundle })
    await page.getByRole('article', { name: '원본 업무', exact: true }).waitFor()
    await run(page)
    assert.deepEqual(errors, [])
    passed++; console.log('  ✓ ' + name)
  } catch (error) {
    failures++; console.error('  ✗ ' + name + ': ' + error.stack)
    console.error((await page.locator('.workhub-connected').innerText()).slice(-2200))
  } finally { await context.close() }
}
const titleInput = (page, kind) => kind === 'calendar' ? page.locator('input[name="title"]') : page.getByLabel('해야 할 일', { exact: true })
const menu = (page, name) => page.getByRole('navigation', { name: '신축 업무 메뉴' }).getByRole('button', { name, exact: true })
const flush = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function showPage(page, kind) {
  const name = kind === 'calendar' ? '학교 일정' : '내 업무'
  if (await titleInput(page, kind).isVisible()) return
  await menu(page, name).click()
  await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor()
}
async function newDraft(page, kind, title) {
  await showPage(page, kind)
  await page.getByRole('button', { name: kind === 'calendar' ? '일정 등록' : '할 일 등록', exact: true }).click()
  if (title !== undefined) await titleInput(page, kind).fill(title)
}
async function openOriginal(page, kind) {
  await showPage(page, kind)
  if (kind === 'task') await page.getByRole('article', { name: '원본 업무', exact: true }).getByRole('button', { name: '수정', exact: true }).click()
  else {
    await page.getByRole('button', { name: '수업 자료 정리 · 원본 v1 보기', exact: true }).click()
    await page.getByRole('button', { name: '일정 수정', exact: true }).click()
  }
}
async function focus(page) {
  const count = await page.evaluate(() => qa.contexts)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(count => qa.contexts > count, count)
  await flush(page)
}
async function transientFailure(page, kind, stage) {
  await page.evaluate(stage => { if (stage === 'profile') qa.failProfile(true); else qa.failContext(true); window.dispatchEvent(new Event('focus')) }, stage)
  await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다', exact: true }).waitFor()
  assert.equal(await titleInput(page, kind).isVisible(), false)
  assert.equal(await page.getByRole('article').count(), 0)
  await page.evaluate(() => { qa.failProfile(false); qa.failContext(false) })
  await page.getByRole('button', { name: '학교 연결 다시 확인', exact: true }).click()
  await page.getByLabel('사용할 학교').waitFor()
  await flush(page)
}
async function verifyDraft(page, kind, expected) {
  await titleInput(page, kind).waitFor()
  assert.equal(await titleInput(page, kind).inputValue(), expected)
  assert.equal(await page.getByLabel('사용할 학교').isDisabled(), true)
  assert.equal(await menu(page, '오늘').isDisabled(), true)
}
async function save(page, kind, editing = false) {
  const name = editing ? '수정 저장' : kind === 'calendar' ? '일정 등록' : '내 업무에 추가'
  const container = kind === 'calendar' ? page.getByRole('dialog') : page.getByRole('form', { name: editing ? '내 업무 수정' : '내 업무 등록', exact: true })
  await container.getByRole('button', { name, exact: true }).click()
}
async function cancel(page, kind) {
  await page.getByRole('button', { name: kind === 'calendar' ? '일정 편집 닫기' : '편집 취소', exact: true }).click()
}
async function assertNoDraft(page, kind) {
  await showPage(page, kind)
  assert.equal(await titleInput(page, kind).isVisible(), false)
  assert.equal(await page.getByRole('button', { name: kind === 'calendar' ? '보관한 일정 확인' : '이전 요청 그대로 다시 확인', exact: true }).count(), 0)
  await newDraft(page, kind)
  assert.equal(await titleInput(page, kind).inputValue(), '')
}
async function restorePending(page, kind) {
  if (kind === 'calendar') {
    const resume = page.getByRole('button', { name: '보관한 일정 확인', exact: true })
    if (await resume.count()) await resume.click()
  } else {
    if (!await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).count()) await showPage(page, kind)
    const unfold = page.getByRole('button', { name: '보관한 입력 보기', exact: true })
    if (await unfold.count()) await unfold.click()
  }
  await titleInput(page, kind).waitFor()
}
try {
  for (const kind of ['calendar', 'task']) {
    await test(kind + ' 초안은 동료 이름·명부 순서·일시 신원/문맥 조회 실패를 거쳐도 보존한다', async page => {
      const text = '서버에 아직 보내지 않은 ' + kind + ' 초안'
      await newDraft(page, kind, text)
      const memo = '둘째 줄도 남아야 하는 합성 메모\n두 번째 줄'
      if (kind === 'calendar') {
        await page.getByLabel('안내 내용').fill(memo)
        await page.getByLabel('장소', { exact: true }).fill('합성 교실')
        await page.locator('input[name="startDate"]').fill('2026-10-20')
        await page.locator('input[name="endDate"]').fill('2026-10-21')
        await page.getByLabel('누가 원본을 볼 수 있나요?').selectOption('private')
      } else {
        await page.getByLabel('나만 보는 메모', { exact: true }).fill(memo)
        await page.getByLabel('기한 (선택)', { exact: true }).fill('2026-10-21')
      }
      const verifyDetails = async () => {
        assert.equal(await page.getByLabel(kind === 'calendar' ? '안내 내용' : '나만 보는 메모', { exact: kind !== 'calendar' }).inputValue(), memo)
        if (kind === 'calendar') {
          assert.equal(await page.getByLabel('장소', { exact: true }).inputValue(), '합성 교실')
          assert.equal(await page.locator('input[name="startDate"]').inputValue(), '2026-10-20')
          assert.equal(await page.locator('input[name="endDate"]').inputValue(), '2026-10-21')
          assert.equal(await page.getByLabel('누가 원본을 볼 수 있나요?').inputValue(), 'private')
        } else assert.equal(await page.getByLabel('기한 (선택)', { exact: true }).inputValue(), '2026-10-21')
      }
      for (const mutation of ['renamePeer', 'reverseRoster']) {
        await page.evaluate(mutation => qa[mutation](), mutation)
        await focus(page); await verifyDraft(page, kind, text); await verifyDetails()
      }
      for (const stage of ['profile', 'context']) { await transientFailure(page, kind, stage); await verifyDraft(page, kind, text); await verifyDetails() }
      assert.deepEqual(await page.evaluate(() => qa.writes), [])
      assert.equal(await page.evaluate(text => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(text)), text), false)
    })

    for (const change of ['membership-role', 'membership-ended', 'profile-role', 'account']) {
      await test(kind + ' 초안은 ' + change + ' 변경 후 권한이 복구되어도 되살아나지 않는다', async page => {
        await newDraft(page, kind, '폐기되어야 하는 비공개 초안')
        await page.evaluate(change => {
          if (change === 'membership-role') qa.memberRole('calendar_manager')
          if (change === 'membership-ended') qa.memberActive(false)
          if (change === 'profile-role') qa.profileRole('teacher')
          if (change === 'account') qa.user('fixture-minjun')
          else window.dispatchEvent(new Event('focus'))
        }, change)
        if (change === 'profile-role' || change === 'account') {
          await page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다', exact: true }).waitFor()
          assert.equal(await titleInput(page, kind).isVisible(), false)
          assert.equal(await page.getByRole('article').count(), 0)
        } else {
          await page.waitForFunction(change => {
            const current = qa.info().memberships.find(member => member.id === 'gaon-soyeon')
            return change === 'membership-role' ? current?.role === 'calendar_manager' : current?.active === false
          }, change)
          await flush(page)
          assert.equal(await titleInput(page, kind).isVisible(), false)
        }
        await page.evaluate(change => {
          if (change === 'membership-role') qa.memberRole('teacher')
          if (change === 'membership-ended') qa.memberActive(true)
          if (change === 'profile-role') qa.profileRole('superadmin')
          if (change === 'account') qa.user('fixture-soyeon')
          else window.dispatchEvent(new Event('focus'))
        }, change)
        if (change === 'profile-role') {
          await flush(page)
          const retry = page.getByRole('button', { name: '학교 연결 다시 확인', exact: true })
          if (await retry.count()) await retry.click()
        }
        await page.getByLabel('사용할 학교').waitFor()
        await flush(page)
        if (await page.getByLabel('사용할 학교').inputValue() !== 'gaon-soyeon') await page.getByLabel('사용할 학교').selectOption('gaon-soyeon')
        await assertNoDraft(page, kind)
      })
    }

    for (const finish of ['cancel', 'save']) {
      await test(kind + ' 편집 ' + finish + ' 뒤 동료 변경·재연결에서 지난 초안이 부활하지 않는다', async page => {
        const text = '완료 처리할 ' + kind + ' 초안'
        await newDraft(page, kind, text)
        if (finish === 'cancel') await cancel(page, kind)
        else { await save(page, kind); await titleInput(page, kind).waitFor({ state: 'detached' }) }
        await page.evaluate(() => qa.renamePeer()); await focus(page)
        await transientFailure(page, kind, 'context')
        await assertNoDraft(page, kind)
        const count = await page.evaluate(({ kind, text }) => qa.rows(kind).filter(row => row.title === text).length, { kind, text })
        assert.equal(count, finish === 'save' ? 1 : 0)
      })
    }

    for (const reason of ['roster', 'context']) {
      await test(kind + ' 응답 미확정 요청은 ' + reason + ' 후 같은 키로 복구하며 초안과 중복 저장하지 않는다', async page => {
        const text = '복구할 ' + kind + ' 접수'
        await newDraft(page, kind, text); await page.evaluate(kind => qa.lose(kind), kind); await save(page, kind)
        const retryName = kind === 'calendar' ? '같은 요청으로 저장 결과 확인' : '이전 요청 그대로 다시 확인'
        await page.getByRole('button', { name: retryName, exact: true }).waitFor()
        if (reason === 'roster') { await page.evaluate(() => qa.renamePeer()); await focus(page) }
        else await transientFailure(page, kind, 'context')
        await restorePending(page, kind)
        assert.equal(await titleInput(page, kind).inputValue(), text)
        await page.getByRole('button', { name: retryName, exact: true }).click()
        await page.getByRole('button', { name: retryName, exact: true }).waitFor({ state: 'detached' })
        const writes = await page.evaluate(() => qa.writes)
        assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1])
        assert.equal(await page.evaluate(({ kind, text }) => qa.rows(kind).filter(row => row.title === text).length, { kind, text }), 1)
        await focus(page); await assertNoDraft(page, kind)
      })
    }

    await test(kind + ' 기존 원본 수정 초안은 재연결 후 원본 ID·버전을 유지한다', async page => {
      await openOriginal(page, kind)
      const text = '수정 중이던 ' + kind + ' 원본'
      await titleInput(page, kind).fill(text)
      await transientFailure(page, kind, 'context')
      await verifyDraft(page, kind, text)
      await save(page, kind, true); await titleInput(page, kind).waitFor({ state: 'detached' })
      const command = await page.evaluate(() => qa.writes[0].args.p_command)
      assert.equal(command.expectedVersion, 1)
      if (kind === 'task') {
        assert.equal(command.kind, 'update')
        assert.equal(command.taskId, await page.evaluate(() => qa.existingTaskId))
      } else assert.equal(command.id, 'fixture-event-my')
      assert.equal(await page.evaluate(({ kind, text }) => qa.rows(kind).filter(row => row.title === text).length, { kind, text }), 1)
    })

    await test(kind + ' 보관 원본 조회가 일시 실패하면 입력을 숨기고 재확인 뒤 복원한다', async page => {
      await openOriginal(page, kind)
      const text = '원본 재확인 전에는 보이지 않을 ' + kind + ' 초안'
      await titleInput(page, kind).fill(text)
      await page.evaluate(kind => qa.blockOriginal(kind, 'QUERY_FAILED'), kind)
      await transientFailure(page, kind, 'context')
      const retry = page.getByRole('button', { name: kind === 'calendar' ? '원본 다시 확인' : '보관한 업무 원본 다시 확인', exact: true })
      await retry.waitFor()
      assert.equal(await titleInput(page, kind).isVisible(), false)
      assert.deepEqual(await page.evaluate(() => qa.writes), [])
      await page.evaluate(kind => qa.blockOriginal(kind, ''), kind)
      await retry.click()
      await verifyDraft(page, kind, text)
      assert.deepEqual(await page.evaluate(() => qa.writes), [])
    })

    await test(kind + ' 보관 원본이 없다는 응답은 초안을 폐기하고 재접속 후에도 복원하지 않는다', async page => {
      await openOriginal(page, kind)
      await titleInput(page, kind).fill('접근할 수 없는 원본의 옛 초안')
      await page.evaluate(kind => qa.blockOriginal(kind, 'NOT_FOUND'), kind)
      await transientFailure(page, kind, 'context')
      await page.getByRole('alert').filter({ hasText: '보관한 입력을 폐기했습니다' }).waitFor()
      assert.equal(await titleInput(page, kind).isVisible(), false)
      await page.evaluate(kind => qa.blockOriginal(kind, ''), kind)
      if (kind === 'calendar') await page.getByRole('button', { name: '일정 편집 닫기', exact: true }).click()
      else await page.getByRole('button', { name: '연결 다시 확인', exact: true }).click()
      await transientFailure(page, kind, 'context')
      await openOriginal(page, kind)
      assert.equal(await titleInput(page, kind).inputValue(), kind === 'calendar' ? '수업 자료 정리' : '원본 업무')
      assert.deepEqual(await page.evaluate(() => qa.writes), [])
    })

    await test(kind + ' 원본이 다른 창에서 바뀌어도 복원 초안의 이전 버전으로 충돌을 확인한다', async page => {
      await openOriginal(page, kind)
      const text = '다른 원본과 비교할 ' + kind + ' 초안'
      await titleInput(page, kind).fill(text)
      await page.evaluate(kind => qa.advanceSource(kind), kind)
      await transientFailure(page, kind, 'context')
      await verifyDraft(page, kind, text)
      await save(page, kind, true)
      await page.getByRole('alert').waitFor()
      assert.equal(await titleInput(page, kind).inputValue(), text)
      const command = await page.evaluate(() => qa.writes[0].args.p_command)
      assert.equal(command.expectedVersion, 1)
      assert.equal(await page.evaluate(({ kind, text }) => qa.rows(kind).filter(row => row.title === text).length, { kind, text }), 0)
    })
  }
  for (const finish of ['cancel', 'save']) {
    await test('task 편집 ' + finish + ' 이후 새 상태 변경의 충돌도 재연결에서 보존한다', async page => {
      await newDraft(page, 'task', '앞서 마친 별도 업무')
      if (finish === 'cancel') await cancel(page, 'task')
      else { await save(page, 'task'); await titleInput(page, 'task').waitFor({ state: 'detached' }) }
      const original = page.getByRole('article', { name: '원본 업무', exact: true })
      await original.waitFor()
      await page.evaluate(() => qa.advanceSource('task'))
      await original.getByRole('button', { name: '완료', exact: true }).click()
      const comparison = page.getByRole('region', { name: '업무 변경 내용 비교', exact: true })
      await comparison.waitFor()
      assert.ok((await comparison.innerText()).includes('완료'))
      const commandBefore = await page.evaluate(() => qa.writes.at(-1).args.p_command)
      assert.equal(commandBefore.kind, 'status'); assert.equal(commandBefore.expectedVersion, 1)
      await transientFailure(page, 'task', 'context')
      await comparison.waitFor()
      assert.ok((await comparison.innerText()).includes('완료'))
      assert.ok((await comparison.innerText()).includes('v2'))
      await comparison.getByRole('button', { name: '최신 내용 확인 · 내 변경 다시 적용', exact: true }).click()
      await comparison.waitFor({ state: 'detached' })
      const commandAfter = await page.evaluate(() => qa.writes.at(-1).args.p_command)
      assert.equal(commandAfter.kind, 'status'); assert.equal(commandAfter.expectedVersion, 2)
      assert.equal(commandAfter.taskId, commandBefore.taskId); assert.equal(commandAfter.status, 'done')
      const latest = await page.evaluate(() => qa.rows('task').find(row => row.id === qa.existingTaskId))
      assert.equal(latest.status, 'done'); assert.equal(latest.version, 3)
    })
  }
} finally { await browser.close() }
console.log('\n미저장 초안 복구 브라우저 ' + passed + '개 통과, ' + failures + '개 실패')
if (failures) process.exitCode = 1
