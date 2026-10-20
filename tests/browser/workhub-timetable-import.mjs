import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./workhub-timetable-import-fixture.tsx', import.meta.url))], bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(10000)
await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }))
const button = name => page.getByRole('button', { name, exact: true })
const csv = 'lessonId,courseId,day,label,start,end,periods,teacherIds,classIds,roomIds\nlesson,course,1,1교시,09:00,09:45,1,teacher,class,room'
const input = () => page.getByLabel('시간표 CSV 내용', { exact: true })
let count = 0
async function boot() { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('http://127.0.0.1:5187/import'); await page.addScriptTag({ content: bundle }); await page.getByText('2027학년도 1학기', { exact: true }).waitFor() }
async function inspect() { await input().fill(csv); await button('공식 자료와 배치 비교').click(); await page.getByRole('region', { name: '가져오기 비교 결과' }).waitFor() }
async function save() { await page.getByLabel('공식 연결과 배치를 확인했습니다.', { exact: true }).check(); await button('서버 초안으로 저장').click() }
async function test(name, run) { await boot(); try { await run() } catch (e) { console.error(await page.locator('body').innerText()); throw e } count++; console.log('  ✓ ' + name) }
try {
 await test('공식 ID·배치 비교와 확인 뒤 한 번 저장하고 공개 검토로 이동', async () => {
  await inspect(); assert.equal(await button('서버 초안으로 저장').isDisabled(), true)
  assert.equal(await page.evaluate(() => window.actualWrites), 0); await save(); await button('이 초안의 공개 검토').waitFor()
  await button('이 초안의 공개 검토').click(); assert.deepEqual(await page.evaluate(() => window.published), [{ id: 'draft', version: 1 }])
  assert.equal(await page.evaluate(() => window.actualWrites), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0); await page.waitForFunction(() => !window.locked)
 })
 await test('잘못된 CSV는 서버 저장 없이 원문과 잠금을 유지', async () => {
  await input().fill(csv.replace(',teacher,', ',wrong,')); await button('공식 자료와 배치 비교').click(); await page.getByRole('alert').waitFor()
  assert.match(await input().inputValue(), /wrong/); assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_preview')).length), 0)
  assert.equal(await page.evaluate(() => window.actualWrites), 0)
 })
 await test('응답 유실·재마운트 뒤 같은 번호로 복구하여 중복 저장하지 않음', async () => {
  await inspect(); await page.evaluate(() => window.dropAfter = true); await save(); await button('같은 요청으로 결과 확인').waitFor()
  const original = await page.evaluate(() => window.calls.find(c => c.name.endsWith('_commit')))
  await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('같은 요청으로 결과 확인').click(); await button('이 초안의 공개 검토').waitFor()
  const calls = await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_commit')))
  assert.deepEqual(calls[1].args, original.args); assert.equal(await page.evaluate(() => window.actualWrites), 1)
 })
 await test('처리 전 단절의 명시적 닫기·닫기 응답 유실 뒤에도 commit으로 돌아가지 않음', async () => {
  await inspect(); await page.evaluate(() => window.dropBefore = true); await save(); await button('이 요청 닫기').waitFor()
  await page.getByLabel('이미 저장되었다면 결과를 확인하고, 미처리 요청은 닫습니다.', { exact: true }).check()
  await page.evaluate(() => window.dropClose = true); await button('이 요청 닫기').click(); await button('닫기 결과 다시 확인').waitFor()
  await page.evaluate(() => { window.root.unmount(); window.mount() }); await button('닫기 결과 다시 확인').click()
  await page.waitForFunction(() => window.pending.count() === 0); assert.equal(await input().inputValue(), csv)
  const calls = await page.evaluate(() => window.calls.filter(c => /_(commit|close)$/.test(c.name)))
  assert.deepEqual(calls.map(c => c.name.split('_').at(-1)), ['commit', 'close', 'close'])
  assert.ok(calls.every(c => c.args.p_request_key === calls[0].args.p_request_key)); assert.equal(await page.evaluate(() => window.actualWrites), 0)
 })
 await test('충돌은 CSV를 보관하고 새 비교 없이는 자동 재전송하지 않음', async () => {
  await inspect(); await page.evaluate(() => window.conflict = true); await save(); await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(() => window.pending.count()), 0); assert.equal(await input().inputValue(), csv)
  assert.equal(await button('서버 초안으로 저장').count(), 0); assert.equal(await page.evaluate(() => window.calls.filter(c => c.name.endsWith('_commit')).length), 1)
 })
 await test('조회 실패가 입력을 지우지 않으며 320px에서 양식과 복구가 보임', async () => {
  await input().fill(csv); await page.evaluate(() => window.failGet = true); await button('현재 학교 자료 다시 확인').click(); await page.getByRole('alert').waitFor()
  assert.equal(await input().inputValue(), csv); await page.setViewportSize({ width: 320, height: 760 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); await page.screenshot({ path: join(process.env.WORKHUB_QA_OUTPUT, 'timetable-import-320.png'), fullPage: true }) }
 })
 await test('홈에서 실제 요청/수업 ID를 넘기고 준비 안 됨·조회 실패를 구분', async () => {
  await button('국어 대강 동의 2027-03-08').click(); assert.equal(await page.evaluate(() => window.summaryOpened.requestId), 'request')
  await page.evaluate(() => { window.summaryFail = 'NOT_READY'; window.revision = 1; window.render() })
  await page.getByRole('region', { name: '시간표 확인할 일' }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByText('시간표 확인할 일 연결 확인', { exact: true }).count(), 0)
  await page.evaluate(() => { window.summaryFail = 'QUERY_FAILED'; window.revision = 2; window.render() })
  await page.getByText('시간표 확인할 일 연결 확인', { exact: true }).waitFor()
 })
 await test('실제 XLSX 파일을 읽고 이름·ID 배치 비교 후에만 서버에 저장',async()=>{
  const bytes=await page.evaluate(()=>window.workbook())
  await page.getByLabel('시간표 파일(XLSX·CSV)',{exact:true}).setInputFiles({name:'학기.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)})
  await page.getByText('학기.xlsx을 읽었습니다. 공식 자료와 배치를 비교한 뒤 저장해 주세요.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.actualWrites),0)
  await button('공식 자료와 배치 비교').click();await page.getByRole('region',{name:'검사한 시간표 배치'}).waitFor()
  assert.match(await page.getByRole('region',{name:'검사한 시간표 배치'}).innerText(),/교사 \[teacher\]/)
  await page.getByLabel('비교할 배치 찾기',{exact:true}).fill('없는 수업');await page.getByText('조건에 맞는 배치가 없습니다.',{exact:true}).waitFor()
  await page.getByLabel('비교할 배치 찾기',{exact:true}).fill('국어');await save();await button('이 초안의 공개 검토').waitFor()
  assert.equal(await page.evaluate(()=>window.actualWrites),1)
 })
 await test('오래된 엑셀 양식과 손상 파일은 기존 CSV·미확정 입력을 보존',async()=>{
  await input().fill(csv)
  const bytes=await page.evaluate(()=>window.workbook('stale'))
  const file=page.getByLabel('시간표 파일(XLSX·CSV)',{exact:true})
  await file.setInputFiles({name:'오래됨.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)})
  await page.getByRole('alert').filter({hasText:'학교 자료가 변경된'}).waitFor();assert.equal(await input().inputValue(),csv)
  await file.setInputFiles({name:'손상.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('bad')})
  await page.getByRole('alert').waitFor();assert.equal(await input().inputValue(),csv);assert.equal(await page.evaluate(()=>window.actualWrites),0)
 })
 await test('비교 결과가 있는 좁은 화면에서 가로 넘침 없이 확인·저장 버튼 유지',async()=>{
  await inspect();await page.setViewportSize({width:320,height:760})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.getByRole('region',{name:'검사한 시간표 배치'}).focus();assert.equal(await button('서버 초안으로 저장').isDisabled(),true)
 })
 assert.deepEqual(errors, []); console.log(`시간표 가져오기·홈: ${count}개 통과`)
} finally { await browser.close() }
