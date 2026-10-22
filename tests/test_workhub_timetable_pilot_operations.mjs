import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

const m=await loadBrowserModule(`
export * from '../apps/workhub/src/timetable/pilot/operations'
export * from '../apps/workhub/src/timetable/pilot/persistence'
export * from '../apps/workhub/src/timetable/pilot/timetable-replacement'
export {getPilotFixture} from '../apps/workhub/src/timetable/pilot/fixture'
export {gzipSync} from 'fflate'
`)
let count=0,serial=0
const test=async(name,run)=>{await run();count++;console.log('  ✓ '+name)}
const fixture=()=>({...m.getPilotFixture(),dateRange:{startsOn:'2026-03-09',endsOn:'2026-03-13'},defaultDate:'2026-03-09'})
const fresh=()=>m.createPilotState(fixture())
const send=(state,actorId,command,requestId='req-'+(++serial))=>({requestId,actorId,expectedRevision:state.revision,command})
const execute=async(state,actorId,command)=>m.applyPilotCommand(state,send(state,actorId,command))
const code=(expected)=>error=>error.code===expected
const manager='pilot-manager-1'
const propose=async(state,kind='swap',patch={})=>{
  const source=state.lessons.find(row=>row.date==='2026-03-09'&&row.period===1)
  const target=m.recommendPilotSwaps(state,source.id)[0]
  assert.ok(target)
  const command={type:'propose',kind,lessonIds:kind==='swap'?[source.id,target.lessonId]:[source.id],reason:'연습 일정 변경',...patch}
  const response=await execute(state,source.teacherId,command)
  return{state:response.state,p:response.state.proposals.at(-1),source,target}
}
const agree=async(state,p)=>{
  for(const id of p.requiredTeacherIds)state=(await execute(state,id,{type:'consent',proposalId:p.id,decision:'accepted'})).state
  return state
}
const approve=async(state,p)=>execute(await agree(state,p),manager,{type:'approve',proposalId:p.id})
const locks={request:async(_name,callback)=>callback()}
const memory=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values}}

await test('9학급 1학기 시드에서 날짜별 수업을 만들고 실제 서버와 분리한다',()=>{
  const state=m.createPilotState(m.getPilotFixture())
  assert.equal(state.fixture.classes.length,9);assert.equal(state.fixture.lessons.length,279)
  assert.ok(state.lessons.length>5000);assert.equal(state.simulated,true);assert.equal(state.revision,1)
  assert.equal(new Set(state.lessons.map(row=>row.id)).size,state.lessons.length)
})
await test('초기 상태를 검증해 복원하고 원본 시드를 변경하지 않는다',()=>{
  const source=fixture(),before=JSON.stringify(source),state=m.createPilotState(source)
  assert.deepEqual(m.parsePilotState(state),state);assert.equal(JSON.stringify(source),before)
})
await test('결정적 교환 추천은 교사·학급·공간 충돌을 확인한다',()=>{
  const state=fresh(),source=state.lessons[0],a=m.recommendPilotSwaps(state,source.id),b=m.recommendPilotSwaps(state,source.id)
  assert.ok(a.length);assert.deepEqual(a,b);assert.ok(a.every(row=>row.date===source.date&&row.period!==source.period))
})
await test('추천 요청 후 전원 수락과 별도 승인으로 두 수업만 교환한다',async()=>{
  const initial=fresh(),before=JSON.stringify(initial),{state,p,source,target}=await propose(initial)
  assert.equal(JSON.stringify(initial),before);assert.equal(state.proposals[0].status,'awaiting_consent')
  assert.deepEqual(state.lessons,initial.lessons)
  const result=await approve(state,p)
  assert.equal(result.state.proposals[0].status,'approved')
  assert.equal(result.state.lessons.find(row=>row.id===source.id).period,target.period)
  assert.equal(result.state.lessons.filter(row=>row.version===2).length,2)
  assert.equal(result.state.notifications.filter(row=>row.kind==='changed').length,p.requiredTeacherIds.length)
  assert.deepEqual(m.parsePilotState(result.state),result.state)
})
await test('수락 전 승인과 본인 승인을 차단한다',async()=>{
  const {state,p}=await propose(fresh())
  await assert.rejects(()=>execute(state,manager,{type:'approve',proposalId:p.id}),code('CONSENT_REQUIRED'))
  await assert.rejects(()=>execute(state,p.requesterId,{type:'approve',proposalId:p.id}),code('SELF_APPROVAL'))
})
await test('영향 교사 아닌 응답과 승인 권한 없는 역할을 차단한다',async()=>{
  const {state,p}=await propose(fresh()),other=state.fixture.teachers.find(row=>!p.requiredTeacherIds.includes(row.id)).id
  await assert.rejects(()=>execute(state,other,{type:'consent',proposalId:p.id,decision:'accepted'}),code('FORBIDDEN'))
  await assert.rejects(async()=>execute(await agree(state,p),other,{type:'approve',proposalId:p.id}),code('FORBIDDEN'))
})
await test('담당자는 사유를 남겨 미반영 요청을 반려하며 시간표를 바꾸지 않는다',async()=>{
  const {state,p}=await propose(fresh()),ready=await agree(state,p)
  const rejected=await execute(ready,manager,{type:'reject',proposalId:p.id,reason:'행사 일정과 겹쳐 반려 연습'})
  assert.equal(rejected.state.proposals[0].status,'rejected')
  assert.deepEqual(rejected.state.lessons,state.lessons)
  assert.ok(rejected.state.history.at(-1).summary.includes('행사 일정'))
  assert.deepEqual(m.parsePilotState(rejected.state),rejected.state)
})
await test('읽음은 동의가 아니며 한 명 반려면 시간표를 바꾸지 않는다',async()=>{
  const initial=fresh(),{state,p}=await propose(initial),notice=m.pilotInbox(state,p.requesterId)[0]
  const read=(await execute(state,p.requesterId,{type:'read_notification',id:notice.id})).state
  assert.equal(read.proposals[0].consents.length,0)
  const rejected=await execute(read,p.requiredTeacherIds[0],{type:'consent',proposalId:p.id,decision:'rejected'})
  assert.equal(rejected.state.proposals[0].status,'rejected');assert.deepEqual(rejected.state.lessons,initial.lessons)
  await assert.rejects(()=>execute(rejected.state,manager,{type:'approve',proposalId:p.id}),code('CONSENT_REQUIRED'))
})
await test('요청자만 미반영 요청을 철회한다',async()=>{
  const {state,p}=await propose(fresh())
  await assert.rejects(()=>execute(state,manager,{type:'withdraw',proposalId:p.id}),code('FORBIDDEN'))
  const result=await execute(state,p.requesterId,{type:'withdraw',proposalId:p.id})
  assert.equal(result.state.proposals[0].status,'withdrawn')
  await assert.rejects(()=>execute(result.state,p.requesterId,{type:'consent',proposalId:p.id,decision:'accepted'}),code('CONFLICT'))
})
await test('동일 요청 번호와 원문 재전송은 원 접수증이고 다른 본문은 거부한다',async()=>{
  const state=fresh(),source=state.lessons[0],request=send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'연습 실시'})
  const result=await m.applyPilotCommand(state,request),again=await m.applyPilotCommand(result.state,request)
  assert.equal(again.duplicate,true);assert.deepEqual(again.receipt,result.receipt);assert.deepEqual(again.state,result.state)
  await assert.rejects(()=>m.applyPilotCommand(result.state,{...request,command:{...request.command,note:'다른 내용'}}),code('CONFLICT'))
})
await test('낡은 전체 판은 새 요청을 거부하고 이전 결과 조회는 허용한다',async()=>{
  const state=fresh(),source=state.lessons[0],first=send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})
  const result=await m.applyPilotCommand(state,first)
  await assert.rejects(()=>m.applyPilotCommand(result.state,{...first,requestId:'new-stale'}),code('CONFLICT'))
  assert.equal((await m.applyPilotCommand(result.state,first)).duplicate,true)
})
await test('요청 닫기는 늦게 온 원명령을 막고 닫기 재확인은 같은 결과다',async()=>{
  const state=fresh(),source=state.lessons[0],request=send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})
  const closed=await m.closePilotRequest(state,request)
  assert.equal(closed.receipt.status,'closed');assert.deepEqual(closed.state.lessons,state.lessons)
  await assert.rejects(()=>m.applyPilotCommand(closed.state,request),code('REQUEST_CLOSED'))
  assert.deepEqual((await m.closePilotRequest(closed.state,request)).receipt,closed.receipt)
  assert.deepEqual(m.parsePilotState(closed.state),closed.state)
})
await test('이미 반영된 요청을 닫아도 실제 결과를 취소하지 않는다',async()=>{
  const state=fresh(),source=state.lessons[0],request=send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})
  const result=await m.applyPilotCommand(state,request),closed=await m.closePilotRequest(result.state,request)
  assert.equal(closed.receipt.status,'applied');assert.deepEqual(closed.state,result.state)
})
await test('다른 역할이 같은 번호를 닫을 수 없다',async()=>{
  const state=fresh(),source=state.lessons[0],request=send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})
  const result=await m.closePilotRequest(state,request)
  await assert.rejects(()=>m.closePilotRequest(result.state,{...request,actorId:manager}),code('CONFLICT'))
})
await test('대강은 원담당과 대강 교사 양쪽 수락 뒤 교사만 바꾼다',async()=>{
  const state=fresh(),source=state.lessons[0],free=state.fixture.teachers.find(teacher=>!state.lessons.some(row=>row.date===source.date&&row.period===source.period&&row.teacherId===teacher.id))
  assert.ok(free)
  const response=await execute(state,source.teacherId,{type:'propose',kind:'substitute',lessonIds:[source.id],substituteTeacherId:free.id,reason:'출장 연습'})
  const p=response.state.proposals.at(-1);assert.deepEqual(p.requiredTeacherIds,[source.teacherId,free.id].sort())
  const result=await approve(response.state,p),changed=result.state.lessons.find(row=>row.id===source.id)
  assert.equal(changed.teacherId,free.id);assert.equal(changed.date,source.date);assert.equal(changed.period,source.period)
  await assert.rejects(()=>execute(result.state,source.teacherId,{type:'record',lessonId:changed.id,expectedLessonVersion:2,note:''}),code('FORBIDDEN'))
})
await test('이미 수업 있는 교사를 대강 배정하면 거부하고 원상태를 보존한다',async()=>{
  const state=fresh(),source=state.lessons[0],busy=state.lessons.find(row=>row.date===source.date&&row.period===source.period&&row.teacherId!==source.teacherId)
  const before=JSON.stringify(state)
  await assert.rejects(()=>execute(state,source.teacherId,{type:'propose',kind:'substitute',lessonIds:[source.id],substituteTeacherId:busy.teacherId,reason:'연습'}),code('RESOURCE_CONFLICT'))
  assert.equal(JSON.stringify(state),before)
})
await test('휴강 뒤 보강은 최초 수업에 연결하고 중복 보강을 막는다',async()=>{
  const {state,p,source}=await propose(fresh(),'cancel')
  const cancelled=(await approve(state,p)).state
  assert.equal(cancelled.lessons.find(row=>row.id===source.id).status,'cancelled')
  const response=await execute(cancelled,source.teacherId,{type:'propose',kind:'makeup',lessonIds:[source.id],targetDate:source.date,targetPeriod:7,reason:'보강 연습'})
  const result=await approve(response.state,response.state.proposals.at(-1))
  const makeup=result.state.lessons.find(row=>row.originLessonId===source.id)
  assert.ok(makeup);assert.equal(makeup.period,7);assert.equal(result.state.lessons.find(row=>row.id===source.id).status,'cancelled')
  await assert.rejects(()=>execute(result.state,source.teacherId,{type:'propose',kind:'makeup',lessonIds:[source.id],targetDate:source.date,targetPeriod:7,reason:'중복'}),code('MAKEUP_EXISTS'))
  assert.deepEqual(m.parsePilotState(result.state),result.state)
})
await test('두 보강 요청이 함께 대기해도 먼저 승인된 한 건만 생긴다',async()=>{
  const {state,p,source}=await propose(fresh(),'cancel')
  let next=(await approve(state,p)).state
  const command={type:'propose',kind:'makeup',lessonIds:[source.id],targetDate:source.date,targetPeriod:7,reason:'보강'}
  next=(await execute(next,source.teacherId,command)).state
  const first=next.proposals.at(-1)
  next=(await execute(next,source.teacherId,command)).state
  const second=next.proposals.at(-1)
  next=(await approve(next,first)).state
  await assert.rejects(()=>execute(next,source.teacherId,{type:'consent',proposalId:second.id,decision:'accepted'}),code('MAKEUP_EXISTS'))
})
await test('휴업은 해당 학급 수업만 취소하고 재개 때 직접 휴강은 보존한다',async()=>{
  const {state,p,source}=await propose(fresh(),'cancel')
  const cancelled=(await approve(state,p)).state
  const command={type:'school_day',date:source.date,classIds:source.classIds,closed:true,reason:'휴업 연습'}
  const closed=(await execute(cancelled,manager,command)).state
  assert.ok(closed.lessons.filter(row=>row.date===source.date&&row.classIds.includes(source.classIds[0])).every(row=>row.status==='cancelled'))
  const reopened=(await execute(closed,manager,{...command,closed:false,reason:'재개 연습'})).state
  assert.equal(reopened.lessons.find(row=>row.id===source.id).cancellation,'requested')
  assert.equal(reopened.lessons.filter(row=>row.date===source.date&&row.classIds.includes(source.classIds[0])&&row.status==='scheduled').length,5)
})
await test('휴업 교시에 이동하거나 담당자 아닌 역할로 휴업할 수 없다',async()=>{
  const state=fresh(),source=state.lessons[0],command={type:'school_day',date:source.date,classIds:source.classIds,closed:true,reason:'휴업'}
  await assert.rejects(()=>execute(state,source.teacherId,command),code('FORBIDDEN'))
  const closed=(await execute(state,manager,command)).state
  await assert.rejects(()=>execute(closed,source.teacherId,{type:'propose',kind:'makeup',lessonIds:[source.id],targetDate:source.date,targetPeriod:7,reason:'보강'}),code('SCHOOL_CLOSED'))
})
await test('이미 받은 동의 이후 원수업이 바뀌면 승인하지 않는다',async()=>{
  const {state,p,source}=await propose(fresh())
  let next=await agree(state,p)
  next=(await execute(next,manager,{type:'school_day',date:source.date,classIds:source.classIds,closed:true,reason:'휴업'})).state
  await assert.rejects(()=>execute(next,manager,{type:'approve',proposalId:p.id}),code('LESSON_CHANGED'))
})
await test('특별 일과는 전 수업 시각과 판을 바꾸고 겹친 일과는 거부한다',async()=>{
  const state=fresh(),shift=value=>{const parts=value.split(':').map(Number);return `${String(parts[0]).padStart(2,'0')}:${String(parts[1]+1).padStart(2,'0')}`}
  const changed=state.fixture.daySlots.map(slot=>({...slot,startTime:shift(slot.startTime),endTime:shift(slot.endTime)}))
  const command={type:'special_day',date:'2026-03-09',classIds:state.fixture.classes.map(row=>row.id),slots:changed,reason:'특별 일과 연습'}
  const result=await execute(state,manager,command)
  assert.equal(result.state.lessons[0].startTime,changed[0].startTime);assert.equal(result.state.lessons[0].version,2)
  assert.deepEqual(m.parsePilotState(result.state),result.state)
  await assert.rejects(()=>execute(state,manager,{...command,slots:changed.map((slot,index)=>index?slot:{...slot,endTime:'23:59'})}),code('INVALID_INPUT'))
})
await test('실시 기록은 배정 교사·판을 확인하고 이후 교환 및 휴업 변경을 막는다',async()=>{
  const state=fresh(),source=state.lessons[0]
  await assert.rejects(()=>execute(state,manager,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}),code('FORBIDDEN'))
  await assert.rejects(()=>execute(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:2,note:''}),code('LESSON_CHANGED'))
  const result=await execute(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'수업 실시 연습'})
  assert.equal(result.state.lessons[0].status,'performed');assert.equal(result.state.records.length,1)
  await assert.rejects(()=>execute(result.state,manager,{type:'school_day',date:source.date,classIds:source.classIds,closed:true,reason:'휴업'}),code('ALREADY_PERFORMED'))
  assert.equal(m.recommendPilotSwaps(result.state,source.id).length,0)
})
await test('알림은 해당 역할만 읽으며 읽음이 수업 상태에 영향을 주지 않는다',async()=>{
  const {state,p}=await propose(fresh()),notice=m.pilotInbox(state,p.requesterId)[0]
  await assert.rejects(()=>execute(state,manager,{type:'read_notification',id:notice.id}),code('FORBIDDEN'))
  const result=await execute(state,p.requesterId,{type:'read_notification',id:notice.id})
  assert.equal(m.pilotInbox(result.state,p.requesterId)[0].read,true);assert.deepEqual(result.state.lessons,state.lessons)
})
await test('깨진 명령, 없는 교사와 추가 권한 필드를 거부한다',async()=>{
  const state=fresh(),source=state.lessons[0],valid={type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}
  for(const command of [{...valid,admin:true},{...valid,expectedLessonVersion:NaN},{type:'school_day',date:'2026-02-30',classIds:source.classIds,closed:true,reason:'x'}]){
    await assert.rejects(()=>execute(state,source.teacherId,command),code('INVALID_INPUT'))
  }
  await assert.rejects(()=>execute(state,'unknown',valid),code('FORBIDDEN'))
})
await test('복원 검사에서 교사 충돌·중복 수업·가짜 실시·동의 없는 승인·접수 손상을 거부한다',async()=>{
  const {state,p}=await propose(fresh()),approved=(await approve(state,p)).state
  for(const edit of [
    value=>value.lessons.push(value.lessons[0]),
    value=>{value.lessons[0].teacherId=value.lessons.find(row=>row.id!==value.lessons[0].id&&row.date===value.lessons[0].date&&row.period===value.lessons[0].period).teacherId},
    value=>value.lessons[0].status='performed',
    value=>value.proposals[0].consents=[],
    value=>value.receipts[0].commandHash='bad',
  ]){const broken=structuredClone(approved);edit(broken);assert.throws(()=>m.parsePilotState(broken))}
})
await test('학교·계정 해시로 저장하고 원 식별자는 본문·내보내기에 남기지 않는다',async()=>{
  const storage=memory(),scope={schoolId:'actual-school-sensitive',accountId:'actual-account-sensitive'}
  const store=await m.createPilotStore({fixture:fixture(),scope,storage,locks})
  const state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  const exported=await store.exportFile()
  assert.ok(!exported.includes(scope.schoolId));assert.ok(!exported.includes(scope.accountId))
  assert.ok(![...storage.values.keys()][0].includes(scope.accountId))
  const reopened=await m.createPilotStore({fixture:fixture(),scope,storage,locks})
  assert.equal(reopened.snapshot().records.length,1)
})
await test('저장 실패는 메모리 상태와 접수 번호를 바꾸지 않는다',async()=>{
  const storage={getItem:()=>null,setItem:()=>{throw new Error('quota')}}
  const store=await m.createPilotStore({fixture:fixture(),scope:'failure',storage,locks}),state=store.snapshot(),source=state.lessons[0]
  await assert.rejects(()=>store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})),code('STORAGE_UNAVAILABLE'))
  assert.deepEqual(store.snapshot(),state)
})
await test('다른 탭이 저장한 뒤 옛 탭은 덮어쓰지 않고 새로 읽는다',async()=>{
  const storage=memory(),a=await m.createPilotStore({fixture:fixture(),scope:'tabs',storage,locks}),b=await m.createPilotStore({fixture:fixture(),scope:'tabs',storage,locks})
  const state=a.snapshot(),source=state.lessons[0],request=send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})
  await a.transact(request)
  await assert.rejects(()=>b.transact(request),code('STORAGE_CONFLICT'))
  await b.reload()
  assert.equal((await b.transact(request)).duplicate,true)
})
await test('로그아웃·학교 전환 후 이전 핸들의 읽기·내보내기·저장을 막는다',async()=>{
  let active=true
  const store=await m.createPilotStore({fixture:fixture(),scope:'scope',storage:memory(),locks,isCurrentScope:()=>active})
  const state=store.snapshot(),source=state.lessons[0];active=false
  assert.throws(()=>store.snapshot(),code('SCOPE_CHANGED'));await assert.rejects(()=>store.exportFile(),code('SCOPE_CHANGED'))
  await assert.rejects(()=>store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})),code('SCOPE_CHANGED'))
  active=true;store.dispose();assert.throws(()=>store.snapshot(),code('SCOPE_CHANGED'))
})
await test('잠금 지원 없는 브라우저는 영구 저장을 거부해 탭 경쟁을 피한다',async()=>{
  const store=await m.createPilotStore({fixture:fixture(),scope:'no-lock',storage:memory(),locks:null}),state=store.snapshot(),source=state.lessons[0]
  await assert.rejects(()=>store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''})),code('STORAGE_LOCK_UNAVAILABLE'))
})
await test('파일 내보내기·복원은 같은 계정만 허용하고 손상과 너무 큰 파일을 거부한다',async()=>{
  const a=await m.createPilotStore({fixture:fixture(),scope:'file-owner',storage:memory(),locks})
  const state=a.snapshot(),source=state.lessons[0]
  await a.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'연습'}))
  const file=await a.exportFile(),b=await m.createPilotStore({fixture:fixture(),scope:'file-owner',storage:memory(),locks})
  assert.equal((await b.restoreFile(file)).records.length,1)
  const c=await m.createPilotStore({fixture:fixture(),scope:'other-owner',storage:memory(),locks})
  await assert.rejects(()=>c.restoreFile(file),code('SCOPE_CHANGED'))
  await assert.rejects(()=>b.restoreFile(file.replace('연습','변조')),code('INVALID_INPUT'))
  await assert.rejects(()=>b.restoreFile('x'.repeat(m.PILOT_BACKUP_MAX_BYTES+1)),code('INVALID_INPUT'))
})
await test('과거 백업으로 닫힌 요청을 부활시키거나 최신 기록을 지울 수 없다',async()=>{
  const store=await m.createPilotStore({fixture:fixture(),scope:'history',storage:memory(),locks}),old=await store.exportFile(),state=store.snapshot(),source=state.lessons[0]
  await store.close(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  await assert.rejects(()=>store.restoreFile(old),code('CONFLICT'))
})
await test('손상된 기존 저장소는 초기화해서 덮어쓰지 않는다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:fixture(),scope:'corrupt',storage,locks}),state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  const key=[...storage.values.keys()][0];storage.values.set(key,'{bad')
  await assert.rejects(()=>m.createPilotStore({fixture:fixture(),scope:'corrupt',storage,locks}),code('INVALID_INPUT'))
  assert.equal(storage.getItem(key),'{bad')
})
await test('실제 교사 이름을 fixture에 넣은 자료는 영구 저장과 내보내기를 막는다',async()=>{
  const altered=fixture();altered.teachers[0]={...altered.teachers[0],kind:'registered-reference',label:'실제교사'}
  const store=await m.createPilotStore({fixture:altered,scope:'privacy',storage:memory(),locks})
  await assert.rejects(()=>store.exportFile(),code('INVALID_INPUT'))
})
await test('시간표 CSV 교체는 적용일 이전 수업과 접수·실시 이력을 보존한다',async()=>{
  let state=fresh(),source=state.lessons[0]
  state=(await execute(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'교체 이전 수업'})).state
  const csv=m.exportPilotTimetableCsv(state.fixture).replaceAll('"국어"','"국어 수정"')
  const preview=await m.previewTimetableReplacement(state.fixture,csv,'2026-03-10','2026-03-09')
  const previous=state.lessons.filter(row=>row.date<'2026-03-10'),receipt=state.receipts[0]
  const result=await execute(state,manager,{type:'replace_timetable',preview,reviewDate:'2026-03-09',reason:'새 시간표 교체 연습'})
  assert.deepEqual(result.state.lessons.filter(row=>row.date<'2026-03-10'),previous)
  assert.deepEqual(result.state.receipts[0],receipt);assert.deepEqual(result.state.records,state.records)
  assert.equal(result.state.fixture.revision,state.fixture.revision+1)
  assert.equal(result.state.timetableVersions[0].previousFixture.revision,state.fixture.revision)
  assert.ok(result.state.lessons.some(row=>row.date>='2026-03-10'&&row.subject==='국어 수정'))
  assert.deepEqual(m.parsePilotState(result.state),result.state)
})
await test('대기 요청·변경 이력·특별 일과가 겹치는 시간표 교체는 막는다',async()=>{
  const initial=fresh(),{state,p}=await propose(initial)
  const csv=m.exportPilotTimetableCsv(initial.fixture).replaceAll('"국어"','"국어 수정"')
  const preview=await m.previewTimetableReplacement(initial.fixture,csv,'2026-03-09','2026-03-09')
  const command={type:'replace_timetable',preview,reviewDate:'2026-03-09',reason:'교체'}
  await assert.rejects(()=>execute(state,manager,command),code('CONFLICT'))
  const changed=(await approve(state,p)).state
  await assert.rejects(()=>execute(changed,manager,command),code('CONFLICT'))
  const closed=(await execute(initial,manager,{type:'school_day',date:'2026-03-09',classIds:[initial.fixture.classes[0].id],closed:true,reason:'휴업'})).state
  await assert.rejects(()=>execute(closed,manager,command),code('CONFLICT'))
})
await test('위조한 시간표 미리보기와 낡은 기준판을 거부한다',async()=>{
  const state=fresh(),csv=m.exportPilotTimetableCsv(state.fixture).replaceAll('"국어"','"국어 수정"')
  const preview=await m.previewTimetableReplacement(state.fixture,csv,'2026-03-10','2026-03-09')
  const forged=structuredClone(preview);forged.lessons[0].subject='위조'
  await assert.rejects(()=>execute(state,manager,{type:'replace_timetable',preview:forged,reviewDate:'2026-03-09',reason:'교체'}))
  const changed=(await execute(state,manager,{type:'replace_timetable',preview,reviewDate:'2026-03-09',reason:'교체'})).state
  await assert.rejects(()=>execute(changed,manager,{type:'replace_timetable',preview,reviewDate:'2026-03-09',reason:'옛 판'}))
})
await test('시간표 교체 파일을 저장·복원해도 이전 기준판이 남는다',async()=>{
  const store=await m.createPilotStore({fixture:fixture(),scope:'replace-backup',storage:memory(),locks}),state=store.snapshot()
  const preview=await m.previewTimetableReplacement(state.fixture,m.exportPilotTimetableCsv(state.fixture).replaceAll('"국어"','"국어 수정"'),'2026-03-10','2026-03-09')
  await store.transact(send(state,manager,{type:'replace_timetable',preview,reviewDate:'2026-03-09',reason:'교체'}))
  const backup=await store.exportFile(),freshStore=await m.createPilotStore({fixture:fixture(),scope:'replace-backup',storage:memory(),locks})
  const restored=await freshStore.restoreFile(backup)
  assert.equal(restored.timetableVersions.length,1);assert.equal(restored.fixture.revision,2)
})
await test('합반의 일부만 휴업하거나 일과를 바꾸는 경우 원자적으로 거부한다',async()=>{
  const data=fixture(),a=data.lessons.find(row=>row.classIds[0]===data.classes[0].id&&row.weekday===1&&row.period===1),b=data.lessons.find(row=>row.classIds[0]===data.classes[1].id&&row.weekday===1&&row.period===1)
  a.classIds.push(b.classIds[0]);data.lessons=data.lessons.filter(row=>row.id!==b.id)
  const state=m.createPilotState(data),before=JSON.stringify(state)
  await assert.rejects(()=>execute(state,manager,{type:'school_day',date:'2026-03-09',classIds:[data.classes[0].id],closed:true,reason:'부분 휴업'}),code('PARTIAL_CLOSURE'))
  assert.equal(JSON.stringify(state),before)
  const closed=(await execute(state,manager,{type:'school_day',date:'2026-03-09',classIds:a.classIds,closed:true,reason:'합반 전체 휴업'})).state
  assert.equal(closed.lessons.find(row=>row.templateId===a.id).status,'cancelled')
})
await test('보강 요청 후 원수업 판이 바뀌면 동의를 다시 받아야 한다',async()=>{
  const state=fresh(),source=state.lessons[0]
  let current=(await execute(state,manager,{type:'school_day',date:source.date,classIds:source.classIds,closed:true,reason:'휴업'})).state
  current=(await execute(current,source.teacherId,{type:'propose',kind:'makeup',lessonIds:[source.id],targetDate:'2026-03-10',targetPeriod:7,reason:'보강'})).state
  const p=current.proposals.at(-1)
  const changedSlots=current.fixture.daySlots.map(slot=>({...slot,startTime:slot.startTime.slice(0,3)+String(Number(slot.startTime.slice(3))+1).padStart(2,'0'),endTime:slot.endTime.slice(0,3)+String(Number(slot.endTime.slice(3))+1).padStart(2,'0')}))
  current=(await execute(current,manager,{type:'special_day',date:source.date,classIds:current.fixture.classes.map(row=>row.id),slots:changedSlots,reason:'휴업일 일과 정정'})).state
  await assert.rejects(()=>execute(current,source.teacherId,{type:'consent',proposalId:p.id,decision:'accepted'}),code('LESSON_CHANGED'))
  // 반려는 실제 반영을 하지 않으므로 자료가 바뀐 요청도 안전하게 끝낸다.
  assert.equal((await execute(current,source.teacherId,{type:'consent',proposalId:p.id,decision:'rejected'})).state.proposals.at(-1).status,'rejected')
})
await test('저장 잠금 대기 중 로그아웃하면 디스크에 쓰지 않는다',async()=>{
  let release
  const gate=new Promise(resolve=>{release=resolve}),storage=memory()
  const store=await m.createPilotStore({fixture:fixture(),scope:'late-logout',storage,locks:{request:async(_name,callback)=>{await gate;return callback()}}})
  const state=store.snapshot(),source=state.lessons[0],pending=store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  store.dispose();release()
  await assert.rejects(()=>pending,code('SCOPE_CHANGED'));assert.equal(storage.values.size,0)
})
await test('두 탭의 동시 저장은 잠금 안에서 하나만 성공한다',async()=>{
  let queue=Promise.resolve()
  const serialLocks={request:(_name,callback)=>{const next=queue.then(callback);queue=next.catch(()=>undefined);return next}}
  const storage=memory(),a=await m.createPilotStore({fixture:fixture(),scope:'concurrent',storage,locks:serialLocks}),b=await m.createPilotStore({fixture:fixture(),scope:'concurrent',storage,locks:serialLocks}),state=a.snapshot(),source=state.lessons[0]
  const outcomes=await Promise.allSettled([
    a.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'첫 탭'})),
    b.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'둘째 탭'})),
  ])
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1)
  assert.equal(outcomes.find(row=>row.status==='rejected').reason.code,'STORAGE_CONFLICT')
})
await test('학기 전체 저장을 압축하고 외부 백업은 검증 가능한 JSON으로 유지한다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:m.getPilotFixture(),scope:'compressed-full',storage,locks})
  const state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'압축 저장 연습'}))
  const raw=[...storage.values.values()][0],backup=await store.exportFile()
  assert.ok(raw.startsWith(m.PILOT_STORAGE_PREFIX));assert.ok(backup.startsWith('{'))
  assert.ok(raw.length<backup.length/8,`${raw.length} / ${backup.length}`)
  assert.ok(raw.length*2<512*1024)
  const reloaded=await m.createPilotStore({fixture:m.getPilotFixture(),scope:'compressed-full',storage,locks})
  assert.equal(reloaded.snapshot().lessons.length,6696);assert.equal(reloaded.snapshot().records[0].note,'압축 저장 연습')
})
await test('기존 JSON 저장을 읽고 다음 저장 때만 압축 형식으로 바꾼다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:fixture(),scope:'legacy-json',storage,locks}),initial=store.snapshot(),first=initial.lessons[0]
  await store.transact(send(initial,first.teacherId,{type:'record',lessonId:first.id,expectedLessonVersion:1,note:'이전 형식'}))
  const key=[...storage.values.keys()][0],legacy=await store.exportFile();storage.values.set(key,legacy)
  const reopened=await m.createPilotStore({fixture:fixture(),scope:'legacy-json',storage,locks})
  assert.equal(storage.getItem(key),legacy);assert.equal(reopened.snapshot().records.length,1)
  const next=reopened.snapshot(),second=next.lessons[1]
  await reopened.transact(send(next,second.teacherId,{type:'record',lessonId:second.id,expectedLessonVersion:1,note:'새 형식'}))
  assert.ok(storage.getItem(key).startsWith(m.PILOT_STORAGE_PREFIX))
  await assert.rejects(()=>store.transact(send(next,second.teacherId,{type:'record',lessonId:second.id,expectedLessonVersion:1,note:'옛 탭'})),code('STORAGE_CONFLICT'))
})
await test('손상된 gzip·CRC·UTF-8·추가 gzip 문서는 덮어쓰지 않고 거부한다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:fixture(),scope:'bad-gzip',storage,locks}),state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  const key=[...storage.values.keys()][0],original=storage.getItem(key)
  const bytes=Buffer.from(original.slice(m.PILOT_STORAGE_PREFIX.length),'base64')
  const badCrc=Buffer.from(bytes);badCrc[badCrc.length-8]^=1
  const badHeader=Buffer.from(bytes);badHeader[0]=0
  const invalidUtf8=m.gzipSync(new Uint8Array([0xff]),{mtime:0})
  const joined=Buffer.concat([bytes,bytes])
  for(const raw of [
    m.PILOT_STORAGE_PREFIX+'!!!!',
    m.PILOT_STORAGE_PREFIX+badCrc.toString('base64'),
    m.PILOT_STORAGE_PREFIX+badHeader.toString('base64'),
    m.PILOT_STORAGE_PREFIX+Buffer.from(invalidUtf8).toString('base64'),
    m.PILOT_STORAGE_PREFIX+joined.toString('base64'),
  ]){
    storage.values.set(key,raw)
    await assert.rejects(()=>m.createPilotStore({fixture:fixture(),scope:'bad-gzip',storage,locks}),code('INVALID_INPUT'))
    assert.equal(storage.getItem(key),raw)
  }
})
await test('압축 길이 선언을 위조해도 실제 해제 출력 24MB에서 멈춘다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:fixture(),scope:'gzip-bomb',storage,locks}),state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  const key=[...storage.values.keys()][0]
  const bomb=m.gzipSync(new Uint8Array(m.PILOT_BACKUP_MAX_BYTES+1).fill(65),{level:9,mtime:0})
  // 마지막 ISIZE를 작게 위조해 사전 선언 검사 대신 스트리밍 누적 검사를 실제로 통과시킨다.
  new DataView(bomb.buffer,bomb.byteOffset+bomb.length-4,4).setUint32(0,1,true)
  const raw=m.PILOT_STORAGE_PREFIX+Buffer.from(bomb).toString('base64');storage.values.set(key,raw)
  await assert.rejects(()=>m.createPilotStore({fixture:fixture(),scope:'gzip-bomb',storage,locks}),error=>error.code==='INVALID_INPUT'&&error.message.includes('24MB'))
  assert.equal(storage.getItem(key),raw)
})
await test('압축 입력 자체의 8MB 한도도 해제 전에 검사한다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:fixture(),scope:'gzip-large',storage,locks}),state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:''}))
  const key=[...storage.values.keys()][0],raw=m.PILOT_STORAGE_PREFIX+'AAAA'.repeat(Math.ceil(m.PILOT_STORAGE_COMPRESSED_MAX_BYTES/3)+1);storage.values.set(key,raw)
  await assert.rejects(()=>m.createPilotStore({fixture:fixture(),scope:'gzip-large',storage,locks}),code('INVALID_INPUT'))
})
await test('gzip가 정상이어도 원 JSON 체크섬이 다르면 거부하고 압축파일 직접 복원을 받지 않는다',async()=>{
  const storage=memory(),store=await m.createPilotStore({fixture:fixture(),scope:'gzip-checksum',storage,locks}),state=store.snapshot(),source=state.lessons[0]
  await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:'원문'}))
  const key=[...storage.values.keys()][0],original=storage.getItem(key)
  await assert.rejects(()=>store.restoreFile(original),code('INVALID_INPUT'))
  const changed=(await store.exportFile()).replace('원문','변조')
  storage.values.set(key,m.PILOT_STORAGE_PREFIX+Buffer.from(m.gzipSync(new TextEncoder().encode(changed),{mtime:0})).toString('base64'))
  await assert.rejects(()=>m.createPilotStore({fixture:fixture(),scope:'gzip-checksum',storage,locks}),code('INVALID_INPUT'))
})
await test('5MB 저장소에서 학교·계정 두 범위의 학기 전체가 함께 저장된다',async()=>{
  const storage=memory()
  const quotaStorage={getItem:storage.getItem,setItem:(key,value)=>{
    const next=new Map(storage.values);next.set(key,value)
    if([...next].reduce((sum,[key,value])=>sum+2*(key.length+value.length),0)>5*1024*1024)throw new Error('QuotaExceededError')
    storage.setItem(key,value)
  }}
  for(const scope of ['scope-A','scope-B']){
    const store=await m.createPilotStore({fixture:m.getPilotFixture(),scope,storage:quotaStorage,locks}),state=store.snapshot(),source=state.lessons[0]
    await store.transact(send(state,source.teacherId,{type:'record',lessonId:source.id,expectedLessonVersion:1,note:scope}))
    assert.equal(store.snapshot().records.length,1)
  }
  assert.equal(storage.values.size,2)
  for(const scope of ['scope-A','scope-B']){
    const store=await m.createPilotStore({fixture:m.getPilotFixture(),scope,storage:quotaStorage,locks})
    assert.equal(store.snapshot().records[0].note,scope)
  }
})
console.log(`학교 시간표 운영 연습 ${count}건 통과`)
