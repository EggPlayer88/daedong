// 실제 화면·인계 서비스와 합성 응답으로 구성한다. 실서비스 호출은 전부 차단한다.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {launchBrowser} from './launch-browser.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url))
const app=(await build({entryPoints:[join(root,'tests/browser/workhub-coordination-ui-fixture.tsx')],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})).outputFiles[0].text
const output=process.env.WORKHUB_QA_OUTPUT||mkdtempSync(join(tmpdir(),'coordination-ui-'));mkdirSync(output,{recursive:true})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),passed=[],errors=[],external=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss())
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:5187'){external.push(url.href);return route.abort()}const match=url.pathname.match(/(PretendardVariable|TossFaceFontMac-0[789])\.woff2$/);if(match)return route.fulfill({contentType:'font/woff2',body:readFileSync(join(root,'apps/workhub/src/assets/fonts',match[1].startsWith('Toss')?'tossface':'',match[0]))});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),label=name=>page.getByLabel(name,{exact:true})
async function start(screen,theme='light',textSize='standard'){
 await page.goto('http://127.0.0.1:5187/'+screen);await page.evaluate(({theme,textSize})=>localStorage.setItem('workhub:appearance:v1',JSON.stringify({theme,textSize,density:'comfortable'})),{theme,textSize})
 await page.addStyleTag({content:readFileSync(join(root,'apps/workhub/src/typography.css'),'utf8')+readFileSync(join(root,'apps/workhub/src/assets/fonts/tossface/tossface.css'),'utf8')});await page.addScriptTag({content:app});await page.getByRole('heading',{level:1}).waitFor()
 if(screen==='transitions'){await page.getByText('업무 인계와 새 학년도 준비',{exact:true}).click();await button('업무 인계 준비').waitFor()}
 await page.evaluate(async()=>{await document.fonts.ready})
}
async function fits(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'문서 가로 넘침 없음');const dialog=page.getByRole('dialog');if(await dialog.count())assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'대화상자 가로 넘침 없음')}
async function shot(name){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,name+'.png'),fullPage:true})}
async function check(name,fn){await fn();passed.push(name);console.log('  ✓ '+name)}
async function prepareHandover(){await button('업무 인계 준비').click();await label('인수 교사').selectOption({index:1});await page.getByRole('checkbox',{name:'학급 운영계획 수합 · 3판',exact:true}).check();await label('인계 내용').fill('현재 제출 현황과 보완 요청을 확인해 주세요.\n마감 일정은 기존 안내를 유지합니다.')}
try{
 await check('일정의 기본 입력과 공유 범위를 나란히 보고 접은 대상 설정과 입력을 보존한다',async()=>{
  await start('calendar');await button('일정 등록').click();await page.locator('input[name=title]').fill('학년 협의회');await label('장소').fill('2층 회의실');await label('안내 내용').fill('학급별 준비 자료를 함께 확인합니다.')
  const a=await page.locator('.calendar-compose-core').boundingBox(),b=await page.locator('.calendar-compose-scope').boundingBox();assert(b.x>a.x+a.width)
  assert.equal(await page.locator('.calendar-target-options').getAttribute('open'),null)
  await page.getByText('홈 추천·관련 대상 설정',{exact:true}).click();await page.getByText('교사 직접 포함·제외',{exact:true}).click()
  const checkbox=page.getByRole('checkbox',{name:/직접 포함/}).first();await checkbox.check();await page.getByText('홈 추천·관련 대상 설정',{exact:true}).click();await shot('01-calendar-desktop')
  await page.setViewportSize({width:390,height:844});await fits();assert.equal(await label('장소').inputValue(),'2층 회의실');await page.getByText('홈 추천·관련 대상 설정',{exact:true}).click();assert(await checkbox.isChecked());await shot('02-calendar-mobile');await page.getByText('홈 추천·관련 대상 설정',{exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>window.coordination.writes),[]);await page.getByRole('dialog').getByRole('button',{name:'일정 등록',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});const commands=await page.evaluate(()=>window.coordination.writes);assert.equal(commands.length,1);assert.equal(commands[0].draft.audience.includeMemberIds.length,1);assert.equal(commands[0].draft.location,'2층 회의실')
 })
 await check('일괄 가져오기는 원본과 열 연결 단계를 구분하고 이 단계에서 저장하지 않는다',async()=>{
  await page.setViewportSize({width:1440,height:1100});await start('batch');await label('원본 묶음 ID').fill('school-plan-2026');await label('원본 묶음 이름').fill('학년 협의 일정');await label('원본 표 붙여넣기').fill('원본 ID,제목,시작일\nmeeting-01,학년 협의회,2026-10-30');assert.match(await page.locator('.batch-progress [aria-current=step]').innerText(),/원본 입력/);await shot('09-batch-desktop');await button('열 연결 확인').click();assert.match(await page.locator('.batch-progress [aria-current=step]').innerText(),/열 연결/);assert.deepEqual(await page.evaluate(()=>window.coordination.writes),[]);await page.setViewportSize({width:390,height:844});await fits();assert.equal(await label('원본 묶음 ID').inputValue(),'school-plan-2026');await shot('10-batch-mobile')
 })
 await check('협업 목록과 상세를 함께 보고 수락과 완료 확인을 혼동하지 않는다',async()=>{
  await page.setViewportSize({width:1440,height:1100});await start('cooperation');await page.getByRole('button',{name:/학년 협의회 자료 검토/}).click();await button('수락').waitFor();assert.equal(await button('완료 확인').count(),0)
  const a=await page.locator('.cooperation-inbox').boundingBox(),b=await page.locator('.cooperation-detail').boundingBox();assert(b.x>a.x+a.width);await fits();await shot('03-cooperation-desktop');await page.setViewportSize({width:390,height:844});await fits();await shot('04-cooperation-mobile');assert.deepEqual(await page.evaluate(()=>window.coordination.writes),[])
 })
 await check('협업의 선택 업무 연결은 접어도 남고 내용 변경 후 재확인해야 전송된다',async()=>{
  await page.setViewportSize({width:1440,height:1100});await start('cooperation');await button('새 협업 요청').click();await label('받는 선생님').selectOption({index:1});await label('요청 제목').fill('협의회 자료 검토');await label('요청 내용').fill('의견을 부탁드립니다.');await label('희망 기한 · 선택').fill('2026-10-30')
  assert.equal(await label('내 원본 업무 · 선택').isVisible(),false);await page.getByText('내 업무와 연결 · 선택',{exact:true}).click();await label('내 원본 업무 · 선택').selectOption('t1');await page.getByText('내 업무와 연결 · 선택',{exact:true}).click()
  const confirm=page.getByRole('checkbox',{name:/에게 보낼 내용과 기한을 확인했습니다/});await confirm.check();await label('요청 내용').fill('변경된 요청입니다.');assert.equal(await confirm.isChecked(),false);assert(await button('확인한 요청 보내기').isDisabled());await shot('05-cooperation-compose')
  await confirm.check();await button('확인한 요청 보내기').click();await page.getByText('서버에 저장했습니다.',{exact:true}).waitFor();const writes=await page.evaluate(()=>window.coordination.writes);assert.equal(writes.length,1);assert.deepEqual(writes[0].command.sourceTask,{id:'t1',expectedVersion:2});assert.equal(writes[0].command.description,'변경된 요청입니다.')
 })
 await check('인계 단계와 제외 자료를 보여주고 미리보기만으로 저장하거나 수락하지 않는다',async()=>{
  await start('transitions');await prepareHandover();assert.match(await page.locator('.transitions-steps [aria-current=step]').innerText(),/대상·내용 입력/);await button('변경 대상 미리보기').click();await page.getByRole('region',{name:'인계 변경 미리보기'}).waitFor();assert.match(await page.locator('.transitions-steps [aria-current=step]').innerText(),/변경 미리보기/);assert(await page.getByText('개인 메모·상담·학생 기록은 포함하지 않습니다.',{exact:true}).isVisible());assert.deepEqual(await page.evaluate(()=>window.coordination.writes),[])
  await label('현재 대상과 변경 내용을 확인했습니다').check();assert.match(await page.locator('.transitions-steps [aria-current=step]').innerText(),/확인 후 요청/);await fits();await shot('06-handover-desktop');await page.setViewportSize({width:390,height:844});await fits();await shot('07-handover-mobile')
  await label('인계 내용').fill('변경된 인계 메모');assert.equal(await page.getByRole('region',{name:'인계 변경 미리보기'}).count(),0);assert(await button('확인한 변경 요청').isDisabled());await button('변경 대상 미리보기').click();await label('현재 대상과 변경 내용을 확인했습니다').check();await button('확인한 변경 요청').click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.',{exact:true}).waitFor();const writes=await page.evaluate(()=>window.coordination.writes);assert.equal(writes.length,1);assert.equal(writes[0].p_command.plan.resources.length,1);assert.equal(writes[0].p_command.plan.note,'변경된 인계 메모')
 })
 await check('인계 결과 미상 안내는 접히지 않고 원래 명령과 번호로 복구된다',async()=>{
  await start('transitions');await prepareHandover();await button('변경 대상 미리보기').click();await label('현재 대상과 변경 내용을 확인했습니다').check();await page.evaluate(()=>window.coordination.drop=true);await button('확인한 변경 요청').click();await page.getByRole('complementary',{name:'보관한 인계 요청'}).waitFor();assert(await label('인계 내용').isDisabled());await page.evaluate(()=>window.coordination.drop=false);await button('원래 인계 요청 결과 확인').click();await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.',{exact:true}).waitFor();const writes=await page.evaluate(()=>window.coordination.writes);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(await page.evaluate(()=>window.coordination.receipts.size),1)
 })
 await check('새 학년도는 빈 공식 날짜를 유지하고 320px 큰 글씨에서도 세 화면이 잘리지 않는다',async()=>{
  await page.setViewportSize({width:320,height:800});for(const screen of ['calendar','cooperation','batch','transitions']){await start(screen,'dark','large');if(screen==='calendar'){await button('일정 등록').click();await page.locator('input[name=title]').fill('작은 화면 일정')}else if(screen==='cooperation'){await button('새 협업 요청').click()}else if(screen==='transitions'){await button('새 학년도 준비').click();assert.equal(await page.locator('input[type=date]').count(),6);for(const field of await page.locator('input[type=date]').all())assert.equal(await field.inputValue(),'');assert(await button('확인한 변경 요청').isDisabled())}await fits();for(const control of await page.locator('.wh-composer input:not([type=checkbox]),.wh-composer textarea,.wh-composer select,.wh-composer button').all()){if(!await control.isVisible())continue;const box=await control.boundingBox();assert(box.x>=0&&box.x+box.width<=321,screen+' 조작 요소 가로 범위')}assert.deepEqual(await page.evaluate(()=>window.coordination.writes),[])}await shot('08-year-dark-large')
 })
 await check('640px·200% CSS 확대에서도 인계 복구 버튼을 키보드로 실행하고 원래 요청을 보존한다',async()=>{
  await page.setViewportSize({width:640,height:1000});await start('transitions');await page.addStyleTag({content:'html{zoom:2}'})
  await prepareHandover();await button('변경 대상 미리보기').click();await label('현재 대상과 변경 내용을 확인했습니다').check();await page.evaluate(()=>window.coordination.drop=true);await button('확인한 변경 요청').click()
  const recover=button('원래 인계 요청 결과 확인');await recover.and(page.locator(':enabled')).waitFor();await fits();await recover.focus();await shot('11-handover-recovery-css-zoom-200')
  await page.evaluate(()=>window.coordination.drop=false);await page.keyboard.press('Enter');await page.getByText('인계 요청을 저장했습니다. 받는 교사의 인수 확인을 기다립니다.',{exact:true}).waitFor()
  const writes=await page.evaluate(()=>window.coordination.writes);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(await page.evaluate(()=>window.coordination.receipts.size),1)
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(output,'results.json'),JSON.stringify({passed,errors,external},null,2)+'\n');console.log(`일정·협업·인계 UI ${passed.length}건 통과 · ${output}`)
}catch(error){await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}finally{await browser.close()}
