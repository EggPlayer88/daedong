// 합성 서버 응답을 실제 React·P5/P8/P10 전송 어댑터에 넣어 명부 보존 왕복을 검증한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-roster-correction-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'}))
const button=name=>page.getByRole('button',{name,exact:true}),label=name=>page.getByLabel(name,{exact:true}),confirm=()=>label('명부 차이와 수강 기간을 확인했으며 기존 학생과 기록을 유지합니다.')
let passed=0
async function boot(){await page.goto('http://127.0.0.1:5191/roster-correction');await page.addScriptTag({content:bundle});await page.waitForFunction(()=>document.querySelector('select[aria-label="수업 선택"]')?.options.length===2);await label('수업 선택').selectOption('course-a');await button('수강 명부 가져오기').waitFor();await button('수강 명부 가져오기').click()}
async function upload(patch={name:'정정할 이름'}){const raw=await page.evaluate(patch=>window.csv([{...window.students[0],...patch}]),patch);await label('CSV 파일').setInputFiles({name:'보존명부.csv',mimeType:'text/csv',buffer:Buffer.from(raw)});await page.getByText('파일을 읽었습니다. 현재 수업 명부와 비교한 뒤 저장해 주세요.',{exact:true}).waitFor()}
async function openName(){await upload();await button('학생 정보 정정 · 001001').click();await button('학생 이름·관리 번호 정정').click();await label('학생 이름').fill('정정할 이름')}
async function preview(){await label('변경 근거').fill('공식 명부 대조 후 이름 오류 정정');await button('영향 확인').click();await page.getByRole('region',{name:'정정 영향 미리보기',exact:true}).waitFor()}
async function save(){await label('변경 전후와 영향을 확인했습니다.').check();await button('확인한 변경 반영').click()}
async function back(){await button('명부로 돌아가 다시 비교').click();await button('입력 유지하고 최신 명부와 비교').waitFor()}
async function test(name,fn){try{await boot();await fn();passed++;console.log('  ✓',name)}catch(e){console.error(await page.locator('body').innerText(),errors);throw e}}
try{
 await test('공식 학생 ID 정정 후 같은 파일로 복귀하며 최신 명부 재비교와 재동의를 요구',async()=>{
  await openName();await preview();assert.equal(await page.evaluate(()=>window.writes),0);await save();await button('학생 이름·관리 번호 정정').waitFor();await back()
  assert.equal(await page.getByText('보존명부.csv',{exact:true}).count(),1);assert.equal(await confirm().isDisabled(),true);assert.equal(await button('확인한 자료 저장').isDisabled(),true)
  const saved=await page.evaluate(()=>window.draft());assert.match(saved.import.rawCsv,/정정할 이름/);assert.equal(saved.import.confirmed,false);assert.equal(saved.import.rosterBasis,undefined)
  await button('입력 유지하고 최신 명부와 비교').click();await page.getByText('현재 명부와 일치 1명',{exact:true}).waitFor();await confirm().check();await button('확인한 자료 저장').click();await page.waitForFunction(()=>window.rosterWrites===1)
  const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_school_data_commit'));assert.equal(calls[0].args.p_command.intent.entityId,'student-a');assert.equal(await page.evaluate(()=>window.students[1].name),'합성 학생 나')
 })
 await test('학적 정정은 선택 학생의 기존 학적 ID만 보내고 명부 필터를 보존',async()=>{
  await upload({name:'합성 학생 가',seatNumber:7});await label('명부 비교 상태').selectOption('correction');await button('학년·반·번호 정정 · 001001').click();await button('학년·반·번호 정정').click();await label('번호').fill('7');await preview();await save();await button('학년·반·번호 정정').waitFor();await back();assert.equal(await label('명부 비교 상태').inputValue(),'correction');await button('입력 유지하고 최신 명부와 비교').click();assert.equal(await page.evaluate(()=>window.calls.find(c=>c.name==='workhub_school_data_commit').args.p_command.intent.entityId),'enrollment-a')
 })
 await test('수강 기간 경로는 선택 학생만 표시하고 지원하는 종료 작업으로 왕복',async()=>{
  await upload({name:'합성 학생 가'});await label('수강 종료일').fill('2026-12-31');await button('수강 기간 확인 · 001001').click();await button('수강 종료 · 합성 학생 가').waitFor();assert.equal(await button('수강 종료 · 합성 학생 나').count(),0);assert.equal(await button('전출 처리 · 합성 학생 가').count(),0)
  await button('수강 종료 · 합성 학생 가').click();await label('마지막 유효일').fill('2026-12-31');await label('변경 사유').fill('학교 명부 기준 수강 기간 종료');await button('변경 영향 미리보기').click();await label('대상·기간·전체 영향과 기존 기록 보존을 확인했습니다.').check();await button('확인한 관계 변경 적용').click();await page.getByText('서버에서 관계 변경을 확인했습니다. 기존 학생과 기록은 보존됩니다.',{exact:true}).waitFor();await back();assert.equal(await label('수강 종료일').inputValue(),'2026-12-31');await button('입력 유지하고 최신 명부와 비교').click();await page.getByText('현재 명부와 일치 1명',{exact:true}).waitFor()
 })
 await test('정정 응답 유실은 명부로 돌아가기 차단·같은 요청 번호 확인 뒤 단 한 번 적용',async()=>{
  await openName();await preview();await page.evaluate(()=>window.dropAfter=true);await save();await button('같은 요청으로 결과 확인').waitFor();assert.equal(await button('명부로 돌아가 다시 비교').isDisabled(),true);const pending=await page.evaluate(()=>window.pendingRow('schoolDataMaintenance'));await button('같은 요청으로 결과 확인').click();await button('학생 이름·관리 번호 정정').waitFor();await back();const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_school_data_commit'));assert.equal(calls.length,2);assert.equal(calls[1].args.p_request_key,pending.key);assert.deepEqual(calls[1].args.p_command,pending.command);assert.equal(await page.evaluate(()=>window.writes),1)
 })
 await test('관계 응답 유실도 동일 번호 복구를 보존하고 다른 학생 작업을 시작하지 않음',async()=>{
  await upload({name:'합성 학생 가'});await label('수강 종료일').fill('2026-12-31');await button('수강 기간 확인 · 001001').click();await button('수강 종료 · 합성 학생 가').click();await label('마지막 유효일').fill('2026-12-31');await label('변경 사유').fill('수강 기간 확인');await button('변경 영향 미리보기').click();await label('대상·기간·전체 영향과 기존 기록 보존을 확인했습니다.').check();await page.evaluate(()=>window.dropRelationAfter=true);await button('확인한 관계 변경 적용').click();await button('같은 관계 변경 요청으로 결과 확인').waitFor();assert.equal(await button('입력 버리고 관계 관리 닫기').isDisabled(),true);const p=await page.evaluate(()=>window.pendingRow('teachingRelations'));await button('같은 관계 변경 요청으로 결과 확인').click();await button('명부로 돌아가 다시 비교').waitFor();await back();const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_teaching_relation_commit'));assert.equal(calls[1].args.p_request_key,p.key);assert.deepEqual(calls[1].args.p_command,p.command);assert.equal(await page.evaluate(()=>window.writes),1)
 })
 await test('복귀 재조회 실패에도 원문·기간을 유지하고 조회 성공 전 저장하지 않음',async()=>{
  await upload();await button('학생 정보 정정 · 001001').click();await button('학생 이름·관리 번호 정정').waitFor();const before=await page.evaluate(()=>window.draft().import);await page.evaluate(()=>window.failCourse=true);await button('명부로 돌아가 다시 비교').click();await page.getByRole('heading',{name:'수업 자료 연결 확인이 필요합니다',exact:true}).waitFor();assert.equal(await button('확인한 자료 저장').count(),0);assert.equal(await page.evaluate(()=>window.draft().import.rawCsv),before.rawCsv);await page.evaluate(()=>window.failCourse=false);await button('다시 연결 확인').click();await button('입력 유지하고 최신 명부와 비교').waitFor();assert.equal(await label('수강 종료일').inputValue(),before.validThrough)
 })
 await test('정정 조회 실패는 다른 학생으로 대체하지 않고 명부로 돌아갈 수 있음',async()=>{
  await upload();await page.evaluate(()=>window.failMaintenance=true);await button('학생 정보 정정 · 001001').click();await page.getByText('학교 자료 정정 기능을 준비 중입니다. 기존 수업과 기록 조회는 계속 이용할 수 있습니다.',{exact:true}).waitFor();assert.equal(await button('학생 이름·관리 번호 정정').count(),0);await back();assert.equal(await page.evaluate(()=>window.draft().import.roster[0].name),'정정할 이름')
 })
 await test('정정 대상 학적이나 번호가 달라지면 다른 동명이인으로 연결하지 않음',async()=>{
  await upload();await page.evaluate(()=>{window.removeTarget=true;window.students[1].name=window.students[0].name});await button('학생 정보 정정 · 001001').click();await page.getByRole('alert').filter({hasText:'학생 번호 또는 학적 연결이 바뀌었습니다'}).waitFor();assert.equal(await button('학생 이름·관리 번호 정정').count(),0);assert.equal(await page.evaluate(()=>window.writes),0);await back()
 })
 await test('다른 학생의 기존 정정 초안은 덮어쓰지 않고 먼저 처리하도록 안내',async()=>{
  await upload();await page.evaluate(()=>window.seedOtherMaintenance());await button('학생 정보 정정 · 001001').click();await page.getByText('앞서 작성한 다른 대상의 정정 입력과 요청을 먼저 확인해 주세요. 명부에서 고른 학생으로 바꾸거나 덮어쓰지 않았습니다.',{exact:true}).waitFor();assert.equal(await label('학생 이름').inputValue(),'먼저 작성한 학생 이름');assert.equal(await label('변경 근거').inputValue(),'앞서 작성한 근거');assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name.endsWith('_commit')).length),0);await button('입력 취소').click();await button('학생 이름·관리 번호 정정').click();assert.equal(await label('학생 이름').inputValue(),'합성 학생 가');assert.equal(await page.evaluate(()=>window.draft().import.roster[0].name),'정정할 이름')
 })
 await test('늦은 정정 조회 중 소속이 바뀌면 이전 명부·파일·학생을 표시하지 않음',async()=>{
  await upload();await page.evaluate(()=>window.holdMaintenance=true);await button('학생 정보 정정 · 001001').click();await page.waitForFunction(()=>typeof window.releaseMaintenance==='function');await page.evaluate(()=>window.switchMember());await page.waitForFunction(()=>!document.querySelector('[aria-label="명부 정정 왕복"]'));await page.evaluate(()=>window.releaseMaintenance());assert.equal(await page.getByText('보존명부.csv',{exact:true}).count(),0);assert.equal(await button('학생 이름·관리 번호 정정').count(),0);assert.equal(await page.evaluate(()=>window.draft()),undefined)
 })
 await test('명부 저장 결과 미상일 때 정정 화면 전환을 허용하지 않음',async()=>{
  await upload();await page.evaluate(()=>window.injectPending());await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal(await button('학생 정보 정정 · 001001').isDisabled(),true);assert.equal(await page.getByRole('region',{name:'명부 정정 왕복',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_school_data_get').length),0);assert.equal(await page.evaluate(()=>window.draft().import.roster[0].name),'정정할 이름')
 })
 await test('두 번째 비교 페이지에서 정정 후에도 원래 페이지와 전체 파일을 유지',async()=>{
  const raw=await page.evaluate(()=>window.csv([...Array.from({length:21},(_,i)=>({schoolStudentKey:'batch-'+i,name:'추가 학생 '+i,grade:1,classLabel:'2',seatNumber:i+1})),{...window.students[0],name:'정정할 이름'}]));await label('CSV 파일').setInputFiles({name:'여러쪽.csv',mimeType:'text/csv',buffer:Buffer.from(raw)});await page.getByText('파일을 읽었습니다. 현재 수업 명부와 비교한 뒤 저장해 주세요.',{exact:true}).waitFor();await button('다음 20행').click();await button('학생 정보 정정 · 001001').click();await button('학생 이름·관리 번호 정정').waitFor();await back();assert.equal(await page.getByText('2 / 2',{exact:true}).count(),1);assert.equal(await page.evaluate(()=>window.draft().import.roster.length),22);assert.equal(await page.getByRole('cell',{name:'001001',exact:true}).count(),1)
 })
 await test('키보드로 정정 이동·복귀 가능하고 320px에서 바깥 가로 넘침 없음',async()=>{
  await page.setViewportSize({width:320,height:800});await upload();await button('학생 정보 정정 · 001001').focus();await page.keyboard.press('Enter');await button('학생 이름·관리 번호 정정').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);await button('명부로 돌아가 다시 비교').focus();await page.keyboard.press('Enter');await button('입력 유지하고 최신 명부와 비교').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);await page.setViewportSize({width:1100,height:900})
 })
 assert.deepEqual(errors,[]);console.log(`학생 명부 정정 왕복 화면 ${passed}개 통과`)
}finally{await browser.close()}
