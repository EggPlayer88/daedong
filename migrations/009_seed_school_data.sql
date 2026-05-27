-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A — 학교 정적 데이터 시드 (자동 생성)
-- ═══════════════════════════════════════════════════════════════════
-- 생성 출처: src/lib/timetableData.js (SBJ / CLS / DEPT / TCH 상수)
-- 생성 도구: 클로드 코드 자동 변환 스크립트 (Phase 5-A 작업)
--
-- 실행 순서: 008_phase5a_school_data.sql 먼저 실행 → 그 다음 이 파일.
-- 중복 실행 안전: subjects/classes/departments/teacher_assignments 는
--   ON CONFLICT DO UPDATE / DO NOTHING. teachers 는 ON CONFLICT DO NOTHING
--   (기존 Google 사용자 행 보호).
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- subjects (16개) — timetableData.SBJ mirror
-- ───────────────────────────────────────────────────────────────
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s1', '국어', 1, 4, 4, 4, 1)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s2', '사회', 3, 3, 0, 2, 2)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s3', '역사', 3, 0, 3, 2, 3)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s4', '도덕', 7, 3, 0, 2, 4)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s5', '수학', 0, 5, 4, 4, 5)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s6', '정보', 8, 0, 1, 0, 6)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s7', '기술가정', 6, 0, 3, 3, 7)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s8', '과학', 5, 3, 3, 4, 8)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s9', '체육', 10, 3, 3, 3, 9)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s10', '스포츠', 9, 1, 1, 1, 10)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s11', '음악', 2, 1, 1, 2, 11)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s12', '미술', 4, 2, 2, 0, 12)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s13', '진로', 6, 1, 1, 0, 13)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s14', '영어', 2, 3, 3, 4, 14)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s15', '보건', 7, 0, 1, 0, 15)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO subjects (id, name, color_index, hours_g1, hours_g2, hours_g3, display_order) VALUES ('s16', '한문', 9, 2, 1, 0, 16)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    color_index = EXCLUDED.color_index,
    hours_g1 = EXCLUDED.hours_g1,
    hours_g2 = EXCLUDED.hours_g2,
    hours_g3 = EXCLUDED.hours_g3,
    display_order = EXCLUDED.display_order,
    updated_at = now();

-- ───────────────────────────────────────────────────────────────
-- classes (9개) — timetableData.CLS mirror
-- ───────────────────────────────────────────────────────────────
INSERT INTO classes (id, name, grade, display_order) VALUES ('c1', '1-1반', 1, 1)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c2', '1-2반', 1, 2)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c3', '1-3반', 1, 3)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c4', '2-1반', 2, 4)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c5', '2-2반', 2, 5)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c6', '2-3반', 2, 6)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c7', '3-1반', 3, 7)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c8', '3-2반', 3, 8)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();
INSERT INTO classes (id, name, grade, display_order) VALUES ('c9', '3-3반', 3, 9)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    grade = EXCLUDED.grade,
    display_order = EXCLUDED.display_order,
    updated_at = now();

-- ───────────────────────────────────────────────────────────────
-- departments (6개) — timetableData.DEPT mirror
-- ───────────────────────────────────────────────────────────────
INSERT INTO departments (name, display_order) VALUES ('교무부', 1)
  ON CONFLICT (name) DO UPDATE SET
    display_order = EXCLUDED.display_order;
INSERT INTO departments (name, display_order) VALUES ('연구부', 2)
  ON CONFLICT (name) DO UPDATE SET
    display_order = EXCLUDED.display_order;
INSERT INTO departments (name, display_order) VALUES ('학생안전부', 3)
  ON CONFLICT (name) DO UPDATE SET
    display_order = EXCLUDED.display_order;
INSERT INTO departments (name, display_order) VALUES ('학생생활부', 4)
  ON CONFLICT (name) DO UPDATE SET
    display_order = EXCLUDED.display_order;
INSERT INTO departments (name, display_order) VALUES ('진로부', 5)
  ON CONFLICT (name) DO UPDATE SET
    display_order = EXCLUDED.display_order;
INSERT INTO departments (name, display_order) VALUES ('정보부', 6)
  ON CONFLICT (name) DO UPDATE SET
    display_order = EXCLUDED.display_order;

-- ───────────────────────────────────────────────────────────────
-- teachers placeholder 행 (24명) — timetableData.TCH mirror
-- ───────────────────────────────────────────────────────────────
-- ON CONFLICT (id) DO NOTHING — 기존 Google 사용자 행 보호.
-- 진짜 매핑 (placeholder ↔ 실 사용자) 은 Phase 6 인증 통합에서.
--
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t1', '국어T1', 'teacher', 'approved', 'c1', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t2', '국어T2', 'teacher', 'approved', 'c7', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t3', '국어T3', 'teacher', 'approved', NULL, ARRAY[1]::INTEGER[], TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t4', '사회', 'teacher', 'approved', 'c5', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t5', '역사', 'teacher', 'approved', 'c6', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t6', '도덕', 'teacher', 'approved', 'c3', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t7', '수학T1', 'teacher', 'approved', 'c2', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t8', '수학T2', 'teacher', 'approved', 'c4', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t9', '수학T3', 'teacher', 'approved', 'c9', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t10', '기술가정', 'teacher', 'approved', 'c8', NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('ti', '정보', 'teacher', 'approved', NULL, ARRAY[3]::INTEGER[], TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t11', '과학T1', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t12', '과학T2', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('ts3', '과학T3', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t13', '체육T1', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t14', '체육T2', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t15', '스포츠강사', 'teacher', 'approved', NULL, NULL, TRUE, TRUE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t16', '음악', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t17', '미술', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t18', '진로', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t19', '영어T1', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t20', '영어T2', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t21', '보건', 'teacher', 'approved', NULL, NULL, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO teachers (id, name, role, status, homeroom_class_id, day_restriction, is_placeholder, is_external) VALUES ('t22', '한문', 'teacher', 'approved', NULL, ARRAY[0,2]::INTEGER[], TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- teacher_assignments (123건) — timetableData.TCH.as mirror
-- ───────────────────────────────────────────────────────────────
-- UNIQUE (teacher_id, subject_id, class_id) 로 중복 방지.
-- ON CONFLICT DO UPDATE 로 hours 값만 갱신 (재실행 시 최신화).
--
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t1', 's1', 'c3', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t1', 's1', 'c7', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t1', 's1', 'c8', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t1', 's1', 'c9', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t2', 's1', 'c1', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t2', 's1', 'c2', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t2', 's1', 'c4', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t2', 's1', 'c5', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t2', 's1', 'c6', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t3', 's1', 'c1', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t3', 's1', 'c2', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t3', 's1', 'c3', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t3', 's1', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t3', 's1', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t4', 's2', 'c1', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t4', 's2', 'c2', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t4', 's2', 'c3', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t4', 's2', 'c7', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t4', 's2', 'c8', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t4', 's2', 'c9', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t5', 's3', 'c4', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t5', 's3', 'c5', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t5', 's3', 'c6', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t5', 's3', 'c7', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t5', 's3', 'c8', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t5', 's3', 'c9', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t6', 's4', 'c1', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t6', 's4', 'c2', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t6', 's4', 'c3', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t6', 's4', 'c7', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t6', 's4', 'c8', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t6', 's4', 'c9', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t7', 's5', 'c1', 5)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t7', 's5', 'c2', 5)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t7', 's5', 'c3', 5)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t8', 's5', 'c4', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t8', 's5', 'c5', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t8', 's5', 'c6', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t9', 's5', 'c7', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t9', 's5', 'c8', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t9', 's5', 'c9', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t10', 's7', 'c4', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t10', 's7', 'c5', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t10', 's7', 'c6', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t10', 's7', 'c7', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t10', 's7', 'c8', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t10', 's7', 'c9', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('ti', 's6', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('ti', 's6', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('ti', 's6', 'c6', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t11', 's8', 'c7', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t11', 's8', 'c8', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t11', 's8', 'c9', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t12', 's8', 'c1', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t12', 's8', 'c2', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t12', 's8', 'c3', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t12', 's8', 'c4', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t12', 's8', 'c5', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t12', 's8', 'c6', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('ts3', 's8', 'c1', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('ts3', 's8', 'c2', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('ts3', 's8', 'c3', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c1', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c2', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c3', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c7', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c8', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t13', 's9', 'c9', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t14', 's9', 'c1', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t14', 's9', 'c2', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t14', 's9', 'c3', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t14', 's9', 'c4', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t14', 's9', 'c5', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t14', 's9', 'c6', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c1', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c2', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c3', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c6', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c7', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c8', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t15', 's10', 'c9', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c1', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c2', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c3', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c6', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c7', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c8', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t16', 's11', 'c9', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t17', 's12', 'c1', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t17', 's12', 'c2', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t17', 's12', 'c3', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t17', 's12', 'c4', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t17', 's12', 'c5', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t17', 's12', 'c6', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t18', 's13', 'c1', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t18', 's13', 'c2', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t18', 's13', 'c3', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t18', 's13', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t18', 's13', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t18', 's13', 'c6', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t19', 's14', 'c2', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t19', 's14', 'c3', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t19', 's14', 'c4', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t19', 's14', 'c5', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t19', 's14', 'c6', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t20', 's14', 'c1', 3)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t20', 's14', 'c7', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t20', 's14', 'c8', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t20', 's14', 'c9', 4)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t21', 's15', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t21', 's15', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t21', 's15', 'c6', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t22', 's16', 'c1', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t22', 's16', 'c2', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t22', 's16', 'c3', 2)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t22', 's16', 'c4', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t22', 's16', 'c5', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, hours) VALUES ('t22', 's16', 'c6', 1)
  ON CONFLICT (teacher_id, subject_id, class_id) DO UPDATE SET hours = EXCLUDED.hours;

-- ───────────────────────────────────────────────────────────────
-- 검증 쿼리 (실행자가 직접 돌려보기)
-- ───────────────────────────────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM subjects)              AS subjects,         -- 기대: 16
--   (SELECT count(*) FROM classes)               AS classes,          -- 기대: 9
--   (SELECT count(*) FROM departments)           AS departments,      -- 기대: 6
--   (SELECT count(*) FROM teachers WHERE is_placeholder=TRUE) AS placeholders, -- 기대: 24
--   (SELECT count(*) FROM teacher_assignments)   AS assignments;      -- 기대: 123
--
-- -- 기존 Google 사용자 보호 확인 (이전과 동일해야 함):
-- SELECT count(*) FROM teachers WHERE user_id IS NOT NULL;
