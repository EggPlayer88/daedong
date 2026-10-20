// 2026-10-20 승인 묶음: 기존 코드 보존 위에 P9 증분과 로컬 운영 연습만 더한다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd()
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const split = value => value.split('\0').filter(Boolean)
const baseline = '4c4b5830084a613c517484382c24b0e88e9208fe'
const required = ['a9d5956c6e8db846d8c02ed4ec517fbc554721ba', '8adb0219cbfc54a52b14178c171860b52209887a']
const sqlFiles = [
  'P9-01_교사연결_모델과함수.sql', 'P9-02_담당교사후보_분리.sql',
  'P9-03_교사연결_승인양식.sql', 'P9-04_사후점검.sql', 'P9-05_통합사후점검.sql',
  'P9_원안_출처PR75.md', 'README.md', 'test/gen_p9_05.py', 'test/run_p9.py',
].map(path => 'database/workhub-school-data/p9/' + path)
try {
  const ancestors = new Set(git('rev-list', 'HEAD').split('\n'))
  for (const sha of [baseline, ...required]) assert(ancestors.has(sha), `필수 이력 누락: ${sha}`)
  assert.equal(git('ls-files', '--unmerged'), '')
  const changed = [...new Set([...split(git('diff', '--name-only', '-z', baseline)), ...split(git('ls-files', '--others', '--exclude-standard', '-z'))])]
  const existing = new Set(split(git('ls-tree', '-r', '--name-only', '-z', baseline)))
  const protectedPath = /^(?:database\/|migrations\/|packages\/shared\/|apps\/main\/api\/|workers\/|docs\/workhub\/release-candidate\/|scripts\/(?:verify-workhub-release-sql\.sh|check-workhub-release\.mjs)$|apps\/main\/src\/(?:lib\/(?:modules\.js|AuthContext\.jsx)|pages\/LoginPage\.jsx)$)/
  for (const path of changed.filter(path => protectedPath.test(path))) {
    assert(sqlFiles.includes(path) && !existing.has(path), `승인 밖 또는 기존 확정 파일 변경: ${path}`)
  }
  assert.deepEqual(changed.filter(path => path.startsWith('.github/workflows/') && path !== '.github/workflows/test.yml'), [])
  const modules = [...read('apps/workhub/src/modules.ts').matchAll(/\{ id: '[^']+'[^\n]+/g)]
  assert.equal(modules.length, 12)
  assert(modules.every(row => row[0].includes("visibility: 'superadmin'") && row[0].includes('productionEnabled: false')))
  const deferred = JSON.parse(read('docs/workhub/integration-r2/pr-inventory.json')).deferred.concat(JSON.parse(read('docs/workhub/pilot-completion/inventory.json')).excluded)
  for (const row of deferred) assert(!ancestors.has(row.sha), `보류 이력 포함: #${row.number}`)
  console.log(JSON.stringify({ included: [72, 74], newSql: 'P9 별도 증분만 허용', historicalSqlPreserved: true, authAndVisibilityPreserved: true, dbApplied: false, changedPaths: changed.length }, null, 2))
} catch (error) {
  console.error('학교·시간표 운영 묶음 보호 검사 실패:', error.message)
  process.exitCode = 1
}
