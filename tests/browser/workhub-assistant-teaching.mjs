// 실제 수업 화면·RPC 어댑터·근거 파서와 대화 프레임을 합성 학교에 연결한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'

const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-assistant-teaching-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1100,height:950}}),page=await context.newPage()
const passed=[],errors=[],external=[],output=process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{
 if(!route.request().url().startsWith('http://127.0.0.1:5179/')){external.push(route.request().url());return route.abort()}
 return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:12px"><div id="root"></div></body></html>'})
})
async function start(query=''){
 await page.setViewportSize({width:1100,height:950})
 await page.goto('http://127.0.0.1:5179/teaching'+query);await page.addScriptTag({content:bundle.outputFiles[0].text})
 await page.getByRole('heading',{name:'수업·기록 이어서',exact:true}).waitFor()
 await page.getByLabel('수업 선택',{exact:true}).waitFor({state:'attached'}).catch(async error=>{console.error('초기 화면',await page.locator('body').innerText(),errors,await page.evaluate(()=>window.calls));throw error})
}
async function openStudent(){await page.getByRole('button',{name:'합성 학생 가 1학년 1반 1번',exact:true}).click();await page.getByRole('heading',{name:/합성 학생 가 · 1학년 1반 1번/}).waitFor();await page.waitForFunction(()=>window.calls.some(c=>c.name==='workhub_teaching_student'))}
async function check(name,fn,query=''){await start(query);try{await fn()}catch(e){console.error(await page.locator('body').innerText());throw e}passed.push(name);console.log('  ✓ '+name)}
const writes=()=>page.evaluate(()=>window.calls.filter(c=>c.name==='workhub_teaching_mutate'))
try{
 await check('대화에서 선택한 수업만 열고 학생 선택 전 조회·저장·상담을 실행하지 않는다',async()=>{
  await page.getByRole('button',{name:'합성 학생 가 1학년 1반 1번',exact:true}).waitFor()
  assert.equal(await page.getByLabel('수업 선택',{exact:true}).inputValue(),'course-a')
  assert.equal(await page.getByLabel('수업 선택',{exact:true}).isVisible(),false)
  assert.equal(await page.locator('.teaching-workspace').count(),1)
  assert.deepEqual(await writes(),[])
  assert.equal(await page.evaluate(()=>window.calls.some(c=>/student|counseling/.test(c.name))),false)
 })
 await check('누락된 수업을 다른 수업으로 대신 선택하지 않는다',async()=>{
  await page.getByRole('alert').filter({hasText:'대화에서 선택한 수업을 현재 권한으로 찾을 수 없습니다.'}).waitFor()
  assert.equal(await page.getByLabel('수업 선택',{exact:true}).inputValue(),'')
  assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name==='workhub_teaching_course')),false)
  assert.deepEqual(await writes(),[])
 },'?course=missing')
 await check('평가 의도는 수업과 학생을 직접 고른 뒤에도 유지하며 자동 평가를 저장하지 않는다',async()=>{
  await page.getByLabel('수업 선택',{exact:true}).selectOption('course-a');await openStudent()
  assert.equal(await page.getByRole('button',{name:'평가',exact:true}).getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'평가 입력',exact:true}).waitFor()
  assert.deepEqual(await writes(),[])
 },'?empty=1&tab=assessment')
 await check('활동 CSV 요청은 수업 선택 후 기존 파일 입력기를 한 번 열고 업로드·저장하지 않는다',async()=>{
  assert.equal(await page.getByLabel('CSV 파일',{exact:true}).count(),0)
  await page.getByLabel('수업 선택',{exact:true}).selectOption('course-a')
  await page.getByLabel('CSV 파일',{exact:true}).waitFor()
  assert.deepEqual(await page.getByRole('list',{name:'활동 가져오기 순서',exact:true}).locator('li').allTextContents(),['파일 선택','학생 연결','내용 검토'])
  assert.equal(await page.getByRole('complementary',{name:'수강 학생 목록',exact:true}).count(),0)
  assert.equal(await page.getByRole('heading',{name:'기록할 학생을 선택하세요',exact:true}).count(),0)
  assert.equal(await page.getByText('가져온 활동 0회',{exact:true}).isVisible(),false)
  assert.equal(await page.getByLabel('CSV 파일',{exact:true}).inputValue(),'')
  assert.equal(await page.getByRole('button',{name:'확인한 자료 저장',exact:true}).isDisabled(),true)
  assert.deepEqual(await writes(),[])
  if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'teaching-activity-import.png'),fullPage:true})}
  await page.getByRole('button',{name:'가져오기 취소',exact:true}).click()
  await page.getByRole('button',{name:'자료 새로 확인',exact:true}).click()
  await page.getByRole('button',{name:'합성 학생 가 1학년 1반 1번',exact:true}).waitFor()
  assert.equal(await page.getByLabel('CSV 파일',{exact:true}).count(),0)
 },'?empty=1&tab=activity&import=1')
 await check('잘못된 수업을 복구하거나 기록 권한이 뒤에 생겨도 이전 CSV 요청을 자동 실행하지 않는다',async()=>{
  await page.getByRole('alert').filter({hasText:'대화에서 선택한 수업을 현재 권한으로 찾을 수 없습니다.'}).waitFor()
  await page.getByLabel('수업 선택',{exact:true}).selectOption('course-a')
  await page.getByRole('button',{name:'합성 학생 가 1학년 1반 1번',exact:true}).waitFor()
  assert.equal(await page.getByLabel('CSV 파일',{exact:true}).count(),0)
  assert.deepEqual(await writes(),[])
 },'?course=missing&import=1')
 await check('CSV 요청도 현재 수업 기록 권한이 없으면 입력기를 열지 않고 나중 권한 회복 때 재생하지 않는다',async()=>{
  await page.getByRole('alert').filter({hasText:'활동 자료를 가져올 권한이 없습니다.'}).waitFor()
  assert.equal(await page.getByLabel('CSV 파일',{exact:true}).count(),0)
  await page.evaluate(()=>{window.course.canRecord=true;window.refresh()})
  await page.getByRole('button',{name:'합성 학생 가 1학년 1반 1번',exact:true}).waitFor()
  assert.equal(await page.getByLabel('CSV 파일',{exact:true}).count(),0)
  assert.deepEqual(await writes(),[])
 },'?import=1&readonly=1')
 await check('유효한 본인 학생 관찰·확정 평가만 고르고 판·해시·epoch·구간을 그대로 AI에 전달한다',async()=>{
  await openStudent();await page.getByRole('button',{name:'활동·근거',exact:true}).click()
  const action=page.getByRole('button',{name:'선택한 근거로 생기부 초안 작성',exact:true})
  assert.equal(await action.isDisabled(),true)
  assert.equal(await page.getByLabel('관찰 근거 선택',{exact:true}).count(),1)
  assert.equal(await page.getByLabel('평가 의견 근거 선택',{exact:true}).count(),1)
  assert.equal(await page.getByText('관찰 근거 stale',{exact:true}).count(),0)
  assert.equal(await page.getByText('관찰 근거 withdrawn',{exact:true}).count(),0)
  assert.equal(await page.getByText('확정하지 않은 평가 의견',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'상담',exact:true}).count(),0)
  await page.getByLabel('관찰 근거 선택',{exact:true}).check();await page.getByLabel('평가 의견 근거 선택',{exact:true}).check();await action.click()
  await page.getByRole('heading',{name:'합성 전문 대화',exact:true}).waitFor()
  const drafts=await page.evaluate(()=>window.drafts)
  assert.deepEqual(drafts,[{schoolId:'school-a',memberId:'member-a',studentId:'student-0',courseId:'course-a',evidence:[{kind:'observation',id:'valid',revisionId:'rev-valid',sourceHash:'a'.repeat(64),epoch:3,start:0,end:Array.from('관찰 근거 valid').length},{kind:'assessment',id:'assessment-a',revisionId:'assessment-rev',sourceHash:'b'.repeat(64),epoch:2,start:0,end:Array.from('확정한 평가 의견').length}]}])
  await page.getByRole('button',{name:'작성하던 업무 보기',exact:true}).click()
  assert.equal(await page.getByLabel('관찰 근거 선택',{exact:true}).isChecked(),true)
  await page.getByText('명부·활동 가져오기·관계 관리',{exact:true}).click()
  await page.getByRole('button',{name:'활동 CSV 가져오기',exact:true}).click()
  await page.getByLabel('CSV 파일',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('관찰 근거 선택',{exact:true}).isVisible(),false)
  assert.equal(await page.getByLabel('관찰 근거 선택',{exact:true}).isChecked(),true)
  await page.getByRole('button',{name:'가져오기 취소',exact:true}).click()
  assert.equal(await page.getByLabel('관찰 근거 선택',{exact:true}).isChecked(),true)
  assert.equal(await page.getByRole('heading',{name:/합성 학생 가 · 1학년 1반 1번/}).isVisible(),true)
  assert.deepEqual(await writes(),[])
 })
 await check('원문이 재검토 대상으로 바뀌면 이전 근거 선택을 재사용하지 않는다',async()=>{
  await openStudent();await page.getByRole('button',{name:'활동·근거',exact:true}).click()
  await page.getByLabel('관찰 근거 선택',{exact:true}).check()
  await page.evaluate(()=>{window.state.observations[0].sourceReviewRequired=true;window.state.observations[0].epoch++;window.refresh()})
  await page.getByLabel('관찰 근거 선택',{exact:true}).waitFor({state:'detached'})
  assert.equal(await page.getByRole('button',{name:'선택한 근거로 생기부 초안 작성',exact:true}).isDisabled(),true)
  assert.deepEqual(await page.evaluate(()=>window.drafts),[])
 })
 await check('작성 중 다른 대화 수업 요청이 와도 원래 학생·입력을 유지하고 명시 저장 후에만 한 건을 만든다',async()=>{
  await openStudent();await page.getByRole('button',{name:'관찰 기록 작성',exact:true}).click()
  await page.getByLabel('관찰한 사실',{exact:true}).fill('대화 안에서 확인한 관찰')
  // 자식 화면의 편집 상태가 부모 대화 프레임의 이동 잠금에 반영된 뒤 단언한다.
  await page.getByRole('button',{name:'대화 보기',exact:true}).and(page.locator(':disabled')).waitFor()
  assert.equal(await page.getByRole('button',{name:'대화 보기',exact:true}).isDisabled(),true)
  await page.evaluate(()=>window.openCourse('missing'))
  await page.getByText('작성 중인 입력과 요청 번호를 유지했습니다.',{exact:false}).waitFor()
  assert.equal(await page.getByLabel('관찰한 사실',{exact:true}).inputValue(),'대화 안에서 확인한 관찰')
  assert.deepEqual(await writes(),[])
  await page.getByRole('button',{name:'기록 저장',exact:true}).click()
  await page.getByText('대화 안에서 확인한 관찰',{exact:true}).waitFor()
  const saved=await writes();assert.equal(saved.length,1);assert.equal(saved[0].args.p_command.studentId,'student-0')
  assert.equal(await page.getByRole('button',{name:'대화에서 선택한 수업 열기',exact:true}).isEnabled(),true)
 })
 await check('저장 응답 유실은 같은 번호·명령으로 복구하고 접수증 확인 전 대화 전환을 막는다',async()=>{
  await openStudent();await page.getByRole('button',{name:'관찰 기록 작성',exact:true}).click();await page.getByLabel('관찰한 사실',{exact:true}).fill('한 번만 저장할 관찰')
  await page.evaluate(()=>window.failOnce=true);await page.getByRole('button',{name:'기록 저장',exact:true}).click()
  await page.getByRole('button',{name:'같은 요청으로 결과 다시 확인',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'대화 보기',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'작업 마치기',exact:true}).isDisabled(),true)
  assert.equal(await page.getByLabel('관찰한 사실',{exact:true}).inputValue(),'한 번만 저장할 관찰')
  await page.evaluate(()=>window.holdMutation=true);await page.getByRole('button',{name:'같은 요청으로 결과 다시 확인',exact:true}).click()
  await page.getByRole('status',{name:'기록 처리 중',exact:true}).waitFor()
  await page.evaluate(()=>{window.holdMutation=false;window.releaseMutation()})
  await page.getByText('한 번만 저장할 관찰',{exact:true}).waitFor()
  const calls=await writes();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1])
  assert.equal(await page.evaluate(()=>window.state.observations.filter(r=>r.text==='한 번만 저장할 관찰').length),1)
  assert.equal(await page.evaluate(()=>window.pending.count()),0)
  // 기록 목록 반영 뒤 부모 프레임에 잠금 해제가 전달되는 시점까지 확인한다.
  await page.getByRole('button',{name:'대화 보기',exact:true}).and(page.locator(':enabled')).waitFor()
  assert.equal(await page.getByRole('button',{name:'대화 보기',exact:true}).isEnabled(),true)
 })
 await check('작성 권한 철회는 기존 민감 입력을 숨기고 AI 근거·저장을 막는다',async()=>{
  await openStudent();await page.getByRole('button',{name:'관찰 기록 작성',exact:true}).click();await page.getByLabel('관찰한 사실',{exact:true}).fill('권한 재확인 대상 입력')
  await page.evaluate(()=>{window.course.canRecord=false;window.refresh()})
  await page.getByRole('heading',{name:'작성 권한을 다시 확인해 주세요',exact:true}).waitFor()
  assert.equal(await page.getByLabel('관찰한 사실',{exact:true}).count(),0)
  assert.deepEqual(await writes(),[])
  await page.getByRole('button',{name:'저장하지 않은 입력 폐기',exact:true}).click()
  await page.getByRole('button',{name:'활동·근거',exact:true}).click()
  assert.equal(await page.getByLabel('관찰 근거 선택',{exact:true}).isDisabled(),true)
 })
 await check('320px에서도 현재 학생·입력·저장 동작이 넘치지 않고 영속 저장소에 학생 내용을 남기지 않는다',async()=>{
  await page.setViewportSize({width:320,height:780});await openStudent();await page.getByRole('button',{name:'관찰 기록 작성',exact:true}).click();await page.getByLabel('관찰한 사실',{exact:true}).fill('작은 화면에서 확인할 기록')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0})
  if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'teaching-conversation-320.png'),fullPage:true})}
 })
 await check('대화 수업 패널의 미리보기 결과는 출력 전으로 AI 업무 목록에 연결된다',async()=>{
  await openStudent();await page.getByRole('button',{name:'기록 출력·내보내기',exact:true}).click()
  await page.getByRole('button',{name:'기록 미리보기',exact:true}).click()
  await page.getByText('최신 기록으로 미리보기를 만들었습니다. 학생·기간·상태를 확인해 주세요.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'출력 닫기',exact:true}).click();await page.getByRole('button',{name:'대화 보기',exact:true}).click()
  const plan=page.getByRole('region',{name:'나누어 진행할 업무',exact:true});await plan.getByText(/기록 미리보기.*출력 전/).waitFor()
  assert.doesNotMatch(await plan.innerText(),/서버 처리 확인|저장 완료|합성 학생 가|확정한 평가 의견/);assert.deepEqual(await writes(),[])
 })
 await check('같은 학생·기간의 실제 CSV 요청 뒤 AI 목록에 저장 확인 필요를 남긴다',async()=>{
  await openStudent();await page.getByRole('button',{name:'기록 출력·내보내기',exact:true}).click();await page.getByRole('button',{name:'기록 미리보기',exact:true}).click()
  await page.getByText('최신 기록으로 미리보기를 만들었습니다. 학생·기간·상태를 확인해 주세요.',{exact:true}).waitFor()
  await page.getByLabel('학생·기간·기록 상태와 철회·근거 재검토 표시를 확인했습니다.',{exact:true}).check()
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'CSV 내려받기',exact:true}).click();const file=await pending
  const csv=readFileSync(await file.path(),'utf8');assert.match(csv,/합성 학생 가/);assert.match(csv,/확정한 평가 의견/)
  await page.getByRole('button',{name:'출력 닫기',exact:true}).click();await page.getByRole('button',{name:'대화 보기',exact:true}).click()
  const plan=page.getByRole('region',{name:'나누어 진행할 업무',exact:true});await plan.getByText(/기록 CSV 내려받기 요청.*파일 저장 확인 필요/).waitFor()
  assert.equal(await page.evaluate(()=>window.plan.outcomes['step-a'].results.length),2)
  assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(window.plan)),/합성 학생 가|확정한 평가 의견/);assert.deepEqual(await writes(),[])
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 if(output){mkdirSync(output,{recursive:true});writeFileSync(join(output,'teaching-assistant-results.json'),JSON.stringify({passed,errors,external},null,2))}
 console.log(`AI 수업·기록 브라우저 ${passed.length}건 통과`)
}finally{await browser.close()}

