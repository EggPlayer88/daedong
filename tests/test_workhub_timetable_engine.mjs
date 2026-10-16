import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`export * from '../packages/timetable/src/validate';export * from '../packages/timetable/src/solver';`)
let count = 0
function check(name, fn) { fn(); count++; console.log('  ✓ ' + name) }
const clone = structuredClone
function basis() {
  return { schemaVersion: 1, id: 'basis-1', revision: 1, schoolId: 'school-1', termId: 'term-1', sourceFingerprint: 'a'.repeat(64), schoolLevel: 'middle', unsupportedFeatures: [],
    resources: [{ id: 't1', kind: 'teacher', label: '교사', capacity: 1 }, { id: 'c1', kind: 'class', label: '학급', capacity: 1 }],
    slots: [{ id: 's1', day: 1, label: '월 1', startMinute: 540, endMinute: 585, periods: 1 }, { id: 's2', day: 1, label: '월 2', startMinute: 585, endMinute: 630, periods: 1 }],
    lessons: [{ id: 'l1', courseId: 'course1', label: '국어', periods: 1, resourceIds: ['t1', 'c1'], allowedSlotIds: ['s1', 's2'] }, { id: 'l2', courseId: 'course2', label: '수학', periods: 1, resourceIds: ['t1', 'c1'], allowedSlotIds: ['s1', 's2'] }],
    courseLoads: [{ courseId: 'course1', periods: 1 }, { courseId: 'course2', periods: 1 }], fixed: [], unavailable: [], preferences: [] }
}
const options = { maxMs: 5000, maxNodes: 50000 }
const ok = b => { const r = m.solveTimetable(b, options); assert.equal(r.status, 'feasible', JSON.stringify(r)); assert.equal(m.validatePlacements(b, r.placements).valid, true); return r }
const invalid = (b, code) => { const r = m.validateBasis(b); assert.equal(r.valid, false); assert.ok(r.issues.some(x => x.code === code), JSON.stringify(r)); assert.equal(m.solveTimetable(b, options).status, 'invalid') }
check('모든 수업을 시수에 맞게 배치하고 독립 검증을 통과한다', () => { const b = basis(), original = clone(b), r = ok(b); assert.equal(r.placements.length, 2); assert.equal(r.optimal, false); assert.equal(r.stats.exhausted, false); assert.deepEqual(b, original) })
check('교시 이름이 달라도 실제 시각이 겹치면 교사 중복을 거절한다', () => { const b = basis(); b.slots[1].startMinute = 560; b.fixed = [{ lessonId: 'l1', slotId: 's1' }, { lessonId: 'l2', slotId: 's2' }]; const r = m.solveTimetable(b, options); assert.equal(r.status, 'infeasible'); assert.equal(r.stats.exhausted, true); assert.ok(m.validatePlacements(b, b.fixed).issues.some(i => i.code === 'RESOURCE_COLLISION')) })
check('실제 종료와 시작이 같은 경계는 서로 겹치지 않는다', () => { const b = basis(); b.fixed = [{ lessonId: 'l1', slotId: 's1' }, { lessonId: 'l2', slotId: 's2' }]; ok(b); assert.equal(m.overlaps(b.slots[0], b.slots[1]), false) })
check('날짜별 교시 수가 다른 초등 학급도 명시한 활동만 배치한다', () => { const b = basis(); b.schoolLevel = 'primary'; b.resources.push({ id: 'c2', kind: 'class', label: '저학년', capacity: 1 }, { id: 't2', kind: 'teacher', label: '담임2', capacity: 1 }); b.lessons.push({ id: 'l3', courseId: 'course3', label: '저학년 통합', periods: 1, resourceIds: ['t2', 'c2'], allowedSlotIds: ['s1'] }); b.courseLoads.push({ courseId: 'course3', periods: 1 }); const r = ok(b); assert.equal(r.placements.filter(p => p.lessonId === 'l3').length, 1) })
check('학생 수강이 겹치는 선택과목은 학급과 교사가 달라도 충돌한다', () => { const b = basis(); b.schoolLevel = 'high'; b.resources.push({ id: 't2', kind: 'teacher', label: '교사2', capacity: 1 }, { id: 'g', kind: 'student_group', label: '공통 수강 집단', capacity: 1 }); b.lessons[0].resourceIds = ['t1', 'g']; b.lessons[1].resourceIds = ['t2', 'g']; b.lessons.forEach(l => l.allowedSlotIds = ['s1']); assert.equal(m.solveTimetable(b, options).status, 'infeasible') })
check('교사 공동수업은 참여 교사를 모두 점유한다', () => { const b = basis(); b.resources.push({ id: 't2', kind: 'teacher', label: '공동교사', capacity: 1 }, { id: 'c2', kind: 'class', label: '다른반', capacity: 1 }); b.lessons[0].resourceIds.push('t2'); b.lessons[1].resourceIds = ['t2', 'c2']; b.lessons.forEach(l => l.allowedSlotIds = ['s1']); assert.equal(m.solveTimetable(b, options).status, 'infeasible') })
check('수용량 자원은 단순 겹침 개수가 아니라 같은 순간의 사용량으로 검사한다', () => { const b = basis(); b.resources = [{ id: 'room', kind: 'room', label: '체육관', capacity: 2 }]; b.slots = [{ id: 'a', day: 1, label: '전반', startMinute: 540, endMinute: 585, periods: 1 }, { id: 'b', day: 1, label: '후반', startMinute: 585, endMinute: 630, periods: 1 }, { id: 'ab', day: 1, label: '연속', startMinute: 540, endMinute: 630, periods: 2 }]; b.lessons = []; b.courseLoads = []; for (let i = 0; i < 3; i++) { const periods = i === 2 ? 2 : 1; b.resources.push({ id: 't' + i, kind: 'teacher', label: '교사' + i, capacity: 1 }, { id: 'c' + i, kind: 'class', label: '학급' + i, capacity: 1 }); b.lessons.push({ id: 'l' + i, courseId: 'course' + i, label: '수업' + i, periods, resourceIds: ['room', 't' + i, 'c' + i], allowedSlotIds: [b.slots[i].id] }); b.courseLoads.push({ courseId: 'course' + i, periods }) }; ok(b); b.resources[0].capacity = 1; assert.equal(m.solveTimetable(b, options).status, 'infeasible') })
check('장비·실습실 자원의 수용 한도도 초과할 수 없다', () => { for (const kind of ['room', 'equipment']) { const b = basis(); b.resources.push({ id: 'r', kind, label: '공유', capacity: 1 }, { id: 't2', kind: 'teacher', label: '교사2', capacity: 1 }, { id: 'c2', kind: 'class', label: '학급2', capacity: 1 }); b.lessons[0].resourceIds.push('r'); b.lessons[1].resourceIds = ['t2', 'c2', 'r']; b.lessons.forEach(l => l.allowedSlotIds = ['s1']); assert.equal(m.solveTimetable(b, options).status, 'infeasible'); b.resources.find(r => r.id === 'r').capacity = 2; ok(b) } })
check('고정 시간과 출근 불가 시간이 겹치면 그 수업의 원인을 알려준다', () => { const b = basis(); b.fixed = [{ lessonId: 'l1', slotId: 's1' }]; b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 540, endMinute: 550 }]; const r = m.solveTimetable(b, options); assert.equal(r.status, 'infeasible'); assert.equal(r.issues[0].code, 'NO_LEGAL_SLOT'); assert.match(r.issues[0].message, /국어/) })
check('불가 시간의 종료 경계는 다음 수업을 막지 않는다', () => { const b = basis(); b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 500, endMinute: 540 }]; ok(b) })
check('미지원 조건은 누락하지 않고 편성을 중지한다', () => { const b = basis(); b.unsupportedFeatures = ['격주 순환']; assert.equal(m.validateBasis(b).valid, true); assert.equal(m.validatePlacements(b, []).valid, false); const r = m.solveTimetable(b, options); assert.equal(r.status, 'unsupported'); assert.equal(r.placements.length, 0) })
check('시간·탐색 횟수 한도는 불가능과 구별한 unknown이다', () => { const r = m.solveTimetable(basis(), { maxMs: 5000, maxNodes: 1 }); assert.equal(r.status, 'unknown'); assert.equal(r.stats.exhausted, false); assert.equal(r.placements.length, 0); assert.equal(r.stats.nodes, 1) })
check('완전탐색으로 실패한 경우만 exhausted를 표시한다', () => { const b = basis(); b.lessons.forEach(l => l.allowedSlotIds = ['s1']); const r = m.solveTimetable(b, options); assert.equal(r.status, 'infeasible'); assert.equal(r.stats.exhausted, true); assert.equal(r.optimal, false) })
check('편성 한도 값과 숨겨진 옵션은 엄격히 검사한다', () => { for (const value of [null, [], { maxMs: 0 }, { maxMs: NaN }, { maxMs: Infinity }, { maxMs: 10001 }, { maxNodes: 0 }, { maxNodes: 1.2 }, { maxNodes: 500001 }, { relaxHard: true }]) assert.equal(m.solveTimetable(basis(), value).status, 'invalid') })
check('배열·숫자·참조·중복·미지정 항목을 조용히 통과시키지 않는다', () => {
  for (const [edit, code] of [[b => b.lessons = null, 'INVALID_ARRAY'], [b => b.lessons[0].periods = '1', 'INVALID_NUMBER'], [b => b.lessons[0].resourceIds.push('missing'), 'UNKNOWN_RESOURCE'], [b => b.slots.push(clone(b.slots[0])), 'DUPLICATE_ID'], [b => b.lessons[0].allowedSlotIds = ['missing'], 'UNKNOWN_SLOT'], [b => b.lessons[0].resourceIds = ['c1'], 'MISSING_TEACHER'], [b => b.lessons[0].resourceIds = ['t1'], 'MISSING_STUDENTS'], [b => b.schoolLevel = 'college', 'INVALID_SCHOOL_LEVEL'], [b => delete b.unavailable, 'MISSING_FIELD'], [b => b.hiddenHardConstraint = true, 'UNKNOWN_FIELD']]) { const b = basis(); edit(b); invalid(b, code) }
})
check('모든 식별자·참조는 RPC와 같은 영문·숫자·밑줄·하이픈 1~100자다', () => {
  const edits = [b => b.id = '기초판', b => b.schoolId = 's:1', b => b.termId = 'a'.repeat(101), b => b.resources[0].id = '교사', b => b.slots[0].id = '월:1', b => b.lessons[0].id = ' l1', b => b.lessons[0].courseId = '수업', b => b.lessons[0].resourceIds = ['t:1', 'c1'], b => b.lessons[0].allowedSlotIds = ['월1'], b => b.courseLoads[0].courseId = 1, b => b.fixed = [{ lessonId: 'l:1', slotId: 's1' }], b => b.fixed = [{ lessonId: 'l1', slotId: 's:1' }], b => b.preferences = [{ lessonId: 'l1', slotId: '시간', weight: 1 }], b => b.unavailable = [{ resourceId: 't 1', day: 1, startMinute: 1, endMinute: 2 }]]
  for (const edit of edits) { const b = basis(); edit(b); invalid(b, 'INVALID_ID') }
  for (const id of ['', 'a'.repeat(101), null, 123, 'x/y', 'a.b']) { const b = basis(); b.id = id; invalid(b, 'INVALID_ID') }
  const b = basis(); b.id = 'a'.repeat(100); b.schoolId = 'cc8e15fe-a9d7-468a-b7b7-bc1577048f0c'; b.termId = 'term_2026-1'; assert.equal(m.validateBasis(b).valid, true); ok(b)
})
check('표시 이름과 미지원 조건 설명에는 한국어와 문장 기호를 유지한다', () => {
  const b = basis(); b.resources[0].label = '김교사: 공동 수업'; b.slots[0].label = '월요일 1교시'; b.lessons[0].label = '국어·생활 속 읽기'; assert.equal(m.validateBasis(b).valid, true); ok(b)
  b.unsupportedFeatures = ['격주 운영: 홀수 주와 짝수 주']; assert.equal(m.validateBasis(b).valid, true); assert.equal(m.solveTimetable(b, options).status, 'unsupported')
})
check('기준 시수와 블록 시수를 검증하고 합계 불일치를 차단한다', () => { const b = basis(); b.courseLoads[0].periods = 2; invalid(b, 'COURSE_LOAD_MISMATCH'); const b2 = basis(); b2.slots[0].periods = 2; invalid(b2, 'BLOCK_PERIODS_MISMATCH') })
check('교사·학급·학생집단의 동시 수용량을 늘려 충돌을 우회하지 못한다', () => { for (const kind of ['teacher', 'class', 'student_group']) { const b = basis(); b.resources[0].kind = kind; b.resources[0].capacity = 2; invalid(b, 'IDENTITY_CAPACITY') } })
check('중복 고정·선호와 허용되지 않은 고정 시간은 거부한다', () => { const b = basis(); b.fixed = [{ lessonId: 'l1', slotId: 's1' }, { lessonId: 'l1', slotId: 's2' }]; invalid(b, 'DUPLICATE_FIXED'); const c = basis(); c.preferences = [{ lessonId: 'l1', slotId: 's1', weight: 1 }, { lessonId: 'l1', slotId: 's1', weight: 2 }]; invalid(c, 'DUPLICATE_PREFERENCE'); const d = basis(); d.lessons[0].allowedSlotIds = ['s1']; d.fixed = [{ lessonId: 'l1', slotId: 's2' }]; invalid(d, 'SLOT_NOT_ALLOWED') })
check('변조한 후보의 누락·중복·알 수 없는 필드·고정 위반을 재검사한다', () => { const b = basis(), r = ok(b); for (const p of [r.placements.slice(0, 1), [...r.placements, r.placements[0]], [{ ...r.placements[0], teacherId: 'other' }, r.placements[1]], [{ lessonId: 'missing', slotId: 's1' }, r.placements[1]], null]) assert.equal(m.validatePlacements(b, p).valid, false); b.fixed = [{ lessonId: r.placements[0].lessonId, slotId: r.placements[0].slotId === 's1' ? 's2' : 's1' }]; assert.ok(m.validatePlacements(b, r.placements).issues.some(i => i.code === 'FIXED_VIOLATION')) })
check('선호 벌점은 경로 순서와 점수에 반영되며 하드 조건을 완화하지 않는다', () => { const b = basis(); b.preferences = [{ lessonId: 'l1', slotId: 's1', weight: 7 }]; const r = ok(b); assert.equal(r.placements.find(p => p.lessonId === 'l1').slotId, 's2'); assert.equal(r.score, 0); b.fixed = [{ lessonId: 'l1', slotId: 's1' }]; assert.equal(ok(b).score, 7) })
check('입력 배열 순서가 바뀌어도 같은 첫 후보를 반환한다', () => { const b = basis(), first = ok(b), shuffled = clone(b); for (const name of ['resources', 'slots', 'lessons', 'courseLoads']) shuffled[name].reverse(); shuffled.lessons.forEach(l => { l.allowedSlotIds.reverse(); l.resourceIds.reverse() }); assert.deepEqual(ok(shuffled).placements, first.placements) })
check('작업자 응답은 상태·완전탐색·점수·문제 형식과 후보를 다시 검증한다', () => {
  const b = basis(), r = ok(b); assert.equal(m.validateSolveResult(b, r), true)
  for (const patch of [{ status: 'done' }, { optimal: true }, { score: 99 }, { issues: null }, { stats: { ...r.stats, nodes: -1 } }, { stats: { ...r.stats, elapsedMs: Infinity } }, { stats: { ...r.stats, exhausted: true } }, { extra: true }, { placements: [] }]) assert.equal(m.validateSolveResult(b, { ...r, ...patch }), false)
  const unknown = m.solveTimetable(b, { maxNodes: 1, maxMs: 5000 }); assert.equal(m.validateSolveResult(b, unknown), true); assert.equal(m.validateSolveResult(b, { ...unknown, status: 'infeasible' }), false)
  b.lessons.forEach(l => l.allowedSlotIds = ['s1']); const impossible = m.solveTimetable(b, options); assert.equal(m.validateSolveResult(b, impossible), true); assert.equal(m.validateSolveResult(b, { ...impossible, issues: [{ code: 'X', message: {}, path: '' }] }), false)
  b.unsupportedFeatures = ['격주']; assert.equal(m.validateSolveResult(b, m.solveTimetable(b, options)), true)
})
// 독립 완전열거 오라클: 엔진의 검사 함수나 점유 코드를 호출하지 않고 분 단위로 집계한다.
function oracleValid(b, placements) {
  const assignments = new Map(placements.map(p => [p.lessonId, b.slots.find(s => s.id === p.slotId)]))
  for (const l of b.lessons) {
    const s = assignments.get(l.id)
    if (!s || !l.allowedSlotIds.includes(s.id) || s.periods !== l.periods || b.fixed.some(f => f.lessonId === l.id && f.slotId !== s.id)) return false
    for (const u of b.unavailable) if (l.resourceIds.includes(u.resourceId) && s.day === u.day) for (let t = s.startMinute; t < s.endMinute; t++) if (t >= u.startMinute && t < u.endMinute) return false
  }
  for (const r of b.resources) for (let day = 1; day <= 3; day++) for (let t = 0; t < 20; t++) {
    let n = 0
    for (const l of b.lessons) { const s = assignments.get(l.id); if (l.resourceIds.includes(r.id) && s.day === day && s.startMinute <= t && t < s.endMinute) n++ }
    if (n > r.capacity) return false
  }
  return true
}
let oracleCombinations = 0
function oracle(b, i = 0, acc = []) { if (i === b.lessons.length) { oracleCombinations++; return oracleValid(b, acc) }; let found = false; for (const id of b.lessons[i].allowedSlotIds) found = oracle(b, i + 1, [...acc, { lessonId: b.lessons[i].id, slotId: id }]) || found; return found }
check('고정 시드 96개 작은 문제를 모든 배치의 독립 오라클과 대조한다', () => {
  let seed = 71283; const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 13) % n }
  for (let n = 0; n < 96; n++) {
    const b = basis(); b.slots = Array.from({ length: 3 + random(2) }, (_, i) => ({ id: 's' + i, day: 1 + random(2), label: '시간' + i, startMinute: i * 3, endMinute: i * 3 + 4, periods: 1 }));
    b.resources.push({ id: 't2', kind: 'teacher', label: '교사2', capacity: 1 }, { id: 'c2', kind: 'class', label: '학급2', capacity: 1 }, { id: 'r', kind: 'equipment', label: '장비', capacity: 1 + random(2) });
    b.lessons = Array.from({ length: 3 + random(2) }, (_, i) => ({ id: 'l' + i, courseId: 'q' + i, label: '수업' + i, periods: 1, resourceIds: [random(2) ? 't1' : 't2', random(2) ? 'c1' : 'c2', 'r'], allowedSlotIds: b.slots.filter((_, j) => j === 0 || random(2)).map(s => s.id) })); b.courseLoads = b.lessons.map(l => ({ courseId: l.courseId, periods: 1 }));
    if (n % 3 === 0) b.fixed = [{ lessonId: 'l0', slotId: b.lessons[0].allowedSlotIds[0] }]; if (n % 4 === 0) b.unavailable = [{ resourceId: 't1', day: 1, startMinute: 3, endMinute: 6 }];
    const exists = oracle(b), r = m.solveTimetable(b, options); assert.equal(r.status, exists ? 'feasible' : 'infeasible', `case ${n}: ${JSON.stringify(b)}`); if (exists) assert.equal(oracleValid(b, r.placements), true); else assert.equal(r.stats.exhausted, true)
  }
})
console.log(`시간표 엔진 ${count}건 통과, 독립 완전열거 ${oracleCombinations}개 배치 대조`)
