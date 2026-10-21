import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../helpers/load-browser-module.mjs'
const path=process.argv[2]??process.env.P10_AI_CAPTURE;if(!path)throw new Error('실제 SQL 응답 캡처 JSON 경로가 필요합니다.')
const api=await loadBrowserModule(`export * from '../apps/workhub/src/assistant/contracts.ts';export * from '../apps/workhub/src/assistant/school-settings-contracts.ts';`)
const capture=JSON.parse(readFileSync(path,'utf8'));assert(Array.isArray(capture));let passed=0,skipped=0;const versions=new Map()
for(const {rpc,args,raw} of capture){
 if(rpc==='workhub_ai_school_key_save'||rpc==='workhub_ai_school_key_close')versions.set(JSON.stringify(args.slice(0,3)),args[3])
 if(raw?.error){skipped++;continue}
 const scope={schoolId:raw.schoolId,memberId:args[1]}
 if(rpc==='workhub_ai_school_status'){api.schoolAiStatus(raw,scope);passed++}
 else if(['workhub_ai_school_key_save','workhub_ai_school_key_recover','workhub_ai_school_key_close'].includes(rpc)){
  const version=versions.get(JSON.stringify(args.slice(0,3)));if(version===undefined){skipped++;continue}
  api.schoolAiReceipt(raw,scope,{expectedCredentialVersion:version},args[2]);passed++
 }else if(rpc==='workhub_ai_policy_thread_get'){api.assistantThread(api.assistantEnvelope(raw,{schoolId:raw.schoolId,memberId:args[0]}));passed++}
 else if(rpc==='workhub_ai_policy_threads_list'){api.threadList(api.assistantEnvelope(raw,{schoolId:raw.schoolId,memberId:args[0]}),args[1]);passed++}
 else if(rpc.startsWith('workhub_ai_gateway_')&&raw?.data?.state==='completed'&&raw?.feature==='assistant'){
  api.askResult(raw.data.response,raw.requestKey);passed++
 }else skipped++
}
assert(passed>0);console.log(`학교 AI SQL 실제응답 앱 parser ${passed}/${passed} 통과 · 범위 밖/예상 DB 오류 ${skipped}건 제외`)
