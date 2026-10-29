import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const bundle=buildSync({stdin:{contents:readFileSync(new URL('./workhub-documents-fixture.tsx',import.meta.url),'utf8'),resolveDir:fileURLToPath(new URL('./',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'test-anon'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],external=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5179/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'})})
let count=0
async function start(scenario=''){await page.goto('http://127.0.0.1:5179/documents');await page.evaluate(value=>window.scenario=value,scenario);await page.addScriptTag({content:bundle.outputFiles[0].text});if(scenario==='missing')await page.getByRole('button',{name:'문서함 다시 연결'}).waitFor();else await page.getByRole('button',{name:scenario.startsWith('guided')?/참가 확인 양식/:/행사 원본/}).waitFor()}
async function test(name,run,scenario=''){await start(scenario);try{await run()}catch(error){console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>({scenario:window.scenario,calls:window.calls,pending:window.pending.count(),active:window.document.activeElement?.id,fields:[...window.document.querySelectorAll('form[aria-label="문서 초안 작성"] input, form[aria-label="문서 초안 작성"] textarea')].map(field=>({id:field.id,value:field.value,valid:field.validity.valid}))})));throw error}count++;console.log('  ✓ '+name)}
async function compose(){await page.getByRole('button',{name:'새 문서 작성'}).click();await page.getByLabel('문서 제목',{exact:true}).fill('내 행사 안내');await page.getByLabel('문서 본문',{exact:true}).fill('기록할 본문')}
try{
 await test('초기 초점이 늦어져도 제목 입력을 가로채지 않고 원래 문서 요청을 보존한다',async()=>{
  // 작업 큐가 늦어진 상황을 만들되 저장·입력 이벤트는 실제 브라우저 경로로 보낸다.
  await page.evaluate(()=>{
   const nativeTimer=window.setTimeout,queued=[];
   window.documentFocusTimer=nativeTimer;
   window.releaseDocumentFocus=()=>{window.setTimeout=nativeTimer;for(const run of queued.splice(0))run()};
   window.setTimeout=function(run,delay,...args){if(delay===0&&typeof run==='function')return nativeTimer(()=>queued.push(()=>run(...args)),delay);return nativeTimer(run,delay,...args)};
  });
  await page.getByRole('button',{name:'새 문서 작성'}).click();
  await page.getByRole('form',{name:'문서 초안 작성'}).waitFor();
  await page.evaluate(()=>new Promise(resolve=>window.documentFocusTimer(resolve,0)));
  await page.getByLabel('문서 제목',{exact:true}).focus();
  await page.evaluate(()=>window.releaseDocumentFocus());
  await page.keyboard.insertText('내 행사 안내');
  await page.getByLabel('문서 본문',{exact:true}).fill('기록할 본문');
  assert.equal(await page.getByLabel('문서 제목',{exact:true}).inputValue(),'내 행사 안내');
  await page.getByRole('button',{name:'초안 저장',exact:true}).click();
  await page.getByRole('button',{name:'같은 문서 요청 다시 확인'}).waitFor();
  const original=await page.evaluate(()=>window.calls[0]);
  assert.equal(original.command.input.title,'내 행사 안내');
  assert.equal(original.command.input.body,'기록할 본문');
  assert.equal(await page.evaluate(()=>window.pending.count()),1);
  await page.getByRole('button',{name:'같은 문서 요청 다시 확인'}).click();
  await page.getByText(/문서 v1을 저장했습니다/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls[1]),original);
 },'unknown')
 await test('AI 제안은 비교 후 입력에만 반영하고 저장은 명시적으로 한다',async()=>{await compose();await page.evaluate(()=>window.setAi(false));await page.getByRole('button',{name:'이 초안을 입력에 반영'}).click();assert.equal(await page.getByLabel('문서 본문',{exact:true}).inputValue(),'AI가 작성한 검토용 초안');assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByRole('button',{name:'AI 반영 전 입력으로 되돌리기'}).click();assert.equal(await page.getByLabel('문서 본문',{exact:true}).inputValue(),'기록할 본문');await page.getByRole('button',{name:'초안 저장',exact:true}).click();await page.getByText(/문서 v1을 저장했습니다/).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),0)})
 await test('저장 결과불명은 원문·원래 키를 접기와 재마운트 후 보존한다',async()=>{await compose();await page.getByRole('button',{name:'초안 저장',exact:true}).click();await page.getByRole('button',{name:'같은 문서 요청 다시 확인'}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);await page.getByRole('button',{name:'입력 접고 문서함 보기',exact:true}).click();await page.evaluate(()=>window.unmount());await page.getByRole('heading',{name:'문서함',exact:true}).waitFor({state:'detached'});await page.evaluate(()=>window.remount());await page.getByRole('button',{name:'보관한 문서 입력 보기'}).click();assert.equal(await page.getByLabel('문서 본문',{exact:true}).inputValue(),'기록할 본문');await page.getByRole('button',{name:'같은 문서 요청 다시 확인'}).click();await page.getByText(/문서 v1을 저장했습니다/).waitFor();const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls[0],calls[1])},'unknown')
 await test('서버 준비 오류 중 미확정 저장은 읽기 전용 접수증으로 복구한다',async()=>{await compose();await page.getByRole('button',{name:'초안 저장',exact:true}).click();await page.getByRole('button',{name:'같은 문서 요청 다시 확인'}).waitFor();await page.evaluate(()=>{window.listFailed=true;window.refresh()});await page.getByRole('button',{name:'문서함 다시 연결'}).waitFor();await page.getByRole('button',{name:'같은 문서 요청 다시 확인'}).click();await page.getByText(/문서 v1을 저장했습니다/).waitFor();assert.equal(await page.evaluate(()=>window.recovered),true);assert.equal(await page.evaluate(()=>window.calls.length),1)},'unknown')
 await test('충돌 비교는 제목·본문·공개범위·종류·기준일·근거를 모두 보여준다',async()=>{await page.getByRole('button',{name:/행사 원본/}).click();await page.getByRole('button',{name:'이 문서 수정',exact:true}).click();await page.getByLabel('문서 본문',{exact:true}).fill('내 수정 본문');await page.getByRole('button',{name:'초안 저장',exact:true}).click();const compare=page.getByRole('region',{name:'문서 변경 비교'});await compare.waitFor();for(const text of ['다른 사람 제목','다른 곳 본문','학교 공유','가정통신문','2026-10-17','새 규정 3쪽','내 수정 본문'])assert((await compare.innerText()).includes(text));await page.getByRole('button',{name:'비교 완료 · 내 입력으로 계속 수정'}).click();await page.getByRole('button',{name:'초안 저장',exact:true}).click();await page.getByText(/문서 v3을 저장했습니다/).waitFor();const calls=await page.evaluate(()=>window.calls);assert.equal(calls[1].command.expectedVersion,2);assert.equal(calls[1].command.input.body,'내 수정 본문')},'conflict')
 await test('AI로 이동하고 돌아와도 접힌 원문과 잠금 해제를 유지한다',async()=>{await compose();await page.getByRole('button',{name:'현재 입력으로 AI 초안 요청'}).click();await page.getByRole('button',{name:'문서 작성 계속하기'}).waitFor();await page.evaluate(()=>window.unmount());await page.getByRole('heading',{name:'문서함',exact:true}).waitFor({state:'detached'});await page.evaluate(()=>window.remount());await page.getByRole('button',{name:'문서 작성 계속하기'}).waitFor();await page.waitForFunction(()=>window.locked===false);await page.getByRole('button',{name:'문서 작성 계속하기'}).click();assert.equal(await page.getByLabel('문서 본문',{exact:true}).inputValue(),'기록할 본문')})
 await test('긴 미저장 본문은 잘라 보내지 않고 요청 전에 안내한다',async()=>{await compose();await page.getByLabel('문서 본문',{exact:true}).fill('가'.repeat(5000));await page.getByRole('button',{name:'현재 입력으로 AI 초안 요청'}).click();await page.getByText(/본문이 길어 한 번에 전달할 수 없습니다/).waitFor();assert.equal(await page.evaluate(()=>window.aiRequests.length),0);assert.equal((await page.getByLabel('문서 본문',{exact:true}).inputValue()).length,5000)})
 await test('학생 초안은 종류·공개 범위가 고정되고 근거 전체를 저장한다',async()=>{await page.evaluate(()=>window.setAi(true));await page.getByRole('button',{name:'이 초안을 입력에 반영'}).click();assert.equal(await page.getByLabel('공개 범위',{exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('문서 종류',{exact:true}).isDisabled(),true);await page.getByRole('button',{name:'초안 저장',exact:true}).click();await page.getByText(/문서 v1을 저장했습니다/).waitFor();const command=await page.evaluate(()=>window.calls[0].command);assert.equal(command.input.visibility,'private');assert.equal(command.input.studentContext.evidence[0].epoch,1)})
 await test('미연결은 빈 문서함·작성 가능 상태로 보이지 않는다',async()=>{assert.equal(await page.getByRole('button',{name:'새 문서 작성'}).isDisabled(),true);assert.doesNotMatch(await page.locator('body').innerText(),/조건에 맞는 문서가 없습니다/)},'missing')
 await test('질문 답변 임시저장·파일생성·확인·수합 첨부를 구분한다',async()=>{await page.getByRole('button',{name:/참가 확인 양식/}).click();await page.getByLabel('참여 인원 (필수)',{exact:true}).fill('0');await page.getByRole('button',{name:'답변 임시 저장'}).click();await page.getByText(/저장을 확인했습니다/).waitFor();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성'}).click();await page.getByRole('button',{name:'생성 HWPX 내려받기'}).waitFor();assert.equal(await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기'}).isDisabled(),true);await page.getByRole('button',{name:'생성 HWPX 내려받기'}).click();await page.getByLabel('파일을 열어 내용과 칸 배치를 확인했습니다').check();await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기'}).click();await page.waitForFunction(()=>window.generated.length===1);assert.deepEqual(await page.evaluate(()=>window.generated[0]),{requestId:'collection',artifactId:'artifact',size:4});assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.command.kind)),['save_answers'])},'guided-teacher')
 await test('질문형 저장 응답유실도 입력·기존 키를 유지한다',async()=>{await page.getByRole('button',{name:/참가 확인 양식/}).click();await page.getByLabel('참여 인원 (필수)',{exact:true}).fill('12');await page.getByRole('button',{name:'답변 임시 저장'}).click();await page.getByRole('button',{name:'같은 양식 요청 다시 확인'}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);await page.getByRole('button',{name:'같은 양식 요청 다시 확인'}).click();await page.getByText(/저장을 확인했습니다/).waitFor();const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.getByLabel('참여 인원 (필수)',{exact:true}).inputValue(),'12')},'guided-unknown')
 await test('매핑 저장 뒤 목록과 본문은 같은 판을 표시하고 숫자 단위 치환을 안내한다',async()=>{
  const item=page.getByRole('button',{name:/참가 확인 양식/});await item.click();
  await page.getByLabel('질문 내용',{exact:true}).fill('참여 인원 확인');
  await page.getByRole('button',{name:'질문·위치 매핑 저장',exact:true}).click();await page.getByText(/저장을 확인했습니다/).waitFor();
  assert.match(await item.innerText(),/v3/);await page.getByText(/원본의 %, 명, 원 등 단위는 자동으로 남지 않습니다/).waitFor();
 },'guided-manager');
 await test('게시 연결 대상이 비면 현재 공개 조건을 설명하고 게시 요청을 보내지 않는다',async()=>{
  await page.evaluate(()=>window.noTargets=true);await page.getByRole('button',{name:/참가 확인 양식/}).click();
  await page.getByLabel('참여 인원 (필수)',{exact:true}).fill('20');await page.getByRole('button',{name:'답변 임시 저장'}).click();
  await page.getByText(/저장을 확인했습니다/).waitFor();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성'}).click();
  await page.getByText(/담당자 초안은 목록에 나오지 않습니다/).waitFor();
  assert.equal(await page.getByRole('button',{name:'확인한 양식 게시'}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.command?.kind==='publish').length),0);
 },'guided-manager');
 await test('담당자는 원문 칸을 보고 질문을 지정하고 예시파일 확인 전 게시하지 못한다',async()=>{await page.getByRole('button',{name:/참가 확인 양식/}).click();await page.getByText(/원본의 입력 가능한 위치 보기/).click();assert.match(await page.locator('body').innerText(),/표 셀 1행 2열/);await page.getByLabel('질문 내용',{exact:true}).fill('실제 참여 인원');await page.getByRole('button',{name:'질문·위치 매핑 저장'}).click();await page.getByText(/저장을 확인했습니다/).waitFor();assert.equal(await page.getByRole('button',{name:'확인한 양식 게시'}).count(),0);const command=await page.evaluate(()=>window.calls[0].command);assert.equal(command.mapping.questions[0].sourceText,'참여 인원');assert.equal(command.mapping.questions[0].anchorId,'Contents/section0.xml:p000000')},'guided-manager')
 await test('양식 업로드 뒤 분석 응답유실에도 원본·두 키를 보존하고 파일을 중복 업로드하지 않는다',async()=>{await page.getByLabel('양식 이름',{exact:true}).fill('원본 양식');await page.getByLabel('HWPX 양식 선택',{exact:true}).setInputFiles({name:'원본.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from([80,75,3,4,1,2,3])});await page.getByRole('button',{name:'같은 양식 요청 다시 확인'}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);await page.evaluate(()=>window.unmount());await page.getByRole('heading',{name:'질문으로 채우는 HWPX'}).waitFor({state:'detached'});await page.evaluate(()=>window.remount());await page.getByRole('button',{name:'같은 양식 요청 다시 확인'}).click();await page.getByText(/양식의 실제 문단을 읽었습니다/).waitFor();const operations=await page.evaluate(()=>window.operations);assert.equal(operations.filter(x=>x.kind==='upload').length,1);assert.equal(new Set(operations.filter(x=>x.kind==='prepare').map(x=>x.key)).size,1);assert.equal(new Set(operations.filter(x=>x.kind==='inspect').map(x=>x.key)).size,1);assert.equal(await page.evaluate(()=>window.pending.count()),0)},'guided-manager')
 await test('320px 문서 작성에서 가로 스크롤이 생기지 않는다',async()=>{await page.setViewportSize({width:320,height:740});await compose();assert.equal(await page.evaluate(()=>window.document.documentElement.scrollWidth<=innerWidth+1),true);await page.setViewportSize({width:390,height:844})})
 await test('미연결 빈 문단을 먼저 보여 주고 명시 연결·삭제 때만 후보를 갱신한다',async()=>{
  await page.getByRole('button',{name:/참가 확인 양식/}).click();await page.getByText(/원본의 입력 가능한 위치 보기/).click();
  const picker=page.locator('details').filter({has:page.getByLabel('빈 문단 후보만 보기')});
  assert.equal(await page.getByLabel('빈 문단 후보만 보기').isChecked(),true);
  assert.equal(await picker.getByRole('button',{name:'이 위치에 질문 연결'}).count(),1);
  assert.doesNotMatch(await picker.innerText(),/보존할 안내 문구/);
  await picker.getByRole('button',{name:'이 위치에 질문 연결'}).click();
  await page.getByText('아직 연결하지 않은 빈 문단 0개').waitFor();
  assert.equal(await page.getByLabel('질문 내용',{exact:true}).count(),2);
  assert.equal(await page.getByLabel('질문 내용',{exact:true}).nth(1).inputValue(),'');
  assert.equal(await page.getByLabel('질문 내용',{exact:true}).first().inputValue(),'참여 인원');
  await page.getByLabel('빈 문단 후보만 보기').uncheck();
  assert.equal(await picker.getByRole('button',{name:'이 위치에 질문 연결'}).count(),3);
  assert.match(await picker.innerText(),/보존할 안내 문구/);
  assert.equal(await picker.getByRole('button',{name:'이 위치에 질문 연결'}).nth(1).isDisabled(),true);
  await page.getByRole('button',{name:'이 질문 삭제'}).nth(1).click();await page.getByLabel('빈 문단 후보만 보기').check();
  await page.getByText('아직 연결하지 않은 빈 문단 1개').waitFor();
  assert.equal(await picker.getByRole('button',{name:'이 위치에 질문 연결'}).count(),1);
  assert.equal(await page.evaluate(()=>window.calls.length+window.operations.length),0);
 },'guided-manager-blanks')
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('문서함·질문형 수합 브라우저 '+count+'건 통과')
}finally{await browser.close()}
