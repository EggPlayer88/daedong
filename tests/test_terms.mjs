// 용어·명칭 가드 — 새 자산이 들어와도 옛 용어가 되살아나지 않게 고정
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const API = `${ROOT}/apps/main/api/doc-ai`
const mod = await import(`${API}/chat.js`)
const P = mod.SYSTEM_PROMPT
let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }
const BANNED = ['정기고사', '지필고사', '1회고사', '2회고사']

console.log('\n[사이트 명칭]')
const SITE = '대동여중 업무혁신시스템'
for (const f of ['apps/main/index.html', 'apps/main/src/components/Layout.jsx',
                 'apps/main/src/pages/LoginPage.jsx', 'package.json', 'apps/main/package.json']) {
  ck(f, () => {
    const s = readFileSync(join(ROOT, f), 'utf-8')
    A(s.includes(SITE), '새 명칭 없음')
    A(!s.includes('대동고'), '옛 명칭 잔존')
  })
}

console.log('\n[용어 — 자산 파일]')
for (const f of readdirSync(`${API}/_assets`)) {
  if (!/\.(json|md)$/.test(f)) continue
  ck(`_assets/${f}`, () => {
    const s = readFileSync(join(API, '_assets', f), 'utf-8')
    for (const b of BANNED) A(!s.includes(b), `'${b}' 잔존`)
  })
}

console.log('\n[용어 — 시스템 프롬프트]')
ck('옛 용어 0', () => { for (const b of BANNED) A(!P.includes(b), `'${b}' 잔존`) })
ck('새 용어 사용', () => {
  A(P.includes('1회 정기시험'), '1회 정기시험 없음')
  A(P.includes('2회 정기시험'), '2회 정기시험 없음')
})
ck('학사일정 라벨도 교체됨', () => {
  const C = mod.constants
  const labels = Object.values(C.exam_schedule).flatMap(g => (g.rounds || []).map(r => r.label))
  A(labels.length > 0, '라벨 없음')
  for (const l of labels) for (const b of BANNED) A(!l.includes(b), `라벨 '${l}'`)
  A(labels.includes('1회 정기시험') && labels.includes('2회 정기시험'), labels.join(','))
})

console.log('\n[조립 문장]')
const M = mod.manifest
ck('EXAM_INTRO(2회) 문구 교체', () => {
  const s = M.composition_rules.EXAM_INTRO['2']
  for (const b of BANNED) A(!s.includes(b), `'${b}' 잔존`)
  A(s.includes('1회 정기시험과 2회 정기시험'), s)
})
ck('EXAM_INTRO/RATIO 전부 옛 용어 0', () => {
  for (const s of [...Object.values(M.composition_rules.EXAM_INTRO), ...Object.values(M.composition_rules.EXAM_RATIO_SENT)]) {
    if (typeof s !== 'string') continue
    for (const b of BANNED) A(!s.includes(b), `'${b}' in ${s.slice(0, 30)}`)
  }
})
ck('회차명 수집 라벨 교체', () => {
  const f = M.exam.rounds.item_fields.find(x => x.key === 'label')
  A(!f.label.includes('1차/2차'), f.label)
  A(f.label.includes('1회 정기시험'), f.label)
})
ck('배치본 계약 == doc-ai-templates-v4 FINAL', () => {
  const F = JSON.parse(readFileSync(`${ROOT}/doc-ai-templates-v4/template-manifest.v4.final.json`, 'utf-8'))
  for (const k of ['routing', 'composition_rules', 'unused_handling', 'fixed_texts',
                   'token_families', 'final_check', 'filename_pattern']) {
    A(JSON.stringify(M[k]) === JSON.stringify(F[k]), `${k} 불일치`)
  }
})
console.log('\n[정기시험 3분류 명칭]')
// 학교 확정 표기는 '단답형·완성형' 하나뿐이다. 비슷한 변형이 섞이면
// 교사가 서로 다른 항목으로 읽는다.
const CAT_BAD = ['단답형/완성형', '단답·완성형', '단답형완성형', '단답형 완성형', '완성형·단답형']
ck('manifest 분류 명칭이 확정 표기', () => {
  const cats = M.exam.method_categories
  A(Array.isArray(cats) && cats.length === 3, '3분류가 아님')
  A(cats.map(c => c.key).join(',') === 'mc,short,essay', cats.map(c => c.key).join(','))
  const short = cats.find(c => c.key === 'short')
  A(short.label === '단답형·완성형(주관식)', short.label)
  A(short.short_label === '단답형·완성형', short.short_label)
  A(short.essay_countable === false, 'short 가 서·논술형 산입으로 잡힘')
  A(cats.filter(c => c.essay_countable).map(c => c.key).join(',') === 'essay', '산입 대상이 essay 하나가 아님')
})
ck('프롬프트·라벨에 변형 표기가 없다', () => {
  const texts = [P, ...M.exam.rounds.item_fields.map(f => f.label)]
  for (const t of texts) for (const b of CAT_BAD) A(!t.includes(b), `'${b}' 사용됨`)
})
ck('서버 안내문도 확정 표기', () => {
  A(mod.buildExamMethodDoc().includes('단답형·완성형(주관식)'), '3분류 안내 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
