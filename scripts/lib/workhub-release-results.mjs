import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Claude가 #60/#62에서 비차단 권장 사항으로 분류한, 서버 호출 전 거부 코드 차이만 인정한다.
// 새 경고를 여기에 자동 추가하지 않는다. 원본 시험이나 승인/권한 검사를 느슨하게 하지 않는다.
const PRECHECK_ADVISORIES = Object.freeze({
  'WARN 앱이 보내기 전에 막았지만 코드가 다름(앱 쪽 확인): ': Object.freeze({
    'tr_preview: 서버 CONFLICT · 앱이 먼저 INVALID_INPUT': 1,
    'tr_preview: 서버 FORBIDDEN · 앱이 먼저 INVALID_INPUT': 1,
  }),
  'WARN 앱이 보내기 전에 막았지만 코드가 다름(PR #60 앱 쪽 확인): ': Object.freeze({
    'rel_preview: 서버 UNAVAILABLE · 앱이 먼저 QUERY_FAILED': 2,
    'tr_mutate: 서버 NOT_FOUND · 앱이 먼저 FORBIDDEN': 1,
    'rel_snapshot: 서버 NOT_FOUND · 앱이 먼저 INVALID_INPUT': 1,
    'rel_preview: 서버 NOT_FOUND · 앱이 먼저 QUERY_FAILED': 1,
    'rel_preview: 서버 NOT_FOUND · 앱이 먼저 CONFLICT': 1,
    'rel_commit: 서버 CONFLICT · 앱이 먼저 INVALID_INPUT': 1,
  }),
})
const evidence = 'database/workhub/integration/재검토_PR62.md'
const failure = code => Object.assign(new Error(code), { code })
export function inspectReleaseLog(suite, text) {
  if (!['integration', 'p8', 'pr62', 'pr62-build', 'relations-path', 'relations-build'].includes(suite) || typeof text !== 'string') throw failure('INVALID_SUITE')
  const lines = text.split(/\r?\n/).map(line => line.trim())
  if (lines.some(line => /^(?:FAIL|KNOWN)(?:\s|$)/.test(line))) throw failure('UNRESOLVED_FAILURE')
  const advisories = []
  const prefixUses = new Map()
  for (const line of lines.filter(line => /^WARN(?:\s|$)/.test(line))) {
    if (suite !== 'integration' && suite !== 'p8') throw failure('UNRECOGNIZED_WARNING')
    const prefix = Object.keys(PRECHECK_ADVISORIES).find(value => line.startsWith(value))
    if (!prefix) throw failure('UNRECOGNIZED_WARNING')
    const allowed = PRECHECK_ADVISORIES[prefix]
    let differences
    try { differences = JSON.parse(line.slice(prefix.length)) } catch { throw failure('MALFORMED_WARNING') }
    if (!differences || Array.isArray(differences) || typeof differences !== 'object' || !Object.keys(differences).length) throw failure('MALFORMED_WARNING')
    for (const [description, count] of Object.entries(differences)) {
      if (!Object.hasOwn(allowed, description) || !Number.isInteger(count) || count < 1 || count > allowed[description]) throw failure('UNRECOGNIZED_WARNING')
    }
    const uses = (prefixUses.get(prefix) ?? 0) + 1
    // 원본 통합과 P8은 보강 있음/없음 두 경로다. 예상 밖 반복도 새 검토 대상으로 둔다.
    if (uses > 2 || suite === 'p8' && !prefix.includes('PR #60')) throw failure('UNRECOGNIZED_WARNING')
    prefixUses.set(prefix, uses)
    const limitations = Object.hasOwn(differences, 'rel_preview: 서버 UNAVAILABLE · 앱이 먼저 QUERY_FAILED') ? [{
      evidence: 'database/workhub/p8/test/app_contract_p8.ts:123',
      reason: '원본 하네스가 ok:false snapshot을 앱에 주지 않고 preview를 호출한다. 실제 UI의 실패 조회→preview 경로는 이 원본 경고로 검증되지 않는다.',
      coveredBy: 'relations-path',
    }] : []
    advisories.push({ code: 'KNOWN_PRECHECK_CODE_DIFFERENCE', evidence, originalLine: line, differences, limitations })
  }
  if (suite.endsWith('-build')) return { passed: null, failed: 0, advisories }
  const totals = lines.map(line => /^(?:== )?(?:합계|PR #62 앱 대조): PASS (\d+) · FAIL (\d+)$/.exec(line)).filter(Boolean)
  if (!totals.length) throw failure('MISSING_TOTAL')
  if (totals.some(total => Number(total[2]) !== 0)) throw failure('UNRESOLVED_FAILURE')
  const [, pass, fail] = totals.at(-1)
  const passed = Number(pass), failed = Number(fail)
  if (!Number.isSafeInteger(passed) || passed <= 0 || failed !== 0) throw failure('UNRESOLVED_FAILURE')
  return { passed, failed, advisories }
}

export function releaseSummary(texts) {
  const results = Object.fromEntries(['integration', 'p8', 'pr62', 'relations-path'].map(suite => [suite, inspectReleaseLog(suite, texts[suite])]))
  return {
    scope: 'isolated_postgresql17_and_captured_app_contracts',
    actualSupabase: false, actualStorage: false, actualClaude: false,
    advisoryLines: Object.values(results).reduce((sum, result) => sum + result.advisories.length, 0), results,
  }
}

export function releaseBranches({ p7With, p7Without, p8With, p8Without, p8StandaloneWith, p8StandaloneWithout }) {
  const enabled = 'PASS H03 P7-05 정상 실행(승인 근거 입력)', disabled = 'PASS H00 P7_BRIDGE=0 — 보강 없이 운영 순서만 시험'
  if (typeof p7With !== 'string' || typeof p7Without !== 'string' || !p7With.includes(enabled) || p7With.includes(disabled) || !p7Without.includes(disabled) || p7Without.includes(enabled)) throw failure('INCORRECT_BRANCH_COVERAGE')
  for (const [capture, expected] of [[p8With, true], [p8Without, false], [p8StandaloneWith, true], [p8StandaloneWithout, false]]) {
    if (capture?.bridge !== expected || !Array.isArray(capture.captures) || capture.captures.length === 0) throw failure('INCORRECT_BRANCH_COVERAGE')
  }
  return { p7: { withBridge: true, withoutBridge: true }, p8Integration: { withBridge: p8With.bridge, withoutBridge: p8Without.bridge }, p8Standalone: { withBridge: p8StandaloneWith.bridge, withoutBridge: p8StandaloneWithout.bridge } }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [mode, value, path] = process.argv.slice(2)
    if (mode === 'check' && process.argv.length === 5) {
      const result = inspectReleaseLog(value, readFileSync(path, 'utf8'))
      console.log(JSON.stringify({ suite: value, passed: result.passed, failed: result.failed, advisoryLines: result.advisories.length }))
    } else if (mode === 'branches' && process.argv.length === 4) {
      const text = name => readFileSync(resolve(value, name), 'utf8'), json = name => JSON.parse(text(name))
      console.log(JSON.stringify(releaseBranches({ p7With: text('integration/p7.txt'), p7Without: text('integration/p7nb.txt'), p8With: json('integration/cap_p8.json'), p8Without: json('integration/cap_p8_nobridge.json'), p8StandaloneWith: json('p8/cap_bridge.json'), p8StandaloneWithout: json('p8/cap_nobridge.json') }), null, 2))
    } else if (mode === 'summarize' && process.argv.length === 4) {
      const summary = releaseSummary(Object.fromEntries(['integration', 'p8', 'pr62', 'relations-path'].map(suite => [suite, readFileSync(resolve(value, `${suite}.log`), 'utf8')])))
      writeFileSync(resolve(value, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
      console.log(JSON.stringify({ results: Object.fromEntries(Object.entries(summary.results).map(([suite, result]) => [suite, { passed: result.passed, failed: result.failed }])), advisoryLines: summary.advisoryLines }))
    } else throw failure('INVALID_ARGUMENTS')
  } catch (error) {
    console.error(JSON.stringify({ code: typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'REPORT_FAILED' }))
    process.exitCode = 1
  }
}
