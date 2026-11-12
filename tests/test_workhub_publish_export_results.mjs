import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {copyWorkflowResult:copy,workflowResultLabel:label,captureWorkflowPlanOrigin:capture,recordWorkflowPlanResult:record,renderPlan,controlFeedback}=await loadBrowserModule(`
export * from '../apps/workhub/src/app/workflow-results.ts'
export * from '../apps/workhub/src/assistant/plan-workflow-results.ts'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {WorkspacePlanCard} from '../apps/workhub/src/assistant/WorkspacePlanCard'
import {useWorkspacePlan} from '../apps/workhub/src/assistant/useWorkspacePlan'
export function controlFeedback(saved){
 const messages=[];let model;const session={prompt:'1번 단계',workspacePlan:saved};const latest={current:session}
 function Harness(){model=useWorkspacePlan({session,latest,scope:saved.scope,date:saved.plan.basisDate,active:true,editable:true,update:s=>{latest.current=s},feedback:e=>messages.push(e),selected(){}});return null}
 renderToStaticMarkup(createElement(Harness));model.handleControl();return messages
}
export function renderPlan(saved){return renderToStaticMarkup(createElement(WorkspacePlanCard,{hasInput:false,model:{saved,manageable:true,selectable:true,stale:false,blockedSelection:false,dismiss(){},choose(){},restoreOriginal(){}}}))}
`)
const scope='school/member/user',date='2026-11-12',stamp='2026-11-12T01:02:03.000Z'
const base={scope,key:'key-a',recordedAt:stamp}
const school={...base,kind:'school_data',action:'course_correct',courseId:'course-a',entityId:'course-a',entityVersion:2}
const publication={...base,kind:'publication',action:'publish',publicationId:'publication-a',publicationVersion:1,changedCount:288}
const output={scope,key:'key-a',kind:'record_export',action:'preview',observedAt:stamp,courseId:'course-a',studentId:'student-a',firstDay:'2026-03-01',lastDay:'2026-11-12',observations:true,assessments:true,includeWithdrawn:false,recordCount:2,fingerprint:'a'.repeat(64)}
const secrets={studentName:'비공개 학생',text:'비공개 관찰',scores:[8],reason:'개인 사유',rows:[{text:'본문'}],teachers:['교사 이름'],counseling:'상담 원문',changes:{name:'이름'}}
function saved(command={kind:'navigate',page:'students'}){return {scope,selectedId:'step-a',plan:{kind:'plan',prompt:'전체 원문',basisDate:date,steps:[{id:'step-a',prompt:'원래 업무',label:'첫 업무',command}]}}}
const origin=(state,target)=>capture(state,'원래 업무',scope,date,target)
const add=(state,first,result)=>record(state,first,result,scope,date)
const results=state=>state.outcomes?.['step-a']?.results??[]
let passed=0,failed=0
function test(name,fn){try{fn();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}

test('정정 9종의 접수 메타만 복사하고 이름·변경내용·사유를 제외한다',()=>{
 for(const action of ['course_correct','course_cancel','course_archive','course_restore','course_teacher_correct','student_correct','student_void','student_restore','enrollment_correct']){
  const expected={...school,action,entityId:action.startsWith('course_')?'course-a':'entity-a'}
  assert.deepEqual(copy({...expected,...secrets}),expected);assert.notEqual(copy(expected),expected)
 }
})
test('수업 정정 원본과 수업 번호가 다르면 거부한다',()=>assert.equal(copy({...school,entityId:'different'}),undefined))
test('알 수 없는 정정·판·시각은 결과로 받아들이지 않는다',()=>{
 for(const patch of [{action:'counseling_save'},{action:'__proto__'},{entityVersion:0},{entityVersion:1},{entityVersion:1.5},{recordedAt:'unknown'},{courseId:''},{entityId:''}])assert.equal(copy({...school,...patch}),undefined)
})
test('수업 취소·보관·복원과 학생 무효·복원을 각각 표시한다',()=>{
 for(const [action,word] of [['course_cancel','취소'],['course_archive','보관'],['course_restore','복원'],['student_void','무효'],['student_restore','복원'],['enrollment_correct','학년·학급·번호']])assert.match(label({...school,action}),new RegExp(word))
})
test('일반·전체 명세 공개의 실제 접수만 최소 정보로 복사한다',()=>{
 for(const action of ['publish','publish_manifest']){const expected={...publication,action};assert.deepEqual(copy({...expected,...secrets,manifest:{students:['개인정보']}}),expected);assert.equal(label(expected),'시간표 공개 · 수업 288건 반영')}
})
test('공개 판·반영 건수·종류·서버 시각 누락은 거부한다',()=>{
 for(const patch of [{action:'preview'},{changedCount:0},{changedCount:-1},{changedCount:1.1},{changedCount:Number.MAX_SAFE_INTEGER+1},{publicationVersion:0},{publicationId:''},{recordedAt:undefined}])assert.equal(copy({...publication,...patch}),undefined)
})
test('출력은 클라이언트 확인 시각을 쓰고 서버 접수 시각을 만들지 않는다',()=>{
 for(const action of ['preview','csv_requested','print_opened']){const expected={...output,action};assert.deepEqual(copy({...expected,...secrets,recordedAt:stamp}),expected);assert(!Object.hasOwn(copy(expected),'recordedAt'))}
})
test('0건 미리보기는 허용하지만 빈 파일 출력 사실은 거부한다',()=>{
 assert.equal(copy({...output,recordCount:0}).recordCount,0)
 for(const action of ['csv_requested','print_opened'])assert.equal(copy({...output,action,recordCount:0}),undefined)
})
test('출력 범위의 실제 날짜·순서·조회 종류·건수·지문을 검사한다',()=>{
 for(const patch of [{firstDay:'2026-02-30'},{firstDay:'2026-13-01'},{lastDay:'2026-02-01'},{firstDay:'2026-3-1'},{observations:false,assessments:false},{observations:'true'},{includeWithdrawn:undefined},{recordCount:-1},{recordCount:2.1},{fingerprint:'a'.repeat(63)},{studentId:''},{observedAt:'bad'}])assert.equal(copy({...output,...patch}),undefined)
})
test('출력 단계 문구는 저장·인쇄 성공을 주장하지 않는다',()=>{
 assert.match(label(output),/미리보기.*출력 전/)
 assert.match(label({...output,action:'csv_requested'}),/내려받기 요청.*저장 확인 필요/)
 assert.match(label({...output,action:'print_opened'}),/인쇄 창 전달.*저장 확인 필요/)
 for(const action of ['preview','csv_requested','print_opened'])assert.doesNotMatch(label({...output,action}),/저장 완료|인쇄 완료|최종 제출/)
})
test('처음 선택한 수업 정정만 검색 단계에 연결한다',()=>{
 const state=saved({kind:'search',query:'국어',kinds:['course']}),bound=origin(state,{kind:'course',id:'course-a'})
 assert.equal(results(add(state,bound,school)).length,1)
 assert.equal(add(state,bound,{...school,courseId:'course-b',entityId:'course-b'}),state)
})
test('정정은 같은 원본의 후속 판만 연결하고 다른 학생·수업은 제외한다',()=>{
 const state=saved(),bound=origin(state),first=add(state,bound,school)
 assert.equal(results(add(first,bound,{...school,key:'k2',action:'course_archive',entityVersion:3})).length,2)
 for(const patch of [{courseId:'other',entityId:'other'},{action:'student_correct',entityId:'student-a'},{action:'enrollment_correct',entityId:'course-a'}])assert.equal(add(first,bound,{...school,key:'k2',...patch}),first)
})
test('학교 자료 정정은 시간표 준비 보완으로 기록하며 공개 완료로 혼동하지 않는다',()=>{
 for(const command of [{kind:'navigate',page:'timetable'},{kind:'specialist',task:'timetablePrepare'}]){const state=saved(command);assert.equal(results(add(state,origin(state),school)).length,1)}
 for(const task of ['timetablePublish','timetableExchange','teachingRecords','teachingAssessment']){const state=saved({kind:'specialist',task});assert.equal(add(state,origin(state),school),state)}
})
test('시간표 공개 전문 단계에 공개 접수를 연결한다',()=>{
 const state=saved({kind:'specialist',task:'timetablePublish'});assert.equal(results(add(state,origin(state),publication)).length,1)
})
test('공개를 교환·대강·편성 준비 단계에 붙이지 않는다',()=>{
 for(const task of ['timetableExchange','timetableSubstitute','timetablePrepare']){const state=saved({kind:'specialist',task});assert.equal(add(state,origin(state),publication),state)}
})
test('공개 접수 뒤 다른 공개 원본은 같은 이력으로 합치지 않는다',()=>{
 const state=saved({kind:'navigate',page:'timetable'}),bound=origin(state),first=add(state,bound,publication)
 assert.equal(add(first,bound,{...publication,key:'new',publicationId:'publication-b'}),first)
 assert.equal(results(add(first,bound,{...publication,key:'new',action:'publish_manifest',publicationVersion:2})).length,2)
})
test('미리보기에서 같은 학생·기간의 CSV·인쇄 요청을 이어 기록한다',()=>{
 const state=saved(),bound=origin(state),first=add(state,bound,output),second=add(first,bound,{...output,key:'k2',action:'csv_requested'})
 assert.equal(results(second).length,2);assert.equal(results(add(second,bound,{...output,key:'k3',action:'print_opened'})).length,3)
})
test('출력 중 학생·수업·기간·종류·철회 포함 범위가 바뀌면 원래 이력에 붙이지 않는다',()=>{
 const state=saved(),bound=origin(state),first=add(state,bound,output)
 for(const patch of [{studentId:'student-b'},{courseId:'course-b'},{firstDay:'2026-04-01'},{lastDay:'2026-11-11'},{observations:false},{assessments:false},{includeWithdrawn:true}])assert.equal(add(first,bound,{...output,key:'new',...patch}),first)
})
test('같은 출력 범위의 최신 기록 재조회는 지문과 건수가 바뀌어도 기록한다',()=>{
 const state=saved(),bound=origin(state),first=add(state,bound,output)
 const next=add(first,bound,{...output,key:'new',fingerprint:'b'.repeat(64),recordCount:3})
 assert.equal(results(next).length,2);assert.equal(results(next)[1].fingerprint,'b'.repeat(64))
})
test('관찰·평가 전문 단계에는 해당 종류만 선택한 출력 결과를 연결한다',()=>{
 for(const [task,selected] of [['teachingRecords',{observations:true,assessments:false}],['teachingAssessment',{observations:false,assessments:true}]]){
  const state=saved({kind:'specialist',task}),bound=origin(state)
  assert.equal(results(add(state,bound,{...output,...selected})).length,1)
  assert.equal(add(state,bound,output),state)
  assert.equal(add(state,bound,{...output,observations:!selected.observations,assessments:!selected.assessments}),state)
 }
})
test('활동 자료 전문 단계에 기록 출력을 근거 반영으로 붙이지 않는다',()=>{
 const state=saved({kind:'specialist',task:'teachingActivity'});assert.equal(add(state,origin(state),output),state)
})
test('검색에서 선택한 수업의 출력만 연결한다',()=>{
 const state=saved({kind:'search',query:'수업',kinds:['course']}),bound=origin(state,{kind:'course',id:'course-a'})
 assert.equal(results(add(state,bound,output)).length,1)
 assert.equal(add(state,bound,{...output,courseId:'other'}),state)
})
test('잘못된 검색 종류나 다른 페이지에는 세 결과를 붙이지 않는다',()=>{
 for(const result of [school,publication,output])for(const command of [{kind:'navigate',page:'messages'},{kind:'search',query:'검색',kinds:['message']}]){const state=saved(command);assert.equal(add(state,origin(state),result),state)}
})
test('학교·계정 범위와 기준일 변경 뒤 결과는 버린다',()=>{
 for(const result of [school,publication,output]){const state=saved({kind:'navigate',page:result.kind==='publication'?'timetable':'students'}),bound=origin(state)
  assert.equal(record(state,bound,result,'other',date),state);assert.equal(record(state,bound,result,scope,'2026-11-13'),state);assert.equal(add(state,bound,{...result,scope:'other'}),state)
 }
})
test('새 계획이 같은 번호·원문을 재사용해도 옛 작업의 늦은 결과는 붙이지 않는다',()=>{
 for(const result of [school,publication,output]){const state=saved({kind:'navigate',page:result.kind==='publication'?'timetable':'students'}),bound=origin(state),next=structuredClone(state);assert.equal(add(next,bound,result),next)}
})
test('같은 요청 번호 재확인은 이력을 늘리지 않는다',()=>{
 for(const result of [school,publication,output]){const state=saved({kind:'navigate',page:result.kind==='publication'?'timetable':'students'}),bound=origin(state),first=add(state,bound,result);assert.equal(results(first).length,1);assert.equal(add(first,bound,result),first)}
})
test('보관 결과 객체의 원본을 변경해도 표시된 최소 정보는 바뀌지 않는다',()=>{
 const raw={...output,...secrets},result=copy(raw);raw.studentId='other';raw.rows[0].text='다른 본문';assert.equal(result.studentId,'student-a');assert(!Object.hasOwn(result,'rows'))
})
test('실제 업무 카드의 CSV 상태는 서버 저장 완료로 표시하지 않는다',()=>{
 const state=saved(),bound=origin(state),next=add(state,bound,{...output,action:'csv_requested'}),html=renderPlan(next)
 assert.match(html,/처리 내역 확인/);assert.match(html,/CSV 내려받기 요청/);assert.match(html,/저장 확인 필요/);assert.doesNotMatch(html,/서버 처리 확인|저장 완료/)
})
test('로컬 미리보기를 다시 선택해도 서버 처리 완료라고 안내하지 않는다',()=>{
 const state=saved(),next=add(state,origin(state),{...output,recordCount:0}),feedback=controlFeedback(next).join(' ')
 assert.match(feedback,/이미 처리 내역을 확인한 단계/);assert.doesNotMatch(feedback,/서버 처리/)
})
console.log(`공개·정정·출력 결과 단위 ${passed}건 통과 · 실패 ${failed}`)
if(failed)process.exit(1)
