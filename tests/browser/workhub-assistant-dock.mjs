import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = buildSync({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React,{useState} from 'react';import{createRoot}from'react-dom/client';
  import{AssistantDock}from'./apps/workhub/src/app/AssistantDock';
  window.dockClosed=0;
  function App(){const[open,setOpen]=useState(true),[locked,setLocked]=useState(true);window.setLocked=setLocked;window.reopen=()=>setOpen(true);return <AssistantDock open={open} closeDisabled={locked} contextLabel="문서 작업" onClose={()=>{window.dockClosed++;setOpen(false)}}><label>작업 입력<textarea defaultValue="보관할 입력"/></label></AssistantDock>}
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
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('AI 작업 패널 닫기 브라우저 2건 통과')
} finally { await browser.close() }
