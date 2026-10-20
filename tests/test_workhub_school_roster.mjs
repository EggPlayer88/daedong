import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const api=await loadBrowserModule(`
export * from '../apps/workhub/src/setup/school-roster-contracts.ts'
export * from '../apps/workhub/src/setup/school-roster-server.ts'
`)
const uid='00000000-0000-0000-0000-000000000002'
const member={id:'member-one',schoolId:'school-one',userId:'user-one',name:'관리자',role:'school_admin',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const intent=()=>({expectedVersion:1,targetUserIds:[uid],startsOn:'2026-03-01',lastDay:null,reason:'기존 회원 확인'})
const preview=()=>({previewId:'preview-one',fingerprint:'a'.repeat(64),expiresAt:'2026-10-20T00:30:00Z',intent:intent(),allowed:true,items:[{legacyUserId:uid,name:'교사',outcome:'link',memberId:null}]})
const command=()=>({previewId:'preview-one',fingerprint:'a'.repeat(64),intent:intent()})
const receipt=()=>({requestKey:'request-one',version:2,recordedAt:'2026-10-20T00:00:00Z',items:[{legacyUserId:uid,memberId:'linked-member',outcome:'linked'}]})
const snapshot=()=>({available:true,reason:null,version:1,asOfDate:'2026-10-20',candidates:[{legacyUserId:uid,name:'교사',memberId:null,state:'unlinked'}],teachers:[]})
const envelope=data=>({contract:'school-roster.v1',schoolId:member.schoolId,memberId:member.id,data})
function fixture(run,timeoutMs=50) {
 let current=structuredClone(member),identity={userId:member.userId,approved:true,profile:{id:member.userId,role:'superadmin',is_active:true,department_id:null,extra_permissions:[]}}
 const calls=[]
 const connection={info:()=>({memberships:[current],schools:[{id:current.schoolId}],basisDate:'2026-10-20'}),getIdentity:async()=>structuredClone(identity),rpcVerified:async(name,args)=>{calls.push({name,args:structuredClone(args)});return run?run(name,args):envelope(name.endsWith('_get')?snapshot():name.endsWith('_preview')?preview():name.endsWith('_close')?{requestKey:'request-one',outcome:'applied',receipt:receipt()}:receipt())}}
 return {server:api.createSchoolRosterServer(connection,{timeoutMs}),calls,connection,setMember:x=>{current=x},setIdentity:x=>{identity=x}}
}
let passed=0
async function test(name,fn){await fn();passed++;console.log('  ✓',name)}
const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>e.code===code)
await test('서버가 확인한 후보·소속·이름을 읽음',()=>assert.deepEqual(api.schoolRosterSnapshot(snapshot()),snapshot()))
await test('비활성 서버는 실명 후보를 보내지 못함',()=>assert.throws(()=>api.schoolRosterSnapshot({...snapshot(),available:false,reason:'not_configured'})))
await test('중복 후보 UID와 교사 ID 거부',()=>{
 const s=snapshot();s.candidates.push(s.candidates[0]);assert.throws(()=>api.schoolRosterSnapshot(s))
 assert.throws(()=>api.schoolRosterSnapshot({...snapshot(),teachers:[{id:'m',label:'a'},{id:'m',label:'a'}]}))
})
await test('이름이 같은 회원도 UID로 구별',()=>{
 const s=snapshot();s.candidates.push({...s.candidates[0],legacyUserId:'00000000-0000-0000-0000-000000000003'});assert.equal(api.schoolRosterSnapshot(s).candidates.length,2)
})
await test('이메일·이름·임시교사 ID를 UID로 쓰지 않음',()=>{
 for(const value of ['teacher@school.kr','동명이인','virtual-teacher',null])assert.throws(()=>api.schoolRosterIntent({...intent(),targetUserIds:[value]}),e=>e.code==='INVALID_INPUT')
})
await test('새 입력 오류는 INVALID_INPUT, 서버 호출 0',async()=>{
 const f=fixture();await rejects(()=>f.server.preview(member.id,{...intent(),startsOn:'2026-02-30'}),'INVALID_INPUT');assert.equal(f.calls.length,0)
})
await test('소속 날짜와 대상 개수·중복·문자 한도 검증',()=>{
 for(const patch of [{targetUserIds:[]},{targetUserIds:[uid,uid]},{startsOn:'2019-01-01'},{lastDay:'2026-02-28'},{reason:'x'.repeat(201)},{reason:'\u0085'}])assert.throws(()=>api.schoolRosterIntent({...intent(),...patch}))
})
await test('선택 UID 정렬과 원문 불변',()=>{
 const input={...intent(),targetUserIds:['ffffffff-ffff-ffff-ffff-ffffffffffff',uid]},copy=structuredClone(input)
 assert.equal(api.schoolRosterIntent(input).targetUserIds[0],uid);assert.deepEqual(input,copy)
})
await test('미리보기에서 대상 추가·누락·차단 위조 거부',()=>{
 for(const change of [{items:[]},{allowed:false},{items:[{...preview().items[0],legacyUserId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}]}])assert.throws(()=>api.schoolRosterPreview({...preview(),...change},intent()))
 assert.throws(()=>api.schoolRosterPreview({...preview(),intent:{...intent(),reason:'다른 이유'}},intent()))
})
await test('접수증 대상·판·요청 번호 대조',()=>{
 assert.deepEqual(api.schoolRosterReceipt(receipt(),command(),'request-one'),receipt())
 for(const patch of [{items:[]},{version:1},{requestKey:'different'}])assert.throws(()=>api.schoolRosterReceipt({...receipt(),...patch},command(),'request-one'))
})
await test('4개 RPC에 기존 회원 소속만 명시',async()=>{
 const f=fixture();await f.server.get(member.id);await f.server.preview(member.id,intent());await f.server.commit(member.id,command(),'request-one');await f.server.close(member.id,command(),'request-one')
 assert.deepEqual(f.calls.map(x=>x.name),['workhub_school_roster_get','workhub_school_roster_preview','workhub_school_roster_commit','workhub_school_roster_close'])
 assert(f.calls.every(x=>x.args.p_member_id===member.id&&!('p_school_id'in x.args)&&!('p_user_id'in x.args)))
})
await test('연결 결과 미상에서 원래 번호·원문 복구',async()=>{
 let first=true;const f=fixture(()=>{if(first){first=false;throw Error('network')}return envelope(receipt())})
 await rejects(()=>f.server.commit(member.id,command(),'request-one'),'RESULT_UNKNOWN')
 assert.deepEqual(await f.server.commit(member.id,command(),'request-one'),receipt())
 assert.deepEqual(f.calls[0],f.calls[1])
 await rejects(()=>f.server.commit(member.id,{...command(),intent:{...intent(),reason:'변경'}},'request-one'),'IDEMPOTENCY_CONFLICT')
 assert.equal(f.calls.length,2)
})
await test('만료된 원래 미리보기도 같은 번호 접수 확인으로 보냄',async()=>{
 const f=fixture();assert.equal((await f.server.commit(member.id,command(),'request-one')).requestKey,'request-one')
})
await test('다른 학교 봉투는 쓰기 결과 미상',async()=>{
 const f=fixture(()=>({...envelope(receipt()),schoolId:'other-school'}));await rejects(()=>f.server.commit(member.id,command(),'request-one'),'RESULT_UNKNOWN')
})
await test('대기 중 학교·계정 변경 시 이전 응답 비노출',async()=>{
 let f;f=fixture(()=>{f.setMember({...member,schoolId:'another-school'});return envelope(snapshot())});await rejects(()=>f.server.get(member.id),'CANCELLED')
})
await test('신원 사전 확인 시간초과 후 늦은 응답은 쓰기 시작 안 함',async()=>{
 const f=fixture(undefined,5);let release;f.connection.getIdentity=()=>new Promise(resolve=>{release=resolve})
 await rejects(()=>f.server.commit(member.id,command(),'request-one'),'RESULT_UNKNOWN')
 release({userId:member.userId,approved:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0)
})
await test('서버의 확정 충돌과 결과 미상 구분',async()=>{
 const f=fixture(()=>({...envelope(null),data:undefined,error:{code:'CONFLICT'}}))
 // exact 봉투를 어기면 충돌로 오인하지 않는다.
 await rejects(()=>f.server.commit(member.id,command(),'request-one'),'RESULT_UNKNOWN')
 const g=fixture(()=>({contract:'school-roster.v1',schoolId:member.schoolId,memberId:member.id,error:{code:'CONFLICT'}}))
 await rejects(()=>g.server.commit(member.id,command(),'request-one'),'CONFLICT')
})
await test('닫기 결과는 적용 원접수증 또는 취소 장벽만 허용',()=>{
 assert.deepEqual(api.schoolRosterCloseResult({requestKey:'request-one',outcome:'applied',receipt:receipt()},command(),'request-one').receipt,receipt())
 assert.deepEqual(api.schoolRosterCloseResult({requestKey:'request-one',outcome:'closed',receipt:null},command(),'request-one'),{requestKey:'request-one',outcome:'closed',receipt:null})
 for(const row of [
   {requestKey:'other',outcome:'closed',receipt:null},
   {requestKey:'request-one',outcome:'closed',receipt:receipt()},
   {requestKey:'request-one',outcome:'applied',receipt:null},
   {requestKey:'request-one',outcome:'applied',receipt:{...receipt(),version:4}},
   {requestKey:'request-one',outcome:'unknown',receipt:null},
 ])assert.throws(()=>api.schoolRosterCloseResult(row,command(),'request-one'))
})
await test('결과 미상 뒤 닫기는 원래 명령과 번호로만 호출',async()=>{
 let count=0
 const f=fixture((name,args)=>{count++;if(count<=2)throw Error('network');return envelope({requestKey:args.p_request_key,outcome:'closed',receipt:null})})
 await rejects(()=>f.server.commit(member.id,command(),'request-one'),'RESULT_UNKNOWN')
 await rejects(()=>f.server.close(member.id,command(),'request-one'),'RESULT_UNKNOWN')
 assert.deepEqual(await f.server.close(member.id,command(),'request-one'),{requestKey:'request-one',outcome:'closed',receipt:null})
 assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.deepEqual(f.calls[1],f.calls[2])
 await rejects(()=>f.server.close(member.id,{...command(),intent:{...intent(),reason:'변경'}},'request-one'),'IDEMPOTENCY_CONFLICT')
 assert.equal(f.calls.length,3)
})
await test('닫기 응답 학교 불일치·잘못된 접수증은 잠금 해제 근거 아님',async()=>{
 const f=fixture(()=>({...envelope({requestKey:'request-one',outcome:'closed',receipt:null}),schoolId:'other-school'}))
 await rejects(()=>f.server.close(member.id,command(),'request-one'),'RESULT_UNKNOWN')
 const g=fixture(()=>envelope({requestKey:'request-one',outcome:'applied',receipt:{...receipt(),items:[]}}))
 await rejects(()=>g.server.close(member.id,command(),'request-one'),'RESULT_UNKNOWN')
})
if(process.env.P9_CAPTURE){
 const captures=JSON.parse(await readFile(process.env.P9_CAPTURE,'utf8'))
 for(const [index,c]of captures.entries())await test(`실제 PostgreSQL 응답 ${index+1} ${c.kind}`,()=>{
   if(c.kind==='get')api.schoolRosterSnapshot(c.raw.data)
   if(c.kind==='preview')api.schoolRosterPreview(c.raw.data,c.intent)
   if(c.kind==='receipt')api.schoolRosterReceipt(c.raw.data,c.command,c.key)
   if(c.kind==='close')api.schoolRosterCloseResult(c.raw.data,c.command,c.key)
 })
}
console.log(`교사 연결 앱 시험 ${passed} 통과`)
