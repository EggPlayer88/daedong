// 배포용 예시 파일 (examples/) — 교사가 대화 전에 완성 모습을 본다.
//
// 지키는 것:
//   · 원본과 배포본이 같은 파일 (수정 금지 확정본)
//   · 화면 링크와 실제 파일이 어긋나지 않는다 (링크는 있는데 파일이 없으면 404)
//   · 학년 표기가 함께 나온다
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'examples')
const PUB = join(ROOT, 'apps/main/public/examples')
const PAGE = readFileSync(join(ROOT, 'apps/main/src/pages/DocAiPage.jsx'), 'utf-8')

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

const files = readdirSync(SRC).filter((f) => f.endsWith('.hwpx')).sort()

console.log('\n[배치 — 원본과 같은 파일]')
ck('예시 3종이 있다', () => A(files.length === 3, `${files.length}건: ${files}`))
ck('배포본이 원본과 동일 (수정 금지)', () => {
  for (const f of files) A(sha(join(SRC, f)) === sha(join(PUB, f)), `${f} 가 다르다`)
})
ck('배포 폴더에 군더더기가 없다', () => {
  const pub = readdirSync(PUB).sort()
  A(JSON.stringify(pub) === JSON.stringify(files), `${pub} != ${files}`)
})

console.log('\n[화면 링크 ↔ 실제 파일]')
// EXAMPLES 배열의 file 값만 뽑는다
const linked = [...PAGE.matchAll(/file:\s*'([^']+\.hwpx)'/g)].map((m) => m[1])
ck('링크한 파일이 전부 실제로 있다', () => {
  A(linked.length === 3, `링크 ${linked.length}개`)
  for (const f of linked) A(files.includes(f), `없는 파일을 링크함: ${f}`)
})
ck('있는 파일이 전부 링크돼 있다', () => {
  for (const f of files) A(linked.includes(f), `링크 안 된 예시: ${f}`)
})
ck('학년 표기가 함께 나온다', () => {
  for (const g of [1, 2, 3]) A(PAGE.includes(`grade: ${g}`), `${g}학년 항목 없음`)
  A(PAGE.includes("label: '1학년 (자유학기)'"), '자유학기 표기 없음')
})
ck('파일명이 URL 로 안전하게 나간다 (한글)', () => {
  A(PAGE.includes('encodeURIComponent(e.file)'), '인코딩 없음')
  A(PAGE.includes('download={e.file}'), 'download 속성 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
