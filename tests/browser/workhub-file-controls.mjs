// 실제 파일 입력·읽기 취소·늦은 응답과 StrictMode의 effect 재실행을 합성 자료로 확인한다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { launchBrowser } from './launch-browser.mjs'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const bundle = buildSync({ stdin: { contents: `
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{FileSelection,FileDownloads}from'./apps/workhub/src/files/FileControls';
 import{createPreviewFileRepository}from'./apps/workhub/src/files/preview-repository';
 import{FileError}from'./apps/workhub/src/files/contracts';
 import{EditSession,useEditSession}from'./apps/workhub/src/app/EditSession';
 import styles from './apps/workhub/src/files/files.css?inline';
 const core=createPreviewFileRepository(),gates=[];window.fileMode='normal';window.readCount=0;window.finishedStages=0;window.finishedReads=0;window.stagedRefs=[];
 const wait=()=>new Promise(resolve=>gates.push(resolve));window.releaseFiles=()=>{while(gates.length)gates.shift()()};
 const repository={...core,stage:async(file,policy,owner,signal)=>{try{let ref;if(window.fileMode==='stage-delay'){await wait();ref=await core.stage(file,policy,owner)}else{if(window.fileMode==='stage-raw')throw Error('secret-key-is-not-user-content');ref=await core.stage(file,policy,owner,signal)}window.stagedRefs.push({ref,owner:{...owner}});return ref}finally{window.finishedStages++}}};
 window.probeStaged=async index=>{const entry=window.stagedRefs[index];try{await core.read(entry.ref,{schoolId:entry.owner.schoolId,memberIds:[entry.owner.memberId]});return true}catch{return false}};
 window.retainStaged=index=>core.retainSaved([window.stagedRefs[index].ref]);
 const read=async(ref,signal)=>{window.readCount++;try{if(window.fileMode==='read-delay'){await wait();return await core.read(ref,{schoolId:'school',memberIds:['teacher-a']})}if(window.fileMode==='read-raw')throw Error('private-stack-and-token');if(window.fileMode==='read-missing')throw new FileError('FILE_UNAVAILABLE');return await core.read(ref,{schoolId:'school',memberIds:['teacher-a']},signal)}finally{window.finishedReads++}};
 function Controls(){const[files,setFiles]=useState([]),[owner,setOwner]=useState('teacher-a'),[max,setMax]=useState(3),[visible,setVisible]=useState(true),[busy,setBusy]=useState(false),[moves,setMoves]=useState(0);window.fileRefs=files;window.setFileOwner=setOwner;window.setFilePolicy=setMax;window.setFileVisible=setVisible;window.setFileRefs=setFiles;const change=useEditSession();return <>
 <button type="button" onClick={()=>change(()=>setMoves(x=>x+1))}>다른 화면 이동</button><output data-moves>{moves}</output><output data-busy>{String(busy)}</output>
 {visible&&<><FileSelection repository={repository} policy={{extensions:['pdf'],maxFileBytes:1024*1024,maxFiles:max}} owner={{schoolId:'school',memberId:owner}} files={files} onChange={setFiles} label="양식 파일" onBusyChange={setBusy}/><FileDownloads files={files} read={read} label="다운로드 파일"/></>}
 </>}
 function App(){const[locked,setLocked]=useState(false);return <><style>{'body{margin:16px;font-family:Arial,sans-serif}button{font:inherit}#root{display:grid;gap:16px;max-width:650px}'+styles}</style><output data-locked>{String(locked)}</output><EditSession onLockChange={setLocked}><Controls/></EditSession></>}
 createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
 `, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }), page = await context.newPage()
const results = [], errors = [], external = [], requestedDownloads = [], output = process.env.WORKHUB_QA_OUTPUT
if (output) mkdirSync(output, { recursive: true })
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); page.on('download', download => requestedDownloads.push(download))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5176/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
const file = (name, suffix = name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + suffix + '\n%%EOF') })
const picker = () => page.getByLabel('양식 파일 선택', { exact: true })
const selection = () => page.getByRole('region', { name: '양식 파일', exact: true })
const downloads = () => page.getByRole('region', { name: '다운로드 파일', exact: true })
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function reset() {
  await page.goto('http://127.0.0.1:5176/file-controls'); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await picker().waitFor(); await settle()
}
async function test(name, action) { await reset(); await action(); results.push(name); console.log('  ✓ ' + name) }
async function selected(count) { await page.waitForFunction(count => window.fileRefs.length === count, count); await settle() }
async function replace(name, value) {
  const chosen = page.waitForEvent('filechooser')
  await selection().getByRole('button', { name: name + ' 바꾸기', exact: true }).click()
  await (await chosen).setFiles(value)
}
async function startSlow(name = '느린 문서.pdf') {
  await page.evaluate(() => { window.fileMode = 'stage-delay' }); await picker().setInputFiles(file(name)); await page.getByRole('button', { name: '파일 확인 취소', exact: true }).waitFor()
}

try {
  await test('파일 선택을 실제 검사하고 기본 확인·개수·다운로드 동선을 표시한다', async () => {
    await picker().setInputFiles(file('첫 문서.pdf')); await selected(1)
    assert.match(await selection().innerText(), /기본 확인 완료 · 현재 창에 보관/)
    assert.equal(await page.locator('[data-busy]').innerText(), 'false')
    assert.equal(await page.locator('[data-locked]').innerText(), 'false')
    assert.equal(await picker().inputValue(), '')
  })
  await test('묶음 중 한 파일이 형식 검사에 실패하면 기존 선택을 보존한다', async () => {
    await picker().setInputFiles(file('기존.pdf')); await selected(1)
    await picker().setInputFiles([file('정상.pdf'), { name: '손상.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') }])
    await selection().getByRole('alert').waitFor(); assert.deepEqual(await page.evaluate(() => window.fileRefs.map(ref => ref.name)), ['기존.pdf'])
    assert.equal(await page.evaluate(() => window.probeStaged(0)), true); assert.equal(await page.evaluate(() => window.probeStaged(1)), false)
  })
  await test('같은 파일을 다시 선택할 수 있고 중복은 기존 목록을 바꾸지 않는다', async () => {
    await picker().setInputFiles(file('같은 문서.pdf')); await selected(1)
    await picker().setInputFiles(file('같은 문서.pdf')); await selection().getByRole('alert').waitFor()
    assert.match(await selection().getByRole('alert').innerText(), /중복/); assert.equal(await page.evaluate(() => window.fileRefs.length), 1)
    assert.equal(await page.evaluate(() => window.probeStaged(0)), true); assert.equal(await page.evaluate(() => window.probeStaged(1)), false)
    await selection().getByRole('button', { name: '같은 문서.pdf 제거', exact: true }).click(); await selected(0)
    await picker().setInputFiles(file('같은 문서.pdf')); await selected(1)
  })
  await test('허용 개수를 넘는 선택을 읽기 전에 막고 이전 파일을 남긴다', async () => {
    await picker().setInputFiles(file('기존.pdf')); await selected(1)
    await picker().setInputFiles([file('추가1.pdf'), file('추가2.pdf'), file('추가3.pdf')]); await selection().getByRole('alert').waitFor()
    assert.match(await selection().getByRole('alert').innerText(), /최대 3개/); assert.equal(await page.evaluate(() => window.fileRefs.length), 1)
  })
  await test('최대 개수에서도 같은 이름의 새 파일을 원자적으로 바꾸고 미저장 이전 실물은 회수한다', async () => {
    await picker().setInputFiles([file('첫 문서.pdf'), file('둘째.pdf'), file('셋째.pdf')]); await selected(3)
    const before = await page.evaluate(() => window.fileRefs)
    await replace('첫 문서.pdf', file('첫 문서.pdf', '수정된 원문'))
    await page.waitForFunction(id => window.fileRefs[0].id !== id, before[0].id); await settle()
    const after = await page.evaluate(() => window.fileRefs)
    assert.equal(await picker().evaluate(node => document.activeElement === node), true, '교체 성공 후 파일 선택으로 초점 복귀')
    assert.equal(after.length, 3); assert.equal(after[0].name, before[0].name); assert.notEqual(after[0].sha256, before[0].sha256)
    assert.deepEqual(after.slice(1), before.slice(1)); assert.equal(await page.evaluate(() => window.probeStaged(0)), false)
    const received = page.waitForEvent('download'); await downloads().getByRole('button', { name: '첫 문서.pdf 다운로드', exact: true }).click()
    assert.deepEqual(readFileSync(await (await received).path()), file('첫 문서.pdf', '수정된 원문').buffer)
  })
  await test('교체 파일의 기본 형식이나 중복 검사가 실패해도 원래 목록과 실물을 그대로 둔다', async () => {
    await picker().setInputFiles([file('기존.pdf'), file('다른.pdf')]); await selected(2)
    const before = await page.evaluate(() => window.fileRefs)
    await replace('기존.pdf', { name: '손상.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') })
    await selection().getByRole('alert').waitFor(); assert.deepEqual(await page.evaluate(() => window.fileRefs), before)
    await replace('기존.pdf', file('다른.pdf')); await selection().getByRole('alert').waitFor()
    assert.match(await selection().getByRole('alert').innerText(), /중복/); assert.deepEqual(await page.evaluate(() => window.fileRefs), before)
    assert.equal(await page.evaluate(() => window.probeStaged(0)), true); assert.equal(await page.evaluate(() => window.probeStaged(1)), true)
    assert.equal(await page.evaluate(() => window.probeStaged(2)), false)
  })
  await test('교체 취소는 원래 파일을 보존하고 바꾸기 버튼으로 초점을 돌려준다', async () => {
    await picker().setInputFiles(file('기존.pdf')); await selected(1)
    const before = await page.evaluate(() => window.fileRefs)
    await page.evaluate(() => { window.fileMode = 'stage-delay' }); await replace('기존.pdf', file('교체.pdf'))
    await page.getByRole('button', { name: '파일 확인 취소', exact: true }).click(); await settle()
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '기존.pdf 바꾸기')
    await page.evaluate(() => window.releaseFiles()); await page.waitForFunction(() => window.finishedStages === 2); await settle()
    assert.deepEqual(await page.evaluate(() => window.fileRefs), before); assert.equal(await page.evaluate(() => window.probeStaged(1)), false)
  })
  await test('교체 중 다른 선택 목록이 반영되면 늦은 교체 결과로 덮어쓰지 않는다', async () => {
    await picker().setInputFiles([file('기존.pdf'), file('남길 파일.pdf')]); await selected(2)
    const before = await page.evaluate(() => window.fileRefs)
    await page.evaluate(() => { window.fileMode = 'stage-delay' }); await replace('기존.pdf', file('늦은 교체.pdf'))
    await page.evaluate(() => window.setFileRefs(window.fileRefs.slice(1))); await selected(1)
    await page.evaluate(() => window.releaseFiles()); await page.waitForFunction(() => window.finishedStages === 3); await settle()
    assert.deepEqual(await page.evaluate(() => window.fileRefs), before.slice(1)); assert.equal(await page.evaluate(() => window.probeStaged(2)), false)
  })
  await test('검사 중 이동을 잠그고 취소하면 늦은 결과를 반영하지 않는다', async () => {
    await startSlow(); assert.equal(await page.locator('[data-locked]').innerText(), 'true')
    await page.getByRole('button', { name: '다른 화면 이동', exact: true }).click(); assert.equal(await page.locator('[data-moves]').innerText(), '0')
    await page.getByRole('button', { name: '파일 확인 취소', exact: true }).click(); await settle()
    assert.equal(await picker().evaluate(element => element === document.activeElement), true)
    assert.equal(await page.locator('[data-busy]').innerText(), 'false'); assert.equal(await page.locator('[data-locked]').innerText(), 'false')
    await page.evaluate(() => window.releaseFiles()); await page.waitForFunction(() => window.finishedStages === 1); await settle(); assert.equal(await page.evaluate(() => window.fileRefs.length), 0)
    assert.equal(await page.evaluate(() => window.probeStaged(0)), false)
    await page.getByRole('button', { name: '다른 화면 이동', exact: true }).click(); assert.equal(await page.locator('[data-moves]').innerText(), '1')
  })
  await test('검사 중 교사·정책이 바뀌거나 화면이 닫히면 늦은 응답을 버린다', async () => {
    for (const kind of ['owner', 'policy', 'unmount']) {
      if (kind !== 'owner') await reset()
      await startSlow(); await page.evaluate(kind => { if (kind === 'owner') window.setFileOwner('teacher-b'); else if (kind === 'policy') window.setFilePolicy(2); else window.setFileVisible(false) }, kind)
      await settle(); await page.evaluate(() => window.releaseFiles()); await page.waitForFunction(() => window.finishedStages === 1); await settle()
      assert.equal(await page.evaluate(() => window.fileRefs.length), 0); assert.equal(await page.locator('[data-busy]').innerText(), 'false')
      assert.equal(await page.evaluate(() => window.probeStaged(0)), false)
    }
  })
  await test('선택과 제거를 반복해도 미저장 파일 실물이 누적되지 않는다', async () => {
    for (let i = 0; i < 12; i++) {
      const name = `반복 선택 ${i}.pdf`
      await picker().setInputFiles(file(name)); await selected(1)
      await selection().getByRole('button', { name: name + ' 제거', exact: true }).click(); await selected(0)
      assert.equal(await page.evaluate(index => window.probeStaged(index), i), false)
    }
    await picker().setInputFiles(file('마지막 선택.pdf')); await selected(1)
    assert.equal(await page.evaluate(() => window.probeStaged(12)), true)
  })
  await test('저장된 원문을 교체한 뒤 편집을 닫으면 저장본은 남고 새 미저장본만 회수한다', async () => {
    await picker().setInputFiles(file('저장 원문.pdf')); await selected(1)
    await page.evaluate(() => window.retainStaged(0))
    await replace('저장 원문.pdf', file('새 미저장본.pdf'))
    await page.waitForFunction(() => window.fileRefs[0]?.name === '새 미저장본.pdf'); await settle()
    assert.equal(await page.evaluate(() => window.probeStaged(0)), true)
    assert.equal(await page.evaluate(() => window.probeStaged(1)), true)
    await page.evaluate(() => window.setFileVisible(false)); await settle()
    assert.equal(await page.evaluate(() => window.probeStaged(0)), true)
    assert.equal(await page.evaluate(() => window.probeStaged(1)), false)
  })
  await test('저장된 파일을 선택 목록에서 제거해도 보관 원문은 유지한다', async () => {
    await picker().setInputFiles(file('저장된 파일.pdf')); await selected(1)
    await page.evaluate(() => window.retainStaged(0))
    await selection().getByRole('button', { name: '저장된 파일.pdf 제거', exact: true }).click(); await selected(0)
    assert.equal(await page.evaluate(() => window.probeStaged(0)), true)
  })
  await test('선택 완료 후 소속 변경이나 화면 해제 시 이전 편집의 미저장 실물을 회수한다', async () => {
    for (const kind of ['owner', 'unmount']) {
      if (kind !== 'owner') await reset()
      await picker().setInputFiles(file('임시 선택.pdf')); await selected(1)
      await page.evaluate(kind => { if (kind === 'owner') { window.setFileRefs([]); window.setFileOwner('teacher-b') } else window.setFileVisible(false) }, kind)
      await settle()
      assert.equal(await page.evaluate(() => window.probeStaged(0)), false)
    }
  })
  await test('원시 파일 오류는 상세 정보 없이 안전한 안내로 표시한다', async () => {
    await page.evaluate(() => { window.fileMode = 'stage-raw' }); await picker().setInputFiles(file('오류.pdf')); await selection().getByRole('alert').waitFor()
    assert.match(await selection().getByRole('alert').innerText(), /파일을 확인하지 못했습니다/)
    assert(!(await page.locator('body').innerText()).includes('secret-key'))
  })
  await test('파일 읽기는 매번 다시 호출하며 실제 바이트로 다운로드를 요청한다', async () => {
    const content = file('다운로드.pdf'); await picker().setInputFiles(content); await selected(1)
    for (let i = 0; i < 2; i++) {
      const pending = page.waitForEvent('download'); await downloads().getByRole('button', { name: '다운로드.pdf 다운로드', exact: true }).click(); const download = await pending
      assert.equal(download.suggestedFilename(), content.name); assert.deepEqual(readFileSync(await download.path()), content.buffer)
    }
    assert.equal(await page.evaluate(() => window.readCount), 2)
    assert.match(await downloads().innerText(), /다운로드를 요청했습니다/)
  })
  await test('다운로드 취소·화면 닫힘 뒤 읽기 응답이 도착해도 파일을 내보내지 않는다', async () => {
    for (const kind of ['cancel', 'unmount']) {
      if (kind !== 'cancel') await reset()
      await picker().setInputFiles(file('늦은 다운로드.pdf')); await selected(1); await page.evaluate(() => { window.fileMode = 'read-delay' })
      const before = requestedDownloads.length
      await downloads().getByRole('button', { name: '늦은 다운로드.pdf 다운로드', exact: true }).click(); await page.getByRole('button', { name: '다운로드 취소', exact: true }).waitFor()
      if (kind === 'cancel') await page.getByRole('button', { name: '다운로드 취소', exact: true }).click(); else await page.evaluate(() => window.setFileVisible(false))
      await settle()
      if (kind === 'cancel') assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '늦은 다운로드.pdf 다운로드')
      await page.evaluate(() => window.releaseFiles()); await page.waitForFunction(() => window.finishedReads === 1); await settle(); assert.equal(requestedDownloads.length, before)
    }
  })
  await test('파일 부재와 예상하지 못한 읽기 오류를 구분하고 비밀을 노출하지 않는다', async () => {
    await picker().setInputFiles(file('오류 다운로드.pdf')); await selected(1)
    await page.evaluate(() => { window.fileMode = 'read-missing' }); await downloads().getByRole('button', { name: '오류 다운로드.pdf 다운로드', exact: true }).click(); await downloads().getByRole('alert').waitFor()
    assert.match(await downloads().getByRole('alert').innerText(), /원본을 다시 선택/)
    await page.evaluate(() => { window.fileMode = 'read-raw' }); await downloads().getByRole('button', { name: '오류 다운로드.pdf 다운로드', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.wf-file-downloads [role=alert]')?.textContent.includes('다시 시도'))
    assert(!(await page.locator('body').innerText()).includes('private-stack'))
  })
  await test('긴 한글 파일 이름과 키보드 포커스가 모바일 폭 안에 표시된다', async () => {
    const name = '학교문서확인을위한긴이름'.repeat(5) + '.pdf'
    await picker().setInputFiles(file(name)); await selected(1)
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }))
    assert(width.scroll <= width.viewport + 1, JSON.stringify(width))
    await selection().getByRole('button', { name: name + ' 제거', exact: true }).focus()
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), name + ' 제거')
    if (output) await page.screenshot({ path: join(output, 'file-controls-390.png'), fullPage: true })
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) writeFileSync(join(output, 'file-controls.json'), JSON.stringify({ results, errors, external }, null, 2))
} finally { await context.close(); await browser.close() }
