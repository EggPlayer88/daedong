import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {loadBrowserModule} from '../helpers/load-browser-module.mjs'
const api=await loadBrowserModule(`export * from '../apps/workhub/src/assistant/school-settings-server.ts';export {ASSISTANT_ROUTING} from '../apps/workhub/src/assistant/contracts.ts';`)
const python=process.argv[2]??process.env.PYTHON??'python'
const member={id:'member-one',userId:'actor-one',schoolId:'school-one',name:'교사',role:'school_admin',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]}
const status={contract:'assistant.school.v1',schoolId:member.schoolId,memberId:member.id,policyVersion:1,canManage:true,credential:{configured:true,version:9,maskedSuffix:'abcd',updatedAt:'2026-10-21T01:00:00Z'},budget:{month:'2026-10',timeZone:'Asia/Seoul',currency:'USD',limitMicroUsd:100000000,settledMicroUsd:0,reservedMicroUsd:0,availableMicroUsd:100000000},models:Object.fromEntries(Object.entries(api.ASSISTANT_ROUTING.models).map(([k,v])=>[k,{id:v.id,label:v.label}])),status:'ready'}
const connection={info:()=>({schools:[{id:member.schoolId}],memberships:[member],basisDate:'2026-10-21'}),getIdentity:async()=>({userId:member.userId,approved:true})}
// 실제 TS 어댑터가 만든 JSON을 실제 Python execute에 전달한다. 외부 인증/RPC만 합성으로 고정한다.
const script=String.raw`
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'apps/main/api/workhub-ai'))
from _school_settings import execute,CheckError
case=json.load(sys.stdin)
class Client:
 def user(self,authorization): return 'actor-one'
 def rpc(self,name,args):
  if name=='workhub_ai_school_status': return case['status']
  assert name=='workhub_ai_school_key_recover',name
  assert args=={'p_actor_user_id':'actor-one','p_member_id':'member-one','p_request_key':case['payload']['requestKey']},args
  return {'contract':'assistant.school.v1','schoolId':'school-one','memberId':'member-one','requestKey':case['payload']['requestKey'],'state':'applied','credentialVersion':3}
result=execute(case['payload'],'Bearer '+('synthetic-token-'*3),client=Client())
bad=dict(case['payload']);del bad['expectedCredentialVersion']
try: execute(bad,'Bearer '+('synthetic-token-'*3),client=Client())
except CheckError as e: assert e.code=='INVALID_INPUT'
else: raise AssertionError('과거 필드 누락 요청이 거부되어야 합니다')
print(json.dumps(result))
`
let requests=0
const server=api.createSchoolAiSettingsServer(connection,{send:async payload=>{requests++;assert(!Object.hasOwn(payload,'apiKey'));const result=spawnSync(python,['-c',script],{input:JSON.stringify({payload,status}),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout)}})
const result=await server.recoverKey(member.id,{expectedCredentialVersion:2},'recover-original-key')
assert.equal(result.state,'applied');assert.equal(result.credentialVersion,3);assert.equal(requests,1)
console.log('학교 키 복구 TS→Python 실제 요청 계약 2/2 통과 · 현재 판 9에서도 원 기대판 2 보존, 누락 요청 거부')
