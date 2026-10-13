import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {renderImport,renderPair,renderEditor,renderCalendar,fixtureData,createMemoryAdapter,prepareImportRows,parseImportTable,suggestImportMapping}=await loadBrowserModule(`
  import{renderToStaticMarkup}from'react-dom/server';import{CalendarImport}from'../apps/workhub/src/calendar/CalendarImport';import{EventEditor}from'../apps/workhub/src/calendar/EventEditor';import{CalendarPanel}from'../apps/workhub/src/calendar/CalendarPanel';
  export{fixtureData}from'../apps/workhub/src/preview/fixtures';export{createMemoryAdapter}from'../apps/workhub/src/preview/memory-adapter';export{prepareImportRows,parseImportTable,suggestImportMapping}from'../apps/workhub/src/calendar/import-table';
  export const renderImport=props=>renderToStaticMarkup(<CalendarImport {...props}/>),renderEditor=props=>renderToStaticMarkup(<EventEditor {...props}/>),renderCalendar=props=>renderToStaticMarkup(<CalendarPanel {...props}/>);
  export const renderPair=props=>renderToStaticMarkup(<><CalendarImport {...props}/><CalendarImport {...props}/></>);
`)
const member=fixtureData.memberships.find(m=>m.id==='gaon-soyeon'),base={member,members:fixtureData.memberships,date:fixtureData.basisDate,adapter:createMemoryAdapter(fixtureData,0),onClose(){},onSaved(){}},table=parseImportTable('제목\t시작일\t내용\n검토할 일정\t2026.10.20\t<script>alert(1)</script>'),draft=prepareImportRows(table,suggestImportMapping(table.headers),member,base.members)[0].draft
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
test('초기 가져오기 화면은 자료 입력·파일·구분자·표 처리 한도를 연결한다',()=>{const html=renderImport({...base,demo:true});assert(html.includes('시트에서 일정 가져오기'));assert(html.includes('원본 표 붙여넣기'));assert(html.includes('CSV·TSV 파일 열기'));assert(html.includes('최대 200행·30열·250,000자'));assert(html.includes('실제 학교·학생 자료를 입력하지 마세요'));assert(html.includes('표 검사만으로 저장되지 않습니다'))})
test('반복 가져오기 화면의 dialog·입력 안내 ID는 겹치지 않는다',()=>{
  const html=renderPair(base)
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length)
})
test('검사한 초안은 기존 등록 양식에 제목·날짜·종일·나만 보기로 들어간다',()=>{const html=renderEditor({...base,initialDraft:draft});assert(html.includes('value="검토할 일정"'));assert(html.includes('value="2026-10-20"'));assert(/<option value="private" selected="">/.test(html));assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert(!html.includes('<script>alert(1)</script>'))})
test('기존 일정 수정이 함께 주어지면 원본이 준비 초안보다 우선한다',()=>{const original=fixtureData.events[0],html=renderEditor({...base,initialDraft:draft,original});assert(html.includes(`value="${original.title}"`));assert(!html.includes('value="검토할 일정"'));assert(html.includes('수정 저장'))})
test('가져오기 준비만으로 저장 명령을 호출하거나 입력 객체를 바꾸지 않는다',()=>{let writes=0;const before=JSON.stringify(draft);renderImport({...base,adapter:{save(){writes++}}});renderEditor({...base,initialDraft:draft,adapter:{save(){writes++}}});assert.equal(writes,0);assert.equal(JSON.stringify(draft),before)})
test('학교 일정에 가져오기 진입점이 있고 홈에서는 기존 등록 흐름을 유지한다',()=>{const props={...base,schoolName:'합성 학교',revision:0,onPageChange(){}};assert(renderCalendar({...props,page:'calendar'}).includes('시트에서 가져오기'));assert(!renderCalendar({...props,page:'home'}).includes('시트에서 가져오기'))})
console.log(`일정 가져오기 화면: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
