import { openTeachingTools } from './teaching-tools.mjs'
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-course-batch-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],external=[]
page.setDefaultTimeout(12000)
page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',r=>{if(!r.request().url().startsWith('http://127.0.0.1:5182/')){external.push(r.request().url());return r.abort()}return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:12px"><div id="root"></div></body></html>'})})
const headers='수업 이름,학기,교과,담당 교사,시작일,종료일'
const csv=(names=['1반 국어','2반 국어','3반 국어'])=>headers+'\n'+names.map(n=>`${n},1학기,국어,담당1,2027-03-01,2027-07-31`).join('\n')
const button=name=>page.getByRole('button',{name,exact:true})
const field=name=>page.getByLabel(name,{exact:true})
const writeCalls=()=>page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_teaching_mutate'))
let passed=0
async function start(){await page.goto('http://127.0.0.1:5182/course-batch');await page.addScriptTag({content:bundle});await openTeachingTools(page,'course');await button('수업 여러 개 등록').click();await field('수업 CSV 내용').waitFor()}
async function fill(raw=csv()){await field('수업 CSV 내용').fill(raw);await field('학기 연결 · 1학기').selectOption('term-a');await field('교과 연결 · 국어').selectOption('subject-b');await field('담당 교사 연결 · 담당1').selectOption('teacher-b');await button('목록 비교하기').click()}
async function confirm(){await field('선택한 수업의 학기·교과·담당·기간을 확인했습니다.').check()}
async function saved(n){await page.waitForFunction(n=>document.body.innerText.includes(`저장 확인 ${n}개 ·`),n);await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='자료 새로 확인').disabled)}
async function check(name,fn){await start();try{await fn()}catch(e){console.error('화면:',await page.locator('body').innerText());console.error('페이지 오류:',errors);throw e}passed++;console.log('  ✓ '+name)}
try{
await check('공식 동명 ID를 직접 연결하고 선택한 행만 저장하며 재클릭으로 중복 생성하지 않는다',async()=>{
  await field('수업 CSV 내용').fill(csv())
  assert.equal((await writeCalls()).length,0)
  assert.equal(await field('학기 연결 · 1학기').inputValue(),'')
  await fill();await field('3행 수업 선택').uncheck();await confirm()
  await button('선택한 수업 2개 저장').evaluate(b=>{b.click();b.click()})
  await saved(2)
  const calls=await writeCalls()
  assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.args.p_command.input.label),['1반 국어','3반 국어'])
  assert.ok(calls.every(c=>c.args.p_command.input.subjectId==='subject-b'&&c.args.p_command.input.teacherMemberIds[0]==='teacher-b'))
  await button('목록 비교하기').click();await confirm();await button('선택한 수업 1개 저장').click();await saved(3)
  assert.equal((await writeCalls()).length,3)
})
await check('부분 성공 뒤 응답 유실이면 다음 행을 멈추고 재마운트 후 같은 번호로만 복구한다',async()=>{
  await fill();await confirm();await page.evaluate(()=>window.qa.failAt=2)
  await button('선택한 수업 3개 저장').click();await button('이 행을 같은 번호로 다시 확인').waitFor()
  assert.equal((await writeCalls()).length,2)
  assert.equal(await button('미저장 수업 CSV 내려받기').isDisabled(),true)
  assert.equal(await button('다른 화면').isDisabled(),true)
  await page.evaluate(()=>window.qa.remount());await button('이 행을 같은 번호로 다시 확인').waitFor()
  assert.equal(await field('수업 CSV 내용').inputValue(),csv())
  await button('이 행을 같은 번호로 다시 확인').click();await saved(2)
  const calls=await writeCalls();assert.deepEqual(calls[1],calls[2]);assert.equal(await page.evaluate(()=>window.qa.courses.length),2)
  await button('목록 비교하기').click();await confirm();await button('선택한 수업 1개 저장').click();await saved(3)
  assert.equal(await page.evaluate(()=>window.qa.pending.count()),0)
})
await check('결과 미상 재전송이 거절돼도 기존 번호·입력·이동 잠금을 버리지 않는다',async()=>{
  await fill(csv(['1반 국어']));await confirm();await page.evaluate(()=>window.qa.failAt=1)
  await button('선택한 수업 1개 저장').click();await button('이 행을 같은 번호로 다시 확인').waitFor()
  await page.evaluate(()=>window.qa.reject=true);await button('이 행을 같은 번호로 다시 확인').click()
  await page.waitForFunction(()=>window.qa.calls.filter(c=>c.name==='workhub_teaching_mutate').length===2)
  await button('이 행을 같은 번호로 다시 확인').waitFor()
  assert.equal(await page.evaluate(()=>window.qa.pending.count()),1);assert.equal(await button('다른 화면').isDisabled(),true)
  await page.evaluate(()=>window.qa.reject=false);await button('이 행을 같은 번호로 다시 확인').click();await saved(1)
  const calls=await writeCalls();assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0],calls[2])
})
await check('미리보기 뒤 공식 목록 변경은 전송 전에 멈추고 현재 목록 재확인을 요구한다',async()=>{
  await fill(csv(['1반 국어']));await confirm()
  await page.evaluate(()=>window.qa.courses.push({id:'already',schoolId:'school-a',version:1,label:'1반 국어',termId:'term-a',subjectId:'subject-b',assignmentId:'assignment-already',validFrom:'2027-03-01',validThrough:'2027-07-31',canRecord:true,canCounsel:true,canManageRoster:true}))
  await button('선택한 수업 1개 저장').click()
  await page.getByText('공식 학기·교과·담당 또는 수업 목록이 바뀌었습니다. 자료 새로 확인 후 목록을 다시 비교해 주세요.',{exact:true}).waitFor()
  assert.equal((await writeCalls()).length,0)
  await button('목록 비교하기').click()
  assert.equal(await field('2행 수업 선택').isDisabled(),true)
})
await check('기간 오류와 중복 행은 선택을 막고 나머지 정상 행만 저장한다',async()=>{
  await fill(csv(['중복','중복','정상'])+'\n기간 오류,1학기,국어,담당1,2027-02-28,2027-07-31')
  assert.equal(await field('2행 수업 선택').isDisabled(),true);assert.equal(await field('3행 수업 선택').isDisabled(),true);assert.equal(await field('5행 수업 선택').isDisabled(),true)
  await confirm();await button('선택한 수업 1개 저장').click();await saved(1)
  assert.equal((await writeCalls())[0].args.p_command.input.label,'정상')
})
await check('같은 계정에서 연결이 바뀌면 이전 늦은 응답을 무시하고 원래 번호 복구를 유지한다',async()=>{
  await fill(csv(['1반 국어']));await confirm();await page.evaluate(()=>window.qa.hold=true)
  await button('선택한 수업 1개 저장').click();await page.waitForFunction(()=>typeof window.qa.release==='function')
  await page.evaluate(()=>window.qa.replaceConnection());await page.locator('[data-connection-epoch="1"]').waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='이 행을 같은 번호로 다시 확인').disabled)
  await page.evaluate(()=>window.qa.release())
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(()=>window.qa.pending.count()),1)
  assert.ok((await page.locator('body').innerText()).includes('저장 확인 0개 · 결과 미확인 1개'))
  await button('이 행을 같은 번호로 다시 확인').click();await saved(1)
  const calls=await writeCalls();assert.deepEqual(calls[0],calls[1])
})
await check('학교·계정이 바뀌면 이전 완료 응답이나 CSV가 새 계정 화면에 나타나지 않는다',async()=>{
  await fill(csv(['이전 학교 수업']));await confirm();await page.evaluate(()=>window.qa.hold=true)
  await button('선택한 수업 1개 저장').click();await page.waitForFunction(()=>typeof window.qa.release==='function')
  await page.evaluate(()=>window.qa.switchAccount())
  // 이전 계정의 열린 메뉴를 새 화면으로 오인하지 않도록 React의 계정 전환 반영을 기다린다.
  await page.locator('[data-school-id="school-b"][data-member-id="member-b"]').waitFor()
  await openTeachingTools(page,'course');await button('수업 여러 개 등록').waitFor();await page.evaluate(()=>window.qa.release())
  await openTeachingTools(page,'course');await button('수업 여러 개 등록').click()
  assert.equal(await field('수업 CSV 내용').inputValue(),'')
  assert.equal(await page.getByText('이전 학교 수업',{exact:true}).count(),0)
  assert.ok((await page.locator('body').innerText()).includes('저장 확인 0개 ·'))
})
await check('파일 읽기 도중 저장이 완료돼도 늦은 파일이 명령·성공 목록을 덮어쓰지 않는다',async()=>{
  await fill(csv(['기존 입력']));await confirm();await page.evaluate(()=>window.qa.holdFile=true)
  await field('수업 CSV 파일').setInputFiles({name:'느린파일.csv',mimeType:'text/csv',buffer:Buffer.from(csv(['덮어쓰면 안 됨']))})
  await page.waitForFunction(()=>typeof window.qa.releaseFile==='function')
  await button('선택한 수업 1개 저장').click();await saved(1)
  await page.evaluate(()=>window.qa.releaseFile());await page.waitForTimeout(100)
  assert.equal(await field('수업 CSV 내용').inputValue(),csv(['기존 입력']))
  assert.ok((await page.locator('body').innerText()).includes('저장 확인 1개 ·'))
  assert.equal((await writeCalls())[0].args.p_command.input.label,'기존 입력')
})
await check('320px에서 표만 가로 스크롤되고 입력·복구 정보를 영속 저장소에 남기지 않는다',async()=>{
  await page.setViewportSize({width:320,height:740});await fill()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0})
  await page.setViewportSize({width:390,height:844})
})
assert.deepEqual(errors,[]);assert.deepEqual(external,[])
console.log(`수업 일괄 등록 브라우저 검증: ${passed}개 통과`)
}finally{await browser.close()}
