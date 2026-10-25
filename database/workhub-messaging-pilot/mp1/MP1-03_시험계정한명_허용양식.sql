-- P9로 시험 계정 소속을 연결한 뒤 사용자가 직접 채워 실행한다. 역할은 teacher 그대로 둔다.
BEGIN;
DO $enable$
DECLARE
 p_user_id uuid:=NULL; -- 시험 계정 Auth UID
 p_member_id text:='<시험 계정 소속 ID>';
 p_admin_user_id uuid:=NULL; -- 기존 학교 관리자 Auth UID
 p_school_id text:='<학교 ID>';
 p_expires_at timestamptz:=NULL; -- 명시한 종료 시각(현재부터 최대 7일), 예: 2026-11-01 18:00:00+09
 p_approval_ref text:='<승인 일시와 근거>';
 admin_member text;ctx workhub_private.actor_context;existing workhub.messaging_pilot_grants;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'SQL Editor 관리 연결에서만 실행하세요.'; END IF;
 IF p_user_id IS NULL OR p_admin_user_id IS NULL OR p_member_id LIKE '<%' OR p_school_id LIKE '<%'
 OR p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '7 days'
 OR p_approval_ref LIKE '<%' OR length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '대상·학교·소속·승인자·종료 시각(최대 7일)·승인 근거를 채우세요.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.messaging_pilot',0));
 SELECT m.id INTO admin_member FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id
 JOIN public.users u ON u.id=a.auth_user_id::text JOIN workhub.schools s ON s.id=m.school_id
 WHERE a.auth_user_id=p_admin_user_id AND m.school_id=p_school_id AND m.status='active'
 AND a.status='active' AND a.legacy_approval_state='approved' AND s.status='active' AND u.is_active AND u.role='superadmin'
 AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)');
 ctx.actor_kind:='member';ctx.membership_id:=admin_member;ctx.school_id:=p_school_id;ctx.scope_key:='s:'||p_school_id;
 SELECT account_id INTO ctx.account_id FROM workhub.memberships WHERE id=admin_member;
 ctx.auth_user_id:=p_admin_user_id;ctx.school_today:=workhub_private.today_in((SELECT timezone FROM workhub.schools WHERE id=p_school_id));
 IF admin_member IS NULL OR NOT workhub_private.member_has_perm(ctx,'membership.approve') THEN RAISE EXCEPTION '현재 학교의 소속 승인 관리자가 아닙니다.'; END IF;
 PERFORM 1 FROM public.users WHERE id=p_user_id::text FOR SHARE;
 PERFORM 1 FROM workhub.accounts WHERE auth_user_id=p_user_id FOR SHARE;
 PERFORM 1 FROM workhub.schools WHERE id=p_school_id FOR SHARE;
 -- 메시지 전송이 잡는 소속 잠금과 직렬화해 수신 자격을 중간에 바꾸지 않는다.
 PERFORM 1 FROM workhub.memberships WHERE id=p_member_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id
 JOIN public.users u ON u.id=a.auth_user_id::text JOIN workhub.schools s ON s.id=m.school_id
 WHERE m.id=p_member_id AND m.school_id=p_school_id AND a.auth_user_id=p_user_id AND u.role='teacher' AND u.is_active
 AND a.status='active' AND a.legacy_approval_state='approved' AND m.status='active' AND s.status='active'
 AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)')) THEN RAISE EXCEPTION '승인된 일반 교사와 유효한 본인 소속을 확인해 주세요.'; END IF;
 SELECT * INTO existing FROM workhub.messaging_pilot_grants WHERE singleton FOR UPDATE;
 IF existing.auth_user_id IS NOT NULL AND (existing.auth_user_id<>p_user_id OR existing.membership_id<>p_member_id OR existing.school_id<>p_school_id) THEN
 RAISE EXCEPTION '이 설치에는 시험 계정 한 명만 허용합니다. 다른 계정으로 자동 교체하지 않습니다.'; END IF;
 INSERT INTO workhub.messaging_pilot_grants(auth_user_id,school_id,membership_id,active,expires_at,approved_by_membership_id,approval_ref)
 VALUES(p_user_id,p_school_id,p_member_id,true,p_expires_at,admin_member,p_approval_ref)
 ON CONFLICT(singleton) DO UPDATE SET active=true,expires_at=excluded.expires_at,approved_by_membership_id=excluded.approved_by_membership_id,
 approval_ref=excluded.approval_ref,revision=workhub.messaging_pilot_grants.revision+1,updated_at=clock_timestamp();
 PERFORM workhub_private.write_audit(ctx,'messaging_pilot.enable','membership',p_member_id,NULL,'school',NULL,jsonb_build_object('user_id',p_user_id,'expires_at',p_expires_at));
END $enable$;
COMMIT;
SELECT 'ok' AS status,auth_user_id,school_id,membership_id,active,expires_at FROM workhub.messaging_pilot_grants;
