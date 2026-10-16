import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const module = await loadBrowserModule(`
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {TimetableOperationsPanel} from '../apps/workhub/src/timetable/TimetableOperationsWorkspace';
import {TimetablePublishPanel} from '../apps/workhub/src/timetable/TimetablePublishPanel';
import {OperationChangeList,OperationLessonLabel,dateOffset,operationDate,operationClock} from '../apps/workhub/src/timetable/OperationChangeList';
export {dateOffset,operationDate,operationClock};
export const render=(kind,props)=>renderToStaticMarkup(React.createElement({workspace:TimetableOperationsPanel,publish:TimetablePublishPanel,changes:OperationChangeList,lesson:OperationLessonLabel}[kind],props));
`)
const member={id:'member',schoolId:'school',userId:'user',name:'합성 교사',role:'admin',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const lesson={id:'lesson',version:1,label:'합성 국어',time:{startsAt:'2026-10-19T00:00:00.000Z',endsAt:'2026-10-19T00:45:00.000Z'},teachers:[{id:'member',name:'합성 교사'}],groupNames:['1반'],roomNames:['1교실'],state:'scheduled',canRequest:true,allowedTargets:[]}
const view={asOf:'2026-10-16T00:00:00.000Z',timeZone:'Asia/Seoul',from:'2026-10-16',until:'2026-11-13',canPublish:true,canRequest:true,drafts:[{id:'draft',version:2,title:'합성 저장 초안'}],lessons:[lesson],requests:[],publications:[]}
const props={server:{},member,view,loading:false,locked:false,onCommand:async()=>{},onDirtyChange:()=>{}}
let count=0
function check(name,run){run();count++;console.log('  ✓ '+name)}
check('조회 전 운영 화면은 연결 확인만 안내하며 확정 자료를 만들지 않는다',()=>{const html=module.render('workspace',{server:{},member,date:'2026-10-16'});assert.match(html,/<h1[^>]*>시간표 운영/);assert.match(html,/시간표 운영 연결을 확인/);assert.doesNotMatch(html,/합성 국어|학교 시간표 1판을 확정했습니다/);assert.match(html,/시간표 운영 작업/);assert.match(html,/hidden=""/);assert.doesNotMatch(html,/<iframe|<script/)} )
check('미확인 권한의 확정 화면에는 학교 초안 이름과 입력 칸이 없다',()=>{const html=module.render('publish',{...props,view:{...view,canPublish:false,drafts:[]}});assert.match(html,/담당 권한과 서버 준비 상태/);assert.doesNotMatch(html,/<select|합성 저장 초안|확인한 시간표 확정/)} )
check('공개 기간 입력에는 명시적 레이블과 포함 마지막 날 안내가 있다',()=>{const html=module.render('publish',props);assert.match(html,/aria-label="확정할 저장 초안"/);assert.match(html,/aria-label="적용 시작일"/);assert.match(html,/aria-label="적용 마지막 날"/);assert.match(html,/마지막 날까지 적용합니다/);assert.doesNotMatch(html,/type="submit"/);assert.match(html,/합성 저장 초안 · 2판/)} )
check('결과 미상 잠금은 확정 입력 전체를 비활성화한다',()=>{const html=module.render('publish',{...props,locked:true});assert.match(html,/<fieldset disabled=""/);assert.doesNotMatch(html,/확인한 시간표 확정/)} )
check('변경 비교는 실제 현지 날짜·시간·교사·반·교실과 변경 전후를 표시한다',()=>{const html=module.render('changes',{changes:[{before:lesson,after:{...lesson,version:2,time:{startsAt:'2026-10-19T01:00:00.000Z',endsAt:'2026-10-19T01:45:00.000Z'}}}],timeZone:'Asia/Seoul'});for(const value of ['변경 전','변경 후','2026-10-19 09:00','2026-10-19 10:00','합성 교사','1반','1교실','1판','2판'])assert.ok(html.includes(value),value)} )
check('학교 이름과 서버 문구는 HTML을 실행하지 않고 문자열로 표시한다',()=>{const unsafe={...lesson,label:'<img src=x onerror=bad()>',teachers:[{id:'member',name:'<script>bad()</script>'}]};const html=module.render('lesson',{lesson:unsafe,timeZone:'Asia/Seoul'});assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script>/)} )
check('다량 변경 내역은 처음 20개만 렌더하고 키보드 확장 버튼을 제공한다',()=>{const changes=Array.from({length:45},(_,index)=>({before:null,after:{...lesson,id:'lesson-'+index}}));const html=module.render('changes',{changes,timeZone:'Asia/Seoul'});assert.equal((html.match(/새로 편성하는 수업/g)||[]).length,20);assert.match(html,/변경 수업 20건 더 보기 \(20\/45\)/);assert.match(html,/type="button"/)} )
check('포함 마지막 날은 UTC 날짜 연산으로 연말·윤년 경계를 한 번만 변환한다',()=>{assert.equal(module.dateOffset('2026-12-31',1),'2027-01-01');assert.equal(module.dateOffset('2028-02-28',1),'2028-02-29');assert.equal(module.dateOffset('2026-02-30',1),'');assert.equal(module.operationDate('2026-10-18T15:00:00.000Z','Asia/Seoul'),'2026-10-19');assert.equal(module.operationClock('2026-10-18T15:00:00.000Z','Asia/Seoul'),'00:00')} )
console.log(`시간표 운영 화면 렌더 검사: ${count}개 통과`)
