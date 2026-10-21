// 실제 화면·T3 전송 어댑터 + 합성 RPC/Claude 응답. 운영 DB·외부 API를 호출하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-interventions-fixture.tsx', import.meta.url))], bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }))
const button = name => page.getByRole('button', { name, exact: true }), label = name => page.getByLabel(name, { exact: true })
let count = 0
async function boot() { await page.goto('http://127.0.0.1:5187/interventions'); await page.addScriptTag({ content: bundle }); await label('대강 교사').locator('option[value="teacher-b"]').waitFor({ state: 'attached' }) }
async function compose() { await label('대강 교사').selectOption('teacher-b'); await label('변경 사유').fill('교내 연수로 대강 요청'); await button('변경 영향 확인').click(); await page.getByRole('region', { name: '수업 변경 확인' }).waitFor() }
async function submit() { await label('대상 수업과 영향받는 교사를 확인했습니다.').check(); await button('동의 요청 보내기').click() }
async function act(name) { await button(name).click(); await label('이 요청의 처리 내용을 확인했습니다.').check(); await button('확인한 처리 반영').click(); await page.waitForFunction(() => window.pending.count() === 0) }
async function ask() { await page.getByText('Claude와 수업 변경 상담하기', { exact: true }).click(); await label('도움받을 내용').fill('다음 수업을 다른 선생님이 맡을 수 있을까요?'); await button('Claude에게 변경 상담').click() }
async function test(name, fn) { try { await boot(); await fn() } catch (e) { console.error(await page.locator('body').innerText(), errors); throw e } count++; console.log('  ✓ ' + name) }
try {
  await test('변경안 명시 확인 뒤 관련 교사 두 명의 수락과 별도 담당 승인으로 반영', async () => {
    await compose(); assert.equal(await button('동의 요청 보내기').isDisabled(), true); assert.equal(await page.evaluate(() => window.writes), 0); await submit()
    await button('수락').waitFor(); assert.deepEqual(await page.evaluate(() => window.lesson), await page.evaluate(() => window.originalLesson))
    await act('수락'); await page.evaluate(() => window.switchMember('teacher-b')); await button('수락').waitFor(); await act('수락')
    assert.equal(await button('최종 승인').count(), 0); assert.deepEqual(await page.evaluate(() => window.lesson), await page.evaluate(() => window.originalLesson))
    await page.evaluate(() => window.switchMember('manager')); await button('최종 승인').waitFor(); await act('최종 승인')
    await page.getByText('대강 · 반영 완료', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.lesson.version), 2); assert.deepEqual(await page.evaluate(() => window.lesson.teachers.map(t => t.id)), ['teacher-b'])
  })
  await test('충돌 안내와 변경 사유 수정은 승인 확인을 폐기하고 자동 제출하지 않음', async () => {
    await page.evaluate(() => window.blocked = true); await compose(); await page.getByText('대강 교사의 다른 수업과 겹칩니다.', { exact: true }).waitFor()
    assert.equal(await button('동의 요청 보내기').isDisabled(), true); await label('변경 사유').fill('사유 수정'); assert.equal(await button('동의 요청 보내기').count(), 0); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('응답 유실·재마운트 뒤 원래 번호와 내용으로만 복구', async () => {
    await compose(); await page.evaluate(() => window.dropAfter = true); await submit(); await button('같은 요청 결과 확인').waitFor()
    const first = await page.evaluate(() => window.pendingRow()); await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('같은 요청 결과 확인').click()
    await page.waitForFunction(() => window.pending.count() === 0); const calls = await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_execute')))
    assert.equal(calls.length, 2); assert.deepEqual(calls[1].args.p_command, first.command); assert.equal(calls[1].args.p_request_key, first.key); assert.equal(calls[1].args.p_recover_only, true); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('미처리 요청 닫기 유실은 닫기만 재확인하며 작성 내용 보존', async () => {
    await compose(); await page.evaluate(() => window.dropBefore = true); await submit(); await button('이 요청 닫기').waitFor()
    assert.equal(await button('이 요청 닫기').isDisabled(), true); await label('이미 처리된 결과 또는 닫힘을 확인한 뒤 이 요청을 종료합니다.').check()
    await page.evaluate(() => window.dropClose = true); await button('이 요청 닫기').click(); await button('요청 닫힘 다시 확인').waitFor()
    assert.equal(await button('같은 요청 결과 확인').isDisabled(), true); await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('요청 닫힘 다시 확인').click()
    await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await label('변경 사유').inputValue(), '교내 연수로 대강 요청')
    const calls = await page.evaluate(() => window.calls.filter(c => /_(execute|close)$/.test(c.name)))
    assert.deepEqual(calls.map(c => c.name.split('_').at(-1)), ['execute', 'close', 'close']); assert.equal(new Set(calls.map(c => c.args.p_request_key)).size, 1); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('모듈 중지 중에도 이전 처리 결과를 원키로 확인', async () => {
    await compose(); await page.evaluate(() => window.dropAfter = true); await submit(); await button('같은 요청 결과 확인').waitFor()
    await page.evaluate(() => { window.notReady = true; window.refresh() }); await page.getByText(/학교에서 대강·보강 요청 연결을 준비 중입니다/).waitFor()
    await button('같은 요청 결과 확인').click(); await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('늦은 미리보기는 바뀐 수업판에 다시 붙지 않음', async () => {
    await label('대강 교사').selectOption('teacher-b'); await label('변경 사유').fill('보존할 사유'); await page.evaluate(() => window.holdPreview = true)
    await button('변경 영향 확인').click(); await page.waitForFunction(() => typeof window.releasePreview === 'function')
    await page.evaluate(() => { window.lesson.version++; window.refresh() }); await page.waitForFunction(() => window.calls.filter(c => c.name.endsWith('_get')).length >= 2)
    await page.evaluate(() => window.releasePreview()); await button('변경 영향 확인').waitFor(); await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('region', { name: '수업 변경 확인' }).count(), 0); assert.equal(await label('변경 사유').inputValue(), '보존할 사유')
  })
  await test('Claude 제안은 확인 후 입력만 채우며 서버 요청을 자동 생성하지 않음', async () => {
    await ask(); await page.getByRole('region', { name: 'AI 수업 변경 제안' }).waitFor(); assert.equal(await button('확인한 제안을 입력에 채우기').isDisabled(), true)
    await label('AI 제안을 입력란에 채우고 서버에서 변경 영향을 확인하겠습니다.').check(); await button('확인한 제안을 입력에 채우기').click()
    assert.equal(await label('대강 교사').inputValue(), 'teacher-b'); assert.equal(await label('변경 사유').inputValue(), '상담한 대강 요청'); assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview') || c.name.endsWith('_execute')).length), 0)
  })
  await test('AI 대기 중 수업판 변경은 늦은 제안을 현재 입력에 적용하지 않음', async () => {
    await page.evaluate(() => window.holdAI = true); await ask(); await page.waitForFunction(() => typeof window.releaseAI === 'function')
    await page.evaluate(() => { window.lesson.version++; window.refresh() }); await page.waitForFunction(() => window.calls.filter(c => c.name.endsWith('_get')).length >= 2); await page.evaluate(() => window.releaseAI())
    await page.getByText('요청 뒤 수업이나 교사 기준이 바뀌었습니다. 이전 답변을 현재 입력에 적용하지 않았습니다.', { exact: true }).waitFor()
    assert.equal(await button('확인한 제안을 입력에 채우기').count(), 0); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('모듈 중지 뒤에도 AI 결과 미상은 같은 번호로 회복하고 새 제안을 금지', async () => {
    await page.evaluate(() => window.aiPending = true); await ask(); await button('원래 AI 요청 결과 확인').waitFor(); const key = await page.evaluate(() => window.aiCalls[0].key)
    await page.evaluate(() => { window.notReady = true; window.aiPending = false; window.refresh() }); await page.getByText(/학교에서 대강·보강 요청 연결을 준비 중입니다/).waitFor()
    await button('원래 AI 요청 결과 확인').click(); await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await page.evaluate(() => window.aiCalls[1].key), key); assert.equal(await button('확인한 제안을 입력에 채우기').count(), 0)
  })
  await test('명시적으로 이동 요청에 넘긴 뒤 T3/AI 잠금을 해제하고 기존 교환 입력 연결', async () => {
    await page.evaluate(() => window.aiMode = 'move'); await ask(); await page.getByRole('region', { name: 'AI 수업 변경 제안' }).waitFor()
    await label('AI 제안을 입력란에 채우고 서버에서 변경 영향을 확인하겠습니다.').check(); await button('확인한 제안을 입력에 채우기').click()
    await label('변경 요청 사유').waitFor(); await page.waitForFunction(() => !window.locked); assert.equal(await label('변경 요청 사유').inputValue(), '상담한 수업 이동'); assert.equal(await label('요청할 변경 종류').inputValue(), 'move'); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('학교·계정 전환은 이전 입력과 비동기 응답을 새 소속에 노출하지 않음', async () => {
    await label('변경 사유').fill('원담당자의 보존 입력'); await page.evaluate(() => window.switchMember('teacher-b'))
    await label('변경 사유').waitFor(); await page.waitForFunction(() => document.querySelector('textarea[placeholder]')?.value === ''); assert.equal(await label('변경 사유').inputValue(), '')
    await page.evaluate(() => window.switchMember('teacher-a')); await page.waitForFunction(() => document.querySelector('textarea[placeholder]')?.value === '원담당자의 보존 입력')
  })
  await test('조회 실패 입력은 명시 확인 후 버릴 수 있고 결과 미상 때는 폐기 금지', async () => {
    await label('변경 사유').fill('보존할 입력'); await page.evaluate(() => { window.failGet = true; window.refresh() })
    await button('입력 버리고 이동 잠금 해제').waitFor(); assert.equal(await button('입력 버리고 이동 잠금 해제').isDisabled(), true)
    await label('서버로 보내지 않은 수업 변경 입력을 버립니다.').check(); await button('입력 버리고 이동 잠금 해제').click(); await page.waitForFunction(() => !window.locked)
    await page.evaluate(() => { window.failGet = false; window.refresh() }); await label('변경 사유').waitFor(); assert.equal(await label('변경 사유').inputValue(), '')
    await compose(); await page.evaluate(() => window.dropBefore = true); await submit(); await button('같은 요청 결과 확인').waitFor()
    await page.evaluate(() => { window.failGet = true; window.refresh() }); await page.getByRole('alert').waitFor(); assert.equal(await button('입력 버리고 이동 잠금 해제').count(), 0)
  })
  await test('휴강은 결손 시수를 확인하고 교사 반려와 요청 철회는 수업을 유지', async () => {
    await label('처리할 일').selectOption('cancel'); await label('변경 사유').fill('특별 일정으로 휴강 검토'); await button('변경 영향 확인').click()
    await page.getByText('결손 45분 · 추가 0분', { exact: true }).waitFor(); await submit(); await button('반려').waitFor(); await act('반려')
    await page.getByText('휴강 · 반려', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.lesson), await page.evaluate(() => window.originalLesson))
    await compose(); await submit(); await button('철회').waitFor(); await act('철회'); await page.getByText('대강 · 철회', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.lesson.version), 1)
  })
  await test('보강은 원수업 번호와 학교 시간대를 서버에 전달하고 휴업 취소는 전체 기록을 선택', async () => {
    await page.evaluate(() => { window.lesson.state = 'cancelled'; window.lesson.canRequest = false; window.lesson.allowedTargets = []; window.closures = [{ id: 'holiday', date: window.future, reason: '학교 휴업', lessonIds: ['lesson-one'], reopened: false }]; window.refresh() })
    await label('처리할 일').selectOption('makeup'); await label('대상 수업').locator('option[value="lesson-one"]').waitFor({ state: 'attached' }); await label('대상 수업').selectOption('lesson-one')
    const day = await page.evaluate(() => window.future); await label('보강 시작 시각').fill(day + 'T11:00'); await label('보강 종료 시각').fill(day + 'T11:45'); await label('변경 사유').fill('휴강 수업 보강')
    await button('변경 영향 확인').click(); await page.getByText('결손 0분 · 추가 45분', { exact: true }).waitFor()
    const call = await page.evaluate(() => window.calls.find(c => c.name.endsWith('_preview')).args.p_input)
    assert.equal(call.lessonId, 'lesson-one'); assert.equal(call.target.startsAt, day + 'T02:00:00.000Z'); assert.equal(await page.evaluate(() => window.lesson.state), 'cancelled')
    await label('처리할 일').selectOption('reopen'); await label('취소할 휴업').selectOption('holiday'); await label('변경 사유').fill('휴업 계획 취소'); await button('변경 영향 확인').click()
    await page.getByRole('heading', { name: '휴업 취소 변경 확인', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview')).at(-1).args.p_input.schoolDayChangeId), 'holiday'); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('요청 기한이 지나면 수락 확인 화면도 새 명령을 보내지 않음', async () => {
    await compose(); await submit(); await button('수락').click(); await label('이 요청의 처리 내용을 확인했습니다.').check()
    await page.evaluate(() => { const late = Date.now() + 700000; Date.now = () => late }); await page.getByText('요청 기한이 지났습니다. 최신 요청을 다시 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await button('확인한 처리 반영').isDisabled(), true); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('기존 요청에 수락해도 별도로 작성한 새 요청 입력은 보존', async () => {
    await compose(); await submit(); await button('수락').waitFor()
    await label('대강 교사').selectOption('teacher-b'); await label('변경 사유').fill('별도 작성 중인 다음 요청'); await act('수락')
    await label('변경 사유').waitFor(); assert.equal(await label('변경 사유').inputValue(), '별도 작성 중인 다음 요청'); assert.equal(await label('대강 교사').inputValue(), 'teacher-b')
  })
  await test('홈 보강 의도는 현재 취소 원수업을 보강 입력으로 열고 자동 제출하지 않음', async () => {
    await page.evaluate(() => { window.lesson.state = 'cancelled'; window.lesson.canRequest = false; window.initialIntent = { kind: 'makeup', lessonId: 'lesson-one', token: 'home-one' }; window.refresh() })
    await page.waitForFunction(() => window.consumedIntent === 'home-one')
    assert.equal(await label('처리할 일').inputValue(), 'makeup'); assert.equal(await label('대상 수업').inputValue(), 'lesson-one')
    assert.equal(await label('변경 사유').inputValue(), ''); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('홈 보강 이동은 작성 입력을 보존하고 별도 체크 뒤에만 바꿈', async () => {
    await label('대강 교사').selectOption('teacher-b'); await label('변경 사유').fill('계속 작성할 사유')
    await page.evaluate(() => { window.lesson.state = 'cancelled'; window.lesson.canRequest = false; window.initialIntent = { kind: 'makeup', lessonId: 'lesson-one', token: 'home-two' }; window.refresh() })
    await page.getByRole('region', { name: '홈에서 연 보강 입력' }).waitFor(); assert.equal(await label('변경 사유').inputValue(), '계속 작성할 사유')
    assert.equal(await button('선택한 보강 입력으로 이동').isDisabled(), true); await button('기존 입력 계속 작성').click()
    assert.equal(await label('변경 사유').inputValue(), '계속 작성할 사유'); assert.equal(await page.evaluate(() => window.consumedIntent), 'home-two')
    await page.evaluate(() => { window.initialIntent = { kind: 'makeup', lessonId: 'lesson-one', token: 'home-three' }; window.refresh() })
    await label('작성 중인 입력을 정리하고 선택한 수업의 보강을 작성합니다.').check(); await button('선택한 보강 입력으로 이동').click()
    assert.equal(await label('처리할 일').inputValue(), 'makeup'); assert.equal(await label('변경 사유').inputValue(), '')
    assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('결과 미상 요청이 있으면 홈 보강 전환도 원번호와 입력을 바꾸지 않음', async () => {
    await compose(); await page.evaluate(() => window.dropBefore = true); await submit(); await button('같은 요청 결과 확인').waitFor()
    const original = await page.evaluate(() => window.pendingRow())
    await page.evaluate(() => { window.lesson.state = 'cancelled'; window.lesson.canRequest = false; window.initialIntent = { kind: 'makeup', lessonId: 'lesson-one', token: 'home-pending' }; window.refresh() })
    await button('선택한 보강 입력으로 이동').waitFor()
    assert.equal(await button('선택한 보강 입력으로 이동').isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.pendingRow()), original)
    assert.equal(await label('변경 사유').inputValue(), '교내 연수로 대강 요청'); assert.equal(await page.evaluate(() => window.consumedIntent ?? null), null)
  })
  await test('같은 수업 변경은 사유를 다시 써도 중복 미리보기·전송을 막음', async () => {
    await compose(); await submit(); await button('수락').waitFor()
    const before = await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview')).length)
    await label('대강 교사').selectOption('teacher-b'); await label('변경 사유').fill('새로 적은 같은 요청')
    await page.getByText('같은 변경 요청이 진행 중입니다. 새 요청 대신 기존 진행 상태를 확인해 주세요.', { exact: true }).waitFor()
    assert.equal(await button('변경 영향 확인').isDisabled(), true); await button('기존 변경 요청 보기').click()
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview')).length), before); assert.equal(await page.evaluate(() => window.writes), 1)
  })
  await test('보강 시각 오입력과 길이 차이를 전송 전에 알리고 원수업 길이 채우기', async () => {
    await page.evaluate(() => { window.lesson.state = 'cancelled'; window.lesson.canRequest = false; window.refresh() })
    await label('처리할 일').selectOption('makeup'); await label('대상 수업').locator('option[value="lesson-one"]').waitFor({ state: 'attached' }); await label('대상 수업').selectOption('lesson-one')
    const day = await page.evaluate(() => window.future)
    await label('보강 시작 시각').fill(day + 'T11:00'); await label('보강 종료 시각').fill(day + 'T11:30'); await label('변경 사유').fill('보강할 수업')
    await page.getByText('보강 길이를 원수업과 같게 맞춰 주세요.', { exact: true }).waitFor(); assert.equal(await button('변경 영향 확인').isDisabled(), true)
    await button('원수업 길이로 종료 시각 맞추기').click(); assert.equal(await label('보강 종료 시각').inputValue(), day + 'T11:45'); assert.equal(await button('변경 영향 확인').isDisabled(), false)
    await label('보강 시작 시각').fill(''); assert.equal(await button('변경 영향 확인').isDisabled(), true)
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview')).length), 0)
  })
  await test('요청 목록 검색·상태 필터는 원자료와 현재 선택한 처리 확인을 보존', async () => {
    await compose(); await submit(); await button('수락').waitFor()
    await page.evaluate(() => {
      const other = structuredClone(window.requests[0]); other.id = 'finished-request'; other.state = 'applied'; other.reason = other.input.reason = '확정된 과학 보강'
      other.participants.forEach(p => { p.response = 'accepted'; p.respondedAt = other.createdAt })
      window.requests.push(other); window.refresh()
    })
    await label('수업 변경 요청 상태').selectOption('finished'); await page.getByText('확정된 과학 보강', { exact: true }).waitFor(); assert.equal(await button('수락').count(), 0)
    await label('수업 변경 요청 검색').fill('없는교사'); await page.getByText('검색 조건에 맞는 요청이 없습니다.', { exact: true }).waitFor()
    await label('수업 변경 요청 검색').fill(''); await label('수업 변경 요청 상태').selectOption('mine'); await button('수락').click()
    await label('수업 변경 요청 검색').fill('필터 밖'); await page.getByRole('region', { name: '수업 요청 처리 확인' }).waitFor()
    assert.equal(await page.evaluate(() => window.requests.length), 2); assert.equal(await page.evaluate(() => window.writes), 1)
    await page.setViewportSize({ width: 320, height: 760 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.setViewportSize({ width: 1280, height: 900 })
  })
  await test('Claude 제안으로 기존 입력을 바꿀 때 추가 확인하며 입력 변경은 동의를 다시 받음', async () => {
    await label('변경 사유').fill('보존할 수동 입력'); await ask(); await page.getByRole('region', { name: 'AI 수업 변경 제안' }).waitFor()
    await label('AI 제안을 입력란에 채우고 서버에서 변경 영향을 확인하겠습니다.').check()
    assert.equal(await button('확인한 제안을 입력에 채우기').isDisabled(), true); assert.equal(await label('변경 사유').inputValue(), '보존할 수동 입력')
    await label('작성 중인 변경 입력을 이 제안으로 바꿉니다.').check()
    await label('변경 사유').fill('추가로 고친 수동 입력'); assert.equal(await label('작성 중인 변경 입력을 이 제안으로 바꿉니다.').isChecked(), false)
    await label('작성 중인 변경 입력을 이 제안으로 바꿉니다.').check(); await button('확인한 제안을 입력에 채우기').click()
    assert.equal(await label('변경 사유').inputValue(), '상담한 대강 요청'); assert.equal(await page.evaluate(() => window.writes), 0)
  })
  await test('홈 요약 종류 필터와 더 보기에서 보강 원수업·완전하지 않은 개수 경계를 유지', async () => {
    await page.evaluate(() => {
      window.summary = { asOf: new Date().toISOString(), pendingConsent: 4, pendingApproval: 2, makeupNeeded: 10, items: Array.from({ length: 6 }, (_, n) => ({
        id: 'summary-' + n, kind: n < 2 ? 'consent' : 'makeup', label: '요약 수업 ' + n, date: window.future, lessonId: 'lesson-' + n, requestId: n < 2 ? 'request-' + n : null,
      })) }; window.refresh()
    })
    const region = page.getByRole('region', { name: '시간표 확인할 일' })
    await region.waitFor(); assert.equal(await region.locator('li').count(), 3)
    await region.getByRole('button', { name: '보강 10', exact: true }).click(); assert.equal(await region.locator('li').count(), 3)
    await region.getByRole('button', { name: '확인할 일 더 보기 (1건)', exact: true }).click(); assert.equal(await region.locator('li').count(), 4)
    await region.getByText('전체 16건 중 먼저 확인할 6건을 불러왔습니다. 나머지는 시간표에서 확인하세요.', { exact: true }).waitFor()
    await region.locator('li button').first().click()
    assert.equal(await page.evaluate(() => window.openedSummary.kind), 'makeup'); assert.equal(await page.evaluate(() => window.openedSummary.lessonId), 'lesson-2'); assert.equal(await page.evaluate(() => window.openedSummary.requestId), null)
  })
  await test('운영 AI 선행비용 실패는 상담 원문을 유지하고 새 유료 요청을 자동 시작하지 않음',async()=>{await page.evaluate(()=>window.aiFailCode='KEY_UNAVAILABLE');await ask();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),0);assert.equal(await label('도움받을 내용').inputValue(),'다음 수업을 다른 선생님이 맡을 수 있을까요?');assert.equal(await page.evaluate(()=>window.aiCalls.length),1)})
  await test('운영 상담 원키 닫기는 미상 뒤 같은 번호로 재닫고 수업을 바꾸지 않음',async()=>{await page.evaluate(()=>{window.aiPending=true;window.aiCloseUnknown=true});await ask();await button('새 호출 없이 요청 닫기').click();await button('같은 번호로 AI 닫기 결과 확인').waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);await button('같은 번호로 AI 닫기 결과 확인').click();await page.getByText('AI 요청을 닫았습니다. 늦은 실행을 막았으며 상담 입력은 그대로입니다.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),0);const calls=await page.evaluate(()=>window.aiCloses);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.writes),0)})
  assert.deepEqual(errors, []); console.log(`시간표 대강·휴강·보강·Claude 화면 ${count}개 통과`)
} finally { await browser.close() }
