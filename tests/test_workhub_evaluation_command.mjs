import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspaceCommand: parse, parseWorkspacePlan: plan, evaluationLink, render } = await loadBrowserModule(`
export * from '../apps/workhub/src/assistant/workspace-commands.ts'
export * from '../apps/workhub/src/assistant/workspace-plan.ts'
export * from '../apps/workhub/src/assistant/evaluation-workspace.tsx'
import { EvaluationWorkspace } from '../apps/workhub/src/assistant/evaluation-workspace.tsx'
import { renderToStaticMarkup } from 'react-dom/server'
export const render = props => renderToStaticMarkup(<EvaluationWorkspace {...props}/>)`)
const date='2026-11-11';let failed=0
function test(name,run){try{run();console.log('  ✓ '+name)}catch(e){failed++;console.error('  ✗ '+name,e)}}
test('평가계획서 작성과 제출 화면을 구분하며 처리 명령을 만들지 않는다',()=>{
  for(const [text,target] of [['평가계획서 작성 열어줘','authoring'],['평가 계획서 제출 화면 보여주세요','submissions'],['평가계획서 작성 화면으로 이동해줘','authoring']])assert.deepEqual(parse(text,date),{kind:'evaluation',target})
})
test('평가 기록·일반 질문·인용·부정은 평가계획서 연결로 해석하지 않는다',()=>{
  for(const text of ['평가 기록 보여줘','평가계획서는 어떻게 쓰나요','“평가계획서 작성 열어줘”','평가계획서 작성 열지 마','평가계획서 제출해줘','평가계획서 작성해줘'])assert.notEqual(parse(text,date)?.kind,'evaluation',text)
})
test('원문을 담은 계획도 자동 새 탭 실행이 아닌 연결 확인 단계다',()=>{
  const p=plan('평가계획서 작성 열어줘; 평가계획서 제출 열어줘',date)
  assert.equal(p.kind,'plan');assert.equal(p.steps[0].label,'평가계획서 작성 연결');assert.equal(p.steps[1].command.target,'submissions')
})
test('링크는 공급된 사이트 내부 주소만 사용하고 누락·임의 외부 URL은 열지 않는다',()=>{
  assert.equal(evaluationLink({authoring:'/doc-ai'},'authoring'),'/doc-ai')
  assert.equal(evaluationLink({authoring:'/site/doc-ai'},'authoring'),'/site/doc-ai')
  for(const value of [undefined,null,{},'','https://example.org/x','//example.org','javascript:alert(1)','/\\example.org','/doc-ai?redirect=other','/doc-ai#other','/doc-ai\n'])assert.equal(evaluationLink({authoring:value},'authoring'),undefined)
})
test('명시 링크는 새 탭과 opener 차단이며 숨김·잠금에는 링크가 없다',()=>{
  const props={links:{authoring:'/doc-ai'},target:'authoring'}
  const html=render(props);assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/href="\/doc-ai"/)
  assert.doesNotMatch(render({...props,locked:true}),/href=/);assert.doesNotMatch(render({target:'submissions'}),/href=/)
})
if(failed)process.exit(1)
