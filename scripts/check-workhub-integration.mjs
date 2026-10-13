// 통합 이력과 보호 경계만 검사한다. DB/외부 서비스에는 접속하지 않는다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const inventory = JSON.parse(readFileSync(new URL('../docs/workhub/integration/pr-inventory.json', import.meta.url), 'utf8'))
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false', '전체 Git 이력이 필요합니다. fetch-depth: 0으로 가져오세요.')
// 보류 브랜치 객체가 삭제되어도 HEAD의 전체 조상 목록으로 포함 여부를 판정한다.
const ancestry = new Set(git('rev-list', 'HEAD').split('\n'))
const ancestor = sha => ancestry.has(sha)
assert.match(inventory.baseline_main, /^[0-9a-f]{40}$/)
assert(ancestor(inventory.baseline_main), '운영 기준 커밋이 통합 이력에 없습니다.')
const numbers = new Set()
for (const pr of inventory.included) {
  assert(!numbers.has(pr.number), '중복 PR: ' + pr.number)
  numbers.add(pr.number)
  assert.match(pr.sha, /^[0-9a-f]{40}$/)
  assert(ancestor(pr.sha), '통합 누락 PR #' + pr.number)
}
for (const pr of inventory.deferred) {
  assert(!numbers.has(pr.number), '보류/포함 중복 PR')
  assert(!ancestor(pr.sha), '보류 작업이 합쳐졌습니다: #' + pr.number)
}
// 이 통합 단계에서 기존 인증·회원·운영 문서 엔진·확정 SQL은 변경하지 않는다.
// AuthContext의 기존 PR 안내 문구 변경은 보존하며 별도 권한 판정을 추가하지 않는다.
const protectedPaths = [
  'packages/shared', 'migrations', 'apps/main/api', 'doc-ai-templates-v4',
  'apps/main/public/examples', 'examples', 'apps/main/src/pages/LoginPage.jsx',
]
const changed = git('diff', '--name-only', inventory.baseline_main, '--', ...protectedPaths)
assert.equal(changed, '', '보호 범위 변경:\n' + changed)
const source = inventory.included.find(pr => pr.number === 21)
assert(source, '사이트 기준 PR 누락')
assert.equal(git('diff', '--name-only', source.sha, '--', 'database/workhub'), '', '통합 과정에서 기존 SQL 제안이 변경됐습니다.')
assert.equal(git('ls-files', '--unmerged'), '', '미해결 병합 충돌')
console.log('통합 PR ' + numbers.size + '개 이력 포함 · 보류 ' + inventory.deferred.length + '개 제외 · 보호 경계 통과')
