import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {findSourceFollowup,TeachingError}=await loadBrowserModule(`
export {findSourceFollowup} from '../apps/workhub/src/teaching/source-followup'
export {TeachingError} from '../apps/workhub/src/teaching/contracts'`)
const scope={schoolId:'school-a',memberId:'member-a',ownerUserId:'user-a'}
const student={id:'student-a',schoolId:'school-a',version:1,schoolStudentKey:'key-a',name:'합성 학생',grade:1,classLabel:'1',seatNumber:1,enrollmentId:'enroll-a',courseMembershipId:'membership-a',validFrom:'2026-08-13',validThrough:'2027-02-28'}
const course={contractVersion:'teaching.v1',...scope,course:{id:'course-a'},students:[student]}
const record=(id,patch={})=>({id,schoolId:'school-a',version:1,ownerUserId:'user-a',courseId:'course-a',studentId:'student-a',courseMembershipId:'membership-a',assignmentId:'assignment-a',occurredOn:'2026-10-16',state:'active',contentHash:'a'.repeat(64),epoch:1,sourceReviewRequired:true,kind:'observation',revisionId:id+'-rev',text:'목록에 보관하지 않을 개인 관찰',...patch})
function fixture(pages=[{observations:[record('obs-a')],assessments:[],nextCursor:null}]) {
 const calls=[]
 const adapter={async student(memberId,courseId,studentId,cursor=null){calls.push([memberId,courseId,studentId,cursor]);return structuredClone({contractVersion:'teaching.v1',...scope,courseId,studentId,...pages[cursor===null?0:Number(cursor)]})},async counseling(){throw Error('상담 조회 금지')},async mutate(){throw Error('기록 변경 금지')}}
 return{adapter,calls,read:(guard)=>findSourceFollowup(adapter,scope,course,student,guard)}
}
let count=0
async function test(name,run){await run();count++;console.log('  ✓ '+name)}
await test('재검토 관찰의 위치만 반환하고 본문·상담·평가를 목록에 보관하지 않는다',async()=>{
 const f=fixture(),result=await f.read()
 assert.deepEqual(result,{studentId:'student-a',recordId:'obs-a',occurredOn:'2026-10-16',cursor:null})
 assert.equal(JSON.stringify(result).includes('개인 관찰'),false);assert.equal(f.calls.length,1)
})
await test('이전 페이지에서 재검토 기록을 찾으면 그 페이지의 커서를 보존한다',async()=>{
 const f=fixture([{observations:[record('recent',{sourceReviewRequired:false})],assessments:[],nextCursor:'1'},{observations:[record('old')],assessments:[],nextCursor:'2'}])
 assert.equal((await f.read()).cursor,'1');assert.deepEqual(f.calls.map(c=>c[3]),[null,'1'])
})
await test('철회된 관찰은 제외하고 끝까지 읽은 경우에만 없음으로 판단한다',async()=>{
 const f=fixture([{observations:[record('withdrawn',{state:'withdrawn'})],assessments:[],nextCursor:'1'},{observations:[record('clean',{sourceReviewRequired:false})],assessments:[],nextCursor:null}])
 assert.equal(await f.read(),null);assert.equal(f.calls.length,2)
})
await test('다음 페이지 실패를 재검토 없음으로 바꾸지 않는다',async()=>{
 const f=fixture([{observations:[],assessments:[],nextCursor:'1'}]),original=f.adapter.student
 f.adapter.student=async(...args)=>{if(args[3])throw new TeachingError('QUERY_FAILED','확인 실패');return original(...args)}
 await assert.rejects(f.read(),e=>e.code==='QUERY_FAILED')
})
await test('반복 커서와 중복 관찰 ID는 조회 변경으로 중단한다',async()=>{
 for(const pages of [
 [{observations:[],assessments:[],nextCursor:'1'},{observations:[],assessments:[],nextCursor:'1'}],
 [{observations:[record('same',{sourceReviewRequired:false})],assessments:[],nextCursor:'1'},{observations:[record('same')],assessments:[],nextCursor:null}],
 ])await assert.rejects(fixture(pages).read(),e=>e.code==='QUERY_FAILED')
})
await test('조회 한도를 넘기면 일부 확인을 완료로 표시하지 않는다',async()=>{
 const f=fixture(Array.from({length:51},(_,i)=>({observations:[],assessments:[],nextCursor:String(i+1)})))
 await assert.rejects(f.read(),e=>e.code==='QUERY_FAILED');assert.equal(f.calls.length,50)
})
await test('다른 학교·교사·학생·수업 응답은 반환하지 않는다',async()=>{
 for(const [key,value] of [['schoolId','other-school'],['ownerUserId','other-user'],['studentId','other-student'],['courseId','other-course']]){
  const f=fixture([{observations:[record('wrong',{[key]:value})],assessments:[],nextCursor:null}])
  await assert.rejects(f.read())
 }
})
await test('수업 밖 학생 또는 다른 소속의 수업이면 서버 호출도 시작하지 않는다',async()=>{
 const f=fixture()
 for(const altered of [{...course,students:[]},{...course,memberId:'other-member'},{...course,schoolId:'other-school'}])
  await assert.rejects(findSourceFollowup(f.adapter,scope,altered,student),e=>e.code==='FORBIDDEN')
 assert.equal(f.calls.length,0)
})
await test('중단·권한 변경 뒤 도착한 응답은 표시 후보가 되지 않는다',async()=>{
 const f=fixture(),original=f.adapter.student;let active=true
 f.adapter.student=async(...args)=>{const value=await original(...args);active=false;return value}
 await assert.rejects(f.read(()=>active),e=>e.code==='CANCELLED')
})
console.log(count+'건 통과')
