// 2차 통합의 출처와 보호 경계만 읽는다. SQL 실행·배포·외부 접속은 하지 않는다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = 'docs/workhub/integration-r2/pr-inventory.json'
const expectedIncluded = Array.from({ length: 17 }, (_, index) => index + 26)
const expectedPreserved = [2, 4, ...Array.from({ length: 17 }, (_, index) => index + 6)]
const shaPattern = /^[0-9a-f]{40}$/
const splitPaths = text => text.split('\0').filter(Boolean)

export function verifyIntegrationR2({ root = defaultRoot, inventory } = {}) {
  inventory ??= JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'))
  const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).trimEnd()
  assert.equal(inventory.version, 2, '2차 통합 명세가 아닙니다.')
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false', '전체 Git 이력이 필요합니다. fetch-depth: 0으로 가져오세요.')
  assert.equal(git('ls-files', '--unmerged'), '', '미해결 병합 충돌이 있습니다.')
  const ancestry = new Set(git('rev-list', 'HEAD').split('\n'))
  assert.match(inventory.baseline_main, shaPattern)
  assert(ancestry.has(inventory.baseline_main), '운영 기준 커밋이 통합 이력에 없습니다.')
  for (const [key, expected] of [['included', expectedIncluded], ['preserved', expectedPreserved], ['deferred', [3, 5]]]) {
    assert(Array.isArray(inventory[key]), `명세 목록 누락: ${key}`)
    assert.deepEqual(inventory[key].map(pr => pr.number).sort((a, b) => a - b), expected, `PR 목록 누락·중복: ${key}`)
    for (const pr of inventory[key]) {
      assert.match(pr.sha, shaPattern)
      if (key === 'deferred') assert(!ancestry.has(pr.sha), `보류 작업이 합쳐졌습니다: #${pr.number}`)
      else assert(ancestry.has(pr.sha), `${key === 'preserved' ? '1차 이력 보존 누락' : '통합 누락'} PR #${pr.number}`)
    }
  }
  // diff는 스테이징·작업 파일을 함께 검사한다. 미추적 추가 파일도 별도로 막는다.
  function unchanged(reference, paths, message) {
    const changed = splitPaths(git('diff', '--no-ext-diff', '--name-only', '-z', reference, '--', ...paths))
    const added = splitPaths(git('ls-files', '--others', '--exclude-standard', '-z', '--', ...paths))
    assert.deepEqual([...new Set([...changed, ...added])], [], message + ': ' + [...changed, ...added].join(', '))
  }
  assert.deepEqual(inventory.protected_paths, [
    'packages/shared', 'migrations', 'apps/main/api', 'doc-ai-templates-v4',
    'apps/main/public/examples', 'examples', 'apps/main/src/pages/LoginPage.jsx', 'apps/main/src/lib/AuthContext.jsx',
  ], '보호 경계 명세가 변경됐습니다.')
  unchanged(inventory.baseline_main, inventory.protected_paths, '기존 인증·회원·확정 자산 변경')
  assert.deepEqual(inventory.sql_sources.map(source => [source.number, source.path]), [
    [31, 'database/workhub/r0'], [39, 'database/workhub/r1'],
  ], 'R0/R1 원문 대조 대상이 변경됐습니다.')
  const sql = inventory.sql_sources.map(source => {
    assert.equal(source.sha, inventory.included.find(pr => pr.number === source.number)?.sha, 'SQL 원문 SHA가 수집한 PR과 다릅니다.')
    const paths = splitPaths(git('ls-tree', '-r', '--name-only', '-z', source.sha, '--', source.path))
    assert(paths.length > 0 && paths.some(path => path.endsWith('.sql')), `SQL 원문이 없습니다: #${source.number}`)
    unchanged(source.sha, [source.path], `확정 SQL·문서 원문 변경: #${source.number}`)
    return { number: source.number, sha: source.sha, path: source.path, files: paths.length, identical: true }
  })
  const moduleSource = inventory.module_source
  assert.equal(moduleSource.number, 27)
  assert.equal(moduleSource.path, 'apps/main/src/lib/modules.js')
  assert.equal(moduleSource.sha, inventory.included.find(pr => pr.number === 27)?.sha)
  // #27의 학교 설정 메뉴(superadmin)와 기존 판정 함수를 그대로 고정한다.
  // 배열 일부만 정규식으로 읽지 않으므로 helper 변경이나 동적 visibility 우회도 잡는다.
  unchanged(moduleSource.sha, [moduleSource.path], '메뉴 공개 범위·판정이 #27 원문과 다릅니다')
  assert.deepEqual(inventory.deferred_paths, ['packages/timetable', '.github/workflows/supabase-keepalive.yml'])
  unchanged(inventory.baseline_main, inventory.deferred_paths, '보류한 시간표·운영 자동화 변경')
  const changedPaths = [...new Set([
    ...splitPaths(git('diff', '--no-ext-diff', '--name-only', '-z', inventory.baseline_main)),
    ...splitPaths(git('ls-files', '--others', '--exclude-standard', '-z')),
  ])]
  const deferredCode = changedPaths.filter(path => /^(?:apps|packages|workers|scripts)\/.*(?:timetable|keepalive)/i.test(path))
  assert.deepEqual(deferredCode, [], '보류한 시간표·자동화 코드가 새 경로에 포함됐습니다.')
  assert.deepEqual(inventory.allowed_workflow_changes, ['.github/workflows/test.yml'])
  const extraWorkflows = changedPaths.filter(path => path.startsWith('.github/workflows/') && !inventory.allowed_workflow_changes.includes(path))
  assert.deepEqual(extraWorkflows, [], '통합 시험 외의 운영 워크플로 변경이 있습니다.')
  function triggers(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const keys = lines.flatMap((line, index) => /^(?:on|"on"|'on')\s*:/.test(line) ? [index] : [])
    assert.equal(keys.length, 1, '운영 자동 실행 트리거의 on 구문을 확인할 수 없습니다.')
    const start = keys[0]
    const following = lines.findIndex((line, index) => index > start && /^[^\s#]/.test(line))
    return lines.slice(start, following < 0 ? undefined : following).join('\n').trimEnd()
  }
  for (const path of inventory.allowed_workflow_changes) {
    // 예약 작업을 기존 테스트 파일로 옮기거나 YAML의 따옴표·인라인 표기를 써도
    // 통과하지 못하게 운영 기준의 전체 트리거 블록과 비교한다. job 추가는 허용한다.
    const expected = git('show', `${inventory.baseline_main}:${path}`)
    const actual = readFileSync(resolve(root, path), 'utf8')
    assert.equal(triggers(actual), triggers(expected), `보류 운영 자동 실행 트리거 변경: ${path}`)
  }
  return {
    baseline_main: inventory.baseline_main, included: inventory.included.map(pr => ({ number: pr.number, sha: pr.sha, ancestor: true })),
    preserved_count: inventory.preserved.length, deferred: inventory.deferred.map(pr => ({ number: pr.number, ancestor: false })),
    sql_sources: sql, protected_paths: inventory.protected_paths, module_source: moduleSource, changed_files: changedPaths.length,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyIntegrationR2()
    console.log(JSON.stringify(result, null, 2))
    console.log(`2차 통합 ${result.included.length}개 · 1차 ${result.preserved_count}개 보존 · 보류 2개 제외 · R0/R1 원문과 보호 경계 통과`)
  } catch (error) {
    console.error('2차 통합 검사 실패: ' + error.message)
    process.exitCode = 1
  }
}
