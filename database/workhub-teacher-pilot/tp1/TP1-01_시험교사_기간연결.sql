-- TP1: 명시한 시험 교사 10명만 등록한다. 설치만으로 계정·허용·연결은 생기지 않는다.
BEGIN;
DO $$ BEGIN
 IF to_regnamespace('teacher_pilot') IS NOT NULL THEN RAISE EXCEPTION 'TP1 already installed'; END IF;
 IF to_regclass('teacher_roster.links') IS NULL OR to_regclass('workhub.participant_grants') IS NULL
 OR to_regclass('workhub.teaching_relation_ends') IS NULL OR to_regprocedure('workhub_private.p6_service_member(uuid,text)') IS NULL
 THEN RAISE EXCEPTION 'TP1 requires TR1, OP1, P8 and P10 AI'; END IF;
END $$;
CREATE SCHEMA teacher_pilot;
REVOKE ALL ON SCHEMA teacher_pilot FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE teacher_pilot.installs(batch text PRIMARY KEY,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE teacher_pilot.batches(
 id text PRIMARY KEY CHECK(id~'^[a-z][a-z0-9-]{2,47}$'),school_id text NOT NULL REFERENCES workhub.schools(id),
 admin_member_id text NOT NULL,starts_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','active','stopped')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),manifest_hash text NOT NULL,
 approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),app_deploy_ref text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),stopped_at timestamptz,
 FOREIGN KEY(school_id,admin_member_id) REFERENCES workhub.memberships(school_id,id),
 CHECK(expires_at>starts_at AND expires_at<=starts_at+interval '7 days'));
CREATE UNIQUE INDEX tp1_one_live_batch ON teacher_pilot.batches(school_id) WHERE state<>'stopped';
CREATE TABLE teacher_pilot.members(
 batch_id text NOT NULL REFERENCES teacher_pilot.batches(id),slot text NOT NULL CHECK(slot~'^T(0[1-9]|10)$'),
 school_id text NOT NULL,teacher_id text NOT NULL,auth_user_id uuid NOT NULL REFERENCES auth.users(id),
 account_id text NOT NULL REFERENCES workhub.accounts(id),member_id text NOT NULL,
 email text NOT NULL,display_name text NOT NULL,link_from date,link_until date,
 PRIMARY KEY(batch_id,slot),UNIQUE(auth_user_id),UNIQUE(member_id),UNIQUE(batch_id,teacher_id),
 FOREIGN KEY(school_id,member_id,account_id) REFERENCES workhub.memberships(school_id,id,account_id),
 FOREIGN KEY(school_id,teacher_id) REFERENCES teacher_roster.teachers(school_id,id));
CREATE TABLE teacher_pilot.ends(
 batch_id text PRIMARY KEY REFERENCES teacher_pilot.batches(id),admin_member_id text NOT NULL,
 end_date date NOT NULL,reason text NOT NULL,receipt jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE teacher_pilot.assignment_links(
 batch_id text NOT NULL REFERENCES teacher_pilot.batches(id),member_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('course','staff')),assignment_id text NOT NULL,
 PRIMARY KEY(batch_id,kind,assignment_id));
CREATE TABLE teacher_pilot.changes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,batch_id text NOT NULL REFERENCES teacher_pilot.batches(id),
 operation text NOT NULL,details jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE teacher_pilot.patch_receipts(
 signature text PRIMARY KEY,before_hash text NOT NULL,after_hash text NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='teacher_pilot' LOOP
 EXECUTE format('ALTER TABLE teacher_pilot.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON teacher_pilot.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA teacher_pilot FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tp1_ends_immutable BEFORE UPDATE OR DELETE ON teacher_pilot.ends FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER tp1_changes_immutable BEFORE UPDATE OR DELETE ON teacher_pilot.changes FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER tp1_patches_immutable BEFORE UPDATE OR DELETE ON teacher_pilot.patch_receipts FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE FUNCTION teacher_pilot.manage(p_school text,p_admin text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;m workhub.memberships;a workhub.accounts;s workhub.schools;
BEGIN
 -- 관리용 SQL 연결만 허용한다. SECURITY DEFINER의 current_user를 권한 근거로 삼지 않는다.
 IF coalesce(current_setting('role',true),'none') NOT IN('none','postgres') OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO s FROM workhub.schools WHERE id=p_school AND status='active' FOR SHARE;
 SELECT * INTO m FROM workhub.memberships WHERE school_id=p_school AND id=p_admin AND status='active' FOR SHARE;
 SELECT * INTO a FROM workhub.accounts WHERE id=m.account_id AND status='active' AND legacy_approval_state='approved' FOR SHARE;
 IF s.id IS NULL OR m.id IS NULL OR a.id IS NULL OR NOT(workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)'))
 OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=a.auth_user_id::text AND role='superadmin' AND is_active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ctx:=ROW('member',a.id,m.id,NULL,s.id,'s:'||s.id,a.auth_user_id,workhub_private.today_in(s.timezone),s.timezone)::workhub_private.actor_context;
 IF NOT workhub_private.member_has_perm(ctx,'membership.approve') OR NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION teacher_pilot.allowed(p_school text,p_member text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM teacher_pilot.members x JOIN teacher_pilot.batches b ON b.id=x.batch_id
 JOIN workhub.memberships m ON m.school_id=x.school_id AND m.id=x.member_id AND m.account_id=x.account_id
 JOIN workhub.accounts a ON a.id=x.account_id AND a.auth_user_id=x.auth_user_id
 JOIN public.users u ON u.id=x.auth_user_id::text JOIN workhub.schools s ON s.id=x.school_id
 JOIN workhub.participant_grants g ON g.school_id=x.school_id AND g.membership_id=x.member_id AND g.auth_user_id=x.auth_user_id
 WHERE x.school_id=p_school AND x.member_id=p_member AND b.state='active' AND b.starts_at<=statement_timestamp() AND b.expires_at>statement_timestamp()
 AND g.active AND g.expires_at>=b.expires_at AND ARRAY['messages','tasks','calendar','cooperation','collections','transitions','teaching','timetable']::text[]<@g.scopes
 AND u.role='teacher' AND u.is_active AND a.status='active' AND a.legacy_approval_state='approved' AND s.status='active' AND m.status='active'
 AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)'))
$$;
CREATE FUNCTION teacher_pilot.actor(p_member text,p_lock boolean) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;x teacher_pilot.members;
BEGIN
 IF public.get_my_role()='superadmin' THEN RETURN workhub_private.member_actor(p_member,p_lock); END IF;
 ctx:=workhub_private.op1_actor(p_member,p_lock,'tasks');
 SELECT * INTO x FROM teacher_pilot.members WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND auth_user_id=ctx.auth_user_id;
 IF x.member_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_lock THEN PERFORM 1 FROM teacher_pilot.batches WHERE id=x.batch_id FOR SHARE; END IF;
 IF NOT teacher_pilot.allowed(ctx.school_id,ctx.membership_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION public.workhub_teacher_pilot_access() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid();x teacher_pilot.members;b teacher_pilot.batches;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO x FROM teacher_pilot.members WHERE auth_user_id=uid;
 IF x.member_id IS NOT NULL AND teacher_pilot.allowed(x.school_id,x.member_id) THEN
 SELECT * INTO b FROM teacher_pilot.batches WHERE id=x.batch_id;
 RETURN jsonb_build_object('contract','workhub.teacher-pilot.v1','userId',uid,'allowed',true,'schoolId',x.school_id,'memberId',x.member_id,
 'batchId',b.id,'teacherId',x.teacher_id,'expiresAt',workhub_private.p2_ts(b.expires_at),'revision',b.revision);END IF;
 RETURN jsonb_build_object('contract','workhub.teacher-pilot.v1','userId',uid,'allowed',false);
END $$;

CREATE FUNCTION teacher_pilot.register(p_school text,p_admin_member text,p_batch text,p_starts timestamptz,p_expires timestamptz,p_entries jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;e jsonb;u public.users;au auth.users;a text;m text;h text;b teacher_pilot.batches;metadata jsonb;member_until date;configuration_hash text;
BEGIN
 ctx:=teacher_pilot.manage(p_school,p_admin_member);
 PERFORM pg_advisory_xact_lock(hashtextextended('teacher-pilot:'||p_school,0));
 IF p_batch IS NULL OR p_batch!~'^[a-z][a-z0-9-]{2,47}$' OR p_starts IS NULL OR p_expires IS NULL OR p_expires<=p_starts OR p_expires>p_starts+interval '7 days'
 OR p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries)<>10 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 h:=workhub_private.p2_sha(jsonb_build_object('schoolId',p_school,'startsAt',p_starts,'expiresAt',p_expires,'entries',p_entries));
 SELECT * INTO b FROM teacher_pilot.batches WHERE id=p_batch FOR UPDATE;
 IF b.id IS NOT NULL THEN
 IF b.school_id<>p_school OR b.manifest_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 RETURN jsonb_build_object('batchId',b.id,'state',b.state,'count',10,'revision',b.revision);END IF;
 IF p_expires<=clock_timestamp() OR p_starts>clock_timestamp()+interval '7 days' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF (SELECT count(DISTINCT value->>'slot') FROM jsonb_array_elements(p_entries))<>10
 OR (SELECT count(DISTINCT value->>'authUserId') FROM jsonb_array_elements(p_entries))<>10
 OR (SELECT count(DISTINCT value->>'teacherId') FROM jsonb_array_elements(p_entries))<>10 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 member_until:=((p_expires AT TIME ZONE ctx.school_timezone)::date+1);
 -- 모든 대상을 먼저 점검한다. 기존 실제 계정·기존 소속은 채택하지 않는다.
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
 IF NOT workhub_private.p2_exact(e,ARRAY['slot','email','displayName','teacherId','authUserId'])
 OR coalesce(e->>'slot','')!~'^T(0[1-9]|10)$' OR e->>'email' IS DISTINCT FROM 'teacher-pilot-'||p_batch||'-'||lower(e->>'slot')||'@example.com'
 OR coalesce(e->>'displayName','') NOT LIKE '[시험] %' OR length(e->>'displayName') NOT BETWEEN 6 AND 50
 OR coalesce(e->>'authUserId','')!~'^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 -- Auth 표에는 조회 권한만 필요하다. FOR SHARE는 불필요한 UPDATE 권한까지 요구한다.
 SELECT * INTO au FROM auth.users WHERE id=(e->>'authUserId')::uuid;
 SELECT * INTO u FROM public.users WHERE id=e->>'authUserId' FOR UPDATE;
 metadata:=au.raw_app_meta_data->'teacher_pilot';
 IF configuration_hash IS NULL THEN configuration_hash:=metadata->>'configHash'; END IF;
 IF au.id IS NULL OR u.id IS NULL OR au.email IS DISTINCT FROM e->>'email' OR u.email IS DISTINCT FROM e->>'email'
 OR u.name IS DISTINCT FROM e->>'displayName' OR u.role IS DISTINCT FROM 'teacher' OR au.email_confirmed_at IS NULL
 OR metadata->>'batchId' IS DISTINCT FROM p_batch OR metadata->>'schoolId' IS DISTINCT FROM p_school
 OR metadata->>'teacherId' IS DISTINCT FROM e->>'teacherId' OR metadata->>'slot' IS DISTINCT FROM e->>'slot'
 OR coalesce(metadata->>'configHash','')!~'^[0-9a-f]{64}$'
 OR metadata->>'configHash' IS DISTINCT FROM configuration_hash
 OR EXISTS(SELECT 1 FROM workhub.accounts WHERE auth_user_id=au.id OR legacy_user_id=u.id)
 OR NOT EXISTS(SELECT 1 FROM teacher_roster.teachers WHERE school_id=p_school AND id=e->>'teacherId' AND kind='person')
 OR EXISTS(SELECT 1 FROM teacher_roster.links WHERE school_id=p_school AND teacher_id=e->>'teacherId')
 THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL='신규 시험 계정·명부·메타데이터를 확인하세요.';END IF;
 END LOOP;
 INSERT INTO teacher_pilot.batches(id,school_id,admin_member_id,starts_at,expires_at,manifest_hash,approval_ref)
 VALUES(p_batch,p_school,p_admin_member,p_starts,p_expires,h,p_reason);
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) ORDER BY value->>'slot' LOOP
 UPDATE public.users SET is_active=true WHERE id=e->>'authUserId' AND role='teacher';
 INSERT INTO workhub.accounts(auth_user_id,legacy_user_id,legacy_link_method,legacy_linked_at,display_name,email,legacy_approval_state)
 VALUES((e->>'authUserId')::uuid,e->>'authUserId','same_auth_user',clock_timestamp(),e->>'displayName',e->>'email','approved') RETURNING id INTO a;
 INSERT INTO workhub.memberships(school_id,account_id,status,employment_type,valid_from,valid_to,decided_by_membership_id,decided_at,decision_note)
 VALUES(p_school,a,'active','teacher',ctx.school_today,member_until,p_admin_member,clock_timestamp(),p_reason) RETURNING id INTO m;
 INSERT INTO teacher_pilot.members(batch_id,slot,school_id,teacher_id,auth_user_id,account_id,member_id,email,display_name)
 VALUES(p_batch,e->>'slot',p_school,e->>'teacherId',(e->>'authUserId')::uuid,a,m,e->>'email',e->>'displayName');
 END LOOP;
 INSERT INTO teacher_pilot.changes(batch_id,operation,details) VALUES(p_batch,'register',jsonb_build_object('manifestHash',h,'count',10));
 PERFORM workhub_private.write_audit(ctx,'teacher_pilot.register','teacher_pilot',p_batch,1,'school',p_batch||':register',jsonb_build_object('count',10,'manifestHash',h));
 RETURN jsonb_build_object('batchId',p_batch,'state','prepared','count',10,'revision',1);
END $$;

CREATE FUNCTION teacher_pilot.activate(p_school text,p_admin text,p_batch text,p_expected_revision integer,p_link_from date,p_link_until date,p_deploy_ref text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;b teacher_pilot.batches;x teacher_pilot.members;i jsonb;v jsonb;old_courses text[];old_staff text[];r integer;
BEGIN
 ctx:=teacher_pilot.manage(p_school,p_admin);
 PERFORM pg_advisory_xact_lock(hashtextextended('teacher-pilot:'||p_school,0));
 SELECT * INTO b FROM teacher_pilot.batches WHERE id=p_batch AND school_id=p_school FOR UPDATE;
 IF b.state='active' AND b.revision=p_expected_revision+1 AND b.app_deploy_ref=p_deploy_ref
 AND NOT EXISTS(SELECT 1 FROM teacher_pilot.members WHERE batch_id=p_batch AND (link_from IS DISTINCT FROM p_link_from OR link_until IS DISTINCT FROM p_link_until)) THEN
 RETURN jsonb_build_object('batchId',p_batch,'state','active','count',10,'revision',b.revision);END IF;
 IF b.id IS NULL OR b.revision IS DISTINCT FROM p_expected_revision OR b.state<>'prepared' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF p_deploy_ref IS NULL OR length(btrim(p_deploy_ref)) NOT BETWEEN 8 AND 200 OR b.starts_at>clock_timestamp() OR b.expires_at<=clock_timestamp()
 OR b.expires_at>clock_timestamp()+interval '7 days' OR p_link_from IS NULL OR p_link_until IS NULL OR p_link_from<ctx.school_today OR p_link_until<=p_link_from
 OR p_link_until>(b.expires_at AT TIME ZONE ctx.school_timezone)::date THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF (SELECT count(*) FROM teacher_pilot.members WHERE batch_id=p_batch)<>10 THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.school_roster_policies WHERE school_id=p_school AND active) THEN RAISE EXCEPTION 'NOT_READY' USING DETAIL='기존 P9 교사 소속 정책이 활성화되어 있어야 합니다.';END IF;
 PERFORM 1 FROM teacher_roster.schools WHERE school_id=p_school FOR UPDATE;
 FOR x IN SELECT * FROM teacher_pilot.members WHERE batch_id=p_batch ORDER BY slot LOOP
 IF EXISTS(SELECT 1 FROM workhub.participant_grants WHERE auth_user_id=x.auth_user_id)
 OR EXISTS(SELECT 1 FROM workhub.course_assignments WHERE membership_id=x.member_id)
 OR EXISTS(SELECT 1 FROM workhub.staff_assignments WHERE membership_id=x.member_id)
 OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=x.auth_user_id::text AND role='teacher' AND is_active)
 THEN RAISE EXCEPTION 'CONFLICT';END IF;
 SELECT revision INTO r FROM teacher_roster.schools WHERE school_id=p_school;
 i:=jsonb_build_object('kind','link','expectedRevision',r,'teacherId',x.teacher_id,'memberId',x.member_id,'from',p_link_from,'until',p_link_until);
 v:=teacher_roster.evaluate(ctx,i);
 IF v->'findings'<>'[]'::jsonb OR (v#>>'{summary,courses}')::integer=0 THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL='공개된 실제 기본표와 겹치는 수업 기간이 필요합니다.';END IF;
 PERFORM teacher_roster.apply(ctx,i);
 UPDATE teacher_roster.schools SET revision=revision+1 WHERE school_id=p_school;
 UPDATE teacher_pilot.members SET link_from=p_link_from,link_until=p_link_until WHERE batch_id=p_batch AND slot=x.slot;
 INSERT INTO teacher_pilot.assignment_links(batch_id,member_id,kind,assignment_id) SELECT p_batch,x.member_id,'course',id FROM workhub.course_assignments WHERE membership_id=x.member_id;
 INSERT INTO teacher_pilot.assignment_links(batch_id,member_id,kind,assignment_id) SELECT p_batch,x.member_id,'staff',id FROM workhub.staff_assignments WHERE membership_id=x.member_id;
 INSERT INTO workhub.participant_grants(school_id,membership_id,auth_user_id,scopes,active,expires_at,approved_by_membership_id,approval_ref,app_deploy_ref)
 VALUES(p_school,x.member_id,x.auth_user_id,ARRAY['messages','tasks','calendar','cooperation','collections','transitions','teaching','timetable'],true,b.expires_at,p_admin,b.approval_ref,p_deploy_ref);
 END LOOP;
 UPDATE teacher_pilot.batches SET state='active',revision=revision+1,app_deploy_ref=p_deploy_ref WHERE id=p_batch RETURNING revision INTO r;
 INSERT INTO teacher_pilot.changes(batch_id,operation,details) VALUES(p_batch,'activate',jsonb_build_object('from',p_link_from,'until',p_link_until,'appDeployRef',p_deploy_ref));
 PERFORM workhub_private.write_audit(ctx,'teacher_pilot.activate','teacher_pilot',p_batch,r,'school',p_batch||':activate',jsonb_build_object('count',10));
 RETURN jsonb_build_object('batchId',p_batch,'state','active','count',10,'revision',r);
END $$;

DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='teacher_pilot'::regnamespace LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.workhub_teacher_pilot_access() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_teacher_pilot_access() TO authenticated;
INSERT INTO teacher_pilot.installs(batch) VALUES('TP1-01');
COMMIT;
SELECT 'TP1-01' AS no,'ok' AS status,'시험 계정 등록·활성화는 별도이며 설치만으로 허용하지 않습니다.' AS detail;
