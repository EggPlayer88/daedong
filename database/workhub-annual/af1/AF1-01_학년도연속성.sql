-- AF1: 재직 소속은 학년도와 분리한다. 기존 종료일·역할·자료를 자동 연장하지 않는다.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE workhub_private.af1_installs(batch text PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON workhub_private.af1_installs FROM PUBLIC,anon,authenticated,service_role;

-- 변경 전 행을 치환하면 현재 표를 수정하지 않고 관리자가 있었던 구간을 계산할 수 있다.
CREATE FUNCTION workhub_private.af1_admin_coverage(s text, old_member jsonb DEFAULT NULL, old_role jsonb DEFAULT NULL)
RETURNS datemultirange LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH m AS (
 SELECT x.* FROM workhub.memberships x WHERE x.school_id=s AND (old_member IS NULL OR x.id<>old_member->>'id')
 UNION ALL SELECT x.* FROM jsonb_populate_record(NULL::workhub.memberships,old_member) x WHERE old_member IS NOT NULL
 ), r AS (
 SELECT x.* FROM workhub.membership_roles x WHERE x.school_id=s AND (old_role IS NULL OR x.id<>old_role->>'id')
 UNION ALL SELECT x.* FROM jsonb_populate_record(NULL::workhub.membership_roles,old_role) x WHERE old_role IS NOT NULL
 ) SELECT COALESCE(range_agg(daterange(m.valid_from,m.valid_to,'[)') * daterange(r.valid_from,r.valid_to,'[)')),'{}'::datemultirange)
 FROM m JOIN r ON r.school_id=m.school_id AND r.membership_id=m.id
 JOIN workhub.accounts a ON a.id=m.account_id
 WHERE m.school_id=s AND m.status='active' AND r.role_code='school_admin' AND r.scope_type='school'
 AND r.revoked_at IS NULL AND a.status='active' AND a.legacy_approval_state='approved'
 AND daterange(m.valid_from,m.valid_to,'[)') && daterange(r.valid_from,r.valid_to,'[)')
$$;
CREATE FUNCTION workhub_private.af1_admin_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM workhub.schools WHERE id=OLD.school_id FOR UPDATE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION workhub_private.af1_admin_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior datemultirange; current_coverage datemultirange; future datemultirange; tz text;
BEGIN
 SELECT timezone INTO tz FROM workhub.schools WHERE id=OLD.school_id;
 future:=datemultirange(daterange(workhub_private.today_in(tz),NULL,'[)'));
 prior:=workhub_private.af1_admin_coverage(OLD.school_id,
 CASE WHEN TG_TABLE_NAME='memberships' THEN to_jsonb(OLD) END,
 CASE WHEN TG_TABLE_NAME='membership_roles' THEN to_jsonb(OLD) END);
 current_coverage:=workhub_private.af1_admin_coverage(OLD.school_id);
 IF (prior * future) - current_coverage <> '{}'::datemultirange THEN
  RAISE EXCEPTION 'CONFLICT' USING DETAIL='마지막 학교 관리자가 없어지는 기간이 생깁니다. 다른 관리자의 소속·역할 기간을 먼저 확인해 주세요.';
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER af1_members_lock BEFORE UPDATE OR DELETE ON workhub.memberships FOR EACH ROW EXECUTE FUNCTION workhub_private.af1_admin_lock();
CREATE TRIGGER af1_members_guard AFTER UPDATE OR DELETE ON workhub.memberships FOR EACH ROW EXECUTE FUNCTION workhub_private.af1_admin_guard();
CREATE TRIGGER af1_roles_lock BEFORE UPDATE OR DELETE ON workhub.membership_roles FOR EACH ROW EXECUTE FUNCTION workhub_private.af1_admin_lock();
CREATE TRIGGER af1_roles_guard AFTER UPDATE OR DELETE ON workhub.membership_roles FOR EACH ROW EXECUTE FUNCTION workhub_private.af1_admin_guard();

CREATE FUNCTION public.workhub_annual_readiness(p_member_id text,p_from text,p_until text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; span daterange; gaps datemultirange; data jsonb;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 BEGIN
 IF NOT workhub_private.p5_manager(ctx) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT workhub_private.p7_admin_active(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 span:=workhub_private.t2_range(p_from,p_until,400);
 gaps:=datemultirange(span)-workhub_private.af1_admin_coverage(ctx.school_id);
 SELECT jsonb_build_object('from',p_from,'until',p_until,'today',ctx.school_today,
 'adminGaps',COALESCE((SELECT jsonb_agg(jsonb_build_object('from',lower(g),'until',upper(g))) FROM unnest(gaps) g),'[]'::jsonb),
 'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',a.display_name,'status',m.status,
 'from',m.valid_from,'until',m.valid_to,'version',m.version) ORDER BY a.display_name,m.id)
 FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE m.school_id=ctx.school_id AND m.status IN('active','suspended','left')),'[]'::jsonb),
 'assignmentCount',(SELECT count(*) FROM workhub.staff_assignments x WHERE x.school_id=ctx.school_id AND x.status='active' AND daterange(x.valid_from,x.valid_to,'[)') && span)) INTO data;
 RETURN jsonb_build_object('contract','school-annual.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'data',data);
 EXCEPTION WHEN raise_exception THEN IF NOT workhub_private.p7_business(SQLERRM) THEN RAISE;END IF;
 RETURN jsonb_build_object('contract','school-annual.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END;
END $$;
REVOKE ALL ON FUNCTION workhub_private.af1_admin_coverage(text,jsonb,jsonb),workhub_private.af1_admin_lock(),workhub_private.af1_admin_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_annual_readiness(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_annual_readiness(text,text,text) TO authenticated;
INSERT INTO workhub_private.af1_installs(batch) VALUES('AF1-01');
COMMIT;
