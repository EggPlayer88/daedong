import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseMessagingPilot, visibleModules, createSupabaseConnection } = await loadBrowserModule(`
 export {parseMessagingPilot} from '../apps/main/src/lib/messaging-pilot.js';
 export {visibleModules} from '../apps/main/src/lib/modules.js';
 export {createSupabaseConnection} from '../apps/workhub/src/connection/supabase-connection.ts';
`,{env:{MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
const profile={id:'teacher',role:'teacher',is_active:true,name:'합성 교사',email:'teacher@example.invalid',department_id:null,extra_permissions:[]}
const access={contract:'messaging.pilot.v1',allowed:true,userId:'teacher',schoolId:'school',memberId:'member',expiresAt:'2099-10-25T12:00:00Z',revision:1}
let passed=0
const ck=(name,fn)=>{fn();passed++;console.log('  ✓ '+name)}
ck('명시한 일반 교사에게 업무실만 추가',()=>assert.deepEqual(visibleModules(profile,access).filter(m=>!visibleModules(profile).some(o=>o.key===m.key)).map(m=>m.key),['workhub']))
for(const [name,p,a] of [
 ['다른 로그인 사용자',{...profile,id:'other'},access],['가입 미승인',{...profile,is_active:false},access],
 ['만료',profile,{...access,expiresAt:'2000-01-01T00:00:00Z'}],['명시 거절',profile,{...access,allowed:false}],
 ['추가 권한 필드',profile,{...access,admin:true}],['잘못된 학교',profile,{...access,schoolId:null}],
 ['잘못된 계약',profile,{...access,contract:'other'}],['잘못된 판',profile,{...access,revision:0}],
 ['누락',profile,null],['배열',profile,[]],['무한 시간',profile,{...access,expiresAt:'infinity'}],
])ck(name+'에는 시범 권한 없음',()=>assert.equal(parseMessagingPilot(a,p,p.id),null))
ck('일반 교사 관리자·설정·일정 범위 유지',()=>assert.deepEqual(visibleModules(profile,access).filter(m=>m.key!=='workhub'),visibleModules(profile)))
ck('관리자는 원래 모듈 그대로',()=>{const p={...profile,role:'superadmin'};assert.deepEqual(visibleModules(p,access),visibleModules(p))})
const raw={basisDate:'2026-10-25',schools:[{id:'school',name:'합성 학교'}],memberships:[{id:'member',schoolId:'school',userId:'teacher',name:'합성 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}],schoolLabels:{school:{departmentIds:[],gradeIds:[],subjectIds:[]}}}
for(const pilot of [true,false]){
 const calls=[];let uid='teacher';let resolve
 const services={getSession:async()=>({user:{id:uid}}),fetchMyProfile:async()=>profile,rpc:async name=>{calls.push(name);return{data:raw,error:null}}}
 const c=createSupabaseConnection(services,{messagingPilot:pilot});const ctx=await c.loadContext('school')
 ck((pilot?'시범':'기존')+' 연결은 지정한 context RPC만 호출',()=>{assert.deepEqual(calls,[pilot?'workhub_messaging_pilot_context':'workhub_context']);assert.equal(ctx.memberships[0].id,'member')})
 services.rpc=()=>new Promise(r=>resolve=r);const pending=c.loadContext('school');while(!resolve)await new Promise(r=>setTimeout(r,0));uid='other';resolve({data:raw,error:null})
 await assert.rejects(pending,error=>error.code==='CANCELLED');passed++;console.log('  ✓ 계정 전환 뒤 늦은 소속 응답 거부')
}
console.log(`\n${passed} passed, 0 failed`)
