import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

// 실제 앱의 도메인·전달·응답 검증 코드를 연결한다. AI 응답과 수합 저장은 기존 메모리 연습 구현이다.
// 이 시험은 실제 DB·Storage·Claude·메시지 전송 성공을 증명하지 않는다.
const api=await loadBrowserModule(`
export * from '../apps/workhub/src/assistant/practice/runtime.ts'
export {freshAssistantInput} from '../apps/workhub/src/assistant/contracts.ts'
export {documentAssistantRequest,assistantDocumentDraft} from '../apps/workhub/src/app/pilot-handoff.ts'
export {createWorkflowStore,validateWorkflowSnapshot} from '../apps/workhub/src/workflows/store.ts'
export {blankMessageDraft,messageAttempt,retryMessageAttempt} from '../apps/workhub/src/messaging/composer.ts'
export {receipt as messageReceipt} from '../apps/workhub/src/messaging/validation.ts'
export {getPilotFixture} from '../apps/workhub/src/timetable/pilot/fixture.ts'
export {createPilotState,applyPilotCommand,recommendPilotSwaps} from '../apps/workhub/src/timetable/pilot/operations.ts'
export {projectTimetableCalendar} from '../apps/workhub/src/timetable/operations-calendar.ts'
`)
let passed=0,failed=0,teachersExercised=0,networkCalls=0,serial=0
async function test(name,run){try{await run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
const runtime=api.createAssistantPracticeRuntime(),schools=runtime.fixture.schools
const store=api.createWorkflowStore({members:schools.flatMap(s=>s.members),date:runtime.fixture.date})
const seed=api.getPilotFixture(),week={...seed,dateRange:{startsOn:runtime.fixture.date,endsOn:runtime.fixture.date},defaultDate:runtime.fixture.date}
const pilot=api.createPilotState(week)
const requests=new Map(),drafts=new Map(),threads=new Map()
const originalFetch=globalThis.fetch
globalThis.fetch=async()=>{networkCalls++;throw new Error('가상 통합 시험에서 외부 네트워크를 호출했습니다.')}
const rejects=(run,code)=>assert.rejects(run,error=>error.code===code)
const throws=(run,code)=>assert.throws(run,error=>error.code===code)
const command=(state,actorId,value)=>({requestId:'virtual-flow-'+(++serial),actorId,expectedRevision:state.revision,command:value})

// 두 연습 자료의 교사 ID는 서로 다르다. 시험에서만 시드 순서의 명시 대응표를 만들며 이름을 추정하지 않는다.
function calendarView(state,school){
  const members=new Map(seed.teachers.map((teacher,index)=>[teacher.id,school.members[index]]))
  return {timeZone:'Asia/Seoul',lessons:state.lessons.map(lesson=>{
    const teacher=members.get(lesson.teacherId)
    assert(teacher,'시드 교사의 명시 대응표가 필요합니다.')
    return {id:school.id+'-'+lesson.id,version:lesson.version,label:lesson.subject,
      teachers:[{id:teacher.id,name:teacher.name}],groupNames:lesson.classIds.map(id=>seed.classes.find(c=>c.id===id).label),
      roomNames:[seed.rooms.find(room=>room.id===lesson.roomId).label],state:lesson.status,
      time:{startsAt:new Date(lesson.date+'T'+lesson.startTime+':00+09:00').toISOString(),endsAt:new Date(lesson.date+'T'+lesson.endTime+':00+09:00').toISOString()}}
  })}
}
try {
await test('2개 학교 72교사의 시간표 일정은 원본 ID·시각·판을 보존하고 다른 학교로 섞이지 않는다',()=>{
  for(const school of schools){
    const view=calendarView(pilot,school)
    for(const member of school.members){
      const items=api.projectTimetableCalendar(view,member.id)
      const expected=view.lessons.filter(l=>l.teachers.some(t=>t.id===member.id))
      assert.equal(items.length,expected.length)
      assert.equal(new Set(items.map(i=>i.id)).size,items.length)
      for(const item of items){
        const lesson=expected.find(l=>l.id===item.lessonId)
        assert(lesson);assert.equal(item.id,'timetable:'+lesson.id);assert.equal(item.version,lesson.version)
        assert.equal(item.startsAt,lesson.time.startsAt);assert.equal(item.readOnly,true);assert.equal(item.sourceModule,'timetable')
      }
      const other=schools.find(s=>s.id!==school.id)
      assert.deepEqual(api.projectTimetableCalendar(calendarView(pilot,other),member.id),[])
    }
  }
})
await test('학교별 담당자가 36개 제출 단위를 배부하며 아직 제출·메시지·AI 답변을 만들지 않는다',()=>{
  for(const school of schools){
    const owner=school.members[0],input={title:'가상 일과 변경 확인',instructions:'시간표를 확인하고 교사가 최종 내용을 제출합니다.',
      dueDate:runtime.fixture.date,reviewMode:'none',reviewerMemberId:'',textLabel:'확인 내용',textRequired:true,numberLabel:'확인한 수업 수',numberRequired:true,
      units:school.members.map(member=>({label:member.id,responsibleMemberId:member.id,contributorMemberIds:[]}))}
    const draft=store.createCollection(owner.id,input,school.id+'-create')
    const request=store.publishCollection(owner.id,draft.id,draft.version,school.id+'-publish')
    requests.set(school.id,request)
    assert.equal(store.listUnits(owner.id,request.id).length,36)
  }
  assert.equal(store.exportState().submissions.length,0);assert.equal(store.exportState().drafts.length,0)
})
await test('72교사가 일정→AI 초안→명시 메시지 명령→수합 초안·제출을 수행하고 재전송은 중복되지 않는다',async()=>{
  for(const school of schools)for(const [index,member] of school.members.entries()){
    const session=runtime.select(member.id),request=requests.get(school.id)
    const unit=store.listUnits(member.id,request.id).find(u=>u.responsibleMemberId===member.id)
    const items=api.projectTimetableCalendar(calendarView(pilot,school),member.id)
    const initial=api.documentAssistantRequest({intent:'guided_collection',title:request.title,
      details:member.name+'의 확인 수업 '+items.length+'건. 최종 확인은 교사가 합니다.'})
    const input=api.freshAssistantInput({...initial,threadId:null,expectedVersion:0}),key=member.id+'-answer'
    const before=store.exportState().submissions.length
    runtime.setScenario(member.id,index%3===0?'lost_answer':index%3===1?'budget':'normal')
    let result
    if(index%3===0){await rejects(()=>session.server.ask(member.id,input,key),'RESULT_UNKNOWN');result=await session.server.ask(member.id,input,key)}
    else if(index%3===1){await rejects(()=>session.server.ask(member.id,input,key),'BUDGET_EXCEEDED');assert.equal(runtime.summary(member.id).completed,0);runtime.setScenario(member.id,'normal');result=await session.server.ask(member.id,input,key)}
    else result=await session.server.ask(member.id,input,key)
    assert.equal(result.state,'completed');assert.equal(runtime.summary(member.id).completed,1)
    const exchange=result.thread.exchanges[0]
    const document=api.assistantDocumentDraft({intent:exchange.intent,segments:exchange.segments,requestKey:key,threadId:result.thread.id,studentContext:null},member)
    assert.equal(document.schoolId,school.id);assert.equal(document.memberId,member.id)
    assert.equal(store.exportState().submissions.length,before);assert.equal(store.getDraft(member.id,unit.id),null)
    // AI 답변만으로 메시지를 만들지 않으며, 받는 사람을 선택하지 않으면 명령도 만들 수 없다.
    const draft={...api.blankMessageDraft(),body:document.body}
    throws(()=>api.messageAttempt(draft,member.id,member.id+'-message'),'INVALID_INPUT')
    const recipient=school.members[(index+1)%school.members.length]
    draft.recipients=[{memberId:recipient.id,schoolId:school.id,name:recipient.name,department:'',version:1}]
    const sent=api.messageAttempt(draft,member.id,member.id+'-message'),again=api.retryMessageAttempt(sent)
    assert.deepEqual(again,sent);assert.notEqual(again,sent);assert.equal(sent.command.body,document.body)
    // 합성 접수증을 실제 parser로 대조한다. 실제 전송이나 서버 멱등 처리 시험은 아니다.
    const receipt={requestKey:sent.key,kind:'start',recordedAt:runtime.fixture.date+'T01:00:00Z',
      deliveries:[{threadId:member.id+'-thread',messageId:member.id+'-message',recipientMemberIds:[recipient.id],sequence:1}],
      threadId:null,throughSequence:null,noticeId:null,version:null}
    assert.equal(api.messageReceipt(receipt,sent.command,sent.key,member.id).requestKey,sent.key)
    throws(()=>api.messageReceipt({...receipt,deliveries:[{...receipt.deliveries[0],recipientMemberIds:[schools.find(s=>s.id!==school.id).members[0].id]}]},sent.command,sent.key,member.id),'INVALID_RESPONSE')
    const saved=store.saveDraft(member.id,unit.id,{text:document.body,number:items.length},0,member.id+'-draft')
    assert.equal(store.unitSummary(member.id,unit.id).current,null)
    const submitted=store.submit(member.id,unit.id,saved.version,unit.version,member.id+'-submit')
    assert.deepEqual(store.submit(member.id,unit.id,saved.version,unit.version,member.id+'-submit'),submitted)
    assert.equal(store.unitSummary(member.id,unit.id).effective.id,submitted.id)
    assert.equal(store.exportState().submissions.length,before+1)
    assert.equal(store.homeSummary(member.id).pendingObligations.length,0)
    drafts.set(member.id,{unit,document});threads.set(member.id,result.thread.id);teachersExercised++
  }
  assert.equal(teachersExercised,72);assert.equal(store.exportState().submissions.length,72)
  assert.deepEqual(api.validateWorkflowSnapshot(store.exportState()),store.exportState())
})
await test('교사·학교를 바꾼 뒤 이전 AI 답변과 제출 전 초안에 접근하지 못한다',async()=>{
  const first=schools[0].members[1],other=schools[1].members[1],unit=drafts.get(first.id).unit
  const session=runtime.select(first.id),next=runtime.select(other.id)
  await rejects(()=>session.server.get(first.id,threads.get(first.id)),'CANCELLED')
  await rejects(()=>next.server.get(other.id,threads.get(first.id)),'NOT_FOUND')
  throws(()=>store.getDraft(other.id,unit.id),'NOT_FOUND')
  throws(()=>store.getDraft(schools[0].members[2].id,unit.id),'NOT_FOUND')
})
await test('수업 교환은 전원 수락·담당자 승인 전에는 일정에 반영되지 않고 승인 뒤 두 원본만 바뀐다',async()=>{
  const source=pilot.lessons[0],target=api.recommendPilotSwaps(pilot,source.id)[0];assert(target)
  let result=await api.applyPilotCommand(pilot,command(pilot,source.teacherId,{type:'propose',kind:'swap',lessonIds:[source.id,target.lessonId],reason:'가상 학교 통합 흐름'}))
  const proposal=result.state.proposals.at(-1),school=schools[0],before=calendarView(pilot,school)
  assert.deepEqual(calendarView(result.state,school),before)
  for(const id of proposal.requiredTeacherIds){result=await api.applyPilotCommand(result.state,command(result.state,id,{type:'consent',proposalId:proposal.id,decision:'accepted'}));assert.deepEqual(calendarView(result.state,school),before)}
  const approval=command(result.state,'pilot-manager-1',{type:'approve',proposalId:proposal.id})
  const approved=await api.applyPilotCommand(result.state,approval),repeated=await api.applyPilotCommand(approved.state,approval)
  assert.deepEqual(repeated.receipt,approved.receipt);assert.deepEqual(repeated.state,approved.state)
  const after=calendarView(approved.state,school),changed=after.lessons.filter(lesson=>JSON.stringify(lesson)!==JSON.stringify(before.lessons.find(l=>l.id===lesson.id)))
  assert.equal(changed.length,2);assert(changed.every(l=>l.version===2))
  for(const member of school.members){
    const projected=api.projectTimetableCalendar(after,member.id)
    for(const lesson of changed.filter(l=>l.teachers.some(t=>t.id===member.id)))assert.equal(projected.find(i=>i.lessonId===lesson.id).startsAt,lesson.time.startsAt)
  }
})
await test('휴업 수업은 일정에서도 취소 원본으로 남고 AI·수합 제출을 되살리거나 변경하지 않는다',async()=>{
  const before=store.exportState(),group=pilot.fixture.classes[0]
  const closed=await api.applyPilotCommand(pilot,command(pilot,'pilot-manager-1',{type:'school_day',date:runtime.fixture.date,classIds:[group.id],closed:true,reason:'가상 휴업'}))
  const affected=closed.state.lessons.filter(l=>l.classIds.includes(group.id))
  assert(affected.length);assert(affected.every(l=>l.status==='cancelled'))
  const view=calendarView(closed.state,schools[0])
  const calendar=schools[0].members.flatMap(member=>api.projectTimetableCalendar(view,member.id))
  for(const lesson of affected){const item=calendar.find(i=>i.lessonId===schools[0].id+'-'+lesson.id);assert(item);assert.equal(item.state,'cancelled');assert.equal(item.version,lesson.version)}
  assert.deepEqual(store.exportState(),before)
})
await test('모든 연습에서 외부 네트워크·실제 AI 호출을 사용하지 않는다',()=>assert.equal(networkCalls,0))
} finally {globalThis.fetch=originalFetch}
console.log(`가상 학교 업무 연결: ${passed} 통과, ${failed} 실패 · 가상 교사 ${teachersExercised}명 · 외부 요청 ${networkCalls}건`)
if(failed)process.exit(1)
