import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
// 실제 운영 외곽 Layout과 실제 업무실 화면을 합성 회원·학교 자료로 함께 검사한다.
// 인증 Provider의 읽기 값만 주입하며 실제 인증·DB·외부 호출은 하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = 'http://127.0.0.1:5179'
const bundle = buildSync({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useEffect,useRef,useState} from 'react';
    import{createRoot}from'react-dom/client';import{createPortal}from'react-dom';
    import{MemoryRouter,Routes,Route,Navigate}from'react-router-dom';
    import Layout from './apps/main/src/components/Layout.jsx';
    import{SeasonalWorkContext}from'./apps/main/src/site/SeasonalWorkProvider.jsx';
    import{AuthContext}from'./apps/main/src/lib/AuthContext.jsx';
    import{visibleModules}from'./apps/main/src/lib/modules.js';
    import{PreviewApp}from'./apps/workhub/src/preview/PreviewApp';
    import{createDemoPersistence}from'./apps/workhub/src/preview/persistence';
    import mainStyles from './apps/main/src/styles.css?inline';
    import theme from './apps/workhub/src/style.css?inline';
    import preview from './apps/workhub/src/preview/preview.css?inline';
    import workflow from './apps/workhub/src/workflows/workflows.css?inline';
    import students from './apps/workhub/src/students/students.css?inline';
    import typography from './apps/workhub/src/typography.css?inline';
    const profile={id:'synthetic-superadmin',name:'검증용 교사',role:window.testRole||'superadmin',is_active:true,extra_permissions:[]};
    const modules=visibleModules(profile);window.allowedLegacyLinks=modules.map(({to,label})=>({to,label}));
    const saved=new Map(),persistence=createDemoPersistence({getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)});
    // 운영 StyleBoundary와 같은 Shadow DOM 격리에서 실제 PreviewApp의 입력·탐색을 검증한다.
    function PreviewBoundary(){const host=useRef(null),[shadow,setShadow]=useState(null);useEffect(()=>{if(host.current)setShadow(host.current.shadowRoot||host.current.attachShadow({mode:'open'}))},[]);return <div ref={host} data-testid="workhub-style-boundary">{shadow&&createPortal(<><style>{theme.replaceAll(':root',':host').replace(/(^|[}\\s,])body(?=\\s*[{,])/g,'$1.workhub-connected')}{preview}{workflow}{students}{':host{display:block}.workhub-connected{min-height:70vh;border-radius:16px;overflow:hidden}'}</style><div className="workhub-connected"><PreviewApp persistence={persistence}/></div></>,shadow)}</div>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><style>{mainStyles}{typography}</style><AuthContext.Provider value={{session:{user:{id:profile.id}},profile,loading:false,profileLoading:false,profileError:null}}><SeasonalWorkContext.Provider value={{state:{enabled:true}}}><MemoryRouter initialEntries={[window.location.pathname]}><Routes><Route element={<Layout/>}>{modules.map(m=>m.to==='/'?<Route key={m.key} index element={<h1>{m.label} 시험 화면</h1>}/>:<Route key={m.key} path={m.to.slice(1)} element={m.key==='workhub'?<PreviewBoundary/>:<h1>{m.label} 시험 화면</h1>}/>)}<Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes></MemoryRouter></SeasonalWorkContext.Provider></AuthContext.Provider></React.StrictMode>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-key' }), 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
const results = [], errors = [], blockedRequests = [], commands = []
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
context.on('request', request => { if (!['GET','HEAD','OPTIONS'].includes(request.method())) commands.push(request.url()) })
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === origin && url.pathname === '/assets/fonts/PretendardVariable.woff2') return route.fulfill({ contentType: 'font/woff2', body: readFileSync(join(root, 'apps/workhub/src/assets/fonts/PretendardVariable.woff2')) })
  if (url.origin === origin && request.isNavigationRequest() && ['/workhub','/submissions','/'].includes(url.pathname)) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
  blockedRequests.push(request.url()); return route.abort()
})
const legacy = () => page.getByRole('dialog',{name:'더보기',exact:true})
async function toggleMore(){if(await legacy().isVisible())await page.getByRole('button',{name:'더보기 닫기',exact:true}).click();else await page.getByRole('button',{name:'더보기',exact:true}).click()}
async function settle() {
  await page.waitForFunction(() => {
    const shadow = document.querySelector('[data-testid="workhub-style-boundary"]')?.shadowRoot
    return !shadow?.querySelector('.task-loading,.loading-state')
  })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function start(role = 'superadmin', path = '/workhub') {
  await page.goto(origin + path)
  await page.evaluate(role => { window.testRole = role; localStorage.clear() }, role)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  if (role === 'superadmin' && path === '/workhub') await page.getByRole('heading', { name: '내 할 일', exact: true }).waitFor()
  else await page.getByRole('heading', { name: path === '/submissions' ? '평가계획서 제출 시험 화면' : '홈 시험 화면', exact: true }).waitFor()
  await settle()
  await page.evaluate(() => document.fonts.ready)
}
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
async function capture(name) { if(output) await page.screenshot({path:join(output,name+'.png'),fullPage:true}) }
async function assertFits(label) {
  const value = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(value.width <= value.viewport + 1, label + ': ' + JSON.stringify(value))
}
try {
  await test('하나의 메뉴 틀에서 기간 업무와 계정 조작을 보존한다',async()=>{
    await start();assert.equal(await page.locator('.app.app-workhub').count(),1);assert.equal(await page.locator('.legacy-navigation').count(),0);
    assert.equal(await page.getByRole('link',{name:'평가계획서 제출',exact:true}).isVisible(),true);
    await toggleMore();const utilities=await legacy().locator('.ws-site-utilities a').evaluateAll(nodes=>nodes.map(n=>({to:n.getAttribute('href'),label:n.textContent})));
    assert.deepEqual(utilities,await page.evaluate(()=>window.allowedLegacyLinks.filter(i=>['/account','/admin/seasonal','/admin/users','/workhub/setup','/calendar'].includes(i.to))));
    await toggleMore();assert.equal(await page.getByRole('button',{name:'로그아웃',exact:true}).isVisible(),true);await capture('shell-desktop-1440')
  })
  await test('더보기는 키보드로 열고 허용된 링크에 접근한 뒤 같은 버튼으로 복귀한다',async()=>{
    await page.getByRole('button',{name:'더보기',exact:true}).focus();await page.keyboard.press('Enter');await legacy().waitFor();
    assert.equal(await page.getByRole('link',{name:'내 계정',exact:true}).isVisible(),true);await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'더보기',exact:true}).evaluate(e=>e===e.getRootNode().activeElement),true)
  })
  await test('오늘 일정은 기존 버튼 이름과 시간 설명을 함께 제공하고 설명 ID가 겹치지 않는다',async()=>{
    const cards=await page.locator('.home-today .event-card').evaluateAll(nodes=>nodes.map(node=>{const id=node.getAttribute('aria-describedby');return{label:node.getAttribute('aria-label'),id,description:id?node.getRootNode().getElementById(id)?.textContent:null}}))
    assert.ok(cards.length>0)
    assert.equal(new Set(cards.map(card=>card.id)).size,cards.length)
    for(const card of cards){assert.ok(card.id);assert.ok(card.description);assert.match(card.label,/ · 원본 v\d+ 보기$/)}
    const morning=cards.find(card=>card.label==='함께 여는 월요일 · 교직원 협의 · 원본 v1 보기')
    assert.ok(morning,'원래 일정 열기 버튼 이름을 유지한다')
    assert.equal(morning.description,'08:30–08:50')
  })
  for(const width of [320,390,1440]) await test(width+'px에서 운영 외곽·업무실·펼친 기존 메뉴가 화면 안에 들어온다',async()=>{
    await page.setViewportSize({width,height:width<720?844:1000});await start();await assertFits(width+' 닫힘')
    const times=await page.locator('.home-time-tile strong').evaluateAll(nodes=>nodes.filter(node=>/^\d{2}:\d{2}$/.test(node.textContent)).map(node=>{const range=document.createRange();range.selectNodeContents(node);return{text:node.textContent,lines:new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size}}))
    assert.ok(times.length>0,'숫자 시각이 있는 일정을 검증한다')
    for(const time of times)assert.equal(time.lines,1,width+'px 시각 줄 바꿈: '+time.text)
    await capture('shell-home-'+width)
    await toggleMore();await assertFits(width+' 펼침')
    const nav=await legacy().boundingBox();assert.ok(nav&&nav.x>=0&&nav.x+nav.width<=width+1)
    assert.equal(await page.getByRole('link',{name:'평가계획서 제출',exact:true}).isVisible(),true)
    await capture('shell-menu-'+width)
    await toggleMore()
  })
  await test('빈 수합과 개인 업무는 모바일에서도 작게 표시하고 원래 조회·이동 행동을 유지한다',async()=>{
    for(const width of [584,390,320]){
      await page.setViewportSize({width,height:844});await start()
      const collections=page.getByRole('region',{name:'오늘 처리할 수합',exact:true}),tasks=page.getByRole('region',{name:'내 할 일',exact:true})
      const collectionHeight=(await collections.boundingBox()).height,taskHeight=(await tasks.boundingBox()).height
      assert(collectionHeight<=110,`${width}px 빈 수합 높이 ${collectionHeight}px`)
      assert(taskHeight<=190,`${width}px 빈 개인 업무 높이 ${taskHeight}px`)
      assert.equal(await tasks.locator('.task-list-heading').count(),0)
      assert.equal(await tasks.getByRole('button',{name:'할 일 등록',exact:true}).isVisible(),true)
      await tasks.locator('.task-home-help>summary').click()
      await tasks.getByRole('button',{name:'목록 새로고침',exact:true}).click();await settle()
      assert.equal(await tasks.locator('.task-home-help>summary').evaluate(node=>node.getRootNode().activeElement===node),true)
      await tasks.getByRole('button',{name:'모든 내 업무 보기',exact:true}).click()
      await page.getByRole('heading',{name:'내 업무',level:1,exact:true}).waitFor()
      await clickWorkspaceMenu(page, '오늘');await settle()
      await page.getByRole('region',{name:'오늘 처리할 수합',exact:true}).getByRole('button',{name:'수합 전체 보기',exact:true}).click()
      await page.getByRole('heading',{name:'자료 수합',level:1,exact:true}).waitFor()
      await assertFits(width+'px 빈 업무 이동')
    }
  })
  await test('기존 메뉴 링크도 실제 작성 중 입력을 버리지 않고 안내 뒤 취소하면 이동한다',async()=>{
    await page.setViewportSize({width:1440,height:1000});await start()
    await page.getByRole('button',{name:'할 일 등록',exact:true}).click()
    await page.getByLabel('해야 할 일',{exact:true}).fill('기존 메뉴 이동 시 보존할 업무')
    await page.getByLabel('나만 보는 메모',{exact:true}).fill('입력은 서버로 보내지 않습니다.')
    await toggleMore();await page.getByRole('link',{name:'내 계정',exact:true}).click()
    await page.getByText('작성 중인 내용을 저장하거나 편집을 취소한 뒤 이동해 주세요. 저장 결과를 확인 중이면 먼저 같은 요청의 결과를 확인해 주세요.',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'기존 메뉴 이동 시 보존할 업무')
    assert.equal(await page.getByLabel('나만 보는 메모',{exact:true}).inputValue(),'입력은 서버로 보내지 않습니다.')
    assert.equal(await page.getByRole('heading',{name:'내 계정 시험 화면',exact:true}).count(),0)
    assert.equal(await page.locator('.app-workhub').count(),1)
    await toggleMore();await page.getByRole('button',{name:'편집 취소',exact:true}).click()
    await page.getByLabel('해야 할 일',{exact:true}).waitFor({state:'detached'})
    await toggleMore();await page.getByRole('link',{name:'내 계정',exact:true}).click()
    await page.getByRole('heading',{name:'내 계정 시험 화면',exact:true}).waitFor()
    assert.equal(await page.locator('.app-workhub').count(),1)
    assert.equal(await page.locator('.legacy-navigation').count(),0)
    assert.equal(await page.getByRole('link',{name:'평가계획서 작성',exact:true}).isVisible(),true)
  })
  await test('일반 교사의 기존 메뉴와 업무실 직접 주소 차단은 공개 범위를 그대로 따른다',async()=>{
    await start('teacher','/submissions')
    assert.equal(await page.locator('.legacy-navigation').count(),0)
    assert.equal(await page.getByRole('link',{name:'평가계획서 작성',exact:true}).isVisible(),true)
    assert.equal(await page.getByRole('link',{name:'평가계획서 제출',exact:true}).isVisible(),true)
    assert.equal(await page.getByRole('link',{name:'신축 업무실 · 시험',exact:true}).count(),0)
    assert.equal(await page.getByRole('link',{name:'사용자 관리',exact:true}).count(),0)
    await start('teacher','/workhub')
    assert.equal(await page.locator('.ws-shell').count(),1);assert.equal(await page.getByRole('button',{name:'시간표',exact:true}).count(),0)
    assert.equal(await page.locator('[data-testid="workhub-style-boundary"]').count(),0)
  })
  assert.deepEqual(errors,[]);assert.deepEqual(blockedRequests,[]);assert.deepEqual(commands,[])
  if(output)writeFileSync(join(output,'shell-layout-results.json'),JSON.stringify({results,errors,blockedRequests,commands},null,2))
  console.log('운영 외곽·업무실 브라우저 '+results.length+'건 통과')
} catch(error) {await capture('shell-layout-failure');console.error((await page.locator('body').innerText()).slice(-1000));if(await page.locator('.ws-shell').count())console.error((await page.locator('.ws-shell').innerText()).slice(-3000));throw error}
finally {await browser.close()}
