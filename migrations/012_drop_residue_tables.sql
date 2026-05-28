-- ═══════════════════════════════════════════════════════════════════
-- 012 (M2) — 잔재 10개 테이블 DROP CASCADE
-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A 잔재 정비 4단계 중 2단계.
-- 선행: 011 완료 + 데이터 있는 4개(period_config/rooms/school_settings/special_slots)
--       SELECT 스냅샷을 db-survey-results/abandoned-data-snapshot.txt 로 저장 완료.
-- 후행: 013(teachers 타입 변경).
--
-- ⚠️ 운영 가이드 (M2 ~ M3 구간 — 매우 중요):
--   · 이 구간 동안 본인(계란)도 앱에 접속하지 말 것 — 시범운영 중이라도.
--   · teachers 타입 변경(013)과 사용자 트래픽이 겹치면 트랜잭션 락 +
--     일관성 문제가 발생할 수 있음.
--   · 012 → 013 → 014 → 009 재실행까지 한 세션에 연달아 끝내고,
--     그동안 앱 미접속을 권장.
--
-- 대상: 코드 from() 0참조 확정(src/ + api/ grep). 이전 작업자의 솔버 DB화 시도 잔재.
--   CASCADE 가 각 테이블의 정책/인덱스/제약/FK 를 함께 정리.
--   잔재→잔재 FK 만 존재(swap_requests→timetable_entries→rooms,
--   teacher_constraints→teachers) — 보존 13개 테이블을 가리키는 FK 는 없음(섹션4 확인).
--   → 보존 테이블에 CASCADE 가 번지지 않음. 영향 0.
--
-- ROLLBACK 범위: 이 트랜잭션 실패 시 10개 테이블 전부 원복. 보존 13개 무관.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS academic_events     CASCADE;
DROP TABLE IF EXISTS period_config       CASCADE;
DROP TABLE IF EXISTS rooms               CASCADE;
DROP TABLE IF EXISTS schedules           CASCADE;
DROP TABLE IF EXISTS school_settings     CASCADE;
DROP TABLE IF EXISTS special_slots       CASCADE;
DROP TABLE IF EXISTS swap_requests       CASCADE;
DROP TABLE IF EXISTS teacher_constraints CASCADE;
DROP TABLE IF EXISTS teacher_subjects    CASCADE;
DROP TABLE IF EXISTS timetable_entries   CASCADE;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- 검증 (COMMIT 후 실행, 기대: residue_left = 0)
-- ───────────────────────────────────────────────────────────────
SELECT count(*) AS residue_left
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('academic_events','period_config','rooms','schedules',
                     'school_settings','special_slots','swap_requests',
                     'teacher_constraints','teacher_subjects','timetable_entries');
