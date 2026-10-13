import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
const page = await context.newPage()
const failures = []
page.on('pageerror', error => failures.push(error.message))
page.on('console', msg => { if (msg.type() === 'error') failures.push(msg.text()) })
page.setDefaultTimeout(12000)
const output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
const results = []
const url = process.env.WORKHUB_QA_URL || 'http://127.0.0.1:5176/workhub-preview-test'
// 기본 실행은 운영·개발 서버 없이 실제 미리보기 앱과 합성 저장소를 묶어 제공한다.
if (!process.env.WORKHUB_QA_URL) {
  const bundle=buildSync({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {DemoBootstrap} from './apps/workhub/src/preview/DemoBootstrap';
    import theme from './apps/workhub/src/style.css?inline';import previewStyles from './apps/workhub/src/preview/preview.css?inline';
    import workflowStyles from './apps/workhub/src/workflows/workflows.css?inline';import studentStyles from './apps/workhub/src/students/students.css?inline';
    createRoot(document.getElementById('root')).render(<><style>{theme}{previewStyles}{workflowStyles}{studentStyles}</style><DemoBootstrap/></>);
  `,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
  await context.route(`${new URL(url).origin}/**`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`}))
}
async function ok(name, action) { await action(); results.push(name); console.log('  ✓ ' + name) }
async function menu(name) {
  const nav=page.getByRole('navigation',{name:'업무 메뉴'}), button=nav.getByRole('button',{name,exact:true})
  if(!await button.isVisible())await nav.getByRole('button',{name:'더보기',exact:true}).click()
  await button.click()
}
const task=title=>page.getByRole('article',{name:title,exact:true})
async function user(id) {
  const details = page.locator('.developer-panel')
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click()
  await page.getByLabel(/가상 소속 계정/).selectOption(id)
}
try {
  await page.goto(url)
  await page.getByRole('heading', { name: '내 할 일' }).waitFor()
  await ok('홈에서 할 일 추가·새로고침 복원·완료와 재개', async () => {
    await page.getByRole('button',{name:'할 일 등록',exact:true}).click()
    await page.getByLabel('해야 할 일', { exact: true }).fill('브라우저 검증 · 행사 안내')
    await page.getByLabel('기한 (선택)').fill('2026-10-20')
    await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
    await task('브라우저 검증 · 행사 안내').waitFor()
    await page.reload()
    const row = task('브라우저 검증 · 행사 안내')
    await row.waitFor(); await row.getByRole('button',{name:'완료',exact:true}).click();await row.waitFor({state:'detached'})
    await menu('내 업무');await page.getByLabel('상태',{exact:true}).selectOption('done');await row.waitFor();await row.getByRole('button',{name:'다시 시작',exact:true}).click();await page.getByLabel('상태',{exact:true}).selectOption('open');await row.waitFor()
  })
  await ok('저장 실패 입력 보존·재시도 단일 저장', async () => {
    await page.evaluate(() => { window.__originalStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('workhub:synthetic:')) throw new DOMException('quota', 'QuotaExceededError'); return window.__originalStorageSet.call(this, key, value) } })
    await page.getByRole('button',{name:'할 일 등록',exact:true}).click()
    await page.getByLabel('해야 할 일', { exact: true }).fill('저장 실패 후 재시도')
    await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
    await page.getByRole('region',{name:'저장 결과 확인 필요'}).waitFor()
    assert.equal(await page.getByLabel('해야 할 일', { exact: true }).inputValue(), '저장 실패 후 재시도')
    assert.equal(await task('저장 실패 후 재시도').count(), 0)
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageSet })
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인', exact: true }).click()
    await task('저장 실패 후 재시도').waitFor();assert.equal(await task('저장 실패 후 재시도').count(), 1)
  })
  await ok('두 번째 창 동시 편집 차단', async () => {
    const second = await context.newPage(); await second.goto(url)
    await second.getByRole('heading', { name: '미리보기가 다른 창에서 열려 있습니다' }).waitFor()
    await second.close()
  })
  await ok('수합 개설·대상 고정·숫자 0 제출·검토자에게 초안 비공개', async () => {
    await menu('자료 수합'); await page.getByRole('button', { name: '+ 수합 만들기', exact: true }).click()
    await page.getByLabel('수합 제목', { exact: true }).fill('브라우저 검증 · 현장학습 수량')
    await page.getByLabel('마감일', { exact: true }).fill('2026-10-23')
    await page.getByLabel('검토 방식').selectOption('required'); await page.getByRole('combobox', { name: /^검토자/ }).selectOption('gaon-minjun')
    await page.getByRole('button', { name: '수합 초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '대상 확인 · 게시', exact: true }).click()
    await page.getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    await page.getByLabel('안내 및 참고 사항', { exact: true }).fill('공동초안만의 검증 문장')
    await page.getByLabel('필요 수량', { exact: true }).fill('0')
    await page.getByRole('button', { name: '초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '편집 취소 · 닫기', exact: true }).click()
    await user('gaon-minjun'); await menu('자료 수합')
    await page.getByRole('button', { name: /브라우저 검증 · 현장학습 수량/ }).click()
    assert(!(await page.locator('main').innerText()).includes('공동초안만의 검증 문장'))
    await user('gaon-soyeon'); await menu('자료 수합')
    await page.getByRole('button', { name: /브라우저 검증 · 현장학습 수량/ }).click()
    await page.getByRole('button', { name: '응답 초안 작성', exact: true }).click()
    assert.equal(await page.getByLabel('필요 수량', { exact: true }).inputValue(), '0')
    await page.getByRole('button', { name: '최종 제출', exact: true }).click()
    assert((await page.locator('.wf-unit').innerText()).includes('검토 대기'))
    await menu('오늘');await page.getByRole('button',{name:/브라우저 검증 · 현장학습 수량.*접수 상태 확인/}).click()
    await page.getByRole('heading',{name:'브라우저 검증 · 현장학습 수량',exact:true}).waitFor()
  })
  await ok('보완 요청·재제출·검토 완료·홈 원본 연결', async () => {
    await user('gaon-minjun'); await menu('자료 수합'); await page.getByRole('button', { name: /브라우저 검증 · 현장학습 수량/ }).click()
    await page.getByLabel('검토 의견', { exact: true }).fill('수량을 다시 확인해 주세요.')
    await page.getByLabel('보완을 요청할 경우 기한').fill('2026-10-24')
    await page.getByRole('button', { name: '보완 요청', exact: true }).click()
    await user('gaon-soyeon'); await menu('자료 수합'); await page.getByRole('button', { name: /브라우저 검증 · 현장학습 수량/ }).click()
    await page.getByRole('button', { name: '정정·보완 초안 작성', exact: true }).click()
    await page.getByLabel('필요 수량', { exact: true }).fill('12')
    await page.getByLabel('정정·보완 사유', { exact: true }).fill('참가 인원 다시 확인')
    await page.getByRole('button', { name: '초안 저장', exact: true }).click()
    await page.getByRole('button', { name: '새 버전 제출', exact: true }).click()
    await user('gaon-minjun'); await menu('자료 수합'); await page.getByRole('button', { name: /브라우저 검증 · 현장학습 수량/ }).click()
    await page.getByRole('button', { name: '이 버전 검토 완료', exact: true }).click()
    assert((await page.locator('.wf-unit .wf-progress').innerText()).includes('v2'))
    await user('gaon-soyeon')
    assert.equal(await page.getByTitle('수합 원본 보기',{exact:true}).count(),0)
    await page.getByRole('button', { name: '수합 전체 보기', exact: true }).click()
    await page.getByRole('button',{name:/브라우저 검증 · 현장학습 수량/}).click()
    await page.getByRole('heading', { name: '브라우저 검증 · 현장학습 수량', exact: true }).waitFor()
  })
  await ok('학생 관찰·정정·근거 출력·타인 기록 격리', async () => {
    await menu('수업과 학생')
    await page.getByLabel('활동', { exact: true }).fill('출처 확인 토의')
    await page.getByLabel('직접 확인한 사실', { exact: true }).fill('자료의 작성자와 공개 범위를 확인해야 한다고 설명함.')
    await page.getByRole('checkbox', { name: '직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.' }).check()
    await page.getByRole('button', { name: '관찰 저장', exact: true }).click()
    await page.getByRole('button', { name: '정정하기', exact: true }).click()
    await page.getByLabel('직접 확인한 사실', { exact: true }).fill('자료의 작성자와 공개 범위를 확인하고 출처를 적는 과정을 설명함.')
    await page.getByLabel('정정 사유', { exact: true }).fill('실제 발언을 정확하게 보완')
    await page.getByRole('checkbox', { name: '직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.' }).check()
    await page.getByRole('button', { name: '새 개정본 저장', exact: true }).click()
    await page.getByRole('button', { name: '근거 목록 텍스트 보기', exact: true }).click()
    assert((await page.getByLabel('나의 근거 목록', { exact: true }).inputValue()).includes('과정을 설명함'))
    await user('gaon-minjun'); await menu('수업과 학생')
    assert(!(await page.locator('main').innerText()).includes('과정을 설명함'))
    await user('gaon-soyeon'); await menu('수업과 학생')
    assert((await page.locator('main').innerText()).includes('과정을 설명함'))
  })
  await ok('가상 수업 활동 수신·명시적 학생 연결·채택·원문 변경 전파', async () => {
    await page.getByRole('button', { name: '가상 수업 활동 받기', exact: true }).click()
    await page.getByRole('combobox', { name: /^교사가 확인한 학생/ }).selectOption({ label: '1번 · 가상 학생 가' })
    await page.getByRole('button', { name: '학생 연결 확정', exact: true }).click()
    await page.getByLabel('교사가 확인한 관찰 사실', { exact: true }).fill('작성자 허락과 출처를 확인한다는 응답을 제출함.')
    await page.getByRole('checkbox', { name: '원문·질문·학생 연결을 직접 검토했습니다.' }).check()
    await page.getByRole('button', { name: '내 관찰로 채택', exact: true }).click()
    await page.getByText('합성 원자료 정정·철회 시험', { exact: true }).click()
    await page.getByRole('button', { name: '수정 답변 수신', exact: true }).click()
    await page.getByRole('button', { name: '내 학급·기록', exact: true }).click()
    assert((await page.locator('.students-records').innerText()).includes('원자료 재검토 필요'))
    await page.getByRole('button', { name: '근거 목록 텍스트 보기', exact: true }).click()
    const text = await page.getByLabel('나의 근거 목록', { exact: true }).inputValue().catch(() => '')
    assert(!text.includes('응답을 제출함'))
  })
  await ok('학교 전환·새로고침에서 각 학교 자료 분리', async () => {
    const tools = page.locator('.developer-panel'); if (!await tools.evaluate(node => node.open)) await tools.locator('summary').click()
    await page.getByLabel(/가상 학교/).selectOption('fixture-school-nuri')
    assert(!(await page.locator('main').innerText()).includes('브라우저 검증 · 행사 안내'))
    await menu('수업과 학생'); assert(!(await page.locator('main').innerText()).includes('과정을 설명함'))
    await page.reload();await page.getByRole('heading',{name:'수업과 학생',level:1,exact:true}).waitFor();await menu('오늘')
    await task('브라우저 검증 · 행사 안내').waitFor()
  })
  await ok('데스크톱·모바일 전 페이지 가로 넘침 및 런타임 오류 없음', async () => {
    for (const [width, height, label] of [[1440,1100,'desktop'],[360,800,'mobile']]) {
      await page.setViewportSize({width,height})
      for (const name of ['오늘','학교 일정','내 업무','자료 수합','수업과 학생']) {
        await menu(name)
        await page.waitForFunction(()=>!document.querySelector('.loading-state,.task-loading'))
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label} ${name}`)
        if (label === 'desktop') assert(await page.locator('.ws-utilities').evaluate(node => node.getBoundingClientRect().top >= document.querySelector('.ws-navigation').getBoundingClientRect().bottom), '왼쪽 메뉴와 화면 설정·AI 비서가 겹치지 않아야 한다.')
        if (output && ['오늘','자료 수합','수업과 학생'].includes(name)) await page.screenshot({path:join(output,`workhub-v2-${label}-${name}.png`),fullPage:true})
      }
    }
    assert.deepEqual(failures, [])
  })
  await ok('일괄 초기화 실패는 모든 자료 유지·성공은 세 영역 동시 초기화', async () => {
    await page.setViewportSize({width:1440,height:1100})
    const tools = page.locator('.developer-panel'); if (!await tools.evaluate(node => node.open)) await tools.locator('summary').click()
    const before = await page.evaluate(() => localStorage.getItem('workhub:synthetic:v2:workspace'))
    await page.evaluate(() => { window.__originalStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('workhub:synthetic:')) throw new DOMException('quota', 'QuotaExceededError'); return window.__originalStorageSet.call(this, key, value) } })
    await page.getByRole('button', {name:'합성 자료 초기화',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'저장하지 못했습니다'}).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('workhub:synthetic:v2:workspace')), before)
    await menu('내 업무');await task('브라우저 검증 · 행사 안내').waitFor();assert.equal(await task('브라우저 검증 · 행사 안내').count(),1)
    await menu('수업과 학생'); assert((await page.locator('main').innerText()).includes('과정을 설명함'))
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageSet })
    await page.getByRole('button', {name:'합성 자료 초기화',exact:true}).click()
    await page.getByRole('heading', {name:'내 할 일'}).waitFor()
    assert.equal(await task('브라우저 검증 · 행사 안내').count(),0)
    await menu('자료 수합'); assert(!(await page.locator('main').innerText()).includes('브라우저 검증 · 현장학습 수량'))
    await menu('수업과 학생'); assert(!(await page.locator('main').innerText()).includes('과정을 설명함'))
    await page.reload();await page.getByRole('heading',{name:'수업과 학생',level:1,exact:true}).waitFor();await menu('오늘')
    assert.equal(await task('브라우저 검증 · 행사 안내').count(),0)
    assert.deepEqual(failures, [])
  })
  if (output) writeFileSync(join(output,'workhub-v2-browser-results.json'), JSON.stringify({url,results,errors:failures},null,2))
  console.log(`통합 미리보기 ${results.length}개 통과`)
} catch (error) {
  console.error('브라우저 시험 실패:',error)
  console.error((await page.locator('body').innerText()).slice(-7000))
  if (output) await page.screenshot({path:join(output,'workhub-v2-failure.png'),fullPage:true})
  process.exitCode=1
} finally { await context.close(); await browser.close() }
