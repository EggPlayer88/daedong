-- ============================================================================
-- 002_schedules_tasks.sql
-- daedong-v2 마이그레이션 002 — 일정(schedules) + 할 일(tasks)
--
-- 선행 조건: 001 실행 완료 (users, departments, 헬퍼 함수)
-- 실행: SQL Editor 전체 붙여넣기 → Run (1회). 실행 후 README.md 기록 (P7)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. schedules — 일정 관리 (스프레드시트형). "나의 할 일" 자동 소환의 원천.
--    복사 없음, 단일 진실 (D10): 위젯은 assignee_id = 나 인 행을 조회할 뿐.
-- ----------------------------------------------------------------------------
CREATE TABLE public.schedules (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date          DATE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  assignee_id   TEXT REFERENCES public.users(id),
  department_id TEXT REFERENCES public.departments(id),
  created_by    TEXT REFERENCES public.users(id),   -- 앱에서 auth.uid() 로 반드시 세팅
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedules_date     ON public.schedules (date);
CREATE INDEX idx_schedules_assignee ON public.schedules (assignee_id);

CREATE TRIGGER schedules_set_updated_at
BEFORE UPDATE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. tasks — 할 일 (상급자 부여 + 본인 추가)
-- ----------------------------------------------------------------------------
CREATE TABLE public.tasks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title       TEXT NOT NULL,
  assignee_id TEXT NOT NULL REFERENCES public.users(id),
  assigner_id TEXT REFERENCES public.users(id),     -- NULL = 본인이 직접 추가
  due_date    DATE,
  is_done     BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_assignee ON public.tasks (assignee_id, is_done);
CREATE INDEX idx_tasks_assigner ON public.tasks (assigner_id);

-- 완료 토글 시 done_at 자동 관리 (프론트가 잊어도 DB 가 보장)
CREATE OR REPLACE FUNCTION public.set_task_done_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_done AND NOT OLD.is_done THEN
    NEW.done_at = now();
  ELSIF NOT NEW.is_done THEN
    NEW.done_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_set_done_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_task_done_at();

-- ----------------------------------------------------------------------------
-- 3. 부여 권한 헬퍼 (D7):
--    admin+ 는 전체에게, department_head 는 자기 부서원에게만 부여 가능
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_assign_task(target_assignee_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    public.is_admin()
    OR (
      public.get_my_role() = 'department_head'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = target_assignee_id
          AND u.department_id IS NOT NULL
          AND u.department_id = public.my_department_id()
      )
    ),
    false
  )
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks     ENABLE ROW LEVEL SECURITY;

-- schedules: shared — 조회 전체, 생성은 본인 명의로만, 수정/삭제 작성자+admin
CREATE POLICY schedules_select ON public.schedules
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY schedules_insert ON public.schedules
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()::text);

CREATE POLICY schedules_update ON public.schedules
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()::text OR public.is_admin())
  WITH CHECK (created_by = auth.uid()::text OR public.is_admin());

CREATE POLICY schedules_delete ON public.schedules
  FOR DELETE TO authenticated
  USING (created_by = auth.uid()::text OR public.is_admin());

-- tasks: personal 변형 — 조회는 assignee + assigner + admin (D10, SCHEMA §4)
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    assignee_id = auth.uid()::text
    OR assigner_id = auth.uid()::text
    OR public.is_admin()
  );

-- 생성: (a) 본인 추가 = assigner NULL + assignee 본인
--       (b) 부여    = assigner 본인 명의 + can_assign_task 통과
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    (assigner_id IS NULL AND assignee_id = auth.uid()::text)
    OR
    (assigner_id = auth.uid()::text AND public.can_assign_task(assignee_id))
  );

-- 수정: assignee(완료 체크) / assigner / admin.
--       assigner 가 재배정해도 can_assign_task 범위를 벗어날 수 없음.
--       ※ "assignee 는 완료 토글만" 같은 컬럼 단위 제한은 앱 UI 에서 처리 (D16 과 동일 사유)
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    assignee_id = auth.uid()::text
    OR assigner_id = auth.uid()::text
    OR public.is_admin()
  )
  WITH CHECK (
    assignee_id = auth.uid()::text
    OR public.is_admin()
    OR (assigner_id = auth.uid()::text AND public.can_assign_task(assignee_id))
  );

-- 삭제: 본인 추가 건은 본인, 부여 건은 부여자, admin 전체
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (
    (assigner_id IS NULL AND assignee_id = auth.uid()::text)
    OR assigner_id = auth.uid()::text
    OR public.is_admin()
  );

REVOKE ALL ON public.schedules, public.tasks FROM anon;

-- ============================================================================
-- [검증] 실행 성공 후 별도 Run:
-- ============================================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN ('schedules','tasks')
--  ORDER BY tablename, cmd;
--   → schedules 4개, tasks 4개
--
-- [참고] 대시보드 "나의 할 일" 위젯은 두 쿼리 합성 (D10):
--   tasks:     assignee_id = 나 AND is_done = false
--   schedules: assignee_id = 나 AND date >= 오늘  ORDER BY date
-- ============================================================================
