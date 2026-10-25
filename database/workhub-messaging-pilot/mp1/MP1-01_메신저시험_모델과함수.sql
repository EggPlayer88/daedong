-- MP1-01 일반 교사 한 명의 메신저 시범 경로 설치. 설치만으로 접근을 허용하지 않습니다.
BEGIN;
DO $guard$
DECLARE r record;p pg_proc; actual_api text;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'MP1: SQL Editor 관리 연결에서만 실행하세요.'; END IF;
 IF to_regclass('workhub_private.mp1_installs') IS NOT NULL THEN RAISE EXCEPTION 'MP1: 이미 설치했습니다. 재설치 대신 MP1-02로 확인해 주세요.'; END IF;
 IF to_regprocedure('public.workhub_school_roster_get(text)') IS NULL THEN RAISE EXCEPTION 'MP1: P9 설치가 필요합니다.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('workhub_storage.knowledge_readable(text,uuid)') AND md5(replace(prosrc,chr(13),''))='8bc5e3e6ef6762573f8230127b0dd70d') THEN RAISE EXCEPTION 'MP1: S3 설치와 INT-08 결과를 확인해 주세요.'; END IF;
 FOR r IN SELECT * FROM (VALUES
('workhub_private.p3_reachable(text,text)','5ac16557218d2e272dc399d42931fbd1','','sql','s'),
('workhub_private.p3_service_member(uuid,text)','9da37e3da04d5ac2659fa48ad3919ebc','','plpgsql','v'),
('workhub_storage.message_insertable(text)','e037b5626801335d5fe22cef7e351e99','authenticated','plpgsql','s'),
('workhub_storage.message_readable(text,uuid)','17e577bb2e249b35458bede8f39d9ff9','authenticated','plpgsql','s'),
('public.workhub_messaging_readiness(text)','565f5d028a1c00ee6c14b2089ff45d53','authenticated','plpgsql','v'),
('public.workhub_message_recipients(text,text,text)','54826d2f9fb17a920b1d8201b1fa117f','authenticated','plpgsql','v'),
('public.workhub_message_threads(text,text,boolean,text)','c2baf18ae554ab6d0f09a2a886327726','authenticated','plpgsql','v'),
('public.workhub_message_get(text,text,text)','d404ce7897c3ff74a6534225a29d092c','authenticated','plpgsql','v'),
('public.workhub_inbox_list(text,boolean,text)','84bda65f9080213e3a44246837fe2ae2','authenticated','plpgsql','v'),
('public.workhub_message_mutate(text,jsonb,text,boolean)','919ea8be63ff20a3bce5ec747d5909f4','authenticated','plpgsql','v'),
('public.workhub_message_file_readiness(text)','f9fcbf7eab780deb941339b352306565','authenticated','plpgsql','v'),
('public.workhub_message_file_prepare(text,jsonb,text,boolean)','f84b46788f6352e6da35911620122de8','authenticated','plpgsql','v'),
('public.workhub_message_file_complete(text,text,text)','e58f3550510d24796873e84946457c3b','authenticated','plpgsql','v'),
('public.workhub_message_file_status(text,text)','804cf625ac939264f7fcab663b107d71','authenticated','plpgsql','v'),
('public.workhub_message_file_access(text,text,text,text)','fc2e023149e0bebc61ada5ebcf63a78f','authenticated','plpgsql','v')
 ) v(signature,hash,api,lang,volatility) LOOP
   SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
   SELECT coalesce(string_agg(x,' ' ORDER BY x),'') INTO actual_api
   FROM unnest(ARRAY['anon','authenticated','service_role']) x WHERE has_function_privilege(x,p.oid,'EXECUTE');
   IF p.oid IS NULL OR md5(replace(p.prosrc,chr(13),''))<>r.hash
     OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR p.provolatile::text<>r.volatility OR (SELECT lanname FROM pg_language WHERE oid=p.prolang)<>r.lang
     OR actual_api<>r.api
     OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') THEN
     RAISE EXCEPTION 'MP1: 확정 P3 함수 원문·소유자·권한·속성이 다릅니다: %',r.signature;
   END IF;
 END LOOP;
END $guard$;
-- MP1: 일반 교사 시험 한 명의 메신저 전용 접근. 운영 설치 파일은 test/build_mp1.py가 만든다.
CREATE TABLE workhub.messaging_pilot_grants (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  school_id text NOT NULL,
  membership_id text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id),
  FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id)
);
ALTER TABLE workhub.messaging_pilot_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub.messaging_pilot_grants FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE workhub_private.mp1_installs (
  batch text PRIMARY KEY CHECK(batch='MP1-01'), installed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workhub_private.mp1_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub_private.mp1_installs FROM PUBLIC,anon,authenticated,service_role;

-- 메신저만 이 함수를 사용한다. 기존 legacy_gate/member_actor/P2 수신 자격은 보존한다.
CREATE FUNCTION workhub_private.mp1_allowed(p_school text,p_member text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
   SELECT 1 FROM workhub.messaging_pilot_grants g
   JOIN workhub.memberships m ON m.school_id=g.school_id AND m.id=g.membership_id
   JOIN workhub.accounts a ON a.id=m.account_id AND a.auth_user_id=g.auth_user_id
   JOIN public.users u ON u.id=a.auth_user_id::text
   JOIN workhub.schools s ON s.id=m.school_id
   WHERE g.school_id=p_school AND g.membership_id=p_member AND g.active
     AND g.expires_at>clock_timestamp() AND u.role='teacher' AND u.is_active
     AND a.status='active' AND a.legacy_approval_state='approved'
     AND s.status='active' AND m.status='active'
     AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)'))
$$;

CREATE FUNCTION workhub_private.mp1_actor(p_member_id text,p_lock boolean) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); a workhub.accounts; s workhub.schools; m workhub.memberships;
 ctx workhub_private.actor_context;
BEGIN
 IF public.get_my_role()='superadmin' THEN RETURN workhub_private.member_actor(p_member_id,p_lock); END IF;
 IF v_uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_lock THEN PERFORM 1 FROM public.users WHERE id=v_uid::text FOR SHARE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_uid::text AND is_active AND role='teacher') THEN
   RAISE EXCEPTION 'FORBIDDEN'; END IF;
 a:=workhub_private.caller_account(v_uid,p_lock);
 IF a.id IS NULL OR p_member_id IS NULL THEN RAISE EXCEPTION 'INACTIVE_MEMBERSHIP'; END IF;
 SELECT * INTO m FROM workhub.memberships WHERE id=p_member_id AND account_id=a.id;
 IF FOUND THEN
   IF p_lock THEN
     SELECT * INTO s FROM workhub.schools WHERE id=m.school_id FOR SHARE;
     SELECT * INTO m FROM workhub.memberships WHERE id=p_member_id AND account_id=a.id FOR SHARE;
     PERFORM 1 FROM workhub.messaging_pilot_grants WHERE singleton FOR SHARE;
   ELSE SELECT * INTO s FROM workhub.schools WHERE id=m.school_id; END IF;
 END IF;
 IF m.id IS NULL OR s.id IS NULL OR NOT workhub_private.mp1_allowed(s.id,m.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ctx.actor_kind:='member'; ctx.account_id:=a.id; ctx.membership_id:=m.id; ctx.school_id:=s.id;
 ctx.scope_key:='s:'||s.id; ctx.auth_user_id:=v_uid;
 ctx.school_today:=workhub_private.today_in(s.timezone); ctx.school_timezone:=s.timezone;
 RETURN ctx;
END $$;

-- 자기 허용 상태만 반환한다. 학교·명단은 거절 응답에 포함하지 않는다.
CREATE FUNCTION public.workhub_messaging_pilot_access() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g workhub.messaging_pilot_grants; ctx workhub_private.actor_context; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO g FROM workhub.messaging_pilot_grants WHERE auth_user_id=uid;
 IF g.auth_user_id IS NOT NULL THEN
   BEGIN
     ctx:=workhub_private.mp1_actor(g.membership_id,false);
     IF public.get_my_role()='teacher' THEN
       RETURN jsonb_build_object('contract','messaging.pilot.v1','userId',uid,'allowed',true,
         'schoolId',g.school_id,'memberId',g.membership_id,'expiresAt',g.expires_at,'revision',g.revision);
     END IF;
   EXCEPTION WHEN raise_exception THEN NULL;
   END;
 END IF;
 RETURN jsonb_build_object('contract','messaging.pilot.v1','userId',uid,'allowed',false);
END $$;

-- 메신저 화면은 본인 소속 한 개만 읽는다. 다른 교사 목록은 기존 메시지 수신자 RPC가 담당한다.
CREATE FUNCTION public.workhub_messaging_pilot_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g workhub.messaging_pilot_grants; ctx workhub_private.actor_context; m workhub.memberships; a workhub.accounts; s workhub.schools;
BEGIN
 SELECT * INTO g FROM workhub.messaging_pilot_grants WHERE auth_user_id=auth.uid();
 IF g.auth_user_id IS NULL OR public.get_my_role() IS DISTINCT FROM 'teacher' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ctx:=workhub_private.mp1_actor(g.membership_id,false);
 SELECT * INTO m FROM workhub.memberships WHERE id=ctx.membership_id;
 SELECT * INTO a FROM workhub.accounts WHERE id=ctx.account_id;
 SELECT * INTO s FROM workhub.schools WHERE id=ctx.school_id;
 RETURN jsonb_build_object('basisDate',ctx.school_today,
   'schools',jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name)),
   'memberships',jsonb_build_array(jsonb_build_object('id',m.id,'schoolId',s.id,'userId',a.auth_user_id,
     'name',a.display_name,'role','teacher','active',true,'validFrom',m.valid_from,
     'validThrough',coalesce(m.valid_to-1,'9999-12-31'::date),'departmentIds','[]'::jsonb,'gradeIds','[]'::jsonb,'subjectIds','[]'::jsonb)),
   'schoolLabels',jsonb_build_object(s.id,jsonb_build_object('departmentIds','[]'::jsonb,'gradeIds','[]'::jsonb,'subjectIds','[]'::jsonb)));
END $$;

REVOKE ALL ON FUNCTION workhub_private.mp1_allowed(text,text),workhub_private.mp1_actor(text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_messaging_pilot_access(),public.workhub_messaging_pilot_context() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_messaging_pilot_access(),public.workhub_messaging_pilot_context() TO authenticated;

CREATE OR REPLACE FUNCTION workhub_private.p3_reachable(p_school text, p_membership text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p2_member_reachable(p_school, p_membership) OR workhub_private.mp1_allowed(p_school, p_membership)
$$;
CREATE OR REPLACE FUNCTION workhub_private.p3_service_member(p_actor uuid, p_member text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '서버 확인 API(service_role, 사람 JWT 없음)만 부를 수 있습니다.';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '확인된 사용자 UID 가 없습니다.'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  IF auth.uid() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청 주체를 확인하지 못했습니다.'; END IF;
  ctx := workhub_private.mp1_actor(p_member, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청 주체를 되돌리지 못했습니다.'; END IF;
  RETURN ctx;
END $$;
CREATE OR REPLACE FUNCTION workhub_storage.message_insertable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.message_files; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p3_installed() OR workhub_private.c_storage_op() IS DISTINCT FROM 'object.upload' THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE storage_path = p_name;
  IF f.id IS NULL OR f.state <> 'awaiting_upload' OR f.upload_expires_at <= clock_timestamp()
     OR NOT EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = f.owner_account_id AND a.auth_user_id = v_uid)
     OR workhub_private.p3_files_reason(f.school_id) <> 'ready' THEN
    RETURN false;
  END IF;
  BEGIN
    ctx := workhub_private.mp1_actor(f.owner_membership_id, false);
  EXCEPTION WHEN raise_exception THEN RETURN false;
  END;
  RETURN ctx.account_id = f.owner_account_id;
END $$;
CREATE OR REPLACE FUNCTION workhub_storage.message_readable(p_name text, p_object uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.message_files; v_op text := workhub_private.c_storage_op(); v_m text; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p3_installed() OR v_op IS NULL OR v_op NOT IN ('object.upload','object.get_authenticated','object.get_authenticated_info') THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE storage_path = p_name;
  IF f.id IS NULL THEN RETURN false; END IF;
  IF f.state = 'awaiting_upload' THEN RETURN workhub_storage.message_insertable(p_name); END IF;
  IF f.state <> 'ready' OR v_op NOT IN ('object.get_authenticated','object.get_authenticated_info') OR p_object IS DISTINCT FROM f.storage_object_id
     OR workhub_private.p3_files_reason(f.school_id) <> 'ready' THEN
    RETURN false;
  END IF;
  FOR v_m IN SELECT f.owner_membership_id WHERE EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = f.owner_account_id AND a.auth_user_id = v_uid)
             UNION
             SELECT tm.membership_id FROM workhub.message_attachments ma JOIN workhub.messages x ON x.id = ma.message_id
               JOIN workhub.message_thread_members tm ON tm.thread_id = x.thread_id
               JOIN workhub.accounts a ON a.id = tm.account_id
              WHERE ma.file_id = f.id AND a.auth_user_id = v_uid LOOP
    BEGIN
      ctx := workhub_private.mp1_actor(v_m, false);
    EXCEPTION WHEN raise_exception THEN CONTINUE;
    END;
    IF ctx.school_id = f.school_id THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_messaging_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  RETURN workhub_private.p3_ok(ctx, workhub_private.p3_readiness(ctx));
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_recipients(p_member_id text, p_query text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_recipients(ctx, p_query, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_threads(p_member_id text, p_query text, p_unread_only boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_threads(ctx, p_query, p_unread_only, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_get(p_member_id text, p_thread_id text, p_before_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_get(ctx, p_thread_id, p_before_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_inbox_list(p_member_id text, p_unread_only boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_inbox(ctx, p_unread_only, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_mutate(p_member_id text, p_command jsonb, p_request_key text, p_replay_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_hash text; r workhub.message_requests; v_data jsonb;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  IF NOT workhub_private.p3_installed() THEN RETURN workhub_private.p3_err(ctx, 'NOT_READY'); END IF;
  IF NOT workhub_private.p3_key(p_request_key) OR p_replay_only IS NULL OR p_command IS NULL OR jsonb_typeof(p_command) <> 'object'
     OR octet_length(p_command::text) > 400000 OR jsonb_typeof(p_command -> 'kind') IS DISTINCT FROM 'string'
     OR p_command ->> 'kind' NOT IN ('start','reply','read_thread','read_notice') THEN
    RETURN workhub_private.p3_err(ctx, 'INVALID_INPUT');
  END IF;
  v_hash := workhub_private.p2_sha(p_command);
  PERFORM workhub_private.p3_lock(ctx, 'mutate', p_request_key);
  SELECT * INTO r FROM workhub.message_requests WHERE school_id = ctx.school_id AND membership_id = ctx.membership_id AND request_key = p_request_key;
  IF r.request_key IS NOT NULL THEN
    IF r.payload_hash <> v_hash OR r.account_id <> ctx.account_id THEN RETURN workhub_private.p3_err(ctx, 'IDEMPOTENCY_CONFLICT'); END IF;
    RETURN workhub_private.p3_ok(ctx, r.response);
  END IF;
  IF p_replay_only THEN RETURN workhub_private.p3_err(ctx, 'NOT_FOUND'); END IF;
  IF workhub_private.p3_messaging_reason(ctx.school_id) <> 'ready' THEN RETURN workhub_private.p3_err(ctx, 'NOT_READY'); END IF;
  BEGIN
    v_data := workhub_private.p3_apply(ctx, p_command, p_request_key);
    INSERT INTO workhub.message_requests (school_id, membership_id, account_id, request_key, command_kind, payload_hash, response)
    VALUES (ctx.school_id, ctx.membership_id, ctx.account_id, p_request_key, p_command ->> 'kind', v_hash, v_data);
    RETURN workhub_private.p3_ok(ctx, v_data);
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_file_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  RETURN workhub_private.p3_ok(ctx, workhub_private.p3_file_readiness(ctx));
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_file_prepare(p_member_id text, p_file jsonb, p_request_key text, p_replay_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_prepare(ctx, p_file, p_request_key, p_replay_only));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_file_complete(p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_complete(ctx, p_file_id, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_file_status(p_member_id text, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_status(ctx, p_file_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE OR REPLACE FUNCTION public.workhub_message_file_access(p_member_id text, p_thread_id text, p_message_id text, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.mp1_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_access(ctx, p_thread_id, p_message_id, p_file_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;
INSERT INTO workhub_private.mp1_installs(batch) VALUES('MP1-01');
COMMIT;
SELECT 'MP1-01' AS no,'메신저 시험 경로 설치 · 허용 명단은 비어 있음' AS item,'ok' AS status;
