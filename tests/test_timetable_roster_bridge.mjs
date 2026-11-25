import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`export * from '../apps/workhub/src/timetable/roster-bridge-contracts';export * from '../apps/workhub/src/timetable/roster-bridge-server'`)
let n=0;async function test(label,fn){await fn();n++;console.log('  ✓ '+label)}
const input={planId:'plan-one',planVersion:2,from:'2027-01-04',until:'2027-01-11'}, key='request-one'
const lesson={id:'lesson-one',version:1,label:'합성 수업',time:{startsAt:'2027-01-04T00:00:00.000Z',endsAt:'2027-01-04T00:45:00.000Z'},teachers:[{id:'teacher-one',name:'합성 교사'}],groupNames:['1학년 1반'],roomNames:[],state:'scheduled',canRequest:false,allowedTargets:[]}
const preview={id:'preview-one',hash:'a'.repeat(64),expiresAt:'2027-01-01T00:15:00.000Z',input,timeZone:'Asia/Seoul',summary:{teachers:22,classes:9,weeklyLessons:288,changedLessons:1},changes:[{before:null,after:lesson}],blockers:[],excludedDays:[]}
const command={previewId:preview.id,hash:preview.hash,input},receipt={requestKey:key,publicationId:'publication-one',changedLessons:1,recordedAt:'2027-01-01T00:00:00.000Z',planId:input.planId,from:input.from,until:input.until}
await test('기본표·기간·변경교시 계약 대조',()=>assert.deepEqual(m.rosterOperatingPreview(preview,input),preview))
for(const [label,change]of[
 ['다른 기본표',v=>v.input.planId='foreign'],['다른 판',v=>v.input.planVersion++],['중복 변경',v=>{v.changes.push(v.changes[0]);v.summary.changedLessons++}],['기간 밖 수업',v=>{v.changes[0].after.time.startsAt='2027-01-11T00:00:00.000Z';v.changes[0].after.time.endsAt='2027-01-11T00:45:00.000Z'}],['시각 형식',v=>v.expiresAt='January 1, 2027'],['수업 수 불일치',v=>v.summary.changedLessons=3],['날짜 밖 제외일',v=>v.excludedDays=[{date:'2027-01-11',reason:'밖'}]],['수업 배열 손상',v=>v.changes=null],['추가 필드',v=>v.authorizedEvidence={secret:'없음'}]]) await test(label+' 응답 거절',()=>{const v=structuredClone(preview);change(v);assert.throws(()=>m.rosterOperatingPreview(v,input),e=>e.code==='INVALID_RESPONSE')})
for(const patch of[{requestKey:'other-key'},{planId:'another-plan'},{until:'2027-01-12'},{changedLessons:0}])await test('원래 요청 접수증 불일치 거절 '+Object.keys(patch)[0],()=>assert.throws(()=>m.rosterOperatingReceipt({...receipt,...patch},command,key)))
const member={id:'member-one',schoolId:'school-one',userId:'user-one',name:'관리자',role:'school_admin',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
let calls=[],mode='unknown',envelopeSchool=member.schoolId,approved=true
const connection={info:()=>({memberships:[member],schools:[{id:member.schoolId}],basisDate:'2026-11-16'}),getIdentity:async()=>({userId:member.userId,approved,profile:{role:'teacher',is_active:true,extra_permissions:[]}}),rpcVerified:async(name,args)=>{calls.push({name,args});if(mode==='unknown')throw Error('network');return {contract:m.ROSTER_BRIDGE_CONTRACT,schoolId:envelopeSchool,memberId:member.id,data:name.endsWith('_close')?{outcome:'applied',receipt}:name.endsWith('_preview')?preview:receipt}}}
const server=m.createRosterOperatingServer(connection)
await test('깨진 입력은 서버 호출 전 거절',async()=>{await assert.rejects(async()=>server.preview(member.id,{...input,until:input.from}),e=>e.code==='INVALID_INPUT');assert.equal(calls.length,0)})
await test('결과 미상은 원키를 유지하고 읽기 재확인·같은 본문 재전송',async()=>{await assert.rejects(()=>server.commit(member.id,command,key,false),e=>e.code==='RESULT_UNKNOWN');mode='ok';assert.deepEqual(await server.commit(member.id,command,key,true),receipt);assert.deepEqual(await server.commit(member.id,command,key,false),receipt);assert.deepEqual(calls[0],calls[2]);assert.equal(calls[1].args.p_recover_only,true);await assert.rejects(()=>server.commit(member.id,{...command,hash:'b'.repeat(64)},key,false),e=>e.code==='IDEMPOTENCY_CONFLICT')})
await test('이미 처리된 원번호 닫기는 접수증으로 종료',async()=>assert.deepEqual(await server.close(member.id,command,key),{outcome:'applied',receipt}))
await test('다른 학교 응답은 표시·확정 거절',async()=>{envelopeSchool='other-school';await assert.rejects(()=>server.preview(member.id,input),e=>e.code==='INVALID_RESPONSE');envelopeSchool=member.schoolId})
await test('승인 철회 뒤 추가 RPC 없음',async()=>{approved=false;const before=calls.length;await assert.rejects(()=>server.preview(member.id,input),e=>e.code==='CANCELLED');assert.equal(calls.length,before)})
console.log('명부 시간표 운영 연결 단위 '+n+' 통과')
