// 승인된 인증 최적화의 경계: 운영 접속 없이 실제 연결 코드를 제어 가능한 세션/프로필 응답으로 시험한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const built=buildSync({stdin:{contents:"export {createSupabaseConnection} from './apps/workhub/src/connection/supabase-connection'",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':'{}'},logLevel:'silent'})
const {createSupabaseConnection}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick()}assert.fail('합성 응답 대기 조건 미충족')}
const profile=id=>({id,name:'시험 교사',email:'test@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true})
const rejected=(request,code='CANCELLED')=>assert.rejects(request,error=>error.code===code)
const schoolContext={schools:[{id:'school',name:'시험 학교'}],memberships:[],basisDate:'2026-10-30',schoolLabels:{school:{departmentIds:[],gradeIds:[],subjectIds:[]}}}
function fixture(){
  let listener=()=>{}
  const state={uid:'a',role:'superadmin',active:true,hold:false,profileCalls:0,sessionCalls:0,rpcCalls:0,subscriptions:0,signOutCalls:0,pending:[],events:[],invalidations:[],rpcReply:async()=>({data:schoolContext,error:null})}
  const api={
    async getSession(){state.sessionCalls++;return state.uid?{user:{id:state.uid}}:null},
    fetchMyProfile(id){state.profileCalls++;const result={...profile(id),role:state.role,is_active:state.active};return state.hold?new Promise((resolve,reject)=>state.pending.push({id,result,resolve:()=>resolve(result),value:resolve,reject})):Promise.resolve(result)},
    onAuthStateChange(callback){state.subscriptions++;listener=callback;return()=>{listener=()=>{}}},
    async signOut(){state.signOutCalls++;state.uid=null},async signInWithGoogle(){},
    async rpc(...args){state.rpcCalls++;return state.rpcReply(...args)},
  }
  const connection=createSupabaseConnection(api)
  connection.subscribeInvalidation(reason=>state.invalidations.push(reason.code))
  let stop=()=>{}
  return {state,api,connection,
    async listen(){stop=connection.subscribeIdentity((identity,error)=>state.events.push({identity,error}));await until(()=>state.subscriptions>0)},
    emit(event,uid=state.uid){state.uid=uid;listener(uid?{user:{id:uid}}:null,event)},stop(){stop()},
  }
}
let failures=0
async function ck(name,run){try{await run();console.log('  ✓ '+name)}catch(error){failures++;console.error('  ✗ '+name+': '+error.stack)}}
await ck('공통 인증 헬퍼는 session 첫 인자를 보존하고 이벤트 종류·구독 해제를 전달',async()=>{
  const {supabase,onAuthStateChange}=await loadBrowserModule("export {supabase,onAuthStateChange} from '../packages/shared/src/index.js'",{env:{VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
  let callback,closed=0;supabase.auth.onAuthStateChange=fn=>(callback=fn,{data:{subscription:{unsubscribe(){closed++}}}})
  const results=[],stop=onAuthStateChange((...args)=>results.push(args)),session={user:{id:'a'}}
  callback('INITIAL_SESSION',session);callback('SIGNED_OUT',null)
  assert.deepEqual(results,[[session,'INITIAL_SESSION'],[null,'SIGNED_OUT']]);stop();assert.equal(closed,1)
})
await ck('첫 INITIAL_SESSION은 진행 중 초기 조회를 취소하지 않고 프로필 1회로 공유',async()=>{
  const f=fixture();f.state.hold=true;await f.listen()
  const request=f.connection.getIdentity();await until(()=>f.state.pending.length===1)
  f.emit('INITIAL_SESSION');await tick();await tick()
  assert.equal(f.state.profileCalls,1);assert.deepEqual(f.state.invalidations,[])
  f.state.pending[0].resolve();assert.equal((await request).userId,'a')
  await until(()=>f.state.events.length===1);assert.equal(f.state.events[0].identity.userId,'a');f.stop()
})
await ck('세션 조회보다 먼저 온 INITIAL_SESSION도 초기 조회와 안전하게 공유',async()=>{
  const f=fixture();f.state.hold=true;await f.listen();f.emit('INITIAL_SESSION')
  const request=f.connection.getIdentity();await until(()=>f.state.pending.length===1);await tick()
  f.state.pending[0].resolve();assert.equal((await request).approved,true)
  await until(()=>f.state.events.length===1);assert.equal(f.state.profileCalls,1);assert.deepEqual(f.state.invalidations,[]);f.stop()
})
await ck('동일 계정·세대 동시 조회 3개는 프로필 1회이며 각 호출의 전후 세션 검증은 유지',async()=>{
  const f=fixture();f.state.hold=true
  const requests=[f.connection.getIdentity(),f.connection.getIdentity(),f.connection.getIdentity()]
  await until(()=>f.state.pending.length===1);await tick();assert.equal(f.state.profileCalls,1)
  f.state.pending[0].resolve();const identities=await Promise.all(requests)
  assert.equal(identities.length,3);assert.equal(f.state.sessionCalls,6)
})
await ck('성공한 프로필은 캐시하지 않아 다음 조회에서 승인 철회를 즉시 확인',async()=>{
  const f=fixture();assert.equal((await f.connection.getIdentity()).approved,true)
  f.state.active=false;assert.equal((await f.connection.getIdentity()).approved,false)
  assert.equal(f.state.profileCalls,2);assert.deepEqual(f.state.invalidations,['CANCELLED'])
})
await ck('같은 계정의 역할 변경도 새 프로필로 확인하고 이전 학교 문맥 폐기',async()=>{
  const f=fixture();await f.connection.loadContext();assert.equal(f.connection.info().schools.length,1)
  f.state.role='teacher';assert.equal((await f.connection.getIdentity()).profile.role,'teacher')
  assert.equal(f.connection.info().schools.length,0);assert.deepEqual(f.state.invalidations,['CANCELLED'])
})
await ck('공유 조회 실패는 각 호출에 실패로 전달하고 다음 시도는 새 조회',async()=>{
  const f=fixture();f.state.hold=true
  const requests=[f.connection.getIdentity(),f.connection.getIdentity()],checks=requests.map(r=>rejected(r,'QUERY_FAILED'))
  await until(()=>f.state.pending.length===1);f.state.pending[0].reject(Error('합성 실패'));await Promise.all(checks)
  f.state.hold=false;assert.equal((await f.connection.getIdentity()).approved,true);assert.equal(f.state.profileCalls,2)
})
await ck('동기 프로필 오류도 보존하지 않고 다음 호출에서 재시도',async()=>{
  const f=fixture(),read=f.api.fetchMyProfile;f.api.fetchMyProfile=()=>{throw Error('합성 동기 실패')}
  await rejected(f.connection.getIdentity(),'QUERY_FAILED');f.api.fetchMyProfile=read
  assert.equal((await f.connection.getIdentity()).approved,true)
})
await ck('없는 프로필과 다른 계정의 깨진 프로필을 승인 성공으로 재사용하지 않음',async()=>{
  const f=fixture();f.state.hold=true
  let request=f.connection.getIdentity();await until(()=>f.state.pending.length===1);f.state.pending[0].value(null)
  assert.equal((await request).approved,false)
  request=f.connection.getIdentity();const check=rejected(request,'QUERY_FAILED');await until(()=>f.state.pending.length===2)
  f.state.pending[1].value(profile('other'));await check
  f.state.hold=false;assert.equal((await f.connection.getIdentity()).approved,true);assert.equal(f.state.profileCalls,3)
})
await ck('서로 다른 연결 객체는 같은 계정이어도 프로필 요청을 공유하지 않음',async()=>{
  const f=fixture();f.state.hold=true;const other=createSupabaseConnection(f.api)
  const requests=[f.connection.getIdentity(),other.getIdentity()];await until(()=>f.state.pending.length===2)
  f.state.pending.forEach(p=>p.resolve());await Promise.all(requests);assert.equal(f.state.profileCalls,2)
})
await ck('세대가 같아도 다른 UID 요청은 분리하고 이전 UID의 늦은 응답은 취소',async()=>{
  const f=fixture();f.state.hold=true
  const first=f.connection.getIdentity(),check=rejected(first);await until(()=>f.state.pending.length===1)
  f.state.uid='b';const second=f.connection.getIdentity();await until(()=>f.state.pending.length===2)
  assert.deepEqual(f.state.pending.map(p=>p.id),['a','b']);f.state.pending[0].resolve();f.state.pending[1].resolve()
  await check;assert.equal((await second).userId,'b')
})
await ck('TOKEN_REFRESHED는 같은 UID라도 이전 세대 조회와 분리하고 늦은 결과를 폐기',async()=>{
  const f=fixture();await f.connection.getIdentity();await f.listen();f.state.hold=true
  const old=f.connection.getIdentity(),check=rejected(old);await until(()=>f.state.pending.length===1)
  f.emit('TOKEN_REFRESHED');await until(()=>f.state.pending.length===2)
  f.state.pending[0].resolve();await check;f.state.pending[1].resolve()
  await until(()=>f.state.events.length===1);assert.equal(f.state.events[0].identity.userId,'a');f.stop()
})
await ck('계정 변경 사건은 이전 학교 문맥을 즉시 폐기하고 새 계정만 전달',async()=>{
  const f=fixture();await f.connection.loadContext();await f.listen();f.state.hold=true
  const old=f.connection.getIdentity(),check=rejected(old);await until(()=>f.state.pending.length===1)
  f.emit('SIGNED_IN','b');assert.equal(f.connection.info().schools.length,0)
  await until(()=>f.state.pending.length===2);f.state.pending.forEach(p=>p.resolve());await check
  await until(()=>f.state.events.length===1);assert.equal(f.state.events[0].identity.userId,'b');f.stop()
})
await ck('SIGNED_OUT 직후 문맥을 비우고 진행 중 승인 결과가 계정을 되살리지 못함',async()=>{
  const f=fixture();await f.connection.loadContext();await f.listen();f.state.hold=true
  const old=f.connection.getIdentity(),check=rejected(old);await until(()=>f.state.pending.length===1)
  f.emit('SIGNED_OUT',null);assert.equal(f.connection.info().schools.length,0);f.state.pending[0].resolve();await check
  await until(()=>f.state.events.length===1);assert.equal(f.state.events[0].identity,null);f.stop()
})
await ck('명시 로그아웃은 인증 이벤트가 오지 않아도 진행 중 조회를 폐기',async()=>{
  const f=fixture();f.state.hold=true;const old=f.connection.getIdentity(),check=rejected(old)
  await until(()=>f.state.pending.length===1);await f.connection.signOut();f.state.pending[0].resolve();await check
  assert.equal(await f.connection.getIdentity(),null);assert.equal(f.state.signOutCalls,1)
})
await ck('첫 이벤트라도 이미 확인한 계정과 다른 INITIAL_SESSION은 실제 변경으로 처리',async()=>{
  const f=fixture();await f.connection.loadContext();await f.listen();f.state.hold=true
  const old=f.connection.getIdentity(),check=rejected(old);await until(()=>f.state.pending.length===1)
  f.emit('INITIAL_SESSION','b');assert.equal(f.connection.info().schools.length,0)
  await until(()=>f.state.pending.length===2);f.state.pending.forEach(p=>p.resolve());await check
  await until(()=>f.state.events.length===1);assert.equal(f.state.events[0].identity.userId,'b');f.stop()
})
await ck('반복 INITIAL_SESSION은 첫 알림 예외로 계속 취급하지 않음',async()=>{
  const f=fixture();await f.listen();f.emit('INITIAL_SESSION');await until(()=>f.state.events.length===1)
  f.state.hold=true;const old=f.connection.getIdentity(),check=rejected(old);await until(()=>f.state.pending.length===1)
  f.emit('INITIAL_SESSION');await until(()=>f.state.pending.length===2)
  f.state.pending.forEach(p=>p.resolve());await check;await until(()=>f.state.events.length===2);f.stop()
})
await ck('미로그인 INITIAL_SESSION은 프로필 호출 없이 null을 전달',async()=>{
  const f=fixture();f.state.uid=null;await f.listen();f.emit('INITIAL_SESSION',null)
  assert.equal(await f.connection.getIdentity(),null);await until(()=>f.state.events.length===1)
  assert.equal(f.state.profileCalls,0);assert.equal(f.state.events[0].identity,null);f.stop()
})
await ck('로그아웃 후 새 구독의 INITIAL_SESSION도 이전 세대 복원으로 취급하지 않음',async()=>{
  const f=fixture();await f.connection.loadContext();await f.connection.signOut()
  f.state.uid='a';f.state.hold=true;const old=f.connection.getIdentity(),check=rejected(old)
  await until(()=>f.state.pending.length===1);await f.listen();f.emit('INITIAL_SESSION')
  await until(()=>f.state.pending.length===2);f.state.pending.forEach(p=>p.resolve());await check
  await until(()=>f.state.events.length===1);f.stop()
})
await ck('이벤트 정보가 없는 기존 어댑터도 기존 세대 무효화 검증을 유지',async()=>{
  const f=fixture();await f.connection.getIdentity();await f.listen();f.state.hold=true
  const old=f.connection.getIdentity(),check=rejected(old);await until(()=>f.state.pending.length===1)
  f.emit(undefined);await until(()=>f.state.pending.length===2);f.state.pending.forEach(p=>p.resolve());await check
  await until(()=>f.state.events.length===1);f.stop()
})
await ck('구독 해제 뒤에는 진행 중 프로필이 끝나도 콜백을 호출하지 않음',async()=>{
  const f=fixture();f.state.hold=true;await f.listen();f.emit('INITIAL_SESSION')
  await until(()=>f.state.pending.length===1);f.stop();f.state.pending[0].resolve();await tick()
  assert.equal(f.state.events.length,0)
})
await ck('쓰기 전 새 승인 조회 유지: 이전 성공 뒤 철회되면 RPC를 보내지 않음',async()=>{
  const f=fixture();await f.connection.rpcVerified('synthetic_save',{requestKey:'same-key'})
  f.state.active=false;await rejected(f.connection.rpcVerified('synthetic_save',{requestKey:'new-key'}),'FORBIDDEN')
  assert.equal(f.state.profileCalls,2);assert.equal(f.state.rpcCalls,1)
})
await ck('쓰기 후 세션 재검증 유지: 결과 도착 전에 계정이 바뀌면 성공을 반환하지 않음',async()=>{
  const f=fixture();let finish;f.state.rpcReply=()=>new Promise(resolve=>{finish=resolve})
  const request=f.connection.rpcVerified('synthetic_save'),check=rejected(request)
  await until(()=>!!finish);f.state.uid='b';finish({data:{ok:true},error:null});await check
  assert.equal(f.state.sessionCalls,3)
})
for(const code of ['FORBIDDEN','INACTIVE_MEMBERSHIP'])await ck('서버 '+code+' 거부 시 학교 문맥 무효화 유지',async()=>{
  const f=fixture();await f.connection.loadContext();f.state.rpcReply=async()=>({data:null,error:{message:code}})
  await rejected(f.connection.rpcVerified('synthetic_save'),code);assert.equal(f.connection.info().schools.length,0)
})
if(failures)process.exitCode=1
