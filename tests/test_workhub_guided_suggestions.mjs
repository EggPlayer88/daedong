import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {recommendGuidedMode,createGuidedCandidates,applyGuidedCandidates,GUIDED_SUGGESTIONS_POLICY:p,GUIDED_LIMITS:limits,renderSetup}=await loadBrowserModule(`
 export * from '../apps/workhub/src/documents/guided-suggestions'
 export {GUIDED_LIMITS} from '../apps/workhub/src/documents/guided-contracts'
 import {renderToStaticMarkup} from 'react-dom/server'
 import {GuidedSetupPanel} from '../apps/workhub/src/documents/GuidedSetupPanel'
 import {createEditDrafts,EditDraftsProvider} from '../apps/workhub/src/app/edit-drafts'
 import {recoveryScope} from '../apps/workhub/src/app/pending-requests'
 import {canonical} from '../apps/workhub/src/services/scoped-rpc'
 import {createGuidedCandidates} from '../apps/workhub/src/documents/guided-suggestions'
 export function renderSetup(props,method=''){
  const store=createEditDrafts(),source=props.selected.template
  if(method)store.bind(recoveryScope(props.member),'guided-setup-proposals:'+source.id+':'+source.version).save({base:canonical([source,props.selected.response]),method,rows:createGuidedCandidates(source.inspection,source.mapping?.questions??[]),chosen:[],handled:'',aiReason:''},false)
  return renderToStaticMarkup(<EditDraftsProvider store={store}><GuidedSetupPanel {...props}/></EditDraftsProvider>)
 }
`)
const a=(n,sourceText='',section='Contents/section0.xml',cell=null)=>({id:`${section}:p${String(n).padStart(6,'0')}`,section,paragraph:n,sourceText,sourceHash:'a'.repeat(64),cell})
const inspection=(anchors,unsupportedParagraphs=0)=>({profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors,unsupportedParagraphs})
const q=(anchor,id='existing')=>({id,label:'기존 질문',kind:'text',required:true,maxLength:100,options:[],anchorId:anchor.id,sourceText:anchor.sourceText,sourceHash:anchor.sourceHash})
const ready=(candidate,changes={})=>({...candidate,label:'입력할 내용',...changes})
let passed=0
function check(name,fn){fn();passed++;console.log('  ✓ '+name)}
const throws=(fn,code='INVALID_INPUT')=>assert.throws(fn,error=>error.code===code)

check('단순 빈 문단은 질문형 검토 후보로 안내하고 적합성을 보장하지 않는다',()=>{
 const r=recommendGuidedMode(inspection([a(0,'제목'),a(1),a(2,'  ')]),[])
 assert.equal(r.mode,'guided');assert.equal(r.blankCount,2);assert.equal(r.unlinkedBlankCount,2);assert.equal(r.remainingCapacity,limits.maxQuestions);assert(r.reasons.some(v=>v.includes('보장하지 않습니다')))
})
check('복합 문단은 표 wrapper일 수도 있어 개수만으로 파일형으로 단정하지 않는다',()=>{
 const r=recommendGuidedMode(inspection([a(0)],3),[]);assert.equal(r.mode,'review');assert.equal(r.unsupportedCount,3);assert(r.reasons.some(v=>v.includes('원형을 유지')))
})
check('빈 문단이 질문 한도보다 많으면 파일형 검토와 일부 칸 선택을 안내한다',()=>{
 const r=recommendGuidedMode(inspection(Array.from({length:limits.maxQuestions+1},(_,i)=>a(i))),[]);assert.equal(r.mode,'file');assert(r.reasons.some(v=>v.includes('일부 칸')))
})
check('빈 문단이 없으면 기존 글을 치환 후보로 만들지 않는다',()=>{
 const source=inspection([a(0,'기존 안내'),a(1,'참가자')]);assert.equal(recommendGuidedMode(source,[]).mode,'review');assert.deepEqual(createGuidedCandidates(source,[]),[])
})
check('이미 연결한 위치를 빼고 빈칸 수·남은 질문 용량을 따로 계산한다',()=>{
 const source=inspection([a(0),a(1)]),r=recommendGuidedMode(source,[q(source.anchors[0])]);assert.equal(r.blankCount,2);assert.equal(r.unlinkedBlankCount,1);assert.equal(r.remainingCapacity,limits.maxQuestions-1)
})
check('질문 용량이 없으면 새 후보를 만들지 않는다',()=>{
 const source=inspection(Array.from({length:limits.maxQuestions+1},(_,i)=>a(i))),questions=source.anchors.slice(0,limits.maxQuestions).map((v,i)=>q(v,'q'+i));assert.equal(recommendGuidedMode(source,questions).mode,'review');assert.deepEqual(createGuidedCandidates(source,questions),[])
})
check('후보는 원본 순서와 남은 질문 한도를 지킨다',()=>{
 const source=inspection(Array.from({length:limits.maxQuestions+2},(_,i)=>a(i))),questions=source.anchors.slice(0,limits.maxQuestions-1).map((v,i)=>q(v,'q'+i));const result=createGuidedCandidates(source,questions);assert.equal(result.length,1);assert.equal(result[0].anchorId,source.anchors[limits.maxQuestions-1].id);assert(recommendGuidedMode(source,questions).reasons.some(v=>v.includes('현재 추가할 수 있는 질문')))
})
check('직전의 짧은 콜론 항목만 질문 초안에 그대로 쓰고 원문과 hash는 보존한다',()=>{
 const source=inspection([a(0,'활동 주제：'),a(1,' \t ')]),result=createGuidedCandidates(source,[])[0];assert.equal(result.label,'활동 주제');assert.equal(result.context,'활동 주제：');assert.equal(result.sourceText,' \t ');assert.equal(result.sourceHash,source.anchors[1].sourceHash);assert.equal(result.required,false);assert.equal(result.maxLength,p.defaultAnswerCharacters)
})
check('같은 행·열의 다른 표처럼 보이는 자료를 인접성만으로 연결하지 않는다',()=>{
 const source=inspection([a(0,'이름:',undefined,{row:'0',column:'0'}),a(10,'',undefined,{row:'0',column:'1'})]);const candidate=createGuidedCandidates(source,[])[0];assert.equal(candidate.label,'');assert.equal(candidate.context,'')
})
check('다른 절의 직전 문단 번호는 문맥으로 사용하지 않는다',()=>{
 const candidate=createGuidedCandidates(inspection([a(0,'성명:'),a(1,'','Contents/section1.xml')]),[])[0];assert.equal(candidate.label,'');assert.equal(candidate.context,'')
})
check('직전 원문이 항목 이름 형태가 아니면 질문을 추측하지 않는다',()=>{
 const candidate=createGuidedCandidates(inspection([a(0,'앞의 설명입니다.'),a(1)]),[])[0];assert.equal(candidate.label,'');assert.equal(candidate.context,'앞의 설명입니다.')
})
check('여러 줄·긴 항목은 잘라서 질문으로 만들지 않는다',()=>{
 for(const value of ['두 줄\n항목:', '긴'.repeat(p.labelCharacters)+':']){const candidate=createGuidedCandidates(inspection([a(0,value),a(1)]),[])[0];assert.equal(candidate.label,'');assert.equal(candidate.context,value)}
 const tooLong='가'.repeat(p.contextCharacters+1),candidate=createGuidedCandidates(inspection([a(0,tooLong),a(1)]),[])[0];assert.equal(candidate.label,'');assert.equal(candidate.context,'')
})
check('검사 결과나 기존 질문이 잘못되면 후보 추천도 입력 오류로 끝낸다',()=>{
 throws(()=>createGuidedCandidates(null,[]));throws(()=>recommendGuidedMode(inspection([a(0)]),null));throws(()=>createGuidedCandidates(inspection([a(0)]),[{...q(a(0)),label:''}]))
})
check('선택 후보만 기존 질문 뒤에 추가하고 기존 입력과 원문은 바꾸지 않는다',()=>{
 const source=inspection([a(0,'기존'),a(1),a(2)]),existing=[q(source.anchors[0])],before=JSON.stringify({source,existing}),selected=[ready(createGuidedCandidates(source,existing)[1])];const result=applyGuidedCandidates(source,existing,selected,()=> 'new-id');assert.equal(result.length,2);assert.deepEqual(result[0],existing[0]);assert.equal(result[1].anchorId,a(2).id);assert.equal(JSON.stringify({source,existing}),before)
})
check('빈 선택과 질문 없는 label을 거절하며 원문을 자동 질문으로 사용하지 않는다',()=>{
 const source=inspection([a(0)]);throws(()=>applyGuidedCandidates(source,[],[]));throws(()=>applyGuidedCandidates(source,[],createGuidedCandidates(source,[])))
})
check('선택 후보의 누락·추가 필드는 전송 전 입력 오류다',()=>{
 const source=inspection([a(0)]),candidate=ready(createGuidedCandidates(source,[])[0]);throws(()=>applyGuidedCandidates(source,[],[{...candidate,extra:true}]));const {context,...missing}=candidate;throws(()=>applyGuidedCandidates(source,[],[missing]))
})
check('원문 판이 바뀌거나 없는 위치를 가리키는 후보는 거절한다',()=>{
 const source=inspection([a(0)]),candidate=ready(createGuidedCandidates(source,[])[0]);for(const change of [{anchorId:a(1).id},{sourceText:'옛 글'},{sourceHash:'c'.repeat(64)}])throws(()=>applyGuidedCandidates(source,[],[{...candidate,...change}]),'CONFLICT')
})
check('다른 문맥을 붙인 후보는 질문에 반영하지 않는다',()=>{
 const source=inspection([a(0,'내용:'),a(1)]),candidate=ready(createGuidedCandidates(source,[])[0]);throws(()=>applyGuidedCandidates(source,[],[{...candidate,context:'다른 설명'}]),'CONFLICT')
})
check('내용이 이미 있는 위치나 이미 연결한 위치는 새 후보로 반영하지 않는다',()=>{
 const source=inspection([a(0,'기재 내용'),a(1)]),candidate=ready(createGuidedCandidates(source,[])[0]);throws(()=>applyGuidedCandidates(source,[q(a(1))],[candidate]),'CONFLICT');throws(()=>applyGuidedCandidates(source,[],[{...candidate,anchorId:a(0).id,sourceText:a(0,'기재 내용').sourceText}]),'CONFLICT')
})
check('중복 위치와 중복 질문 id는 원자적으로 거절한다',()=>{
 const source=inspection([a(0),a(1)]),candidates=createGuidedCandidates(source,[]).map(v=>ready(v));throws(()=>applyGuidedCandidates(source,[],[candidates[0],candidates[0]],()=> 'id'));throws(()=>applyGuidedCandidates(source,[],candidates,()=> 'id'))
})
check('현재 질문과 새 질문 id 충돌을 거절한다',()=>{
 const source=inspection([a(0),a(1)]),existing=[q(a(0))],candidate=ready(createGuidedCandidates(source,existing)[0]);throws(()=>applyGuidedCandidates(source,existing,[candidate],()=> 'existing'))
})
check('답변 형식·필수 여부·길이·선택지 검사는 기존 매핑 계약을 따른다',()=>{
 const source=inspection([a(0)]),candidate=ready(createGuidedCandidates(source,[])[0]);for(const change of [{kind:'unknown'},{required:'true'},{maxLength:0},{maxLength:limits.maxAnswerCharacters+1},{kind:'select',options:[]},{kind:'text',options:['보기']},{kind:'select',options:['같음','같음']}])throws(()=>applyGuidedCandidates(source,[],[{...candidate,...change}],()=> 'new'))
 const selected=applyGuidedCandidates(source,[],[{...candidate,kind:'select',options:['참가','불참']}],()=> 'new');assert.deepEqual(selected[0].options,['참가','불참'])
})
check('여러 후보 중 하나가 잘못되면 기존 질문과 후보를 전혀 변경하지 않는다',()=>{
 const source=inspection([a(0),a(1),a(2)]),existing=[q(a(0))],candidates=createGuidedCandidates(source,existing).map(v=>ready(v));candidates[1].label='';const before=JSON.stringify({source,existing,candidates});let n=0;throws(()=>applyGuidedCandidates(source,existing,candidates,()=> 'new'+n++));assert.equal(JSON.stringify({source,existing,candidates}),before)
})
check('전체 질문 수 초과와 잘못된 id 생성기를 거절한다',()=>{
 const source=inspection(Array.from({length:limits.maxQuestions+1},(_,i)=>a(i))),existing=source.anchors.slice(0,limits.maxQuestions).map((v,i)=>q(v,'q'+i)),candidate={anchorId:a(limits.maxQuestions).id,sourceText:'',sourceHash:a(0).sourceHash,label:'추가',context:'',kind:'text',required:false,maxLength:500,options:[]};throws(()=>applyGuidedCandidates(source,existing,[candidate]));throws(()=>applyGuidedCandidates(inspection([a(0)]),[],[ready(createGuidedCandidates(inspection([a(0)]),[])[0])],()=> 'bad id'))
})
const member={id:'teacher',userId:'user',schoolId:'school',name:'가상 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const panelProps=(source,callback)=>({member,revision:0,selected:{template:{id:'template',schoolId:member.schoolId,ownerMemberId:member.id,title:'학교 양식',version:1,state:'draft',inspection:source,mapping:null,collectionRequestId:null,canManage:true},response:null},questions:[],title:'학교 양식',disabled:false,service:{get:callback,mutate:callback},onApply:callback,onBusyChange:callback,onRequestAi:callback,onOpenFileCollections:callback})
check('처음 렌더는 방식 안내와 선택만 제공하고 후보 선택·조회·저장·AI를 시작하지 않는다',()=>{
 let calls=0;const html=renderSetup(panelProps(inspection([a(0,'항목:'),a(1)]),()=>calls++));assert.match(html,/질문형 수합 검토 가능/);assert.match(html,/질문형으로 준비/);assert.match(html,/파일형으로 진행/);assert.equal((html.match(/aria-pressed="false"/g)||[]).length,2);assert(!html.includes('선택한 연결 제안 반영'));assert(!html.includes('연결 후보 1'));assert(!html.includes('checked=""'));assert.equal(calls,0)
})
check('복합 검사 결과의 최초 화면은 원본 확인 후 선택을 안내한다',()=>{
 const html=renderSetup(panelProps(inspection([a(0)],2),()=>{}));assert.match(html,/원본 확인 후 방식 선택/);assert.match(html,/원형을 유지/);assert(!html.includes('<strong>파일형 수합 우선 검토</strong>'));assert.match(html,/담당자가 방식을 정하며/)
})
check('선택 화면에 복원한 원문·질문 제안은 HTML로 실행되지 않고 확인 전 반영이 잠긴다',()=>{
 let calls=0;const payload='<img src=x onerror=alert(1)>:',html=renderSetup(panelProps(inspection([a(0,payload),a(1)]),()=>calls++),'guided');assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert(!html.includes('<img'));assert(!html.includes('checked=""'));assert.match(html,/<button[^>]*disabled=""[^>]*>선택한 연결 제안 반영<\/button>/);assert.equal(calls,0)
})
console.log(`양식 방식·질문 연결 후보 ${passed}건 통과`)
