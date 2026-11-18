import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { launchBrowser } from '../tests/browser/launch-browser.mjs'
import { makeQualitySchool } from '../tests/helpers/timetable-quality-fixtures.mjs'

// 폴더 선택 대화상자만 대체한다. 요청·계산·작업자 검증·정책 간격의 UI 조회는 실제 경로다.
const scriptRoot = dirname(fileURLToPath(import.meta.url)), root = resolve(scriptRoot, '..')
const args = process.argv.slice(2)
const usage = '사용법: node scripts/benchmark-timetable-button.mjs --output-directory <결과 폴더> [--classes 9|18]'
const supplied = new Map()
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1]
  assert.ok(['--classes', '--output-directory'].includes(key) && !supplied.has(key) && typeof value === 'string' && value.trim() && !value.startsWith('--'), usage)
  supplied.set(key, value)
}
assert.ok(supplied.has('--output-directory') && (!supplied.has('--classes') || ['9', '18'].includes(supplied.get('--classes'))), usage)
const classes = Number(supplied.get('--classes') ?? '9')
// 상대 경로는 현재 셸 위치가 아니라 저장소 루트를 기준으로 해석한다.
const outputDirectory = resolve(root, supplied.get('--output-directory'))
mkdirSync(outputDirectory, { recursive: true })
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const prefix = join(outputDirectory, `benchmark-button-${classes}classes-` + stamp), store = prefix + '-store'
const reportPath = prefix + '.json', screenshotPath = prefix + '.png'
const TEST_BUDGET_MS = 180000, targetMs = 60000
const fixture = makeQualitySchool({ classes, complex: true, seed: 71283 })
const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
const sourcePaths = [
  ...readdirSync(join(root, 'packages/timetable/engine')).filter(name => name.endsWith('.py')).map(name => 'packages/timetable/engine/' + name),
  ...readdirSync(join(root, 'packages/timetable/_assets')).filter(name => name.endsWith('.json')).map(name => 'packages/timetable/_assets/' + name),
  ...['cpSat.ts', 'balanced.ts', 'validate.ts'].map(name => 'packages/timetable/src/' + name),
  ...['TimetableEnginePanel.tsx', 'LocalTimetableEngine.tsx'].map(name => 'apps/workhub/src/timetable/' + name),
  'tests/helpers/timetable-quality-fixtures.mjs', 'scripts/benchmark-timetable-button.mjs',
].sort()
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]))
const processors = cpus()
const report = { startedAt: new Date().toISOString(), fixture: { label: fixture.label, classes, complex: true, seed: 71283 },
  targetMs, testBudgetMs: TEST_BUDGET_MS, timingDefinition: '실제 버튼 click capture부터 후보 제목·radio 3개·품질 평가가 표시된 뒤 두 프레임까지; 작업자 검증과 실제 정책 간격의 UI 조회 포함',
  sourceHashes, currentCommit: null, environment: { platform: platform(), release: release(), arch: arch(), nodeVersion: process.version,
    cpu: { model: processors[0]?.model ?? null, logicalProcessors: processors.length, reportedSpeedsMHz: [...new Set(processors.map(cpu => cpu.speed))] }, totalMemoryBytes: totalmem(), python: null },
  outputDirectory, store, screenshotPath, passed: false, errors: [], policy: JSON.parse(readFileSync(join(root, 'packages/timetable/_assets/balanced-policy.json'), 'utf8')) }

function launch(command, args, captureOutput = false) {
  const started = performance.now(), child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const output = []
  const state = { started, pid: child.pid ?? null, exitCode: null, signal: null, stdoutBytes: 0, stderrBytes: 0, spawnError: null, elapsedMs: null }
  child.stdout.on('data', value => { state.stdoutBytes += value.length; if (captureOutput && state.stdoutBytes <= 65536) output.push(value) })
  child.stderr.on('data', value => { state.stderrBytes += value.length })
  const done = new Promise(resolveDone => {
    child.once('error', error => { state.spawnError = error.code ?? error.name })
    child.once('close', (code, signal) => { state.exitCode = code; state.signal = signal; state.elapsedMs = performance.now() - started; resolveDone(state) })
  })
  // 작업자 출력은 수집하지 않는다. 명시한 버전 조회 명령만 제한된 메타데이터를 읽는다.
  return { child, state, done, output: () => Buffer.concat(output).toString('utf8') }
}

async function pickPython() {
  const candidates = [process.env.TIMETABLE_PYTHON, process.env.PYTHON, join(root, 'packages/timetable/.venv/Scripts/python.exe'), join(root, 'tests/.venv/Scripts/python.exe'), join(root, 'tests/.venv/bin/python'), 'python3', 'python'].filter(Boolean)
  for (const candidate of candidates) {
    if (/[\\/]/.test(candidate) && !existsSync(candidate)) continue
    const result = await launch(candidate, ['-c', 'import ortools; assert ortools.__version__ == "9.15.6755"']).done
    if (result.exitCode === 0) return candidate
  }
  throw new Error('고정 OR-Tools 실행 환경을 찾지 못했습니다.')
}

let browser, page, worker, requestId, python, readyAtHost, clickAtHost
const jobsArgs = (...args) => ['packages/timetable/engine/jobs.py', ...args, '--store', store]
const persist = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
try {
  python = await pickPython()
  const commit = launch('git', ['rev-parse', 'HEAD'], true)
  const runtime = launch(python, ['-c', 'import json,platform,sys,ortools;print(json.dumps(dict(version=platform.python_version(),fullVersion=sys.version,implementation=platform.python_implementation(),executable=sys.executable,ortoolsVersion=ortools.__version__)))'], true)
  const [commitExit, runtimeExit] = await Promise.all([commit.done, runtime.done])
  assert.equal(commitExit.exitCode, 0, '시작 커밋 확인 실패'); assert.equal(runtimeExit.exitCode, 0, 'Python 실행 환경 확인 실패')
  report.currentCommit = commit.output().trim(); assert.match(report.currentCommit, /^[0-9a-f]{40}$/)
  report.environment.python = JSON.parse(runtime.output())
  report.metadataCapturedAt = new Date().toISOString()
  persist()
  const initialized = await launch(python, jobsArgs('init')).done
  assert.equal(initialized.exitCode, 0, '전용 작업 폴더 초기화 실패')
  const bundle = buildSync({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{TimetableEnginePanel}from'./apps/workhub/src/timetable/TimetableEnginePanel';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
import{parseCpSatResponse}from'./packages/timetable/src/cpSat';import{validatePlacements}from'./packages/timetable/src/validate';
import{actualTimetableFingerprint,evaluateBalancedQuality,timetableDifferenceMinutes}from'./packages/timetable/src/balanced';
const member={id:'m',schoolId:'synthetic_quality_school',userId:'u',name:'합성 담당자',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]},drafts=createEditDrafts();window.adopted=[];
window.auditResult=async(request,result)=>{await parseCpSatResponse(request,result);return{requestAndResponseAccepted:true,hard:result.candidates.map(c=>validatePlacements(request.basis,c.placements)),quality:result.candidates.map(c=>evaluateBalancedQuality(request.basis,c.placements,request.options)),distinctActualTimetables:new Set(result.candidates.map(c=>actualTimetableFingerprint(request.basis,c.placements))).size,pairwiseDifferenceMinutes:result.candidates.map(a=>result.candidates.map(b=>timetableDifferenceMinutes(request.basis,a.placements,b.placements)))}};
createRoot(document.getElementById('root')).render(<EditDraftsProvider store={drafts}><main className="timetable-workspace"><h1>합성 ${classes}학급 시간표 · 실제 PC 계산 경로</h1><TimetableEnginePanel member={member} basis={window.syntheticBasis} placements={null} lockedLessonIds={[]} scopeResourceId="" disabled={false} onAdopt={p=>window.adopted.push(p)}/></main></EditDraftsProvider>);
`, loader: 'tsx', resolveDir: root }, bundle: true, format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'text' },
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  browser = await launchBrowser()
  report.environment.browser = { version: browser.version(), channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', viewport: { width: 1280, height: 900 } }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  page = await context.newPage(); page.setDefaultTimeout(TEST_BUDGET_MS)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.exposeFunction('jobFileIO', ({ op, path, text, create }) => {
    const target = resolve(store, path)
    assert.ok(target === store || target.startsWith(store + sep), '시험 폴더 밖 접근 거절')
    try {
      if (op === 'list') return { entries: readdirSync(target, { withFileTypes: true }).map(e => [e.name, { kind: e.isDirectory() ? 'directory' : 'file' }]) }
      if (op === 'directory') { if (create) mkdirSync(target, { recursive: true }); return existsSync(target) ? { ok: true } : { error: 'NotFoundError' } }
      if (op === 'file') { if (create && !existsSync(target)) writeFileSync(target, ''); return existsSync(target) ? { ok: true } : { error: 'NotFoundError' } }
      if (op === 'read') { const value = readFileSync(target); return { text: value.toString('utf8'), size: value.length, lastModified: statSync(target).mtimeMs } }
      if (op === 'open' || op === 'chunk') return { ok: true }
      if (op === 'remove') { rmSync(target); return { ok: true } }
      if (op === 'write') {
        writeFileSync(target + '.browser-tmp', text); renameSync(target + '.browser-tmp', target)
        if (path.endsWith('/ready.json') && !worker) {
          readyAtHost = performance.now()
          const ready = JSON.parse(readFileSync(target, 'utf8'))
          const input = JSON.parse(readFileSync(join(dirname(target), 'request.json'), 'utf8'))
          assert.equal(ready.requestId, input.requestId); assert.equal(ready.inputHash, input.inputHash)
          requestId = ready.requestId
          worker = launch(python, jobsArgs('work', '--once'))
        }
        return { ok: true }
      }
      throw new Error('지원하지 않는 시험 파일 작업')
    } catch (error) { if (error.code === 'ENOENT') return { error: 'NotFoundError' }; throw error }
  })
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div></html>' }))
  await page.goto('http://127.0.0.1:5179/button-benchmark')
  await page.evaluate(basis => {
    window.syntheticBasis = basis
    async function io(args) { const result = await window.jobFileIO(args); if (result.error) throw new DOMException(result.error, result.error); return result }
    function directory(path = '') {
      return { name: '합성 시간표 전용 폴더', async *entries() { const result = await io({ op: 'list', path }); for (const entry of result.entries) yield entry },
        async removeEntry(name) { await io({ op: 'remove', path: path ? path + '/' + name : name }) },
        async getDirectoryHandle(name, options = {}) { const next = path ? path + '/' + name : name; await io({ op: 'directory', path: next, create: options.create }); return directory(next) },
        async getFileHandle(name, options = {}) {
          const next = path ? path + '/' + name : name; await io({ op: 'file', path: next, create: options.create })
          return { key: next, async isSameEntry(other) { return other.key === next }, async getFile() { const result = await io({ op: 'read', path: next }); return { size: result.size, lastModified: result.lastModified, async text() { return result.text } } },
            async createWritable() { await io({ op: 'open', path: next }); let text = ''; return { async write(value) { await io({ op: 'chunk', path: next }); text = value }, async close() { await io({ op: 'write', path: next, text }) }, async abort() {} } } }
        } }
    }
    window.showDirectoryPicker = async () => directory()
  }, fixture.basis)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.addStyleTag({ content: readFileSync(join(root, 'apps/workhub/src/timetable/timetable.css'), 'utf8') + 'body{margin:24px;background:#f6f8fb;font-family:Arial,sans-serif;color:#18283d}main{max-width:1200px;margin:auto}' })
  await page.getByText('최적화 엔진으로 계산·후보 비교', { exact: true }).click()
  assert.equal(await page.getByLabel('계산 목표', { exact: true }).inputValue(), 'balanced')
  assert.equal(await page.getByLabel('계산 시간 한도(초)', { exact: true }).inputValue(), '60')
  assert.equal(await page.getByLabel('비교할 후보 수', { exact: false }).inputValue(), '3')
  await page.getByRole('button', { name: '계산 작업 폴더 연결', exact: true }).click()
  await page.getByText('계산 폴더를 연결했습니다.', { exact: false }).waitFor()
  const button = page.getByRole('button', { name: '이 PC에서 최적화 시작', exact: true })
  await button.evaluate(element => {
    window.buttonTiming = { started: null, shown: null, finished: null, elapsedMs: null }
    const visible = element => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
    const shown = () => [...document.querySelectorAll('h3')].some(h => h.textContent === '검사를 통과한 후보를 찾았습니다' && visible(h))
      && [...document.querySelectorAll('input[type="radio"]')].filter(visible).length === 3
      && visible(document.querySelector('[aria-label="선택 후보 품질 평가"]'))
    let framesPending = false
    const observer = new MutationObserver(() => {
      if (window.buttonTiming.started === null || window.buttonTiming.finished !== null || framesPending || !shown()) return
      framesPending = true; window.buttonTiming.shown = performance.now()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        framesPending = false
        if (!shown()) return
        window.buttonTiming.finished = performance.now(); window.buttonTiming.elapsedMs = window.buttonTiming.finished - window.buttonTiming.started
        observer.disconnect()
      }))
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    element.addEventListener('click', () => { window.buttonTiming.started = performance.now() }, { capture: true, once: true })
  })
  clickAtHost = performance.now()
  await button.click()
  await page.waitForFunction(() => window.buttonTiming.finished !== null, null, { timeout: TEST_BUDGET_MS })
  report.browserTiming = await page.evaluate(() => window.buttonTiming)
  report.clickToReadyHostMs = readyAtHost - clickAtHost
  report.readyToWorkerSpawnHostMs = worker.state.started - readyAtHost
  const workerExit = await worker.done
  report.worker = workerExit
  assert.equal(workerExit.exitCode, 0, '실제 작업자 비정상 종료')
  const directory = join(store, 'jobs', requestId)
  report.request = JSON.parse(readFileSync(join(directory, 'request.json'), 'utf8'))
  report.response = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
  report.jobStatus = JSON.parse(readFileSync(join(directory, 'status.json'), 'utf8'))
  report.audit = await page.evaluate(({ request, response }) => window.auditResult(request, response), { request: report.request, response: report.response })
  report.adoptedCount = await page.evaluate(() => window.adopted.length)
  assert.equal(report.request.options.maxSeconds, 60); assert.equal(report.request.options.maxCandidates, 3)
  assert.equal(report.request.options.seed, 71283); assert.equal(report.request.options.qualityMode, 'balanced'); assert.equal(report.request.options.minimizeChanges, false)
  assert.equal(report.jobStatus.state, 'succeeded'); assert.equal(report.response.candidates.length, 3)
  assert.ok(report.audit.hard.every(value => value.valid)); assert.equal(report.audit.distinctActualTimetables, 3)
  assert.equal(report.adoptedCount, 0); assert.deepEqual(report.errors, [])
  report.met60SecondsGoal = report.browserTiming.elapsedMs <= targetMs
  report.passed = report.met60SecondsGoal
  await page.screenshot({ path: screenshotPath, fullPage: true })
  persist()
  console.log(JSON.stringify({ reportPath, screenshotPath, passed: report.passed, clickToThreeCandidatesMs: report.browserTiming.elapsedMs,
    engineMs: report.response.stats.elapsedMs, candidatePenalties: report.response.candidates.map(c => c.quality.totalPenalty),
    hardValid: report.audit.hard.every(value => value.valid), distinctActualTimetables: report.audit.distinctActualTimetables, workerExitCode: workerExit.exitCode }))
  if (!report.passed) process.exitCode = 1
} catch (error) {
  report.failure = { name: error.name, message: error.message }
  if (worker) report.worker = worker.state
  if (page) {
    report.browserTiming = await page.evaluate(() => window.buttonTiming ?? null).catch(() => null)
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
  }
  if (requestId) {
    const directory = join(store, 'jobs', requestId)
    for (const [key, filename] of [['request', 'request.json'], ['response', 'result.json'], ['jobStatus', 'status.json']]) {
      try { report[key] = JSON.parse(readFileSync(join(directory, filename), 'utf8')) } catch {}
    }
  }
  persist(); console.error(JSON.stringify({ reportPath, passed: false, failure: report.failure, workerExitCode: worker?.state.exitCode ?? null }))
  process.exitCode = 1
} finally {
  // 진행 중 실패하면 원래 요청의 정상 취소 경로를 사용한다. 검증 산출물은 지우지 않는다.
  if (worker && worker.state.elapsedMs === null && requestId) {
    await launch(python, jobsArgs('cancel', '--request-id', requestId)).done
    await worker.done
    report.worker = worker.state; persist()
  }
  if (browser) await browser.close()
}
