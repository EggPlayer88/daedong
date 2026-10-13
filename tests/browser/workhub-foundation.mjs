// 실제 PreviewApp를 서버 없이 실행한다. 오류 주입은 메모리 번들에만 적용한다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const fault='SYNTHETIC_WORKHUB_RENDER_FAULT'
const bundle=await build({stdin:{contents:`
  import React,{useState} from 'react';import{createRoot}from'react-dom/client';
  import{PreviewApp}from'./apps/workhub/src/preview/PreviewApp';
  import{createDemoPersistence}from'./apps/workhub/src/preview/persistence';
  import theme from './apps/workhub/src/style.css?inline';import previewStyles from './apps/workhub/src/preview/preview.css?inline';
  import workflowStyles from './apps/workhub/src/workflows/workflows.css?inline';import studentStyles from './apps/workhub/src/students/students.css?inline';
  const persistence=createDemoPersistence(localStorage);
  function Harness(){const[,update]=useState(0);window.qa={fault(value){window.__qaSummaryFault=value;update(n=>n+1)}};return <><style>{theme}{previewStyles}{workflowStyles}{studentStyles}</style><PreviewApp persistence={persistence}/></>}
  createRoot(document.getElementById('root')).render(<Harness/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'synthetic-module-fault',setup(builder){builder.onLoad({filter:/[\\/]workflows[\\/]WorkflowPanel\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('export function HomeWorkSummary(', 'function ActualHomeWorkSummary(')+`\nexport function HomeWorkSummary(props){if(window.__qaSummaryFault)throw new Error('${fault}');return <ActualHomeWorkSummary {...props}/>}`,loader:'tsx'}))}}]})
const browser=await launchBrowser()
const context=await browser.newContext({viewport:{width:1440,height:1000}})
const page=await context.newPage(), errors=[], results=[]
page.setDefaultTimeout(10000)
page.on('pageerror',error=>errors.push(error.message))
page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
const origin='http://127.0.0.1:5176'
const output=process.env.WORKHUB_QA_OUTPUT
if(output)mkdirSync(output,{recursive:true})
await context.route(`${origin}/**`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`}))
const nav=()=>page.getByRole('navigation',{name:'업무 메뉴'})
async function menu(name){const button=nav().getByRole('button',{name,exact:true});if(!await button.isVisible())await nav().getByRole('button',{name:'더보기',exact:true}).click();await button.click()}
async function screen(name){await page.getByRole('heading',{name,exact:true,level:1}).waitFor()}
async function home(){await page.getByRole('heading',{name:'내 할 일',exact:true}).waitFor()}
async function test(name,action){await action();results.push(name);console.log('  ✓ '+name)}
async function settledNavigation(){await page.waitForFunction(()=>[...document.querySelectorAll('.ws-menu-button')].every(button=>!button.disabled))}
try{
  await page.goto(origin+'/workhub?keep=fixture&view=tasks#preview');await screen('내 업무')
  await test('직접 주소·새로고침은 화면 선택과 다른 query/hash를 유지한다',async()=>{
    await page.reload();await screen('내 업무');assert.equal(new URL(page.url()).searchParams.get('keep'),'fixture');assert.equal(new URL(page.url()).hash,'#preview')
  })
  await test('오늘의 하위 내 업무·업무 수합·나의 수업 메뉴 구조와 현재 위치를 제공한다',async()=>{
    assert.equal(await nav().locator('.ws-group-today').getByRole('button',{name:'내 업무',exact:true}).count(),1)
    assert.equal(await nav().locator('.ws-group-work').getByRole('button',{name:'자료 수합',exact:true}).count(),1)
    assert.equal(await nav().locator('.ws-group-teaching').getByRole('button',{name:'수업과 학생',exact:true}).count(),1)
    assert.equal(await nav().getByRole('button',{name:'내 업무',exact:true}).getAttribute('aria-current'),'page')
    assert.match(await page.getByRole('navigation',{name:'현재 위치'}).innerText(),/오늘[\s\S]*내 업무/)
    for(const title of ['시간표','AI 상담','문서함'])assert.equal(await nav().getByRole('button',{name:title,exact:true}).count(),0)
  })
  await test('메뉴 이동·뒤로·앞으로와 제목 포커스가 실제 페이지와 일치한다',async()=>{
    await menu('학교 일정');await screen('학교 일정');await menu('오늘');await home()
    await page.goBack();await screen('학교 일정');await page.goBack();await screen('내 업무');await page.goForward();await screen('학교 일정')
    assert.equal(new URL(page.url()).searchParams.get('view'),'calendar')
    await page.waitForFunction(()=>document.activeElement?.tagName==='H1')
  })
  await test('홈에서 내 업무 입력 중 일정 CTA·학교·메뉴·뒤로 가기가 초안을 보존한다',async()=>{
    await menu('오늘');await home();await page.getByRole('button',{name:'할 일 등록',exact:true}).click();await page.getByLabel('해야 할 일',{exact:true}).fill('이동해도 사라지면 안 되는 초안')
    for(const button of await nav().locator('.ws-menu-button').all())assert(await button.isDisabled())
    assert(await page.getByRole('combobox',{name:/^학교 선택/}).isDisabled())
    const tools=page.locator('.developer-panel');await tools.locator('summary').click();assert(await page.getByRole('combobox',{name:/^가상 학교/}).isDisabled());assert(await page.getByRole('combobox',{name:/^가상 소속 계정/}).isDisabled())
    await page.getByRole('button',{name:'학교 전체 일정 살펴보기'}).click();await home();assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'이동해도 사라지면 안 되는 초안')
    const before=page.url();await page.goBack();await page.waitForURL(before);await home();assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'이동해도 사라지면 안 되는 초안')
    assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented}),true)
  })
  await test('편집 취소 후 이동·학교 선택·새로고침 경고가 정상 해제된다',async()=>{
    await page.getByRole('button',{name:'편집 취소',exact:true}).click();await settledNavigation();assert.equal(await page.getByRole('combobox',{name:/^학교 선택/}).isDisabled(),false)
    assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented}),false)
    await page.getByRole('button',{name:'학교 전체 일정 살펴보기'}).click();await screen('학교 일정')
  })
  await test('수합 초안 입력은 이동을 잠그고 취소하면 다른 화면으로 이동한다',async()=>{
    await menu('자료 수합');await page.getByRole('button',{name:'+ 수합 만들기',exact:true}).click();await page.getByLabel('수합 제목',{exact:true}).fill('버리지 않을 수합 초안')
    await page.waitForFunction(()=>document.querySelector('.ws-menu-button')?.disabled)
    assert(await page.getByRole('combobox',{name:/^학교 선택/}).isDisabled());assert.equal(await page.getByLabel('수합 제목',{exact:true}).inputValue(),'버리지 않을 수합 초안')
    await page.getByRole('form',{name:'수합 만들기 양식'}).getByRole('button',{name:'취소',exact:true}).click();await settledNavigation();await menu('오늘');await home()
  })
  await test('일정 조회 실패는 빈 목록과 구별되고 다시 불러오기로 복구한다',async()=>{
    await page.getByRole('button',{name:'학교 전체 일정 살펴보기'}).waitFor()
    const tools=page.locator('.developer-panel');if(!await tools.evaluate(node=>node.open))await tools.locator('summary').click()
    await page.getByRole('button',{name:'다음 조회 실패',exact:true}).click();await page.getByRole('heading',{name:'일정을 확인할 수 없어요'}).waitFor()
    await page.locator('.error-state').getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByRole('button',{name:'학교 전체 일정 살펴보기'}).waitFor();assert.equal(await page.getByRole('heading',{name:'일정을 확인할 수 없어요'}).count(),0)
  })
  await test('한 기능의 렌더 오류를 격리하고 원본 삭제 없이 그 기능만 다시 연다',async()=>{
    const before=await page.evaluate(()=>localStorage.getItem('workhub:synthetic:v3:workspace'))
    await page.evaluate(()=>window.qa.fault(true));await page.getByRole('heading',{name:'수합 요약 화면을 표시하지 못했습니다'}).waitFor()
    assert.equal(await page.getByRole('button',{name:'할 일 등록',exact:true}).isEnabled(),true);assert(!(await page.locator('body').innerText()).includes(fault))
    await page.evaluate(()=>window.qa.fault(false));await page.getByRole('button',{name:'이 화면 다시 열기',exact:true}).click();await page.getByRole('heading',{name:'오늘 처리할 수합',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>localStorage.getItem('workhub:synthetic:v3:workspace')),before)
  })
  await test('본문 건너뛰기와 360px 더보기로 모든 화면을 찾고 가로 넘침이 없다',async()=>{
    await page.getByRole('link',{name:'본문으로 건너뛰기'}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'H1')
    await page.setViewportSize({width:360,height:800});assert.equal(await nav().getByRole('button',{name:'수업과 학생',exact:true}).isVisible(),false)
    for(const name of ['오늘','학교 일정','내 업무','자료 수합','수업과 학생']){await menu(name);await page.waitForFunction(()=>!document.querySelector('.loading-state,.task-loading'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name);assert((await nav().locator('.ws-menu-button[aria-current="page"]').textContent()).includes(name));assert.equal(await page.getByRole('heading',{level:1}).textContent(),name);if(output)await page.screenshot({path:join(output,`foundation-mobile-${name}.png`),fullPage:true})}
    await page.setViewportSize({width:1440,height:1000});await menu('오늘');await page.waitForFunction(()=>!document.querySelector('.loading-state,.task-loading'));if(output)await page.screenshot({path:join(output,'foundation-desktop-home.png'),fullPage:true})
  })
  await test('모바일 더보기에서 연속으로 다른 메뉴를 골라도 이전 화면의 닫기가 새 클릭을 취소하지 않는다',async()=>{
    await page.setViewportSize({width:360,height:800})
    // 고정 지연 없이 메뉴를 바로 이어 누른다. 늦은 effect가 다시 연 메뉴를 닫는 회귀를 잡는다.
    for(let round=0;round<12;round++)for(const name of ['자료 수합','수업과 학생']){
      await menu(name)
      assert.equal(await page.getByRole('heading',{level:1}).textContent(),name)
    }
  })
  assert.deepEqual(errors.filter(error=>!error.includes(fault)),[])
  console.log(`기본 구조 브라우저 ${results.length}개 통과`)
  if(output)writeFileSync(join(output,'foundation-browser-results.json'),JSON.stringify({results,expectedFault:fault,unexpectedErrors:errors.filter(error=>!error.includes(fault))},null,2))
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-4500));if(output)await page.screenshot({path:join(output,'foundation-failure.png'),fullPage:true});process.exitCode=1}
finally{await context.close();await browser.close()}
