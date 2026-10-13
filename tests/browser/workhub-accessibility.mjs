// 실제 화면을 일반 DOM과 연결 화면과 같은 ShadowRoot에서 키보드로 검증한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const bundle = buildSync({ stdin: { contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {PreviewApp} from './apps/workhub/src/preview/PreviewApp';
  import {createDemoPersistence} from './apps/workhub/src/preview/persistence';
  import theme from './apps/workhub/src/style.css?inline';
  import preview from './apps/workhub/src/preview/preview.css?inline';
  import workflows from './apps/workhub/src/workflows/workflows.css?inline';
  import students from './apps/workhub/src/students/students.css?inline';
  const host=document.getElementById('root');
  const root=new URL(location.href).searchParams.has('shadow')?host.attachShadow({mode:'open'}):host;
  window.qaRoot=root;createRoot(root).render(<><style>{theme}{preview}{workflows}{students}</style><PreviewApp persistence={createDemoPersistence(localStorage)}/></>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }).outputFiles[0].text
const browser = await launchBrowser()
const output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
const results = [], errors = []
let currentPage
async function test(name, run) { await run(); results.push(name); console.log('  ✓ ' + name) }
try {
  for (const mode of ['document', 'shadow']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = currentPage = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await context.route('http://127.0.0.1:5176/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></body></html>` }))
    await page.goto(`http://127.0.0.1:5176/?view=tasks${mode === 'shadow' ? '&shadow=1' : ''}`)
    const nav = page.getByRole('navigation', { name: '업무 메뉴', exact: true })
    const title = page.getByLabel('해야 할 일', { exact: true })
    const add = page.getByRole('button', { name: '할 일 등록', exact: true })
    async function focusIs(locator) { await locator.waitFor(); await page.waitForFunction(node => node.getRootNode().activeElement === node || document.activeElement === node, await locator.elementHandle()) }
    async function menu(name) { const button = nav.getByRole('button', { name, exact: true }); if (!await button.isVisible()) await nav.getByRole('button', { name: '더보기', exact: true }).click(); await button.click() }
    async function settled() { await page.waitForFunction(() => !window.qaRoot.querySelector('.task-loading,.loading-state')); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
    const scoped = (name, run) => test(`${mode} · ${name}`, run)
    await settled()
    await scoped('등록 양식은 제목에서 시작하고 취소하면 등록 버튼으로 돌아간다', async () => {
      await add.focus(); await page.keyboard.press('Enter'); await focusIs(title)
      await page.getByRole('button', { name: '편집 취소', exact: true }).click(); await focusIs(add)
    })
    await scoped('공백 제목 오류는 안내에 초점을 주고 입력 및 글자수 설명을 유지한다', async () => {
      await add.click(); await title.fill('   '); await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click()
      const error = page.locator('.task-error[role="alert"]'); await focusIs(error)
      assert.equal(await title.inputValue(), '   ')
      assert.equal(await page.getByRole('form', { name: '내 업무 등록' }).getAttribute('aria-describedby'), await error.getAttribute('id'))
      assert.equal(await title.evaluate(node => node.getRootNode().getElementById(node.getAttribute('aria-describedby')).textContent.includes('120자')), true)
    })
    await scoped('저장 후 재조회가 끝나도 완료 안내에 초점이 남고 다음 업무를 찾을 수 있다', async () => {
      await title.fill('접근성 검증 업무'); await page.getByRole('button', { name: '내 업무에 추가', exact: true }).click(); await settled()
      await page.getByRole('article', { name: '접근성 검증 업무', exact: true }).waitFor(); await focusIs(page.locator('.task-notice'))
    })
    const card = page.getByRole('article', { name: '접근성 검증 업무', exact: true })
    await scoped('수정 원본을 읽는 동안 기다린 뒤 제목으로 이동하고 취소하면 원래 수정 버튼으로 돌아간다', async () => {
      const edit = card.getByRole('button', { name: '수정', exact: true }); await edit.click(); await focusIs(title)
      assert.equal(await title.inputValue(), '접근성 검증 업무')
      await page.getByRole('button', { name: '편집 취소', exact: true }).click(); await focusIs(edit)
      assert.equal(await edit.evaluate(node => node.getRootNode().getElementById(node.getAttribute('aria-describedby')).textContent), '접근성 검증 업무')
    })
    await scoped('완료 처리로 카드가 사라져도 안내에 초점이 남는다', async () => {
      await card.getByRole('button', { name: '완료', exact: true }).click(); await card.waitFor({ state: 'detached' }); await settled(); await focusIs(page.locator('.task-notice'))
    })
    await menu('학교 일정'); await settled()
    await scoped('일정 전체 기간·필터 초기화 버튼이 사라지면 검색 입력으로 돌아간다', async () => {
      await page.getByLabel('일정 검색', { exact: true }).fill('아무 결과도 없는 합성 단어')
      await page.getByRole('button', { name: '모든 날짜에서 찾기', exact: true }).click(); await focusIs(page.getByLabel('일정 검색', { exact: true }))
      assert.equal(await page.getByLabel('조회 기간', { exact: true }).inputValue(), 'all')
      await page.getByRole('button', { name: '검색·관련 필터 지우기', exact: true }).click(); await focusIs(page.getByLabel('일정 검색', { exact: true }))
    })
    await scoped('일정 등록 취소는 원래 등록 버튼을 복원한다', async () => {
      const register = page.getByRole('button', { name: '일정 등록', exact: true }); await register.click()
      await focusIs(page.getByRole('textbox', { name: '일정 제목 필수' })); await page.keyboard.press('Escape'); await focusIs(register)
    })
    const eventCard = page.getByRole('button', { name: '수업 자료 정리 · 원본 v1 보기', exact: true })
    await scoped('일정 상세→수정→취소에서도 원래 일정 카드로 돌아간다', async () => {
      await eventCard.click(); await page.getByRole('button', { name: '일정 수정', exact: true }).click()
      await focusIs(page.getByRole('textbox', { name: '일정 제목 필수' })); await page.getByRole('button', { name: '취소', exact: true }).click(); await focusIs(eventCard)
    })
    await scoped('일정 수정 저장 뒤 목록 교체는 완료 안내로 초점을 잇는다', async () => {
      await eventCard.click(); await page.getByRole('button', { name: '일정 수정', exact: true }).click()
      await page.getByRole('textbox', { name: '일정 제목 필수' }).fill('키보드로 수정한 합성 일정')
      await page.getByRole('button', { name: '수정 저장', exact: true }).click(); await page.getByRole('button', { name: '키보드로 수정한 합성 일정 · 원본 v2 보기', exact: true }).waitFor(); await settled(); await focusIs(page.locator('.success-box'))
    })
    await scoped('모바일 더보기는 Escape로 닫고 현재 메뉴를 다시 선택해도 본문으로 간다', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); const more = nav.getByRole('button', { name: '더보기', exact: true })
      await more.click(); await nav.getByRole('button', { name: '자료 수합', exact: true }).focus(); await page.keyboard.press('Escape'); await focusIs(more); assert.equal(await more.getAttribute('aria-expanded'), 'false')
      await menu('자료 수합'); await more.click(); await nav.getByRole('button', { name: '자료 수합', exact: true }).click(); assert.equal(await more.getAttribute('aria-expanded'), 'false'); await focusIs(page.getByRole('heading', { name: '자료 수합', exact: true, level: 1 }))
    })
    await scoped('320px와 200% 텍스트 확대에서도 일정 모달의 입력·취소가 가려지지 않는다', async () => {
      await menu('학교 일정'); await settled(); await page.setViewportSize({ width: 320, height: 640 })
      await page.evaluate(() => document.documentElement.style.fontSize = '200%')
      await page.getByRole('button', { name: '일정 등록', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '일정 등록', exact: true })
      await page.getByRole('textbox', { name: '일정 제목 필수' }).fill('확대화면 확인')
      await page.getByRole('button', { name: '취소', exact: true }).focus()
      assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      if (output) await page.screenshot({ path: join(output, `accessibility-${mode}-320-text200.png`), fullPage: true })
      await page.keyboard.press('Enter'); await dialog.waitFor({ state: 'detached' })
      await page.evaluate(() => document.documentElement.style.fontSize = '')
    })
    await scoped('높이 480px에서도 끝의 입력과 저장·취소를 스크롤로 확인한다', async () => {
      await page.setViewportSize({ width: 800, height: 480 }); await page.getByRole('button', { name: '일정 등록', exact: true }).click()
      assert.equal(await page.locator('.editor-dialog .dialog-footer').evaluate(node => getComputedStyle(node).position), 'static')
      const cancel = page.getByRole('button', { name: '취소', exact: true }); await cancel.focus()
      const box = await cancel.boundingBox(); assert(box.y >= 0 && box.y + box.height <= 480)
      await page.keyboard.press('Enter')
    })
    await context.close()
  }
  assert.deepEqual(errors, [])
  if (output) writeFileSync(join(output, 'accessibility-browser-results.json'), JSON.stringify({ results, errors }, null, 2))
  console.log(`공통 접근성 브라우저 ${results.length}개 통과`)
} catch (error) {
  console.error(error)
  if (currentPage && !currentPage.isClosed() && output) await currentPage.screenshot({ path: join(output, 'accessibility-failure.png'), fullPage: true })
  process.exitCode = 1
} finally { await browser.close() }
