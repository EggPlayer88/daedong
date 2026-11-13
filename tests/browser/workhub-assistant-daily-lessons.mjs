// 실제 시간표·명부 어댑터와 React에 합성 응답을 넣는다. 운영 쓰기·AI 호출은 없다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./fixtures/assistant-daily-lessons.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],external=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5284/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>'})})
const lessons=()=>page.getByRole('region',{name:'대화에서 오늘 수업',exact:true}), actual=()=>lessons().getByRole('region',{name:'오늘 수업',exact:true})
async function start(flags={}){await page.setViewportSize({width:1280,height:1000});await page.goto('http://127.0.0.1:5284/lessons');await page.evaluate(flags=>window.dailyInitial=flags,flags);await page.addScriptTag({content:bundle.outputFiles[0].text})}
async function update(values){await page.evaluate(values=>window.qa.update(values),values)}
async function ready(){await actual().getByRole('button',{name:'시간표 전체 보기',exact:true}).waitFor()}
let passed=0
async function test(name,fn){await fn();assert.deepEqual(errors,[]);passed++;console.log('  ✓ '+name)}
try{
 await test('교환 후 현재 시각·휴업 취소·실시 완료를 보존하고 다른 교사 수업은 요약하지 않는다',async()=>{
  await start();await ready();assert.equal(await actual().locator('li').count(),3)
  assert.match(await actual().getByRole('button',{name:/원본 국어 교환 반영/}).innerText(),/09:40–10:25/)
  assert.match(await actual().getByRole('button',{name:/원본 휴업 수업/}).innerText(),/취소/)
  assert.match(await actual().getByRole('button',{name:/원본 실시 완료 수업/}).innerText(),/진행 완료/)
  assert.equal(await page.getByText('다른 교사의 수업 원문',{exact:true}).count(),0)
  const calls=await page.evaluate(()=>window.qa.calls.filter(x=>x.name==='workhub_timetable_operations_get'))
  assert.equal(calls[0].args.p_from,'2026-11-16');assert.equal(calls[0].args.p_until,'2026-11-17')
 })
 await test('수업 열기는 정확한 날짜·수업 ID, 전체 보기는 선택 날짜를 유지한다',async()=>{
  await actual().getByRole('button',{name:/원본 국어 교환 반영/}).click();await actual().getByRole('button',{name:'시간표 전체 보기',exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>window.qa.opened),[{source:'lesson',lessonId:'lesson-exchanged',date:'2026-11-16'},{source:'lesson',lessonId:'',date:'2026-11-16'}])
 })
 await test('기본표는 접힌 참고이며 열어도 현재 교환 시각·취소 상태를 덮어쓰지 않는다',async()=>{
  const reference=lessons().locator('details.personal-roster');await reference.getByText('내 기본 시간표 참고',{exact:true}).waitFor()
  assert.equal(await reference.getAttribute('open'),null);await reference.getByText('내 기본 시간표 참고',{exact:true}).click()
  await reference.locator('li').first().waitFor();assert.match(await reference.innerText(),/휴업·교환은 반영하지 않으므로/)
  assert.match(await actual().getByRole('button',{name:/원본 국어 교환 반영/}).innerText(),/09:40–10:25/)
 })
 await test('미준비·조회 실패는 수업 없음으로 숨기지 않으며 기본표가 실제 수업을 대신하지 않는다',async()=>{
  await start({lessonNotReady:true});await actual().getByText('확정 시간표 연결을 준비 중입니다.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.qa.calls.some(c=>c.name==='workhub_timetable_operations_get')),false)
  assert.equal(await actual().getByText('이 날짜에 확인된 내 수업이 없습니다.',{exact:true}).count(),0)
  await update({lessonNotReady:false,failed:['lessons']});await actual().getByRole('alert').waitFor()
  assert.equal(await actual().locator('li').count(),0);assert.equal(await actual().getByText('이 날짜에 확인된 내 수업이 없습니다.',{exact:true}).count(),0)
  await page.evaluate(()=>window.qa.failed=[]);await actual().getByRole('button',{name:'내 수업 다시 확인',exact:true}).click();await ready()
 })
 await test('서버가 확인한 빈 수업만 없음으로 표시하고 기본표 미연결이면 다른 교사 기본표를 노출하지 않는다',async()=>{
  await start({lessonEmpty:true,rosterUnlinked:true});await actual().getByText('이 날짜에 확인된 내 수업이 없습니다.',{exact:true}).waitFor()
  await lessons().getByText('내 기본 시간표 참고',{exact:true}).waitFor({state:'detached'});assert.equal(await actual().locator('li').count(),0)
 })
 await test('다른 학교의 실제 수업 응답을 원문 노출 없이 거부한다',async()=>{
  await start({lessonBadScope:true});await actual().getByRole('alert').waitFor();assert.equal(await actual().getByText('원본 국어 교환 반영',{exact:true}).count(),0)
 })
 await test('날짜 변경 뒤 늦게 도착한 실제 수업·기본표를 새 날짜에 표시하지 않는다',async()=>{
  await start({defer:['lessons','roster'],label:'이전날'});await page.waitForFunction(()=>window.qa.waits.some(x=>x.source==='lessons')&&window.qa.waits.some(x=>x.source==='roster'))
  await update({date:'2026-11-17',defer:[],label:'새날'});await ready();await page.evaluate(()=>window.qa.resolve())
  assert.doesNotMatch(await lessons().innerText(),/이전날/);assert.match(await actual().innerText(),/새날/)
  await actual().getByRole('button',{name:/새날 국어 교환 반영/}).click();assert.equal(await page.evaluate(()=>window.qa.opened.at(-1).date),'2026-11-17')
 })
 await test('소속 변경 중 이전 수업 응답을 버리고 새 소속의 원본만 연다',async()=>{
  await start({defer:['lessons','roster'],label:'이전소속'});await page.waitForFunction(()=>window.qa.waits.some(x=>x.source==='lessons'))
  await page.evaluate(()=>{window.qa.defer=[];window.qa.label='새소속';window.qa.switchMember()});await ready();await page.evaluate(()=>window.qa.resolve())
  assert.doesNotMatch(await lessons().innerText(),/이전소속/);assert.match(await actual().innerText(),/새소속/)
  assert.equal(await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_timetable_operations_get').at(-1).args.p_member_id),'second')
 })
 await test('미확정 작업 잠금 중 수업·전체 보기 이동을 막고 급식 단독 화면은 시간표를 조회하지 않는다',async()=>{
  await start({locked:true});await ready();for(const button of await actual().getByRole('button').all())assert.equal(await button.isDisabled(),true)
  assert.deepEqual(await page.evaluate(()=>window.qa.opened),[])
  await start({view:'meals'});await page.getByRole('region',{name:'학교 급식',exact:true}).getByText('중식',{exact:true}).waitFor()
  assert.equal(await lessons().count(),0);assert.equal(await page.evaluate(()=>window.qa.calls.some(c=>/timetable|roster/.test(c.name??''))),false)
 })
 await test('320px·200% 글자·어두운 화면에서 현재 수업과 원본 이동이 넘치지 않으며 쓰기 요청은 없다',async()=>{
  await start({lessonLong:true});await ready();await page.setViewportSize({width:320,height:760})
  await page.addStyleTag({content:'.ws-shell{--ui-text:#eee;--ui-surface:#161b25;--ui-surface-muted:#242a35;--ui-muted:#b8c0ce;--ui-line:#526070;background:#10151e}'} )
  await page.evaluate(()=>{const sizes=[...document.querySelectorAll('.assistant-daily *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]);for(const [el,size] of sizes)el.style.fontSize=(size*2)+'px'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await actual().getByRole('button',{name:'시간표 전체 보기',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.qa.opened.at(-1).date),'2026-11-16')
  assert.equal(await page.evaluate(()=>window.qa.calls.some(c=>/mutate|execute|ask|confirm|publish/.test(c.name??'')&&c.name!=='workhub_teacher_roster_published')),false)
 })
 await test('내 시간표 질문의 날짜를 조회하고 날짜별 공개가 없을 때 내 기본 수업을 자동 안내한다',async()=>{
  await start({view:'lessons',lessonDate:'2026-11-17',lessonEmpty:true})
  const basic=page.getByRole('region',{name:'내 기본 시간표 참고',exact:true})
  await basic.locator('li').first().waitFor()
  assert.match(await basic.innerText(),/2026-11-17/)
  assert.match(await basic.innerText(),/휴업·교환 등 날짜별 변경이 반영되지 않습니다/)
  assert.equal(await basic.getByRole('button').count(),0)
  const calls=await page.evaluate(()=>window.qa.calls)
  assert.equal(calls.find(c=>c.name==='workhub_timetable_operations_get').args.p_from,'2026-11-17')
  assert.equal(calls.find(c=>c.name==='workhub_teacher_roster_published').args.p_date,'2026-11-17')
  assert.equal(calls.some(c=>c.source==='tasks'||c.source==='calendar'||/home_overview|neis_status|mutate|execute|ask|confirm/.test(c.name??'')),false)
 })
 await test('정상 확정본의 빈 날과 조회 오류에는 기본표를 실제 수업처럼 대신 보여주지 않는다',async()=>{
  await start({view:'lessons',lessonEmpty:true,publication:true})
  await page.getByText('이 날짜에 확인된 내 수업이 없습니다.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('region',{name:'내 기본 시간표 참고',exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>window.qa.calls.some(c=>c.name==='workhub_teacher_roster_published')),false)
  await start({view:'lessons',failed:['lessons']})
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('region',{name:'내 기본 시간표 참고',exact:true}).count(),0)
 })
 await test('미연결 기본표·오류·늦은 이전 날짜 응답은 내 실제 수업으로 표시하지 않는다',async()=>{
  await start({view:'lessons',lessonEmpty:true,rosterUnlinked:true})
  await page.getByText('이 날짜의 기본 시간표에 내 교사 배정이 연결되어 있지 않습니다.',{exact:true}).waitFor()
  await start({view:'lessons',lessonEmpty:true,failed:['roster']})
  await page.getByText('기본 시간표를 확인하지 못했습니다. 수업이 없는 것으로 처리하지 않습니다.',{exact:true}).waitFor()
  await start({view:'lessons',lessonEmpty:true,lessonDate:'2026-11-16',defer:['roster']})
  await page.waitForFunction(()=>window.qa.waits.some(x=>x.source==='roster'))
  await update({lessonDate:'2026-11-17',defer:[]})
  const basic=page.getByRole('region',{name:'내 기본 시간표 참고',exact:true});await basic.locator('li').first().waitFor()
  await page.evaluate(()=>window.qa.resolve())
  assert.match(await basic.innerText(),/2026-11-17/);assert.doesNotMatch(await basic.innerText(),/2026-11-16/)
 })
 assert.deepEqual(external,[]);console.log(`AI 오늘 수업 실제 어댑터 브라우저 ${passed}건 통과 · 쓰기·유료 호출 0`)
}finally{await browser.close()}
