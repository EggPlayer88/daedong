#!/usr/bin/env node
// prefill 폴더 → 교과·학년 목록(prefill-catalog.json).
//
// 제출 현황 매트릭스가 "무엇이 제출돼야 하는지" 를 알려면 교과 목록이 필요하다.
// 그 목록의 근거는 prefill 색인이다 — 학교가 실제로 내는 과목이 거기 있다.
// 브라우저가 35개 팩(552KB)을 다 읽을 이유는 없으므로 여기서 뽑아 둔다.
//
// 실행: node scripts/build-prefill-catalog.mjs   (tests/test_submissions.mjs 가 대조한다)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'apps/main/api/doc-ai/_assets/prefill')
const OUT = join(ROOT, 'apps/main/api/doc-ai/_assets/prefill-catalog.json')

export function buildCatalog(dir = DIR) {
  const seen = new Map()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let d
    try {
      d = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
    } catch {
      continue
    }
    const subject = String(d?.subject || '').trim()
    const grade = Number.parseInt(d?.grade, 10)
    if (!subject || !Number.isInteger(grade)) continue
    seen.set(`${grade}|${subject}`, { subject, grade })
  }
  return [...seen.values()].sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject, 'ko'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const catalog = buildCatalog()
  writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8')
  console.log(`${catalog.length}건 → ${OUT}`)
}
