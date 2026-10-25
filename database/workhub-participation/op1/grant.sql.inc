CREATE FUNCTION workhub_private.op1_set_grant(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g workhub.participant_grants;m workhub.memberships;a workhub.accounts;s workhub.schools;
 admin workhub.memberships;ctx workhub_private.actor_context;scopes text[];expiry timestamptz;expected integer;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'OP1: SQL Editor 관리 연결에서만 실행하세요.';END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR p->>'confirm' IS DISTINCT FROM 'true'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM ARRAY['active','adminUserId','appDeployRef','approvalRef','confirm','expectedRevision','expiresAt','memberId','schoolId','scopes','userId']::text[]
 OR jsonb_typeof(p->'scopes') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'active') IS DISTINCT FROM 'boolean'
 OR length(btrim(coalesce(p->>'approvalRef',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(p->>'appDeployRef',''))) NOT BETWEEN 1 AND 200
 OR p::text LIKE '%<%' THEN RAISE EXCEPTION 'OP1: 대상·학교·허용 범위·기간·배포 근거를 직접 확인하세요.';END IF;
 SELECT array_agg(v ORDER BY v) INTO scopes FROM jsonb_array_elements_text(p->'scopes') v;
 IF NOT workhub_private.op1_valid_scopes(scopes) THEN RAISE EXCEPTION 'OP1: 허용 범위 또는 연결 메뉴가 빠졌습니다.';END IF;
 expected:=(p->>'expectedRevision')::integer;expiry:=(p->>'expiresAt')::timestamptz;
 IF expected IS NULL OR expected<0 OR expiry IS NULL OR ((p->>'active')::boolean AND (expiry<=clock_timestamp() OR expiry>clock_timestamp()+interval '7 days')) THEN RAISE EXCEPTION 'OP1: 현재 판과 최대 7일의 종료 시각을 확인하세요.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('op1-grant',0));
 SELECT * INTO s FROM workhub.schools WHERE id=p->>'schoolId' AND status='active' FOR SHARE;
 SELECT * INTO a FROM workhub.accounts WHERE auth_user_id=(p->>'userId')::uuid AND status='active' AND legacy_approval_state='approved' FOR SHARE;
 PERFORM 1 FROM public.users WHERE id=p->>'userId' AND role='teacher' AND is_active FOR SHARE;
 IF NOT FOUND OR a.id IS NULL OR s.id IS NULL THEN RAISE EXCEPTION 'OP1: 승인된 일반 교사와 활성 학교를 확인하세요.';END IF;
 SELECT * INTO m FROM workhub.memberships WHERE id=p->>'memberId' AND school_id=s.id AND account_id=a.id
 AND status='active' AND workhub_private.today_in(s.timezone)<@daterange(valid_from,valid_to,'[)') FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'OP1: 본인 학교 소속이 아닙니다.';END IF;
 SELECT mm.* INTO admin FROM workhub.memberships mm JOIN workhub.accounts aa ON aa.id=mm.account_id
 WHERE mm.school_id=s.id AND aa.auth_user_id=(p->>'adminUserId')::uuid AND workhub_private.p2_member_reachable(s.id,mm.id) FOR SHARE OF mm;
 ctx:=ROW('member',admin.account_id,admin.id,NULL,s.id,'s:'||s.id,(p->>'adminUserId')::uuid,workhub_private.today_in(s.timezone),s.timezone)::workhub_private.actor_context;
 PERFORM workhub_private.lock_member_roles(ctx);
 IF admin.id IS NULL OR admin.account_id=a.id OR NOT workhub_private.member_has_perm(ctx,'role.grant') THEN RAISE EXCEPTION 'OP1: 대상과 다른 현재 학교 관리자의 승인이 필요합니다.';END IF;
 SELECT * INTO g FROM workhub.participant_grants WHERE auth_user_id=a.auth_user_id FOR UPDATE;
 IF g.auth_user_id IS NOT NULL AND (g.school_id<>s.id OR g.membership_id<>m.id) THEN RAISE EXCEPTION 'OP1: 기존 허용의 학교·소속을 바꿀 수 없습니다.';END IF;
 IF coalesce(g.revision,0)<>expected THEN RAISE EXCEPTION 'OP1: 허용 판이 바뀌었습니다. 현재 값을 다시 확인하세요.';END IF;
 INSERT INTO workhub.participant_grants(school_id,membership_id,auth_user_id,scopes,active,expires_at,revision,approved_by_membership_id,approval_ref,app_deploy_ref)
 VALUES(s.id,m.id,a.auth_user_id,scopes,(p->>'active')::boolean,expiry,expected+1,admin.id,btrim(p->>'approvalRef'),btrim(p->>'appDeployRef'))
 ON CONFLICT(school_id,membership_id) DO UPDATE SET scopes=excluded.scopes,active=excluded.active,expires_at=excluded.expires_at,
 revision=excluded.revision,approved_by_membership_id=excluded.approved_by_membership_id,approval_ref=excluded.approval_ref,app_deploy_ref=excluded.app_deploy_ref,updated_at=now();
 PERFORM workhub_private.write_audit(ctx,'participant.grant','participant_grant',m.id,expected+1,'school',NULL,
 jsonb_build_object('scopes',scopes,'active',(p->>'active')::boolean,'expiresAt',expiry,'approvalRef',p->>'approvalRef','appDeployRef',p->>'appDeployRef'));
 RETURN jsonb_build_object('status','ok','memberId',m.id,'revision',expected+1,'active',(p->>'active')::boolean);
END $$;
REVOKE ALL ON FUNCTION workhub_private.op1_set_grant(jsonb) FROM PUBLIC,anon,authenticated,service_role;
