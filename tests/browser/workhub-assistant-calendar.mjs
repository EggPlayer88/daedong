// 대화 초안은 기존 편집기만 열고, 확인 전에는 저장하지 않는지 실제 React에서 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CalendarPanel} from './apps/workhub/src/calendar/CalendarPanel';
  import {buildAssistantCalendarDraft} from './apps/workhub/src/calendar/assistant-draft';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {createEditDrafts,EditDraftsProvider} from './apps/workhub/src/app/edit-drafts';
  import {createPendingRequests,PendingRequestsProvider,recoveryScope} from './apps/workhub/src/app/pending-requests';
  import {ContractError} from './apps/workhub/src/contracts';
  import styles from './apps/workhub/src/style.css?inline';
  const root=createRoot(document.getElementById('root')), drafts=createEditDrafts(), pending=createPendingRequests();
  const baseMember=fixtureData.memberships.find(row=>row.id==='gaon-soyeon'), scope=recoveryScope(baseMember), date=fixtureData.basisDate;
  const memory=createMemoryAdapter(fixtureData,0); let member=baseMember, generation=0, request, page='calendar';
  const clone=value=>structuredClone(value);
  function fresh(id='draft-1',partial=false){return {id,schoolId:member.schoolId,memberId:member.id,draft:buildAssistantCalendarDraft({title:'대화로 만든 회의',date,startTime:partial?null:'15:00',endTime:partial?null:'16:00',allDay:false},baseMember,date)}}
  const scenario={handled:[],attempts:[],failAfter:false,
    reset(kind='normal'){drafts.clear();drafts.activate(scope);pending.clear();memory.reset();member=baseMember;request=undefined;page='calendar';scenario.handled=[];scenario.attempts=[];scenario.failAfter=false;generation++;
      if(kind==='restored'){const draft=fresh().draft;draft.title='기존 미저장 입력';drafts.bind(scope,'calendar-editor').save({draft,initialValue:JSON.stringify(draft)},true)}
      if(kind==='pending')pending.put(scope,'calendar',{command:{draft:fresh().draft,idempotencyKey:'original-pending-key'}});
      render();},
    send(kind='normal',id='draft-1'){request=fresh(id,kind==='partial');if(kind==='foreign')request.schoolId='another-school';if(kind==='inactive')member={...baseMember,active:false};render()},
    show(next){page=next;render()},remount(){generation++;render()},
    snapshot(){return memory.exportState()},pending(){return pending.get(scope,'calendar')},draft(){return drafts.bind(scope,'calendar-editor').initial},
  };window.scenario=scenario;
  const adapter={list:id=>memory.list(id),get:(id,event)=>memory.get(id,event),async save(id,command){scenario.attempts.push(clone(command));const result=await memory.save(id,command);if(scenario.failAfter){scenario.failAfter=false;throw new ContractError('SAVE_FAILED','접수 뒤 응답 유실')}return result}};
  function render(){root.render(<EditDraftsProvider store={drafts}><PendingRequestsProvider store={pending}><style>{styles}</style><CalendarPanel key={generation} member={member} members={fixtureData.memberships} schoolName="가상 학교" date={date} adapter={adapter} revision={0} page={page} onPageChange={next=>{page=next;render()}} relationOptions={relationLabels} assistantDraftRequest={request} onAssistantDraftHandled={(id,accepted)=>{scenario.handled.push({id,accepted})}}/></PendingRequestsProvider></EditDraftsProvider>)}scenario.reset();
`, loader: 'tsx', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('http://127.0.0.1:5176/assistant-calendar', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
const report = message => { assert.deepEqual(errors, []); console.log(`  ✓ ${message}`) }
async function reset(kind = 'normal') { await page.evaluate(value => window.scenario.reset(value), kind); await page.getByRole('dialog').waitFor({ state: 'detached' }) }
async function send(kind = 'normal', id = 'draft-1') { await page.evaluate(([a,b]) => window.scenario.send(a,b), [kind,id]); await page.waitForFunction(value => window.scenario.handled.some(row => row.id === value), id) }
try {
  await page.goto('http://127.0.0.1:5176/assistant-calendar'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await send('partial'); await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('input[name=title]').inputValue(), '대화로 만든 회의')
  assert.equal(await page.getByLabel('시작 시간', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('종료 시간', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('누가 원본을 볼 수 있나요?').inputValue(), 'private')
  assert.equal(await page.evaluate(() => window.scenario.attempts.length), 0)
  await page.getByRole('dialog').getByRole('button', { name: '일정 등록', exact: true }).click()
  assert.equal(await page.evaluate(() => window.scenario.attempts.length), 0)
  await page.getByLabel('시작 시간', { exact: true }).fill('15:00'); await page.getByLabel('종료 시간', { exact: true }).fill('16:00')
  await page.getByRole('dialog').getByRole('button', { name: '일정 등록', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.scenario.attempts.length), 1)
  const saved = await page.evaluate(() => window.scenario.snapshot().data.events.find(row => row.title === '대화로 만든 회의'))
  assert.equal(saved.visibility, 'private'); assert.equal(saved.version, 1)
  report('초안은 미리 저장하지 않고, 누락 시간 입력·기존 저장 버튼 확인 뒤 나만 보는 일정 1건을 만든다')

  await page.evaluate(() => window.scenario.remount()); await page.getByRole('heading', { name: '학교 일정', exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.scenario.handled), [{ id: 'draft-1', accepted: true }])
  report('완료한 같은 초안 번호를 부모가 유지하고 화면을 다시 열어도 재수락·중복 저장하지 않는다')

  await reset(); await page.evaluate(() => window.scenario.show('home')); await page.evaluate(() => window.scenario.send())
  await page.getByRole('heading', { name: '오늘', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.scenario.handled), [])
  await page.evaluate(() => window.scenario.show('calendar')); await page.getByRole('dialog').waitFor()
  assert.deepEqual(await page.evaluate(() => window.scenario.handled), [{ id: 'draft-1', accepted: true }])
  report('홈에 머무는 동안 초안을 소비하지 않고 일정 화면에서만 연다')

  await reset('restored'); await send()
  assert.deepEqual(await page.evaluate(() => window.scenario.handled), [{ id: 'draft-1', accepted: false }])
  assert.equal(await page.evaluate(() => window.scenario.draft().draft.title), '기존 미저장 입력')
  await page.getByRole('button', { name: '일정 등록', exact: true }).click()
  assert.equal(await page.locator('input[name=title]').inputValue(), '기존 미저장 입력')
  report('복원 대기 중인 편집 초안이 있으면 새 연결을 거부하고 원래 입력을 유지한다')

  await reset('pending'); await send()
  assert.equal(await page.evaluate(() => window.scenario.pending().command.idempotencyKey), 'original-pending-key')
  assert.deepEqual(await page.evaluate(() => window.scenario.handled), [{ id: 'draft-1', accepted: false }])
  assert.equal(await page.getByRole('dialog').count(), 0)
  report('미확정 저장 요청의 원래 번호·입력을 보존하고 새 초안을 열지 않는다')

  for (const kind of ['foreign','inactive']) {
    await reset(); await send(kind)
    assert.deepEqual(await page.evaluate(() => window.scenario.handled), [{ id: 'draft-1', accepted: false }])
    assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(() => window.scenario.attempts.length), 0)
  }
  report('다른 학교 초안·비활성 소속은 편집기와 저장 호출 모두 차단한다')

  await reset(); await page.getByRole('button', { name: '일정 등록', exact: true }).click(); await page.locator('input[name=title]').fill('작성 중 원래 일정')
  await send(); assert.equal(await page.locator('input[name=title]').inputValue(), '작성 중 원래 일정')
  assert.deepEqual(await page.evaluate(() => window.scenario.handled), [{ id: 'draft-1', accepted: false }])
  report('열려 있는 수동 입력을 대화 초안으로 덮어쓰지 않는다')

  await reset(); await send(); await page.evaluate(() => { window.scenario.failAfter=true })
  await page.getByRole('dialog').getByRole('button', { name: '일정 등록', exact: true }).click()
  await page.getByRole('region', { name: '일정 저장 결과 확인 필요' }).waitFor()
  await page.getByRole('button', { name: '입력창 접고 목록 보기', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  await send('normal','draft-2'); assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal((await page.evaluate(() => window.scenario.handled)).at(-1).accepted, false)
  await page.getByRole('button', { name: '보관한 일정 확인', exact: true }).click()
  await page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' })
  const attempts = await page.evaluate(() => window.scenario.attempts)
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1])
  assert.equal(await page.evaluate(() => window.scenario.snapshot().data.events.filter(row => row.title === '대화로 만든 회의').length), 1)
  report('대화 초안 저장의 응답 유실·접기·재확인도 기존 요청 번호로 복구하며 중복을 만들지 않는다')
} finally { await browser.close() }
