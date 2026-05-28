-- ═══════════════════════════════════════════════════════════════════
-- 011 (M1) — 잔재 이벤트 트리거 + rls_auto_enable 함수 제거
-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A 잔재 정비 4단계 중 1단계 (다른 작업 전 가장 먼저 실행).
-- 후행: 012(잔재 테이블) → 013(teachers 타입) → 014(RLS) → 009 재실행(시드).
--
-- ensure_rls: 새 테이블 생성 시 RLS 를 자동으로 켜는 DDL 이벤트 트리거.
--   정리 2-B 의 notes 403 사고의 진짜 원인이자, Phase 5-B 에서 새 테이블 만들 때
--   같은 사고가 재발할 시한폭탄.
-- rls_auto_enable(): 그 트리거가 호출하는 함수.
--   ※ 이름이 다름 (트리거=ensure_rls, 함수=rls_auto_enable) — 둘 다 제거해야 함.
--   ※ Supabase 시스템 이벤트 트리거 6개(issue_*, pgrst_*)는 건드리지 않음.
--
-- ROLLBACK 범위: 이 트랜잭션(BEGIN/COMMIT) 실패 시 트리거/함수 둘 다 원복.
--   다른 객체 영향 0.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DROP EVENT TRIGGER IF EXISTS ensure_rls;
DROP FUNCTION IF EXISTS public.rls_auto_enable();

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- 검증 (COMMIT 후 실행, 기대: 둘 다 0)
-- ───────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_event_trigger WHERE evtname = 'ensure_rls')  AS ensure_rls_left,
  (SELECT count(*) FROM pg_proc WHERE proname = 'rls_auto_enable')      AS func_left;
