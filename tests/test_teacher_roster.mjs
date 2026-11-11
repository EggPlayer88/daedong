import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../apps/workhub/src/teacher-roster/contracts'; export * from '../apps/workhub/src/teacher-roster/server'; export * from '../apps/workhub/src/teacher-roster/published'; export * from '../apps/workhub/src/teacher-roster/calendar'`)
const fixture = JSON.parse(readFileSync(new URL('./fixtures/teacher-roster/nine-classes.json', import.meta.url), 'utf8')).plan
const p = () => structuredClone(fixture)
let total = 0
async function test(label, run) { await run(); total++; console.log('  ✓ '+label) }
await test('22명·9학급·288교시·157수업 원본 구조', () => { const v = m.localPlan(p()); assert.deepEqual([v.teachers.length,v.classes.length,v.lessons.length,v.courses.length],[22,9,288,157]); assert.equal(m.findings(v).length,0) })
for (const field of ['teachers','classes','courses','slots','lessons']) await test(field+' 중복 ID 거절', () => { const v=p(); v[field].push(v[field][0]); assert.throws(()=>m.localPlan(v),e=>e.code==='INVALID_INPUT') })
for (const [field,key,bad] of [['courses','teacherId','absent'],['courses','classId','absent'],['lessons','courseId','absent'],['lessons','slotId','absent'],['teachers','id','x'.repeat(81)],['teachers','name',String.fromCharCode(0x85)],['teachers','name',String.fromCharCode(0xd800)],['courses','weeklyHours',0],['slots','end',1441],['slots','day',8]]) await test(field+'.'+key+' 잘못된 참조·한도 거절',()=>{const v=p();v[field][0][key]=bad;assert.throws(()=>m.localPlan(v),e=>e.code==='INVALID_INPUT')})
await test('같은 학급·학년 중복 거절',()=>{const v=p();v.classes[1].grade=v.classes[0].grade;v.classes[1].number=v.classes[0].number;assert.throws(()=>m.localPlan(v))})
await test('담임은 명시한 교사·학급만 허용',()=>{const v=p();v.homerooms=[{classId:v.classes[0].id,teacherId:v.teachers[0].id}];assert.deepEqual(m.localPlan(v).homerooms,v.homerooms);v.homerooms[0].teacherId='absent';assert.throws(()=>m.localPlan(v))})
await test('교사 동시간 중복을 교시 번호와 무관하게 검출',()=>{const v=p();const a=v.lessons[0],c=v.courses.find(c=>c.id===a.courseId),s=v.slots.find(s=>s.id===a.slotId);v.slots.push({...s,id:'overlap',period:20,start:s.start+1});v.lessons.push({id:'extra',courseId:c.id,slotId:'overlap'});assert(m.findings(m.localPlan(v)).some(x=>x.code==='OVERLAP'))})
await test('시수가 모자라면 확정 전 안내',()=>{const v=p();v.lessons.pop();assert(m.findings(m.localPlan(v)).some(x=>x.code==='HOURS'))})
await test('빈 편성은 저장 가능하되 확정 차단',()=>{const v=p();v.lessons=[];assert(m.findings(m.localPlan(v)).some(x=>x.code==='EMPTY'))})
await test('이모지 이름은 정상 유니코드로 허용',()=>{const v=p();v.teachers[0].name='교사 🌱';assert.equal(m.localPlan(v).teachers[0].name,'교사 🌱')})
for(const [from,until]of[['2026-02-30','2027-01-01'],['2027-01-01','2026-01-01'],['2019-01-01','2027-01-01']])await test('잘못된 적용 기간 '+from,()=>assert.throws(()=>m.localPlan({...p(),from,until})))
const i={kind:'save',expectedRevision:0,plan:p()}, c={previewId:'preview-one',hash:'a'.repeat(64),intent:i}, key='request-one'
const receipt={requestKey:key,revision:1,kind:'save',targetId:i.plan.id}
await test('접수증과 원래 명령을 대조',()=>{assert.deepEqual(m.receipt(receipt,c,key),receipt);for(const patch of[{revision:2},{requestKey:'different'},{targetId:'other'},{kind:'link'}])assert.throws(()=>m.receipt({...receipt,...patch},c,key))})
await test('서버 닫기 확인 전에 결과를 추정하지 않음',()=>{assert.deepEqual(m.closeResult({outcome:'closed',receipt:null},c,key),{outcome:'closed',receipt:null});assert.throws(()=>m.closeResult({outcome:'applied',receipt:null},c,key));assert.throws(()=>m.closeResult({outcome:'closed',receipt},c,key))})
const member={id:'member-one',schoolId:'school-one',userId:'user-one',name:'관리자',role:'school_admin',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
let calls=[], first=true
const connection={info:()=>({memberships:[member],schools:[{id:member.schoolId}],basisDate:'2026-11-09'}),getIdentity:async()=>({userId:member.userId,approved:true,profile:{role:'superadmin',is_active:true,extra_permissions:[]}}),rpcVerified:async(name,args)=>{calls.push({name,args});if(first){first=false;throw Error('network')};return{contract:m.CONTRACT,schoolId:member.schoolId,memberId:member.id,data:receipt}}}
const server=m.createTeacherRosterServer(connection)
await test('잘못된 입력은 서버 호출 전에 거절',async()=>{await assert.rejects(async()=>server.preview(member.id,{...i,plan:{...p(),from:'invalid'}}),e=>e.code==='INVALID_INPUT');assert.equal(calls.length,0)})
await test('결과 미상 뒤 같은 번호·본문으로 복구',async()=>{await assert.rejects(()=>server.commit(member.id,c,key),e=>e.code==='RESULT_UNKNOWN');assert.deepEqual(await server.commit(member.id,c,key),receipt);assert.deepEqual(calls[0],calls[1]);await assert.rejects(()=>server.commit(member.id,{...c,intent:{...i,expectedRevision:1}},key),e=>e.code==='IDEMPOTENCY_CONFLICT')})
await test('조회 기간·기본표·내 교사 참조 대조',()=>{const v={date:fixture.from,timeZone:'Asia/Seoul',available:true,plans:[p()],myTeacherIds:[fixture.teachers[0].id]};assert.equal(m.published(v,v.date).plans.length,1);for(const patch of[{available:false},{date:'2020-01-01'},{myTeacherIds:['absent']},{plans:[p(),p()]}])assert.throws(()=>m.published({...v,...patch},v.date))})
await test('내 일정은 선택한 날짜·연결 교사의 기본 배치만 표시',()=>{const date=fixture.from,v={date,timeZone:'Asia/Seoul',available:true,plans:[p()],myTeacherIds:[fixture.teachers[0].id]};const rows=m.personalRosterDay(v);const expected=fixture.lessons.filter(l=>fixture.courses.find(c=>c.id===l.courseId).teacherId===v.myTeacherIds[0]&&fixture.slots.find(s=>s.id===l.slotId).day===1);assert.equal(rows.length,expected.length);assert(rows.every(r=>r.date===date));assert.deepEqual(m.personalRosterDay({...v,myTeacherIds:[]}),[]);assert.deepEqual(m.personalRosterDay({...v,available:false}),[]);assert.deepEqual(m.personalRosterDay({...v,date:'2026-11-22'}),[]);assert.deepEqual(m.personalRosterDay({...v,date:fixture.until}),[])})
console.log('명부 앱 검사',total,'통과')
