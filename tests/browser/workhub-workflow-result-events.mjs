import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

// 실제 패널과 기존 서버 검증 경로를 실행한다. RPC·Storage 응답만 합성하며 외부 전송은 차단한다.
const entries = {
  message: './workhub-messaging-deliveries-fixture.tsx',
  collection: './workhub-collection-conversation-fixture.tsx',
  timetable: './workhub-assistant-timetable-fixture.tsx',
}
const bundles = Object.fromEntries(Object.entries(entries).map(([kind, entry]) => [kind, buildSync({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text]))
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage()
const errors = [], external = [], passed = [], origin = 'http://127.0.0.1:5284/'
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { errors.push(dialog.message()); await dialog.dismiss() } })
await context.route('**/*', route => {
  if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}*{box-sizing:border-box}</style><div id="root"></div></html>' })
})
const button = name => page.getByRole('button', { name, exact: true })
const eventList = () => page.evaluate(() => window.qa ? window.qa.workflowResults : window.workflowResults)
const eventActions = async () => (await eventList()).map(result => result.action)
const hwpx = name => ({ name, mimeType: 'application/hwp+zip', buffer: Buffer.from('PK synthetic HWPX') })
async function start(kind, withCompose = false) {
  await page.goto(origin + kind)
  await page.evaluate(value => { window.withCompose = value }, withCompose)
  if (kind === 'timetable') await page.evaluate(() => { window.deferTimetableFixture = true; window.initialOperationTab = 'exchange' })
  await page.addScriptTag({ content: bundles[kind] })
  if (kind === 'message') await page.getByText('조건에 맞는 대화가 없습니다.', { exact: true }).waitFor()
  if (kind === 'collection') await page.getByRole('heading', { name: '수합 작업', exact: true }).waitFor()
  if (kind === 'timetable') await page.getByText('2개 수업 · 요청 0건', { exact: true }).waitFor()
  assert.deepEqual(await eventList(), [])
}
async function test(kind, name, run, withCompose = false) {
  await start(kind, withCompose)
  try { await run() } catch (error) { console.error(await page.locator('body').innerText()); console.error('결과 이벤트', await eventList()); throw error }
  passed.push(name); console.log('  ✓ ' + name)
}
function scope(result, expected) {
  assert.equal(typeof result.key, 'string'); assert.ok(result.key.length >= 8)
  assert.ok(Number.isFinite(Date.parse(result.recordedAt)))
  assert.deepEqual(JSON.parse(result.scope).slice(0, 3), expected)
}
async function composeMessage() {
  await button('새 메시지').click(); await page.getByLabel('보내는 방식').selectOption('individual')
  await page.getByLabel('김교사 · 교무부 [recipient-b]', { exact: true }).check(); await page.getByLabel('김교사 · 교무부 [recipient-a]', { exact: true }).check()
  await page.getByLabel('메시지', { exact: true }).fill('본문은 결과 요약에 복제하지 않습니다')
}
async function sendMessage() { await button('받는 사람과 내용 확인').click(); await button('확인한 내용 보내기').click() }
const sent = () => page.getByRole('region', { name: '최근 발송 결과', exact: true })
async function collectionInput() {
  await button('새 수합 만들기').click(); await page.getByLabel('수합 제목', { exact: true }).fill('결과 연결 수합')
  await page.getByLabel('제출 기한', { exact: true }).fill('2026-11-20'); await page.getByRole('checkbox', { name: '담당교사', exact: true }).check()
}
async function collectionDraft() { await collectionInput(); await button('수합 초안 저장').click(); await button('대상 교사에게 공개').waitFor() }
async function collectionPublish() { await collectionDraft(); await button('대상 교사에게 공개').click(); await button('대상·양식 확인 후 공개').click(); await button('내 제출 파일 작성').waitFor() }
async function collectionAnswer() {
  await collectionPublish(); await button('내 제출 파일 작성').click(); await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('제출.hwpx'))
  await page.getByText(/파일 준비가 완료되었습니다/).waitFor(); await button('제출 초안 저장').click()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === '최종 제출 내용 확인' && !node.disabled))
}
async function submitCollection() { await button('최종 제출 내용 확인').click(); await button('확인한 파일 최종 제출').click() }
async function timetableApprove() {
  await page.evaluate(() => window.addRequest('manager')); await button('승인하고 시간표에 반영').click()
  const review = page.getByRole('region', { name: '변경 요청 응답 확인', exact: true })
  await review.getByLabel('현재 수업과 변경 내용을 확인했습니다', { exact: true }).check()
  await review.getByRole('button', { name: '승인하고 시간표에 반영', exact: true }).click()
}
async function prepareTimetableClose() {
  await button('원래 요청 결과만 다시 확인').waitFor()
  await page.evaluate(() => { window.resultRecoverMissing = true; window.resultResendDenied = true })
  await button('원래 요청 결과만 다시 확인').click()
  await page.getByLabel('늦은 처리 가능성을 확인했고 같은 번호·같은 내용으로 다시 보냅니다').check()
  await button('같은 번호·같은 내용으로 다시 보내기').click(); await button('이 요청 닫기').click()
}
try {
  await test('message', '메시지는 최종 확인 뒤 모든 개별 대화의 검증된 접수증만 결과로 알린다', async () => {
    await composeMessage(); await button('받는 사람과 내용 확인').click(); assert.deepEqual(await eventList(), [])
    assert.equal(await page.evaluate(() => window.qa.writes), 0)
    await button('확인한 내용 보내기').click(); await sent().waitFor()
    const [result] = await eventList(); scope(result, ['user', 'school', 'self']); assert.equal(result.kind, 'message'); assert.equal(result.action, 'start')
    assert.deepEqual(result.deliveries.map(item => item.threadId).sort(), ['thread-recipient-a', 'thread-recipient-b'])
    for (const delivery of result.deliveries) assert.deepEqual(Object.keys(delivery).sort(), ['messageId', 'sequence', 'threadId'])
    assert.deepEqual(Object.keys(result).sort(), ['action', 'deliveries', 'key', 'kind', 'recordedAt', 'scope'])
    assert.equal(await page.evaluate(() => window.qa.saved.get(window.qa.workflowResults[0].key).deliveries.length), 2)
  })
  await test('message', '읽음은 업무 전송 결과에 추가하지 않고 답장은 정확한 기존 대화에 별도 접수한다', async () => {
    await composeMessage(); await sendMessage(); await sent().waitFor()
    await sent().getByRole('button', { name: /recipient-a.*대화 열기/ }).click(); await button('화면에 연 메시지까지 읽음 표시').click()
    await page.waitForFunction(() => window.qa.calls.some(call => call.name === 'workhub_message_mutate' && call.args.p_command.kind === 'read_thread'))
    assert.deepEqual(await eventActions(), ['start'])
    await button('답장').click(); await page.getByLabel('메시지', { exact: true }).fill('별도 답장 본문'); await sendMessage()
    await page.waitForFunction(() => window.qa.workflowResults.length === 2)
    const [, result] = await eventList(); assert.equal(result.action, 'reply'); assert.equal(result.deliveries.length, 1)
    assert.equal(result.deliveries[0].threadId, 'thread-recipient-a'); assert.equal(result.deliveries[0].sequence, 2)
  })
  await test('message', '응답 유실과 재진입은 결과를 추정하지 않고 같은 번호 복구 뒤 한 번만 알린다', async () => {
    await composeMessage(); await page.evaluate(() => { window.qa.unknown = true }); await sendMessage(); await button('이전 요청 그대로 다시 확인').waitFor()
    assert.deepEqual(await eventList(), []); await page.evaluate(() => window.qa.unmount()); await page.getByRole('heading', { name: '메시지와 알림', exact: true }).waitFor({ state: 'detached' }); await page.evaluate(() => window.qa.remount())
    await button('이전 요청 그대로 다시 확인').click(); await sent().waitFor()
    assert.equal((await eventList()).length, 1)
    const state = await page.evaluate(() => ({ writes: window.qa.writes, calls: window.qa.calls.filter(call => call.name === 'workhub_message_mutate'), pending: window.qa.pending.count(), result: window.qa.workflowResults[0] }))
    assert.equal(state.writes, 1); assert.equal(state.pending, 0); assert.deepEqual(state.calls[0].args, state.calls[1].args); assert.equal(state.result.key, state.calls[0].args.p_request_key)
  })
  await test('message', '결과 표시 콜백의 오류는 이미 성공한 전송을 미확정으로 되돌리지 않는다', async () => {
    await composeMessage(); await page.evaluate(() => { window.qa.resultThrows = true }); await sendMessage(); await sent().waitFor()
    assert.equal((await eventList()).length, 1); assert.equal(await page.evaluate(() => window.qa.pending.count()), 0)
    assert.equal(await button('이전 요청 그대로 다시 확인').count(), 0); assert.equal(await page.evaluate(() => window.qa.writes), 1)
  })
  await test('message', '연결 교체 전 늦은 전송 응답은 결과를 알리지 않고 원래 접수만 복구한다', async () => {
    await composeMessage(); await page.evaluate(() => { window.qa.defer = true }); await sendMessage(); await page.waitForFunction(() => typeof window.qa.release === 'function')
    await page.evaluate(() => window.qa.replaceConnection()); await page.waitForFunction(() => window.qa.calls.filter(call => call.name === 'workhub_messaging_readiness').length >= 3)
    await page.evaluate(() => window.qa.release()); await button('이전 요청 그대로 다시 확인').waitFor(); assert.deepEqual(await eventList(), [])
    await button('이전 요청 그대로 다시 확인').click(); await sent().waitFor(); assert.equal((await eventList()).length, 1); assert.equal(await page.evaluate(() => window.qa.writes), 1)
  })
  await test('message', 'AI 메시지의 초안 식별은 원래 번호 복구까지 유지하고 서버 명령에는 넣지 않는다', async () => {
    await button('전달받은 메시지 초안 사용').click(); await page.getByLabel('김교사 · 교무부 [recipient-b]', { exact: true }).check()
    await page.evaluate(() => { window.qa.unknown = true }); await sendMessage(); await button('이전 요청 그대로 다시 확인').waitFor(); assert.deepEqual(await eventList(), [])
    await page.evaluate(() => window.qa.unmount()); await page.getByRole('heading', { name: '메시지와 알림', exact: true }).waitFor({ state: 'detached' }); await page.evaluate(() => window.qa.remount())
    await button('이전 요청 그대로 다시 확인').click(); await sent().waitFor()
    const [result] = await eventList(); assert.equal(result.composeId, 'compose-message-1')
    const calls = await page.evaluate(() => window.qa.calls.filter(call => call.name === 'workhub_message_mutate')); assert.deepEqual(calls[0].args, calls[1].args); assert.equal('composeId' in calls[0].args.p_command, false)
    assert.equal(await page.evaluate(() => window.qa.writes), 1)
  }, true)
  await test('message', 'AI 메시지 초안을 폐기한 뒤 새 수동 전송을 이전 AI 업무로 연결하지 않는다', async () => {
    await button('전달받은 메시지 초안 사용').click(); await button('작성 닫기').click(); await button('작성한 입력 버리고 닫기').click()
    await composeMessage(); await sendMessage(); await sent().waitFor(); assert.equal((await eventList())[0].composeId, undefined)
    assert.equal(await page.evaluate(() => window.qa.writes), 1)
  }, true)
  await test('collection', '수합 초안 저장과 대상 공개는 서로 다른 사용자 확인·접수 결과다', async () => {
    await collectionDraft(); assert.deepEqual(await eventActions(), ['create']); assert.equal(await page.evaluate(() => window.state.request.status), 'draft')
    await button('대상 교사에게 공개').click(); assert.deepEqual(await eventActions(), ['create'])
    await button('대상·양식 확인 후 공개').click(); await button('내 제출 파일 작성').waitFor(); assert.deepEqual(await eventActions(), ['create', 'publish'])
    const [draft, publication] = await eventList(); scope(draft, ['user-0', 'school', 'member-0']); assert.equal(publication.resourceVersion, 2); assert.notEqual(draft.key, publication.key)
    assert.deepEqual(Object.keys(publication).sort(), ['action', 'key', 'kind', 'recordedAt', 'requestId', 'resourceId', 'resourceVersion', 'scope'])
  })
  await test('collection', '양식 일괄 저장은 뼈대 생성 결과를 생략하고 검사·파일 연결 완료만 알린다', async () => {
    await collectionInput(); await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx('배부.hwpx'))
    assert.deepEqual(await eventList(), []); await button('수합 초안 저장').click(); await button('대상 교사에게 공개').waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.command.kind)), ['create', 'update'])
    assert.deepEqual(await eventActions(), ['update']); assert.equal((await eventList())[0].resourceVersion, 2)
    assert.equal(await page.evaluate(() => window.state.request.fileCollection.templates.length), 1)
  })
  for (const mode of ['reject', 'pending']) await test('collection', `양식 ${mode} 상태에서는 생성된 빈 초안을 완료 결과로 알리지 않는다`, async () => {
    await collectionInput(); await page.evaluate(mode => { window.fileMode = mode }, mode); await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx('검사.hwpx')); await button('수합 초안 저장').click()
    await page.waitForFunction(() => window.uploads.some(row => row.kind === 'complete'))
    if (mode === 'pending') await button('같은 파일 상태 다시 확인').waitFor()
    else await page.getByText('서버가 파일을 거부했습니다. 다른 파일을 선택해 주세요.', { exact: true }).waitFor()
    assert.deepEqual(await eventList(), []); assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.command.kind)), ['create'])
    assert.equal(await page.evaluate(() => window.state.request.status), 'draft')
  })
  await test('collection', '수합 초안 응답 유실은 자동 공개하지 않고 원래 번호 복구 뒤에만 저장을 알린다', async () => {
    await collectionInput(); await page.evaluate(() => { window.unknown = 'create' }); await button('수합 초안 저장').click(); await button('이전 요청 그대로 다시 확인').waitFor()
    assert.deepEqual(await eventList(), []); await button('이전 요청 그대로 다시 확인').click(); await button('대상 교사에게 공개').waitFor(); assert.deepEqual(await eventActions(), ['create'])
    const calls = await page.evaluate(() => window.calls); assert.deepEqual(calls[0], calls[1]); assert.equal((await eventList())[0].key, calls[0].key)
  })
  await test('collection', '파일 준비·제출 초안과 최종 접수는 구분하고 유실된 최종 접수는 한 번만 복구한다', async () => {
    await collectionPublish(); await button('내 제출 파일 작성').click(); await page.getByLabel('제출 파일 선택', { exact: true }).setInputFiles(hwpx('제출.hwpx')); await page.getByText(/파일 준비가 완료되었습니다/).waitFor()
    assert.deepEqual(await eventActions(), ['create', 'publish']); await button('제출 초안 저장').click(); await button('최종 제출 내용 확인').waitFor(); assert.deepEqual(await eventActions(), ['create', 'publish', 'save_draft'])
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === '최종 제출 내용 확인' && !node.disabled))
    await button('최종 제출 내용 확인').click(); assert.deepEqual(await eventActions(), ['create', 'publish', 'save_draft'])
    await page.evaluate(() => { window.unknown = 'submit' }); await button('확인한 파일 최종 제출').click(); await button('이전 요청 그대로 다시 확인').waitFor()
    assert.deepEqual(await eventActions(), ['create', 'publish', 'save_draft']); await button('이전 요청 그대로 다시 확인').click(); await page.getByText(/최종 제출을 접수했습니다/).waitFor()
    assert.deepEqual(await eventActions(), ['create', 'publish', 'save_draft', 'submit'])
    const calls = await page.evaluate(() => window.calls.filter(call => call.command.kind === 'submit')); assert.deepEqual(calls[0], calls[1]); assert.equal((await eventList()).at(-1).key, calls[0].key)
    assert.equal(await page.evaluate(() => window.state.submissions.length), 1); assert.equal((await eventList()).at(-1).resourceId, 'submission-1')
  })
  await test('collection', '결과 콜백 실패 후에도 최종 제출 접수와 복구 잠금 해제를 유지한다', async () => {
    await collectionAnswer(); await page.evaluate(() => { window.resultThrows = true }); await submitCollection(); await page.getByText(/최종 제출을 접수했습니다/).waitFor()
    assert.deepEqual(await eventActions(), ['create', 'publish', 'save_draft', 'submit']); assert.equal(await button('이전 요청 그대로 다시 확인').count(), 0)
    assert.equal(await page.evaluate(() => window.state.submissions.length), 1)
  })
  await test('collection', 'AI 수합 초안 식별은 양식 저장의 마지막 update와 원키 복구에만 보존한다', async () => {
    await button('수합 초안 사용').click(); await page.getByLabel('양식 파일 선택', { exact: true }).setInputFiles(hwpx('AI양식.hwpx'))
    await page.evaluate(() => { window.unknown = 'update' }); await button('수합 초안 저장').click(); await button('이전 요청 그대로 다시 확인').waitFor(); assert.deepEqual(await eventList(), [])
    await button('이전 요청 그대로 다시 확인').click(); await button('대상 교사에게 공개').waitFor()
    const [result] = await eventList(); assert.equal(result.action, 'update'); assert.equal(result.composeId, 'compose-1')
    const calls = await page.evaluate(() => window.calls.filter(call => call.command.kind === 'update')); assert.deepEqual(calls[0], calls[1]); assert.equal('composeId' in calls[0].command, false)
    assert.equal(await page.evaluate(() => window.state.request.fileCollection.templates.length), 1)
  }, true)
  await test('collection', 'AI 수합 초안을 취소하고 새로 만든 수합은 이전 초안 식별을 재사용하지 않는다', async () => {
    await button('수합 초안 사용').click(); await button('작성 취소').click(); await collectionDraft()
    assert.equal((await eventList())[0].composeId, undefined); assert.equal((await eventList())[0].action, 'create')
    assert.equal(await page.evaluate(() => window.state.request.title), '결과 연결 수합')
  }, true)
  await test('timetable', '교환 동의 접수는 승인·시간표 반영 결과로 알리지 않는다', async () => {
    await page.evaluate(() => window.addRequest('incoming')); await button('변경안에 동의').click()
    const review = page.getByRole('region', { name: '변경 요청 응답 확인', exact: true })
    await review.getByLabel('현재 수업과 변경 내용을 확인했습니다', { exact: true }).check(); await review.getByRole('button', { name: '확인한 변경에 동의', exact: true }).click()
    await page.waitForFunction(() => window.actualWrites === 1 && window.pending.count() === 0)
    assert.deepEqual(await eventList(), []); assert.equal(await page.evaluate(() => window.view.requests[0].state), 'awaiting_approval')
    assert.deepEqual(await page.evaluate(() => window.view.lessons.map(row => row.version)), [1, 1])
  })
  await test('timetable', '새 교환 요청 접수만으로는 실제 시간표 승인 결과를 만들지 않는다', async () => {
    await page.getByLabel('요청할 변경 종류', { exact: true }).selectOption('swap'); await page.getByLabel('변경할 내 수업', { exact: true }).selectOption('one')
    await page.getByLabel('교환할 상대 수업', { exact: true }).selectOption('two'); await page.getByLabel('변경 요청 사유', { exact: true }).fill('대화로 준비한 교환 요청')
    await button('변경 전후 미리보기').click(); await page.getByLabel('변경되는 수업·시간·관련 교사를 확인했으며 나는 이 변경안에 동의합니다', { exact: true }).check()
    await button('내 동의와 변경 요청 보내기').click(); await page.getByText('관련 교사 동의 대기', { exact: true }).waitFor()
    assert.deepEqual(await eventList(), []); assert.equal(await page.evaluate(() => window.actualWrites), 1)
    assert.deepEqual(await page.evaluate(() => window.view.lessons.map(row => row.version)), [1, 1])
  })
  for (const example of [{ seed: 'manager', open: '승인하지 않음', confirm: '확인한 요청 반려', state: 'rejected' }, { seed: 'own', open: '요청 철회', confirm: '확인한 요청 철회', state: 'withdrawn' }]) await test('timetable', `시간표 ${example.state} 접수는 승인 결과에 포함하지 않는다`, async () => {
    await page.evaluate(seed => window.addRequest(seed), example.seed); await button(example.open).click()
    const review = page.getByRole('region', { name: '변경 요청 응답 확인', exact: true })
    await review.getByLabel('현재 수업과 변경 내용을 확인했습니다', { exact: true }).check(); await review.getByRole('button', { name: example.confirm, exact: true }).click()
    await page.waitForFunction(state => window.view.requests[0].state === state && window.pending.count() === 0, example.state)
    assert.deepEqual(await eventList(), []); assert.equal(await page.evaluate(() => window.actualWrites), 1)
    assert.deepEqual(await page.evaluate(() => window.view.lessons.map(row => row.version)), [1, 1])
  })
  await test('timetable', '최종 승인 접수는 실제 반영된 수업 번호와 판을 정확히 전달한다', async () => {
    await timetableApprove(); await page.getByText('시간표 반영 완료', { exact: true }).waitFor()
    const [result] = await eventList(); scope(result, ['u', 's', 'm']); assert.equal(result.kind, 'timetable'); assert.equal(result.action, 'approve')
    assert.equal(result.requestId, 'request-existing'); assert.equal(result.requestVersion, 2); assert.deepEqual(result.changedLessonIds, ['one', 'two'])
    assert.deepEqual(await page.evaluate(() => window.view.lessons.map(row => row.version)), [2, 2]); assert.equal(await page.evaluate(() => window.actualWrites), 1)
  })
  await test('timetable', '승인 응답 유실 후 원키 접수 조회는 추가 반영 없이 결과를 한 번 전달한다', async () => {
    await page.evaluate(() => { window.failOnce = true }); await timetableApprove(); await button('원래 요청 결과만 다시 확인').waitFor(); assert.deepEqual(await eventList(), [])
    await button('원래 요청 결과만 다시 확인').click(); await page.getByText('시간표 반영 완료', { exact: true }).waitFor()
    assert.equal((await eventList()).length, 1); assert.equal(await page.evaluate(() => window.actualWrites), 1)
    const calls = await page.evaluate(() => window.calls.filter(call => call.name === 'workhub_timetable_operations_execute')); assert.equal(calls[1].args.p_recover_only, true); assert.deepEqual(calls[0].args.p_command, calls[1].args.p_command); assert.equal(calls[0].args.p_request_key, calls[1].args.p_request_key)
  })
  await test('timetable', '요청 닫기가 기존 승인 접수를 발견한 경우에만 실제 반영 결과를 전달한다', async () => {
    await page.evaluate(() => { window.failOnce = true }); await timetableApprove(); await prepareTimetableClose(); assert.deepEqual(await eventList(), [])
    await button('요청 닫기 확인').click(); await page.getByText(/원래 요청이 이미 처리된 것을 확인했습니다/).waitFor()
    assert.equal((await eventList()).length, 1); assert.equal(await page.evaluate(() => window.actualWrites), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    const calls = await page.evaluate(() => window.calls.filter(call => call.name === 'workhub_timetable_operations_abandon')); assert.equal(calls.length, 1); assert.equal(calls[0].args.p_request_key, (await eventList())[0].key)
  })
  await test('timetable', '미접수 승인 요청을 닫은 결과는 승인 완료로 알리지 않는다', async () => {
    await page.evaluate(() => { window.resultBeforeSaveUnknown = true }); await timetableApprove(); await prepareTimetableClose(); await button('요청 닫기 확인').click()
    await page.getByText(/이 요청을 닫았습니다. 입력은 보관했습니다/).waitFor(); assert.deepEqual(await eventList(), [])
    assert.equal(await page.evaluate(() => window.actualWrites), 0); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.deepEqual(await page.evaluate(() => window.view.lessons.map(row => row.version)), [1, 1])
  })
  await test('timetable', '승인 결과 콜백 예외는 이미 반영된 시간표를 재시도 상태로 만들지 않는다', async () => {
    await page.evaluate(() => { window.resultThrows = true }); await timetableApprove(); await page.getByText('시간표 반영 완료', { exact: true }).waitFor()
    assert.equal((await eventList()).length, 1); assert.equal(await page.evaluate(() => window.actualWrites), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    assert.equal(await button('원래 요청 결과만 다시 확인').count(), 0)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log(`업무 처리 결과 브라우저 ${passed.length}건 통과 · 외부 RPC·Storage·유료 AI 호출 0`)
} finally { await browser.close() }
