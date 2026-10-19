// 실제 연결 셸·일정·시간표 어댑터를 합성 RPC와 연결한다. 운영 DB·외부 서비스는 호출하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{ConnectedWorkspace}from'./apps/workhub/src/app/ConnectedWorkspace';
import{ContractError}from'./apps/workhub/src/contracts';
import{createMemoryAdapter}from'./apps/workhub/src/preview/memory-adapter';
import{fixtureData,relationLabels}from'./apps/workhub/src/preview/fixtures';
import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
const copy=v=>structuredClone(v),offset=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),now=()=>new Date().toISOString();
const data=copy(fixtureData);data.basisDate=offset(now().slice(0,10),3);data.memberships.forEach(m=>{m.validFrom='2020-01-01';m.validThrough='2099-12-31'});
const calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate});
const ctx={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels};
const identity={userId:'fixture-soyeon',approved:true,profile:{id:'fixture-soyeon',name:'합성 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}};
let identityChanged=()=>{};
window.state={calls:[],writes:[],basisDate:data.basisDate,selectedDate:offset(data.basisDate,2),holdOperations:false,release:null,revoke:()=>{identity.userId='different-account';identity.profile.id='different-account';identityChanged()}};
const span=(day,hour)=>({startsAt:day+'T'+String(hour).padStart(2,'0')+':00:00.000Z',endsAt:day+'T'+String(hour).padStart(2,'0')+':45:00.000Z'});
const lesson=(member,day)=>({id:member.id+'-'+day,version:1,label:day+' '+(member.id==='gaon-soyeon'?'가온':'누리')+' 원본 수업',time:span(day,0),teachers:[{id:member.id,name:member.name}],groupNames:['1학년 1반'],roomNames:['1반 교실'],state:'scheduled',canRequest:true,allowedTargets:[span(day,0),span(day,1)]});
const connection={getIdentity:async()=>copy(identity),loadContext:async()=>copy(ctx),info:()=>copy(ctx),subscribeIdentity:f=>{identityChanged=f;return()=>{}},subscribeInvalidation:()=>()=>{},checkReadiness:async()=>({stage:'ready',code:'READY',checkedAt:now(),readySchoolCount:2}),rpcVerified:async(name,args)=>{
 window.state.calls.push({name,args:copy(args)});const member=ctx.memberships.find(m=>m.id===args.p_member_id),env=(data,contract='timetable-operations.v1')=>({contract,schoolId:member.schoolId,memberId:member.id,data});
 if(name==='workhub_calendar_list')return calendar.list(args.p_member_id);
 if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id);
 if(name==='workhub_home_overview')return env({asOf:now(),items:[],counts:{collection:0,supplement:0,message:0,student_followup:0,cooperation:0},unavailable:[]},'home.v1');
 if(name==='workhub_timetable_operations_readiness')return env({available:true});
 if(name==='workhub_timetable_operations_get'){
  const lessons=[];for(let date=args.p_from;date<args.p_until;date=offset(date,1))lessons.push(lesson(member,date));
  const response=env({asOf:now(),timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:false,canRequest:true,drafts:[],lessons,requests:[],publications:[]});
  if(window.state.holdOperations&&args.p_until!==offset(args.p_from,1)&&member.id==='gaon-soyeon')await new Promise(resolve=>window.state.release=resolve);
  return response;
 }
 if(name==='workhub_timetable_operations_references')return env({asOf:args.p_source_as_of,from:args.p_from,until:args.p_until,lessons:Array.from({length:(Date.parse(args.p_until)-Date.parse(args.p_from))/86400000},(_,i)=>({lessonId:member.id+'-'+offset(args.p_from,i),version:1,groups:[{id:'class-'+member.id,name:'1학년 1반'}],rooms:[{id:'room-'+member.id,name:'1반 교실'}]}))},'timetable-operations.next.v1');
 if(name==='workhub_timetable_operations_recommend')return env({input:copy(args.p_input),sourceAsOf:args.p_source_as_of,coverage:{from:args.p_input.from,until:args.p_input.until,complete:true},status:'none_found',explanations:['합성 자료의 추천 후보가 없습니다.'],candidates:[]},'timetable-operations.next.v1');
 if(name==='workhub_timetable_operations_exchange_preview'){
  const input=args.p_input,day=input.lessonId.slice(-10),before=lesson(member,day);
  return env({previewId:'preview-selected',previewHash:'a'.repeat(64),createdAt:now(),expiresAt:new Date(Date.now()+600000).toISOString(),input:copy(input),complete:true,changes:[{before,after:{...copy(before),version:2,time:copy(input.target)}}],participants:copy(before.teachers),blockers:[]});
 }
 if(name.endsWith('_execute'))window.state.writes.push({name,args:copy(args)});
 throw new ContractError('QUERY_FAILED');
}};
createRoot(document.getElementById('root')).render(<ConnectedWorkspace expectedUserId='fixture-soyeon' legacyHomeHref='/legacy' connection={connection}/>);
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })

const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), errors = [], external = [], passed = []
page.setDefaultTimeout(15000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5187/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const agenda = () => page.getByRole('region', { name: '내 수업', exact: true })
const detail = () => page.getByRole('region', { name: '선택한 수업', exact: true })
const monday = date => { const value = new Date(date + 'T00:00:00Z'); value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7); return value.toISOString().slice(0, 10) }
async function boot() { await page.goto('http://127.0.0.1:5187/home'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await agenda().getByRole('button', { name: /가온 원본 수업/ }).waitFor() }
async function go(name) { await page.getByRole('navigation', { name: '신축 업무 메뉴', exact: true }).getByRole('button', { name, exact: true }).click() }
async function openLesson() { await agenda().getByRole('button', { name: /원본 수업/ }).click(); await detail().waitFor() }
async function check(name, run) { await boot(); try { await run() } catch (error) { console.error(await page.locator('.workhub-connected').innerText()); console.error(await page.evaluate(() => window.state.calls)); throw error } passed.push(name); console.log('  ✓ ' + name) }
try {
  await check('실제 홈 수업에서 정확한 날짜·수업을 열고 교환 추천 서버에 같은 수업을 전달한다', async () => {
    const date = await page.evaluate(() => window.state.basisDate)
    await openLesson()
    await detail().getByText(date + ' 가온 원본 수업', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('조회 시작일', { exact: true }).inputValue(), date)
    const reads = await page.evaluate(() => window.state.calls.filter(row => row.name === 'workhub_timetable_operations_get'))
    assert.equal(reads[0].args.p_from, date)
    assert.equal(reads.at(-1).args.p_from, monday(date))
    await detail().getByRole('button', { name: '이 수업 변경 요청', exact: true }).click()
    // 공유표의 클릭은 sourceSelection을 만든다. 자식 effect가 초안에 반영한 뒤 서버 전달을 검사한다.
    await page.getByText('시간표에서 선택한 수업으로 변경 요청을 시작합니다.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('변경할 내 수업', { exact: true }).inputValue(), 'gaon-soyeon-' + date)
    await page.getByLabel('변경 요청 사유', { exact: true }).fill('공식 행사에 따른 교환 검토')
    await page.getByRole('button', { name: '가능한 교환안 추천받기', exact: true }).click()
    await page.getByText('합성 자료의 추천 후보가 없습니다.', { exact: true }).waitFor()
    const recommendation = await page.evaluate(() => window.state.calls.find(row => row.name === 'workhub_timetable_operations_recommend'))
    assert.equal(recommendation.args.p_input.lessonId, 'gaon-soyeon-' + date)
    assert.equal(recommendation.args.p_member_id, 'gaon-soyeon')
    assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  })
  await check('일정에서 선택한 날짜의 수업이 오늘로 바뀌지 않고 변경 미리보기까지 전달된다', async () => {
    const date = await page.evaluate(() => window.state.selectedDate)
    await go('학교 일정'); await page.getByRole('group', { name: '일정 보기 방식', exact: true }).getByRole('button', { name: '월', exact: true }).click()
    await page.locator('[data-calendar-day="' + date + '"]').click()
    await agenda().getByRole('button', { name: new RegExp(date + ' 가온 원본 수업') }).waitFor()
    await openLesson()
    assert.equal(await page.getByLabel('조회 시작일', { exact: true }).inputValue(), date)
    await detail().getByText(date + ' 가온 원본 수업', { exact: true }).waitFor()
    await detail().getByRole('button', { name: '이 수업 변경 요청', exact: true }).click()
    await page.getByText('시간표에서 선택한 수업으로 변경 요청을 시작합니다.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('변경할 내 수업', { exact: true }).inputValue(), 'gaon-soyeon-' + date)
    await page.getByLabel('요청할 변경 종류', { exact: true }).selectOption('move')
    await page.getByLabel('이동할 공식 시간', { exact: true }).selectOption({ index: 1 })
    await page.getByLabel('변경 요청 사유', { exact: true }).fill('선택 날짜의 공식 시간 변경 검토')
    await page.getByRole('button', { name: '변경 전후 미리보기', exact: true }).click()
    await page.getByRole('region', { name: '수업 변경 미리보기', exact: true }).waitFor()
    const request = await page.evaluate(() => window.state.calls.find(row => row.name === 'workhub_timetable_operations_exchange_preview'))
    assert.equal(request.args.p_input.lessonId, 'gaon-soyeon-' + date)
    assert.equal(request.args.p_input.target.startsAt.slice(0, 10), date)
    assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  })
  await check('학교를 바꾸면 이전 수업 선택과 늦은 시간표 응답을 새 학교에 노출하지 않는다', async () => {
    await page.evaluate(() => window.state.holdOperations = true)
    await agenda().getByRole('button', { name: /가온 원본 수업/ }).click()
    await page.waitForFunction(() => typeof window.state.release === 'function')
    await page.getByLabel('사용할 학교').selectOption('nuri-soyeon')
    await agenda().getByRole('button', { name: /누리 원본 수업/ }).waitFor()
    await page.evaluate(() => window.state.release())
    await openLesson()
    await detail().getByText(/누리 원본 수업/).waitFor()
    assert.equal(await detail().getByText(/가온 원본 수업/).count(), 0)
    const reads = await page.evaluate(() => window.state.calls.filter(row => row.name === 'workhub_timetable_operations_get'))
    assert.equal(reads.at(-1).args.p_member_id, 'nuri-soyeon')
    assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  })
  await check('계정 변경 중 도착한 시간표 응답은 이전 수업 상세를 다시 열지 않는다', async () => {
    await page.evaluate(() => window.state.holdOperations = true)
    await agenda().getByRole('button', { name: /가온 원본 수업/ }).click()
    await page.waitForFunction(() => typeof window.state.release === 'function')
    await page.evaluate(() => window.state.revoke())
    await page.getByText(/현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다/).waitFor()
    await page.evaluate(() => window.state.release())
    await page.waitForTimeout(30)
    assert.equal(await detail().count(), 0)
    assert.equal(await page.getByText(/가온 원본 수업/).count(), 0)
    assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('실제 업무실 홈·일정→시간표 연결 브라우저 검사: ' + passed.length + '개 통과')
} finally { await browser.close() }
