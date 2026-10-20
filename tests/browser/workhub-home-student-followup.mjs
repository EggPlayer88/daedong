// 실제 연결 셸·홈·수업 어댑터를 합성 RPC에 연결한다. 운영 DB와 외부 API에는 접근하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{ConnectedWorkspace}from'./apps/workhub/src/app/ConnectedWorkspace';
import{ContractError}from'./apps/workhub/src/contracts';
import{createMemoryAdapter}from'./apps/workhub/src/preview/memory-adapter';
import{fixtureData,relationLabels}from'./apps/workhub/src/preview/fixtures';
import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
const clone=value=>structuredClone(value),data=clone(fixtureData),calendar=createMemoryAdapter(data,0),tasks=createWorkflowStore({members:data.memberships,date:data.basisDate});
const ctx={...calendar.info(),schoolLabels:Object.fromEntries(data.schools.map(s=>[s.id,relationLabels])),relationLabels};
const identity={userId:'fixture-soyeon',approved:true,profile:{id:'fixture-soyeon',name:'합성 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}};
let identityChanged=()=>{},invalidated=()=>{};
const now='2026-10-19T00:00:00Z',member='gaon-soyeon',school='fixture-school-gaon',courseId='course-home';
const course=id=>({id,schoolId:school,version:1,label:id===courseId?'홈에서 선택한 도덕 수업':'다른 수업',termId:'term-a',subjectId:'subject-a',assignmentId:'assignment-'+id,validFrom:'2026-08-13',validThrough:'2027-02-28',canRecord:true,canCounsel:true,canManageRoster:false});
const students=Array.from({length:12},(_,i)=>({id:'student-'+String(i+1).padStart(2,'0'),schoolId:school,version:1,schoolStudentKey:'school-key-'+(i+1),name:'합성 학생 '+String(i+1).padStart(2,'0'),grade:1,classLabel:'1',seatNumber:i+1,enrollmentId:'enrollment-'+(i+1),courseMembershipId:'course-member-'+(i+1),validFrom:'2026-08-13',validThrough:'2027-02-28'}));
const envelope=mid=>({contractVersion:'teaching.v1',schoolId:ctx.memberships.find(m=>m.id===mid).schoolId,memberId:mid,ownerUserId:identity.userId});
const observation=(studentId,old=false)=>({id:'record-'+studentId+(old?'-old':'-new'),schoolId:school,version:1,ownerUserId:identity.userId,courseId,studentId,courseMembershipId:students.find(s=>s.id===studentId).courseMembershipId,assignmentId:'assignment-'+courseId,revisionId:'revision-'+studentId+(old?'-old':'-new'),occurredOn:old?'2026-10-01':'2026-10-18',text:old?'이전 페이지에서 직접 연 재검토 관찰':'최근 관찰 본문',state:'active',contentHash:'a'.repeat(64),epoch:1,kind:'observation',sourceActivity:null,sourceReviewRequired:old});
window.state={calls:[],writes:[],missingCourse:false,courseFail:false,wrongCourse:false,failStudent:null,holdStudent:null,held:false,noTargets:false,refresh:()=>identityChanged(),revoke:()=>{identity.approved=false;identityChanged()},resolve:()=>{}};
const connection={async getIdentity(){return clone(identity)},async loadContext(){return clone(ctx)},info(){return clone(ctx)},subscribeIdentity(f){identityChanged=f;return()=>{}},subscribeInvalidation(f){invalidated=f;return()=>{}},async checkReadiness(){return{stage:'ready',code:'READY',checkedAt:now,readySchoolCount:2}},async rpcVerified(name,args){
 window.state.calls.push(clone({name,args}));
 if(name==='workhub_calendar_list')return calendar.list(args.p_member_id);
 if(name==='workhub_task_list')return tasks.listTasks(args.p_member_id);
 if(name==='workhub_home_overview'){const own=args.p_member_id===member;return{contract:'home.v1',schoolId:own?school:'fixture-school-nuri',memberId:args.p_member_id,data:{asOf:now,items:own?[{id:'followup-home',kind:'student_followup',title:'근거를 다시 확인할 수업',dueDate:null,sourceId:courseId,priority:'normal',label:'관찰 기록 재검토'}]:[],counts:{collection:0,supplement:0,message:0,student_followup:own?1:0,cooperation:0},unavailable:[]}}}
 if(name==='workhub_teaching_catalog')return{...envelope(args.p_member_id),courses:args.p_member_id===member?[course('course-other'),...window.state.missingCourse?[]:[course(courseId)]]:[],terms:[{id:'term-a',schoolId:ctx.memberships.find(m=>m.id===args.p_member_id).schoolId,version:1,label:'2026년 2학기',firstDay:'2026-08-13',lastDay:'2027-02-28'}],subjects:[{id:'subject-a',label:'도덕'}],approvedTeachers:[],canManageCourses:false};
 if(name==='workhub_teaching_course'){if(window.state.courseFail)throw new ContractError('QUERY_FAILED');return{...envelope(args.p_member_id),course:course(window.state.wrongCourse?'course-other':args.p_course_id),students:args.p_course_id===courseId?clone(students):[],rubrics:[],imports:[]}}
 if(name==='workhub_teaching_student'){
  if(window.state.holdStudent===args.p_student_id&&!window.state.held){window.state.held=true;await new Promise(resolve=>window.state.resolve=resolve)}
  if(window.state.failStudent===args.p_student_id)throw new ContractError('QUERY_FAILED');
  const older=args.p_cursor==='older-observations',target=!window.state.noTargets&&args.p_student_id==='student-01';
  return{...envelope(args.p_member_id),courseId:args.p_course_id,studentId:args.p_student_id,observations:target?[observation(args.p_student_id,older)]:[],assessments:[],nextCursor:target&&!older?'older-observations':null};
 }
 if(name==='workhub_teaching_counseling')return{...envelope(args.p_member_id),courseId:args.p_course_id,studentId:args.p_student_id,records:[],nextCursor:null};
 if(name.includes('mutate'))window.state.writes.push(clone({name,args}));
 throw new ContractError('QUERY_FAILED');
}};
createRoot(document.getElementById('root')).render(<ConnectedWorkspace expectedUserId="fixture-soyeon" legacyHomeHref="/legacy" connection={connection}/>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://localhost.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })

const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage()
const passed = [], errors = [], external = [], output = process.env.WORKHUB_QA_OUTPUT
const fontCss = readFileSync(new URL('../../apps/workhub/src/typography.css', import.meta.url), 'utf8')
const fontBytes = readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url))
page.setDefaultTimeout(15000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  const url = route.request().url()
  if (!url.startsWith('http://127.0.0.1:5187/')) { external.push(url); return route.abort() }
  if (url.endsWith('/assets/fonts/PretendardVariable.woff2')) return route.fulfill({ contentType: 'font/woff2', body: fontBytes })
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const card = () => page.getByRole('button', { name: '근거를 다시 확인할 수업 관찰 기록 재검토', exact: true })
const panel = () => page.getByRole('region', { name: '학생 기록 근거 확인', exact: true })
const target = () => panel().getByRole('button', { name: '합성 학생 01 · 1학년 1반 1번 · 2026-10-01 기록 열기', exact: true })
async function boot() {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('http://127.0.0.1:5187/home')
  await page.addStyleTag({ content: fontCss })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await card().waitFor()
}
async function open() { await card().click(); await panel().getByRole('button', { name: '처음 10명 확인', exact: true }).waitFor() }
async function scan() { await panel().getByRole('button', { name: '처음 10명 확인', exact: true }).click(); await panel().getByRole('button', { name: '다음 2명 확인', exact: true }).waitFor() }
async function calls(name) { return page.evaluate(name => window.state.calls.filter(call => call.name === name), name) }
async function check(name, run) {
  await boot()
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); console.error(errors); console.error(await page.evaluate(() => window.state.calls)); throw error }
  assert.equal((await calls('workhub_teaching_counseling')).length, 0)
  assert.equal(await page.evaluate(() => window.state.writes.length), 0)
  passed.push(name); console.log('  ✓ ' + name)
}
try {
  await check('홈 원본 수업을 정확히 열고 명시 확인 뒤 첫 10명 관찰만 조회한다', async () => {
    assert.equal((await calls('workhub_teaching_student')).length, 0)
    await open()
    assert.equal(await page.getByLabel('수업 선택', { exact: true }).inputValue(), 'course-home')
    assert.deepEqual((await calls('workhub_teaching_course')).map(call => call.args.p_course_id), ['course-home'])
    assert.equal((await calls('workhub_teaching_student')).length, 0)
    await scan()
    const read = await calls('workhub_teaching_student')
    assert.equal(new Set(read.map(call => call.args.p_student_id)).size, 10)
    assert.equal(read.length, 11)
    assert(read.every(call => call.args.p_course_id === 'course-home'))
    assert(!read.some(call => ['student-11', 'student-12'].includes(call.args.p_student_id)))
    await target().waitFor()
    assert.equal(await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).count(), 0)
  })
  await check('이전 페이지의 재검토 관찰은 선택한 커서로 바로 열며 최근 페이지로 대체하지 않는다', async () => {
    await open(); await scan()
    const count = (await calls('workhub_teaching_student')).length
    await target().click()
    await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '합성 학생 01 · 1학년 1반 1번', exact: true, level: 3 }).evaluate(el => el.getRootNode().activeElement === el), true)
    const read = await calls('workhub_teaching_student')
    assert.equal(read.length, count + 1)
    assert.equal(read.at(-1).args.p_cursor, 'older-observations')
    assert.equal(read.at(-1).args.p_student_id, 'student-01')
    assert.equal(await page.getByText('최근 관찰 본문', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '최근 기록부터 보기', exact: true }).click()
    await page.getByText('최근 관찰 본문', { exact: true }).waitFor()
    assert.equal((await calls('workhub_teaching_student')).at(-1).args.p_cursor, null)
  })
  await check('다음 확인은 남은 2명만 읽고 이미 확인한 학생을 반복 조회하지 않는다', async () => {
    await open(); await scan()
    const count = (await calls('workhub_teaching_student')).length
    await panel().getByRole('button', { name: '다음 2명 확인', exact: true }).click()
    await panel().getByText('12명 중 12명 확인 · 재검토 학생 1명', { exact: true }).waitFor()
    assert.deepEqual((await calls('workhub_teaching_student')).slice(count).map(call => call.args.p_student_id), ['student-11', 'student-12'])
  })
  await check('같은 재검토 기록을 다시 선택해도 같은 커서로 재조회하고 로딩을 마친다', async () => {
    await open(); await scan(); await target().click()
    await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).waitFor()
    const count = (await calls('workhub_teaching_student')).length
    await target().click()
    await page.waitForFunction(count => window.state.calls.filter(call => call.name === 'workhub_teaching_student').length > count, count)
    await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).waitFor()
    assert.equal((await calls('workhub_teaching_student')).at(-1).args.p_cursor, 'older-observations')
    assert.equal(await page.getByText('학생 기록을 확인하는 중…', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '관찰 기록 작성', exact: true }).isEnabled(), true)
  })
  await check('이전 관찰 정정 중 배경 재조회는 원래 페이지 커서와 교사 입력을 보존한다', async () => {
    await open(); await scan(); await target().click()
    await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).waitFor()
    await page.getByRole('button', { name: '기록 정정', exact: true }).click()
    const field = page.getByLabel('관찰한 사실', { exact: true })
    await field.fill('이전 관찰을 다시 확인해 작성한 정정 입력')
    await page.getByLabel('정정 사유', { exact: true }).fill('원본 활동 근거 재확인')
    const count = (await calls('workhub_teaching_student')).length
    await page.evaluate(() => window.state.refresh())
    await page.waitForFunction(count => window.state.calls.filter(call => call.name === 'workhub_teaching_student').length > count, count)
    await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).waitFor()
    const after = (await calls('workhub_teaching_student')).slice(count)
    assert(after.every(call => call.args.p_cursor === 'older-observations' && call.args.p_student_id === 'student-01'))
    assert.equal(await field.inputValue(), '이전 관찰을 다시 확인해 작성한 정정 입력')
    assert.equal(await page.getByLabel('정정 사유', { exact: true }).inputValue(), '원본 활동 근거 재확인')
    assert.equal(await page.getByText('최근 관찰 본문', { exact: true }).count(), 0)
  })
  await check('조회 실패를 재검토 0건 완료로 위장하지 않고 실패한 학생만 다시 확인한다', async () => {
    await page.evaluate(() => { window.state.failStudent = 'student-01'; window.state.noTargets = true })
    await open(); await scan()
    await panel().getByText('12명 중 9명 확인 · 재검토 학생 0명 · 확인 실패 1명', { exact: true }).waitFor()
    assert.equal(await panel().getByText('현재 명부에서 재검토할 관찰 기록을 찾지 못했습니다.', { exact: true }).count(), 0)
    const count = (await calls('workhub_teaching_student')).length
    await page.evaluate(() => { window.state.failStudent = null; window.state.noTargets = false })
    await panel().getByRole('button', { name: '실패한 학생 다시 확인', exact: true }).click()
    await target().waitFor()
    assert.deepEqual((await calls('workhub_teaching_student')).slice(count).map(call => call.args.p_student_id), ['student-01', 'student-01'])
  })
  await check('홈 수업이 현재 목록에 없으면 다른 수업을 자동으로 열지 않는다', async () => {
    await page.evaluate(() => window.state.missingCourse = true)
    await card().click()
    await page.getByText('홈에서 선택한 수업을 현재 권한으로 찾을 수 없습니다. 다른 수업을 대신 열지 않았습니다.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('수업 선택', { exact: true }).inputValue(), '')
    assert.equal((await calls('workhub_teaching_course')).length, 0)
    assert.equal((await calls('workhub_teaching_student')).length, 0)
  })
  await check('홈 수업 조회 실패 후 재연결은 같은 원본 수업을 다시 조회한다', async () => {
    await page.evaluate(() => window.state.courseFail = true)
    await card().click()
    await page.getByRole('button', { name: '다시 연결 확인', exact: true }).waitFor()
    assert.equal((await calls('workhub_teaching_student')).length, 0)
    await page.evaluate(() => window.state.courseFail = false)
    await page.getByRole('button', { name: '다시 연결 확인', exact: true }).click()
    await panel().getByRole('button', { name: '처음 10명 확인', exact: true }).waitFor()
    assert((await calls('workhub_teaching_course')).every(call => call.args.p_course_id === 'course-home'))
  })
  await check('RPC가 다른 수업을 반환하면 실제 파서가 거부하고 학생 관찰을 조회하지 않는다', async () => {
    await page.evaluate(() => window.state.wrongCourse = true)
    await card().click()
    await page.getByRole('button', { name: '다시 연결 확인', exact: true }).waitFor()
    assert.equal(await panel().count(), 0)
    assert.equal((await calls('workhub_teaching_student')).length, 0)
    assert.deepEqual((await calls('workhub_teaching_course')).map(call => call.args.p_course_id), ['course-home'])
  })
  await check('학교를 바꾸면 이전 학교의 늦은 관찰과 확인 목록을 표시하지 않는다', async () => {
    await page.evaluate(() => window.state.holdStudent = 'student-01')
    await open(); await panel().getByRole('button', { name: '처음 10명 확인', exact: true }).click()
    await page.waitForFunction(() => window.state.held)
    await page.getByLabel('사용할 학교').selectOption('nuri-soyeon')
    await page.waitForFunction(() => window.state.calls.some(call => call.name === 'workhub_teaching_catalog' && call.args.p_member_id === 'nuri-soyeon'))
    await page.evaluate(() => window.state.resolve()); await page.waitForTimeout(75)
    assert.equal(await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).count(), 0)
    assert.equal(await panel().count(), 0)
    assert.equal((await calls('workhub_teaching_student')).length, 1)
  })
  await check('계정 권한 회수 후 늦은 관찰 응답을 버리고 다음 학생을 읽지 않는다', async () => {
    await page.evaluate(() => window.state.holdStudent = 'student-01')
    await open(); await panel().getByRole('button', { name: '처음 10명 확인', exact: true }).click()
    await page.waitForFunction(() => window.state.held)
    await page.evaluate(() => window.state.revoke())
    await page.getByText(/현재 로그인 계정으로 신축 시험 화면을 이용할 수 없습니다/).waitFor()
    await page.evaluate(() => window.state.resolve()); await page.waitForTimeout(75)
    assert.equal(await panel().count(), 0)
    assert.equal(await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).count(), 0)
    assert.equal((await calls('workhub_teaching_student')).length, 1)
  })
  await check('320px에서 근거 확인과 이전 기록을 키보드로 열며 본문을 영속 저장하지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 760 })
    await card().focus(); await page.keyboard.press('Enter')
    await panel().getByRole('button', { name: '처음 10명 확인', exact: true }).waitFor()
    await scan(); await target().focus(); await page.keyboard.press('Enter')
    await page.getByText('이전 페이지에서 직접 연 재검토 관찰', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 })
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'home-student-followup-320.png'), fullPage: true }) }
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) writeFileSync(join(output, 'home-student-followup-results.json'), JSON.stringify({ passed, pageErrors: errors, externalRequests: external, scope: '실제 ConnectedWorkspace·TeachingWorkspace·RPC 파서, 합성 학교·교사·학생 자료; 운영 DB 연결 없음' }, null, 2))
  console.log('홈 학생 후속 근거 브라우저 검사: ' + passed.length + '개 통과')
} finally { await browser.close() }
