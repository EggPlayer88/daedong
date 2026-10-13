// 실제 개인 업무 화면에 합성 1,000건을 넣어 표시량·원본 이동·편집 보호를 확인한다.
import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const bundle=buildSync({stdin:{contents:`
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TaskPanel}from'./apps/workhub/src/tasks/TaskPanel';
  import{TaskError}from'./apps/workhub/src/tasks/contracts';import{fixtureData}from'./apps/workhub/src/preview/fixtures';import css from'./apps/workhub/src/style.css?inline';
  const members=fixtureData.memberships,owner=members.find(m=>m.id==='gaon-soyeon'),other=members.find(m=>m.id==='nuri-soyeon'),date=fixtureData.basisDate,qa=window.qa={gets:[],failure:'',hold:false};let rows=[],release;
  const make=index=>({id:'scale-'+String(index).padStart(4,'0'),title:'합성 업무 '+String(index).padStart(4,'0'),notes:'개인 메모',dueDate:date,status:'todo',version:1,schoolId:owner.schoolId,ownerMemberId:owner.id});
  function seed(count){rows=Array.from({length:count},(_,index)=>make(index));qa.failure='';qa.hold=false;qa.gets=[]}seed(1000);
  const adapter={async list(memberId){return structuredClone(rows.filter(row=>row.ownerMemberId===memberId))},async get(memberId,id){qa.gets.push(id);const row=rows.find(row=>row.id===id&&row.ownerMemberId===memberId);if(!row)throw new TaskError('NOT_FOUND','합성 조회실패');return structuredClone(row)},
    async setStatus(memberId,id,status){if(qa.hold){qa.hold=false;await new Promise(r=>release=r)}if(qa.failure)throw new TaskError(qa.failure,'합성 저장실패');const row=rows.find(row=>row.id===id&&row.ownerMemberId===memberId);if(!row)throw new TaskError('NOT_FOUND','합성 조회실패');row.status=status;row.version++;return structuredClone(row)},
    async update(memberId,id,input){const row=rows.find(row=>row.id===id&&row.ownerMemberId===memberId);Object.assign(row,input,{version:row.version+1});return structuredClone(row)}
  };
  function App(){const[generation,setGeneration]=useState(0),[revision,setRevision]=useState(0),[member,setMember]=useState(owner),[compact,setCompact]=useState(false),[request,setRequest]=useState(),[locked,setLocked]=useState(false);
    qa.reset=(count=1000)=>{seed(count);setGeneration(v=>v+1);setRevision(0);setMember(owner);setCompact(false);setRequest(undefined);return generation+1};qa.refresh=()=>setRevision(v=>v+1);qa.shrink=count=>{rows=rows.slice(0,count);setRevision(v=>v+1)};qa.open=id=>setRequest({key:crypto.randomUUID(),taskId:id});qa.switch=()=>{setMember(other);setRequest(undefined)};qa.compact=()=>setCompact(true);qa.release=()=>release?.();
    return <><style>{css}</style><main data-generation={generation} data-locked={locked}><TaskPanel key={generation} member={member} date={date} adapter={adapter} compact={compact} revision={revision} openRequest={request} onNavigationLockChange={setLocked}/></main></>
  }createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1050}}),results=[],errors=[],metrics={},output=process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});if(output)mkdirSync(output,{recursive:true})
const nav=()=>page.getByRole('navigation',{name:'내 업무 목록 페이지',exact:true}),cards=()=>page.locator('[data-task-id]')
async function test(name,run){await run();results.push(name);console.log('  ✓ '+name)}
async function settled(){await page.waitForFunction(()=>!document.querySelector('.task-loading'))}
async function reset(count=1000){const generation=await page.evaluate(value=>qa.reset(value),count);await page.waitForFunction(value=>document.querySelector('main').dataset.generation===String(value),generation);await settled()}
async function shot(name){if(output)await page.screenshot({path:join(output,'task-paging-'+name+'.png'),fullPage:true})}
try{
  await page.route('https://workhub.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'}));await page.goto('https://workhub.test/');await page.addScriptTag({content:bundle});await cards().first().waitFor()
  await test('1,000개 업무는 20카드만 표시하면서 전체 건수와 50쪽을 안내한다',async()=>{
    assert.equal(await cards().count(),20);assert.equal(await page.getByText('현재 분류 1000개',{exact:true}).count(),1);assert((await nav().innerText()).includes('1 / 50쪽'));metrics.tasks1000=await page.locator('.task-panel').evaluate(node=>({cards:node.querySelectorAll('[data-task-id]').length,elements:node.querySelectorAll('*').length}));assert(metrics.tasks1000.elements<500);await shot('desktop')
  })
  await test('다음·마지막 쪽은 올바른 업무로 이어지고 키보드 초점을 목록 제목에 둔다',async()=>{
    await nav().getByRole('button',{name:'다음',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('[data-task-id="scale-0020"]').waitFor();assert.equal(await page.locator('.task-list-heading').evaluate(node=>node===document.activeElement),true);await nav().getByRole('button',{name:'마지막',exact:true}).click();await page.locator('[data-task-id="scale-0999"]').waitFor();assert.equal(await cards().count(),20);assert((await nav().innerText()).includes('981–1,000개 표시'));assert(await nav().getByRole('button',{name:'다음',exact:true}).isDisabled())
  })
  await test('뒤쪽에서 검색·상태·기한을 바꾸면 첫 쪽부터 검색 결과를 보여 준다',async()=>{
    await page.getByLabel('업무 검색',{exact:true}).fill('합성 업무 00');await page.locator('[data-task-id="scale-0000"]').waitFor();assert((await nav().innerText()).includes('1 / 5쪽'));await nav().getByRole('button',{name:'마지막',exact:true}).click();await page.getByLabel('상태',{exact:true}).selectOption('all');await page.locator('[data-task-id="scale-0000"]').waitFor();await nav().getByRole('button',{name:'마지막',exact:true}).click();await page.getByLabel('기한 분류',{exact:true}).selectOption('today');await page.locator('[data-task-id="scale-0000"]').waitFor()
  })
  await test('검색 원본이 1,000번째에 있어도 최신 조회 후 해당 쪽·카드에 도착한다',async()=>{
    await page.evaluate(()=>qa.open('scale-0999'));await page.waitForFunction(()=>document.activeElement?.getAttribute('data-task-id')==='scale-0999');assert((await nav().innerText()).includes('50 / 50쪽'));assert.deepEqual(await page.evaluate(()=>qa.gets),['scale-0999']);assert.equal(await page.getByLabel('업무 검색',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('form').count(),0)
  })
  await test('수정 중 모든 쪽 이동을 막고 취소 시 같은 쪽의 수정 버튼으로 돌아온다',async()=>{
    const card=page.locator('[data-task-id="scale-0999"]'),trigger=card.getByRole('button',{name:'수정',exact:true});await trigger.click();await page.getByLabel('해야 할 일',{exact:true}).fill('보존할 입력');for(const name of['처음','이전','다음','마지막'])assert(await nav().getByRole('button',{name,exact:true}).isDisabled());assert.equal(await page.getByLabel('해야 할 일',{exact:true}).inputValue(),'보존할 입력');await page.getByRole('button',{name:'편집 취소',exact:true}).click();assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);assert((await nav().innerText()).includes('50 / 50쪽'))
  })
  await test('마지막 쪽의 유일한 업무 완료 후 앞 쪽으로 보정하고 결과 안내를 읽는다',async()=>{
    await reset(21);await nav().getByRole('button',{name:'마지막',exact:true}).click();assert.equal(await cards().count(),1);await cards().getByRole('button',{name:'완료',exact:true}).click();await settled();await page.getByText('현재 분류 20개',{exact:true}).waitFor();assert.equal(await cards().count(),20);assert.equal(await nav().count(),0);assert.equal(await page.locator('.task-notice').evaluate(node=>node===document.activeElement),true)
  })
  await test('외부 목록 축소 후 마지막 유효 쪽과 빈 목록을 안전하게 표시한다',async()=>{
    // revision 변경 직후에는 이전 화면이 잠시 남으므로 새 목록 응답의 집계부터 확인한다.
    await reset();await nav().getByRole('button',{name:'마지막',exact:true}).click();await page.evaluate(()=>qa.shrink(21));await page.getByText('현재 분류 21개',{exact:true}).waitFor();assert.equal(await cards().count(),1);assert((await nav().innerText()).includes('21–21개 표시'));await page.evaluate(()=>qa.shrink(0));await page.getByText('현재 분류 0개',{exact:true}).waitFor();assert.equal(await cards().count(),0);assert.equal(await nav().count(),0);await page.getByText('아직 등록한 개인 업무가 없습니다.',{exact:true}).waitFor()
  })
  await test('저장 대기·결과 미확정 동안 쪽 이동을 잠그고 같은 요청 재확인 후 풀어 준다',async()=>{
    await reset();await page.evaluate(()=>{qa.hold=true;qa.failure='SAVE_FAILED'});await cards().first().getByRole('button',{name:'완료',exact:true}).click();assert(await nav().getByRole('button',{name:'다음',exact:true}).isDisabled());await page.evaluate(()=>qa.release());await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).waitFor();assert(await nav().getByRole('button',{name:'다음',exact:true}).isDisabled());await page.evaluate(()=>qa.failure='');await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click();await settled();assert(await nav().getByRole('button',{name:'다음',exact:true}).isEnabled())
  })
  await test('320px에서도 쪽 조작·표시 범위를 가로 넘침 없이 읽는다',async()=>{
    await reset();await page.setViewportSize({width:320,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await nav().getByRole('button',{name:'다음',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('[data-task-id="scale-0020"]').waitFor();await shot('320')
  })
  await test('홈 요약은 기존 4개 표시와 전체 기한 집계를 유지한다',async()=>{
    await reset();await page.evaluate(()=>qa.compact());await page.getByRole('heading',{name:'내 할 일',exact:true}).waitFor();assert.equal(await cards().count(),4);assert.equal(await nav().count(),0);assert.equal(await page.getByRole('button',{name:'오늘까지 업무 1000개 보기',exact:true}).count(),1)
  })
  await test('학교 변경은 이전 쪽과 자료를 제거하며 브라우저 오류가 없다',async()=>{
    await reset();await nav().getByRole('button',{name:'마지막',exact:true}).click();await page.evaluate(()=>qa.switch());await page.getByText('현재 분류 0개',{exact:true}).waitFor();assert.equal(await cards().count(),0);assert.equal(await nav().count(),0);assert.deepEqual(errors,[])
  })
  if(output)writeFileSync(join(output,'task-paging-results.json'),JSON.stringify({results,errors,metrics,scope:'합성 1,000건의 실제 React DOM 검사. 서버 조회 성능을 측정하지 않는다.'},null,2));console.log(`개인 업무 목록 페이지 브라우저 ${results.length}개 통과`);console.log(JSON.stringify(metrics))
}catch(error){console.error(error);console.error((await page.locator('body').innerText()).slice(-5000));await shot('failure');process.exitCode=1}finally{await browser.close()}
