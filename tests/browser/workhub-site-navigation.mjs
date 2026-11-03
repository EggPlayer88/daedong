// 실제 공통 셸과 연결 화면을 합성 응답으로 검증한다. 메뉴 배치는 권한을 추가하지 않는다.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {readFileSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url))
const base={bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}
const ordinary=(await build({...base,entryPoints:[join(root,'tests/browser/workhub-navigation-ui-fixture.tsx')]})).outputFiles[0].text
const connected=(await build({...base,entryPoints:[join(root,'tests/browser/workhub-cross-module-fixture.tsx')],plugins:[{name:'synthetic-ai',setup(builder){builder.onLoad({filter:/assistant[\\/]legacy-http\.ts$/},()=>({contents:'export const legacyAssistantHttp={send:payload=>window.cross.assistantHttp(payload)};export const legacySchoolAiHttp={send:async()=>{throw Error("synthetic settings unavailable")}};export const legacySchoolAiOperationsHttp={send:async()=>{throw Error("synthetic operations unavailable")}}',loader:'ts'}));builder.onLoad({filter:/workhub-cross-module-fixture\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace("checkReadiness:async()=>({stage:'ready',code:'READY',checkedAt:now(),readySchoolCount:2})","checkReadiness:async()=>{w.cross.connectionChecks=(w.cross.connectionChecks??0)+1;return{stage:'ready',code:'CONTEXT_READY',checkedAt:now(),readySchoolCount:2}}"),loader:'tsx'}))}}]})).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[],passed=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:5195'){external.push(url.href);return route.abort()}const match=url.pathname.match(/(PretendardVariable|TossFaceFontMac-0[789])\.woff2$/);if(match)return route.fulfill({contentType:'font/woff2',body:readFileSync(join(root,'apps/workhub/src/assets/fonts',match[1].startsWith('Toss')?'tossface':'',match[0]))});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true})
const info=()=>page.getByRole('dialog',{name:'서비스 정보',exact:true})
const more=()=>page.getByRole('dialog',{name:'더보기',exact:true})
async function boot(config={},app=ordinary){await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5195/site-navigation');await page.evaluate(config=>{window.uiConfig=config;localStorage.clear()},config);await page.addStyleTag({content:readFileSync(join(root,'apps/workhub/src/typography.css'),'utf8')+readFileSync(join(root,'apps/workhub/src/assets/fonts/tossface/tossface.css'),'utf8')});await page.addScriptTag({content:app});await page.locator('.ws-shell').waitFor();await page.evaluate(()=>document.fonts.ready)}
async function check(name,action){await action();passed.push(name);console.log('  ✓ '+name)}
async function writes(){assert.deepEqual(await page.evaluate(()=>window.qa?.writes??window.cross?.writes),[])}
async function capture(name){if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png'),fullPage:false})}}
try{
 await boot()
 await check('데스크톱은 허용된 여섯 핵심 메뉴를 목적별로 구분하고 선택한 화면으로 이동한다',async()=>{
  const primary=page.locator('.ws-primary-menus');assert.deepEqual(await primary.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['홈','일정','시간표','내 업무','수업·학생','문서·자료'])
  for(const[label,id]of[['홈','home'],['일정','calendar'],['시간표','timetable'],['내 업무','tasks'],['수업·학생','students'],['문서·자료','documents']]){await primary.getByRole('button',{name:label,exact:true}).click();await page.locator('.ws-content[data-page="'+id+'"]').waitFor();assert.equal(await primary.getByRole('button',{name:label,exact:true}).getAttribute('aria-current'),'page')}
  await writes()
 })
 await check('모바일은 핵심 네 메뉴와 더보기를 두고 수업·문서를 전체 목록에서 계속 연다',async()=>{
  await page.setViewportSize({width:390,height:844});assert.deepEqual(await page.locator('.ws-primary-menus button:visible').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['홈','일정','시간표','내 업무']);assert.equal(await page.locator('.ws-navigation>.ws-more-button:visible').count(),1)
  for(const[label,id]of[['수업과 학생','students'],['문서함','documents']]){await button('더보기').click();await more().getByRole('button',{name:label,exact:true}).click();await page.locator('.ws-content[data-page="'+id+'"]').waitFor();assert.equal(await more().isVisible(),false);assert.match(await button('더보기').getAttribute('class'),/ws-more-current/)}
  await writes()
 })
 await check('서비스 정보와 원문 라이선스는 필요할 때 열고 닫으면 원래 버튼으로 초점을 돌린다',async()=>{
  await page.setViewportSize({width:1440,height:1000});assert.equal(await page.getByText('글꼴 라이선스',{exact:true}).count(),0);const trigger=button('서비스 정보');await trigger.click();await info().getByRole('heading',{name:'연결 정보',exact:true}).waitFor();await info().getByText('글꼴 라이선스',{exact:true}).click();assert.match(await info().locator('pre').innerText(),/SIL OPEN FONT LICENSE/);assert.match(await info().locator('pre').innerText(),/Pretendard/);assert.match(await info().locator('pre').innerText(),/Toss/);await page.keyboard.press('Escape');assert.equal(await info().count(),0);assert(await trigger.evaluate(el=>el===el.getRootNode().activeElement));await writes()
 })
 await check('입력 잠금은 업무 이동만 막으며 서비스 정보 조회와 닫기는 입력을 버리지 않는다',async()=>{
  await page.evaluate(()=>window.qa.lock(true));await page.locator('.ws-locked').waitFor();const prior=await page.locator('.ws-content').getAttribute('data-page');assert(await page.locator('.ws-primary-menus').getByRole('button',{name:'일정',exact:true}).isDisabled());assert(await button('서비스 정보').isEnabled());await button('서비스 정보').click();await info().getByRole('button',{name:'서비스 정보 닫기'}).click();assert.equal(await page.locator('.ws-content').getAttribute('data-page'),prior);assert(await button('서비스 정보').evaluate(el=>el===el.getRootNode().activeElement));assert.equal(await page.evaluate(()=>window.qa.discarded),0)
  await page.setViewportSize({width:390,height:844});await button('더보기').click();assert(await more().getByRole('button',{name:'수업과 학생',exact:true}).isDisabled());await more().getByRole('button',{name:'서비스 정보',exact:true}).click();await info().waitFor();assert.equal(await more().isVisible(),false);await page.keyboard.press('Escape');assert(await button('더보기').evaluate(el=>el===el.getRootNode().activeElement));await writes()
 })
 await boot({participant:true})
 await check('참여 계정은 전달된 허용 메뉴 밖의 수업·문서·학교 관리·AI를 얻지 않는다',async()=>{
  for(const width of[1440,390]){await page.setViewportSize({width,height:900});await button('더보기').click();for(const name of['수업과 학생','문서함','학교 관리','AI 비서'])assert.equal(await more().getByRole('button',{name,exact:true}).count(),0);assert.equal(await page.locator('.ws-primary-menus').getByRole('button',{name:'시간표',exact:true}).count(),0);await more().getByRole('button',{name:'서비스 정보',exact:true}).click();assert.match(await info().innerText(),/허용된 업무 참여/);await page.keyboard.press('Escape')}
  await writes()
 })
 await boot({},connected)
 await check('연결된 관리자 화면의 운영 진단은 서비스 정보 안으로 이동하고 직접 실행할 때만 조회한다',async()=>{
  await page.getByRole('heading',{name:'오늘',exact:true,level:1}).waitFor();assert.equal(await page.locator('.connected-diagnostics').count(),0);await button('서비스 정보').click();await info().getByText('운영 연결 진단',{exact:true}).click();assert.equal(await info().locator('.readiness-result').count(),0);assert.equal(await page.evaluate(()=>window.cross.connectionChecks??0),0);await info().getByRole('button',{name:'연결 상태 확인',exact:true}).click();await info().getByRole('heading',{name:'학교 소속 조회까지 확인했습니다',exact:true}).waitFor();assert.equal(await info().locator('.readiness-checks [data-check-state="confirmed"]').count(),4);assert.equal(await page.evaluate(()=>window.cross.connectionChecks),1);await capture('07-service-info');await page.keyboard.press('Escape');assert(await button('서비스 정보').evaluate(el=>el===el.getRootNode().activeElement));assert.equal(await page.evaluate(()=>window.cross.aiCalls.length),0);await writes()
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
}finally{await browser.close()}
console.log(passed.length+'개 전체 메뉴·서비스 정보 브라우저 시나리오 통과')
