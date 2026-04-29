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
