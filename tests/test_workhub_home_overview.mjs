import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {parse,create}=await loadBrowserModule(`export {homeOverview as parse,createHomeService as create} from '../apps/workhub/src/home/overview'`)
const member={id:'m',schoolId:'s',userId:'u',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',role:'teacher',departmentIds:[],gradeIds:[],subjectIds:[]}
const base=()=>({asOf:'2026-10-16T00:00:00Z',items:[{id:'i',kind:'collection',title:'계획서',dueDate:'2026-10-31',sourceId:'request',priority:'normal',label:'자료 수합 열기'}],counts:{collection:3,supplement:0,message:null,student_followup:0,cooperation:0},unavailable:['message']})
let n=0;function test(name,run){run();n++;console.log('  ✓ '+name)}
test('카드 수와 전체 건수를 구분하고 확인되지 않은 메시지는 null로 유지한다',()=>{assert.equal(parse(base(),member).counts.collection,3);assert.equal(parse(base(),member).counts.message,null)})
test('연결 실패를 0건으로 위장하거나 미연결 카드가 오면 거부한다',()=>{const value=base();value.counts.message=0;assert.throws(()=>parse(value,member));value.counts.message=null;value.items[0].kind='message';assert.throws(()=>parse(value,member))})
test('같은 수합을 두 의무처럼 중복 표시하지 않는다',()=>{const value=base();value.items.push({...value.items[0],id:'other'});assert.throws(()=>parse(value,member))})
test('읽음 버튼이 제출 완료 명령을 만들지 않는 조회 전용 계약이다',()=>{const connection={info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-10-16'})};assert.deepEqual(Object.keys(create(connection)),['load'])})
test('비정상 날짜·분류·빈 제목·0건인데 카드 있음은 거부한다',()=>{for(const changed of [{dueDate:'2026-02-30'},{kind:'timetable'},{title:''}]){const value=base();Object.assign(value.items[0],changed);assert.throws(()=>parse(value,member))}const value=base();value.counts.collection=0;assert.throws(()=>parse(value,member))})
console.log(n+'건 통과')
