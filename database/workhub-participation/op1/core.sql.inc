-- OP1은 지정한 기존 계정의 업무 범위만 연다. 회원·학교 역할·기존 공통 gate는 변경하지 않는다.
CREATE TABLE workhub.participant_grants (
 school_id text NOT NULL, membership_id text NOT NULL, auth_user_id uuid NOT NULL REFERENCES auth.users(id),
 scopes text[] NOT NULL, active boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 approved_by_membership_id text NOT NULL, approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
 app_deploy_ref text NOT NULL CHECK(length(btrim(app_deploy_ref)) BETWEEN 1 AND 200),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,membership_id), UNIQUE(auth_user_id),
 FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id),
 FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id),
 CHECK(workhub_private.op1_valid_scopes(scopes))
);
CREATE TABLE workhub_private.op1_installs(batch text PRIMARY KEY CHECK(batch='OP1-01'),installed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workhub.participant_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub_private.op1_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub.participant_grants,workhub_private.op1_installs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER op1_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.op1_installs FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE FUNCTION workhub_private.op1_allowed(p_school text,p_member text,p_scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM workhub.participant_grants g
 JOIN workhub.memberships m ON m.school_id=g.school_id AND m.id=g.membership_id
 JOIN workhub.accounts a ON a.id=m.account_id AND a.auth_user_id=g.auth_user_id
 JOIN public.users u ON u.id=a.auth_user_id::text JOIN workhub.schools s ON s.id=m.school_id
 WHERE g.school_id=p_school AND g.membership_id=p_member AND g.active AND g.expires_at>statement_timestamp()
 AND p_scope=ANY(g.scopes) AND u.role='teacher' AND u.is_active AND a.status='active' AND a.legacy_approval_state='approved'
 AND s.status='active' AND m.status='active' AND workhub_private.today_in(s.timezone)<@daterange(m.valid_from,m.valid_to,'[)'))
$$;
CREATE FUNCTION workhub_private.op1_reachable(p_school text,p_member text,p_scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT workhub_private.p2_member_reachable(p_school,p_member) OR workhub_private.op1_allowed(p_school,p_member,p_scope)
$$;
CREATE FUNCTION workhub_private.op1_actor(p_member_id text,p_lock boolean,p_scope text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); a workhub.accounts; m workhub.memberships; s workhub.schools; g workhub.participant_grants; ctx workhub_private.actor_context;
BEGIN
 IF public.get_my_role()='superadmin' THEN RETURN workhub_private.member_actor(p_member_id,p_lock); END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_lock THEN PERFORM 1 FROM public.users WHERE id=uid::text FOR SHARE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=uid::text AND is_active AND role='teacher') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 a:=workhub_private.caller_account(uid,p_lock);
 SELECT * INTO m FROM workhub.memberships WHERE id=p_member_id AND account_id=a.id;
 IF m.id IS NULL THEN RAISE EXCEPTION 'INACTIVE_MEMBERSHIP'; END IF;
 IF p_lock THEN
  SELECT * INTO s FROM workhub.schools WHERE id=m.school_id FOR SHARE;
  SELECT * INTO m FROM workhub.memberships WHERE id=p_member_id AND account_id=a.id FOR SHARE;
  SELECT * INTO g FROM workhub.participant_grants WHERE school_id=s.id AND membership_id=m.id FOR SHARE;
 ELSE
  SELECT * INTO s FROM workhub.schools WHERE id=m.school_id;
  SELECT * INTO g FROM workhub.participant_grants WHERE school_id=s.id AND membership_id=m.id;
 END IF;
 IF s.id IS NULL OR g.membership_id IS NULL OR g.auth_user_id IS DISTINCT FROM uid OR NOT g.active
 OR g.expires_at<=clock_timestamp() OR NOT(p_scope=ANY(g.scopes)) OR NOT workhub_private.op1_allowed(s.id,m.id,p_scope)
 THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ctx.actor_kind:='member';ctx.account_id:=a.id;ctx.membership_id:=m.id;ctx.school_id:=s.id;ctx.scope_key:='s:'||s.id;
 ctx.auth_user_id:=uid;ctx.school_today:=workhub_private.today_in(s.timezone);ctx.school_timezone:=s.timezone;
 RETURN ctx;
END $$;

CREATE FUNCTION public.workhub_participant_access() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid();g workhub.participant_grants;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO g FROM workhub.participant_grants WHERE auth_user_id=uid;
 IF g.membership_id IS NOT NULL AND workhub_private.op1_allowed(g.school_id,g.membership_id,g.scopes[1]) THEN
 RETURN jsonb_build_object('contract','workhub.participant.v1','userId',uid,'allowed',true,'schoolId',g.school_id,
 'memberId',g.membership_id,'scopes',g.scopes,'expiresAt',g.expires_at,'revision',g.revision); END IF;
 RETURN jsonb_build_object('contract','workhub.participant.v1','userId',uid,'allowed',false);
END $$;
CREATE FUNCTION public.workhub_participant_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g workhub.participant_grants;ctx workhub_private.actor_context;m workhub.memberships;a workhub.accounts;s workhub.schools;
BEGIN
 SELECT * INTO g FROM workhub.participant_grants WHERE auth_user_id=auth.uid();
 IF g.membership_id IS NULL OR public.get_my_role() IS DISTINCT FROM 'teacher' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ctx:=workhub_private.op1_actor(g.membership_id,false,g.scopes[1]);
 SELECT * INTO m FROM workhub.memberships WHERE id=ctx.membership_id;
 SELECT * INTO a FROM workhub.accounts WHERE id=ctx.account_id;
 SELECT * INTO s FROM workhub.schools WHERE id=ctx.school_id;
 RETURN jsonb_build_object('basisDate',ctx.school_today,'schools',jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name)),
 'memberships',(SELECT jsonb_agg(jsonb_build_object('id',mm.id,'schoolId',s.id,'userId',aa.auth_user_id,'name',aa.display_name,
 'role',CASE WHEN workhub_private.member_has_perm(ROW('member',aa.id,mm.id,NULL,s.id,'s:'||s.id,aa.auth_user_id,ctx.school_today,s.timezone)::workhub_private.actor_context,'calendar.shared_manage') THEN 'calendar_manager' ELSE 'teacher' END,
 'active',mm.status='active' AND aa.status='active','validFrom',mm.valid_from,'validThrough',coalesce(mm.valid_to-1,'9999-12-31'::date))||workhub_private.member_relations(s.id,mm.id) ORDER BY mm.id)
 FROM workhub.memberships mm JOIN workhub.accounts aa ON aa.id=mm.account_id WHERE mm.school_id=s.id AND mm.status IN('active','suspended','left') AND mm.valid_from IS NOT NULL
 AND (mm.id=ctx.membership_id OR g.scopes && ARRAY['calendar','collections']::text[])),
 'schoolLabels',jsonb_build_object(s.id,jsonb_build_object('departmentIds',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name) ORDER BY d.id)
 FROM workhub.departments d WHERE d.school_id=s.id AND ctx.school_today<@daterange(d.active_from,d.active_to,'[)')),'[]'::jsonb),
 'gradeIds',(SELECT jsonb_agg(jsonb_build_object('id',x::text,'name',x::text||'학년')) FROM generate_series(1,s.grade_count) x),'subjectIds','[]'::jsonb)));
END $$;

-- 관리자는 명단과 연결 준비 상태만 조회한다. 브라우저에서 명단·권한을 변경하는 RPC는 없다.
CREATE FUNCTION public.workhub_participant_administration(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 IF NOT workhub_private.member_has_perm(ctx,'role.grant') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('contract','workhub.participant-admin.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,
 'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('memberId',g.membership_id,'name',a.display_name,'scopes',g.scopes,
 'active',g.active,'expiresAt',g.expires_at,'revision',g.revision,'effective',workhub_private.op1_allowed(g.school_id,g.membership_id,g.scopes[1])) ORDER BY g.membership_id)
 FROM workhub.participant_grants g JOIN workhub.memberships m ON m.id=g.membership_id JOIN workhub.accounts a ON a.id=m.account_id WHERE g.school_id=ctx.school_id),'[]'::jsonb),
 'timetableApprovers',(SELECT count(DISTINCT a.account_id) FROM workhub_private.t2_approvers(ctx.school_id,ctx.school_today) a
 WHERE workhub_private.op1_reachable(ctx.school_id,a.membership_id,'timetable')),
 'interventionsReady',workhub_private.t3_ready(ctx) IS NULL);
END $$;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 'op1\_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.workhub_participant_access(),public.workhub_participant_context(),public.workhub_participant_administration(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_participant_access(),public.workhub_participant_context(),public.workhub_participant_administration(text) TO authenticated;
