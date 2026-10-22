// 생성된 단일 HTML을 Chrome file://로 직접 열어 검사한다. HTTP 서버는 사용하지 않는다.
import assert from 'node:assert/strict'
import { launchBrowser } from './launch-browser.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
const path=resolve(process.argv[2]||process.env.WORKHUB_OFFLINE_FILE||resolve(root,'dist/workhub-preview.html'))
const html=readFileSync(path,'utf8')
const browser=await launchBrowser()
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
    assert.equal(/<title>(.*?)<\/title>/.exec(html)?.[1], '학교업무혁신시스템 · 개발 미리보기 · 파일형 수합')
    for(const value of ['.ws-shell','.task-panel','.wf-','.students-panel','.cv-month','.ws-search-dialog'])assert(html.includes(value),value)
    for(const value of ['workhub_calendar_list','workhub_task_save','createSupabaseConnection'])assert(!html.includes(value),value)
    assert.match(html,/connect-src 'none'/)
    await page.goto(base);await page.getByRole('heading',{name:'내 할 일',exact:true}).waitFor();await settle()
    assert.equal(await page.locator('.ws-frame').evaluate(node=>getComputedStyle(node).display),'grid')
    assert.match(await page.locator('.ws-mode-banner').innerText(),/합성 자료/)
    assert.equal(new URL(page.url()).protocol,'file:')
  })
  await test('한국어 가변 글꼴과 원문 라이선스를 포함하고 외부 요청 없이 실제 로드한다',async()=>{
    assert.match(html,/font-src data:/)
    assert.match(html,/data:font\/woff2;base64,/)
    const license=readFileSync(resolve(root,'apps/workhub/src/assets/fonts/LICENSE-Pretendard.txt'),'utf8')
    assert(html.replaceAll('\r\n','\n').includes(license.replaceAll('\r\n','\n')),'원문 저작권 표시와 OFL 전문')
    const loaded=await page.evaluate(async()=>{
      const faces=await document.fonts.load('500 16px "Pretendard Variable"','학교 업무 일정 수업 학생 기록')
      return {count:faces.length,status:faces.map(face=>face.status),koreanReady:document.fonts.check('500 16px "Pretendard Variable"','학교 업무 일정 수업 학생 기록'),family:getComputedStyle(document.querySelector('.ws-shell')).fontFamily}
    })
    assert(loaded.count>0,'등록된 Pretendard 글꼴')
    assert(loaded.status.every(status=>status==='loaded'))
    assert.equal(loaded.koreanReady,true)
    assert.match(loaded.family,/Pretendard Variable/)
    assert.deepEqual(network,[])
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
    await menu('오늘');await page.getByRole('heading',{name:'내 할 일',exact:true}).waitFor();await settle()
    await page.getByRole('button',{name:'할 일 등록',exact:true}).click();await page.getByLabel('해야 할 일',{exact:true}).fill('파일에서도 보존되는 초안')
    const before=page.url();await page.getByRole('button',{name:'학교 전체 일정 살펴보기'}).click();assert.equal(page.url(),before)
    await page.goBack();await page.waitForURL(before);assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'파일에서도 보존되는 초안')
    await page.getByRole('button',{name:'편집 취소',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.ws-menu-button')].every(button=>!button.disabled))
  })
  await test('수합과 학생 일반 CSS·일정 인라인 CSS가 실제로 적용된다',async()=>{
    assert.equal(await page.locator('.home-dashboard').evaluate(node=>getComputedStyle(node).display),'grid')
    // 첫 영역으로 옮긴 수합 요약은 테두리 한 겹만 갖고, 바깥 배치 영역은 카드를 중첩하지 않는다.
    assert.equal(await page.locator('.home-priority').evaluate(node=>getComputedStyle(node).borderTopWidth),'0px')
    assert.equal(await page.locator('.home-priority > .wf-home').evaluate(node=>getComputedStyle(node).borderTopWidth),'1px')
    assert.equal(await page.locator('.wf-home').evaluate(node=>getComputedStyle(node).borderRadius),await page.locator('.home-today').evaluate(node=>getComputedStyle(node).borderRadius))
    await menu('자료 수합');await heading('자료 수합')
    const colors=await page.locator('.wf-panel').evaluate(node=>{const probe=document.createElement('span');probe.style.color='var(--ui-text)';node.append(probe);const result={actual:getComputedStyle(node).color,token:getComputedStyle(node).getPropertyValue('--ui-text').trim(),expected:getComputedStyle(probe).color};probe.remove();return result})
    assert(colors.token,'공통 본문 색 토큰');assert.equal(colors.actual,colors.expected)
    await menu('수업과 학생');await heading('수업과 학생');assert.equal(await page.locator('.students-layout').evaluate(node=>getComputedStyle(node).display),'grid')
    await menu('학교 일정');await heading('학교 일정');await settle();await page.getByRole('button',{name:'월',exact:true}).click();assert.equal(await page.locator('.cv-month-grid').evaluate(node=>getComputedStyle(node).display),'grid')
  })
  await test('학생 관찰·활동은 메뉴 왕복 동안 유지하고 브라우저 저장 없이 새로고침하면 초기화한다',async()=>{
    await menu('수업과 학생');await heading('수업과 학생')
    assert.match(await page.locator('.ws-mode-banner').innerText(),/현재 창에서만 임시 보관/)
    const initialRecords=await page.locator('.students-record').count()
    const marker='오프라인 학생 자유기록 메모리 전용 표식'
    await page.getByLabel('활동',{exact:true}).fill('저장 정책 확인 활동')
    await page.getByLabel('직접 확인한 사실',{exact:true}).fill(marker)
    await page.getByLabel('직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.').check()
    await page.getByRole('button',{name:'관찰 저장',exact:true}).click()
    await page.getByRole('region',{name:'저장한 관찰 기록',exact:true}).waitFor()
    assert.equal(await page.locator('.students-record').filter({hasText:marker}).count(),1)
    await page.getByRole('button',{name:'가상 수업 활동 받기',exact:true}).click()
    await page.locator('.students-source').first().waitFor()
    await menu('오늘');await heading('오늘');await settle();await menu('수업과 학생');await heading('수업과 학생')
    assert.equal(await page.locator('.students-record').filter({hasText:marker}).count(),1)
    await page.getByRole('button',{name:/^수업 활동 받은함/}).click();assert.equal(await page.locator('.students-source').count(),1)
    const saved=await page.evaluate(()=>Object.entries(localStorage).map(([key,value])=>({key,value})))
    assert(!JSON.stringify(saved).includes(marker))
    const envelope=saved.find(row=>row.key==='workhub:synthetic:v3:workspace')
    assert(envelope);assert(!Object.hasOwn(JSON.parse(envelope.value).sections,'students'))
    await page.reload();await heading('수업과 학생')
    assert.equal(await page.locator('.students-record').filter({hasText:marker}).count(),0)
    assert.equal(await page.locator('.students-record').count(),initialRecords)
    await page.getByRole('button',{name:/^수업 활동 받은함/}).click();assert.equal(await page.locator('.students-source').count(),0)
  })
  await test('구버전 미리보기의 학생 저장값은 자동으로 열지 않고 원본을 그대로 둔다',async()=>{
    const legacyContext=await browser.newContext(),legacyPage=await legacyContext.newPage()
    const original=JSON.stringify({schema:2,kind:'synthetic-only',revision:3,sections:{students:{content:'구버전 학생 비공개 표식'}}})
    try{
      await legacyPage.addInitScript(value=>localStorage.setItem('workhub:synthetic:v2:workspace',value),original)
      await legacyPage.goto(base+'?view=students')
      await legacyPage.getByRole('heading',{name:'수업과 학생',exact:true,level:1}).waitFor()
      await legacyPage.getByRole('heading',{name:'학생과 수업 기록',exact:true}).waitFor()
      assert(!(await legacyPage.locator('body').innerText()).includes('구버전 학생 비공개 표식'))
      assert.equal(await legacyPage.evaluate(()=>localStorage.getItem('workhub:synthetic:v2:workspace')),original)
      assert.equal(await legacyPage.evaluate(()=>localStorage.getItem('workhub:synthetic:v3:workspace')),null)
    }finally{await legacyContext.close()}
  })
  await test('360px 더보기와 다섯 화면에서 메뉴 접근·레이아웃이 유지된다',async()=>{
    await page.setViewportSize({width:360,height:800})
    for(const name of ['오늘','학교 일정','내 업무','자료 수합','수업과 학생']){await menu(name);await heading(name);await settle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name);assert.equal(await page.getByRole('heading',{name,exact:true,level:1}).isVisible(),true);if(output)await page.screenshot({path:join(output,`offline-mobile-${name}.png`),fullPage:true})}
    await page.setViewportSize({width:1440,height:1000});await menu('오늘');await settle();if(output)await page.screenshot({path:join(output,'offline-desktop-home.png'),fullPage:true})
  })
  await test('외부 HTTP 요청과 예상하지 않은 브라우저 오류가 없다',async()=>{assert.deepEqual(network,[]);assert.deepEqual(errors,[])})
  console.log(`오프라인 단일 HTML ${results.length}개 통과`)
  if(output)writeFileSync(join(output,'offline-browser-results.json'),JSON.stringify({file:path,results,externalRequestCount:network.length,errors},null,2))
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-3500));if(output)await page.screenshot({path:join(output,'offline-failure.png'),fullPage:true});process.exitCode=1}
finally{await context.close();await browser.close()}
