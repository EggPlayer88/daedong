// 실제 학생 화면을 합성 메모리 저장소와 렌더한다. 학교 서버·학생 자료를 사용하지 않는다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const bundle=buildSync({stdin:{contents:`
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {StudentsPanel} from './apps/workhub/src/students/StudentsPanel';
  import {EditSession} from './apps/workhub/src/app/EditSession';
  import {createStudentStore,createStudentFixture} from './apps/workhub/src/students/store';
  import {fixtureData} from './apps/workhub/src/preview/fixtures';
  import theme from './apps/workhub/src/style.css?inline';import css from './apps/workhub/src/students/students.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate,teacher=members.find(m=>m.id==='gaon-soyeon');
  let store,course,roster,source,event,first,second,adopted;
  function seed(ended=false){
    const snapshot=createStudentFixture(members,date);
    if(ended){const e=snapshot.enrollments[0];e.until=date;snapshot.courseMemberships.filter(m=>m.enrollmentId===e.id).forEach(m=>m.until=date)}
    store=createStudentStore({members,date,snapshot});course=store.listCourses(teacher.id)[0];roster=store.listStudents(teacher.id,course.id,ended?'2026-09-30':date);
    const draft=(s,changes={})=>({courseId:course.id,studentId:s.id,enrollmentId:s.enrollmentId,observedAt:ended?'2026-09-30':date,activity:'출처 확인 토의',content:'본인 확인 원문',confirmed:true,...changes});
    first=store.createObservation(teacher.id,draft(roster[0],{observedAt:'2026-09-01',content:'첫 학생의 직접 관찰'}),'first');
    second=store.createObservation(teacher.id,draft(roster[1],{content:'둘째 학생의 직접 관찰'}),'second');
    const withdrawn=store.createObservation(teacher.id,draft(roster[0],{content:'철회된 학생 기록'}),'withdrawn');store.withdrawObservation(teacher.id,withdrawn.id,1,'사실 재확인','withdraw');
    event={eventId:'s1',sourceSystem:'synthetic-lesson',activityId:'share',itemId:'response',revision:1,operation:'upsert',courseId:course.id,occurredAt:ended?'2026-09-30':date,questionVersion:'q1',question:'자료를 공유할 때?',answer:'출처를 확인합니다.',alias:'가상 별명 A'};
    source=store.receiveActivity(teacher.id,event);store.confirmMapping(teacher.id,source.id,1,roster[0].id,roster[0].enrollmentId,0,'map');
    adopted=store.adoptActivity(teacher.id,source.id,1,1,'원문을 직접 검토한 관찰',true,'adopt');
  }
  seed();
  const qa=window.qa={downloads:[],ids:()=>({first:first.id,second:second.id,adopted:adopted.id}),
    changeSource(){store.receiveActivity(teacher.id,{...event,eventId:'s2',revision:2,answer:'출처와 공개 범위를 확인합니다.'})},
    reviseDirect(){store.reviseObservation(teacher.id,first.id,1,{...first.current,content:'최신 정정된 직접 관찰'},'관찰 사실 보완','revise')},
    records(){return store.listRecords(teacher.id)},
  };
  URL.createObjectURL=blob=>{qa.downloads.push(blob);return 'blob:synthetic-test'};URL.revokeObjectURL=()=>{};
  HTMLAnchorElement.prototype.click=function(){};
  function App(){const[generation,setGeneration]=useState(0),[revision,setRevision]=useState(0),[member,setMember]=useState(teacher),[scope,setScope]=useState(members),[locked,setLocked]=useState(false);
    qa.refresh=()=>setRevision(n=>n+1);qa.switch=id=>setMember(members.find(m=>m.id===id));
    qa.revoke=()=>{const next=members.map(m=>m.id===teacher.id?{...m,active:false}:m);setScope(next);setMember(next.find(m=>m.id===teacher.id))};
    qa.reset=ended=>{seed(ended);qa.downloads=[];setGeneration(n=>n+1);setMember(teacher);setScope(members);return generation+1};
    return <><style>{theme}{css}</style><main data-generation={generation} data-revision={revision} data-locked={locked}><EditSession key={generation} onLockChange={setLocked}><StudentsPanel member={member} members={scope} date={date} store={store}/></EditSession></main></>
  }
  createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050}})
const errors=[],results=[],output=process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())})
if(output)mkdirSync(output,{recursive:true})
async function test(name,run){await run();results.push(name);console.log('  ✓ '+name)}
async function reset(ended=false){const generation=await page.evaluate(value=>qa.reset(value),ended);await page.waitForFunction(value=>document.querySelector('main').dataset.generation===String(value)&&document.querySelector('main').dataset.locked==='false',generation);await page.getByLabel('학생 찾기',{exact:true}).waitFor()}
const record=text=>page.locator('.students-record').filter({hasText:text})
async function scopeAll(){await page.getByLabel('기록 범위',{exact:true}).selectOption('all')}
async function openEvidence(){await page.getByRole('button',{name:'근거 목록 텍스트 보기',exact:true}).click()}
async function snapshot(label){if(output)await page.screenshot({path:join(output,`student-${label}.png`),fullPage:true})}
try{
  await page.setContent('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>')
  await page.addScriptTag({content:bundle});await page.getByLabel('학생 찾기',{exact:true}).waitFor()
  await test('명부 검색은 선택을 바꾸지 않으며 검색 0건이어도 작성 대상이 명확하다',async()=>{
    await page.getByLabel('학생 찾기',{exact:true}).fill('2번 학생 나'.normalize('NFD'))
    assert.equal(await page.locator('.students-roster button').count(),1)
    assert((await page.locator('.students-selected').innerText()).includes('1번 · 가상 학생 가'))
    await page.getByLabel('학생 찾기',{exact:true}).fill('없는 학생')
    assert.equal(await page.locator('.students-roster button').count(),0)
    assert((await page.locator('.students-selected').innerText()).includes('선택을 유지'))
    assert((await page.locator('.students-form').innerText()).includes('직접 확인'))
    await page.getByLabel('학생 찾기',{exact:true}).fill('2번')
    await page.locator('.students-roster button').click()
    assert.equal(await page.locator('.students-record').count(),1)
    assert((await page.locator('.students-record').innerText()).includes('둘째 학생의 직접 관찰'))
  })
  await test('선택 학생·전체 범위 및 기간·종류·상태 조건을 함께 적용한다',async()=>{
    await reset();assert.equal(await page.locator('.students-record').count(),3)
    await scopeAll();assert.equal(await page.locator('.students-record').count(),4)
    await page.getByLabel('조회 시작일',{exact:true}).fill('2026-09-01');await page.getByLabel('조회 종료일',{exact:true}).fill('2026-09-01')
    assert.equal(await page.locator('.students-record').count(),1)
    await page.getByRole('button',{name:'조회 조건 초기화',exact:true}).click()
    await page.getByLabel('기록 종류',{exact:true}).selectOption('adopted');assert.equal(await page.locator('.students-record').count(),1)
    await page.getByRole('button',{name:'조회 조건 초기화',exact:true}).click()
    await page.getByRole('button',{name:'철회 이력 1건 보기',exact:true}).click()
    assert.equal(await page.locator('.students-record').count(),1);assert((await page.locator('.students-record').innerText()).includes('철회됨'))
    await page.getByLabel('조회 시작일',{exact:true}).fill('2026-10-01');await page.getByLabel('조회 종료일',{exact:true}).fill('2026-09-01')
    await page.getByRole('alert').filter({hasText:'시작일'}).waitFor();assert.equal(await page.locator('.students-record').count(),0)
  })
  await test('신규 기록 입력 중 학생·날짜·조회 조건을 바꿔도 입력과 대상을 유지한다',async()=>{
    await reset();await page.getByLabel('활동',{exact:true}).fill('작성 중인 활동')
    await page.getByLabel('기록 범위',{exact:true}).selectOption('all');assert.equal(await page.getByLabel('기록 범위',{exact:true}).inputValue(),'selected')
    await page.getByLabel('수업 기준일',{exact:true}).fill('2026-09-01');assert.notEqual(await page.getByLabel('수업 기준일',{exact:true}).inputValue(),'2026-09-01')
    await page.locator('.students-roster button').nth(1).click();assert((await page.locator('.students-selected').innerText()).includes('1번'))
    assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'작성 중인 활동')
    await page.getByRole('button',{name:'기록 입력 취소',exact:true}).click();await scopeAll();assert.equal(await page.locator('.students-record').count(),4)
  })
  await test('철회 사유 작성 중 상태와 기간 필터가 카드를 숨기지 않는다',async()=>{
    await reset();const card=record('첫 학생의 직접 관찰')
    await card.getByRole('button',{name:'철회하기',exact:true}).click();await card.getByLabel('철회 사유').fill('사실 확인 중')
    await page.getByRole('button',{name:'철회 이력 1건 보기',exact:true}).click();assert.equal(await page.locator('.students-record').count(),3)
    await page.getByLabel('조회 종료일',{exact:true}).fill('2026-08-31');assert.equal(await page.getByLabel('조회 종료일',{exact:true}).inputValue(),'')
    assert.equal(await card.getByLabel('철회 사유').inputValue(),'사실 확인 중')
    await card.getByRole('button',{name:'사유와 함께 철회',exact:true}).click();assert.equal(await card.getByLabel('철회 사유').count(),0)
    await page.getByRole('button',{name:'철회 이력 2건 보기',exact:true}).click();assert.equal(await page.locator('.students-record').count(),2)
  })
  await test('원자료 변경은 유효 근거와 재검토를 분리하고 숨긴 기록도 전체 출력에 반영한다',async()=>{
    await reset();await page.evaluate(()=>{qa.changeSource();qa.refresh()})
    await page.getByRole('button',{name:'원자료 재검토 1건 보기',exact:true}).click()
    assert.equal(await page.locator('.students-record').count(),1);assert.equal(await page.getByRole('button',{name:'정정하기',exact:true}).isDisabled(),true)
    await page.getByLabel('기록 종류',{exact:true}).selectOption('direct');assert.equal(await page.locator('.students-record').count(),0)
    await openEvidence();await page.getByRole('alert').filter({hasText:'원자료가 바뀐 기록'}).waitFor();assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0)
  })
  await test('근거 텍스트는 화면 필터와 무관한 본인 전체 유효 기록이다',async()=>{
    await reset();await page.getByLabel('기록 종류',{exact:true}).selectOption('adopted');await openEvidence()
    const text=await page.getByLabel('나의 근거 목록',{exact:true}).inputValue()
    assert(text.includes('둘째 학생의 직접 관찰'));assert(text.includes('첫 학생의 직접 관찰'));assert(!text.includes('철회된 학생 기록'))
  })
  await test('재렌더 없는 원자료 변경도 다운로드 직전에 검증해 오래된 파일을 차단한다',async()=>{
    await reset();await openEvidence();await page.evaluate(()=>qa.changeSource())
    await page.getByRole('button',{name:'텍스트 파일 내려받기',exact:true}).click()
    assert.equal(await page.evaluate(()=>qa.downloads.length),0);assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0)
    await page.getByRole('alert').filter({hasText:'원자료가 바뀐 기록'}).waitFor()
  })
  await test('동일 화면 재렌더에서도 바뀐 기록판의 이전 근거 텍스트가 남지 않는다',async()=>{
    await reset();await openEvidence();await page.evaluate(()=>{qa.changeSource();qa.refresh()})
    await page.getByLabel('나의 근거 목록',{exact:true}).waitFor({state:'detached'})
    assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'텍스트 파일 내려받기',exact:true}).count(),0)
  })
  await test('직접 관찰 외부 정정 뒤 첫 클릭은 최신 목록 확인, 두번째 클릭은 최신판만 출력한다',async()=>{
    await reset();await openEvidence();await page.evaluate(()=>qa.reviseDirect())
    await page.getByRole('button',{name:'텍스트 파일 내려받기',exact:true}).click()
    assert.equal(await page.evaluate(()=>qa.downloads.length),0);assert((await page.getByLabel('나의 근거 목록',{exact:true}).inputValue()).includes('최신 정정된 직접 관찰'))
    await page.getByRole('button',{name:'텍스트 파일 내려받기',exact:true}).click()
    assert.equal(await page.evaluate(()=>qa.downloads.length),1)
    assert((await page.evaluate(()=>qa.downloads[0].text())).includes('최신 정정된 직접 관찰'))
  })
  await test('수강 종료일 명부는 제외하고 과거 기준일로 바꾸면 당시 학생·기록을 찾는다',async()=>{
    await reset(true);assert.equal(await page.locator('.students-roster button').count(),2)
    assert(!(await page.locator('.students-roster').innerText()).includes('가상 학생 가'))
    await page.getByLabel('수업 기준일',{exact:true}).fill('2026-09-30');assert.equal(await page.locator('.students-roster button').count(),3)
    await page.getByLabel('학생 찾기',{exact:true}).fill('1번');await page.locator('.students-roster button').click()
    assert.equal(await page.locator('.students-record').count(),3)
  })
  await test('학교·작성자 변경과 소속 종료는 이전 검색·기록·근거를 모두 제거한다',async()=>{
    await reset();await openEvidence();await page.getByLabel('학생 찾기',{exact:true}).fill('1번')
    await page.evaluate(()=>qa.switch('gaon-minjun'));assert.equal(await page.locator('.students-record').count(),0);assert.equal(await page.getByLabel('학생 찾기',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0)
    await page.evaluate(()=>qa.switch('nuri-soyeon'));assert.equal(await page.locator('.students-record').count(),0)
    await reset();await openEvidence();await page.evaluate(()=>qa.revoke())
    await page.getByRole('alert').filter({hasText:'학교 소속이 종료'}).waitFor();assert.equal(await page.getByLabel('학생 찾기',{exact:true}).count(),0);assert.equal(await page.getByLabel('나의 근거 목록',{exact:true}).count(),0)
  })
  await test('실제 화면 정정은 불변 개정 이력을 보존하고 새 관찰판을 표시한다',async()=>{
    await reset();const card=record('첫 학생의 직접 관찰');await card.getByRole('button',{name:'정정하기',exact:true}).click()
    await page.getByLabel('직접 확인한 사실',{exact:true}).fill('화면에서 정정한 확인 사실');await page.getByLabel('정정 사유',{exact:true}).fill('내용을 다시 확인함')
    await page.getByRole('checkbox',{name:'직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.',exact:true}).check()
    await page.getByRole('button',{name:'새 개정본 저장',exact:true}).click()
    assert((await card.innerText()).includes('v2'));assert.equal(await page.evaluate(()=>qa.records().find(r=>r.id===qa.ids().first).revisions.length),2)
  })
  await test('PC·390px 학생 검색 및 기록 화면이 가로 넘침 없이 표시된다',async()=>{
    await reset();await scopeAll();await page.evaluate(()=>{qa.changeSource();qa.refresh()})
    for(const [width,height,label] of [[1440,1050,'desktop'],[390,844,'mobile']]){
      await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label);await snapshot(label)
    }
    assert.deepEqual(errors,[])
  })
  if(output)writeFileSync(join(output,'student-workspace-results.json'),JSON.stringify({results,errors},null,2))
  console.log(`학생 기록 화면 브라우저 ${results.length}개 통과`)
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-6000));if(output)await snapshot('failure');process.exitCode=1}finally{await browser.close()}
