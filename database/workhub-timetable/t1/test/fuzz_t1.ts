// 앱 검사 함수와 SQL 이식본(t1_basis_issues · t1_placement_issues · t1_foundation_ready · t1_draft_ok · t1_compile)의 판정을 무작위 변형으로 대조한다.
// 1단계(이 파일): run_t1.py 의 실제 확정 기준판 · 원본 · 초안을 씨앗으로 변형을 만들고, 앱 함수의 판정을 붙여 T1_FUZZ 에 쓴다.
// 2단계(fuzz_t1.py): 같은 변형을 SQL 함수에 넣어 판정이 같은지 센다.
// 앱 코드는 고치지 않고 가져다 쓰기만 한다. --alias:t1app=<checkout>/apps/workhub/src · --alias:t1pkg=<checkout>/packages/timetable/src
import { readFileSync, writeFileSync } from 'node:fs'
import { validateBasis, validatePlacements } from 't1pkg/validate'
import { reviewTimetableFoundation } from 't1app/timetable/foundation'
import { compilePreparation, preparationDraft, preparationSource } from 't1app/timetable/preparation'

const cap = JSON.parse(readFileSync(process.env.T1_CAPTURE!, 'utf8')).captures as any[]
const seedCase = cap.find(c => c.kind === 'prep_exec' && !c.recover && c.input.kind === 'confirm' && c.raw?.data?.basis && c.sourceRaw?.data)
if (!seedCase) { console.log('FAIL 씨앗(확정 성공 응답)이 없습니다'); process.exit(1) }
const schoolId = seedCase.scope.schoolId
const baseSource = preparationSource(seedCase.sourceRaw.data, schoolId)
const baseDraft = seedCase.input.draft
const baseBasis = seedCase.raw.data.basis
const saved = cap.find(c => c.kind === 'save' && c.raw?.data && !c.recover)
const basePlacements = saved ? saved.input.placements : []
const baseConditions = saved ? saved.input.conditions : { fixed: [], unavailable: [], preferences: [] }

let s = Number(process.env.T1_FUZZ_SEED ?? 20261018)
const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const clone = <T,>(v: T): T => structuredClone(v)
const EMOJI = '\u{1F600}'
const strings = ['', ' ', '\u0085', ' ', '​', 'a\n', 'a\u007f', 'a\u0008', '　가', 'x'.repeat(200), 'x'.repeat(201), EMOJI.repeat(100), EMOJI.repeat(101),
                 'x'.repeat(100), 'x'.repeat(101), 'x'.repeat(120), 'x'.repeat(121), 'bad id', 'ok-id_1', 'A'.repeat(100), 'A'.repeat(101), '가나다', ' 앞 공백', '﻿']
const numbers = [0, 1, 2, -1, 1.5, 7, 8, 16, 17, 1000, 1001, 1439, 1440, 1441, 9007199254740991, 9007199254740992, 1e20]
const others = [null, true, false, [], {}, '1', 'x']

// 무작위 경로 하나를 골라 바꾼다(키 삭제 · 추가 · 값 바꿈 · 배열 원소 복제/삭제/비우기)
function paths(v: any, p: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  out.push(p)
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, [...p, i], out))
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) paths(v[k], [...p, k], out)
  return out
}
function getAt(v: any, p: (string | number)[]) { return p.reduce((a, k) => a?.[k], v) }
function setAt(v: any, p: (string | number)[], x: any) { if (!p.length) return x; const parent = getAt(v, p.slice(0, -1)); parent[p[p.length - 1]] = x; return v }
function mutate(v0: any, n = 1 + Math.floor(rnd() * 2)) {
  let v = clone(v0)
  for (let i = 0; i < n; i++) {
    const all = paths(v), p = pick(all.length > 1 ? all.slice(1) : all), cur = getAt(v, p), parent = getAt(v, p.slice(0, -1)), r = rnd()
    if (r < 0.08 && parent && !Array.isArray(parent)) delete parent[p[p.length - 1]]
    else if (r < 0.14 && cur && typeof cur === 'object' && !Array.isArray(cur)) cur[pick(['extra', 'id', 'kind', 'weight'])] = pick([1, 'x', null])
    else if (r < 0.26 && Array.isArray(cur) && cur.length) { const j = Math.floor(rnd() * cur.length); pick([() => cur.push(clone(cur[j])), () => cur.splice(j, 1), () => cur.length = 0, () => cur.reverse()])() }
    else if (typeof cur === 'string') v = setAt(v, p, rnd() < 0.7 ? pick(strings) : pick(others))
    else if (typeof cur === 'number') v = setAt(v, p, rnd() < 0.8 ? pick(numbers) : pick(others))
    else v = setAt(v, p, pick([...others, ...numbers.slice(0, 4), 'x']))
  }
  return v
}
// 의미 있는 변형: 배치 시간대 바꾸기 · 사용 불가 시간 · 고정 · 선호
function semantic(b: any) {
  const slots = b.slots.map((x: any) => x.id), lessons = b.lessons.map((x: any) => x.id), res = b.resources.map((x: any) => x.id)
  const placements = b.lessons.map((l: any) => ({ lessonId: l.id, slotId: pick(l.allowedSlotIds) }))
  const fixed = rnd() < 0.5 ? [] : [{ lessonId: pick(lessons), slotId: pick(slots) }]
  const unavailable = Array.from({ length: Math.floor(rnd() * 3) }, () => { const st = Math.floor(rnd() * 800); return { resourceId: pick(res), day: 1 + Math.floor(rnd() * 3), startMinute: st, endMinute: st + 1 + Math.floor(rnd() * 600) } })
  const preferences = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ lessonId: pick(lessons), slotId: pick(slots), weight: Math.floor(rnd() * 10) }))
  return { basis: { ...b, fixed, unavailable, preferences }, placements }
}

const cases: any[] = []
const verdict = (fn: () => boolean) => { try { return fn() } catch { return false } }
const N = Number(process.env.T1_FUZZ_N ?? 400)
const basisWithConditions = { ...baseBasis, ...baseConditions }
for (let i = 0; i < N; i++) {
  // 1. validateBasis
  const b = mutate(rnd() < 0.5 ? baseBasis : basisWithConditions)
  cases.push({ type: 'basis', value: b, app: validateBasis(b).valid })
  // 2. validatePlacements(유효한 기준판에서) · 3. 준비 완료 판정
  const sm = semantic(baseBasis)
  const pb = validateBasis(sm.basis).valid ? sm.basis : baseBasis
  const pl = rnd() < 0.7 ? sm.placements : mutate(basePlacements.length ? basePlacements : sm.placements)
  cases.push({ type: 'placements', basis: pb, value: pl, app: validatePlacements(pb, pl).valid })
  const fb = rnd() < 0.5 ? pb : { ...pb, slots: pb.slots.slice(0, 1 + Math.floor(rnd() * pb.slots.length)), lessons: pb.lessons }
  cases.push({ type: 'foundation', basis: fb, app: reviewTimetableFoundation(fb).ready })
  // 4. preparationDraft(원본 대조) · 5. compilePreparation(같은 원본 · 초안 → 같은 기준판)
  const dr = rnd() < 0.15 ? baseDraft : mutate(baseDraft)
  cases.push({ type: 'draft', value: dr, source: baseSource, app: verdict(() => !!preparationDraft(dr, baseSource)) })
  if (verdict(() => !!preparationDraft(dr, baseSource))) {
    const c = compilePreparation(baseSource, dr, 'fz-' + i, 1 + (i % 3))
    cases.push({ type: 'compile', value: dr, source: baseSource, id: 'fz-' + i, revision: 1 + (i % 3), app: c.basis })
  }
}
writeFileSync(process.env.T1_FUZZ!, JSON.stringify(cases))
const by: Record<string, [number, number]> = {}
for (const c of cases) { const k = c.type; by[k] ??= [0, 0]; (c.app ? by[k][0]++ : by[k][1]++) }
console.log('INFO 변형 ' + cases.length + '건 — ' + Object.entries(by).map(([k, [a, b]]) => `${k} 통과 ${a} · 거절 ${b}`).join(' / '))
