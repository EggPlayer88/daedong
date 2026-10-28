// 실제 화면·전송 어댑터·파서를 사용한다. HTTP/RPC/Storage는 loopback 합성이며 파일 생성·최소 검사·ZIP 내용 대조는 실제 코드다.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {unzipSync} from 'fflate'
import {clickWorkspaceMenu} from '../helpers/workspace-menu.mjs'
import {launchBrowser} from './launch-browser.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url)),helper=fileURLToPath(new URL('../helpers/document-collection-fixture.py',import.meta.url))
const python=process.env.WORKHUB_TEST_PYTHON??process.env.PYTHON??'python'
function py(args,input){const r=spawnSync(python,[helper,...args],{cwd:root,encoding:'utf8',input,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},maxBuffer:12*1024*1024});assert.equal(r.status,0,r.stderr||r.error?.message);return JSON.parse(r.stdout)}
const seed=py(['--count','2']),digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const guidedPath=fileURLToPath(new URL('../../apps/workhub/src/documents/guided-adapter.ts',import.meta.url)).replaceAll('\\','/')
const bundle=await build({entryPoints:[fileURLToPath(new URL('./workhub-document-collection-flow-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},plugins:[{name:'synthetic-session-storage',setup(b){
 b.onResolve({filter:/^@daedong\/shared$/},()=>({path:'synthetic-shared',namespace:'flow'}))
 b.onLoad({filter:/.*/,namespace:'flow'},()=>({contents:`export const getSession=()=>window.flow.session();export const supabase={storage:{from:bucket=>({upload:(path,file)=>window.flow.storage.upload(bucket,path,file),download:path=>window.flow.storage.download(bucket,path)})}};export const fetchMyProfile=async()=>null;export const onAuthStateChange=()=>()=>{};export const signInWithGoogle=async()=>{throw Error('합성 외부 로그인 금지')};export const signOut=async()=>{};`,loader:'js'}))
 // 제품 서비스의 공개 timeout 옵션만 짧게 주입한다. HTTP·권한 대조·파일 해시 코드는 그대로 실행한다.
 b.onResolve({filter:/^\.\/guided-adapter$/},a=>a.importer.endsWith('GuidedWorkspace.tsx')?{path:'guided-deadline',namespace:'flow-timeout'}:undefined)
 b.onLoad({filter:/.*/,namespace:'flow-timeout'},()=>({contents:`export * from ${JSON.stringify(guidedPath)};import{createGuidedService as factory}from ${JSON.stringify(guidedPath)};export const createGuidedService=(c,p)=>factory(c,p,{timeoutMs:1500});`,loader:'ts',resolveDir:root}))
}}],define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const output=process.env.WORKHUB_QA_OUTPUT??mkdtempSync(join(tmpdir(),'workhub-document-collection-flow-'));mkdirSync(output,{recursive:true})
const fontCss=readFileSync(new URL('../../apps/workhub/src/typography.css',import.meta.url),'utf8'),fontBytes=readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2',import.meta.url))
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true}),page=await context.newPage(),passed=[],errors=[],external=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',async route=>{
 const req=route.request(),url=req.url();if(!url.startsWith('http://127.0.0.1:5188/')){external.push(url);return route.abort()}
 if(url.endsWith('/assets/fonts/PretendardVariable.woff2'))return route.fulfill({contentType:'font/woff2',body:fontBytes})
 if(req.method()==='POST'){
  assert.equal(req.headers().authorization,'Bearer synthetic-session')
  const result=await page.evaluate(async({path,p})=>window.flow.handleHttp(path,p),{path:new URL(url).pathname,p:req.postDataJSON()})
  return route.fulfill({status:result.status??200,contentType:'application/json',body:JSON.stringify(result.body)})
 }
 return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})
})
const go=name=>clickWorkspaceMenu(page,name==='문서 수합'?'자료 수합':name),review=()=>page.getByLabel('파일을 열어 내용과 칸 배치를 확인했습니다',{exact:true}),answerForm=()=>page.getByRole('form',{name:'제출 파일 작성',exact:true})
const matches=()=>page.evaluate(()=>({uploads:window.flow.uploads,http:window.flow.http,calls:window.flow.calls,applied:window.flow.applied,snapshot:window.flow.snapshot()}))
async function openQuestions(i=0){await go('문서함');await page.getByRole('button',{name:'질문형 수합 양식',exact:true}).click();await page.getByRole('button',{name:/학교자료학교자료/}).click();for(const q of seed.mapping.questions)await page.getByLabel(q.label+(q.required?' (필수)':''),{exact:true}).fill(seed.documents[i].answers[q.id])}
async function savedAndGenerated(i=0){await openQuestions(i);await page.getByRole('button',{name:'답변 임시 저장',exact:true}).click();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).and(page.locator(':enabled')).waitFor();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).click();await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).waitFor();assert.equal(await review().isDisabled(),true);assert.equal(await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기',exact:true}).isDisabled(),true);assert.equal((await matches()).uploads.length,i)}
async function downloadGenerated(i=0){const wait=page.waitForEvent('download');await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).click();const download=await wait,bytes=readFileSync(await download.path());assert.equal(digest(bytes),seed.documents[i].file.sha256);assert.ok(download.suggestedFilename().length<=200);assert.ok(download.suggestedFilename().endsWith('.hwpx'));return download.suggestedFilename()}
async function handoff(i=0){await review().check();await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기',exact:true}).click();await page.getByRole('region',{name:'수합 상세',exact:true}).waitFor();assert.equal((await matches()).uploads.length,i);await page.getByRole('button',{name:'내 제출 파일 작성',exact:true}).click();await answerForm().waitFor();assert.equal((await matches()).uploads.length,i)}
async function attach(i=0){await page.getByRole('button',{name:'문서함에서 만든 HWPX 첨부',exact:true}).click();await page.getByText(/파일 준비가 완료되었습니다/).waitFor();const result=await matches();assert.equal(result.uploads.length,i+1);assert.equal(result.uploads[i].sha256,seed.documents[i].file.sha256);assert.equal(result.http.filter(x=>x.path==='/api/collections/check-hwpx').length,i+1);assert.equal(result.snapshot.submissions.length,i)}
async function saveAndSubmit(){await page.getByRole('button',{name:'제출 초안 저장',exact:true}).click();await page.getByRole('button',{name:'저장한 파일 최종 제출',exact:true}).and(page.locator(':enabled')).waitFor();await page.getByRole('button',{name:'저장한 파일 최종 제출',exact:true}).click();await page.getByText(/최종 제출을 접수했습니다/).waitFor()}
async function login(id){await page.evaluate(id=>window.flow.login(id),id);await page.locator('.ws-primary-menus').getByRole('button',{name:'홈',exact:true}).waitFor()}
async function test(name,run){await page.setViewportSize({width:1280,height:1000});await page.goto('http://127.0.0.1:5188/document-collection');await page.addStyleTag({content:fontCss});await page.evaluate(seed=>window.flowSeed=seed,seed);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.locator('.ws-primary-menus').getByRole('button',{name:'홈',exact:true}).waitFor();try{await run();assert.deepEqual(errors,[]);assert.deepEqual(external,[])}catch(error){console.error((await page.getByRole('main').allInnerTexts()).join('\n').slice(-10000));console.error(await page.evaluate(()=>({calls:window.flow.calls.slice(-10),applied:window.flow.applied})));await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error}passed.push(name);console.log('  ✓ '+name)}
try{
 await test('문서 저장·생성 대기 안내는 복구 안내와 구분하고 응답 유실 후 원래 키로 복구한다',async()=>{
  await openQuestions();await page.evaluate(()=>{window.flow.holdGuided=true;window.flow.unknownGuided=true})
  await page.getByRole('button',{name:'답변 임시 저장',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseGuided==='function')
  const status=page.getByRole('region',{name:'질문형 문서 처리 결과 확인',exact:true})
  await status.getByRole('status').filter({hasText:'문서 요청을 처리하고 있습니다'}).waitFor()
  assert.equal(await status.getByRole('button',{name:'처리 결과 확인 중…',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).count(),0)
  assert.doesNotMatch(await page.locator('.library-step-guide').innerText(),/이전 요청/)
  await page.evaluate(()=>window.flow.releaseGuided())
  await status.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).and(page.locator(':enabled')).waitFor()
  assert.match(await page.locator('.library-step-guide').innerText(),/이전 요청의 결과/)
  for(const q of seed.mapping.questions)assert.equal(await page.getByLabel(q.label+' (필수)',{exact:true}).inputValue(),seed.documents[0].answers[q.id])
  await status.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).click();await status.waitFor({state:'hidden'})
  const writes=(await matches()).calls.filter(c=>c.name==='workhub_template_mutate');assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args)
  assert.equal((await matches()).applied.filter(c=>c.kind==='save_answers').length,1)
  await page.evaluate(()=>window.flow.holdRender=true);await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseRender==='function')
  await status.getByRole('status').filter({hasText:'문서 요청을 처리하고 있습니다'}).waitFor()
  assert.equal(await status.getByRole('button',{name:'처리 결과 확인 중…',exact:true}).isDisabled(),true)
  await page.evaluate(()=>window.flow.releaseRender());await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).waitFor();assert.equal(await status.count(),0)
  assert.equal((await matches()).uploads.length,0);assert.equal((await matches()).snapshot.submissions.length,0)
 })
 await test('가상 교사 2명의 실제 생성 HWPX를 명시 확인·검사·초안 저장·최종 제출하고 담당자가 전체 ZIP으로 원본을 받는다',async()=>{
  const names=[]
  for(let i=0;i<2;i++){
   if(i)await login('gaon-seojin');await savedAndGenerated(i);names.push(await downloadGenerated(i));if(!i)await page.screenshot({path:join(output,'teacher-generated-hwpx.png'),fullPage:true});await handoff(i);await attach(i);assert.equal((await matches()).uploads[i].name,names[i]);await saveAndSubmit();if(!i)await page.screenshot({path:join(output,'teacher-final-submission.png'),fullPage:true})
  }
  const state=await matches();assert.equal(state.snapshot.submissions.length,2);assert.ok(state.snapshot.submissions.every(s=>s.files.length===1));assert.ok(state.snapshot.units.filter(u=>u.currentSubmissionId).every(u=>u.requestId===state.snapshot.requests.find(r=>r.title==='학급 운영 자료 최종 수합').id));assert.equal(state.applied.filter(x=>x.kind==='submit').length,2)
  await login('gaon-minjun');await go('문서 수합');await page.getByRole('button',{name:/학급 운영 자료 최종 수합/}).click();await page.getByText('제출 파일 모아 받기',{exact:true}).click();await page.getByRole('button',{name:'최신 현황으로 묶음 준비',exact:true}).click();await page.getByRole('button',{name:'ZIP 내려받기',exact:true}).and(page.locator(':enabled')).waitFor()
  await page.setViewportSize({width:320,height:760});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:join(output,'manager-zip-320.png'),fullPage:true})
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:'ZIP 내려받기',exact:true}).focus();await page.keyboard.press('Enter');const zip=await wait,entries=unzipSync(readFileSync(await zip.path())),hwpx=Object.entries(entries).filter(([name])=>name.endsWith('.hwpx')),csv=Object.entries(entries).find(([name])=>name.endsWith('.csv'))
  assert.equal(hwpx.length,2);assert.ok(csv);assert.equal(new Set(hwpx.map(([name])=>name)).size,2);assert.deepEqual(hwpx.map(([,b])=>digest(b)).sort(),seed.documents.map(d=>d.file.sha256).sort())
  const content=new TextDecoder().decode(csv[1]);for(const d of seed.documents){assert.ok(content.includes(d.name));assert.ok(content.includes(d.classLabel))}
  const inspected=py(['--inspect-stdin'],JSON.stringify(hwpx.map(([,b])=>Buffer.from(b).toString('base64'))));assert.deepEqual(inspected.map(d=>d.sha256).sort(),seed.documents.map(d=>d.file.sha256).sort());for(const d of seed.documents)assert.ok(inspected.some(x=>Object.values(d.answers).every(answer=>x.paragraphs.includes(answer))))
  writeFileSync(join(output,'completed-collection.zip'),readFileSync(await zip.path()));writeFileSync(join(output,'zip-verified.json'),JSON.stringify({entries:Object.keys(entries),inspected},null,2))
 })
 await test('답변 저장·제출 초안·최종 제출 응답 유실은 재진입 후 원래 키와 내용으로 복구하고 중복 제출하지 않는다',async()=>{
  await openQuestions();await page.evaluate(()=>window.flow.unknownGuided=true);await page.getByRole('button',{name:'답변 임시 저장',exact:true}).click();await page.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).waitFor();await page.getByRole('button',{name:'입력 보관하고 접기',exact:true}).click();await go('오늘');await go('문서함');await page.getByRole('button',{name:'보관한 양식 입력 계속하기',exact:true}).click();await page.getByRole('button',{name:'같은 양식 요청 다시 확인',exact:true}).click();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).and(page.locator(':enabled')).waitFor();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).click();await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).waitFor();await downloadGenerated();await handoff();await attach()
  await page.evaluate(()=>{window.flow.unknownKind='save_draft';window.flow.holdCollection=true});await page.getByRole('button',{name:'제출 초안 저장',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseCollection==='function')
  const waiting=page.getByRole('region',{name:'수합 저장 결과 확인',exact:true});await waiting.getByRole('status').filter({hasText:'수합 요청을 처리하고 있습니다'}).waitFor();assert.equal(await waiting.getByRole('button',{name:'처리 결과 확인 중…',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).count(),0)
  await page.evaluate(()=>window.flow.releaseCollection());await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).and(page.locator(':enabled')).waitFor();await page.getByRole('button',{name:'입력 보관하고 다른 메뉴 이용',exact:true}).click();await go('오늘');await go('문서 수합');await page.getByRole('button',{name:'보관한 입력과 요청 다시 열기',exact:true}).click();await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click();await page.getByRole('button',{name:'저장한 파일 최종 제출',exact:true}).and(page.locator(':enabled')).waitFor()
  await page.evaluate(()=>window.flow.unknownKind='submit');await page.getByRole('button',{name:'저장한 파일 최종 제출',exact:true}).click();await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).waitFor();await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click();await page.getByText(/최종 제출을 접수했습니다/).waitFor()
  const value=await matches();assert.equal(value.snapshot.submissions.length,1);assert.equal(value.snapshot.drafts.length,1);assert.equal(value.uploads.length,1)
  for(const kind of ['save_draft','submit']){const calls=value.calls.filter(c=>c.name==='workhub_collection_mutate'&&c.args.p_command.kind===kind);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(value.applied.filter(c=>c.kind===kind).length,1)}
  const writes=value.calls.filter(c=>['workhub_template_mutate','workhub_template_request_get'].includes(c.name));assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args);assert.equal(value.applied.filter(c=>c.kind==='save_answers').length,1)
 })
 await test('생성 파일을 읽는 동안 원본 해시가 바뀌면 확인과 수합 전달을 허용하지 않는다',async()=>{
  await savedAndGenerated();await page.evaluate(()=>window.flow.holdDownload=true);await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseDownload==='function');await page.evaluate(()=>{window.flow.changedAccess=true;window.flow.releaseDownload()});await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).and(page.locator(':enabled')).waitFor();assert.equal(await review().isDisabled(),true);assert.equal(await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기',exact:true}).isDisabled(),true);assert.equal((await matches()).uploads.length,0);assert.equal((await matches()).snapshot.submissions.length,0)
 })
 await test('늦은 생성물 내려받기 중 다른 학교 계정으로 바뀌면 기존 파일과 전달 초안을 노출하지 않는다',async()=>{
  await savedAndGenerated();await page.evaluate(()=>window.flow.holdDownload=true);await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseDownload==='function');await login('nuri-harin');await page.evaluate(()=>window.flow.releaseDownload());await go('문서함');await page.getByRole('button',{name:'질문형 수합 양식',exact:true}).click();await page.getByRole('heading',{name:'질문으로 채우는 HWPX',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/학교자료학교자료/}).count(),0);await go('문서 수합');await page.getByText('현재 볼 수 있는 수합이 없습니다.',{exact:true}).waitFor();assert.equal((await matches()).uploads.length,0);assert.equal((await matches()).snapshot.submissions.length,0)
 })
 await test('생성물 내려받기 응답이 끝나지 않아도 제한시간 뒤 잠금을 풀고 늦은 원본을 버린 뒤 다시 확인할 수 있다',async()=>{
  await savedAndGenerated();let downloads=0;const count=()=>downloads++;page.on('download',count)
  try{await page.evaluate(()=>window.flow.holdDownload=true);await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseDownload==='function');await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).and(page.locator(':enabled')).waitFor();assert.equal(await review().isDisabled(),true);assert.equal(downloads,0);await go('오늘');await page.evaluate(()=>window.flow.releaseDownload());await go('문서함');await page.getByRole('button',{name:/학교자료학교자료/}).click();await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).waitFor();assert.equal(await review().isDisabled(),true);assert.equal(downloads,0);await downloadGenerated();assert.equal(downloads,1);assert.equal((await matches()).uploads.length,0)}finally{page.off('download',count)}
 })
 await test('수합에서 돌아오면 원래 양식을 다시 조회해 저장 답변·생성 파일을 열고 확인 체크는 다시 받는다',async()=>{
  await savedAndGenerated();await downloadGenerated();await handoff();assert.equal(await page.getByRole('button',{name:'문서함으로 돌아가기',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'작성 닫기',exact:true}).click();const before=(await matches()).calls.filter(c=>c.name==='workhub_template_get').length
  await page.evaluate(()=>window.flow.template.title='수합에서 돌아온 원래 양식');await page.getByRole('button',{name:'문서함으로 돌아가기',exact:true}).click();await page.getByRole('heading',{name:'수합에서 돌아온 원래 양식 · v2',exact:true}).waitFor()
  for(const q of seed.mapping.questions)assert.equal(await page.getByLabel(q.label+' (필수)',{exact:true}).inputValue(),seed.documents[0].answers[q.id])
  assert.equal(await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).count(),1);assert.equal(await review().isDisabled(),true);assert.equal(await review().isChecked(),false);assert.equal((await matches()).uploads.length,0)
  const reads=(await matches()).calls.filter(c=>c.name==='workhub_template_get');assert.ok(reads.length>before);assert.equal(reads.at(-1).args.p_template_id,'guided-real-hwpx')
 })
 await test('저장 완료 후 재진입은 최신 답변판을 읽고 옛 생성물 대신 새 상태를 보여 준다',async()=>{
  await savedAndGenerated();await go('오늘');await page.evaluate(()=>window.flow.changeSavedAnswer('다른 화면에서 고친 최신 답변'));await go('문서함');await page.getByLabel('확인 내용 (필수)',{exact:true}).waitFor();assert.equal(await page.getByLabel('확인 내용 (필수)',{exact:true}).inputValue(),'다른 화면에서 고친 최신 답변');assert.equal(await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'답변 임시 저장',exact:true}).isDisabled(),true);assert.equal((await matches()).applied.filter(x=>x.kind==='save_answers').length,1)
 })
 await test('복귀 원본 조회 실패는 저장 답변을 노출하지 않고 같은 양식 번호로 다시 확인한다',async()=>{
  await savedAndGenerated();await go('오늘');await page.evaluate(()=>window.flow.getError='QUERY_FAILED');await go('문서함');await page.getByRole('button',{name:'이전 양식 다시 확인',exact:true}).waitFor();assert.equal(await page.getByLabel('확인 내용 (필수)',{exact:true}).count(),0);assert.equal(await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).count(),0)
  await page.evaluate(()=>window.flow.getError='');await page.getByRole('button',{name:'이전 양식 다시 확인',exact:true}).click();await page.getByLabel('확인 내용 (필수)',{exact:true}).waitFor();assert.equal(await page.getByLabel('확인 내용 (필수)',{exact:true}).inputValue(),seed.documents[0].answers.note);assert.equal(await review().isDisabled(),true)
  assert.ok((await matches()).calls.filter(c=>c.name==='workhub_template_get').every(c=>c.args.p_template_id==='guided-real-hwpx'))
 })
 await test('사라진 양식의 복귀 번호를 지워 다음 재진입에서 반복 조회하지 않는다',async()=>{
  await savedAndGenerated();await go('오늘');await page.evaluate(()=>window.flow.getError='NOT_FOUND');await go('문서함');await page.getByRole('region',{name:'이전 양식 다시 열기',exact:true}).waitFor();assert.equal(await page.getByLabel('확인 내용 (필수)',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'이전 양식 다시 확인',exact:true}).count(),0)
  const before=(await matches()).calls.filter(c=>c.name==='workhub_template_get').length;await go('오늘');await go('문서함');await page.getByRole('button',{name:/학교자료학교자료/}).waitFor();assert.equal((await matches()).calls.filter(c=>c.name==='workhub_template_get').length,before)
 })
 await test('복귀 조회 도중 다른 학교로 바뀌면 늦은 답변·생성물·선택 번호를 다시 열지 않는다',async()=>{
  await savedAndGenerated();await go('오늘');await page.evaluate(()=>window.flow.holdGet=true);await go('문서함');await page.waitForFunction(()=>typeof window.flow.releaseGet==='function');await login('nuri-harin');await page.evaluate(()=>window.flow.releaseGet());await go('문서함');await page.getByRole('button',{name:'질문형 수합 양식',exact:true}).click();await page.getByText('사용할 수 있는 질문형 양식이 없습니다.',{exact:true}).waitFor();assert.equal(await page.getByLabel('확인 내용 (필수)',{exact:true}).count(),0);assert.equal(await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).count(),0);assert.equal(await page.getByRole('region',{name:'이전 양식 다시 열기',exact:true}).count(),0)
 })
 writeFileSync(join(output,'results.json'),JSON.stringify({passed,errors,external,limits:'실제 React·전송 어댑터·파서 / 합성 HTTP·RPC·Storage / 실제 Python HWPX 생성·검사·ZIP 원문 대조'},null,2));console.log(`\n문서 생성→수합 전체 흐름 ${passed.length}/${passed.length} 통과 · ${output}`)
}finally{await context.close();await browser.close()}
