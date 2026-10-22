import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {eventTiming}=await loadBrowserModule(`export {eventTiming} from '../apps/workhub/src/calendar/formatting'`)
const interval={allDay:false,startDate:'2026-10-18',endDate:'2026-10-20',startTime:'18:00',endTime:'09:00'}
let passed=0
function test(name,run){run();passed++;console.log('  ✓ '+name)}
test('하루 일정은 기존 시작·종료 시각을 그대로 표시한다',()=>{
 assert.deepEqual(eventTiming({...interval,endDate:interval.startDate,endTime:'19:00'},interval.startDate),{primary:'18:00',secondary:'19:00',description:'18:00–19:00'})
})
test('여러 날 일정 첫날은 시작 시각이며 마지막 날 종료 시각을 같은 날 시간으로 합치지 않는다',()=>{
 assert.deepEqual(eventTiming(interval,'2026-10-18'),{primary:'18:00',secondary:'시작',description:'2026-10-18 18:00 시작 · 2026-10-20 09:00 종료'})
})
test('중간 날짜는 처음 시각을 반복하지 않고 진행 중으로 표시한다',()=>{
 const value=eventTiming(interval,'2026-10-19');assert.equal(value.primary,'진행');assert.equal(value.secondary,'중')
 assert.match(value.description,/2026-10-18 18:00 시작/);assert.match(value.description,/2026-10-20 09:00 종료/)
})
test('마지막 날짜는 종료 시각과 종료 표기를 사용한다',()=>{
 const value=eventTiming(interval,'2026-10-20');assert.equal(value.primary,'09:00');assert.equal(value.secondary,'종료')
})
test('종일 일정은 날짜와 관계없이 종일이며 종료일도 포함한다',()=>{
 for(const day of ['2026-10-18','2026-10-19','2026-10-20'])assert.deepEqual(eventTiming({...interval,allDay:true,startTime:'',endTime:''},day),{primary:'종일',secondary:'',description:'2026-10-18 ~ 2026-10-20 · 종일'})
 assert.equal(eventTiming({...interval,allDay:true,endDate:interval.startDate},interval.startDate).description,'종일')
})
test('연도·윤년 경계도 원본 전체 날짜를 보존하고 시각을 추정하지 않는다',()=>{
 for(const [startDate,endDate,day] of [['2026-12-31','2027-01-02','2027-01-01'],['2028-02-28','2028-03-01','2028-02-29']]){
  const value=eventTiming({...interval,startDate,endDate},day)
  assert.equal(value.primary,'진행');assert.equal(value.description,`${startDate} 18:00 시작 · ${endDate} 09:00 종료`)
 }
})
test('목록의 기간은 시작과 종료의 날짜·시각을 함께 명시한다',()=>{
 assert.equal(eventTiming(interval).description,'2026-10-18 18:00 시작 · 2026-10-20 09:00 종료')
})
test('자정 종료와 원본 입력은 변경하지 않는다',()=>{
 const source=Object.freeze({...interval,endTime:'00:00'})
 assert.equal(eventTiming(source,source.endDate).primary,'00:00');assert.equal(source.startTime,'18:00');assert.equal(source.endDate,'2026-10-20')
})
console.log(`일정 시간 표시 ${passed}건 통과`)
