import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { blankAnchorCandidates, render, maxQuestions } = await loadBrowserModule(`
 import {renderToStaticMarkup} from 'react-dom/server'
 import {GuidedAnchorPicker,blankAnchorCandidates} from '../apps/workhub/src/documents/GuidedAnchorPicker'
 import {GUIDED_LIMITS} from '../apps/workhub/src/documents/guided-contracts'
 export {blankAnchorCandidates}
 export const maxQuestions=GUIDED_LIMITS.maxQuestions
 export function render(props){return renderToStaticMarkup(<GuidedAnchorPicker {...props}/>)}
`)
const anchor=(n,sourceText='',cell=null)=>({id:`Contents/section0.xml:p${String(n).padStart(6,'0')}`,section:'Contents/section0.xml',paragraph:n,sourceText,sourceHash:'a'.repeat(64),cell})
const inspection=(anchors)=>({profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors,unsupportedParagraphs:2})
const question=(a)=>({id:`q-${a.paragraph}`,label:'확인할 질문',kind:'text',required:true,maxLength:500,options:[],anchorId:a.id,sourceText:a.sourceText,sourceHash:a.sourceHash})
const html=(source,questions=[],extra={})=>render({inspection:source,questions,locked:false,onAdd:()=>{},...extra})
let count=0
function check(name,fn){fn();count++;console.log('  ✓ '+name)}
check('빈 문단·공백 문단만 후보로 찾고 본문이 있는 문단은 제외한다',()=>{
 const items=[anchor(0),anchor(1,' \t\n　'),anchor(2,'  입력 항목  ')];assert.deepEqual(blankAnchorCandidates(inspection(items),[]),items.slice(0,2))
})
check('이미 연결한 빈 문단을 제외하고 질문 삭제 뒤 다시 후보로 돌린다',()=>{
 const items=[anchor(0),anchor(1)];assert.deepEqual(blankAnchorCandidates(inspection(items),[question(items[0])]),[items[1]]);assert.deepEqual(blankAnchorCandidates(inspection(items),[]),items)
})
check('후보 필터가 원문·hash·기존 질문을 바꾸지 않는다',()=>{
 const source=inspection([anchor(0,'　'),anchor(1,'이미 쓴 원문')]),questions=[question(source.anchors[1])],before=JSON.stringify({source,questions});blankAnchorCandidates(source,questions);html(source,questions);assert.equal(JSON.stringify({source,questions}),before)
})
check('빈 후보가 있으면 후보를 먼저 보이되 입력란 확정으로 표현하지 않는다',()=>{
 const result=html(inspection([anchor(0),anchor(1,'따로 확인할 본문')]));assert.match(result,/checked=""/);assert.match(result,/아직 연결하지 않은 빈 문단 1개/);assert.match(result,/빈 문단이 모두 입력란인 것은 아닙니다/);assert(!result.includes('따로 확인할 본문'))
})
check('빈 후보가 없으면 전체 위치와 원문을 바로 보여 준다',()=>{
 const result=html(inspection([anchor(0,'기존 기재 내용')]));assert(!result.includes('checked=""'));assert.match(result,/기존 기재 내용/);assert.match(result,/이 위치에 질문 연결/)
})
check('이미 연결한 위치는 원문을 유지하며 연결됨 표시와 버튼 잠금을 제공한다',()=>{
 const a=anchor(0,'기존 문장'),result=html(inspection([a]),[question(a)]);assert.match(result,/기존 문장/);assert.match(result,/질문 연결됨/);assert.match(result,/<button[^>]*disabled=""/)
})
check('처리 중 잠금과 자산의 최대 질문 수를 모두 연결 버튼에 적용한다',()=>{
 const source=inspection([anchor(0)]);assert.match(html(source,[],{locked:true}),/<button[^>]*disabled=""/);const questions=Array.from({length:maxQuestions},(_,n)=>question(anchor(n+1)));assert.match(html(source,questions),/<button[^>]*disabled=""/)
})
check('화면 렌더만으로 질문 추가를 호출하지 않고 실제 표 위치를 표시한다',()=>{
 let calls=0;const result=html(inspection([anchor(0,'',{row:'2',column:'3'})]),[],{onAdd:()=>calls++});assert.equal(calls,0);assert.match(result,/표 셀 3행 4열/);assert.match(result,/Contents\/section0.xml:p000000/)
})
console.log(`질문형 빈 문단 후보 ${count}건 통과`)
