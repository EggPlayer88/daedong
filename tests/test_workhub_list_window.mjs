import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

const {listWindow,renderPager}=await loadBrowserModule(`
  import{renderToStaticMarkup}from'react-dom/server';import{ListPagination}from'../apps/workhub/src/app/ListPagination';
  export{listWindow}from'../apps/workhub/src/app/list-window';
  export const renderPager=props=>renderToStaticMarkup(<ListPagination {...props} onPageChange={()=>{}}/>);
`)
const rows=Array.from({length:1000},(_,index)=>({id:index}));let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
test('전체 건수와 첫 20개 표시 범위를 분리한다',()=>{
  const value=listWindow(rows);assert.equal(value.total,1000);assert.equal(value.pages,50);assert.equal(value.start,1);assert.equal(value.end,20);assert.deepEqual(value.items,rows.slice(0,20));assert.equal(rows.length,1000)
})
test('다음 쪽·마지막 일부 쪽은 누락이나 중복 없이 이어진다',()=>{
  const input=rows.slice(0,43),all=[0,1,2].flatMap(page=>listWindow(input,page).items);assert.deepEqual(all,input);assert.equal(listWindow(input,2).start,41);assert.equal(listWindow(input,2).end,43)
})
test('목록 축소 시 마지막 유효 쪽으로 보정한다',()=>{
  const value=listWindow(rows.slice(0,21),49);assert.equal(value.page,1);assert.deepEqual(value.items,[rows[20]])
})
test('잘못된 쪽·크기는 정수 기본값으로 처리한다',()=>{
  for(const page of[-1,NaN,Infinity,0.5,'2'])assert.equal(listWindow(rows,page).page,0)
  for(const size of[0,-1,NaN,Infinity,0.5,'20'])assert.equal(listWindow(rows,0,size).size,20)
})
test('배열 대신 null·문자열·객체가 들어와도 빈 표시 범위를 반환한다',()=>{
  for(const input of[null,undefined,'broken',{},[]]){const value=listWindow(input,49);assert.deepEqual(value.items,[]);assert.equal(value.total,0);assert.equal(value.start,0);assert.equal(value.end,0);assert.equal(value.page,0);assert.equal(value.pages,1)}
})
test('표시 배열을 수정해도 원본 배열을 바꾸지 않는다',()=>{
  const original=Object.freeze([...rows]),value=listWindow(original);value.items.pop();assert.equal(original.length,1000);assert.equal(listWindow(original).items.length,20)
})
test('빈 목록과 한 쪽은 이동 메뉴를 만들지 않는다',()=>{
  for(const count of[0,1,20])assert.equal(renderPager({label:'업무 목록 페이지',window:listWindow(rows.slice(0,count))}),'')
})
test('전체 쪽수·표시 범위를 상태 안내로 제공하고 첫·마지막 쪽 경계를 비활성화한다',()=>{
  const first=renderPager({label:'업무 목록 페이지',window:listWindow(rows)}),last=renderPager({label:'업무 목록 페이지',window:listWindow(rows,49)})
  assert(first.includes('aria-label="업무 목록 페이지"'));assert(first.includes('role="status"'));assert(first.includes('aria-atomic="true"'));assert(first.includes('총 1,000개 중 1–20개 표시 · 1 / 50쪽'))
  assert(/<button[^>]*disabled[^>]*>처음<\/button>/.test(first));assert(/<button[^>]*>다음<\/button>/.test(first));assert(/<button[^>]*disabled[^>]*>마지막<\/button>/.test(last));assert(last.includes('981–1,000개 표시 · 50 / 50쪽'))
})
test('작성 중 보호를 요청하면 모든 쪽 이동 버튼을 잠근다',()=>{
  const html=renderPager({label:'업무 목록 페이지',window:listWindow(rows,1),disabled:true});assert.equal((html.match(/<button[^>]*disabled/g)||[]).length,4)
})
console.log(`공통 목록 페이지: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
