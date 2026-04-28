// ═══════════════════════════════════════════════════════════════════
//  timetableEngine.js
//  순수함수 모음. UI 와 분리되어 단위테스트 가능.
//  - mergeChangesIntoTT: base TT + 변동 → 그날의 실제 TT
//  - toTeacherView: 학급 인덱스 TT → 교사 인덱스 TT 트랜스포즈
//  - getWeekDates: 기준일 → 그 주 월~금 날짜 배열
//  - resolveDayState: 캘린더 + 변동 → 그 날의 최종 상태
// ═══════════════════════════════════════════════════════════════════

import { DAYS, CLS, TCH } from './timetableData';

// ─── 셀 키 인코딩 ───
// 한 슬롯을 표현하는 표준 형식: "월-3"
export const slotKey = (day, period) => `${day}-${period}`;
export const parseSlot = (key) => {
  const [day, p] = key.split('-');
  return { day, period: parseInt(p, 10) };
};

// 날짜 → 요일 ('월'~'금', 그 외는 null)
export const dateToDay = (date) => {
  const d = (date instanceof Date) ? date : new Date(date);
  const idx = d.getDay(); // 0=일, 1=월, ..., 6=토
  if (idx === 0 || idx === 6) return null;
  return DAYS[idx - 1];
};


// ═══════════════════════════════════════════════════════════════════
//  1. mergeChangesIntoTT
//  특정 날짜의 시간표를 그릴 때 base TT 위에 변동을 차곡차곡 적용
// ═══════════════════════════════════════════════════════════════════
//  baseTT: { c1: { '월-1': {sid,tid}, ... }, c2: ..., }
//  changes: 그 날짜에 status='approved' 인 timetable_changes row 배열
//  date: 'YYYY-MM-DD'
//
//  반환: baseTT 와 같은 형태인데 변동 적용된 새 객체 (불변)
//  + 각 변동된 셀에는 _changed 메타 추가:
//    { sid, tid, _changed: { type, originalSid, originalTid, changeId } }
// ═══════════════════════════════════════════════════════════════════

export function mergeChangesIntoTT(baseTT, changes, date) {
  if (!baseTT) return {};
  // 깊은 복사 (JSONB 데이터라 안전)
  const tt = JSON.parse(JSON.stringify(baseTT));

  // 같은 날짜의 변동만 필터 (호출자가 이미 필터했어도 방어)
  const dayChanges = (changes || []).filter(
    c => c.source_date === date && c.status === 'approved'
  );

  for (const ch of dayChanges) {
    applyChangeToTT(tt, ch);
  }

  return tt;
}

function applyChangeToTT(tt, ch) {
  const sKey = slotKey(ch.source_day, ch.source_period);
  const sCls = ch.source_class_id;

  // 원본 셀 보존 (안내문 등에 쓰임)
  const original = tt[sCls]?.[sKey];

  if (ch.type === 'swap') {
    // payload: [{class_id, day, period, teacher_id, subject_id}, ...]
    // cells[0] = source, cells[1..N] = partners. 순환 swap.
    const cells = [{ cls: sCls, key: sKey }, ...(ch.payload?.partners || []).map(p => ({
      cls: p.class_id, key: slotKey(p.day, p.period)
    }))];

    const contents = cells.map(c => tt[c.cls]?.[c.key] || null);
    cells.forEach((c, i) => {
      const newContent = contents[(i - 1 + contents.length) % contents.length];
      if (!newContent) return;
      if (!tt[c.cls]) tt[c.cls] = {};
      tt[c.cls][c.key] = {
        ...newContent,
        _changed: {
          type: 'swap',
          originalSid: contents[i]?.sid,
          originalTid: contents[i]?.tid,
          changeId: ch.id,
        }
      };
    });
  }
  else if (ch.type === 'substitute') {
    // payload: { substitute_teacher_id, ai_recommended }
    if (!tt[sCls]) tt[sCls] = {};
    tt[sCls][sKey] = {
      sid: original?.sid,
      tid: ch.payload?.substitute_teacher_id,
      _changed: {
        type: 'substitute',
        originalTid: original?.tid,
        changeId: ch.id,
      }
    };
  }
  else if (ch.type === 'self_study') {
    // payload: { supervisor_teacher_id }  (없으면 그냥 결강)
    if (!tt[sCls]) tt[sCls] = {};
    tt[sCls][sKey] = {
      type: 'self_study',
      tid: ch.payload?.supervisor_teacher_id || null,
      _changed: {
        type: 'self_study',
        originalSid: original?.sid,
        originalTid: original?.tid,
        changeId: ch.id,
      }
    };
  }
  else if (ch.type === 'period_move') {
    // payload: { target_class_id, target_day, target_period }
    const tCls = ch.payload?.target_class_id || sCls;
    const tKey = slotKey(ch.payload?.target_day, ch.payload?.target_period);
    const targetContent = tt[tCls]?.[tKey] || null;

    if (!tt[sCls]) tt[sCls] = {};
    if (!tt[tCls]) tt[tCls] = {};

    // 원본 자리 → 대상 자리에 있던 내용으로 교체 (보통 빈 슬롯)
    if (targetContent) {
      tt[sCls][sKey] = {
        ...targetContent,
        _changed: {
          type: 'period_move_from',
          originalSid: original?.sid,
          originalTid: original?.tid,
          changeId: ch.id,
        }
      };
    } else {
      delete tt[sCls][sKey];
    }
    // 대상 자리 → 원본 내용
    tt[tCls][tKey] = {
      ...original,
      _changed: {
        type: 'period_move_to',
        originalSid: targetContent?.sid,
        originalTid: targetContent?.tid,
        changeId: ch.id,
      }
    };
  }
}


// ═══════════════════════════════════════════════════════════════════
//  2. toTeacherView
//  학급 인덱스 TT 를 교사 인덱스 TT 로 트랜스포즈
// ═══════════════════════════════════════════════════════════════════
//  입력: { c1: { '월-1': {sid, tid}, ... }, ... }
//  출력: { t1: { '월-1': {sid, cid}, ... }, t2: ..., }
//
//  유의: 교사 뷰의 빈 슬롯은 "공강" (보강 후보 탐색의 근거)
//  유의: 학급에 없는 교시(예: 월 7교시)는 교사 뷰에도 없음
// ═══════════════════════════════════════════════════════════════════

export function toTeacherView(classViewTT) {
  const teacherTT = {};

  // 모든 교사를 빈 객체로 초기화 (등장 안 한 교사도 빈 시간표 보이게)
  TCH.forEach(t => { teacherTT[t.id] = {}; });

  for (const [cid, classTT] of Object.entries(classViewTT || {})) {
    for (const [sKey, slot] of Object.entries(classTT)) {
      if (!slot || !slot.tid) continue;
      const tid = slot.tid;
      if (!teacherTT[tid]) teacherTT[tid] = {};
      teacherTT[tid][sKey] = {
        sid: slot.sid,
        cid: cid,
        type: slot.type,
        _changed: slot._changed,
      };
    }
  }

  return teacherTT;
}


// ═══════════════════════════════════════════════════════════════════
//  3. getWeekDates
//  기준일이 속한 주의 월~금 Date 배열 반환
// ═══════════════════════════════════════════════════════════════════

export function getWeekDates(refDate) {
  const d = (refDate instanceof Date) ? new Date(refDate) : new Date(refDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=일, 1=월, ..., 6=토
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  return Array.from({ length: 5 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return x;
  });
}

// 'YYYY-MM-DD' 포맷
export const fmtDate = (d) => {
  const x = (d instanceof Date) ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

// 사람용 포맷: "5/13 (수)"
export const fmtDateShort = (d) => {
  const x = (d instanceof Date) ? d : new Date(d);
  const m = x.getMonth() + 1;
  const dd = x.getDate();
  const dayName = dateToDay(x) || ['일','월','화','수','목','금','토'][x.getDay()];
  return `${m}/${dd} (${dayName})`;
};


// ═══════════════════════════════════════════════════════════════════
//  4. resolveDayState
//  특정 날짜의 최종 상태 결정 (캘린더 + 변동 종합)
// ═══════════════════════════════════════════════════════════════════
//  반환:
//   { kind: 'normal',      tt: <merged TT> }                         정규 수업일
//   { kind: 'no_school',   reason: 'holiday'|'no_school', note }    수업 없음
//   { kind: 'exam',        customSchedule, note }                    시험기간
//   { kind: 'event',       customSchedule, note, partial }           행사 (전교 또는 일부)
//   { kind: 'weekend' }                                              토/일
// ═══════════════════════════════════════════════════════════════════

export function resolveDayState(date, baseTT, calendarEntry, changes, classId = null) {
  const dayName = dateToDay(date);
  if (!dayName) return { kind: 'weekend' };

  if (calendarEntry) {
    const { type, note, affected_classes, custom_schedule } = calendarEntry;

    if (type === 'holiday' || type === 'no_school') {
      return { kind: 'no_school', reason: type, note };
    }

    if (type === 'exam') {
      return { kind: 'exam', customSchedule: custom_schedule, note };
    }

    if (type === 'event') {
      // 특정 학급만 영향받는 행사: classId 가 주어지고 그 학급이 affected 에 없으면 정상수업
      const isAffected = !affected_classes || affected_classes.length === 0
        || (classId && affected_classes.includes(classId));
      if (isAffected) {
        return { kind: 'event', customSchedule: custom_schedule, note, partial: !!affected_classes };
      }
      // 영향 없으면 정상 수업으로 진행
    }
  }

  // 정상 수업일
  return {
    kind: 'normal',
    tt: mergeChangesIntoTT(baseTT, changes, fmtDate(date)),
  };
}


// ═══════════════════════════════════════════════════════════════════
//  5. 검증 헬퍼 (Phase 3 의 관리자 AI 가 본격적으로 쓸 것이지만
//     Phase 1 에서도 시간표 보기 페이지에서 hover 정보로 활용 가능)
// ═══════════════════════════════════════════════════════════════════

// 특정 시간에 누가 비어있는지 (= 보강/교환 후보)
export function findFreeTeachersAt(teacherViewTT, day, period) {
  const key = slotKey(day, period);
  return TCH.filter(t => !teacherViewTT[t.id]?.[key]);
}

// 한 교사의 주간 누적 시수
export function countTeacherHours(teacherViewTT, tid) {
  return Object.keys(teacherViewTT[tid] || {}).length;
}
