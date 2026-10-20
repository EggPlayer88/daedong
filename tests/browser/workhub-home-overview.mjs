// 실제 홈 요약과 어댑터를 합성 RPC로 검사한다. 운영 자료와 외부 서버는 사용하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{HomeOverviewPanel}from'./apps/workhub/src/home/HomeOverviewPanel';
import theme from './apps/workhub/src/style.css?inline';
import home from './apps/workhub/src/calendar/home-dashboard.css?inline';
const member={id:'member',schoolId:'school',userId:'user',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',role:'teacher',departmentIds:[],gradeIds:[],subjectIds:[]};
const root=createRoot(document.getElementById('root'));
window.state={mode:'busy',calls:[],opened:[],revision:0,resolve:()=>{}};
const payload=()=>{const mode=window.state.mode;const items=mode==='busy'?Array.from({length:8},(_,i)=>({id:'item-'+i,kind:'message',title:'원본 업무 '+i,dueDate:null,sourceId:'source-'+i,priority:i===6?'urgent':'normal',label:'메시지 열기'})):[];return{asOf:'2026-10-20T00:00:00Z',items,counts:{collection:0,supplement:0,message:mode==='partial'?null:items.length,student_followup:0,cooperation:0},unavailable:mode==='partial'?['message']:[]}};
const connection={info:()=>({memberships:[member],schools:[{id:'school'}],basisDate:'2026-10-20'}),async getIdentity(){return{userId:'user',approved:true,profile:{role:'superadmin',is_active:true,extra_permissions:[],department_id:null}}},async rpcVerified(name,args){window.state.calls.push({name,args});if(window.state.mode==='failed')throw new Error('합성 조회 실패');if(window.state.mode==='loading')await new Promise(resolve=>window.state.resolve=resolve);return{contract:'home.v1',schoolId:'school',memberId:'member',data:payload()}}};
window.renderHome=()=>root.render(<><style>{theme}{home}</style><div className="ws-shell"><main className="ui-home-main"><div className="home-priority"><HomeOverviewPanel connection={connection} member={member} revision={window.state.revision++} onOpen={item=>window.state.opened.push(item.sourceId)}/></div></main></div></>);
window.renderHome();
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], external = [], passed = []
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
const panel = () => page.getByRole('region', { name: '확인할 학교 업무', exact: true })
async function state(mode) { await page.evaluate(mode => { window.state.mode = mode; window.renderHome() }, mode) }
async function test(name, run) { await run(); passed.push(name); console.log('  ✓ ' + name) }
try {
  await page.goto('http://127.0.0.1:5176/home-overview'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await panel().getByRole('button', { name: '확인할 업무 8개 모두 보기', exact: true }).waitFor()
  await test('처음 네 건과 긴급 업무는 항상 보이며 펼치면 나머지 원본도 정확하게 연다', async () => {
    assert.equal(await panel().locator('.home-overview-items button').count(), 5)
    assert.deepEqual(await panel().locator('.home-overview-title').allTextContents(), ['원본 업무 0', '원본 업무 1', '원본 업무 2', '원본 업무 3', '확인 필요 · 원본 업무 6'])
    await panel().getByRole('button', { name: '확인할 업무 8개 모두 보기', exact: true }).click()
    assert.equal(await panel().locator('.home-overview-items button').count(), 8)
    await panel().getByRole('button', { name: '원본 업무 7 메시지 열기', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.state.opened), ['source-7'])
    await panel().getByRole('button', { name: '업무 목록 접기', exact: true }).click()
    assert.equal(await panel().locator('.home-overview-items button').count(), 5)
  })
  await test('조회 실패와 일부 미확인을 빈 업무로 표시하지 않고 재조회로 회복한다', async () => {
    await state('failed'); await panel().getByRole('alert').waitFor()
    assert.equal(await panel().locator('.home-overview-empty-state').count(), 0)
    assert.match(await panel().innerText(), /0건으로 판단하지 않습니다/)
    await page.evaluate(() => { window.state.mode = 'partial' })
    await panel().getByRole('button', { name: '추가 업무 다시 확인', exact: true }).click()
    await panel().getByText('일부 연결 항목은 확인 중입니다. 확인되지 않은 항목은 건수에 포함하지 않았습니다.', { exact: true }).waitFor()
    assert.equal(await panel().getByText('지금 표시할 추가 업무가 없습니다.', { exact: true }).count(), 0)
    assert.equal(await panel().getAttribute('class').then(value => value.includes('home-overview-empty-state')), false)
  })
  await test('정상 빈 상태는 작은 줄로 표시하고 미완료 조회는 빈 상태가 되지 않는다', async () => {
    await state('empty'); await panel().getByText('지금 표시할 추가 업무가 없습니다.', { exact: true }).waitFor()
    assert.equal(await panel().getAttribute('class').then(value => value.includes('home-overview-empty-state')), true)
    assert((await panel().boundingBox()).height < 160, '정상 빈 홈 업무가 큰 카드로 남지 않습니다')
    await state('loading'); await panel().getByRole('status').waitFor()
    assert.equal(await panel().getAttribute('class').then(value => value.includes('home-overview-empty-state')), false)
    assert.equal(await panel().getByText('지금 표시할 추가 업무가 없습니다.', { exact: true }).count(), 0)
    await page.evaluate(() => { window.state.mode = 'busy'; window.state.resolve() })
    await panel().getByRole('button', { name: '확인할 업무 8개 모두 보기', exact: true }).waitFor()
  })
  await test('확인된 빈 학교 업무는 모바일에서도 작은 요약과 표시 기준을 유지한다', async () => {
    await state('empty'); await panel().getByText('지금 표시할 추가 업무가 없습니다.', { exact: true }).waitFor()
    for (const width of [584, 390, 320]) {
      await page.setViewportSize({ width, height: 760 })
      assert((await panel().boundingBox()).height <= 110, width + 'px 빈 학교 업무가 작은 요약으로 표시됩니다')
      await panel().locator('.home-overview-help>summary').click()
      await panel().getByText('원본에서 제출·검토·처리를 마치면 반영됩니다. 홈에서 읽었다고 완료되지 않습니다.', { exact: true }).waitFor()
      await panel().locator('.home-overview-help>summary').click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    }
    await state('busy'); await panel().getByRole('button', { name: '확인할 업무 8개 모두 보기', exact: true }).waitFor()
  })
  await test('320px 큰 글자에서도 긴급 업무·펼치기·원본 이동을 사용할 수 있다', async () => {
    await page.setViewportSize({ width: 320, height: 760 })
    await page.locator('.ws-shell').evaluate(element => { element.style.setProperty('--ui-body-size', '18px'); element.style.setProperty('--ui-small-size', '16px') })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    const more = panel().getByRole('button', { name: '확인할 업무 8개 모두 보기', exact: true })
    await more.focus(); await page.keyboard.press('Enter')
    assert.equal(await panel().locator('.home-overview-items button').count(), 8)
    await panel().getByRole('button', { name: '확인 필요 · 원본 업무 6 메시지 열기', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.state.opened), ['source-7', 'source-6'])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  assert((await page.evaluate(() => window.state.calls)).every(call => call.name === 'workhub_home_overview'), '홈 표시와 펼치기는 조회 이외 서버 명령을 보내지 않습니다')
  console.log(passed.length + '개 홈 핵심 업무 브라우저 시나리오 통과')
} finally { await browser.close() }
