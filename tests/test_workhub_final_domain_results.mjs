import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {copyWorkflowResult:copy,workflowResultLabel:label,captureWorkflowPlanOrigin:capture,recordWorkflowPlanResult:record,renderPlan}=await loadBrowserModule(`
export * from '../apps/workhub/src/app/workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-workflow-results.ts'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {WorkspacePlanCard} from '../apps/workhub/src/assistant/WorkspacePlanCard'
export function renderPlan(saved){return renderToStaticMarkup(createElement(WorkspacePlanCard,{hasInput:false,model:{saved,manageable:true,selectable:true,stale:false,blockedSelection:false,dismiss(){},choose(){},restoreOriginal(){}}}))}
`)
const scope='school/member/user',date='2026-11-12',base={scope,key:'first-key',recordedAt:'2026-11-12T03:00:00.000Z'}
const configuration={...base,kind:'school_configuration',action:'update',configurationId:'year-a',configurationVersion:3,schoolYear:2026}
const relations={...base,kind:'relations',action:'assignment_end',courseId:'course-a',relationId:'assignment-a',relationVersion:2,changedCount:1}
const knowledge={...base,kind:'knowledge',action:'create',sourceId:'source-a',sourceVersion:1}
const execution={...base,kind:'execution',action:'save',recordId:'record-a',recordVersion:1,lessonId:'lesson-a',lessonVersion:4,outcome:'needs_review'}
const all=[configuration,relations,knowledge,execution]
const secrets={name:'비공개 이름',studentId:'비공개 학생',body:'비공개 본문',reason:'개인 사유',scores:[4],changes:[{name:'교사'}],configuration:{schoolName:'실제 이름'},record:{notes:'상담'},file:{url:'private'}}
function saved(command){return {scope,selectedId:'a',plan:{kind:'plan',prompt:'전체 원문',basisDate:date,steps:[{id:'a',label:'업무',prompt:'원래 업무',command}]}}}
const origin=(s,target)=>capture(s,'원래 업무',scope,date,target),add=(s,o,r)=>record(s,o,r,scope,date),results=s=>s.outcomes?.a?.results??[]
const command=r=>({kind:'navigate',page:({school_configuration:'schoolAdmin',relations:'students',knowledge:'knowledge',execution:'timetable'})[r.kind]})
let passed=0,failed=0
function test(name,fn){try{fn();passed++;console.log('  ✓ '+name)}catch(e){failed++;console.error('  ✗ '+name,e)}}
test('네 결과는 본문·이름·사유·원본 객체를 복제하지 않는다',()=>{for(const r of all)assert.deepEqual(copy({...r,...secrets}),r)})
test('학교 구성은 학년도·구성 원본·접수판만 보관한다',()=>{assert.deepEqual(copy(configuration),configuration);assert.match(label({...configuration,action:'create_year'}),/담당 배정 별도/)})
test('학교 구성의 초기판·잘못된 학년도·권한 작업은 결과로 만들지 않는다',()=>{for(const p of [{configurationVersion:1},{configurationId:''},{schoolYear:1},{schoolYear:2026.5},{schoolYear:9999},{action:'review_membership'},{action:'assign_duty'}])assert.equal(copy({...configuration,...p}),undefined)})
test('관계 네 종류를 종료·교체·전출로 구별한다',()=>{for(const action of ['assignment_end','assignment_replace','membership_end','student_transfer_out']){const r={...relations,action,...(action==='assignment_replace'?{replacementAssignmentId:'new-assignment'}:{})};assert.deepEqual(copy(r),r);assert(label(r).length)}})
test('관계 교체의 새 원본 누락·동일 원본·다른 명령의 잉여 식별자를 거부한다',()=>{for(const p of [{action:'assignment_replace'},{action:'assignment_replace',replacementAssignmentId:'assignment-a'},{replacementAssignmentId:'new'},{changedCount:0},{changedCount:1.5},{relationVersion:1},{courseId:''}])assert.equal(copy({...relations,...p}),undefined)})
test('학교 자료 생성·가져오기는 1판이며 게시와 종료는 후속판이다',()=>{for(const action of ['create','import','update','publish','retire']){const r={...knowledge,action,sourceVersion:['create','import'].includes(action)?1:2};assert.deepEqual(copy(r),r);assert.equal(copy({...r,sourceVersion:r.sourceVersion===1?2:1}),undefined)}})
test('학교 자료 초안·게시·기간을 구분한다',()=>{assert.match(label(knowledge),/게시 전/);assert.match(label({...knowledge,action:'publish'}),/적용 기간 별도/);assert.match(label({...knowledge,action:'retire'}),/게시 종료/)})
test('실시 결과는 확인 필요·미실시를 완료로 부르지 않는다',()=>{assert.match(label(execution),/확인 필요/);assert.doesNotMatch(label(execution),/완료/);assert.match(label({...execution,outcome:'not_performed'}),/미실시/);assert.match(label({...execution,outcome:'completed'}),/실시 완료/)})
test('실시 신규 저장과 정정 판·수업 판·종류를 검사한다',()=>{for(const p of [{recordVersion:2},{action:'correct',recordVersion:1},{action:'void'},{outcome:'approved'},{lessonVersion:0},{recordId:''}])assert.equal(copy({...execution,...p}),undefined);assert(copy({...execution,action:'correct',recordVersion:2}))})
test('학교 기본 설정과 시간표 준비는 구성 결과를 받는다',()=>{for(const c of [{kind:'navigate',page:'schoolAdmin'},{kind:'navigate',page:'timetable'},{kind:'specialist',task:'schoolSettings'},{kind:'specialist',task:'timetablePrepare'}]){const s=saved(c);assert.equal(results(add(s,origin(s),configuration)).length,1)}})
test('학교 구성은 같은 학년도 원본만 이어 붙인다',()=>{const s=saved(command(configuration)),o=origin(s),first=add(s,o,configuration);for(const p of [{configurationId:'other'},{schoolYear:2027}])assert.equal(add(first,o,{...configuration,key:'new',...p}),first);assert.equal(results(add(first,o,{...configuration,key:'new',configurationVersion:4})).length,2)})
test('관계는 수업 검색에서 선택한 수업만 받는다',()=>{const s=saved({kind:'search',query:'수업',kinds:['course']}),o=origin(s,{kind:'course',id:'course-a'});assert.equal(results(add(s,o,relations)).length,1);assert.equal(add(s,o,{...relations,courseId:'other'}),s)})
test('관계는 같은 원본·종류의 후속 결과만 받는다',()=>{const s=saved(command(relations)),o=origin(s),first=add(s,o,relations);for(const p of [{courseId:'other'},{relationId:'other'},{action:'membership_end'}])assert.equal(add(first,o,{...relations,key:'new',...p}),first)})
test('관계 교체로 생긴 별도 담당 원본은 이전 원본에 합치지 않는다',()=>{const s=saved(command(relations)),o=origin(s),first=add(s,o,{...relations,action:'assignment_replace',replacementAssignmentId:'new'});assert.equal(add(first,o,{...relations,key:'next',relationId:'new'}),first)})
test('학교 자료 검색의 원본과 다른 자료 게시를 받지 않는다',()=>{const s=saved({kind:'search',query:'자료',kinds:['knowledge']}),o=origin(s,{kind:'knowledge',id:'source-a'});assert.equal(results(add(s,o,knowledge)).length,1);assert.equal(add(s,o,{...knowledge,sourceId:'other'}),s)})
test('학교 자료 생성·게시·종료는 같은 원본의 이력이다',()=>{const s=saved(command(knowledge)),o=origin(s),first=add(s,o,knowledge),second=add(first,o,{...knowledge,key:'publish',action:'publish',sourceVersion:2});assert.equal(results(second).length,2);assert.equal(results(add(second,o,{...knowledge,key:'retire',action:'retire',sourceVersion:3})).length,3);assert.equal(add(second,o,{...knowledge,key:'new',sourceId:'other'}),second)})
test('실시 결과는 시간표 조회에만 붙고 공개·교환·대강 완료로 붙지 않는다',()=>{const s=saved({kind:'specialist',task:'timetableView'});assert.equal(results(add(s,origin(s),execution)).length,1);for(const task of ['timetablePublish','timetableExchange','timetableSubstitute','timetablePrepare']){const x=saved({kind:'specialist',task});assert.equal(add(x,origin(x),execution),x)}})
test('실시 기록은 같은 수업의 같은 기록만 정정 이력을 잇는다',()=>{const s=saved(command(execution)),o=origin(s),first=add(s,o,execution);for(const p of [{lessonId:'other'},{recordId:'other'}])assert.equal(add(first,o,{...execution,key:'new',action:'correct',recordVersion:2,...p}),first);assert.equal(results(add(first,o,{...execution,key:'new',action:'correct',recordVersion:2,outcome:'completed'})).length,2)})
test('전문 기록·평가·인계는 별도 관리 결과를 받지 않는다',()=>{for(const task of ['teachingRecords','teachingAssessment','teachingActivity','schoolTransition'])for(const r of all){const s=saved({kind:'specialist',task});assert.equal(add(s,origin(s),r),s)}})
test('다른 원본 종류·본문 검색에는 결과를 붙이지 않는다',()=>{for(const r of all){const s=saved({kind:'search',query:'검색',kinds:['message']}),o=origin(s,{kind:'message',id:'a'});assert.equal(add(s,o,r),s)}})
test('학교·계정·기준일이 바뀐 뒤 늦은 결과는 제외한다',()=>{for(const r of all){const s=saved(command(r)),o=origin(s);assert.equal(record(s,o,r,'other',date),s);assert.equal(record(s,o,r,scope,'2026-11-13'),s);assert.equal(add(s,o,{...r,scope:'other'}),s)}})
test('새 계획에 이전 결과를 붙이지 않고 같은 번호 복구를 중복 기록하지 않는다',()=>{for(const r of all){const s=saved(command(r)),o=origin(s),fresh=structuredClone(s);assert.equal(add(fresh,o,r),fresh);const first=add(s,o,r);assert.equal(add(first,o,r),first)}})
test('실제 업무 카드에서 미실시는 접수 내역이며 전체 업무 완료가 아니다',()=>{const s=saved(command(execution)),next=add(s,origin(s),{...execution,outcome:'not_performed'}),html=renderPlan(next);assert.match(html,/처리 내역 확인/);assert.match(html,/미실시/);assert.doesNotMatch(html,/실시 완료|확정 완료/);assert.doesNotMatch(html,/비공개/)})
test('모든 결과에 실제 접수 시각과 요청 번호가 필요하다',()=>{for(const r of all)for(const p of [{key:''},{recordedAt:undefined},{recordedAt:'bad'}])assert.equal(copy({...r,...p}),undefined)})
console.log(`최종 영역 결과 단위 ${passed}건 통과 · 실패 ${failed}`)
if(failed)process.exit(1)
