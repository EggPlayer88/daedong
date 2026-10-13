// 실제 가져오기 화면·일정 편집기를 합성 저장소와 연결한다. 실제 학교 서버에는 접속하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const bundle = buildSync({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CalendarImport} from './apps/workhub/src/calendar/CalendarImport';
  import {PendingRequestsProvider,createPendingRequests} from './apps/workhub/src/app/pending-requests';
  import {ContractError} from './apps/workhub/src/contracts';
  import {createMemoryAdapter} from './apps/workhub/src/preview/memory-adapter';
  import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
  import styles from './apps/workhub/src/style.css?inline';
  const host=document.getElementById('root');const surface=window.SHADOW_TEST?host.attachShadow({mode:'open'}):host;
  const root=createRoot(surface);
  const member=fixtureData.memberships.find(item=>item.id==='gaon-minjun');
  const memory=createMemoryAdapter(fixtureData,0),pendingStore=createPendingRequests();let visible=false,generation=0,releaseList,releaseSave;
  const clone=value=>structuredClone(value);
  const scenario={attempts:[],saved:[],closed:0,failAfter:0,listFailure:'',listCalls:0,holdList:false,holdSave:false,navigationLocked:false,
    navigationLock(locked){scenario.navigationLocked=locked},
    open(){memory.reset();pendingStore.clear();scenario.attempts=[];scenario.saved=[];scenario.closed=0;scenario.failAfter=0;scenario.listFailure='';scenario.listCalls=0;scenario.holdList=false;scenario.holdSave=false;visible=true;generation++;render()},
    pendingCount(){return pendingStore.count()},
    snapshot(){return memory.exportState()},
    releaseList(){releaseList?.();releaseList=undefined},releaseSave(){releaseSave?.();releaseSave=undefined},
    async match(){return (await memory.list(member.id)).find(event=>event.id==='fixture-event-morning')},
  };window.scenario=scenario;
  const adapter={async list(id){scenario.listCalls++;if(scenario.holdList){scenario.holdList=false;await new Promise(resolve=>{releaseList=resolve})}
    if(scenario.listFailure==='throw')throw new ContractError('QUERY_FAILED','합성 조회 실패');
    if(scenario.listFailure==='null')return null;
    if(scenario.listFailure==='malformed')return [null,{title:'깨진 일정'}];
    if(scenario.listFailure==='foreign'){const events=await memory.list(id);return [{...events[0],schoolId:'different-school'}]}
    return memory.list(id)},get:(id,event)=>memory.get(id,event),async save(memberId,command){
    scenario.attempts.push({memberId,command:clone(command)});
    if(scenario.holdSave){scenario.holdSave=false;await new Promise(resolve=>{releaseSave=resolve})}
    const result=await memory.save(memberId,command);
    if(scenario.failAfter){scenario.failAfter--;throw new ContractError('SAVE_FAILED','합성 접수 후 응답 유실')}
    return result;
  }};
  function render(){root.render(<PendingRequestsProvider store={pendingStore}><style>{styles}</style><h1>일정 표 가져오기 합성 시험</h1><button id="open" onClick={()=>scenario.open()}>가져오기 열기</button>{visible&&<CalendarImport key={generation} member={member} members={fixtureData.memberships} date={fixtureData.basisDate} adapter={adapter} relationOptions={relationLabels} demo storageLabel="합성 저장소" onNavigationLockChange={scenario.navigationLock} onClose={()=>{scenario.closed++;visible=false;render()}} onSaved={event=>{scenario.saved.push(clone(event));render()}}/>}</PendingRequestsProvider>)}render();
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
await page.route('http://127.0.0.1:5176/calendar-import-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div></body></html>' }))
const outer = page.locator('dialog.calendar-import-dialog')
const source = page.getByRole('textbox', { name: /^원본 표 붙여넣기/ })
const results = page.getByRole('heading', { name: '가져올 일정 검토', exact: true })
const cards = page.locator('.ci-row')
const editor = () => page.getByRole('dialog', { name: '일정 등록', exact: true })
let passed = 0
const checks = [], screenshots = [], outputDir = process.env.WORKHUB_QA_OUTPUT || process.env.WORKHUB_EVIDENCE_DIR
async function open() { await page.evaluate(() => window.scenario.open()); await outer.waitFor(); await source.waitFor() }
async function columns(text) { await source.fill(text); await page.getByRole('button', { name: '열 연결 확인', exact: true }).click(); await page.getByRole('combobox', { name: /^제목 \(필수\)/ }).waitFor() }
async function inspect() { await page.getByRole('button', { name: '행 검사 · 기존 일정과 비교', exact: true }).click(); await results.waitFor() }
async function prepare(text) { await columns(text); await inspect() }
async function snapshot() { return page.evaluate(() => window.scenario.snapshot()) }
async function attempts() { return page.evaluate(() => window.scenario.attempts) }
async function report(message) { assert.deepEqual(errors, []); checks.push(message); passed++; console.log(`  ✓ ${message}`) }
async function screenshot(name) { if (outputDir) { await mkdir(outputDir, { recursive: true }); const path = join(outputDir, name); await page.screenshot({ path, fullPage: true }); screenshots.push(path) } }
async function save() { await editor().getByRole('button', { name: '일정 등록', exact: true }).click() }

try {
  await page.goto('http://127.0.0.1:5176/calendar-import-test'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.locator('#open').click(); await source.waitFor()
  assert.equal(await source.evaluate(element => element === document.activeElement), true)
  assert.equal(await page.evaluate(() => window.scenario.navigationLocked), false)
  await source.fill('   ')
  assert.equal(await page.evaluate(() => window.scenario.navigationLocked), false)
  await prepare('제목\t시작일\t종료일\t시작 시간\t종료 시간\t장소\n검토할 회의\t2026.10.20\t\t09:00\t10:00\t연구실')
  assert.equal(await cards.count(), 1)
  assert.ok((await cards.innerText()).includes('2026-10-20 ~ 2026-10-20 · 09:00–10:00'))
  assert.equal((await attempts()).length, 0); assert.equal((await snapshot()).receipts.length, 0)
  assert.equal(await results.evaluate(element => element === document.activeElement), true)
  assert.equal(await page.evaluate(() => window.scenario.navigationLocked), true)
  await report('TSV 붙여넣기·열 연결·날짜 정규화·검사는 저장하지 않으며 결과 표제로 초점 이동')

  await open(); await prepare('제목\t시작일\t시작 시간\t종료 시간\n한국어 표시 일정\t2026. 10. 13.\t오전 9:00:00\t오후 2:30:00')
  assert.ok((await cards.innerText()).includes('2026-10-13 ~ 2026-10-13 · 09:00–14:30'))
  await cards.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click(); await editor().waitFor()
  assert.equal(await editor().getByLabel('시작 시간', { exact: true }).inputValue(), '09:00')
  assert.equal(await editor().getByLabel('종료 시간', { exact: true }).inputValue(), '14:30')
  await save(); await editor().waitFor({ state: 'detached' })
  const koreanSaved = (await snapshot()).data.events.find(event => event.title === '한국어 표시 일정')
  assert.equal(koreanSaved.startDate, '2026-10-13'); assert.equal(koreanSaved.startTime, '09:00'); assert.equal(koreanSaved.endTime, '14:30')
  await report('한국어 시트 날짜·오전오후 시간을 편집기와 실제 합성 저장까지 같은 값으로 정규화')

  await open(); await prepare('제목\t시작일\t시작 시간\t종료 시간\n초가 있는 일정\t2026-10-13\t9:00:01\t10:00\n정상 일정\t2026-10-13\t9:00\t10:00:00')
  assert.ok((await cards.nth(0).innerText()).includes('0이 아닌 초'))
  assert.equal(await cards.nth(0).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).count(), 0)
  assert.ok((await cards.nth(1).innerText()).includes('09:00–10:00'))
  assert.equal((await attempts()).length, 0)
  await report('0이 아닌 초는 버리지 않고 오류로 안내하며 한 자리 시와 초 00은 허용')

  await open(); await prepare('제목\t시작일\t시간\t담당\t빈열\n제외 확인 일정\t2026-10-13\t09:00~10:30\t교무부\t')
  const omissions = page.getByRole('region', { name: '가져오지 않는 열을 확인하세요', exact: true })
  const confirmOmissions = page.getByRole('checkbox', { name: '표시된 열을 제외하고 등록하는 데 동의합니다', exact: true })
  const openOmittedRow = page.getByRole('button', { name: '내용·공유 대상 확인', exact: true })
  assert.ok((await omissions.innerText()).includes('3열 ‘시간’ · 값이 있는 1행 · 예: 09:00~10:30'))
  assert.ok((await omissions.innerText()).includes('4열 ‘담당’')); assert.ok(!(await omissions.innerText()).includes('빈열'))
  assert.equal(await openOmittedRow.isDisabled(), true); assert.equal((await attempts()).length, 0)
  await confirmOmissions.check(); assert.equal(await openOmittedRow.isEnabled(), true)
  await confirmOmissions.uncheck(); assert.equal(await openOmittedRow.isDisabled(), true)
  await confirmOmissions.check()
  await page.getByRole('combobox', { name: /^설명 \(선택\)/ }).selectOption('3')
  assert.equal(await confirmOmissions.isChecked(), false)
  assert.ok(!(await omissions.innerText()).includes('4열 ‘담당’'))
  await inspect(); assert.equal(await openOmittedRow.isDisabled(), true)
  await page.setViewportSize({ width: 320, height: 800 })
  assert.equal(await omissions.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
  await page.setViewportSize({ width: 1200, height: 900 })
  await confirmOmissions.check(); await openOmittedRow.click(); await editor().waitFor()
  assert.equal(await editor().getByRole('checkbox', { name: '종일 일정', exact: true }).isChecked(), true)
  await save(); await editor().waitFor({ state: 'detached' })
  const omittedSaved = (await snapshot()).data.events.find(event => event.title === '제외 확인 일정')
  assert.equal(omittedSaved.allDay, true); assert.equal(omittedSaved.description, '교무부')
  assert.equal((await attempts()).length, 1)
  await report('값이 있는 미연결 시간·기타 열을 알리고 제외 동의 전 등록 차단·매핑 변경 시 동의 초기화')

  await open(); await columns('행사 이름,행사 날짜,안내\n수동 매핑,2026/10/20,"쉼표, 안내"')
  assert.equal(await page.getByRole('combobox', { name: /^제목 \(필수\)/ }).inputValue(), '-1')
  assert.equal(await page.getByRole('combobox', { name: /^시작일 \(필수\)/ }).inputValue(), '-1')
  await inspect(); assert.ok((await cards.innerText()).includes('제목 열을 연결해 주세요'))
  assert.equal(await page.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).count(), 0)
  await page.getByRole('combobox', { name: /^제목 \(필수\)/ }).selectOption('0')
  await page.getByRole('combobox', { name: /^시작일 \(필수\)/ }).selectOption('1')
  await inspect(); assert.ok((await cards.innerText()).includes('쉼표, 안내'))
  assert.equal((await attempts()).length, 0)
  await report('추정하지 않은 CSV 헤더를 직접 연결해야 진행하며 인용 셀 내용 유지')

  await open(); await prepare('제목,시작일\n잘못된 날짜,2026-02-29\n연도 없음,10/20\n가능한 일정,2028-02-29')
  assert.equal(await cards.count(), 3); assert.equal(await page.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).count(), 1)
  assert.ok((await outer.innerText()).includes('입력 오류 2행'))
  assert.ok((await outer.innerText()).includes('실제 달력에 없는 날짜'))
  assert.equal((await attempts()).length, 0)
  await report('잘못된 날짜·연도 없는 행은 차단하고 정상 행만 확인 버튼 제공')

  await open(); const match = await page.evaluate(() => window.scenario.match())
  const csvCell = value => `"${String(value).replaceAll('"', '""')}"`
  await prepare(['제목,시작일,종료일,시작 시간,종료 시간', [match.title, match.startDate, match.endDate, match.startTime, match.endTime].map(csvCell).join(',')].join('\n'))
  const candidateButton = page.getByRole('button', { name: '내용·공유 대상 확인', exact: true })
  assert.equal(await candidateButton.isDisabled(), true)
  await page.getByRole('checkbox', { name: '기존 일정과 별개의 새 일정임을 확인했습니다', exact: true }).check()
  assert.equal(await candidateButton.isDisabled(), false)
  await candidateButton.click(); await editor().waitFor()
  assert.equal(await editor().getByRole('combobox', { name: /^누가 원본을 볼 수 있나요\?/ }).inputValue(), 'private')
  await editor().getByRole('button', { name: '취소', exact: true }).click(); await editor().waitFor({ state: 'detached' })
  assert.equal((await attempts()).length, 0)
  await report('열람 가능한 기존 일정 후보는 별개 일정 확인이 필요하며 편집기 기본은 나만 보기')

  await page.getByRole('button', { name: '기존 일정 다시 비교', exact: true }).click(); await results.waitFor()
  await page.waitForFunction(() => window.scenario.listCalls === 2)
  assert.equal(await page.getByRole('checkbox', { name: '기존 일정과 별개의 새 일정임을 확인했습니다', exact: true }).isChecked(), false)
  assert.equal(await candidateButton.isDisabled(), true)
  await report('기존 일정을 다시 조회하면 과거 후보 확인을 지우고 다시 확인 요구')

  await open(); await prepare('제목,시작일,설명\n등록할 첫 일정,2026-10-20,초안 안내\n남은 일정,2026-10-21,다음 안내\n아직 안 보낸 일정,2026-10-22,미등록 안내')
  const initialCount = (await snapshot()).data.events.length
  await cards.nth(0).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click(); await editor().waitFor()
  await editor().locator('input[name=title]').fill('확인한 첫 일정')
  await editor().getByRole('textbox', { name: /^안내 내용/ }).fill('검토 후 수정한 안내')
  await save(); await editor().waitFor({ state: 'detached' })
  let state = await snapshot(), saved = state.data.events.find(event => event.title === '확인한 첫 일정')
  assert.equal(state.data.events.length, initialCount + 1); assert.equal(state.receipts.length, 1)
  assert.equal(saved.description, '검토 후 수정한 안내'); assert.equal(saved.visibility, 'private')
  assert.equal(await source.isDisabled(), true)
  assert.equal(await page.getByRole('combobox', { name: /^제목 \(필수\)/ }).isDisabled(), true)
  assert.equal(await page.getByRole('combobox', { name: /^열 구분/ }).isDisabled(), true)
  assert.equal(await cards.nth(0).getByRole('button').count(), 0)
  assert.equal(await cards.nth(1).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).isEnabled(), true)
  assert.equal(await page.evaluate(() => window.scenario.saved.length), 1)
  await report('실제 편집기에서 수정한 한 행만 저장하고 부분 등록 후 원본·열 매핑을 잠금')

  await page.evaluate(() => { window.scenario.listFailure='throw' })
  await page.getByRole('button', { name: '기존 일정 다시 비교', exact: true }).click(); await page.getByRole('alert').waitFor()
  assert.ok((await cards.nth(0).innerText()).includes('등록 완료'))
  assert.equal(await cards.nth(1).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).isDisabled(), true)
  assert.equal(await source.isDisabled(), true); assert.equal((await snapshot()).receipts.length, 1)
  await page.evaluate(() => { window.scenario.listFailure='' })
  await page.getByRole('button', { name: '기존 일정 다시 비교', exact: true }).click()
  await cards.nth(1).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelectorAll('.ci-row button')[0]?.disabled === false)
  assert.equal((await attempts()).length, 1)
  await report('부분 등록 후 재비교 실패는 완료 행을 보존하고 남은 등록을 차단하며 비교 성공 후 복구')

  await page.evaluate(() => { window.scenario.holdList=true })
  await page.getByRole('button', { name: '기존 일정 다시 비교', exact: true }).click()
  await page.getByRole('button', { name: '읽기 취소', exact: true }).click()
  assert.equal(await cards.nth(1).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).isDisabled(), true)
  await page.evaluate(() => window.scenario.releaseList())
  assert.equal(await cards.nth(1).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).isDisabled(), true)
  assert.ok((await cards.nth(0).innerText()).includes('등록 완료'))
  await page.getByRole('button', { name: '기존 일정 다시 비교', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.ci-row button')[0]?.disabled === false)
  await report('부분 등록 후 읽기 취소의 늦은 응답으로 등록 잠금이 풀리지 않고 새 비교가 필요')

  await page.getByRole('button', { name: '검토 마치기', exact: true }).click()
  await page.getByRole('region', { name: '일정 가져오기 종료 확인', exact: true }).waitFor()
  assert.ok((await outer.innerText()).includes('등록 완료한 1개 일정은 유지됩니다'))
  await page.getByRole('button', { name: '계속 검토', exact: true }).click()
  assert.ok((await cards.nth(0).innerText()).includes('등록 완료'))
  assert.equal((await snapshot()).receipts.length, 1)
  await report('종료 확인을 취소해도 등록 완료 표시와 남은 검토 행 보존')

  await cards.nth(1).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click(); await editor().waitFor()
  await editor().getByRole('combobox', { name: /^누가 원본을 볼 수 있나요\?/ }).selectOption('school')
  await page.evaluate(() => { window.scenario.failAfter=1 })
  await save(); await page.getByRole('region', { name: '일정 저장 결과 확인 필요', exact: true }).waitFor()
  state = await snapshot(); assert.equal(state.data.events.length, initialCount + 2); assert.equal(state.receipts.length, 2)
  assert.equal(await editor().locator('input[name=title]').isDisabled(), true)
  assert.equal(await editor().getByRole('button', { name: '일정 편집 닫기', exact: true }).isDisabled(), true)
  assert.equal(await outer.locator('button[aria-label="일정 가져오기 닫기"]').isDisabled(), true)
  await page.keyboard.press('Escape'); assert.equal(await editor().count(), 1)
  await outer.evaluate(element => element.dispatchEvent(new Event('cancel', { cancelable: true })))
  assert.equal(await page.evaluate(() => window.scenario.closed), 0)
  await editor().locator('form').evaluate(form => form.requestSubmit())
  assert.equal((await attempts()).length, 2)
  await report('접수 후 응답 유실이면 두 창의 닫기·Esc·새 제출을 막고 미확정 행 유지')

  await page.getByRole('button', { name: '입력창 접고 표 보기', exact: true }).click()
  await editor().waitFor({ state: 'detached' })
  await page.getByRole('region', { name: '가져오기 저장 결과 확인 필요', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.scenario.pendingCount()), 1)
  assert.equal(await source.isDisabled(), true)
  assert.ok((await cards.nth(0).innerText()).includes('등록 완료 · 확인한 첫 일정'))
  assert.ok((await cards.nth(1).innerText()).includes('저장 결과 확인 대기'))
  assert.equal(await cards.nth(2).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '검토 마치기', exact: true }).isEnabled(), true)
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'status' && document.activeElement.textContent.includes('원본 3행의 저장 요청을 보관했습니다.'))
  await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('button', { name: '보관한 원본 3행 다시 확인', exact: true }).evaluate(element => element === document.activeElement), true)
  await report('미확정 입력창을 접으면 복구 안내에 초점이 이어지고 Tab으로 같은 행 재확인에 접근')
  await page.getByRole('button', { name: '보관한 원본 3행 다시 확인', exact: true }).click(); await editor().waitFor()
  assert.equal(await editor().locator('input[name=title]').inputValue(), '남은 일정')
  assert.equal(await editor().getByRole('combobox', { name: /^누가 원본을 볼 수 있나요\?/ }).inputValue(), 'school')
  assert.equal((await attempts()).length, 2)
  await report('응답 유실 입력창을 접어도 원본 행·이전 완료 행을 보존하고 다른 행 등록을 막은 채 원래 요청 복구')

  await page.evaluate(() => { window.scenario.holdSave=true })
  const retry = page.getByRole('button', { name: '같은 요청으로 저장 결과 확인', exact: true })
  await retry.click(); await page.waitForFunction(() => window.scenario.attempts.length === 3)
  assert.equal(await retry.isDisabled(), true)
  await retry.evaluate(button => { button.click();button.click() })
  assert.equal((await attempts()).length, 3)
  await page.evaluate(() => window.scenario.releaseSave()); await editor().waitFor({ state: 'detached' })
  const commands = await attempts(); assert.deepEqual(commands[1], commands[2])
  state = await snapshot(); assert.equal(state.data.events.length, initialCount + 2); assert.equal(state.receipts.length, 2)
  assert.equal(state.data.events.find(event => event.title === '남은 일정').visibility, 'school')
  assert.equal(await page.evaluate(() => window.scenario.saved.length), 2)
  assert.ok((await outer.innerText()).includes('등록 완료 2개'))
  assert.ok((await cards.nth(1).innerText()).includes('등록 완료 · 남은 일정'))
  assert.ok(!(await cards.nth(2).innerText()).includes('등록 완료'))
  assert.equal(await cards.nth(2).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).isEnabled(), true)
  assert.equal(await page.evaluate(() => window.scenario.pendingCount()), 0)
  await report('재확인은 같은 요청·키를 사용하며 중복 클릭해도 추가 일정 없이 완료 처리')

  await page.getByRole('button', { name: '검토 마치기', exact: true }).click()
  await page.getByRole('button', { name: '가져오기 종료', exact: true }).click(); await outer.waitFor({ state: 'detached' })
  assert.equal((await snapshot()).receipts.length, 2); assert.equal(await page.evaluate(() => window.scenario.closed), 1)
  assert.equal(await page.evaluate(() => window.scenario.navigationLocked), false)
  await report('가져오기 종료 후에도 이미 등록한 일정은 합성 저장소에 유지')

  await open(); await prepare('제목,시작일\n밖에서 확인할 일정,2026-10-20')
  await cards.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click(); await editor().waitFor()
  await page.evaluate(() => { window.scenario.failAfter=1 }); await save()
  await page.getByRole('button', { name: '입력창 접고 표 보기', exact: true }).click(); await editor().waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '검토 마치기', exact: true }).click()
  assert.ok((await outer.innerText()).includes('보관한 일정 확인'))
  await page.getByRole('button', { name: '가져오기 종료', exact: true }).click(); await outer.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.scenario.pendingCount()), 1)
  assert.equal((await attempts()).length, 1); assert.equal((await snapshot()).receipts.length, 1)
  assert.equal(await page.evaluate(() => window.scenario.navigationLocked), false)
  await report('결과 미확정 가져오기를 종료해도 상위 공유 메모리에 같은 요청을 보존하고 일반 일정에서 확인 가능')

  for (const mode of ['throw', 'null', 'malformed', 'foreign']) {
    await open(); await columns('제목,시작일\n조회 확인 일정,2026-10-20')
    await page.evaluate(value => { window.scenario.listFailure=value }, mode)
    await page.getByRole('button', { name: '행 검사 · 기존 일정과 비교', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await cards.count(), 0); assert.equal((await attempts()).length, 0)
    assert.equal(await source.inputValue(), '제목,시작일\n조회 확인 일정,2026-10-20')
    await page.evaluate(() => { window.scenario.listFailure='' }); await inspect()
    assert.equal(await cards.count(), 1)
  }
  await report('기존 목록 조회 실패·null·깨진 행·다른 학교 응답은 빈 목록으로 통과시키지 않으며 원본 유지 후 재검사 가능')

  await open(); await columns('제목,시작일\n취소할 조회,2026-10-20')
  await page.evaluate(() => { window.scenario.holdList=true })
  await page.getByRole('button', { name: '행 검사 · 기존 일정과 비교', exact: true }).click()
  await page.getByRole('button', { name: '읽기 취소', exact: true }).waitFor()
  assert.equal(await source.isDisabled(), true)
  await page.getByRole('button', { name: '읽기 취소', exact: true }).click()
  await source.fill('제목,시작일\n새로 바꾼 자료,2026-10-22')
  await page.evaluate(() => window.scenario.releaseList())
  await page.waitForFunction(() => !document.querySelector('.ci-rows'))
  assert.equal(await source.inputValue(), '제목,시작일\n새로 바꾼 자료,2026-10-22')
  await page.getByRole('button', { name: '열 연결 확인', exact: true }).click(); await inspect()
  assert.ok((await cards.innerText()).includes('새로 바꾼 자료')); assert.equal((await attempts()).length, 0)
  await report('느린 읽기를 취소하고 원본을 바꾸면 이전 응답이 새 입력·검토 결과를 덮어쓰지 않음')

  await open()
  await page.getByLabel('CSV·TSV 파일 열기', { exact: true }).setInputFiles({ name: '합성일정.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFF제목,시작일\r\n파일 일정,2026-10-20') })
  await page.waitForFunction(() => document.querySelector('.ci-source').value.includes('파일 일정'))
  await page.getByRole('button', { name: '열 연결 확인', exact: true }).click(); await inspect()
  assert.ok((await cards.innerText()).includes('파일 일정')); assert.equal((await attempts()).length, 0)
  await report('UTF-8 CSV 파일도 같은 열 연결·검사 경로를 사용하고 자동 저장하지 않음')

  await open()
  await page.getByLabel('CSV·TSV 파일 열기', { exact: true }).setInputFiles({ name: '깨진인코딩.csv', mimeType: 'text/csv', buffer: Buffer.from([0xff, 0xfe, 0x00]) })
  await page.getByRole('alert').waitFor(); assert.ok((await page.getByRole('alert').innerText()).includes('UTF-8'))
  assert.equal(await source.isEnabled(), true); assert.equal((await attempts()).length, 0)
  await report('UTF-8이 아닌 파일은 명확히 거부하고 붙여넣기 입력을 다시 허용')

  await open(); await prepare(['제목,시작일', ...Array.from({ length: 23 }, (_, index) => `여러 행 ${index + 1},2026-10-20`)].join('\n'))
  assert.equal(await cards.count(), 20); assert.ok((await outer.innerText()).includes('전체 23행'))
  await page.getByRole('navigation', { name: '가져올 일정 페이지', exact: true }).getByRole('button', { name: '다음', exact: true }).click()
  assert.equal(await cards.count(), 3); assert.ok((await cards.nth(0).innerText()).includes('여러 행 21'))
  assert.equal(await results.evaluate(element => element === document.activeElement), true)
  await cards.nth(0).getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click(); await editor().waitFor()
  await editor().getByRole('button', { name: '취소', exact: true }).click(); await editor().waitFor({ state: 'detached' })
  assert.equal(await cards.count(), 3); assert.ok((await cards.nth(0).innerText()).includes('여러 행 21'))
  await report('검토는 20행씩 표시하고 다음 페이지·편집 취소 후 같은 행과 초점을 유지')
  await screenshot('calendar-import-desktop.png')

  await page.setViewportSize({ width: 320, height: 800 })
  await page.getByRole('navigation', { name: '가져올 일정 페이지', exact: true }).getByRole('button', { name: '처음', exact: true }).click()
  const layout = await outer.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, bodyWidth: document.documentElement.clientWidth, bodyScroll: document.documentElement.scrollWidth }))
  assert.ok(layout.scroll <= layout.width + 1, JSON.stringify(layout)); assert.ok(layout.bodyScroll <= layout.bodyWidth + 1, JSON.stringify(layout))
  await screenshot('calendar-import-320.png')
  assert.equal((await attempts()).length, 0)
  await report('320px 화면에서도 원본·매핑·검토 목록·페이지 버튼에 가로 넘침 없음')

  await page.setViewportSize({ width: 1200, height: 900 })
  await page.goto('http://127.0.0.1:5176/calendar-import-test')
  await page.evaluate(() => { window.SHADOW_TEST=true }); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.locator('#open').click(); await source.waitFor()
  assert.equal(await source.evaluate(element => element.getRootNode().activeElement === element), true)
  await prepare('제목,시작일\n그림자 영역 일정,2026-10-20')
  assert.equal(await results.evaluate(element => element.getRootNode().activeElement === element), true)
  await cards.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).click(); await editor().waitFor()
  assert.equal(await editor().locator('input[name=title]').evaluate(element => element.getRootNode().activeElement === element), true)
  await page.keyboard.press('Escape'); await editor().waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.getElementById('root').shadowRoot.activeElement?.textContent === '내용·공유 대상 확인', undefined, { timeout: 3000 })
  assert.equal(await cards.getByRole('button', { name: '내용·공유 대상 확인', exact: true }).evaluate(element => element.getRootNode().activeElement === element), true)
  await page.getByRole('button', { name: '검토 마치기', exact: true }).click()
  await page.getByRole('button', { name: '가져오기 종료', exact: true }).click(); await outer.waitFor({ state: 'detached' })
  assert.equal(await page.locator('#open').evaluate(element => element.getRootNode().activeElement === element), true)
  assert.equal((await attempts()).length, 0)
  await report('Shadow DOM에서도 열기·결과·중첩 편집 취소·종료의 초점이 원래 버튼으로 돌아옴')
  if (outputDir) await writeFile(join(outputDir, 'calendar-import.json'), `${JSON.stringify({ passed, checks, errors, screenshots, narrowLayout: layout, syntheticOnly: true }, null, 2)}\n`, 'utf8')
  console.log(`\n일정 표 가져오기 Chrome ${passed}개 통과`)
} catch (error) {
  console.error('초점 상태', await page.evaluate(() => { const root = document.getElementById('root')?.shadowRoot; const describe = element => element ? { tag: element.tagName, text: element.textContent?.slice(0, 120), disabled: element.disabled } : null; return { document: describe(document.activeElement), shadow: describe(root?.activeElement), rowButtons: root ? [...root.querySelectorAll('.ci-row button')].map(describe) : [] } }))
  console.error(error); console.error((await page.locator('body').innerText()).slice(-6000)); process.exitCode = 1
} finally { await context.close(); await browser.close() }
