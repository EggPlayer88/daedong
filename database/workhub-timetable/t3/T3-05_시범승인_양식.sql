-- 사람이 검토·승인한 학교와 실제 기존 회원만 기입한다. 빈칸/enable=false로는 활성화하지 않는다.
-- 신규 auth/users 생성, 일반 교사 legacy_gate 확대, 메뉴 공개 확대를 하지 않는다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $approval$
DECLARE
 i jsonb := $input${"school_code":"<학교 코드>","approver_user_id":"<승인자 기존 UID>","allowed_user_ids":["<실제 시범 참여자 기존 UID>"],"approval_ref":"<승인 날짜와 근거>","app_deploy_ref":"<PR 미리보기 검증 근거>","enable":false}$input$::jsonb;
 school text;actor workhub_private.actor_context;ids text[];uid uuid;n integer;
BEGIN
 IF i->>'enable'<>'true' OR i::text LIKE '%<%' THEN RAISE EXCEPTION 'T3 시범 승인: 직접 채우고 enable을 true로 결정하기 전에는 적용하지 않습니다.';END IF;
 IF jsonb_typeof(i->'allowed_user_ids')<>'array' OR jsonb_array_length(i->'allowed_user_ids') NOT BETWEEN 2 AND 1000
 OR length(btrim(i->>'approval_ref')) NOT BETWEEN 1 AND 200 OR length(btrim(i->>'app_deploy_ref')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'T3 시범 승인: 입력을 확인하세요.';END IF;
 SELECT id INTO school FROM workhub.schools WHERE code=i->>'school_code' AND status='active';
 IF school IS NULL OR(SELECT count(*) FROM workhub_private.t3_installs)<>3 THEN RAISE EXCEPTION 'T3 시범 승인: 활성 학교와 T3 전체 설치가 필요합니다.';END IF;
 PERFORM workhub_private.t2_lock(school);
 IF EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies WHERE school_id=school) THEN RAISE EXCEPTION 'T3 시범 승인: 기존 정책을 덮어쓰지 않습니다. 변경은 별도 검토하세요.';END IF;
 uid:=(i->>'approver_user_id')::uuid;
 SELECT m.id,m.account_id INTO actor.membership_id,actor.account_id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id
 WHERE m.school_id=school AND a.auth_user_id=uid AND workhub_private.p2_member_reachable(school,m.id);
 actor.actor_kind:='member';actor.school_id:=school;actor.scope_key:='s:'||school;actor.auth_user_id:=uid;
 SELECT timezone INTO actor.school_timezone FROM workhub.schools WHERE id=school;actor.school_today:=workhub_private.today_in(actor.school_timezone);
 IF actor.membership_id IS NULL OR NOT workhub_private.p5_manager(actor) OR NOT workhub_private.t2_ready(school) THEN RAISE EXCEPTION 'T3 시범 승인: 현재 학교 관리권한과 T2 활성화가 필요합니다.';END IF;
 SELECT array_agg(DISTINCT m.id ORDER BY m.id),count(DISTINCT a.auth_user_id) INTO ids,n
 FROM jsonb_array_elements_text(i->'allowed_user_ids') x(uid) JOIN workhub.accounts a ON a.auth_user_id::text=x.uid
 JOIN workhub.memberships m ON m.account_id=a.id AND m.school_id=school WHERE workhub_private.p2_member_reachable(school,m.id);
 IF n<>jsonb_array_length(i->'allowed_user_ids') OR NOT(actor.membership_id=ANY(ids)) THEN RAISE EXCEPTION 'T3 시범 승인: 모든 UID는 승인된 현재 업무실 회원이어야 하며 승인자를 포함해야 합니다.';END IF;
 INSERT INTO workhub.timetable_intervention_policies(school_id,active,allowed_member_ids,approved_by_membership_id,approval_ref)
 VALUES(school,false,ids,actor.membership_id,i->>'approval_ref');
 IF(SELECT count(DISTINCT account_id) FROM workhub_private.t3_approvers(school,actor.school_today))<2 THEN RAISE EXCEPTION 'T3 시범 승인: 실제 승인 담당자 계정 2개가 필요합니다.';END IF;
 UPDATE workhub.timetable_intervention_policies SET active=true WHERE school_id=school;
 PERFORM workhub_private.write_audit(actor,'timetable.intervention_pilot_activate','timetable_intervention_policy',school,1,'school',NULL,
 jsonb_build_object('approval_ref',i->>'approval_ref','app_deploy_ref',i->>'app_deploy_ref','allowed_member_ids',ids));
END $approval$;
COMMIT;
