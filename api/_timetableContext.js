// ═══════════════════════════════════════════════════════════════════
//  api/_timetableContext.js — 시간표 AI 엔드포인트 공통 컨텍스트
// ═══════════════════════════════════════════════════════════════════
//  Supabase 에서 시간표·변동·캘린더를 가져와서 Claude 가 이해할 수 있는
//  텍스트 형태로 변환. 모든 시간표 AI 엔드포인트가 이걸 import 해서 사용.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── 활성 시간표 + 그 주의 변동 + 캘린더 통합 조회 ───
export async function fetchTimetableContext(weekStart, weekEnd) {
  const [ttRes, chRes, calRes] = await Promise.all([
    supabase.from('timetables').select('*').eq('is_active', true).maybeSingle(),
    supabase.from('timetable_changes').select('*').gte('source_date', weekStart).lte('source_date', weekEnd).eq('status', 'approved'),
    supabase.from('school_calendar').select('*').gte('date', weekStart).lte('date', weekEnd),
  ]);
  return {
    activeTimetable: ttRes.data || null,
    approvedChanges: chRes.data || [],
    calendar: (calRes.data || []).reduce((acc, e) => { acc[e.date] = e; return acc; }, {}),
  };
}

// ─── 슬롯 키 ───
export const slotKey = (day, period) => `${day}-${period}`;

// ─── 시간표 데이터를 학급/요일별로 풀어서 해석 가능한 형태로 ───
// 반환: { c1: { '월-1': {sid,tid}, ... }, ... }
export function expandTimetableData(timetableData) {
  if (!timetableData) return {};
  return timetableData; // 이미 우리 스키마는 이 형태
}

// ─── 교사별 시간표 변환 ───
// 반환: { t1: { '월-1': {sid, cid}, ... }, ... }
export function toTeacherView(classViewTT) {
  const teacherTT = {};
  for (const [cid, classTT] of Object.entries(classViewTT || {})) {
    for (const [sKey, slot] of Object.entries(classTT || {})) {
      if (!slot?.tid) continue;
      if (!teacherTT[slot.tid]) teacherTT[slot.tid] = {};
      teacherTT[slot.tid][sKey] = { sid: slot.sid, cid };
    }
  }
  return teacherTT;
}

// ─── 특정 시간에 비어있는 교사 찾기 (학교 전체 교사 목록 필요) ───
// teacherIds: 모든 교사 ID 배열 (TCH 에서 추출)
// teacherViewTT: toTeacherView 결과
export function findFreeTeachersAt(teacherIds, teacherViewTT, day, period) {
  const k = slotKey(day, period);
  return teacherIds.filter(tid => !teacherViewTT[tid]?.[k]);
}

// ─── 교사의 빈 시간 찾기 ───
// 학교 전체 교시 정의 필요
const ALL_SLOTS = [];
for (const d of ['월','화','수','목','금']) {
  const maxP = (d === '화' || d === '목') ? 7 : 6;
  for (let p = 1; p <= maxP; p++) ALL_SLOTS.push({ day: d, period: p });
}

export function findFreeSlotsForTeacher(teacherViewTT, tid, excludeKey = null) {
  const tch = teacherViewTT[tid] || {};
  return ALL_SLOTS.filter(({ day, period }) => {
    const k = slotKey(day, period);
    if (k === excludeKey) return false; // 본인이 옮기려는 셀 제외
    return !tch[k];
  });
}


// ─── 교사 시간표 텍스트 요약 ───
export function summarizeTeacherSchedule(tid, teacherViewTT, classMap, subjectMap) {
  const tch = teacherViewTT[tid] || {};
  const lines = [];
  const dayKeys = ['월','화','수','목','금'];
  for (const d of dayKeys) {
    const dayLine = [];
    for (let p = 1; p <= 7; p++) {
      const slot = tch[slotKey(d, p)];
      if (slot) {
        const sub = subjectMap[slot.sid]?.name || slot.sid;
        const cls = classMap[slot.cid]?.name || slot.cid;
        dayLine.push(`${p}교시: ${sub}(${cls})`);
      }
    }
    if (dayLine.length > 0) lines.push(`${d}요일 — ${dayLine.join(', ')}`);
    else lines.push(`${d}요일 — 수업 없음`);
  }
  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════
//  관리자 AI 도구용 추가 유틸
// ═══════════════════════════════════════════════════════════════════

// ─── 활성 시간표 단독 조회 ───
export async function fetchActiveTimetable() {
  const { data, error } = await supabase
    .from('timetables').select('*').eq('is_active', true).maybeSingle();
  if (error) throw error;
  return data;
}

// ─── 학급별 시수 카운트 (실제 배치된 시수) ───
//   classTT 에서 학급별로 과목별 시수 카운트
//   반환: { c1: { s1: 4, s5: 5, ... }, c2: ..., }
export function countActualHours(classTT) {
  const result = {};
  for (const [cid, cls] of Object.entries(classTT || {})) {
    result[cid] = {};
    for (const slot of Object.values(cls || {})) {
      if (!slot?.sid || slot.type) continue;
      result[cid][slot.sid] = (result[cid][slot.sid] || 0) + 1;
    }
  }
  return result;
}

// ─── 교사별 시수 카운트 (실제 배치된 시수) ───
export function countTeacherActualHours(classTT) {
  const result = {};
  for (const cls of Object.values(classTT || {})) {
    for (const slot of Object.values(cls || {})) {
      if (!slot?.tid || slot.type) continue;
      result[slot.tid] = (result[slot.tid] || 0) + 1;
    }
  }
  return result;
}

// ─── 시간표 충돌 탐지 ───
//   같은 시간에 한 교사가 두 학급에 들어가 있는지
//   반환: [{ tid, day, period, classes: [c1, c2] }, ...]
export function findTeacherConflicts(classTT) {
  const conflicts = [];
  // 각 (day, period) 별로 교사 등장 횟수 추적
  const slotMap = {}; // {`day-period`: { tid: [c1, c2, ...] } }

  for (const [cid, cls] of Object.entries(classTT || {})) {
    for (const [sKey, slot] of Object.entries(cls || {})) {
      if (!slot?.tid || slot.type) continue;
      if (!slotMap[sKey]) slotMap[sKey] = {};
      if (!slotMap[sKey][slot.tid]) slotMap[sKey][slot.tid] = [];
      slotMap[sKey][slot.tid].push(cid);
    }
  }

  for (const [sKey, byTid] of Object.entries(slotMap)) {
    for (const [tid, cids] of Object.entries(byTid)) {
      if (cids.length > 1) {
        const [day, p] = sKey.split('-');
        conflicts.push({ tid, day, period: parseInt(p, 10), classes: cids });
      }
    }
  }
  return conflicts;
}

// ─── 변동 통계 조회 ───
export async function fetchChangeStats(filter = {}) {
  let q = supabase.from('timetable_changes').select('*');
  if (filter.startDate) q = q.gte('source_date', filter.startDate);
  if (filter.endDate)   q = q.lte('source_date', filter.endDate);
  if (filter.teacherId) q = q.eq('source_teacher_id', filter.teacherId);
  if (filter.type)      q = q.eq('type', filter.type);
  if (filter.status)    q = q.eq('status', filter.status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ─── 보강 누적 분석 ───
//   각 교사별 보강(substitute payload.substitute_teacher_id) 횟수 합산
export async function fetchSubstituteLoad(startDate, endDate) {
  const { data, error } = await supabase
    .from('timetable_changes')
    .select('payload, status')
    .eq('type', 'substitute')
    .eq('status', 'approved')
    .gte('source_date', startDate)
    .lte('source_date', endDate);
  if (error) throw error;

  const counts = {};
  for (const row of data || []) {
    const tid = row.payload?.substitute_teacher_id;
    if (!tid) continue;
    counts[tid] = (counts[tid] || 0) + 1;
  }
  return counts;
}
