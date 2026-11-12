import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-plan-workflow-connected-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),origin='http://127.0.0.1:5294/',errors=[],external=[]
let passed=0
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await context.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort()}return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true}),plan=()=>page.getByRole('region',{name:'나누어 진행할 업무',exact:true})
const writes=()=>page.evaluate(()=>window.workflow.calls.filter(c=>c.name==='workhub_message_mutate'||c.name==='workhub_collection_mutate'))
async function command(text,label){await input().fill(text);await button(label).click()}
async function build(first){await command(`1. ${first}\n2. 시간표 보여줘`,'업무 나누기');await plan().waitFor();await plan().getByRole('button',{name:/^1단계 선택/}).click()}
async function messageDraft(){await build('메시지 초안: 자료를 확인해 주세요.');await button('메시지 초안 열기').click();await page.getByLabel('가상 교사 02',{exact:true}).check();assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'자료를 확인해 주세요.')}
async function send(){await button('받는 사람과 내용 확인').click();await button('확인한 내용 보내기').click()}
async function collectionDraft(){await build('수합 초안: 학년 자료');await button('수합 초안 열기').click();await button('수합 초안 사용').click();await page.getByLabel('제출 기한',{exact:true}).fill('2026-11-20');await page.getByRole('checkbox',{name:'가상 교사 01',exact:true}).check()}
async function talk(){await button('대화 보기').click();await plan().waitFor()}
async function test(name,run){await page.setViewportSize({width:1280,height:1000});await page.goto(origin);await page.addScriptTag({content:bundle});await button('AI 비서').first().click();await input().waitFor();try{await run();passed++;console.log('  ✓ '+name)}catch(e){console.error(await page.locator('.workhub-connected').innerText());throw e}}
try{
  await test('실제 연결 셸에서 메시지 초안→최종 전송 접수만 해당 단계에 기록한다',async()=>{
    await messageDraft();assert.deepEqual(await writes(),[]);await send();await page.getByRole('region',{name:'최근 발송 결과',exact:true}).waitFor();await talk()
    assert.match(await plan().innerText(),/처리 내역 확인[\s\S]*메시지 전송 · 1개 대화 접수/)
    assert.equal(await plan().getByRole('button',{name:/^1단계 선택/}).isDisabled(),true)
    await command('다음 업무','업무 목록 확인');assert.equal(await input().inputValue(),'시간표 보여줘');assert.equal((await writes()).length,1)
  })
  await test('메시지 응답 유실은 완료로 표시하지 않고 같은 번호 복구 뒤 한 번만 기록한다',async()=>{
    await messageDraft();await page.evaluate(()=>window.workflow.unknown='message');await send();await button('이전 요청 그대로 다시 확인').waitFor()
    assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(),0)
    await button('이전 요청 그대로 다시 확인').click();await page.getByRole('region',{name:'최근 발송 결과',exact:true}).waitFor();await talk()
    assert.match(await plan().innerText(),/메시지 전송 · 1개 대화 접수/)
    const calls=await writes();assert.equal(calls.length,2);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key)
    assert.equal(await page.evaluate(()=>window.workflow.writes),1)
  })
  await test('수합 초안 접수와 공개를 구분하고 작성하던 원본의 후속 결과를 보존한다',async()=>{
    await collectionDraft();await button('수합 초안 저장').click();await button('대상 교사에게 공개').waitFor();await talk()
    assert.match(await plan().innerText(),/수합 초안 저장 · 아직 미공개/);assert.doesNotMatch(await plan().innerText(),/최종 제출 접수/)
    await button('작성하던 업무 보기').click();await button('대상 교사에게 공개').click();await button('대상·양식 확인 후 공개').click();await button('내 제출 파일 작성').waitFor();await talk()
    assert.match(await plan().innerText(),/수합 공개/);await plan().getByText('이전 처리 1건',{exact:true}).click();assert.match(await plan().innerText(),/수합 초안 저장 · 아직 미공개/)
    assert.deepEqual((await writes()).map(c=>c.args.p_command.kind),['create','publish'])
    if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,'plan-workflow-results-desktop.png'),fullPage:true})}
    await page.setViewportSize({width:320,height:720});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,'plan-workflow-results-mobile.png'),fullPage:true})}
  })
  await test('수합 응답 유실 뒤 원래 번호로 복구해도 초안만 저장하고 자동 공개하지 않는다',async()=>{
    await collectionDraft();await page.evaluate(()=>window.workflow.unknown='collection');await button('수합 초안 저장').click();await button('이전 요청 그대로 다시 확인').waitFor()
    assert.equal(await page.locator('.assistant-plan [data-outcome="recorded"]').count(),0)
    await button('이전 요청 그대로 다시 확인').click();await button('대상 교사에게 공개').waitFor();await talk()
    assert.match(await plan().innerText(),/수합 초안 저장 · 아직 미공개/);const calls=await writes();assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args)
    assert.equal(await page.evaluate(()=>window.workflow.requests[0].status),'draft')
  })
  await test('전달된 메시지 초안을 닫은 뒤 별도로 만든 메시지는 원래 단계 결과가 아니다',async()=>{
    await build('메시지 초안: 원래 초안');await button('메시지 초안 열기').click();await page.getByLabel('메시지',{exact:true}).waitFor();await button('작성 닫기').click();await button('작성한 입력 버리고 닫기').click()
    await button('메시지 작성').click();await page.getByLabel('가상 교사 02',{exact:true}).check();await page.getByLabel('메시지',{exact:true}).fill('별도로 만든 메시지');await send();await page.getByRole('region',{name:'최근 발송 결과',exact:true}).waitFor();await talk()
    assert.match(await plan().innerText(),/화면 연결됨/);assert.equal(await plan().locator('[data-outcome="recorded"]').count(),0)
  })
  await test('수합 초안을 닫은 뒤 새로 만든 수합은 원래 단계에 붙이지 않는다',async()=>{
    await build('수합 초안: 원래 초안');await button('수합 초안 열기').click();await button('전달받은 수합 초안 닫기').click()
    await button('새 수합 만들기').click();await page.getByLabel('수합 제목',{exact:true}).fill('다른 수합');await page.getByLabel('제출 기한',{exact:true}).fill('2026-11-20');await page.getByRole('checkbox',{name:'가상 교사 01',exact:true}).check();await button('수합 초안 저장').click();await button('대상 교사에게 공개').waitFor();await talk()
    assert.match(await plan().innerText(),/화면 연결됨/);assert.equal(await plan().locator('[data-outcome="recorded"]').count(),0)
  })
  await test('범용 수합 화면에서 명시적으로 저장한 결과는 해당 화면 단계에 기록한다',async()=>{
    await build('수합 열어줘');await button('바로 이동').click();await button('새 수합 만들기').click();await page.getByLabel('수합 제목',{exact:true}).fill('화면에서 고른 자료');await page.getByLabel('제출 기한',{exact:true}).fill('2026-11-20');await page.getByRole('checkbox',{name:'가상 교사 01',exact:true}).check();await button('수합 초안 저장').click();await button('대상 교사에게 공개').waitFor();await talk()
    assert.match(await plan().innerText(),/수합 초안 저장 · 아직 미공개/)
    await command('원문 다시 검토','업무 목록 확인');assert.match(await page.getByRole('alert').filter({hasText:'이미 처리한 단계'}).innerText(),/전체 요청에서 처리 결과를 확인하고, 남은 업무만 새 요청으로 작성/);assert.equal((await writes()).length,1)
  })
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  console.log(`실제 연결 셸의 업무 결과 연결 ${passed}건 통과 · 합성 RPC·유료 호출 0`)
}finally{await browser.close()}
