// 실제 React 화면과 현재 탭 복구 저장소를 합성 서버에 연결한다. 운영 DB에는 접근하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SchoolRosterPanel}from'./apps/workhub/src/setup/SchoolRosterPanel';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
import{ServiceError}from'./apps/workhub/src/services/scoped-rpc';
const member={id:'manager',userId:'user-one',schoolId:'school-one',name:'관리자',role:'school_admin',active:true,validFrom:'2026-01-01',validThrough:null,departmentIds:[],gradeIds:[],subjectIds:[]};
const uid='00000000-0000-0000-0000-000000000002';
window.calls=[];window.pending=createPendingRequests();const memory=createEditDrafts();const receipts=new Map();const closed=new Set();
const data={available:true,reason:null,version:1,asOfDate:'2026-10-20',candidates:[{legacyUserId:uid,name:'연결 교사',memberId:null,state:'unlinked'}],teachers:[]};
const server={
 async get(){return window.scenario==='missing'?{...data,available:false,reason:'not_configured',candidates:[],teachers:[]}:structuredClone(data)},
 async preview(id,intent){window.calls.push({stage:'preview',intent});return{previewId:'preview-one',fingerprint:'a'.repeat(64),expiresAt:new Date(Date.now()+(window.scenario==='expired'?-1000:600000)).toISOString(),intent,allowed:true,items:[{legacyUserId:uid,name:'연결 교사',outcome:'link',memberId:null}]}},
 async commit(id,command,key){window.calls.push({stage:'commit',command:structuredClone(command),key});if(closed.has(key))throw new ServiceError('CONFLICT');if(receipts.has(key))return structuredClone(receipts.get(key));if(window.scenario==='not_sent'){window.scenario='conflict';throw new ServiceError('RESULT_UNKNOWN')}if(window.scenario==='conflict')throw new ServiceError('CONFLICT');const receipt={requestKey:key,version:2,recordedAt:new Date().toISOString(),items:[{legacyUserId:uid,memberId:'new-member',outcome:'linked'}]};receipts.set(key,receipt);if(window.scenario==='unknown'){window.scenario='';throw new ServiceError('RESULT_UNKNOWN')}return receipt;},
 async close(id,command,key){window.calls.push({stage:'close',command:structuredClone(command),key});if(window.scenario==='close_not_sent'){window.scenario='';throw new ServiceError('RESULT_UNKNOWN')}if(receipts.has(key))return{requestKey:key,outcome:'applied',receipt:structuredClone(receipts.get(key))};closed.add(key);if(window.scenario==='close_unknown'){window.scenario='';throw new ServiceError('RESULT_UNKNOWN')}return{requestKey:key,outcome:'closed',receipt:null};}
};
function App(){const[show,setShow]=useState(true);window.show=setShow;return<EditDraftsProvider store={memory}><PendingRequestsProvider store={window.pending}>{show&&<SchoolRosterPanel connection={{}} member={member} date="2026-10-20" server={server} onNavigationLockChange={value=>window.locked=value}/>}</PendingRequestsProvider></EditDraftsProvider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext(), page = await context.newPage(), errors = []
page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message))
await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:5179/') ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body><div id="root"></div></body></html>' }) : route.abort())
async function start(scenario = '') {
  await page.goto('http://127.0.0.1:5179/roster')
  await page.evaluate(value => { window.scenario = value }, scenario); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('heading', { name: '가입 교사 연결' }).waitFor()
}
async function select() { await page.getByRole('checkbox').first().check(); await page.getByLabel('연결 근거').fill('재직 확인 명단 대조'); await page.getByRole('button', { name: '연결 내용 미리보기', exact: true }).click(); await page.getByRole('heading', { name: '연결할 교사 확인' }).waitFor() }
async function confirm() { await page.getByLabel('선택한 교사의 재직과 소속 기간을 확인했습니다.').check(); await page.getByRole('button', { name: '확인한 교사 연결', exact: true }).click() }
let passed = 0
async function test(name, fn, scenario) { await start(scenario); await fn(); passed++; console.log('  ✓ ' + name) }
try {
  await test('설치 전에는 명단과 저장 버튼을 보여주지 않음', async () => {
    await page.getByText(/학교별 교사 연결 명단을 준비 중/).waitFor()
    assert.equal(await page.getByRole('button', { name: '확인한 교사 연결' }).count(), 0)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  }, 'missing')
  await test('명단 선택·기간·근거와 최종 확인을 거쳐서만 저장', async () => {
    await select(); assert.equal(await page.evaluate(() => window.calls.filter(x => x.stage === 'commit').length), 0)
    assert.equal(await page.getByRole('button', { name: '확인한 교사 연결' }).isDisabled(), true)
    await confirm(); await page.getByText(/교사 1명의 소속 연결을 확인/).waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await test('응답 단절·재마운트 후 기존 요청 번호와 원문으로 복구', async () => {
    await select(); await confirm(); await page.getByRole('button', { name: '같은 요청으로 결과 확인' }).waitFor()
    const first = await page.evaluate(() => window.calls.find(x => x.stage === 'commit'))
    await page.evaluate(() => window.show(false)); await page.getByRole('heading', { name: '가입 교사 연결' }).waitFor({ state: 'detached' }); await page.evaluate(() => window.show(true))
    await page.getByRole('button', { name: '같은 요청으로 결과 확인' }).click(); await page.getByText(/교사 1명의 소속 연결을 확인/).waitFor()
    const writes = await page.evaluate(() => window.calls.filter(x => x.stage === 'commit')); assert.deepEqual(writes[1], first)
  }, 'unknown')
  await test('확정 거절은 입력을 보존하고 새 미리보기로 재검토', async () => {
    await select(); await confirm(); await page.getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('연결 근거').inputValue(), '재직 확인 명단 대조')
    assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await page.getByRole('heading', { name: '연결할 교사 확인' }).count(), 0)
  }, 'conflict')
  await test('만료 미리보기는 쓰기를 보내지 않음', async () => {
    await select(); await page.getByLabel('선택한 교사의 재직과 소속 기간을 확인했습니다.').check()
    await page.getByText(/확인 기한이 지났습니다/).waitFor()
    assert.equal(await page.getByRole('button', { name: '확인한 교사 연결' }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.calls.filter(x => x.stage === 'commit').length), 0)
  }, 'expired')
  await test('미확정 뒤 거절이 반복되어도 명시적 종료 전에는 잠금을 풀지 않고 원키로 닫음', async () => {
    await select(); await confirm()
    await page.getByRole('button', { name: '같은 요청으로 결과 확인' }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 1)
    assert.equal(await page.getByLabel('연결 근거').isDisabled(), true)
    await page.getByText('이 요청 종료', { exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '서버에서 요청 종료 확인' }).isDisabled(), true)
    await page.getByLabel('이 요청을 종료하고 입력을 다시 확인하겠습니다.').check()
    await page.getByRole('button', { name: '서버에서 요청 종료 확인' }).click()
    await page.getByText(/이 요청을 종료했습니다/).waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await page.getByLabel('연결 근거').inputValue(), '재직 확인 명단 대조')
    assert.equal(await page.getByRole('heading', { name: '연결할 교사 확인' }).count(), 0)
    const calls = await page.evaluate(() => window.calls.filter(x => ['commit', 'close'].includes(x.stage)))
    assert.equal(calls[0].key, calls[2].key); assert.deepEqual(calls[0].command, calls[2].command)
  }, 'not_sent')
  await test('닫기 응답 단절은 원번호를 보존하고 다시 닫아 서버 종료를 확인한 뒤 해제', async () => {
    await select(); await confirm()
    await page.getByText('이 요청 종료', { exact: true }).click()
    await page.getByLabel('이 요청을 종료하고 입력을 다시 확인하겠습니다.').check()
    await page.evaluate(() => { window.scenario = 'close_unknown' })
    await page.getByRole('button', { name: '서버에서 요청 종료 확인' }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.getByRole('button', { name: '같은 요청으로 종료 확인' }).click()
    await page.getByText(/이 요청을 종료했습니다/).waitFor()
    const calls = await page.evaluate(() => window.calls.filter(x => x.stage === 'close'))
    assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  }, 'not_sent')
  await test('연결과 닫기가 모두 미도달해도 재마운트 뒤에는 연결을 재전송하지 않고 닫기만 확인', async () => {
    await select(); await confirm()
    await page.getByText('이 요청 종료', { exact: true }).click()
    await page.getByLabel('이 요청을 종료하고 입력을 다시 확인하겠습니다.').check()
    await page.evaluate(() => { window.scenario = 'close_not_sent' })
    await page.getByRole('button', { name: '서버에서 요청 종료 확인' }).click()
    await page.getByRole('alert').waitFor()
    await page.evaluate(() => window.show(false))
    await page.getByRole('heading', { name: '가입 교사 연결' }).waitFor({ state: 'detached' })
    await page.evaluate(() => window.show(true))
    assert.equal(await page.getByRole('button', { name: '같은 요청으로 결과 확인' }).count(), 0)
    await page.getByRole('button', { name: '같은 요청으로 종료 확인' }).click()
    await page.getByText(/이 요청을 종료했습니다/).waitFor()
    const calls = await page.evaluate(() => window.calls.filter(x => ['commit', 'close'].includes(x.stage)))
    assert.deepEqual(calls.map(row => row.stage), ['commit', 'close', 'close'])
    assert.deepEqual(calls[1], calls[2])
  }, 'not_sent')
  await test('닫기에서 이미 반영된 접수증을 받으면 완료 결과를 표시하고 입력을 정리', async () => {
    await select(); await confirm()
    await page.getByText('이 요청 종료', { exact: true }).click()
    await page.getByLabel('이 요청을 종료하고 입력을 다시 확인하겠습니다.').check()
    await page.getByRole('button', { name: '서버에서 요청 종료 확인' }).click()
    await page.getByText(/이미 연결된 교사 1명의 원래 결과/).waitFor()
    assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await page.getByLabel('연결 근거').inputValue(), '')
  }, 'unknown')
  assert.deepEqual(errors, [])
  console.log(`학교 교사 연결 브라우저 ${passed}건 통과`)
} finally { await context.close(); await browser.close() }
