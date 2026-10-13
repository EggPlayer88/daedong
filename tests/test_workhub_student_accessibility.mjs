import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {renderEntries,renderStudents,createStudentStore,fixtureData}=await loadBrowserModule(`
  import{renderToStaticMarkup}from'react-dom/server';import{ObservationEntry,ActivityObservationEntry}from'../apps/workhub/src/students/ObservationEntry';import{StudentsPanel}from'../apps/workhub/src/students/StudentsPanel';
  export{createStudentStore}from'../apps/workhub/src/students/store';export{fixtureData}from'../apps/workhub/src/preview/fixtures';
  const target={student:'1번 · 같은 이름',course:'가상 수업',date:'2026-10-19',valid:true};
  export const renderEntries=()=>renderToStaticMarkup(<><ObservationEntry input={{activity:'',content:'',reason:'',confirmed:false}} target={target} dirty={false} resetToken={0} onChange={()=>{}} onSave={()=>{}} onCancel={()=>{}}/>{[1,2].map(index=><ActivityObservationEntry key={index} contextLabel={'수업 활동 '+index+' · 같은 별명 관찰 채택'} content="" confirmed={false} target={target} sourceRevision={1} onChange={()=>{}} onSave={()=>{}} onCancel={()=>{}}/>)}</>);
  export const renderStudents=props=>renderToStaticMarkup(<StudentsPanel {...props}/>);
`)
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
function attributes(html,name){return [...html.matchAll(new RegExp('\\s'+name+'="([^"]*)"','g'))].map(match=>match[1])}
function assertReferences(html){const ids=attributes(html,'id');assert.equal(ids.length,new Set(ids).size,'동일 페이지에서 ID가 중복되면 안 된다');for(const name of ['aria-labelledby','aria-describedby','aria-controls'])for(const value of attributes(html,name))for(const ref of value.split(' '))assert(ids.includes(ref),`${name} ${ref}의 대상이 있어야 한다`)}
const members=fixtureData.memberships,date=fixtureData.basisDate,member=members.find(row=>row.id==='gaon-soyeon')
function fixture(){const store=createStudentStore({members,date}),course=store.listCourses(member.id)[0],student=store.listStudents(member.id,course.id)[0];for(const index of [1,2])store.createObservation(member.id,{studentId:student.id,enrollmentId:student.enrollmentId,courseId:course.id,observedAt:date,activity:'같은 활동',content:'확인한 사실 '+index,confirmed:true},'record-'+index);return{store,member,members,date}}
test('관찰 작성과 반복 채택 폼에 접근성 이름과 대상 설명이 있다',()=>{
  const html=renderEntries(),forms=[...html.matchAll(/<form\b[^>]*>/g)].map(match=>match[0]);assert.equal(forms.length,3)
  assert(forms.every(form=>/aria-label(?:ledby)?=/.test(form)&&form.includes('aria-describedby=')))
  assert(html.includes('수업 활동 1 · 같은 별명 관찰 채택'));assert(html.includes('수업 활동 2 · 같은 별명 관찰 채택'))
})
test('반복 입력 인스턴스에서도 모든 ID가 고유하고 설명·이름 연결이 유효하다',()=>assertReferences(renderEntries()))
test('입력과 확인란의 설명에 작성 대상이 포함되고 도움말 연결이 분리된다',()=>{
  const html=renderEntries(),fields=[...html.matchAll(/<(?:input|textarea)\b[^>]*>/g)].map(match=>match[0]);assert.equal(fields.length,7)
  assert(fields.every(field=>/aria-describedby="[^"]*-target/.test(field)))
  assert(fields.filter(field=>field.includes('type="checkbox"')).every(field=>field.includes('aria-invalid="false"')))
})
test('같은 학생·날짜·활동 기록도 목록 순서를 포함한 서로 다른 영역 이름을 가진다',()=>{
  const html=renderStudents(fixture());assert(html.includes('관찰 기록 1'));assert(html.includes('관찰 기록 2'))
  const cards=[...html.matchAll(/<section\b[^>]*data-student-record-id[^>]*>/g)].map(match=>match[0]);assert.equal(cards.length,2)
  assert(cards.every(card=>card.includes('aria-labelledby=')&&card.includes('aria-describedby=')&&card.includes('tabindex="-1"')))
  assertReferences(html)
})
test('반복 정정·철회 버튼은 원기록의 이름과 활동 설명에 연결된다',()=>{
  const html=renderStudents(fixture()),buttons=[...html.matchAll(/<button\b([^>]*)>(정정하기|철회하기)<\/button>/g)];assert.equal(buttons.length,4)
  assert(buttons.every(match=>match[1].includes('aria-describedby=')))
  assert(buttons.filter(match=>match[2]==='철회하기').every(match=>match[1].includes('aria-expanded="false"')))
})
test('불변 이력 펼침과 상태는 색상 없이도 이름·문구로 구분할 수 있다',()=>{
  const props=fixture(),record=props.store.listRecords(member.id)[0];props.store.withdrawObservation(member.id,record.id,1,'사실 재확인','withdraw')
  const html=renderStudents(props);assert(html.includes('철회됨'));assert(html.includes('본인 확인 기록'))
  assert([...html.matchAll(/<summary\b([^>]*)>/g)].every(match=>match[1].includes('aria-describedby=')))
  assert(html.includes('불변 개정 이력 2개'))
})
test('학생 업무 전환은 기존 누름 버튼을 유지하고 불완전한 tab 역할을 만들지 않는다',()=>{
  const html=renderStudents(fixture());assert(html.includes('aria-pressed="true"'));assert(!html.includes('role="tab"'));assert(!html.includes('role="tablist"'))
})
test('조회 실패는 초점 가능한 오류 영역으로 안내하고 본문·입력 폼을 노출하지 않는다',()=>{
  const props=fixture(),html=renderStudents({...props,store:{...props.store,listRecords(){throw new Error('합성 조회 실패')}}})
  assert(/role="alert"[^>]*tabindex="-1"/.test(html));assert(html.includes('학생 자료 다시 확인'));assert(!html.includes('<form'));assert(!html.includes('확인한 사실 1'))
})
console.log(`학생 접근성 구조: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
