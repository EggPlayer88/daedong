-- ============================================================================
-- 009_seed.sql
-- daedong-v2 마이그레이션 009 — 시드: 부서 6개 + 2026학년도 2학기
--
-- 선행: 001~008 (필수 의존은 001 departments, 007 academic_terms)
-- 실행 시점: Phase 1 말. ⚠ 1회만 실행 (departments 는 중복 방지 제약이 없어
--            재실행 시 부서가 중복 생성됨)
--
-- 판정 기록 (2026-08-16, 계란):
--   - 부서 6개 = 실제 부서 명단 → v1 departments 원본 그대로 이관
--     (v1 display_order → v2 sort_order)
--   - v1 업무종류(v1 public.tasks) 5건 = 샘플 데이터로 판정 → 폐기 (D3 갱신)
--     원본은 backup/v1_tasks_duty_catalog.csv 에 보존, 양식 참고용으로 부활 가능
--   - handover_docs 는 빈 상태로 시작 (Phase 3 에서 실데이터 입력)
--   - 계정 시드 없음: D17 (첫 로그인 + 승격 UPDATE) 로 대체
-- ============================================================================

INSERT INTO public.departments (name, sort_order) VALUES
  ('교무부', 1),
  ('연구부', 2),
  ('학생안전부', 3),
  ('학생생활부', 4),
  ('진로부', 5),
  ('정보부', 6);

-- 2026학년도 2학기 (시작/종료일은 학사일정 확정 후 UPDATE 로 채움)
INSERT INTO public.academic_terms (year, semester)
VALUES (2026, 2)
ON CONFLICT (year, semester) DO NOTHING;

-- ============================================================================
-- [검증] 실행 후 별도 Run:
-- SELECT name, sort_order FROM departments ORDER BY sort_order;  → 6행
-- SELECT year, semester FROM academic_terms;                     → 2026 / 2
-- ============================================================================
