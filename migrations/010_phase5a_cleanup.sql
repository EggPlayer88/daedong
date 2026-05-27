-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A 정비 — 이전 작업자의 DB 잔재 정리 + D6 컴플라이언스 회복
-- ═══════════════════════════════════════════════════════════════════
-- 작성일: 2026-05-27
--
-- 배경:
--   Phase 5-A 코드 작업 (커밋 b2d05ce) 완료 후 DB 점검에서 이전 작업자가
--   남긴 시간표 솔버 DB 화 시도의 광범위한 잔재가 발견됨.
--   008/009 의 신규 테이블과 충돌하지 않게 별도 정비 마이그레이션으로 분리.
--
-- 핵심 충돌:
--   · D6 결정 (모든 사용자 ID 컬럼 영구 TEXT) 과 달리 teachers.id 가 UUID.
--   · t1~t22 placeholder INSERT (009 시드) 가 타입 충돌로 실패한 원인.
--
-- 진단 결과 (계란님 Supabase 확인, 2026-05-27):
--   · timetables.data 의 tid: t2, t4, t7, t12, t14, t20 형식 (TEXT) — 매핑 불필요.
--   · events.created_by 1건: 계란님 본인 UUID (`7ac5cbc9-...`) — TEXT 캐스트 시 동일 값 보존.
--   · teacher_constraints: 0건 + FK CASCADE — 안전 DROP 가능.
--   · documents.uploaded_by: 0건 — 캐스트 부담 없음.
--
-- FK 3개 (모두 teachers.id 참조):
--   · teacher_constraints.teacher_id   ON DELETE CASCADE
--   · events.created_by                ON DELETE SET NULL
--   · documents.uploaded_by            ON DELETE SET NULL
--
-- 확정된 결정 (DECISIONS.md "Phase 5-A 정비" 절 참조):
--   1. D6 유지 — teachers.id 영구 TEXT.
--   2. 잔재 컬럼 DROP — is_homeroom, is_parttime, allowed_days (코드 참조 0건).
--   3. teacher_constraints 테이블 DROP (코드 참조 0건).
--   4. 의존 FK 3개도 TEXT 로 동시 변경 + FK 재생성 (TEXT ↔ TEXT).
--   5. 기존 데이터 (teachers 1행, events 1행) 모두 보존.
--
-- 안전성:
--   · 한 트랜잭션 (BEGIN/COMMIT) 으로 묶음 — 어느 한 단계라도 실패하면 전체 ROLLBACK.
--   · ALTER COLUMN TYPE USING ... ::text — UUID 값은 그대로 TEXT 표현으로 보존.
--   · placeholder 시드 (009) 는 이 마이그레이션 적용 후 재실행.
--
-- 실행 순서:
--   1) 이 파일을 Supabase SQL Editor 에서 한 번에 실행.
--   2) 성공 확인 후 009_seed_school_data.sql 재실행 → placeholder 24명 + 시수 123건 채워짐.
--   3) 검증 쿼리는 파일 끝 주석 참조.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1단계: 의존 FK 임시 제거
--   teachers.id 의 TYPE 을 바꾸려면 참조하는 FK 를 먼저 떼야 함.
--   (PostgreSQL 은 TYPE mismatch FK 를 허용 안 함.)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE teacher_constraints DROP CONSTRAINT IF EXISTS teacher_constraints_teacher_id_fkey;
ALTER TABLE events              DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE documents           DROP CONSTRAINT IF EXISTS documents_uploaded_by_fkey;


-- ───────────────────────────────────────────────────────────────
-- 2단계: 잔재 테이블 DROP
--   teacher_constraints — 이전 작업자가 만들었으나 코드 참조 0건 (src/ + api/ grep 확인).
--   CASCADE 로 잔존 인덱스/트리거까지 정리.
-- ───────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS teacher_constraints CASCADE;


-- ───────────────────────────────────────────────────────────────
-- 3단계: teachers.id TYPE 변경 (UUID → TEXT)
--   D6 결정에 따라 placeholder (t1~t22) 와 실 사용자 (UUID 형식 TEXT) 공존하려면
--   id 컬럼이 TEXT 여야 함. 기존 UUID 값은 '7ac5cbc9-4031-...' 형식 문자열로 자동 보존.
-- ───────────────────────────────────────────────────────────────
ALTER TABLE teachers ALTER COLUMN id TYPE TEXT USING id::text;


-- ───────────────────────────────────────────────────────────────
-- 4단계: 의존 컬럼 TYPE 변경 (UUID → TEXT)
--   FK 가 다시 걸릴 수 있도록 참조 컬럼도 TEXT 로.
--   teacher_constraints 는 이미 DROP 됐으므로 events / documents 만.
-- ───────────────────────────────────────────────────────────────
ALTER TABLE events    ALTER COLUMN created_by  TYPE TEXT USING created_by::text;
ALTER TABLE documents ALTER COLUMN uploaded_by TYPE TEXT USING uploaded_by::text;


-- ───────────────────────────────────────────────────────────────
-- 5단계: teachers 의 잔재 컬럼 DROP
--   Phase 5-A 의 신규 컬럼 (homeroom_class_id / day_restriction / is_external) 과
--   의미 중복. 코드 참조 0건 (grep 확인) → 안전 삭제.
--
--   참고: 기존 homeroom 컬럼 (text) 은 보존 — Phase 5-A 결정 4 (D1).
-- ───────────────────────────────────────────────────────────────
ALTER TABLE teachers DROP COLUMN IF EXISTS is_homeroom;
ALTER TABLE teachers DROP COLUMN IF EXISTS is_parttime;
ALTER TABLE teachers DROP COLUMN IF EXISTS allowed_days;


-- ───────────────────────────────────────────────────────────────
-- 6단계: FK 재생성 (TEXT ↔ TEXT)
--   원래의 ON DELETE 정책을 그대로 복원.
--   teacher_constraints 는 DROP 됐으므로 events / documents 만 재생성.
-- ───────────────────────────────────────────────────────────────
ALTER TABLE events
  ADD CONSTRAINT events_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES teachers(id) ON DELETE SET NULL;

ALTER TABLE documents
  ADD CONSTRAINT documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES teachers(id) ON DELETE SET NULL;


COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- 검증 쿼리 (실행자가 직접 돌려보기)
-- ═══════════════════════════════════════════════════════════════════
--
-- ─── 1) teachers 컬럼 구조: id=text, 잔재 컬럼 없음 ───
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'teachers'
-- ORDER BY ordinal_position;
--
--   기대: id 행의 data_type = 'text'.
--         is_homeroom / is_parttime / allowed_days 행이 없음.
--         homeroom_class_id / day_restriction / is_placeholder / is_external 행은 그대로 존재.
--
--
-- ─── 2) FK 가 TEXT ↔ TEXT 로 재생성됨 ───
-- SELECT conrelid::regclass AS table, conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE contype = 'f'
--   AND confrelid = 'teachers'::regclass
-- ORDER BY conname;
--
--   기대: events_created_by_fkey, documents_uploaded_by_fkey 두 개.
--         teacher_constraints_* 는 없음.
--
--
-- ─── 3) 기존 데이터 보존 확인 ───
-- SELECT count(*) AS teachers_count FROM teachers;
-- SELECT count(*) AS events_with_creator   FROM events    WHERE created_by  IS NOT NULL;
-- SELECT count(*) AS docs_with_uploader    FROM documents WHERE uploaded_by IS NOT NULL;
--
--   기대 (정비 직후, 009 재실행 전):
--     teachers_count        = 1   (계란님 본인)
--     events_with_creator   = 1   (계란님의 일정 1건)
--     docs_with_uploader    = 0
--
--
-- ─── 4) teacher_constraints 테이블 없음 ───
-- SELECT EXISTS (
--   SELECT 1 FROM information_schema.tables WHERE table_name = 'teacher_constraints'
-- ) AS still_exists;
--
--   기대: still_exists = false.
--
--
-- ─── 5) 009 시드 재실행 후 ───
--   migrations/009_seed_school_data.sql 을 다시 실행.
--   기대:
--     SELECT count(*) FROM teachers WHERE is_placeholder = TRUE;  -- 24
--     SELECT count(*) FROM teacher_assignments;                   -- 123
--     SELECT count(*) FROM subjects;                              -- 16
--     SELECT count(*) FROM classes;                               -- 9
--     SELECT count(*) FROM departments;                           -- 6
--     SELECT count(*) FROM teachers WHERE user_id IS NOT NULL;    -- 1 (계란님 보존)
-- ═══════════════════════════════════════════════════════════════════
