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
// v4 는 유형마다 한도가 다르다 — 라우팅 표 전부가 프롬프트에 적혀야 한다
ck('유형별 한도가 전부 명시된다 (routing 파생)', () => {
  for (const [k, e] of Object.entries(M.routing)) {
    if (k.startsWith('_') || !e.file) continue
    A(P.includes(`- ${k}:`), `한도 표에 ${k} 없음`)
  }
})
ck('한도 초과 요청 시 안내 (없는 예정을 만들지 않는다)', () => {
  A(P.includes('계획 자체를 반대하지 않는다'), '초과 케이스 안내 없음')
  A(P.includes('그대로 진행할까요?'), '교사 선택 문구 없음')
  // 유형별 양식 6종이 학교 최종본이다 — "확장 양식 준비 중" 은 거짓말이다
  A(P.includes('"확장 양식이 준비 중" 이라고 말하지 않는다'), '허위 예정 금지 없음')
  A(!P.includes('확장 양식은 준비 중임'), '옛 문구가 남음')
})
ck('정기시험 횟수는 라우팅 표가 말한다', () => {
  // v4 는 회차 수가 곧 양식이라, 가능한 횟수는 routing 키에 드러난다
  for (const k of ['grade2_exam0', 'grade2_exam1', 'grade2_exam2', 'grade3_exam0', 'grade3_exam1']) {
    A(P.includes(`**${k}**`), `유형 누락: ${k}`)
  }
  A(P.includes('grade × exam_count 로 양식 결정'), '결정 규칙 없음')
})
ck('요소 3개·수준 4단계 명시', () => A(P.includes('최대 3개') && P.includes('4단계'), '요소/수준 한도 없음'))
ck('한도가 token-map 에서 파생 (하드코딩 아님)', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  delete m2.routing.grade2_exam1
  const p2 = mod.buildLimitDoc(m2)
  A(!p2.includes('- grade2_exam1:'), '유형 제거가 반영 안 됨')
  A(p2.includes('- grade2_exam2:'), '남은 유형이 사라짐')
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

console.log('\n[골격 key ↔ 수집 명세]')
// v4 는 '토큰 → 경로' 표가 없다. 어떤 토큰이 어디서 오는지는 _fill.token_value 가 알고,
// 그 둘이 실제로 맞물리는지는 tests/test_v4.py 가 골격에 표식을 넣어 확인한다.
// 여기서는 골격이 수집 명세를 빠짐없이 반영하는지만 본다.
ck('수집 명세의 최상위 key 가 골격에 전부 있다', () => {
  const nodes = ['monthly_plan', 'eval_purpose', 'exam', 'perf_summary', 'achievement_levels',
                 'perf_plans', 'min_achievement_plan', 'essay_total_ratio', 'free_activities']
  for (const n of nodes) {
    const node = M[n]
    if (!node) continue
    const key = node.key || n
    A(key in skel, `골격에 ${key} 없음`)
  }
  for (const f of M.basic_fields) A(f.key in skel, `골격에 ${f.key} 없음`)
})
ck('자유학기 활동은 배열로 비어 있다 (해당 유형에서만 채운다)', () => {
  A(Array.isArray(skel.free_activities) && skel.free_activities.length === 0,
    JSON.stringify(skel.free_activities))
})
ck('배열 개수는 프롬프트 문구가 지시', () => {
  A(P.includes(`최대 ${M.exam.rounds.max}개, count 만큼만 채운다`), '회차 개수 지시 없음')
  A(P.includes('- grade2_exam0: 수행평가 3개'), '유형별 수행 개수 지시 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
