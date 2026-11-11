// 실제 읽기 어댑터와 React를 합성 RPC에 연결한다. 로그인·운영 DB·유료 API는 사용하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { launchBrowser } from './launch-browser.mjs'
const fixture=JSON.parse(readFileSync(new URL('../fixtures/teacher-roster/nine-classes.json',import.meta.url),'utf8')).plan
const bundle=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx',contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{PersonalRosterAgenda}from'./apps/workhub/src/teacher-roster/PersonalRosterAgenda';
import{PublishedRoster}from'./apps/workhub/src/teacher-roster/PublishedRoster';
const w:any=window;const p=${JSON.stringify(fixture)};w.calls=[];
const member={id:'member-one',schoolId:'school-one',userId:'user-one',name:'관리자',role:'school_admin',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
const connection={info:()=>({memberships:[member],schools:[{id:member.schoolId}],basisDate:'2026-11-16'}),getIdentity:async()=>({userId:member.userId,approved:true,profile:{role:'superadmin',is_active:true,extra_permissions:[]}}),rpcVerified:async(name,args)=>{w.calls.push({name,args});if(w.failed)throw Error('network');const data={date:args.p_date,timeZone:'Asia/Seoul',available:!w.unavailable,plans:w.unavailable||args.p_date>=p.until?[]:[p],myTeacherIds:w.unavailable||w.unlinked||args.p_date>=p.until?[]:[p.teachers[0].id]};if(w.hold)await new Promise(resolve=>w.release=resolve);return{contract:'teacher-roster.v1',schoolId:member.schoolId,memberId:member.id,data}}};
function App(){const[date,setDate]=useState('2026-11-16');w.setDate=setDate;return w.week?<PublishedRoster connection={connection} member={member} date={date}/>:<PersonalRosterAgenda connection={connection} member={member} date={date}/>};createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div></html>'}))
let n=0;async function test(name,flags,fn){await page.goto('http://127.0.0.1:5182/roster-calendar');await page.evaluate(flags=>Object.assign(window,flags),flags);await page.addScriptTag({content:bundle.outputFiles[0].text});await fn();n++;console.log('  ✓ '+name)}
try{
 await test('연결 계정의 선택 날짜 기본 수업만 참고 표시',{},async()=>{await page.getByText('내 기본 시간표 참고',{exact:true}).click();await page.locator('li').first().waitFor();assert.match(await page.locator('body').innerText(),/휴업·교환은 반영하지 않으므로/);const expected=fixture.lessons.filter(l=>fixture.courses.find(c=>c.id===l.courseId).teacherId===fixture.teachers[0].id&&fixture.slots.find(s=>s.id===l.slotId).day===1).length;assert.equal(await page.locator('li').count(),expected);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)})
 await test('날짜 변경 뒤 늦은 응답은 새 일정에 표시하지 않음',{hold:true},async()=>{await page.waitForFunction(()=>window.release);await page.evaluate(()=>{window.old=window.release;window.hold=false;window.setDate('2026-11-22')});await page.getByText('내 기본 시간표 참고',{exact:true}).click();await page.getByText('이 날짜의 기본 배치가 없습니다.',{exact:true}).waitFor();await page.evaluate(()=>window.old());assert.equal(await page.locator('li').count(),0)})
 await test('미연결 계정은 다른 교사의 기본표를 개인 일정에 넣지 않음',{unlinked:true},async()=>{await page.waitForFunction(()=>window.calls.length>0);await page.getByText('내 기본 시간표 참고',{exact:true}).waitFor({state:'detached'});assert.equal(await page.locator('li').count(),0)})
 await test('조회 실패 후 재시도와 기존 날짜 보존',{failed:true},async()=>{await page.getByText('내 기본 시간표 참고',{exact:true}).click();await page.getByRole('alert').waitFor();await page.evaluate(()=>window.failed=false);await page.getByRole('button',{name:'기본 배치 다시 확인'}).click();await page.locator('li').first().waitFor();assert((await page.evaluate(()=>window.calls)).every(c=>c.args.p_date==='2026-11-16'))})
 await test('학급별 32교시·내 교사 주간표 전환',{week:true},async()=>{await page.getByText('32교시 · Asia/Seoul',{exact:true}).waitFor();await page.getByRole('button',{name:'내 기본 시간표',exact:true}).click();const expected=fixture.lessons.filter(l=>fixture.courses.find(c=>c.id===l.courseId).teacherId===fixture.teachers[0].id).length;await page.getByText(expected+'교시 · Asia/Seoul',{exact:true}).waitFor();assert.equal(await page.locator('article').count(),expected)})
 assert.deepEqual(errors,[]);console.log('명부 개인 일정·주간 조회 브라우저',n,'통과')
}finally{await browser.close()}
