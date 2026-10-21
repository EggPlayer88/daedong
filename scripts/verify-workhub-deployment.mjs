// 운영 접속 정보를 받지 않는다. 고정된 회귀 명령과 localhost 임시 PostgreSQL만 사용한다.
import {spawnSync,execFileSync} from 'node:child_process'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
export function assertIsolatedEnvironment(environment){
 const blocked=new Set(['DATABASE_URL','WORKHUB_TEST_DATABASE_URL','SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ANTHROPIC_API_KEY'])
 for(const [name,value] of Object.entries(environment)){
  const key=name.toUpperCase()
  // libpq의 PGHOSTADDR는 명시한 localhost도 덮을 수 있다. 검증 중 목록 재생성도 금지한다.
  if(value&&(key.startsWith('PG')||key.includes('_WRITE_')||blocked.has(key)))throw new Error('격리 검증 전에 접속·자격증명·원문 생성 환경변수를 제거하세요: '+name)
 }
}
export function deploymentSteps({python,report,pgBin,port=55609,integrationOnly=false}){
 if(!python||!report||!pgBin||!Number.isInteger(port)||port<49152||port>65535)throw new Error('격리 PostgreSQL 17 경로·보고서 경로·시험 포트를 확인하세요.')
 const env={PYTHON:python,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',WORKHUB_DEPLOYMENT_PG_BIN:pgBin,WORKHUB_DEPLOYMENT_TEST_PORT:String(port),WORKHUB_DEPLOYMENT_REPORT:join(report,'integrated'),P9_PG_BIN:pgBin,P9_TEST_PORT:String(port),P10_AI_PG_BIN:pgBin,P10_AI_PORT:String(port),K1_PG_BIN:pgBin,K1_TEST_PORT:String(port),M1_PG_BIN:pgBin,M1_TEST_PORT:String(port),T3_TEST_PORT:String(port),T4_TEST_PORT:String(port),T4_WITH_OPERATIONS:'1',P9_CAPTURE:join(report,'p9-captures.json'),P10_CAPTURE:join(report,'school-p10-captures.json'),T3_CAPTURE:join(report,'t3-captures.json'),T4_CAPTURE:join(report,'t4-captures.json'),WORKHUB_AI_SQL_REPORT:join(report,'ai-policy'),WORKHUB_AI_MEMORY_REPORT:join(report,'ai-memory')}
 const step=(name,command,args)=>({name,command,args,env})
 const node=(name,...args)=>step(name,process.execPath,args),py=(name,...args)=>step(name,python,args)
 const steps=[node('inventory','scripts/check-workhub-sql-package.mjs'),py('integrated','database/workhub-deployment/integration/test/run_integrated.py')]
 if(integrationOnly)return [...steps,node('inventory-after','scripts/check-workhub-sql-package.mjs')]
 return [...steps,
  py('school-roster','database/workhub-school-data/p9/test/run_p9.py'),node('school-roster-app','tests/test_workhub_school_roster.mjs'),
  py('school-data','database/workhub-school-data/p10/test/run_p10.py'),node('school-data-app','tests/test_workhub_school_data_maintenance.mjs'),
  py('timetable-interventions','database/workhub-timetable/t3/test/run_t3.py'),node('timetable-interventions-app','tests/integration/timetable-interventions-capture.mjs',env.T3_CAPTURE),
  py('timetable-import','database/workhub-timetable/t4/test/run_t4.py'),node('timetable-import-app','tests/test_workhub_timetable_import.mjs'),
  node('ai-policy','scripts/verify-workhub-ai-policy.mjs'),py('knowledge-history','database/workhub-knowledge-history/k1/test/run_k1.py'),node('ai-memory','scripts/verify-workhub-ai-memory.mjs'),node('inventory-after','scripts/check-workhub-sql-package.mjs')]
}
export function executeDeploymentSteps(steps,{cwd,report,environment=process.env,spawn=spawnSync}={}){
 assertIsolatedEnvironment(environment)
 for(const step of steps)assertIsolatedEnvironment({...environment,...step.env})
 mkdirSync(report,{recursive:true})
 const results=[]
 for(const step of steps){
  const started=Date.now()
  const result=spawn(step.command,step.args,{cwd,env:{...environment,...step.env},encoding:'utf-8',windowsHide:true,timeout:600000,maxBuffer:24000000})
  const output=(result.stdout||'')+(result.stderr||'')+(result.error?'\n'+result.error.message:'')
  writeFileSync(join(report,step.name+'.log'),output)
  if(output)process.stdout.write(output.endsWith('\n')?output:output+'\n')
  results.push({name:step.name,passed:result.status===0&&!result.error&&!result.signal,exitCode:result.status,signal:result.signal??null,durationMs:Date.now()-started})
  // 앞선 설치·대조 실패 뒤 성공한 나머지 결과로 실패를 가리지 않는다.
  if(!results.at(-1).passed)break
 }
 const summary={kind:'isolated_deployment_verification',passed:results.length===steps.length&&results.every(r=>r.passed),expectedSteps:steps.length,completedSteps:results.length,results,productionDbApplied:false,realMembersLinked:false,realProviderCalls:0}
 writeFileSync(join(report,'summary.json'),JSON.stringify(summary,null,2)+'\n')
 return summary
}
function main(){
 const args=process.argv.slice(2)
 if(args.some(arg=>arg!=='--integration-only')||args.length>1)throw new Error('지원 인자는 --integration-only뿐입니다. 운영 DSN이나 SQL 실행 옵션을 받지 않습니다.')
 const report=process.env.WORKHUB_DEPLOYMENT_REPORT?resolve(process.env.WORKHUB_DEPLOYMENT_REPORT):mkdtempSync(join(tmpdir(),'workhub-deployment-'))
 const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3'),pgBin=process.env.WORKHUB_DEPLOYMENT_PG_BIN||process.env.P9_PG_BIN
 const steps=deploymentSteps({python,report,pgBin,port:Number(process.env.WORKHUB_DEPLOYMENT_TEST_PORT||55609),integrationOnly:args.includes('--integration-only')})
 const result=executeDeploymentSteps(steps,{cwd:root,report})
 let sourceCommit=null,workingTreeClean=false
 try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();workingTreeClean=!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()}catch{/* 보고서의 Git 정보가 없으면 확인한 것으로 표시하지 않는다. */}
 writeFileSync(join(report,'summary.json'),JSON.stringify({...result,sourceCommit,workingTreeClean},null,2)+'\n')
 console.log('미적용 SQL 통합 검증 기록: '+report)
 if(!result.passed)process.exitCode=1
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main()
