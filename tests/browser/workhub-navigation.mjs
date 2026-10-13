import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'
const bundle = buildSync({ stdin: { contents: `
  import React, {useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {BrowserRouter,Routes,Route,Link,useLocation,useNavigate} from 'react-router-dom';
  import {useWorkspaceNavigation} from './apps/workhub/src/app/navigation';
  const scenario={mounts:0,unmounts:0,actions:0}; window.scenario=scenario;
  function Workspace(){
    const [scope,setScope]=useState();const [draft,setDraft]=useState('');const [pending,setPending]=useState(false);
    const [allowed,setAllowed]=useState(['home','calendar','tasks']); const navigate=useNavigate();
    const nav=useWorkspaceNavigation({allowedPages:allowed,scopeKey:scope,locked:!!draft||pending});
    useEffect(()=>{scenario.mounts++;return()=>scenario.unmounts++},[]);
    scenario.scope=value=>setScope(value);scenario.pending=value=>setPending(value);scenario.allowed=value=>setAllowed(value);
    scenario.forceExit=()=>navigate('/legacy');scenario.current=nav.page;
    return <section aria-label="작업실"><h1>{nav.page}</h1><nav>{allowed.map(page=><button key={page} onClick={()=>nav.requestNavigate(page)}>{page}</button>)}</nav>
      <label>미저장 내용<input aria-label="미저장 내용" value={draft} onChange={event=>setDraft(event.target.value)}/></label>
      <button onClick={()=>nav.requestAction(()=>{scenario.actions++})}>학교 선택 action</button>
      <p role="status">{nav.announcement}</p><a href="#main-content">본문으로 건너뛰기</a><a href="#fragment-target">다른 본문 위치</a><div id="main-content" tabIndex={-1}>본문</div><div id="fragment-target">두 번째 본문</div>
    </section>
  }
  function Frame(){const loc=useLocation();return <><header><Link to="/legacy">기존 메뉴</Link><Link to="/workhub?view=tasks&keep=school#main-content">신축 업무실</Link><output data-testid="router-url">{loc.pathname+loc.search+loc.hash}</output></header><Routes><Route path="/workhub" element={<Workspace/>}/><Route path="*" element={<h1>기존 화면</h1>}/></Routes></>}
  createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><Frame/></BrowserRouter></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1000, height: 800 } })
const page = await context.newPage()
const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
const origin = 'http://127.0.0.1:5176'
await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>` }))
async function boot(path = '/workhub?view=tasks&keep=school#main-content') { await page.goto(origin + path); await page.getByRole('heading', { name: path.startsWith('/workhub') ? (new URL(origin + path).searchParams.get('view') || 'home') : '기존 화면', exact: true }).waitFor() }
async function screen(name) { await page.getByRole('heading', { name, exact: true }).waitFor() }
async function click(name) { await page.getByRole('button', { name, exact: true }).click() }
async function routerLocation(expected) { await page.waitForFunction(value => document.querySelector('[data-testid=router-url]')?.textContent === value, expected) }
async function report(message) { assert.deepEqual(errors, []); console.log(`  ✓ ${message}`) }
try {
  await boot()
  assert.equal(await page.getByTestId('router-url').textContent(), '/workhub?view=tasks&keep=school#main-content')
  await page.reload(); await screen('tasks')
  await page.evaluate(() => window.scenario.scope('school-a'))
  await screen('tasks')
  await report('직접 주소·새로고침·최초 학교 연결에서 선택 화면과 다른 query/hash 유지')

  const length = await page.evaluate(() => history.length)
  await click('tasks')
  assert.equal(await page.evaluate(() => history.length), length)
  await click('calendar'); await screen('calendar')
  await routerLocation('/workhub?view=calendar&keep=school#main-content')
  await click('home'); await screen('home')
  await page.goBack(); await screen('calendar')
  await page.goBack(); await screen('tasks')
  await page.goForward(); await screen('calendar')
  await report('BrowserRouter 주소 동기화·동일 화면 중복 방지·뒤로/앞으로 화면 복원')

  await page.getByLabel('미저장 내용').fill('이 입력과 편집 컴포넌트를 보존')
  const mounts = await page.evaluate(() => window.scenario.mounts)
  await click('tasks'); await screen('calendar')
  await click('학교 선택 action')
  assert.equal(await page.evaluate(() => window.scenario.actions), 0)
  assert.match(await page.locator('p[role=status]').textContent(), /작성 중인 내용을 저장/)
  await page.getByRole('link', { name: '기존 메뉴', exact: true }).click()
  await screen('calendar')
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '이 입력과 편집 컴포넌트를 보존')
  await report('내부 CTA·일반 action·기존 NavLink 모두 같은 편집 잠금으로 차단')

  const lockedUrl = page.url()
  await page.goBack()
  await page.waitForURL(lockedUrl)
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '이 입력과 편집 컴포넌트를 보존')
  assert.equal(await page.getByTestId('router-url').textContent(), new URL(lockedUrl).pathname + new URL(lockedUrl).search + new URL(lockedUrl).hash)
  assert.equal(await page.evaluate(() => window.scenario.mounts), mounts)
  assert.equal(await page.evaluate(() => window.scenario.unmounts), 0)
  await report('잠긴 뒤로가기는 Router unmount 없이 원래 history 항목으로 복귀')

  await page.goForward()
  await page.waitForURL(lockedUrl)
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '이 입력과 편집 컴포넌트를 보존')
  await report('잠긴 앞으로가기도 초안·페이지·Router 위치를 유지')

  await page.getByRole('link', { name: '다른 본문 위치', exact: true }).click()
  await page.waitForURL(url => url.hash === '#fragment-target')
  await page.goBack(); await page.waitForURL(lockedUrl)
  await page.getByRole('link', { name: '본문으로 건너뛰기', exact: true }).click()
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '이 입력과 편집 컴포넌트를 보존')
  await page.evaluate(() => { const host=document.createElement('div');host.id='shadow-link';document.body.append(host);host.attachShadow({mode:'open'}).innerHTML='<a href="/legacy">그림자 메뉴</a>' })
  await page.getByRole('link', { name: '그림자 메뉴', exact: true }).click()
  await screen('calendar')
  assert.equal(await page.evaluate(() => { const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented }), true)
  await report('본문 건너뛰기 허용·Shadow DOM 링크 차단·새로고침 경고')

  await page.getByLabel('미저장 내용').fill('')
  await page.evaluate(() => window.scenario.pending(true))
  await click('tasks'); await screen('calendar')
  await page.getByRole('link', { name: '기존 메뉴', exact: true }).click(); await screen('calendar')
  await page.evaluate(() => window.scenario.pending(false))
  await click('tasks'); await screen('tasks')
  await report('저장 결과 미확정 상태도 보호하며 확인 완료 뒤 이동 잠금 해제')

  await page.evaluate(() => window.scenario.scope('school-b'))
  await screen('home')
  assert.equal(new URL(page.url()).searchParams.get('keep'), 'school')
  assert.equal(new URL(page.url()).hash, '#main-content')
  await report('다른 학교로 전환하면 홈으로 교체하고 다른 주소 정보 유지')

  await page.getByRole('link', { name: '기존 메뉴', exact: true }).click(); await screen('기존 화면')
  await page.getByRole('link', { name: '신축 업무실', exact: true }).click(); await screen('tasks')
  await page.getByLabel('미저장 내용').fill('기존 화면으로도 뒤로가지 않음')
  const insideUrl = page.url()
  await page.goBack(); await page.waitForURL(insideUrl); await screen('tasks')
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '기존 화면으로도 뒤로가지 않음')
  await report('같은 BrowserRouter의 기존 화면으로 나가는 뒤로가기도 초안 유지')

  await page.evaluate(() => window.scenario.forceExit()); await screen('기존 화면')
  assert.equal(await page.evaluate(() => { const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented }), false)
  await report('프로그램적 권한 회수·로그아웃 경로를 막지 않고 unmount 뒤 listener 정리')

  await page.goto(origin + '/workhub?keep=school&view=students#main-content'); await screen('home')
  assert.equal(new URL(page.url()).searchParams.has('view'), false)
  await routerLocation('/workhub?keep=school#main-content')
  await report('연결 모드에 없는 직접 URL을 홈으로 교정하고 Router와 일치')

  await click('tasks'); await screen('tasks')
  await page.evaluate(() => window.scenario.allowed(['home', 'calendar'])); await screen('home')
  assert.equal(new URL(page.url()).searchParams.has('view'), false)
  await report('허용 메뉴가 바뀌면 현재 화면과 URL을 함께 안전 복원')
  await boot(); await click('home'); await click('calendar'); await click('tasks'); await screen('tasks')
  await page.getByLabel('미저장 내용').fill('여러 항목 뒤로가기도 보존')
  const traversalUrl = page.url()
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame() && frame.url() !== traversalUrl), page.evaluate(() => history.go(-2))]); await page.waitForURL(traversalUrl)
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '여러 항목 뒤로가기도 보존')
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame() && frame.url() !== traversalUrl), page.evaluate(() => { history.back(); history.back() })]); await page.waitForURL(traversalUrl)
  assert.equal(await page.getByLabel('미저장 내용').inputValue(), '여러 항목 뒤로가기도 보존')
  assert.equal(await page.evaluate(() => window.scenario.unmounts), 0)
  await report('여러 history 항목 이동과 연속 뒤로가기에서도 초안·마운트 유지')
} catch (error) {
  console.error(error); console.error((await page.locator('body').innerText()).slice(-2500)); process.exitCode=1
} finally { await context.close(); await browser.close() }
