// 작은 실제 Git 저장소를 망가뜨려 가드가 실패하는지 확인한다. 운영 저장소는 바꾸지 않는다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { verifyIntegrationR2 } from '../scripts/check-workhub-integration-r2.mjs'

const root = mkdtempSync(join(tmpdir(), 'workhub-r2-guard-'))
const git = (args, input) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
  cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'],
}).trim()
const write = (path, text) => { const target = join(root, path); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, text) }
let failures = 0
function test(name, fn) { try { fn(); console.log('  ✓ ' + name) } catch (error) { failures++; console.error('  ✗ ' + name + ': ' + error.message) } }
let inventory
function check(changes = {}) { return verifyIntegrationR2({ root, inventory: { ...structuredClone(inventory), ...changes } }) }
function mutate(path, value, expected) {
  let original
  try { original = readFileSync(join(root, path)) } catch {}
  try { write(path, value); assert.throws(() => check(), expected) }
  finally { if (original === undefined) rmSync(join(root, path)); else writeFileSync(join(root, path), original) }
}
try {
  git(['init', '--quiet'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'user.name', 'Guard fixture'])
  git(['config', 'user.email', 'guard@example.invalid'])
  for (const path of ['packages/shared/auth.js', 'migrations/001.sql', 'apps/main/api/fixed.js',
    'apps/main/src/lib/AuthContext.jsx', 'packages/timetable/src/index.js']) write(path, '// 기준 원문\n')
  write('apps/main/src/lib/modules.js', "export const MODULES = [{ key: 'workhub', visibility: 'superadmin' }]\n")
  write('.github/workflows/test.yml', 'on:\n  pull_request:\njobs: {}\n')
  git(['add', '.']); git(['commit', '--quiet', '-m', '합성 운영 기준'])
  const baseline = git(['rev-parse', 'HEAD'])
  const tree = git(['rev-parse', 'HEAD^{tree}'])
  // HEAD의 조상이 아닌 실제 커밋도 만든다. 누락 검사를 가짜 문자열로만 시험하지 않는다.
  const outside = git(['commit-tree', tree, '-m', '합치지 않은 합성 변경'])
  write('database/workhub/r0/R0.sql', 'SELECT 0;\n')
  write('database/workhub/r1/R1.sql', 'SELECT 1;\n')
  write('database/workhub/r1/README.md', '검토한 실행 순서\n')
  write('apps/main/src/lib/modules.js', "export const MODULES = [{ key: 'workhub', visibility: 'superadmin' }, { key: 'workhub-setup', visibility: 'superadmin' }]\n")
  git(['add', '.']); git(['commit', '--quiet', '-m', '합성 통합 변경'])
  const head = git(['rev-parse', 'HEAD'])
  const production = JSON.parse(readFileSync(new URL('../docs/workhub/integration-r2/pr-inventory.json', import.meta.url), 'utf8'))
  inventory = {
    ...production, baseline_main: baseline,
    included: production.included.map(pr => ({ ...pr, sha: head })),
    preserved: production.preserved.map(pr => ({ ...pr, sha: baseline })),
    deferred: production.deferred.map(pr => ({ ...pr, sha: outside })),
    sql_sources: production.sql_sources.map(source => ({ ...source, sha: head })),
    module_source: { ...production.module_source, sha: head },
  }
  test('실제 통합 이력과 검토 원문은 통과하며 17개·19개 보존을 보고한다', () => {
    const result = check(); assert.equal(result.included.length, 17); assert.equal(result.preserved_count, 19)
    assert.deepEqual(result.sql_sources.map(source => source.files), [1, 2])
  })
  test('목록에 있어도 실제 HEAD 조상에 없는 PR은 거부한다', () => {
    const included = structuredClone(inventory.included); included.find(pr => pr.number === 34).sha = outside
    assert.throws(() => check({ included }), /통합 누락 PR #34/)
  })
  test('이전 1차 통합의 조상이 빠졌으면 거부한다', () => {
    const preserved = structuredClone(inventory.preserved); preserved[0].sha = outside
    assert.throws(() => check({ preserved }), /1차 이력 보존 누락 PR #2/)
  })
  test('보류 커밋이 이력에 포함되면 거부한다', () => {
    const deferred = structuredClone(inventory.deferred); deferred[0].sha = baseline
    assert.throws(() => check({ deferred }), /보류 작업이 합쳐졌습니다: #3/)
  })
  test('운영 기준 자체가 조상이 아니면 거부한다', () => assert.throws(() => check({ baseline_main: outside }), /운영 기준 커밋/))
  test('PR 목록의 누락을 중복 번호로 채워도 거부한다', () => {
    const included = structuredClone(inventory.included); included[0].number = 27
    assert.throws(() => check({ included }), /PR 목록 누락·중복/)
  })
  test('R0 SQL 한 줄 변경을 잡는다', () => mutate('database/workhub/r0/R0.sql', 'SELECT 99;\n', /확정 SQL·문서 원문 변경: #31/))
  test('R1 안내 문서의 변경도 원문 대조로 잡는다', () => mutate('database/workhub/r1/README.md', '잘못 바뀐 안내\n', /확정 SQL·문서 원문 변경: #39/))
  test('스테이징 전 새 R1 SQL 추가도 잡는다', () => mutate('database/workhub/r1/extra.sql', 'SELECT 9;\n', /확정 SQL·문서 원문 변경: #39/))
  test('기존 인증 판정 변경을 잡는다', () => mutate('apps/main/src/lib/AuthContext.jsx', '// 변경\n', /기존 인증·회원·확정 자산 변경/))
  test('미추적 기존 migrations 추가를 잡는다', () => mutate('migrations/999.sql', 'SELECT 9;\n', /기존 인증·회원·확정 자산 변경/))
  test('메뉴 visibility 전체 공개 변경을 잡는다', () => mutate('apps/main/src/lib/modules.js', "export const MODULES = [{ key: 'workhub', visibility: 'all' }]\n", /메뉴 공개 범위·판정/))
  test('기존 시간표 자리 표시 코드를 엔진으로 바꾸면 잡는다', () => mutate('packages/timetable/src/index.js', '// 신규 시간표 엔진\n', /보류한 시간표·운영 자동화 변경/))
  test('보류 시간표 코드를 다른 앱 경로에 넣어도 잡는다', () => mutate('apps/workhub/timetable-engine.js', '// 신규 엔진\n', /새 경로/))
  test('운영 keepalive 워크플로를 이력 없이 추가해도 잡는다', () => mutate('.github/workflows/supabase-keepalive.yml', 'on: {}\n', /보류한 시간표·운영 자동화 변경/))
  test('검사 이외의 새 워크플로를 잡는다', () => mutate('.github/workflows/deploy-worker.yml', 'on: {}\n', /운영 워크플로 변경/))
  test('허용된 검사 워크플로 안에 예약 실행을 끼워도 잡는다', () => mutate('.github/workflows/test.yml', 'on:\n  schedule:\n    - cron: "0 * * * *"\n', /보류 운영 자동 실행 트리거/))
  test('인라인 YAML로 쓴 예약 실행도 거부한다', () => mutate('.github/workflows/test.yml', 'on: {schedule: [{cron: "0 * * * *"}]}\njobs: {}\n', /보류 운영 자동 실행 트리거/))
  test('중복 on 키로 예약 작업을 덧붙여도 거부한다', () => mutate('.github/workflows/test.yml', 'on:\n  pull_request:\non:\n  schedule: []\njobs: {}\n', /자동 실행 트리거/))
  test('SQL 비교 기준을 수집한 PR과 다르게 바꾸면 거부한다', () => {
    const sql_sources = structuredClone(inventory.sql_sources); sql_sources[0].sha = baseline
    assert.throws(() => check({ sql_sources }), /SQL 원문 SHA/)
  })
  test('실제 인덱스에 미해결 병합 단계가 있으면 거부한다', () => {
    const blob = git(['rev-parse', 'HEAD:packages/shared/auth.js'])
    git(['update-index', '--index-info'], `100644 ${blob} 1\tconflict.txt\n100644 ${blob} 2\tconflict.txt\n`)
    try { assert.throws(() => check(), /미해결 병합 충돌/) }
    finally { git(['reset', '--quiet', 'HEAD', '--', 'conflict.txt']) }
  })
  test('얕은 저장소는 포함·제외를 오판하기 전에 거부한다', () => {
    write('.git/shallow', head + '\n')
    try { assert.throws(() => check(), /전체 Git 이력/) }
    finally { rmSync(join(root, '.git/shallow')) }
  })
} finally {
  // 이 시험이 직접 만든 임시 폴더 안에서만 정리한다.
  assert(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('workhub-r2-guard-'))
  rmSync(root, { recursive: true, force: true })
}
if (failures) process.exitCode = 1
