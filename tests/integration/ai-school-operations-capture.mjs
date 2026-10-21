import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../helpers/load-browser-module.mjs'
const path=process.argv[2];if(!path)throw new Error('격리 PG 운영 조회 캡처가 필요합니다.')
const api=await loadBrowserModule("export * from '../apps/workhub/src/assistant/school-operations-contracts.ts';")
let passed=0,errors=0,internal=0
for(const {rpc,args,raw}of JSON.parse(readFileSync(path,'utf8'))){
 if(raw.error){errors++;continue}
 if(rpc!=='workhub_ai_school_operations'){internal++;continue}
 api.schoolAiOperations(raw,{schoolId:raw.schoolId,memberId:args[1]},args[2]??null);passed++
}
assert(passed>0);console.log('학교 AI 운영 실제 PG → 앱 parser '+passed+'건 통과 · 업무거절 '+errors+' / 내부전용 '+internal+' 제외')

