import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url)
const { chromium }=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const bundle=buildSync({stdin:{contents:`
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ConnectedWorkspace} from './apps/workhub/src/app/ConnectedWorkspace';
  import {createSupabaseConnection} from './apps/workhub/src/connection/supabase-connection';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  let uid='fixture-soyeon', denied=false, profileError=false, delay=0, callback=()=>{};
  const memory=createMemoryAdapter(fixtureData,0);
  const scenario={contextCalls:0,token(){callback({user:{id:uid}})},switchUser(id){uid=id;callback({user:{id:uid}})},deny(){denied=true},profileError(value){profileError=value},delay(value){delay=value}};
  window.scenario=scenario;
  const services={async getSession(){return {user:{id:uid}}},async fetchMyProfile(id){if(delay) await new Promise(r=>setTimeout(r,delay));if(profileError)throw new Error('synthetic query failure');return {id,name:'가상 기존 회원',email:'synthetic@example.invalid',role:'superadmin',extra_permissions:[],department_id:null,is_active:true}},onAuthStateChange(cb){callback=cb;return()=>{callback=()=>{}}},async signInWithGoogle(){},async signOut(){},async rpc(name,args){
    if(name==='workhub_context'){scenario.contextCalls++;return {error:null,data:{...memory.info(),schoolLabels:Object.fromEntries(fixtureData.schools.map(s=>[s.id,relationLabels]))}}}
    if(denied)return {data:null,error:{message:'INACTIVE_MEMBERSHIP'}};
    try { if(name==='workhub_calendar_list')return {data:await memory.list(args.p_member_id),error:null};if(name==='workhub_calendar_get')return {data:await memory.get(args.p_member_id,args.p_event_id),error:null};if(name==='workhub_calendar_save')return {data:await memory.save(args.p_member_id,args.p_command),error:null}; } catch(e){return {data:null,error:{message:e.code}}}
    return {data:null,error:{message:'UNKNOWN'}};
  }};
  const connection=createSupabaseConnection(services);
  createRoot(document.getElementById('root')).render(<ConnectedWorkspace expectedUserId="fixture-soyeon" connection={connection}/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({VITE_SUPABASE_URL:'http://localhost.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1280,height:1000}})
const page=await context.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
await page.route('**/connection-contract-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>'}))
async function boot(){await page.goto('http://127.0.0.1:5176/connection-contract-test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'일정 등록',exact:true}).waitFor();await page.getByRole('button',{name:'일정 등록',exact:true}).click();await page.locator('input[name="title"]').fill('보존해야 하는 미저장 초안')}
try{
  await boot()
  assert(await page.locator('.dialog-body').evaluate(node => parseFloat(getComputedStyle(node).paddingTop)) > 0)
  assert.equal(await page.getByLabel('사용할 학교').locator('option').count(),2)
  assert.equal(await page.getByRole('button',{name:'다른 교사 수정 발생'}).count(),0)
  let count=await page.evaluate(()=>window.scenario.contextCalls)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(old=>window.scenario.contextCalls>old,count)
  assert.equal(await page.locator('input[name="title"]').inputValue(),'보존해야 하는 미저장 초안')
  console.log('  ✓ 같은 계정의 포커스 재검증에서 미저장 초안 유지')
  count=await page.evaluate(()=>window.scenario.contextCalls)
  await page.evaluate(()=>window.scenario.token())
  await page.waitForFunction(old=>window.scenario.contextCalls>old,count)
  assert.equal(await page.locator('input[name="title"]').inputValue(),'보존해야 하는 미저장 초안')
  console.log('  ✓ 동일 UID 토큰 갱신에서 미저장 초안 유지')
  await page.evaluate(()=>window.scenario.deny())
  await page.getByRole('dialog').getByRole('button',{name:'일정 등록',exact:true}).click()
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  assert.equal(await page.getByText('보존해야 하는 미저장 초안',{exact:true}).count(),0)
  console.log('  ✓ 서버의 소속 종료 거부 즉시 목록·편집창 폐기')
  await boot();await page.evaluate(()=>{window.scenario.delay(200);window.scenario.switchUser('fixture-minjun')})
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  console.log('  ✓ 다른 계정 전환에서 이전 자료 즉시 폐기')
  await boot();await page.evaluate(()=>{window.scenario.profileError(true);window.scenario.token()})
  await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  console.log('  ✓ 계정 확인 실패에서 이전 업무 화면 재사용 차단')
  assert.deepEqual(errors,[])
  console.log('  ✓ 실제 연결 JSX·Shadow DOM에서 런타임 오류 없음 (합성 전송 계층)')
}catch(e){console.error(e);console.error((await page.locator('body').innerText()).slice(-3000));process.exitCode=1}
finally{await context.close();await browser.close()}
