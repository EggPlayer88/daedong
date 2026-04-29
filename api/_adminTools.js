// ═══════════════════════════════════════════════════════════════════
//  api/_adminTools.js — 관리자 AI 의 도구 정의 및 구현
// ═══════════════════════════════════════════════════════════════════
//
//  도구 5개:
//   1. validate_timetable      — 시수/충돌/균등성 검증
//   2. query_change_stats      — 변동 통계 조회
//   3. analyze_substitute_load — 교사별 보강 부담 분석
//   4. find_available_teachers — 특정 시간 빈 교사 찾기
//   5. propose_change          — 변동 제안 (실제 적용 X, UI 카드로 표시)
//
//  각 도구는 Claude tool use 의 input_schema 정의 + 실행 함수로 구성됨
// ═══════════════════════════════════════════════════════════════════

import {
  fetchActiveTimetable, fetchChangeStats, fetchSubstituteLoad,
  countActualHours, countTeacherActualHours, findTeacherConflicts,
  toTeacherView, findFreeTeachersAt, slotKey,
} from './_timetableContext.js';


// ─── 도구 정의 (Claude tool use 형식) ───
export const ADMIN_TOOLS = [
  {
    name: 'validate_timetable',
    description: '활성 시간표의 시수 정확성과 충돌을 검증합니다. 학년별 과목 표준 시수 vs 실제 배치 시수 비교, 동시간 교사 중복 탐지를 수행합니다.',
    input_schema: {
      type: 'object',
      properties: {
        check_hours: {
          type: 'boolean',
          description: '학년별 과목 시수 일치 검증 (기본: true)',
        },
        check_conflicts: {
          type: 'boolean',
          description: '동시간 교사 중복 검증 (기본: true)',
        },
        check_teacher_hours: {
          type: 'boolean',
          description: '교사별 누적 시수 검증 (기본: true)',
        },
      },
    },
  },
  {
    name: 'query_change_stats',
    description: '시간표 변동 요청 통계를 조회합니다. 기간/교사/유형/상태로 필터링 가능. 변동이 얼마나 발생했는지, 누가 자주 요청하는지 등을 알 때 사용.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: '시작 날짜 YYYY-MM-DD (기본: 30일 전)' },
        end_date:   { type: 'string', description: '종료 날짜 YYYY-MM-DD (기본: 오늘)' },
        teacher_id: { type: 'string', description: '특정 교사 ID 로 필터' },
        type:       { type: 'string', enum: ['swap','substitute','self_study','period_move'] },
        status:     { type: 'string', enum: ['pending','awaiting_partners','awaiting_admin','approved','rejected','cancelled'] },
      },
    },
  },
  {
    name: 'analyze_substitute_load',
    description: '교사별 보강 누적 횟수를 분석합니다. 형평성 모니터링에 사용 — 특정 교사에게 보강이 몰리는지, 평균 대비 어떤 분포인지 파악.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD (기본: 60일 전)' },
        end_date:   { type: 'string', description: 'YYYY-MM-DD (기본: 오늘)' },
      },
    },
  },
  {
    name: 'find_available_teachers',
    description: '특정 시간(요일+교시)에 비어있는 교사를 찾습니다. 보강 후보 탐색에 사용.',
    input_schema: {
      type: 'object',
      properties: {
        day:    { type: 'string', enum: ['월','화','수','목','금'], description: '요일' },
        period: { type: 'integer', minimum: 1, maximum: 7, description: '교시' },
      },
      required: ['day', 'period'],
    },
  },
  {
    name: 'propose_change',
    description: '시간표 변동을 제안합니다. 실제로 적용하지 않고, 사용자가 카드를 통해 확정하도록 정보를 반환합니다. 사용자가 "이렇게 바꿔줘" 라고 자연어로 말할 때 의도를 파악해서 호출.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['swap','substitute','self_study','period_move'],
          description: '변동 유형',
        },
        source_date: { type: 'string', description: 'YYYY-MM-DD' },
        source_class_id: { type: 'string' },
        source_day: { type: 'string', enum: ['월','화','수','목','금'] },
        source_period: { type: 'integer', minimum: 1, maximum: 7 },
        source_teacher_id: { type: 'string' },
        source_subject_id: { type: 'string' },
        payload: {
          type: 'object',
          description: 'type 별로 필요한 정보 — substitute: {substitute_teacher_id}, self_study: {supervisor_teacher_id?}, period_move: {target_class_id, target_day, target_period}, swap: {partners: [{class_id, day, period, teacher_id, subject_id}, ...]}',
        },
        reason: { type: 'string', description: '변동 사유' },
      },
      required: ['type', 'source_date', 'source_class_id', 'source_day', 'source_period', 'source_teacher_id', 'reason'],
    },
  },
];


// ─── 도구 실행 ───
export async function executeAdminTool(name, input, context) {
  switch (name) {
    case 'validate_timetable':       return await validateTimetable(input, context);
    case 'query_change_stats':       return await queryChangeStats(input);
    case 'analyze_substitute_load':  return await analyzeSubstituteLoad(input, context);
    case 'find_available_teachers':  return await findAvailableTeachers(input, context);
    case 'propose_change':           return proposeChange(input);
    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
}


// ───── 1. validate_timetable ─────
async function validateTimetable(input, context) {
  const {
    check_hours = true,
    check_conflicts = true,
    check_teacher_hours = true,
  } = input || {};

  const tt = await fetchActiveTimetable();
  if (!tt) return { error: '활성 시간표가 없습니다' };

  const classTT = tt.data || {};
  const result = { ok: true, issues: [], summary: {} };

  // 시수 검증 (학급별 과목 표준 시수 vs 실제)
  if (check_hours) {
    const actualHours = countActualHours(classTT);
    const subjects = context.subjects || [];
    const classes = context.classes || [];

    let mismatches = [];
    for (const cls of classes) {
      const grade = parseInt(cls.id.charAt(1), 10) || 1; // c1->1, c4->2 — 시드 매핑 단순화 필요
      // 학년 추출은 클라이언트가 주는 클래스 정보에 의존해야 함
      const gradeFromName = parseInt(cls.name?.charAt(0), 10) || 1;
      for (const sub of subjects) {
        const standard = sub.gh?.[gradeFromName] || 0;
        const actual = actualHours[cls.id]?.[sub.id] || 0;
        if (standard > 0 && actual !== standard) {
          mismatches.push({
            class: cls.name, subject: sub.name,
            standard, actual, diff: actual - standard,
          });
        }
        if (standard === 0 && actual > 0) {
          // 표준에 없는데 배치된 경우 (예: 1학년 역사)
          mismatches.push({
            class: cls.name, subject: sub.name,
            standard: 0, actual, note: '커리큘럼에 없는 과목',
          });
        }
      }
    }
    result.summary.hours_mismatches = mismatches.length;
    if (mismatches.length > 0) {
      result.ok = false;
      result.issues.push({ category: '시수 불일치', items: mismatches.slice(0, 20) });
    }
  }

  // 충돌 검증 (한 교사 동시간 두 학급)
  if (check_conflicts) {
    const conflicts = findTeacherConflicts(classTT);
    result.summary.conflicts = conflicts.length;
    if (conflicts.length > 0) {
      result.ok = false;
      result.issues.push({
        category: '교사 동시간 중복',
        items: conflicts.map(c => {
          const tname = (context.teachers || []).find(t => t.id === c.tid)?.name || c.tid;
          const cnames = c.classes.map(cid =>
            (context.classes || []).find(x => x.id === cid)?.name || cid
          );
          return { teacher: tname, day: c.day, period: c.period, classes: cnames };
        }),
      });
    }
  }

  // 교사별 시수 (표준 vs 실제)
  if (check_teacher_hours) {
    const actual = countTeacherActualHours(classTT);
    const teachers = context.teachers || [];
    const teacherMismatches = [];
    for (const t of teachers) {
      // 교사의 표준 시수 = as 배열의 h 합계
      const standard = (t.as || []).reduce((s, a) => s + (a.h || 0), 0);
      const a = actual[t.id] || 0;
      if (standard > 0 && a !== standard) {
        teacherMismatches.push({
          teacher: t.name, standard, actual: a, diff: a - standard,
        });
      }
    }
    result.summary.teacher_hours_mismatches = teacherMismatches.length;
    if (teacherMismatches.length > 0) {
      result.issues.push({
        category: '교사 시수 불일치',
        items: teacherMismatches.slice(0, 20),
      });
    }
  }

  if (result.ok) result.message = '검증 통과 — 시수, 충돌 모두 정상';
  return result;
}


// ───── 2. query_change_stats ─────
async function queryChangeStats(input) {
  const today = new Date();
  const startDefault = new Date(today);
  startDefault.setDate(today.getDate() - 30);

  const filter = {
    startDate: input?.start_date || startDefault.toISOString().slice(0, 10),
    endDate:   input?.end_date   || today.toISOString().slice(0, 10),
    teacherId: input?.teacher_id,
    type:      input?.type,
    status:    input?.status,
  };

  const changes = await fetchChangeStats(filter);

  // 집계
  const byType = {};
  const byStatus = {};
  const byRequester = {};
  const byClass = {};

  for (const c of changes) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (c.requester_id) byRequester[c.requester_id] = (byRequester[c.requester_id] || 0) + 1;
    if (c.source_class_id) byClass[c.source_class_id] = (byClass[c.source_class_id] || 0) + 1;
  }

  const topRequesters = Object.entries(byRequester)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topClasses = Object.entries(byClass)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    total: changes.length,
    period: `${filter.startDate} ~ ${filter.endDate}`,
    by_type: byType,
    by_status: byStatus,
    top_requesters: topRequesters,
    top_classes: topClasses,
  };
}


// ───── 3. analyze_substitute_load ─────
async function analyzeSubstituteLoad(input, context) {
  const today = new Date();
  const startDefault = new Date(today);
  startDefault.setDate(today.getDate() - 60);

  const startDate = input?.start_date || startDefault.toISOString().slice(0, 10);
  const endDate = input?.end_date || today.toISOString().slice(0, 10);

  const counts = await fetchSubstituteLoad(startDate, endDate);
  const teachers = context.teachers || [];

  const list = teachers.map(t => ({
    teacher_id: t.id,
    name: t.name,
    count: counts[t.id] || 0,
  })).sort((a, b) => b.count - a.count);

  const totalSubs = list.reduce((s, x) => s + x.count, 0);
  const avg = teachers.length > 0 ? totalSubs / teachers.length : 0;

  // 평균 대비 2배 이상 = 주의 필요
  const heavy = list.filter(x => avg > 0 && x.count >= avg * 2);

  return {
    period: `${startDate} ~ ${endDate}`,
    total_substitutes: totalSubs,
    average_per_teacher: avg.toFixed(1),
    teachers_above_2x_avg: heavy,
    top_5: list.slice(0, 5),
  };
}


// ───── 4. find_available_teachers ─────
async function findAvailableTeachers(input, context) {
  const { day, period } = input || {};
  if (!day || !period) return { error: 'day, period 필수' };

  const tt = await fetchActiveTimetable();
  if (!tt) return { error: '활성 시간표가 없습니다' };

  const classTT = tt.data || {};
  const teacherTT = toTeacherView(classTT);
  const teachers = context.teachers || [];

  const allTeacherIds = teachers.map(t => t.id);
  const freeIds = findFreeTeachersAt(allTeacherIds, teacherTT, day, period);

  const free = freeIds.map(tid => {
    const t = teachers.find(x => x.id === tid);
    return {
      id: tid,
      name: t?.name || tid,
      subject: t?.subject,
      total_hours: Object.keys(teacherTT[tid] || {}).length,
    };
  });

  return {
    day, period,
    free_teachers: free,
    free_count: free.length,
  };
}


// ───── 5. propose_change ─────
//   실제로 적용하지 않고 정보만 반환. UI 가 카드로 보여주고 확정 클릭 시 적용.
function proposeChange(input) {
  const required = ['type', 'source_date', 'source_class_id', 'source_day', 'source_period', 'source_teacher_id', 'reason'];
  const missing = required.filter(k => !input?.[k]);
  if (missing.length > 0) return { error: `필수 필드 누락: ${missing.join(', ')}` };

  return {
    proposal: {
      type: input.type,
      source_date: input.source_date,
      source_class_id: input.source_class_id,
      source_day: input.source_day,
      source_period: input.source_period,
      source_teacher_id: input.source_teacher_id,
      source_subject_id: input.source_subject_id,
      payload: input.payload || {},
      reason: input.reason,
      requires_approval: 'admin_only', // 관리자 직권이므로
      created_at: new Date().toISOString(),
    },
    note: '이 제안은 아직 적용되지 않았습니다. 관리자가 카드를 통해 확정해야 시간표에 반영됩니다.',
  };
}
