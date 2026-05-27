// ═══════════════════════════════════════════════════════════════════
//  schoolDataAPI.js — DB 의 학교 정적 데이터 mirror 조회 API
// ═══════════════════════════════════════════════════════════════════
//  Phase 5-A 에서 신설. 진실의 원천은 여전히 src/lib/timetableData.js.
//  DB 는 mirror — 008 마이그레이션의 subjects/classes/departments/
//  teacher_assignments + teachers 의 placeholder 행이 채워져 있음.
//
//  현재 단계 (D3 = C-2): 사용처 없음. Phase 5-B 의 학교 설정 페이지가
//  부활할 때 진실의 원천 전환을 위한 fetch 계층.
//
//  단, verifySchoolDataIntegrity() 는 시범운영 중 양면 일치 검증에
//  바로 활용 가능. 브라우저 콘솔에서 호출.
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

// ─── 과목 ───
export async function listSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, color_index, hours_g1, hours_g2, hours_g3, display_order')
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getSubject(id) {
  if (!id) throw new Error('subject id 가 필요합니다');
  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── 학급 ───
export async function listClasses() {
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, grade, display_order')
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getClass(id) {
  if (!id) throw new Error('class id 가 필요합니다');
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── 부서 ───
export async function listDepartments() {
  const { data, error } = await supabase
    .from('departments')
    .select('name, display_order')
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ─── 교사 ───
//  placeholder + 실 사용자 모두 반환. 필터 옵션:
//    { placeholderOnly: true }  → is_placeholder=TRUE
//    { realUsersOnly: true }    → is_placeholder=FALSE (또는 NULL)
export async function listTeachers(options = {}) {
  let q = supabase
    .from('teachers')
    .select('id, name, email, role, status, dept, area, subject, homeroom, homeroom_class_id, day_restriction, is_placeholder, is_external, user_id, created_at')
    .order('id', { ascending: true });
  if (options.placeholderOnly) q = q.eq('is_placeholder', true);
  if (options.realUsersOnly)   q = q.or('is_placeholder.is.null,is_placeholder.eq.false');
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getTeacher(id) {
  if (!id) throw new Error('teacher id 가 필요합니다');
  const { data, error } = await supabase
    .from('teachers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── 교사별 표준시수 ───
//  teacherId 지정 시 그 교사만, 미지정 시 전체.
export async function listTeacherAssignments(teacherId = null) {
  let q = supabase
    .from('teacher_assignments')
    .select('teacher_id, subject_id, class_id, hours');
  if (teacherId) q = q.eq('teacher_id', teacherId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════
//  verifySchoolDataIntegrity — 코드 seed 와 DB seed 일치 검증
// ═══════════════════════════════════════════════════════════════════
//  Phase 5-A 의 D3=C-2 정책에서는 코드와 DB 가 같은 값이어야 정상.
//  이 함수가 차이를 발견하면 콘솔에 보고. 사용자가 schoolDataAPI 호출
//  결과를 보고 마이그레이션 누락/실패를 확인할 수 있음.
//
//  사용 (브라우저 콘솔):
//    import('./src/lib/schoolDataAPI.js').then(m => m.verifySchoolDataIntegrity())
// ═══════════════════════════════════════════════════════════════════
export async function verifySchoolDataIntegrity() {
  // 동적 import — schoolDataAPI 가 timetableData 를 정적 의존하지 않도록.
  // (timetableData 도 단순 데이터라 정적 import 도 안전하지만, 분리 원칙)
  const td = await import('./timetableData.js');
  const { SBJ, CLS, DEPT, TCH } = td;

  const report = { ok: true, mismatches: [] };

  const note = (msg) => { report.ok = false; report.mismatches.push(msg); };

  // ─── 과목 ───
  const dbSubjects = await listSubjects();
  if (dbSubjects.length !== SBJ.length) {
    note(`subjects count 불일치: code=${SBJ.length}, db=${dbSubjects.length}`);
  }
  SBJ.forEach(s => {
    const row = dbSubjects.find(x => x.id === s.id);
    if (!row) { note(`subject 누락: ${s.id} (${s.name})`); return; }
    if (row.name !== s.name)         note(`subject ${s.id} name: code=${s.name}, db=${row.name}`);
    if (row.color_index !== s.ci)    note(`subject ${s.id} color_index: code=${s.ci}, db=${row.color_index}`);
    if (row.hours_g1 !== (s.gh[1]||0)) note(`subject ${s.id} hours_g1: code=${s.gh[1]||0}, db=${row.hours_g1}`);
    if (row.hours_g2 !== (s.gh[2]||0)) note(`subject ${s.id} hours_g2: code=${s.gh[2]||0}, db=${row.hours_g2}`);
    if (row.hours_g3 !== (s.gh[3]||0)) note(`subject ${s.id} hours_g3: code=${s.gh[3]||0}, db=${row.hours_g3}`);
  });

  // ─── 학급 ───
  const dbClasses = await listClasses();
  if (dbClasses.length !== CLS.length) {
    note(`classes count 불일치: code=${CLS.length}, db=${dbClasses.length}`);
  }
  CLS.forEach(c => {
    const row = dbClasses.find(x => x.id === c.id);
    if (!row) { note(`class 누락: ${c.id} (${c.name})`); return; }
    if (row.name !== c.name)  note(`class ${c.id} name: code=${c.name}, db=${row.name}`);
    if (row.grade !== c.g)    note(`class ${c.id} grade: code=${c.g}, db=${row.grade}`);
  });

  // ─── 부서 ───
  const dbDepts = await listDepartments();
  if (dbDepts.length !== DEPT.length) {
    note(`departments count 불일치: code=${DEPT.length}, db=${dbDepts.length}`);
  }
  DEPT.forEach(d => {
    if (!dbDepts.find(x => x.name === d)) note(`department 누락: ${d}`);
  });

  // ─── 교사 (placeholder 만) ───
  const dbTeachersPh = await listTeachers({ placeholderOnly: true });
  if (dbTeachersPh.length !== TCH.length) {
    note(`teachers(placeholder) count 불일치: code=${TCH.length}, db=${dbTeachersPh.length}`);
  }
  TCH.forEach(t => {
    const row = dbTeachersPh.find(x => x.id === t.id);
    if (!row) { note(`teacher placeholder 누락: ${t.id} (${t.name})`); return; }
    if (row.name !== t.name)                 note(`teacher ${t.id} name: code=${t.name}, db=${row.name}`);
    if ((row.homeroom_class_id||null) !== (t.hc||null))
      note(`teacher ${t.id} homeroom_class_id: code=${t.hc||'NULL'}, db=${row.homeroom_class_id||'NULL'}`);
    const codeAl = t.al ? [...t.al].sort().join(',') : '';
    const dbAl   = Array.isArray(row.day_restriction) ? [...row.day_restriction].sort().join(',') : '';
    if (codeAl !== dbAl) note(`teacher ${t.id} day_restriction: code=[${codeAl}], db=[${dbAl}]`);
    if (!!row.is_external !== !!t.isExt) note(`teacher ${t.id} is_external: code=${!!t.isExt}, db=${!!row.is_external}`);
  });

  // ─── teacher_assignments ───
  const dbAssigns = await listTeacherAssignments();
  const codeAssignCount = TCH.reduce((s, t) => s + t.as.length, 0);
  if (dbAssigns.length !== codeAssignCount) {
    note(`teacher_assignments count 불일치: code=${codeAssignCount}, db=${dbAssigns.length}`);
  }
  TCH.forEach(t => {
    t.as.forEach(a => {
      const row = dbAssigns.find(r => r.teacher_id === t.id && r.subject_id === a.s && r.class_id === a.c);
      if (!row) { note(`assignment 누락: ${t.id}/${a.s}/${a.c}`); return; }
      if (row.hours !== a.h) note(`assignment ${t.id}/${a.s}/${a.c} hours: code=${a.h}, db=${row.hours}`);
    });
  });

  // ─── 보고 ───
  if (report.ok) {
    console.log('%c✅ school data integrity: all match', 'color:#34d399;font-weight:bold');
  } else {
    console.warn('%c⚠️ school data integrity: mismatches', 'color:#fbbf24;font-weight:bold');
    report.mismatches.forEach(m => console.warn('  -', m));
  }
  return report;
}
