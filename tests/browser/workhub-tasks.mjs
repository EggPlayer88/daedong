// 서버 비동기 계약을 따르는 합성 어댑터로 실제 내 업무 JSX를 검사한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const bundle = buildSync({ stdin: { contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {TaskPanel} from './apps/workhub/src/tasks/TaskPanel';
  import {TaskError} from './apps/workhub/src/tasks/contracts';
  import {normalizeTaskInput} from './apps/workhub/src/tasks/validation';
  import {fixtureData} from './apps/workhub/src/preview/fixtures';
  const root=createRoot(document.getElementById('root'));
  const clone=value=>structuredClone(value);
  let member=fixtureData.memberships.find(item=>item.id==='gaon-soyeon'),revision=0;
  const other=fixtureData.memberships.find(item=>item.id==='nuri-soyeon');
  const date=fixtureData.basisDate;
  const day=offset=>{const value=new Date(date+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10)};
  const make=(id,title,status='todo',dueDate='',owner=member)=>({id,title,status,dueDate,notes:'합성 메모 '+id,version:1,schoolId:owner.schoolId,ownerMemberId:owner.id});
  let rows=[make('t1','지난 업무','todo',day(-1)),make('t2','오늘 업무','doing',date),make('t3','미래 업무','waiting',day(1)),make('t4','기한 없는 업무'),make('t5','다섯째 업무','todo',day(2)),make('t6','여섯째 업무'),make('done','끝난 업무','done'),make('cancelled','취소한 업무','cancelled'),make('foreign','다른 학교 업무','todo','',other)];
  const receipts=new Map();let serial=0,listRelease,writeRelease;
  const scenario={attempts:[],lists:0,gets:0,more:0,navLocked:false,failList:false,failBefore:false,failAfter:false,deny:false,holdList:false,holdWrite:false,omitConflict:false,
    mutate(id,changes){const index=rows.findIndex(row=>row.id===id);rows[index]={...rows[index],...changes,version:rows[index].version+1}},
    getRows(){return clone(rows)},refresh(){revision++;render()},switchSchool(){member=other;render()},releaseList(){listRelease?.();listRelease=undefined},releaseWrite(){writeRelease?.();writeRelease=undefined},unmount(){root.unmount()},
  };window.scenario=scenario;
  function find(memberId,id){const row=rows.find(row=>row.id===id&&row.ownerMemberId===memberId);if(!row)throw new TaskError('NOT_FOUND','원문 미노출');return row}
  async function change(kind,memberId,id,data,version,key){
    const payload={kind,id,data,version};scenario.attempts.push({memberId,key,payload:clone(payload)});
    if(scenario.holdWrite){scenario.holdWrite=false;await new Promise(resolve=>{writeRelease=resolve})}
    if(scenario.deny)throw new TaskError('FORBIDDEN','SECRET-ERROR');
    if(scenario.failBefore){scenario.failBefore=false;throw new TaskError('SAVE_FAILED','SECRET-ERROR')}
    const receiptKey=memberId+':'+key,previous=receipts.get(receiptKey);
    if(previous){if(JSON.stringify(previous.payload)!==JSON.stringify(payload))throw new TaskError('IDEMPOTENCY_CONFLICT','SECRET-ERROR');return clone(previous.result)}
    let result;
    if(kind==='create'){
      const owner=fixtureData.memberships.find(item=>item.id===memberId);
      result={...normalizeTaskInput(data),id:'new-'+(++serial),schoolId:owner.schoolId,ownerMemberId:owner.id,status:'todo',version:1};rows.push(result);
    }else{
      const original=find(memberId,id);
      if(original.version!==version)throw new TaskError('CONFLICT','SECRET-ERROR',scenario.omitConflict?undefined:clone(original));
      result={...original,...(kind==='update'?normalizeTaskInput(data):{status:data}),version:original.version+1};rows=rows.map(row=>row.id===id?result:row);
    }
    receipts.set(receiptKey,{payload:clone(payload),result:clone(result)});
    if(scenario.failAfter){scenario.failAfter=false;throw new TaskError('SAVE_FAILED','SECRET-ERROR')}
    return clone(result);
  }
  const adapter={
    async list(memberId){scenario.lists++;if(scenario.failList){scenario.failList=false;throw new TaskError('QUERY_FAILED','SECRET-LIST')};const result=clone(rows.filter(row=>row.ownerMemberId===memberId));if(scenario.holdList){scenario.holdList=false;await new Promise(resolve=>{listRelease=resolve})};return result},
    async get(memberId,id){scenario.gets++;if(scenario.failGet){scenario.failGet=false;throw new TaskError('QUERY_FAILED','SECRET-GET')};return clone(find(memberId,id))},
    create:(memberId,input,key)=>change('create',memberId,undefined,input,undefined,key),
    update:(memberId,id,input,version,key)=>change('update',memberId,id,input,version,key),
    setStatus:(memberId,id,status,version,key)=>change('status',memberId,id,status,version,key),
  };
  const lock=locked=>{scenario.navLocked=locked};
  function render(){root.render(<TaskPanel adapter={adapter} member={member} date={date} revision={revision} compact={new URL(location.href).searchParams.has('compact')} onOpenTasks={()=>{scenario.more++}} onNavigationLockChange={lock}/>)}
  render();
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(10000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('dialog', dialog => dialog.accept())
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#f7f8f4}</style><body><div id="root"></div></body></html>' }))
const card = id => page.locator(`[data-task-id="${id}"]`)
const form = () => page.locator('.task-editor')
const title = () => form().locator('[name="task-title"]')
const notes = () => form().locator('[name="task-notes"]')
const due = () => form().locator('[name="task-due"]')
async function boot(compact = false) {
  await page.goto('http://127.0.0.1:5176/tasks-contract-test' + (compact ? '?compact=1' : ''))
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await card('t1').waitFor()
}
async function add(titleValue, noteValue = '', dueValue = '') {
  await page.getByRole('button', { name: '할 일 등록', exact: true }).click()
  await title().fill(titleValue);await notes().fill(noteValue);await due().fill(dueValue)
  await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
}
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function snapshot(name) { if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,name+'.png'),fullPage:true})} }
try {
  await boot()
  assert.equal(await page.locator('.task-card').count(), 6)
  assert.equal(await card('foreign').count(), 0)
  assert.equal(await page.evaluate(() => window.scenario.attempts.length), 0)
  await add('준비 자료 확인', '내 메모 검색어', '2026-12-01')
  await card('new-1').waitFor()
  assert.equal(await page.evaluate(() => window.scenario.navLocked), false)
  await card('new-1').getByRole('button', { name: '수정', exact: true }).click()
  await title().fill('수정한 개인 업무');await due().fill('')
  await page.getByRole('button', { name: '수정 저장', exact: true }).click()
  await card('new-1').getByRole('heading', { name: '수정한 개인 업무', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.scenario.getRows().find(row=>row.id==='new-1').version), 2)
  await page.getByLabel('업무 검색', { exact: true }).fill('검색어')
  assert.equal(await page.locator('.task-card').count(), 1)
  await page.getByLabel('업무 검색', { exact: true }).fill('')
  console.log('  ✓ 서버 비동기 목록·등록·원본 조회 수정·빈 기한·메모 검색·학교 범위')

  await page.getByLabel('상태', { exact: true }).selectOption('all')
  for(const status of ['doing','waiting','done','todo','cancelled']){
    await card('new-1').locator('select').selectOption(status)
    await page.waitForFunction(expected=>window.scenario.getRows().find(row=>row.id==='new-1').status===expected,status)
    await card('new-1').locator('select:not(:disabled)').waitFor()
  }
  await card('new-1').getByRole('button',{name:'다시 시작',exact:true}).click()
  await card('new-1').getByRole('button',{name:'완료',exact:true}).waitFor()
  await card('new-1').getByRole('button',{name:'완료',exact:true}).click()
  await card('new-1').getByRole('button',{name:'다시 시작',exact:true}).waitFor()
  await page.getByLabel('기한 분류',{exact:true}).selectOption('overdue')
  assert.equal(await page.locator('.task-card').count(),1)
  assert.equal(await card('t1').count(),1)
  await page.getByLabel('기한 분류',{exact:true}).selectOption('today')
  assert.equal(await page.locator('.task-card').count(),1)
  assert.equal(await card('t2').count(),1)
  console.log('  ✓ 다섯 상태 변경·완료 재개·기한 지남과 오늘 기한 분류')

  await boot()
  await page.evaluate(()=>{window.scenario.failList=true;window.scenario.refresh()})
  await page.getByText(/업무가 없는 것으로 처리하지 않습니다/).waitFor()
  assert.equal(await page.locator('.task-empty').count(),0)
  assert.equal(await page.locator('.task-card').count(),0)
  await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await card('t1').waitFor()
  console.log('  ✓ 조회 실패는 빈 목록과 구분하고 재조회로 복구')

  await page.evaluate(()=>{window.scenario.failAfter=true})
  await add('응답 유실 확인 업무','보존 메모')
  await page.getByRole('region',{name:'저장 결과 확인 필요'}).waitFor()
  assert.equal(await title().inputValue(),'응답 유실 확인 업무')
  assert.equal(await title().isDisabled(),true)
  assert.equal(await page.evaluate(()=>window.scenario.navLocked),true)
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented}),true)
  await page.getByRole('button',{name:'이전 요청 그대로 다시 확인',exact:true}).click()
  await card('new-1').waitFor()
  const retries=await page.evaluate(()=>window.scenario.attempts)
  assert.equal(retries.length,2);assert.deepEqual(retries[0],retries[1])
  assert.equal(await page.evaluate(()=>window.scenario.getRows().filter(row=>row.title==='응답 유실 확인 업무').length),1)
  assert.equal(await page.evaluate(()=>window.scenario.navLocked),false)
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});dispatchEvent(event);return event.defaultPrevented}),false)
  console.log('  ✓ 응답 유실 후 입력·이동 잠금·같은 payload/key 재시도·중복 생성 없음')

  await boot()
  await page.getByRole('button',{name:'할 일 등록',exact:true}).click()
  await title().fill('😀'.repeat(121));await page.getByRole('button',{name:'내 업무에 추가',exact:true}).click()
  await page.locator('.task-error').waitFor();assert.equal(await page.evaluate(()=>window.scenario.attempts.length),0)
  await title().fill('😀'.repeat(120));await notes().fill('가'.repeat(2000));await page.getByRole('button',{name:'내 업무에 추가',exact:true}).click()
  await card('new-1').waitFor()
  assert.equal(await page.evaluate(()=>Array.from(window.scenario.getRows().find(row=>row.id==='new-1').title).length),120)
  console.log('  ✓ 코드포인트 기준 제목 120자·메모 2,000자와 초과 입력 보존')

  await boot()
  await card('t1').getByRole('button',{name:'수정',exact:true}).click();await title().fill('내가 수정할 제목');await notes().fill('내 변경 메모')
  await page.evaluate(()=>window.scenario.mutate('t1',{title:'다른 창 최신 제목',notes:'최신 메모'}))
  await page.getByRole('button',{name:'수정 저장',exact:true}).click()
  await page.getByRole('region',{name:'업무 변경 내용 비교'}).waitFor()
  assert.equal(await title().inputValue(),'내가 수정할 제목')
  assert.match(await page.locator('.task-comparison').innerText(),/다른 창 최신 제목/)
  assert.match(await page.locator('.task-comparison').innerText(),/내가 수정할 제목/)
  assert.equal(await page.evaluate(()=>window.scenario.attempts.length),1)
  assert.equal(await page.evaluate(()=>window.scenario.navLocked),true)
  await page.getByRole('button',{name:'최신 내용 확인 · 내 변경 다시 적용',exact:true}).click()
  await card('t1').getByRole('heading',{name:'내가 수정할 제목',exact:true}).waitFor()
  const conflicts=await page.evaluate(()=>window.scenario.attempts)
  assert.equal(conflicts[1].payload.version,2);assert.notEqual(conflicts[0].key,conflicts[1].key)
  assert.equal(await page.evaluate(()=>window.scenario.getRows().find(row=>row.id==='t1').version),3)
  console.log('  ✓ 충돌 시 최신·내 입력 비교 후 명시적 재적용만 새 버전 저장')

  await boot()
  await card('t1').getByRole('button',{name:'수정',exact:true}).click();await title().fill('유지할 입력')
  await page.evaluate(()=>{window.scenario.omitConflict=true;window.scenario.mutate('t1',{title:'최신 원본'});})
  await page.getByRole('button',{name:'수정 저장',exact:true}).click()
  await page.evaluate(()=>{window.scenario.failGet=true})
  await page.getByRole('button',{name:'최신 업무 불러오기',exact:true}).click()
  await page.getByText('최신 업무를 확인하지 못했습니다. 내 변경은 보존했습니다. 다시 불러와 주세요.',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.activeElement?.classList.contains('task-error'))
  assert.equal(await title().inputValue(),'유지할 입력')
  await page.getByRole('button',{name:'최신 업무 불러오기',exact:true}).click()
  await page.getByRole('button',{name:'최신 내용 사용',exact:true}).waitFor()
  await page.waitForFunction(()=>document.activeElement?.classList.contains('task-error'))
  await page.getByRole('button',{name:'최신 내용 사용',exact:true}).click()
  await page.waitForFunction(()=>document.activeElement?.name==='task-title')
  assert.equal(await title().inputValue(),'최신 원본')
  assert.equal(await page.evaluate(()=>window.scenario.attempts.length),1)
  await page.getByRole('button',{name:'편집 취소',exact:true}).click()
  console.log('  ✓ 충돌 원본이 없으면 조회 후 선택하며 최신 내용 사용은 자동 저장하지 않음')

  await boot()
  await card('t1').getByRole('button',{name:'수정',exact:true}).click();await title().fill('목록 경합 후 저장')
  await page.evaluate(()=>{window.scenario.holdList=true;window.scenario.refresh()})
  await page.getByText('내 업무를 불러오는 중…',{exact:true}).waitFor()
  assert.equal(await title().inputValue(),'목록 경합 후 저장')
  await page.getByRole('button',{name:'수정 저장',exact:true}).click()
  await card('t1').getByRole('heading',{name:'목록 경합 후 저장',exact:true}).waitFor()
  await page.evaluate(()=>window.scenario.releaseList());await frames()
  assert.equal(await card('t1').getByRole('heading').innerText(),'목록 경합 후 저장')
  console.log('  ✓ focus/revision 재조회는 편집을 보존하고 늦은 목록이 저장 결과를 덮지 않음')

  await boot()
  await card('t1').getByRole('button',{name:'수정',exact:true}).click();await title().fill('옛 원본에서 작성한 입력')
  await page.evaluate(()=>{window.scenario.mutate('t1',{title:'내용이 바뀐 최신 원본'});window.scenario.refresh()})
  await card('t1').getByRole('heading',{name:'내용이 바뀐 최신 원본',exact:true}).waitFor()
  await card('t1').locator('select').selectOption('doing')
  await page.waitForFunction(()=>window.scenario.getRows().find(row=>row.id==='t1').version===3)
  await page.getByRole('button',{name:'수정 저장',exact:true}).click()
  await page.getByRole('region',{name:'업무 변경 내용 비교'}).waitFor()
  assert.equal(await page.evaluate(()=>window.scenario.getRows().find(row=>row.id==='t1').title),'내용이 바뀐 최신 원본')
  console.log('  ✓ 편집 중 최신 업무의 상태를 바꿔도 예전 입력을 자동 재적용하지 않음')

  await boot()
  await page.evaluate(()=>{window.scenario.holdWrite=true})
  await add('이전 학교 지연 저장')
  await page.getByRole('button',{name:'저장 중…',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'저장 중…',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'저장 중…',exact:true}).evaluate(node=>{node.click();node.click()})
  assert.equal(await page.evaluate(()=>window.scenario.attempts.length),1)
  await page.evaluate(()=>window.scenario.switchSchool());await card('foreign').waitFor()
  await page.evaluate(()=>window.scenario.releaseWrite());await frames()
  assert.equal(await page.getByText('이전 학교 지연 저장',{exact:true}).count(),0)
  assert.equal(await form().count(),0)
  assert.equal(await page.evaluate(()=>window.scenario.navLocked),false)
  console.log('  ✓ 중복 제출 차단·소속 변경은 잠금과 무관하게 이전 폼·늦은 저장 결과 폐기')

  await boot()
  await page.evaluate(()=>{window.scenario.deny=true})
  await card('t1').getByRole('button',{name:'완료',exact:true}).click()
  await page.getByText(/이전 업무 화면을 닫았습니다/).waitFor()
  assert.equal(await page.locator('.task-card').count(),0);assert.equal(await form().count(),0)
  assert(!/SECRET/.test(await page.locator('body').innerText()))
  console.log('  ✓ 확정 권한 거부 시 업무 목록과 입력 폐기·서버 원문 미노출')

  await boot(true)
  assert.equal(await page.locator('.task-card').count(),4)
  assert.equal(await card('done').count(),0);assert.equal(await card('cancelled').count(),0)
  await page.getByRole('button',{name:'모든 내 업무 보기',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.scenario.more),1)
  await add('홈에서 등록한 업무');await page.waitForFunction(()=>window.scenario.getRows().some(row=>row.title==='홈에서 등록한 업무'))
  assert.equal(await page.locator('.task-card').count(),4)
  console.log('  ✓ 홈은 열린 업무 4개·더보기·등록을 제공하고 완료·취소 업무 제외')

  await page.setViewportSize({width:360,height:800});await boot()
  await card('t1').getByRole('button',{name:'수정',exact:true}).click();await title().fill('모바일에서 유지할 입력')
  await page.evaluate(()=>window.scenario.mutate('t1',{title:'최신 원본의 긴 제목 '.repeat(7).trim()}))
  await page.getByRole('button',{name:'수정 저장',exact:true}).click();await page.getByRole('region',{name:'업무 변경 내용 비교'}).waitFor()
  await page.locator('.task-comparison').waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await snapshot('tasks-mobile-conflict')
  await page.setViewportSize({width:1280,height:1000});await snapshot('tasks-desktop-conflict')
  assert.deepEqual(errors,[])
  console.log('  ✓ 360px 충돌 비교·입력 폼 가로 넘침 없음·console/page 오류 없음')
} catch(error) {console.error(error);console.error((await page.locator('body').innerText()).slice(-2500));process.exitCode=1}
finally {await context.close();await browser.close()}
