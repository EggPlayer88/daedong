import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { splitPlan } = await import(`${ROOT}/apps/main/src/lib/planMarker.js`)

let fail = 0
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

const PLAN = { year: 2026, semester: 2, subject: '과학', perf_areas: [{ name: '실험' }] }
const J = JSON.stringify(PLAN, null, 2)

console.log('\nPLAN_READY 마커 파서')

check('마커 없는 일반 대화', () => {
  const r = splitPlan('교과가 무엇인가요?')
  assert(r.json === null, 'json 이 나옴')
  assert(r.text === '교과가 무엇인가요?', r.text)
})

check('마커만 있는 정상 응답', () => {
  const r = splitPlan(`===PLAN_READY===\n${J}\n===END===`)
  assert(r.json?.subject === '과학', JSON.stringify(r))
  assert(r.text === '', `앞 텍스트: ${r.text}`)
})

check('앞에 설명이 붙은 응답 — 설명은 채팅으로', () => {
  const r = splitPlan(`확정했습니다.\n\n===PLAN_READY===\n${J}\n===END===`)
  assert(r.json?.year === 2026, 'json 실패')
  assert(r.text === '확정했습니다.', `text=${r.text}`)
})

check('===END=== 누락도 복구', () => {
  const r = splitPlan(`===PLAN_READY===\n${J}`)
  assert(r.json?.subject === '과학', 'END 없으면 실패함')
})

check('코드펜스로 감싼 경우 복구', () => {
  const r = splitPlan('===PLAN_READY===\n```json\n' + J + '\n```\n===END===')
  assert(r.json?.subject === '과학', '코드펜스 미처리')
})

check('깨진 JSON → broken', () => {
  const r = splitPlan('===PLAN_READY===\n{ "year": 2026, \n===END===')
  assert(r.json === null && r.broken === true, JSON.stringify(r))
})

check('빈 블록 → broken', () => {
  const r = splitPlan('===PLAN_READY===\n\n===END===')
  assert(r.broken === true, JSON.stringify(r))
})

check('배열/스칼라 JSON 은 거부 (필드 객체여야 함)', () => {
  assert(splitPlan('===PLAN_READY===\n[1,2]\n===END===').broken === true, '배열 통과')
  assert(splitPlan('===PLAN_READY===\n"hi"\n===END===').broken === true, '문자열 통과')
})

check('null/비문자열 입력에도 죽지 않음', () => {
  assert(splitPlan(undefined).json === null, 'undefined')
  assert(splitPlan(null).text === '', 'null')
  assert(splitPlan(123).json === null, 'number')
})

check('한글 값 보존', () => {
  const r = splitPlan(`===PLAN_READY===\n${J}\n===END===`)
  assert(r.json.perf_areas[0].name === '실험', '한글 깨짐')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
