// 전체 증분을 같은 격리 DB에 올린 실제 응답을 현재 앱 parser에 대조한다.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../../../../tests/helpers/load-browser-module.mjs'
const api=await loadBrowserModule("export * as memory from '../apps/workhub/src/assistant/memory-contracts';export * as knowledge from '../apps/workhub/src/knowledge/contracts';export * as ai from '../apps/workhub/src/assistant/school-settings-contracts';")
const rows=JSON.parse(readFileSync(process.argv[2],'utf8'));let accepted=0,rejected=0
assert(rows.length>20)
for(const row of rows){
 const {module,kind,raw,command,key,schoolId,memberId}=row
 const scope={schoolId,id:memberId}
 if(module==='ai-status'){api.ai.schoolAiStatus(raw,{schoolId,memberId});accepted++;continue}
 assert.equal(raw.contract,module==='memory'?'memory.v1':'knowledge.v1');assert.equal(raw.schoolId,schoolId);assert.equal(raw.memberId,memberId)
 if(raw.error){assert.deepEqual(Object.keys(raw).sort(),['contract','error','memberId','schoolId']);assert(['NOT_READY','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT'].includes(raw.error.code));rejected++;continue}
 assert.deepEqual(Object.keys(raw).sort(),['contract','data','memberId','schoolId'])
 if(module==='memory'){
  if(kind==='list')api.memory.memoryList(raw.data,scope)
  else if(kind==='select')api.memory.memorySelection(raw.data,scope,command)
  else if(kind==='mutate')api.memory.memoryReceipt(raw.data,command,key)
  else api.memory.memoryResult(raw.data,command,key,kind==='recover')
 }else if(kind==='get')api.knowledge.knowledgeRevision(raw.data,scope,row.sourceId,row.number)
 else api.knowledge.knowledgeHistory(raw.data,scope,row.sourceId,row.number)
 accepted++
}
assert(accepted>15);assert(rejected>=5)
console.log('통합 실제 RPC → 앱 parser '+accepted+'건, 예상 업무 거절 '+rejected+'건, 합계 '+rows.length+'건 통과')
