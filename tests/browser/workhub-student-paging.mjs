// 실제 학생 화면·저장소에 합성 자료 1,000건을 넣어 DOM 수와 화면 밖 근거 검증을 함께 확인한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const bundle=buildSync({stdin:{contents:`
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StudentsPanel}from'./apps/workhub/src/students/StudentsPanel';
  import{EditSession}from'./apps/workhub/src/app/EditSession';import{createStudentStore}from'./apps/workhub/src/students/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';
  import theme from'./apps/workhub/src/style.css?inline';import css from'./apps/workhub/src/students/students.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate,teacher=members.find(row=>row.id==='gaon-soyeon'),qa=window.qa={};let store,course,student;
  function seed(count=1000){
    const initial=createStudentStore({members,date});course=initial.listCourses(teacher.id)[0];student=initial.listStudents(teacher.id,course.id)[0];
    const record=initial.createObservation(teacher.id,{studentId:student.id,enrollmentId:student.enrollmentId,courseId:course.id,observedAt:date,activity:'합성 대량 관찰',content:'직접 확인한 사실',confirmed:true},'seed');
    const source=initial.receiveActivity(teacher.id,{eventId:'seed-source',sourceSystem:'synthetic-scale',activityId:'synthetic-activity',itemId:'seed-item',revision:1,operation:'upsert',courseId:course.id,occurredAt:date,questionVersion:'q1',question:'합성 질문',answer:'직접 확인할 합성 응답',alias:'합성 별명'});
    initial.confirmMapping(teacher.id,source.id,1,student.id,student.enrollmentId,0,'seed-map');const mapped=initial.listActivities(teacher.id)[0],snapshot=initial.exportState();snapshot.receipts=[];snapshot.serial=10000;
    snapshot.sources=Array.from({length:count},(_,index)=>({id:'scale-source-'+String(index).padStart(4,'0'),schoolId:teacher.schoolId,ownerUserId:teacher.userId,revisions:[{...mapped.current,eventId:'source-event-'+index,itemId:'source-item-'+index,alias:'합성 별명 '+index}],mappings:mapped.mappings}));
    snapshot.observations=Array.from({length:count},(_,index)=>({id:'scale-record-'+String(index).padStart(4,'0'),schoolId:teacher.schoolId,authorUserId:teacher.userId,authorMemberId:teacher.id,revisions:[1,2,3].map(version=>({...record.current,version,createdAt:'2026-10-01T00:00:00Z',reason:'합성 개정 '+version,activity:'합성 관찰 '+index,content:'합성 사실 '+index+' 판 '+version,...(index===count-1?{source:{sourceId:snapshot.sources[index].id,sourceRevision:1,mappingRevision:1}}:{})}))}));
    store=createStudentStore({members,date,snapshot});qa.started=performance.now();qa.downloads=[];qa.failRead='';
  }
  seed();qa.records=()=>store.listRecords(teacher.id);qa.ids=()=>({student:student.id,course:course.id});
  qa.changeLastSource=()=>{const source=store.listActivities(teacher.id).at(-1);store.receiveActivity(teacher.id,{...source.current,eventId:'external-source-update',revision:source.current.revision+1,answer:'외부에서 갱신된 원문'})};
  qa.shrink=count=>{const snapshot=store.exportState();snapshot.observations=snapshot.observations.slice(0,count);snapshot.sources=snapshot.sources.slice(0,count);snapshot.receipts=[];store=createStudentStore({members,date,snapshot})};
  qa.backdateRecord=()=>{const snapshot=store.exportState(),record=snapshot.observations[23];record.revisions=record.revisions.map(revision=>({...revision,observedAt:'2026-09-01'}));store=createStudentStore({members,date,snapshot});return record.id};
  URL.createObjectURL=blob=>{qa.downloads.push(blob);return'blob:synthetic-test'};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){};
  function App(){const[generation,setGeneration]=useState(0),[revision,setRevision]=useState(0),[member,setMember]=useState(teacher),[scope,setScope]=useState(members),[locked,setLocked]=useState(false);
    qa.refresh=()=>setRevision(value=>value+1);qa.reset=(count=1000)=>{seed(count);setGeneration(value=>value+1);setMember(teacher);setScope(members);return generation+1};qa.switch=id=>setMember(members.find(row=>row.id===id));qa.revoke=()=>{const revoked={...teacher,active:false};setMember(revoked);setScope(members.map(row=>row.id===teacher.id?revoked:row))};
    const viewStore={...store,listCourses(...args){if(qa.failRead==='courses')throw new Error('합성 수업 조회 실패');return store.listCourses(...args)},listActivities(...args){if(qa.failRead==='activities')throw new Error('합성 활동 조회 실패');return store.listActivities(...args)}};
    return <><style>{theme}{css}</style><main data-generation={generation} data-revision={revision} data-locked={locked}><EditSession key={generation} onLockChange={setLocked}><StudentsPanel member={member} members={scope} date={date} store={viewStore}/></EditSession></main></>
  }createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1050}}),results=[],errors=[],metrics={},output=process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});if(output)mkdirSync(output,{recursive:true})
const records=()=>page.locator('.students-record'),sources=()=>page.locator('.students-source'),recordNav=()=>page.getByRole('navigation',{name:'관찰 기록 페이지',exact:true}),sourceNav=()=>page.getByRole('navigation',{name:'수업 활동 페이지',exact:true})
async function test(name,run){await run();results.push(name);console.log('  ✓ '+name)}
async function reset(count=1000){const generation=await page.evaluate(value=>qa.reset(value),count);await page.waitForFunction(value=>document.querySelector('main').dataset.generation===String(value)&&document.querySelector('main').dataset.locked==='false',generation);await page.getByLabel('활동',{exact:true}).waitFor()}
async function inbox(){await page.getByRole('button',{name:/^수업 활동 받은함/}).click();await sources().first().waitFor()}
async function activate(locator){await locator.focus();await page.keyboard.press('Enter')}
async function focus(locator){assert.equal(await locator.evaluate(node=>node===(node.getRootNode().activeElement??document.activeElement)),true)}
async function capture(label){if(output)await page.screenshot({path:join(output,'student-paging-'+label+'.png'),fullPage:true})}
async function measure(label,selector){metrics[label]=await page.evaluate(selector=>({cards:document.querySelectorAll(selector).length,elements:document.querySelectorAll('.students-panel *').length,historyItems:document.querySelectorAll('.students-history li').length,elapsedMs:Math.round((performance.now()-qa.started)*10)/10}),selector)}
try{
  await page.setContent('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>');await page.addScriptTag({content:bundle});await records().first().waitFor()
  await test('실제 저장소의 관찰 1,000건은 20개 카드로 표시하고 전체 집계는 1,000건이다',async()=>{
    assert.equal(await records().count(),20);assert.equal(await page.getByRole('button',{name:'전체 기록 1000건 보기',exact:true}).count(),1);assert((await recordNav().innerText()).includes('1–20개 표시'));assert.equal(await page.locator('.students-history li').count(),0);await measure('records1000','.students-record');assert(metrics.records1000.elements<1000);await capture('records-desktop')
  })
  await test('이력은 펼친 기록만 생성하고 닫으면 해당 DOM을 회수한다',async()=>{
    const first=records().first();await activate(first.locator('summary'));await first.locator('.students-history li').first().waitFor();assert.equal(await page.locator('.students-history li').count(),3);await activate(first.locator('summary'));await page.waitForFunction(()=>document.querySelectorAll('.students-history li').length===0)
  })
  await test('키보드로 다음·마지막 쪽을 열면 전체 순번이 이어지고 목록 제목으로 초점이 간다',async()=>{
    const started=Date.now();await activate(recordNav().getByRole('button',{name:'다음',exact:true}));await page.getByRole('region',{name:/^관찰 기록 21 ·/}).waitFor();metrics.recordsNextPageMs=Date.now()-started;await focus(page.getByRole('heading',{name:'내 관찰 기록',exact:true}));await recordNav().getByRole('button',{name:'마지막',exact:true}).click();assert((await recordNav().innerText()).includes('981–1,000개 표시'));assert.equal(await records().count(),20);assert.equal(await page.getByRole('region',{name:/^관찰 기록 1000 ·/}).count(),1);assert(await recordNav().getByRole('button',{name:'다음',exact:true}).isDisabled())
  })
  await test('활동 입력과 철회 사유가 쪽 이동으로 사라지지 않는다',async()=>{
    await reset();await page.getByLabel('활동',{exact:true}).fill('저장 전 입력');await recordNav().getByRole('button',{name:'다음',exact:true}).click();assert((await recordNav().innerText()).includes('1–20개 표시'));assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'저장 전 입력');await page.getByRole('button',{name:'기록 입력 취소',exact:true}).click()
    const first=records().first();await first.getByRole('button',{name:'철회하기',exact:true}).click();await first.getByLabel('철회 사유',{exact:true}).fill('보관할 사유');await recordNav().getByRole('button',{name:'마지막',exact:true}).click();assert.equal(await first.getByLabel('철회 사유',{exact:true}).inputValue(),'보관할 사유');assert((await recordNav().innerText()).includes('1–20개 표시'));await first.getByRole('button',{name:'철회 입력 취소',exact:true}).click()
  })
  await test('필터·학생을 바꾸면 첫 쪽에서 다시 시작하고 없어진 마지막 쪽에 머무르지 않는다',async()=>{
    await reset();await recordNav().getByRole('button',{name:'마지막',exact:true}).click();await page.getByLabel('기록 종류',{exact:true}).selectOption('direct');assert((await recordNav().innerText()).includes('1–20개 표시'));assert((await recordNav().innerText()).includes('999개'));await page.getByRole('button',{name:'조회 조건 초기화',exact:true}).click();await recordNav().getByRole('button',{name:'마지막',exact:true}).click();await page.locator('.students-roster button').nth(1).click();assert.equal(await records().count(),0);await page.locator('.students-roster button').first().click();assert((await recordNav().innerText()).includes('1–20개 표시'))
    await recordNav().getByRole('button',{name:'마지막',exact:true}).click();await page.evaluate(()=>{qa.shrink(21);qa.refresh()});assert.equal(await records().count(),1);assert((await recordNav().innerText()).includes('21–21개 표시'));await recordNav().getByRole('button',{name:'처음',exact:true}).click();assert.equal(await records().count(),20)
  })
  await test('둘째 쪽 기록 정정을 취소하면 원기록 쪽과 초점으로 돌아간다',async()=>{
    await reset();await recordNav().getByRole('button',{name:'다음',exact:true}).click();const target=records().nth(3),id=await target.getAttribute('data-student-record-id');await target.getByRole('button',{name:'정정하기',exact:true}).click();await page.getByLabel('직접 확인한 사실',{exact:true}).fill('정정 중인 내용');await recordNav().getByRole('button',{name:'마지막',exact:true}).click();assert((await recordNav().innerText()).includes('21–40개 표시'));await page.getByRole('button',{name:'정정 취소',exact:true}).click();await focus(page.locator('[data-student-record-id="'+id+'"]'));assert((await recordNav().innerText()).includes('21–40개 표시'))
  })
  await test('과거 관찰 정정으로 수업 기준일과 쪽이 바뀌어도 취소는 원기록이 있는 쪽으로 돌아간다',async()=>{
    await reset();const id=await page.evaluate(()=>{const id=qa.backdateRecord();qa.refresh();return id});await recordNav().getByRole('button',{name:'마지막',exact:true}).click();await page.locator('[data-student-record-id="'+id+'"]').getByRole('button',{name:'정정하기',exact:true}).click();assert.equal(await page.getByLabel('수업 기준일',{exact:true}).inputValue(),'2026-09-01');assert((await recordNav().innerText()).includes('1–20개 표시'));await page.getByRole('button',{name:'정정 취소',exact:true}).click();await page.locator('[data-student-record-id="'+id+'"]:focus').waitFor();assert((await recordNav().innerText()).includes('981–1,000개 표시'))
  })
  await test('정정 저장 후 최신 정렬의 다른 쪽으로 이동해 저장 원기록을 정확히 연다',async()=>{
    await reset();await recordNav().getByRole('button',{name:'마지막',exact:true}).click();const target=records().first(),id=await target.getAttribute('data-student-record-id');await target.getByRole('button',{name:'정정하기',exact:true}).click();await page.getByLabel('직접 확인한 사실',{exact:true}).fill('최신 확인된 정정 사실');await page.getByLabel('정정 사유',{exact:true}).fill('관찰 내용 보완');await page.getByRole('checkbox',{name:'직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.',exact:true}).check();await page.getByRole('button',{name:'새 개정본 저장',exact:true}).click();await page.getByRole('button',{name:'저장한 기록 보기',exact:true}).click();await page.locator('[data-student-record-id="'+id+'"]:focus').waitFor();assert((await recordNav().innerText()).includes('1–20개 표시'));assert((await records().first().innerText()).includes('최신 확인된 정정 사실'))
  })
  await test('유효 근거 마지막 한 건 철회는 마지막 쪽을 줄이고 목록 제목에 초점을 유지한다',async()=>{
    await reset(21);await page.getByRole('button',{name:'유효 근거 21건 보기',exact:true}).click();await recordNav().getByRole('button',{name:'마지막',exact:true}).click();await records().first().getByRole('button',{name:'철회하기',exact:true}).click();await records().first().getByLabel('철회 사유',{exact:true}).fill('사실 재확인');await records().first().getByRole('button',{name:'사유와 함께 철회',exact:true}).click();assert.equal(await records().count(),20);assert.equal(await recordNav().count(),0);await focus(page.getByRole('heading',{name:'내 관찰 기록',exact:true}))
  })
  await test('근거 텍스트는 화면의 20개가 아닌 전체 1,000개를 포함한다',async()=>{
    await reset();await page.getByRole('button',{name:'근거 목록 텍스트 보기',exact:true}).click();const value=await page.getByLabel('나의 근거 목록',{exact:true}).inputValue();assert(value.includes('본인 유효 기록: 1000건'));assert(value.includes('[scale-record-0999@v3]'));assert(value.includes('합성 사실 999 판 3'));await page.getByRole('button',{name:'텍스트 파일 내려받기',exact:true}).click();assert.equal(await page.evaluate(()=>qa.downloads.length),1)
  })
  await test('화면 밖 1,000번째 원자료가 바뀌면 전체 재검토 집계와 내보내기 차단에 즉시 반영된다',async()=>{
    await page.evaluate(()=>{qa.changeLastSource();qa.refresh()});assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'원자료 재검토 1건 보기',exact:true}).count(),1);assert.equal(await records().count(),20);await page.getByRole('button',{name:'근거 목록 텍스트 보기',exact:true}).click();await page.getByRole('alert').filter({hasText:'원자료가 바뀐 기록'}).waitFor();assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0)
  })
  await test('수업 활동 1,000건도 20개만 생성하고 페이지 순번·초점이 유지된다',async()=>{
    await reset();const started=Date.now();await inbox();metrics.activitiesOpenMs=Date.now()-started;assert.equal(await sources().count(),20);assert((await sourceNav().innerText()).includes('1,000개'));await measure('activities1000','.students-source');assert(metrics.activities1000.elements<1600);await sourceNav().getByRole('button',{name:'다음',exact:true}).click();assert.equal(await page.getByRole('region',{name:/^수업 활동 21 ·/}).count(),1);await focus(page.getByRole('heading',{name:'수업 활동 받은함',exact:true}));await sourceNav().getByRole('button',{name:'마지막',exact:true}).click();assert((await sourceNav().innerText()).includes('981–1,000개 표시'));await capture('activities-desktop')
  })
  await test('활동 사실·미확정 학생 선택은 쪽 이동을 막고 취소 후 이동을 허용한다',async()=>{
    await reset();await inbox();const first=sources().first();await first.getByLabel('교사가 확인한 관찰 사실',{exact:true}).fill('채택 전 사실');await sourceNav().getByRole('button',{name:'다음',exact:true}).click();assert.equal(await first.getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'채택 전 사실');assert((await sourceNav().innerText()).includes('1–20개 표시'));await first.getByRole('button',{name:'활동 입력 취소',exact:true}).click();await first.getByLabel('교사가 확인한 학생',{exact:true}).selectOption({label:'2번 · 가상 학생 나'});await sourceNav().getByRole('button',{name:'마지막',exact:true}).click();assert((await sourceNav().innerText()).includes('1–20개 표시'));await first.getByLabel('교사가 확인한 학생',{exact:true}).selectOption(await page.evaluate(()=>qa.ids().student));await sourceNav().getByRole('button',{name:'다음',exact:true}).click();assert((await sourceNav().innerText()).includes('21–40개 표시'))
  })
  await test('둘째 쪽 활동 작성 중 수업·활동 조회가 실패해도 복구 후 같은 쪽 입력을 취소하거나 이어 쓸 수 있다',async()=>{
    for(const failure of['courses','activities']){
      await reset();await inbox();await sourceNav().getByRole('button',{name:'다음',exact:true}).click();await sources().first().getByLabel('교사가 확인한 관찰 사실',{exact:true}).fill('둘째 쪽에서 보관한 입력');await page.evaluate(value=>{qa.failRead=value;qa.refresh()},failure);await page.getByRole('alert').filter({hasText:/합성 (수업|활동) 조회 실패/}).waitFor();assert.equal(await sources().count(),0);assert.equal(await page.locator('main').getAttribute('data-locked'),'true')
      await page.evaluate(()=>qa.failRead='');await page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}).click();assert((await sourceNav().innerText()).includes('21–40개 표시'));assert.equal(await sources().first().getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'둘째 쪽에서 보관한 입력');await sourceNav().getByRole('button',{name:'다음',exact:true}).click();assert((await sourceNav().innerText()).includes('21–40개 표시'));await sources().first().getByRole('button',{name:'활동 입력 취소',exact:true}).click();await sourceNav().getByRole('button',{name:'다음',exact:true}).click();assert((await sourceNav().innerText()).includes('41–60개 표시'))
    }
  })
  await test('활동 마지막 쪽 소멸·학교 소속 변경·권한 종료는 이전 자료를 남기지 않는다',async()=>{
    await reset();await inbox();await sourceNav().getByRole('button',{name:'마지막',exact:true}).click();await page.evaluate(()=>{qa.shrink(21);qa.refresh()});assert.equal(await sources().count(),1);assert((await sourceNav().innerText()).includes('21–21개 표시'));await page.evaluate(()=>qa.switch('nuri-soyeon'));assert.equal(await sources().count(),0);assert.equal(await records().count(),0);await page.evaluate(()=>qa.switch('gaon-soyeon'));assert.equal(await records().count(),20);assert((await recordNav().innerText()).includes('1–20개 표시'));await page.evaluate(()=>qa.revoke());await page.getByRole('alert').filter({hasText:'현재 학교 소속이 종료'}).waitFor();assert.equal(await records().count(),0);assert.equal(await sources().count(),0);assert.equal(await recordNav().count(),0)
  })
  await test('320px 목록과 쪽 버튼을 키보드로 조작하고 가로 넘침 없이 읽는다',async()=>{
    await reset();await page.setViewportSize({width:320,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await activate(recordNav().getByRole('button',{name:'다음',exact:true}));await focus(page.getByRole('heading',{name:'내 관찰 기록',exact:true}));await capture('records-320');await inbox();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await activate(sourceNav().getByRole('button',{name:'다음',exact:true}));await focus(page.getByRole('heading',{name:'수업 활동 받은함',exact:true}));await capture('activities-320');assert.deepEqual(errors,[])
  })
  if(output)writeFileSync(join(output,'student-paging-results.json'),JSON.stringify({results,errors,metrics,scope:'합성 기록·활동 각각 1,000건의 실제 React DOM 검사. 시간은 이 기기의 참고 측정이며 서버 성능 보장이 아니다.'},null,2));console.log(`학생 목록 페이지 브라우저 ${results.length}개 통과`);console.log(JSON.stringify(metrics))
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-6000));if(output)await capture('failure');process.exitCode=1}finally{await browser.close()}
