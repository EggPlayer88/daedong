import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule("export * from '../apps/workhub/src/timetable/operations-domain'")
const at=(hour,day='19')=>`2026-10-${day}T${String(hour).padStart(2,'0')}:00:00.000Z`
const now='2026-10-18T00:00:00.000Z'
const span=(hour,day='19')=>({startsAt:at(hour,day),endsAt:`2026-10-${day}T${String(hour).padStart(2,'0')}:45:00.000Z`})
const teacher=(id)=>({id:'teacher-'+id,kind:'teacher',memberId:id,capacity:1})
function snapshot(){
  return{contract:'timetable-operations.v1',schoolId:'school-1',basisRevisionId:'basis-1',revision:1,timeZone:'Asia/Seoul',
    coverage:{startsAt:at(0),endsAt:at(0,'24'),complete:true},
    members:['m1','m2','m3','manager'].map(id=>({id,accountId:'account-'+id,active:true,canApprove:id==='manager'})),
    resources:[teacher('m1'),teacher('m2'),teacher('m3'),{id:'group-1',kind:'group',memberId:null,capacity:1},{id:'room-1',kind:'room',memberId:null,capacity:2}],
    lessons:['m1','m2','m3'].map((memberId,i)=>({id:'lesson-'+(i+1),schoolId:'school-1',version:1,courseId:'course-'+(i+1),occurrenceKey:'weekly-'+(i+1),
      state:'scheduled',...span(i),allowedSpans:[0,1,2,3,4].map(h=>span(h)),teacherMemberIds:[memberId],resources:[{resourceId:'teacher-'+memberId,units:1},{resourceId:'group-1',units:1},{resourceId:'room-1',units:1}]})),
    unavailable:[],closed:[]}
}
async function proposal(s=snapshot(),patch={}){
  return m.createTimetableChangeProposal({schoolId:s.schoolId,basisRevisionId:s.basisRevisionId,kind:'swap',requesterMemberId:'m1',expiresAt:at(23),baseFingerprint:await m.operationsBaseFingerprint(s),
    moves:[{lessonId:'lesson-1',expectedVersion:1,from:span(0),to:span(1)},{lessonId:'lesson-2',expectedVersion:1,from:span(1),to:span(0)}],...patch})
}
async function move(s=snapshot(),destination=span(3),patch={}){return proposal(s,{kind:'move',moves:[{lessonId:'lesson-1',expectedVersion:1,from:span(0),to:destination}],...patch})}
const codes=result=>result.issues.map(issue=>issue.code)
const consent=(p,memberId)=>({memberId,accountId:'account-'+memberId,proposalFingerprint:p.proposalFingerprint,baseFingerprint:p.baseFingerprint,response:'accepted',respondedAt:now})
let count=0
async function check(name,test){await test();count++;console.log('  ✓ '+name)}
await check('현재 전체 조회에서 두 교사 수업 교환을 검증하고 서버 재검사 필요를 명시한다',async()=>{
  const s=snapshot(),p=await proposal(s),r=await m.validateTimetableChange(s,p,now)
  assert.equal(r.status,'valid');assert.deepEqual(r.requiredMemberIds,['m1','m2']);assert.equal(r.serverRevalidationRequired,true)
})
await check('3자 순환 교환도 원래 시간의 순열로 검증한다',async()=>{
  const s=snapshot(),p=await proposal(s,{moves:s.lessons.map((l,i)=>({lessonId:l.id,expectedVersion:1,from:span(i),to:span((i+1)%3)}))})
  assert.equal((await m.validateTimetableChange(s,p,now)).status,'valid')
})
await check('하나의 수업을 빈 시간으로 이동한다',async()=>{const s=snapshot();assert.equal((await m.validateTimetableChange(s,await move(s),now)).status,'valid')})
await check('입력 객체를 수정하지 않는다',async()=>{const s=snapshot(),p=await proposal(s),before=JSON.stringify([s,p]);await m.validateTimetableChange(s,p,now);assert.equal(JSON.stringify([s,p]),before)})
await check('정렬만 다른 조회 자료는 같은 기준 지문이다',async()=>{const s=snapshot(),other=structuredClone(s);other.lessons.reverse();other.resources.reverse();other.members.reverse();other.lessons[0].resources.reverse();assert.equal(await m.operationsBaseFingerprint(s),await m.operationsBaseFingerprint(other))})
await check('수업 version이 달라지면 이전 제안의 기준을 재사용하지 않는다',async()=>{const s=snapshot(),p=await proposal(s);s.lessons[0].version++;assert.equal((await m.validateTimetableChange(s,p,now)).status,'stale')})
await check('기준판 변경은 같은 배치라도 재미리보기가 필요하다',async()=>{const s=snapshot(),p=await proposal(s);s.basisRevisionId='basis-2';assert.ok(codes(await m.validateTimetableChange(s,p,now)).includes('BASIS_CHANGED'))})
await check('전체 자원 조회가 아니면 충돌 없음이라고 표시하지 않는다',async()=>{const s=snapshot();s.coverage.complete=false;assert.equal((await m.validateTimetableChange(s,await proposal(s),now)).status,'unsupported')})
await check('제안 지문을 유지한 채 목적지나 요청자를 바꾸면 거부한다',async()=>{for(const edit of [p=>p.moves[0].to=span(3),p=>p.requesterMemberId='m3']){const s=snapshot(),p=await proposal(s);edit(p);assert.ok(codes(await m.validateTimetableChange(s,p,now)).includes('PROPOSAL_TAMPERED'))}})
await check('다른 학교 proposal은 거부한다',async()=>{const s=snapshot(),p=await proposal(s,{schoolId:'other'});assert.ok(codes(await m.validateTimetableChange(s,p,now)).includes('SCHOOL_MISMATCH'))})
await check('다른 학교 수업을 조회에 섞을 수 없다',()=>{const s=snapshot();s.lessons[0].schoolId='other';assert.throws(()=>m.parseOperationsSnapshot(s))})
await check('미지원 대강·휴강·보강을 실제 검증 완료로 표현하지 않는다',async()=>{for(const kind of ['substitute','cancel','makeup']){const s=snapshot();assert.equal((await m.validateTimetableChange(s,await proposal(s,{kind}),now)).status,'unsupported')}})
await check('만료된 제안은 재확인이 필요하다',async()=>{const s=snapshot();assert.ok(codes(await m.validateTimetableChange(s,await proposal(s,{expiresAt:now}),now)).includes('CHANGE_EXPIRED'))})
await check('요청자의 비활성 소속과 본인 수업이 없는 요청을 막는다',async()=>{
  for(const inactive of [true,false]){const s=snapshot();if(inactive)s.members[0].active=false;const p=await proposal(s,{requesterMemberId:inactive?'m1':'manager'});assert.equal((await m.validateTimetableChange(s,p,now)).status,'invalid')}
})
await check('관련 교사 소속이 끝나면 동의를 재검토한다',async()=>{const s=snapshot();s.members[1].active=false;assert.ok(codes(await m.validateTimetableChange(s,await proposal(s),now)).includes('PARTICIPANT_INACTIVE'))})
await check('없는 수업과 정확하지 않은 기대판을 거부한다',async()=>{for(const edit of [moves=>moves[0].lessonId='missing',moves=>moves[0].expectedVersion=2,moves=>moves[0].from=span(3)]){const s=snapshot(),base=await proposal(s),{proposalFingerprint,...input}=base;edit(input.moves);assert.equal((await m.validateTimetableChange(s,await m.createTimetableChangeProposal(input),now)).status,'stale')}})
await check('중복 수업 ID를 한 제안에 넣을 수 없다',async()=>{const s=snapshot(),p=await proposal(s),{proposalFingerprint,...input}=p;input.moves.push(input.moves[0]);await assert.rejects(()=>m.createTimetableChangeProposal(input))})
await check('이동은 하나, 교환은 둘 이상만 받는다',async()=>{const s=snapshot();for(const patch of [{kind:'move'},{moves:[]},{moves:[{lessonId:'lesson-1',expectedVersion:1,from:span(0),to:span(1)}]}])assert.equal((await m.validateTimetableChange(s,await proposal(s,patch),now)).status,'invalid')})
await check('실시 또는 취소된 원수업은 예정 변경으로 덮어쓰지 않는다',async()=>{for(const state of ['performed','cancelled']){const s=snapshot();s.lessons[0].state=state;assert.ok(codes(await m.validateTimetableChange(s,await move(s),now)).includes('LESSON_NOT_SCHEDULED'))}})
await check('과거 시각과 조회 밖 목적지를 거부한다',async()=>{for(const destination of [span(3,'17'),span(3,'25')]){const s=snapshot();assert.equal((await m.validateTimetableChange(s,await move(s,destination),now)).status,'invalid')}})
await check('시작한 원수업은 미래로 옮기지 않는다',async()=>{const s=snapshot();assert.ok(codes(await m.validateTimetableChange(s,await move(s),at(0))).includes('PAST_LESSON'))})
await check('길이가 달라지거나 날짜를 넘기는 목적지를 거부한다',async()=>{
  const s=snapshot(),long={startsAt:at(3),endsAt:at(4)};assert.ok(codes(await m.validateTimetableChange(s,await move(s,long),now)).includes('DURATION_CHANGED'))
  const overnight={startsAt:'2026-10-19T14:45:00.000Z',endsAt:'2026-10-19T15:30:00.000Z'};assert.ok(codes(await m.validateTimetableChange(s,await move(s,overnight),now)).includes('OVERNIGHT_UNSUPPORTED'))
})
await check('실제 시각으로 겹침을 검사하고 인접 구간은 허용한다',async()=>{
  const s=snapshot();assert.ok(codes(await m.validateTimetableChange(s,await move(s,{startsAt:at(1),endsAt:'2026-10-19T01:45:00.000Z'}),now)).includes('RESOURCE_CONFLICT'))
  assert.equal((await m.validateTimetableChange(s,await move(s,{startsAt:'2026-10-19T01:45:00.000Z',endsAt:'2026-10-19T02:30:00.000Z'}),now)).status,'invalid')
  s.lessons=s.lessons.filter(l=>l.id!=='lesson-3');s.lessons[0].allowedSpans.push({startsAt:'2026-10-19T01:45:00.000Z',endsAt:'2026-10-19T02:30:00.000Z'})
  assert.equal((await m.validateTimetableChange(s,await move(s,{startsAt:'2026-10-19T01:45:00.000Z',endsAt:'2026-10-19T02:30:00.000Z'}),now)).status,'valid')
})
await check('교환이라는 이름으로 원래 시간 외 슬롯을 넣지 못한다',async()=>{const s=snapshot(),p=await proposal(s),{proposalFingerprint,...input}=p;input.moves[0].to=span(4);assert.ok(codes(await m.validateTimetableChange(s,await m.createTimetableChangeProposal(input),now)).includes('SWAP_NOT_PERMUTATION'))})
await check('수업 불가시간과 휴업 구간은 이유 상세 없이 충돌로 알린다',async()=>{
  for(const resource of [true,false]){const s=snapshot();if(resource)s.unavailable=[{resourceId:'teacher-m1',...span(3)}];else s.closed=[span(3)];const r=await m.validateTimetableChange(s,await move(s),now);assert.ok(codes(r).includes(resource?'RESOURCE_UNAVAILABLE':'SCHOOL_CLOSED'))}
})
await check('특별실 용량은 누적 사용량을 검사한다',async()=>{
  const s=snapshot();s.lessons.forEach((l,i)=>{const groupId='separate-group-'+i;s.resources.push({id:groupId,kind:'group',memberId:null,capacity:1});l.resources=l.resources.map(r=>r.resourceId==='group-1'?{resourceId:groupId,units:1}:r)});s.lessons[2]={...s.lessons[2],...span(1)}
  assert.ok(codes(await m.validateTimetableChange(s,await move(s,span(1)),now)).includes('RESOURCE_CONFLICT'))
  s.resources.find(r=>r.id==='room-1').capacity=3
  assert.equal((await m.validateTimetableChange(s,await move(s,span(1)),now)).status,'valid')
})
await check('선택수강 학생 자원을 공유하면 행정학급이 달라도 막는다',async()=>{
  const s=snapshot();s.resources.push({id:'student-opaque-1',kind:'student',memberId:null,capacity:1});s.lessons.forEach(l=>{l.resources=l.resources.filter(r=>r.resourceId!=='group-1');l.resources.push({resourceId:'student-opaque-1',units:1})})
  const r=await m.validateTimetableChange(s,await move(s,span(1)),now);assert.ok(r.issues.some(i=>i.resourceIds.includes('student-opaque-1')))
})
await check('팀티칭의 모든 교사가 필요한 동의자에 포함된다',async()=>{
  const s=snapshot();s.lessons[0].teacherMemberIds.push('m3');s.lessons[0].resources.push({resourceId:'teacher-m3',units:1})
  const p=await proposal(s);assert.deepEqual((await m.validateTimetableChange(s,p,now)).requiredMemberIds,['m1','m2','m3'])
})
await check('교사 목록과 실제 교사 자원의 누락·중복을 거부한다',()=>{
  for(const edit of [s=>s.lessons[0].resources=s.lessons[0].resources.filter(r=>r.resourceId!=='teacher-m1'),s=>s.lessons[0].resources.push(s.lessons[0].resources[0]),s=>s.resources[0].capacity=2,s=>s.resources[0].memberId='unknown']){const s=snapshot();edit(s);assert.throws(()=>m.parseOperationsSnapshot(s))}
})
await check('동의 전원과 대리 담당자가 있으면 승인 전 사전 검사를 통과한다',async()=>{const s=snapshot(),p=await proposal(s);assert.equal((await m.validateTimetableApproval(s,p,['m1','m2'].map(id=>consent(p,id)),'manager',now)).status,'valid')})
await check('읽음·무응답은 동의가 아니고 한 명 거절도 반영을 막는다',async()=>{
  const s=snapshot(),p=await proposal(s)
  assert.ok(codes(await m.validateTimetableApproval(s,p,[consent(p,'m1')],'manager',now)).includes('CONSENT_MISSING'))
  const declined={...consent(p,'m2'),response:'rejected'}
  assert.ok(codes(await m.validateTimetableApproval(s,p,[consent(p,'m1'),declined],'manager',now)).includes('CONSENT_REJECTED'))
  assert.ok(codes(await m.validateTimetableApproval(s,p,[{...consent(p,'m1'),response:'read'}],'manager',now)).includes('INVALID_CONSENT'))
})
await check('다른 제안·기준판·계정·미래시각 동의를 재사용하지 못한다',async()=>{
  for(const patch of [{proposalFingerprint:'0'.repeat(64)},{baseFingerprint:'1'.repeat(64)},{accountId:'other'},{respondedAt:at(1)}]){const s=snapshot(),p=await proposal(s);assert.equal((await m.validateTimetableApproval(s,p,[{...consent(p,'m1'),...patch},consent(p,'m2')],'manager',now)).status,'stale')}
})
await check('동의자 중복과 불필요한 타인 동의를 거부한다',async()=>{
  const s=snapshot(),p=await proposal(s)
  for(const data of [[consent(p,'m1'),consent(p,'m1')],[consent(p,'m1'),consent(p,'m2'),consent(p,'m3')]])assert.equal((await m.validateTimetableApproval(s,p,data,'manager',now)).status,'invalid')
})
await check('승인 권한 없는 교사와 같은 계정의 다른 소속을 통한 자기승인을 막는다',async()=>{
  const s=snapshot(),p=await proposal(s),all=['m1','m2'].map(id=>consent(p,id))
  assert.ok(codes(await m.validateTimetableApproval(s,p,all,'m3',now)).includes('APPROVER_REQUIRED'))
  s.members.find(member=>member.id==='manager').accountId='account-m1';const changed=await proposal(s)
  assert.ok(codes(await m.validateTimetableApproval(s,changed,['m1','m2'].map(id=>consent(changed,id)),'manager',now)).includes('SELF_APPROVAL_DENIED'))
})
await check('동의 이후 수업을 수정하면 동의를 모았어도 최신 검증에서 멈춘다',async()=>{const s=snapshot(),p=await proposal(s);s.lessons[1].version++;assert.equal((await m.validateTimetableApproval(s,p,['m1','m2'].map(id=>consent(p,id)),'manager',now)).status,'stale')})
await check('깨진 날짜·추가 권한 필드·무한값·없는 자원·학교 시각대는 거부한다',()=>{
  for(const edit of [s=>s.lessons[0].startsAt='2026-02-30T00:00:00.000Z',s=>s.admin=true,s=>s.resources[0].capacity=Infinity,s=>s.resources.find(r=>r.kind==='room').capacity=10001,s=>s.lessons[0].resources[0].resourceId='missing',s=>s.timeZone='not-a-zone']){const s=snapshot();edit(s);assert.throws(()=>m.parseOperationsSnapshot(s))}
})
await check('합성 이동 후 날짜별 수업 ID·수강·교사·실시 원장을 변경하지 않는다',async()=>{const s=snapshot(),p=await move(s),before=structuredClone(s);await m.validateTimetableChange(s,p,now);assert.deepEqual(s,before);assert.equal(s.lessons[0].id,'lesson-1')})
await check('백 개 초과의 변경으로 검증 작업을 무제한 키우지 않는다',async()=>{const s=snapshot(),p=await proposal(s),{proposalFingerprint,...input}=p;input.moves=Array.from({length:101},(_,i)=>({...p.moves[0],lessonId:'id-'+i}));await assert.rejects(()=>m.createTimetableChangeProposal(input))})
await check('학생 집단이 빠진 교사만의 수업은 완전한 입력으로 보지 않는다',()=>{const s=snapshot();s.lessons[0].resources=s.lessons[0].resources.filter(r=>r.resourceId!=='group-1');assert.throws(()=>m.parseOperationsSnapshot(s))})
await check('조회 범위가 완전해도 공식 일과에 없는 밤 시간으로 옮기지 않는다',async()=>{const s=snapshot();const r=await m.validateTimetableChange(s,await move(s,span(18)),now);assert.ok(codes(r).includes('TARGET_NOT_ALLOWED'))})
await check('같은 시간 교환도 상대 학년 일과가 허용하지 않으면 거부한다',async()=>{const s=snapshot();s.lessons[0].allowedSpans=s.lessons[0].allowedSpans.filter(item=>item.startsAt!==at(1));assert.ok(codes(await m.validateTimetableChange(s,await proposal(s),now)).includes('TARGET_NOT_ALLOWED'))})
await check('공식 허용 시간대가 바뀌면 기존 동의를 재사용하지 않는다',async()=>{const s=snapshot(),p=await proposal(s);s.lessons[0].allowedSpans=s.lessons[0].allowedSpans.filter(item=>item.startsAt!==at(1));assert.equal((await m.validateTimetableChange(s,p,now)).status,'stale')})
console.log(`시간표 날짜별 운영 사전 검증 ${count}건 통과`)
