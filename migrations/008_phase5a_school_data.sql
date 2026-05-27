-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A — 학교 정적 데이터 DB 화 (기본 스키마 + 컬럼 보강)
-- ═══════════════════════════════════════════════════════════════════
-- 목적:
--   src/lib/timetableData.js 의 SBJ / CLS / DEPT / TCH 상수를
--   DB 의 mirror 테이블로 옮기는 첫 단계.
--
--   D3 결정: 코드 변경 0. timetableData.js 가 진실의 원천 유지.
--   DB 는 mirror — Phase 5-B 에서 학교 설정 페이지 부활 시 진실의 원천 전환.
--
--   D6 결정: 모든 사용자/엔티티 ID 컬럼은 영구 TEXT.
--   Phase 6 의 "UUID 컬럼 복원 (003 역방향)" 결정 폐기.
--
-- 시드 데이터는 별도 파일 (009_seed_school_data.sql) 에서 실행.
--
-- RLS 일괄 비활성화 — 007 사고 (Supabase 가 새 테이블에 기본 RLS 활성화)
-- 재발 방지. Phase 6 인증 통합 시 일괄 RLS 정책 설계.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 1. subjects (과목)
--   timetableData.SBJ 의 mirror. id=TEXT PK (s1~s16).
--   color_index=ci, hours_g1/g2/g3=gh[1]/gh[2]/gh[3].
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  color_index   INTEGER NOT NULL DEFAULT 0,
  hours_g1      INTEGER NOT NULL DEFAULT 0,
  hours_g2      INTEGER NOT NULL DEFAULT 0,
  hours_g3      INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subjects DISABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────
-- 2. classes (학급)
--   timetableData.CLS 의 mirror. id=TEXT PK (c1~c9).
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS classes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  grade         INTEGER NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE classes DISABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────
-- 3. departments (부서)
--   timetableData.DEPT 의 mirror. 부서명 자체가 PK (D2 결정).
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  name          TEXT PRIMARY KEY,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE departments DISABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────
-- 4. teachers — 기존 테이블 + 컬럼 보강
--   기존 컬럼 (유지): id, user_id, name, email, role, status, dept,
--                     area, subject, homeroom, created_at
--   신규 컬럼 (Phase 5-A):
--     · homeroom_class_id  — TCH.hc 대응 (D1: 기존 homeroom 컬럼은 보존)
--     · day_restriction    — TCH.al 대응 (D5: INTEGER[] 단일 컬럼)
--     · is_placeholder     — D2: TCH 시드 행 표시
--     · is_external        — TCH.isExt 대응 (외부강사)
--
--   FK 제약 없음 — placeholder 행 + 실 사용자 행 공존 (D6) 을 위해.
--   기존 homeroom 컬럼은 deprecated. DROP 안 함 (정리 2-A 의 scope 컬럼과 동일 패턴).
-- ───────────────────────────────────────────────────────────────
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS homeroom_class_id TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS day_restriction   INTEGER[];
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_placeholder    BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_external       BOOLEAN DEFAULT FALSE;

-- placeholder 조회 가속 (Phase 5-B / Phase 6 에서 자주 필터링됨)
CREATE INDEX IF NOT EXISTS idx_teachers_is_placeholder
  ON teachers (is_placeholder)
  WHERE is_placeholder = TRUE;


-- ───────────────────────────────────────────────────────────────
-- 5. teacher_assignments (교사별 표준시수)
--   timetableData.TCH.as 의 mirror. 한 행 = 한 교사가 한 학급에서
--   한 과목을 주당 N시간 가르치는 표준시수.
--
--   FK 안 검 — placeholder 자유 + 시드 단순화 (D2/D6).
--   id 는 UUID — 자연 PK 가 (teacher,subject,class) 3-tuple 이라
--   UNIQUE 제약으로 무결성 확보 + 행 식별은 UUID.
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   TEXT    NOT NULL,
  subject_id   TEXT    NOT NULL,
  class_id     TEXT    NOT NULL,
  hours        INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (teacher_id, subject_id, class_id)
);

ALTER TABLE teacher_assignments DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON teacher_assignments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class   ON teacher_assignments (class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject ON teacher_assignments (subject_id);


-- ───────────────────────────────────────────────────────────────
-- 검증 쿼리 (선택, 실행자가 직접 돌려보기)
-- ───────────────────────────────────────────────────────────────
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_name IN ('subjects', 'classes', 'departments', 'teacher_assignments')
-- ORDER BY table_name;
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'teachers'
--   AND column_name IN ('homeroom_class_id', 'day_restriction', 'is_placeholder', 'is_external')
-- ORDER BY column_name;
