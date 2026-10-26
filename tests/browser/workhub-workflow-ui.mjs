// 실제 React 입력 화면과 합성 전송으로 배치·입력 보존·명시적 저장 경계를 함께 확인한다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchBrowser } from './launch-browser.mjs'
import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
async function bundle(collection = false) {
  return (await build({entryPoints:[join(root, `tests/browser/workhub-${collection ? 'collection-create' : 'cross-module'}-fixture.tsx`)], bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}),'process.env.NODE_ENV':'"development"'},logLevel:'silent',plugins:[{name:'workflow-ui',setup(builder){
    builder.onLoad({filter:/assistant[\\/]legacy-http\.ts$/},()=>({contents:'export const legacyAssistantHttp={send:payload=>window.cross.assistantHttp(payload)};export const legacySchoolAiHttp={send:async()=>{throw Error("no live service")}};export const legacySchoolAiOperationsHttp=legacySchoolAiHttp;',loader:'ts'}))
    if(!collection) builder.onLoad({filter:/workhub-cross-module-fixture\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace("if(name==='workhub_task_list')", "if(name==='workhub_task_mutate'){if(args.p_command.kind!=='create')throw Error('unexpected synthetic task command');return tasks.createTask(member.id,args.p_command.input,args.p_request_key)}\n if(name==='workhub_task_list')"),loader:'tsx'}))
    if(collection) builder.onLoad({filter:/workhub-collection-create-fixture\.tsx$/},args=>{
      let contents=readFileSync(args.path,'utf8')
      contents="import {WorkspaceShell} from '../../apps/workhub/src/app/WorkspaceShell';\n"+contents
      contents=contents.replace('return visible && <CollectionServerPanel', 'return visible && <WorkspaceShell page="collections" mode="connected" schoolName="가온중학교 · 합성 자료" memberName="김담당" onNavigate={()=>{}}><main className="main-content"><header className="page-header"><h1>자료 수합</h1></header><CollectionServerPanel')
      contents=contents.replace('date="2026-10-22" revision={revision} />','date="2026-10-22" revision={revision} /></main></WorkspaceShell>')
      return {contents,loader:'tsx'}
    })
  }}]})).outputFiles[0].text
}
const [app, collection] = await Promise.all([bundle(), bundle(true)])
const output=process.env.WORKHUB_QA_OUTPUT||mkdtempSync(join(tmpdir(),'workhub-workflow-ui-'))
mkdirSync(output,{recursive:true})
const browser=await launchBrowser(), context=await browser.newContext({viewport:{width:1440,height:1100}}), page=await context.newPage()
const results=[], errors=[], external=[]
page.setDefaultTimeout(12000); page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss())
await context.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(url.origin!=='http://127.0.0.1:5187'){external.push(url.href);return route.abort()}
  const match=url.pathname.match(/(PretendardVariable|TossFaceFontMac-0[789])\.woff2$/)
  if(match)return route.fulfill({contentType:'font/woff2',body:readFileSync(join(root,'apps/workhub/src/assets/fonts',match[1].startsWith('Toss')?'tossface':'',match[0]))})
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>'})
})
const button=name=>page.getByRole('button',{name,exact:true})
async function start(isCollection=false,theme='light',textSize='standard'){
  await page.goto('http://127.0.0.1:5187/workflow')
  await page.evaluate(({theme,textSize})=>{localStorage.setItem('workhub:appearance:v1',JSON.stringify({theme,textSize,density:'comfortable'}));window.showcase=true},{theme,textSize})
  await page.addStyleTag({content:readFileSync(join(root,'apps/workhub/src/typography.css'),'utf8')+readFileSync(join(root,'apps/workhub/src/assets/fonts/tossface/tossface.css'),'utf8')})
  await page.addScriptTag({content:isCollection?collection:app})
  await page.getByRole('heading',{name:isCollection?'자료 수합':'오늘',level:1,exact:true}).waitFor()
  await page.evaluate(async()=>{await document.fonts.load('24px Tossface','🏠📋💬');await document.fonts.ready})
}
async function shot(name){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,name+'.png'),fullPage:true})}
async function fits(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'가로 넘침 없음')}
async function check(name,fn){await fn();results.push(name);console.log('  ✓ '+name)}
async function collectionForm(){
  await button('새 수합 만들기').click()
  await page.getByLabel('수합 제목',{exact:true}).fill('1학기 학급 운영계획 수합')
  await page.getByLabel('제출 기한',{exact:true}).fill('2026-10-31')
  await page.getByLabel('안내 내용',{exact:true}).fill('양식을 내려받아 작성한 뒤 HWPX로 제출해 주세요.')
}
try{
  await check('메시지 두 열 입력·소속 상세·화면 크기 변경은 내용을 보존하고 확인 전 전송하지 않는다',async()=>{
    await start();await clickWorkspaceMenu(page,'메시지와 알림');await button('새 메시지').click()
    await page.getByLabel('이민준 · 교무부',{exact:true}).check()
    await page.getByLabel('메시지',{exact:true}).fill('선생님, 다음 주 학년 협의회 자료를 확인해 주세요.\n검토 의견은 금요일까지 부탁드립니다.')
    const from=await page.locator('.messaging-to').boundingBox(), body=await page.locator('.messaging-compose-content').boundingBox()
    assert(body.x>from.x+from.width-1,'데스크톱 받는 사람과 본문 나란히')
    await page.locator('.messaging-person-id summary').click()
    assert(await page.getByText('소속 번호: gaon-minjun',{exact:true}).isVisible())
    await page.locator('.messaging-person-id summary').click()
    await shot('01-message-desktop');await fits()
    await page.setViewportSize({width:390,height:844});await fits()
    assert.equal(await page.getByLabel('이민준 · 교무부',{exact:true}).isChecked(),true)
    assert.match(await page.getByLabel('메시지',{exact:true}).inputValue(),/검토 의견/)
    await shot('02-message-mobile')
    await button('받는 사람과 내용 확인').click()
    await page.getByRole('region',{name:'보내기 전 확인',exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.cross.writes),[])
    await button('내용 수정').click()
    assert.match(await page.getByLabel('메시지',{exact:true}).inputValue(),/금요일/)
  })
  await check('업무 제목·기한·메모가 같은 편집기에서 저장되고 원래 명령 내용과 일치한다',async()=>{
    await page.setViewportSize({width:1440,height:1100});await start();await clickWorkspaceMenu(page,'내 업무');await button('할 일 등록').click()
    await page.getByLabel('해야 할 일',{exact:true}).fill('다음 주 학년 협의회 자료 준비')
    await page.getByLabel('기한 (선택)',{exact:true}).fill('2026-10-30')
    await page.getByLabel('나만 보는 메모',{exact:true}).fill('학급별 의견을 모아서 공유 자료에 정리하기')
    await shot('03-task-desktop');await fits()
    await page.setViewportSize({width:390,height:844});await fits();await shot('04-task-mobile')
    assert.deepEqual(await page.evaluate(()=>window.cross.writes),[])
    await button('내 업무에 추가').click();await page.getByRole('form',{name:'내 업무 등록',exact:true}).waitFor({state:'hidden'})
    const writes=await page.evaluate(()=>window.cross.writes)
    assert.equal(writes.length,1);assert.match(JSON.stringify(writes[0]),/다음 주 학년 협의회 자료 준비/);assert.match(JSON.stringify(writes[0]),/학급별 의견/)
  })
  await check('수합 대상 검색으로 선택이 사라지지 않고 양식 선택은 초안 저장 전 서버에 쓰지 않는다',async()=>{
    await page.setViewportSize({width:1440,height:1100});await start(true);await collectionForm()
    await page.getByRole('checkbox',{name:'김담당',exact:true}).check()
    await page.getByRole('searchbox',{name:'교사 찾기',exact:true}).fill('이교사')
    await page.getByRole('checkbox',{name:'이교사',exact:true}).check()
    await page.getByRole('searchbox',{name:'교사 찾기',exact:true}).fill('없는 교사')
    await page.getByRole('status').filter({hasText:'선택한 제출 대상은 아래에 유지됩니다'}).waitFor()
    assert.equal(await page.locator('.cs-unit-settings').count(),2)
    await page.getByRole('searchbox',{name:'교사 찾기',exact:true}).fill('')
    assert.equal(await page.getByRole('checkbox',{name:'김담당',exact:true}).isChecked(),true)
    await page.getByLabel('양식 파일 선택',{exact:true}).setInputFiles({name:'학급운영계획_양식.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from('PK synthetic HWPX')})
    assert.deepEqual(await page.evaluate(()=>window.calls),[]);assert.deepEqual(await page.evaluate(()=>window.fileCalls),[])
    await shot('05-collection-desktop');await fits()
    await page.setViewportSize({width:390,height:844});await fits();await shot('06-collection-mobile')
    await button('수합 초안 저장').click();await button('대상 교사에게 공개').waitFor()
    const request=await page.evaluate(()=>window.request)
    assert.equal(request.status,'draft');assert.equal(request.units.length,2);assert.equal(request.fileCollection.templates[0].name,'학급운영계획_양식.hwpx')
    assert.equal(await page.evaluate(()=>window.calls.some(call=>['publish','submit'].includes(call.command.kind))),false)
  })
  await check('설정이 있는 수합 초안을 다시 열면 글·숫자 질문을 접어 숨기지 않는다',async()=>{
    await page.setViewportSize({width:1440,height:1100});await start(true);await collectionForm();await page.getByRole('checkbox',{name:'김담당',exact:true}).check()
    await page.getByText('함께 받을 답변 · 글과 숫자',{exact:true}).click()
    await page.getByLabel('글 응답 질문',{exact:true}).fill('확인할 내용')
    await button('수합 초안 저장').click();await button('대상 교사에게 공개').waitFor()
    await button('양식 추가·초안 수정').click()
    assert(await page.getByLabel('글 응답 질문',{exact:true}).isVisible())
    assert.equal(await page.getByLabel('글 응답 질문',{exact:true}).inputValue(),'확인할 내용')
    assert.equal(await page.evaluate(()=>window.request.status),'draft')
  })
  await check('큰 글씨·어두운 화면·320px에서도 세 입력 화면의 버튼과 입력란이 잘리지 않는다',async()=>{
    await page.setViewportSize({width:320,height:800})
    for(const screen of ['task','message','collection']){
      await start(screen==='collection','dark','large')
      if(screen==='collection')await collectionForm()
      else if(screen==='task'){await clickWorkspaceMenu(page,'내 업무');await button('할 일 등록').click()}
      else{await clickWorkspaceMenu(page,'메시지와 알림');await button('새 메시지').click()}
      await fits()
      assert.equal(await page.locator('.ws-shell').getAttribute('data-text-size'),'large')
      assert(await page.locator('.wh-composer').isVisible())
      for(const control of await page.locator('.wh-composer').locator('input:not([type=checkbox]):not([type=file]),textarea,button').all()){
        if(!await control.isVisible())continue
        const box=await control.boundingBox();assert(box.x>=0&&box.x+box.width<=321,screen+' 조작 요소 가로 범위')
      }
    }
    await shot('07-collection-dark-large')
  })
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  writeFileSync(join(output,'results.json'),JSON.stringify({passed:results.length,results,errors,external},null,2)+'\n')
  console.log(`입력 화면 통합 브라우저 ${results.length}건 통과 · ${output}`)
}catch(error){await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error}
finally{await browser.close()}
