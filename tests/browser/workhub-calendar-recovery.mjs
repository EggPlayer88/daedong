// 합성 저장소가 실제로 접수한 뒤 응답만 잃도록 하여 일정 재확인 UI를 검증한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'
const bundle = buildSync({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {EventEditor} from './apps/workhub/src/calendar/EventEditor';
  import {createEditDrafts,EditDraftsProvider} from './apps/workhub/src/app/edit-drafts';
  import {recoveryScope} from './apps/workhub/src/app/pending-requests';
  import {ContractError} from './apps/workhub/src/contracts';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  import styles from './apps/workhub/src/style.css?inline';
  const root=createRoot(document.getElementById('root'));
  const member=fixtureData.memberships.find(item=>item.id==='gaon-minjun');
  const drafts=createEditDrafts(),scope=recoveryScope(member);
  const memory=createMemoryAdapter(fixtureData,0);let visible=false,original,generation=0,release;
  const clone=value=>structuredClone(value);
  const scenario={attempts:[],saved:[],closed:0,failAfter:0,failBefore:0,rejectCode:'',holdNext:false,plainError:false,discarded:0,
    open(kind='create'){drafts.clear();drafts.activate(scope);scenario.discarded=0;memory.reset();scenario.attempts=[];scenario.saved=[];scenario.closed=0;scenario.failAfter=0;scenario.failBefore=0;scenario.rejectCode='';scenario.holdNext=false;scenario.plainError=false;original=kind==='update'?clone(fixtureData.events.find(item=>item.id==='fixture-event-morning')):undefined;visible=true;generation++;render()},
    remount(){visible=true;generation++;render()},draftSnapshot(){return drafts.bind(scope,'calendar-editor').initial},
    snapshot(){return memory.exportState()},release(){release?.();release=undefined},
    concurrent(){return memory.simulateConcurrentEdit(member.id,'fixture-event-morning')},
  };window.scenario=scenario;
  const adapter={list:id=>memory.list(id),get:(id,event)=>memory.get(id,event),async save(memberId,command){
    scenario.attempts.push({memberId,command:clone(command)});
    if(scenario.holdNext){scenario.holdNext=false;await new Promise(resolve=>{release=resolve})}
    if(scenario.rejectCode){const code=scenario.rejectCode;scenario.rejectCode='';throw new ContractError(code,'합성 서버의 확정 거부: '+code)}
    if(scenario.failBefore){scenario.failBefore--;throw new ContractError('SAVE_FAILED','합성 전송 실패: 저장 전')}
    const result=await memory.save(memberId,command);
    if(scenario.failAfter){scenario.failAfter--;if(scenario.plainError)throw new Error('합성 응답 유실');throw new ContractError('SAVE_FAILED','합성 전송 실패: 접수 후 응답 유실')}
    return result;
  }};
  function render(){root.render(<EditDraftsProvider store={drafts}><style>{styles}</style><h1>일정 접수 복구 합성 시험</h1><output aria-label="성공 통지 수">{scenario.saved.length}</output>{visible&&<EventEditor key={generation} original={original} member={member} members={fixtureData.memberships} date={fixtureData.basisDate} adapter={adapter} relationLabels={relationLabels} onDiscard={()=>{scenario.discarded++;original=undefined}} onClose={()=>{scenario.closed++;visible=false;render()}} onSaved={event=>{scenario.saved.push(clone(event));visible=false;render()}}/>}</EditDraftsProvider>)}render();
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await context.newPage()
const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('http://127.0.0.1:5176/calendar-recovery-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
async function open(kind = 'create') { await page.evaluate(value => window.scenario.open(value), kind); await page.getByRole('dialog').waitFor() }
async function title(text) { await page.locator('input[name=title]').fill(text) }
async function save(kind = 'create') { await page.getByRole('dialog').getByRole('button', { name: kind === 'update' ? '수정 저장' : '일정 등록', exact: true }).click() }
async function pending() { await page.getByRole('region', { name: '일정 저장 결과 확인 필요' }).waitFor() }
async function retry() { await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).click() }
async function snapshot() { return page.evaluate(() => window.scenario.snapshot()) }
async function attempts() { return page.evaluate(() => window.scenario.attempts) }
async function report(message) { assert.deepEqual(errors, []); console.log(`  ✓ ${message}`) }
try {
  await page.goto('http://127.0.0.1:5176/calendar-recovery-test'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await open(); await title('응답이 사라진 새 일정')
  const initial = (await snapshot()).data.events.length
  await page.evaluate(() => { window.scenario.failAfter=1;window.scenario.plainError=true })
  await save(); await pending()
  let state = await snapshot()
  assert.equal(state.data.events.length, initial + 1); assert.equal(state.receipts.length, 1)
  assert.equal(state.data.events.filter(event => event.title === '응답이 사라진 새 일정').length, 1)
  assert.equal(await page.locator('input[name=title]').isDisabled(), true)
  assert.equal(await page.getByLabel('안내 내용', { exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '취소', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '일정 편집 닫기', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: '일정 등록', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1)
  assert.equal(await page.evaluate(() => window.scenario.closed), 0)
  await page.locator('form').evaluate(form => form.requestSubmit())
  assert.equal((await attempts()).length, 1)
  await report('저장 완료 후 응답 유실이면 원본·접수는 1건이며 입력·취소·Esc·새 제출을 차단')

  await page.evaluate(() => { window.scenario.holdNext=true }); await retry()
  await page.waitForFunction(() => window.scenario.attempts.length === 2)
  assert.equal(await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).evaluate(button => { button.click();button.click() })
  assert.equal((await attempts()).length, 2)
  await page.evaluate(() => window.scenario.release()); await page.getByRole('dialog').waitFor({ state: 'detached' })
  state = await snapshot(); const creationAttempts = await attempts()
  assert.deepEqual(creationAttempts[0], creationAttempts[1])
  assert.equal(state.data.events.length, initial + 1); assert.equal(state.receipts.length, 1)
  assert.equal(state.data.events.find(event => event.title === '응답이 사라진 새 일정').version, 1)
  assert.equal(await page.evaluate(() => window.scenario.saved.length), 1)
  await report('재확인은 입력·멱등 키가 완전히 같고 중복 클릭에도 추가 등록·성공 통지가 없음')

  await open('update'); await title('응답이 사라진 일정 수정')
  await page.evaluate(() => { window.scenario.failAfter=1 }); await save('update'); await pending()
  assert.equal((await snapshot()).data.events.find(event => event.id === 'fixture-event-morning').version, 2)
  await retry(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  state = await snapshot(); const updateAttempts = await attempts()
  assert.deepEqual(updateAttempts[0], updateAttempts[1])
  assert.equal(state.data.events.length, initial); assert.equal(state.receipts.length, 1)
  assert.equal(state.data.events.find(event => event.id === 'fixture-event-morning').version, 2)
  await report('수정 응답 유실의 재확인에서도 원본 version이 두 번 증가하지 않음')

  await open(); await title('저장 전에 끊긴 일정')
  await page.evaluate(() => { window.scenario.failBefore=1 }); await save(); await pending()
  assert.equal((await snapshot()).data.events.length, initial); assert.equal((await snapshot()).receipts.length, 0)
  await retry(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  state = await snapshot(); const beforeAttempts = await attempts()
  assert.deepEqual(beforeAttempts[0], beforeAttempts[1])
  assert.equal(state.data.events.length, initial + 1); assert.equal(state.receipts.length, 1)
  await report('저장 전 전송 실패도 같은 요청으로 재시도하여 최종 원본·접수 각 1건')

  for (const code of ['INVALID_INPUT', 'NOT_FOUND']) {
    await open(); await title(`확정 거부 ${code}`)
    await page.evaluate(() => { window.scenario.failBefore=1 }); await save(); await pending()
    await page.evaluate(value => { window.scenario.rejectCode=value }, code); await retry()
    await page.getByRole('region', { name: '일정 저장 결과 확인 필요' }).waitFor({ state: 'detached' })
    assert.equal(await page.locator('input[name=title]').isDisabled(), false)
    assert.equal(await page.locator('input[name=title]').inputValue(), `확정 거부 ${code}`)
    assert.equal(await page.getByRole('button', { name: '취소', exact: true }).isDisabled(), false)
    assert.equal((await snapshot()).data.events.length, initial); assert.equal((await snapshot()).receipts.length, 0)
    await page.getByRole('button', { name: '취소', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  }
  await report('입력 오류·원본 없음은 미확정 잠금을 해제하고 입력 확인·취소 허용')

  for (const code of ['FORBIDDEN', 'INACTIVE_MEMBERSHIP']) {
    await open(); await title(`확정 권한 거부 ${code}`)
    await page.getByLabel('안내 내용', { exact: true }).fill('폐기해야 할 미저장 내용')
    await page.evaluate(() => { window.scenario.failBefore=1 }); await save(); await pending()
    await page.evaluate(value => { window.scenario.rejectCode=value }, code); await retry()
    await page.getByRole('dialog', { name: '보관한 일정 입력 확인', exact: true }).waitFor()
    assert.equal(await page.locator('input[name=title]').count(), 0)
    assert.equal(await page.getByLabel('안내 내용', { exact: true }).count(), 0)
    assert.ok(!(await page.locator('body').innerText()).includes('폐기해야 할 미저장 내용'))
    assert.equal(await page.evaluate(() => window.scenario.draftSnapshot()), undefined)
    assert.equal(await page.evaluate(() => window.scenario.discarded), 1)
    assert.equal((await snapshot()).data.events.length, initial); assert.equal((await snapshot()).receipts.length, 0)
    await page.evaluate(() => window.scenario.remount())
    await page.getByRole('dialog', { name: '일정 등록', exact: true }).waitFor()
    assert.equal(await page.locator('input[name=title]').inputValue(), '')
    assert.equal(await page.getByLabel('안내 내용', { exact: true }).inputValue(), '')
    assert.equal((await attempts()).length, 2)
    await page.getByRole('button', { name: '취소', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  }
  await report('확정 권한 거부는 입력 DOM·보관 초안을 폐기하고 부모에 알리며 같은 탭 재마운트에서도 재등장하지 않음')

  await open(); await title('입력 오류 후 정정')
  await page.evaluate(() => { window.scenario.rejectCode='INVALID_INPUT' }); await save(); await page.getByRole('alert').waitFor()
  await title('오류를 고친 일정'); await save(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  const corrected = await attempts()
  assert.notEqual(corrected[0].command.idempotencyKey, corrected[1].command.idempotencyKey)
  assert.equal((await snapshot()).receipts.length, 1)
  await report('확정된 입력 거부 뒤 내용을 고치면 새 명령·새 키로 한 번만 저장')

  await open('update'); await title('내 충돌 수정안')
  await page.evaluate(() => { window.scenario.failBefore=1 }); await save('update'); await pending()
  await page.evaluate(() => window.scenario.concurrent()); await retry()
  await page.getByRole('heading', { name: '원본이 v2으로 바뀌었습니다', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '일정 저장 결과 확인 필요' }).count(), 0)
  assert.equal(await page.locator('input[name=title]').inputValue(), '내 충돌 수정안')
  assert.equal(await page.getByRole('button', { name: '수정 저장', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '변경 확인 · 내 입력 유지', exact: true }).click()
  await save('update'); await page.getByRole('dialog').waitFor({ state: 'detached' })
  const conflicted = await attempts(); state = await snapshot()
  assert.equal(conflicted.length, 3); assert.deepEqual(conflicted[0], conflicted[1])
  assert.notEqual(conflicted[1].command.idempotencyKey, conflicted[2].command.idempotencyKey)
  assert.equal(conflicted[2].command.expectedVersion, 2)
  assert.equal(state.data.events.find(event => event.id === 'fixture-event-morning').version, 3)
  assert.equal(state.receipts.length, 1)
  await report('확인 재시도 중 version 충돌은 별도 비교로 전환하고 사람 확인 뒤 새 키·최신 version으로 저장')

  await open(); await title('여러 미확정 오류에도 원래 명령 보존')
  for (const code of ['QUERY_FAILED', 'CANCELLED', 'IDEMPOTENCY_CONFLICT']) {
    await page.evaluate(value => { window.scenario.rejectCode=value }, code)
    if ((await attempts()).length) await retry(); else await save()
    await page.getByRole('alert').filter({ hasText: code }).waitFor(); await pending()
    assert.equal(await page.locator('input[name=title]').isDisabled(), true)
  }
  await retry(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  const uncertain = await attempts()
  assert.equal(uncertain.length, 4)
  for (const attempt of uncertain) assert.deepEqual(attempt, uncertain[0])
  assert.equal((await snapshot()).receipts.length, 1)
  await report('결과를 확정할 수 없는 오류는 입력·취소를 계속 막고 최초 요청을 끝까지 유지')
} catch (error) {
  console.error(error); console.error((await page.locator('body').innerText()).slice(-2500)); process.exitCode=1
} finally { await context.close(); await browser.close() }
