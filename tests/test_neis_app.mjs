import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule("export * from '../apps/workhub/src/neis/contracts';export * from '../apps/workhub/src/neis/server';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';export {NeisCalendar} from '../apps/workhub/src/neis/NeisCalendar';export {NeisTimetable} from '../apps/workhub/src/neis/NeisTimetable'")
let count=0;const ck=async(n,f)=>{await f();count++;console.log('  ✓ '+n)}
const member={id:'m',schoolId:'s',userId:'u',name:'합성',role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const range=m.range('schedule','2026-11-08'),meta={identity:'a'.repeat(64),contentHash:'b'.repeat(64),loadedOn:'2026-11-08'}
const row={id:'source',version:1,data:{...meta,date:'2026-11-20',title:'학교 행사',content:'내용',grades:[1,2,3],dayKind:'해당없음',course:'중학교',session:'주간'},present:true,eventId:null,baseline:null,dismissed:false,supersededBy:null,current:null}
const response={...range,contract:'neis.v1',schoolId:'s',memberId:'m',today:'2026-11-08',configured:true,canManage:true,source:{officeCode:'K10',schoolCode:'7892043',schoolName:'시험학교'},version:1,fetchedAt:'2026-11-08T00:00:00Z',errorCode:null,rows:[row]}
const id={userId:'u',approved:true,profile:{id:'u',role:'superadmin',is_active:true}}
function connection(fn=async()=>response){return{info:()=>({memberships:[member],schools:[{id:'s'}],basisDate:'2026-11-08'}),getIdentity:async()=>id,rpcVerified:fn}}
await ck('학년도·급식 월 범위와 시간표 2주 범위를 한국 학교 날짜로 고정',()=>{
 assert.deepEqual(m.range('schedule','2027-02-20'),range)
 assert.deepEqual(m.range('meals','2026-11-08'),{kind:'meals',year:2026,from:'2026-11-01',to:'2026-12-31'})
 assert.equal(m.range('timetable','2026-11-08').from,'2026-11-02')
 assert.throws(()=>m.range('schedule','2026-02-30'))
})
await ck('서버 응답의 학교·소속·범위·형식·중복 원본을 검증',()=>{
 assert.equal(m.snapshot(response,range,member,[member]).rows.length,1)
 for(const bad of [{...response,schoolId:'other'},{...response,rows:[row,row]},{...response,rows:[{...row,present:'true'}]},{...response,from:'2025-03-01'},{...response,rows:[{...row,data:{...row.data,grades:[1,1]}}]}])assert.throws(()=>m.snapshot(bad,range,member,[member]))
})
await ck('사이트에서 수정한 제목과 시각은 나이스 원본이 그대로면 변경 후보가 아니다',()=>{
 const baseline=m.incoming(row.data),current={...baseline,title:'로컬 제목',location:'장소',startTime:'09:00',endTime:'10:00',allDay:false,id:'e',schoolId:'s',authorMemberId:'m',version:2,updatedAt:'2026-11-08T00:00:00Z'}
 assert.equal(m.comparison({...row,eventId:'e',current,baseline}).state,'same')
 assert.deepEqual(m.comparison({...row,eventId:'e',current,baseline,data:{...row.data,title:'외부 제목'}}).conflicts,['title'])
})
await ck('조회 전후 승인·소속을 재확인하고 계정 변경 응답은 버린다',async()=>{
 const c=connection();assert.equal((await m.createNeisServer(c,async()=>({data:response})).read(member,range)).rows.length,1)
 let calls=0;c.getIdentity=async()=>++calls===1?id:{...id,userId:'other'}
 await assert.rejects(m.createNeisServer(c,async()=>({data:response})).read(member,range),e=>e.code==='CANCELLED')
})
await ck('미설치는 준비 중, 쓰기 응답 유실은 결과 미확정으로 보존',async()=>{
 const c=connection(async()=>{throw Object.assign(Error(),{rpcCode:'PGRST202'})})
 await assert.rejects(m.createNeisServer(c,async()=>{}).read(member,range),e=>e.code==='NOT_READY')
 const stalled=connection(()=>new Promise(()=>{}))
 await assert.rejects(m.createNeisServer(stalled,async()=>{},5).apply(member,[],'same-key'),e=>e.code==='RESULT_UNKNOWN')
})
await ck('HTTP는 비밀 키 없이 기존 세션만 전달하고 다른 학교 인자를 만들지 않는다',async()=>{
 let sent;const http=m.createNeisHttp({getSession:async()=>({user:{id:'u'},access_token:'synthetic'}),fetch:async(url,options)=>{sent={url,options};return new Response(JSON.stringify({data:response}),{status:200})}})
 assert.equal((await http({memberId:'m',...range},'u')).data.schoolId,'s')
 assert.equal(sent.url,'/api/neis/data');assert.equal(sent.options.headers.Authorization,'Bearer synthetic');assert.equal(sent.options.redirect,'error')
 assert.equal(JSON.parse(sent.options.body).schoolId,undefined)
})
await ck('응답 오류·다른 로그인·제한 초과를 정상 자료로 해석하지 않는다',async()=>{
 for(const scenario of ['auth','json','size','http']){
 const http=m.createNeisHttp({getSession:async()=>({user:{id:scenario==='auth'?'other':'u'},access_token:'synthetic'}),fetch:async()=>new Response(scenario==='json'?'bad':scenario==='size'?'x'.repeat(12000001):JSON.stringify({error:{code:'KEY_MISSING'}}),{status:scenario==='http'?503:200})})
 await assert.rejects(http({},'u'))
 }
})
await ck('실제 React 초기 렌더에 비교 확인과 원본 시간표 구분을 제공한다',()=>{
 const server=m.createNeisServer(connection(),async()=>({data:response}))
 const html=m.renderToStaticMarkup(m.createElement(m.NeisCalendar,{server,member,date:'2026-11-08'}));assert.match(html,/학년도/);assert.match(html,/최신 자료 가져오기/)
 const grid=m.renderToStaticMarkup(m.createElement(m.NeisTimetable,{server,member,date:'2026-11-08'}));assert.match(grid,/조회 날짜/);assert.match(grid,/원본 CSV/)
})
await ck('긴 원문은 기존 일정 한도로 안내하고 CSV 수식은 실행되지 않게 보존',()=>{
 assert.equal(m.applyIssue(row.data,member),null)
 assert.match(m.applyIssue({...row.data,title:'가'.repeat(101)},member),/100자/)
 assert.match(m.applyIssue({...row.data,content:'가'.repeat(2000)},member),/2,000자/)
 assert.equal(m.csvCell(' =1+1'),'"\' =1+1"')
 assert.equal(m.csvCell('국어'),'"국어"')
})
await ck('시간초과 뒤 늦게 끝난 신원 조회는 새 HTTP나 RPC를 보내지 않는다',async()=>{
 let sent=0
 const http=m.createNeisHttp({timeoutMs:2,getSession:async()=>{await new Promise(r=>setTimeout(r,15));return{user:{id:'u'},access_token:'synthetic'}},fetch:async()=>{sent++;return new Response('{}')}})
 await assert.rejects(http({},'u'));assert.equal(sent,0)
 const c=connection(async()=>{sent++;return response});c.getIdentity=async()=>{await new Promise(r=>setTimeout(r,15));return id}
 await assert.rejects(m.createNeisServer(c,async()=>{},2).read(member,range))
 await new Promise(r=>setTimeout(r,30));assert.equal(sent,0)
})
console.log('전부 통과 ('+count+')')
