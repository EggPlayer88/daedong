import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({stdin:{contents:readFileSync(new URL('./workhub-timetable-target-connected-fixture.tsx',import.meta.url),'utf8'),loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const output=process.env.WORKHUB_QA_OUTPUT||mkdtempSync(join(tmpdir(),'workhub-target-connected-'));mkdirSync(output,{recursive:true})
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'}))
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true}),target=()=>page.getByRole('combobox',{name:'준비할 학기 선택',exact:true})
const called=name=>page.evaluate(name=>window.calls.filter(row=>row.name===name),name)
const writes=()=>called('workhub_timetable_setup_execute'),targetWrites=()=>called('workhub_timetable_target_set')
// 자식 편집 상태가 준비 패널과 Workspace를 거쳐 반영된 뒤 잠금 자체를 확인한다.
// 단순 지연이나 재시도로 실패를 넘기지 않으며, 잠금이 누락되면 제한 시간 안에 실패한다.
async function waitForTargetLock(locked=true){
 await page.waitForFunction(locked=>{const select=document.querySelector('section[aria-label="준비할 학기 선택"] select');return select instanceof HTMLSelectElement&&select.disabled===locked},locked)
 assert.equal(await target().isDisabled(),locked)
}
async function openPreparation(){await page.getByText('학교 편성 자료 준비',{exact:true}).click();await field('준비 자료 이름').waitFor()}
async function openSetup(){await openPreparation();await page.getByText('공간·수업 연결 관리',{exact:true}).click();await button('공간 추가').waitFor()}
async function changeTarget(){await target().selectOption('next');await field('학교 전체의 준비 대상이 바뀌며, 저장한 기존 학기 자료는 유지됨을 확인했습니다').check();await button('확인한 학기로 변경').click()}
async function editSpace(){await openSetup();await page.getByRole('listitem',{name:'과학실 [room-used]',exact:true}).getByRole('button',{name:'공간 수정',exact:true}).click();await field('공간 이름').fill('보존할 과학실 입력')}
async function saveSpace(){await button('변경 내용 확인').click();await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click()}
let count=0
async function test(name,run,options={}){await page.goto('http://127.0.0.1:5179/target-connected');await page.evaluate(options=>window.testOptions=options,options);await page.addScriptTag({content:bundle.outputFiles[0].text});if(!options.legacy)await target().waitFor();try{await run();count++;console.log('  ✓ '+name)}catch(error){writeFileSync(join(output,'failure.html'),await page.content());await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error}}
try{
 await test('기준판이 없어도 다음 학기를 선택한 뒤 해당 준비와 공간 자료를 연다',async()=>{
  await page.getByRole('heading',{name:'시간표 기초 자료를 준비하고 있습니다',exact:true}).waitFor();await changeTarget();await page.waitForFunction(()=>window.targetWrites===1&&window.pending.count()===0)
  await openSetup();await page.getByRole('listitem',{name:'다음학기 과학실 [room-used]',exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/2027학년도 1학기/)
  assert.equal((await targetWrites()).length,1);assert.equal((await writes()).length,0);assert.equal(await page.evaluate(()=>window.readDraft('timetable-preparation').termId),'next')
 })
 await test('준비 초안 입력이 있으면 학기 선택을 잠그고 입력을 보존한다',async()=>{
  await openPreparation();await field('준비 자료 이름').fill('아직 저장하지 않은 일과');await page.waitForFunction(()=>document.querySelector('section[aria-label="준비할 학기 선택"] select').disabled)
  await waitForTargetLock();assert.equal((await targetWrites()).length,0);assert.equal(await page.evaluate(()=>window.readDraft('timetable-preparation').draft.title),'아직 저장하지 않은 일과')
 })
 await test('공간 편집과 엑셀 변경 미리보기 중에는 학교 공통 학기를 바꾸지 않는다',async()=>{
  const originalTarget=await target().inputValue();await editSpace();await waitForTargetLock()
  assert.equal(await field('공간 이름').inputValue(),'보존할 과학실 입력');assert.equal(await page.evaluate(()=>window.readDraft('timetable-setup').input.label),'보존할 과학실 입력')
  assert.equal(await target().inputValue(),originalTarget);assert.equal((await targetWrites()).length,0);assert.equal((await writes()).length,0)
  await button('편집 입력 정리').click();await button('입력 버리고 닫기').click();await waitForTargetLock(false)
  await page.getByText('엑셀로 공간·수업 연결 한 번에 준비',{exact:true}).click();const bytes=Buffer.from(await page.evaluate(()=>window.makeBatchFile()));await field('편집한 준비 입력 엑셀 가져오기').setInputFiles({name:'편집.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes})
  await button('선택한 항목 순서대로 저장').waitFor();await waitForTargetLock();assert.equal(await target().inputValue(),originalTarget);assert.equal((await targetWrites()).length,0);assert.equal((await writes()).length,0)
 })
 await test('아직 추가하지 않은 조건 선택도 학기 전환을 잠근다',async()=>{
  await button('시간표 만들기').click();await button('조건 정리').click();await field('조건 수업').selectOption('practice-lesson-a1')
  await waitForTargetLock();assert.equal((await targetWrites()).length,0)
 },{basis:true})
 await test('Claude에 아직 보내지 않은 질문을 보관하고 학기 전환을 잠근다',async()=>{
  await page.getByText('Claude와 조건 정리하기',{exact:true}).click();await field('시간표 조건 요청').fill('보존할 다음 학기 조건 질문')
  await page.waitForFunction(()=>document.querySelector('section[aria-label="준비할 학기 선택"] select').disabled)
  await waitForTargetLock();assert.equal((await targetWrites()).length,0)
 },{basis:true})
 await test('다른 담당자가 학기를 바꾸면 포커스 재조회 후 옛 준비 입력을 새 학기에 저장하지 않는다',async()=>{
  await openPreparation();await field('준비 자료 이름').fill('이전 학기 보관 초안');await page.evaluate(()=>{window.externalSelect('next');window.dispatchEvent(new Event('focus'))})
  await page.getByText(/학교의 준비 대상 학기가 바뀌어 자료를 다시 확인합니다/).waitFor();await page.waitForFunction(()=>window.calls.filter(row=>row.name==='workhub_timetable_preparation_get').length>=2)
  assert.equal(await page.evaluate(()=>window.readDraft('timetable-preparation').draft.title),'이전 학기 보관 초안');assert.equal(await page.evaluate(()=>window.readDraft('timetable-preparation').termId),'term')
  assert.equal(await button('준비 초안 서버에 저장').count()===0||await button('준비 초안 서버에 저장').isDisabled(),true)
  assert.equal((await called('workhub_timetable_preparation_execute')).length,0)
 })
 await test('학기 변경을 몰랐어도 공간 저장 직전 대상 재확인에서 차단한다',async()=>{
  await editSpace();await button('변경 내용 확인').click();await field('변경 내용을 확인했습니다').check();await page.evaluate(()=>window.externalSelect('next'));await button('확인한 내용 저장').click()
  await page.waitForFunction(()=>window.calls.filter(row=>row.name==='workhub_timetable_target_get').length>=2)
  await page.getByRole('alert').first().waitFor();assert.equal((await writes()).length,0);assert.equal(await page.evaluate(()=>window.readDraft('timetable-setup').input.label),'보존할 과학실 입력')
 })
 await test('학기 변경 응답 유실은 원래 요청 번호로만 확인하고 그 전에는 준비 쓰기를 막는다',async()=>{
  await page.evaluate(()=>window.targetDrop=true);await changeTarget();await button('원래 학기 변경 결과 확인').waitFor();const sent=await targetWrites()
  assert.equal(sent.length,1);await waitForTargetLock();assert.equal(await page.evaluate(()=>window.pending.count()),1)
  await button('원래 학기 변경 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0);await openSetup();await page.getByRole('listitem',{name:'다음학기 과학실 [room-used]',exact:true}).waitFor()
  const recovered=await targetWrites();assert.equal(recovered.length,2);assert.equal(recovered[1].args.p_request_key,sent[0].args.p_request_key);assert.equal(recovered[1].args.p_recover_only,true);assert.equal(await page.evaluate(()=>window.targetWrites),1);assert.equal((await writes()).length,0)
 })
 await test('이전 학기의 공간 저장 결과 미상도 대상 변경 뒤 원래 번호로만 복구한다',async()=>{
  await editSpace();await page.evaluate(()=>window.dropOnce=true);await saveSpace();await button('원래 저장 요청 결과 확인').waitFor();const sent=await writes()
  assert.equal(sent.length,1);assert.equal(await page.evaluate(()=>window.actualWrites),1);await waitForTargetLock()
  await page.evaluate(()=>{window.externalSelect('next');window.dispatchEvent(new Event('focus'))});await page.getByText(/학교의 준비 대상 학기가 바뀌어 자료를 다시 확인합니다/).waitFor()
  await button('원래 저장 요청 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0)
  const recovered=await writes();assert.equal(recovered.length,2);assert.equal(recovered[1].args.p_request_key,sent[0].args.p_request_key);assert.deepEqual(recovered[1].args.p_command,sent[0].args.p_command);assert.equal(recovered[1].args.p_recover_only,true)
  assert.equal(await page.evaluate(()=>window.actualWrites),1);assert.equal(await page.evaluate(()=>window.views.term.spaces[0].label),'보존할 과학실 입력');assert.equal(await page.evaluate(()=>window.views.next.spaces[0].label),'다음학기 과학실')
 })
 await test('대상 학기 RPC가 없는 이전 T1에서도 기존 준비 조회와 저장은 계속 동작한다',async()=>{
  await page.getByText(/준비 학기 선택 기능을 연결 중입니다/).waitFor();await editSpace();await saveSpace();await page.waitForFunction(()=>window.actualWrites===1&&window.pending.count()===0)
  assert.equal((await writes()).length,1);assert.equal((await targetWrites()).length,0)
 },{legacy:true})
 await test('준비 대상은 다음 학기여도 공개 운영 조회는 요청 기간을 유지하고 target 설정을 보내지 않는다',async()=>{
  await changeTarget();await page.waitForFunction(()=>window.pending.count()===0);await button('확정·공유·교환').click();await page.getByRole('heading',{name:'시간표 운영',exact:true}).waitFor();await page.waitForFunction(()=>window.calls.some(row=>row.name==='workhub_timetable_operations_get'))
  const calls=await called('workhub_timetable_operations_get');assert.equal(calls[0].args.p_from,'2026-10-19');assert.equal(calls[0].args.p_input,undefined);assert.equal(calls[0].args.p_term_id,undefined)
  assert.equal(await page.evaluate(()=>window.target.termId),'next');assert.equal((await targetWrites()).length,1)
 })
 assert.deepEqual(errors,[]);console.log(`시간표 대상 학기 Workspace 연결 브라우저 검사: ${count}개 통과`)
}finally{await browser.close()}
