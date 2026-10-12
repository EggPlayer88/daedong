import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { searchRoster, studentRecordWorkspace, evidenceSignature, createStudentStore, createStudentFixture, fixtureData, renderStudents } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'; import {StudentsPanel} from '../apps/workhub/src/students/StudentsPanel';
  export {searchRoster, studentRecordWorkspace, evidenceSignature} from '../apps/workhub/src/students/presentation';
  export {createStudentStore, createStudentFixture} from '../apps/workhub/src/students/store';
  export {fixtureData} from '../apps/workhub/src/preview/fixtures';
  export const renderStudents=props=>renderToStaticMarkup(<StudentsPanel {...props}/>);
`)
const members=fixtureData.memberships,date=fixtureData.basisDate,member=members.find(row=>row.id==='gaon-soyeon')
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
const defaults={scope:'all',from:'',until:'',kind:'all',state:'all'}
function fixture(){
  const store=createStudentStore({members,date}),course=store.listCourses(member.id)[0],roster=store.listStudents(member.id,course.id)
  const draft=(student=roster[0],changes={})=>({courseId:course.id,studentId:student.id,enrollmentId:student.enrollmentId,observedAt:date,activity:'자료 공유',content:'출처 확인을 설명함.',confirmed:true,...changes})
  const first=store.createObservation(member.id,draft(roster[0],{observedAt:'2026-09-01'}),'first')
  const second=store.createObservation(member.id,draft(roster[1]),'second')
  const withdrawn=store.createObservation(member.id,draft(roster[0]),'withdrawn')
  store.withdrawObservation(member.id,withdrawn.id,1,'확인 중 철회','withdraw')
  const event={eventId:'source-1',sourceSystem:'synthetic-lesson',activityId:'share',itemId:'answer',revision:1,operation:'upsert',courseId:course.id,occurredAt:date,questionVersion:'q1',question:'출처란?',answer:'작성자를 알려줍니다.',alias:'가상 별명'}
  const source=store.receiveActivity(member.id,event)
  store.confirmMapping(member.id,source.id,1,roster[0].id,roster[0].enrollmentId,0,'map')
  const adopted=store.adoptActivity(member.id,source.id,1,1,'작성자를 알려주는 응답을 확인함.',true,'adopt')
  return {store,course,roster,first,second,withdrawn,source,event,adopted}
}
test('명부 이름·번호를 여러 단어와 정규화된 한글로 검색한다',()=>{
  const {roster}=fixture()
  assert.equal(searchRoster(roster,'2번 학생 나'.normalize('NFD'))[0].id,roster[1].id)
  assert.equal(searchRoster(roster,'가상').length,3)
  assert.equal(searchRoster(roster,'없는 학생').length,0)
})
test('표시명 검색은 학생 ID를 검색어로 취급하지 않고 입력 배열을 바꾸지 않는다',()=>{
  const {roster}=fixture(),before=structuredClone(roster)
  assert.equal(searchRoster(roster,roster[0].id).length,0)
  assert.deepEqual(roster,before)
})
test('깨진 명부와 기록 응답은 배열 연산 오류 없이 비워진다',()=>{
  for(const value of [null,'bad',{},[null,{}]]){
    assert.deepEqual(searchRoster(value,''),[])
    assert.equal(studentRecordWorkspace(value,defaults).records.length,0)
    assert.equal(evidenceSignature(value),'[]')
  }
})
test('선택 학생은 학생 ID와 수업 ID 모두 같은 본인 기록만 표시한다',()=>{
  const {store,roster,course}=fixture()
  const result=studentRecordWorkspace(store.listRecords(member.id),{...defaults,scope:'selected',studentId:roster[0].id,courseId:course.id})
  assert.equal(result.records.length,3)
  assert(result.records.every(row=>row.current.studentId===roster[0].id))
  assert.equal(studentRecordWorkspace(result.records,{...defaults,scope:'selected'}).records.length,0)
  assert.equal(studentRecordWorkspace(result.records,{...defaults,scope:'selected',studentId:roster[0].id,courseId:'other'}).records.length,0)
})
test('관찰일 기간 경계 양쪽을 포함하고 최신 관찰일 순으로 표시한다',()=>{
  const {store,first}=fixture(),rows=store.listRecords(member.id)
  const september=studentRecordWorkspace(rows,{...defaults,from:'2026-09-01',until:'2026-09-01'})
  assert.deepEqual(september.records.map(row=>row.id),[first.id])
  const all=studentRecordWorkspace(rows,{...defaults,from:'2026-09-01',until:date})
  assert.equal(all.records.length,4);assert.equal(all.records.at(-1).id,first.id)
})
test('기간 역전과 존재하지 않는 날짜는 빈 결과의 이유를 알린다',()=>{
  const {store}=fixture()
  assert.match(studentRecordWorkspace(store.listRecords(member.id),{...defaults,from:date,until:'2026-09-01'}).error,/시작일/)
  assert.match(studentRecordWorkspace(store.listRecords(member.id),{...defaults,from:'2026-02-30'}).error,/실제 날짜/)
})
test('직접 관찰과 수업 활동 채택을 최신 기록의 실제 출처로 구분한다',()=>{
  const {store,adopted}=fixture(),rows=store.listRecords(member.id)
  assert.equal(studentRecordWorkspace(rows,{...defaults,kind:'direct'}).records.length,3)
  assert.deepEqual(studentRecordWorkspace(rows,{...defaults,kind:'adopted'}).records.map(row=>row.id),[adopted.id])
})
test('유효 근거·재검토·철회를 중복 집계하지 않고 상태 필터 전에 요약한다',()=>{
  const {store,event}=fixture()
  store.receiveActivity(member.id,{...event,eventId:'source-2',revision:2,answer:'원문 정정'})
  const result=studentRecordWorkspace(store.listRecords(member.id),{...defaults,state:'ready'})
  assert.deepEqual(result.counts,{all:4,ready:2,review:1,withdrawn:1});assert.equal(result.records.length,2)
  assert(result.records.every(row=>!row.needsReview&&row.current.state==='active'))
})
test('철회된 원자료 기록의 needsReview는 철회 이력으로만 계산한다',()=>{
  const {store,event,adopted}=fixture()
  store.receiveActivity(member.id,{...event,eventId:'source-2',revision:2,operation:'withdraw'})
  store.withdrawObservation(member.id,adopted.id,1,'원자료 철회 반영','withdraw-adopted')
  const result=studentRecordWorkspace(store.listRecords(member.id),defaults)
  assert.equal(result.counts.review,0);assert.equal(result.counts.withdrawn,2)
})
test('근거 표시 서명은 기록 정정과 원자료 변경을 감지한다',()=>{
  const {store,event,first}=fixture(),before=evidenceSignature(store.listRecords(member.id))
  store.reviseObservation(member.id,first.id,1,{...first.current,content:'정정한 사실'},'사실 보완','revise')
  const revised=evidenceSignature(store.listRecords(member.id));assert.notEqual(revised,before)
  store.receiveActivity(member.id,{...event,eventId:'source-2',revision:2,answer:'원문 정정'})
  assert.notEqual(evidenceSignature(store.listRecords(member.id)),revised)
})
test('명부는 수강·학적 종료일을 제외하고 과거 기준일에는 다시 조회된다',()=>{
  const state=createStudentFixture(members,date),course=state.courses.find(row=>row.id.includes(member.id)),enrollment=state.enrollments[0]
  enrollment.until=date
  state.courseMemberships.filter(row=>row.enrollmentId===enrollment.id).forEach(row=>{row.until=date})
  const store=createStudentStore({members,date,snapshot:state})
  assert.equal(searchRoster(store.listStudents(member.id,course.id,date),'1번').length,0)
  assert.equal(searchRoster(store.listStudents(member.id,course.id,'2026-09-30'),'1번').length,1)
})
test('관리자 요약에도 다른 교사의 기록과 건수가 전달되지 않는다',()=>{
  const {store}=fixture(),manager=members.find(row=>row.id==='gaon-minjun')
  assert.deepEqual(studentRecordWorkspace(store.listRecords(manager.id),defaults).counts,{all:0,ready:0,review:0,withdrawn:0})
  const html=renderStudents({member:manager,members,date,store});assert(!html.includes('출처 확인을 설명함.'))
})
test('SSR은 검색·범위·필터·전체 근거 출력 범위를 명확하게 표시한다',()=>{
  const {store}=fixture(),html=renderStudents({member,members,date,store})
  for(const label of ['학생 찾기','기록 범위','조회 시작일','조회 종료일','기록 종류','원자료 재검토','본인이 작성한 모든 유효 기록'])assert(html.includes(label),label)
  assert(html.includes('조회 결과 3건'));assert(!html.includes('관리자 집계'))
})
test('소속 종료 SSR에서 검색과 근거 출력 및 학생 자료가 모두 사라진다',()=>{
  const {store}=fixture(),ended={...member,active:false},updated=members.map(row=>row.id===member.id?ended:row)
  const html=renderStudents({member:ended,members:updated,date,store})
  assert(html.includes('현재 학교 소속이 종료'));assert(!html.includes('가상 학생 가'));assert(!html.includes('근거 목록 텍스트 보기'))
})
test('깨진 기록 목록은 SSR에서 0건 성공으로 표시하지 않고 조회 실패로 안내한다',()=>{
  const {store,first}=fixture()
  for(const value of [null,'bad',[first,{}],[{...first,needsReview:undefined}],[{...first,current:{...first.current,version:0}}]]){
    const html=renderStudents({member,members,date,store:{...store,listRecords:()=>value}})
    assert(html.includes('관찰 기록을 확인하지 못했습니다.'));assert(!html.includes('조회 결과'));assert(!html.includes('유효 근거'))
  }
})
console.log(`학생 기록 탐색: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
