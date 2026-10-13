// 생성된 단일 HTML을 Chrome file://로 직접 열어 검사한다. HTTP 서버는 사용하지 않는다.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const root=fileURLToPath(new URL('../../',import.meta.url))
const path=resolve(process.argv[2]||process.env.WORKHUB_OFFLINE_FILE||resolve(root,'dist/workhub-preview.html'))
const html=readFileSync(path,'utf8')
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000}})
const page=await context.newPage(),errors=[],network=[],results=[]
page.setDefaultTimeout(10000)
page.on('pageerror',error=>errors.push(error.message))
page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
context.on('request',request=>{if(/^https?:/i.test(request.url()))network.push(request.url())})
await context.route(/^https?:/i,route=>route.abort())
const output=process.env.WORKHUB_QA_OUTPUT
if(output)mkdirSync(output,{recursive:true})
const base=pathToFileURL(path).href
async function test(name,action){await action();results.push(name);console.log('  ✓ '+name)}
async function menu(name){const nav=page.getByRole('navigation',{name:'업무 메뉴'}),button=nav.getByRole('button',{name,exact:true});if(!await button.isVisible())await nav.getByRole('button',{name:'더보기',exact:true}).click();await button.click()}
async function heading(name){await page.getByRole('heading',{name,exact:true,level:1}).waitFor()}
async function settle(){await page.waitForFunction(()=>!document.querySelector('.loading-state,.task-loading'))}
try{
  await test('단일 파일에 일반·인라인 CSS를 담고 운영 연결 코드를 포함하지 않는다',async()=>{
    assert.match(html,/10차 개발 · 목록 성능/)
    for(const value of ['.ws-shell','.task-panel','.wf-','.students-panel','.cv-month','.ws-search-dialog'])assert(html.includes(value),value)
    for(const value of ['workhub_calendar_list','workhub_task_save','createSupabaseConnection'])assert(!html.includes(value),value)
    assert.match(html,/connect-src 'none'/)
    await page.goto(base);await page.getByRole('heading',{name:'오늘 챙길 내 업무',exact:true}).waitFor();await settle()
    assert.equal(await page.locator('.ws-frame').evaluate(node=>getComputedStyle(node).display),'grid')
    assert.match(await page.locator('.ws-mode-banner').innerText(),/합성 자료/)
    assert.equal(new URL(page.url()).protocol,'file:')
  })
  await test('file 주소의 view 선택·직접 진입·새로고침이 동작한다',async()=>{
    await menu('내 업무');await heading('내 업무');assert.equal(new URL(page.url()).searchParams.get('view'),'tasks')
    await page.reload();await heading('내 업무')
    await page.goto(base+'?view=collections&keep=offline#preview');await heading('자료 수합')
    assert.equal(new URL(page.url()).searchParams.get('keep'),'offline');assert.equal(new URL(page.url()).hash,'#preview')
  })
  await test('file 주소에서 뒤로·앞으로 가기를 통해 이전 화면으로 복원한다',async()=>{
    await menu('학교 일정');await heading('학교 일정');await menu('내 업무');await heading('내 업무')
    await page.goBack();await heading('학교 일정');await page.goForward();await heading('내 업무')
  })
  await test('합성 할 일을 작성하고 파일 새로고침 후 복원·완료·재개한다',async()=>{
    assert.match(await page.locator('.ws-mode-banner').innerText(),/이 브라우저에 저장/)
    await page.getByRole('button',{name:'할 일 등록',exact:true}).click();await page.getByLabel('해야 할 일',{exact:true}).fill('오프라인 합성 할 일')
    await page.getByLabel('나만 보는 메모',{exact:true}).fill('실제 학교·학생 자료를 넣지 않은 시험')
    await page.getByRole('button',{name:'내 업무에 추가',exact:true}).click();await page.getByRole('article',{name:'오프라인 합성 할 일',exact:true}).waitFor()
    await page.reload();await heading('내 업무');const row=page.getByRole('article',{name:'오프라인 합성 할 일',exact:true});await row.waitFor()
    await row.getByRole('button',{name:'완료',exact:true}).click();await row.waitFor({state:'detached'});await page.getByLabel('상태',{exact:true}).selectOption('done');await row.waitFor()
    await row.getByRole('button',{name:'다시 시작',exact:true}).click();await page.getByLabel('상태',{exact:true}).selectOption('open');await row.waitFor()
  })
  await test('오프라인에서도 편집 중 뒤로 가기와 내부 CTA가 초안을 보존한다',async()=>{
    await menu('오늘');await page.getByRole('heading',{name:'오늘 챙길 내 업무',exact:true}).waitFor();await settle()
    await page.getByRole('button',{name:'할 일 등록',exact:true}).click();await page.getByLabel('해야 할 일',{exact:true}).fill('파일에서도 보존되는 초안')
    const before=page.url();await page.getByRole('button',{name:'학교 전체 일정 살펴보기'}).click();assert.equal(page.url(),before)
    await page.goBack();await page.waitForURL(before);assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'파일에서도 보존되는 초안')
    await page.getByRole('button',{name:'편집 취소',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.ws-menu-button')].every(button=>!button.disabled))
  })
  await test('수합과 학생 일반 CSS·일정 인라인 CSS가 실제로 적용된다',async()=>{
    assert.equal(await page.locator('.wf-home').evaluate(node=>getComputedStyle(node).borderTopWidth),'1px')
    assert.equal(await page.locator('.wf-home').evaluate(node=>getComputedStyle(node).borderRadius),'13px')
    await menu('자료 수합');await heading('자료 수합');assert.equal(await page.locator('.wf-panel').evaluate(node=>getComputedStyle(node).color),'rgb(36, 68, 63)')
    await menu('수업과 학생');await heading('수업과 학생');assert.equal(await page.locator('.students-layout').evaluate(node=>getComputedStyle(node).display),'grid')
    await menu('학교 일정');await heading('학교 일정');await settle();await page.getByRole('button',{name:'월',exact:true}).click();assert.equal(await page.locator('.cv-month-grid').evaluate(node=>getComputedStyle(node).display),'grid')
  })
  await test('360px 더보기와 다섯 화면에서 메뉴 접근·레이아웃이 유지된다',async()=>{
    await page.setViewportSize({width:360,height:800})
    for(const name of ['오늘','학교 일정','내 업무','자료 수합','수업과 학생']){await menu(name);await settle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name);assert.equal(await page.getByRole('navigation',{name:'현재 위치'}).locator('strong').textContent(),name);if(output)await page.screenshot({path:join(output,`offline-mobile-${name}.png`),fullPage:true})}
    await page.setViewportSize({width:1440,height:1000});await menu('오늘');await settle();if(output)await page.screenshot({path:join(output,'offline-desktop-home.png'),fullPage:true})
  })
  await test('외부 HTTP 요청과 예상하지 않은 브라우저 오류가 없다',async()=>{assert.deepEqual(network,[]);assert.deepEqual(errors,[])})
  console.log(`오프라인 단일 HTML ${results.length}개 통과`)
  if(output)writeFileSync(join(output,'offline-browser-results.json'),JSON.stringify({file:path,results,externalRequestCount:network.length,errors},null,2))
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-3500));if(output)await page.screenshot({path:join(output,'offline-failure.png'),fullPage:true});process.exitCode=1}
finally{await context.close();await browser.close()}
