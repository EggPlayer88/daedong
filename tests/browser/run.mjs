// 브라우저 계약은 npm test와 따로 보고한다. 운영 서버 대신 합성 전송과 소유한 로컬 Vite만 사용한다.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasPreviewUrl } from './preview-readiness.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scripts = [
  'workhub-tasks', 'workhub-connection', 'workhub-connection-exit', 'workhub-draft-recovery', 'workhub-day-refresh', 'workhub-readiness',
  'workhub-navigation', 'workhub-foundation', 'workhub-calendar-views',
  'workhub-calendar-recovery', 'workhub-calendar-import', 'workhub-request-recovery',
  'workhub-home-search', 'workhub-home-layout', 'workhub-task-navigation',
  'workhub-collection-workbench', 'workhub-collection-entry', 'workhub-collection-followup', 'workhub-collection-server', 'workhub-file-controls', 'workhub-file-collections', 'workhub-file-persistence',
  'workhub-student-workspace', 'workhub-student-entry',
  'workhub-accessibility', 'workhub-collection-accessibility', 'workhub-student-accessibility',
  'workhub-task-paging', 'workhub-collection-paging', 'workhub-student-paging',
  'workhub', 'workhub-offline', 'workhub-appearance', 'workhub-mobile-navigation',
]
const filters = process.argv.slice(2)
if (filters.includes('--list')) { console.log(scripts.join('\n')); process.exit(0) }
const selected = scripts.filter(name => !filters.length || filters.some(filter => name.includes(filter)))
if (!selected.length) throw new Error('선택한 브라우저 시험이 없습니다. --list로 이름을 확인하세요.')
for (const name of selected) if (!existsSync(join(root, `tests/browser/${name}.mjs`))) throw new Error(`필수 브라우저 시험이 없습니다: ${name}`)
const work = mkdtempSync(join(tmpdir(), 'workhub-browser-'))
const output = resolve(process.env.WORKHUB_QA_OUTPUT || join(work, 'results'))
mkdirSync(output, { recursive: true })
const results = []
let server

function runNode(args, { environment = process.env, timeout = 120000, cwd = root } = {}) {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, args, { cwd, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk) })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeout)
    child.on('error', error => { stderr += error.message })
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ exitCode: code, signal, timedOut, stdout, stderr }) })
  })
}

async function startPreview() {
  // 기존 개발 서버와 섞이지 않도록 별도 고정 포트의 성공을 확인한다. 점유됐으면 Vite가 실패한다.
  const url = 'http://127.0.0.1:5187/'
  server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: join(root, 'apps/workhub'), env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = '', failed
  server.stdout.on('data', chunk => { log += chunk })
  server.stderr.on('data', chunk => { log += chunk })
  server.on('error', error => { failed = error.message })
  server.on('exit', code => { failed = `Vite 종료 코드 ${code}` })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (failed) throw new Error(`${failed}\n${log}`)
    if (hasPreviewUrl(log, url)) {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return url } catch { /* 소유 서버의 준비가 끝날 때까지 기다린다. */ }
    }
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error(`브라우저 시험용 Vite를 준비하지 못했습니다.\n${log}`)
}

try {
  let offline, previewUrl
  if (selected.includes('workhub-offline')) {
    offline = join(work, 'preview.html')
    const prepared = await runNode(['scripts/export-workhub-preview.mjs', offline])
    if (prepared.exitCode !== 0) throw new Error('오프라인 미리보기 생성에 실패했습니다.')
  }
  if (selected.includes('workhub-appearance')) previewUrl = await startPreview()
  for (const name of selected) {
    console.log(`\n브라우저 검사: ${name}`)
    const started = Date.now(), directory = join(output, name)
    mkdirSync(directory, { recursive: true })
    const environment = { ...process.env, WORKHUB_QA_OUTPUT: directory }
    delete environment.WORKHUB_QA_URL
    if (name === 'workhub-appearance') environment.WORKHUB_QA_URL = previewUrl
    const args = [`tests/browser/${name}.mjs`, ...(name === 'workhub-offline' ? [offline] : [])]
    const result = await runNode(args, { environment })
    writeFileSync(join(directory, 'console.log'), result.stdout + result.stderr)
    results.push({ name, passed: result.exitCode === 0 && !result.timedOut, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, durationMs: Date.now() - started })
    // 실패한 이후에도 독립된 나머지 계약의 결과를 모으되 실패를 성공으로 바꾸지 않는다.
  }
} finally {
  if (server && server.exitCode === null) {
    await new Promise(done => { server.once('exit', done); server.kill() })
  }
  writeFileSync(join(output, 'summary.json'), JSON.stringify({ browser: process.env.PLAYWRIGHT_CHANNEL || 'chrome', results }, null, 2))
}
const failed = results.filter(result => !result.passed)
console.log(`\n브라우저 파일 ${results.length}개 중 ${results.length - failed.length}개 통과 · 결과: ${output}`)
if (failed.length) { console.error(`실패: ${failed.map(result => result.name).join(', ')}`); process.exitCode = 1 }
