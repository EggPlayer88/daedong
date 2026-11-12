import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'

const bundle=buildSync({entryPoints:[fileURLToPath(new URL('./workhub-knowledge-result-events-fixture.tsx',import.meta.url))],bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[],external=[],origin='http://127.0.0.1:5301/'
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await page.route('**/*',r=>{if(!r.request().url().startsWith(origin)){external.push(r.request().url());return r.abort()}return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),label=name=>page.getByLabel(name,{exact:true}),results=()=>page.evaluate(()=>window.qa.results),retry=()=>button('원래 요청 결과 확인')
let count=0
async function check(name,fn){await page.goto(origin);await page.addScriptTag({content:bundle});await page.getByRole('heading',{name:'합성 학교 규정',exact:true}).waitFor();try{await fn();count++;console.log('  ✓ '+name)}catch(e){console.error(await page.locator('body').innerText());throw e}}
async function create(){await button('자료 초안 등록').click();await label('제목').fill('새 자료 제목');await label('근거 위치').fill('합성 근거 위치');await label('확인한 원문').fill('새 초안의 원문 내용')}
async function prepare(action){
 if(action==='create'){await create();return}
 if(action==='retire'){await page.evaluate(()=>{window.qa.sources[0].status='published';window.qa.refresh()});await button('게시 종료').waitFor()}
 await button(action==='update'?'초안 수정':action==='publish'?'게시 검토':'게시 종료').click()
 if(action==='update')await label('제목').fill('정정한 자료 제목');else await label('확인 근거 또는 사유').fill('확인한 게시 처리 근거')
}
const save=action=>button(['create','update'].includes(action)?'초안 저장':'확인한 변경 적용').click()
async function done(n=1){await page.waitForFunction(value=>window.qa.results.length===value&&window.qa.pendingCount()===0,n)}
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function verify(result){const receipt=await page.evaluate(key=>window.qa.receipt(key),result.key);assert.deepEqual(Object.keys(result).sort(),['action','key','kind','recordedAt','scope','sourceId','sourceVersion']);assert.equal(result.kind,'knowledge');assert.equal(result.sourceId,receipt.id);assert.equal(result.sourceVersion,receipt.version);assert.equal(result.recordedAt,receipt.recordedAt);assert.deepEqual(JSON.parse(result.scope).slice(0,3),['user-a','school-a','member-a'])}
async function replay(){const calls=await page.evaluate(()=>window.qa.calls.filter(c=>c.name==='workhub_knowledge_mutate'));assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);assert.equal(await page.evaluate(()=>window.qa.writes),1);await verify((await results())[0])}
try{
 await check('초안 생성·수정·게시·게시 종료를 정확한 원본 판과 실제 명령으로 구분한다',async()=>{
  await create();assert.deepEqual(await results(),[]);await save('create');await done();const id=(await results())[0].sourceId
  const article=()=>page.getByRole('article').filter({has:page.getByRole('heading',{name:/새 자료 제목|정정한 자료 제목/,exact:true})})
  await article().getByRole('button',{name:'초안 수정',exact:true}).click();await label('제목').fill('정정한 자료 제목');await save('update');await done(2)
  await article().getByRole('button',{name:'게시 검토',exact:true}).click();await label('확인 근거 또는 사유').fill('게시 확인');assert.equal((await results()).length,2);await save('publish');await done(3)
  await article().getByRole('button',{name:'게시 종료',exact:true}).click();await label('확인 근거 또는 사유').fill('종료 확인');await save('retire');await done(4)
  const all=await results();assert.deepEqual(all.map(r=>r.action),['create','update','publish','retire']);assert.deepEqual(all.map(r=>r.sourceVersion),[1,2,3,4]);assert(all.every(r=>r.sourceId===id));for(const result of all)await verify(result)
 })
 await check('조회·원문 열기·이력 확인·HWPX 연결 확인은 게시 결과를 만들지 않는다',async()=>{await page.getByText('원문 확인',{exact:true}).click();await button('이전 판 보기').click();await button('연결된 HWPX 원본 확인').click();await page.getByText('이 판에 연결된 원본 파일이 없습니다. 직접 입력한 자료의 본문을 확인해 주세요.',{exact:true}).waitFor();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.qa.writes),0)})
 for(const action of ['create','update','publish','retire'])await check(`${action}: 응답 유실과 편집기억 없는 재진입에도 원래 키·명령으로 복구한다`,async()=>{await prepare(action);await page.evaluate(()=>window.qa.unknown=true);await save(action);await retry().and(page.locator(':enabled')).waitFor();assert.deepEqual(await results(),[]);await page.evaluate(()=>window.qa.remount());await retry().click();await done();assert.equal((await results())[0].action,action);await replay()})
 for(const[field,value,action]of [['requestKey','wrong-key','create'],['recordedAt','invalid-date','create'],['version',2,'create'],['id','other-source','update'],['version',5,'publish']])await check(`잘못된 ${action}/${field} 접수는 결과 없이 원키를 유지한다`,async()=>{await prepare(action);await page.evaluate(([field,value])=>window.qa.badReceipt={[field]:value},[field,value]);await save(action);await retry().and(page.locator(':enabled')).waitFor();assert.deepEqual(await results(),[]);await page.evaluate(()=>window.qa.badReceipt=undefined);await retry().click();await done();await replay()})
 for(const change of ['replaceService','changeDate'])await check(`${change}: 늦은 응답은 원키를 지우지 않고 새 수명에서 재확인한다`,async()=>{await prepare('publish');await page.evaluate(()=>window.qa.hold='mutate');await save('publish');await page.waitForFunction(()=>typeof window.qa.release==='function');await page.evaluate(action=>window.qa[action](),change);await retry().and(page.locator(':enabled')).waitFor();await page.evaluate(()=>window.qa.release());await settle();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.qa.pendingCount()),1);await retry().click();await done();await replay()})
 for(const change of ['hide','changeScope'])await check(`${change}: 이전 화면 응답을 다른 수명의 결과로 알리지 않는다`,async()=>{await prepare('create');await page.evaluate(()=>window.qa.hold='mutate');await save('create');await page.waitForFunction(()=>typeof window.qa.release==='function');await page.evaluate(action=>window.qa[action](),change);await settle();await page.evaluate(()=>window.qa.release());await settle();assert.deepEqual(await results(),[])})
 await check('결과 수신자 교체 후에도 전송 당시 수신자만 호출한다',async()=>{await prepare('create');await page.evaluate(()=>window.qa.hold='mutate');await save('create');await page.waitForFunction(()=>typeof window.qa.release==='function');await page.evaluate(()=>window.qa.changeListener());await settle();await page.evaluate(()=>window.qa.release());await done();assert.deepEqual(await page.evaluate(()=>window.qa.listeners),['original'])})
 await check('결과 콜백 예외와 후속 목록 조회 실패는 실제 접수와 원키 정리를 되돌리지 않는다',async()=>{await prepare('create');await page.evaluate(()=>{window.qa.resultThrows=true;window.qa.failRead=true});await save('create');await done();await page.getByRole('alert').waitFor();assert.equal(await retry().count(),0);await verify((await results())[0])})
 await check('저장 도중 신원이 바뀌면 결과 없이 원래 요청을 보존한다',async()=>{await prepare('create');await page.evaluate(()=>window.qa.hold='mutate');await save('create');await page.waitForFunction(()=>typeof window.qa.release==='function');await page.evaluate(()=>{window.qa.identityRole='admin';window.qa.release()});await retry().and(page.locator(':enabled')).waitFor();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.qa.pendingCount()),1)})
 await check('게시 관리권한 회수는 확인 사유가 있어도 새 게시 명령을 만들지 않는다',async()=>{await prepare('publish');await page.evaluate(()=>{window.qa.canManage=false;window.qa.refresh()});await page.getByText('현재 권한과 자료를 다시 확인할 때까지 편집 내용을 숨겼습니다.',{exact:false}).waitFor();assert.equal(await button('확인한 변경 적용').count(),0);assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.qa.writes),0)})
 await check('명시 서버 거절은 게시 결과를 만들지 않고 입력을 보존한다',async()=>{await prepare('create');await page.evaluate(()=>window.qa.reject='FORBIDDEN');await save('create');await page.getByRole('alert').waitFor();assert.deepEqual(await results(),[]);assert.equal(await page.evaluate(()=>window.qa.pendingCount()),0);assert.equal(await page.evaluate(()=>window.qa.writes),0)})
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`\n학교 자료 결과 브라우저 ${count}건 통과`)
}finally{await browser.close()}
