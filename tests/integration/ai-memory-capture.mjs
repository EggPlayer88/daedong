// 격리 PG의 실제 응답을 현재 앱 parser에 대조한다. 운영·공급자를 호출하지 않는다.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../helpers/load-browser-module.mjs'
const path=process.argv[2];if(!path)throw new Error('격리 PG 개인 기억 캡처가 필요합니다.')
const api=await loadBrowserModule("export * from '../apps/workhub/src/assistant/memory-contracts.ts';")
let passed=0,rejected=0
const knownErrors=new Set(['NOT_READY','FORBIDDEN','INACTIVE_MEMBERSHIP','INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT'])
for(const {kind,raw,command,key,schoolId,memberId} of JSON.parse(readFileSync(path,'utf8'))){
 assert.equal(raw.contract,'memory.v1');assert.equal(raw.schoolId,schoolId);assert.equal(raw.memberId,memberId)
 if(raw.error){assert.deepEqual(Object.keys(raw).sort(),['contract','error','memberId','schoolId']);assert(knownErrors.has(raw.error.code));rejected++;continue}
 assert.deepEqual(Object.keys(raw).sort(),['contract','data','memberId','schoolId'])
 const scope={schoolId,id:memberId}
 if(kind==='list')api.memoryList(raw.data,scope)
 else if(kind==='select')api.memorySelection(raw.data,scope,command)
 else if(kind==='mutate')api.memoryReceipt(raw.data,command,key)
 else api.memoryResult(raw.data,command,key,kind==='recover')
 passed++
}
assert(passed>50);assert(rejected>10)
console.log(`개인 기억 실제 PG → 앱 parser ${passed}건 통과 · 업무 거절 ${rejected}건 확인`)
