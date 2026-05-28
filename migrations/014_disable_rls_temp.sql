-- ═══════════════════════════════════════════════════════════════════
-- 014 (M4) — 보존 테이블 RLS 임시 비활성화 (Phase 6 까지)
-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A 잔재 정비 4단계 중 4단계.
-- 선행: 013 완료 + 앱 동작 체크리스트 6개 통과.
-- 후행: 009 재실행(시드).
--
-- 결정: 정책을 DROP 하지 않고 비활성화만 (Phase 6 RLS 재설계 시 참고 자산).
--   섹션6 기준 보존 테이블 중 RLS ON = teachers / documents / tasks (events 는 이미 OFF).
--   get_my_role() / handle_new_user() 는 유지 — 비활성화와 무관, Phase 6 에서 재사용.
--   ※ storage.objects(스토리지 스키마)는 이번 범위 밖 — Phase 6 인증 통합에서 일괄.
--
-- ROLLBACK 범위: 실패 시 3개 테이블 RLS 상태 원복. 정책 정의는 손상되지 않음.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE teachers  DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks     DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- 검증 (COMMIT 후 실행, 기대: 셋 다 rowsecurity = false)
-- ───────────────────────────────────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname='public' AND tablename IN ('teachers','documents','tasks')
ORDER BY tablename;
