// PG 시험에서 저장한 evaluation 봉투를 실제 Node 게이트웨이로 대조한다. 외부 통신은 없다.
// claimed의 DB 시험용 가짜 암호문만 같은 학교·판의 유효한 합성 암호문으로 바꾼다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { executeSchoolAi, encryptSchoolKey } from '../apps/main/api/_ai-policy/gateway.mjs'
const filename = process.argv[2]
if (!filename) throw Error('PG captures.json 경로가 필요합니다.')
const rows = JSON.parse(readFileSync(filename, 'utf8')).filter(row => row.rpc?.startsWith('workhub_ai_gateway_') && row.raw?.feature === 'evaluation')
const env = {VITE_SUPABASE_URL:'https://captured.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',WORKHUB_AI_ACTIVE_KEY_ID:'capture-test',WORKHUB_AI_KEY_ENCRYPTION_KEYS:JSON.stringify({'capture-test':Buffer.alloc(32,17).toString('base64')})}
const response = value => ({ok:true,json:async()=>structuredClone(value)})
let passed = 0, claimed = 0, starts = 0
for (const row of rows) {
  const raw = structuredClone(row.raw), quality = raw.data?.quality ?? raw.data?.execution?.quality ?? (row.rpc.endsWith('_prepare') ? row.args[5] : 'quick')
  const request = {actorUserId:raw.actorUserId,requestKey:raw.requestKey,quality,payload:{messages:[{role:'user',content:'PG 봉투 대조'}]},buildProviderBody:({model,maxOutputTokens})=>({model,max_tokens:maxOutputTokens,messages:[{role:'user',content:'합성 질문'}]}),transformResponse:()=>({reply:'합성 응답',stop_reason:'end_turn'})}
  let first = true, generated = 0
  const fetcher = async (url, init) => {
    assert.ok(url.startsWith('https://captured.invalid/') || url === 'https://api.anthropic.com/v1/messages/count_tokens')
    if (url.endsWith('count_tokens')) return response({input_tokens:120})
    if (first) { first = false; return response(raw) }
    const args = JSON.parse(init.body)
    assert.equal(args.p_actor_user_id, raw.actorUserId); assert.equal(args.p_request_key, raw.requestKey)
    const envelope = data => ({contract:raw.contract,actorUserId:raw.actorUserId,schoolId:raw.schoolId,feature:raw.feature,requestKey:raw.requestKey,data})
    if (url.endsWith('_start')) return response(envelope({started:false}))
    generated++; throw Error('허용하지 않은 후속 호출')
  }
  if (raw.data?.state === 'claimed') {
    const version = raw.data.credential.version
    raw.data.credential = {version,...encryptSchoolKey({schoolId:raw.schoolId,credentialVersion:version,apiKey:'synthetic-evaluation-capture-key'},env)}
    assert.equal((await executeSchoolAi(request,{env,fetcher})).state,'pending')
    claimed++
  } else if (raw.data && Object.hasOwn(raw.data,'started')) {
    // start는 순수 수신 필드가 두 가지뿐이다. 실제 SQL 시작권 봉투를 별도로 검증한다.
    assert.deepEqual(Object.keys(raw.data),['started']); assert.equal(typeof raw.data.started,'boolean'); starts++
  } else if (raw.error) {
    await assert.rejects(executeSchoolAi({...request,recoverOnly:true},{env,fetcher}),error=>error.code===raw.error.code)
  } else {
    const result = await executeSchoolAi({...request,recoverOnly:true},{env,fetcher})
    const expected = raw.data.state === 'provider_unknown' ? 'pending' : raw.data.state === 'rejected' ? 'failed' : raw.data.state
    assert.equal(result.state,expected); assert.equal(result.requestKey,raw.requestKey)
    if (raw.data.state === 'completed') for (const key of Object.keys(raw.data.response)) assert.deepEqual(result[key],raw.data.response[key])
  }
  assert.equal(generated,0)
  passed++
}
assert.ok(passed > 0)
console.log(`PG evaluation 봉투 ${passed}건 대조 통과 (claimed 합성 키 대체 ${claimed}, start 필드 대조 ${starts}, 외부 호출 0)`)
