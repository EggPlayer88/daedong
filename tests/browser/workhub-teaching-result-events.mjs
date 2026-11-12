import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
import { openTeachingTools } from './teaching-tools.mjs'

// 실제 수업 화면·RPC 어댑터를 실행한다. 학교 서버와 유료 AI 호출은 합성 전송으로 대체한다.
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-teaching-result-events-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],external=[],passed=[]
const origin='http://127.0.0.1:5296/'
page.setDefaultTimeout(12000)
page.on('pageerror',e=>errors.push(e.message))
page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload')await dialog.accept();else{errors.push(dialog.message());await dialog.dismiss()}})
await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:12px"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true})
const results=()=>page.evaluate(()=>window.results),writes=()=>page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_teaching_mutate'))
async function start(){await page.goto(origin+'teaching');await page.addScriptTag({content:bundle});await field('수업 선택').waitFor();assert.deepEqual(await results(),[])}
async function test(name,run){await start();try{await run();assert.deepEqual(errors,[]);assert.deepEqual(external,[])}catch(e){console.error(await page.locator('body').innerText());console.error('결과',await results());throw e}passed.push(name);console.log('  ✓ '+name)}
async function course(){await field('수업 선택').selectOption('course-a');await button('합성 학생 가 1학년 1반 1번').waitFor()}
async function student(){await course();await button('합성 학생 가 1학년 1반 1번').click();await button('관찰 기록 작성').and(page.locator(':enabled')).waitFor()}
async function observation(text='결과에 복제하지 않을 관찰'){await button('관찰 기록 작성').click();await field('관찰한 사실').fill(text)}
async function done(count){await page.waitForFunction(count=>window.results.length===count,count);await button('자료 새로 확인').and(page.locator(':enabled')).waitFor()}
async function withdraw(name){await button(name).click();await field('철회 사유').fill('확인한 철회 사유');await button('사유 확인 · 기록 철회').click()}
function metadata(row,action){assert.equal(row.kind,'teaching');assert.equal(row.action,action);assert.deepEqual(JSON.parse(row.scope).slice(0,3),['user-a','school-a','member-a']);assert.ok(row.key);assert.equal(row.recordedAt,'2026-10-16T01:00:00Z');assert.ok(row.entityId);assert.ok(row.entityVersion>0);if(action!=='activity_correct')assert.equal(Object.hasOwn(row,'previousImportId'),false);for(const key of ['studentId','text','comment','scores','reason','input','rawCsv','rows','studentName','sourceActivity'])assert.equal(Object.hasOwn(row,key),false,key)}
const gradingHeaders=['자리번호·별명','현재 단계','제출 여부','나의 결정','직접 제안','선택한 근거','근거를 고른 이유','다른 사람','영향','필요한 조건','심화 (평가 제외)']
const gradingCsv=[gradingHeaders,['가번 별명','작성','제출 완료','선택 문장','','근거','이유','사람','영향','조건','심화']].map(row=>row.map(value=>'"'+value+'"').join(',')).join('\r\n')
async function activityInput(raw=gradingCsv,label='합성 윤리 활동'){
  await field('CSV 파일').setInputFiles({name:'합성활동.csv',mimeType:'text/csv',buffer:Buffer.from(raw,'utf8')})
  await field('활동 회차 이름').fill(label);await field('실제 활동 날짜').fill('2026-10-16');await field('질문판 이름').fill('질문판 1');await field('당시 질문·선택지 원문').fill('실제로 사용한 질문과 선택지')
  await field('처리').selectOption('adopt');await field('실제 수강 학생').selectOption('student-a');await field('전체 명부·활동 회차와 학생 연결, 보류·제외 상태를 확인했습니다.').check()
}
async function importActivity(){await course();await openTeachingTools(page,'roster');await button('활동 CSV 가져오기').click();await field('수업 CSV 형식').selectOption('grading');await activityInput();await button('확인한 자료 저장').click();await done(1);await page.getByText('가져온 활동 1회',{exact:true}).click();await button('원문·학생 연결 확인').click();await button('학생 연결·처리 변경').waitFor()}
async function correctionInput(){await button('CSV 원문 정정판 등록').click();await activityInput(gradingCsv.replace('선택 문장','정정한 선택 문장'),'활동 정정판');await button('정정판 행 대응 확인으로 이동').click();await field('원문 정정 사유').fill('교사가 원문 정정 확인');await field('새 2행의 이전 원문 행').selectOption({label:'2행 · 가번 별명 · 이전 상태 adopt'});await field('새 학생 연결과 이전 모든 행의 대응·추가·제외 사유를 확인했습니다.').check()}
const batchCsv=names=>'수업 이름,학기,교과,담당 교사,시작일,종료일\n'+names.map(name=>`${name},2학기,도덕,담당1,2026-08-13,2027-02-28`).join('\n')
async function batch(names=['일괄 수업 하나','일괄 수업 둘']){await openTeachingTools(page,'course');await button('수업 여러 개 등록').click();await field('수업 CSV 내용').fill(batchCsv(names));await field('학기 연결 · 2학기').selectOption('term-a');await field('교과 연결 · 도덕').selectOption('subject-a');await field('담당 교사 연결 · 담당1').selectOption('member-a');await button('목록 비교하기').click();await field('선택한 수업의 학기·교과·담당·기간을 확인했습니다.').check()}
try{
 await test('수업 생성은 명시 저장 후 생성한 수업 번호를 결과 원본으로 쓴다',async()=>{
  await openTeachingTools(page,'course');await button('수업·담당 등록').click();await field('수업 이름').fill('새 수업');await field('학기').selectOption('term-a');await field('교과').selectOption('subject-a');await page.getByRole('checkbox',{name:'합성 교사',exact:true}).check();assert.deepEqual(await results(),[])
  await button('수업과 담당 저장').click();await done(1);const[row]=await results();metadata(row,'course_create');assert.equal(row.courseId,row.entityId);assert.equal(row.entityVersion,1)
 })
 await test('수강 명부 저장은 해당 수업의 새 판만 알리고 학생 명부를 결과에 복제하지 않는다',async()=>{
  await course();await openTeachingTools(page,'roster');await button('수강 명부 가져오기').click();await field('CSV 파일').setInputFiles({name:'명부.csv',mimeType:'text/csv',buffer:Buffer.from('학교내학생번호,이름,학년,반,번호\r\nstudent-key-b,합성 학생 나,1,1,2','utf8')});await field('명부 차이와 수강 기간을 확인했으며 기존 학생과 기록을 유지합니다.').check();await button('확인한 자료 저장').click();await done(1)
  const[row]=await results();metadata(row,'roster_import');assert.equal(row.courseId,'course-a');assert.equal(row.entityId,'course-a');assert.equal(row.entityVersion,2);assert.equal(await button('합성 학생 나 1학년 1반 2번').count(),1)
 })
 await test('관찰 생성·정정·철회는 같은 기록의 정확한 판과 처리 종류만 알린다',async()=>{
  await student();await observation();await button('기록 저장').click();await done(1);await button('기록 정정').click();await field('관찰한 사실').fill('정정한 관찰');await field('정정 사유').fill('직접 확인한 보완');await button('정정본 저장').click();await done(2);await withdraw('기록 철회');await done(3)
  const rows=await results();assert.deepEqual(rows.map(row=>[row.action,row.entityVersion,row.recordKind]),[['observation_save',1,undefined],['observation_save',2,undefined],['record_withdraw',3,'observation']]);for(const row of rows){metadata(row,row.action);assert.equal(row.courseId,'course-a');assert.equal(row.entityId,rows[0].entityId)}
 })
 await test('평가 미확정·교사 확인·철회는 점수나 학생 자료 없이 서로 다른 상태를 보존한다',async()=>{
  await student();await button('평가').click();await button('평가 입력').click();await field('평가 기준').selectOption('rubric-a');await field('판단 근거 상태').selectOption('scored');await field('판단 근거 점수 · 10점 만점').fill('0');await field('교사 평가 의견').fill('교사만 볼 의견');await button('미확정 평가 저장').click();await done(1)
  await button('평가 정정').click();await field('정정 사유').fill('교사가 점수 확인');await field('학생·기준·항목별 상태와 점수를 교사가 확인했습니다.').check();await button('교사 확인 평가 저장').click();await done(2);await withdraw('평가 철회');await done(3)
  const rows=await results();assert.deepEqual(rows.map(row=>[row.action,row.entityVersion,row.confirmed,row.recordKind]),[['assessment_save',1,false,undefined],['assessment_save',2,true,undefined],['record_withdraw',3,undefined,'assessment']]);rows.forEach(row=>metadata(row,row.action))
 })
 await test('평가 기준 생성·개정도 기준 번호와 판으로만 결과를 알린다',async()=>{
  await student();await button('평가').click();await button('평가 기준 등록').click();await field('평가 이름').fill('검토 평가');await field('항목 1').fill('검토 항목');await field('만점').fill('10');await button('평가 기준 저장').click();await done(1)
  await page.getByText('평가 기준 2개',{exact:true}).click();const rubric=page.locator('article').filter({has:page.getByRole('heading',{name:'검토 평가',exact:true})});await rubric.getByRole('button',{name:'새 기준판 작성',exact:true}).click();await field('평가 이름').fill('개정 검토 평가');await button('평가 기준 저장').click();await done(2)
  const rows=await results();rows.forEach(row=>metadata(row,'rubric_save'));assert.equal(rows[0].entityId,rows[1].entityId);assert.deepEqual(rows.map(row=>row.entityVersion),[1,2])
 })
 await test('활동 CSV 저장과 학생 연결 검토는 원문·별명·학생 정보 없이 구분한다',async()=>{
  await importActivity();await button('학생 연결·처리 변경').click();await field('처리').selectOption('withdraw');await field('변경 사유').fill('학생 연결 재검토');await button('확인한 연결 저장').click();await done(2)
  const rows=await results();metadata(rows[0],'activity_import');metadata(rows[1],'activity_review');assert.equal(rows[0].entityVersion,1);assert.equal(rows[1].entityVersion,2);assert.equal(rows[1].disposition,'withdraw');assert.notEqual(rows[0].entityId,rows[1].entityId)
 })
 await test('활동 원문 정정은 원본을 보존하며 응답 유실 후 새 정정판의 원키 접수만 기록한다',async()=>{
  await importActivity();await correctionInput();await page.evaluate(()=>{window.failOnce=true});await button('확인한 원문 정정판 저장').click();await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal((await results()).length,1)
  await button('같은 요청으로 결과 다시 확인').click();await done(2);const rows=await results(),calls=(await writes()).filter(call=>call.args.p_command.kind==='activity_correct');metadata(rows[1],'activity_correct');assert.equal(rows[1].entityVersion,1);assert.notEqual(rows[0].entityId,rows[1].entityId);assert.equal(rows[1].previousImportId,rows[0].entityId);assert.equal(rows[1].previousImportId,calls[0].args.p_command.previousImportId);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.state.activities[0].items[0].values[3]),'선택 문장')
 })
 await test('원문 정정 응답이 이전 원문 ID를 새 판처럼 돌려주면 원키로 검증하기 전 연결하지 않는다',async()=>{
  await importActivity();await correctionInput();const original=(await results())[0].entityId;await page.evaluate(id=>{window.badReceipt={entityId:id}},original);await button('확인한 원문 정정판 저장').click();await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal((await results()).length,1);assert.equal(await page.evaluate(()=>window.pending.count()),1)
  await page.evaluate(()=>{window.badReceipt=undefined});await button('같은 요청으로 결과 다시 확인').click();await done(2);const row=(await results())[1];assert.equal(row.previousImportId,original);assert.notEqual(row.entityId,original);assert.equal(row.entityVersion,1);const calls=(await writes()).filter(call=>call.args.p_command.kind==='activity_correct');assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.state.activities.length),2)
 })
 await test('상담 생성·정정·철회 사실과 내용은 AI 결과에 전혀 보내지 않는다',async()=>{
  await student();await button('상담').click();await button('내 상담 기록 열기').click();await button('상담 기록 작성').and(page.locator(':enabled')).waitFor();await button('상담 기록 작성').click();await field('상담 내용').fill('상담 비공개 원문');await button('기록 저장').click();await button('상담 정정').and(page.locator(':enabled')).waitFor()
  await button('상담 정정').click();await field('상담 내용').fill('상담 정정 원문');await field('정정 사유').fill('상담 정정 사유');await button('정정본 저장').click();await button('상담 철회').and(page.locator(':enabled')).waitFor();await withdraw('상담 철회');await page.waitForFunction(()=>window.state.counseling[0].state==='withdrawn');await button('자료 새로 확인').and(page.locator(':enabled')).waitFor()
  assert.deepEqual(await results(),[]);assert.deepEqual(await page.evaluate(()=>window.applied.map(command=>command.kind)),['counseling_save','counseling_save','record_withdraw'])
 })
 await test('관찰 응답 유실은 재마운트 후 같은 명령·번호로 복구하고 한 결과만 남긴다',async()=>{
  await student();await observation();await page.evaluate(()=>{window.failOnce=true});await button('기록 저장').click();await button('같은 요청으로 결과 다시 확인').waitFor();assert.deepEqual(await results(),[])
  await page.evaluate(()=>window.unmount());await field('수업 선택').waitFor({state:'detached'});await page.evaluate(()=>window.remount());await button('같은 요청으로 결과 다시 확인').click();await done(1);const calls=await writes();assert.deepEqual(calls[0],calls[1]);assert.equal((await results())[0].key,calls[0].args.p_request_key);assert.equal(await page.evaluate(()=>window.applied.length),1);assert.equal(await page.evaluate(()=>window.pending.count()),0)
 })
 await test('결과 콜백과 후속 조회가 실패해도 확인된 저장과 결과·복구 해제를 보존한다',async()=>{
  await student();await observation();await page.evaluate(()=>{window.resultThrows=true;window.readFail=true});await button('기록 저장').click();await done(1);await page.getByRole('alert').first().waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),0);assert.equal(await page.evaluate(()=>window.applied.length),1)
 })
 for(const [fieldName,value] of [['requestKey','wrong-key'],['commandKind','assessment_save'],['version',9],['schoolId','other-school'],['memberId','other-member'],['ownerUserId','other-user'],['appliedAt','invalid']])await test(`접수증 ${fieldName} 불일치는 결과를 만들지 않고 원번호 복구를 유지한다`,async()=>{
  await student();await observation();await page.evaluate(([field,value])=>{window.badReceipt={[field]:value}},[fieldName,value]);await button('기록 저장').click();await button('같은 요청으로 결과 다시 확인').waitFor();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.pending.count()),1)
  await page.evaluate(()=>{window.badReceipt=undefined});await button('같은 요청으로 결과 다시 확인').click();await done(1);const calls=await writes();assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.applied.length),1)
 })
 await test('기존 기록 정정의 다른 원본 번호는 접수하지 않고 원래 기록으로만 복구한다',async()=>{
  await student();await observation();await button('기록 저장').click();await done(1);await button('기록 정정').click();await field('정정 사유').fill('보완');await page.evaluate(()=>{window.badReceipt={entityId:'other-record'}});await button('정정본 저장').click();await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal((await results()).length,1);await page.evaluate(()=>{window.badReceipt=undefined});await button('같은 요청으로 결과 다시 확인').click();await done(2);const rows=await results();assert.equal(rows[0].entityId,rows[1].entityId);assert.equal(rows[1].entityVersion,2)
 })
 for(const change of ['unmount','replaceConnection','switchAccount'])await test(`${change} 뒤 도착한 저장 응답을 새 화면의 결과로 옮기지 않는다`,async()=>{
  await student();await observation();await page.evaluate(()=>{window.holdMutation=true});await button('기록 저장').click();await page.waitForFunction(()=>typeof window.releaseMutation==='function');await page.evaluate(change=>window[change](),change);await page.waitForFunction(change=>change==='unmount'?!window.ui.mounted:change==='replaceConnection'?window.ui.epoch===1:window.ui.memberId==='member-b',change);await page.evaluate(()=>window.releaseMutation());await page.waitForTimeout(100);assert.deepEqual(await results(),[])
  if(change==='replaceConnection'){assert.equal(await page.evaluate(()=>window.pending.count()),1);await button('같은 요청으로 결과 다시 확인').click();await done(1);const calls=await writes();assert.deepEqual(calls[0],calls[1])}
 })
 await test('저장 중 결과 수신자가 바뀌어도 요청 시작 때의 콜백만 호출한다',async()=>{
  await student();await observation();await page.evaluate(()=>{window.holdMutation=true});await button('기록 저장').click();await page.waitForFunction(()=>typeof window.releaseMutation==='function');await page.evaluate(()=>window.changeListener());await page.waitForFunction(()=>window.ui.listener==='new');await page.evaluate(()=>window.releaseMutation());await done(1);assert.deepEqual(await page.evaluate(()=>window.listeners),['original'])
 })
 await test('서버 권한 거절은 저장 결과를 만들지 않고 명확한 거절로 처리한다',async()=>{
  await student();await observation();await page.evaluate(()=>{window.rejectCode='FORBIDDEN'});await button('기록 저장').click();await page.getByRole('alert').waitFor();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.pending.count()),0);assert.equal(await page.evaluate(()=>window.applied.length),0)
 })
 await test('저장 중 신원 변경은 성공 결과로 기록하지 않는다',async()=>{
  await student();await observation();await page.evaluate(()=>{window.holdMutation=true});await button('기록 저장').click();await page.waitForFunction(()=>typeof window.releaseMutation==='function');await page.evaluate(()=>{window.identityRole='admin';window.releaseMutation()});await button('같은 요청으로 결과 다시 확인').waitFor();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.pending.count()),1)
 })
 await test('수업 일괄 등록은 행별 접수만 기록하고 중간 유실·재마운트 복구에도 중복 결과가 없다',async()=>{
  await batch(['일괄 첫 수업','일괄 둘째 수업','아직 안 보낸 수업']);await page.evaluate(()=>{window.failAt=2;window.resultThrows=true});await button('선택한 수업 3개 저장').click();await button('이 행을 같은 번호로 다시 확인').waitFor();assert.equal((await results()).length,1);assert.equal((await writes()).length,2)
  await page.evaluate(()=>window.unmount());await field('수업 CSV 내용').waitFor({state:'detached'});await page.evaluate(()=>window.remount());await button('이 행을 같은 번호로 다시 확인').click();await done(2);const rows=await results(),calls=await writes();rows.forEach(row=>{metadata(row,'course_create');assert.equal(row.courseId,row.entityId)});assert.notEqual(rows[0].entityId,rows[1].entityId);assert.deepEqual(calls[1],calls[2]);assert.equal(await page.evaluate(()=>window.extraCourses.length),2);assert.equal(await page.evaluate(()=>window.pending.count()),0)
 })
 await test('일괄 수업 저장도 연결 교체의 늦은 응답을 버리고 원래 행 번호로 복구한다',async()=>{
  await batch(['늦게 저장한 수업']);await page.evaluate(()=>{window.holdMutation=true});await button('선택한 수업 1개 저장').click();await page.waitForFunction(()=>typeof window.releaseMutation==='function');await page.evaluate(()=>window.replaceConnection());await page.waitForFunction(()=>window.ui.epoch===1);await page.evaluate(()=>window.releaseMutation());await page.waitForTimeout(100);assert.deepEqual(await results(),[]);await button('이 행을 같은 번호로 다시 확인').click();await done(1);const calls=await writes();assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.extraCourses.length),1)
 })
 console.log(`\n수업·학생 기록 결과 연결 ${passed.length}/${passed.length} 통과 · 실제 React/어댑터, 합성 RPC`)
}finally{await context.close();await browser.close()}
