-- 현재 관리자의 학교 암호문은 service_role 서버 내부에서만 복호화 진단에 사용한다. 공개 응답으로 전달하지 않는다.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM workhub_private.p10_ai_installs WHERE batch='P10-AI-03') THEN RAISE EXCEPTION 'P10 AI 먼저 설치'; END IF;
END $$;
CREATE FUNCTION public.workhub_ai_school_diagnostics(p_actor_user_id uuid,p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; result jsonb;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  -- 한 읽기 스냅샷에서 현재 정책·통제·키를 선택한다. 정책 등록 전에도 관리자 진단은 가능하다.
  SELECT jsonb_build_object('contract','assistant.school.diagnostics.v1','schoolId',ctx.school_id,'memberId',p_member_id,
    'policyVersion',coalesce(pol.version,0),'enabled',coalesce(control.enabled,false),'overageBlocked',coalesce(control.overage_blocked,false),
    'credential',CASE WHEN cred.version IS NULL THEN NULL ELSE cred.envelope||jsonb_build_object('version',cred.version) END)
    INTO result FROM (SELECT 1) seed
    LEFT JOIN LATERAL(SELECT * FROM workhub.ai_school_policies WHERE school_id=ctx.school_id ORDER BY version DESC LIMIT 1) pol ON true
    LEFT JOIN LATERAL(SELECT * FROM workhub.ai_credentials WHERE school_id=ctx.school_id ORDER BY version DESC LIMIT 1) cred ON true
    LEFT JOIN workhub.ai_school_controls control ON control.school_id=ctx.school_id;
  RETURN result;
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN jsonb_build_object('error',jsonb_build_object('code',SQLERRM)); END IF; RAISE;
END $$;
REVOKE ALL ON FUNCTION public.workhub_ai_school_diagnostics(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_ai_school_diagnostics(uuid,text) TO service_role;
INSERT INTO workhub_private.p10_ai_installs VALUES('P10-AI-10','2026-10-21.2',clock_timestamp());
COMMIT;
