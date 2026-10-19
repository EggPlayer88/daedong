import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle=buildSync({stdin:{contents:readFileSync(new URL('./workhub-timetable-setup-fixture.tsx',import.meta.url),'utf8'),loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const output=process.env.WORKHUB_QA_OUTPUT||mkdtempSync(join(tmpdir(),'preparation-hours-connected-'));mkdirSync(output,{recursive:true})
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000)
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>'}))
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true}),apply=()=>button('선택한 시수를 준비 초안에 반영'),confirm=()=>field('선택한 시수와 기존 활동 합계를 확인했으며 준비 초안에 반영합니다')
const writes=()=>page.evaluate(()=>window.calls.filter(call=>call.name==='workhub_timetable_preparation_execute'))
let count=0
async function start(){await page.setViewportSize({width:1280,height:900});await page.goto('http://127.0.0.1:5179/preparation-hours-connected');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>{window.mode='preparation';window.root.unmount();window.mount()});await page.getByText('학교 편성 자료 준비',{exact:true}).click();await field('준비 자료 이름').waitFor();await page.getByText('엑셀로 주당 시수 한 번에 준비',{exact:true}).click()}
async function upload(){await button('준비 시수 엑셀 내려받기').click();const buffer=Buffer.from(await page.evaluate(async()=>{const sheets=window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer()));sheets.find(row=>row.name==='주당시수').rows.find(row=>row[0]==='course-a')[6]='3';return Array.from(window.writeTimetableXlsx(sheets))}));await field('준비 시수 엑셀 불러오기').setInputFiles({name:'주당시수.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});await apply().waitFor()}
async function test(name,run){await start();await run();count++;console.log('  ✓ '+name)}
try{
 await test('시수 미리보기는 다른 편집을 잠그고 선택 반영 뒤 기존 저장 경로만 사용한다',async()=>{
  await field('준비 자료 이름').fill('직접 입력한 제목');await upload();assert.equal(await field('준비 자료 이름').isDisabled(),true);assert.equal(await button('준비 초안 서버에 저장').isDisabled(),true);assert.equal((await writes()).length,0)
  await confirm().check();await apply().click();assert.equal(await field('준비 자료 이름').inputValue(),'직접 입력한 제목');await button('준비 초안 서버에 저장').click();await page.waitForFunction(()=>window.prepWrites===1)
  const sent=(await writes())[0].args.p_input,original=await page.evaluate(()=>window.initialPreparation.draft);assert.equal(sent.kind,'save');assert.equal(sent.draft.plans[0].weeklyPeriods,3);assert.deepEqual(sent.draft.slots,original.slots);assert.deepEqual(sent.draft.plans[0].blocks,original.plans[0].blocks);assert.deepEqual(sent.draft.plans[1],original.plans[1]);assert.equal(await page.evaluate(()=>window.actualWrites),0);assert.equal(await page.evaluate(()=>window.confirmed),0)
 })
 await test('가져온 시수 저장 응답이 끊겨도 원키·원명령으로 복구하고 중복 저장하지 않는다',async()=>{
  await upload();await confirm().check();await apply().click();await page.evaluate(()=>window.dropPrepOnce=true);await button('준비 초안 서버에 저장').click();await button('원래 준비 요청 결과 확인').waitFor();const first=(await writes())[0]
  await page.evaluate(()=>{window.failPrepRead=true;window.root.unmount();window.mount()});await button('원래 준비 요청 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0);const sent=await writes();assert.equal(sent.length,2);assert.equal(sent[1].args.p_recover_only,true);assert.equal(sent[1].args.p_request_key,first.args.p_request_key);assert.deepEqual(sent[1].args.p_input,first.args.p_input);assert.equal(await page.evaluate(()=>window.prepWrites),1)
 })
 await test('미반영 시수는 준비 화면 재진입에서 복원되고 승인을 다시 받아 적용한다',async()=>{
  await upload();await confirm().check();await page.evaluate(()=>{window.root.unmount();window.mount()});await apply().waitFor();assert.equal(await confirm().isChecked(),false);assert.equal(await field('준비 자료 이름').isDisabled(),true);assert.equal(await page.evaluate(()=>window.locked),true);assert.equal((await writes()).length,0);await confirm().check();await apply().click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('label')).find(label=>label.textContent==='준비 자료 이름')?.querySelector('input')?.matches(':enabled'));assert.equal(await field('준비 자료 이름').isEnabled(),true)
 })
 await test('준비 조회 장애에서 시수 파일을 보관하고 재조회 뒤에만 반영한다',async()=>{
  await upload();await confirm().check();await page.evaluate(()=>window.failPrepRead=true);await button('공식 자료 다시 확인').click();await page.waitForFunction(()=>document.body.textContent.includes('준비 조회 기능의 설치'));assert.equal(await apply().isDisabled(),true);await button('보관한 시수 파일 내려받기').click();assert.equal(await page.evaluate(async()=>window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())).find(row=>row.name==='주당시수').rows.find(row=>row[0]==='course-a')[6]),'3')
  await page.evaluate(()=>window.failPrepRead=false);await button('공식 자료 다시 확인').click();await field('준비 자료 이름').waitFor();assert.equal(await confirm().isChecked(),false);await confirm().check();await apply().click();assert.equal((await writes()).length,0)
 })
 await test('서버 초안 판이 바뀌면 가져온 파일로 덮어쓰지 않고 비교·기존 입력을 유지한다',async()=>{
  await field('준비 자료 이름').fill('내가 편집한 시수와 일과');await upload();await page.evaluate(()=>window.savedPreparation.revision++);await button('공식 자료 다시 확인').click();await page.getByText(/서버의 준비 초안 판이 바뀌었습니다/).waitFor();assert.equal(await apply().isDisabled(),true);assert.equal((await writes()).length,0);await button('시수 파일 미리보기 정리').click();await button('미반영 시수 버리기').click();assert.equal(await button('준비 초안 서버에 저장').isDisabled(),true);assert.equal(await field('준비 자료 이름').inputValue(),'내가 편집한 시수와 일과')
 })
 await test('파일 비교만 남은 상태에서 서버 초안이 갱신되면 옛 파일 반영을 차단한다',async()=>{
  await upload();await page.evaluate(()=>{window.savedPreparation.revision++;window.savedPreparation.draft.title='다른 담당자가 저장한 제목'});await button('공식 자료 다시 확인').click();await field('준비 자료 이름').waitFor();await page.getByText(/학교 자료나 준비 초안이 바뀌어 반영을 멈췄습니다/).waitFor();assert.equal(await field('준비 자료 이름').inputValue(),'다른 담당자가 저장한 제목');assert.equal(await apply().isDisabled(),true);assert.equal((await writes()).length,0);await button('보관한 시수 파일 내려받기').click();assert.equal(await page.evaluate(async()=>window.readTimetableXlsx(new Uint8Array(await window.lastBlob.arrayBuffer())).find(row=>row.name==='주당시수').rows.find(row=>row[0]==='course-a')[6]),'3')
 })
 await test('입력 점검은 정확한 수업 ID의 편집 영역을 열고 키보드 초점을 옮긴다',async()=>{
  await page.getByText('확인할 수업 찾아가기',{exact:true}).click();await field('입력 점검 분류').selectOption('resources');await button('국어 1학년 [course-a] 입력으로 이동').click();assert.equal(await field('준비할 수업 검색').inputValue(),'course-a');assert.equal(await page.locator('details[aria-label="국어 1학년 [course-a] 준비 편집"]').evaluate(node=>node.open),true);assert.equal(await page.evaluate(()=>document.activeElement.parentElement.getAttribute('aria-label')),'국어 1학년 [course-a] 준비 편집');assert.equal(await field('주간 기준 시수').count(),1);assert.equal((await writes()).length,0)
 })
 await test('시수 반영 뒤 활동 합계 불일치를 표시하고 교사별 합계를 갱신한다',async()=>{
  await upload();await confirm().check();await apply().click();await page.getByText('확인할 수업 찾아가기',{exact:true}).click();await field('입력 점검 분류').selectOption('activities');await button('국어 1학년 [course-a] 입력으로 이동').waitFor();await page.getByText('교사·학급별 배정 시수 보기',{exact:true}).click();await field('시수 요약 검색').fill('teacher-a');await page.getByText('연결 수업 1개 · 입력된 시수 합계 3차시',{exact:true}).waitFor();assert.equal(await button('확인한 편성 기준판 만들기').isDisabled(),true);assert.equal((await writes()).length,0)
 })
 await test('320px와 200% 글자에서도 시수 비교와 점검 목록을 가로 밀림 없이 사용한다',async()=>{
  await upload();await page.setViewportSize({width:320,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));await page.screenshot({path:join(output,'preparation-hours-connected-mobile.png'),fullPage:true});await confirm().check();await apply().click();await page.getByText('확인할 수업 찾아가기',{exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));await page.screenshot({path:join(output,'preparation-progress-mobile.png'),fullPage:true})
 })
 assert.deepEqual(errors,[]);console.log(`시수 엑셀·점검 실제 준비 화면 연결: ${count}개 통과`)
}finally{await browser.close()}
