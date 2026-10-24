// 실제 로그인 화면·공통 인증·승인 게이트를 합성 Supabase 응답으로 검증한다. 운영 접속은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../',import.meta.url))
const bundle = buildSync({stdin:{contents:`
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import App from './apps/main/src/App.jsx';
  import {supabase} from './packages/shared/src/index.js';
  let listener=()=>{}, current=null, profile={id:'synthetic',email:'synthetic@example.invalid',name:'시험 교사',role:'teacher',is_active:false,extra_permissions:[]};
  window.scenario={calls:0,googleCalls:0,code:null,delay:0,setProfile(value){profile=value}};
  const scenario=window.scenario;
  supabase.auth.getSession=async()=>({data:{session:current},error:null});
  supabase.auth.onAuthStateChange=cb=>{listener=cb;return {data:{subscription:{unsubscribe(){listener=()=>{}}}}}};
  supabase.auth.signInWithOAuth=async()=>{scenario.googleCalls++;return {data:{},error:null}};
  supabase.auth.signInWithPassword=async input=>{
    scenario.calls++; scenario.email=input.email; scenario.passwordMatches=input.password===' synthetic-password ';
    if(scenario.delay)await new Promise(r=>setTimeout(r,scenario.delay));
    if(scenario.code)return {data:null,error:{code:scenario.code,status:scenario.code==='over_request_rate_limit'?429:400,message:'DO_NOT_SHOW_SECRET'}};
    current={user:{id:'synthetic',email:'synthetic@example.invalid'}};
    listener('SIGNED_IN',current);return {data:{session:current,user:current.user},error:null};
  };
  supabase.from=()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:profile,error:null}}});
  createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser()
const context=await browser.newContext({viewport:{width:420,height:850}})
const page=await context.newPage(), errors=[], remote=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1'){remote.push(route.request().url());return route.abort()}
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'})
})
async function boot(path='/?login=email'){
  await page.goto('http://127.0.0.1:5176'+path)
  await page.addStyleTag({content:readFileSync(resolve(root,'apps/main/src/styles.css'),'utf8')})
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  await page.getByRole('heading',{name:'대동여중 업무혁신시스템',exact:true}).waitFor()
}
async function credentials(){await page.getByLabel('이메일',{exact:true}).fill('synthetic@example.invalid');await page.getByLabel('비밀번호',{exact:true}).fill(' synthetic-password ')}
try {
  await boot('/')
  assert.equal(await page.locator('input[type=password]').count(),0)
  await page.getByRole('button',{name:'Google 로 로그인',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.scenario.googleCalls),1)
  console.log('  ✓ 기본 주소 Google 로그인 유지')

  await boot(); await credentials()
  await page.evaluate(()=>{window.scenario.code='invalid_credentials';window.scenario.delay=250})
  await page.getByRole('button',{name:'이메일로 로그인',exact:true}).click()
  assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'')
  assert.equal(await page.getByRole('button',{name:'로그인 확인 중…',exact:true}).isDisabled(),true)
  await page.locator('form').dispatchEvent('submit')
  await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(()=>window.scenario.calls),1)
  assert.equal(await page.evaluate(()=>window.scenario.passwordMatches),true)
  assert.equal(await page.getByLabel('이메일',{exact:true}).inputValue(),'synthetic@example.invalid')
  assert.equal(await page.getByLabel('비밀번호',{exact:true}).inputValue(),'')
  assert(!(await page.locator('body').innerText()).includes('DO_NOT_SHOW_SECRET'))
  assert.equal(await page.evaluate(()=>sessionStorage.length),0)
  assert.equal(await page.evaluate(()=>localStorage.length),0)
  console.log('  ✓ 중복 접수 차단, 요청 직후 비밀번호 비우기, 실패 후 이메일 유지·서버 원문 비노출')

  for(const [code,expected] of [['email_not_confirmed','이메일 인증이 완료되지 않았습니다.'],['over_request_rate_limit','로그인 요청이 많습니다.'],['network','로그인 연결을 완료하지 못했습니다.']]){
    await page.evaluate(code=>{window.scenario.code=code;window.scenario.delay=0},code)
    await page.getByLabel('비밀번호',{exact:true}).fill(' synthetic-password ')
    await page.getByRole('button',{name:'이메일로 로그인',exact:true}).click()
    await page.getByText(expected,{exact:false}).waitFor()
    console.log('  ✓ 오류 안내 '+code)
  }
  if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:resolve(process.env.WORKHUB_QA_OUTPUT,'email-login.png'),fullPage:true})}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  console.log('  ✓ 좁은 화면에서도 입력창과 오류 안내 표시')

  await page.evaluate(()=>{window.scenario.code=null})
  await page.getByLabel('비밀번호',{exact:true}).fill(' synthetic-password ')
  await page.getByRole('button',{name:'이메일로 로그인',exact:true}).click()
  await page.getByRole('heading',{name:'승인 대기중입니다',exact:true}).waitFor()
  assert.equal(await page.locator('nav').count(),0)
  console.log('  ✓ 인증 성공 후 미승인 사용자는 기존 승인 대기 화면으로 차단')

  await boot('/workhub?login=email')
  await page.evaluate(()=>window.scenario.setProfile({id:'synthetic',email:'synthetic@example.invalid',name:'시험 교사',role:'teacher',is_active:true,extra_permissions:[]}))
  await credentials();await page.getByRole('button',{name:'이메일로 로그인',exact:true}).click()
  await page.getByRole('heading',{name:'대시보드',exact:true}).waitFor()
  assert.equal(new URL(page.url()).pathname,'/')
  assert.equal(await page.getByRole('link',{name:'신축 업무실 · 시험',exact:true}).count(),0)
  console.log('  ✓ 승인된 일반 교사도 업무실 직접 주소·메뉴 차단 유지')
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
} finally {await context.close();await browser.close()}
