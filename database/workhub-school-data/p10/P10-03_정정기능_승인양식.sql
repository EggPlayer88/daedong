-- 승인 뒤 SQL Editor에서만 실행한다. 설치만으로는 활성화하지 않는다.
BEGIN;
DO $$
DECLARE p_school_id text:='<학교 ID>';p_approver_user_id uuid:=NULL;
 p_approval_ref text:='<승인 일시와 근거>';p_app_deploy_ref text:='<P10 앱 배포 확인 근거>';p_enable boolean:=false;
 ctx workhub_private.actor_context;v_member text;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'SQL Editor 관리 연결에서만 실행하세요.';END IF;
 IF p_school_id LIKE '<%' OR p_approver_user_id IS NULL OR p_approval_ref LIKE '<%' OR p_app_deploy_ref LIKE '<%' OR length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200 OR length(btrim(p_app_deploy_ref)) NOT BETWEEN 1 AND 200 OR NOT p_enable THEN RAISE EXCEPTION '학교·승인자·승인 근거·앱 배포 근거·켜기 값을 직접 채우세요.';END IF;
 IF (SELECT count(*) FROM workhub_private.p10_installs WHERE batch IN('P10-01','P10-02'))<>2 THEN RAISE EXCEPTION 'P10-01·02를 먼저 설치하세요.';END IF;
 PERFORM workhub_private.t1_lock(p_school_id);
 SELECT m.id INTO v_member FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id JOIN workhub.schools s ON s.id=m.school_id JOIN public.users u ON u.id=a.auth_user_id::text
 WHERE m.school_id=p_school_id AND a.auth_user_id=p_approver_user_id AND m.status='active' AND s.status='active' AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)') AND a.status='active' AND a.legacy_approval_state='approved' AND u.is_active AND u.role='superadmin';
 IF v_member IS NULL THEN RAISE EXCEPTION '현재 승인된 학교 관리자가 아닙니다.';END IF;
 ctx.actor_kind:='member';ctx.school_id:=p_school_id;ctx.membership_id:=v_member;ctx.school_today:=workhub_private.today_in((SELECT timezone FROM workhub.schools WHERE id=p_school_id));
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RAISE EXCEPTION '학년도 관리 권한이 필요합니다.';END IF;
 IF NOT workhub_private.p5_ready(p_school_id) THEN RAISE EXCEPTION '수업 모듈을 먼저 준비하세요.';END IF;
 INSERT INTO workhub.school_data_policies(school_id,active,approval_ref,app_deploy_ref,approved_by) VALUES(p_school_id,true,p_approval_ref,p_app_deploy_ref,v_member)
 ON CONFLICT(school_id) DO UPDATE SET active=true,approval_ref=excluded.approval_ref,app_deploy_ref=excluded.app_deploy_ref,approved_by=excluded.approved_by;
 RAISE NOTICE '학교 자료 정정 기능 승인 완료. 자료 정정은 앱 미리보기와 최종 확인을 거쳐 별도로 실행합니다.';
END $$;
COMMIT;
