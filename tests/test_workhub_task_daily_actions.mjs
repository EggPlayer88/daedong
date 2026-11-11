import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { parseWorkspaceCommand: parse, reviewAssistantTaskChange: review, prepareTaskOperation: prepare, executeWorkspaceOperation: execute, TASK_INPUT_LIMITS: limits, renderCard, renderTaskCard } = await loadBrowserModule(`
 export { parseWorkspaceCommand } from '../apps/workhub/src/assistant/workspace-commands.ts'
 export * from '../apps/workhub/src/tasks/assistant-change.ts'
 export * from '../apps/workhub/src/assistant/workspace-operations.ts'
 export { TASK_INPUT_LIMITS } from '../apps/workhub/src/tasks/validation.ts'
 import { renderToStaticMarkup } from 'react-dom/server'
 import { WorkspaceOperationCard } from '../apps/workhub/src/assistant/WorkspaceOperationCard.tsx'
 import { TaskChangeConfirmation } from '../apps/workhub/src/tasks/TaskChangeConfirmation.tsx'
 export const renderCard = props => renderToStaticMarkup(<WorkspaceOperationCard {...props} />)
 export const renderTaskCard = props => renderToStaticMarkup(<TaskChangeConfirmation {...props} />)
`)
const date = '2026-11-11'
const member = { id:'m-1', schoolId:'s-1', userId:'u-1', name:'합성 교사', active:true, role:'teacher', validFrom:'2026-03-01', validThrough:'2027-02-28', departmentIds:[], gradeIds:[], subjectIds:[] }
const original = { id:'task-one', schoolId:member.schoolId, ownerMemberId:member.id, version:4, title:'제출 자료 확인', notes:'원래 메모', dueDate:'2026-11-20', status:'doing' }
const request = (change, task=original) => ({ key:'daily-original-key', schoolId:member.schoolId, memberId:member.id, basisDate:date, taskId:task.id, expectedVersion:task.version, title:task.title, change })
function fixture(initial = original) {
 let current = structuredClone(initial), calls = [], saved, failOnce = false
 return { calls, setCurrent(value) { current=structuredClone(value) }, dropResponse() { failOnce=true }, task: {
   async get(memberId, id) { calls.push(['get',memberId,id]); return structuredClone(current) },
   async update(memberId,id,input,version,key) { calls.push(['update',memberId,id,structuredClone(input),version,key]); saved ??= {...structuredClone(current),...input,version:version+1}; current=structuredClone(saved); if(failOnce){failOnce=false;throw Error('응답 유실')}return structuredClone(saved) },
   async setStatus(memberId,id,status,version,key) { calls.push(['status',memberId,id,status,version,key]); saved ??= {...structuredClone(current),status,version:version+1}; current=structuredClone(saved); if(failOnce){failOnce=false;throw Error('응답 유실')}return structuredClone(saved) },
 }, calendar:{} }
}
const writes = f => f.calls.filter(call=>call[0]!=='get')
let failed=0
async function test(name, action) {try { await action(); console.log('  ✓ '+name) }catch(error){failed++;console.log('  ✗ '+name+': '+error.stack)}}

await test('할 일 맥락의 제목 변경은 대상 검색과 새 제목만 준비한다',()=>{
 for(const text of ['할 일 제출 자료 확인 제목을 안내장 확인으로 바꿔줘','내 할 일 제출 자료 확인의 제목을 안내장 확인으로 수정해 주세요']) {
   const value=parse(text,date); assert.equal(value.kind,'taskChange');assert.equal(value.query,original.title);assert.deepEqual(value.change,{kind:'title',value:'안내장 확인'})
 }
})
await test('기존 다섯 상태는 표시 명칭과 같은 단일 상태 변경으로 분류한다',()=>{
 for(const [label,status] of [['할 일','todo'],['진행 중','doing'],['대기','waiting'],['완료','done'],['취소','cancelled']]) {
  const value=parse(`할 일 제출 자료 확인 상태를 ${label}로 바꿔줘`,date);assert.equal(value.kind,'taskChange');assert.equal(value.query,original.title)
  assert.deepEqual(value.change,status==='done'?{kind:'complete'}:{kind:'status',value:status})
 }
})
await test('다시 시작과 재개는 명시한 할 일 한 건에만 연결한다',()=>{
 for(const text of ['할 일 제출 자료 확인을 다시 시작해줘','내 업무 제출 자료 확인 재개해 주세요']) {
  const value=parse(text,date);assert.equal(value.query,original.title);assert.deepEqual(value.change,{kind:'restart'})
 }
 for(const text of ['수업을 다시 시작해줘','이야기를 재개해줘','문서 제목을 자연스럽게 바꿔줘']) assert.equal(parse(text,date),null)
})
await test('일반 설명·인용·부정·여러 변경을 단일 할 일 쓰기로 해석하지 않는다',()=>{
 for(const text of ['"할 일 제출 자료 확인 다시 시작해줘"','할 일 제목을 어떻게 바꾸는지 설명해줘','할 일 제출 자료 확인 다시 시작하지 마']) assert.equal(parse(text,date),null,text)
 for(const text of ['할 일 모두 다시 시작해줘','할 일 제출 자료 확인 제목을 안내장 그리고 메모를 인쇄로 바꿔줘','할 일 제출 자료 확인 제목을 새 제목으로 바꾸고 완료해줘']) assert.equal(parse(text,date)?.kind,'clarify',text)
})
await test('대상·새 제목 누락, 미지원 상태, 제목 한도 초과는 조회 전 확인을 요청한다',()=>{
 for(const text of ['할 일 제목을 자료 확인으로 바꿔줘','할 일 제출 자료 확인 제목을 로 바꿔줘','할 일 제출 자료 확인 상태를 긴급으로 바꿔줘',`할 일 제출 자료 확인 제목을 ${'가'.repeat(limits.titleChars+1)}로 바꿔줘`]) assert.equal(parse(text,date)?.kind,'clarify',text)
 const value=parse(`할 일 제출 자료 확인 제목을 ${'😀'.repeat(limits.titleChars)}로 바꿔줘`,date);assert.equal(value.change.value,'😀'.repeat(limits.titleChars))
})
await test('제목 변경 검토는 원래 메모·기한·상태를 유지하며 저장은 별도다',async()=>{
 const f=fixture(), r=await prepare(f.task,request({kind:'title',value:'  안내장 확인  '}),member,date)
 assert.equal(r.task.field,'제목');assert.equal(r.task.before,original.title);assert.equal(r.task.after,'안내장 확인');assert.equal(writes(f).length,0)
 assert.deepEqual(r.task.command,{kind:'update',taskId:original.id,expectedVersion:4,input:{title:'안내장 확인',notes:original.notes,dueDate:original.dueDate}})
 const receipt=await execute(r,f,member,date);assert.equal(receipt.title,'안내장 확인');assert.equal(receipt.result.status,'doing');assert.equal(writes(f).length,1)
})
await test('완료·취소 업무의 다시 시작은 기존 todo 상태로 한 번 변경한다',async()=>{
 for(const status of ['done','cancelled']) {
  const task={...original,status}, f=fixture(task), r=await prepare(f.task,request({kind:'restart'},task),member,date)
  assert.equal(r.task.before,status==='done'?'완료':'취소');assert.equal(r.task.after,'할 일');assert.equal(writes(f).length,0)
  const receipt=await execute(r,f,member,date);assert.equal(receipt.result.status,'todo');assert.deepEqual(writes(f)[0],['status',member.id,task.id,'todo',4,r.key])
 }
})
await test('진행 가능한 할 일의 재개와 동일 상태·제목은 새 요청을 저장하지 않는다',async()=>{
 for(const status of ['todo','doing','waiting']) {
  const task={...original,status}, f=fixture(task)
  await assert.rejects(()=>prepare(f.task,request({kind:'restart'},task),member,date),/이미 진행/);assert.equal(writes(f).length,0)
 }
 for(const change of [{kind:'title',value:original.title},{kind:'status',value:original.status}]) await assert.rejects(()=>prepare(fixture().task,request(change),member,date),/같은/)
})
await test('취소된 할 일을 바로 완료하지 않고 재개부터 확인한다',()=>{
 const task={...original,status:'cancelled'}
 for(const change of [{kind:'complete'},{kind:'status',value:'done'}]) assert.throws(()=>review(request(change,task),task,member,date),/다시 시작/)
})
await test('명시 상태 변경은 다른 필드와 확인한 판을 보존한다',async()=>{
 for(const status of ['todo','waiting','cancelled']) {
  const f=fixture(), r=await prepare(f.task,request({kind:'status',value:status}),member,date), result=await execute(r,f,member,date)
  assert.deepEqual(result.result,{...original,status,version:5});assert.deepEqual(writes(f)[0],['status',member.id,original.id,status,4,r.key])
 }
})
await test('제목·재개·상태 변경 모두 원본 판 또는 내용이 달라지면 쓰기 전 멈춘다',async()=>{
 for(const [change,status] of [[{kind:'title',value:'새 제목'},'doing'],[{kind:'restart'},'done'],[{kind:'status',value:'waiting'},'doing']]) {
  const task={...original,status}, f=fixture(task), r=await prepare(f.task,request(change,task),member,date)
  f.setCurrent({...task,notes:'다른 창 수정'});await assert.rejects(()=>execute(r,f,member,date),error=>error.outcome==='not_saved'&&error.code==='CONFLICT');assert.equal(writes(f).length,0)
 }
})
await test('세 변경의 응답 유실은 다음 날도 조회 없이 원문과 원키로만 복구한다',async()=>{
 for(const [change,status] of [[{kind:'title',value:'새 제목'},'doing'],[{kind:'restart'},'done'],[{kind:'status',value:'waiting'},'doing']]) {
  const task={...original,status}, f=fixture(task), r=await prepare(f.task,request(change,task),member,date)
  f.dropResponse();await assert.rejects(()=>execute(r,f,member,date),error=>error.outcome==='unknown')
  f.task.get=async()=>{throw Error('새 원본 조회 금지')}
  const result=await execute(r,f,member,'2026-11-12',{retry:true});assert.equal(result.version,5);assert.deepEqual(writes(f)[0],writes(f)[1]);assert.equal(result.key,r.key)
 }
})
await test('잘못된 상태·추가 필드·깨진 제목 요청은 원본 조회도 호출하지 않는다',async()=>{
 for(const change of [{kind:'restart',value:'todo'},{kind:'status',value:'administrator'},{kind:'status',value:'todo',extra:true},{kind:'title',value:[]}]) {
  const f=fixture();await assert.rejects(()=>prepare(f.task,request(change),member,date));assert.equal(f.calls.length,0)
 }
 for(const title of ['', 'x'.repeat(limits.titleChars+1),'문자\0깨짐','\ud800']) await assert.rejects(()=>prepare(fixture().task,request({kind:'title',value:title}),member,date))
})
await test('제목이나 상태가 다른 접수증을 성공으로 표시하지 않는다',async()=>{
 for(const change of [{kind:'title',value:'새 제목'},{kind:'status',value:'waiting'}]) {
  const f=fixture(), r=await prepare(f.task,request(change),member,date)
  f.task.update=async()=>({...original,title:'틀린 제목',version:5});f.task.setStatus=async()=>({...original,status:'done',version:5})
  await assert.rejects(()=>execute(r,f,member,date),error=>error.outcome==='unknown')
 }
})
await test('일반·AI 확인 카드 모두 다시 시작과 상태 변경을 완료 버튼과 구분한다',async()=>{
 for(const [change,status,label] of [[{kind:'restart'},'done','확인한 할 일 다시 시작'],[{kind:'status',value:'waiting'},'doing','확인한 상태 변경'],[{kind:'title',value:'새 제목'},'doing','확인한 변경 저장']]) {
  const task={...original,status}, r=await prepare(fixture(task).task,request(change,task),member,date)
  assert.match(renderCard({review:r,status:'review'}),new RegExp(label));assert.match(renderTaskCard({review:r.task,disabled:false}),new RegExp(label))
  assert.doesNotMatch(renderCard({review:r,status:'review'}),/확인한 할 일 완료/)
 }
})
if(failed)process.exitCode=1
