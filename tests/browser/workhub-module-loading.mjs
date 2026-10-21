// 실제 React 오류 경계·지연 로딩·요청 보관소를 사용한다. DB·AI 호출은 하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const source = `
import React,{Suspense,useState}from'react';import{createRoot}from'react-dom/client';
import{ModuleBoundary}from'./apps/workhub/src/app/ModuleBoundary';
import{retryableLazy}from'./apps/workhub/src/app/retryable-lazy';
import{createPendingRequests,PendingRequestsProvider,recoveryScope,usePendingRequest}from'./apps/workhub/src/app/pending-requests';
window.React=React;window.loads={};window.failures={primary:1};window.mode='primary';window.scope='school-a';window.renderFault=false;window.retryFault=false;window.mounts={};window.writes=0;
const member={id:'member',schoolId:'school',userId:'user',name:'가상 교사',role:'teacher',active:true,validFrom:'2026-03-01',validThrough:'2027-02-28',departmentIds:[],gradeIds:[],subjectIds:[]};
const pending=createPendingRequests();window.pending=pending;window.seed=()=>pending.put(recoveryScope(member),'documents',{key:'original-request',command:{title:'보관한 원문',version:3}});
function Fields({name}){const[value,setValue]=useState('');const recovery=usePendingRequest(member,'documents');if(name==='primary'&&window.renderFault)throw Error('LOAD_TEST_RENDER_FAULT');return <section aria-label={name}><h2>{name} 화면</h2><label>{name} 입력<input value={value} onChange={event=>setValue(event.target.value)}/></label><p>요청 번호: {recovery.request?.key??'없음'}</p><button onClick={()=>{window.writes++}}>명시 저장</button></section>}
function make(name){return retryableLazy(async()=>{window.loads[name]=(window.loads[name]??0)+1;if(window.failures[name]===-1||window.loads[name]<=(window.failures[name]??0))throw Error('LOAD_TEST_IMPORT_FAULT: private@example.invalid');return{default:()=> <Fields name={name}/>}})}
const Primary=make('primary'),Healthy=make('healthy'),Inner=make('inner');
const Nested=retryableLazy(async()=>{window.loads.outer=(window.loads.outer??0)+1;return{default:()=> <Suspense fallback={<p>내부 로딩</p>}><Inner/></Suspense>}});
const Native=retryableLazy(()=>{window.loads.native=(window.loads.native??0)+1;return import('/retryable-screen.js')});
function App(){const[,render]=useState(0);window.refresh=()=>render(n=>n+1);return <PendingRequestsProvider store={pending}><ModuleBoundary moduleName="주요 업무" resetKey={window.scope} onRetry={()=>{if(window.retryFault)throw Error('LOAD_TEST_RETRY_FAULT')}}><Suspense fallback={<p>주요 화면 로딩</p>}>{window.mode==='native'?<Native/>:window.mode==='nested'?<Nested/>:<Primary/>}</Suspense></ModuleBoundary><ModuleBoundary moduleName="정상 업무" resetKey={window.scope}><Suspense fallback={<p>정상 화면 로딩</p>}><Healthy/></Suspense></ModuleBoundary><button onClick={()=>render(n=>n+1)}>부모 화면 갱신</button></PendingRequestsProvider>};createRoot(document.getElementById('root')).render(<App/>);
`
const bundle=buildSync({stdin:{contents:source,loader:'tsx',resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},external:['/retryable-screen.js'],logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1000,height:900}})
const results=[],unexpected=[]
let nativeRequests=0,documentRequests=0
page.setDefaultTimeout(10000)
page.on('pageerror',error=>{if(!/LOAD_TEST|Failed to fetch dynamically imported module/.test(error.message))unexpected.push(error.message)})
await page.route('**/*',route=>{
  if(route.request().url().endsWith('/retryable-screen.js')){nativeRequests++;return nativeRequests===1?route.abort('failed'):route.fulfill({contentType:'application/javascript',body:'export default function Screen(){return window.React.createElement("p",null,"실제 모듈 파일 복구");}'})}
  documentRequests++
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>'})
})
const failure=()=>page.getByRole('heading',{name:'주요 업무 화면을 표시하지 못했습니다',exact:true})
const retry=()=>page.getByRole('button',{name:'이 화면 다시 열기',exact:true})
async function start(){nativeRequests=0;documentRequests=0;await page.goto('http://127.0.0.1:5181/loading');await page.addScriptTag({content:bundle});await page.getByRole('heading',{name:'healthy 화면',exact:true}).waitFor()}
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function test(name,run){await start();await run();results.push(name);console.log('  ✓ '+name)}
try{
  await test('가져오기 한 번 실패 후 사용자 재시도는 실제 loader를 다시 실행한다',async()=>{
    await failure().waitFor();assert.equal(await page.evaluate(()=>window.loads.primary),1)
    assert.doesNotMatch(await page.locator('body').innerText(),/private@example.invalid|LOAD_TEST_IMPORT_FAULT/)
    await retry().click();await page.getByRole('heading',{name:'primary 화면',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>window.loads.primary),2);assert.equal(await failure().count(),0)
  })
  await test('자동 재시도·자동 새로고침 없이 실패한 화면만 격리한다',async()=>{
    await failure().waitFor();for(let i=0;i<4;i++)await page.getByRole('button',{name:'부모 화면 갱신'}).click()
    assert.equal(await page.evaluate(()=>window.loads.primary),1);assert.equal(documentRequests,1)
    assert.equal(await page.getByLabel('healthy 입력',{exact:true}).isEnabled(),true)
  })
  await test('실패 화면을 다시 열어도 다른 정상 모듈의 입력을 재마운트하지 않는다',async()=>{
    await failure().waitFor();await page.getByLabel('healthy 입력',{exact:true}).fill('다른 화면의 작성 중 입력')
    await retry().click();await page.getByRole('heading',{name:'primary 화면',exact:true}).waitFor()
    assert.equal(await page.getByLabel('healthy 입력',{exact:true}).inputValue(),'다른 화면의 작성 중 입력')
    assert.equal(await page.evaluate(()=>window.loads.healthy),1)
  })
  await test('지속 실패는 클릭 한 번에 한 번만 재시도하고 데이터 정리 뒤 수동 새로고침을 안내한다',async()=>{
    await failure().waitFor();await page.evaluate(()=>window.failures.primary=-1);await retry().click()
    await page.getByText(/새로고침하면 현재 탭에만 보관한 입력과 요청 번호가 사라집니다/).waitFor()
    assert.equal(await page.evaluate(()=>window.loads.primary),2);assert.equal(documentRequests,1)
    await settle();assert.equal(await page.evaluate(()=>window.loads.primary),2)
  })
  await test('재시도 콜백 실패는 loader를 추가 호출하지 않는다',async()=>{
    await failure().waitFor();await page.evaluate(()=>window.retryFault=true);await retry().click();await settle()
    assert.equal(await failure().isVisible(),true);assert.equal(await page.evaluate(()=>window.loads.primary),1)
  })
  await test('실패 상태에서 학교·메뉴 범위가 바뀌면 새 시도로 열 수 있다',async()=>{
    await failure().waitFor();await page.evaluate(()=>{window.scope='school-b';window.refresh()})
    await page.getByRole('heading',{name:'primary 화면',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.loads.primary),2)
  })
  await test('정상 상태의 키 변경은 기존 정책대로 입력과 로딩 결과를 유지한다',async()=>{
    await failure().waitFor();await retry().click();await page.getByRole('heading',{name:'primary 화면',exact:true}).waitFor()
    await page.getByLabel('primary 입력',{exact:true}).fill('입력 보존')
    await page.evaluate(()=>{window.scope='scope-refresh';window.refresh()});await settle()
    assert.equal(await page.getByLabel('primary 입력',{exact:true}).inputValue(),'입력 보존')
    assert.equal(await page.evaluate(()=>window.loads.primary),2)
  })
  await test('내부 지연 모듈도 같은 오류 경계의 명시적 재시도로 복구한다',async()=>{
    await failure().waitFor();await page.evaluate(()=>{window.mode='nested';window.failures.inner=1;window.scope='nested';window.refresh()})
    await page.waitForFunction(()=>window.loads.inner===1);await failure().waitFor();await retry().click()
    await page.getByRole('heading',{name:'inner 화면',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.loads.inner),2)
  })
  await test('렌더 오류의 재시도 후 원래 요청 번호와 명령을 보존하며 자동 전송하지 않는다',async()=>{
    await failure().waitFor();await page.evaluate(()=>window.seed());await retry().click();await page.getByRole('heading',{name:'primary 화면',exact:true}).waitFor()
    const before=await page.evaluate(()=>window.pending.count());await page.evaluate(()=>{window.renderFault=true;window.refresh()});await failure().waitFor()
    await page.evaluate(()=>window.renderFault=false);await retry().click();await page.getByRole('heading',{name:'primary 화면',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>window.pending.count()),before)
    assert.equal(await page.getByRole('region',{name:'primary',exact:true}).getByText('요청 번호: original-request',{exact:true}).isVisible(),true)
    assert.equal(await page.evaluate(()=>window.writes),0)
    assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented}),true)
  })
  await test('실제 dynamic import 실패 캐시는 재시도로 복구된다고 표시하지 않으며 자동 새로고침하지 않는다',async()=>{
    await failure().waitFor();await page.evaluate(()=>{window.mode='native';window.scope='native';window.refresh()});await page.waitForFunction(()=>window.loads.native===1);await failure().waitFor()
    assert.equal(nativeRequests,1);await retry().click();await page.waitForFunction(()=>window.loads.native===2)
    await page.getByText(/화면 파일의 다운로드 실패는 브라우저에 남아 있을 수 있습니다/).waitFor()
    assert.equal(nativeRequests,1);assert.equal(documentRequests,1);assert.equal(await page.getByText('실제 모듈 파일 복구',{exact:true}).count(),0)
    // 사용자가 탭을 새로고침한 별도 상황에서만 브라우저 모듈 캐시가 비워진다.
    await page.reload();await page.addScriptTag({content:bundle});await failure().waitFor();await page.evaluate(()=>{window.mode='native';window.scope='native-after-manual-reload';window.refresh()})
    await page.getByText('실제 모듈 파일 복구',{exact:true}).waitFor();assert.equal(nativeRequests,2);assert.equal(documentRequests,2)
  })
  assert.deepEqual(unexpected,[])
  console.log(`모듈 지연 로딩 복구 브라우저 ${results.length}건 통과`)
  if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'module-loading.json'),JSON.stringify({results,unexpected,nativeImportBoundary:'동일 URL 실패 캐시는 수동 새로고침 전까지 유지됨. 자동 새로고침 없음.'},null,2))}
}finally{await page.close();await browser.close()}
