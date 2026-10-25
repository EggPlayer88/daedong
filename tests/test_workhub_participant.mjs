// OP1 계약의 거부 경계. 운영 계정·DB·외부 API를 사용하지 않는다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkhubParticipant, validParticipantScopes, visibleModules, createSupabaseConnection, participantAdministration } = await loadBrowserModule(`
 export {parseWorkhubParticipant,validParticipantScopes} from '../apps/main/src/lib/workhub-participant.js';
 export {visibleModules} from '../apps/main/src/lib/modules.js';
 export {createSupabaseConnection} from '../apps/workhub/src/connection/supabase-connection.ts';
 export {participantAdministration} from '../apps/workhub/src/participation/ParticipantAdministration.tsx';
`, {env:{MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
const profile={id:'teacher',role:'teacher',is_active:true,name:'합성 교사',email:'teacher@example.invalid',department_id:null,extra_permissions:[]}
const access={contract:'workhub.participant.v1',allowed:true,userId:'teacher',schoolId:'school',memberId:'member',scopes:['messages','tasks','cooperation'],expiresAt:'2099-10-25T12:00:00Z',revision:1}
let passed=0
const check=(name,fn)=>{fn();passed++;console.log('  ✓ '+name)}
check('명시된 업무 참여만 업무실 경로 추가',()=>assert.deepEqual(visibleModules(profile,access).filter(m=>!visibleModules(profile).some(o=>o.key===m.key)).map(m=>m.key),['workhub']))
check('반환된 범위는 원래 응답 배열을 공유하지 않음',()=>{const parsed=parseWorkhubParticipant(access,profile,'teacher');parsed.scopes.pop();assert.equal(access.scopes.length,3)})
for(const [name,value] of [
 ['타인',{...access,userId:'other'}],['추가 필드',{...access,admin:true}],['거절',{...access,allowed:false}],
 ['잘못된 계약',{...access,contract:'messaging.pilot.v1'}],['만료',{...access,expiresAt:'2000-01-01T00:00:00Z'}],
 ['무한 기간',{...access,expiresAt:'infinity'}],['누락',null],['배열',[]],['학교 누락',{...access,schoolId:null}],
 ['부정 판',{...access,revision:0}],['빈 범위',{...access,scopes:[]}],['중복 범위',{...access,scopes:['messages','messages']}],
 ['범위 밖',{...access,scopes:['assistant']}],['협업 의존 누락',{...access,scopes:['cooperation']}],
 ['시간표 의존 누락',{...access,scopes:['timetable','calendar','messages']}],['인계 의존 누락',{...access,scopes:['transitions','collections']}],
])check(name+'는 참여 허용 아님',()=>assert.equal(parseWorkhubParticipant(value,profile,'teacher'),null))
for(const p of [{...profile,is_active:false},{...profile,id:'other'},{...profile,role:'superadmin'}])check('현재 일반 교사와 일치해야 허용',()=>assert.equal(parseWorkhubParticipant(access,p,p.id),null))
check('다른 메뉴 공개 범위 보존',()=>assert.deepEqual(visibleModules(profile,access).filter(m=>m.key!=='workhub'),visibleModules(profile)))
check('의존 범위 전체 포함',()=>assert.equal(validParticipantScopes(['messages','tasks','calendar','cooperation','collections','transitions','teaching','timetable']),true))
check('중복 연결 모드 거부',()=>assert.throws(()=>createSupabaseConnection(undefined,{participant:true,messagingPilot:true}),e=>e.code==='INVALID_INPUT'))
const member={id:'member',schoolId:'school',userId:'teacher',name:'합성 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2099-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const raw={basisDate:'2026-10-26',schools:[{id:'school',name:'합성 학교'}],memberships:[member],schoolLabels:{school:{departmentIds:[],gradeIds:[],subjectIds:[]}}}
const calls=[]
const connection=createSupabaseConnection({getSession:async()=>({user:{id:'teacher'}}),fetchMyProfile:async()=>profile,rpc:async name=>{calls.push(name);return{data:raw,error:null}}},{participant:true})
await connection.loadContext('school')
check('전용 context만 사용',()=>assert.deepEqual(calls,['workhub_participant_context']))
const admin={contract:'workhub.participant-admin.v1',schoolId:'school',memberId:'member',grants:[{memberId:'participant',name:'대상',scopes:['messages'],active:true,effective:true,expiresAt:access.expiresAt,revision:1}],timetableApprovers:2,interventionsReady:false}
check('관리자 목록은 준비됨을 추정하지 않음',()=>assert.equal(participantAdministration(admin,member).interventionsReady,false))
for(const changed of [{...admin,schoolId:'other'},{...admin,grants:[...admin.grants,...admin.grants]},{...admin,timetableApprovers:1.5},{...admin,grants:[{...admin.grants[0],scopes:['transitions']}]}])check('위조 관리자 응답 거부',()=>assert.throws(()=>participantAdministration(changed,member)))
console.log(`\n${passed} passed, 0 failed`)
