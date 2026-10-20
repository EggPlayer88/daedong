-- 기존 로그인 회원은 읽기만 하고 업무실 계정·소속만 추가한다. 기본 비활성.
-- P9-03에서 학교별 UID 허용 목록을 승인한 뒤에만 후보 조회·연결 가능.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF to_regprocedure('workhub_private.member_actor(text,boolean)') IS NULL
     OR to_regclass('workhub.school_admin_activations') IS NULL
     OR to_regprocedure('workhub_private.p2_member_reachable(text,text)') IS NULL THEN
    RAISE EXCEPTION 'P9: R0 · P1 · P2를 먼저 설치해야 합니다.';
  END IF;
  IF to_regclass('workhub.school_roster_policies') IS NOT NULL THEN RAISE EXCEPTION 'P9: 이미 설치되어 있습니다. 재실행하지 마세요.'; END IF;
END $$;
CREATE TABLE workhub_private.p9_installs(batch text PRIMARY KEY CHECK(batch IN('P9-01','P9-02')),release text NOT NULL,installed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workhub_private.p9_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub_private.p9_installs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER p9_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p9_installs FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TABLE workhub.school_roster_policies (
 school_id text PRIMARY KEY REFERENCES workhub.schools(id), active boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 allowed_user_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(allowed_user_ids)<=300),
 approved_by_membership_id text NOT NULL, approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TABLE workhub.school_roster_previews (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL,membership_id text NOT NULL,
 intent jsonb NOT NULL,fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),allowed boolean NOT NULL,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TABLE workhub.school_roster_requests (
 school_id text NOT NULL,membership_id text NOT NULL,request_key text NOT NULL,
 command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),
 preview_id text NOT NULL UNIQUE REFERENCES workhub.school_roster_previews(id),
 outcome text NOT NULL CHECK(outcome IN('applied','closed')),result jsonb,
 CHECK((outcome='applied' AND result IS NOT NULL AND jsonb_typeof(result)='object') OR(outcome='closed' AND result IS NULL)),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,membership_id,request_key),
 FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TABLE workhub.school_roster_links (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL,actor_membership_id text NOT NULL,
 request_key text NOT NULL,legacy_user_id uuid NOT NULL REFERENCES auth.users(id),account_id text NOT NULL REFERENCES workhub.accounts(id),
 membership_id text NOT NULL,outcome text NOT NULL CHECK(outcome IN('linked','already_linked')),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,membership_id,account_id) REFERENCES workhub.memberships(school_id,id,account_id),
 FOREIGN KEY(school_id,actor_membership_id,request_key) REFERENCES workhub.school_roster_requests(school_id,membership_id,request_key) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(school_id,actor_membership_id,request_key,legacy_user_id)
);
ALTER TABLE workhub.school_roster_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.school_roster_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.school_roster_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.school_roster_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub.school_roster_policies,workhub.school_roster_previews,workhub.school_roster_requests,workhub.school_roster_links FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER roster_preview_immutable BEFORE UPDATE OR DELETE ON workhub.school_roster_previews FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER roster_request_immutable BEFORE UPDATE OR DELETE ON workhub.school_roster_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER roster_link_immutable BEFORE UPDATE OR DELETE ON workhub.school_roster_links FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE FUNCTION workhub_private.p9_envelope(ctx workhub_private.actor_context,p_data jsonb,p_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('contract','school-roster.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id)
 || CASE WHEN p_code IS NULL THEN jsonb_build_object('data',p_data) ELSE jsonb_build_object('error',jsonb_build_object('code',p_code)) END
$$;
-- 담당 자격과 업무실 입구를 분리한다. 메시지·인계 수신 자격을 넓히지 않는다.
CREATE FUNCTION workhub_private.p9_teacher_assignable(p_school_id text,p_membership_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workhub.school_roster_policies p WHERE p.school_id=p_school_id AND p.active) THEN EXISTS(
 SELECT 1 FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id JOIN workhub.schools s ON s.id=m.school_id
 JOIN public.users u ON u.id=a.auth_user_id::text JOIN auth.users au ON au.id=a.auth_user_id
 WHERE m.school_id=p_school_id AND m.id=p_membership_id AND m.status='active' AND s.status='active'
 AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)')
 AND a.status='active' AND a.legacy_approval_state='approved' AND u.is_active AND u.role IN('teacher','superadmin')
 ) ELSE workhub_private.p2_member_reachable(p_school_id,p_membership_id) END
$$;
CREATE FUNCTION workhub_private.p9_check_intent(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date;e date;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF jsonb_typeof(p->'targetUserIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT workhub_private.p1_exact(p,ARRAY['expectedVersion','targetUserIds','startsOn','lastDay','reason'])
 OR workhub_private.p1_int(p->'expectedVersion',1,2147483647) IS NULL
 OR jsonb_typeof(p->'targetUserIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'targetUserIds') NOT BETWEEN 1 AND 300
 OR NOT workhub_private.p1_text_ok(p->'reason',200,false) OR length(btrim(p->>'reason'))=0
 OR (p->>'reason') ~ E'[\\x01-\\x1f\\x7f\\u0080-\\u009f]' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'targetUserIds') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p->'targetUserIds') x)<>jsonb_array_length(p->'targetUserIds')
 OR (SELECT jsonb_agg(x ORDER BY x COLLATE "C") FROM jsonb_array_elements_text(p->'targetUserIds') x)<>p->'targetUserIds' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 d:=workhub_private.p1_date(p->>'startsOn');
 IF d IS NULL OR d<'2020-01-01' OR d>'2100-12-31' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF p->'lastDay'<>'null'::jsonb THEN e:=workhub_private.p1_date(p->>'lastDay');
 IF e IS NULL OR e<d OR e>'2100-12-31' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;END IF;
END $$;
-- 지문에 쓰는 원문은 내부용이다. 다른 학교 소속은 읽거나 반환하지 않는다.
CREATE FUNCTION workhub_private.p9_plan(ctx workhub_private.actor_context,p_intent jsonb,p_lock boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pol workhub.school_roster_policies;u public.users;a workhub.accounts;m workhub.memberships;
 v_uid uuid;v_from date;v_to date;found_auth boolean;out_rows jsonb:='[]';sources jsonb:='[]';outcome text;mid text;membership_state jsonb;
BEGIN
 PERFORM workhub_private.p9_check_intent(p_intent);
 SELECT * INTO pol FROM workhub.school_roster_policies WHERE school_id=ctx.school_id;
 IF pol.school_id IS NULL OR NOT pol.active THEN RAISE EXCEPTION 'NOT_READY';END IF;
 IF pol.revision<>(p_intent->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT';END IF;
 v_from:=(p_intent->>'startsOn')::date;v_to:=CASE WHEN p_intent->'lastDay'='null'::jsonb THEN NULL ELSE (p_intent->>'lastDay')::date+1 END;
 IF v_from>ctx.school_today OR v_to IS NOT NULL AND v_to<=ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOR v_uid IN SELECT x::uuid FROM jsonb_array_elements_text(p_intent->'targetUserIds') x ORDER BY x COLLATE "C" LOOP
 IF NOT(v_uid=ANY(pol.allowed_user_ids)) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p_lock THEN
 SELECT * INTO u FROM public.users WHERE id=v_uid::text FOR SHARE;
 -- auth 표의 쓰기 권한을 요구하지 않는다. 계정 INSERT의 Auth FK가 삭제 경쟁을 막는다.
 PERFORM 1 FROM auth.users WHERE id=v_uid;found_auth:=FOUND;
 SELECT * INTO a FROM workhub.accounts WHERE auth_user_id=v_uid FOR SHARE;
 PERFORM 1 FROM workhub.memberships WHERE school_id=ctx.school_id AND account_id=a.id ORDER BY id FOR SHARE;
 ELSE
 SELECT * INTO u FROM public.users WHERE id=v_uid::text;
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid) INTO found_auth;
 SELECT * INTO a FROM workhub.accounts WHERE auth_user_id=v_uid;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_array(id,status,valid_from,valid_to,version,permission_version) ORDER BY id),'[]') INTO membership_state
 FROM workhub.memberships WHERE school_id=ctx.school_id AND account_id=a.id;
 SELECT * INTO m FROM workhub.memberships WHERE school_id=ctx.school_id AND account_id=a.id AND status IN('active','suspended','left')
 AND daterange(valid_from,valid_to,'[)')&&daterange(v_from,v_to,'[)') ORDER BY id LIMIT 1;
 mid:=NULL;outcome:='blocked';
 IF u.id IS NOT NULL AND found_auth AND u.is_active AND u.role IN('teacher','superadmin') AND length(btrim(u.name)) BETWEEN 1 AND 50 AND u.name !~ E'[\\x01-\\x1f\\x7f\\u0080-\\u009f]'
 AND (a.id IS NULL OR a.status='active' AND a.legacy_approval_state='approved' AND a.legacy_user_id=v_uid::text AND a.legacy_link_method='same_auth_user')
 AND NOT EXISTS(SELECT 1 FROM workhub.accounts WHERE legacy_user_id=v_uid::text AND auth_user_id<>v_uid)
 AND NOT EXISTS(SELECT 1 FROM workhub.memberships WHERE school_id=ctx.school_id AND account_id=a.id AND status='pending') THEN
 IF m.id IS NULL THEN outcome:=CASE WHEN a.id IS NULL THEN 'link' ELSE 'membership_only' END;
 ELSIF m.status='active' AND daterange(v_from,v_to,'[)')<@daterange(m.valid_from,m.valid_to,'[)') THEN outcome:='already_linked';mid:=m.id;END IF;
 END IF;
 out_rows:=out_rows||jsonb_build_array(jsonb_build_object('legacyUserId',v_uid::text,'name',CASE WHEN length(btrim(u.name)) BETWEEN 1 AND 50 AND u.name !~ E'[\\x01-\\x1f\\x7f\\u0080-\\u009f]' THEN btrim(u.name) ELSE '확인 불가' END,'outcome',outcome,'memberId',mid));
 sources:=sources||jsonb_build_array(jsonb_build_object('uid',v_uid,'user',to_jsonb(u),'authPresent',found_auth,'account',to_jsonb(a),'memberships',membership_state));
 END LOOP;
 RETURN jsonb_build_object('items',out_rows,'allowed',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(out_rows) x WHERE x->>'outcome'='blocked'),
 'fingerprint',workhub_private.request_sha256(jsonb_build_object('school',ctx.school_id,'policy',to_jsonb(pol),'intent',p_intent,'sources',sources)));
END $$;

CREATE FUNCTION public.workhub_school_roster_get(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;pol workhub.school_roster_policies;candidates jsonb;teachers jsonb;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 SELECT * INTO pol FROM workhub.school_roster_policies WHERE school_id=ctx.school_id;
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN
 RETURN workhub_private.p9_envelope(ctx,jsonb_build_object('available',false,'reason','forbidden','version',COALESCE(pol.revision,1),'asOfDate',ctx.school_today,'candidates','[]'::jsonb,'teachers','[]'::jsonb));END IF;
 IF pol.school_id IS NULL OR NOT pol.active OR NOT EXISTS(SELECT 1 FROM workhub.school_admin_activations WHERE school_id=ctx.school_id AND state='active') THEN
 RETURN workhub_private.p9_envelope(ctx,jsonb_build_object('available',false,'reason','not_configured','version',COALESCE(pol.revision,1),'asOfDate',ctx.school_today,'candidates','[]'::jsonb,'teachers','[]'::jsonb));END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('legacyUserId',ids.uid::text,'name',CASE WHEN length(btrim(u.name)) BETWEEN 1 AND 50 AND u.name !~ E'[\\x01-\\x1f\\x7f\\u0080-\\u009f]' THEN btrim(u.name) ELSE '확인 불가' END,'memberId',m.id,
 'state',CASE WHEN u.id IS NULL OR au.id IS NULL OR NOT u.is_active OR u.role NOT IN('teacher','superadmin') OR length(btrim(u.name)) NOT BETWEEN 1 AND 50 OR u.name ~ E'[\\x01-\\x1f\\x7f\\u0080-\\u009f]'
 OR a.id IS NOT NULL AND (a.status<>'active' OR a.legacy_approval_state<>'approved') THEN 'blocked'
 WHEN m.id IS NOT NULL THEN 'linked'
 WHEN EXISTS(SELECT 1 FROM workhub.memberships z WHERE z.school_id=ctx.school_id AND z.account_id=a.id AND z.status IN('pending','suspended')) THEN 'blocked'
 ELSE 'unlinked' END) ORDER BY ids.uid),'[]') INTO candidates
 FROM unnest(pol.allowed_user_ids) ids(uid) LEFT JOIN public.users u ON u.id=ids.uid::text LEFT JOIN auth.users au ON au.id=ids.uid
 LEFT JOIN workhub.accounts a ON a.auth_user_id=ids.uid
 LEFT JOIN LATERAL(SELECT z.id FROM workhub.memberships z WHERE z.school_id=ctx.school_id AND z.account_id=a.id AND z.status='active'
 AND ctx.school_today<@daterange(z.valid_from,z.valid_to,'[)') ORDER BY z.id LIMIT 1) m ON true;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'label',a.display_name) ORDER BY a.display_name COLLATE "C",m.id),'[]') INTO teachers
 FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE m.school_id=ctx.school_id AND workhub_private.p9_teacher_assignable(ctx.school_id,m.id);
 IF jsonb_array_length(teachers)>300 THEN RETURN workhub_private.p9_envelope(ctx,NULL,'CONFLICT');END IF;
 RETURN workhub_private.p9_envelope(ctx,jsonb_build_object('available',true,'reason',NULL,'version',pol.revision,'asOfDate',ctx.school_today,'candidates',candidates,'teachers',teachers));
END $$;
CREATE FUNCTION public.workhub_school_roster_preview(p_member_id text,p_intent jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;plan jsonb;p workhub.school_roster_previews;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 IF NOT(workhub_private.member_has_perm(ctx,'year.manage') AND workhub_private.member_has_perm(ctx,'membership.approve')) THEN RETURN workhub_private.p9_envelope(ctx,NULL,'FORBIDDEN');END IF;
 BEGIN
 IF NOT EXISTS(SELECT 1 FROM workhub.school_admin_activations WHERE school_id=ctx.school_id AND state='active') THEN RAISE EXCEPTION 'NOT_READY';END IF;
 plan:=workhub_private.p9_plan(ctx,p_intent,false);
 INSERT INTO workhub.school_roster_previews(school_id,membership_id,intent,fingerprint,items,allowed,expires_at)
 VALUES(ctx.school_id,ctx.membership_id,p_intent,plan->>'fingerprint',plan->'items',(plan->>'allowed')::boolean,clock_timestamp()+interval '10 minutes') RETURNING * INTO p;
 RETURN workhub_private.p9_envelope(ctx,jsonb_build_object('previewId',p.id,'fingerprint',p.fingerprint,'expiresAt',p.expires_at,'intent',p.intent,'items',p.items,'allowed',p.allowed));
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN('NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND') THEN RETURN workhub_private.p9_envelope(ctx,NULL,SQLERRM);END IF;RAISE;
 END;
END $$;
CREATE FUNCTION public.workhub_school_roster_commit(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;p workhub.school_roster_previews;r workhub.school_roster_requests;plan jsonb;item jsonb;
 v_school text;v_hash text;v_rev integer;v_account text;v_member text;result_items jsonb:='[]';receipt jsonb;u public.users;
BEGIN
 -- 같은 UID를 두 학교에서 동시에 계정으로 만들지 않도록 직렬화한다.
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_roster',0));
 SELECT school_id INTO v_school FROM workhub.memberships WHERE id=p_member_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:'||COALESCE(v_school,'-'),0));
 ctx:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(ctx);
 IF NOT(workhub_private.member_has_perm(ctx,'year.manage') AND workhub_private.member_has_perm(ctx,'membership.approve')) THEN RETURN workhub_private.p9_envelope(ctx,NULL,'FORBIDDEN');END IF;
 BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT workhub_private.p1_exact(p_command,ARRAY['previewId','fingerprint','intent'])
 OR p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$'
 OR jsonb_typeof(p_command->'previewId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_command->'fingerprint') IS DISTINCT FROM 'string'
 OR p_command->>'fingerprint' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.p9_check_intent(p_command->'intent');v_hash:=workhub_private.request_sha256(p_command);
 SELECT * INTO r FROM workhub.school_roster_requests WHERE school_id=ctx.school_id AND membership_id=ctx.membership_id AND request_key=p_request_key;
 IF FOUND THEN
 IF r.command_hash<>v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF r.outcome='closed' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN workhub_private.p9_envelope(ctx,r.result);END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.school_admin_activations WHERE school_id=ctx.school_id AND state='active') THEN RAISE EXCEPTION 'NOT_READY';END IF;
 PERFORM 1 FROM workhub.school_roster_policies WHERE school_id=ctx.school_id FOR UPDATE;
 SELECT * INTO p FROM workhub.school_roster_previews WHERE id=p_command->>'previewId' AND school_id=ctx.school_id AND membership_id=ctx.membership_id FOR SHARE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.intent<>p_command->'intent' OR p.fingerprint<>p_command->>'fingerprint' OR p.expires_at<=clock_timestamp()
 OR NOT p.allowed OR EXISTS(SELECT 1 FROM workhub.school_roster_requests WHERE preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 plan:=workhub_private.p9_plan(ctx,p.intent,true);
 IF plan->>'fingerprint'<>p.fingerprint OR NOT(plan->>'allowed')::boolean THEN RAISE EXCEPTION 'CONFLICT';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(plan->'items') LOOP
 SELECT * INTO u FROM public.users WHERE id=item->>'legacyUserId';
 SELECT id INTO v_account FROM workhub.accounts WHERE auth_user_id=(item->>'legacyUserId')::uuid;
 IF item->>'outcome'='already_linked' THEN v_member:=item->>'memberId';
 ELSE
 IF v_account IS NULL THEN
 INSERT INTO workhub.accounts(auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,email,legacy_approval_state)
 VALUES(u.id::uuid,u.id,'same_auth_user',clock_timestamp(),btrim(u.name),u.email,'approved') RETURNING id INTO v_account;END IF;
 INSERT INTO workhub.memberships(school_id,account_id,status,employment_type,valid_from,valid_to,decided_by_membership_id,decided_at,decision_note)
 VALUES(ctx.school_id,v_account,'active','teacher',(p.intent->>'startsOn')::date,
 CASE WHEN p.intent->'lastDay'='null'::jsonb THEN NULL ELSE (p.intent->>'lastDay')::date+1 END,ctx.membership_id,clock_timestamp(),p.intent->>'reason')
 RETURNING id INTO v_member;END IF;
 result_items:=result_items||jsonb_build_array(jsonb_build_object('legacyUserId',u.id,'memberId',v_member,'outcome',CASE WHEN item->>'outcome'='already_linked' THEN 'already_linked' ELSE 'linked' END));
 INSERT INTO workhub.school_roster_links(school_id,actor_membership_id,request_key,legacy_user_id,account_id,membership_id,outcome)
 VALUES(ctx.school_id,ctx.membership_id,p_request_key,u.id::uuid,v_account,v_member,CASE WHEN item->>'outcome'='already_linked' THEN 'already_linked' ELSE 'linked' END);
 END LOOP;
 UPDATE workhub.school_roster_policies SET revision=revision+1,updated_at=clock_timestamp() WHERE school_id=ctx.school_id RETURNING revision INTO v_rev;
 UPDATE workhub.school_admin_activations SET revision=revision+1,updated_at=clock_timestamp() WHERE school_id=ctx.school_id;
 receipt:=jsonb_build_object('requestKey',p_request_key,'version',v_rev,'recordedAt',clock_timestamp(),'items',result_items);
 INSERT INTO workhub.school_roster_requests(school_id,membership_id,request_key,command_hash,preview_id,outcome,result) VALUES(ctx.school_id,ctx.membership_id,p_request_key,v_hash,p.id,'applied',receipt);
 PERFORM workhub_private.write_audit(ctx,'school_roster.link','school_roster',ctx.school_id,v_rev,'school',p_request_key,jsonb_build_object('count',jsonb_array_length(result_items),'preview_id',p.id));
 RETURN workhub_private.p9_envelope(ctx,receipt);
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN('INVALID_INPUT','NOT_READY','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT') THEN RETURN workhub_private.p9_envelope(ctx,NULL,SQLERRM);END IF;RAISE;
 WHEN unique_violation OR exclusion_violation OR foreign_key_violation THEN RETURN workhub_private.p9_envelope(ctx,NULL,'CONFLICT');
 END;
END $$;
-- 명시적 요청 닫기. 적용과 같은 잠금으로 원래 적용/취소 둘 중 하나만 확정한다.
-- 중지·미리보기 만료는 복구를 막지 않지만 현재 본인·학교·소속·관리 권한은 유지한다.
CREATE FUNCTION public.workhub_school_roster_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;p workhub.school_roster_previews;r workhub.school_roster_requests;v_school text;v_hash text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_roster',0));
 SELECT school_id INTO v_school FROM workhub.memberships WHERE id=p_member_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:'||COALESCE(v_school,'-'),0));
 ctx:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(ctx);
 IF NOT(workhub_private.member_has_perm(ctx,'year.manage') AND workhub_private.member_has_perm(ctx,'membership.approve')) THEN RETURN workhub_private.p9_envelope(ctx,NULL,'FORBIDDEN');END IF;
 BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT workhub_private.p1_exact(p_command,ARRAY['previewId','fingerprint','intent'])
 OR p_request_key IS NULL OR p_request_key!~'^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$'
 OR jsonb_typeof(p_command->'previewId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_command->'fingerprint') IS DISTINCT FROM 'string'
 OR p_command->>'fingerprint' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.p9_check_intent(p_command->'intent');v_hash:=workhub_private.request_sha256(p_command);
 SELECT * INTO r FROM workhub.school_roster_requests WHERE school_id=ctx.school_id AND membership_id=ctx.membership_id AND request_key=p_request_key;
 IF FOUND THEN
 IF r.command_hash<>v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 RETURN workhub_private.p9_envelope(ctx,jsonb_build_object('requestKey',p_request_key,'outcome',r.outcome,'receipt',r.result));END IF;
 SELECT * INTO p FROM workhub.school_roster_previews WHERE id=p_command->>'previewId' AND school_id=ctx.school_id AND membership_id=ctx.membership_id FOR SHARE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.intent<>p_command->'intent' OR p.fingerprint<>p_command->>'fingerprint' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 -- 같은 미리보기의 다른 번호를 닫아 기존 적용 결과를 취소한 것으로 오인하지 않는다.
 IF EXISTS(SELECT 1 FROM workhub.school_roster_requests WHERE preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 INSERT INTO workhub.school_roster_requests(school_id,membership_id,request_key,command_hash,preview_id,outcome,result)
 VALUES(ctx.school_id,ctx.membership_id,p_request_key,v_hash,p.id,'closed',NULL);
 PERFORM workhub_private.write_audit(ctx,'school_roster.close','school_roster',ctx.school_id,NULL,'school',p_request_key,jsonb_build_object('preview_id',p.id));
 RETURN workhub_private.p9_envelope(ctx,jsonb_build_object('requestKey',p_request_key,'outcome','closed','receipt',NULL));
 EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN('INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT') THEN RETURN workhub_private.p9_envelope(ctx,NULL,SQLERRM);END IF;RAISE;
 WHEN unique_violation OR foreign_key_violation THEN RETURN workhub_private.p9_envelope(ctx,NULL,'CONFLICT');
 END;
END $$;
REVOKE ALL ON FUNCTION workhub_private.p9_envelope(workhub_private.actor_context,jsonb,text),workhub_private.p9_teacher_assignable(text,text),
 workhub_private.p9_check_intent(jsonb),workhub_private.p9_plan(workhub_private.actor_context,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_school_roster_get(text),public.workhub_school_roster_preview(text,jsonb),public.workhub_school_roster_commit(text,jsonb,text),public.workhub_school_roster_close(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_school_roster_get(text),public.workhub_school_roster_preview(text,jsonb),public.workhub_school_roster_commit(text,jsonb,text),public.workhub_school_roster_close(text,jsonb,text) TO authenticated;
INSERT INTO workhub_private.p9_installs(batch,release) VALUES('P9-01','2026-10-20.1');
COMMIT;
