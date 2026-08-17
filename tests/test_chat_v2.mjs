// chat.js v2 — 프롬프트 조립(고정부 + 상수 + manifest v2) 검증
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`
const mod = await import(`${API}/chat.js`)
const { SYSTEM_PROMPT: P, manifest: M, constants: C } = mod

let fail = 0
const check = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

console.log('\n[1] 고정부(prompt-rules.v2.md) 반영')
check('머리말은 잘리고 본문만 들어감', () => {
  assert(!P.includes('chat.js 의 buildSystemPrompt()'), '머리말 설명이 프롬프트에 섞임')
  assert(P.startsWith('너는 대동여자중학교'), P.slice(0, 40))
})
check('제1원칙 + 성취기준 원문 대조 규칙', () => {
  assert(P.includes('제1원칙'), '제1원칙 누락')
  assert(P.includes('원문 대조 확인 필요'), '성취기준 경고 누락')
  assert(P.includes('추정으로 채우지 않는다'), '추정 금지 누락')
})
check('대화 진행 순서 8단계 전부', () => {
  for (const s of ['기본 정보', '참고 자료 요청', '교수·학습 계획', '평가 계획 뼈대',
                   '평가 목적', '학기 단위 성취수준', '수행평가 출제 계획',
                   '최소 성취수준 미도달']) {
    assert(P.includes(s), `단계 누락: ${s}`)
  }
})
check('참고자료 블록 형식이 프롬프트에 있음 (extract 연동)', () => {
  assert(P.includes('[참고자료:'), '참고자료 블록 안내 누락')
})

console.log('\n[2] {{CONSTANTS}} 주입')
check('자리표시가 남아있지 않음', () => assert(!P.includes('{{CONSTANTS}}'), '미주입'))
check('학사일정 실제 값이 들어감', () => {
  assert(P.includes('2026-09-29'), '2학년 1회고사 일정 누락')
  assert(P.includes('total_class_days'), '수업일수 누락')
  assert(P.includes('11/6 개교기념일'), '월별 note 누락')
})
check('규칙 상수(시수 공식·서논술 30%·수행 횟수)', () => {
  assert(P.includes('hours_calculation_rule'), '시수 규칙 누락')
  assert(P.includes('essay_ratio_rule'), '서논술 규칙 누락')
  assert(P.includes('perf_count_rule'), '수행 횟수 규칙 누락')
})
check('TBD 는 TBD 그대로 (임의로 채우지 않음)', () => {
  assert(P.includes('TBD'), 'TBD 가 사라짐 — pending 항목이 채워진 것처럼 보이면 위험')
})
check('학년별 교육과정 매핑', () => {
  assert(P.includes('2022 개정') && P.includes('2015 개정'), '교육과정 매핑 누락')
})

console.log('\n[3] manifest v2 → 수집 항목 문서')
check('기본 필드 6개 label+key', () => {
  for (const f of M.basic_fields) {
    assert(P.includes(f.label), `label 누락: ${f.label}`)
    assert(P.includes(`— ${f.key}`) || P.includes(`key: ${f.key}`), `key 누락: ${f.key}`)
  }
})
check('monthly_plan 5행 + 월 목록', () => {
  assert(P.includes('5행 고정'), '행 수 누락')
  for (const m of M.monthly_plan.months) assert(P.includes(m), `월 누락: ${m}`)
  for (const rf of M.monthly_plan.row_fields) assert(P.includes(rf.label), `행 필드 누락: ${rf.label}`)
})
check('exam.rounds 중첩 구조', () => {
  assert(P.includes('rounds'), 'rounds 누락')
  for (const f of M.exam.rounds.item_fields) assert(P.includes(f.label), `회차 필드 누락: ${f.label}`)
})
check('perf_summary 의 key 는 perf_areas (property 이름 아님)', () => {
  assert(P.includes('key: perf_areas'), 'perf_areas key 누락')
  assert(!P.includes('key: perf_summary'), 'property 이름을 key 로 잘못 씀')
  assert(P.includes(`${M.perf_summary.min}~${M.perf_summary.max}개`), '개수 범위 누락')
})
check('perf_plans 평가방법 선택지 10종', () => {
  const methods = M.perf_plans.item_fields.find((f) => f.key === 'methods')
  for (const o of methods.options) assert(P.includes(o), `선택지 누락: ${o}`)
})
check('achievement_levels A~E', () => {
  assert(P.includes('A/B/C/D/E'), '성취수준 레벨 누락')
})

console.log('\n[4] 출력 JSON 골격')
const body = P.split('===PLAN_READY===')[1].split('===END===')[0]
const skel = JSON.parse(body)
check('자리표시 문구가 실제 JSON 으로 대체됨', () => {
  assert(!P.includes('manifest 의 key 구조를 그대로 따르는 JSON'), '자리표시 잔존')
})
check('최상위 key 전부', () => {
  for (const k of ['year', 'semester', 'grade', 'subject', 'teacher_name', 'weekly_hours',
                   'monthly_plan', 'eval_purpose', 'exam', 'perf_areas',
                   'essay_total_ratio', 'achievement_levels', 'perf_plans',
                   'min_achievement_plan']) {
    assert(k in skel, `골격에 ${k} 없음`)
  }
})
check('monthly_plan 은 5행 + month 값이 채워짐', () => {
  assert(skel.monthly_plan.length === 5, `행 수 ${skel.monthly_plan.length}`)
  assert(skel.monthly_plan[0].month === '8월', skel.monthly_plan[0].month)
  assert('hours_cum' in skel.monthly_plan[0], 'hours_cum 없음')
})
check('eval_purpose 는 문자열 3개', () => {
  assert(Array.isArray(skel.eval_purpose) && skel.eval_purpose.length === 3, JSON.stringify(skel.eval_purpose))
})
check('exam 은 객체 + rounds 배열', () => {
  assert(typeof skel.exam === 'object' && !Array.isArray(skel.exam), 'exam 이 객체가 아님')
  assert(Array.isArray(skel.exam.rounds), 'rounds 가 배열이 아님')
  assert('mc' in skel.exam.rounds[0] && 'essay' in skel.exam.rounds[0], '회차 필드 누락')
})
check('achievement_levels 는 A~E 객체', () => {
  assert(Object.keys(skel.achievement_levels).join('') === 'ABCDE', JSON.stringify(skel.achievement_levels))
})
check('perf_plans[0].methods 는 배열, elements 는 3그룹×4수준 중첩 (FINAL 구조)', () => {
  const p = skel.perf_plans[0]
  assert(Array.isArray(p.methods), 'methods 가 배열이 아님')
  const e = p.elements[0]
  assert('name' in e, 'elements[0].name 없음')
  assert(Array.isArray(e.levels) && e.levels.length === 4, JSON.stringify(e.levels))
  assert('desc' in e.levels[0] && 'points' in e.levels[0], JSON.stringify(e.levels[0]))
})

console.log('\n[5] 하드코딩 아님 — manifest/상수를 바꾸면 프롬프트도 바뀜')
check('manifest 변경 반영', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  m2.perf_summary.max = 9
  m2.basic_fields.push({ key: 'zzz', label: '테스트항목', type: 'text' })
  const p2 = mod.buildSystemPrompt(m2, C)
  assert(p2.includes('1~9개'), 'max 변경 미반영')
  assert(p2.includes('테스트항목'), '새 필드 미반영')
  assert(!P.includes('테스트항목'), '원본 오염')
})
check('상수 변경 반영', () => {
  const c2 = JSON.parse(JSON.stringify(C))
  c2.total_class_days = 999
  const p2 = mod.buildSystemPrompt(M, c2)
  assert(p2.includes('999'), '상수 변경 미반영')
})

console.log('\n[6] 프롬프트 규모')
check('시스템 프롬프트가 캐시 최소 단위(1024토큰≈2000자)를 넘음', () => {
  assert(P.length > 4000, `길이 ${P.length}자 — 프롬프트 캐싱이 안 걸릴 수 있음`)
})
console.log(`     (시스템 프롬프트 ${P.length.toLocaleString()}자, 대략 ${Math.round(P.length / 2.2).toLocaleString()} 토큰)`)

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
