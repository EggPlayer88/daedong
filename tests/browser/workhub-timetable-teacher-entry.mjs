// 교사 첫 화면·기본표 안내·관리 메뉴는 실제 React/어댑터를 쓰고 서버 응답만 합성한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const contents=`
import {createRoot} from 'react-dom/client'; import {useState} from 'react';
import {TimetableWorkspace} from '../../apps/workhub/src/timetable/TimetableWorkspace';
import {createEditDrafts,EditDraftsProvider} from '../../apps/workhub/src/app/edit-drafts';
import {createPendingRequests,PendingRequestsProvider,recoveryScope} from '../../apps/workhub/src/app/pending-requests';
import roster from '../fixtures/teacher-roster/nine-classes.json';
const w=window as any; const member:any={id:'teacher',userId:'user',schoolId:'school',name:'시험 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
w.calls=[];w.manager=Boolean(w.initial?.manager);w.failManagement=Boolean(w.initial?.failManagement);const drafts=createEditDrafts(),pending=createPendingRequests();w.pending=pending;
if(w.initial?.route)drafts.bind(recoveryScope(member),'timetable-entry').save(w.initial.route,false);
if(w.initial?.pending)pending.put(recoveryScope(member),'timetableSetup',{key:'original-key',command:{kind:'space_save',spaceId:null,expectedVersion:null,input:{kind:'room',label:'보존한 교실',capacity:1}}});
const connection:any={info:()=>({memberships:[member],schools:[{id:'school'}],basisDate:'2026-11-16'}),getIdentity:async()=>({userId:'user',approved:true}),rpcVerified:async(name:string,args:any)=>{w.calls.push({name,args});const wrap=(contract:string,data:any)=>({contract,schoolId:'school',memberId:'teacher',data});
if(name==='workhub_timetable_readiness'){if(w.failManagement)throw Error('연결 실패');return wrap('timetable.v1',w.manager?{available:false,reason:'basis_missing'}:{available:false,reason:'not_allowed'})}
if(name==='workhub_timetable_operations_readiness')return wrap('timetable-operations.v1',{available:true});
if(name==='workhub_timetable_operations_get')return wrap('timetable-operations.v1',{asOf:new Date().toISOString(),timeZone:'Asia/Seoul',from:args.p_from,until:args.p_until,canPublish:false,canRequest:false,drafts:[],requests:[],publications:[],lessons:[]});
if(name==='workhub_teacher_roster_published'){const p=structuredClone(roster.plan),available=p.from<=args.p_date&&args.p_date<p.until;return wrap('teacher-roster.v1',{date:args.p_date,timeZone:'Asia/Seoul',available:true,plans:available?[p]:[],myTeacherIds:available?[p.teachers[0].id]:[]})}
throw Error('이 시험의 미연결 조회 '+name)}};
function App(){const[revision,setRevision]=useState(0);w.refresh=()=>setRevision(x=>x+1);return <EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><TimetableWorkspace connection={connection} member={member} date="2026-11-16" revision={revision}/></PendingRequestsProvider></EditDraftsProvider>};createRoot(document.getElementById('root')!).render(<App/>);`
const bundle=buildSync({stdin:{contents,loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html lang="ko"><meta charset="utf-8"><div id="root"></div></html>'}))
async function start(initial={}){await page.goto('http://127.0.0.1:5285/teacher-entry');await page.evaluate(initial=>window.initial=initial,initial);await page.addScriptTag({content:bundle.outputFiles[0].text})}
const button=name=>page.getByRole('button',{name,exact:true})
let count=0
async function test(name,run){try{await run()}catch(error){console.error(await page.locator('body').innerText(),await page.evaluate(()=>window.calls));throw error};assert.deepEqual(errors,[]);count++;console.log('  ✓ '+name)}
try{
 await test('일반 교사에게 관리탭을 숨기고 날짜별 공개가 없으면 내 기본표를 바로 안내한다',async()=>{
  await start();const basic=page.getByRole('region',{name:'내 기본 시간표 참고',exact:true});await basic.locator('li').first().waitFor();
  assert.match(await basic.innerText(),/휴업·교환 등 날짜별 변경이 반영되지 않습니다/);
  assert.equal(await button('편성 관리').count(),0);assert.equal(await page.getByText('시간표 관리 도구',{exact:true}).count(),0);
  await button('다음 주').click();await basic.getByText('2026-11-23',{exact:true}).waitFor();await button('이 날짜의 기본 주간표 보기').click();
  await page.getByLabel('적용 기준일',{exact:true}).waitFor();assert.equal(await page.getByLabel('적용 기준일',{exact:true}).inputValue(),'2026-11-23');
 })
 await test('교사의 오래된 관리탭 경로를 열지 않고 서버가 허용한 관리자에게만 관리탭을 보여준다',async()=>{
  await start({route:'editor'});await page.getByRole('region',{name:'내 기본 시간표 참고',exact:true}).waitFor();assert.equal(await button('편성 관리').count(),0);
  await page.evaluate(()=>{window.manager=true;window.refresh()});await button('편성 관리').waitFor();assert.equal(await page.getByText('시간표 관리 도구',{exact:true}).count(),1);
 })
 await test('관리 권한 조회가 실패하면 권한을 추정하지 않고 재확인만 제공한다',async()=>{
  await start({failManagement:true});await button('관리 도구 권한 다시 확인').waitFor();assert.equal(await button('편성 관리').count(),0);
  await page.evaluate(()=>{window.failManagement=false;window.manager=true});await button('관리 도구 권한 다시 확인').click();await button('편성 관리').waitFor();
 })
 await test('권한이 달라져도 미확정 편성 요청과 원번호 복구 입구를 없애지 않는다',async()=>{
  await start({pending:true});await button('편성 요청 결과 확인').waitFor();
  assert.equal(await page.evaluate(()=>window.pending.count()),1);assert.equal(await page.getByText('시간표 관리 도구',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.calls.some(c=>/execute|save|mutate|publish_commit/.test(c.name))),false);
 })
 console.log('시간표 교사 첫 화면 '+count+'건 통과 · 운영 쓰기·유료 호출 0')
}finally{await browser.close()}
