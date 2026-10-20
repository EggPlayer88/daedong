import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
import { teachingRosterFixture } from './fixtures/teaching-roster-import.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/teaching/roster-correction';export {rosterReviewBasis} from '../apps/workhub/src/teaching/roster-import';`)
let passed=0
const fixture=()=>{const {course,draft}=teachingRosterFixture();return {course,input:{...draft,roster:[{...course.students[0],name:'정정 이름'}],rosterBasis:m.rosterReviewBasis(course)}}}
function test(name,run){run();passed++;console.log('  ✓',name)}
test('공식 번호와 학생·학적·수강 ID를 함께 고정한다',()=>{const {course,input}=fixture(),[target]=m.rosterCorrectionTargets(input,course,'001001');assert.equal(target.studentId,'student-a');assert.equal(target.enrollmentId,'enrollment-a');assert.equal(target.courseMembershipId,'membership-a');assert.equal(target.kind,'student');m.assertRosterCorrectionTarget(target,input,course)})
test('학생 정보·학적·기간 차이를 각각의 기존 화면에 연결한다',()=>{const {course,input}=fixture();input.roster[0].grade=2;input.validThrough='2026-07-15';assert.deepEqual(m.rosterCorrectionTargets(input,course,'001001').map(x=>x.kind),['student','enrollment','membership'])})
test('같은 이름 새 학생을 기존 학생 정정 대상으로 추정하지 않는다',()=>{const {course,input}=fixture();input.roster=[{...course.students[0],schoolStudentKey:'other',seatNumber:9}];assert.deepEqual(m.rosterCorrectionTargets(input,course,'other'),[])})
test('좌석 충돌만 있는 행을 다른 학생 ID로 연결하지 않는다',()=>{const {course,input}=fixture();input.roster=[{...course.students[0],schoolStudentKey:'other'}];assert.deepEqual(m.rosterCorrectionTargets(input,course,'other'),[])})
test('수업 판이나 현재 명부가 바뀌면 이전 정정 링크를 거부한다',()=>{for(const mutate of [c=>c.course.version++,c=>c.students[0].name='새 이름',c=>c.students[0].courseMembershipId='changed']){const {course,input}=fixture(),target=m.rosterCorrectionTargets(input,course,'001001')[0];mutate(course);assert.throws(()=>m.assertRosterCorrectionTarget(target,input,course),/최신 명부/);assert.deepEqual(m.rosterCorrectionTargets(input,course,'001001'),[])}})
test('학교·계정·수업·학생·관계 ID 중 하나라도 다르면 거부한다',()=>{const {course,input}=fixture(),target=m.rosterCorrectionTargets(input,course,'001001')[0];for(const key of ['schoolId','memberId','ownerUserId','courseId','studentId','enrollmentId','courseMembershipId'])assert.throws(()=>m.assertRosterCorrectionTarget({...target,[key]:'different'},input,course),/최신 명부/)})
test('현재 명부 관리 권한이 없으면 정정 후보를 만들지 않는다',()=>{const {course,input}=fixture();course.course.canManageRoster=false;input.rosterBasis=m.rosterReviewBasis(course);assert.deepEqual(m.rosterCorrectionTargets(input,course,'001001'),[])})
test('이미 일치하는 행과 사라진 학생은 정정 대상으로 만들지 않는다',()=>{const {course,input}=fixture();input.roster[0].name=course.students[0].name;assert.deepEqual(m.rosterCorrectionTargets(input,course,'001001'),[]);assert.deepEqual(m.rosterCorrectionTargets(input,course,'missing'),[])})
test('링크 생성은 파일·명부·날짜를 변경하지 않는다',()=>{const {course,input}=fixture(),before=structuredClone({course,input});m.rosterCorrectionTargets(input,course,'001001');assert.deepEqual({course,input},before)})
console.log(`\n학생 명부 정정 왕복: ${passed}개 통과`)
