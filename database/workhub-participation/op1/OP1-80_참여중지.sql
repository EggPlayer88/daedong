-- 대상이 만료·정지됐어도 허용을 회수한다. 기존 자료·원장·회원·역할은 보존한다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE p jsonb:=$input${"confirm":false,"userId":"<대상 Auth UID>","adminUserId":"<학교 관리자 Auth UID>","expectedRevision":0,"reason":"<중지 이유>"}$input$::jsonb;
 g workhub.participant_grants;ctx workhub_private.actor_context;s workhub.schools;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN ('postgres','supabase_admin') OR p->>'confirm' IS DISTINCT FROM 'true' OR p::text LIKE '%<%'
 OR length(btrim(coalesce(p->>'reason',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'OP1: 대상과 중지 승인을 확인하세요.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('op1-grant',0));
 SELECT * INTO g FROM workhub.participant_grants WHERE auth_user_id=(p->>'userId')::uuid FOR UPDATE;
 IF g.membership_id IS NULL OR g.revision IS DISTINCT FROM (p->>'expectedRevision')::integer THEN RAISE EXCEPTION 'OP1: 대상과 현재 판을 다시 확인하세요.';END IF;
 SELECT * INTO s FROM workhub.schools WHERE id=g.school_id;
 SELECT m.id,m.account_id INTO ctx.membership_id,ctx.account_id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id
 WHERE m.school_id=s.id AND a.auth_user_id=(p->>'adminUserId')::uuid AND workhub_private.p2_member_reachable(s.id,m.id);
 ctx.actor_kind:='member';ctx.school_id:=s.id;ctx.scope_key:='s:'||s.id;ctx.auth_user_id:=(p->>'adminUserId')::uuid;ctx.school_timezone:=s.timezone;ctx.school_today:=workhub_private.today_in(s.timezone);
 PERFORM workhub_private.lock_member_roles(ctx);
 IF ctx.membership_id IS NULL OR NOT workhub_private.member_has_perm(ctx,'role.grant') THEN RAISE EXCEPTION 'OP1: 현재 학교 관리자의 승인이 필요합니다.';END IF;
 UPDATE workhub.participant_grants SET active=false,revision=revision+1,updated_at=now(),approval_ref=btrim(p->>'reason'),approved_by_membership_id=ctx.membership_id WHERE auth_user_id=g.auth_user_id;
 PERFORM workhub_private.write_audit(ctx,'participant.stop','participant_grant',g.membership_id,g.revision+1,'school',NULL,jsonb_build_object('reason',p->>'reason'));
END $$;
COMMIT;
