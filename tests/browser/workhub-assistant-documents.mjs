// 실제 화면·전송 어댑터·파서를 사용한다. HTTP/RPC/Storage는 loopback 합성이며 파일 생성·최소 검사·ZIP 내용 대조는 실제 코드다.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {clickWorkspaceMenu} from '../helpers/workspace-menu.mjs'
import {launchBrowser} from './launch-browser.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url)),helper=fileURLToPath(new URL('../helpers/document-collection-fixture.py',import.meta.url))
const python=process.env.WORKHUB_TEST_PYTHON??process.env.PYTHON??'python'
function py(args,input){const r=spawnSync(python,[helper,...args],{cwd:root,encoding:'utf8',input,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},maxBuffer:12*1024*1024});assert.equal(r.status,0,r.stderr||r.error?.message);return JSON.parse(r.stdout)}
const seed=py(['--count','2']),digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const guidedPath=fileURLToPath(new URL('../../apps/workhub/src/documents/guided-adapter.ts',import.meta.url)).replaceAll('\\','/')
const bundle=await build({entryPoints:[fileURLToPath(new URL('./workhub-assistant-documents-fixture.tsx',import.meta.url))],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},plugins:[{name:'synthetic-session-storage',setup(b){
 b.onResolve({filter:/^@daedong\/shared$/},()=>({path:'synthetic-shared',namespace:'flow'}))
 b.onLoad({filter:/.*/,namespace:'flow'},()=>({contents:`export const getSession=()=>window.flow.session();export const supabase={storage:{from:bucket=>({upload:(path,file)=>window.flow.storage.upload(bucket,path,file),download:path=>window.flow.storage.download(bucket,path)})}};export const fetchMyProfile=async()=>null;export const onAuthStateChange=()=>()=>{};export const signInWithGoogle=async()=>{throw Error('합성 외부 로그인 금지')};export const signOut=async()=>{};`,loader:'js'}))
 // 제품 서비스의 공개 timeout 옵션만 짧게 주입한다. HTTP·권한 대조·파일 해시 코드는 그대로 실행한다.
 b.onResolve({filter:/^\.\/guided-adapter$/},a=>a.importer.endsWith('useGuidedEditor.ts')?{path:'guided-deadline',namespace:'flow-timeout'}:undefined)
 b.onLoad({filter:/.*/,namespace:'flow-timeout'},()=>({contents:`export * from ${JSON.stringify(guidedPath)};import{createGuidedService as factory}from ${JSON.stringify(guidedPath)};export const createGuidedService=(c,p)=>factory(c,p,{timeoutMs:1500});`,loader:'ts',resolveDir:root}))
}}],define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const output=process.env.WORKHUB_QA_OUTPUT??mkdtempSync(join(tmpdir(),'workhub-assistant-documents-'));mkdirSync(output,{recursive:true})
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
const review=()=>page.getByLabel('파일을 열어 내용과 칸 배치를 확인했습니다',{exact:true})
const state=()=>page.evaluate(()=>({calls:window.flow.calls,http:window.flow.http,uploads:window.flow.uploads,applied:window.flow.applied,aiCalls:window.flow.aiCalls,snapshot:window.flow.snapshot()}))
async function openPane(){
 await clickWorkspaceMenu(page,'문서함');await page.getByRole('button',{name:'질문형 수합 양식',exact:true}).click();await page.getByRole('button',{name:/학교자료학교자료/}).click()
 for(const q of seed.mapping.questions)await page.getByLabel(q.label+' (필수)',{exact:true}).fill(seed.documents[0].answers[q.id])
 await page.getByRole('button',{name:'답변 작성 도움 받기',exact:true}).click();await page.getByRole('button',{name:'전달받은 요청 사용',exact:true}).click();await page.getByRole('button',{name:'AI에게 요청',exact:true}).click()
 await page.getByRole('button',{name:'이 초안을 작성 화면으로 보내기',exact:true}).click();await page.locator('.assistant-delivery-work div.documents-assistant-pane').waitFor()
 await page.getByRole('button',{name:'제안 닫고 답변 계속 작성',exact:true}).and(page.locator(':enabled')).waitFor();await page.getByRole('button',{name:'제안 닫고 답변 계속 작성',exact:true}).click()
 for(const q of seed.mapping.questions)assert.equal(await page.getByLabel(q.label+' (필수)',{exact:true}).inputValue(),seed.documents[0].answers[q.id])
 assert.equal((await state()).applied.length,0)
}
async function generate(){
 await page.getByRole('button',{name:'답변 임시 저장',exact:true}).click();await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).and(page.locator(':enabled')).waitFor()
 await page.getByRole('button',{name:'저장한 답변으로 HWPX 생성',exact:true}).click();await page.getByRole('region',{name:'생성한 HWPX 확인',exact:true}).waitFor()
 assert.equal(await review().isDisabled(),true);assert.equal(await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기',exact:true}).isDisabled(),true)
}
async function download(){
 const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).click();const file=await waiting
 assert.equal(digest(readFileSync(await file.path())),seed.documents[0].file.sha256)
 return file.suggestedFilename()
}
async function transfer(){
 await review().check();await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기',exact:true}).click()
 await page.getByRole('heading',{name:'수합 작성·제출',exact:true}).waitFor();await page.getByRole('region',{name:'수합 상세',exact:true}).waitFor()
 const detail=page.getByRole('region',{name:'수합 상세',exact:true});assert.match(await detail.innerText(),/학급 운영 자료 최종 수합/);assert.doesNotMatch(await detail.innerText(),/목록 첫 번째의 다른 수합/)
 assert.equal((await state()).uploads.length,0);assert.equal((await state()).snapshot.submissions.length,0)
 await page.getByRole('button',{name:'내 제출 파일 작성',exact:true}).click();await page.getByRole('form',{name:'제출 파일 작성',exact:true}).waitFor()
 await page.getByRole('button',{name:'문서함에서 만든 HWPX 첨부',exact:true}).click();await page.getByText(/파일 준비가 완료되었습니다/).waitFor()
 assert.equal((await state()).uploads.length,1);assert.equal((await state()).uploads[0].sha256,seed.documents[0].file.sha256)
}
async function test(name,run){
 await page.goto('http://127.0.0.1:5188/assistant-documents');await page.addStyleTag({content:fontCss});await page.evaluate(seed=>window.flowSeed=seed,seed);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.locator('.ws-primary-menus').getByRole('button',{name:'홈',exact:true}).waitFor()
 try{await run();assert.deepEqual(errors,[]);assert.deepEqual(external,[])}catch(error){console.error((await page.getByRole('main').allInnerTexts()).join('\n').slice(-12000));console.error(await state());await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error}
 passed.push(name);console.log('  ✓ '+name)
}
try{
 await test('대화 안에서 원래 양식 답변→저장→실제 HWPX→명시 확인→같은 수합 최종 제출을 한 번씩 처리한다',async()=>{
  await openPane();await generate();await download();await transfer()
  assert.equal((await state()).snapshot.drafts.length,0);assert.equal((await state()).snapshot.submissions.length,0)
  await page.getByRole('button',{name:'제출 초안 저장',exact:true}).click();await page.getByRole('button',{name:'최종 제출 내용 확인',exact:true}).and(page.locator(':enabled')).waitFor()
  assert.equal((await state()).snapshot.submissions.length,0)
  await page.getByRole('button',{name:'최종 제출 내용 확인',exact:true}).click();await page.getByRole('region',{name:'대화 수합 최종 제출 확인',exact:true}).waitFor()
  assert.equal((await state()).snapshot.submissions.length,0)
  await page.getByRole('button',{name:'확인한 파일 최종 제출',exact:true}).click();await page.getByText(/최종 제출을 접수했습니다/).waitFor()
  const value=await state();assert.equal(value.uploads.length,1);assert.equal(value.snapshot.submissions.length,1)
  for(const kind of ['save_answers','save_draft','submit'])assert.equal(value.applied.filter(x=>x.kind===kind).length,1)
  assert.equal(value.http.filter(x=>x.path==='/api/workhub-documents/guided').length,1)
  assert.equal(value.http.filter(x=>x.path==='/api/collections/check-hwpx').length,1)
  assert.equal(value.aiCalls.length,1)
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:join(output,'assistant-document-submitted.png'),fullPage:true})
 })
 await test('다운로드·파일 전달 중 대화 전환을 막고 결과 미상 수합 저장은 같은 번호로 복구한다',async()=>{
  await page.setViewportSize({width:1280,height:1000});await openPane();await generate();await page.evaluate(()=>window.flow.holdDownload=true)
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'생성 HWPX 내려받기',exact:true}).click();await page.waitForFunction(()=>typeof window.flow.releaseDownload==='function')
  assert.equal(await page.getByRole('button',{name:'대화 보기',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'확인한 파일을 수합에 첨부하기',exact:true}).isDisabled(),true)
  await page.evaluate(()=>window.flow.releaseDownload());const file=await waiting;assert.equal(digest(readFileSync(await file.path())),seed.documents[0].file.sha256)
  await transfer();await page.evaluate(()=>window.flow.unknownKind='save_draft')
  await page.getByRole('button',{name:'제출 초안 저장',exact:true}).click();await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'대화 보기',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click();await page.getByRole('button',{name:'최종 제출 내용 확인',exact:true}).and(page.locator(':enabled')).waitFor()
  const value=await state(),writes=value.calls.filter(x=>x.name==='workhub_collection_mutate'&&x.args.p_command.kind==='save_draft')
  assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args);assert.equal(value.applied.filter(x=>x.kind==='save_draft').length,1)
  assert.equal(value.uploads.length,1);assert.equal(value.snapshot.submissions.length,0)
 })
 writeFileSync(join(output,'results.json'),JSON.stringify({passed,errors,external,limits:'실제 React·전송 어댑터·파일 해시·Python HWPX 생성 / 합성 AI·HTTP·RPC·Storage'},null,2))
 console.log(`\n대화 안 문서→수합 통합 ${passed.length}/${passed.length} 통과 · ${output}`)
}finally{await context.close();await browser.close()}
