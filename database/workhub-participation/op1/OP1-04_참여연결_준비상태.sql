-- OP1 설치 후 읽기 전용. 실제 수업 배정과 정책 설정을 구분한다. 키·비밀번호를 조회하지 않는다.
SELECT s.id AS school_id,s.code AS school_code,s.name AS school_name,
 (SELECT count(*) FROM workhub.participant_grants g WHERE g.school_id=s.id) AS registered,
 (SELECT count(*) FROM workhub.participant_grants g WHERE g.school_id=s.id AND workhub_private.op1_allowed(s.id,g.membership_id,g.scopes[1])) AS effective,
 workhub_private.t2_ready(s.id) AS timetable_operations_ready,
 (SELECT count(DISTINCT a.account_id) FROM workhub_private.t2_approvers(s.id,workhub_private.today_in(s.timezone)) a) AS timetable_approvers,
 coalesce(p.revision,0) AS intervention_policy_revision,coalesce(p.active,false) AS intervention_policy_active,
 coalesce(p.allowed_member_ids,'{}'::text[]) AS intervention_members,
 (SELECT count(DISTINCT a.account_id) FROM workhub_private.t3_approvers(s.id,workhub_private.today_in(s.timezone)) a) AS intervention_approvers,
 coalesce((SELECT jsonb_agg(jsonb_build_object('userId',g.auth_user_id,'memberId',g.membership_id,'scopes',g.scopes,
 'revision',g.revision,'active',g.active,'expiresAt',g.expires_at) ORDER BY g.membership_id)
 FROM workhub.participant_grants g WHERE g.school_id=s.id),'[]'::jsonb) AS participation
FROM workhub.schools s LEFT JOIN workhub.timetable_intervention_policies p ON p.school_id=s.id
WHERE s.status='active' ORDER BY s.id;
