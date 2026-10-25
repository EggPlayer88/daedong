-- T3-05 원문은 보존한다. OP1의 지정 일반 교사도 포함할 수 있는 승인·명단 변경 양식이다.
-- 학교 역할을 새로 주지 않는다. 현재 독립 승인 담당 계정이 2명 미만이면 전체를 취소한다.
-- 신규 expected_revision=0, 변경은 OP1-04에서 읽은 현재 판을 넣는다. 진행 중 요청 당사자는 제거할 수 없다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $approval$
DECLARE
 i jsonb := $input${"school_code":"<학교 코드>","approver_user_id":"<승인자 기존 UID>","allowed_user_ids":["<현재 승인 담당자 UID 1>","<현재 승인 담당자 UID 2>","<OP1 시간표 참여 교사 UID>"],"approval_ref":"<승인 일시와 근거>","app_deploy_ref":"<배포 커밋과 근거>","expected_revision":0,"enable":false}$input$::jsonb;
 school text;actor workhub_private.actor_context;ids text[];uid uuid;n integer;previous workhub.timetable_intervention_policies;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'OP1: SQL Editor 관리 연결에서만 실행하세요.';END IF;
 IF i->>'enable' IS DISTINCT FROM 'true' OR i::text LIKE '%<%' THEN RAISE EXCEPTION 'OP1 시간표 승인: 대상과 근거를 채우고 enable을 결정하세요.';END IF;
 IF jsonb_typeof(i->'allowed_user_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(i->'allowed_user_ids') NOT BETWEEN 2 AND 1000
 OR length(btrim(coalesce(i->>'approval_ref',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(i->>'app_deploy_ref',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'OP1 시간표 승인: 입력을 확인하세요.';END IF;
 SELECT id INTO school FROM workhub.schools WHERE code=i->>'school_code' AND status='active';
 IF school IS NULL OR(SELECT count(*) FROM workhub_private.t3_installs)<>3 OR NOT EXISTS(SELECT 1 FROM workhub_private.op1_installs WHERE batch='OP1-01') THEN RAISE EXCEPTION 'OP1 시간표 승인: 활성 학교와 T3·OP1 설치가 필요합니다.';END IF;
 -- 승인 중 명단의 만료 연장·중지를 직렬화한다. 도중 기간 만료는 아래 현재 시각 재검사로 거부한다.
 PERFORM pg_advisory_xact_lock(hashtextextended('op1-grant',0));
 PERFORM workhub_private.t2_lock(school);
 SELECT * INTO previous FROM workhub.timetable_intervention_policies WHERE school_id=school FOR UPDATE;
 IF coalesce(previous.revision,0) IS DISTINCT FROM (i->>'expected_revision')::integer THEN RAISE EXCEPTION 'OP1 시간표 승인: 정책 판이 달라졌습니다. 현재 명단과 판을 다시 확인하세요.';END IF;
 uid:=(i->>'approver_user_id')::uuid;
 SELECT m.id,m.account_id INTO actor.membership_id,actor.account_id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id
 WHERE m.school_id=school AND a.auth_user_id=uid AND workhub_private.p2_member_reachable(school,m.id);
 actor.actor_kind:='member';actor.school_id:=school;actor.scope_key:='s:'||school;actor.auth_user_id:=uid;
 SELECT timezone INTO actor.school_timezone FROM workhub.schools WHERE id=school;actor.school_today:=workhub_private.today_in(actor.school_timezone);
 PERFORM workhub_private.lock_member_roles(actor);
 IF actor.membership_id IS NULL OR NOT workhub_private.p5_manager(actor) OR NOT workhub_private.t2_ready(school) THEN RAISE EXCEPTION 'OP1 시간표 승인: 현재 학교 관리권한과 T2 활성화가 필요합니다.';END IF;
 SELECT array_agg(DISTINCT m.id ORDER BY m.id),count(DISTINCT a.auth_user_id) INTO ids,n
 FROM jsonb_array_elements_text(i->'allowed_user_ids') x(uid) JOIN workhub.accounts a ON a.auth_user_id::text=x.uid
 JOIN workhub.memberships m ON m.account_id=a.id AND m.school_id=school
 WHERE workhub_private.op1_reachable(school,m.id,'timetable') AND (workhub_private.p2_member_reachable(school,m.id)
 OR EXISTS(SELECT 1 FROM workhub.participant_grants g WHERE g.school_id=school AND g.membership_id=m.id AND g.expires_at>clock_timestamp()));
 IF n<>jsonb_array_length(i->'allowed_user_ids') OR NOT(actor.membership_id=ANY(ids)) THEN RAISE EXCEPTION 'OP1 시간표 승인: 모든 UID는 현재 시간표 허용 계정이어야 하며 승인자를 포함해야 합니다.';END IF;
 IF EXISTS(SELECT 1 FROM workhub.timetable_interventions r WHERE r.school_id=school AND workhub_private.t3_live(r,clock_timestamp())
 AND (NOT(r.requester_membership_id=ANY(ids)) OR EXISTS(SELECT 1 FROM workhub.timetable_intervention_participants p WHERE p.intervention_id=r.id AND NOT(p.membership_id=ANY(ids)))))
 THEN RAISE EXCEPTION 'OP1 시간표 승인: 진행 중 요청 당사자는 명단에서 제외할 수 없습니다. 원래 요청을 먼저 정리하세요.';END IF;
 INSERT INTO workhub.timetable_intervention_policies(school_id,active,allowed_member_ids,approved_by_membership_id,approval_ref,revision)
 VALUES(school,false,ids,actor.membership_id,i->>'approval_ref',coalesce(previous.revision,0)+1)
 ON CONFLICT(school_id) DO UPDATE SET active=false,allowed_member_ids=excluded.allowed_member_ids,
 approved_by_membership_id=excluded.approved_by_membership_id,approval_ref=excluded.approval_ref,revision=excluded.revision,updated_at=clock_timestamp();
 IF(SELECT count(DISTINCT account_id) FROM workhub_private.t3_approvers(school,actor.school_today))<2 THEN RAISE EXCEPTION 'OP1 시간표 승인: 서로 다른 실제 승인 담당 계정 2개가 필요합니다.';END IF;
 UPDATE workhub.timetable_intervention_policies SET active=true WHERE school_id=school;
 PERFORM workhub_private.write_audit(actor,'timetable.intervention_pilot_activate','timetable_intervention_policy',school,coalesce(previous.revision,0)+1,'school',NULL,
 jsonb_build_object('approval_ref',i->>'approval_ref','app_deploy_ref',i->>'app_deploy_ref','allowed_member_ids',ids,'authorization','OP1'));
END $approval$;
COMMIT;
