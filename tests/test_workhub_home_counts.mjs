import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { rows, empty, labels } = await loadBrowserModule(`export {homeCountRows as rows,homeOverviewEmpty as empty,homeCountLabels as labels} from '../apps/workhub/src/home/counts'`)
const data=()=>({items:[],counts:{collection:0,supplement:0,message:0,student_followup:0,cooperation:0},unavailable:[]})
let n=0;function test(name,action){action();console.log('  ✓ '+name);n++}
test('대표 카드가 없어도 서버에 남은 업무가 있으면 빈 업무가 아니다',()=>{const d=data();d.counts.message=108;assert.equal(empty(d),false);assert.equal(rows(d).find(r=>r.kind==='message').count,108)})
test('확인 중은 0건과 구별하며 전체 확인 0건일 때만 빈 화면이다',()=>{const d=data();assert.equal(empty(d),true);d.counts.collection=null;d.unavailable=['collection'];assert.equal(empty(d),false);assert.equal(rows(d)[0].count,null)})
test('수합·보완은 합산하지 않고 각각 같은 자료 수를 유지한다',()=>{const d=data();d.counts.collection=20;d.counts.supplement=20;assert.deepEqual(rows(d).slice(0,2).map(r=>r.count),[20,20]);assert.equal(rows(d).length,5)})
test('종류별 목적지는 기존 메뉴이며 학생 후속은 수업 건수임을 명시한다',()=>{assert.deepEqual(rows(data()).map(r=>r.page),['collections','collections','messages','students','cooperation']);assert.match(labels.student_followup.label,/수업/);assert.match(labels.message.label,/대화/)})
console.log(n+'건 통과')
