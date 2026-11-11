import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = await build({entryPoints:[fileURLToPath(new URL('./site-ai-evaluation-bridge-fixture.jsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},
  plugins:[{name:'observe-main-workhub-props',setup(build){build.onLoad({filter:/app[\\/]ConnectedWorkspace\.tsx$/},()=>({loader:'jsx',contents:`
    import React,{useEffect} from 'react'
    export function ConnectedWorkspace(props){
      window.evaluationBridge.props=props
      useEffect(()=>{window.evaluationBridge.mounts++;return()=>window.evaluationBridge.unmounts++},[])
      return <section aria-label="연결 게이트 통과"><output data-testid="evaluation-links">{JSON.stringify(props.legacyEvaluationLinks)}</output><output data-testid="legacy-link">{props.legacyPlanHref??''}</output><label>AI 원문<input defaultValue=""/></label></section>
    }
  `}))}}],
  define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://synthetic.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser = await launchBrowser(), context = await browser.newContext(), page = await context.newPage(), errors=[], external=[]
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5179/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'})})
let passed=0
const ready = {state:{enabled:true},loading:false,error:''}
const links=async()=>JSON.parse(await page.getByTestId('evaluation-links').innerText())
async function seasonal(value){await page.evaluate(value=>window.evaluationBridge.setSeasonal(value),value);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function test(name,run){await page.goto('http://127.0.0.1:5179/school-site/workhub');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('region',{name:'연결 게이트 통과',exact:true}).waitFor();await run();passed++;console.log('  ✓ '+name)}
try {
  await test('기간 업무가 숨겨져 있으면 새 AI 연결과 기존 문서 링크를 공급하지 않는다',async()=>{assert.deepEqual(await links(),{});assert.equal(await page.getByTestId('legacy-link').innerText(),'')})
  await test('활성 기간 업무의 두 주소는 현재 라우터 basename을 그대로 따른다',async()=>{await seasonal(ready);assert.deepEqual(await links(),{authoring:'/school-site/doc-ai',submissions:'/school-site/submissions'});assert.equal(await page.getByTestId('legacy-link').innerText(),'/school-site/doc-ai')})
  await test('재조회 중에는 과거 활성 값으로 새 AI 링크를 보이지 않는다',async()=>{await seasonal(ready);await seasonal({...ready,loading:true});assert.deepEqual(await links(),{});assert.equal(await page.getByTestId('legacy-link').innerText(),'/school-site/doc-ai')})
  await test('재조회 실패와 미설치는 새 AI 연결을 허용하지 않는다',async()=>{await seasonal({...ready,error:'서버 조회 실패'});assert.deepEqual(await links(),{});await seasonal({state:null,loading:false,error:'미설치'});assert.deepEqual(await links(),{})})
  await test('기간 업무가 닫혀도 현재 AI 입력과 업무 앱 마운트는 유지한다',async()=>{await seasonal(ready);await page.getByLabel('AI 원문').fill('메뉴 표시가 바뀌어도 보존할 원문');await seasonal({state:{enabled:false},loading:false,error:''});assert.deepEqual(await links(),{});assert.equal(await page.getByLabel('AI 원문').inputValue(),'메뉴 표시가 바뀌어도 보존할 원문');assert.equal(await page.evaluate(()=>window.evaluationBridge.mounts),1);assert.equal(await page.evaluate(()=>window.evaluationBridge.unmounts),0)})
  await test('일반 교사의 업무실 접근을 새 링크 연결로 넓히지 않는다',async()=>{await page.evaluate(()=>window.evaluationBridge.setAuth({session:{user:{id:'teacher-one'}},profile:{id:'teacher-one',role:'teacher',is_active:true},profileLoading:false,profileError:null}));await page.getByRole('alert').filter({hasText:'현재 계정으로'}).waitFor();assert.equal(await page.getByRole('region',{name:'연결 게이트 통과',exact:true}).count(),0)})
  await test('승인 취소나 프로필 계정 불일치에서는 업무 앱과 새 링크가 사라진다',async()=>{await seasonal(ready);await page.evaluate(()=>window.evaluationBridge.setAuth({session:{user:{id:'admin-one'}},profile:{id:'another-user',role:'superadmin',is_active:true},profileLoading:false,profileError:null}));await page.getByRole('alert').waitFor();assert.equal(await page.getByTestId('evaluation-links').count(),0);await page.evaluate(()=>window.evaluationBridge.setAuth({session:{user:{id:'admin-one'}},profile:{id:'admin-one',role:'superadmin',is_active:false},profileLoading:false,profileError:null}));assert.equal(await page.getByTestId('evaluation-links').count(),0)})
  await test('프로필 조회 중에는 평가계획 연결을 미리 마운트하지 않는다',async()=>{await page.evaluate(()=>window.evaluationBridge.setAuth({session:{user:{id:'admin-one'}},profile:{id:'admin-one',role:'superadmin',is_active:true},profileLoading:true,profileError:null}));await page.getByRole('status').filter({hasText:'계정 확인 중'}).waitFor();assert.equal(await page.getByTestId('evaluation-links').count(),0)})
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  console.log(`main 평가계획 연결 브라우저 ${passed}건 통과 · 외부 호출 0건`)
} finally {await browser.close()}
