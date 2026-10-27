import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'
import {openTeachingTools} from './teaching-tools.mjs'
const bundles=Object.fromEntries(Object.entries({school:'workhub-school-configuration-batch-fixture.tsx',teaching:'workhub-teaching-fixture.tsx',maintenance:'workhub-school-data-maintenance-fixture.tsx'}).map(([key,file])=>[key,buildSync({entryPoints:[fileURLToPath(new URL(file,import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text]))
const font=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url)).toString('base64')
const workflow=readFileSync(new URL('../../apps/workhub/src/app/school-records-ui.css',import.meta.url),'utf8'), teachingStyles=readFileSync(new URL('../../apps/workhub/src/teaching/teaching.css',import.meta.url),'utf8')
const html=`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:45 920}body{font-family:Pretendard,sans-serif;margin:0;padding:24px;background:var(--ui-surface-muted,#f6f7f9)}*{box-sizing:border-box}#root{max-width:1200px;margin:auto}${teachingStyles}${workflow}</style><div id="root"></div></html>`
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[],passed=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5189/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:html})})
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true})
const writes=()=>page.evaluate(()=>window.calls.filter(c=>c.command||/_mutate|_commit/.test(c.name)).length)
async function boot(kind){await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5189/'+kind);await page.addScriptTag({content:bundles[kind]});await page.evaluate(()=>document.fonts.ready);if(kind==='school')await button('구성 수정').waitFor();if(kind==='teaching')await field('수업 선택').waitFor();if(kind==='maintenance'){await button('수업 이름·기간 정정').waitFor();await page.locator('#root').evaluate(el=>el.classList.add('teaching-workspace','school-records-ui'))}}
async function check(name,kind,fn){await boot(kind);try{await fn()}catch(e){console.error(await page.locator('body').innerText());throw e}passed.push(name);console.log('  ✓ '+name)}
async function capture(name,locator){if(!process.env.WORKHUB_QA_OUTPUT)return;mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await (locator??page.locator('#root')).screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png')})}
async function student(){await field('수업 선택').selectOption('course-a');await button('합성 학생 가 1학년 1반 1번').click();await button('관찰 기록 작성').waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='관찰 기록 작성').disabled)}
try{
 await check('학교 구성 45개를 검색·페이지로 끝까지 조회해도 서버에 쓰지 않는다','school',async()=>{
  await page.evaluate(()=>{window.data.configuration.classes=Array.from({length:45},(_,i)=>({id:'class-'+i,grade:String(Math.floor(i/15)+1),classNo:String(i%15+1),name:'합성 학급 '+String(i+1).padStart(2,'0'),kind:'regular'}));window.refresh()})
  await button('학급 45개 보기').click();assert.equal(await page.locator('.school-configuration-items li').count(),20)
  const pages=page.getByRole('navigation',{name:'학급 조회 목록 페이지',exact:true});await pages.getByRole('button',{name:'마지막',exact:true}).click();assert.equal(await page.locator('.school-configuration-items li').count(),5);await page.getByText('합성 학급 45',{exact:true}).waitFor()
  await field('학급 찾기').fill('class-23');assert.equal(await page.locator('.school-configuration-items li').count(),1);await page.getByText('합성 학급 24',{exact:true}).waitFor();assert.equal(await writes(),0)
  await field('학급 찾기').fill('');await capture('school-configuration')
 })
 await check('학교 구성 바로가기는 키보드 초점만 옮기고 다른 칸의 미저장 값을 유지한다','school',async()=>{
  await button('구성 수정').click();await field('학교명').fill('입력 보존 중학교');await button('교과 1 입력으로 이동').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.dataset.configurationSection),'subjects')
  await field('교과 이름').fill('토론과 도덕');await button('학교·학년도 입력으로 이동').click();assert.equal(await field('학교명').inputValue(),'입력 보존 중학교');assert.equal(await field('교과 이름').inputValue(),'토론과 도덕');assert.equal(await writes(),0)
  await field('변경 사유').fill('학교 편성 자료 확인');await button('변경 내용 검토').click();assert.match(await page.locator('.school-admin-changes').innerText(),/토론과 도덕/);assert.equal(await writes(),0);await capture('school-configuration-review',page.locator('.setup-review'))
 })
 await check('수업 검색에서 선택이 검색 밖으로 나가도 수업과 학생을 바꾸지 않는다','teaching',async()=>{
  await student();await field('수업 찾기').fill('검색 결과 없는 수업');assert.equal(await field('수업 선택').inputValue(),'course-a');await page.getByText('검색 결과 0개 · 전체 1개 · 검색 밖의 선택한 수업은 유지합니다.',{exact:true}).waitFor();assert.match(await page.locator('.teaching-student-context').innerText(),/합성 학생 가/);assert.equal(await writes(),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_teaching_counseling').length),0)
  await field('수업 찾기').fill('');await capture('course-and-student-records',page.locator('.teaching-workspace'))
 })
 await check('담당 교사 검색은 선택한 교사와 수업 입력을 유지하고 명시 저장 전에는 쓰지 않는다','teaching',async()=>{
  await openTeachingTools(page,'course');await button('수업·담당 등록').click();await field('수업 이름').fill('1반 토론 수업');await field('학기').selectOption('term-a');await field('교과').selectOption('subject-a');await field('합성 교사').check();await field('담당 교사 찾기').fill('다른 교사');assert.equal(await field('합성 교사').isChecked(),true);assert.equal(await field('수업 이름').inputValue(),'1반 토론 수업');assert.equal(await field('수업 시작일').inputValue(),'2026-08-13');assert.equal(await field('수업 선택').isDisabled(),true);assert.equal(await writes(),0);await capture('course-registration',page.locator('.teaching-editor'))
 })
 await check('도구 접기와 새 기록 입력 후 응답이 유실돼도 기존 번호로 한 번만 저장한다','teaching',async()=>{
  await student();await button('관찰 기록 작성').click();await field('관찰한 사실').fill('모둠 토의에서 근거를 비교하고 의견을 정리함.\n친구의 설명을 듣고 판단을 보완함.')
  await openTeachingTools(page,'roster');await page.getByText('명부·활동 가져오기·관계 관리',{exact:true}).click();assert.match(await field('관찰한 사실').inputValue(),/근거를 비교/);assert.equal(await field('수업 선택').isDisabled(),true);assert.equal(await writes(),0);await capture('observation-editor',page.locator('.teaching-content'))
  await page.evaluate(()=>window.failOnce=true);await button('기록 저장').click();await button('같은 요청으로 결과 다시 확인').waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);const first=await page.evaluate(()=>window.calls.find(c=>c.name==='workhub_teaching_mutate'))
  await button('같은 요청으로 결과 다시 확인').click();await page.waitForFunction(()=>window.pending.count()===0);const requests=await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_teaching_mutate'));assert.equal(requests.length,2);assert.deepEqual(requests[1],first);assert.equal(await page.evaluate(()=>window.state.observations.length),1)
 })
 await check('평가 화면은 교사 확인과 당시 기준판을 유지하며 상담을 미리 조회하지 않는다','teaching',async()=>{
  await student();await button('평가').click();await button('평가 입력').click();await field('평가 기준').selectOption('rubric-a');await field('판단 근거 상태').selectOption('scored');await field('판단 근거 점수 · 10점 만점').fill('8');await field('교사 평가 의견').fill('근거를 비교하여 자신의 판단을 설명함.');assert.equal(await field('학생·기준·항목별 상태와 점수를 교사가 확인했습니다.').isChecked(),false);assert.equal(await writes(),0);await capture('assessment-editor',page.locator('.teaching-content'))
  await field('학생·기준·항목별 상태와 점수를 교사가 확인했습니다.').check();await button('교사 확인 평가 저장').click();await page.waitForFunction(()=>window.state.assessments.length===1&&window.pending.count()===0);const command=await page.evaluate(()=>window.calls.find(c=>c.name==='workhub_teaching_mutate').args.p_command);assert.equal(command.rubricRevisionId,'rubric-rev-a');assert.equal(command.confirmed,true);assert.equal(command.scores[0].points,8);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_teaching_counseling').length),0)
 })
 await check('자료 정정 학생 목록의 검색·페이지 이동은 대상을 임의로 바꾸거나 저장하지 않는다','maintenance',async()=>{
  await page.evaluate(()=>{window.extraStudents=Array.from({length:44},(_,i)=>({...structuredClone(window.student),id:'extra-'+i,fields:{name:'추가 학생 '+String(i).padStart(2,'0'),schoolStudentKey:'extra-key-'+i},enrollment:{...structuredClone(window.student.enrollment),id:'extra-enrollment-'+i,fields:{grade:2,classLabel:'1',seatNumber:i+1}}}))})
  await button('현재 자료 다시 확인').click();await page.getByText('학생 자료 정정 (45명)',{exact:true}).click();await field('정정할 학생 찾기').fill('extra-key-33');assert.equal(await page.locator('.teaching-maintenance-students>li').count(),1);assert.match(await page.locator('.teaching-maintenance-students').innerText(),/추가 학생 33/)
  await field('정정할 학생 찾기').fill('');await page.getByRole('navigation',{name:'정정할 학생 목록 페이지'}).getByRole('button',{name:'마지막',exact:true}).click();assert.equal(await page.locator('.teaching-maintenance-students>li').count(),5);assert.equal(await writes(),0)
  await button('수업 이름·기간 정정').click();await field('수업 이름').fill('1반 국어 확인');await field('변경 근거').fill('편성 원장과 대조');await button('영향 확인').click();await page.getByRole('region',{name:'정정 영향 미리보기'}).waitFor();assert.equal(await button('확인한 변경 반영').isDisabled(),true);assert.equal(await writes(),0);await capture('school-data-correction')
 })
 await check('관리 권한이 없는 응답에서는 접힌 도구 안에도 수업 등록을 제공하지 않는다','teaching',async()=>{
  await page.evaluate(()=>{window.canManageCourses=false;window.refresh()});await page.waitForFunction(()=>!document.body.textContent.includes('수업 등록·자료 관리'));assert.equal(await page.getByRole('button',{name:'수업·담당 등록',exact:true,includeHidden:true}).count(),0);assert.equal(await writes(),0)
 })
 await check('320px·큰 글씨·어두운 화면에서도 선택 학생과 기록 입력이 가로로 넘치지 않는다','teaching',async()=>{
  await student();await button('관찰 기록 작성').click();await field('관찰한 사실').fill('작은 화면에서도 보관할 기록');await page.setViewportSize({width:320,height:760});await page.addStyleTag({content:'html{font-size:32px;--ui-surface:#171c28;--ui-surface-muted:#101521;--ui-text:#e9edf5;--ui-muted:#b7c3d6;--ui-line:#45506a;--ui-accent:#a4baff;--ui-accent-soft:#253658;--ui-on-accent:#102145}body{padding:8px}'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await button('기록 저장').focus();assert.equal(await button('기록 저장').evaluate(el=>document.activeElement===el),true);assert.equal(await writes(),0);await capture('student-record-mobile-dark')
 })
 await check('학교 구성도 작은 화면·큰 글씨·어두운 스킨에서 입력과 키보드 바로가기를 유지한다','school',async()=>{
  await button('구성 수정').click();await field('학교명').fill('작은 화면 중학교');await page.setViewportSize({width:320,height:760});await page.addStyleTag({content:'html{font-size:32px;--ui-surface:#171c28;--ui-surface-muted:#101521;--ui-text:#e9edf5;--ui-muted:#b7c3d6;--ui-line:#45506a;--ui-accent:#a4baff;--ui-accent-soft:#253658;--ui-on-accent:#102145}body{padding:8px}'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await field('학교명').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 28, 40)');assert.equal(await field('학교명').evaluate(el=>getComputedStyle(el).color),'rgb(233, 237, 245)');await button('교과 1 입력으로 이동').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.dataset.configurationSection),'subjects');assert.equal(await field('학교명').inputValue(),'작은 화면 중학교');assert.equal(await writes(),0);await capture('school-editor-mobile-dark',page.locator('.school-configuration-editor'))
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'school-records-ui-results.json'),JSON.stringify({passed,errors,external},null,2));console.log(`학교·수업·학생 기록 화면 ${passed.length}개 통과`)
}finally{await browser.close()}
