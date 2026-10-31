import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'
// 하단 탐색과 더보기 전환을 실제 화면·ShadowRoot·연결 모드 메뉴로 검증한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const source = `
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{PreviewApp}from'./apps/workhub/src/preview/PreviewApp';
 import{createDemoPersistence}from'./apps/workhub/src/preview/persistence';
 import{WorkspaceShell}from'./apps/workhub/src/app/WorkspaceShell';
 import theme from './apps/workhub/src/style.css?inline';import preview from './apps/workhub/src/preview/preview.css?inline';
 import workflows from './apps/workhub/src/workflows/workflows.css?inline';import students from './apps/workhub/src/students/students.css?inline';
 function Connected(){const[page,setPage]=useState('home');return <WorkspaceShell page={page} onNavigate={setPage} mode="connected" schoolName="가상 연결 학교" memberName="가상 교사" contextControls={<label>학교 선택<select defaultValue="one"><option value="one">가상 연결 학교</option></select></label>} quickActions={<button className="ws-search-trigger">업무 찾기</button>}><main><h1>{page==='home'?'오늘':page==='tasks'?'내 업무':'학교 일정'}</h1></main></WorkspaceShell>}
 const params=new URL(location.href).searchParams, host=document.getElementById('root');
 const root=params.has('shadow')?host.attachShadow({mode:'open'}):host;window.qaRoot=root;
 createRoot(root).render(<><style>{theme}{preview}{workflows}{students}</style>{params.has('connected')?<Connected/>:<PreviewApp persistence={createDemoPersistence(localStorage)}/>}</>);
`
const bundle = buildSync({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), results = [], errors = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
let current
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
try {
 for (const shadow of [false, true]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = current = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await context.route('http://127.0.0.1:5176/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0"><div id="root"></div><script>${bundle.replaceAll('</script','<\\/script')}</script></body></html>` }))
  await page.goto('http://127.0.0.1:5176/?' + (shadow ? 'shadow=1' : ''))
  const scoped = (name, run) => test(`${shadow?'shadow':'document'} · ${name}`, run)
  const nav = () => page.getByRole('navigation', { name: '업무 메뉴', exact: true })
  const more = () => nav().getByRole('button', { name: '더보기', exact: true })
  const sheet = () => page.getByRole('dialog', { name: '더보기', exact: true })
  async function settled() { await page.waitForFunction(() => !window.qaRoot.querySelector('.task-loading,.loading-state')); await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))) }
  async function focusIs(locator) { await page.waitForFunction(node => node.getRootNode().activeElement===node, await locator.elementHandle()) }
  async function fits() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); for (const dialog of await page.locator('dialog[open]').all()) assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)) }
  async function menu(name) { await clickWorkspaceMenu(page,name);await page.getByRole('heading',{name,level:1,exact:true}).waitFor();await settled() }
  await page.getByRole('heading',{name:'오늘',exact:true,level:1}).waitFor();await settled()
  await scoped('390px 미리보기는 지원하는 핵심 메뉴와 검색 하나로 시작한다', async () => {
   assert.equal(await nav().count(),1)
   assert.deepEqual(await nav().getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')||n.innerText.replace(/\s/g,''))),['홈','학교 일정','업무','•••더보기'])
   const bounds=await nav().boundingBox();assert(bounds.y>700 && bounds.y+bounds.height<=845)
   assert(await page.locator('.ws-sidebar').evaluate(node=>node.getBoundingClientRect().height<90))
   assert.equal(await page.getByRole('button',{name:'업무 찾기',exact:true}).count(),1)
   assert.equal(await page.getByRole('combobox',{name:/^학교 선택/}).count(),0)
  })
  await scoped('하단 AI 비서에서 연 안내는 준비 상태를 밝히고 닫으면 같은 버튼으로 돌아온다', async () => {
   const directAi=page.getByRole('button',{name:'AI 비서 열기',exact:true})
   await directAi.click();const assistant=page.getByRole('dialog',{name:'AI 비서',exact:true});await assistant.waitFor()
   assert.equal(await page.locator('dialog[open]').count(),1)
   assert.match(await assistant.innerText(),/현재는 대화를 전송하거나 AI 작업을 실행할 수 없습니다/)
   assert.equal(await assistant.locator('textarea,input').count(),0)
   await page.keyboard.press('Escape');assert.equal(await assistant.count(),0);await focusIs(directAi)
   assert.equal(await more().getAttribute('aria-expanded'),'false')
  })
  await scoped('더보기는 학교 선택과 보조 메뉴를 모으고 Escape로 초점을 복원한다', async () => {
   await more().click();await sheet().waitFor();await focusIs(sheet().getByRole('button',{name:'더보기 닫기'}))
   assert.equal(await sheet().getByRole('button',{name:'자료 수합',exact:true}).count(),1)
   assert.equal(await sheet().getByRole('button',{name:'수업과 학생',exact:true}).count(),1)
   assert.equal(await sheet().getByRole('button',{name:'시간표',exact:true}).count(),0)
   assert.equal(await sheet().getByRole('combobox',{name:/^학교 선택/}).count(),1)
   await page.keyboard.press('Shift+Tab');assert(await sheet().evaluate(node=>node.contains(node.getRootNode().activeElement)))
   await page.keyboard.press('Escape');assert.equal(await sheet().count(),0);await focusIs(more())
  })
  await scoped('설정·AI 비서 전환 때 대화상자는 하나이고 닫으면 하단 메뉴로 돌아온다', async () => {
   await more().click();await sheet().getByRole('button',{name:'화면 설정',exact:true}).click()
   const settings=page.getByRole('dialog',{name:'화면 설정',exact:true});await settings.waitFor();assert.equal(await page.locator('dialog[open]').count(),1)
   await settings.locator('input[value="large"]').check();await page.keyboard.press('Escape');await focusIs(more())
   await more().click();await sheet().getByRole('button',{name:'AI 비서 준비 중',exact:true}).click()
   const assistant=page.getByRole('dialog',{name:'AI 비서',exact:true});await assistant.waitFor();assert.equal(await page.locator('dialog[open]').count(),1)
   await page.keyboard.press('Escape');await focusIs(more())
   await more().click();await sheet().getByRole('button',{name:'AI 비서 준비 중',exact:true}).click();await assistant.getByRole('button',{name:'내 업무 열기',exact:true}).click()
   await page.getByRole('heading',{name:'내 업무',level:1,exact:true}).waitFor();await focusIs(page.getByRole('heading',{name:'내 업무',level:1,exact:true}))
  })
  await scoped('320px 큰 글씨에서도 다섯 화면과 더보기가 넘치지 않는다', async () => {
   await page.setViewportSize({width:320,height:640});await settled()
   for(const name of ['자료 수합','수업과 학생','오늘','학교 일정','내 업무']){await menu(name);await fits()}
   await more().click();await fits()
   if(output)await page.screenshot({path:join(output,`mobile-${shadow?'shadow':'document'}-320-large-sheet.png`),fullPage:true})
   await page.keyboard.press('Escape')
  })
  await scoped('낮은 화면의 업무 입력을 보존하면서 이동은 잠그고 설정은 허용한다', async () => {
   await page.setViewportSize({width:390,height:480});await menu('내 업무')
   await page.getByRole('button',{name:'할 일 등록',exact:true}).click();await page.getByLabel('해야 할 일',{exact:true}).fill('모바일 입력을 보존하는 가상 초안');await settled()
   assert(await nav().getByRole('button',{name:'홈',exact:true}).isDisabled())
   await more().click();assert(await sheet().getByRole('combobox',{name:/^학교 선택/}).isDisabled());assert(await sheet().getByRole('button',{name:'AI 비서 준비 중',exact:true}).isDisabled())
   await sheet().getByRole('button',{name:'화면 설정',exact:true}).click();await page.keyboard.press('Escape')
   const input=page.getByLabel('해야 할 일',{exact:true});assert.equal(await input.inputValue(),'모바일 입력을 보존하는 가상 초안')
   await input.focus();await input.scrollIntoViewIfNeeded();const inputBox=await input.boundingBox(),navBox=await nav().boundingBox();assert(inputBox.y>=0&&inputBox.y+inputBox.height<=navBox.y)
   await page.getByRole('button',{name:'편집 취소',exact:true}).click();await settled()
  })
  await scoped('더보기에서 선택·재선택·화면 확대 후 숨은 메뉴에 초점이 남지 않는다', async () => {
   await menu('자료 수합');await more().click();await sheet().getByRole('button',{name:'자료 수합',exact:true}).click();await focusIs(page.getByRole('heading',{name:'자료 수합',level:1,exact:true}))
   await more().click();await page.setViewportSize({width:1200,height:900});await settled();assert.equal(await page.locator('dialog[open]').count(),0);await focusIs(page.getByRole('heading',{name:'자료 수합',level:1,exact:true}))
   await page.setViewportSize({width:390,height:844});await settled();await more().click();await sheet().getByRole('button',{name:'화면 설정',exact:true}).click();await page.setViewportSize({width:1200,height:900});await settled();assert.equal(await page.locator('dialog[open]').count(),0);await focusIs(page.getByRole('heading',{name:'자료 수합',level:1,exact:true}))
   await page.getByRole('button',{name:'화면 설정',exact:true}).click();await page.setViewportSize({width:390,height:844});await settled();assert.equal(await page.locator('dialog[open]').count(),0);await focusIs(page.getByRole('heading',{name:'자료 수합',level:1,exact:true}))
  })
  await scoped('연결 모드 더보기는 시간표를 포함하고 미리보기의 메뉴는 유지한다', async () => {
   await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5176/?connected=1'+(shadow?'&shadow=1':''));await page.getByRole('heading',{name:'오늘',level:1,exact:true}).waitFor()
   const connected=page.getByRole('navigation',{name:'업무 메뉴',exact:true});assert.deepEqual(await connected.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')||n.innerText.replace(/\s/g,''))),['홈','시간표','업무','자료','•••더보기'])
   await connected.getByRole('button',{name:'더보기',exact:true}).click();assert.equal(await sheet().getByRole('button',{name:'자료 수합',exact:true}).count(),1);assert.equal(await sheet().getByRole('button',{name:'수업과 학생',exact:true}).count(),1)
   for(const name of ['협업 요청','학교 관리','AI 비서'])assert.equal(await sheet().getByRole('button',{name,exact:true}).count(),1);assert.equal(await sheet().getByRole('button',{name:'시간표',exact:true}).count(),0)
   assert.equal(await sheet().getByRole('button',{name:'화면 설정',exact:true}).count(),1);await fits();await page.keyboard.press('Escape')
  })
  await context.close()
 }
 assert.deepEqual(errors,[]);console.log(`모바일 탐색 브라우저 ${results.length}개 통과`)
 if(output)writeFileSync(join(output,'mobile-navigation-results.json'),JSON.stringify({results,errors},null,2))
}catch(error){console.error(error);if(current&&!current.isClosed()&&output)await current.screenshot({path:join(output,'mobile-navigation-failure.png'),fullPage:true});process.exitCode=1}
finally{await browser.close()}
