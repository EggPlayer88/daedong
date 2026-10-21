import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const api=await loadBrowserModule("export * from '../apps/workhub/src/assistant/school-operations-contracts.ts';export * from '../apps/workhub/src/assistant/school-operations-server.ts';")
const expected={schoolId:'school-one',memberId:'member-one'}
const time='2026-10-21T01:00:00.000Z'
const counts=()=>Object.fromEntries(api.AI_OPERATION_STATES.map(s=>[s,0]))
const aggregate=()=>({requests:0,settledMicroUsd:0,reservedMicroUsd:0,states:counts()})
function data(){return{contract:'assistant.operations.v1',...expected,checkedAt:time,asOf:time,month:'2026-10',timeZone:'Asia/Seoul',totals:aggregate(),groups:api.AI_OPERATION_FEATURES.flatMap(feature=>api.AI_OPERATION_QUALITIES.map(quality=>({...aggregate(),feature,quality}))),unresolved:{requests:0,reservedMicroUsd:0,previousMonthRequests:0,previousMonthReservedMicroUsd:0,oldestCreatedAt:null,observedOverageRequests:0},items:[],nextCursor:null}}
function diagnostics(){return{contract:'assistant.school.diagnostics.v1',...expected,checkedAt:time,providerContacted:false,checks:Object.entries(api.DIAGNOSTIC_RULES).map(([id,rules])=>{const[code,ok]=Object.entries(rules)[0];return{id,code,ok}})}}
function one(){const v=data();for(const a of [v.totals,v.groups[0]]){a.requests=1;a.states.unknown=1;a.reservedMicroUsd=14000}v.items.push({id:'request-one',requestKey:'original-request-key',feature:'assistant',quality:'quick',state:'unknown',createdAt:time,updatedAt:time,model:'claude-haiku-test',reservedMicroUsd:14000,settledMicroUsd:null,usage:null,errorCode:'PROVIDER_UNKNOWN',observedOverage:false});v.unresolved={requests:1,reservedMicroUsd:14000,previousMonthRequests:0,previousMonthReservedMicroUsd:0,oldestCreatedAt:time,observedOverageRequests:0};return v}
let passed=0,failed=0
async function test(name,fn){try{await fn();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
const parse=value=>api.schoolAiOperations(value,expected)
await test('빈 목록과 처리미상 요청을 기능별 합계와 함께 받는다',()=>{assert.deepEqual(parse(data()),data());assert.deepEqual(parse(one()),one())})
for(const[name,change]of[
 ['다른 학교',v=>v.schoolId='school-two'],['다른 소속',v=>v.memberId='member-two'],['질문 필드 유출',v=>v.prompt='비공개 원문'],
 ['잘못된 월',v=>v.month='2026-11'],['잘못된 표준시',v=>v.timeZone='not-a-zone'],['밀리초 누락',v=>v.asOf='2026-10-21T01:00:00Z'],
 ['미래 기준',v=>v.asOf='2026-10-22T01:00:00.000Z'],['총계 불일치',v=>v.totals.requests++],['그룹 비용 불일치',v=>v.groups[0].reservedMicroUsd++],
 ['상태별 합계 불일치',v=>v.totals.states.prepared++],['중복 그룹',v=>v.groups[1]=v.groups[0]],['이전달 건수 과장',v=>v.unresolved.previousMonthRequests=2],
 ['중복 항목',v=>v.items.push(v.items[0])],['원키 너무 짧음',v=>v.items[0].requestKey='x'],['예약 정산 중복',v=>v.items[0].settledMicroUsd=10],
 ['미등록 오류코드',v=>v.items[0].errorCode='secret-error'],['다른 범위 커서',v=>v.nextCursor={month:'2026-09',asOf:time,afterId:'request-one'}],
 ['소수 비용',v=>v.totals.reservedMicroUsd=.5],['요청보다 앞선 갱신',v=>v.items[0].updatedAt='2026-10-20T00:00:00.000Z'],
])await test(name+' 응답을 거부한다',()=>{const v=one();change(v);assert.throws(()=>parse(v))})
await test('다음 쪽은 처음 읽은 월·기준시각과 일치해야 한다',()=>assert.throws(()=>api.schoolAiOperations(one(),expected,{month:'2026-10',asOf:'2026-10-20T00:00:00.000Z',afterId:'earlier'})))
await test('지원 파일은 학교·회원·요청번호·내역 없이 집계와 진단만 남긴다',()=>{const text=JSON.stringify(api.schoolAiSupportReport(parse(one()),api.schoolAiDiagnostics(diagnostics(),expected)));for(const key of ['school-one','member-one','request-one','original-request-key','claude-haiku-test'])assert(!text.includes(key));assert(text.includes('assistant.support.v1'));assert.equal(JSON.parse(text).providerContacted,false)})
await test('진단은 실제 공급자를 확인했다고 표시할 수 없다',()=>{const d=diagnostics();assert.deepEqual(api.schoolAiDiagnostics(d,expected),d);d.providerContacted=true;assert.throws(()=>api.schoolAiDiagnostics(d,expected))})
await test('진단의 코드와 성공상태를 함께 확인한다',()=>{const d=diagnostics();d.checks[7].ok=true;assert.throws(()=>api.schoolAiDiagnostics(d,expected));d.checks[7].ok=null;d.key='secret';assert.throws(()=>api.schoolAiDiagnostics(d,expected))})
function connection(){let identity={userId:'user-one',approved:true,profile:{role:'superadmin',is_active:true,extra_permissions:[]}},member={...expected,id:expected.memberId,userId:'user-one',role:'school_admin',active:true,validFrom:'2026-01-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]};return{info:()=>({basisDate:'2026-10-21',memberships:[member],schools:[{id:expected.schoolId}]}),getIdentity:async()=>identity,change:()=>identity={...identity,userId:'user-two'},revoke:()=>identity={...identity,approved:false}}}
await test('목록·진단만 고정주소 전송하며 쓰기 플래그는 false다',async()=>{const c=connection(),calls=[],server=api.createSchoolAiOperationsServer(c,{send:async(p,u,w)=>{calls.push([p,u,w]);return p.action==='list'?data():diagnostics()}});await server.list(expected.memberId);await server.diagnostics(expected.memberId);assert.deepEqual(calls.map(c=>c[0]),[{action:'list',memberId:expected.memberId,cursor:null},{action:'diagnostics',memberId:expected.memberId}]);assert(calls.every(c=>c[1]==='user-one'&&c[2]===false))})
await test('승인되지 않은 계정은 조회를 보내지 않는다',async()=>{const c=connection();c.revoke();let calls=0;const s=api.createSchoolAiOperationsServer(c,{send:async()=>{calls++;return data()}});await assert.rejects(()=>s.list(expected.memberId),e=>e.code==='CANCELLED');assert.equal(calls,0)})
await test('조회 중 계정 변경은 늦은 자료를 폐기한다',async()=>{const c=connection(),s=api.createSchoolAiOperationsServer(c,{send:async()=>{c.change();return one()}});await assert.rejects(()=>s.list(expected.memberId),e=>e.code==='CANCELLED')})
await test('손상된 응답은 목록 오류로 처리한다',async()=>{const s=api.createSchoolAiOperationsServer(connection(),{send:async()=>({...data(),schoolId:'another-school'})});await assert.rejects(()=>s.list(expected.memberId),e=>e.code==='INVALID_RESPONSE')})
await test('시간초과 후 응답은 결과를 덮어쓰지 않는다',async()=>{let release;const s=api.createSchoolAiOperationsServer(connection(),{send:()=>new Promise(r=>release=r)},{timeoutMs:5});await assert.rejects(()=>s.list(expected.memberId),e=>e.code==='QUERY_FAILED');release(data());await new Promise(r=>setTimeout(r,10))})
console.log('학교 AI 운영 계약 '+passed+' 통과, '+failed+' 실패');if(failed)process.exit(1)

