-- ============================================================================
-- 001_users_departments.sql
-- daedong-v2 마이그레이션 001 — 기반: departments, users, 헬퍼 함수, 트리거, RLS
--
-- 실행: 새 Supabase 프로젝트 > SQL Editor 에 전체 붙여넣기 → Run (1회)
-- 실행 후: migrations/README.md 에 실행 기록 (P7)
--
-- 이 파일이 해결하는 설계 이슈 4가지:
--   (1) users ↔ departments 순환 참조
--       → departments 를 head_id 없이 먼저 생성 → users → ALTER 로 head_id 추가
--   (2) users RLS 무한 재귀 (Supabase 대표 함정)
--       → 역할 체크는 SECURITY DEFINER 헬퍼 함수로만 수행 (D15)
--   (3) "본인 행 수정 가능, 단 role/extra_permissions 는 admin+" 는 RLS 로 불가
--       → BEFORE UPDATE 트리거로 강제 (D16)
--   (4) superadmin 은 시드 불가 (첫 로그인 전엔 uid 를 모름)
--       → 파일 맨 아래 [D17 부트스트랩] 블록을 첫 로그인 후 1회 실행
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. departments — head_id 는 3단계에서 추가 (순환 참조 회피)
-- ----------------------------------------------------------------------------
CREATE TABLE public.departments (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  sort_order INT  NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 2. users — auth.users 와 1:1
-- ----------------------------------------------------------------------------
CREATE TABLE public.users (
  id                TEXT PRIMARY KEY,               -- auth.users.id::text
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'teacher'
                    CHECK (role IN ('superadmin','admin','department_head','teacher')),
  extra_permissions JSONB NOT NULL DEFAULT '[]',    -- 예: ["timetable_manage"]
  department_id     TEXT REFERENCES public.departments(id),
  is_active         BOOLEAN NOT NULL DEFAULT true,  -- 퇴직/전출 시 false (삭제 금지)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. 순환 참조 해소: departments.head_id 추가
-- ----------------------------------------------------------------------------
ALTER TABLE public.departments
  ADD COLUMN head_id TEXT REFERENCES public.users(id);

-- ----------------------------------------------------------------------------
-- 4. 헬퍼 함수 (SECURITY DEFINER) — 모든 RLS 역할 체크의 유일한 경로 (D15)
--    ⚠ users 자신의 정책이 users 를 직접 SELECT 하면 무한 재귀 에러.
--      이후 모든 마이그레이션(003~)의 역할 체크도 반드시 이 함수들 경유.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid()::text
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('admin','superadmin'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_dept_head_or_above()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public.get_my_role() IN ('department_head','admin','superadmin'), false)
$$;

CREATE OR REPLACE FUNCTION public.my_department_id()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT department_id FROM public.users WHERE id = auth.uid()::text
$$;

CREATE OR REPLACE FUNCTION public.has_extra_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()::text
        AND extra_permissions ? perm
    ),
    false
  )
$$;

-- 공용 유틸: updated_at 자동 갱신 (schedules, handover_docs 등에서 재사용)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. 신규 가입 자동 생성 — Google 로그인 시 users 행 생성 (role='teacher' 기본)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id::text,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',   -- Google OAuth 가 주는 이름
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. 권한 컬럼 보호 트리거 (D16)
--    RLS 는 행 단위라 "본인 행 수정 OK, 단 role 컬럼은 admin+" 을 표현 못함.
--    auth.uid() IS NULL (SQL Editor / 서버 컨텍스트) 은 통과
--    → D17 superadmin 부트스트랩 UPDATE 가 막히지 않는 이유.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- SQL Editor 등 서버 측 실행은 통과 (클라이언트 요청이 아님)
  END IF;

  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.extra_permissions IS DISTINCT FROM OLD.extra_permissions
      OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'role / extra_permissions / is_active 는 admin 이상만 변경할 수 있습니다';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER users_protect_privileged
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_columns();

-- ----------------------------------------------------------------------------
-- 7. RLS — 둘 다 shared 패턴 (P4)
-- ----------------------------------------------------------------------------
ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- users: 조회 전체(교직원 목록 용도), 수정 본인+admin,
--        INSERT 는 트리거만 (정책 없음), DELETE 금지 (정책 없음)
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid()::text OR public.is_admin())
  WITH CHECK (id = auth.uid()::text OR public.is_admin());

-- departments: 조회 전체, 편집 admin+
CREATE POLICY departments_select ON public.departments
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY departments_insert ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY departments_update ON public.departments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY departments_delete ON public.departments
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 비로그인(anon) 명시적 차단 (정책이 authenticated 전용이라 이미 차단되지만 이중 안전)
REVOKE ALL ON public.users, public.departments FROM anon;

-- ============================================================================
-- [검증] 실행 성공 후 아래 쿼리를 별도로 Run 해서 확인
-- ============================================================================
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--   → users, departments 모두 rowsecurity = t
--
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' ORDER BY tablename, cmd;
--   → users 2개 (SELECT, UPDATE), departments 4개
--
-- SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1;
--   → get_my_role, handle_new_user, has_extra_permission, is_admin,
--     is_dept_head_or_above, my_department_id, protect_privileged_columns, set_updated_at

-- ============================================================================
-- [D17 부트스트랩] ⚠ 지금은 실행하지 말 것!
-- 사이트에서 "첫 Google 로그인"을 마친 뒤에만 아래를 1회 실행 (SQL Editor):
--
-- UPDATE public.users SET role = 'superadmin'
--  WHERE email = '로그인에_사용한_이메일';
--
-- SELECT id, email, name, role FROM public.users;   -- role = superadmin 확인
-- ============================================================================
