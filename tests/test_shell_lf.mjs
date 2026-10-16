// 셸 스크립트 줄바꿈 — Windows 체크아웃(core.autocrlf)에서도 LF 로 남아야 bash 가 돈다.
// CRLF 면 `set -euo pipefail` 이 "pipefail\r" 로 멈춘다(R1S 시험을 Windows 사본에서 돌렸을 때 실제로 난 오류).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

const shells = execFileSync('git', ['ls-files', '-z', '*.sh'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
ck('.gitattributes 가 *.sh 를 LF 로 고정', () => {
  const out = execFileSync('git', ['check-attr', 'eol', '--', ...shells], { cwd: ROOT, encoding: 'utf8' })
  const bad = out.trim().split('\n').filter((l) => !l.endsWith(': eol: lf'))
  A(shells.length > 0, '셸 스크립트를 찾지 못함')
  A(bad.length === 0, bad.join(', '))
})
ck('작업 사본의 셸 스크립트에 CR 이 없음', () => {
  const bad = shells.filter((f) => readFileSync(join(ROOT, f)).includes(13))
  A(bad.length === 0, bad.join(', '))
})
process.exit(fail ? 1 : 0)
