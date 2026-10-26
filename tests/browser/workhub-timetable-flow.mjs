import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-timetable-flow-fixture.tsx',import.meta.url))],bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.url':'"http://127.0.0.1:5179/worker-client.ts"','import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const font=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url)).toString('base64')
const html=`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2')}body{font-family:Pretendard,sans-serif;margin:0;padding:16px}*{box-sizing:border-box}</style><div id="root"></div></html>`
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),passed=[],errors=[],external=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5179/'))external.push(r.url())})
await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}))
async function start(){await page.goto('http://127.0.0.1:5179/flow');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'편성 관리',exact:true}).click();await page.getByRole('button',{name:'시간표 만들기',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready)}
async function check(name,run){await start();await run();passed.push(name);console.log('  ✓ '+name)}
async function design(){await page.getByRole('button',{name:'시간표 만들기',exact:true}).click()}
async function generate(){await design();await page.getByRole('button',{name:'배치·비교',exact:true}).click();await page.getByRole('button',{name:'배치 만들기',exact:true}).click();await page.getByText('전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인',{exact:true}).waitFor()}
async function save(){await page.getByRole('button',{name:'초안 저장·공개 검토',exact:true}).click();await page.getByLabel('초안 이름',{exact:true}).fill('확정 검토할 합성 초안');await page.getByRole('button',{name:'새 초안으로 서버에 저장',exact:true}).click()}
const handoff=()=>page.getByRole('button',{name:'저장한 초안으로 확정 검토 열기',exact:true})
const writes=()=>page.evaluate(()=>window.calls.filter(r=>r.name.includes('_execute')||r.name.includes('_preview')).length)
try{
 await check('조건→실제 계산→초안 저장→정확한 초안 확정 검토가 자동 공개 없이 이어진다',async()=>{
  await design();await page.getByRole('button',{name:'조건 입력 시작하기',exact:true}).click();await page.getByLabel('조건 종류',{exact:true}).selectOption('preferences');await page.getByLabel('조건 수업',{exact:true}).selectOption('practice-lesson-a1');await page.getByLabel('조건 시간',{exact:true}).selectOption('practice-1-1');await page.getByRole('button',{name:'조건 추가',exact:true}).click();await page.getByRole('button',{name:'생성 화면으로 이동',exact:true}).click();await page.getByRole('button',{name:'배치 만들기',exact:true}).click();await page.getByText('전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인',{exact:true}).waitFor();await save();await handoff().waitFor();await handoff().click();await page.getByLabel('확정할 저장 초안',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="확정할 저장 초안"]')?.value==='saved-1@1');assert.equal(await page.evaluate(()=>window.saved),1);assert.equal(await writes(),0);assert.match(await page.getByRole('region',{name:'초안 확정',exact:true}).innerText().catch(()=>page.locator('body').innerText()),/확정/)
 })
 await check('결과 미상은 새 저장과 확정 연결을 막고 원래 번호를 복구한 뒤 이동한다',async()=>{
  await generate();await page.evaluate(()=>window.drop=true);await save();await page.getByRole('button',{name:'같은 요청으로 저장 결과 확인',exact:true}).waitFor();assert.equal(await handoff().count(),0);await page.getByRole('button',{name:'같은 요청으로 저장 결과 확인',exact:true}).click();await handoff().waitFor();const calls=await page.evaluate(()=>window.calls.filter(r=>r.name==='workhub_timetable_save_draft'));assert.equal(calls.length,2);assert.deepEqual(calls[0].args.p_input,calls[1].args.p_input);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.equal(calls[1].args.p_recover_only,true);await handoff().click();await page.getByLabel('확정할 저장 초안',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.saved),1);assert.equal(await writes(),0)
 })
 await check('저장 후 제목을 바꾸면 옛 초안을 넘기지 않고 새 저장 접수증을 사용한다',async()=>{
  await generate();await save();await handoff().waitFor();await page.getByLabel('초안 이름',{exact:true}).fill('바뀐 제목');assert.equal(await handoff().count(),0);assert.equal(await page.getByRole('button',{name:'시간표 보기',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'새 초안으로 서버에 저장',exact:true}).click();await handoff().waitFor();await handoff().click();await page.waitForFunction(()=>document.querySelector('[aria-label="확정할 저장 초안"]')?.value==='saved-2@1');assert.equal(await page.evaluate(()=>window.saved),2);assert.equal(await writes(),0)
 })
 await check('확정 목록에서 초안 판이 달라지면 자동 선택하지 않는다',async()=>{
  await generate();await save();await handoff().waitFor();await page.evaluate(()=>window.operationVersion=2);await handoff().click();await page.getByLabel('확정할 저장 초안',{exact:true}).waitFor();assert.equal(await page.getByLabel('확정할 저장 초안',{exact:true}).inputValue(),'');assert.equal(await writes(),0)
 })
 await check('확정 탭으로 다녀와도 저장한 편성의 단계와 입력이 유지된다',async()=>{
  await generate();await save();await handoff().waitFor();await page.getByRole('button',{name:'시간표 보기',exact:true}).click();await page.getByRole('heading',{name:'시간표 운영',exact:true}).waitFor();await page.getByRole('button',{name:'편성 관리',exact:true}).click();await page.getByLabel('초안 이름',{exact:true}).waitFor();assert.equal(await page.getByLabel('초안 이름',{exact:true}).inputValue(),'확정 검토할 합성 초안');await handoff().waitFor();assert.equal(await page.evaluate(()=>window.saved),1)
 })
 await check('한 번 넘긴 초안은 입력 정리 후 일반 재진입에서 다시 자동 선택되지 않는다',async()=>{
  await generate();await save();await handoff().waitFor();await handoff().click();await page.waitForFunction(()=>document.querySelector('[aria-label="확정할 저장 초안"]')?.value==='saved-1@1');await page.getByRole('button',{name:'확정 입력 정리',exact:true}).click();await page.getByRole('button',{name:'확정 입력 비우기',exact:true}).click();await page.getByRole('button',{name:'편성 관리',exact:true}).click();await handoff().waitFor();await page.getByRole('button',{name:'시간표 보기',exact:true}).click();await page.getByLabel('확정할 저장 초안',{exact:true}).waitFor();assert.equal(await page.getByLabel('확정할 저장 초안',{exact:true}).inputValue(),'');assert.equal(await page.evaluate(()=>window.locked),false);assert.equal(await writes(),0)
 })
 await check('새 기초판은 기존 저장 접수증을 새 편성의 확정 근거로 사용하지 않는다',async()=>{
  await generate();await save();await handoff().waitFor();await page.evaluate(()=>{window.snapshot.basis.revision++;window.snapshot.basis.sourceFingerprint='b'.repeat(64);window.snapshot.drafts=[];window.refresh()});await page.getByText('기초 자료가 바뀌었습니다',{exact:true}).waitFor();assert.equal(await handoff().count(),0);assert.equal(await writes(),0)
 })
 await check('계산 취소 후 늦게 온 결과가 배치를 만들거나 저장하지 않는다',async()=>{
  await design();await page.getByRole('button',{name:'배치·비교',exact:true}).click();await page.evaluate(()=>window.holdSolve=true);await page.getByRole('button',{name:'배치 만들기',exact:true}).click();await page.getByRole('button',{name:'계산 중지',exact:true}).click();await page.getByRole('alert').filter({hasText:'계산을 중지했습니다.'}).waitFor();await page.evaluate(()=>window.deliverSolve());assert.equal(await page.getByText('전체 필수 조건 검사 통과 · 교사·학생 집단·공간·시수 확인',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.saved),0)
 })
 await check('320px·200% 글자에서도 다음 단계와 저장 연결을 키보드로 이용한다',async()=>{
  await page.setViewportSize({width:320,height:740});await page.addStyleTag({content:'html{font-size:32px}'});await design();await page.getByRole('button',{name:'조건 입력 시작하기',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'생성 화면으로 이동',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,'timetable-flow-mobile.png'),fullPage:true})};await page.setViewportSize({width:1280,height:900})
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'timetable-flow-results.json'),JSON.stringify({passed,errors,external},null,2))};console.log('시간표 전체 흐름 브라우저: '+passed.length+'개 통과')
}catch(error){console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>window.calls));throw error}finally{await browser.close()}
