// 프롬프트 ↔ 확인 카드 ↔ generate 가 같은 계약(manifest FINAL)을 보는지
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`
const mod = await import(`${API}/chat.js`)
const { SYSTEM_PROMPT: P, manifest: M } = mod
let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

console.log('\n[프롬프트 — 양식 한도]')
const CAP = Math.min(M.limits.perf_areas_max, M.limits.perf_plans_max)
ck('양식 한도 명시 (manifest.limits 파생)', () =>
  A(P.includes(`수행평가는 최대 ${CAP}개까지만`), '한도 문구 없음'))
ck('한도 초과 요청 시 안내 (없는 예정을 만들지 않는다)', () => {
  A(P.includes(`${CAP + 1}회 이상 하겠다고 하면`), '초과 케이스 안내 없음')
  A(P.includes('그대로 진행할까요?'), '교사 선택 문구 없음')
  // v3 마스터가 학교 공용 최종본이다 — "확장 양식 준비 중" 은 이제 거짓말이다
  A(P.includes('"확장 양식이 준비 중" 이라고 말하지 않는다'), '허위 예정 금지 없음')
  A(!P.includes('확장 양식은 준비 중임'), '옛 문구가 남음')
})
ck('정기시험 횟수 0/1/2 명시', () => A(P.includes('0 / 1 / 2 회만 가능'), '횟수 한도 없음'))
ck('요소 3개·수준 4단계 명시', () => A(P.includes('최대 3개') && P.includes('4단계'), '요소/수준 한도 없음'))
ck('manifest.limits 에서 파생 (하드코딩 아님)', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  m2.limits.perf_areas_max = 4; m2.limits.perf_plans_max = 4
  const p2 = mod.buildSystemPrompt(m2)
  A(p2.includes('수행평가는 최대 4개까지만'), '한도 변경 미반영')
  A(p2.includes('5회 이상 하겠다고 하면'), '안내 문구 미갱신')
  A(p2.includes('4개를 넘기는 확장 계획은 없다'), '한도 문장 미갱신')
})

console.log('\n[프롬프트 — elements 3그룹×4수준]')
ck('elements 구조 설명', () => {
  A(P.includes('최대 3개 요소'), '요소 개수 없음')
  A(P.includes('levels 배열에 4단계'), '수준 설명 없음')
  A(P.includes('"levels": [{ "desc"'), '형태 예시 없음')
})
const skel = JSON.parse(P.split('===PLAN_READY===')[1].split('===END===')[0])
ck('골격의 elements 가 name+levels 중첩', () => {
  const e = skel.perf_plans[0].elements[0]
  A('name' in e, 'name 없음')
  A(Array.isArray(e.levels) && e.levels.length === 4, `levels: ${JSON.stringify(e.levels)}`)
  A('desc' in e.levels[0] && 'points' in e.levels[0], JSON.stringify(e.levels[0]))
})
ck('exam.rounds 에 essay_ratio 포함', () => A('essay_ratio' in skel.exam.rounds[0], JSON.stringify(skel.exam.rounds[0])))

console.log('\n[골격 key ↔ generate 가 읽는 경로]')
// 골격은 배열마다 샘플 1개만 보여준다 (개수는 프롬프트 문구가 지시) → [n] 은 [0] 으로 정규화
const paths = Object.entries(M.token_paths)
  .filter(([k]) => k.startsWith('{{'))
  .map(([, v]) => v)
const norm = p => p.replace(/\[\d+\]/g, '[0]')
const derived = ['exam.ratio_display','perf.ratio_display','perf.essay_ratio_display','perf.standards_combined','computed.points_sum','essay_total_ratio_display']
const get = (o, p) => {
  let cur = o
  for (const part of p.split('.')) {
    const m = part.match(/^([A-Za-z_]\w*)((?:\[\d+\])*)$/); if (!m) return undefined
    cur = cur?.[m[1]]
    for (const i of (m[2].match(/\d+/g) || [])) cur = cur?.[Number(i)]
  }
  return cur
}
ck('direct_tokens 경로가 전부 골격에 존재하거나 파생값', () => {
  const missing = paths.filter(p => !derived.includes(p) && get(skel, norm(p)) === undefined)
  A(missing.length === 0, `골격에 없는 경로: ${missing.join(', ')}`)
})
console.log(`     (direct_tokens 경로 ${paths.length}개 중 파생 ${derived.length}개는 코드가 계산)`)
ck('배열 개수는 프롬프트 문구가 지시', () => {
  A(P.includes(`최대 ${M.exam.rounds.max}개, count 만큼만 채운다`), '회차 개수 지시 없음')
  A(P.includes(`${M.perf_summary.min}~${M.perf_summary.max}개 배열`), '수행 개수 지시 없음')
})
console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
