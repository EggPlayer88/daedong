import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {observationInputIssues,activityInputIssues,observationLimits,renderEntry,renderAdoption}=await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server';import {ObservationEntry,ActivityObservationEntry} from '../apps/workhub/src/students/ObservationEntry';
  export {observationInputIssues,activityInputIssues,observationLimits} from '../apps/workhub/src/students/entry';
  const target={student:'1번 · 가상 학생 가',course:'가상 학급 · 정보 수업',date:'2026-10-01',valid:true};
  export const renderEntry=changes=>renderToStaticMarkup(<ObservationEntry input={{activity:'토의',content:'출처를 설명함.',reason:'',confirmed:false}} target={target} dirty={false} resetToken={0} onChange={()=>{}} onSave={()=>{}} onCancel={()=>{}} {...changes}/>);
  export const renderAdoption=changes=>renderToStaticMarkup(<ActivityObservationEntry content="응답에서 확인한 사실" confirmed={false} target={target} sourceRevision={3} onChange={()=>{}} onSave={()=>{}} onCancel={()=>{}} {...changes}/>);
`)
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
const input={activity:'자료 공유 토의',content:'출처를 확인한다고 설명함.',reason:'사실 확인',confirmed:true}
test('직접 관찰의 정상 입력은 추가 저장 규칙을 만들지 않는다',()=>assert.deepEqual(observationInputIssues(input,true),[]))
test('필수 활동·관찰 내용·사실 확인을 입력 순서대로 안내한다',()=>assert.deepEqual(observationInputIssues({activity:'',content:'',reason:'',confirmed:false},true).map(issue=>issue.field),['activity','content','confirmed']))
test('공백·줄바꿈만 있는 내용을 사실 기록으로 받아들이지 않는다',()=>assert.deepEqual(observationInputIssues({...input,activity:'  ',content:'\n\t '},true).map(issue=>issue.field),['activity','content']))
test('승인 수업이나 대상 학생이 없으면 대상 확인을 가장 먼저 요구한다',()=>{
  const issues=observationInputIssues({...input,activity:''},false);assert.equal(issues[0].field,'target');assert.match(issues[0].message,/자동 변경하지 않습니다/)
})
test('정정에만 사유가 필수이며 신규 기록에 정정 사유를 강제하지 않는다',()=>{
  assert.deepEqual(observationInputIssues({...input,reason:''},true),[])
  assert.deepEqual(observationInputIssues({...input,reason:' '},true,true).map(issue=>issue.field),['reason'])
})
test('기존 저장 한도와 같은 글자수 경계는 허용하고 한 글자 초과는 설명한다',()=>{
  assert.deepEqual(observationLimits,{activity:150,content:4000,reason:300})
  for(const field of ['activity','content','reason']){
    assert.deepEqual(observationInputIssues({...input,[field]:'가'.repeat(observationLimits[field])},true,true),[])
    assert.equal(observationInputIssues({...input,[field]:'가'.repeat(observationLimits[field]+1)},true,true)[0].field,field)
  }
})
test('문자열이 아닌 입력도 예외 대신 해당 항목 오류로 반환한다',()=>{
  for(const value of [null,{},[]])assert.deepEqual(observationInputIssues({...input,activity:value,content:value},true).map(issue=>issue.field),['activity','content'])
})
test('확인란에는 실제 true만 인정한다',()=>{
  for(const value of [false,null,'true',1])assert.equal(observationInputIssues({...input,confirmed:value},true)[0].field,'confirmed')
})
test('활동 채택은 관찰 내용과 확인만 요구하고 이미 결정된 활동명을 다시 요구하지 않는다',()=>{
  assert.deepEqual(activityInputIssues('확인 사실',true,true),[])
  assert.deepEqual(activityInputIssues('',false,true).map(issue=>issue.field),['content','confirmed'])
})
test('채택 대상 연결 불일치·원문 변경은 내용이 채워져도 대상 오류로 막는다',()=>assert.equal(activityInputIssues('확인 사실',true,false)[0].field,'target'))
test('SSR에 학생·수업·관찰일과 각 입력 한도를 함께 표시한다',()=>{
  const html=renderEntry({});for(const text of ['이번에 기록할 대상','1번 · 가상 학생 가','가상 학급 · 정보 수업','2026-10-01','150자','4000자'])assert(html.includes(text),text)
  assert(html.includes('data-entry-field="content"'));assert(html.includes('aria-describedby='));assert(!html.includes('type="submit" disabled'))
})
test('정정 SSR은 원기록 판·불변 이력·정정 사유를 명시한다',()=>{
  const html=renderEntry({version:2,dirty:true});for(const text of ['v2 기준','정정하는 기록의 대상','이전 내용은 보존','정정 사유','300자','정정 취소'])assert(html.includes(text),text)
})
test('대상 조회 실패 SSR은 임의의 다른 학생을 제시하지 않고 저장 불가를 설명한다',()=>{
  const html=renderEntry({target:{student:'기존 학생 확인 필요',course:'수업 확인 필요',date:'2026-10-01',valid:false}})
  assert(html.includes('저장할 수 없습니다'));assert(!html.includes('1번 · 가상 학생 가'))
})
test('활동 채택 SSR은 확정 대상과 원문판을 표시하고 원문을 HTML로 실행하지 않는다',()=>{
  const html=renderAdoption({content:'<script>외부 응답</script>'});assert(html.includes('원문 판 3'));assert(html.includes('학생 연결이 확정된 대상'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>외부'))
})
console.log(`학생 입력 안내: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
