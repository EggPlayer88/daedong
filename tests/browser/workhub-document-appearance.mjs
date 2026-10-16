import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

// 실제 문서 화면과 업무실 셸을 실행한다. 합성 서비스만 사용하며 운영 요청은 차단한다.
const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{WorkspaceShell}from'./apps/workhub/src/app/WorkspaceShell';
import{DocumentsWorkspace}from'./apps/workhub/src/documents/DocumentsWorkspace';
import{GuidedWorkspace}from'./apps/workhub/src/documents/GuidedWorkspace';
import{KnowledgeImport}from'./apps/workhub/src/knowledge/KnowledgeImport';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
import{ServiceError}from'./apps/workhub/src/services/scoped-rpc';
import documentStyles from'./apps/workhub/src/documents/documents.css?inline';
const member={id:'teacher',userId:'user',schoolId:'school',name:'시험 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
const document={id:'doc',schoolId:'school',ownerMemberId:'teacher',version:1,latestVersion:1,status:'draft',updatedAt:'2026-10-16T00:00:00Z',canEdit:true,origin:null,title:'학교 행사 운영 계획',kind:'event_plan',body:'준비 내용과 역할을 확인합니다.',visibility:'private',sources:[],basisDate:'2026-10-16',studentContext:null};
const documents={async list(){if(window.skinFailure)throw new ServiceError('QUERY_FAILED');return{items:[structuredClone(document)],nextCursor:null,canShare:true}},async get(){return structuredClone(document)},async history(){return[{version:1,status:'draft',recordedAt:document.updatedAt}]}};
const anchor={id:'Contents/section0.xml:p000000',section:'Contents/section0.xml',paragraph:0,sourceText:'참여 인원',sourceHash:'a'.repeat(64),cell:{row:'0',column:'1'}};
const template={id:'template',schoolId:'school',ownerMemberId:'teacher',title:'행사 참여 확인 양식',version:2,state:'draft',inspection:{profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),anchors:[anchor],unsupportedParagraphs:2},mapping:{profile:'explicit_paragraph_v1',templateSha256:'b'.repeat(64),questions:[{id:'q',label:'참여 인원',kind:'number',required:true,maxLength:10,options:[],anchorId:anchor.id,sourceText:anchor.sourceText,sourceHash:anchor.sourceHash}]},collectionRequestId:null,canManage:true};
const guided={async list(){if(window.skinFailure)throw new ServiceError('QUERY_FAILED');return{items:[structuredClone(template)],nextCursor:null,canCreate:true}},async get(){return{template:structuredClone(template),response:null}},async targets(){return[]}};
const result={fileId:'file',fileVersion:1,name:'학교규정.hwpx',extraction:{profile:'hwpx_text_v1',fileSha256:'a'.repeat(64),extractionSha256:'b'.repeat(64),blocks:[{id:'Contents/section0.xml:p000000',locator:'Contents/section0.xml / 문단 1',text:'협의회 확인을 거친 학교규정 원문'}],omittedObjects:1}};
const knowledge={async ready(){if(window.skinFailure)throw new ServiceError('QUERY_FAILED');return true},async prepare(){return{fileId:'file',fileVersion:1,uploaded:false}},async upload(){},async extract(){return structuredClone(result)}};
const content=window.skinMode==='documents'?<DocumentsWorkspace connection={{}} service={documents} member={member} date='2026-10-16'/>:window.skinMode==='guided'?<GuidedWorkspace connection={{}} service={guided} member={member} date='2026-10-16'/>:<KnowledgeImport connection={{}} service={knowledge} member={member} date='2026-10-16' onCreated={()=>{}} onClose={()=>{}}/>;
createRoot(window.document.getElementById('root')).render(<React.StrictMode><EditDraftsProvider store={createEditDrafts()}><PendingRequestsProvider store={createPendingRequests()}><WorkspaceShell page={window.skinMode==='knowledge'?'knowledge':'documents'} onNavigate={()=>{}} mode='connected' schoolName='연결 시험 학교' memberName='시험 교사'><main className='main-content'><style>{documentStyles}</style>{content}</main></WorkspaceShell></PendingRequestsProvider></EditDraftsProvider></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE:'test' }), 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })

const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width:1280,height:900 } }), page = await context.newPage()
const output = process.env.WORKHUB_QA_OUTPUT, errors = [], external = [], results = []
if (output) mkdirSync(output, { recursive:true })
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><body><div id="root"></div></body></html>' })
})
async function start(mode,theme='light',failure=false) {
  await page.goto('http://127.0.0.1:5179/document-skin')
  await page.evaluate(({mode,theme,failure}) => { window.skinMode=mode; window.skinFailure=failure; localStorage.setItem('workhub:appearance:v1',JSON.stringify({theme,density:'comfortable',textSize:'standard'})) },{mode,theme,failure})
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  if (failure) { await page.locator('.main-content [role="alert"]').first().waitFor(); return }
  if (mode==='documents') { await page.getByRole('button',{name:'새 문서 작성',exact:true}).click(); await page.getByLabel('문서 제목',{exact:true}).fill('입력은 스킨 변경 뒤에도 유지합니다'); await page.getByLabel('문서 본문',{exact:true}).fill('교사에게 필요한 내용과 제출 순서를 확인합니다.') }
  else if (mode==='guided') { await page.getByRole('button',{name:/행사 참여 확인 양식/}).click(); await page.getByText(/원본의 입력 가능한 위치 보기/).click(); await page.getByLabel('질문 내용',{exact:true}).waitFor() }
  else { await page.getByLabel('읽어 올 HWPX 파일',{exact:true}).setInputFiles({name:'학교규정.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from([80,75,3,4,1,2,3])}); await page.getByLabel('확인·정리한 본문',{exact:true}).waitFor(); await page.getByText('추출한 원문과 위치 확인',{exact:true}).click() }
}
function luminance(rgb) { const c=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}); return .2126*c[0]+.7152*c[1]+.0722*c[2] }
function contrast(a,b) { const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
async function palette() { return page.locator('.main-content').evaluate(root=>{
  const shell=root.closest('.ws-shell'), token=name=>{const probe=document.createElement('i');probe.style.color='var('+name+')';shell.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value}
  const nodes=selector=>[...root.querySelectorAll(selector)].filter(n=>n.getClientRects().length).map(n=>({text:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor}))
  return{surface:token('--ui-surface'),text:token('--ui-text'),accent:token('--ui-accent'),onAccent:token('--ui-on-accent'),muted:token('--ui-muted'),warning:token('--ui-warning'),warningSoft:token('--ui-warning-soft'),panels:nodes('.documents-panel,.documents-editor'),primary:nodes('.documents-primary:not(:disabled)'),notes:nodes('.documents-muted'),alerts:nodes('.documents-status[role="alert"]')}
}) }
async function shot(name) { if(output)await page.screenshot({path:join(output,name+'.png'),fullPage:true}) }
async function test(name,run) { await run();results.push({name,passed:true});console.log('  ✓ '+name) }
try {
  for (const mode of ['documents','guided','knowledge']) for (const theme of ['dark','light','warm']) {
    await test(mode+' · '+theme+' 스킨의 실제 문서 화면과 대비',async()=>{
      await page.setViewportSize({width:1280,height:900});await start(mode,theme)
      const p=await palette();assert.ok(p.panels.length>0)
      for(const panel of p.panels){assert.equal(panel.background,p.surface,mode+' 패널 배경');assert.equal(panel.text,p.text,mode+' 패널 글자');assert.ok(contrast(panel.text,panel.background)>=4.5)}
      for(const primary of p.primary){assert.equal(primary.background,p.accent);assert.equal(primary.text,p.onAccent);assert.ok(contrast(primary.text,primary.background)>=4.5)}
      for(const note of p.notes)assert.equal(note.text,p.muted)
      assert.ok(contrast(p.muted,p.surface)>=4.5)
      await shot('document-skin-'+mode+'-'+theme)
    })
  }
  for(const theme of ['dark','light','warm'])await test(theme+' 오류 안내가 스킨과 충분한 대비를 유지한다',async()=>{
    await start('documents',theme,true);const p=await palette();assert.ok(p.alerts.length>0);for(const alert of p.alerts){assert.equal(alert.background,p.warningSoft);assert.equal(alert.text,p.warning);assert.ok(contrast(alert.text,alert.background)>=4.5)}
  })
  await test('스킨·간격·글자 설정을 바꿔도 입력을 유지하고 키보드 초점을 돌려준다',async()=>{
    await start('documents');const before=await page.locator('.documents-editor').first().evaluate(n=>parseFloat(getComputedStyle(n).paddingTop))
    await page.getByRole('button',{name:'화면 설정',exact:true}).click();const dialog=page.getByRole('dialog',{name:'화면 설정',exact:true});await dialog.locator('input[value="dark"]').check();await dialog.locator('input[value="compact"]').check();await dialog.locator('input[value="large"]').check();await dialog.getByRole('button',{name:'완료',exact:true}).click()
    assert.equal(await page.getByLabel('문서 제목',{exact:true}).inputValue(),'입력은 스킨 변경 뒤에도 유지합니다');assert.equal(await page.getByRole('button',{name:'화면 설정',exact:true}).evaluate(n=>n===document.activeElement),true)
    assert.ok(await page.locator('.documents-editor').first().evaluate(n=>parseFloat(getComputedStyle(n).paddingTop))<before)
    const title=page.getByLabel('문서 제목',{exact:true});await title.focus();await page.keyboard.press('Tab');const focus=await page.evaluate(()=>{const n=document.activeElement,s=getComputedStyle(n);return{width:parseFloat(s.outlineWidth),style:s.outlineStyle,color:s.outlineColor}});assert.ok(focus.width>=3);assert.equal(focus.style,'solid')
  })
  for(const mode of ['documents','guided','knowledge']) for(const theme of ['dark','light','warm'])await test(mode+' · '+theme+' 320px 및 글자 200%에서 내용·조작이 잘리지 않는다',async()=>{
    await page.setViewportSize({width:320,height:800});await start(mode,theme)
    await page.addStyleTag({content:'.ws-shell{--ui-body-size:28px!important;--ui-small-size:24px!important}.main-content{font-size:28px!important}'})
    assert.ok(await page.locator('.documents-workspace').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize))>=28)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    const action=mode==='documents'?page.getByRole('button',{name:'초안 저장',exact:true}):mode==='guided'?page.getByRole('button',{name:'답변 임시 저장',exact:true}):page.getByRole('button',{name:'확인한 내용으로 자료 초안 만들기',exact:true})
    const box=await action.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=321)
    await shot('document-skin-'+mode+'-'+theme+'-320-text200')
  })
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  if(output)writeFileSync(join(output,'document-appearance-results.json'),JSON.stringify({results,errors,external},null,2))
  console.log('문서 계열 스킨 브라우저 '+results.length+'건 통과')
} catch(error) { await shot('document-skin-failure');if(await page.locator('.main-content').count())console.error(await palette());throw error }
finally { await browser.close() }



