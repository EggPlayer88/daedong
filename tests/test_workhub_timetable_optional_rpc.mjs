import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const api = await loadBrowserModule(`
export { createSupabaseConnection,rpcFailure } from '../apps/workhub/src/connection/supabase-connection'
export { createTimetableImportServer } from '../apps/workhub/src/timetable/import-server'
export { createTimetableInterventionsServer } from '../apps/workhub/src/timetable/interventions-server'
export { createTimetableTargetServer } from '../apps/workhub/src/timetable/target-server'
`)
const member={id:'member',schoolId:'school',userId:'user',name:'시험',role:'teacher',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const context={schools:[{id:'school',name:'학교'}],memberships:[member],basisDate:'2026-10-20',schoolLabels:{school:{departmentIds:[],gradeIds:[],subjectIds:[]}}}
let response={code:'PGRST202',message:'internal missing function',details:'hidden schema'},session='user',calls=0
const services={
 getSession:async()=>({user:{id:session}}),
 fetchMyProfile:async id=>({id,name:'시험',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}),
 onAuthStateChange:()=>()=>{},signInWithGoogle:async()=>{throw Error('사용 금지')},signOut:async()=>{throw Error('사용 금지')},
 rpc:async name=>{calls++;return name==='workhub_context'?{data:structuredClone(context),error:null}:{data:null,error:response}},
}
const connection=api.createSupabaseConnection(services);await connection.loadContext()
const methods=[
 ()=>api.createTimetableImportServer(connection).get('member'),
 ()=>api.createTimetableInterventionsServer(connection).resolve('member','request'),
 ()=>api.createTimetableInterventionsServer(connection).summary('member'),
 ()=>api.createTimetableTargetServer(connection).get('member'),
]
let count=0
async function test(name,fn){await fn();count++;console.log('  ✓ '+name)}
await test('기존 공용 오류 코드와 원문 비노출을 유지하며 함수부재 코드만 보존',()=>{
 const e=api.rpcFailure(response);assert.equal(e.code,'QUERY_FAILED');assert.equal(e.rpcCode,'PGRST202');assert.ok(!e.message.includes('hidden'))
 const network=api.rpcFailure({code:'08006',message:'connection detail'});assert.equal(network.code,'QUERY_FAILED');assert.equal(network.rpcCode,undefined)
})
await test('실제 connection→모듈 어댑터에서 미설치 RPC만 준비 중으로 구분',async()=>{
 for(const run of methods)await assert.rejects(run,e=>e.code==='NOT_READY')
})
await test('통신 실패는 준비 중으로 숨기지 않고 조회 실패로 남김',async()=>{
 response={code:'08006',message:'connection lost'}
 for(const run of methods)await assert.rejects(run,e=>e.code==='QUERY_FAILED')
})
await test('권한 거절은 기존 연결을 무효화하며 준비 중 예외로 우회하지 않음',async()=>{
 response={code:'P0001',message:'FORBIDDEN'}
 assert.equal(api.rpcFailure(response).code,'FORBIDDEN')
 await assert.rejects(methods[0],e=>e.code==='CANCELLED')
 assert.equal(connection.info().memberships.length,0)
})
await test('계정 변경은 RPC 이전에 차단하여 미설치 예외로 우회하지 않음',async()=>{
 session='user';await connection.loadContext();session='other'
 const before=calls;await assert.rejects(methods[0],e=>['CANCELLED','INACTIVE_MEMBERSHIP'].includes(e.code));assert.equal(calls,before)
})
console.log(`선택 모듈 실제 연결 오류 분리 ${count}개 통과`)
