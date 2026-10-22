-- 운영 실행은 사용자의 검토·승인 뒤에만 한다. 빈 입력은 중단한다.
-- 이 양식은 후보 UID 목록과 기능만 승인한다. 소속 연결은 앱의 미리보기→확정에서 별도로 수행한다.
BEGIN;
DO $$
DECLARE
 p_school_id text := '<학교 ID>';
 p_approver_user_id uuid := NULL; -- 기존 학교 관리자 Auth UID
 p_allowed_user_ids uuid[] := ARRAY[]::uuid[]; -- 이 학교 재직을 확인한 기존 가입 회원 UID만
 p_approval_ref text := '<승인 일시와 근거>';
 p_enable boolean := false; -- 승인했다면 true
 ctx workhub_private.actor_context;v_member text;v_rev integer;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'SQL Editor 관리 연결에서만 실행하세요.';END IF;
 IF p_school_id LIKE '<%' OR p_approver_user_id IS NULL OR p_approval_ref LIKE '<%' OR length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200
 OR cardinality(p_allowed_user_ids) NOT BETWEEN 1 AND 300 OR NOT p_enable THEN RAISE EXCEPTION '학교·승인자·대상 UID·승인 근거·켜기 값을 직접 채우세요.';END IF;
 IF array_position(p_allowed_user_ids,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_allowed_user_ids)x)<>cardinality(p_allowed_user_ids) THEN RAISE EXCEPTION '중복되거나 빈 UID가 있습니다.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_roster',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:'||p_school_id,0));
 SELECT m.id INTO v_member FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id
 JOIN workhub.schools s ON s.id=m.school_id JOIN public.users u ON u.id=a.auth_user_id::text
 WHERE m.school_id=p_school_id AND a.auth_user_id=p_approver_user_id AND m.status='active' AND s.status='active'
 AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)')
 AND a.status='active' AND a.legacy_approval_state='approved' AND u.is_active AND u.role='superadmin';
 IF v_member IS NULL THEN RAISE EXCEPTION '승인된 현 학교 관리자가 아닙니다.';END IF;
 ctx.actor_kind:='member';ctx.school_id:=p_school_id;ctx.membership_id:=v_member;ctx.school_today:=workhub_private.today_in((SELECT timezone FROM workhub.schools WHERE id=p_school_id));
 IF NOT(workhub_private.member_has_perm(ctx,'year.manage') AND workhub_private.member_has_perm(ctx,'membership.approve')) THEN RAISE EXCEPTION '학년도 관리·소속 승인 권한이 모두 필요합니다.';END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_allowed_user_ids) ids(uid) LEFT JOIN public.users u ON u.id=ids.uid::text LEFT JOIN auth.users a ON a.id=ids.uid
 WHERE u.id IS NULL OR a.id IS NULL OR NOT u.is_active OR u.role NOT IN('teacher','superadmin') OR length(btrim(u.name)) NOT BETWEEN 1 AND 50) THEN
 RAISE EXCEPTION '현재 승인된 기존 회원이 아닌 UID가 있습니다. 로그인 계정은 만들지 않습니다.';END IF;
 INSERT INTO workhub.school_roster_policies(school_id,active,allowed_user_ids,approved_by_membership_id,approval_ref)
 VALUES(p_school_id,true,p_allowed_user_ids,v_member,p_approval_ref)
 ON CONFLICT(school_id) DO UPDATE SET active=true,allowed_user_ids=excluded.allowed_user_ids,revision=workhub.school_roster_policies.revision+1,
 approved_by_membership_id=excluded.approved_by_membership_id,approval_ref=excluded.approval_ref,updated_at=clock_timestamp()
 RETURNING revision INTO v_rev;
 RAISE NOTICE '후보 목록 승인 완료: 학교 %, 판 %, 대상 %명. 아직 소속 연결은 하지 않았습니다.',p_school_id,v_rev,cardinality(p_allowed_user_ids);
END $$;
COMMIT;
