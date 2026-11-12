import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React,{useState} from 'react';import{createRoot}from'react-dom/client';
  import{AssistantDock}from'./apps/workhub/src/app/AssistantDock';
  window.dockClosed=0;window.dockOpened=0;
  function App(){const[open,setOpen]=useState(location.search!=='?closed'),[locked,setLocked]=useState(true);window.setLocked=setLocked;window.reopen=()=>setOpen(true);return <><button onClick={()=>setOpen(true)}>AI 비서 열기</button><AssistantDock open={open} fullPage={location.search==='?full'} closeDisabled={locked} contextLabel="문서 작업" onClose={()=>{window.dockClosed++;setOpen(false)}}><label>작업 입력<textarea defaultValue="보관할 입력"/></label><button onClick={()=>{window.dockOpened++}}>업무 원본 열기</button></AssistantDock></>}
  createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext(), page = await context.newPage()
const errors = [], external = []
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('http://127.0.0.1:5179/dock')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const dialog = page.getByRole('dialog', { name: 'AI 비서', exact: true })
    await dialog.waitFor()
    await page.getByLabel('작업 입력').fill('전송 결과를 확인할 입력')
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), true)
    assert.equal(await page.evaluate(() => window.dockClosed), 0)
    assert.equal(await page.getByRole('button', { name: 'AI 비서 닫기' }).isDisabled(), true)
    await page.evaluate(() => window.setLocked(false))
    await page.waitForFunction(() => !document.querySelector('button[aria-label="AI 비서 닫기"]').disabled)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.dockClosed), 1)
    await page.evaluate(() => window.reopen())
    await dialog.waitFor()
    assert.equal(await page.getByLabel('작업 입력').inputValue(), '전송 결과를 확인할 입력')
    console.log(`  ✓ ${width}px 대화 패널은 잠금 중 Escape를 막고 해제 뒤에도 입력을 보존한다`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:5179/dock?closed')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const trigger = page.getByRole('button', { name: 'AI 비서 열기', exact: true })
  await trigger.click()
  await page.getByRole('dialog', { name: 'AI 비서', exact: true }).waitFor()
  await page.evaluate(() => window.setLocked(false))
  await page.waitForFunction(() => !document.querySelector('button[aria-label="AI 비서 닫기"]').disabled)
  await page.getByLabel('작업 입력').fill('닫은 뒤에도 유지할 입력')
  await page.setViewportSize({ width: 390, height: 900 })
  await page.waitForFunction(() => document.querySelector('dialog').matches(':modal'))
  await page.getByRole('button', { name: 'AI 비서 닫기', exact: true }).click()
  await page.getByRole('dialog', { name: 'AI 비서', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await trigger.evaluate(node => node.matches(':focus')), true)
  assert.equal(await page.evaluate(() => window.dockClosed), 1)
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'AI 비서', exact: true }).waitFor()
  assert.equal(await page.getByLabel('작업 입력').inputValue(), '닫은 뒤에도 유지할 입력')
  console.log('  ✓ 외부 진입점에서 연 AI는 모바일 전환 후 닫아도 원래 진입점으로 초점을 돌려준다')
  for (const fullPage of [true, false]) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`http://127.0.0.1:5179/dock${fullPage ? '?full' : ''}`)
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.getByRole('dialog', { name: 'AI 비서', exact: true }).waitFor()
    await page.evaluate(() => window.setLocked(false))
    await page.waitForFunction(() => !document.querySelector('button[aria-label="AI 비서 닫기"]').disabled)
    const source = page.getByRole('button', { name: '업무 원본 열기', exact: true })
    await source.focus()
    await page.setViewportSize({ width: 390, height: 900 })
    // resize 통지와 다음 화면 반영을 지난 뒤 확인한다. 고정 지연으로 경합을 가리지 않는다.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await source.evaluate(node => node.matches(':focus')), true)
    assert.equal(await page.locator('dialog').evaluate(node => node.matches(':modal')), !fullPage)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.dockOpened), 1)
    assert.equal(await page.evaluate(() => window.dockClosed), 0)
    await page.getByLabel('작업 입력').fill('크기를 바꿔도 유지할 입력')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByLabel('작업 입력').evaluate(node => node.matches(':focus')), true)
    assert.equal(await page.getByLabel('작업 입력').inputValue(), '크기를 바꿔도 유지할 입력')
    console.log(`  ✓ ${fullPage ? '전체 화면' : '옆자리'} AI는 화면 폭 변경 후 원본 버튼·입력 초점을 유지한다`)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('AI 작업 패널 닫기·화면 전환 초점 브라우저 5건 통과')
} finally { await browser.close() }
