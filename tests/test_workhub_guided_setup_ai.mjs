import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`export * from '../apps/workhub/src/documents/guided-setup-ai';export {createGuidedCandidates,applyGuidedCandidates} from '../apps/workhub/src/documents/guided-suggestions';export {ASSISTANT_LIMITS} from '../apps/workhub/src/assistant/contracts';export {GUIDED_LIMITS} from '../apps/workhub/src/documents/guided-contracts';export {documentAssistantRequest} from '../apps/workhub/src/app/pilot-handoff';`)
const clone=structuredClone,member={id:'manager',schoolId:'school',userId:'user',name:'가상 담당자',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const anchor=(n,sourceText,section='Contents/section0.xml')=>({id:`${section}:p${String(n).padStart(6,'0')}`,section,paragraph:n,sourceText,sourceHash:'a'.repeat(64),cell:null})
const anchors=[anchor(0,'행사명:'),anchor(1,''),anchor(2,'참여 인원:'),anchor(3,' \t'),anchor(4,'바꾸지 않을 기존 원문')]
const inspection={profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors,unsupportedParagraphs:1}
const oldQuestion={id:'existing',label:'기존 질문',kind:'text',required:false,maxLength:500,options:[],anchorId:anchors[4].id,sourceText:anchors[4].sourceText,sourceHash:anchors[4].sourceHash}
const mapping={profile:inspection.profile,templateSha256:inspection.templateSha256,questions:[oldQuestion]}
const template={id:'template',schoolId:'school',ownerMemberId:'manager',title:'행사 참가 양식',version:2,state:'draft',inspection,mapping,collectionRequestId:null,canManage:true}
const response={id:'response',templateId:template.id,templateVersion:template.version,schoolId:'school',ownerMemberId:'manager',version:3,answers:{existing:'비공개 답변을 제안 프롬프트에 보내지 않음'},preview:true,artifact:null}
const detail={template,response},candidates=()=>m.createGuidedCandidates(inspection,mapping.questions)
const request=()=>m.makeGuidedSetupAiRequest(member,detail,candidates(),'origin')
const question=(patch={})=>({anchorId:anchors[1].id,label:'어떤 행사인가요?',kind:'text',required:false,maxLength:500,options:[],...patch})
const body=(patch={})=>JSON.stringify({mode:'guided',reason:'선택한 빈 문단에 질문을 연결할 수 있습니다.',questions:[question()],...patch})
const parse=(value=body(),origin=request().origin)=>m.parseGuidedSetupProposal(value,origin)
let count=0
function check(name,fn){fn();count++;console.log('  ✓ '+name)}
check('준비용 원본은 양식·검사·저장 매핑·답변판과 선택 후보를 보존한다',()=>{
 const {origin,request:r}=request();assert.equal(origin.templateVersion,2);assert.equal(origin.responseVersion,3);assert.deepEqual(origin.inspection,inspection);assert.deepEqual(origin.savedMapping,mapping);assert.equal(origin.candidates.length,2);assert.equal(r.intent,'guided_collection');assert.equal(m.documentAssistantRequest(r).intent,'guided_collection')
})
check('질문이 아직 없는 준비 초안도 새로운 응답을 만들지 않고 요청할 수 있다',()=>{
 const value={template:{...template,mapping:null},response:null},selected=m.createGuidedCandidates(inspection,[]);const result=m.makeGuidedSetupAiRequest(member,value,selected,'first');assert.equal(result.origin.savedMapping,null);assert.equal(result.origin.responseId,null);assert.equal(result.origin.responseVersion,0)
})
check('선택 후보의 항목 이름·문맥만 전송하고 원문 전체·답변·해시는 보내지 않는다',()=>{
 const {request:r}=m.makeGuidedSetupAiRequest(member,detail,[candidates()[0]],'selected');assert.match(r.details,/행사명:/);assert(!r.details.includes('참여 인원:'));assert(!r.details.includes(anchors[4].sourceText));assert(!r.details.includes(response.answers.existing));assert(!r.details.includes(inspection.templateSha256));assert.equal(Object.hasOwn(r,'sourceId'),false)
})
check('복귀 원본을 변경해도 기존 양식·질문·선택 후보는 변하지 않는다',()=>{
 const items=candidates(),before=JSON.stringify({detail,items}),value=m.makeGuidedSetupAiRequest(member,detail,items,'origin');value.origin.inspection.anchors[0].sourceText='변조';value.origin.savedMapping.questions[0].label='다른 질문';value.origin.candidates[0].label='다른 후보';assert.equal(JSON.stringify({detail,items}),before)
})
check('계정·학교·소속·역할이 바뀐 복귀 주소를 거부한다',()=>{
 for(const patch of [{userId:'other'},{schoolId:'other'},{id:'other'},{role:'school_admin'},{active:false}])assert.throws(()=>m.guidedSetupOrigin(request().origin,{...member,...patch}),error=>error.code==='CANCELLED')
})
check('작성 권한이 없는 양식·게시된 양식·검사 전 양식은 요청하지 않는다',()=>{
 for(const t of [{...template,state:'published',collectionRequestId:'collection'},{...template,inspection:null,mapping:null},{...template,ownerMemberId:'other',canManage:false}])assert.throws(()=>m.makeGuidedSetupAiRequest(member,{template:t,response:null},candidates(),'origin'))
})
check('원본에 없는 후보·이미 연결한 위치·중복 후보·빈 선택을 거부한다',()=>{
 const first=candidates()[0];for(const items of [[],[first,first],[{...first,anchorId:'unknown'}],[{...first,anchorId:oldQuestion.anchorId}]])assert.throws(()=>m.createGuidedSetupOrigin(member,detail,items,'origin'))
})
check('후보의 원문·hash·문맥·기본 질문을 바꿔 요청하지 않는다',()=>{
 for(const patch of [{sourceText:'기존 글'},{sourceHash:'c'.repeat(64)},{context:'다른 문맥'},{label:'수정한 입력'},{kind:'number'},{extra:true}])assert.throws(()=>m.createGuidedSetupOrigin(member,detail,[{...candidates()[0],...patch}],'origin'))
})
check('프롬프트 한도를 넘으면 일부 후보를 자르거나 호출하지 않고 거부한다',()=>{
 const many=Array.from({length:80},(_,n)=>anchor(n,n%2?'':'가'.repeat(190))),source={...inspection,anchors:many},value={template:{...template,inspection:source,mapping:null},response:null},selected=m.createGuidedCandidates(source,[]);assert.throws(()=>m.makeGuidedSetupAiRequest(member,value,selected,'long'),error=>error.code==='INVALID_INPUT');assert.equal(selected.length,40)
})
check('준비 제안 본문·요청 번호를 그대로 검증하고 추가필드를 거부한다',()=>{
 const value={origin:request().origin,requestId:'ask',body:body()};assert.deepEqual(m.guidedSetupSuggestion(value,member),value);for(const item of [{...value,extra:true},{...value,body:''},{...value,requestId:'wrong id'}])assert.throws(()=>m.guidedSetupSuggestion(item,member))
})
check('AI 질문에는 원래 후보의 원문·hash·문맥을 다시 결합한다',()=>{
 const result=parse();assert.equal(result.mode,'guided');assert.equal(result.questions[0].label,'어떤 행사인가요?');assert.equal(result.questions[0].sourceHash,anchors[1].sourceHash);assert.equal(result.questions[0].sourceText,'');assert.equal(result.questions[0].context,'행사명:')
})
check('JSON 코드 블록 하나는 허용하되 다른 설명·여러 블록은 거부한다',()=>{
 assert.deepEqual(parse('```json\n'+body()+'\n```'),parse());for(const value of ['설명\n'+body(),'```json\n'+body()+'\n```\n설명','```json\n'+body()+'\n```\n```json\n'+body()+'\n```','{broken}'])assert.throws(()=>parse(value))
})
check('선택 후보 일부만 제안하거나 아무 질문 없이 검토를 권할 수 있다',()=>{
 assert.equal(parse().questions.length,1);assert.equal(parse(body({mode:'review',reason:'입력 위치를 확인해 주세요.',questions:[]})).questions.length,0);assert.equal(parse(body({mode:'file',questions:[]})).mode,'file')
})
check('다른 후보·기존 글·중복 위치·선택 개수 초과를 거부한다',()=>{
 for(const questions of [[question({anchorId:'unknown'})],[question({anchorId:anchors[4].id})],[question(),question()],[question(),question({anchorId:anchors[3].id}),question()]])assert.throws(()=>parse(body({questions})))
})
check('AI가 만든 원문·hash·추가 키와 잘못된 상위 모양을 거부한다',()=>{
 for(const value of [body({questions:[{...question(),sourceHash:'c'.repeat(64)}]}),body({extra:true}),body({mode:'automatic'}),body({reason:''}),body({questions:null}),JSON.stringify([])])assert.throws(()=>parse(value))
})
check('질문 형식·필수 여부·길이·선택 항목은 기존 매핑 계약을 따른다',()=>{
 for(const patch of [{label:''},{kind:'html'},{required:'yes'},{maxLength:0},{maxLength:1.2},{maxLength:m.GUIDED_LIMITS.maxAnswerCharacters+1},{options:['임의']},{kind:'select',options:[]},{kind:'select',options:['같음','같음']},{label:'가'.repeat(201)}])assert.throws(()=>parse(body({questions:[question(patch)]})));assert.equal(parse(body({questions:[question({kind:'select',options:['참여','불참']})]})).questions[0].kind,'select')
})
check('AI가 질문을 제안해도 기존 질문·답변·원본은 바뀌지 않는다',()=>{
 const origin=request().origin,before=JSON.stringify({origin,detail});parse(body(),origin);assert.equal(JSON.stringify({origin,detail}),before)
})
check('검증된 제안은 기존 명시적 질문 추가 함수와 호환된다',()=>{
 const proposal=parse(),result=m.applyGuidedCandidates(inspection,mapping.questions,proposal.questions,()=> 'new-question');assert.deepEqual(result[0],oldQuestion);assert.equal(result[1].label,'어떤 행사인가요?');assert.equal(result[1].sourceText,'');assert.equal(mapping.questions.length,1)
})
check('반영 전 현재 서버 원본과 저장 답변판을 정확히 확인한다',()=>{
 assert.deepEqual(m.verifyGuidedSetupSource(request().origin,detail,member),detail)
})
check('양식 ID·판·파일 hash·검사 위치·저장 매핑 변경을 거부한다',()=>{
 for(const change of [{id:'other'},{version:3},{inspection:{...inspection,templateSha256:'c'.repeat(64)}},{inspection:{...inspection,anchors:anchors.map((a,n)=>n? a:{...a,sourceText:'다른 근거'})}},{mapping:{...mapping,questions:[{...oldQuestion,label:'변경'}]}}]){const changed={...template,...change};assert.throws(()=>m.verifyGuidedSetupSource(request().origin,{template:changed,response:{...response,templateId:changed.id,templateVersion:changed.version}},member))}
})
check('답변 생성·삭제·판 변경·다른 학교 응답은 혼용하지 않는다',()=>{
 const original=request().origin;for(const value of [{template,response:null},{template,response:{...response,version:4}},{template,response:{...response,id:'other'}},{template:{...template,schoolId:'other'},response}])assert.throws(()=>m.verifyGuidedSetupSource(original,value,member));const empty={template,response:null},origin=m.createGuidedSetupOrigin(member,empty,candidates(),'empty');assert.throws(()=>m.verifyGuidedSetupSource(origin,detail,member))
})
check('손상된 응답판·범위·원본 추가필드는 origin 검증에서 막는다',()=>{
 const original=request().origin;for(const patch of [{responseId:null,responseVersion:1},{responseVersion:0},{responseVersion:1.5},{extra:true},{savedMapping:null}])assert.throws(()=>m.guidedSetupOrigin({...original,...patch},member))
})
console.log(`질문형 준비 AI 계약 ${count}건 통과`)
