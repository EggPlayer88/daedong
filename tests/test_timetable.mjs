import assert from 'node:assert/strict';
import { toClassTimetable, compareCandidates } from '../packages/timetable/src/index.js';

const problem = { classes: [{ id: 'c1' }], days: [{ id: '월', periods: 3 }],
  lessons: [{ id: 'a', classId: 'c1', subjectId: 's1', teacherIds: ['t1', 't2'], hours: 2, blocks: [2] }],
  reservations: [{ classId: 'c1', day: '월', period: 3, name: '창체', teacherIds: ['t3'] }] };
const candidate = { hardValidation: { valid: true }, placements: [{ unitId: 'a@0', day: '월', start: 1 }],
  evaluation: { totalPenalty: 3, weaknesses: [], breakdown: {} }, strengths: ['공강'] };
const tt = toClassTimetable(problem, candidate);
assert.deepEqual(tt.c1['월-1'].teacherIds, ['t1', 't2']);
assert.equal(tt.c1['월-2'].blockLength, 2);
assert.equal(tt.c1['월-3'].tid, 't3');
console.log('  ✓ 블록·동반교사·예약을 화면 셀로 보존');
assert.throws(() => toClassTimetable(problem, { ...candidate, placements: [] }), /배정되지/);
assert.throws(() => toClassTimetable(problem, { ...candidate, placements: [...candidate.placements, ...candidate.placements] }));
assert.throws(() => toClassTimetable(problem, { ...candidate, hardValidation: { valid: false } }));
for (const blocks of ['2', null, [0], [1], [2.5]]) {
  assert.throws(() => toClassTimetable({ ...problem, lessons: [{ ...problem.lessons[0], blocks }] }, candidate), /시수·블록/);
}
console.log('  ✓ 미완성·중복·검증 실패 후보를 화면 전달에서 거부');
assert.equal(compareCandidates({ status: 'unknown', candidates: [] }).length, 0);
assert.equal(compareCandidates({ status: 'feasible', candidates: [candidate] })[0].totalPenalty, 3);
assert.deepEqual(compareCandidates({ status: 'feasible', candidates: [candidate] })[0].strengths, ['공강']);
assert.throws(() => compareCandidates({ status: 'feasible', candidates: [{ ...candidate, hardValidation: null }] }));
console.log('  ✓ 품질과 약점 비교는 검증된 후보만 제공');
console.log('전부 통과 — 3건');
