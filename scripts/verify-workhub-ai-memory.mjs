// 운영 DSN·공급자 없이 격리 PG17 → 앱 memory.v1 계약을 검증한다.
import {spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const report=process.env.WORKHUB_AI_MEMORY_REPORT?resolve(process.env.WORKHUB_AI_MEMORY_REPORT):mkdtempSync(join(tmpdir(),'workhub-ai-memory-report-'))
mkdirSync(report,{recursive:true})
const capture=join(report,'captures.json')
const env={...process.env,M1_CAPTURE:capture,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3')
const cases=[['postgres',python,['database/workhub-ai-memory/m1/test/run_m1.py']],['app',process.execPath,['tests/integration/ai-memory-capture.mjs',capture]]]
const results=[]
for(const [name,command,args] of cases){
 const started=Date.now(),result=spawnSync(command,args,{cwd:root,env,encoding:'utf-8',windowsHide:true,timeout:240000,maxBuffer:10000000})
 const output=(result.stdout||'')+(result.stderr||'');process.stdout.write(output);writeFileSync(join(report,name+'.log'),output)
 results.push({name,exitCode:result.status,passed:result.status===0,durationMs:Date.now()-started})
 if(result.status!==0)break
}
writeFileSync(join(report,'summary.json'),JSON.stringify({results,realProviderCalls:0,productionDbApplied:false},null,2))
console.log('개인 기억 SQL 검증 기록: '+report)
if(results.length!==cases.length||results.some(r=>!r.passed))process.exitCode=1
