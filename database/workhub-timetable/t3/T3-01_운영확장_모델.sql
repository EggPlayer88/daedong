-- T3 대강 · 개별 휴강 · 보강 · 휴업 취소. 설치는 활성화가 아니다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('workhub_private.t2_installed_all()') IS NULL THEN RAISE EXCEPTION 'T3: T2 전체를 먼저 설치하세요.';END IF;
 IF NOT workhub_private.t2_installed_all() THEN RAISE EXCEPTION 'T3: T2 전체를 먼저 설치하세요.';END IF;
 IF to_regclass('workhub_private.t3_installs') IS NOT NULL THEN RAISE EXCEPTION 'T3: 이미 설치되어 있습니다.';END IF;
END $$;
CREATE TABLE workhub_private.t3_installs(batch text PRIMARY KEY CHECK(batch IN('T3-01','T3-02','T3-03')),release text NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE workhub.timetable_intervention_policies(
 school_id text PRIMARY KEY REFERENCES workhub.schools(id),active boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 allowed_member_ids text[] NOT NULL CHECK(cardinality(allowed_member_ids) BETWEEN 1 AND 1000),
 approved_by_membership_id text NOT NULL,approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.timetable_intervention_previews(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL,membership_id text NOT NULL,account_id text NOT NULL,
 input jsonb NOT NULL,plan jsonb NOT NULL,preview_hash text NOT NULL CHECK(preview_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
 FOREIGN KEY(school_id,membership_id,account_id) REFERENCES workhub.memberships(school_id,id,account_id));
CREATE TABLE workhub.timetable_interventions(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL,kind text NOT NULL CHECK(kind IN('substitute','cancel','makeup','reopen')),
 requester_membership_id text NOT NULL,requester_account_id text NOT NULL,input jsonb NOT NULL,plan jsonb NOT NULL,
 proposal_hash text NOT NULL CHECK(proposal_hash ~ '^[0-9a-f]{64}$'),preview_id text NOT NULL UNIQUE REFERENCES workhub.timetable_intervention_previews(id),
 state text NOT NULL CHECK(state IN('awaiting_consent','awaiting_approval','applied','rejected','withdrawn')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,decided_by_membership_id text,UNIQUE(school_id,id),
 FOREIGN KEY(school_id,requester_membership_id,requester_account_id) REFERENCES workhub.memberships(school_id,id,account_id),
 FOREIGN KEY(school_id,decided_by_membership_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.timetable_intervention_participants(
 school_id text NOT NULL,intervention_id text NOT NULL,membership_id text NOT NULL,response text NOT NULL DEFAULT 'pending' CHECK(response IN('pending','accepted','rejected')),
 responded_at timestamptz,PRIMARY KEY(intervention_id,membership_id),CHECK((response='pending')=(responded_at IS NULL)),
 FOREIGN KEY(school_id,intervention_id) REFERENCES workhub.timetable_interventions(school_id,id),
 FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.timetable_intervention_versions(
 school_id text NOT NULL,intervention_id text NOT NULL,version integer NOT NULL,snapshot jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(intervention_id,version),
 FOREIGN KEY(school_id,intervention_id) REFERENCES workhub.timetable_interventions(school_id,id));
CREATE TABLE workhub.timetable_intervention_commands(
 school_id text NOT NULL,membership_id text NOT NULL,account_id text NOT NULL,request_key text NOT NULL,
 command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),outcome text NOT NULL CHECK(outcome IN('applied','closed')),receipt jsonb,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(school_id,membership_id,request_key),
 CHECK((outcome='closed' AND receipt IS NULL) OR(outcome='applied' AND receipt IS NOT NULL AND jsonb_typeof(receipt)='object')),
 FOREIGN KEY(school_id,membership_id,account_id) REFERENCES workhub.memberships(school_id,id,account_id));
-- 보강은 취소 원수업을 고치지 않고 새 수업에 연결한다.
CREATE TABLE workhub.timetable_makeup_links(
 school_id text NOT NULL,original_lesson_id text PRIMARY KEY,makeup_lesson_id text NOT NULL UNIQUE,intervention_id text NOT NULL UNIQUE,
 FOREIGN KEY(school_id,original_lesson_id) REFERENCES workhub.timetable_lessons(school_id,id),
 FOREIGN KEY(school_id,makeup_lesson_id) REFERENCES workhub.timetable_lessons(school_id,id),
 FOREIGN KEY(school_id,intervention_id) REFERENCES workhub.timetable_interventions(school_id,id));
CREATE TABLE workhub.timetable_reopened_days(
 school_id text NOT NULL,school_day_change_id text PRIMARY KEY REFERENCES workhub.timetable_school_day_changes(id),
 intervention_id text NOT NULL UNIQUE,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(school_id,intervention_id) REFERENCES workhub.timetable_interventions(school_id,id));
CREATE TABLE workhub.timetable_intervention_sources(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL REFERENCES workhub.schools(id),
 kind text NOT NULL CHECK(kind IN('intervention','school_day')),entity_id text NOT NULL,date date NOT NULL,lesson_id text,
 UNIQUE(school_id,kind,entity_id),FOREIGN KEY(school_id,lesson_id) REFERENCES workhub.timetable_lessons(school_id,id));
CREATE INDEX timetable_interventions_scope_idx ON workhub.timetable_interventions(school_id,created_at,id);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['workhub_private.t3_installs','workhub.timetable_intervention_policies','workhub.timetable_intervention_previews',
 'workhub.timetable_interventions','workhub.timetable_intervention_participants','workhub.timetable_intervention_versions',
 'workhub.timetable_intervention_commands','workhub.timetable_makeup_links','workhub.timetable_reopened_days','workhub.timetable_intervention_sources'] LOOP
 EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated,service_role',t);END LOOP;
 FOREACH t IN ARRAY ARRAY['workhub_private.t3_installs','workhub.timetable_intervention_previews','workhub.timetable_intervention_versions',
 'workhub.timetable_intervention_commands','workhub.timetable_makeup_links','workhub.timetable_reopened_days','workhub.timetable_intervention_sources'] LOOP
 EXECUTE format('CREATE TRIGGER t3_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change()',t);END LOOP;
END $$;
DO $$ BEGIN
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='workhub.timetable_lessons'::regclass AND conname='timetable_lessons_changed_by_check')
 IS DISTINCT FROM 'CHECK ((changed_by = ANY (ARRAY[''publish''::text, ''exchange''::text, ''school_day''::text])))'
 OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='workhub.timetable_lesson_versions'::regclass AND conname='timetable_lesson_versions_kind_check')
 IS DISTINCT FROM 'CHECK ((change_kind = ANY (ARRAY[''publish''::text, ''exchange''::text, ''school_day''::text])))'
 THEN RAISE EXCEPTION 'T3: 수업 이력 제약이 확정 T2 원본과 다릅니다.';END IF;
END $$;
ALTER TABLE workhub.timetable_lessons DROP CONSTRAINT timetable_lessons_changed_by_check;
ALTER TABLE workhub.timetable_lessons ADD CONSTRAINT timetable_lessons_changed_by_check CHECK(changed_by IN('publish','exchange','school_day','intervention'));
ALTER TABLE workhub.timetable_lesson_versions DROP CONSTRAINT timetable_lesson_versions_kind_check;
ALTER TABLE workhub.timetable_lesson_versions ADD CONSTRAINT timetable_lesson_versions_kind_check CHECK(change_kind IN('publish','exchange','school_day','intervention'));
CREATE FUNCTION workhub_private.t3_envelope(ctx workhub_private.actor_context,d jsonb,e text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('contract','timetable-interventions.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id)
 ||CASE WHEN e IS NULL THEN jsonb_build_object('data',d) ELSE jsonb_build_object('error',jsonb_build_object('code',e)) END $$;
-- 기존 업무실 입구보다 좁은 시범 자격. legacy_gate는 바꾸지 않는다.
CREATE FUNCTION workhub_private.t3_member(p_school text,p_member text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT workhub_private.p2_member_reachable(p_school,p_member) AND EXISTS(
 SELECT 1 FROM workhub.timetable_intervention_policies p WHERE p.school_id=p_school AND p_member=ANY(p.allowed_member_ids)) $$;
CREATE FUNCTION workhub_private.t3_approvers(p_school text,p_today date) RETURNS TABLE(membership_id text,account_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.membership_id,a.account_id FROM workhub_private.t2_approvers(p_school,p_today) a WHERE workhub_private.t3_member(p_school,a.membership_id) $$;
CREATE FUNCTION workhub_private.t3_ready(ctx workhub_private.actor_context) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT workhub_private.t2_ready(ctx.school_id) OR NOT EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies p WHERE p.school_id=ctx.school_id AND p.active)
 THEN RETURN 'not_configured';END IF;
 IF NOT workhub_private.t3_member(ctx.school_id,ctx.membership_id) THEN RETURN 'not_allowed';END IF;
 IF (SELECT count(DISTINCT account_id) FROM workhub_private.t3_approvers(ctx.school_id,ctx.school_today))<2 THEN RETURN 'approvers_missing';END IF;
 RETURN NULL;END $$;
CREATE FUNCTION workhub_private.t3_stale(r workhub.timetable_interventions) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'sources') x LEFT JOIN workhub.timetable_lessons l
 ON l.school_id=r.school_id AND l.id=x->>'id' WHERE l.id IS NULL OR l.version<>(x->>'version')::integer) $$;
CREATE FUNCTION workhub_private.t3_live(r workhub.timetable_interventions,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT r.state IN('awaiting_consent','awaiting_approval') AND r.expires_at>p_at AND NOT workhub_private.t3_stale(r) $$;
CREATE FUNCTION workhub_private.t3_visible(r workhub.timetable_interventions,ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT r.school_id=ctx.school_id AND (r.requester_account_id=ctx.account_id OR workhub_private.p5_manager(ctx)
 OR EXISTS(SELECT 1 FROM workhub.timetable_intervention_participants p WHERE p.intervention_id=r.id AND p.membership_id=ctx.membership_id)) $$;
CREATE FUNCTION workhub_private.t3_record_version(r workhub.timetable_interventions) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO workhub.timetable_intervention_versions(school_id,intervention_id,version,snapshot)
 SELECT r.school_id,r.id,r.version,jsonb_build_object('request',to_jsonb(r),'participants',
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.membership_id) FROM workhub.timetable_intervention_participants p WHERE p.intervention_id=r.id)) $$;
CREATE FUNCTION workhub_private.t3_actions(r workhub.timetable_interventions,ctx workhub_private.actor_context,p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN workhub_private.t3_ready(ctx) IS NOT NULL OR NOT workhub_private.t3_live(r,p_at) THEN '[]'::jsonb ELSE
 (CASE WHEN r.requester_account_id=ctx.account_id THEN '["withdraw"]'::jsonb ELSE '[]'::jsonb END)
 ||(CASE WHEN r.state='awaiting_consent' AND EXISTS(SELECT 1 FROM workhub.timetable_intervention_participants p
 WHERE p.intervention_id=r.id AND p.membership_id=ctx.membership_id AND p.response='pending') THEN '["accept","reject"]'::jsonb ELSE '[]'::jsonb END)
 ||(CASE WHEN r.state='awaiting_approval' AND workhub_private.p5_manager(ctx) AND r.requester_account_id<>ctx.account_id
 AND NOT EXISTS(SELECT 1 FROM workhub.timetable_intervention_participants p JOIN workhub.memberships m ON m.school_id=p.school_id AND m.id=p.membership_id
 WHERE p.intervention_id=r.id AND m.account_id=ctx.account_id) THEN '["approve","rejectApproval"]'::jsonb ELSE '[]'::jsonb END) END $$;
CREATE FUNCTION workhub_private.t3_view(r workhub.timetable_interventions,ctx workhub_private.actor_context,p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'version',r.version,'proposalHash',r.proposal_hash,
 'state',CASE WHEN r.state NOT IN('awaiting_consent','awaiting_approval') THEN r.state WHEN workhub_private.t3_stale(r) THEN 'stale' WHEN r.expires_at<=p_at THEN 'expired' ELSE r.state END,
 'kind',r.kind,'input',r.input,'requester',jsonb_build_object('id',r.requester_membership_id,'name',workhub_private.t2_member_name(r.requester_membership_id)),
 'requesterIsViewer',r.requester_account_id=ctx.account_id,'createdAt',workhub_private.t2_ts(r.created_at),'expiresAt',workhub_private.t2_ts(r.expires_at),
 'reason',r.input->>'reason','changes',r.plan->'changes','participants',
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.membership_id,'name',(SELECT x->>'name' FROM jsonb_array_elements(r.plan->'participants') x WHERE x->>'id'=p.membership_id),'response',p.response,
 'respondedAt',CASE WHEN p.responded_at IS NULL THEN NULL ELSE workhub_private.t2_ts(p.responded_at) END) ORDER BY p.membership_id)
 FROM workhub.timetable_intervention_participants p WHERE p.intervention_id=r.id),'[]'::jsonb),'actions',workhub_private.t3_actions(r,ctx,p_at)) $$;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 't3\_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;END $$;
INSERT INTO workhub_private.t3_installs(batch,release) VALUES('T3-01','2026-10-20.1');
COMMIT;
