-- 적용 전 초기 연결 제안. 기존 승인 superadmin과 실제 학교 정보를 확인한 뒤 값만 채운다.
-- 자리표시자·빈 기간을 두면 어떤 INSERT보다 먼저 중단된다. 기존 회원·트리거는 변경하지 않는다.
BEGIN;
DO $$
DECLARE
  v_user_id text := '<기존 public.users.id>';
  v_school_id text := '<확정 학교 식별자>';
  v_school_name text := '<확정 학교명>';
  v_valid_from date := NULL;
  v_valid_through date := NULL; -- 마지막 유효일(포함)
BEGIN
  IF v_user_id LIKE '<%' OR v_school_id LIKE '<%' OR v_school_name LIKE '<%'
    OR v_valid_from IS NULL OR v_valid_through IS NULL OR v_valid_from > v_valid_through
  THEN RAISE EXCEPTION '초기 연결 값을 먼저 확정해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=v_user_id AND role='superadmin' AND is_active IS TRUE)
  THEN RAISE EXCEPTION '기존 승인 superadmin을 찾을 수 없습니다. 회원을 새로 만들지 마세요.'; END IF;
  IF EXISTS (SELECT 1 FROM public.workhub_schools WHERE id=v_school_id AND name<>v_school_name)
  THEN RAISE EXCEPTION '학교 식별자와 학교명이 기존 연결과 다릅니다.'; END IF;
  INSERT INTO public.workhub_schools(id,name) VALUES(v_school_id,v_school_name) ON CONFLICT(id) DO NOTHING;
  -- 중첩 트리거보다 먼저 기존 시작일 소속을 확인하여 같은 초기 연결의 재실행을 허용한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_school_id || chr(31) || v_user_id,0));
  IF NOT EXISTS (SELECT 1 FROM public.workhub_memberships WHERE school_id=v_school_id AND user_id=v_user_id AND valid_from=v_valid_from)
  THEN
    INSERT INTO public.workhub_memberships(school_id,user_id,role,active,valid_from,valid_through)
      VALUES(v_school_id,v_user_id,'calendar_manager',true,v_valid_from,v_valid_through);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workhub_memberships WHERE school_id=v_school_id AND user_id=v_user_id
    AND valid_from=v_valid_from AND valid_through=v_valid_through AND active AND role='calendar_manager')
  THEN RAISE EXCEPTION '기존 소속과 초기 연결이 다릅니다. 기존 값을 덮어쓰지 않았습니다.'; END IF;
END $$;
COMMIT;
