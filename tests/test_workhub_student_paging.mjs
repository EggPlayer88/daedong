import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

const {renderStudents,createStudentStore,fixtureData}=await loadBrowserModule(`
  import{renderToStaticMarkup}from'react-dom/server';import{StudentsPanel}from'../apps/workhub/src/students/StudentsPanel';
  export{createStudentStore}from'../apps/workhub/src/students/store';export{fixtureData}from'../apps/workhub/src/preview/fixtures';
  export const renderStudents=props=>renderToStaticMarkup(<StudentsPanel {...props}/>);
`)
const members=fixtureData.memberships,date=fixtureData.basisDate,member=members.find(row=>row.id==='gaon-soyeon')
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
function fixture(count=1000){
  const initial=createStudentStore({members,date}),course=initial.listCourses(member.id)[0],student=initial.listStudents(member.id,course.id)[0]
  const record=initial.createObservation(member.id,{studentId:student.id,enrollmentId:student.enrollmentId,courseId:course.id,observedAt:date,activity:'합성 관찰',content:'직접 확인한 사실',confirmed:true},'seed')
  const snapshot=initial.exportState();snapshot.receipts=[]
  snapshot.observations=Array.from({length:count},(_,index)=>({id:`scale-${String(index).padStart(4,'0')}`,schoolId:member.schoolId,authorUserId:member.userId,authorMemberId:member.id,revisions:[1,2,3].map(version=>({...record.current,version,createdAt:'2026-10-01T00:00:00Z',reason:'합성 개정 '+version,content:'합성 사실 '+index+' 판 '+version}))}))
  return{store:createStudentStore({members,date,snapshot}),member,members,date}
}
test('관찰 1,000건은 첫 20개 카드만 서버 렌더링하고 전체 집계를 유지한다',()=>{
  const html=renderStudents(fixture());assert.equal((html.match(/data-student-record-id=/g)||[]).length,20)
  assert(html.includes('전체 기록 1000건 보기'));assert(html.includes('총 1,000개 중 1–20개 표시'));assert(!html.includes('합성 사실 20 판'))
})
test('첫 화면에는 3,000개 개정 이력 본문을 생성하지 않고 펼침 안내만 제공한다',()=>{
  const html=renderStudents(fixture());assert.equal((html.match(/불변 개정 이력 3개/g)||[]).length,20);assert(!html.includes('class="students-history"'));assert(!html.includes('합성 개정 1'))
})
test('페이지 나누기 후에도 전체 기록의 유효 근거 텍스트를 출력한다',()=>{
  const props=fixture(),text=props.store.exportEvidence(member.id);assert(text.includes('본인 유효 기록: 1000건'));assert(text.includes('[scale-0999@v3]'));assert(text.includes('합성 사실 999 판 3'))
})
test('마지막 일부와 빈 목록은 불필요한 쪽 이동 버튼 없이 렌더링한다',()=>{
  for(const count of[0,1,20]){const html=renderStudents(fixture(count));assert.equal((html.match(/data-student-record-id=/g)||[]).length,count);assert(!html.includes('aria-label="관찰 기록 페이지"'))}
})
test('21번째 기록부터 쪽 안내와 키보드 조작 가능한 이동 버튼을 제공한다',()=>{
  const html=renderStudents(fixture(21));assert(html.includes('aria-label="관찰 기록 페이지"'));assert(html.includes('1 / 2쪽'));assert(/<button[^>]*disabled[^>]*>처음<\/button>/.test(html));assert(/<button[^>]*>다음<\/button>/.test(html))
})
test('대량 목록에서도 본인 학교 소속 종료 시 모든 카드와 쪽 이동을 숨긴다',()=>{
  const props=fixture(),inactive={...member,active:false},html=renderStudents({...props,member:inactive,members:members.map(row=>row.id===member.id?inactive:row)})
  assert(html.includes('현재 학교 소속이 종료'));assert(!html.includes('data-student-record-id='));assert(!html.includes('관찰 기록 페이지'))
})
test('깨진 관찰 목록을 20건으로 잘라 통과시키지 않고 전체 조회 실패로 안내한다',()=>{
  for(const input of[null,'잘못된 배열',[...fixture(21).store.listRecords(member.id),null]]){
    const props=fixture(),html=renderStudents({...props,store:{...props.store,listRecords(){return input}}});assert(html.includes('관찰 기록을 확인하지 못했습니다'));assert(!html.includes('data-student-record-id='))
  }
})
console.log(`학생 목록 페이지 구조: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
