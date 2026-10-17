// 실제 업무실 스킨 CSS와 시간표 React 화면을 함께 렌더한다. 서버 응답만 합성이다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {readFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url))
const options={bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}
const operations=buildSync({...options,entryPoints:[fileURLToPath(new URL('./workhub-timetable-exchanges-fixture.tsx',import.meta.url))]}).outputFiles[0].text
const companions=buildSync({...options,stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{TimetableWorkspacePanel}from'./apps/workhub/src/timetable/TimetableWorkspace';
import{TimetableAgendaContent}from'./apps/workhub/src/timetable/TimetableAgendaPanel';
import{projectTimetableCalendar}from'./apps/workhub/src/timetable/operations-calendar';
import{timetablePracticeSnapshot}from'./apps/workhub/src/timetable/sample';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
const w:any=window,snapshot=timetablePracticeSnapshot('2026-10-17');snapshot.basis.schoolId='s';
const drafts=createEditDrafts(),server={readiness:async()=>{if(w.editorFail)throw Error('합성 조회 실패');return{available:true}},get:async()=>structuredClone(snapshot)};
function Editor(){const[revision,setRevision]=useState(0);w.editorRefresh=()=>setRevision(v=>v+1);return <EditDraftsProvider store={drafts}><TimetableWorkspacePanel server={server as any} member={w.member} date='2026-10-17' revision={revision}/></EditDraftsProvider>}
createRoot(document.getElementById('editor')!).render(<Editor/>);
createRoot(document.getElementById('agenda')!).render(<TimetableAgendaContent title='오늘 수업' date={w.future} state={{status:'ready',items:projectTimetableCalendar(w.view,'m')}} onRetry={()=>{}} onOpen={()=>{}}/>);
`}}).outputFiles[0].text
const shellCss=readFileSync(join(root,'apps/workhub/src/app/workspace-shell.css'),'utf8')
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],external=[]
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5183/'))external.push(r.url())});page.setDefaultTimeout(10000)
await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${shellCss}body{margin:0}.theme-fixture{padding:16px}.theme-fixture>div{min-width:0;margin-bottom:24px}</style><main class="ws-shell theme-fixture" data-theme="light"><div id="editor"></div><div id="root"></div><div id="agenda"></div></main></html>`}))
let passed=0
async function test(name,run){await run();passed++;console.log('  ✓ '+name)}
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function start(theme){await page.setViewportSize({width:1280,height:900});await page.goto('http://127.0.0.1:5183/theme');await page.evaluate(theme=>{document.querySelector('.ws-shell').dataset.theme=theme;window.enableNext=true},theme);await page.addScriptTag({content:operations});await page.addScriptTag({content:companions});await page.getByRole('heading',{name:'학교가 확정한 수업',exact:true}).waitFor();await page.getByRole('button',{name:'시간표 만들기',exact:true}).click();await page.getByText('기초 자료의 시수·배정·시간대 검사 통과',{exact:true}).waitFor();await page.getByRole('heading',{name:'오늘 수업',exact:true}).waitFor();await settle()}
async function contrast(locator,label){
  const colors=await locator.first().evaluate(element=>{const foreground=getComputedStyle(element).color;let at=element,background='';while(at){background=getComputedStyle(at).backgroundColor;if(!['transparent','rgba(0, 0, 0, 0)'].includes(background))break;at=at.parentElement}return{foreground,background}})
  const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722}
  const a=luminance(colors.foreground),b=luminance(colors.background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
  assert.ok(ratio>=4.5,`${label}: 대비 ${ratio.toFixed(2)} ${JSON.stringify(colors)}`)
}
async function fits(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,label+' 페이지 가로 넘침');for(const selector of ['.timetable-workspace','.timetable-operations','.ttagenda']){const bounds=await page.locator(selector).evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:innerWidth}));assert.ok(bounds.left>=-1&&bounds.right<=bounds.width+1,label+' '+selector)}}
async function shot(name){if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png'),fullPage:true})}}
try{
for(const theme of ['light','warm','dark']){
  await start(theme)
  await test(theme+' 스킨에서 편성·운영·수업 요약의 글자·카드·입력 대비를 유지한다',async()=>{
    for(const selector of ['.timetable-workspace h1','.timetable-workspace .timetable-muted','.timetable-card','.timetable-steps [aria-current=step]','.ttops-header h1','.ttops-muted','.ttops-tabs [aria-pressed=true]','.ttagenda strong','.ttagenda small','.ttagenda-all'])await contrast(page.locator(selector),theme+' '+selector)
    const actual=await page.locator('.timetable-card').first().evaluate(e=>getComputedStyle(e).backgroundColor)
    assert.equal(actual,{light:'rgb(255, 255, 255)',warm:'rgb(255, 254, 251)',dark:'rgb(28, 36, 48)'}[theme])
    await page.getByRole('button',{name:/배치·비교/}).click();const primary=page.getByRole('button',{name:'배치 만들기',exact:true});await contrast(primary,theme+' 편성 주 버튼')
    assert.equal(await primary.evaluate(e=>getComputedStyle(e).color),theme==='dark'?'rgb(23, 39, 67)':'rgb(255, 255, 255)')
    await page.getByRole('button',{name:'교환·변경 요청',exact:true}).click();await page.getByLabel('변경할 내 수업',{exact:true}).selectOption('one');await page.getByLabel('교환할 상대 수업',{exact:true}).selectOption('two');await page.getByLabel('변경 요청 사유',{exact:true}).fill('스킨을 바꿔도 보존할 사유')
    await contrast(page.getByLabel('변경 요청 사유',{exact:true}),theme+' 교환 입력');await contrast(page.getByRole('button',{name:'변경 전후 미리보기',exact:true}),theme+' 운영 주 버튼')
    await page.getByRole('button',{name:'변경 전후 미리보기',exact:true}).click();await page.getByRole('region',{name:'수업 변경 미리보기',exact:true}).waitFor();await contrast(page.locator('.timetable-exchange-preview'),theme+' 미리보기');assert.equal(await page.evaluate(()=>window.actualWrites),0)
  })
  await test(theme+' 320px·200% 콘텐츠 확대에서 입력과 주요 조작이 잘리지 않는다',async()=>{
    await page.setViewportSize({width:320,height:900});await settle();await fits(theme+' 320px');await page.getByLabel('변경 요청 사유',{exact:true}).focus();await page.keyboard.press('End');await page.keyboard.type(' 확인');assert.equal(await page.getByLabel('변경 요청 사유',{exact:true}).inputValue(),'스킨을 바꿔도 보존할 사유 확인')
    await shot('timetable-'+theme+'-320')
    // 페이지 확대와 같은 레이아웃 확대를 적용한다. 실제 브라우저 메뉴의 배율 설정과는 구분한다.
    await page.setViewportSize({width:1280,height:1000});await page.locator('.ws-shell').evaluate(e=>{e.style.zoom='2'});await settle();await fits(theme+' 200% 콘텐츠 확대');await contrast(page.getByLabel('변경 요청 사유',{exact:true}),theme+' 확대 입력');await shot('timetable-'+theme+'-zoom200');await page.locator('.ws-shell').evaluate(e=>{e.style.zoom=''});assert.equal(await page.evaluate(()=>window.actualWrites),0)
  })
  await test(theme+' 실제 조회 오류 안내도 스킨 대비를 유지하고 입력을 보존한다',async()=>{
    await page.evaluate(()=>{window.failRead=true;window.refresh();window.editorFail=true;window.editorRefresh()});await page.locator('.ttops-error').first().waitFor();await page.locator('.timetable-error').first().waitFor();await contrast(page.locator('.ttops-error'),theme+' 운영 오류');await contrast(page.locator('.timetable-error'),theme+' 편성 오류');assert.equal(await page.evaluate(()=>window.actualWrites),0)
    await page.evaluate(()=>{window.failRead=false;window.refresh();window.editorFail=false;window.editorRefresh()});await page.getByLabel('변경 요청 사유',{exact:true}).waitFor();assert.equal(await page.getByLabel('변경 요청 사유',{exact:true}).inputValue(),'스킨을 바꿔도 보존할 사유 확인')
  })
}
await test('입력 중 스킨을 즉시 변경해도 원본 수업·상대 수업·사유를 보존한다',async()=>{
  for(const theme of ['light','warm','dark']){await page.locator('.ws-shell').evaluate((e,theme)=>{e.dataset.theme=theme},theme);await settle();assert.equal(await page.getByLabel('변경할 내 수업',{exact:true}).inputValue(),'one');assert.equal(await page.getByLabel('교환할 상대 수업',{exact:true}).inputValue(),'two');assert.equal(await page.getByLabel('변경 요청 사유',{exact:true}).inputValue(),'스킨을 바꿔도 보존할 사유 확인');await contrast(page.getByLabel('변경 요청 사유',{exact:true}),theme+' 즉시 변경 입력')}
  assert.equal(await page.evaluate(()=>window.actualWrites),0)
})
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`시간표 실제 스킨·가독성 브라우저 검사: ${passed}개 통과`)
}finally{await browser.close()}
