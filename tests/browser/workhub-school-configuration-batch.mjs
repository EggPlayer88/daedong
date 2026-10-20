import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-school-configuration-batch-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'}))
const button=name=>page.getByRole('button',{name,exact:true}),text=()=>page.getByLabel('학교 구성 일괄 입력',{exact:true}),group=()=>page.getByLabel('일괄 입력 종류',{exact:true}),file=()=>page.getByLabel('학교 구성 일괄 파일',{exact:true}),confirm=()=>page.getByLabel('기존 항목을 유지하고 추가·수정할 내용을 확인했습니다.',{exact:true})
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
let passed=0
async function boot(){await page.goto('http://127.0.0.1:5191/school-batch');await page.addScriptTag({content:bundle});await button('구성 수정').click();await page.locator('.school-batch summary').click();await text().waitFor()}
async function paste(value,g='subjects'){await group().selectOption(g);await text().fill(value);await button('현재 구성과 비교').click()}
async function adopt(){await confirm().check();await button('구성 초안에 반영').click();await page.getByText(/구성 초안에 합쳤습니다/).waitFor()}
async function finalReview(){await page.getByLabel('변경 사유',{exact:true}).fill('학교 초기 자료 확인');await button('변경 내용 검토').click()}
async function upload(rows,g='subjects',foreign=false){const bytes=await page.evaluate(({rows,g,foreign})=>window.xlsx(g,rows,foreign),{rows,g,foreign});await file().setInputFiles({name:'학교자료.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)})}
async function test(name,run){try{await boot();await run();passed++;console.log('  ✓',name)}catch(e){console.error(await page.locator('body').innerText(),errors);throw e}}
try{
 await test('교과 붙여넣기 비교·명시 확인·기존 원자 저장까지 이어지고 기존 항목을 보존한다',async()=>{
  await paste('식별자\t이름\n\t기술,가정\n\t국어');await page.getByRole('heading',{name:'추가 2개 · 수정 0개 · 일치 0개'}).waitFor();assert.equal(await button('구성 초안에 반영').isDisabled(),true);assert.equal(await page.evaluate(()=>window.calls.length),0)
  await adopt();assert.equal(await page.getByLabel('교과 이름',{exact:true}).count(),3);await finalReview();await button('확인한 내용 반영').click();await page.getByText(/변경 반영을 확인했습니다/).waitFor()
  const call=await page.evaluate(()=>window.calls[0]);assert.equal(call.command.kind,'save_configuration');assert.equal(call.command.subjects.length,3);assert.equal(call.command.subjects[0].id,'subject-one');assert.equal(call.command.subjects[1].name,'기술,가정');assert.equal(call.command.configuration.classes[0].id,'class-one')
 })
 await test('기존 교과 ID를 유지한 이름 정정은 전후 차이를 보여 준다',async()=>{
  await paste('식별자,이름\nsubject-one,윤리');await page.getByRole('heading',{name:'추가 0개 · 수정 1개 · 일치 0개'}).waitFor();assert.match(await page.getByRole('region',{name:'일괄 입력 비교'}).innerText(),/도덕[\s\S]*윤리/)
  await adopt();await finalReview();await button('확인한 내용 반영').click();await page.getByText(/변경 반영을 확인했습니다/).waitFor();assert.deepEqual(await page.evaluate(()=>window.data.subjects),[{id:'subject-one',name:'윤리'}])
 })
 await test('이름만 같은 신규 행은 추정 연결하지 않으며 반영 전 원문이 있으면 최종 저장을 막는다',async()=>{
  await paste('식별자,이름\n,도덕');await page.getByText(/이름으로 연결하지 않으므로/).waitFor();await finalReview();await page.getByText(/일괄 입력이 아직 구성 초안에/).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0);assert.equal(await text().inputValue(),'식별자,이름\n,도덕')
 })
 await test('실제 XLSX로 학급을 추가하고 다른 학교 양식은 이전 입력을 유지한다',async()=>{
  await upload([['','2','1','2학년 1반','regular']],'classes');await page.getByText(/파일을 읽었습니다/).waitFor();await button('현재 구성과 비교').click();await page.getByRole('heading',{name:'추가 1개 · 수정 0개 · 일치 0개'}).waitFor()
  const original=await text().inputValue();await upload([['','3','1','3학년 1반','regular']],'classes',true);await page.getByText(/다른 학교·학년도·입력 종류/).waitFor();assert.equal(await text().inputValue(),original);assert.equal(await button('구성 초안에 반영').count(),0)
  await button('현재 구성과 비교').click();await adopt();assert.equal(await page.getByLabel('학급 이름',{exact:true}).count(),2)
 })
 await test('서버 판 변경 시 원문과 기존 변경을 함께 보존하고 충돌 해결 후 다시 비교한다',async()=>{
  await paste('식별자,이름\n,수학');await page.evaluate(()=>{window.data.configuration.departments[0].name='변경된 부서';window.data.version++;window.refresh()});await page.getByText(/서버의 학교 자료가 바뀌었습니다/).waitFor()
  assert.equal(await button('구성 초안에 반영').isDisabled(),true);await finalReview();await button('선택한 내용으로 다시 편집').click();assert.equal(await text().inputValue(),'식별자,이름\n,수학')
  await button('현재 구성과 비교').click();await adopt();assert.equal(await page.getByLabel('부서 이름',{exact:true}).inputValue(),'변경된 부서');await finalReview();await button('확인한 내용 반영').click();await page.getByText(/변경 반영을 확인했습니다/).waitFor();assert.equal(await page.evaluate(()=>window.calls[0].command.expectedVersion),4)
 })
 await test('편집 내용 변경은 이전 비교 확인을 무효화하고 재비교를 요구한다',async()=>{
  await paste('식별자,이름\n,수학');await confirm().check();await page.getByLabel('학교명',{exact:true}).fill('수정된 학교명');await page.getByText(/비교한 뒤 구성 초안이 바뀌었습니다/).waitFor();assert.equal(await button('구성 초안에 반영').isDisabled(),true)
  await button('현재 구성과 비교').click();assert.equal(await confirm().isChecked(),false);await adopt();assert.equal(await page.getByLabel('학교명',{exact:true}).inputValue(),'수정된 학교명')
 })
 await test('조회 실패·화면 재마운트에도 일괄 원문을 유지하며 다른 계정에는 보이지 않는다',async()=>{
  await paste('식별자,이름\n,수학');await page.evaluate(()=>{window.failRead=true;window.refresh()});await button('연결 다시 확인').waitFor();assert.equal(await text().inputValue(),'식별자,이름\n,수학')
  await page.evaluate(()=>{window.failRead=false;window.setShow(false)});await settle();await page.evaluate(()=>window.setShow(true));await text().waitFor();assert.equal(await text().inputValue(),'식별자,이름\n,수학')
  await page.evaluate(()=>window.changeMember());await button('구성 수정').waitFor();await button('구성 수정').click();await page.locator('.school-batch summary').click();assert.equal(await text().inputValue(),'')
 })
 await test('저장 응답 단절 후 추가 행과 같은 요청 번호를 유지해 재확인하고 중복을 만들지 않는다',async()=>{
  await paste('식별자,이름\n,수학');await adopt();await finalReview();await page.evaluate(()=>{window.unknownOnce=true});await button('확인한 내용 반영').click();await button('같은 요청으로 결과 확인').waitFor();const first=await page.evaluate(()=>window.calls[0])
  await page.evaluate(()=>window.setShow(false));await settle();await page.evaluate(()=>window.setShow(true));await button('같은 요청으로 결과 확인').click();await page.getByText(/변경 반영을 확인했습니다/).waitFor();assert.deepEqual(await page.evaluate(()=>window.calls[1]),first);assert.equal(await page.evaluate(()=>window.data.subjects.length),2)
 })
 await test('파일을 읽는 동안 원본 판이 바뀌면 늦은 파일을 채택하지 않고 원문을 보존한다',async()=>{
  await paste('식별자,이름\n,수학');await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){const self=this;return new Promise(resolve=>{window.finishFile=()=>original.call(self).then(resolve)})}})
  await upload([['','국어']]);await page.getByText('파일을 읽는 중입니다.',{exact:false}).waitFor();await page.evaluate(()=>{window.data.version++;window.refresh()});await page.getByText(/서버의 학교 자료가 바뀌었습니다/).waitFor();await page.evaluate(()=>window.finishFile());await page.getByText(/파일을 읽는 동안 학교 자료나 입력이 바뀌었습니다/).waitFor();assert.equal(await text().inputValue(),'식별자,이름\n,수학')
 })
 await test('320px에서 일괄 입력과 비교표가 전체 화면을 가로로 밀지 않는다',async()=>{
  await page.setViewportSize({width:320,height:800});await paste('식별자,이름\n,수학');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
 })
 assert.deepEqual(errors,[]);console.log(`학교 구성 일괄 입력 브라우저 ${passed}개 통과 · 페이지 오류 0`)
}finally{await browser.close()}
