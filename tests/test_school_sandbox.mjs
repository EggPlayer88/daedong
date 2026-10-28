import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {assertSandbox,SANDBOX_REF} from '../scripts/school-sandbox/environment.mjs'
import {patchDefinition,replacements} from '../scripts/school-sandbox/overrides.mjs'
const folder=mkdtempSync(join(tmpdir(),'school-sandbox-'))
const check=(name,fn)=>{fn();console.log('  ✓ '+name)}
try{
 async function clock(tag,env){const path=join(folder,tag+'.mjs');await build({entryPoints:['apps/workhub/src/sandbox/clock.ts'],outfile:path,bundle:true,platform:'node',format:'esm',define:{'import.meta.env':JSON.stringify(env)}});return import(pathToFileURL(path))}
 const live=await clock('live',{}),wrong=await clock('wrong',{VITE_SCHOOL_SANDBOX:SANDBOX_REF,VITE_SUPABASE_URL:'https://dhaoszbqtbofqftgjfyb.supabase.co'}),test=await clock('test',{VITE_SCHOOL_SANDBOX:SANDBOX_REF,VITE_SUPABASE_URL:`https://${SANDBOX_REF}.supabase.co`})
 check('일반 배포는 시각과 공개 범위를 변경하지 않음',()=>{assert.equal(live.isSchoolSandbox(),false);assert.equal(live.businessTime(123),123)})
 check('운영 DB 주소에서는 시험 플래그만으로 켜지지 않음',()=>{assert.equal(wrong.isSchoolSandbox(),false);assert.equal(wrong.businessTime(123),123)})
 check('시험 시계 미확인 시 실제 시계로 조용히 대체하지 않음',()=>assert.throws(()=>test.businessTime(123)))
 const start=Date.parse('2027-02-28T15:00:00Z'),end=Date.parse('2028-02-29T15:00:00Z'),real=Date.parse('2026-10-28T15:00:00Z'),speed=(end-start)/3600000
 const state={contract:'school-sandbox.v1',projectRef:SANDBOX_REF,revision:1,realNow:new Date(real).toISOString(),virtualNow:new Date(start).toISOString(),startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString(),speed,running:true,canControl:true,segments:[{realAt:new Date(real).toISOString(),virtualAt:new Date(start).toISOString(),running:true}],ai:{enabled:false,capMicroUsd:9000000,reservedCeilingMicroUsd:0,availableCeilingMicroUsd:9000000}}
 test.acceptSandboxClock(state)
 check('윤년을 포함한 학년도도 실제 1시간에 정확히 종료',()=>{assert.equal(test.businessTime(real+3600000),end);assert.equal(test.businessTime(real+7200000),end)})
 check('30분은 학년도 길이의 절반',()=>assert.equal(test.businessTime(real+1800000),start+(end-start)/2))
 const stopped=start+600000*speed
 test.acceptSandboxClock({...state,revision:2,segments:[...state.segments,{realAt:new Date(real+600000).toISOString(),virtualAt:new Date(stopped).toISOString(),running:false}]})
 check('일시정지는 실제 대기시간을 학년도에서 차감하지 않음',()=>assert.equal(test.businessTime(real+1800000),stopped))
 check('이전 조회 시점은 당시 시계 구간으로 검증',()=>assert.equal(test.businessTime(real+300000),start+300000*speed))
 check('늦게 도착한 이전 판은 현재 시계를 되감지 않음',()=>{assert.equal(test.acceptSandboxClock(state),false);assert.equal(test.businessTime(real+1800000),stopped)})
 check('무한 속도·잘못된 학년도·역순 이력은 거절',()=>{for(const broken of [{...state,speed:NaN},{...state,endAt:'invalid'},{...state,revision:2},{...state,segments:[{...state.segments[0],virtualAt:new Date(end+1).toISOString()}]}])assert.throws(()=>test.acceptSandboxClock(broken))})
 check('계정 변경 시 시계 상태를 폐기',()=>{test.clearSandboxClock();assert.throws(()=>test.businessTime(real))})
 const roster=JSON.parse(readFileSync('sandbox/school-year/roster.json','utf8'))
 check('원본의 22명·9학급·학급당 32시간 보존',()=>{assert.equal(roster.teachers.length,22);assert.equal(roster.classes.length,9);for(let i=0;i<9;i++)assert.equal(roster.allocations.reduce((n,a)=>n+a.hours[i],0),32)})
 check('관리자 1·시간표 담당 1·일반 교사 20명',()=>{assert.equal(roster.teachers.filter(t=>t.role==='administrator_teacher').length,1);assert.equal(roster.teachers.filter(t=>t.role==='timetable_manager_teacher').length,1);assert.equal(roster.teachers.filter(t=>t.role==='teacher').length,20)})
 const originals=JSON.parse(readFileSync('sandbox/school-year/override-originals.json','utf8'))
 check('모든 시험 SQL 변경은 고정 원문 구문을 확인',()=>{for(const name of Object.keys(replacements)){const original=originals.find(f=>f.name===name);assert.ok(original);assert.notEqual(patchDefinition(name,original.definition),original.definition);assert.throws(()=>patchDefinition(name,''))}})
 check('누적 AI 한도는 9달러이며 학교·가상 월별로 나누지 않음',()=>{const sql=readFileSync('sandbox/school-year/SB-01_시험시계_누적예산.sql','utf8');assert.match(sql,/cap_micro_usd=9000000/);assert.match(sql,/SELECT \* INTO b FROM sandbox_private.ai_limit FOR UPDATE/);assert.match(sql,/NEW.state='started'/);assert.match(sql,/DEFAULT false/);assert.doesNotMatch(sql,/burned_micro_usd\s*=\s*0/i)})
 check('복제 연결기는 운영 프로젝트와 TLS 해제를 거부',()=>{const x={projectRef:SANDBOX_REF,db:{user:`postgres.${SANDBOX_REF}`,host:'aws-0-ap-northeast-2.pooler.supabase.com',port:5432,database:'postgres',ssl:{rejectUnauthorized:true,ca:'test-ca'}}};assert.equal(assertSandbox(x),x);assert.throws(()=>assertSandbox({...x,projectRef:'dhaoszbqtbofqftgjfyb'}));assert.throws(()=>assertSandbox({...x,db:{...x.db,ssl:{rejectUnauthorized:false}}}))})
}finally{rmSync(folder,{recursive:true,force:true})}
