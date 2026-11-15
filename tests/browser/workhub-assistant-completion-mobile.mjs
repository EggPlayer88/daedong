// 실제 연결 셸을 사용한 합성 모바일 회귀. 실제 휴대폰 IME·운영 DB·유료 AI 검증은 아니다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({entryPoints:[fileURLToPath(new URL('./workhub-global-search-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(), context=await browser.newContext({viewport:{width:390,height:844}}), page=await context.newPage()
const errors=[], external=[], origin='http://127.0.0.1:5276/'
let passed=0
page.setDefaultTimeout(12000)
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
await context.route('**/*',route=>{
  if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})
})
const button=name=>page.getByRole('button',{name,exact:true})
const input=()=>page.getByLabel('질문 또는 부탁할 일',{exact:true})
const mutations=()=>page.evaluate(()=>window.qa.calls.filter(row=>/(?:_mutate|_execute|_commit|_ask|_confirm|_apply)$/.test(row.name)))
async function noWrite(){assert.deepEqual(await mutations(),[])}
async function command(text,label='업무 시작'){await input().fill(text);await button(label).click()}
async function open(){await button('AI 비서 열기').click();await input().and(page.locator(':enabled')).waitFor()}
async function test(name,run){
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'completion-mobile');await page.addScriptTag({content:bundle});await open()
  try{await run();passed++;console.log('  ✓ '+name)}catch(error){console.error(await page.locator('.workhub-connected').innerText());throw error}
}
async function fits(){
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'문서 전체에 가로 스크롤이 생기면 안 됩니다')
  const overflow=await page.locator('.assistant-delivery').evaluate(root=>[...root.querySelectorAll('button,input,textarea,select,summary')].filter(el=>{
    const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0&&(rect.left < -1 || rect.right > innerWidth+1)
  }).map(el=>({text:el.textContent?.slice(0,65),width:el.getBoundingClientRect().width})))
  assert.deepEqual(overflow,[],'대화 안의 조작 대상이 화면 밖으로 잘리면 안 됩니다')
}
async function reachable(control){
  await control.scrollIntoViewIfNeeded();await control.click({trial:true})
  assert(await control.evaluate(el=>{
    const r=el.getBoundingClientRect(),root=el.getRootNode(),hit=root.elementFromPoint(r.left+r.width/2,r.top+r.height/2)
    return r.top>=0&&r.bottom<=innerHeight+1&&(hit===el||el.contains(hit))
  }),'실행 버튼이 하단 메뉴나 다른 고정 요소에 가려지면 안 됩니다')
}
async function screenshot(name){if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png'),fullPage:true})}}
async function chooseCourse(){await command('수업에서 국어 찾아줘','자료 찾기');await page.getByRole('button',{name:/가상 1학년 국어.*열기/}).click();await page.getByRole('heading',{name:'가상 1학년 국어',exact:true}).waitFor()}
try{
  await test('완료한 할 일 화면은 다음 일정 요청 때 자동 접고 새 일정은 확인 전 저장하지 않는다',async()=>{
    await page.evaluate(()=>window.qa.qaTasks.seed());await command('내 할 일 보여줘','바로 이동')
    const tasks=page.locator('.assistant-delivery-work .task-panel');await tasks.getByRole('button',{name:'완료',exact:true}).first().click()
    await tasks.getByRole('button',{name:'저장한 업무 보기',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.qa.qaTasks.snapshot().writes),1)
    await button('대화 보기').click();await command('내일 교과회의 일정 잡아줘','일정 초안 열기');await input().fill('오후 3시부터 4시');await button('일정 정보 이어 입력').click()
    await page.locator('.workspace-operation[data-operation-kind="calendarCreate"]').waitFor();assert.equal(await page.locator('.assistant-delivery-header').count(),0)
    assert.equal((await mutations()).length,1);assert.equal(await page.evaluate(()=>window.qa.qaTasks.snapshot().writes),1)
    assert.equal(await page.getByText('먼저 작성 중인 업무나 결과 확인을 마쳐 주세요. 입력은 유지됩니다.',{exact:true}).count(),0);await fits()
  })
  await test('미저장 할 일과 결과 미상 작업은 완료 화면처럼 자동 접지 않는다',async()=>{
    await page.evaluate(()=>window.qa.qaTasks.seed());await command('내 할 일 보여줘','바로 이동');const tasks=page.locator('.assistant-delivery-work .task-panel')
    await tasks.getByRole('button',{name:'할 일 등록',exact:true}).click();await tasks.getByLabel('해야 할 일',{exact:true}).fill('미저장 입력 보존')
    assert.equal(await button('대화 보기').isDisabled(),true);assert.equal(await button('작업 마치기').isDisabled(),true)
    await page.setViewportSize({width:320,height:420});assert.equal(await tasks.getByLabel('해야 할 일',{exact:true}).inputValue(),'미저장 입력 보존');await noWrite()
    await tasks.getByRole('button',{name:'편집 취소',exact:true}).click();await page.evaluate(()=>window.qa.qaTasks.loseNextReply());await tasks.getByRole('button',{name:'완료',exact:true}).first().click()
    await tasks.getByRole('region',{name:'저장 결과 확인 필요',exact:true}).waitFor();const first=await mutations();assert.equal(first.length,1)
    await tasks.getByRole('button',{name:'입력창 접고 목록 보기',exact:true}).click();assert.equal(await button('대화 보기').isDisabled(),true);assert.equal(await button('작업 마치기').isDisabled(),true)
    await tasks.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click();await tasks.getByRole('button',{name:'저장한 업무 보기',exact:true}).waitFor()
    assert.deepEqual(await mutations(),[first[0],first[0]]);assert.equal(await page.evaluate(()=>window.qa.qaTasks.snapshot().writes),1)
  })
  await test('390px 첫 입력과 전체 AI 화면의 실행 버튼은 하단 메뉴 위에서 누를 수 있다',async()=>{
    await input().fill('내 할 일 보여줘');await reachable(button('바로 이동'));await button('바로 이동').click();await button('대화 보기').click()
    for(const size of [{width:390,height:844},{width:390,height:360},{width:320,height:420}]){
      await page.setViewportSize(size);await input().fill('내일 교과회의 일정 잡아줘');await reachable(button('일정 초안 열기'));await fits()
    }
    await noWrite()
  })
  await test('320px 전문 업무의 진행 순서와 복귀 버튼을 잘림 없이 조작한다',async()=>{
    await page.setViewportSize({width:320,height:720});await command('교사 명부 보여줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor()
    await page.locator('.assistant-specialist-plan summary').click();await fits();await button('대화 보기').click();await input().waitFor();await button('작성하던 업무 보기').click();await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();await fits();await noWrite();await screenshot('mobile-school-work')
  })
  await test('390→320px 전환 중 선택한 수업과 미전송 질문을 같은 편집기에 보존한다',async()=>{
    await chooseCourse();const before=await page.evaluate(()=>window.qa.calls.filter(row=>row.name==='workhub_teaching_course').length)
    await button('대화 보기').click();const draft='선택한 수업의 관찰 근거를 어떻게 정리할까요?';await input().fill(draft)
    await page.setViewportSize({width:320,height:640});await button('작성하던 업무 보기').click();await page.getByRole('heading',{name:'가상 1학년 국어',exact:true}).waitFor();await fits()
    assert.equal(await page.locator('.teaching-assistant').count(),1);assert.equal(await page.evaluate(()=>window.qa.calls.filter(row=>row.name==='workhub_teaching_course').length),before)
    await button('대화 보기').click();assert.equal(await input().inputValue(),draft);await noWrite()
  })
  await test('키보드에 해당하는 높이 축소 뒤 질문·선택 영역을 유지하고 실행 버튼에 접근한다',async()=>{
    await chooseCourse();await button('대화 보기').click();const draft='수업 기록을 검토하기 전에\n학생 관찰 근거를 먼저 확인하고 싶어요.';await input().fill(draft);await input().focus();await input().evaluate(el=>el.setSelectionRange(3,9))
    await page.setViewportSize({width:390,height:360});assert.equal(await input().inputValue(),draft);assert.deepEqual(await input().evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,9])
    await button('작성하던 업무 보기').click({trial:true});await fits();await page.setViewportSize({width:390,height:844});assert.equal(await input().inputValue(),draft);await noWrite();await screenshot('mobile-keyboard-return')
  })
  await test('640px·글자 200% 조건에서도 학교 작업 선택과 취소 없는 복귀를 유지한다',async()=>{
    await page.setViewportSize({width:640,height:480});await page.evaluate(()=>{
      document.documentElement.style.fontSize='32px';const shell=document.querySelector('#root > div')?.shadowRoot?.querySelector('.ws-shell');shell?.style.setProperty('--ui-body-size','30px');shell?.style.setProperty('--ui-small-size','26px')
    })
    await command('학교 기초 자료 보여줘');await page.getByLabel('학교 관리 업무',{exact:true}).waitFor();await fits()
    assert(await page.locator('.assistant-delivery-header h2').evaluate(el=>el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight)+1),'짧은 작업 이름이 버튼 옆 좁은 칸에서 잘리지 않아야 합니다')
    await button('대화 보기').click({trial:true});await noWrite();await screenshot('text-200-school-work')
  })
  await test('320px CSV 입력은 파일·대상 확인 전 잠금을 유지하고 취소 뒤 대화로 돌아온다',async()=>{
    await page.setViewportSize({width:320,height:720});await command('활동 자료 가져오기 시작해줘');await page.getByLabel('수업 선택',{exact:true}).selectOption('course-one');await page.getByLabel('CSV 파일',{exact:true}).waitFor();await fits()
    assert.equal(await button('대화 보기').isDisabled(),true);assert.equal(await button('작업 마치기').isDisabled(),true);assert.equal(await button('확인한 자료 저장').isDisabled(),true)
    await button('가져오기 취소').click();await button('대화 보기').click();await input().waitFor();await noWrite();await screenshot('mobile-import-cancel')
  })
  await test('모바일 결과 미확정 할 일은 화면 크기를 바꿔도 같은 번호로만 복구한다',async()=>{
    await page.evaluate(()=>window.qa.qaTasks.seed());await command('제출 자료 확인을 완료해줘','내 할 일 찾기');const choices=page.getByRole('region',{name:'변경할 내 할 일',exact:true});await choices.getByRole('button').filter({hasText:'2026-10-28'}).click();const review=page.locator('.workspace-operation[data-operation-kind="taskChange"]');await review.waitFor()
    await page.evaluate(()=>window.qa.qaTasks.loseNextReply());await review.getByRole('button',{name:'확인한 할 일 완료',exact:true}).click();const retry=button('같은 요청으로 저장 결과 확인');await retry.waitFor();const original=await mutations();assert.equal(original.length,1)
    await page.setViewportSize({width:320,height:420});await fits();await retry.click();await retry.waitFor({state:'detached'});const calls=await mutations();assert.deepEqual(calls,[original[0],original[0]]);assert.equal(await page.evaluate(()=>window.qa.qaTasks.snapshot().writes),1);await screenshot('mobile-request-recovered')
  })
  await test('모바일 일정 이어 쓰기에서 포커스 재검증 후 날짜·제목·미전송 시각을 보존한다',async()=>{
    await command('내일 교과회의 일정 잡아줘','일정 초안 열기');const follow=page.getByRole('region',{name:'작성 중인 일정',exact:true});await follow.waitFor();await input().fill('오후 3시부터 4시')
    const before=await page.evaluate(()=>{const before=window.qa.calls.filter(row=>row.name==='workhub_context').length;window.dispatchEvent(new Event('focus'));return before})
    await page.waitForFunction(before=>window.qa.calls.filter(row=>row.name==='workhub_context').length>before,before)
    await page.setViewportSize({width:390,height:360});assert.match(await follow.innerText(),/교과회의/);assert.equal(await input().inputValue(),'오후 3시부터 4시');await button('일정 정보 이어 입력').click();const review=page.locator('.workspace-operation[data-operation-kind="calendarCreate"]');await review.waitFor();assert.match(await review.innerText(),/2026-10-22/);assert.match(await review.innerText(),/15:00–16:00/);await fits();await noWrite()
  })
  await test('모바일 조회 중 신원 철회 뒤 늦은 결과와 업무 버튼을 다시 노출하지 않는다',async()=>{
    await page.evaluate(()=>window.qa.defer=true);await command('문서함에서 학교 행사 찾아줘','자료 찾기');await page.waitForFunction(()=>window.qa.releases.length===1);await page.setViewportSize({width:320,height:420});await page.evaluate(()=>window.qa.deny());await page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다',exact:true}).waitFor();await page.evaluate(()=>window.qa.releases.splice(0).forEach(release=>release()));assert.equal(await page.locator('.assistant-delivery').count(),0);await noWrite()
  })
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`\n대화 통합 모바일 ${passed}건 통과 · 실제 휴대폰 IME 미검증`)
}finally{await browser.close()}
