-- 읽기 전용. 시험 계정 Auth UID 한 칸만 채운다. 회원·역할·소속을 바꾸지 않는다.
WITH target(uid) AS (VALUES (NULL::uuid)), -- NULL을 '시험 계정 Auth UID'::uuid로 바꾼다.
u AS (SELECT a.id AS uid,a.email AS auth_email,p.id AS profile_id,p.role,p.is_active
 FROM target t JOIN auth.users a ON a.id=t.uid LEFT JOIN public.users p ON p.id=a.id::text)
SELECT u.uid,u.auth_email,(u.profile_id=u.uid::text) AS identity_ok,u.role,u.is_active,
 a.id AS workhub_account_id,a.status AS account_status,a.legacy_approval_state,
 coalesce((SELECT jsonb_agg(jsonb_build_object('memberId',m.id,'schoolId',m.school_id,'schoolName',s.name,
 'status',m.status,'validFrom',m.valid_from,'validTo',m.valid_to))
 FROM workhub.memberships m JOIN workhub.schools s ON s.id=m.school_id WHERE m.account_id=a.id),'[]'::jsonb) AS memberships,
 (SELECT jsonb_agg(jsonb_build_object('schoolId',s.id,'schoolName',s.name,'messaging',workhub_private.p3_messaging_reason(s.id),
 'files',workhub_private.p3_files_reason(s.id))) FROM workhub.schools s WHERE s.status='active') AS school_readiness,
 (SELECT jsonb_agg(jsonb_build_object('schoolId',p.school_id,'active',p.active,'revision',p.revision,'allowedUserIds',p.allowed_user_ids))
 FROM workhub.school_roster_policies p) AS current_roster_policies,
 (SELECT jsonb_agg(jsonb_build_object('schoolId',m.school_id,'memberId',m.id,'adminUserId',a2.auth_user_id))
 FROM workhub.memberships m JOIN workhub.accounts a2 ON a2.id=m.account_id JOIN public.users p2 ON p2.id=a2.auth_user_id::text
 JOIN workhub.schools s2 ON s2.id=m.school_id
 WHERE p2.role='superadmin' AND p2.is_active AND a2.status='active' AND a2.legacy_approval_state='approved'
 AND m.status='active' AND s2.status='active' AND workhub_private.today_in(s2.timezone)<@daterange(m.valid_from,m.valid_to,'[)')) AS existing_admins,
 to_regclass('workhub_private.mp1_installs') IS NOT NULL AS mp1_installed
FROM u LEFT JOIN workhub.accounts a ON a.auth_user_id=u.uid;
