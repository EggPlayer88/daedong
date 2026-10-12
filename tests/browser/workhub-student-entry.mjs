// 실제 학생 입력 화면과 합성 저장소로 오류 안내·대상 고정·입력 복구를 검증한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const bundle=buildSync({stdin:{contents:`
  import React,{useState} from 'react';import{createRoot}from'react-dom/client';
  import{StudentsPanel}from'./apps/workhub/src/students/StudentsPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';
  import{createStudentStore}from'./apps/workhub/src/students/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';
  import theme from './apps/workhub/src/style.css?inline';import css from './apps/workhub/src/students/students.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate,teacher=members.find(m=>m.id==='gaon-soyeon');
  let raw,store,course,students,record,source,event;
  const qa=window.qa={};
  function seed(){
    qa.failRead=false;qa.failWrite=false;qa.hidden='';qa.createCalls=0;qa.reviseCalls=0;qa.adoptCalls=0;
    raw=createStudentStore({members,date});course=raw.listCourses(teacher.id)[0];students=raw.listStudents(teacher.id,course.id);
    record=raw.createObservation(teacher.id,{studentId:students[0].id,enrollmentId:students[0].enrollmentId,courseId:course.id,observedAt:'2026-09-01',activity:'기존 관찰',content:'처음 직접 확인한 사실',confirmed:true},'existing');
    event={eventId:'source-1',sourceSystem:'synthetic-lesson',activityId:'lesson',itemId:'answer',revision:1,operation:'upsert',courseId:course.id,occurredAt:date,questionVersion:'q1',question:'자료를 공유할 때?',answer:'출처를 확인합니다.',alias:'가상 별명'};
    source=raw.receiveActivity(teacher.id,event);raw.confirmMapping(teacher.id,source.id,1,students[0].id,students[0].enrollmentId,0,'mapping');
    store={...raw,
      listStudents(...args){return raw.listStudents(...args).filter(s=>s.id!==qa.hidden)},
      listActivities(...args){if(qa.failRead)throw new Error('합성 학생 자료 조회 실패');return raw.listActivities(...args)},
      createObservation(...args){qa.createCalls++;if(qa.failWrite)throw new Error('합성 저장 실패');return raw.createObservation(...args)},
      reviseObservation(...args){qa.reviseCalls++;if(qa.failWrite)throw new Error('합성 저장 실패');return raw.reviseObservation(...args)},
      adoptActivity(...args){qa.adoptCalls++;if(qa.failWrite)throw new Error('합성 저장 실패');return raw.adoptActivity(...args)},
    };
  }
  seed();
  qa.ids=()=>({a:students[0].id,b:students[1].id,record:record.id,source:source.id});
  qa.records=()=>raw.listRecords(teacher.id);
  qa.reviseOutside=()=>raw.reviseObservation(teacher.id,record.id,1,{...record.current,content:'외부에서 정정한 사실'},'외부 확인','outside');
  qa.changeSource=operation=>{const current=raw.listActivities(teacher.id)[0].current;raw.receiveActivity(teacher.id,{...current,eventId:'source-'+(current.revision+1),revision:current.revision+1,operation:operation||'upsert',answer:'원문이 바뀐 응답'})};
  qa.adoptOutside=()=>raw.adoptActivity(teacher.id,source.id,1,1,'외부에서 이미 채택함',true,'outside-adopt');
  function App(){const[generation,setGeneration]=useState(0),[revision,setRevision]=useState(0),[member,setMember]=useState(teacher),[locked,setLocked]=useState(false);
    qa.refresh=()=>setRevision(v=>v+1);qa.switch=id=>setMember(members.find(m=>m.id===id));qa.reset=()=>{seed();setMember(teacher);setGeneration(v=>v+1);return generation+1};
    return <><style>{theme}{css}</style><main data-generation={generation} data-revision={revision} data-locked={locked}><EditSession key={generation} onLockChange={setLocked}><StudentsPanel member={member} members={members} date={date} store={store}/></EditSession></main></>
  }
  createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050}})
const results=[],errors=[],output=process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())})
if(output)mkdirSync(output,{recursive:true})
async function test(name,run){await run();results.push(name);console.log('  ✓ '+name)}
async function reset(){const generation=await page.evaluate(()=>qa.reset());await page.waitForFunction(value=>document.querySelector('main').dataset.generation===String(value)&&document.querySelector('main').dataset.locked==='false',generation)}
const confirm=()=>page.getByRole('checkbox',{name:'직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.',exact:true})
const sourceConfirm=()=>page.getByRole('checkbox',{name:'원문·질문·학생 연결을 직접 검토했습니다.',exact:true})
async function fillDirect(content='새로 직접 확인한 사실'){await page.getByLabel('활동',{exact:true}).fill('자료 공유 토의');await page.getByLabel('직접 확인한 사실',{exact:true}).fill(content);await confirm().check()}
async function inbox(){await page.getByRole('button',{name:/^수업 활동 받은함/}).click();await page.getByLabel('교사가 확인한 학생',{exact:true}).waitFor()}
async function fillSource(content='활동 원문에서 직접 확인한 사실'){await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).fill(content);await sourceConfirm().check()}
async function saveDirect(){await page.getByRole('button',{name:'관찰 저장',exact:true}).click()}
async function capture(label){if(output)await page.screenshot({path:join(output,`student-entry-${label}.png`),fullPage:true})}
try{
  await page.setContent('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>')
  await page.addScriptTag({content:bundle});await page.getByLabel('활동',{exact:true}).waitFor()
  await test('빈 입력·공백은 구체적 안내와 첫 오류 초점으로 이어지고 저장하지 않는다',async()=>{
    await saveDirect();await page.locator('.students-entry-errors').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.dataset.entryField),'activity');assert.equal(await page.evaluate(()=>qa.createCalls),0)
    await page.getByLabel('활동',{exact:true}).fill('  ');await page.getByLabel('직접 확인한 사실',{exact:true}).fill('  ');await confirm().check();await saveDirect()
    assert((await page.locator('.students-entry-errors').innerText()).includes('공백만으로'));assert.equal(await page.evaluate(()=>qa.createCalls),0)
  })
  await test('관찰 내용이 바뀌면 이전 확인을 풀고 확인란 오류 위치를 안내한다',async()=>{
    await reset();await fillDirect();await page.getByLabel('직접 확인한 사실',{exact:true}).fill('다시 작성한 직접 확인 사실');assert.equal(await confirm().isChecked(),false)
    await saveDirect();assert.equal(await page.evaluate(()=>document.activeElement.dataset.entryField),'confirmed');assert.equal(await page.evaluate(()=>qa.createCalls),0)
    assert((await page.locator('.students-entry-target').innerText()).includes('1번 · 가상 학생 가'))
    assert((await page.locator('.students-field-help').allTextContents()).some(text=>text.includes('/ 4000자')))
  })
  await test('저장 후 학생·날짜·판을 확인하고 필터에 숨은 기록도 정확히 연다',async()=>{
    await reset();await page.getByLabel('조회 종료일',{exact:true}).fill('2026-09-01');await fillDirect();await saveDirect()
    assert((await page.locator('.students-saved').innerText()).includes('가상 학생 가'));assert((await page.locator('.students-saved').innerText()).includes('v1'))
    assert.equal(await page.locator('.students-record').count(),1)
    await page.getByRole('button',{name:'저장한 기록 보기',exact:true}).click();await page.waitForFunction(()=>document.activeElement.hasAttribute('data-student-record-id'))
    assert((await page.locator('.students-record:focus').innerText()).includes('새로 직접 확인한 사실'));assert.equal(await page.getByLabel('조회 종료일',{exact:true}).inputValue(),'')
  })
  await test('같은 학생 새 기록 뒤 명시적으로 다른 학생을 골라 새 기록을 작성할 수 있다',async()=>{
    await reset();await fillDirect();await saveDirect();await page.getByRole('button',{name:'같은 학생 새 기록',exact:true}).click()
    await page.getByLabel('활동',{exact:true}).fill('쓰다가 지운 활동');await page.getByLabel('활동',{exact:true}).fill('')
    await page.locator('.students-roster button').nth(1).click();await fillDirect('둘째 학생 새 관찰');await saveDirect()
    assert.equal(await page.evaluate(()=>qa.records().find(r=>r.current.content==='둘째 학생 새 관찰').current.studentId),await page.evaluate(()=>qa.ids().b))
  })
  await test('신규 저장 실패는 내용·확인·대상을 보존하고 재시도는 한 기록만 만든다',async()=>{
    await reset();await fillDirect();await page.evaluate(()=>qa.failWrite=true);await saveDirect();await page.getByRole('alert').filter({hasText:'합성 저장 실패'}).waitFor()
    assert.equal(await confirm().isChecked(),true);assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).inputValue(),'새로 직접 확인한 사실');assert.equal(await page.locator('.students-saved').count(),0)
    await page.evaluate(()=>qa.failWrite=false);await saveDirect();assert.equal(await page.evaluate(()=>qa.records().filter(r=>r.current.content==='새로 직접 확인한 사실').length),1)
  })
  await test('정정 사유 누락을 안내하고 대상 학생이 명부에서 빠지면 다른 학생으로 대체하지 않는다',async()=>{
    await reset();await page.getByRole('button',{name:'정정하기',exact:true}).click();await confirm().check();await page.getByRole('button',{name:'새 개정본 저장',exact:true}).click()
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.entryField),'reason');assert.equal(await page.evaluate(()=>qa.reviseCalls),0)
    await page.getByLabel('정정 사유',{exact:true}).fill('발언 다시 확인');await confirm().check();await page.evaluate(()=>{qa.hidden=qa.ids().a;qa.refresh()})
    await page.locator('.students-entry-target.unavailable').waitFor();await page.getByRole('button',{name:'새 개정본 저장',exact:true}).click()
    assert.equal(await page.evaluate(()=>qa.reviseCalls),0);assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).inputValue(),'처음 직접 확인한 사실');assert.equal(await page.evaluate(()=>document.activeElement.dataset.entryField),'target')
  })
  await test('신규 입력 시작 뒤 명부가 바뀌어도 작성 대상과 저장 내용을 옮기지 않는다',async()=>{
    await reset();await fillDirect();await page.evaluate(()=>{qa.hidden=qa.ids().a;qa.refresh()});await page.locator('.students-entry-target.unavailable').waitFor();await saveDirect()
    assert.equal(await page.evaluate(()=>qa.createCalls),0);assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).inputValue(),'새로 직접 확인한 사실')
  })
  await test('동시 정정 충돌은 입력·사유·확인을 보존하며 성공 안내를 내지 않는다',async()=>{
    await reset();await page.getByRole('button',{name:'정정하기',exact:true}).click();await page.getByLabel('직접 확인한 사실',{exact:true}).fill('내가 수정 중인 관찰');await page.getByLabel('정정 사유',{exact:true}).fill('원문 다시 확인');await confirm().check()
    await page.evaluate(()=>qa.reviseOutside());await page.getByRole('button',{name:'새 개정본 저장',exact:true}).click();await page.getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).inputValue(),'내가 수정 중인 관찰');assert.equal(await page.getByLabel('정정 사유',{exact:true}).inputValue(),'원문 다시 확인');assert.equal(await confirm().isChecked(),true);assert.equal(await page.locator('.students-saved').count(),0)
  })
  await test('직접 관찰 조회 실패는 입력을 화면에서 숨기고 재조회 뒤 복원한다',async()=>{
    await reset();await fillDirect();await page.evaluate(()=>{qa.failRead=true;qa.refresh()});await page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}).waitFor();assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).count(),0)
    await page.evaluate(()=>qa.failRead=false);await page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}).click();assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).inputValue(),'새로 직접 확인한 사실');assert.equal(await confirm().isChecked(),true)
  })
  await test('미확정 B 선택에서는 채택하지 못하고 B 연결을 확정해야 B 기록을 만든다',async()=>{
    await reset();await inbox();const b=await page.evaluate(()=>qa.ids().b);await page.getByLabel('교사가 확인한 학생',{exact:true}).selectOption(b)
    assert.equal(await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).count(),0);await page.getByText(/선택한 학생과 확정된 연결이 다릅니다/).waitFor()
    await page.getByRole('button',{name:'학생 연결 확정',exact:true}).click();await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.entryField),'content')
    await fillSource();await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).click();assert.equal(await page.evaluate(()=>qa.records().find(r=>r.current.source).current.studentId),b)
    await page.getByRole('button',{name:'같은 학생 새 기록',exact:true}).click();await page.getByLabel('활동',{exact:true}).waitFor();assert((await page.locator('.students-entry-target').innerText()).includes('2번 · 가상 학생 나'));assert.equal(await page.getByLabel('직접 확인한 사실',{exact:true}).inputValue(),'')
  })
  await test('활동 채택 저장 실패도 관찰 내용·확인 상태를 유지한다',async()=>{
    await reset();await inbox();await fillSource();await page.evaluate(()=>qa.failWrite=true);await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).click();await page.getByRole('alert').filter({hasText:'합성 저장 실패'}).waitFor()
    assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'활동 원문에서 직접 확인한 사실');assert.equal(await sourceConfirm().isChecked(),true)
    await page.evaluate(()=>qa.failWrite=false);await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).click();assert.equal(await page.evaluate(()=>qa.records().filter(r=>r.current.source).length),1)
  })
  await test('활동 입력 중 합성 원문 정정 버튼과 탭 전환은 입력을 지우지 않는다',async()=>{
    await reset();await inbox();await fillSource();await page.getByText('합성 원자료 정정·철회 시험',{exact:true}).click();await page.getByRole('button',{name:'수정 답변 수신',exact:true}).click()
    assert((await page.locator('.students-source h3').innerText()).includes('원문 판 1'));await page.getByRole('button',{name:'내 학급·기록',exact:true}).click();assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'활동 원문에서 직접 확인한 사실')
  })
  await test('활동 입력 조회 실패도 부모에 보관한 문장·대상·확인을 복구한다',async()=>{
    await reset();await inbox();await fillSource('조회 실패 뒤 복원할 활동 입력');await page.evaluate(()=>{qa.failRead=true;qa.refresh()});await page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}).waitFor()
    assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).count(),0);assert(!(await page.locator('body').innerText()).includes('조회 실패 뒤 복원할 활동 입력'))
    await page.evaluate(()=>qa.failRead=false);await page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}).click();assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'조회 실패 뒤 복원할 활동 입력');assert.equal(await sourceConfirm().isChecked(),true)
    await page.getByRole('button',{name:'활동 입력 취소',exact:true}).click();await page.getByRole('button',{name:'내 학급·기록',exact:true}).click();await page.getByLabel('활동',{exact:true}).waitFor()
  })
  await test('원자료 외부 철회·이미 채택은 입력을 보관하고 이동과 중복 채택을 차단한다',async()=>{
    for(const operation of ['withdraw','adopted']){
      await reset();await inbox();await fillSource('외부 변경 중 보관할 입력');await page.evaluate(value=>{if(value==='adopted')qa.adoptOutside();else qa.changeSource(value);qa.refresh()},operation)
      await page.getByRole('alert').filter({hasText:'입력 내용은 보관'}).waitFor();assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'외부 변경 중 보관할 입력')
      await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).click();assert.equal(await page.evaluate(()=>qa.adoptCalls),0)
      await page.getByRole('button',{name:'내 학급·기록',exact:true}).click();assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).count(),1)
      await page.getByRole('button',{name:'활동 입력 취소',exact:true}).click();await page.getByRole('button',{name:'내 학급·기록',exact:true}).click();await page.getByLabel('활동',{exact:true}).waitFor()
    }
  })
  await test('채택 완료 후 원문 새 판을 수신해도 과거 확정 선택이 새 입력 잠금을 만들지 않는다',async()=>{
    await reset();await inbox();await fillSource();await page.getByRole('button',{name:'내 관찰로 채택',exact:true}).click();await page.getByText('합성 원자료 정정·철회 시험',{exact:true}).click();await page.getByRole('button',{name:'수정 답변 수신',exact:true}).click()
    assert.equal(await page.getByLabel('교사가 확인한 학생',{exact:true}).inputValue(),'');await page.getByRole('button',{name:'내 학급·기록',exact:true}).click();await page.getByLabel('활동',{exact:true}).waitFor();assert((await page.locator('.students-records').innerText()).includes('원자료 재검토 필요'))
  })
  await test('읽기 실패 중 보관 입력 취소와 강제 소속 전환은 이전 입력을 복원하지 않는다',async()=>{
    await reset();await inbox();await fillSource();await page.evaluate(()=>{qa.failRead=true;qa.refresh()});await page.getByRole('button',{name:'보관한 입력 취소',exact:true}).click();await page.evaluate(()=>qa.failRead=false);await page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}).click();assert.equal(await page.getByLabel('교사가 확인한 관찰 사실',{exact:true}).inputValue(),'')
    await fillSource('이전 학교에서만 작성한 입력');await page.evaluate(()=>qa.switch('nuri-soyeon'));await page.getByLabel('활동',{exact:true}).waitFor();assert(!(await page.locator('body').innerText()).includes('이전 학교에서만 작성한 입력'))
  })
  await test('입력 안내 PC·390px 화면에 가로 넘침과 브라우저 오류가 없다',async()=>{
    await reset();await page.getByLabel('활동',{exact:true}).fill('자료 공유 토의');await saveDirect()
    for(const [width,height,label]of[[1440,1050,'desktop'],[390,844,'mobile']]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture(label)}
    assert.deepEqual(errors,[])
  })
  if(output)writeFileSync(join(output,'student-entry-results.json'),JSON.stringify({results,errors},null,2));console.log(`학생 입력 안내 브라우저 ${results.length}개 통과`)
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-6500));if(output)await capture('failure');process.exitCode=1}finally{await browser.close()}
