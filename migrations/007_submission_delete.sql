-- ============================================================================
-- 007_submission_delete.sql
-- daedong-v2 마이그레이션 007 — 제출물 삭제 (행 보존·파일 실물만 삭제)
--
-- 선행: 005. 실행: SQL Editor 전체 Run 1회
-- 설계: 제출 행은 물리 삭제 불가 유지 (수합 기록 보존).
--       status='deleted' 로 표시 + Storage 파일 실물만 제거.
--       교사 = 본인 것 / admin = 전체.
-- ============================================================================

-- 1) status 에 'deleted' 허용
ALTER TABLE public.doc_submissions DROP CONSTRAINT IF EXISTS doc_submissions_status_check;
ALTER TABLE public.doc_submissions ADD CONSTRAINT doc_submissions_status_check
  CHECK (status IN ('submitted','replaced','deleted'));

-- 2) admin 이 제출 행을 갱신할 수 있게 (관리 차원 삭제 표시용)
CREATE POLICY subm_update_admin ON public.doc_submissions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3) Storage 파일 실물 삭제 권한: 본인 폴더 + admin 전체
CREATE POLICY subm_storage_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'submissions'
         AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY subm_storage_delete_admin ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'submissions' AND public.is_admin());
-- ============================================================================
