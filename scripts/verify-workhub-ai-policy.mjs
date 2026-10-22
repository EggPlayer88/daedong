// 운영 DSN·공급자 없이 격리 PG17 → 실제 앱/Node/Python 계약을 한 번에 검증한다.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const report = process.env.WORKHUB_AI_SQL_REPORT ? resolve(process.env.WORKHUB_AI_SQL_REPORT) : mkdtempSync(join(tmpdir(), 'workhub-ai-policy-report-'))
mkdirSync(report, { recursive: true })
const capture = join(report, 'captures.json')
const operationsCapture = join(report, 'operations-captures.json')
const environment = { ...process.env, P10_AI_CAPTURE: capture, P10_AI_OPERATIONS_CAPTURE: operationsCapture, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const cases = [
  ['postgres', python, ['database/workhub-ai-policy/p10/test/run_p10_operations.py']],
  ['app', process.execPath, ['tests/integration/ai-school-policy-capture.mjs', capture]],
  ['node', process.execPath, ['tests/verify_school_ai_gateway_capture.mjs', capture]],
  ['python', python, ['tests/verify_school_ai_python_capture.py', capture]],
  ['settings-transport', process.execPath, ['tests/integration/ai-school-settings-transport.mjs', python]],
  ['operations-app', process.execPath, ['tests/integration/ai-school-operations-capture.mjs', operationsCapture]],
  ['operations-python', python, ['tests/verify_school_ai_operations_capture.py', operationsCapture]],
]
const results = []
for (const [name, command, args] of cases) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: 'utf-8', windowsHide: true, timeout: 240000, maxBuffer: 10000000 })
  const output = (result.stdout || '') + (result.stderr || '')
  process.stdout.write(output)
  writeFileSync(join(report, `${name}.log`), output)
  results.push({ name, exitCode: result.status, passed: result.status === 0, durationMs: Date.now() - started })
  if (result.status !== 0) break
}
writeFileSync(join(report, 'summary.json'), JSON.stringify({ results, realProviderCalls: 0, productionDbApplied: false }, null, 2))
console.log('학교 AI SQL 검증 기록: ' + report)
if (results.length !== cases.length || results.some(row => !row.passed)) process.exitCode = 1
