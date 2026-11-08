import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {readFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url))
const bundle=buildSync({stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{NeisCalendar}from'./apps/workhub/src/neis/NeisCalendar';import{NeisTimetable}from'./apps/workhub/src/neis/NeisTimetable';
import{NeisError,incoming}from'./apps/workhub/src/neis/contracts';import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
const member={id:'m',schoolId:'s',userId:'u',name:'시험 관리자',role:'calendar_manager',active:true,validFrom:'2026-01-01',validThrough:'2027-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
const data={identity:'a'.repeat(64),contentHash:'b'.repeat(64),loadedOn:'2026-11-08',date:'2026-11-20',title:'학교 행사',content:'행사 안내\\n둘째 줄',grades:[1,2,3],dayKind:'해당없음',course:'중학교',session:'주간'};
if(window.scenario==='long')data.content='가'.repeat(2000);
const row={id:'source',version:1,data,present:window.scenario!=='missing',eventId:null,baseline:null,dismissed:false,supersededBy:null,current:null};
const base={contract:'neis.v1',schoolId:'s',memberId:'m',today:'2026-11-08',configured:window.scenario!=='disabled',canManage:true,source:{officeCode:'K10',schoolCode:'7892043',schoolName:'시험학교'},version:1,fetchedAt:'2026-11-08T00:00:00Z',errorCode:null};
const old={...incoming(data),title:'학교 행사',description:'내 메모',startTime:'09:00',endTime:'10:00',allDay:false,location:'회의실',id:'e',schoolId:'s',authorMemberId:'m',version:2,updatedAt:'2026-11-08T00:00:00Z'};
window.calls=[];window.pending=createPendingRequests();let saved=false;
const server={
 read:async(m,r)=>({...base,...r,rows:!base.configured?[]:r.kind==='schedule'?[row]:[{identity:'c'.repeat(64),contentHash:'d'.repeat(64),loadedOn:'2026-11-08',date:'2026-11-02',grade:1,className:'1',session:'주간',period:1,semester:2,subject:'국어'}]}),
 refresh:async(m,r)=>{window.calls.push({op:'refresh'});return server.read(m,r)},
 events:async()=>window.scenario==='existing'?[old]:[],
 apply:async(m,command,key)=>{window.calls.push({op:'apply',command,key});if(window.scenario==='unknown'&&!saved){saved=true;throw new NeisError('RESULT_UNKNOWN')}if(window.scenario==='conflict')throw new NeisError('CONFLICT');row.eventId='e';row.current={...old,...incoming(data),version:3};row.baseline=incoming(data);row.version++;return{items:command.map(s=>({sourceId:s.id,decision:s.decision==='ignore'?'ignored':'applied',event:row.current}))}},
 close:async(m,command,key)=>{window.calls.push({op:'close',command,key});return{outcome:saved?'applied':'closed'}}
};
function App(){const[tab,setTab]=useState('calendar'),[show,setShow]=useState(true);window.show=setShow;return<PendingRequestsProvider store={window.pending}><header><h1>나이스 학교 자료</h1><button onClick={()=>setTab('calendar')}>학사일정</button><button onClick={()=>setTab('timetable')}>시간표</button></header>{show&&(tab==='calendar'?<NeisCalendar server={server} member={member} date="2026-11-08" onLock={v=>window.locked=v}/>:<NeisTimetable server={server} member={member} date="2026-11-08"/>)}</PendingRequestsProvider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
const css=readFileSync(join(root,'apps/workhub/src/neis/neis.css'),'utf8')
await context.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:5179/')?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;background:#f7f9fc;color:#18243a;margin:20px}#root{max-width:1080px;margin:auto}button,input,select{font:inherit;padding:10px;border:1px solid #dce3ed;border-radius:9px;background:white;color:inherit}button{cursor:pointer}button:disabled{opacity:.5}input[type=checkbox]{width:18px;height:18px}h1{font-size:26px}.button-row{display:flex;gap:10px}fieldset label{display:block}'+css+'</style><div id="root"></div></html>'}):route.abort())
async function start(scenario=''){await page.goto('http://127.0.0.1:5179/neis');await page.evaluate(v=>window.scenario=v,scenario);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByText(scenario==='disabled'?'학교 연결 등록 후 학사일정을 가져올 수 있습니다.':'학교 행사',{exact:true}).first().waitFor()}
async function select(){await page.getByLabel('학교 행사',{exact:true}).check()}
async function confirm(){await page.getByLabel('선택한 변경과 공개 범위를 확인했습니다.').check();await page.getByRole('button',{name:'선택 1건 반영·보류',exact:true}).click()}
let count=0
async function test(name,fn,scenario=''){await start(scenario);await fn();assert.deepEqual(errors,[]);count++;console.log('  ✓ '+name)}
try{
 await test('불러오기만으로 일정을 쓰지 않고 선택·확인 뒤 한 번 반영',async()=>{
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.op==='apply').length),0)
 await select();assert.equal(await page.getByRole('button',{name:'선택 1건 반영·보류'}).isDisabled(),true)
 await confirm();await page.getByText('1건 반영 · 0건 보류',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),0)
 })
 await test('동일한 기존 일정을 선택하고 충돌 확인해야 반영',async()=>{
 await select();await page.getByLabel('학교 행사 기존 일정').selectOption('e')
 await page.getByLabel('선택한 변경과 공개 범위를 확인했습니다.').check();assert.equal(await page.getByRole('button',{name:'선택 1건 반영·보류'}).isDisabled(),true)
 await page.getByLabel('충돌한 제목·설명·날짜를 나이스 값으로 바꾸는 것을 확인했습니다.').check();await confirm();await page.getByText('1건 반영 · 0건 보류',{exact:true}).waitFor()
 const call=await page.evaluate(()=>window.calls.find(x=>x.op==='apply'));assert.equal(call.command[0].eventId,'e');assert.equal(call.command[0].eventVersion,2);assert.equal(call.command[0].overwrite,true)
 },'existing')
 await test('결과 미상·재마운트 뒤 원 선택과 번호로 복구',async()=>{
 await select();await confirm();await page.getByRole('button',{name:'같은 요청의 결과 확인'}).waitFor()
 const first=await page.evaluate(()=>window.calls.find(x=>x.op==='apply'));assert.equal(await page.evaluate(()=>window.locked),true)
 await page.evaluate(()=>window.show(false));await page.getByRole('button',{name:'같은 요청의 결과 확인'}).waitFor({state:'detached'});await page.evaluate(()=>window.show(true))
 await page.getByRole('button',{name:'같은 요청의 결과 확인'}).click();await page.getByText('1건 반영 · 0건 보류',{exact:true}).waitFor()
 const calls=await page.evaluate(()=>window.calls.filter(x=>x.op==='apply'));assert.deepEqual(calls[1],first)
 },'unknown')
 await test('원본 누락은 기존 일정 삭제 없이 보류만 허용',async()=>{
 await select();assert.equal(await page.getByLabel('학교 행사 처리').inputValue(),'ignore');assert.equal(await page.getByRole('option',{name:'일정에 반영'}).isDisabled(),true)
 await confirm();await page.getByText('0건 반영 · 1건 보류',{exact:true}).waitFor()
 },'missing')
 await test('긴 원문은 잘라 저장하지 않고 안내 후 보류만 가능',async()=>{
 await select();await page.getByText(/원문을 줄이지 않고 보존합니다/).waitFor()
 assert.equal(await page.getByLabel('학교 행사 처리').inputValue(),'ignore');assert.equal(await page.getByRole('option',{name:'일정에 반영'}).isDisabled(),true)
 await confirm();await page.getByText('0건 반영 · 1건 보류',{exact:true}).waitFor()
 },'long')
 await test('미확정 요청 닫기는 원 요청 번호를 확인한 뒤에만 잠금을 푼다',async()=>{
 await select();await confirm();await page.getByRole('button',{name:'이 요청 닫기'}).waitFor()
 const first=await page.evaluate(()=>window.calls.find(x=>x.op==='apply'))
 await page.getByRole('button',{name:'이 요청 닫기'}).click();await page.getByText('이미 반영된 요청입니다.',{exact:true}).waitFor()
 const call=await page.evaluate(()=>window.calls.find(x=>x.op==='close'));assert.equal(call.key,first.key);assert.deepEqual(call.command,first.command);assert.equal(await page.evaluate(()=>window.pending.count()),0)
 },'unknown')
 await test('미설치·비활성은 준비 안내로 마감하며 쓰기 버튼이 없다',async()=>{assert.equal(await page.getByRole('button',{name:/선택 .*건 반영/}).count(),0)},'disabled')
 await test('모바일 비교·확대 폭에서 문구와 확인 버튼에 접근 가능',async()=>{
 await select()
 for(const width of [390,640]){await page.setViewportSize({width,height:850});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false)}
 await page.setViewportSize({width:1280,height:900})
 const output=process.env.WORKHUB_QA_OUTPUT;if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'neis-calendar.png'),fullPage:true})}
 })
 await test('공개 학급 시간표를 운영 확정본과 구분하고 CSV를 내려받는다',async()=>{
 await page.getByRole('button',{name:'시간표',exact:true}).click();await page.getByText('국어',{exact:true}).waitFor()
 await page.getByText(/담당 교사·수업 시각이 없어/).waitFor()
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'원본 CSV 내려받기'}).click();assert.match((await downloaded).suggestedFilename(),/나이스_학급시간표/)
 const output=process.env.WORKHUB_QA_OUTPUT;if(output)await page.screenshot({path:join(output,'neis-timetable.png'),fullPage:true})
 })
 console.log('전부 통과 ('+count+')')
}finally{await browser.close()}
