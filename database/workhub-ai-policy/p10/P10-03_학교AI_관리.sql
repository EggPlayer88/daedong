-- 키 관리·정책 등록·운영 양식용 좁은 RPC. 설치만으로 키/정책/연결/활성화가 생기지 않는다.
BEGIN;
CREATE FUNCTION workhub_private.p10_admin(p_actor uuid,p_member text) RETURNS workhub_private.actor_context LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx:=workhub_private.p6_service_member(p_actor,p_member);
  IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN ctx;
END $$;
CREATE FUNCTION workhub_private.p10_envelope(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF NOT workhub_private.p2_exact(p,ARRAY['keyId','iv','ciphertext','tag']) OR NOT workhub_private.p6_id(p->'keyId')
    OR jsonb_typeof(p->'iv')<>'string' OR jsonb_typeof(p->'ciphertext')<>'string' OR jsonb_typeof(p->'tag')<>'string'
    OR (p->>'iv') !~ '^[A-Za-z0-9+/]{16}$' OR (p->>'tag') !~ '^[A-Za-z0-9+/]{22}==$'
    OR (p->>'ciphertext') !~ '^[A-Za-z0-9+/]+={0,2}$' THEN RETURN false; END IF;
  RETURN length(decode(p->>'iv','base64'))=12 AND length(decode(p->>'tag','base64'))=16
    AND length(decode(p->>'ciphertext','base64')) BETWEEN 20 AND 3000
    AND replace(encode(decode(p->>'ciphertext','base64'),'base64'),E'\n','')=p->>'ciphertext'
    AND encode(decode(p->>'tag','base64'),'base64')=p->>'tag';
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE FUNCTION public.workhub_ai_school_status(p_actor_user_id uuid,p_member_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; p workhub.ai_school_policies; c workhub.ai_credentials; ctl workhub.ai_school_controls;
  w date[]; settled bigint; reserved bigint; st text; models jsonb;
BEGIN
  ctx:=workhub_private.p6_service_member(p_actor_user_id,p_member_id);
  SELECT * INTO p FROM workhub.ai_school_policies WHERE school_id=ctx.school_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO c FROM workhub.ai_credentials WHERE school_id=ctx.school_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO ctl FROM workhub.ai_school_controls WHERE school_id=ctx.school_id;
  w:=workhub_private.p6_window(ctx.school_id);
  SELECT coalesce(sum(r.actual_micro_usd),0),coalesce(sum(CASE WHEN r.actual_micro_usd IS NULL THEN workhub_private.p10_charge(r) ELSE 0 END),0)
    INTO settled,reserved FROM workhub.ai_gateway_requests r WHERE school_id=ctx.school_id AND budget_month=w[2];
  st:=CASE WHEN p.version IS NULL THEN 'policy_missing' WHEN c.version IS NULL THEN 'key_missing' WHEN ctl.enabled IS DISTINCT FROM true OR ctl.overage_blocked THEN 'disabled'
      WHEN settled+reserved+14000>100000000 THEN 'budget_exhausted' ELSE 'ready' END;
  models:=workhub_private.p10_models()->'models';
  RETURN jsonb_build_object('contract','assistant.school.v1','schoolId',ctx.school_id,'memberId',p_member_id,'policyVersion',coalesce(p.version,0),
    'canManage',workhub_private.member_has_perm(ctx,'year.manage'),
    'credential',jsonb_build_object('configured',c.version IS NOT NULL,'version',coalesce(c.version,0),'maskedSuffix',c.masked_suffix,'updatedAt',workhub_private.p2_ts(c.created_at)),
    'budget',jsonb_build_object('month',to_char(w[2],'YYYY-MM'),'timeZone',ctx.school_timezone,'currency','USD','limitMicroUsd',100000000,
      'settledMicroUsd',settled,'reservedMicroUsd',reserved,'availableMicroUsd',greatest(0,100000000-settled-reserved)),
    'models',jsonb_build_object('quick',jsonb_build_object('id',models#>>'{quick,id}','label',models#>>'{quick,label}'),
      'review',jsonb_build_object('id',models#>>'{review,id}','label',models#>>'{review,label}')),'status',st);
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN jsonb_build_object('error',jsonb_build_object('code',SQLERRM)); END IF; RAISE;
END $$;

CREATE FUNCTION public.workhub_ai_school_key_save(p_actor_user_id uuid,p_member_id text,p_request_key text,p_expected_version integer,p_envelope jsonb,p_masked_suffix text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; old workhub.ai_admin_requests; sha text; ver integer; receipt jsonb;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF NOT workhub_private.p6_key(p_request_key) OR p_expected_version IS NULL OR p_expected_version<0 OR NOT workhub_private.p10_envelope(p_envelope)
    OR p_masked_suffix IS NULL OR p_masked_suffix !~ '^[A-Za-z0-9_-]{4}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  sha:=workhub_private.p2_sha(jsonb_build_object('operation','key.save','expectedVersion',p_expected_version,'envelope',p_envelope,'maskedSuffix',p_masked_suffix));
  PERFORM workhub_private.p10_lock(ctx.school_id);
  SELECT * INTO old FROM workhub.ai_admin_requests WHERE school_id=ctx.school_id AND member_id=p_member_id AND request_key=p_request_key;
  IF old.request_key IS NOT NULL THEN
    IF old.receipt->>'state'='closed' THEN RETURN old.receipt; END IF;
    IF old.payload_sha256<>sha THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN old.receipt;
  END IF;
  SELECT coalesce(max(version),0) INTO ver FROM workhub.ai_credentials WHERE school_id=ctx.school_id;
  IF ver<>p_expected_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  INSERT INTO workhub.ai_credentials(school_id,version,envelope,masked_suffix,created_by_membership_id) VALUES(ctx.school_id,ver+1,p_envelope,p_masked_suffix,p_member_id);
  receipt:=jsonb_build_object('contract','assistant.school.v1','schoolId',ctx.school_id,'memberId',p_member_id,'requestKey',p_request_key,'state','applied','credentialVersion',ver+1);
  INSERT INTO workhub.ai_admin_requests(school_id,member_id,request_key,payload_sha256,receipt) VALUES(ctx.school_id,p_member_id,p_request_key,sha,receipt);
  PERFORM workhub_private.write_audit(ctx,'ai.key_save','ai_credential',ctx.school_id,ver+1,'operator_only',p_request_key,jsonb_build_object('credentialVersion',ver+1));
  RETURN receipt;
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN jsonb_build_object('error',jsonb_build_object('code',SQLERRM)); END IF; RAISE;
END $$;
CREATE FUNCTION public.workhub_ai_school_key_close(p_actor_user_id uuid,p_member_id text,p_request_key text,p_expected_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; receipt jsonb;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF NOT workhub_private.p6_key(p_request_key) OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  SELECT r.receipt INTO receipt FROM workhub.ai_admin_requests r WHERE school_id=ctx.school_id AND member_id=p_member_id AND request_key=p_request_key;
  IF receipt IS NOT NULL THEN RETURN receipt; END IF;
  receipt:=jsonb_build_object('contract','assistant.school.v1','schoolId',ctx.school_id,'memberId',p_member_id,'requestKey',p_request_key,'state','closed','credentialVersion',NULL);
  INSERT INTO workhub.ai_admin_requests(school_id,member_id,request_key,payload_sha256,receipt)
    VALUES(ctx.school_id,p_member_id,p_request_key,workhub_private.p2_sha(jsonb_build_object('operation','key.close','expectedVersion',p_expected_version)),receipt);
  RETURN receipt;
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN jsonb_build_object('error',jsonb_build_object('code',SQLERRM)); END IF; RAISE;
END $$;
CREATE FUNCTION public.workhub_ai_school_key_recover(p_actor_user_id uuid,p_member_id text,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; receipt jsonb;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF NOT workhub_private.p6_key(p_request_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT r.receipt INTO receipt FROM workhub.ai_admin_requests r WHERE school_id=ctx.school_id AND member_id=p_member_id AND request_key=p_request_key;
  RETURN coalesce(receipt,jsonb_build_object('contract','assistant.school.v1','schoolId',ctx.school_id,'memberId',p_member_id,'requestKey',p_request_key,'state','pending','credentialVersion',NULL));
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN jsonb_build_object('error',jsonb_build_object('code',SQLERRM)); END IF; RAISE;
END $$;

-- 명시 운영 양식에서만 호출한다. 키 저장 함수와 별개이며 켜지 않는다.
CREATE FUNCTION public.workhub_ai_school_policy_register(p_actor_user_id uuid,p_member_id text,p_approval_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; m jsonb; tier text; v integer; qv integer; rv integer; pv integer; res bigint;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200 OR p_approval_ref IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  IF EXISTS(SELECT 1 FROM workhub.ai_school_policies WHERE school_id=ctx.school_id) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  FOREACH tier IN ARRAY ARRAY['quick','review'] LOOP
    m:=workhub_private.p10_models()#>ARRAY['models',tier];
    SELECT coalesce(max(version),0)+1 INTO v FROM workhub.assistant_policies WHERE school_id=ctx.school_id;
    res:=ceil((100000::numeric*(m->>'inputMicroUsdPerMtok')::bigint+8000::numeric*(m->>'outputMicroUsdPerMtok')::bigint)/1000000)::bigint;
    INSERT INTO workhub.assistant_policies(school_id,version,approved_by_membership_id,approval_ref,verification_ref,allowed_members,model,price_table_ref,
      input_price_micro_usd_per_mtok,output_price_micro_usd_per_mtok,max_input_tokens,max_output_tokens,reserve_micro_usd,
      member_daily_micro_usd,member_monthly_micro_usd,school_daily_micro_usd,school_monthly_micro_usd)
    VALUES(ctx.school_id,v,p_member_id,p_approval_ref,'P10 모델/가격 2026-10-21.1','all_members',m->>'id','model-routing.json 2026-10-21.1',
      (m->>'inputMicroUsdPerMtok')::bigint,(m->>'outputMicroUsdPerMtok')::bigint,100000,8000,res,100000000,100000000,100000000,100000000);
    IF tier='quick' THEN qv:=v; ELSE rv:=v; END IF;
  END LOOP;
  INSERT INTO workhub.ai_school_policies(school_id,version,quick_policy_version,review_policy_version,monthly_limit_micro_usd,approved_by_membership_id,approval_ref)
    VALUES(ctx.school_id,1,qv,rv,100000000,p_member_id,p_approval_ref);
  INSERT INTO workhub.ai_school_controls(school_id) VALUES(ctx.school_id);
  PERFORM workhub_private.write_audit(ctx,'ai.policy_register','ai_policy',ctx.school_id,1,'operator_only',NULL,jsonb_build_object('approvalRef',p_approval_ref,'enabled',false));
  RETURN public.workhub_ai_school_status(p_actor_user_id,p_member_id);
END $$;

CREATE FUNCTION public.workhub_ai_school_link_legacy(p_actor_user_id uuid,p_member_id text,p_user_ids uuid[],p_approval_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; uid uuid; l workhub.ai_legacy_school_links; n integer:=0;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF p_user_ids IS NULL OR cardinality(p_user_ids) NOT BETWEEN 1 AND 1000 OR array_position(p_user_ids,NULL) IS NOT NULL
    OR (SELECT count(DISTINCT x) FROM unnest(p_user_ids)x)<>cardinality(p_user_ids) OR length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200 OR p_approval_ref IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- 회원→학교 순서가 다른 요청과 뒤집히지 않게 대상 승인행을 먼저 고정한다.
  PERFORM 1 FROM public.users WHERE id=ANY(SELECT x::text FROM unnest(p_user_ids)x) ORDER BY id FOR SHARE;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  FOREACH uid IN ARRAY p_user_ids LOOP
    IF NOT EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text=u.id WHERE u.id=uid::text AND u.is_active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO l FROM workhub.ai_legacy_school_links WHERE auth_user_id=uid AND revoked_at IS NULL FOR UPDATE;
    IF l.id IS NOT NULL THEN
      IF l.school_id<>ctx.school_id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    ELSE
      INSERT INTO workhub.ai_legacy_school_links(school_id,auth_user_id,approved_by_membership_id,approval_ref,valid_from) VALUES(ctx.school_id,uid,p_member_id,p_approval_ref,ctx.school_today); n:=n+1;
    END IF;
  END LOOP;
  PERFORM workhub_private.write_audit(ctx,'ai.legacy_link','ai_policy',ctx.school_id,NULL,'operator_only',NULL,jsonb_build_object('count',n,'approvalRef',p_approval_ref));
  RETURN jsonb_build_object('schoolId',ctx.school_id,'linked',n);
END $$;

-- 결과 미상은 청구 근거를 확인한 관리자만 정산한다. 답변은 복원·생성하지 않는다.
-- 켜기/중지는 별도 운영 양식으로만 수행한다. 키 관리 HTTP 경로에서는 호출하지 않는다.
CREATE FUNCTION public.workhub_ai_school_control(p_actor_user_id uuid,p_member_id text,p_enabled boolean,p_approval_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; ctl workhub.ai_school_controls;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF p_enabled IS NULL OR p_approval_ref IS NULL OR length(btrim(p_approval_ref)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  SELECT * INTO ctl FROM workhub.ai_school_controls WHERE school_id=ctx.school_id FOR UPDATE;
  IF ctl.school_id IS NULL THEN RAISE EXCEPTION 'POLICY_MISSING'; END IF;
  IF p_enabled AND ctl.overage_blocked THEN RAISE EXCEPTION 'OVER_RESERVATION'; END IF;
  IF p_enabled AND NOT EXISTS(SELECT 1 FROM workhub.ai_credentials WHERE school_id=ctx.school_id) THEN RAISE EXCEPTION 'KEY_MISSING'; END IF;
  UPDATE workhub.ai_school_controls SET enabled=p_enabled,updated_at=clock_timestamp() WHERE school_id=ctx.school_id;
  PERFORM workhub_private.write_audit(ctx,'ai.control','ai_policy',ctx.school_id,NULL,'operator_only',NULL,jsonb_build_object('enabled',p_enabled,'approvalRef',p_approval_ref));
  RETURN public.workhub_ai_school_status(p_actor_user_id,p_member_id);
END $$;

CREATE FUNCTION public.workhub_ai_school_resolve(p_actor_user_id uuid,p_member_id text,p_gateway_id text,p_input_tokens integer,p_output_tokens integer,p_evidence_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; g workhub.ai_gateway_requests; ap workhub.assistant_policies; cost bigint; rec jsonb;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  IF p_input_tokens IS NULL OR p_output_tokens IS NULL OR p_input_tokens<0 OR p_input_tokens>100000 OR p_output_tokens<0 OR p_output_tokens>8000 OR p_evidence_ref IS NULL OR length(btrim(p_evidence_ref)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE school_id=ctx.school_id AND id=p_gateway_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF g.state NOT IN('unknown','rejected') OR g.actual_micro_usd IS NOT NULL OR g.observed_usage IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO ap FROM workhub.assistant_policies WHERE school_id=g.school_id AND version=g.assistant_policy_version;
  cost:=workhub_private.p10_cost(ap,p_input_tokens,p_output_tokens); rec:=jsonb_build_object('state','failed','code','PROVIDER_REJECTED');
  UPDATE workhub.assistant_requests SET state=CASE WHEN state='provider_unknown' THEN 'resolved' ELSE state END,cost_state='resolved',actual_micro_usd=cost,
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,resolution=jsonb_build_object('evidenceRef',p_evidence_ref,'resolvedBy',p_member_id),
    result=jsonb_build_object('state','rejected','code','PROVIDER_REJECTED'),updated_at=clock_timestamp() WHERE id=g.assistant_request_id AND cost_state='unknown';
  IF g.origin='native' THEN
    UPDATE workhub.ai_gateway_requests SET state='resolved',actual_micro_usd=cost,input_tokens=p_input_tokens,output_tokens=p_output_tokens,receipt=rec,updated_at=clock_timestamp() WHERE id=g.id;
  END IF;
  PERFORM workhub_private.write_audit(ctx,'ai.cost_resolve','ai_run',g.id,NULL,'operator_only',NULL,jsonb_build_object('evidenceRef',p_evidence_ref,'actualMicroUsd',cost));
  IF cost>g.reserved_micro_usd THEN UPDATE workhub.ai_school_controls SET overage_blocked=true WHERE school_id=g.school_id; END IF;
  RETURN jsonb_build_object('schoolId',g.school_id,'requestId',g.id,'actualMicroUsd',cost);
END $$;

DO $$ DECLARE f text; BEGIN
  FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 'p10\_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f); END LOOP;
  FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'workhub_ai_school_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);
  END LOOP;
END $$;
INSERT INTO workhub_private.p10_ai_installs VALUES('P10-AI-03','2026-10-21.1',clock_timestamp());
COMMIT;
