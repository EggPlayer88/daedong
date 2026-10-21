import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {assertIsolatedEnvironment,deploymentSteps,executeDeploymentSteps} from '../scripts/verify-workhub-deployment.mjs'
let count=0
function test(name,fn){fn();count++;console.log('  ✓ '+name)}
const options={python:'python',report:'report',pgBin:'local-pg17'}
test('모든 묶음은 목록 무결성과 한 DB 통합을 먼저 검사하고 각 캡처를 실제 앱에 대조한다',()=>{
 const rows=deploymentSteps(options),names=rows.map(r=>r.name)
 assert.deepEqual(names.slice(0,2),['inventory','integrated'])
 for(const pair of [['school-roster','school-roster-app'],['school-data','school-data-app'],['timetable-interventions','timetable-interventions-app'],['timetable-import','timetable-import-app']])assert.equal(names.indexOf(pair[1]),names.indexOf(pair[0])+1)
 assert(names.includes('ai-policy')&&names.includes('knowledge-history')&&names.includes('ai-memory'))
 assert(rows.every(r=>r.env.WORKHUB_DEPLOYMENT_TEST_PORT==='55609'&&r.env.T4_WITH_OPERATIONS==='1'))
 assert.equal(names.at(-1),'inventory-after')
 assert.deepEqual(deploymentSteps({...options,integrationOnly:true}).map(r=>r.name),['inventory','integrated','inventory-after'])
})

test('접속 주소·libpq 비밀 파일·DSN·생성 플래그는 값 노출 없이 실행 전에 거절한다',()=>{
 for(const name of ['PGHOSTADDR','PGSSLKEY','pgHostAddr','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','WORKHUB_WRITE_INT05','WORKHUB_WRITE_INT04','P9_WRITE_MANIFEST']){
  let spawned=false
  assert.throws(()=>executeDeploymentSteps(deploymentSteps(options),{cwd:'.',report:join(tmpdir(),'unused-report'),environment:{[name]:'private-value'},spawn:()=>{spawned=true}}),error=>error.message.includes(name)&&!error.message.includes('private-value'))
  assert.equal(spawned,false)
 }
 assert.doesNotThrow(()=>assertIsolatedEnvironment({WORKHUB_DEPLOYMENT_PG_BIN:'local',P9_PG_BIN:'local',PATH:'local',PGHOSTADDR:''}))
})
test('운영 기본 포트와 누락된 임시 PG 경로는 실행 전 거절한다',()=>{
 for(const patch of [{port:5432},{port:65536},{port:NaN},{pgBin:''},{report:''}])assert.throws(()=>deploymentSteps({...options,...patch}))
})
test('선행 실패 뒤 다른 SQL을 진행하거나 부분 성공을 전체 성공으로 기록하지 않는다',()=>{
 const report=mkdtempSync(join(tmpdir(),'deployment-runner-')),steps=deploymentSteps({...options,report}),calls=[]
 const result=executeDeploymentSteps(steps,{cwd:'.',report,spawn:(command,args)=>{calls.push(args);return{status:calls.length===2?1:0,stdout:'시험 전용 기록\n'}}})
 assert.equal(calls.length,2);assert.equal(result.passed,false);assert.equal(result.completedSteps,2);assert.equal(result.results[1].passed,false)
 assert.equal(JSON.parse(readFileSync(join(report,'summary.json'),'utf8')).passed,false)
 assert.match(readFileSync(join(report,'integrated.log'),'utf8'),/시험 전용 기록/)
})
test('시간초과와 실행 오류도 실패로 남기고 후속 단계를 실행하지 않는다',()=>{
 for(const failure of [{status:null,signal:'SIGTERM'},{status:0,error:new Error('spawn failed')}]){
  const report=mkdtempSync(join(tmpdir(),'deployment-timeout-')),result=executeDeploymentSteps(deploymentSteps({...options,report}),{cwd:'.',report,spawn:()=>failure})
  assert.equal(result.passed,false);assert.equal(result.completedSteps,1)
 }
})
test('모든 단계가 종료 코드 0일 때만 통합 성공으로 표시한다',()=>{
 const report=mkdtempSync(join(tmpdir(),'deployment-success-')),steps=deploymentSteps({...options,report,integrationOnly:true}),result=executeDeploymentSteps(steps,{cwd:'.',report,spawn:()=>({status:0,stdout:''})})
 assert.equal(result.passed,true);assert.equal(result.completedSteps,steps.length);assert.equal(result.productionDbApplied,false);assert.equal(result.realMembersLinked,false)
})

test('끝난 뒤 목록 검사 실패도 전체 실패로 남긴다',()=>{
 const report=mkdtempSync(join(tmpdir(),'deployment-after-')),steps=deploymentSteps({...options,report,integrationOnly:true});let called=0
 const result=executeDeploymentSteps(steps,{cwd:'.',report,spawn:()=>({status:++called===steps.length?1:0,stdout:''})})
 assert.equal(result.passed,false);assert.equal(result.completedSteps,steps.length);assert.equal(result.results.at(-1).name,'inventory-after')
})
console.log('배포 검증 실행기 '+count+'건 통과')
