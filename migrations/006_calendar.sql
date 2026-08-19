-- ============================================================================
-- 006_calendar.sql
-- daedong-v2 마이그레이션 006 — 모듈 C: 학사일정(공식) + 공유 캘린더
--
-- 선행: 001~005. 실행: SQL Editor 전체 Run 1회
-- 구조:
--   academic_terms  — 학기 정의 (시수·수업일수 계산의 기준 기간)
--   calendar_events — 단일 테이블 + scope 2계층
--     scope='official' : 학사일정. admin(교감·교무부장·슈퍼관리자)만 쓰기.
--                        no_class 등 파생 계산의 유일한 원천
--     scope='shared'   : 공유 캘린더. 승인 교사 전원이 자유 편집 (구글시트 은유).
--                        soft delete 로 실수 복구 여지 확보
--   labels — 자유 태그 배열. 대시보드 선별 표출 대비 (C-3)
-- ============================================================================

CREATE TABLE public.academic_terms (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  year       INT  NOT NULL,                  -- 학년도 (2026)
  semester   INT  NOT NULL CHECK (semester IN (1,2)),
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (year, semester),
  CHECK (start_date <= end_date)
);

CREATE TABLE public.calendar_events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  term_id     TEXT REFERENCES public.academic_terms(id),
  scope       TEXT NOT NULL CHECK (scope IN ('official','shared')),
  title       TEXT NOT NULL,
  event_type  TEXT NOT NULL DEFAULT '기타'
              CHECK (event_type IN ('행사','휴업일','재량휴업','고사','마감','수업일수조정','기타')),
  labels      TEXT[] NOT NULL DEFAULT '{}',
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  grades      INT[] NOT NULL DEFAULT '{1,2,3}',   -- 대상 학년
  no_class    BOOLEAN NOT NULL DEFAULT false,     -- 수업 없음 (official 만 파생 계산에 사용)
  description TEXT,
  created_by  TEXT NOT NULL REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT REFERENCES public.users(id),
  updated_at  TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,                        -- soft delete (shared 실수 복구용)
  CHECK (start_date <= end_date)
);

CREATE INDEX idx_cal_range ON public.calendar_events (start_date, end_date)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_scope ON public.calendar_events (scope, start_date)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_labels ON public.calendar_events USING GIN (labels);

ALTER TABLE public.academic_terms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- 공통: admin 판별
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = auth.uid()::text AND u.role IN ('admin','superadmin')) $$;

-- academic_terms: 전체 조회 / admin 쓰기
CREATE POLICY terms_select ON public.academic_terms
  FOR SELECT TO authenticated USING (public.is_approved());
CREATE POLICY terms_write ON public.academic_terms
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- calendar_events: 전체 조회 (삭제분 제외는 앱에서 필터, 복구 화면은 admin)
CREATE POLICY cal_select ON public.calendar_events
  FOR SELECT TO authenticated USING (public.is_approved());

-- official: admin 만 생성·수정·삭제
CREATE POLICY cal_official_insert ON public.calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (scope = 'official' AND public.is_admin() AND created_by = auth.uid()::text);
CREATE POLICY cal_official_update ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (scope = 'official' AND public.is_admin())
  WITH CHECK (scope = 'official' AND public.is_admin());

-- shared: 승인 교사 전원 생성·수정 (구글시트 은유 — 남의 일정도 편집 가능, 이력 기록)
CREATE POLICY cal_shared_insert ON public.calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (scope = 'shared' AND public.is_approved() AND created_by = auth.uid()::text);
CREATE POLICY cal_shared_update ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (scope = 'shared' AND public.is_approved())
  WITH CHECK (scope = 'shared' AND public.is_approved());

-- 물리 DELETE 는 아무도 못 함 (정책 없음) — 삭제는 deleted_at 갱신(UPDATE)으로만
REVOKE ALL ON public.academic_terms  FROM anon;
REVOKE ALL ON public.calendar_events FROM anon;

-- 초기 데이터: 2026-2 학기 (시작·종료일은 학사일정 자산 기준으로 CC 시드에서 확정)
INSERT INTO public.academic_terms (year, semester, start_date, end_date, is_current)
VALUES (2026, 2, '2026-08-17', '2027-01-08', true)
ON CONFLICT (year, semester) DO NOTHING;

-- [검증]
-- SELECT COUNT(*) FROM pg_policies WHERE tablename IN ('academic_terms','calendar_events'); → 7
-- SELECT * FROM public.academic_terms;  → 2026-2 1행
-- ============================================================================
