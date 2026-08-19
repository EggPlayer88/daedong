-- ============================================================================
-- 005_doc_submissions.sql
-- daedong-v2 마이그레이션 005 — 평가계획서 제출·수합 (담당자 수합 기능)
--
-- 선행: 001~004. 실행: SQL Editor 전체 Run 1회 → README 기록
-- 구조: Storage 버킷(submissions, 비공개) + doc_submissions 테이블
-- RLS: 교사 = 본인 제출물만 / admin·superadmin = 전체 열람 (수합 담당자용)
-- ============================================================================

-- 1) Storage 버킷
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', false)
ON CONFLICT (id) DO NOTHING;

-- 2) 제출 테이블
CREATE TABLE public.doc_submissions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL REFERENCES public.users(id),
  year         INT  NOT NULL DEFAULT 2026,
  semester     INT  NOT NULL DEFAULT 2,
  subject      TEXT NOT NULL,
  grade        INT  NOT NULL CHECK (grade IN (1,2,3)),
  file_name    TEXT NOT NULL,
  file_path    TEXT NOT NULL,               -- storage 경로: {user_id}/{uuid}_{file_name}
  note         TEXT,                        -- 교사 메모 (선택)
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','replaced')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_submissions_admin ON public.doc_submissions (year, semester, grade, subject, submitted_at DESC);
CREATE INDEX idx_submissions_user  ON public.doc_submissions (user_id, submitted_at DESC);

ALTER TABLE public.doc_submissions ENABLE ROW LEVEL SECURITY;

-- 본인 제출·조회
CREATE POLICY subm_insert ON public.doc_submissions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved() AND user_id = auth.uid()::text);

CREATE POLICY subm_select_own ON public.doc_submissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

-- 담당자(관리자) 전체 열람
CREATE POLICY subm_select_admin ON public.doc_submissions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE u.id = auth.uid()::text AND u.role IN ('admin','superadmin')));

-- 재제출: 본인 것 status 갱신만 허용 (replaced 처리)
CREATE POLICY subm_update_own ON public.doc_submissions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

REVOKE ALL ON public.doc_submissions FROM anon;

-- 3) Storage 정책 (본인 폴더 업로드/조회 + 관리자 전체 조회)
CREATE POLICY subm_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'submissions'
              AND public.is_approved()
              AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY subm_storage_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'submissions'
         AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY subm_storage_select_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'submissions'
         AND EXISTS (SELECT 1 FROM public.users u
                     WHERE u.id = auth.uid()::text AND u.role IN ('admin','superadmin')));

-- [검증]
-- SELECT policyname FROM pg_policies WHERE tablename = 'doc_submissions';  → 4개
-- SELECT id FROM storage.buckets WHERE id = 'submissions';                → 1행
-- ============================================================================
