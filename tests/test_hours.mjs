// 프롬프트 + 카드 판정이 서버(apply_fixed_hours)와 같은지
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`
const mod = await import(`${API}/chat.js`)
const { SYSTEM_PROMPT: P, constants: C, fixedHours: T, manifest: M } = mod
let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }
const row = T.variants[T.default_variant]

console.log('\n[프롬프트 — 계산 금지 + 값 안내]')
ck('고정표 절이 존재하고 계산을 금지', () => {
  A(P.includes('자동 입력 (직접 계산하지 말 것)'), '제목 없음')
  A(P.includes('네가 계산하거나 제안하지 않는다'), '금지 문구 없음')
})
ck('주당 1~5 실제 값이 예시로 들어감', () => {
  for (const k of ['1','2','3','4','5']) {
    A(P.includes(`주당 ${k}시간 → ${row[k].months.join(', ')}`), `주당 ${k} 예시 없음`)
  }
  A(P.includes('주당 4시간 → 8/8, 16/24, 16/40, 16/56, 16/72'), '지시서 예시와 불일치')
})
ck('weekly_hours 하나만 받으면 된다고 안내', () => A(P.includes('주당 시수(weekly_hours)') && P.includes('하나뿐'), '안내 없음'))
ck('hours_manual 사용법', () => {
  A(P.includes('"hours_manual": true'), 'manual 키 안내 없음')
  A(P.includes('고정표 값으로 덮어쓰인다'), '덮어쓰기 사실 미고지')
})
ck('weekly_hours 는 필수 수집 항목', () => {
  const f = M.basic_fields.find(x => x.key === 'weekly_hours')
  A(f?.required === true, 'manifest 에서 필수가 아님')
  A(P.includes('주당 시수 — weekly_hours (숫자, 필수)'), '프롬프트에 필수 표기 없음')
})
ck('골격에 hours_manual 포함', () => {
  const skel = JSON.parse(P.split('===PLAN_READY===')[1].split('===END===')[0])
  A(skel.hours_manual === false, JSON.stringify(skel.hours_manual))
})

console.log('\n[상충 정리 — 옛 시수 공식이 프롬프트에 남지 않아야]')
ck('hours_calculation_rule 의 공식/예시가 제거됨', () => {
  A(!P.includes('반올림(월별 수업일수 × 주당시수 ÷ 5)'), '옛 공식이 남음')
  A(!P.includes('16/25'), `고정표와 다른 옛 예시(16/25)가 남음`)
  A(!P.includes('example_weekly4'), '옛 예시 키가 남음')
})
ck('대체 문구가 들어감', () => {
  A(P.includes('_replaced'), '대체 표시 없음')
  A(P.includes('AI 는 시수를 계산하지 않는다'), '대체 문구 없음')
})
ck('원본 상수 파일은 그대로 (메모리에서만 대체)', () => {
  A(C.hours_calculation_rule.formula.includes('반올림'), '원본이 변형됨')
  A(!('_replaced' in C.hours_calculation_rule), '원본 오염')
})
ck('고정표가 없으면 옛 규칙이 그대로 (하위호환)', () => {
  const p2 = mod.buildSystemPrompt(M, C, undefined, null)
  A(p2.includes('반올림(월별 수업일수'), '고정표 없을 때 규칙이 사라짐')
  A(!p2.includes('자동 입력 (직접 계산하지 말 것)'), '고정표 없는데 절이 들어감')
})
ck('고정표 변경 시 프롬프트도 바뀜 (하드코딩 아님)', () => {
  const t2 = JSON.parse(JSON.stringify(T))
  t2.variants.common['4'].months = ['1/1','2/3','3/6','4/10','5/15']
  const p2 = mod.buildSystemPrompt(M, C, undefined, t2)
  A(p2.includes('주당 4시간 → 1/1, 2/3, 3/6, 4/10, 5/15'), '표 변경 미반영')
})

console.log('\n[카드 ↔ 서버 판정 일치]')
// PlanCard 의 resolveHours 와 같은 규칙을 재현해 대조
const resolve = (plan) => {
  if (plan?.hours_manual === true) return 'manual'
  const n = Number(plan?.weekly_hours)
  const r = Number.isInteger(n) && n > 0 ? T.variants[T.default_variant]?.[String(n)] : null
  return r?.months ? 'fixed' : 'out_of_range'
}
ck('주당 4 → fixed / manual → manual / 6 → out_of_range', () => {
  A(resolve({ weekly_hours: 4 }) === 'fixed', 'fixed 아님')
  A(resolve({ weekly_hours: 4, hours_manual: true }) === 'manual', 'manual 아님')
  A(resolve({ weekly_hours: 6 }) === 'out_of_range', 'out_of_range 아님')
  A(resolve({}) === 'out_of_range', '미입력 처리 아님')
})
console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
