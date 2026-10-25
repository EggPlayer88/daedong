-- 시험 종료 또는 즉시 중지. 계정·메시지·첨부·소속을 삭제하지 않는다.
BEGIN;
DO $stop$
DECLARE p_user_id uuid:=NULL; -- 중지할 시험 계정 Auth UID
 p_reason text:='<중지 일시와 사유>';g workhub.messaging_pilot_grants;
BEGIN
 IF auth.uid() IS NOT NULL OR session_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'SQL Editor 관리 연결에서만 실행하세요.'; END IF;
 IF p_user_id IS NULL OR p_reason LIKE '<%' OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '시험 계정 UID와 중지 사유를 채우세요.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.messaging_pilot',0));
 SELECT * INTO g FROM workhub.messaging_pilot_grants WHERE auth_user_id=p_user_id;
 IF g.auth_user_id IS NULL THEN RAISE EXCEPTION '이 UID에 허용된 시험 계정이 없습니다.'; END IF;
 PERFORM 1 FROM workhub.memberships WHERE id=g.membership_id FOR UPDATE;
 UPDATE workhub.messaging_pilot_grants SET active=false,approval_ref=p_reason,revision=revision+1,updated_at=clock_timestamp() WHERE auth_user_id=p_user_id;
END $stop$;
COMMIT;
SELECT 'ok' AS status,auth_user_id,active,expires_at FROM workhub.messaging_pilot_grants;
