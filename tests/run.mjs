#!/usr/bin/env node
// tests/run.mjs — 전체 검증 실행기.  `npm test` 로 호출한다.
//
// JS 테스트는 node 로, Python 테스트는 lxml 이 있는 인터프리터로 돌린다.
// Python 인터프리터 탐색 순서: $PYTHON → tests/.venv → .venv → python3
// (lxml 이 없으면 Python 몫은 건너뛰고 그 사실을 분명히 보고한다 — 조용히 통과시키지 않는다)

import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const only = process.argv[2] // 부분 문자열로 필터 (예: npm test -- hours)

function findPython() {
  const candidates = [
    process.env.PYTHON,
    join(HERE, '.venv', 'bin', 'python'),
    join(HERE, '..', '.venv', 'bin', 'python'),
    'python3',
  ].filter(Boolean)
  for (const py of candidates) {
    if (py.includes('/') && !existsSync(py)) continue
    const r = spawnSync(py, ['-c', 'import lxml.etree'], { stdio: 'ignore' })
    if (r.status === 0) return py
  }
  return null
}

const python = findPython()
const files = readdirSync(HERE)
  .filter((f) => /^test_.*\.(mjs|py)$/.test(f))
  .filter((f) => !only || f.includes(only))
  .sort()

let pass = 0
let fail = 0
let skipped = []
const failed = []

for (const f of files) {
  const isPy = f.endsWith('.py')
  if (isPy && !python) {
    skipped.push(f)
    continue
  }
  const cmd = isPy ? python : process.execPath
  const r = spawnSync(cmd, [join(HERE, f)], { encoding: 'utf-8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const n = (out.match(/^ {2}✓/gm) || []).length
  if (r.status === 0) {
    pass += n
    console.log(`  ✓ ${f} (${n})`)
  } else {
    fail += 1
    failed.push(f)
    console.log(`  ✗ ${f}`)
    for (const line of out.split('\n').filter((l) => l.startsWith('  ✗'))) {
      console.log(`      ${line.trim()}`)
    }
    if (!out.includes('✗')) console.log(out.trim().split('\n').slice(-6).join('\n'))
  }
}

console.log()
if (skipped.length) {
  console.log(
    `⚠ Python 테스트 ${skipped.length}건을 건너뛰었습니다 (lxml 이 있는 인터프리터를 못 찾음).\n` +
      `  설치: python3 -m venv tests/.venv && tests/.venv/bin/pip install lxml\n` +
      `  건너뛴 파일: ${skipped.join(', ')}`
  )
}
if (fail) {
  console.log(`실패 ${fail}개 파일: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`전부 통과 — ${pass}건${skipped.length ? ` (Python ${skipped.length}파일 건너뜀)` : ''}`)
