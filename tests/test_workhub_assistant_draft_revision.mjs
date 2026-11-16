import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { parseWorkspaceCommand, parseDraftRevision, reviseTaskDraft, reviseDraftFollowup, continueCalendar } = await loadBrowserModule(`
 export {parseWorkspaceCommand} from '../apps/workhub/src/assistant/workspace-commands.ts'
 export * from '../apps/workhub/src/assistant/draft-revision.ts'
 export * from '../apps/workhub/src/assistant/draft-followup.ts'
 export * from '../apps/workhub/src/assistant/calendar-conversation.ts'
`)
const date = '2026-11-16'
const task = Object.freeze({title:'채점 확인',notes:'1반\n2반',dueDate:'2026-11-19'})
const chosen = Object.freeze([{memberId:'member-one',displayName:'김하늘',version:3}])
const message = {command:{kind:'messageDraft',body:'기존 본문\n둘째 줄',prompt:'메시지 초안: 기존 본문\n둘째 줄'},selected:chosen,scope:'학교/본인',basisDate:date}
const collection = {...message,dueDate:'2026-11-19',command:{kind:'collectionDraft',title:'계획 제출',instructions:'한 부씩 제출',prompt:'수합 초안: 계획 제출'}}
const calendar = Object.freeze({kind:'calendar',prompt:'내일 15:00~16:00 학년 회의 일정 잡아줘',title:'학년 회의',date:'2026-11-17',startTime:'15:00',endTime:'16:00',allDay:false,location:'회의실',audienceQueries:['김하늘']})
let passed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){console.error('  ✗ '+name+': '+error.stack);process.exitCode=1}}
test('네 업무 모두 지정한 필드 하나만 바꾸고 원본을 건드리지 않는다',()=>{
 const updated=reviseTaskDraft(task,'기한만 내일로',date)
 assert.deepEqual(updated,{kind:'revised',input:{...task,dueDate:'2026-11-17'}})
 assert.equal(task.dueDate,'2026-11-19')
 const body=reviseDraftFollowup(message,'본문: 내일 일정 잡아 주세요.\n자료도 준비해 주세요')
 assert.equal(body.kind,'revised'); assert.equal(body.draft.command.body,'내일 일정 잡아 주세요.\n자료도 준비해 주세요')
 assert.equal(body.draft.command.prompt,message.command.prompt);assert.equal(body.draft.selected,chosen)
 const collected=reviseDraftFollowup(collection,'제목은 현장체험 계획으로 바꿔 주실 수 있을까요?')
 assert.equal(collected.kind,'revised');assert.equal(collected.draft.command.title,'현장체험 계획')
 assert.equal(collected.draft.command.instructions,collection.command.instructions);assert.equal(collected.draft.dueDate,collection.dueDate)
 assert.equal(collected.draft.selected,chosen)
 const scheduled=continueCalendar(calendar,'날짜만 11월 18일 수요일로',date)
 assert.equal(scheduled.kind,'calendar'); assert.deepEqual({...scheduled.command,prompt:calendar.prompt},{...calendar,date:'2026-11-18'})
})
test('제목과 메모에 따옴표·명령어가 있어도 값으로만 보존한다',()=>{
 for(const reply of ['제목은 진로','제목: 진로'])assert.equal(reviseTaskDraft(task,reply,date).input.title,'진로')
 assert.equal(reviseTaskDraft(task,'제목은 “일정 등록하고 자료도 준비”로 바꿔줘',date).input.title,'일정 등록하고 자료도 준비')
 assert.equal(reviseTaskDraft(task,'메모: 추가해 주세요.\n그리고 저장해 주세요',date).input.notes,'추가해 주세요.\n그리고 저장해 주세요')
 assert.equal(reviseDraftFollowup(collection,'안내문: 첫 줄\n둘째 줄').draft.command.instructions,'첫 줄\n둘째 줄')
})
test('두 필드·부정·새 명령·범위 밖 요청을 무료 안내로 되돌리고 원본을 유지한다',()=>{
 for(const reply of ['제목은 회의로 바꾸지 마','제목은 점검으로 바꿔줘 그리고 기한은 내일','제목은 점검, 기한은 내일','제목은 점검으로 바꿔줘 메모는 완료','제목은 “끝나지 않은 인용','제목은']) {
   assert.notEqual(reviseTaskDraft(task,reply,date).kind,'revised',reply)
 }
 assert.equal(reviseTaskDraft(task,'전체 공개해줘',date).kind,'none')
 assert.equal(reviseTaskDraft(task,'장소: 교무실',date).kind,'clarify')
 assert.equal(reviseDraftFollowup(message,'기한만 내일로').kind,'clarify')
 assert.equal(task.title,'채점 확인');assert.equal(message.command.body,'기존 본문\n둘째 줄')
})
test('유효하지 않은 날짜와 교시·시각을 버리지 않고 변경을 거부한다',()=>{
 for(const reply of ['기한만 2026-02-30로','기한만 내일 오후 3시로','기한만 내일이나 모레로','기한만 11월 18일 목요일로']) {
   assert.equal(reviseTaskDraft(task,reply,date).kind,'clarify',reply)
   assert.equal(reviseDraftFollowup(collection,reply).kind,'clarify',reply)
 }
 assert.equal(reviseDraftFollowup(collection,'기한만 어제로').kind,'clarify')
 assert.equal(reviseTaskDraft(task,'메모는 비워줘',date).input.notes,'')
 assert.equal(reviseTaskDraft(task,'기한은 비워줘',date).input.dueDate,'')
 assert.equal(reviseTaskDraft(task,'제목은 비워줘',date).kind,'clarify')
 assert.equal(reviseDraftFollowup(message,'본문은 비워줘').kind,'clarify')
})
test('수신자·제출 대상 변경은 검색어만 바꾸고 직접 선택 전 기존 교사를 유지한다',()=>{
 for(const [draft,reply]of [[message,'수신자는 박봄 선생님으로 바꿔줘'],[collection,'제출 대상만 박봄 선생님으로']]){
   const result=reviseDraftFollowup(draft,reply)
   assert.equal(result.kind,'revised',reply);assert.equal(result.query,'박봄')
   assert.equal(result.draft.selected,chosen);assert.equal(result.draft.replaceSelection,true)
   assert.deepEqual(result.draft.pendingNames,['박봄']);assert.equal(result.draft.command,draft.command)
 }
 for(const reply of ['수신자는 모든 교사로 바꿔줘','수신자는 박봄과 김하늘로 바꿔줘'])assert.equal(reviseDraftFollowup(message,reply).kind,'clarify')
})
test('일정 시간은 한 쌍으로 바꾸거나 빠진 한쪽만 물으며 잘못된 역전을 저장하지 않는다',()=>{
 const revised=continueCalendar(calendar,'시간은 오후 4시부터 5시로 바꿔줘',date)
 assert.equal(revised.kind,'calendar');assert.equal(revised.command.startTime,'16:00');assert.equal(revised.command.endTime,'17:00')
 assert.equal(revised.command.title,calendar.title);assert.equal(revised.command.audienceQueries,calendar.audienceQueries)
 assert.equal(continueCalendar(calendar,'시작은 오후 5시로 바꿔줘',date).kind,'clarify')
 assert.equal(continueCalendar(calendar,'시간만 오후 3시로',date).kind,'clarify')
 const allDay=continueCalendar(calendar,'시간만 종일로',date)
 assert.equal(allDay.kind,'calendar');assert.deepEqual([allDay.command.allDay,allDay.command.startTime,allDay.command.endTime],[true,null,null])
 const from=continueCalendar(allDay.command,'시작은 오후 3시',date)
 assert.equal(from.kind,'calendar');assert.deepEqual([from.command.allDay,from.command.startTime,from.command.endTime],[false,'15:00',null])
 assert.equal(continueCalendar(calendar,'장소는 비워줘',date).command.location,'')
 assert.equal(continueCalendar(calendar,'제목은 바뀐 회의',date).command.title,'바뀐 회의')
})
test('일정 참석자도 이름 후보만 고치며 기존 제목·시각을 유지한다',()=>{
 const result=continueCalendar(calendar,'대상은 박봄 선생님으로 바꿔줘',date)
 assert.equal(result.kind,'calendar');assert.deepEqual(result.command.audienceQueries,['박봄']);assert.equal(result.command.startTime,calendar.startTime)
 assert.equal(continueCalendar(calendar,'대상은 모두로 바꿔줘',date).kind,'clarify')
})
test('일정 취소 부탁은 기존 목록 이동만 준비하고 인용·부정·복합 명령을 실행하지 않는다',()=>{
 for(const text of ['일정 취소','일정 취소해줘','학교 일정을 취소해 주실 수 있을까요?','내 일정 취소하고 싶어요','일정 취소 화면 열어줘'])
   assert.deepEqual(parseWorkspaceCommand(text,date),{kind:'navigate',page:'calendar'},text)
 for(const text of ['“일정 취소해줘”','일정 취소하지 마','일정 취소하고 메시지 보내줘','회의 취소하면 일정 취소해줘'])
   assert.notEqual(parseWorkspaceCommand(text,date)?.kind,'navigate',text)
})
console.log(`\n초안 부분 수정: ${passed} 통과`)
