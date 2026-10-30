import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {clickWorkspaceMenu} from '../helpers/workspace-menu.mjs'
import {launchBrowser} from './launch-browser.mjs'
const bundle=await build({plugins:[{name:'synthetic-guided-setup-ai',setup(build){build.onLoad({filter:/assistant[\\/]legacy-http\.ts$/},()=>({contents:'export const legacyAssistantHttp={send:(...args)=>window.aiPort.send(...args)};export const legacySchoolAiHttp={send:async()=>{throw Error("synthetic settings unavailable")}};export const legacySchoolAiOperationsHttp={send:async()=>{throw Error("synthetic operations unavailable")}}',loader:'ts'}))}}],entryPoints:[fileURLToPath(new URL('./workhub-guided-setup-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'test-anon'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],external=[],results=[]
const output=mkdtempSync(join(tmpdir(),'workhub-guided-setup-'))
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:5179/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:8px"><div id="root"></div></body></html>'});external.push(route.request().url());return route.abort()})
const panel=()=>page.getByRole('region',{name:'수합 방식과 질문 제안',exact:true})
const writes=()=>page.evaluate(()=>window.calls.filter(c=>/mutate|request_get|render|publish/.test(c.name)))
async function start(connected=false,complex=false){await page.goto('http://127.0.0.1:5179/guided-setup');await page.evaluate(value=>Object.assign(window,value),{connected,complex});await page.addScriptTag({content:bundle.outputFiles[0].text});if(connected){await clickWorkspaceMenu(page,'문서함');await page.getByRole('button',{name:'질문형 수합 양식',exact:true}).click()}await page.getByRole('button',{name:/가상 학교 행사 양식/}).click();await panel().waitFor()}
async function choose(indices=[1,2]){await panel().getByRole('button',{name:'질문형으로 준비',exact:true}).click();for(const index of indices)await panel().getByLabel('제안 선택 '+index,{exact:true}).check()}
async function confirm(){await panel().getByLabel('선택한 질문과 원본 위치를 확인했습니다',{exact:true}).check()}
async function apply(){await confirm();await panel().getByRole('button',{name:'선택한 연결 제안 반영',exact:true}).click();await page.getByLabel('질문 내용',{exact:true}).nth(1).waitFor()}
async function ask(indices=[1,2]){await choose(indices);await panel().getByText('선택한 후보를 AI와 검토',{exact:true}).click();await panel().getByLabel('AI에 보낼 항목과 문맥을 확인했습니다',{exact:true}).check();await panel().getByRole('button',{name:'선택한 질문 제안 받기',exact:true}).click();await page.getByRole('button',{name:'전달받은 요청 사용',exact:true}).click();await page.getByRole('button',{name:'AI에게 요청',exact:true}).click();await page.getByRole('button',{name:'이 초안을 작성 화면으로 보내기',exact:true}).waitFor()}
async function back(){await page.getByRole('button',{name:'이 초안을 작성 화면으로 보내기',exact:true}).click();await panel().waitFor()}
async function check(name,action,options={}){await start(options.connected,options.complex);try{await action();results.push({name,passed:true});console.log('  ✓ '+name)}catch(error){console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>({calls:window.calls,asks:window.asks,locked:window.locked})));throw error}}
try{
 await check('검사한 빈 문단만 제안하고 화면을 열어도 AI 호출이나 저장을 하지 않는다',async()=>{
  await choose();assert.equal(await panel().getByLabel(/^제안 선택 \d+$/).count(),2);assert.match(await panel().innerText(),/활동명/);assert.match(await panel().innerText(),/실시일/);assert.equal(await page.getByLabel('질문 내용',{exact:true}).inputValue(),'기존 질문');assert.deepEqual(await writes(),[]);assert.equal(await page.evaluate(()=>window.asks.length),0)
 })
 await check('선택한 연결만 원문·해시를 보존해 추가하며 명시 저장 전에는 서버 쓰기가 없다',async()=>{
  await choose([1]);await panel().getByLabel('제안 선택 2',{exact:true}).uncheck();await panel().getByLabel('제안 질문 1',{exact:true}).fill('활동명을 알려 주세요');await apply();
  assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),2);assert.equal(await page.getByLabel('질문 내용',{exact:true}).first().inputValue(),'기존 질문');assert.equal(await page.getByLabel('질문 내용',{exact:true}).nth(1).inputValue(),'활동명을 알려 주세요');assert.equal(await page.getByLabel('기존 질문 (필수)',{exact:true}).inputValue(),'저장된 기존 답변');assert.deepEqual(await writes(),[]);
  await page.getByRole('button',{name:'질문과 입력 위치 저장',exact:true}).click();await page.getByText(/저장을 확인했습니다/).waitFor();const calls=await writes();assert.equal(calls.length,1);const qs=calls[0].args.p_command.mapping.questions;assert.equal(qs[0].sourceText,'기존 계획 원문을 보존합니다');assert.equal(qs[1].anchorId,'Contents/section0.xml:p000001');assert.equal(qs[1].sourceText,'');assert.equal(qs[1].sourceHash,'a'.repeat(64));assert(!qs.some(q=>q.anchorId==='Contents/section0.xml:p000003'))
 })
 await check('질문 또는 선택이 바뀌면 원본 확인을 다시 요구한다',async()=>{
  await choose();await confirm();await panel().getByLabel('제안 질문 1',{exact:true}).fill('수정한 활동명 질문');assert.equal(await panel().getByLabel('선택한 질문과 원본 위치를 확인했습니다',{exact:true}).isChecked(),false);assert.equal(await panel().getByRole('button',{name:'선택한 연결 제안 반영',exact:true}).isDisabled(),true);await confirm();await panel().getByLabel('제안 선택 2',{exact:true}).uncheck();assert.equal(await panel().getByLabel('선택한 질문과 원본 위치를 확인했습니다',{exact:true}).isChecked(),false);assert.deepEqual(await writes(),[])
 })
 await check('제안 편집은 양식별로 보존하고 다른 양식의 후보와 섞지 않는다',async()=>{
  await choose([1]);await panel().getByLabel('제안 질문 1',{exact:true}).fill('행사 양식에만 보관한 질문');await confirm();await page.getByRole('button',{name:/가상 안전교육 양식/}).click();await page.getByRole('heading',{name:'가상 안전교육 양식 · v2',exact:true}).waitFor();await panel().getByRole('button',{name:'질문형으로 준비',exact:true}).click();assert.notEqual(await panel().getByLabel('제안 질문 1',{exact:true}).inputValue(),'행사 양식에만 보관한 질문');await panel().getByLabel('제안 질문 1',{exact:true}).fill('안전교육에만 보관한 질문');await page.getByRole('button',{name:/가상 학교 행사 양식/}).click();await page.getByRole('heading',{name:'가상 학교 행사 양식 · v2',exact:true}).waitFor();assert.equal(await panel().getByLabel('제안 질문 1',{exact:true}).inputValue(),'행사 양식에만 보관한 질문');assert.equal(await panel().getByLabel('제안 선택 1',{exact:true}).isChecked(),true);assert.equal(await panel().getByLabel('선택한 질문과 원본 위치를 확인했습니다',{exact:true}).isChecked(),false);assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('반영 직전 양식판이 바뀌면 기존 질문을 유지하고 연결하지 않는다',async()=>{
  await choose();await confirm();await page.evaluate(()=>window.changeTemplate());await panel().getByRole('button',{name:'선택한 연결 제안 반영',exact:true}).click();await panel().getByRole('alert').waitFor();assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('반영 직전 권한이 사라지면 제안으로 원본을 변경하지 않는다',async()=>{
  await choose();await confirm();await page.evaluate(()=>window.getError='FORBIDDEN');await panel().getByRole('button',{name:'선택한 연결 제안 반영',exact:true}).click();await panel().getByRole('alert').waitFor();assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('반영 조회 중 새로고침하면 늦은 응답을 버리고 기존 질문만 남긴다',async()=>{
  await choose();await confirm();await page.evaluate(()=>window.deferGet=true);await panel().getByRole('button',{name:'선택한 연결 제안 반영',exact:true}).click();await page.waitForFunction(()=>typeof window.resolveGet==='function')
  const revision=await page.evaluate(()=>window.refresh())
  // setState 호출만으로 갱신이 반영된 것은 아니다. 화면의 세대 변경 뒤에 이전 응답을 도착시킨다.
  await page.waitForFunction(value=>window.appliedRevision===value,revision)
  await panel().locator('label').filter({hasText:'선택한 질문과 원본 위치를 확인했습니다'}).locator('input:not(:checked)').waitFor()
  assert.equal(await panel().getByLabel('선택한 질문과 원본 위치를 확인했습니다',{exact:true}).isChecked(),false)
  await page.evaluate(()=>window.resolveGet());await page.waitForFunction(()=>window.locked===false);assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('AI 요청은 선택 문맥 확인과 명시 전송 뒤에만 실행하고 제안으로만 돌아온다',async()=>{
  await ask();assert.equal(await page.evaluate(()=>window.asks.length),1);await back();await panel().getByLabel('제안 질문 1',{exact:true}).waitFor();assert.equal(await panel().getByLabel('제안 질문 1',{exact:true}).inputValue(),'활동 이름은 무엇인가요?');assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[]);assert.equal(await page.evaluate(()=>window.lastRequest.origin.id===window.returnContext),true);await choose();await apply();assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),3)
 })
 await check('AI에는 선택한 후보 문맥만 보내고 기존 답변과 다른 후보는 보내지 않는다',async()=>{
  await page.evaluate(()=>{const proposal=JSON.parse(window.replyBody);proposal.questions=proposal.questions.slice(0,1);window.replyBody=JSON.stringify(proposal)});await ask([1]);const sent=await page.evaluate(()=>window.asks[0].input.prompt);assert.match(sent,/활동명/);assert.doesNotMatch(sent,/Contents\/section0\.xml:p000003|실시일:|저장된 기존 답변|기존 계획 원문을 보존합니다/);await back();await panel().getByLabel('제안 질문 1',{exact:true}).waitFor();assert.equal(await panel().getByLabel(/^제안 선택 \d+$/).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('AI가 선택하지 않은 위치를 만들어 보내면 전체 제안을 반영하지 않는다',async()=>{
  await page.evaluate(()=>{const proposal=JSON.parse(window.replyBody);proposal.questions[0].anchorId='Contents/section0.xml:p999999';window.replyBody=JSON.stringify(proposal)});await ask();await back();await panel().getByRole('alert').waitFor();assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('AI 요청 이후 원문판 변경은 돌아온 제안을 기존 양식에 덮어쓰지 않는다',async()=>{
  await ask();await page.evaluate(()=>window.changeTemplate());await back();await panel().getByRole('alert').waitFor();assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.deepEqual(await writes(),[])
 })
 await check('돌아온 AI 제안의 원본 조회가 실패해도 읽기 재시도로 복구하고 유료 요청을 늘리지 않는다',async()=>{
  await ask();await page.evaluate(()=>window.getError='QUERY_FAILED');await back();await panel().getByRole('alert').waitFor();assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),1);assert.equal(await page.evaluate(()=>window.asks.length),1);const readsBefore=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_template_get').length);await page.evaluate(()=>window.getError=null);await panel().getByRole('button',{name:'돌아온 제안 다시 확인',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(input=>input.value==='활동 이름은 무엇인가요?'));assert.equal(await panel().getByLabel('제안 질문 1',{exact:true}).inputValue(),'활동 이름은 무엇인가요?');assert.equal(await page.evaluate(()=>window.asks.length),1);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_template_get').length),readsBefore+1);assert.deepEqual(await writes(),[])
 })
 await check('학교 변경 뒤 늦은 확인 응답은 이전 질문 제안을 노출하지 않는다',async()=>{
  await choose();await confirm();await page.evaluate(()=>window.deferGet=true);await panel().getByRole('button',{name:'선택한 연결 제안 반영',exact:true}).click();await page.waitForFunction(()=>typeof window.resolveGet==='function');await page.evaluate(()=>{window.changeScope();window.resolveGet()});await page.getByText('사용할 수 있는 질문형 양식이 없습니다.').waitFor();assert.equal(await panel().count(),0);assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),0);assert.deepEqual(await writes(),[])
 })
 await check('매핑 저장 응답 유실은 기존 요청 번호로만 복구하고 새 제안을 보내지 않는다',async()=>{
  await choose();await apply();await page.evaluate(()=>window.unknown=true);await page.getByRole('button',{name:'질문과 입력 위치 저장',exact:true}).click();await page.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).waitFor();const first=(await writes())[0];const request=panel().getByRole('button',{name:'선택한 질문 제안 받기',exact:true});assert.equal(await request.count()===0||await request.isDisabled(),true);await page.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).click();await page.getByText(/저장을 확인했습니다/).waitFor();const calls=await writes();assert.equal(calls.length,2);assert.deepEqual(calls[1].args,first.args);assert.equal(await page.evaluate(()=>window.pending.count()),0)
 })
 await check('복합 문단이 있는 양식도 담당자가 파일형을 선택해 이동할 수 있으며 자동 저장하지 않는다',async()=>{
  assert.match(await page.locator('body').innerText(),/복합 문단 2개/);await panel().getByRole('button',{name:'파일형으로 진행',exact:true}).click();await panel().getByRole('button',{name:'파일형 수합 화면 열기',exact:true}).click();assert.equal(await page.evaluate(()=>window.fileOpens),1);assert.equal(await page.evaluate(()=>window.asks.length),0);assert.deepEqual(await writes(),[])
 },{complex:true})
 await check('320px에서 질문 제안과 확인을 가로 넘침 없이 사용한다',async()=>{
  await page.setViewportSize({width:320,height:740});await choose();await confirm();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);await page.screenshot({path:join(output,'guided-setup-320.png'),fullPage:true})
 })
 await page.setViewportSize({width:1280,height:1000})
 await check('실제 업무실은 양식 준비→비서→원래 질문형 탭으로 돌아오며 저장을 자동 실행하지 않는다',async()=>{
  await ask();await back();await panel().getByLabel('제안 질문 1',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'질문형 수합 양식',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await panel().getByLabel('제안 질문 1',{exact:true}).inputValue(),'활동 이름은 무엇인가요?');assert.deepEqual(await writes(),[])
 },{connected:true})
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(output,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log(`양식 추천·질문 연결 브라우저 ${results.length}건 통과 · ${output}`)
}finally{await browser.close()}
