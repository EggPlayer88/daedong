import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const api=await loadBrowserModule(`
export * from '../apps/workhub/src/calendar/lifecycle.ts'
export * from '../apps/workhub/src/calendar/event-response.ts'
export * from '../apps/workhub/src/domain.ts'
export * from '../apps/workhub/src/app/workflow-results.ts'
export {fixtureData} from '../apps/workhub/src/preview/fixtures.ts'
export {canonical,sha256} from '../apps/workhub/src/cooperation/protocol.ts'
`)
const member=api.fixtureData.memberships.find(m=>m.id==='gaon-minjun'), event=api.fixtureData.events.find(e=>e.id==='fixture-event-morning')
const scope={schoolId:member.schoolId,memberId:member.id,ownerUserId:member.userId}, stamp='2026-10-19T02:03:04.000Z'
const command={eventId:event.id,expectedVersion:event.version,reason:'연수 일정 변경'}, key='cancel-one'
const cancelled={...event,version:event.version+1,updatedAt:stamp,status:'cancelled',cancelledAt:stamp,cancelReason:command.reason}
const envelope={contractVersion:'calendar.lifecycle.v1',ok:true,...scope,requestKey:key,event:cancelled,recordedAt:stamp}
let passed=0
async function test(name,fn){await fn();passed++;console.log('  ✓ '+name)}
function fixture(response){let current=structuredClone(member), revoked=false; const calls=[];const connection={
 info:()=>({...api.fixtureData,memberships:api.fixtureData.memberships.map(m=>m.id===member.id?current:m)}),
 getIdentity:async()=>({userId:current.userId,approved:!revoked,profile:{id:current.userId,is_active:!revoked,role:'teacher',extra_permissions:[],department_id:null}}),
 rpcVerified:async(name,args)=>{calls.push(structuredClone({name,args}));return response(name,args)}
 };return {server:api.createCalendarLifecycleAdapter(connection,300),calls,change:()=>{current={...current,userId:'other-user'}},revoke:()=>{revoked=true}}}
await test('취소 명령은 원본·판·사유만 허용하고 빈 사유·범위 초과·제어 문자는 거부한다',()=>{
 assert.deepEqual(api.cancelCommand(command),command)
 for(const bad of [{...command,eventId:''},{...command,expectedVersion:0},{...command,extra:true},...['',' ', '가'.repeat(501),'x\u0000'].map(reason=>({...command,reason}))])assert.throws(()=>api.cancelCommand(bad))
 assert.equal([...api.cancelCommand({...command,reason:'😀'.repeat(500)}).reason].length,500)
})
await test('옛 일정 응답은 유지하고 취소 응답은 세 필드의 일관성을 검증한다',()=>{
 assert.deepEqual(api.eventResponse(event,member.schoolId,api.fixtureData.memberships),event)
 assert.deepEqual(api.eventResponse(cancelled,member.schoolId,api.fixtureData.memberships),cancelled)
 for(const patch of [{status:'active'},{cancelledAt:null},{cancelledAt:'bad'},{cancelReason:''},{status:'deleted'}])assert.throws(()=>api.eventResponse({...cancelled,...patch},member.schoolId,api.fixtureData.memberships))
})
await test('취소한 일정은 홈에서 제외하고 수정도 막지만 원본 열람 권한은 그대로 유지한다',()=>{
 assert.equal(api.canRead(cancelled,member,api.fixtureData.basisDate),true)
 assert.equal(api.canEdit(cancelled,member,api.fixtureData.basisDate),false)
 assert.deepEqual(api.homeItems([cancelled],member,api.fixtureData.basisDate),{today:[],upcoming:[]})
})
await test('접수증의 학교·원본·판·사유·요청 번호·접수 시각 불일치를 거부한다',()=>{
 assert.deepEqual(api.cancelReceipt(envelope,scope,command,key,api.fixtureData.memberships),{event:cancelled,recordedAt:stamp,requestKey:key})
 assert.equal(api.cancelReceipt({...envelope,recordedAt:'2026-10-19T02:03:05.000Z'},scope,command,key,api.fixtureData.memberships).recordedAt,'2026-10-19T02:03:05.000Z')
 for(const patch of [{requestKey:'other'},{schoolId:'other'},{recordedAt:'2026-10-19T02:03:03.000Z'},...['id','version','cancelReason'].map(field=>({event:{...cancelled,[field]:field==='version'?99:'other'}}))])assert.throws(()=>api.cancelReceipt({...envelope,...patch},scope,command,key,api.fixtureData.memberships))
})
await test('취소·복구는 같은 번호·명령을 쓰고 결과 조회에는 recover_only를 보낸다',async()=>{
 const f=fixture(()=>envelope);await f.server.cancel(member.id,command,key);await f.server.recoverCancel(member.id,command,key)
 assert.deepEqual(f.calls.map(c=>c.args.p_recover_only),[false,true]);assert.deepEqual(f.calls.map(c=>c.args.p_command),[command,command])
 await assert.rejects(()=>f.server.cancel(member.id,{...command,reason:'다른 사유'},key),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(f.calls.length,2)
})
await test('미접수 조회는 확정 실패가 아니며 원키를 유지할 미확정 오류로 반환한다',async()=>{
 const f=fixture(async()=>({...envelope,ok:false,event:undefined,outcome:'unknown',code:'SAVE_UNCERTAIN',commandHash:await api.sha256(api.canonical(command))}))
 await assert.rejects(()=>f.server.recoverCancel(member.id,command,key),e=>e.code==='SAVE_UNCERTAIN'&&!e.definitive)
})
await test('서버의 원키·명령 해시가 맞는 판 충돌만 확정 거절로 구분한다',async()=>{
 const f=fixture(async()=>({...envelope,ok:false,outcome:'rejected',code:'CONFLICT',commandHash:await api.sha256(api.canonical(command))}))
 await assert.rejects(()=>f.server.cancel(member.id,command,key),e=>e.code==='CONFLICT'&&e.definitive)
 const bad=fixture(()=>({...envelope,ok:false,outcome:'rejected',code:'CONFLICT',commandHash:'a'.repeat(64)}))
 await assert.rejects(()=>bad.server.cancel(member.id,command,key),e=>e.code==='SAVE_UNCERTAIN'&&!e.definitive)
})
await test('취소 목록은 취소 원본만 허용하고 중복·다른 학교 응답을 거부한다',async()=>{
 const f=fixture(()=>[cancelled]);assert.deepEqual(await f.server.listCancelled(member.id),[cancelled])
 for(const value of [[event],[cancelled,cancelled],[{...cancelled,schoolId:'other'}]])await assert.rejects(()=>fixture(()=>value).server.listCancelled(member.id))
})
await test('응답 유실·잘못된 접수증과 처리 중 권한 철회는 확정 결과로 표시하지 않는다',async()=>{
 for(const response of [()=>{throw Error('lost')},()=>({...envelope,requestKey:'other'})])await assert.rejects(()=>fixture(response).server.cancel(member.id,command,key),e=>e.code==='SAVE_UNCERTAIN')
 let f;f=fixture(()=>{f.revoke();return envelope});await assert.rejects(()=>f.server.cancel(member.id,command,key),e=>e.code==='CANCELLED')
})
await test('업무 결과에는 취소의 접수 정보만 남고 사유·일정 본문은 남기지 않는다',()=>{
 const result={kind:'calendar',action:'cancel',scope:'school/member/user',key,recordedAt:stamp,eventId:event.id,eventVersion:2}
 assert.deepEqual(api.copyWorkflowResult({...result,reason:command.reason}),result);assert.equal(api.workflowResultLabel(result),'일정 취소')
})
console.log(`\n일정 취소 계약 ${passed}건 통과`)
