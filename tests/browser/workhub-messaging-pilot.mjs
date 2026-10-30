// 실제 앱·라우터·메신저를 합성 Supabase 응답으로 검증한다. 외부 요청은 차단한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({stdin:{contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import App from './apps/main/src/App.jsx';
 import{supabase}from'./packages/shared/src/index.js';
 let uid='teacher',listener=()=>{};
 window.calls=[];window.allowed=window.scenario!=='denied';
 const profile=()=>({id:uid,name:'시험 교사',email:uid+'@example.invalid',role:'teacher',is_active:true,department_id:null,extra_permissions:[]});
 const session=()=>({user:{id:uid,email:uid+'@example.invalid'}});
 const access=()=>({contract:'messaging.pilot.v1',allowed:true,userId:'teacher',schoolId:'school',memberId:'member',revision:1,expiresAt:window.expiresAt||'2099-12-31T00:00:00Z'});
 window.changeUser=()=>{uid='other';listener('SIGNED_IN',session())};
 supabase.auth.getSession=async()=>({data:{session:session()},error:null});
 supabase.auth.onAuthStateChange=cb=>{listener=cb;return{data:{subscription:{unsubscribe(){}}}}};
 supabase.from=()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:profile(),error:null})});
 const envelope=data=>({contractVersion:1,schoolId:'school',memberId:'member',userId:'teacher',ok:true,data});
 supabase.rpc=async(name,args)=>{
  window.calls.push({name,args});
  if(name==='workhub_participant_access')return{data:null,error:{code:'PGRST202'}};
  if(name==='workhub_messaging_pilot_access'){
   if(window.scenario==='missing')return{data:null,error:{code:'PGRST202'}};
   if(window.scenario==='delayed')await new Promise(r=>window.resolveAccess=r);
   return{data:window.allowed&&uid==='teacher'?access():{contract:'messaging.pilot.v1',userId:uid,allowed:false},error:null};
  }
  if(name==='workhub_messaging_pilot_context')return{data:{basisDate:'2026-10-25',schools:[{id:'school',name:'합성 학교'}],memberships:[{id:'member',schoolId:'school',userId:'teacher',name:'시험 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2099-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}],schoolLabels:{school:{departmentIds:[],gradeIds:[],subjectIds:[]}}},error:null};
  const values={workhub_messaging_readiness:{available:true,reason:'ready',limits:{bodyCharacters:5000,titleCharacters:100,recipients:100},attachments:'hwpx_basic_v1'},
   workhub_message_threads:{items:[],nextCursor:null},workhub_inbox_list:{items:[],nextCursor:null},
   workhub_message_recipients:{items:[{memberId:'admin',schoolId:'school',name:'관리자',department:'',version:1}],nextCursor:null},
   workhub_message_file_readiness:{available:true,reason:'ready',policy:{extensions:['hwpx'],maxFileBytes:20971520,maxFiles:5}}};
  if(!(name in values))throw new Error('허용 범위 밖 호출: '+name);
  return{data:envelope(values[name]),error:null};
 };
 createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'jsx'},bundle:true,alias:{'@daedong/shared':fileURLToPath(new URL('../../packages/shared/src/index.js',import.meta.url))},write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext(),page=await context.newPage(),errors=[],external=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<html><meta charset="utf-8"><div id="root"></div></html>'})})
async function boot(scenario='ready'){await page.goto('http://127.0.0.1:5176/workhub');await page.evaluate(s=>window.scenario=s,scenario);await page.addScriptTag({content:bundle.outputFiles[0].text})}
const heading=()=>page.getByRole('heading',{name:'업무실 · 메신저 시험',exact:true})
try{
 await boot();await heading().waitFor();await page.getByRole('button',{name:'새 메시지',exact:true}).click();await page.getByLabel('메시지',{exact:true}).fill('보존할 입력');await page.getByRole('checkbox',{name:'관리자',exact:true}).check()
 await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click();await page.getByRole('region',{name:'보내기 전 확인'}).waitFor()
 assert.equal(await page.getByRole('link',{name:'사용자 관리',exact:true}).count(),0)
 assert.equal(await page.getByRole('heading',{name:'시간표',exact:true}).count(),0)
 assert.equal(await page.evaluate(()=>window.calls.some(c=>['workhub_context','workhub_ai_memory_list','workhub_school_roster_get'].includes(c.name))),false)
 console.log('  ✓ 일반 교사에게 메신저만 열림·작성·수신자 최종 확인·범위 밖 호출 0')
 await page.getByRole('button',{name:'내용 수정',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await page.waitForFunction(()=>window.calls.filter(c=>c.name==='workhub_messaging_pilot_access').length>=2)
 assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'보존할 입력')
 console.log('  ✓ 창 복귀 시 입력·화면 유지')
 await page.locator('summary').filter({hasText:'기존 업무 메뉴'}).click();await page.getByRole('link',{name:'대시보드',exact:true}).click()
 await page.getByText(/작성 중인 내용을 저장하거나|보관한 입력이나 확인할 저장 요청이 남아/).waitFor()
 assert.equal(new URL(page.url()).pathname,'/workhub');assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'보존할 입력')
 console.log('  ✓ 미저장 메시지와 원요청이 남으면 기존 메뉴 이동 차단')
 await page.evaluate(()=>{window.allowed=false;window.dispatchEvent(new Event('focus'))});await heading().waitFor({state:'detached'});assert.equal(await page.getByLabel('메시지',{exact:true}).count(),0)
 console.log('  ✓ 서버 중지 시 전용 화면과 입력 접근 종료')
 for(const scenario of ['denied','missing']){await boot(scenario);await page.waitForURL('http://127.0.0.1:5176/');assert.equal(await heading().count(),0);assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.name)),['workhub_participant_access','workhub_messaging_pilot_access']);console.log('  ✓ '+scenario+' 직접 주소 접근 차단·기존 교사 화면 유지')}
 await boot('delayed');await page.waitForFunction(()=>Boolean(window.resolveAccess));await page.evaluate(()=>{window.changeUser();window.resolveAccess()});await page.waitForFunction(()=>window.calls.filter(c=>c.name==='workhub_messaging_pilot_access').length>=2);await page.evaluate(()=>window.resolveAccess());await page.waitForURL('http://127.0.0.1:5176/');assert.equal(await heading().count(),0)
 console.log('  ✓ 계정 변경 후 지연된 이전 허용 응답 무시')
 await boot();await heading().waitFor();await page.evaluate(()=>{window.expiresAt=new Date(Date.now()+1500).toISOString();window.dispatchEvent(new Event('focus'))});await heading().waitFor({state:'detached'});console.log('  ✓ 허용 만료 시 타이머로 화면 접근 종료')
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
}catch(error){console.error(await page.locator('body').innerText(),await page.evaluate(()=>window.calls),errors);throw error}finally{await browser.close()}
