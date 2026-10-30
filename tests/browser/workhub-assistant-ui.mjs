// 화면 재배치가 유료 요청·원문 이동·기억·키 저장 확인을 대신 실행하지 않는지 검사한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'

const fixtures={assistant:'workhub-ai-school-policy',settings:'workhub-ai-school-policy',memory:'workhub-ai-memory',operations:'workhub-ai-operations'}
const bundles=Object.fromEntries(Object.entries(fixtures).map(([name,file])=>[name,buildSync({entryPoints:[fileURLToPath(new URL(`./${file}-fixture.tsx`,import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text]))
const font=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url)).toString('base64')
const shellStyles=['workspace-shell.css','workspace-renewal.css'].map(file=>readFileSync(new URL('../../apps/workhub/src/app/'+file,import.meta.url),'utf8')).join('\n')
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:45 920}body{font-family:Pretendard,sans-serif;background:var(--ui-surface-muted,#f6f7f9);color:var(--ui-text,#202832);margin:0;padding:28px}#root{max-width:1120px;margin:auto}*{box-sizing:border-box}</style><div id="root"></div></html>`
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[],results=[]
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5189/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:html})})
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true})
async function start(view){
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5189/assistant-ui/'+view)
 await page.evaluate(view=>{window.initialView=view;window.integrated=true},view)
 await page.addScriptTag({content:bundles[view]});await page.evaluate(()=>document.fonts.ready)
 if(view==='settings')await button('API 키 교체').waitFor()
 else if(view==='operations')await page.locator('.school-ai-operation-list>li').last().waitFor()
 else await button('내 개인 비서').waitFor({state:'visible'})
}
async function check(name,view,run){await start(view);try{await run()}catch(error){await capture('failure');console.error(await page.locator('#root').innerText());throw error}results.push(name);console.log('  ✓ '+name)}
async function capture(name,locator=page.locator('#root')){if(!process.env.WORKHUB_QA_OUTPUT)return;mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await locator.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png')})}
const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
async function answer(){
 await page.evaluate(()=>window.answerSegments=[{text:'현장체험학습 준비는 다음 순서로 진행해 주세요.\n\n1. 학년 협의에서 운영 계획과 담당 역할을 확인합니다.\n2. 학교 운영 계획에 따라 안전교육과 인원 점검을 준비합니다.\n3. 제출 전 최신 양식과 마감일을 담당자에게 확인합니다.',citations:[{reference:{kind:'knowledge',id:'school-guide-2026',version:3},title:'현장체험학습 운영 안내',locator:'운영 안내 2쪽 · 준비 절차\n「담당 교사는 출발 전 안전교육과 인원 점검을 실시한다.」'}]}])
 await field('질문 또는 부탁할 일').fill('현장체험학습을 준비하려고 해요. 확인할 순서를 알려 주세요.');await button('AI에게 요청').click();await page.getByText('Haiku 기본 답변',{exact:true}).waitFor()
 await page.getByText('근거 1개',{exact:true}).click()
}
async function darkSmall(){await page.setViewportSize({width:320,height:820});await page.addStyleTag({content:'html{--ui-surface:#171c28;--ui-surface-muted:#101521;--ui-text:#e9edf5;--ui-muted:#b7c3d6;--ui-line:#45506a;--ui-accent:#a4baff;--ui-accent-soft:#253658;--ui-on-accent:#102145;--ui-body-size:30px;--ui-small-size:26px;--ui-warning:#f0c475;--ui-warning-soft:#30271b}body{padding:8px}'});await fits()}
function contrast(a,b){const luminance=color=>{const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*values[0]+.7152*values[1]+.0722*values[2]};const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
try{
 await check('넓은 화면은 도구를 옆에 두고 좁은 화면은 질문 다음에 배치하며 자동 호출하지 않는다','assistant',async()=>{
  const compose=page.locator('.assistant-compose'),tools=page.getByRole('complementary',{name:'AI 대화 도구'})
  const a=await compose.boundingBox(),b=await tools.boundingBox();assert(b.x>a.x+a.width);assert(Math.abs(a.y-b.y)<2)
  await field('질문 또는 부탁할 일').fill('잠시 보관할 질문')
  await page.setViewportSize({width:390,height:844});await fits();const narrow=await tools.boundingBox();assert(narrow.y>(await compose.boundingBox()).y);assert.equal(await field('질문 또는 부탁할 일').inputValue(),'잠시 보관할 질문')
  await page.getByText('학교 AI 예산 · 기본 Haiku',{exact:true}).click();await page.getByText('이전 대화 0개',{exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0)
 })
 await check('답변·판·인용 줄바꿈은 유지하고 식별 정보는 명시적으로 펼쳐 본다','assistant',async()=>{
  await answer();const citation=page.locator('.assistant-citations');assert.match(await citation.innerText(),/판 3/)
  assert.equal(await citation.locator('.assistant-source-locator').evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap')
  assert.equal(await citation.locator('.assistant-source-id p').isVisible(),false)
  assert.equal(await button('인용 원문 보기').isVisible(),true);assert.equal(await page.evaluate(()=>window.calls.length),1)
  await capture('01-assistant-answer')
  await citation.getByText('출처 식별 정보',{exact:true}).click();assert.match(await citation.innerText(),/school-guide-2026/);assert.equal(await page.evaluate(()=>window.calls.length),1)
 })
 await check('원문 버튼은 인용 당시 자료·판 번호로만 이동하며 추가 AI 요청이 없다','assistant',async()=>{
  await answer();await button('인용 원문 보기').click();await page.waitForFunction(()=>window.openedCitations.length===1)
  const request=await page.evaluate(()=>window.openedCitations[0]);assert.equal(request.sourceId,'school-guide-2026');assert.equal(request.sourceVersion,3);assert.equal(await page.evaluate(()=>window.calls.length),1)
 })
 await check('정밀 검토 비용 안내는 버튼과 함께 보이고 직접 누른 뒤에만 Sonnet 요청이 생긴다','assistant',async()=>{
  await answer();assert.equal(await page.locator('.assistant-compose').evaluate(el=>Boolean(document.querySelector('.assistant-conversation')?.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)),true);const review=page.locator('.assistant-review');assert.match(await review.innerText(),/학교 예산에서 비용/)
  await page.getByText('학교 AI 예산 · 기본 Haiku',{exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),1)
  await button('이 답변 정밀 검토').click();assert.equal(await page.evaluate(()=>window.calls.length),1);await button('정밀 검토 취소').click();assert.equal(await page.evaluate(()=>window.calls.length),1);await button('이 답변 정밀 검토').click();await page.getByRole('button',{name:'비용 사용 확인하고 정밀 검토',exact:true}).click();await page.getByText('Sonnet 정밀 검토',{exact:true}).waitFor();const requests=await page.evaluate(()=>window.calls);assert.equal(requests.length,2);assert.equal(requests[1].input.reviewOf.requestKey,requests[0].requestKey)
 })
 await check('작은 화면·두 배 글씨에서도 인용·입력·요청 복구가 넘치거나 접혀 숨지 않는다','assistant',async()=>{
  await answer();await darkSmall();await button('인용 원문 보기').focus();assert.equal(await button('인용 원문 보기').evaluate(el=>document.activeElement===el),true)
  await field('질문 또는 부탁할 일').fill('두 번째 질문');await page.evaluate(()=>window.aiMissing=true);await button('AI에게 요청').click();await button('새 호출 없이 요청 닫기').waitFor();await fits()
  assert.equal(await page.getByRole('region',{name:'미확정 요청',exact:true}).isVisible(),true);assert.equal(await field('질문 또는 부탁할 일').inputValue(),'두 번째 질문');await capture('02-assistant-small-dark')
 })
 await check('기억 검색·상태·선택을 정리해도 확인 전 질문 사용이나 저장은 하지 않는다','memory',async()=>{
  await button('나의 AI 기억').click();await field('기억 선택: 답변 방식').waitFor();await field('기억 찾기').fill('답변');await page.getByText(/검색 결과 1개/).waitFor()
  assert.equal(await page.locator('.assistant-memory-list>li').count(),1);await field('기억 선택: 답변 방식').check();assert.equal(await button('선택한 기억을 질문에 넣기').isDisabled(),true)
  await page.locator('.assistant-memory-list summary').click();assert.match(await page.locator('.assistant-memory-meta').innerText(),/사용 가능/);assert.equal(await page.evaluate(()=>window.asks.length),0)
  await capture('03-personal-memory',page.getByRole('complementary',{name:'AI 대화 도구'}))
  await field('이 내용을 이번 질문에 넣겠습니다').check();await button('선택한 기억을 질문에 넣기').click();await page.waitForFunction(()=>document.querySelector('.assistant-compose textarea')?.value.includes('짧은 문단'))
  assert.equal(await page.evaluate(()=>window.asks.length),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>/memory_mutate/.test(c.name)).length),0)
 })
 await check('기억의 수정·중지·삭제는 짧은 버튼에도 대상 이름을 접근성 이름으로 유지한다','memory',async()=>{
  await button('나의 AI 기억').click();await field('기억 선택: 답변 방식').waitFor();assert.equal(await button('수정 · 중지 설정: 답변 방식').innerText(),'수정 · 중지')
  await button('수정 · 중지 설정: 답변 방식').focus();await page.keyboard.press('Enter');await field('기억 제목').fill('내가 쓰는 답변 방식');await field('기억 내용').fill('핵심부터 짧게 정리합니다.');await darkSmall();await fits()
  assert.equal(await button('확인한 기억 저장').isDisabled(),true);assert.equal(await page.evaluate(()=>window.calls.filter(c=>/memory_mutate/.test(c.name)).length),0)
  await capture('04-memory-editor-small',page.locator('.assistant-memory-editor'))
 })
 await check('설정은 예산·모델·등록 상태를 먼저 보여 주고 키 교체 열기만으로 저장하지 않는다','settings',async()=>{
  assert.equal(await field('교체할 API 키').isVisible(),false);assert.equal(await page.getByRole('region',{name:'학교 AI 월 예산'}).isVisible(),true)
  assert.match(await page.getByLabel('AI 모델 사용 구분').innerText(),/Haiku[\s\S]*Sonnet/);await capture('05-school-ai-settings')
  await button('API 키 교체').focus();await page.keyboard.press('Enter');await field('교체할 API 키').waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0)
  await field('교체할 API 키').fill('sk-ant-synthetic-ui-key-not-real');assert.equal(await button('확인한 키로 교체').isDisabled(),true)
  await page.waitForFunction(()=>window.locked===true);assert.equal(await button('키 입력 접기').isDisabled(),true)
  await button('키 입력 지우기').click();await button('키 입력 접기').click();assert.equal(await field('교체할 API 키').inputValue(),'');assert.equal(await page.evaluate(()=>window.calls.length),0)
 })
 await check('키 입력을 접어 두어도 결과 미상 복구는 밖에 보이고 비밀 없이 같은 번호를 확인한다','settings',async()=>{
  await button('API 키 교체').click();await field('교체할 API 키').fill('sk-ant-synthetic-ui-key-not-real');await field('현재 학교의 API 키를 교체할 것을 확인했습니다.').check();await page.evaluate(()=>window.fail='RESULT_UNKNOWN')
  await button('확인한 키로 교체').click();await button('키 없이 저장 결과 확인').waitFor();const first=await page.evaluate(()=>window.calls[0]);await page.evaluate(()=>window.setShow(false));await page.getByRole('heading',{name:'학교 AI 이용 설정',exact:true}).waitFor({state:'hidden'});await page.evaluate(()=>window.setShow(true))
  await button('키 없이 저장 결과 확인').waitFor();assert.equal(await field('교체할 API 키').isVisible(),false);await button('키 없이 저장 결과 확인').click();await page.getByText('기존 요청의 키 저장 완료를 확인했습니다.',{exact:true}).waitFor()
  const retry=await page.evaluate(()=>window.calls[1]);assert.equal(retry.requestKey,first.requestKey);assert.equal(Object.hasOwn(retry,'apiKey'),false)
 })
 await check('키 관리 권한이 없는 응답에는 교체 버튼과 입력을 표시하지 않는다','settings',async()=>{
  await page.evaluate(()=>{window.canManage=false;window.refresh()});await page.getByText('키 등록과 교체는 학교 관리 담당자만 할 수 있습니다.',{exact:true}).waitFor();assert.equal(await button('API 키 교체').count(),0);assert.equal(await field('교체할 API 키').count(),0);assert.equal(await page.evaluate(()=>window.calls.length),0)
 })
 await check('관리자 설정도 작은 화면·큰 글씨·어두운 테마에서 읽고 키 입력을 유지한다','settings',async()=>{
  await button('API 키 교체').click();await field('교체할 API 키').fill('sk-ant-synthetic-ui-key-not-real');await darkSmall();await fits();assert.equal(await field('교체할 API 키').inputValue(),'sk-ant-synthetic-ui-key-not-real');assert.equal(await field('교체할 API 키').getAttribute('type'),'password');assert.equal(await page.evaluate(()=>window.calls.length),0);await capture('06-settings-small-dark')
 })
 await check('운영 현황은 예약 주의를 접지 않고 요청 상세 펼치기만으로 재호출하지 않는다','operations',async()=>{
  const before=await page.evaluate(()=>window.calls.length)
  assert.match(await page.locator('.school-ai-operation-attention').innerText(),/확인할 예약/);const first=page.locator('.school-ai-operation-list>li').first();await first.getByText('요청 정보',{exact:true}).click();assert.match(await first.innerText(),/private-request/)
  await capture('07-school-ai-operations',page.locator('.school-ai-operation-summary'))
  assert.equal(await page.evaluate(()=>window.calls.length),before);await button('서버 준비 상태 확인').click();await page.locator('.school-ai-check-state').last().waitFor();assert.equal(await page.locator('.school-ai-check-state[data-state=unknown]').count(),1);assert.equal(await page.evaluate(()=>window.calls.every(c=>!c.writing)),true)
  await capture('08-school-ai-diagnostics',page.locator('.school-ai-diagnostics'))
 })
 await check('운영 표는 내부 스크롤을 쓰며 큰 글씨에서도 상태를 색상과 문구로 함께 보여 준다','operations',async()=>{
  await darkSmall();await page.getByText('기능·모델별 사용량',{exact:true}).click();await button('서버 준비 상태 확인').click();await page.locator('.school-ai-check-state').last().waitFor();await fits();assert.equal(await page.getByRole('region',{name:'기능별 사용량',exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth),true)
  const completed=page.locator('.school-ai-operation-state[data-state=completed]').first();assert.equal(await completed.evaluate(el=>getComputedStyle(el).color),'rgb(164, 186, 255)');assert.match(await completed.innerText(),/완료/);await capture('09-operations-small-dark',page.locator('.school-ai-operation-summary'))
 })
 for(const view of ['assistant','memory','settings','operations'])for(const theme of ['light','warm','dark'])await check(`${view} · ${theme} 실제 스킨의 주요 글자 대비`,view,async()=>{
  if(view==='assistant')await answer()
  if(view==='memory'){await button('나의 AI 기억').click();await field('기억 선택: 답변 방식').waitFor();await field('기억 선택: 답변 방식').check()}
  if(view==='operations'){await button('서버 준비 상태 확인').click();await page.locator('.school-ai-check-state').last().waitFor()}
  await page.addStyleTag({content:shellStyles});await page.locator('#root').evaluate((el,theme)=>{el.classList.add('ws-shell');el.dataset.theme=theme},theme)
  const selector=view==='assistant'?'.assistant-source-version,.assistant-source-locator,.assistant-execution,.assistant-review .assistant-hint':view==='memory'?'.assistant-memory-meta,.assistant-memory-state':view==='settings'?'.assistant-budget dt,.assistant-budget .assistant-hint,.school-ai-models small,.school-ai-availability':'.school-ai-operation-summary dt,.school-ai-operation-state,.school-ai-check-state'
  const palette=await page.locator(selector).evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length).map(el=>{let parent=el,background='rgb(255, 255, 255)';while(parent){const color=getComputedStyle(parent).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){background=color;break}parent=parent.parentElement??parent.getRootNode().host}return{text:el.textContent,color:getComputedStyle(el).color,background}}))
  assert(palette.length>=2);for(const item of palette)assert(contrast(item.color,item.background)>=4.5,`${theme}: ${item.text} / ${contrast(item.color,item.background).toFixed(2)}`)
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'assistant-ui-results.json'),JSON.stringify({results,errors,external},null,2));console.log(`AI 화면 정리 브라우저 ${results.length}개 통과 · 실제 외부 호출 0건`)
}finally{await browser.close()}
