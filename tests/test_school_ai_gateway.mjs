import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encryptSchoolKey,decryptSchoolKey,hashAiPayload,executeSchoolAi } from '../apps/main/api/_ai-policy/gateway.mjs'
import { createDocAiHandler } from '../apps/main/api/doc-ai/chat.js'
const routing=JSON.parse(readFileSync(new URL('../apps/main/api/workhub-ai/_assets/model-routing.json',import.meta.url)))
const env={VITE_SUPABASE_URL:'https://synthetic.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key',WORKHUB_AI_ACTIVE_KEY_ID:'test-v1',WORKHUB_AI_KEY_ENCRYPTION_KEYS:JSON.stringify({'test-v1':Buffer.alloc(32,7).toString('base64')})}
const secret='sk-ant-synthetic-key-never-a-live-key',schoolId='school-one',actorUserId='user-one',credentialVersion=1
let passed=0
async function test(name,fn){await fn();passed++;console.log('  ✓ '+name)}
const encrypted=encryptSchoolKey({schoolId,credentialVersion,apiKey:secret},env)
function harness(options={}){
 const calls=[],ledger=new Map();let attempts=0,clock=0
 const envelope=(args,data)=>({contract:'ai-gateway.v1',schoolId:options.wrongSchool??schoolId,actorUserId:args.p_actor_user_id,feature:args.p_feature,requestKey:args.p_request_key,data})
 const result=body=>({ok:true,json:async()=>structuredClone(body)})
 const fetcher=async(url,init)=>{
  const body=JSON.parse(init.body);calls.push({url,body,headers:init.headers});clock+=options.elapsed?.[url.split('/').at(-1)]??0
  if(url.includes('/count_tokens')){if(options.countFail)throw Error('count failed');return result({input_tokens:options.count??1000})}
  if(url==='https://api.anthropic.com/v1/messages'){
   attempts++;if(options.providerFail)throw Error('provider unknown')
   return result({id:options.missingId?null:'msg-synthetic',model:options.wrongModel?'wrong-model':body.model,content:[{type:'thinking',thinking:'private reasoning never store'},{type:'text',text:'확인된 답변'}],stop_reason:'end_turn',usage:{input_tokens:options.actualInput??1000,output_tokens:options.badUsage?9000:200,cache_creation_input_tokens:0,cache_read_input_tokens:0}})
  }
  const action=url.split('_').at(-1),key=body.p_request_key,prior=ledger.get(key)
  if(action==='prepare'){
   if(options.denied)return result({...envelope(body,null),error:{code:'BUDGET_EXCEEDED'}})
   if(prior){if(prior.data?.state==='closed')return result(envelope(body,prior.data));if(prior.hash!==body.p_payload_sha256||prior.quality!==body.p_quality)return result({...envelope(body,null),error:{code:'IDEMPOTENCY_CONFLICT'}});return result(envelope(body,prior.data??{state:'pending'}))}
   const entry={hash:body.p_payload_sha256,quality:body.p_quality,started:false};ledger.set(key,entry)
   const model=routing.models[body.p_quality],reservedMicroUsd=Math.ceil((routing.reserveInputTokens*model.inputMicroUsdPerMtok+routing.maxOutputTokens*model.outputMicroUsdPerMtok)/1000000)
   return result(envelope(body,{state:'claimed',leaseToken:'lease-one',policy:{version:1,model:model.id,maxInputTokens:80000,maxOutputTokens:8000,reservedMicroUsd:options.underReserve?12000:reservedMicroUsd},credential:{version:1,...encrypted}}))
  }
  if(action==='recover'){if(!prior)return result(envelope(body,{state:'missing'}));if(prior.hash!==body.p_payload_sha256)return result({...envelope(body,null),error:{code:'IDEMPOTENCY_CONFLICT'}});return result(envelope(body,prior.data??{state:'pending'}))}
  if(action==='start'){const started=!prior.started&&!options.startDenied;prior.started=true;return result(envelope(body,{started}))}
  if(action==='release'){if(body.p_lease_token===null){if(prior?.data?.state==='completed')return result(envelope(body,prior.data));if(prior?.started)return result(envelope(body,{state:'pending'}));const data={state:'closed',code:'CANCELLED'};ledger.set(key,{...prior,data});return result(envelope(body,data))}prior.data={state:'failed',code:body.p_reason};return result(envelope(body,prior.data))}
  if(action==='finish'){
   if(body.p_result.state==='provider_unknown'){prior.data??={state:'pending'};return result(envelope(body,prior.data))}
   prior.data={state:'completed',response:body.p_result.response,usage:body.p_result.usage,quality:prior.quality,model:routing.models[prior.quality].id}
   if(options.finishLost){options.finishLost=false;throw Error('commit response lost')}
   return result(envelope(body,prior.data))
  }
  throw Error('unexpected '+url)
 }
 const request={actorUserId,requestKey:'request-one',quality:'quick',payload:{messages:[{role:'user',content:'질문'}]},buildProviderBody:({model,maxOutputTokens,effort})=>({model,max_tokens:maxOutputTokens,system:'확인된 지침',messages:[{role:'user',content:'질문'}],thinking:{type:'disabled'},output_config:{effort}}),transformResponse:raw=>({reply:raw.text,stop_reason:raw.stop_reason,truncated:false,usage:raw.usage})}
 return{calls,ledger,request,run:patch=>executeSchoolAi({...request,...patch},{env,fetcher,now:()=>clock,deadlineAt:options.deadlineAt}),attempts:()=>attempts}
}
await test('학교·키 판에 묶은 AES-GCM은 원문을 복구하고 평문을 봉투에 노출하지 않는다',()=>{assert.equal(decryptSchoolKey({schoolId,credentialVersion,envelope:encrypted},env),secret);assert.ok(!JSON.stringify(encrypted).includes(secret));assert.notEqual(encryptSchoolKey({schoolId,credentialVersion,apiKey:secret},env).iv,encrypted.iv)})
for(const kind of ['school','version','tag','iv','key'])await test('AES 암호문 범위·인증 훼손을 거절한다: '+kind,()=>{const value={...encrypted};if(kind==='tag')value.tag=Buffer.alloc(16).toString('base64');if(kind==='iv')value.iv='bad';if(kind==='key')value.keyId='missing';assert.throws(()=>decryptSchoolKey({schoolId:kind==='school'?'school-other':schoolId,credentialVersion:kind==='version'?2:1,envelope:value},env),/KEY_UNAVAILABLE/)})
await test('같은 구조의 요청 hash는 key순서에 독립적이며 다른 내용은 다르다',()=>{assert.equal(hashAiPayload({b:1,a:[2]}),hashAiPayload({a:[2],b:1}));assert.notEqual(hashAiPayload({a:2}),hashAiPayload({a:3}));assert.throws(()=>hashAiPayload({bad:undefined}))})
await test('기본 Haiku는 예약→토큰 확인→시작권→생성→정산으로 한 번 호출한다',async()=>{const h=harness(),out=await h.run();assert.equal(out.reply,'확인된 답변');assert.equal(h.attempts(),1);assert.deepEqual(h.calls.map(c=>c.url.split('/').at(-1)),['workhub_ai_gateway_prepare','count_tokens','workhub_ai_gateway_start','messages','workhub_ai_gateway_finish']);assert.equal(h.calls[3].body.model,routing.models.quick.id);assert.equal(h.calls[3].body.max_tokens,8000);assert.ok(!JSON.stringify(h.calls[3].body).includes('cache_control'));assert.ok(!JSON.stringify(h.calls.at(-1).body).includes('private reasoning'))})
await test('정밀 검토는 명시한 Sonnet을 사용하고 클라이언트 모델을 받지 않는다',async()=>{const h=harness();await h.run({quality:'review'});assert.equal(h.calls.find(c=>c.url.endsWith('/messages')).body.model,routing.models.review.id)})
await test('토큰 사전검사는 실제 생성과 같은 thinking·output_config를 사용한다',async()=>{const h=harness();await h.run({quality:'review'});const count=h.calls.find(c=>c.url.endsWith('count_tokens')).body,generate=h.calls.find(c=>c.url.endsWith('/messages')).body;assert.deepEqual(count.thinking,generate.thinking);assert.deepEqual(count.output_config,generate.output_config)})
await test('응답 모델이 승인한 모델과 다르면 자동정산 없이 결과미상으로 보존한다',async()=>{const h=harness({wrongModel:true});assert.equal((await h.run()).state,'pending');assert.equal(h.calls.at(-1).body.p_result.state,'provider_unknown');assert.equal(h.calls.some(c=>c.url.endsWith('_release')),false)})
await test('인증에서 쓴 시간까지 합쳐50초가 지나면 예약·공급자호출을 하지 않는다',async()=>{const h=harness({deadlineAt:0});await assert.rejects(h.run(),/GATEWAY_UNAVAILABLE/);assert.equal(h.calls.length,0);assert.equal(h.attempts(),0)})
await test('시작전 남은시간이 부족하면 예약을 해제하고 생성하지 않는다',async()=>{for(const elapsed of [{workhub_ai_gateway_prepare:35000},{count_tokens:41000}]){const h=harness({elapsed});assert.equal((await h.run()).code,'CANCELLED');assert.equal(h.attempts(),0);assert.equal(h.calls.some(c=>c.url.endsWith('_start')),false)}})
await test('시작권뒤 남은시간이 부족하면 공급자호출 없이 결과미상 기록만 남긴다',async()=>{const h=harness({elapsed:{workhub_ai_gateway_start:43000}});assert.equal((await h.run()).state,'pending');assert.equal(h.attempts(),0);assert.equal(h.calls.at(-1).body.p_result.state,'provider_unknown');assert.equal(h.calls.some(c=>c.url.endsWith('_release')),false)})
await test('완료 재전송·recover는 원응답만 돌려주며 다른내용 재사용은 거절한다',async()=>{const h=harness(),first=await h.run();assert.deepEqual(await h.run(),first);assert.deepEqual(await h.run({recoverOnly:true}),first);assert.equal(h.attempts(),1);await assert.rejects(h.run({payload:{messages:[{role:'user',content:'다른 질문'}]}}),/IDEMPOTENCY_CONFLICT/)})
await test('결과미상은 예약을 보존하고 같은 키 요청도 재생성하지 않는다',async()=>{const h=harness({providerFail:true});assert.equal((await h.run()).state,'pending');assert.equal((await h.run()).state,'pending');assert.equal((await h.run({recoverOnly:true})).state,'pending');assert.equal(h.attempts(),1);assert.equal(h.calls.filter(c=>c.url.endsWith('_release')).length,0)})
await test('정산 응답 유실 뒤 복구는 이미 저장한 응답을 돌려주고 재과금하지 않는다',async()=>{const h=harness({finishLost:true});assert.equal((await h.run()).state,'pending');assert.equal((await h.run({recoverOnly:true})).state,'completed');assert.equal(h.attempts(),1)})
for(const [options,code]of[[{countFail:true},'COUNT_FAILED'],[{count:80001},'INPUT_TOO_LARGE']])await test('생성 전 실패는 원장 해제 뒤 유료 생성0: '+code,async()=>{const h=harness(options),out=await h.run();assert.equal(out.state,'failed');assert.equal(out.code,code);assert.equal(h.attempts(),0);assert.equal(h.calls.filter(c=>c.url.endsWith('_start')).length,0)})
await test('예산 거절과 시작권 없는 요청은 공급자 생성0',async()=>{const h=harness({denied:true});await assert.rejects(h.run(),/BUDGET_EXCEEDED/);assert.equal(h.calls.length,1);const second=harness({startDenied:true});assert.equal((await second.run()).state,'pending');assert.equal(second.attempts(),0)})
for(const options of [{missingId:true},{badUsage:true}])await test('공급자 식별자·사용량이 불명확하면 성공으로 정산하지 않는다 '+JSON.stringify(options),async()=>{const h=harness(options);assert.equal((await h.run()).state,'pending');assert.equal(h.calls.filter(c=>c.url.endsWith('_release')).length,0)})
await test('미접수 복구는 예약·토큰계수·유료 호출을 만들지 않는다',async()=>{const h=harness();assert.equal((await h.run({recoverOnly:true})).state,'missing');assert.equal(h.calls.length,1)})
await test('캐시·강제tool요청은 생성 전 중지한다',async()=>{for(const extra of [{tool_choice:{type:'any'}},{system:[{type:'text',text:'hello',cache_control:{type:'ephemeral'}}]}]){const h=harness();const original=h.request.buildProviderBody;const out=await h.run({buildProviderBody:args=>({...original(args),...extra})});assert.equal(out.code,'CANCELLED');assert.equal(h.attempts(),0)}})
await test('토큰 추정 오차 여유를 전액 예약하지 않았으면 유료 생성을 시작하지 않는다',async()=>{const h=harness({underReserve:true});assert.equal((await h.run()).code,'CANCELLED');assert.equal(h.attempts(),0);assert.equal(h.calls.some(c=>c.url.endsWith('count_tokens')),false)})
await test('실제입력이 count추정치를 넘어도 사전예약한100k 범위 안에서만 정산한다',async()=>{const h=harness({actualInput:90000});assert.equal((await h.run()).state,'completed');assert.equal(h.calls.at(-1).body.p_result.usage.inputTokens,90000);const exceeded=harness({actualInput:100001});assert.equal((await exceeded.run()).state,'pending');assert.equal(exceeded.calls.some(c=>c.url.endsWith('_release')),false)})
await test('예약범위 초과는 알려진사용량을 남기고 자동정산·해제를 하지 않는다',async()=>{const h=harness({actualInput:100001});await h.run();assert.deepEqual(h.calls.at(-1).body.p_result,{state:'provider_unknown',observedUsage:{inputTokens:100001,outputTokens:200}})})
await test('미접수닫기 장벽 뒤 늦은원요청은 유료실행되지 않는다',async()=>{const h=harness();assert.equal((await h.run({cancelOnly:true})).state,'closed');assert.equal((await h.run()).state,'closed');assert.equal(h.attempts(),0)})
await test('이미시작한요청 닫기는 unknown 유지하고 이미완료한요청은원접수증반환',async()=>{const h=harness({providerFail:true});await h.run();assert.equal((await h.run({cancelOnly:true})).state,'pending');assert.equal(h.attempts(),1);const good=harness();const first=await good.run();assert.deepEqual(await good.run({cancelOnly:true}),first);assert.equal(good.attempts(),1)})
const oldFetch=globalThis.fetch,oldEnv={url:process.env.VITE_SUPABASE_URL,anon:process.env.VITE_SUPABASE_ANON_KEY};process.env.VITE_SUPABASE_URL='https://synthetic.invalid';process.env.VITE_SUPABASE_ANON_KEY='anon'
try{
 let active=true,calls=[];globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('/auth/')?{id:actorUserId}:[{is_active:active}]})
 const handler=createDocAiHandler(async request=>{calls.push(request);return{state:'completed',requestKey:request.requestKey,...request.transformResponse({text:'평가 안내',stop_reason:'end_turn',usage:{input_tokens:12,output_tokens:5}})}})
 const response=()=>({status(code){this.code=code;return this},json(body){this.body=body;return this},setHeader(){}})
 const req={method:'POST',headers:{authorization:'Bearer synthetic'},body:{messages:[{role:'user',content:'평가 계획'}],requestKey:'evaluation-key',quality:'quick'}}
 await test('평가계획 기존 승인 게이트는 공통 gateway보다 먼저 막는다',async()=>{active=false;const res=response();await handler(req,res);assert.equal(res.code,403);assert.equal(res.body.error,'PENDING_APPROVAL');assert.equal(calls.length,0);active=true})
 await test('평가계획은 검증된 사용자만 전달하고 기존 최종응답·캐시OFF를 유지한다',async()=>{const res=response();await handler({...req,body:{...req.body,actorUserId:'forged',schoolId:'forged'}},res);assert.equal(res.code,200);assert.equal(calls[0].actorUserId,actorUserId);assert.equal(calls[0].feature,'evaluation');assert.equal(calls[0].payload.messages[0].content,'평가 계획');const body=calls[0].buildProviderBody({model:routing.models.quick.id,maxOutputTokens:8000,effort:'low'});assert.ok(!JSON.stringify(body).includes('cache_control'));assert.equal(res.body.reply,'평가 안내')})
 await test('평가계획 기본·정밀 모두5.5에서 지원하는 adaptive만 보내고 thinking원문은화면응답에넣지않는다',()=>{for(const model of Object.values(routing.models)){const body=calls[0].buildProviderBody({model:model.id,maxOutputTokens:8000,effort:model.effort});assert.deepEqual(body.thinking,{type:'adaptive'});assert.equal(body.max_tokens,8000);assert.equal(body.tool_choice,undefined)}assert.equal(calls[0].transformResponse({text:'검토내용',stop_reason:'end_turn',usage:{input_tokens:5,output_tokens:8}}).thinking,undefined)})
 await test('요청 번호가 없는 구버전 요청은 유료 호출 전에 안내한다',async()=>{const res=response();await handler({...req,body:{messages:req.body.messages}},res);assert.equal(res.code,400);assert.equal(calls.length,1)})
}finally{globalThis.fetch=oldFetch;if(oldEnv.url===undefined)delete process.env.VITE_SUPABASE_URL;else process.env.VITE_SUPABASE_URL=oldEnv.url;if(oldEnv.anon===undefined)delete process.env.VITE_SUPABASE_ANON_KEY;else process.env.VITE_SUPABASE_ANON_KEY=oldEnv.anon}
console.log('학교 공통 AI Node gateway '+passed+'건 통과')
