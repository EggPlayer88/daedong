import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {TimetableWorkspacePanel,timetableClock} from '../apps/workhub/src/timetable/TimetableWorkspace';
import {TimetableBoard} from '../apps/workhub/src/timetable/TimetableBoard';
export {timetablePracticeSnapshot} from '../apps/workhub/src/timetable/sample';
export {solveTimetable} from '../packages/timetable/src/solver';
export {validateBasis,validatePlacements} from '../packages/timetable/src/validate';
export {timetableClock};
export const render=(kind,props)=>renderToStaticMarkup(React.createElement(kind==='board'?TimetableBoard:TimetableWorkspacePanel,props));
`)
const member={id:'member',schoolId:'school',userId:'user',name:'합성교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
let count=0
function check(name,run){run();count++;console.log('  ✓ '+name)}
const sample=m.timetablePracticeSnapshot('2026-10-16'),basis=sample.basis,result=m.solveTimetable(basis)
check('첫 화면에는 실제 학교를 대신하는 예시자료나 저장 완료가 없다',()=>{const html=m.render('panel',{server:{},member,date:'2026-10-16'});assert.match(html,/시간표 연결을 확인/);assert.doesNotMatch(html,/예시 교사|예시 1반|학교 서버에 새 초안을 저장했습니다/);assert.match(html,/aria-labelledby/);assert.doesNotMatch(html,/<table/)})
check('명시적으로 연습할 자료는 현재 학교 식별자를 사용하지 않고 저장 불가다',()=>{assert.equal(sample.canSave,false);assert.equal(sample.lessons.length,0);assert.equal(sample.basis.schoolId,'practice-school');assert.equal(sample.weekStart,'2026-10-12');assert.equal(m.validateBasis(basis).valid,true);assert.equal(result.status,'feasible');assert.equal(m.validatePlacements(basis,result.placements).valid,true)})
check('시간표 표는 교시와 실제 시각·요일을 함께 표시한다',()=>{const html=m.render('board',{basis,placements:result.placements,onSelect:()=>{}});assert.match(html,/09:00–09:45/);assert.match(html,/월요일/);assert.match(html,/scope="col"/);assert.match(html,/scope="row"/);assert.match(html,/tabindex="0"/);assert.equal((html.match(/이동할 수업 선택/g)||[]).length,6)})
check('교사 선택은 해당 교사가 참여한 수업만 표에 넣는다',()=>{const html=m.render('board',{basis,placements:result.placements,filterResourceId:'practice-teacher-b',onSelect:()=>{}});assert.match(html,/예시 1반 국어/);assert.doesNotMatch(html,/예시 1반 과학/);assert.equal((html.match(/이동할 수업 선택/g)||[]).length,2)})
check('수업 이동은 키보드 버튼이며 선택 상태와 비활성을 전달한다',()=>{const html=m.render('board',{basis,placements:result.placements,selectedLessonId:'practice-lesson-a1',disabled:true,onSelect:()=>{}});assert.match(html,/aria-pressed="true"/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/draggable="true"/)})
check('학교의 수업·자원 이름은 실행 코드로 렌더하지 않는다',()=>{const unsafe=structuredClone(basis);unsafe.lessons[0].label='<img src=x onerror=alert(1)>';unsafe.resources[0].label='<script>bad</script>';const html=m.render('board',{basis:unsafe,placements:result.placements,onSelect:()=>{}});assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script>/)})
check('아직 배치하지 않은 빈 시간표도 실제 수업을 만들어 표시하지 않는다',()=>{const html=m.render('board',{basis,placements:[],onSelect:()=>{}});assert.doesNotMatch(html,/이동할 수업 선택/);assert.match(html,/편성 초안/)})
check('자정 경계 시각은 날짜를 추측하지 않고 시각만 표현한다',()=>{assert.equal(m.timetableClock(0),'00:00');assert.equal(m.timetableClock(1439),'23:59');assert.equal(m.timetableClock(1440),'24:00')})
console.log(`시간표 화면 렌더 검사: ${count}개 통과`)
