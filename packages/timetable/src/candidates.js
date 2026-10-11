// 독립 검증을 통과한 엔진 결과를 기존 시간표 셀 형식과 검토 목록으로 변환한다.
// 저장·활성화는 담당자의 별도 채택 단계이며 이 함수는 배치를 변경하지 않는다.
export function toClassTimetable(problem, candidate) {
  if (!candidate?.hardValidation?.valid || !Array.isArray(candidate.placements)) {
    throw new Error('하드조건 검증을 통과한 후보가 필요합니다.');
  }
  if (!Array.isArray(problem?.classes) || !Array.isArray(problem?.lessons) || !Array.isArray(problem?.days)) {
    throw new Error('시간표 문제 입력이 올바르지 않습니다.');
  }
  const tt = Object.fromEntries(problem.classes.map(c => [c.id, {}]));
  const days = new Map(problem.days.map(d => [d.id, d.periods]));
  const units = new Map();
  for (const l of problem.lessons) {
    const blocks = l.blocks === undefined ? [] : l.blocks;
    if (!Array.isArray(blocks) || blocks.some(v => !Number.isInteger(v) || v < 2) ||
        !Number.isInteger(l.hours) || l.hours < 1 || l.hours > problem.days.reduce((n, d) => n + d.periods, 0)) {
      throw new Error('수업 시수·블록 입력이 올바르지 않습니다.');
    }
    const rest = l.hours - blocks.reduce((n, v) => n + v, 0);
    if (rest < 0 || !Array.isArray(l.teacherIds) || !l.teacherIds.length) {
      throw new Error('수업 시수·블록·교사 입력이 올바르지 않습니다.');
    }
    [...blocks, ...Array(rest).fill(1)].forEach((length, i) => units.set(`${l.id}@${i}`, { l, length }));
  }
  const seen = new Set();
  for (const place of candidate.placements) {
    const u = units.get(place.unitId);
    if (!u || seen.has(place.unitId) || !Number.isInteger(place.start) || place.start < 1 ||
        !days.has(place.day) || place.start + u.length - 1 > days.get(place.day) || !tt[u.l.classId]) {
      throw new Error('후보의 수업·교시가 올바르지 않습니다.');
    }
    seen.add(place.unitId);
    for (let p = place.start; p < place.start + u.length; p++) {
      const key = `${place.day}-${p}`;
      if (tt[u.l.classId][key]) throw new Error('같은 학급 교시에 수업이 중복됐습니다.');
      tt[u.l.classId][key] = { sid: u.l.subjectId, tid: u.l.teacherIds[0],
        teacherIds: [...u.l.teacherIds], resourceIds: [...(u.l.resourceIds ?? [])],
        lessonId: u.l.id, unitId: place.unitId, blockLength: u.length };
    }
  }
  if (seen.size !== units.size) throw new Error('배정되지 않은 수업이 있습니다.');
  for (const r of problem.reservations ?? []) {
    const key = `${r.day}-${r.period}`;
    if (!tt[r.classId] || tt[r.classId][key]) throw new Error('예약 교시가 중복됐습니다.');
    tt[r.classId][key] = { type: 'special', name: r.name ?? '예약', tid: r.teacherIds?.[0] ?? null,
      teacherIds: [...(r.teacherIds ?? [])], resourceIds: [...(r.resourceIds ?? [])] };
  }
  for (const c of problem.classes) {
    for (const d of problem.days) for (let p = 1; p <= d.periods; p++) {
      if (!tt[c.id][`${d.id}-${p}`]) throw new Error('시간표에 빈 교시가 있습니다.');
    }
  }
  return tt;
}

export function compareCandidates(result) {
  if (result?.status !== 'feasible' || !Array.isArray(result.candidates)) return [];
  return result.candidates.map((c, i) => {
    if (!c?.hardValidation?.valid || !Number.isFinite(c.evaluation?.totalPenalty)) {
      throw new Error('검증되지 않은 후보를 비교할 수 없습니다.');
    }
    return { id: i + 1, totalPenalty: c.evaluation.totalPenalty,
      breakdown: c.evaluation.breakdown, weaknesses: c.evaluation.weaknesses,
      teacherBurden: c.evaluation.teacherBurden, differentCells: c.differentCells,
      changedCells: c.changedCells, optimality: c.optimality, strengths: c.strengths ?? [] };
  });
}
