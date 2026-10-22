import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-school-preparation-fixture.tsx',import.meta.url))],bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'}))
const button=name=>page.getByRole('button',{name,exact:true})
let passed=0
async function ready(){await page.locator('.school-preparation-overview').waitFor();await page.waitForFunction(()=>document.querySelector('.school-preparation')?.getAttribute('aria-busy')==='false')}
async function boot(){await page.goto('http://127.0.0.1:5187/school-preparation');await page.addScriptTag({content:bundle});await ready()}
async function test(name,fn){try{await boot();await fn();passed++;console.log('  ✓',name)}catch(e){console.error(await page.locator('body').innerText(),errors);throw e}}
try{
await test('기존 RPC로 7단계 현황을 보이고 각 입력 화면 목적지를 전달',async()=>{
  assert.equal(await page.locator('.school-preparation-steps>li').count(),7)
  for(const [name,destination]of [['가입 교사 연결하기','roster'],['대상 학기 선택하기','target'],['학교 구성 입력하기','school'],['수업·학생 입력하기','teaching'],['공간·학급 연결하기','setup'],['시수·일과 입력하기','preparation'],['시간표 파일 확인하기','import']]){
    await button(name).click();assert.equal(await page.evaluate(()=>window.destinations.at(-1)),destination)
  }
  assert.equal(await page.evaluate(()=>window.calls.length),8)
  assert.equal(await page.getByText('기존 교사 비공개 이름',{exact:true}).count(),0)
})
await test('개별 조회 실패는 해당 단계만 확인 필요이며 이전 성공 현황을 남기지 않음',async()=>{
  await page.evaluate(()=>window.fail='workhub_timetable_setup_get');await button('현황 다시 확인').click();await ready()
  const rows=page.locator('.school-preparation-steps>li')
  assert.equal(await rows.nth(4).getAttribute('data-state'),'unknown');assert.equal(await rows.nth(5).getAttribute('data-state'),'unknown');assert.equal(await rows.nth(2).getAttribute('data-state'),'present')
  assert.equal(await page.getByText('등록 공간 0개 · 시간표 연결 수업 1개',{exact:true}).count(),0)
})
await test('새 원본 조회에서 시수 초안이 오래되면 정리 필요 표시',async()=>{
  await page.evaluate(()=>window.state.preparation.savedDraft.sourceFingerprint='b'.repeat(64));await button('현황 다시 확인').click();await ready()
  await page.getByText('학교 자료가 바뀌어 저장한 준비 초안을 다시 확인해야 합니다.',{exact:true}).waitFor()
  assert.equal(await page.locator('.school-preparation-steps>li').nth(5).getAttribute('data-state'),'blocked')
})
await test('작성 중에는 이동만 막고 현황 재조회는 가능',async()=>{
  await page.evaluate(()=>window.setDisabled(true));await page.getByText('작성 중인 입력이나 확인 중인 요청을 먼저 마무리하면 다음 화면으로 이동할 수 있습니다.',{exact:true}).waitFor()
  assert.equal(await button('가입 교사 연결하기').isDisabled(),true);assert.equal(await button('시간표 파일 확인하기').isDisabled(),true)
  assert.equal(await button('현황 다시 확인').isDisabled(),false);await button('현황 다시 확인').click();await ready()
  assert.equal(await button('시간표 파일 확인하기').isDisabled(),true)
})
await test('계정 변경 전 늦은 조회 결과가 새 계정 현황을 덮어쓰지 않음',async()=>{
  await page.evaluate(()=>window.delayImport=true);await button('현황 다시 확인').click();await page.waitForFunction(()=>!!window.release)
  await page.evaluate(()=>{window.state.roster.teachers.push({id:'teacher-two',label:'둘째 교사'});window.switchMember()});await ready()
  await page.getByText('수업 담당 후보 2명 · 연결된 가입 교사 1명',{exact:true}).waitFor()
  await page.evaluate(()=>window.release());await page.waitForTimeout(60)
  assert.equal(await page.getByText('수업 담당 후보 1명 · 연결된 가입 교사 1명',{exact:true}).count(),0)
})
await test('휴대전화에서도 단계 버튼이 가로 넘침 없이 접근 가능',async()=>{
  await page.setViewportSize({width:390,height:844})
  await page.getByText('수업·학생 확인 범위와 다음 작업',{exact:true}).click()
  await page.getByText(/수강 등록 합계 27건/).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
  await button('시간표 파일 확인하기').click();assert.equal(await page.evaluate(()=>window.destinations.at(-1)),'import')
})
assert.deepEqual(errors,[]);console.log(`학교 준비 브라우저 ${passed} 통과 · 페이지 오류 0`)
}finally{await browser.close()}
