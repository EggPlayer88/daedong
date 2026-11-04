import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseTaskChangeCommand: parse, reviewAssistantTaskChange: review, verifyTaskChangeReceipt: verify } = await loadBrowserModule(`
  export * from '../apps/workhub/src/assistant/task-change-command.ts'
  export * from '../apps/workhub/src/tasks/assistant-change.ts'
`)
const day = '2026-11-04', friday = '2026-11-06'
const member = {id:'my-member',schoolId:'my-school'}
const task = {id:'task-2',schoolId:member.schoolId,ownerMemberId:member.id,version:2,title:'제출 자료 확인',status:'doing',notes:'기존 메모',dueDate:'2026-11-10'}
const req = {key:'picked-key',schoolId:member.schoolId,memberId:member.id,basisDate:day,taskId:task.id,expectedVersion:2,title:task.title, change:{kind:'dueDate',value:friday}}
const change = text => parse(text,day)
const check = (name,fn) => { try {fn(); console.log('  ✓ '+name)} catch(error) { console.log('  ✗ '+name+': '+error.stack); process.exitCode=1 } }
check('기한 변경은 제목을 보존하고 가장 가까운 금요일 날짜를 보여 준다',()=>{
  const p='제출 자료 확인을 금요일까지로 바꿔줘'
  assert.deepEqual(change(p),{kind:'taskChange',prompt:p,query:task.title,change:req.change})
  assert.equal(change('내 할 일 제출 자료 확인 기한을 내일로 바꿔줘').query,task.title)
})
check('이번 주·다음 주를 월요일 기준으로 계산하고 오늘과 같은 요일은 오늘을 선택한다',()=>{
  for (const [date,want] of [['이번 주 월요일','2026-11-02'],['다음 주 일요일','2026-11-15'],['수요일',day],['내일','2026-11-05'],['2028-02-29','2028-02-29']]) assert.equal(change('제출 자료 확인을 '+date+'까지로 바꿔줘').change.value,want,date)
})
check('메모 교체·완료는 대상 한 건을 확인할 명령으로만 해석한다',()=>{
  assert.deepEqual(change('제출 자료 확인 메모를 배부 완료로 바꿔줘').change,{kind:'notes',value:'배부 완료'})
  assert.equal(change('제출 자료 확인의 메모를 인쇄 필요로 바꿔줘').query,task.title)
  assert.deepEqual(change('제출 자료 확인을 완료해줘').change,{kind:'complete'})
})
check('대상 누락·범위 전체·잘못된 날짜·비지원 변경은 확인만 요청한다',()=>{
  for(const p of ['완료해줘','할 일 전부 완료해줘','제출 자료 확인을 2026-02-30까지로 바꿔줘','제출 자료 확인 기한을 다음 학기로 바꿔줘','제출 자료 확인 수정해줘']) assert.equal(change(p)?.kind,'clarify',p)
})
check('원본의 다른 필드와 버전을 보존한 변경 전후 비교를 만든다',()=>{
  const result=review(req,task,member,day)
  assert.equal(result.key,req.key); assert.equal(result.before,task.dueDate); assert.equal(result.after,friday)
  assert.deepEqual(result.command,{kind:'update',taskId:task.id,expectedVersion:2,input:{title:task.title,notes:task.notes,dueDate:friday}})
  const note=review({...req,change:{kind:'notes',value:'수정 내용'}},task,member,day)
  assert.deepEqual(note.command.input,{title:task.title,notes:'수정 내용',dueDate:task.dueDate})
})
check('완료는 기존 상태 명령 한 건이며 이미 완료·취소한 업무는 새 저장이 없다',()=>{
  const done={...req,change:{kind:'complete'}}
  assert.deepEqual(review(done,task,member,day).command,{kind:'status',taskId:task.id,expectedVersion:2,status:'done'})
  for(const status of ['done','cancelled']) assert.throws(()=>review(done,{...task,status},member,day))
})
check('선택 후 판이나 제목이 달라지면 변경을 만들지 않는다',()=>{
  for(const stale of [{...task,version:3},{...task,title:'다른 제목'}]) assert.throws(()=>review(req,stale,member,day),/다시 선택/)
})
check('같은 이름의 다른 번호, 다른 학교·소속·기준일로 전달하면 거절한다',()=>{
  for(const wrong of [{...req,taskId:'task-1'},{...req,schoolId:'other'},{...req,memberId:'other'},{...req,basisDate:'2026-11-03'}]) assert.throws(()=>review(wrong,task,member,day))
})
check('서버가 같은 ID의 예전 판이나 다른 내용을 돌려줘도 성공으로 취급하지 않는다',()=>{
  const command=review(req,task,member,day).command
  const result={...task,dueDate:friday,version:3}
  verify(command,task,result)
  for (const wrong of [{...result,version:2},{...result,title:'바뀐 제목'},{...result,notes:'다른 메모'},{...result,status:'done'}]) assert.throws(()=>verify(command,task,wrong),err=>err.code==='SAVE_FAILED')
})
check('입력 한도와 동일한 변경 값은 원래 화면의 규칙으로 거절한다',()=>{
  assert.throws(()=>review({...req,change:{kind:'notes',value:task.notes}},task,member,day),/같은 내용/)
  assert.throws(()=>review({...req,change:{kind:'notes',value:'x'.repeat(2001)}},task,member,day))
  assert.throws(()=>review({...req,change:{kind:'dueDate',value:'2026-02-30'}},task,member,day))
})
