import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {launchBrowser} from './launch-browser.mjs'

// 기존 회귀와 같은 합성 서비스를 공유한다. 실제 React 화면의 이동·입력·명시적 실행을 확인한다.
const bundles=Object.fromEntries(['documents','knowledge'].map(name=>[name,buildSync({entryPoints:[fileURLToPath(new URL(`./workhub-${name}-fixture.tsx`,import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_ANON_KEY:'test-anon'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text]))
const font=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url)).toString('base64')
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:45 920}*{box-sizing:border-box}body{font-family:Pretendard,sans-serif;background:var(--ui-surface-muted,#f6f7f9);margin:0;padding:24px}#root{max-width:1280px;margin:auto}</style><div id="root"></div></html>`
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],external=[],passed=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5189/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:html})})
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true})
const writes=()=>page.evaluate(()=>window.calls.filter(c=>c.command||/_mutate|_commit/.test(c.name)).length)
async function boot(mode){await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5189/'+mode);await page.evaluate(mode=>{window.scenario=mode==='documents'?'':mode},mode);await page.addScriptTag({content:bundles[mode==='knowledge'?'knowledge':'documents']});await page.evaluate(()=>document.fonts.ready);if(mode.startsWith('guided')){await page.getByRole('button',{name:/참가 확인 양식/}).click();await page.getByRole('navigation',{name:'질문형 양식 작업 단계'}).waitFor()}else if(mode==='documents')await page.getByRole('button',{name:/행사 원본/}).click();else await page.getByRole('heading',{name:'학교 규정',exact:true}).waitFor()}
async function check(name,mode,fn){await boot(mode);try{await fn()}catch(e){console.error(await page.locator('body').innerText());throw e}passed.push(name);console.log('  ✓ '+name)}
async function capture(name,locator){if(!process.env.WORKHUB_QA_OUTPUT)return;mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await (locator??page.locator('#root')).screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png')})}
async function step(name,id){await page.getByRole('navigation',{name:'질문형 양식 작업 단계'}).getByRole('button',{name,exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement?.dataset.documentStep),id)}
async function generate(){await field('참여 인원 (필수)').fill('24');await button('답변 임시 저장').click();await page.getByText(/저장을 확인했습니다/).waitFor();await button('저장한 답변으로 HWPX 생성').click();await button('생성 HWPX 내려받기').waitFor()}
const smallDark=async()=>{await page.setViewportSize({width:320,height:760});await page.addStyleTag({content:'html{font-size:32px;--ui-surface:#171c28;--ui-surface-muted:#101521;--ui-text:#e9edf5;--ui-muted:#b7c3d6;--ui-line:#45506a;--ui-accent:#a4baff;--ui-accent-soft:#253658;--ui-on-accent:#102145}body{padding:8px}'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)}
try{
 await check('문서 주요 작업이 본문 앞에 있고 조회만으로 수정·확정하지 않는다','documents',async()=>{
  await page.getByText('불러온 문서 1개',{exact:true}).waitFor();const detail=page.getByRole('region',{name:'선택한 문서',exact:true});assert.equal(await detail.evaluate(el=>Boolean(el.querySelector('.library-detail-actions').compareDocumentPosition(el.querySelector('.library-document-body'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);assert.equal(await writes(),0);await capture('document-library')
 })
 await check('문서 작성 메타데이터와 본문은 검색 뒤에도 유지하고 AI 호출을 만들지 않는다','documents',async()=>{
  await button('이 문서 수정').click();await field('문서 제목').fill('10월 학년 공동 행사 계획');await field('문서 본문').fill('1. 운영 목적\n학생이 함께 준비하는 학년 행사\n\n2. 역할과 일정\n담당 교사와 운영 일정을 확인합니다.');await field('문서 검색').fill('행사');await button('검색').click();await page.getByText('불러온 문서 1개',{exact:true}).waitFor();assert.equal(await field('문서 제목').inputValue(),'10월 학년 공동 행사 계획');assert.match(await field('문서 본문').inputValue(),/운영 목적/);assert.equal(await writes(),0);assert.equal(await page.evaluate(()=>window.aiRequests.length),0);await capture('document-editor',page.getByRole('form',{name:'문서 초안 작성'}))
 })
 await check('질문 단계 이동은 미저장 입력과 질문 위치를 보존하고 서버 쓰기를 하지 않는다','guided-manager',async()=>{
  await field('질문 내용').fill('참석할 학생 수');await step('답변 작성','answers');await step('질문 연결','mapping');assert.equal(await field('질문 내용').inputValue(),'참석할 학생 수');assert.equal(await field('참여 인원 (필수)').isDisabled(),true);assert.equal(await writes(),0);assert.equal(await page.evaluate(()=>window.operations.length),0);await capture('guided-mapping',page.getByRole('region',{name:'선택한 질문형 양식',exact:true}))
 })
 await check('빈 후보가 없으면 무의미한 선택·반영 확인을 숨기고 기존 질문은 계속 편집한다','guided-manager',async()=>{
  await button('질문형으로 준비').click();await page.getByText(/새로 연결할 빈 문단 후보가 없습니다/).waitFor();assert.equal(await field('선택한 질문과 원본 위치를 확인했습니다').count(),0);assert.equal(await button('선택한 연결 제안 반영').count(),0);await field('질문 내용').fill('직접 확인할 질문');assert.equal(await field('질문 내용').inputValue(),'직접 확인할 질문');assert.equal(await writes(),0)
 })
 await check('아직 없는 파일 단계는 안내만 하고 파일 생성이나 AI 요청을 실행하지 않는다','guided-manager',async()=>{
  const nav=page.getByRole('navigation',{name:'질문형 양식 작업 단계'});assert.equal(await nav.getByRole('button',{name:'파일 확인',exact:true}).isDisabled(),true);assert.equal(await nav.getByRole('button',{name:'수합에 게시',exact:true}).isDisabled(),true);await step('답변 작성','answers');assert.equal(await writes(),0);assert.equal(await page.evaluate(()=>window.operations.length),0);await capture('guided-answers',page.getByRole('region',{name:'선택한 질문형 양식',exact:true}))
 })
 await check('게시 영역으로 이동해도 파일 다운로드·확인·수합 선택을 건너뛰지 못한다','guided-manager',async()=>{
  await generate();await step('수합에 게시','connect');await field('연결할 파일형 수합 요청').selectOption('collection');assert.equal(await button('확인한 양식 게시').isDisabled(),true);assert.equal(await field('파일을 열어 내용과 칸 배치를 확인했습니다').isDisabled(),true);await step('파일 확인','file');await button('생성 HWPX 내려받기').click();await field('파일을 열어 내용과 칸 배치를 확인했습니다').check();await step('수합에 게시','connect');assert.equal(await button('확인한 양식 게시').isEnabled(),true);assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.command.kind)),['save_answers']);await capture('guided-file-review',page.getByRole('region',{name:'선택한 질문형 양식',exact:true}));await button('확인한 양식 게시').click();await page.getByText(/저장을 확인했습니다/).waitFor();assert.equal(await page.evaluate(()=>window.calls.at(-1).command.kind),'publish')
 })
 await check('생성 후 답변을 바꾸면 이전 파일 확인과 게시 영역이 사라진다','guided-manager',async()=>{
  await generate();await step('답변 작성','answers');await field('참여 인원 (필수)').fill('25');assert.equal(await button('확인한 양식 게시').count(),0);assert.equal(await button('생성 HWPX 내려받기').count(),0);assert.equal(await page.getByRole('navigation',{name:'질문형 양식 작업 단계'}).getByRole('button',{name:'파일 확인',exact:true}).isDisabled(),true);assert.equal(await writes(),1)
 })
 await check('일반 응답자는 질문 편집·게시 없이 답변과 명시적 수합 첨부만 사용한다','guided-teacher',async()=>{
  assert.equal(await button('질문 연결').count(),0);assert.equal(await button('수합에 게시').count(),0);await generate();await step('수합에 첨부','connect');assert.equal(await button('확인한 파일을 수합에 첨부하기').isDisabled(),true);await button('생성 HWPX 내려받기').click();await field('파일을 열어 내용과 칸 배치를 확인했습니다').check();await button('확인한 파일을 수합에 첨부하기').click();await page.waitForFunction(()=>window.generated.length===1);assert.deepEqual(await page.evaluate(()=>window.generated[0]),{requestId:'collection',artifactId:'artifact',size:4});assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.command.kind)),['save_answers'])
 })
 await check('학교 자료는 상태·기간·근거와 저장 본문·원본 다운로드를 구분한다','knowledge',async()=>{
  await page.getByText('현재 쪽 1개',{exact:true}).waitFor();await page.getByText('원문 확인',{exact:true}).click();await page.getByText('제3조 원문',{exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/저장된 1판 본문/);await button('연결된 HWPX 원본 확인').waitFor();assert.equal(await writes(),0);await capture('school-knowledge')
 })
 await check('학교 자료 작성은 초안이며 게시 종료는 사유를 적고 명시적으로 실행한다','knowledge',async()=>{
  await button('자료 초안 등록').click();await field('제목').fill('학년별 현장체험학습 운영 계획');await field('근거 위치').fill('운영 계획 2쪽');await field('확인한 원문').fill('학생 안전을 먼저 확인합니다.\n담당 교사가 사전 교육과 인원 점검을 진행합니다.');assert.equal(await writes(),0);await capture('knowledge-editor',page.getByRole('form',{name:'학교 자료 작성'}));await button('작성 취소').click();await button('게시 종료').click();assert.equal(await writes(),0);await field('확인 근거 또는 사유').fill('최신 규정으로 대체');await button('확인한 변경 적용').click();await page.getByText('서버에 2판으로 저장했습니다.',{exact:true}).waitFor();assert.equal(await writes(),1)
 })
 await check('작은 화면·큰 글씨·어두운 스킨에서도 문서 입력과 버튼이 넘치지 않는다','documents',async()=>{
  await button('이 문서 수정').click();await field('문서 제목').fill('보존할 긴 문서 제목');await smallDark();await button('초안 저장').focus();assert.equal(await button('초안 저장').evaluate(el=>document.activeElement===el),true);assert.equal(await field('문서 제목').inputValue(),'보존할 긴 문서 제목');assert.equal(await writes(),0);await capture('document-mobile-dark',page.getByRole('form',{name:'문서 초안 작성'}))
 })
 await check('질문 단계 바로가기는 작은 화면에서도 키보드로 입력을 보존하며 이동한다','guided-manager',async()=>{
  await field('참여 인원 (필수)').fill('18');await smallDark();await button('질문 연결').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.documentStep),'mapping');assert.equal(await field('참여 인원 (필수)').inputValue(),'18');assert.equal(await writes(),0);await capture('guided-mobile-dark',page.getByRole('region',{name:'선택한 질문형 양식',exact:true}))
 })
 await check('학교 자료의 긴 제목·본문과 날짜 입력도 작은 화면에서 보존한다','knowledge',async()=>{
  await button('자료 초안 등록').click();await field('제목').fill('학교 자료'.repeat(20));await field('확인한 원문').fill('보존할 본문');await smallDark();assert.equal(await field('확인한 원문').inputValue(),'보존할 본문');assert.equal(await writes(),0);await capture('knowledge-mobile-dark',page.getByRole('form',{name:'학교 자료 작성'}))
 })
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'document-library-ui-results.json'),JSON.stringify({passed,errors,external},null,2));console.log(`문서함·학교 자료·질문형 양식 화면 ${passed.length}개 통과`)
}finally{await browser.close()}
