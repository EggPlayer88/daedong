-- 이 파일은 자료를 지우지 않는다. 원래 번호의 결과 확인과 요청 닫기는 유지한다.
BEGIN;
DO $$ DECLARE p_school_id text:='<학교 ID>';p_approval_ref text:='<중지 근거>';BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'SQL Editor 관리 연결에서만 실행하세요.';END IF;
 IF p_school_id LIKE '<%' OR p_approval_ref LIKE '<%' OR length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '학교와 중지 근거를 직접 채우세요.';END IF;
 PERFORM workhub_private.t1_lock(p_school_id);
 UPDATE workhub.school_data_policies SET active=false,approval_ref=p_approval_ref WHERE school_id=p_school_id;
 IF NOT FOUND THEN RAISE EXCEPTION '승인 정책을 찾지 못했습니다.';END IF;
END $$;
COMMIT;
