// 검색도 기존 화면과 같은 읽기 경계를 거치는지 실제 합성 저장소로 확인한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { calendarSearchSource, taskSearchSource, collectionSearchSource, filterSearchItems, fixtureData, createWorkflowStore, createPreviewTaskAdapter } = await loadBrowserModule(`
 export { calendarSearchSource, taskSearchSource, collectionSearchSource } from '../apps/workhub/src/search/sources.ts'
 export { filterSearchItems } from '../apps/workhub/src/search/presentation.ts'
 export { fixtureData } from '../apps/workhub/src/preview/fixtures.ts'
 export { createWorkflowStore } from '../apps/workhub/src/workflows/store.ts'
 export { createPreviewTaskAdapter } from '../apps/workhub/src/preview/task-adapter.ts'
`)
const date=fixtureData.basisDate, members=fixtureData.memberships
const mine=members.find(m=>m.id==='gaon-soyeon'), other=members.find(m=>m.id==='gaon-minjun'), away=members.find(m=>m.id==='nuri-soyeon')
let passed=0,failed=0
async function test(name,fn){try{await fn();passed++;console.log('  ✓ '+name)}catch(e){failed++;console.error('  ✗ '+name+': '+e.stack)}}
const item=(id,title,patch={})=>({id,kind:'task',title,description:'',meta:'',...patch})

await test('검색은 한글 조합·대소문자·연속 공백을 정규화하고 여러 단어를 모두 찾는다',()=>{
 const rows=[item('a','학교 AI 연수',{description:'자료 준비'}),item('b','학교 연수')]
 assert.deepEqual(filterSearchItems(rows,'  학교   ai ').map(x=>x.id),['a'])
 assert.equal(filterSearchItems(rows,'학교'.normalize('NFD')).length,2)
 assert.equal(filterSearchItems(rows,'학교 자료').length,1)
 assert.equal(filterSearchItems(rows,'없는 업무').length,0)
})
await test('표시용 업무·공개 범위·상태 문구는 검색 원문으로 사용하지 않는다',()=>{
 const rows=[item('plain','준비 자료',{meta:'할 일 · 기한 없음 · 나만 보는 업무'}),item('real','업무 분장',{meta:'완료 · 나만 보는 업무'}),item('calendar','연수 안내',{kind:'calendar',meta:'학교 교사 전체 · 종일 · 장소 미지정'})]
 assert.deepEqual(filterSearchItems(rows,'업무').map(x=>x.id),['real'])
 for(const query of ['교사','전체','종일','미지정','완료','기한 없음'])assert.equal(filterSearchItems(rows,query).length,0,query)
})
await test('띄어쓰기 차이는 찾되 서로 다른 원문 필드를 붙여 거짓 단어를 만들지 않는다',()=>{
 const rows=[item('spaced','체험 학습 준비'),item('joined','체험학습 준비'),item('fields','체험',{description:'학습'})]
 assert.deepEqual(filterSearchItems(rows,'체험학습').map(x=>x.id).sort(),['joined','spaced'])
 assert.equal(filterSearchItems(rows,'체험 학습').length,3)
 assert.deepEqual(filterSearchItems(rows,'체험학습','calendar'),[])
})
await test('서로 다른 종류의 같은 ID를 유지하고 같은 원본 중복만 제거한다',()=>{
 const rows=[item('same','검색'),item('same','검색'),item('same','검색',{kind:'calendar'}),item('same','검색',{kind:'collection',unitId:'u1'}),item('same','검색',{kind:'collection',unitId:'u2'})]
 assert.equal(filterSearchItems(rows,'').length,4)
 assert.equal(filterSearchItems(rows,'','collection').length,2)
})
await test('제목 일치가 본문 일치보다 먼저이며 깨진 목록은 화면을 중단시키지 않는다',()=>{
 assert.deepEqual(filterSearchItems([item('body','가나다',{description:'연수'}),item('exact','연수')],'연수').map(x=>x.id),['exact','body'])
 assert.deepEqual(filterSearchItems(null,'학교'),[])
 assert.equal(filterSearchItems([null,item('ok','정상'),{id:'bad',title:null}],'').length,1)
})
await test('일정 검색은 현재 학교와 기존 개인/대상 열람 경계를 그대로 사용한다',async()=>{
 const base={...fixtureData.events[0],schoolId:mine.schoolId,authorMemberId:other.id,visibility:'school',audience:{all:true,groups:[],includeMemberIds:[],excludeMemberIds:[]}}
 const rows=[{...base,id:'shared',title:'학교 공유'},{...base,id:'mine',title:'내 비공개',visibility:'private',authorMemberId:mine.id},{...base,id:'hidden',title:'타인 비공개',visibility:'private'},{...base,id:'away',title:'다른 학교',schoolId:away.schoolId}]
 let called='';const source=calendarSearchSource({list:async memberId=>{called=memberId;return rows}},mine,date)
 const found=await source.load();assert.equal(called,mine.id);assert.deepEqual(found.map(x=>x.id),['shared','mine'])
 assert(!JSON.stringify(found).includes('타인 비공개'));assert(!JSON.stringify(found).includes('다른 학교'))
})
await test('일정의 장소·시작일·종료일·입력한 시각은 계속 검색할 수 있다',async()=>{
 const event={...fixtureData.events[0],title:'원문 제목',description:'원문 설명',startDate:'2026-10-19',endDate:'2026-10-22',allDay:false,startTime:'08:40',endTime:'09:30',location:'도서관 북쪽 교실',schoolId:mine.schoolId,authorMemberId:mine.id}
 const found=await calendarSearchSource({list:async()=>[event]},mine,date).load()
 for(const query of ['도서관','북쪽교실','2026-10-19','2026-10-22','08:40','09:30'])assert.equal(filterSearchItems(found,query).length,1,query)
 assert.equal(filterSearchItems(found,'학교 교사 전체').length,0)
 const tasks=[item('due','제출 준비',{date:'2026-10-24',meta:'2026-10-24까지 · 나만 보는 업무'})]
 assert.equal(filterSearchItems(tasks,'2026-10-24').length,1)
 assert.equal(filterSearchItems(tasks,'까지').length,0)
})
await test('개인 업무 검색은 현재 소속 본인만 읽으며 완료 업무도 다시 찾을 수 있다',async()=>{
 const store=createWorkflowStore({members,date}),adapter=createPreviewTaskAdapter(store)
 const own=store.createTask(mine.id,{title:'완료한 연수',notes:'내 참고 메모',dueDate:date},'mine')
 store.createTask(other.id,{title:'다른 교사의 할 일',notes:'타인 메모',dueDate:date},'other')
 await adapter.setStatus(mine.id,own.id,'done',own.version,'done')
 const found=await taskSearchSource(adapter,mine,date).load();assert.equal(found.length,1)
 assert.match(found[0].meta,/완료/);assert.equal(found[0].description,'내 참고 메모')
 assert.equal((await taskSearchSource(adapter,away,date).load()).length,0)
})
await test('개인 업무 응답에 다른 소속 행이 섞이면 검색 성공으로 처리하지 않는다',async()=>{
 const forged={id:'foreign',schoolId:mine.schoolId,ownerMemberId:other.id,title:'오염된 업무',notes:'',dueDate:'',status:'todo',version:1}
 await assert.rejects(()=>taskSearchSource({list:async()=>[forged]},mine,date).load())
})
await test('수합 검색은 공개 전 작성자와 공개 후 참여자의 기존 권한을 따른다',async()=>{
 const store=createWorkflowStore({members,date})
 const input={title:'공동 수합',instructions:'행사 준비 안내',dueDate:date,reviewMode:'none',reviewerMemberId:'',textLabel:'안내',textRequired:true,numberLabel:'',numberRequired:false,units:[{label:'공동 단위',responsibleMemberId:mine.id,contributorMemberIds:[]}]}
 const draft=store.createCollection(other.id,input,'create')
 assert.equal((await collectionSearchSource(store,mine,date).load()).length,0)
 assert.match((await collectionSearchSource(store,other,date).load())[0].meta,/요청 초안/)
 store.publishCollection(other.id,draft.id,draft.version,'publish')
 const found=await collectionSearchSource(store,mine,date).load()
 assert.equal(found.length,1);assert.equal(found[0].id,draft.id)
 assert.equal((await collectionSearchSource(store,away,date).load()).length,0)
 assert.deepEqual(Object.keys(found[0]).sort(),['date','description','id','kind','meta','title'])
})
await test('종료 소속에서는 검색을 위한 조회 호출도 시작하지 않는다',async()=>{
 let calls=0;const source=calendarSearchSource({list:async()=>{calls++;return[]}}, {...mine,active:false},date)
 await assert.rejects(()=>source.load(),e=>e.code==='INACTIVE_MEMBERSHIP');assert.equal(calls,0)
})
console.log(`\n${passed}개 통과, ${failed}개 실패`);if(failed)process.exitCode=1
