import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
import { assignment, snapshot } from './helpers/teaching-relations-fixture.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/teaching/relations-list';export * from '../apps/workhub/src/app/list-window';import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{RelationsLists}from'../apps/workhub/src/teaching/RelationsLists';export const render=props=>renderToStaticMarkup(React.createElement(RelationsLists,props));`)
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
const day = '2026-10-16', base = assignment()
check('시작일·마지막 날은 모두 현재 유효이며 다음날부터 종료다', () => {
  assert.equal(m.relationStatus({...base,validFrom:day},day),'active')
  assert.equal(m.relationStatus({...base,effectiveThrough:day},day),'active')
  assert.equal(m.relationStatus({...base,effectiveThrough:'2026-10-15'},day),'ended')
})
check('미래 시작과 시작 전 취소를 종료와 구분한다', () => {
  assert.equal(m.relationStatus({...base,validFrom:'2026-10-17'},day),'scheduled')
  assert.equal(m.relationStatus({...base,validFrom:'2026-10-17',effectiveThrough:null},day),'cancelled')
})
check('교사 검색은 정규화된 이름과 상태를 동시에 적용하고 원본 순서를 보존한다', () => {
  const rows=[{...base,id:'b',label:'김  가람'},{...base,id:'c',label:'김 나래'},{...base,id:'a',label:'김 가람',effectiveThrough:'2026-10-15'}],before=structuredClone(rows)
  assert.deepEqual(m.filterAssignments(rows,day,'  김 가람  ','active').map(r=>r.id),['b'])
  assert.deepEqual(m.filterAssignments(rows,day,'김','all').map(r=>r.id),['b','c','a'])
  assert.deepEqual(rows,before)
})
check('분해된 한글과 영문 대소문자를 이름 검색에서 동일하게 본다', () => {
  assert.equal(m.filterAssignments([{...base,label:'가람 TEACHER'}],day,'가람'.normalize('NFD')+' teacher','all').length,1)
})
check('학생 검색 상태는 학적이 아니라 선택 수업의 수강 기준이다', () => {
  const student=snapshot().students[0],s={...student,membership:{...student.membership,effectiveThrough:'2026-10-15'}}
  assert.equal(m.filterRelationStudents([s],day,'합성','active').length,0)
  assert.equal(m.filterRelationStudents([s],day,'합성','ended').length,1)
  assert.equal(m.relationStatus(s.enrollment,day),'active')
})
check('빈 검색 결과와 필터 초기화는 관계와 ID를 바꾸지 않는다', () => {
  const rows=snapshot().students
  assert.equal(m.filterRelationStudents(rows,day,'없는 이름','all').length,0)
  const result=m.filterRelationStudents(rows,day,'','all')
  assert.notEqual(result,rows); assert.equal(result[0],rows[0])
})
check('검색 범위 1,000명을 모두 검사한 뒤 표시만 20명으로 나눈다', () => {
  const student=snapshot().students[0],rows=Array.from({length:1000},(_,i)=>({...student,studentId:'student-'+i,name:'학생 '+String(i).padStart(4,'0')}))
  assert.equal(m.listWindow(m.filterRelationStudents(rows,day,'','all'),0).items.length,20)
  const found=m.filterRelationStudents(rows,day,'0999','all')
  assert.equal(found.length,1);assert.equal(found[0].studentId,'student-999')
})
check('목록이 줄어들어도 실제 표시 페이지는 유효 범위로 보정된다', () => {
  const first=m.listWindow(Array(100).fill(base),4)
  const shorter=m.listWindow([base],first.page)
  assert.equal(shorter.page,0);assert.equal(shorter.start,1);assert.equal(shorter.end,1)
})
const props=s=>({snapshot:s,disabled:false,editing:false,stale:false,onBegin:()=>{throw Error('렌더 중 변경 금지')}})
check('SSR은 전체 건수를 표시하면서 교사·학생 카드 각각 20개만 출력한다', () => {
  const s=snapshot(),student=s.students[0]
  s.assignments=Array.from({length:42},(_,i)=>({...base,id:'teacher-'+i,label:'교사 '+i}))
  s.students=Array.from({length:1000},(_,i)=>({...student,studentId:'student-'+i,name:'학생 '+i}))
  const html=m.render(props(s))
  assert.equal((html.match(/<article/g)||[]).length,40)
  assert.ok(html.includes('학생 수강 전체 1000명'))
  assert.ok(html.includes('교사 담당 전체 42건'))
  assert.ok(!html.includes('<h4>학생 999</h4>'))
})
check('반복 렌더의 폼 ID는 겹치지 않고 관계 이름은 HTML로 실행되지 않는다', () => {
  const s=snapshot();s.students[0].name='<img src=x onerror=alert(1)>'
  const a=m.render(props(s)),b=m.render(props(s)),ids=html=>[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1])
  assert.ok(a.includes('&lt;img'));assert.ok(!a.includes('<img src=x'))
  // 서로 다른 SSR 루트의 ID는 합쳐 쓰지 않는다. 각 렌더 안에서 label 연결의 유일성을 확인한다.
  for(const html of [a,b])assert.equal(new Set(ids(html)).size,ids(html).length)
})
check('편집 중에는 다른 관계의 변경 버튼을 비활성화한다', () => {
  const html=m.render({...props(snapshot()),editing:true})
  assert.ok(/disabled="">담당 교체/.test(html));assert.ok(/disabled="">수강 종료/.test(html))
})
check('변경 권한이 없는 목록은 조회만 제공한다', () => {
  const s=snapshot();s.capabilities={manageAssignments:false,endMemberships:false,transferStudents:false};s.approvedTeachers=[]
  const html=m.render(props(s))
  assert.ok(html.includes('현재 교사'));assert.ok(!html.includes('담당 교체 ·'));assert.ok(!html.includes('전출 처리 ·'))
})
console.log(`\n${count}건 전부 통과`)
