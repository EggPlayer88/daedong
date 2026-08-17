-- ============================================================================
-- 003_signup_approval.sql
-- daedong-v2 마이그레이션 003 — 가입 승인제 (임시 제도, D20)
--
-- 목적: Google 가입 즉시 사용 가능하던 것을 → 가입 시 "대기(is_active=false)" 로
--       생성하고, admin+ 가 /admin/users 에서 승인해야 사용 가능하게.
--       (미승인 계정의 데이터 열람·문서작성 AI 비용 발생 차단)
-- 선행: 001, 002. 실행 후 migrations/README.md 기록 (P7).
-- 참고: 001 의 protect_privileged_columns 트리거가 is_active 변경을 admin+ 로
--       이미 제한하므로 승인 권한이 자연스럽게 성립한다.
-- 주의: 이미 승인된 기존 사용자(계란님 superadmin 포함)는 영향 없음.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 승인 여부 헬퍼 (D15 원칙: 정책 내 판단은 SECURITY DEFINER 함수 경유)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.users WHERE id = auth.uid()::text),
    false
  )
$$;

-- ----------------------------------------------------------------------------
-- 2. 신규 가입 기본값 변경 — 대기 상태로 생성
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, is_active)
  VALUES (
    NEW.id::text,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    false                                   -- ★ 승인 전 대기
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. 미승인 사용자 차단 — 공유 조회면과 쓰기 진입점에 is_approved() 게이트
--    (users 는 본인 행만 예외 허용 — 대기 화면에서 자기 이름·상태를 봐야 함)
-- ----------------------------------------------------------------------------
DROP POLICY users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid()::text OR public.is_approved());

DROP POLICY departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments
  FOR SELECT TO authenticated
  USING (public.is_approved());

DROP POLICY schedules_select ON public.schedules;
CREATE POLICY schedules_select ON public.schedules
  FOR SELECT TO authenticated
  USING (public.is_approved());

DROP POLICY schedules_insert ON public.schedules;
CREATE POLICY schedules_insert ON public.schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved() AND created_by = auth.uid()::text);

DROP POLICY tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_approved() AND (
      (assigner_id IS NULL AND assignee_id = auth.uid()::text)
      OR
      (assigner_id = auth.uid()::text AND public.can_assign_task(assignee_id))
    )
  );

-- schedules_update/delete 는 created_by 조건이 이미 미승인자를 배제 (본인 작성물이
-- 있을 수 없음), tasks select/update/delete 는 assignee/assigner 범위라 유지.

-- ============================================================================
-- [검증] 실행 후 별도 Run:
-- SELECT policyname FROM pg_policies WHERE schemaname='public' ORDER BY 1;
--   → users_select / departments_select / schedules_select·insert / tasks_insert 존재
-- SELECT proname FROM pg_proc WHERE proname = 'is_approved';   → 1행
--
-- [운영] 승인 = /admin/users 대기 목록에서 버튼 (내부적으로 UPDATE users
--        SET is_active = true WHERE id = ...). SQL 로도 가능:
--        UPDATE public.users SET is_active = true WHERE email = '교사이메일';
--
-- [제도 폐지 시] handle_new_user 의 is_active 를 true 로 원복하고
--        이 파일의 정책 5개를 001·002 원형으로 되돌리는 마이그레이션을 새 번호로 작성
-- ============================================================================
