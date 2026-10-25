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
