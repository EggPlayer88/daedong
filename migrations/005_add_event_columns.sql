-- ═══════════════════════════════════════════════════════════════════
-- 정리 작업 1 보강 — events 테이블에 priority/tags/dept 컬럼 추가
-- ═══════════════════════════════════════════════════════════════════
-- 배경: 004 마이그레이션은 events 테이블이 이미 존재하는 환경에서
--       CREATE TABLE IF NOT EXISTS 라 컬럼 추가가 안 됨.
--       별도 ALTER TABLE 로 누락 컬럼 보강.
--
-- 컬럼 의미:
--   priority — '높음' | '중간' | '낮음' (대시보드에서 우선순위 표시)
--   tags     — ['전체','담임','교과', ...] (대시보드에서 본인 관련 일정 필터링)
--   dept     — '교무' | '학년1' | '수학과' 등 (부서 일정 매칭)
--
-- SchedulePage 폼 보강은 별도 단계 (정리 작업 2 — 일정 시스템 보강) 에서.
-- 본 마이그레이션 직후에는 모든 일정의 priority/tags/dept 가 NULL.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS dept TEXT;
