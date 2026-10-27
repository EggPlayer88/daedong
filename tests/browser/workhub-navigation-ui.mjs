// 공통 탐색·상태 안내의 접근성과 기존 행동을 실제 React 화면에서 검증한다.
import assert from 'node:assert/strict'
import{buildSync}from'esbuild'
import{readFileSync,mkdirSync,writeFileSync}from'node:fs'
import{fileURLToPath}from'node:url'
import{join}from'node:path'
import{launchBrowser}from'./launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-navigation-ui-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const font=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url)).toString('base64')
const toss=readFileSync(new URL('../../apps/workhub/src/assets/fonts/tossface/tossface.css',import.meta.url),'utf8').replace(/url\("\.\/(TossFaceFontMac-0[789]\.woff2)"\)/g,(_,file)=>'url(data:font/woff2;base64,'+readFileSync(new URL('../../apps/workhub/src/assets/fonts/tossface/'+file,import.meta.url)).toString('base64')+')')
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font});font-weight:45 920}${toss}body{font-family:Pretendard,sans-serif;margin:0}*{box-sizing:border-box}</style><div id="root"></div></html>`
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[],results=[]
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5195/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:html})})
const button=name=>page.getByRole('button',{name,exact:true})
async function boot(config={}){await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5195/ui');await page.evaluate(config=>{window.uiConfig=config;localStorage.setItem('workhub:appearance:v1',JSON.stringify({theme:config.theme??'light',density:'comfortable',textSize:'standard'}))},config);await page.addScriptTag({content:bundle});await button('업무 찾기').waitFor();await page.evaluate(()=>document.fonts.ready);if(!config.view)await page.getByText('조건에 맞는 대화가 없습니다.',{exact:true}).waitFor()}
async function capture(name,locator=page.locator('.ws-shell')){if(!process.env.WORKHUB_QA_OUTPUT)return;mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await locator.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png')})}
async function check(name,run,config={}){await boot(config);try{await run()}catch(error){await capture('navigation-ui-failure');console.error((await page.locator('body').innerText()).slice(-6000));throw error}results.push(name);console.log('  ✓ '+name)}
async function search(){await button('업무 찾기').click();await page.locator('.ws-search-source-ready').last().waitFor();await page.waitForFunction(()=>document.querySelectorAll('.ws-search-source-ready').length===2)}
async function inbox(){await button('업무 알림').click();await page.locator('.messaging-notice').last().waitFor()}
async function fits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className)),[])}
async function small(){await page.setViewportSize({width:320,height:820});await page.addStyleTag({content:'.ws-shell{--ui-body-size:30px!important;--ui-small-size:26px!important}'});await fits()}
function contrast(a,b){const lum=color=>{const v=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
try{
 await check('더보기는 현재 위치를 표시하고 기존 메뉴 선택·키보드 복귀를 유지한다',async()=>{
  await button('더보기').click();const dialog=page.getByRole('dialog',{name:'더보기'});assert.match(await dialog.locator('.ws-sheet-location').innerText(),/메시지와 알림/)
  assert.equal(await dialog.getByRole('button',{name:'메시지와 알림',exact:true}).getAttribute('aria-current'),'page');await capture('01-navigation-menu',dialog)
  await page.keyboard.press('Escape');assert.equal(await button('더보기').evaluate(el=>el===document.activeElement),true);assert.equal(await page.evaluate(()=>window.qa.writes.length),0)
 })
 await check('허용된 참여 메뉴는 더보기·검색에서도 같은 범위이며 AI와 관리자 메뉴가 생기지 않는다',async()=>{
  await button('더보기').click();const dialog=page.getByRole('dialog',{name:'더보기'});assert.equal(await dialog.getByRole('button',{name:'학교 관리',exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'AI 비서',exact:true}).count(),0)
  await page.keyboard.press('Escape');await search();const names=await page.locator('.ws-search-result strong').allTextContents();assert(!names.includes('학교 관리'));assert(!names.includes('AI 비서'));assert(names.includes('메시지와 알림'));assert.equal(await page.evaluate(()=>window.qa.writes.length),0)
 },{participant:true})
 await check('검색 결과는 종류·원본 판·설명을 보존하고 선택한 원본만 연다',async()=>{
  await search();await page.getByLabel('검색어',{exact:true}).fill('현장체험');const row=page.locator('.ws-search-result').filter({hasText:'현장체험학습 운영 안내'});await row.waitFor();assert.match(await row.innerText(),/판 3/);await capture('02-navigation-search',page.locator('.ws-search-dialog'))
  await row.click();assert.deepEqual(await page.evaluate(()=>window.qa.opens.map(x=>[x.kind,x.id,x.version])),[['knowledge','guide',3]]);assert.equal(await page.evaluate(()=>window.qa.writes.length),0)
 })
 await check('일부 조회 실패는 빈 결과로 숨기지 않고 해당 범위만 재조회한다',async()=>{
  await page.evaluate(()=>window.qa.failed=true);await button('업무 찾기').click();await page.locator('.ws-search-source-failed').waitFor();await page.getByLabel('검색 범위',{exact:true}).selectOption('knowledge');assert.equal(await page.locator('.ws-search-empty').getAttribute('data-state'),'attention')
  assert.match(await page.locator('.ws-search-empty').innerText(),/조회 상태/);await page.evaluate(()=>window.qa.failed=false);await button('학교 자료 다시 불러오기').click();await page.locator('.ws-search-source-ready').waitFor();assert.deepEqual(await page.evaluate(()=>window.qa.loads),['menu','knowledge','knowledge']);assert.equal(await page.evaluate(()=>window.qa.writes.length),0)
 })
 await check('검색 창이 열린 뒤 입력 잠금이 생겨도 검색어는 보존하고 원본 이동을 막는다',async()=>{
  await search();await page.getByLabel('검색어',{exact:true}).fill('현장체험');await page.evaluate(()=>window.qa.lock(true));await page.locator('.ws-search-notice').waitFor();assert.equal(await page.locator('.ws-search-result').isDisabled(),true);assert.equal(await page.getByLabel('검색어',{exact:true}).inputValue(),'현장체험');assert.equal(await page.evaluate(()=>window.qa.opens.length),0)
 })
 await check('모바일 메뉴와 검색은 두 배 글씨에서도 잘리지 않고 현재 위치와 닫기 버튼에 접근한다',async()=>{
  await page.setViewportSize({width:390,height:844});await button('더보기').click();await capture('03-navigation-mobile-menu',page.getByRole('dialog',{name:'더보기'}));await page.keyboard.press('Escape');await small();await button('더보기').click();const dialog=page.getByRole('dialog',{name:'더보기'});await dialog.getByRole('button',{name:'더보기 닫기'}).focus();await fits();await capture('07-navigation-large-text',dialog);await page.keyboard.press('Escape');await search();await page.getByLabel('검색어',{exact:true}).fill('없음');await fits();assert.match(await page.locator('.ws-search-empty').innerText(),/찾은 항목이 없습니다/);await button('업무 찾기 닫기').click();assert.equal(await button('업무 찾기').evaluate(el=>el===document.activeElement),true)
 })
 await check('알림 목록·원본 이동은 쓰기를 하지 않고 읽음 버튼만 해당 알림의 판을 보낸다',async()=>{
  await inbox();const item=page.locator('.messaging-notice').first();assert.equal(await item.getAttribute('data-read'),'false');assert.equal(await page.locator('.messaging-notice-open').count(),1);await capture('04-navigation-notifications')
  await button('문서 수합 원본 열기').click();assert.equal(await page.evaluate(()=>window.qa.writes.length),0);await item.getByRole('button',{name:'읽음으로 표시'}).click();await item.getByText('읽음',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.qa.writes),[{kind:'read_notice',noticeId:'notice',expectedVersion:1}]);assert.equal(await item.getAttribute('data-read'),'true')
 })
 await check('빈 알림은 필터를 확인하는 방법을 보이고 자동 전송·읽음 처리가 없다',async()=>{
  await page.evaluate(()=>{window.qa.empty=true;window.qa.refresh()});await button('업무 알림').click();await page.getByText('조건에 맞는 알림이 없습니다.',{exact:true}).waitFor();await page.getByLabel('읽지 않은 항목만',{exact:true}).check();await page.getByText('읽지 않은 항목만 보기를 해제하면 읽은 알림도 확인할 수 있습니다.',{exact:true}).waitFor();await small();await fits();assert.equal(await page.evaluate(()=>window.qa.writes.length),0)
 })
 await check('보관 입력은 폐기 확인을 취소하면 유지되고 새 요청이 생기면 폐기 버튼을 감춘다',async()=>{
  await button('임시 입력 버리기').click();assert.equal(await button('계속 보관').evaluate(el=>el===document.activeElement),true);await button('계속 보관').click();assert.equal(await button('임시 입력 버리기').evaluate(el=>el===document.activeElement),true);assert.equal(await page.evaluate(()=>window.qa.discarded),0)
  await button('임시 입력 버리기').click();await page.evaluate(()=>window.qa.pending(true));await page.getByRole('heading',{name:'이전 요청의 결과 확인이 필요합니다'}).waitFor();assert.equal(await button('입력 버리고 메뉴 이용').count(),0);assert.equal(await button('임시 입력 버리기').count(),0);await small();await fits();await capture('05-navigation-recovery',page.locator('.ws-recovery'))
 },{view:'recovery'})
 await check('연결 점검은 버튼을 눌러야 실행되며 상태·다음 행동과 미확인 범위를 보인다',async()=>{
  assert.equal(await page.evaluate(()=>window.qa.checks),0);await page.locator('.readiness-button').first().click();await page.getByText('현재 이용할 학교 소속이 없습니다',{exact:true}).waitFor();assert.equal(await page.locator('.readiness-checks [data-check-state=attention]').count(),1);assert.match(await page.locator('.readiness-next').innerText(),/학교 관리자/);await capture('06-navigation-readiness',page.locator('.connection-readiness'));await small();await fits();assert.equal(await page.evaluate(()=>window.qa.checks),1);assert.equal(await page.evaluate(()=>window.qa.writes.length),0)
 },{view:'readiness'})
 await check('모듈 오류는 재시도와 입력 손실 안내를 계속 표시하고 새로고침하지 않는다',async()=>{
  await small();assert.match(await page.locator('.ws-module-failure').innerText(),/요청 번호가 사라집니다/);await button('이 화면 다시 열기').click();assert.equal(await page.evaluate(()=>window.qa.retries),1);assert.equal(await page.evaluate(()=>window.qa.writes.length),0);await fits()
 },{view:'failure',theme:'dark'})
 for(const theme of ['light','warm','dark'])for(const area of ['search','notices','recovery','readiness'])await check(`${theme} 스킨의 ${area} 주요 상태·본문 대비`,async()=>{
  if(area==='search')await search();if(area==='notices')await inbox();if(area==='readiness'){await page.locator('.readiness-button').first().click();await page.getByText('현재 이용할 학교 소속이 없습니다',{exact:true}).waitFor()}
  const selector=area==='search'?'.ws-search-kind,.ws-search-excerpt,.ws-search-source':area==='notices'?'.messaging-notice-state,.messaging-notice-meta time,.messaging-empty p':area==='readiness'?'.readiness-step,.readiness-checks strong,.readiness-summary h3,.readiness-next strong':'.ws-recovery h2,.ws-recovery-warning,.ws-recovery a'
  const palette=await page.locator(selector).evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length).map(el=>{let parent=el,background='rgb(255, 255, 255)';while(parent){const color=getComputedStyle(parent).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){background=color;break}parent=parent.parentElement}return{text:el.textContent,color:getComputedStyle(el).color,background}}));assert(palette.length>=2);for(const item of palette)assert(contrast(item.color,item.background)>=4.5,`${theme} ${area}: ${item.text} ${contrast(item.color,item.background)}`)
 },{theme,...(['recovery','readiness'].includes(area)?{view:area}:{})})
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'navigation-ui-results.json'),JSON.stringify({results,errors,external},null,2));console.log(`공통 탐색·상태 안내 UI ${results.length}건 통과 · 외부 요청 0`)
}finally{await browser.close()}
