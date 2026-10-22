// 실제 TaskPanel과 합성 읽기 어댑터로 원본 이동·지연 응답을 검사한다. 운영 서버에 접속하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'

const bundle = buildSync({ stdin: { contents: `
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {TaskPanel} from './apps/workhub/src/tasks/TaskPanel';
  import {TaskError} from './apps/workhub/src/tasks/contracts';
  import {fixtureData} from './apps/workhub/src/preview/fixtures';
  const members=fixtureData.memberships,owner=members.find(m=>m.id==='gaon-soyeon'),other=members.find(m=>m.id==='nuri-soyeon');
  const date=fixtureData.basisDate;
  let releaseGet,releaseList;
  const make=(id,dueDate='',status='todo')=>({id,title:'합성 '+id,notes:'메모',dueDate,status,version:1,schoolId:owner.schoolId,ownerMemberId:owner.id});
  let rows=[make('today',date),make('done','','done'),make('later','2027-01-01')];
  const qa={holdGet:false,holdList:false,fail:'',gets:0,
    releaseGet(){releaseGet?.();releaseGet=undefined},releaseList(){releaseList?.();releaseList=undefined},
    remove(id){rows=rows.filter(r=>r.id!==id)},
  };window.qa=qa;
  const adapter={
    async list(memberId){const result=structuredClone(rows.filter(r=>r.ownerMemberId===memberId));if(qa.holdList){qa.holdList=false;await new Promise(r=>releaseList=r)}return result},
    async get(memberId,id){qa.gets++;const result=structuredClone(rows.find(r=>r.id===id&&r.ownerMemberId===memberId));if(qa.holdGet){qa.holdGet=false;await new Promise(r=>releaseGet=r)}if(qa.fail)throw new TaskError(qa.fail,'SECRET');if(!result)throw new TaskError('NOT_FOUND','SECRET');return result},
  };
  function App(){const[request,setRequest]=useState(),[member,setMember]=useState(owner),[revision,setRevision]=useState(0),[locked,setLocked]=useState(false);
    qa.open=value=>setRequest(value);qa.refresh=()=>setRevision(v=>v+1);qa.switch=()=>{setMember(other);setRequest(undefined)};
    return <><button type="button" disabled={locked} onClick={()=>setRequest({key:'open-done',taskId:'done'})}>완료 업무 원본 열기</button><TaskPanel member={member} date={date} adapter={adapter} revision={revision} openRequest={request} onNavigationLockChange={setLocked}/></>;
  }
  createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text

const browser = await launchBrowser()
const page = await browser.newPage()
const errors = [], results = []
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
try {
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: bundle })
  await page.getByText('현재 분류 2개', { exact: true }).waitFor()

  await test('기한 이동 요청은 기존 검색·상태·기한 필터를 초기화한다', async () => {
    await page.getByLabel('업무 검색', { exact: true }).fill('없는 검색')
    await page.getByLabel('상태', { exact: true }).selectOption('done')
    await page.getByLabel('기한 분류', { exact: true }).selectOption('none')
    await page.evaluate(() => qa.open({ key: 'due', dueFilter: 'today' }))
    await page.getByText('현재 분류 1개', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('업무 검색', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('상태', { exact: true }).inputValue(), 'open')
    assert.equal(await page.getByLabel('기한 분류', { exact: true }).inputValue(), 'today')
  })
  await test('production에서 필터 초기화와 원본 응답의 commit 순서가 달라도 초점을 이동한다', async () => {
    const before = await page.evaluate(() => qa.gets)
    await page.getByRole('button', { name: '완료 업무 원본 열기', exact: true }).click()
    await page.locator('[data-task-id="done"].task-card-highlighted').waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-task-id') === 'done')
    assert.equal(await page.getByRole('form').count(), 0)
    assert.equal(await page.getByLabel('상태', { exact: true }).inputValue(), 'all')
    assert.equal(await page.getByLabel('기한 분류', { exact: true }).inputValue(), 'all')
    assert.equal(await page.evaluate(() => qa.gets), before + 1)
  })
  await test('이전 원본의 늦은 응답이 새 이동 요청의 강조를 덮지 않는다', async () => {
    await page.evaluate(() => { qa.holdGet = true; qa.open({ key: 'old', taskId: 'today' }) })
    await page.getByText('업무 원본을 확인하는 중…', { exact: true }).waitFor()
    await page.evaluate(() => qa.open({ key: 'new', taskId: 'later' }))
    await page.locator('[data-task-id="later"].task-card-highlighted').waitFor()
    await page.evaluate(() => qa.releaseGet())
    assert.equal(await page.locator('[data-task-id="today"].task-card-highlighted').count(), 0)
    assert.equal(await page.locator('[data-task-id="later"].task-card-highlighted').count(), 1)
  })
  await test('NOT_FOUND 뒤 늦게 끝난 목록도 삭제된 검색 원본을 되살리지 않는다', async () => {
    await page.locator('[data-task-id="today"]').evaluate(node => { window.keptTaskCard = node })
    await page.evaluate(() => { qa.holdList = true; qa.refresh() })
    await page.getByText('내 업무 확인 중', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.keptTaskCard.isConnected), true)
    await page.evaluate(() => { qa.remove('today'); qa.open({ key: 'gone', taskId: 'today' }) })
    await page.getByText('찾은 업무가 없거나 현재 소속으로 확인할 수 없습니다. 최신 목록에서 다시 찾아 주세요.', { exact: true }).waitFor()
    await page.evaluate(() => qa.releaseList())
    await page.waitForFunction(() => !document.body.innerText.includes('내 업무 확인 중'))
    await page.getByText('현재 분류 2개', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-task-id="today"]').count(), 0)
    assert(!await page.locator('body').innerText().then(value => value.includes('SECRET')))
  })
  await test('학교가 바뀌면 이전 원본의 지연 응답을 폐기하고 화면 오류가 없다', async () => {
    await page.evaluate(() => { qa.holdGet = true; qa.open({ key: 'end-scope', taskId: 'later' }) })
    await page.getByText('업무 원본을 확인하는 중…', { exact: true }).waitFor()
    await page.evaluate(() => qa.switch())
    await page.evaluate(() => qa.releaseGet())
    await page.getByText('현재 분류 0개', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-task-id="later"]').count(), 0)
    assert.equal(await page.locator('.task-card-highlighted').count(), 0)
    assert.deepEqual(errors, [])
  })
  console.log(`\n개인 업무 원본 이동 브라우저 ${results.length}개 통과`)
} catch (error) {
  console.error(error)
  console.error((await page.locator('body').innerText()).slice(-3500))
  process.exitCode = 1
} finally { await browser.close() }
