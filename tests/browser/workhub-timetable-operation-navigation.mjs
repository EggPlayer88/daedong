import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-operation-navigation-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = [], external = []
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5240/')) external.push(request.url()) })
await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px}*{box-sizing:border-box}</style><div id="root"></div></html>' }))
let count = 0
const button = name => page.getByRole('button', { name, exact: true })
async function start() { await page.goto('http://127.0.0.1:5240/operations'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).waitFor(); await page.waitForFunction(() => window.calls.some(row => row.method === 'interventions.get')) }
async function check(name, run) { await start(); await run(); count++; console.log('  ✓ ' + name) }
async function selectLesson(label) { await page.getByRole('button', { name: new RegExp(label) }).first().click(); await page.getByRole('region', { name: '선택 수업의 추가 처리', exact: true }).waitFor() }
async function reopenLesson(id) {
  const before = await page.evaluate(() => window.calls.filter(row => row.method === 'operations.get').length)
  await page.evaluate(() => window.leaveOperations()); await page.getByText('합성 일정 화면', { exact: true }).waitFor()
  await page.evaluate(value => window.openLesson(value), id)
  await page.waitForFunction(count => window.calls.filter(row => row.method === 'operations.get').length > count, before)
  await page.getByRole('navigation', { name: '시간표 운영 작업', exact: true }).waitFor()
}
async function publication() {
  await button('시간표 확정').click(); await page.getByLabel('확정할 저장 초안', { exact: true }).selectOption('draft@1')
  const date = await page.evaluate(() => window.later); await page.getByLabel('적용 시작일', { exact: true }).fill(date); await page.getByLabel('적용 마지막 날', { exact: true }).fill(date)
  await button('적용 전 변경 영향 확인').click(); await page.getByLabel('적용 기간과 변경 수업을 확인했으며, 학교 시간표로 확정합니다.', { exact: true }).check()
}
try {
await check('공유 시간표의 선택 수업에서 대강·휴강을 정확한 원수업으로 열고 자동 전송하지 않는다', async () => {
  await selectLesson('선택 국어'); await button('대강 요청 작성').click(); await page.getByLabel('처리할 일', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('처리할 일', { exact: true }).inputValue(), 'substitute'); assert.equal(await page.getByLabel('대상 수업', { exact: true }).inputValue(), 'scheduled')
  await button('선택 수업으로 돌아가기').click(); await button('휴강 요청 작성').click()
  await page.waitForFunction(() => document.querySelector('[aria-label="처리할 일"]').value === 'cancel')
  assert.equal(await page.getByLabel('대상 수업', { exact: true }).inputValue(), 'scheduled'); assert.equal(await page.evaluate(() => window.writes), 0)
})
await check('취소 수업은 보강 입력으로 연결하고 작성 입력을 정리하기 전에는 공통 기간을 옮기지 않는다', async () => {
  await selectLesson('취소 과학'); await button('이 취소 수업 보강 작성').click()
  await page.waitForFunction(() => document.querySelector('[aria-label="처리할 일"]').value === 'makeup')
  assert.equal(await page.getByLabel('처리할 일', { exact: true }).inputValue(), 'makeup'); assert.equal(await page.getByLabel('대상 수업', { exact: true }).inputValue(), 'cancelled')
  await page.getByLabel('변경 사유', { exact: true }).fill('보존할 보강 입력')
  assert.equal(await button('다음 조회 기간').isDisabled(), true); assert.equal(await button('선택 수업으로 돌아가기').isDisabled(), true)
  await button('입력 취소').click(); await button('선택 수업으로 돌아가기').click(); assert.equal(await page.evaluate(() => window.writes), 0)
})
await check('선택 수업의 실시 기록을 바로 펼치며 다른 수업 기록이나 쓰기를 시작하지 않는다', async () => {
  await selectLesson('취소 과학'); await button('이 수업 실시 기록 보기').click()
  await page.locator('details.timetable-execution-records[open]').waitFor(); assert.equal(await page.evaluate(() => window.calls.filter(row => row.method === 'records.get').at(-1).id), 'cancelled')
  assert.equal(await page.evaluate(() => window.writes), 0)
})
await check('빈 공통 날짜는 조회하지 않고 기간 변경 뒤 학사 변경 날짜·학급·사유를 보존한다', async () => {
  await page.getByLabel('운영 조회 날짜', { exact: true }).fill(''); assert.equal(await button('이 날짜 조회').isDisabled(), true)
  await button('시간표 확정').click(); await page.getByText('행사·휴업·특별일과 관리', { exact: true }).click()
  const date = await page.evaluate(() => window.future); await page.getByLabel('학사 변경 날짜', { exact: true }).fill(date); await page.getByRole('group', { name: '영향받는 학급', exact: true }).getByLabel('1학년 1반').check(); await page.getByLabel('학사 변경 사유', { exact: true }).fill('보존할 행사 사유')
  await button('바뀔 수업 미리보기').click(); await page.getByRole('heading', { name: '반영 전 수업 확인', exact: true }).waitFor()
  await button('다음 조회 기간').click(); await page.getByLabel('학사 변경 날짜', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('학사 변경 날짜', { exact: true }).inputValue(), date); assert.equal(await page.getByLabel('학사 변경 사유', { exact: true }).inputValue(), '보존할 행사 사유')
  assert.equal(await page.getByRole('heading', { name: '반영 전 수업 확인', exact: true }).count(), 0); await page.getByText(/입력한 날짜가 현재 조회 기간에 없습니다/).waitFor(); assert.equal(await page.evaluate(() => window.writes), 0)
})
await check('학사 변경을 막는 교환 요청을 보고 원래 학사 초안으로 돌아온다', async () => {
  await page.evaluate(() => { window.blocking = true; window.refresh() }); await button('시간표 확정').click(); await page.getByText('행사·휴업·특별일과 관리', { exact: true }).click()
  await page.getByLabel('학사 변경 날짜', { exact: true }).fill(await page.evaluate(() => window.future)); await page.getByRole('group', { name: '영향받는 학급', exact: true }).getByLabel('1학년 1반').check(); await page.getByLabel('학사 변경 사유', { exact: true }).fill('기존 교환 확인 중')
  await button('바뀔 수업 미리보기').click(); await page.getByText('먼저 확인할 기존 교환 1건', { exact: true }).click(); await button('이 교환 요청 확인 · blocked-request').click()
  await page.getByText('보존할 교환 요청', { exact: true }).waitFor(); await button('보관한 학사 변경으로 돌아가기').click()
  assert.equal(await page.getByLabel('학사 변경 사유', { exact: true }).inputValue(), '기존 교환 확인 중'); assert.equal(await page.evaluate(() => window.writes), 0)
})
await check('먼 미래 공개 완료 뒤에만 해당 날짜로 이동 버튼을 제공하고 명시 클릭으로 조회한다', async () => {
  await publication(); await button('확인한 시간표 확정').click(); await button('반영한 날짜의 시간표 보기').waitFor()
  assert.notEqual(await page.getByLabel('운영 조회 날짜', { exact: true }).inputValue(), await page.evaluate(() => window.later))
  await button('반영한 날짜의 시간표 보기').click(); await page.waitForFunction(() => document.querySelector('[aria-label="운영 조회 날짜"]').value === window.later)
  assert.equal(await page.evaluate(() => window.writes), 1); assert.equal(await button('공유 시간표').getAttribute('aria-pressed'), 'true')
})
await check('결과 미상에는 기간 이동을 잠그고 원래 키 복구 후 완료 날짜 연결을 제공한다', async () => {
  await publication(); await page.evaluate(() => window.dropResult = true); await button('확인한 시간표 확정').click(); await button('원래 요청 결과만 다시 확인').waitFor()
  assert.equal(await button('다음 조회 기간').isDisabled(), true); assert.equal(await button('반영한 날짜의 시간표 보기').count(), 0)
  await button('원래 요청 결과만 다시 확인').click(); await button('반영한 날짜의 시간표 보기').waitFor()
  const calls = await page.evaluate(() => window.calls.filter(row => ['execute', 'recover'].includes(row.method))); assert.equal(calls.length, 2); assert.equal(calls[0].key, calls[1].key); assert.deepEqual(calls[0].command, calls[1].command)
  assert.equal(await page.evaluate(() => window.writes), 1)
})
await check('T3 권한 조회 실패 뒤 이전 수업 연결을 사용하지 않고 공유 시간표 조회는 유지한다', async () => {
  await selectLesson('선택 국어'); assert.equal(await button('대강 요청 작성').isDisabled(), false)
  await page.evaluate(() => { window.failT3 = true; window.refresh() }); await button('대강 요청 작성').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].find(row => row.textContent === '대강 요청 작성')?.disabled)
  assert.equal(await page.getByRole('heading', { name: '학교가 확정한 수업', exact: true }).count(), 1); assert.equal(await page.evaluate(() => window.writes), 0)
})
for (const previousTab of ['교환·변경 요청', '시간표 확정']) {
await check(`저장된 ${previousTab} 탭보다 일정의 정확한 수업 연결을 우선해 공유 시간표를 연다`, async () => {
  await button(previousTab).click(); assert.equal(await button(previousTab).getAttribute('aria-pressed'), 'true')
  await reopenLesson('cancelled')
  assert.equal(await button('공유 시간표').getAttribute('aria-pressed'), 'true')
  await page.getByRole('region', { name: '선택한 수업', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /취소 과학/ }).first().getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('button', { name: /선택 국어/ }).first().getAttribute('aria-pressed'), 'false')
  assert.equal(await page.getByLabel('운영 조회 날짜', { exact: true }).inputValue(), await page.evaluate(() => window.future))
  await button('이 수업 실시 기록 보기').click(); await page.getByRole('heading', { name: '취소 과학 [cancelled]', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.calls.filter(row => row.method === 'records.get').at(-1).id), 'cancelled')
  assert.equal(await page.evaluate(() => window.writes), 0)
})
}
await check('수업 연결로 다시 열어도 미확정 확정 요청의 탭·원키·원문 복구가 먼저 유지된다', async () => {
  await publication(); await page.evaluate(() => window.dropResult = true); await button('확인한 시간표 확정').click(); await button('원래 요청 결과만 다시 확인').waitFor()
  const original = await page.evaluate(() => window.calls.find(row => row.method === 'execute'))
  await reopenLesson('cancelled'); await button('원래 요청 결과만 다시 확인').waitFor()
  assert.equal(await button('시간표 확정 · 작성 중').getAttribute('aria-pressed'), 'true')
  assert.equal(await button('공유 시간표').isDisabled(), true)
  assert.equal(await page.evaluate(() => window.pending.count()), 1)
  assert.equal(await page.evaluate(() => window.calls.filter(row => row.method === 'execute').length), 1)
  await button('원래 요청 결과만 다시 확인').click(); await button('반영한 날짜의 시간표 보기').waitFor()
  const recovered = await page.evaluate(() => window.calls.find(row => row.method === 'recover'))
  assert.equal(recovered.key, original.key); assert.deepEqual(recovered.command, original.command)
  assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await page.evaluate(() => window.writes), 1)
})
await check('다른 수업 링크보다 미확정 실시 기록의 원수업을 먼저 표시하고 원키로 복구한다', async () => {
  await page.evaluate(() => window.leaveOperations()); await page.getByText('합성 일정 화면', { exact: true }).waitFor()
  const original = await page.evaluate(() => window.seedRecordRecovery())
  await page.evaluate(() => window.openLesson('cancelled'))
  await page.getByRole('heading', { name: '복구할 지난 수업 [record-original]', exact: true }).waitFor()
  assert.equal(await button('공유 시간표').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('heading', { name: '취소 과학 [cancelled]', exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => window.calls.filter(row => row.method === 'records.get').at(-1).id), 'record-original')
  assert.equal(await page.evaluate(() => window.pending.count()), 1)
  await button('원래 실시 기록 결과 확인').click(); await page.getByText('저장한 실시 기록과 현재 기록을 다시 확인했습니다.', { exact: true }).waitFor()
  const recovered = await page.evaluate(() => window.calls.find(row => row.method === 'records.recover'))
  assert.equal(recovered.key, original.key); assert.deepEqual(recovered.command, original.command)
  assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await page.evaluate(() => window.writes), 0)
})
assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log(`시간표 운영 동선 브라우저 검사: ${count}개 통과`)
} catch (error) { console.log(await page.locator('body').innerText()); console.log(errors); throw error } finally { await browser.close() }
