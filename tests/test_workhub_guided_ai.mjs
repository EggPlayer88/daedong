import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/documents/guided-ai'`)
const member={id:'member',schoolId:'school',userId:'user',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const anchor=(n)=>({id:`Contents/section0.xml:p00000${n}`,section:'Contents/section0.xml',paragraph:n,sourceText:'원문',sourceHash:'a'.repeat(64),cell:null})
const questions=['longtext','number','date','select'].map((kind,n)=>({id:`q${n}`,label:`질문 ${n}`,kind,required:true,maxLength:50,options:kind==='select'?['참가','불참']:[],anchorId:anchor(n).id,sourceText:'원문',sourceHash:'a'.repeat(64)}))
const mapping={profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),questions}
const template={id:'template',schoolId:'school',ownerMemberId:'other',title:'확인 양식',version:2,state:'published',inspection:{profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors:questions.map((_,n)=>anchor(n)),unsupportedParagraphs:0},mapping,collectionRequestId:'collection',canManage:false}
const response={id:'response',templateId:'template',templateVersion:2,schoolId:'school',ownerMemberId:'member',version:3,answers:{q0:'저장한 글',q1:'0',q2:'2026-10-21',q3:'참가'},preview:false,artifact:null}
const detail={template,response}, input={...response.answers,q0:'아직 저장하지 않은 글'}
const request=()=>m.makeGuidedAiRequest(member,detail,input,'origin')
let count=0
function check(name,fn){fn();count++;console.log('  ✓ '+name)}
check('양식·저장 답변판과 미저장 답변을 별도로 보존한다',()=>{const {origin,request:r}=request();assert.equal(origin.templateVersion,2);assert.equal(origin.responseVersion,3);assert.deepEqual(origin.answers,input);assert.equal(r.intent,'guided_collection');assert.equal(Object.hasOwn(r,'sourceId'),false)})
check('원문을 수정해도 보관한 복귀 입력은 달라지지 않는다',()=>{const r=request();r.origin.answers.q0='변경';assert.equal(input.q0,'아직 저장하지 않은 글')})
check('다른 학교·사용자·역할의 복귀 주소를 거부한다',()=>{for(const patch of [{schoolId:'other'},{userId:'other'},{role:'school_admin'}])assert.throws(()=>m.guidedAiOrigin(request().origin,{...member,...patch}))})
check('원래 양식과 현재 저장 답변판을 정확히 재검증한다',()=>{assert.equal(m.verifyGuidedAiSource(request().origin,detail,member).template.id,'template')})
check('다른 양식·새 양식판·바뀐 질문과 응답판을 거부한다',()=>{for(const value of [{...detail,template:{...template,id:'other'}},{...detail,template:{...template,version:3}},{...detail,template:{...template,mapping:{...mapping,questions:questions.map(q=>({...q,label:'수정'}))}}},{...detail,response:{...response,version:4}},{...detail,response:null}])assert.throws(()=>m.verifyGuidedAiSource(request().origin,value,member))})
check('저장 전 답변도 임의로 생성된 서버 답변과 섞지 않는다',()=>{const origin=m.makeGuidedAiRequest(member,{template,response:null},input,'origin').origin;assert.equal(origin.responseVersion,0);assert.throws(()=>m.verifyGuidedAiSource(origin,detail,member))})
check('질문을 선택하지 않거나 없는 질문으로 배정하지 않는다',()=>{for(const id of ['', 'unknown'])assert.throws(()=>m.applyGuidedAiAnswer(request().origin,input,id,'제안'))})
check('명시 선택한 질문만 바꾸고 다른 입력의 공백도 보존한다',()=>{const current={...input,q0:'  현재 글  '};const result=m.applyGuidedAiAnswer(request().origin,current,'q1','12');assert.deepEqual(result,{...current,q1:'12'})})
check('숫자·날짜·선택 답변의 형식을 기존 계약으로 검사한다',()=>{for(const [id,value] of [['q1','열 명'],['q1','1e3'],['q2','2026-02-30'],['q3','모름']])assert.throws(()=>m.applyGuidedAiAnswer(request().origin,input,id,value))})
check('긴 제안을 조용히 자르지 않고 거부한다',()=>{assert.throws(()=>m.applyGuidedAiAnswer(request().origin,input,'q0','가'.repeat(51)))})
check('제안 본문과 요청 번호를 보존하며 추가필드·빈본문을 거부한다',()=>{const value={origin:request().origin,requestId:'ask',body:'검토할 제안'};assert.deepEqual(m.guidedAiSuggestion(value,member),value);for(const v of [{...value,body:''},{...value,extra:true}])assert.throws(()=>m.guidedAiSuggestion(v,member))})
check('양식 서버의 다른 학교 응답을 먼저 거부한다',()=>{assert.throws(()=>m.makeGuidedAiRequest(member,{...detail,template:{...template,schoolId:'other'}},input,'origin'))})
console.log(`질문형 AI 복귀 ${count}건 통과`)
