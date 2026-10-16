// 실제 실행기의 사전 검사를 돌려 외부 접속값·잘못된 삭제 범위가 DB 시작 전에 거부되는지 확인한다.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectReleaseLog, releaseSummary, releaseBranches } from '../scripts/lib/workhub-release-results.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash'
assert.ok(existsSync(bash), '실행기 안전 회귀에는 Bash가 필요합니다. Windows는 Git for Windows를 사용합니다.')
const unix = value => process.platform === 'win32'
  ? execFileSync(bash, ['-c', 'cygpath -u "$1"', 'path', value], { encoding: 'utf8', windowsHide: true }).trim()
  : value
const task = mkdtempSync(join(tmpdir(), 'workhub-release-guards-'))
const script = unix(join(repo, 'scripts/verify-workhub-release-sql.sh'))
const base = { ...process.env }
for (const name of Object.keys(base)) {
  if (/^(?:PG|SUPABASE|VITE_SUPABASE|ANTHROPIC|OPENAI|P[1-8]_|R1_|R1S_|INT_)/.test(name) || ['DATABASE_URL', 'DIRECT_URL', 'WORKHUB_TEST_DATABASE_URL', 'R0_SQL_DIR', 'R0_CONTRACT', 'R0_PG_PORT'].includes(name)) delete base[name]
}
let passed = 0
function check(name, test) { test(); passed++; console.log('  ✓ ' + name) }
function run(path, extra = {}, args = ['--check-safety']) {
  return spawnSync(bash, [script, ...args], { cwd: repo, env: { ...base, R0_WORK: unix(path), ...extra }, encoding: 'utf8', windowsHide: true })
}
function refused(path, extra, expected) {
  const result = run(path, extra)
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, expected)
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-disclose/)
}
try {
  const clean = join(task, 'workhub-release-r0-verify-clean')
  // 실행기는 root를 경로 검사보다 먼저 막는다. 이 안전장치를 우회하지 않고 실제 거부를 확인한다.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    for (const args of [['--check-safety'], []]) {
      check(`root는 ${args.length ? '사전 검사' : '실제 실행'}에서도 DB와 폴더를 만들기 전에 거부`, () => {
        const result = run(clean, {}, args)
        assert.equal(result.status, 2, result.stdout + result.stderr)
        assert.match(result.stderr, /일반 OS 사용자로 실행/)
        assert.equal(existsSync(clean), false)
      })
    }
  } else {
    check('정상 전용 경로의 사전 검사에는 파일 생성이나 서버 시작이 없다', () => {
      const result = run(clean)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(existsSync(clean), false)
    })
    check('다른 이름의 작업 폴더는 시작 전에 거부', () => refused(join(task, 'important-data'), {}, /끝 이름/))
    check('상대 작업 경로 거부', () => refused(clean, { R0_WORK: 'workhub-release-r0-verify-relative' }, /절대 경로/))
    check('원본 대조 도구의 인자가 나뉘는 DB 임시 경로 공백을 시작 전 거부', () => refused(clean, { R0_WORK: unix(clean) + ' with spaces' }, /공백 없이/))
    for (const key of ['DATABASE_URL', 'PGHOST', 'PGSERVICE', 'PGOPTIONS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'ANTHROPIC_API_KEY', 'WORKHUB_TEST_DATABASE_URL', 'R0_SQL_DIR', 'INT_APP_SRC', 'P8_APP_SRC', 'P7_BRIDGE', 'P8_BRIDGE', 'INT_R1S_MODE', 'R1S_API_DIR', 'P4_APP_SRC', 'P8_CAPTURE', 'R1_CAPTURE', 'P7_COOP_CASES']) {
      check(`${key}를 상속하면 값 노출 없이 실행 거부`, () => refused(clean, { [key]: 'do-not-disclose' }, /외부 접속 또는 시험 범위 변경/))
    }
    for (const port of ['abc', '0', '65536', '55463;echo']) {
      check(`잘못된 포트 ${port} 거부`, () => refused(clean, { R0_PG_PORT: port }, /시험 포트/))
    }
    for (const ending of ["quote'", 'dollar$', 'backtick`', 'newline\n']) {
      check('reset 셸의 경계가 될 수 있는 경로 문자 거부: ' + JSON.stringify(ending), () => {
        refused(clean, { R0_WORK: unix(clean) + ending }, /셸 특수문자/)
      })
    }
    const foreign = join(task, 'workhub-release-r0-verify-foreign')
    mkdirSync(foreign)
    writeFileSync(join(foreign, 'keep.txt'), '기존 자료')
    check('기존 자료가 있는 폴더의 내용 보존', () => {
      refused(foreign, {}, /다른 자료/)
      assert.deepEqual(readdirSync(foreign), ['keep.txt'])
      assert.equal(readFileSync(join(foreign, 'keep.txt'), 'utf8'), '기존 자료')
    })
    check('캡처 출력으로 바깥 파일을 지정해도 그 파일을 덮어쓰지 않고 시작 전에 거부', () => {
      refused(clean, { R1_CAPTURE: unix(join(foreign, 'keep.txt')) }, /외부 접속 또는 시험 범위 변경/)
      refused(clean, { P7_COOP_CASES: unix(join(foreign, 'keep.txt')) }, /외부 접속 또는 시험 범위 변경/)
      assert.equal(readFileSync(join(foreign, 'keep.txt'), 'utf8'), '기존 자료')
    })
    writeFileSync(join(foreign, '.codex-workhub-release-sql'), '다른 도구')
    check('다른 도구의 표식은 인정하지 않음', () => refused(foreign, {}, /다른 자료/))
    const owned = join(task, 'workhub-release-r0-verify-owned')
    mkdirSync(owned)
    writeFileSync(join(owned, '.codex-workhub-release-sql'), 'workhub-release-local-sql-v1\n')
    check('정상 표식의 경로도 안전 검사만 하고 변경하지 않음', () => {
      const before = readdirSync(owned)
      assert.equal(run(owned).status, 0)
      assert.deepEqual(readdirSync(owned), before)
    })
    mkdirSync(join(owned, 'data'))
    writeFileSync(join(owned, 'data', 'existing.txt'), '다른 DB')
    check('원본 reset 표식 없는 기존 DB 보존', () => {
      refused(owned, {}, /표식이 없는 DB/)
      assert.equal(readFileSync(join(owned, 'data', 'existing.txt'), 'utf8'), '다른 DB')
    })
    check('알 수 없는 실행 인자는 실행 전에 거부', () => {
      const result = run(clean, {}, ['--use-production'])
      assert.equal(result.status, 2)
      assert.equal(existsSync(clean), false)
    })
  }
  const total = '\n== 합계: PASS 2309 · FAIL 0\n'
  const warning = 'WARN 앱이 보내기 전에 막았지만 코드가 다름(PR #60 앱 쪽 확인): '
  const known = { 'rel_preview: 서버 NOT_FOUND · 앱이 먼저 QUERY_FAILED': 1 }
  check('원본 요약에서 통과·실패 수를 읽고 실제 서비스와 구분', () => {
    const summary = releaseSummary({ integration: total, p8: '합계: PASS 322 · FAIL 0', pr62: 'PR #62 앱 대조: PASS 53 · FAIL 0', 'relations-path': '합계: PASS 19 · FAIL 0' })
    assert.equal(summary.results.integration.passed, 2309)
    assert.equal(summary.advisoryLines, 0)
    assert.equal(summary.actualSupabase, false)
    assert.equal(summary.actualStorage, false)
    assert.equal(summary.actualClaude, false)
  })
  check('검토된 권장 코드 차이는 원문과 근거를 남기며 0 WARN으로 숨기지 않음', () => {
    const line = warning + JSON.stringify(known)
    const result = inspectReleaseLog('integration', line + total)
    assert.equal(result.advisories.length, 1)
    assert.equal(result.advisories[0].originalLine, line)
    assert.deepEqual(result.advisories[0].differences, known)
    assert.match(result.advisories[0].evidence, /재검토_PR62\.md$/)
  })
  for (const [name, text] of [
    ['하위 FAIL 뒤 성공 요약', '  FAIL 자식 검사\n' + total],
    ['하위 실패 요약 뒤 전체 성공 요약', '합계: PASS 12 · FAIL 1\n' + total],
    ['KNOWN 뒤 성공 요약', 'KNOWN 미해결\n' + total],
    ['새 경고 종류', 'WARN 새로운 계약 차이\n' + total],
    ['새 경고 코드', warning + JSON.stringify({ 'rel_preview: 서버 FORBIDDEN · 앱이 먼저 OK': 1 }) + total],
    ['관계 UNAVAILABLE 경고의 새로운 차이', warning + JSON.stringify({ 'rel_preview: 서버 UNAVAILABLE · 앱이 먼저 FORBIDDEN': 2 }) + total],
    ['경고 건수 증가', warning + JSON.stringify({ 'rel_preview: 서버 NOT_FOUND · 앱이 먼저 QUERY_FAILED': 2 }) + total],
    ['0건 경고', warning + JSON.stringify({ 'rel_preview: 서버 NOT_FOUND · 앱이 먼저 QUERY_FAILED': 0 }) + total],
    ['문자열 건수', warning + JSON.stringify({ 'rel_preview: 서버 NOT_FOUND · 앱이 먼저 QUERY_FAILED': '1' }) + total],
    ['깨진 경고 JSON', warning + '{' + total],
    ['비어 있는 경고', warning + '{}' + total],
    ['경고 반복 증가', (warning + JSON.stringify(known) + '\n').repeat(3) + total],
    ['통과 0건', '합계: PASS 0 · FAIL 0'],
    ['실패 1건', '합계: PASS 2309 · FAIL 1'],
    ['요약 없음', 'PASS 일부만 실행'],
  ]) {
    check(name + ': 성공 종료나 성공 요약으로 덮을 수 없음', () => assert.throws(() => inspectReleaseLog('integration', text)))
  }
  check('PR62에서는 다른 묶음의 알려진 경고도 새 경고로 차단', () => {
    assert.throws(() => inspectReleaseLog('pr62', warning + JSON.stringify(known) + '\nPR #62 앱 대조: PASS 53 · FAIL 0'))
  })
  check('실패 snapshot 생략 경고는 보충 시험 근거를 남기고 보충 시험 누락·실패를 허용하지 않음', () => {
    const text = warning + JSON.stringify({ 'rel_preview: 서버 UNAVAILABLE · 앱이 먼저 QUERY_FAILED': 2 }) + total
    const result = inspectReleaseLog('integration', text)
    assert.equal(result.advisories[0].limitations[0].coveredBy, 'relations-path')
    assert.match(result.advisories[0].limitations[0].reason, /ok:false snapshot/)
    const texts = { integration: text, p8: '합계: PASS 322 · FAIL 0', pr62: 'PR #62 앱 대조: PASS 53 · FAIL 0' }
    assert.throws(() => releaseSummary(texts))
    assert.throws(() => releaseSummary({ ...texts, 'relations-path': '합계: PASS 15 · FAIL 4' }))
    assert.equal(releaseSummary({ ...texts, 'relations-path': '합계: PASS 19 · FAIL 0' }).advisoryLines, 1)
  })
  check('CLI도 같은 판정으로 실패 종료하며 원시 오류나 파일 내용을 노출하지 않음', () => {
    const log = join(task, 'failure.log')
    writeFileSync(log, 'WARN do-not-disclose' + total)
    const result = spawnSync(process.execPath, [join(repo, 'scripts/lib/workhub-release-results.mjs'), 'check', 'integration', log], { encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(result.stderr).code, 'UNRECOGNIZED_WARNING')
    assert.doesNotMatch(result.stdout + result.stderr, /do-not-disclose/)
  })
  const branches = { p7With: 'PASS H03 P7-05 정상 실행(승인 근거 입력)', p7Without: 'PASS H00 P7_BRIDGE=0 — 보강 없이 운영 순서만 시험', p8With: { bridge: true, captures: [{}] }, p8Without: { bridge: false, captures: [{}] }, p8StandaloneWith: { bridge: true, captures: [{}] }, p8StandaloneWithout: { bridge: false, captures: [{}] } }
  check('원본 로그와 실제 캡처에서 보강 있음·없음 경로가 모두 실행된 증거를 남김', () => {
    const result = releaseBranches(branches)
    assert.equal(result.p8Integration.withBridge, true)
    assert.equal(result.p8Standalone.withoutBridge, false)
  })
  for (const key of ['p8With', 'p8Without', 'p8StandaloneWith', 'p8StandaloneWithout']) {
    check(`${key}가 반대 분기 또는 빈 캡처면 통과 수와 무관하게 실패`, () => {
      assert.throws(() => releaseBranches({ ...branches, [key]: { bridge: !branches[key].bridge, captures: [{}] } }))
      assert.throws(() => releaseBranches({ ...branches, [key]: { bridge: branches[key].bridge, captures: [] } }))
    })
  }
  check('P7도 보강 없는 경로만 두 번 실행한 결과를 거부', () => assert.throws(() => releaseBranches({ ...branches, p7With: branches.p7Without })))
  console.log(`실행기 안전 회귀 ${passed}건 통과`)
} finally {
  // mkdtemp로 이 시험이 만든 폴더 하나만 정리한다.
  rmSync(task, { recursive: true, force: true })
}
