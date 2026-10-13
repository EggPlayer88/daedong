// 합성 학생 화면의 실제 키보드 이동·동적 초점·설명 연결·좁은 화면을 확인한다.
import assert from 'node:assert/strict'
import{buildSync}from'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import{fileURLToPath}from'node:url'
import{mkdirSync,writeFileSync}from'node:fs'
import{join}from'node:path'
const bundle=buildSync({stdin:{contents:`
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StudentsPanel}from'./apps/workhub/src/students/StudentsPanel';import{EditSession}from'./apps/workhub/src/app/EditSession';import{createStudentStore}from'./apps/workhub/src/students/store';import{fixtureData}from'./apps/workhub/src/preview/fixtures';import theme from'./apps/workhub/src/style.css?inline';import css from'./apps/workhub/src/students/students.css?inline';
  const members=fixtureData.memberships,date=fixtureData.basisDate,member=members.find(m=>m.id==='gaon-soyeon');let store,raw,course,student,sources;const qa=window.qa={};
  function seed(){qa.failRead=false;raw=createStudentStore({members,date});course=raw.listCourses(member.id)[0];student=raw.listStudents(member.id,course.id)[0];
    for(const index of[1,2])raw.createObservation(member.id,{studentId:student.id,enrollmentId:student.enrollmentId,courseId:course.id,observedAt:date,activity:'동일한 관찰 활동',content:index===1?'Z'.repeat(300):'두 번째 기록의 확인 사실',confirmed:true},'record-'+index);
    sources=[];for(const index of[1,2,3]){const source=raw.receiveActivity(member.id,{eventId:'event-'+index,sourceSystem:'synthetic-lesson',activityId:'activity-'+index,itemId:'answer-'+index,revision:1,operation:'upsert',courseId:course.id,occurredAt:date,questionVersion:'question-v1',question:index===2?'Q'.repeat(250):'출처를 확인할 때 무엇을 보나요?',answer:'답변 '+index+' '+('answer'.repeat(50)),alias:'같은 별명'});sources.push(source);if(index<3)raw.confirmMapping(member.id,source.id,1,student.id,student.enrollmentId,0,'map-'+index)}
    store={...raw,listActivities(...args){if(qa.failRead)throw new Error('합성 학생 조회 실패');return raw.listActivities(...args)}};
  }
  seed();qa.ids=()=>({student:student.id,sources:sources.map(s=>s.id)});qa.records=()=>raw.listRecords(member.id);
  qa.withdrawSource=index=>{const source=raw.listActivities(member.id).find(s=>s.id===sources[index].id);raw.receiveActivity(member.id,{...source.current,eventId:'withdraw-'+index,revision:2,operation:'withdraw'})};
  function App(){const[generation,setGeneration]=useState(0),[revision,setRevision]=useState(0),[locked,setLocked]=useState(false);qa.refresh=()=>setRevision(v=>v+1);qa.reset=()=>{seed();setGeneration(v=>v+1);return generation+1};return <><style>{theme}{css}</style><main data-generation={generation} data-revision={revision} data-locked={locked}><EditSession key={generation} onLockChange={setLocked}><StudentsPanel member={member} members={members} date={date} store={store}/></EditSession></main></>}
  createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1050}}),results=[],errors=[],output=process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});if(output)mkdirSync(output,{recursive:true})
async function test(name,run){await run();results.push(name);console.log('  ✓ '+name)}
async function reset(){const generation=await page.evaluate(()=>qa.reset());await page.waitForFunction(value=>document.querySelector('main').dataset.generation===String(value)&&document.querySelector('main').dataset.locked==='false',generation)}
async function activate(locator){await locator.focus();await page.keyboard.press('Enter')}
async function inbox(){await activate(page.getByRole('button',{name:/^수업 활동 받은함/}));await page.locator('.students-source').first().waitFor()}
async function fillDirect(){await page.getByLabel('활동',{exact:true}).fill('키보드 저장');await page.getByLabel('직접 확인한 사실',{exact:true}).fill('학생이 직접 말한 사실');await page.getByRole('checkbox',{name:'직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.',exact:true}).check()}
async function capture(label){if(output)await page.screenshot({path:join(output,`student-accessibility-${label}.png`),fullPage:true})}
async function assertReferences(){assert.deepEqual(await page.evaluate(()=>{const nodes=[...document.querySelectorAll('[id]')],ids=nodes.map(node=>node.id),failures=[];if(new Set(ids).size!==ids.length)failures.push('duplicate id');for(const node of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]'))for(const attr of['aria-labelledby','aria-describedby','aria-controls'])for(const ref of(node.getAttribute(attr)||'').split(' ').filter(Boolean))if(!document.getElementById(ref))failures.push(attr+':'+ref);return failures}),[])}
async function assertFocus(locator){await page.waitForFunction(()=>document.activeElement&&document.activeElement!==document.body);assert.equal(await locator.evaluate(node=>node===document.activeElement),true)}
try{
  await page.setContent('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>');await page.addScriptTag({content:bundle});await page.getByLabel('활동',{exact:true}).waitFor()
  await test('같은 이름·날짜 기록도 구분되는 영역이며 모든 ARIA 참조가 실제 요소에 연결된다',async()=>{
    assert.equal(await page.getByRole('region',{name:/^관찰 기록 1 ·/}).count(),1);assert.equal(await page.getByRole('region',{name:/^관찰 기록 2 ·/}).count(),1)
    assert.equal(await page.getByRole('form',{name:'빠른 관찰 기록',exact:true}).count(),1);await assertReferences()
  })
  await test('새 관찰 입력을 키보드로 취소하면 활동 입력으로 초점이 돌아간다',async()=>{
    await page.getByLabel('활동',{exact:true}).fill('취소할 입력');await activate(page.getByRole('button',{name:'기록 입력 취소',exact:true}));await assertFocus(page.getByLabel('활동',{exact:true}));assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'')
  })
  await test('정정을 키보드로 열고 취소하면 편집한 원기록으로 초점이 돌아간다',async()=>{
    const card=page.locator('.students-record').first();await activate(card.getByRole('button',{name:'정정하기',exact:true}));await assertFocus(page.getByLabel('활동',{exact:true}));await activate(page.getByRole('button',{name:'정정 취소',exact:true}));await assertFocus(card)
  })
  await test('철회 펼침·빈 사유 오류·취소를 키보드로 이동하고 오류 설명을 읽을 수 있다',async()=>{
    await reset();const card=page.locator('.students-record').first();await activate(card.getByRole('button',{name:'철회하기',exact:true}));const reason=card.getByLabel('철회 사유',{exact:true});await assertFocus(reason)
    await page.keyboard.press('Enter');assert.equal(await reason.getAttribute('aria-invalid'),'true');assert((await reason.getAttribute('aria-describedby')).includes('withdraw-help'));await assertReferences()
    await page.keyboard.press('Shift+Tab');await assertFocus(card.getByRole('button',{name:'철회 입력 취소',exact:true}));await page.keyboard.press('Enter');await assertFocus(card.getByRole('button',{name:'철회하기',exact:true}));assert.equal(await reason.count(),0)
  })
  await test('철회 완료는 남은 기록으로, 필터 때문에 사라지면 기록 목록 제목으로 초점을 옮긴다',async()=>{
    for(const filtered of[false,true]){await reset();if(filtered)await activate(page.getByRole('button',{name:'유효 근거 2건 보기',exact:true}));const card=page.locator('.students-record').first(),id=await card.getAttribute('data-student-record-id');await activate(card.getByRole('button',{name:'철회하기',exact:true}));await card.getByLabel('철회 사유',{exact:true}).fill('사실 다시 확인');await activate(card.getByRole('button',{name:'사유와 함께 철회',exact:true}));if(filtered)await assertFocus(page.getByRole('heading',{name:'내 관찰 기록',exact:true}));else{await assertFocus(page.locator(`[data-student-record-id="${id}"]`));assert((await page.locator(`[data-student-record-id="${id}"]`).innerText()).includes('철회됨'))}}
  })
  await test('직접 관찰 저장 후 결과 안내와 저장 원기록을 키보드로 이어서 확인한다',async()=>{
    await reset();await fillDirect();await activate(page.getByRole('button',{name:'관찰 저장',exact:true}));await assertFocus(page.getByRole('region',{name:'저장한 관찰 기록',exact:true}));await activate(page.getByRole('button',{name:'저장한 기록 보기',exact:true}));await page.waitForFunction(()=>document.activeElement.hasAttribute('data-student-record-id'));assert((await page.locator('.students-record:focus').innerText()).includes('학생이 직접 말한 사실'))
  })
  await test('같은 별명의 반복 채택 폼이 서로 다른 이름과 오류·대상 설명을 가진다',async()=>{
    await reset();await inbox();const forms=page.getByRole('form',{name:/수업 활동 \d · 같은 별명 .* 관찰 채택/});assert.equal(await forms.count(),2)
    const second=page.locator('.students-source').nth(1);await activate(second.getByRole('button',{name:'내 관찰로 채택',exact:true}));await assertFocus(second.getByLabel('교사가 확인한 관찰 사실',{exact:true}));assert.equal(await page.locator('.students-source').first().getByLabel('교사가 확인한 관찰 사실',{exact:true}).getAttribute('aria-invalid'),'false');await assertReferences()
    const description=await second.getByLabel('교사가 확인한 관찰 사실',{exact:true}).evaluate(node=>node.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id).textContent).join(' '));assert(description.includes('1번 · 가상 학생 가'));assert(description.includes('공백만으로'))
  })
  await test('학생 연결 확정은 해당 활동 입력으로, 취소는 같은 활동의 선택란으로 이동한다',async()=>{
    await reset();await inbox();const third=page.locator('.students-source').nth(2),student=await page.evaluate(()=>qa.ids().student);await third.getByLabel('교사가 확인한 학생',{exact:true}).selectOption(student);await activate(third.getByRole('button',{name:'학생 연결 확정',exact:true}));await assertFocus(third.getByLabel('교사가 확인한 관찰 사실',{exact:true}));await activate(third.getByRole('button',{name:'활동 입력 취소',exact:true}));await assertFocus(third.getByLabel('교사가 확인한 학생',{exact:true}))
  })
  await test('활동 채택 완료로 폼이 없어져도 저장 결과 안내에 초점을 유지한다',async()=>{
    await reset();await inbox();const first=page.locator('.students-source').first();await first.getByLabel('교사가 확인한 관찰 사실',{exact:true}).fill('채택한 학생 발언');await first.getByRole('checkbox',{name:'원문·질문·학생 연결을 직접 검토했습니다.',exact:true}).check();await activate(first.getByRole('button',{name:'내 관찰로 채택',exact:true}));await assertFocus(page.getByRole('region',{name:'저장한 관찰 기록',exact:true}));assert.equal(await first.getByRole('form').count(),0);await assertReferences()
    await activate(page.getByRole('button',{name:'내 학급·기록',exact:true}));await assertFocus(page.getByRole('button',{name:'내 학급·기록',exact:true}));await inbox();await assertFocus(page.getByRole('button',{name:/^수업 활동 받은함/}))
  })
  await test('원자료가 철회된 활동의 입력을 취소해도 사라진 선택란 대신 활동 영역으로 이동한다',async()=>{
    await reset();await inbox();const first=page.locator('.students-source').first();await first.getByLabel('교사가 확인한 관찰 사실',{exact:true}).fill('보관할 입력');await page.evaluate(()=>{qa.withdrawSource(0);qa.refresh()});await first.getByRole('alert').waitFor();await activate(first.getByRole('button',{name:'활동 입력 취소',exact:true}));await assertFocus(first);assert((await first.innerText()).includes('원자료 철회'));await assertReferences()
  })
  await test('조회 오류가 입력을 숨길 때 오류 영역으로, 복구 후 제목으로 초점을 옮긴다',async()=>{
    await reset();await page.getByLabel('활동',{exact:true}).fill('복구할 입력');await page.evaluate(()=>{qa.failRead=true;qa.refresh()});const alert=page.getByRole('alert').filter({hasText:'합성 학생 조회 실패'});await alert.waitFor();await assertFocus(alert)
    await page.evaluate(()=>qa.failRead=false);await activate(page.getByRole('button',{name:'학생 자료 다시 확인',exact:true}));await assertFocus(page.getByRole('heading',{name:'학생과 수업 기록',exact:true}));assert.equal(await page.getByLabel('활동',{exact:true}).inputValue(),'복구할 입력');await activate(page.getByRole('button',{name:'기록 입력 취소',exact:true}));await assertFocus(page.getByLabel('활동',{exact:true}))
  })
  await test('긴 영문 원문·이력·반복 활동을 320·390px에서 가로 넘침 없이 읽는다',async()=>{
    await reset();for(const [width,label]of[[1440,'desktop'],[390,'mobile'],[320,'narrow']]){await page.setViewportSize({width,height:950});await activate(page.getByRole('button',{name:'내 학급·기록',exact:true}));await page.locator('.students-record details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'기록 '+label);await capture(label+'-records');await inbox();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'활동 '+label);if(width===320)await capture(label+'-activities')}
  })
  await test('320px에서 글자 크기를 두 배로 확대한 기록·채택 입력도 내용이 잘리지 않는다',async()=>{
    await reset();await page.setViewportSize({width:320,height:950});await page.locator('.students-record details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true))
    async function enlarge(){await page.evaluate(()=>{const sizes=[...document.querySelectorAll('.students-panel,.students-panel *')].map(node=>[node,parseFloat(getComputedStyle(node).fontSize)]);for(const[node,size]of sizes)node.style.fontSize=(size*2)+'px'})}
    await enlarge();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'기록 텍스트 두 배');await capture('text-200-records')
    await reset();await inbox();await enlarge();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'활동 텍스트 두 배');await capture('text-200-activities');await assertReferences();assert.deepEqual(errors,[])
  })
  if(output)writeFileSync(join(output,'student-accessibility-results.json'),JSON.stringify({results,errors,scope:'합성 자료의 Chrome 키보드·DOM·화면 검증. 화면읽기 프로그램의 실제 음성 동작이나 접근성 인증 검증은 아님.'},null,2));console.log(`학생 접근성 브라우저 ${results.length}개 통과`)
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-6000));if(output)await capture('failure');process.exitCode=1}finally{await browser.close()}
