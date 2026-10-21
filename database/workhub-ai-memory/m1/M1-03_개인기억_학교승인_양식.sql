-- 운영 실행은 사용자 별도 승인 뒤. 아래 세 입력을 직접 채운 실행본을 별도 보관한다.
-- true는 새 기억 저장·수정·참고 선택을 켠다. false는 해당 기능만 중지한다.
-- 중지해도 본인 목록·삭제·원번호 복구·닫기는 허용하며 대화·비용·메뉴 공개 범위는 바꾸지 않는다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $m1$
DECLARE
 admin_member_id text := ''; -- 승인한 학교 관리자 소속 ID
 approval_ref text := ''; -- 날짜·승인 내용
 requested_enabled boolean := NULL; -- true 또는 false
 ctx workhub_private.actor_context;
BEGIN
 IF admin_member_id='' OR approval_ref='' OR requested_enabled IS NULL THEN RAISE EXCEPTION 'M1-03: 승인한 관리자 소속 ID·승인 근거·켜기/중지를 직접 채우세요.'; END IF;
 IF length(btrim(approval_ref)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'M1-03: 승인 근거를 확인하세요.'; END IF;
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'M1-03: postgres SQL Editor에서만 실행하세요.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub_private.m1_installs WHERE batch='M1-01' AND release='2026-10-21.1') THEN RAISE EXCEPTION 'M1-03: M1-01 설치를 먼저 확인하세요.'; END IF;
 -- 운영 양식에서 주체를 만들 때도 기존 회원·승인·소속·학교 관리자 권한을 재검사한다.
 PERFORM set_config('request.jwt.claim.sub',(SELECT a.auth_user_id::text FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE m.id=admin_member_id),true);
 ctx:=workhub_private.member_actor(admin_member_id,true);
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RAISE EXCEPTION 'M1-03: 학교 관리자 확인 필요'; END IF;
 INSERT INTO workhub.ai_memory_controls(school_id,enabled,approved_by_membership_id,approval_ref)
 VALUES(ctx.school_id,requested_enabled,ctx.membership_id,approval_ref)
 ON CONFLICT(school_id) DO UPDATE SET enabled=excluded.enabled,approved_by_membership_id=excluded.approved_by_membership_id,approval_ref=excluded.approval_ref,updated_at=clock_timestamp();
 PERFORM workhub_private.write_audit(ctx,'memory.control','memory',ctx.school_id,NULL,'operator_only',NULL,jsonb_build_object('enabled',requested_enabled,'approvalRef',approval_ref));
END $m1$;
COMMIT;
