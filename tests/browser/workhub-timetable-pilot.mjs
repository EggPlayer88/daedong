import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchBrowser } from './launch-browser.mjs'

const contents = `
import {createRoot} from 'react-dom/client'
import {TimetablePilotPanel} from '../../apps/workhub/src/timetable/pilot/TimetablePilotPanel'
import {getPilotFixture} from '../../apps/workhub/src/timetable/pilot/fixture'
import {pilotDigest} from '../../apps/workhub/src/timetable/pilot/operations'
import {createPilotStore} from '../../apps/workhub/src/timetable/pilot/persistence'
import {exportPilotTimetableCsv,previewTimetableReplacement} from '../../apps/workhub/src/timetable/pilot/timetable-replacement'
void(async()=>{
  const fixture=getPilotFixture(),scope='browser-pilot:'+new URL(location.href).searchParams.get('case')
  const key='workhub:timetable-pilot:v1:'+await pilotDigest({purpose:'timetable-pilot-storage',scope})
  window.pilotqa={fixture,scope,key,csv:()=>exportPilotTimetableCsv(fixture),snapshot:async()=>{const store=await createPilotStore({fixture,scope});const state=store.snapshot();store.dispose();return state},futureBackup:async()=>{
    const values=new Map(),store=await createPilotStore({fixture,scope,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)}},locks:{request:(_name,callback)=>callback()}})
    for(const [index,date] of ['2026-03-16','2026-03-23'].entries()){
      const current=store.snapshot(),csv=exportPilotTimetableCsv(current.fixture).replace(index?'"국어 심화"':'"국어"',index?'"국어 토론"':'"국어 심화"')
      const preview=await previewTimetableReplacement(current.fixture,csv,date,'2026-03-09')
      await store.transact({requestId:'backup-basis-'+index,actorId:'pilot-manager-1',expectedRevision:current.revision,command:{type:'replace_timetable',preview,reviewDate:'2026-03-09',reason:'복원 시험 기준판'}})
    }
    const result=await store.exportFile();store.dispose();return result
  }}
  createRoot(document.getElementById('root')).render(<TimetablePilotPanel scope={scope}/>)
})()
`
const bundle = buildSync({ stdin: { contents, loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const font = readFileSync(new URL('../../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64')
const html = `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2')}*{box-sizing:border-box}body{margin:0;padding:16px;background:#f6f7f9;font-family:Pretendard,sans-serif}button,input,select,textarea{font:inherit}button{cursor:pointer}textarea{min-height:84px}button,input,select,textarea{border:1px solid #c9d1dc;border-radius:7px;padding:8px}button:disabled{cursor:default;opacity:.5}</style><div id="root"></div></html>`
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-pilot-')); mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }), page = await context.newPage()
const errors = [], external = [], passed = [], startedAt = Date.now()
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5187/') && !request.url().startsWith('blob:')) external.push(request.url()) })
page.on('dialog', dialog => dialog.accept())
page.setDefaultTimeout(20000)
await context.route('http://127.0.0.1:5187/**', route => route.fulfill({ contentType: 'text/html', body: html }))
const button = name => page.getByRole('button', { name, exact: true })
const label = name => page.getByLabel(new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
const snapshot = () => page.evaluate(() => window.pilotqa.snapshot())
async function ready() {
  await page.getByRole('heading', { name: '오늘의 학교 운영', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.pilot-storage button')?.disabled === false)
}
async function mount(reload = false) {
  if (reload) await page.reload()
  else { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`http://127.0.0.1:5187/pilot?case=${passed.length}`); await page.evaluate(() => localStorage.clear()) }
  await page.addScriptTag({ content: bundle.outputFiles[0].text }); await ready(); await page.evaluate(() => document.fonts.ready)
}
async function check(name, test) { await mount(); await test(); passed.push(name); console.log('  ✓ ' + name) }
async function selectTeacher(id) { await label('지금 연습할 역할').selectOption(id) }
async function selectLesson(period = 1) { await page.getByRole('button', { name: new RegExp(`^${period}교시 .+ 선택$`) }).click() }
async function sendRequest(kind, reason) {
  await label('처리할 일').selectOption(kind)
  if (kind === 'swap') {
    await label('교환 후보').locator('option').nth(1).waitFor({ state: 'attached' })
    await label('교환 후보').selectOption({ index: 1 })
  }
  await label('요청 사유').fill(reason); await button('변경 요청').click()
  await page.getByRole('heading', { name: '요청부터 반영까지', exact: true }).waitFor()
  await page.waitForFunction(async () => (await window.pilotqa.snapshot()).proposals.length > 0)
}
async function consentLatest() {
  let state = await snapshot(), request = state.proposals.at(-1)
  for (const teacherId of request.requiredTeacherIds) {
    if (request.consents.some(row => row.teacherId === teacherId)) continue
    await selectTeacher(teacherId); await button('이 변경 수락').click()
    await page.waitForFunction(async ({ id, teacherId }) => (await window.pilotqa.snapshot()).proposals.find(row => row.id === id).consents.some(row => row.teacherId === teacherId), { id: request.id, teacherId })
  }
  return request
}
async function approveLatest() {
  const request = await consentLatest()
  await selectTeacher('pilot-manager-2'); await button('최종 승인·반영').click()
  await page.waitForFunction(async id => (await window.pilotqa.snapshot()).proposals.find(row => row.id === id).status === 'approved', request.id)
  return (await snapshot()).proposals.find(row => row.id === request.id)
}
async function backToDay() { await button('일과·시간표').click() }
try {
  await check('실제 React 화면에서 9학급·18가상 교사와 임시 날짜·가상 동의 경계를 안내한다', async () => {
    assert.match(await page.locator('.pilot-banner').first().innerText(), /9학급 \/ 가상 교사 18명/)
    assert.match(await page.locator('body').innerText(), /실제 학교의 시간표·교사 동의·알림과 분리/)
    assert.equal(await label('학급').locator('option').count(), 9)
    assert.equal(await label('지금 연습할 역할').locator('option').count(), 20)
    assert.equal(await label('연습 날짜').inputValue(), '2026-03-09')
    assert.equal(await page.locator('.pilot-layout .pilot-table tbody tr').count(), 6)
    await page.screenshot({ path: join(output, 'pilot-day-desktop.png'), fullPage: true })
  })
  await check('교환 추천→모든 가상 교사 수락→다른 담당자 승인 뒤에만 시간표와 알림이 바뀐다', async () => {
    await selectLesson()
    const before = (await snapshot()).lessons
    await sendRequest('swap', '연습 연수 일정 교환')
    assert.deepEqual((await snapshot()).lessons, before)
    assert.equal(await button('최종 승인·반영').count(), 0)
    const request = await approveLatest(), state = await snapshot()
    for (const edit of request.edits) assert.deepEqual(state.lessons.find(lesson => lesson.id === edit.lessonId), edit.after)
    assert.ok(state.notifications.some(row => row.kind === 'changed'))
    await selectTeacher(request.requiredTeacherIds[0]); await page.getByRole('button', { name: /^내 알림 \d+$/ }).click()
    const region = page.getByRole('region', { name: '연습 알림', exact: true })
    await region.getByText('승인한 시간표 변경이 반영되었습니다', { exact: true }).waitFor()
    await region.getByRole('button', { name: '내용 확인', exact: true }).first().click()
    await page.waitForFunction(async () => (await window.pilotqa.snapshot()).notifications.some(row => row.read))
    await page.screenshot({ path: join(output, 'pilot-request-approved.png'), fullPage: true })
  })
  await check('새로고침·보관 파일에서 완료 요청·동의·변경을 복원하고 손상된 파일은 현재 자료를 보존한다', async () => {
    await selectLesson(); await sendRequest('swap', '새로고침 보존'); await approveLatest()
    const before = await snapshot()
    await mount(true)
    assert.deepEqual(await snapshot(), before)
    await button('요청·승인').click()
    await page.getByText('수업 교환 · 반영 완료', { exact: true }).waitFor()
    await button('변경 이력').click(); assert.match(await page.locator('body').innerText(), /실제 학교 승인 원장으로 사용하지 않습니다/)
    await page.locator('summary').filter({ hasText: /^브라우저에 저장된 연습 기록 관리$/ }).click()
    const downloadEvent = page.waitForEvent('download'); await button('연습 기록 보관 파일').click(); const backupFile = await downloadEvent
    const bytes = readFileSync(await backupFile.path())
    assert.equal(backupFile.suggestedFilename(), '시간표_운영연습_보관.json')
    await label('연습 기록 복원').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(bytes.toString().replace('"schema":', '"broken":')) })
    await page.getByRole('alert').waitFor(); assert.deepEqual(await snapshot(), before)
    await page.evaluate(() => localStorage.clear()); await mount(true)
    assert.equal((await snapshot()).proposals.length, 0)
    await page.locator('summary').filter({ hasText: /^브라우저에 저장된 연습 기록 관리$/ }).click()
    await label('연습 기록 복원').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: bytes })
    await page.getByRole('status').filter({ hasText: '현재 계정의 연습 기록을 복원했습니다.' }).waitFor()
    assert.deepEqual(await snapshot(), before)
  })
  await check('대강은 새 담당의 동의와 승인 후 반영하며 실제 수업 기록은 새 담당 역할만 남긴다', async () => {
    await selectLesson(); await label('처리할 일').selectOption('substitute')
    const state = await snapshot(), source = state.lessons.find(row => row.date === '2026-03-09' && row.period === 1 && row.classIds.includes('pilot-c1'))
    const free = state.fixture.teachers.find(teacher => teacher.id !== source.teacherId && !state.lessons.some(row => row.date === source.date && row.period === source.period && row.teacherId === teacher.id))
    assert.ok(free)
    await label('대강 교사').selectOption(free.id); await label('요청 사유').fill('대강 연습'); await button('변경 요청').click()
    await page.getByRole('heading', { name: '요청부터 반영까지', exact: true }).waitFor(); await approveLatest()
    await backToDay(); await selectLesson()
    await page.locator('summary').filter({ hasText: /^수업 실시 기록$/ }).click()
    assert.equal(await button('실시 기록 저장').isDisabled(), true)
    await selectTeacher(free.id); await label('수업 기록').fill('가상 수업 실시 확인'); await button('실시 기록 저장').click()
    await page.waitForFunction(async () => (await window.pilotqa.snapshot()).records.length === 1)
    const after = await snapshot(); assert.equal(after.lessons.find(row => row.id === source.id).status, 'performed'); assert.equal(after.records[0].teacherId, free.id)
  })
  await check('휴강과 보강을 원수업으로 연결하고 승인 전에는 보강을 만들지 않는다', async () => {
    await selectLesson(); await sendRequest('cancel', '행사로 휴강 연습'); const cancelled = await approveLatest()
    const sourceId = cancelled.edits[0].lessonId
    await backToDay(); await selectTeacher(cancelled.edits[0].before.teacherId); await selectLesson()
    await label('처리할 일').selectOption('makeup'); await label('변경 날짜').fill('2026-03-09'); await label('변경 교시').selectOption('7')
    await label('요청 사유').fill('휴강한 수업 보강'); await button('변경 요청').click()
    await page.getByRole('heading', { name: '요청부터 반영까지', exact: true }).waitFor()
    assert.equal((await snapshot()).lessons.some(row => row.originLessonId === sourceId), false)
    await approveLatest(); const after = await snapshot()
    assert.equal(after.lessons.find(row => row.id === sourceId).status, 'cancelled')
    assert.equal(after.lessons.filter(row => row.originLessonId === sourceId).length, 1)
    await backToDay(); await page.getByText('원수업에 연결된 보강', { exact: true }).waitFor()
  })
  await check('담당자 휴업은 수업을 삭제하지 않고 취소와 알림으로 남긴다', async () => {
    await selectTeacher('pilot-manager-1'); await button('학사 변경').click()
    await label('학사 변경 사유').fill('학교 행사 휴업 연습'); await button('연습 일과에 반영').click()
    await page.waitForFunction(async () => (await window.pilotqa.snapshot()).closedDays.length > 0)
    const state = await snapshot(), today = state.lessons.filter(row => row.date === '2026-03-09')
    assert.equal(today.length, 54); assert.ok(today.every(row => row.status === 'cancelled'))
    assert.ok(state.notifications.some(row => row.kind === 'school_day'))
    await backToDay(); assert.equal(await page.getByText('취소·보강 검토', { exact: true }).count(), 6)
  })
  await check('320px·200% 확대에서 입력·역할 선택·요청 버튼이 가로 화면을 넘지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 850 }); await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await selectLesson()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: join(output, 'pilot-day-mobile-200.png'), fullPage: true })
    await button('실제 자료로 교체').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: join(output, 'pilot-replacement-mobile-200.png'), fullPage: true })
  })
  await check('명단 CSV의 명시 선택은 탭 연결 계획에만 적용하고 연습 저장본에는 실교사 ID를 넣지 않는다', async () => {
    await button('실제 자료로 교체').click()
    await label('확인한 교사 명단 CSV').setInputFiles({ name: 'teachers.csv', mimeType: 'text/csv', buffer: Buffer.from('id,schoolId,label,active\r\nconfirmed-member,pilot-daedong,확인 교사,true') })
    const choice = label('가상 국어 교사 1 연결')
    await choice.locator('option[value="confirmed-member"]').waitFor({ state: 'attached' }); await choice.selectOption('confirmed-member')
    await button('교사 교체 영향 확인').click(); await page.getByRole('heading', { name: '교사 교체 확인', exact: true }).waitFor()
    assert.equal(await button('연결 계획에 반영').isDisabled(), true)
    await label('서버 배정 전 연결 계획임을 확인했습니다.').check(); await button('연결 계획에 반영').click()
    await page.getByRole('status').filter({ hasText: '운영 DB에는 반영하지 않았습니다' }).waitFor()
    assert.ok(!JSON.stringify(await snapshot()).includes('confirmed-member'))
    await backToDay(); await button('실제 자료로 교체').click()
    assert.equal(await choice.inputValue(), '__keep')
    assert.equal(await choice.locator('xpath=ancestor::tr').locator('small').innerText(), '확인 교사')
    const download = page.waitForEvent('download'); await button('연결 계획 CSV').click(); const file = await download
    assert.equal(file.suggestedFilename(), '교사_연결계획.csv')
  })
  await check('시간표 CSV 변경을 비교하고 적용일 이후 새 기준판으로 교체한다', async () => {
    await selectTeacher('pilot-manager-1'); await button('실제 자료로 교체').click()
    await label('확인한 교사 명단 CSV').setInputFiles({ name: 'teachers.csv', mimeType: 'text/csv', buffer: Buffer.from('id,schoolId,label,active\r\nreplacement-member,pilot-daedong,교체 확인 교사,true') })
    const choice = label('가상 국어 교사 1 연결')
    await choice.locator('option[value="replacement-member"]').waitFor({ state: 'attached' }); await choice.selectOption('replacement-member')
    await button('교사 교체 영향 확인').click(); await page.getByRole('heading', { name: '교사 교체 확인', exact: true }).waitFor()
    await label('서버 배정 전 연결 계획임을 확인했습니다.').check(); await button('연결 계획에 반영').click()
    await page.getByRole('status').filter({ hasText: '운영 DB에는 반영하지 않았습니다' }).waitFor()
    await label('새 자료 적용일').fill('2026-03-16')
    const csv = await page.evaluate(() => window.pilotqa.csv().replace('"국어"', '"국어 심화"'))
    await label('수정한 시간표 CSV').setInputFiles({ name: 'timetable.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await label('교체 사유').fill('실제 자료 교체 연습')
    await button('시간표 변경 비교').click(); await page.getByRole('heading', { name: '시간표 변경 1칸', exact: true }).waitFor()
    await label('위 변경을 운영 연습에 반영합니다.').check(); await button('운영 연습 시간표 교체').click()
    await page.waitForFunction(async () => (await window.pilotqa.snapshot()).fixture.revision === 2)
    const state = await snapshot()
    assert.equal(state.timetableVersions.length, 1)
    assert.ok(state.lessons.some(row => row.date >= '2026-03-16' && row.subject === '국어 심화'))
    assert.ok(!state.lessons.some(row => row.date < '2026-03-16' && row.subject === '국어 심화'))
    assert.equal(await choice.inputValue(), '__keep')
    assert.equal(await choice.locator('xpath=ancestor::tr').locator('small').innerText(), '교체 확인 교사')
    assert.ok(!JSON.stringify(state).includes('replacement-member'))
    await page.screenshot({ path: join(output, 'pilot-replacement-desktop.png'), fullPage: true })
  })
  await check('시간표 교체 적용일을 지워도 화면과 기존 연결을 보존하고 비교·확정을 막는다', async () => {
    await button('실제 자료로 교체').click()
    await label('새 자료 적용일').fill('')
    await page.getByRole('heading', { name: '1. 가상 교사를 실제 교사에 연결', exact: true }).waitFor()
    assert.equal(await button('교사 교체 영향 확인').isDisabled(), true)
    const csv = await page.evaluate(() => window.pilotqa.csv().replace('"국어"', '"국어 심화"'))
    await label('수정한 시간표 CSV').setInputFiles({ name: 'timetable.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    assert.equal(await button('시간표 변경 비교').isDisabled(), true)
    await label('새 자료 적용일').fill('2026-03-16')
    await button('시간표 변경 비교').click()
    await page.getByRole('heading', { name: '시간표 변경 1칸', exact: true }).waitFor()
  })
  await check('저장 중 사유·역할·교환 후보를 잠그고 원래 입력으로 한 번만 요청한다', async () => {
    await selectLesson(); await label('처리할 일').selectOption('swap')
    await label('교환 후보').locator('option').nth(1).waitFor({ state: 'attached' }); await label('교환 후보').selectOption({ index: 1 })
    await label('요청 사유').fill('저장 중 입력 보존')
    // 암호 검증 자체는 원 함수를 사용하고 다음 호출의 완료만 늦춰 저장 중 상태를 관찰한다.
    await page.evaluate(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle)
      crypto.subtle.digest = (...args) => {
        crypto.subtle.digest = original
        return new Promise(resolve => { window.releasePilotDigest = () => resolve(original(...args)) })
      }
    })
    await button('변경 요청').click()
    await page.waitForFunction(() => typeof window.releasePilotDigest === 'function')
    assert.equal(await label('요청 사유').isDisabled(), true)
    assert.equal(await label('교환 후보').isDisabled(), true)
    assert.equal(await label('지금 연습할 역할').isDisabled(), true)
    assert.equal(await button('변경 요청').isDisabled(), true)
    await page.evaluate(() => window.releasePilotDigest())
    await page.waitForFunction(async () => (await window.pilotqa.snapshot()).proposals.length === 1)
    assert.equal((await snapshot()).proposals[0].reason, '저장 중 입력 보존')
  })
  await check('작성 중인 사유가 있으면 알림에서 다른 요청으로 이동하지 않고 입력을 유지한다', async () => {
    await selectLesson(); await sendRequest('swap', '알림 잠금 확인'); const request = await approveLatest()
    await selectTeacher(request.requiredTeacherIds[0]); await backToDay()
    await page.getByRole('button', { name: /^내 알림 \d+$/ }).click()
    await selectLesson(); await label('요청 사유').fill('이동 전에 보존할 사유')
    const notice = page.getByRole('region', { name: '연습 알림', exact: true }).getByRole('button', { name: '내용 확인', exact: true }).first()
    assert.equal(await notice.isDisabled(), true)
    assert.equal(await button('요청·승인').isDisabled(), true)
    assert.equal(await label('요청 사유').inputValue(), '이동 전에 보존할 사유')
    await button('입력 취소').click(); assert.equal(await notice.isEnabled(), true)
  })
  await check('담당자가 동의 완료 요청을 사유와 함께 반려하면 수업은 바뀌지 않고 반려 이력이 남는다', async () => {
    await selectLesson(); const before = (await snapshot()).lessons
    await sendRequest('swap', '담당자 반려 확인'); const request = await consentLatest()
    await selectTeacher('pilot-manager-2')
    await page.locator('summary').filter({ hasText: /^담당자 반려$/ }).click()
    assert.equal(await button('담당자 반려 확정').isDisabled(), true)
    await label('반려 사유').fill('해당 날짜 행사로 조정 필요'); await button('담당자 반려 확정').click()
    await page.waitForFunction(async id => (await window.pilotqa.snapshot()).proposals.find(row => row.id === id).status === 'rejected', request.id)
    const after = await snapshot()
    assert.deepEqual(after.lessons, before); assert.equal(after.history.at(-1).kind, 'reject')
    await page.getByText('수업 교환 · 반려', { exact: true }).waitFor()
  })
  await check('여러 기준판이 담긴 보관 파일을 복원해도 현재 탭의 실교사 연결 계획을 유지한다', async () => {
    await button('실제 자료로 교체').click()
    await label('확인한 교사 명단 CSV').setInputFiles({ name: 'teachers.csv', mimeType: 'text/csv', buffer: Buffer.from('id,schoolId,label,active\r\nrestore-member,pilot-daedong,복원 확인 교사,true') })
    const choice = label('가상 국어 교사 1 연결')
    await choice.locator('option[value="restore-member"]').waitFor({ state: 'attached' }); await choice.selectOption('restore-member')
    await button('교사 교체 영향 확인').click(); await page.getByRole('heading', { name: '교사 교체 확인', exact: true }).waitFor()
    await label('서버 배정 전 연결 계획임을 확인했습니다.').check(); await button('연결 계획에 반영').click()
    await page.getByRole('status').filter({ hasText: '운영 DB에는 반영하지 않았습니다' }).waitFor()
    const backup = await page.evaluate(() => window.pilotqa.futureBackup())
    await page.locator('summary').filter({ hasText: /^브라우저에 저장된 연습 기록 관리$/ }).click()
    await label('연습 기록 복원').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(backup) })
    await page.waitForFunction(async () => (await window.pilotqa.snapshot()).fixture.revision === 3)
    await page.getByRole('status').filter({ hasText: '현재 계정의 연습 기록을 복원했습니다.' }).waitFor()
    await label('새 자료 적용일').fill('2026-03-23')
    assert.equal(await choice.locator('xpath=ancestor::tr').locator('small').innerText(), '복원 확인 교사')
    assert.equal(await page.getByRole('alert').count(), 0)
  })
  await check('교사 연결·시간표 확인을 따로 받고 교사 연결을 반영하면 시간표 비교를 다시 요구한다', async () => {
    await selectTeacher('pilot-manager-1'); await button('실제 자료로 교체').click()
    await label('확인한 교사 명단 CSV').setInputFiles({ name: 'teachers.csv', mimeType: 'text/csv', buffer: Buffer.from('id,schoolId,label,active\r\nseparate-member,pilot-daedong,별도 확인 교사,true') })
    const choice = label('가상 국어 교사 1 연결')
    await choice.locator('option[value="separate-member"]').waitFor({ state: 'attached' }); await choice.selectOption('separate-member')
    await button('교사 교체 영향 확인').click(); await page.getByRole('heading', { name: '교사 교체 확인', exact: true }).waitFor()
    const csv = await page.evaluate(() => window.pilotqa.csv().replace('"국어"', '"국어 심화"'))
    await label('수정한 시간표 CSV').setInputFiles({ name: 'timetable.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await label('교체 사유').fill('별도 동의 검사')
    await button('시간표 변경 비교').click(); await page.getByRole('heading', { name: '시간표 변경 1칸', exact: true }).waitFor()
    await label('서버 배정 전 연결 계획임을 확인했습니다.').check()
    assert.equal(await label('위 변경을 운영 연습에 반영합니다.').isChecked(), false)
    assert.equal(await button('운영 연습 시간표 교체').isDisabled(), true)
    await button('연결 계획에 반영').click()
    await page.getByRole('status').filter({ hasText: '운영 DB에는 반영하지 않았습니다' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '시간표 변경 1칸', exact: true }).count(), 0)
    assert.equal((await snapshot()).fixture.revision, 1)
    await button('시간표 변경 비교').click(); await page.getByRole('heading', { name: '시간표 변경 1칸', exact: true }).waitFor()
    assert.equal(await label('위 변경을 운영 연습에 반영합니다.').isChecked(), false)
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  writeFileSync(join(output, 'results.json'), JSON.stringify({ scenarios: passed.length, passed, durationMs: Date.now() - startedAt, errors, external, boundary: '실제 React·로컬 저장소. Supabase·운영 Storage·실교사 승인은 호출하지 않음.' }, null, 2))
  console.log(`시간표 운영 연습 브라우저 검사: ${passed.length}개 통과 · 화면: ${output}`)
} catch (error) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('*')].map(element => ({tag: element.tagName, className: element.className, label: element.getAttribute('aria-label'), width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right})).filter(element => element.right > innerWidth + 1 || element.width > innerWidth + 1))
  writeFileSync(join(output, 'failure.txt'), `${error.stack}\n\n${JSON.stringify(overflow, null, 2)}\n\n${await page.locator('body').innerText()}`)
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw error
} finally { await context.close(); await browser.close() }
