import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`
 export * from '../apps/workhub/src/teaching/course-batch'
 export * from '../apps/workhub/src/teaching/csv'
 export {TeachingError} from '../apps/workhub/src/teaching/contracts'
 import React from 'react';import {renderToStaticMarkup} from 'react-dom/server'
 import {CourseBatchPanel} from '../apps/workhub/src/teaching/CourseBatchPanel'
 export const render=props=>renderToStaticMarkup(React.createElement(CourseBatchPanel,props))
`)
let count=0
const check=(name,fn)=>{fn();count++;console.log('  ✓ '+name)}
const scope={schoolId:'school-a',memberId:'member-a',ownerUserId:'user-a'}
const catalog=()=>({contractVersion:'teaching.v1',...scope,courses:[],terms:[
 {id:'term-a',schoolId:'school-a',version:1,label:'1학기',firstDay:'2027-03-01',lastDay:'2027-07-31'},
 {id:'term-b',schoolId:'school-a',version:1,label:'1학기',firstDay:'2028-03-01',lastDay:'2028-07-31'},
],subjects:[{id:'subject-a',label:'국어'},{id:'subject-b',label:'국어'}],approvedTeachers:[{id:'teacher-a',label:'동명 교사'},{id:'teacher-b',label:'동명 교사'}],canManageCourses:true})
const mapping=()=>({terms:{'1학기':'term-a'},subjects:{'국어':'subject-b'},teachers:{'담당1':'teacher-b','담당2':'teacher-a'}})
const cells=(label='1반 국어')=>[label,'1학기','국어','담당1','2027-03-01','2027-07-31']
const csv=(rows=[cells()])=>m.safeCsv(m.courseBatchHeaders,rows)
const review=()=>m.reviewCourseBatch(m.parseCourseBatch(csv()),mapping(),catalog())[0]
const attempt=()=>m.startCourseBatchAttempt(review(),'request-one',[])
const receipt=a=>({contractVersion:'teaching.v1',...scope,requestKey:a.key,commandKind:'course_create',entityId:'course-created',version:1,outcome:'applied',appliedAt:'2027-02-01T01:00:00Z'})
check('빈 양식은 공식 헤더만 포함하며 교과·날짜·교사를 임의로 채우지 않는다',()=>{assert.deepEqual(m.parseCsv(m.courseBatchTemplate()),[m.courseBatchHeaders])})
check('CSV BOM·인용 쉼표·한글을 보존하며 행 번호는 원파일과 같다',()=>{const rows=m.parseCourseBatch(csv([cells('1반, 국어')]));assert.equal(rows[0].rowNumber,2);assert.equal(rows[0].label,'1반, 국어')})
check('머리글 변경·빈 목록·상한 초과를 전체 거부한다',()=>{for(const raw of [csv().replace('수업 이름','다른 칸'),m.courseBatchTemplate(),csv(Array.from({length:m.courseBatchLimit+1},(_,i)=>cells('수업'+i)))])assert.throws(()=>m.parseCourseBatch(raw),m.TeachingError)})
check('공식 ID와 파일 표기가 같아도 수동 연결 전에는 전송 명령을 만들지 않는다',()=>{const rows=m.parseCourseBatch(csv([['수업','term-a','subject-a','teacher-a','2027-03-01','2027-07-31']]));const r=m.reviewCourseBatch(rows,{terms:{},subjects:{},teachers:{}},catalog())[0];assert.equal(r.command,null);assert.equal(r.problems.length,3)})
check('동명 학기·교과·교사는 선택한 공식 ID로만 연결한다',()=>{const r=review();assert.deepEqual(r.problems,[]);assert.equal(r.command.input.termId,'term-a');assert.equal(r.command.input.subjectId,'subject-b');assert.deepEqual(r.command.input.teacherMemberIds,['teacher-b'])})
check('여러 담당은 모두 직접 연결하고 안정된 ID 순서로 보낸다',()=>{const rows=m.parseCourseBatch(csv([[...cells().slice(0,3),'담당1|담당2',...cells().slice(4)]]));assert.deepEqual(m.reviewCourseBatch(rows,mapping(),catalog())[0].command.input.teacherMemberIds,['teacher-a','teacher-b'])})
check('두 파일 표기를 같은 교사에 중복 연결하면 거부한다',()=>{const rows=m.parseCourseBatch(csv([[...cells().slice(0,3),'담당1|담당2',...cells().slice(4)]]));const map=mapping();map.teachers['담당2']='teacher-b';assert.ok(m.reviewCourseBatch(rows,map,catalog())[0].problems.length)})
check('없는 교사·교과·학기·권한은 오류로 남고 다른 ID를 추정하지 않는다',()=>{for(const kind of ['terms','subjects','approvedTeachers']){const c=catalog();c[kind]=[];assert.ok(m.reviewCourseBatch(m.parseCourseBatch(csv()),mapping(),c)[0].problems.length)}const c=catalog();c.canManageCourses=false;assert.ok(m.reviewCourseBatch(m.parseCourseBatch(csv()),mapping(),c)[0].problems.length)})
check('윤년 아닌 날짜·역전 날짜·학기 밖 기간·긴 이름을 거부한다',()=>{for(const row of [cells().map((v,i)=>i===4?'2027-02-29':v),cells().map((v,i)=>i===4?'2027-08-01':v),cells().map((v,i)=>i===5?'2027-08-01':v),cells('가'.repeat(121))])assert.ok(m.reviewCourseBatch(m.parseCourseBatch(csv([row])),mapping(),catalog())[0].problems.length)})
check('등록한 같은 수업의 겹치는 기간을 막되 다른 학급 이름은 허용한다',()=>{const c=catalog();c.courses=[{id:'existing',...review().command.input}];assert.ok(m.reviewCourseBatch(m.parseCourseBatch(csv()),mapping(),c)[0].problems.length);assert.deepEqual(m.reviewCourseBatch(m.parseCourseBatch(csv([cells('2반 국어')])),mapping(),c)[0].problems,[])})
check('파일 안 중복은 양쪽 행에 표시하고 인접한 비중첩 기간은 허용한다',()=>{const rows=m.parseCourseBatch(csv([cells(),cells()]));assert.ok(m.reviewCourseBatch(rows,mapping(),catalog()).every(r=>r.problems.length));rows[0].validThrough='2027-04-30';rows[1].validFrom='2027-05-01';assert.ok(m.reviewCourseBatch(rows,mapping(),catalog()).every(r=>r.problems.length===0))})
check('목록 비교는 입력과 원래 카탈로그를 변경하지 않는다',()=>{const rows=m.parseCourseBatch(csv()),map=mapping(),c=catalog(),before=JSON.stringify([rows,map,c]);m.reviewCourseBatch(rows,map,c);assert.equal(JSON.stringify([rows,map,c]),before)})
check('공식 목록 기준은 배열 순서에는 같고 날짜·권한·수업 변경에는 달라진다',()=>{const c=catalog(),basis=m.courseBatchBasis(c);c.terms.reverse();assert.equal(m.courseBatchBasis(c),basis);c.terms[0].lastDay='2028-07-30';assert.notEqual(m.courseBatchBasis(c),basis)})
check('전송 전 명령을 복제하고 결과 미상 행·성공 행의 새 접수를 막는다',()=>{const r=review(),a=m.startCourseBatchAttempt(r,'key-a',[]);r.command.input.label='변조';assert.equal(a.command.input.label,'1반 국어');assert.throws(()=>m.startCourseBatchAttempt(review(),'key-b',[a]));assert.throws(()=>m.startCourseBatchAttempt(review(),'key-b',[{...a,status:'saved'}]))})
check('서버 접수증을 학교·계정·요청 번호·명령·수업판으로 확인한다',()=>{const a=attempt();assert.equal(m.finishCourseBatchAttempt(a,receipt(a),scope).status,'saved');for(const patch of [{schoolId:'foreign'},{requestKey:'other'},{commandKind:'roster_import'},{version:2}])assert.throws(()=>m.finishCourseBatchAttempt(a,{...receipt(a),...patch},scope),e=>e.code==='SAVE_UNCERTAIN')})
check('처음의 확정 거절만 정리하며 복구 중 권한·입력 거절은 원래 번호를 유지한다',()=>{const a=attempt();for(const code of ['INVALID_INPUT','FORBIDDEN','CONFLICT','NOT_FOUND']){const f=new m.TeachingError(code,'거절');assert.equal(m.failCourseBatchAttempt(a,f,false).status,'rejected');const x=m.failCourseBatchAttempt(a,f,true);assert.equal(x.status,'unknown');assert.equal(x.key,a.key);assert.deepEqual(x.command,a.command)}})
check('응답 유실·알 수 없는 오류·접수증 이상은 안전하게 결과 미상으로 남긴다',()=>{const a=attempt();for(const f of [new Error('network'),new m.TeachingError('SAVE_UNCERTAIN','결과 미상'),new m.TeachingError('IDEMPOTENCY_CONFLICT','번호 충돌')])assert.equal(m.failCourseBatchAttempt(a,f,false).status,'unknown')})
check('결과 CSV는 행·상태·원번호·수업 ID를 담으며 신규등록 양식으로 오인되지 않는다',()=>{const a=attempt(),done=m.finishCourseBatchAttempt(a,receipt(a),scope),raw=m.courseBatchResultsCsv(m.parseCourseBatch(csv()),[done]);assert.match(raw,/저장 확인/);assert.match(raw,/request-one/);assert.match(raw,/course-created/);assert.throws(()=>m.parseCourseBatch(raw))})
check('수업 전용 패널은 상담·학생 자료를 읽거나 예시 수업을 자동 생성하지 않는다',()=>{const member={id:'member-a',schoolId:'school-a',userId:'user-a',name:'합성',role:'school_admin',active:true,validFrom:'2026-01-01',validThrough:'2029-01-01',departmentIds:[],gradeIds:[],subjectIds:[]};const html=m.render({adapter:{},member,disabled:false,canRecover:true,catalog:catalog(),onBusyChange(){},onSaved(){},onClose(){}});assert.match(html,/수업 여러 개 등록/);assert.match(html,/복구 번호는 현재 탭에만 보관/);assert.doesNotMatch(html,/1반 국어|localStorage|sessionStorage/);assert.match(html,/수강 명부와 시간표 배치는 이 단계에서 바뀌지 않습니다/)})
console.log(`수업 일괄 등록 단위 검증: ${count}개 통과`)
