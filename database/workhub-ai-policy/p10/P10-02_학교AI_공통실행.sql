-- P10 AI gateway. P6 원본 파일은 수정하지 않고 검증한 끝 처리 사본을 사용한다.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM workhub_private.p10_ai_installs WHERE batch='P10-AI-01') THEN RAISE EXCEPTION 'P10-AI-01 먼저 설치'; END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.workhub_ai_finish(uuid,text,text,text,jsonb)'::regprocedure))<>'49349f458c6da0e5a00453239a9d9c72' THEN RAISE EXCEPTION 'P6 finish 원문 불일치'; END IF;
END $$;
CREATE FUNCTION workhub_private.p10_models() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $m$
SELECT $j${"contract":"assistant.routing.v1","version":"2026-10-21.1","currency":"USD","schoolMonthlyLimitMicroUsd":100000000,"maxInputTokens":80000,"reserveInputTokens":100000,"maxOutputTokens":8000,"maxReviewDepth":1,"automaticEscalation":false,"cacheEnabled":false,"models":{"quick":{"id":"claude-haiku-5-5","label":"Haiku","inputMicroUsdPerMtok":100000,"outputMicroUsdPerMtok":500000,"effort":"low"},"review":{"id":"claude-sonnet-5-5","label":"Sonnet","inputMicroUsdPerMtok":2000000,"outputMicroUsdPerMtok":10000000,"effort":"medium"}},"intentDefaults":{"school_advice":"quick","personal_assistant":"quick","document_draft":"quick","student_record_draft":"review","guided_collection":"quick"},"sources":["https://platform.claude.com/docs/en/models/haiku-5-5/overview","https://platform.claude.com/docs/en/models/sonnet-5-5/overview"]}$j$::jsonb
$m$;
CREATE FUNCTION workhub_private.p10_cost(p workhub.assistant_policies,p_in bigint,p_out bigint) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
  IF p_in<0 OR p_out<0 OR p_in>100000 OR p_out>8000 THEN RAISE EXCEPTION 'OVER_RESERVATION'; END IF;
  RETURN workhub_private.p6_cost(p,p_in,p_out);
END $$;
CREATE FUNCTION workhub_private.p10_claim(p_ctx workhub_private.actor_context, p_input jsonb, p_key text, p_sha text, p_old workhub.assistant_requests, p_policy_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pol workhub.assistant_policies; t workhub.assistant_threads; w date[]; r workhub.assistant_requests; v_src jsonb; v_thread text;
BEGIN
  IF NOT workhub_private.p6_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO pol FROM workhub.assistant_policies WHERE school_id=p_ctx.school_id AND version=p_policy_version;
  IF pol.version IS NULL THEN RAISE EXCEPTION 'POLICY_MISSING'; END IF;
  IF NOT workhub_private.p6_allowed(p_ctx, pol) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_thread := p_input ->> 'threadId';
  IF v_thread IS NOT NULL THEN
    SELECT * INTO t FROM workhub.assistant_threads
     WHERE school_id = p_ctx.school_id AND id = v_thread AND owner_account_id = p_ctx.account_id FOR UPDATE;
    IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF t.mode <> p_input ->> 'mode' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF t.version <> (p_input ->> 'expectedVersion')::integer OR workhub_private.p6_inflight(p_ctx.school_id, t.id, p_old.id) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
  END IF;
  -- 예산 확인과 예약은 학교 단위로 한 줄씩
  PERFORM workhub_private.p6_lock('budget' || chr(31) || p_ctx.school_id);
  IF NOT workhub_private.p6_budget_ok(p_ctx.school_id, p_ctx.account_id, pol, p_old.id) THEN RAISE EXCEPTION 'BUDGET_EXCEEDED'; END IF;
  w := workhub_private.p6_window(p_ctx.school_id);
  IF p_old.id IS NULL THEN
    INSERT INTO workhub.assistant_requests (school_id, owner_account_id, owner_membership_id, owner_auth_user_id, request_key, input, input_sha256,
        mode, intent, thread_id, expected_version, lease_token, lease_until, policy_version, reserved_micro_usd, budget_day, budget_month)
    VALUES (p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, p_ctx.auth_user_id, p_key, p_input, p_sha,
        p_input ->> 'mode', p_input ->> 'intent', v_thread, (p_input ->> 'expectedVersion')::integer,
        workhub_private.p6_token(), clock_timestamp() + workhub_private.p6_lease(), pol.version, pol.reserve_micro_usd, w[1], w[2])
    RETURNING * INTO r;
  ELSE
    UPDATE workhub.assistant_requests SET lease_token = workhub_private.p6_token(), lease_until = clock_timestamp() + workhub_private.p6_lease(),
           claims = claims + 1, policy_version = pol.version, reserved_micro_usd = pol.reserve_micro_usd, budget_day = w[1], budget_month = w[2],
           updated_at = clock_timestamp()
     WHERE id = p_old.id RETURNING * INTO r;
  END IF;
  v_src := workhub_private.p6_sources(p_ctx, r);
  RETURN jsonb_build_object('state', 'claimed', 'requestKey', p_key, 'leaseToken', r.lease_token, 'input', r.input,
    'history', workhub_private.p6_history(p_ctx, v_thread, p_input -> 'studentContext'),
    'sources', v_src,
    'policy', jsonb_build_object('approved', true, 'configVersion', pol.version, 'model', pol.model, 'maxTokens', pol.max_output_tokens, 'maxInputTokens', 80000,
      'budget', jsonb_build_object('reservationId', r.id, 'policyVersion', pol.version, 'currency', 'USD', 'reservedMicroUsd', pol.reserve_micro_usd,
                                   'dailyLimitMicroUsd', pol.member_daily_micro_usd, 'monthlyLimitMicroUsd', pol.member_monthly_micro_usd)));
END $$;
CREATE FUNCTION workhub_private.p10_legacy_finish(p_actor_user_id uuid, p_member_id text, p_request_key text, p_lease_token text, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.assistant_requests; ctx workhub_private.actor_context; actx workhub_private.actor_context; pol workhub.assistant_policies;
        t workhub.assistant_threads; x workhub.assistant_exchanges; v_sha text; v_withheld text; v_state text; v_seq integer;
        v_title text; v_in bigint; v_out bigint; v_cost bigint; v_access boolean := true;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '서버 API(service_role, 사람 JWT 없음)만 부를 수 있습니다.';
  END IF;
  IF p_actor_user_id IS NULL OR p_member_id IS NULL OR NOT workhub_private.p6_key(p_request_key) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청을 확인하지 못했습니다.';
  END IF;
  -- 사람의 소속이 끊겨도 기록할 수 있게, 요청 원장의 소유(인증 UID · 소속 · 요청 번호)로 찾는다
  SELECT * INTO r FROM workhub.assistant_requests WHERE owner_auth_user_id = p_actor_user_id AND owner_membership_id = p_member_id
     AND request_key = p_request_key;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청을 확인하지 못했습니다.'; END IF;
  PERFORM workhub_private.p6_lock('req' || chr(31) || r.school_id || chr(31) || r.owner_account_id || chr(31) || p_request_key);
  SELECT * INTO r FROM workhub.assistant_requests WHERE id = r.id FOR UPDATE;
  ctx.actor_kind := 'member'; ctx.account_id := r.owner_account_id; ctx.membership_id := r.owner_membership_id; ctx.school_id := r.school_id;
  ctx.scope_key := 's:' || r.school_id; ctx.auth_user_id := r.owner_auth_user_id;
  BEGIN
    actx := workhub_private.p6_service_member(p_actor_user_id, p_member_id);
  EXCEPTION WHEN others THEN
    v_access := false;
  END;
  IF v_access THEN ctx := actx; END IF;
  BEGIN
    IF r.started_lease IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_sha := workhub_private.p2_sha(p_result);
    IF r.finish_sha256 IS NOT NULL THEN
      IF r.finish_sha256 <> v_sha THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
      IF NOT v_access THEN RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id,
                                 jsonb_build_object('state', 'rejected', 'requestKey', r.request_key, 'code', 'OUTPUT_INVALID')); END IF;
      RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, workhub_private.p6_public(ctx, r));
    END IF;
    IF r.state <> 'started' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    PERFORM workhub_private.p6_finish_shape(p_result, r);
    SELECT * INTO pol FROM workhub.assistant_policies WHERE school_id = r.school_id AND version = r.policy_version;
    v_state := p_result ->> 'state';
    IF p_result -> 'usage' <> 'null'::jsonb THEN
      v_in := (p_result #>> '{usage,inputTokens}')::bigint; v_out := (p_result #>> '{usage,outputTokens}')::bigint;
      v_cost := workhub_private.p10_cost(pol, v_in, v_out);
    END IF;

    IF v_state = 'completed' THEN
      -- 답을 붙이기 전 다시 확인: 사람의 접근 · 학생 근거 · 대화 판(늦게 끝난 요청)
      IF NOT v_access THEN v_withheld := 'access_lost';
      ELSIF NOT workhub_private.p6_evidence_live(ctx, NULLIF(r.input -> 'studentContext', 'null'::jsonb)) THEN v_withheld := 'evidence_changed';
      ELSIF r.thread_id IS NOT NULL THEN
        SELECT * INTO t FROM workhub.assistant_threads WHERE school_id = r.school_id AND id = r.thread_id FOR UPDATE;
        IF t.version <> r.expected_version THEN v_withheld := 'thread_changed'; END IF;
      END IF;
    END IF;

    IF v_state = 'completed' AND v_withheld IS NULL THEN
      IF r.thread_id IS NULL THEN
        v_title := workhub_private.p6_label(workhub_private.js_trim(
                     (SELECT l FROM regexp_split_to_table(r.input ->> 'prompt', E'\n') WITH ORDINALITY q(l, o)
                       WHERE workhub_private.js_trim(l) <> '' ORDER BY o LIMIT 1)), 100, '새 대화');
        INSERT INTO workhub.assistant_threads (school_id, owner_account_id, owner_membership_id, mode, title)
        VALUES (r.school_id, r.owner_account_id, r.owner_membership_id, r.mode, v_title) RETURNING * INTO t;
      ELSE
        UPDATE workhub.assistant_threads SET version = version + 1, updated_at = clock_timestamp() WHERE id = t.id RETURNING * INTO t;
      END IF;
      SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM workhub.assistant_exchanges WHERE thread_id = t.id;
      INSERT INTO workhub.assistant_exchanges (school_id, thread_id, request_id, seq, request_key, intent, prompt, segments, student_context)
      VALUES (r.school_id, t.id, r.id, v_seq, r.request_key, r.intent, r.input ->> 'prompt', p_result -> 'segments',
              NULLIF(r.input -> 'studentContext', 'null'::jsonb))
      RETURNING * INTO x;
      IF p_result -> 'taskDraft' <> 'null'::jsonb THEN
        INSERT INTO workhub.assistant_proposals (school_id, thread_id, exchange_id, owner_account_id, draft)
        VALUES (r.school_id, t.id, x.id, r.owner_account_id, p_result -> 'taskDraft');
      END IF;
      UPDATE workhub.assistant_requests SET state = 'completed', cost_state = 'settled', actual_micro_usd = v_cost, input_tokens = v_in,
             output_tokens = v_out, provider_message_id = p_result ->> 'providerMessageId', finish_sha256 = v_sha, exchange_id = x.id,
             result = jsonb_build_object('state', 'completed'), updated_at = clock_timestamp()
       WHERE id = r.id RETURNING * INTO r;
      PERFORM workhub_private.write_audit(ctx, 'assistant.answer', 'ai_run', r.id, t.version, 'owner_only', r.request_key,
        jsonb_build_object('threadId', t.id, 'intent', r.intent, 'mode', r.mode, 'policyVersion', r.policy_version,
                           'sources', (SELECT count(*) FROM workhub.assistant_request_sources WHERE request_id = r.id AND lease_token = r.started_lease),
                           'costMicroUsd', v_cost));
      RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, workhub_private.p6_public(ctx, r));
    END IF;

    -- 거절 · 보류 · 결과 불명: 답은 붙이지 않는다. 사용량이 없으면 청구 미확인(예약액으로 셈 — P6-05 로 확정)
    UPDATE workhub.assistant_requests SET
           state = CASE WHEN v_state = 'provider_unknown' THEN 'provider_unknown' ELSE 'rejected' END,
           cost_state = CASE WHEN v_cost IS NULL THEN 'unknown' ELSE 'settled' END, actual_micro_usd = v_cost,
           input_tokens = v_in, output_tokens = v_out, provider_message_id = p_result ->> 'providerMessageId', finish_sha256 = v_sha,
           reject_code = CASE WHEN v_state = 'completed' THEN 'OUTPUT_INVALID' WHEN v_state = 'rejected' THEN p_result ->> 'code' END,
           withheld_reason = v_withheld,
           result = CASE WHEN v_state = 'provider_unknown' THEN jsonb_build_object('state', 'pending', 'reason', 'provider_unknown')
                         ELSE jsonb_build_object('state', 'rejected', 'code', CASE WHEN v_state = 'completed' THEN 'OUTPUT_INVALID' ELSE p_result ->> 'code' END) END,
           updated_at = clock_timestamp()
     WHERE id = r.id RETURNING * INTO r;
    PERFORM workhub_private.write_audit(ctx, 'assistant.' || r.state, 'ai_run', r.id, NULL, 'owner_only', r.request_key,
      jsonb_build_object('intent', r.intent, 'mode', r.mode, 'policyVersion', r.policy_version, 'code', r.reject_code,
                         'withheld', v_withheld, 'costState', r.cost_state, 'costMicroUsd', v_cost));
    IF NOT v_access THEN
      RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, jsonb_build_object('state', 'rejected', 'requestKey', r.request_key, 'code', 'OUTPUT_INVALID'));
    END IF;
    RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, workhub_private.p6_public(ctx, r));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(r.school_id, r.owner_membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;
CREATE FUNCTION workhub_private.p10_business(p_code text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
SELECT p_code IN('FORBIDDEN','INACTIVE_MEMBERSHIP','INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','BUDGET_EXCEEDED','NOT_READY','SCHOOL_NOT_LINKED','KEY_MISSING','POLICY_MISSING','DISABLED','OVER_RESERVATION')
$$;
CREATE FUNCTION workhub_private.p10_ready(p_school text,p_feature text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub.ai_school_controls;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM workhub.ai_school_policies WHERE school_id=p_school) THEN RAISE EXCEPTION 'POLICY_MISSING'; END IF;
  SELECT * INTO c FROM workhub.ai_school_controls WHERE school_id=p_school FOR SHARE;
  IF c.enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'DISABLED'; END IF;
  IF c.overage_blocked THEN RAISE EXCEPTION 'OVER_RESERVATION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM workhub.ai_credentials WHERE school_id=p_school) THEN RAISE EXCEPTION 'KEY_MISSING'; END IF;
  IF p_feature='assistant' AND NOT workhub_private.p6_ready(p_school) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
END $$;

CREATE FUNCTION public.workhub_ai_gateway_prepare(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,
  p_payload_sha256 text,p_quality text,p_input jsonb DEFAULT NULL,p_review_of jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; g workhub.ai_gateway_requests; pol workhub.ai_school_policies;
  ap workhub.assistant_policies; cred workhub.ai_credentials; a workhub.assistant_requests; olda workhub.assistant_requests;
  oldg workhub.ai_gateway_requests; x workhub.assistant_exchanges; claim jsonb; inp jsonb:=p_input; quality text:=p_quality; w date[]; student jsonb;
BEGIN
  ctx:=workhub_private.p10_actor(p_actor_user_id,p_feature,p_member_id);
  IF NOT workhub_private.p6_key(p_request_key) OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_quality IS NULL OR p_quality NOT IN('quick','review') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_review_of='null'::jsonb THEN p_review_of:=NULL; END IF;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  IF EXISTS(SELECT 1 FROM workhub.ai_gateway_closed_keys WHERE school_id=ctx.school_id AND actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key) THEN
    RETURN workhub_private.p10_ok(ctx.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('state','closed')); END IF;
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key AND member_id IS NOT DISTINCT FROM p_member_id FOR UPDATE;
  IF g.id IS NOT NULL THEN
    IF g.school_id<>ctx.school_id OR g.member_id IS DISTINCT FROM p_member_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF g.payload_sha256<>p_payload_sha256 OR g.requested_quality<>p_quality OR g.review_of IS DISTINCT FROM p_review_of THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,workhub_private.p10_public(g,ctx));
  END IF;
  PERFORM workhub_private.p10_ready(ctx.school_id,p_feature);
  IF p_feature='assistant' THEN
    PERFORM workhub_private.p6_input(inp);
    IF inp->>'intent'='student_record_draft' THEN quality:='review'; END IF;
    IF p_review_of IS NOT NULL THEN
      IF quality<>'review' OR NOT workhub_private.p2_exact(p_review_of,ARRAY['requestKey','exchangeId'])
         OR NOT workhub_private.p6_key(p_review_of->>'requestKey') OR NOT workhub_private.p6_id(p_review_of->'exchangeId') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      SELECT z.* INTO oldg FROM workhub.ai_gateway_requests z WHERE z.actor_user_id=p_actor_user_id AND z.school_id=ctx.school_id AND z.feature='assistant'
        AND z.request_key=p_review_of->>'requestKey' AND z.member_id=p_member_id AND z.quality='quick' AND z.state='completed' AND z.origin='native';
      SELECT * INTO olda FROM workhub.assistant_requests WHERE id=oldg.assistant_request_id;
      SELECT * INTO x FROM workhub.assistant_exchanges WHERE id=olda.exchange_id;
      IF x.id IS NULL OR x.id<>p_review_of->>'exchangeId' OR inp->>'threadId' IS DISTINCT FROM x.thread_id
        OR (inp->'prompt',inp->'intent',inp->'mode',inp->'studentContext') IS DISTINCT FROM (olda.input->'prompt',olda.input->'intent',olda.input->'mode',olda.input->'studentContext')
        OR inp->'references'<>'[]'::jsonb THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      inp:=jsonb_set(inp,'{references}',olda.input->'references');
    END IF;
  ELSIF inp IS NOT NULL OR p_review_of IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO pol FROM workhub.ai_school_policies WHERE school_id=ctx.school_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO ap FROM workhub.assistant_policies WHERE school_id=ctx.school_id AND version=CASE quality WHEN 'quick' THEN pol.quick_policy_version ELSE pol.review_policy_version END;
  SELECT * INTO cred FROM workhub.ai_credentials WHERE school_id=ctx.school_id ORDER BY version DESC LIMIT 1;
  w:=workhub_private.p6_window(ctx.school_id);
  IF workhub_private.p10_total(ctx.school_id,w[2])+ap.reserve_micro_usd>pol.monthly_limit_micro_usd THEN RAISE EXCEPTION 'BUDGET_EXCEEDED'; END IF;
  IF p_feature='assistant' THEN
    claim:=workhub_private.p10_claim(ctx,inp,p_request_key,workhub_private.p2_sha(inp),a,ap.version);
    SELECT * INTO a FROM workhub.assistant_requests WHERE school_id=ctx.school_id AND owner_account_id=ctx.account_id AND request_key=p_request_key;
    IF inp->>'intent'='student_record_draft' THEN
      PERFORM workhub_private.p5_document_student_check(ctx,inp->'studentContext');
      SELECT jsonb_build_object('studentId',s.id,'schoolStudentKey',s.school_student_key,'name',s.name) INTO student
        FROM workhub.students s WHERE s.school_id=ctx.school_id AND s.id=inp#>>'{studentContext,studentId}';
    END IF;
  END IF;
  INSERT INTO workhub.ai_gateway_requests(school_id,actor_user_id,feature,member_id,request_key,payload_sha256,requested_quality,quality,review_of,
    policy_version,assistant_policy_version,credential_version,assistant_request_id,lease_token,lease_until,budget_day,budget_month,reserved_micro_usd)
  VALUES(ctx.school_id,p_actor_user_id,p_feature,p_member_id,p_request_key,p_payload_sha256,p_quality,quality,p_review_of,pol.version,ap.version,cred.version,a.id,
    coalesce(a.lease_token,workhub_private.p6_token()),coalesce(a.lease_until,clock_timestamp()+workhub_private.p6_lease()),w[1],w[2],ap.reserve_micro_usd) RETURNING * INTO g;
  RETURN workhub_private.p10_ok(ctx.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('state','claimed','leaseToken',g.lease_token,
    'policy',jsonb_build_object('version',pol.version,'model',ap.model,'maxInputTokens',80000,'maxOutputTokens',ap.max_output_tokens,'reservedMicroUsd',ap.reserve_micro_usd),
    'credential',cred.envelope||jsonb_build_object('version',cred.version),'assistant',claim,'execution',workhub_private.p10_execution(g),
    'reviewSnapshot',CASE WHEN p_review_of IS NOT NULL THEN jsonb_build_object('requestKey',p_review_of->>'requestKey','exchangeId',x.id,'segments',x.segments) END,'studentIdentity',student));
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN workhub_private.p10_err(ctx.school_id,p_actor_user_id,p_feature,p_request_key,SQLERRM); END IF; RAISE;
END $$;

CREATE FUNCTION public.workhub_ai_gateway_start(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_lease_token text,
  p_counted_input_tokens integer,p_provider_body_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; g workhub.ai_gateway_requests; ap workhub.assistant_policies; v jsonb; a workhub.assistant_requests;
BEGIN
  ctx:=workhub_private.p10_actor(p_actor_user_id,p_feature,p_member_id);
  PERFORM workhub_private.p10_lock(ctx.school_id);
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key AND member_id IS NOT DISTINCT FROM p_member_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF g.school_id<>ctx.school_id OR g.member_id IS DISTINCT FROM p_member_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF g.state<>'prepared' OR g.lease_token IS DISTINCT FROM p_lease_token OR g.lease_until<=clock_timestamp() THEN
    RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('started',false)); END IF;
  PERFORM workhub_private.p10_ready(ctx.school_id,p_feature);
  IF g.credential_version IS DISTINCT FROM (SELECT max(version) FROM workhub.ai_credentials WHERE school_id=ctx.school_id)
     OR g.budget_month<>(workhub_private.p6_window(ctx.school_id))[2] THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO ap FROM workhub.assistant_policies WHERE school_id=g.school_id AND version=g.assistant_policy_version;
  IF p_counted_input_tokens IS NULL OR p_counted_input_tokens<0 OR p_counted_input_tokens>80000
     OR p_provider_body_sha256 IS NULL OR p_provider_body_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_feature='assistant' THEN
    SELECT * INTO a FROM workhub.assistant_requests WHERE id=g.assistant_request_id;
    IF NOT workhub_private.p6_evidence_live(ctx,NULLIF(a.input->'studentContext','null'::jsonb)) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v:=public.workhub_ai_start(p_actor_user_id,p_member_id,p_request_key,p_lease_token);
    IF v ? 'error' THEN RAISE EXCEPTION '%',v#>>'{error,code}'; END IF;
    IF v#>'{data,started}' IS DISTINCT FROM 'true'::jsonb THEN RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('started',false)); END IF;
  END IF;
  UPDATE workhub.ai_gateway_requests SET state='started',started_at=clock_timestamp(),counted_input_tokens=p_counted_input_tokens,
    provider_body_sha256=p_provider_body_sha256,updated_at=clock_timestamp() WHERE id=g.id;
  RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('started',true));
EXCEPTION WHEN raise_exception THEN IF workhub_private.p10_business(SQLERRM) THEN RETURN workhub_private.p10_err(ctx.school_id,p_actor_user_id,p_feature,p_request_key,SQLERRM); END IF; RAISE;
END $$;

CREATE FUNCTION public.workhub_ai_gateway_recover(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_payload_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; g workhub.ai_gateway_requests;
BEGIN
  ctx:=workhub_private.p10_actor(p_actor_user_id,p_feature,p_member_id);
  IF NOT workhub_private.p6_key(p_request_key) OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF EXISTS(SELECT 1 FROM workhub.ai_gateway_closed_keys WHERE school_id=ctx.school_id AND actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key) THEN
    RETURN workhub_private.p10_ok(ctx.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('state','closed')); END IF;
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key AND member_id IS NOT DISTINCT FROM p_member_id;
  IF g.id IS NULL THEN RETURN workhub_private.p10_ok(ctx.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('state','missing')); END IF;
  IF g.school_id<>ctx.school_id OR g.member_id IS DISTINCT FROM p_member_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF g.payload_sha256<>p_payload_sha256 THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,workhub_private.p10_public(g,ctx));
EXCEPTION WHEN raise_exception THEN IF workhub_private.p10_business(SQLERRM) THEN RETURN workhub_private.p10_err(ctx.school_id,p_actor_user_id,p_feature,p_request_key,SQLERRM); END IF; RAISE;
END $$;

CREATE FUNCTION public.workhub_ai_gateway_release(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_lease_token text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; g workhub.ai_gateway_requests; v jsonb;
BEGIN
  ctx:=workhub_private.p10_actor(p_actor_user_id,p_feature,p_member_id);
  IF NOT workhub_private.p6_key(p_request_key) OR p_reason IS NULL OR p_reason NOT IN('COUNT_FAILED','INPUT_TOO_LARGE','CANCELLED') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p10_lock(ctx.school_id);
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key AND member_id IS NOT DISTINCT FROM p_member_id FOR UPDATE;
  IF g.id IS NULL THEN
    IF p_reason<>'CANCELLED' OR p_lease_token IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    INSERT INTO workhub.ai_gateway_closed_keys(school_id,actor_user_id,feature,member_id,request_key) VALUES(ctx.school_id,p_actor_user_id,p_feature,p_member_id,p_request_key) ON CONFLICT DO NOTHING;
    RETURN workhub_private.p10_ok(ctx.school_id,p_actor_user_id,p_feature,p_request_key,jsonb_build_object('state','closed'));
  END IF;
  IF g.school_id<>ctx.school_id OR g.member_id IS DISTINCT FROM p_member_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF g.state<>'prepared' THEN RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,workhub_private.p10_public(g,ctx)); END IF;
  IF NOT(p_reason='CANCELLED' AND p_lease_token IS NULL) AND g.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v:=CASE p_reason WHEN 'CANCELLED' THEN jsonb_build_object('state','closed') ELSE jsonb_build_object('state','failed','code',p_reason) END;
  UPDATE workhub.ai_gateway_requests SET state=CASE p_reason WHEN 'CANCELLED' THEN 'closed' ELSE 'failed' END,actual_micro_usd=0,
    finish_sha256=workhub_private.p2_sha(v),receipt=v,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=g.id;
  -- P6의 시작 전 대기만 만료한다. 원 입력·원키·시작 여부를 바꾸지 않는다.
  UPDATE workhub.assistant_requests SET lease_until=least(lease_until,clock_timestamp()),updated_at=clock_timestamp() WHERE id=g.assistant_request_id AND state='claimed';
  RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,v);
EXCEPTION WHEN raise_exception THEN IF workhub_private.p10_business(SQLERRM) THEN RETURN workhub_private.p10_err(ctx.school_id,p_actor_user_id,p_feature,p_request_key,SQLERRM); END IF; RAISE;
END $$;

CREATE FUNCTION public.workhub_ai_gateway_finish(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_lease_token text,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE ctx workhub_private.actor_context; g workhub.ai_gateway_requests; ap workhub.assistant_policies; access_ok boolean:=true;
  sh text; cost bigint; nin integer; nout integer; mid text; state text; receipt jsonb; v jsonb; response jsonb; observed jsonb;
BEGIN
  PERFORM workhub_private.p10_service();
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE actor_user_id=p_actor_user_id AND feature=p_feature AND request_key=p_request_key AND member_id IS NOT DISTINCT FROM p_member_id;
  IF g.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  BEGIN ctx:=workhub_private.p10_actor(p_actor_user_id,p_feature,p_member_id); access_ok:=ctx.school_id=g.school_id;
  EXCEPTION WHEN others THEN access_ok:=false; END;
  PERFORM workhub_private.p10_lock(g.school_id);
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE id=g.id FOR UPDATE;
  IF g.lease_token IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  sh:=workhub_private.p2_sha(p_result);
  IF g.finish_sha256 IS NOT NULL THEN
    IF g.finish_sha256<>sh THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,
      CASE WHEN access_ok THEN workhub_private.p10_public(g,ctx) ELSE jsonb_build_object('state','failed','code','FORBIDDEN') END);
  END IF;
  IF g.state<>'started' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO ap FROM workhub.assistant_policies WHERE school_id=g.school_id AND version=g.assistant_policy_version;
  state:=p_result->>'state';
  IF state='provider_unknown' THEN
    IF NOT(workhub_private.p2_exact(p_result,ARRAY['state']) OR workhub_private.p2_exact(p_result,ARRAY['state','observedUsage'])) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    observed:=p_result->'observedUsage';
    IF observed IS NOT NULL AND (NOT workhub_private.p2_exact(observed,ARRAY['inputTokens','outputTokens']) OR NOT workhub_private.p6_int(observed->'inputTokens',0) OR NOT workhub_private.p6_int(observed->'outputTokens',0)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSIF state IN('completed','rejected') THEN
    IF NOT workhub_private.p2_exact(p_result,CASE state WHEN 'completed' THEN ARRAY['state','response','usage','providerMessageId'] ELSE ARRAY['state','code','usage','providerMessageId'] END)
      OR state='rejected' AND coalesce(p_result->>'code','') NOT IN('OUTPUT_INVALID','PROVIDER_REJECTED','TRUNCATED')
      OR state='completed' AND (jsonb_typeof(p_result->'response')<>'object' OR octet_length((p_result->'response')::text)>1500000) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF p_result->'usage'<>'null'::jsonb THEN
      IF NOT workhub_private.p2_exact(p_result->'usage',ARRAY['inputTokens','outputTokens'])
         OR NOT workhub_private.p6_int(p_result#>'{usage,inputTokens}',0) OR NOT workhub_private.p6_int(p_result#>'{usage,outputTokens}',0)
         OR (p_result#>>'{usage,inputTokens}')::numeric>2147483647 OR (p_result#>>'{usage,outputTokens}')::numeric>2147483647
         OR NOT workhub_private.p6_id(p_result->'providerMessageId') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      nin:=(p_result#>>'{usage,inputTokens}')::integer; nout:=(p_result#>>'{usage,outputTokens}')::integer; mid:=p_result->>'providerMessageId';
      IF nin>100000 OR nout>8000 THEN observed:=p_result->'usage'; state:='provider_unknown';
      ELSE cost:=workhub_private.p10_cost(ap,nin,nout); END IF;
    ELSE
      IF state='completed' OR p_result->'providerMessageId'<>'null'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    END IF;
  ELSE RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF mid IS NOT NULL AND EXISTS(SELECT 1 FROM workhub.ai_gateway_requests WHERE school_id=g.school_id AND provider_message_id=mid AND id<>g.id) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_feature='assistant' THEN
    v:=CASE state WHEN 'completed' THEN p_result->'response' WHEN 'rejected' THEN p_result ELSE jsonb_build_object('state','provider_unknown','usage',NULL,'providerMessageId',NULL) END;
    IF state='completed' AND (v->'usage' IS DISTINCT FROM p_result->'usage' OR v->'providerMessageId' IS DISTINCT FROM p_result->'providerMessageId' OR v->>'state'<>'completed') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v:=workhub_private.p10_legacy_finish(p_actor_user_id,p_member_id,p_request_key,p_lease_token,v);
    IF v ? 'error' THEN
      IF cost IS NULL THEN RAISE EXCEPTION '%',v#>>'{error,code}'; END IF;
      v:=workhub_private.p10_legacy_finish(p_actor_user_id,p_member_id,p_request_key,p_lease_token,
        jsonb_build_object('state','rejected','code','OUTPUT_INVALID','usage',p_result->'usage','providerMessageId',mid));
      IF v ? 'error' THEN RAISE EXCEPTION '%',v#>>'{error,code}'; END IF;
    END IF;
    response:=workhub_private.p10_decorate(v->'data',g.school_id,p_actor_user_id);
    IF response->>'state'<>'completed' AND state='completed' THEN state:='rejected'; END IF;
  ELSE response:=p_result->'response'; END IF;
  IF cost IS NULL THEN state:='unknown'; receipt:=jsonb_build_object('state','pending','reason','provider_unknown');
  ELSIF state='completed' AND access_ok THEN receipt:=jsonb_build_object('state','completed','response',response,'quality',g.quality,'model',ap.model,'usage',p_result->'usage');
  ELSE state:='rejected'; receipt:=jsonb_build_object('state','failed','code',CASE WHEN NOT access_ok THEN 'FORBIDDEN' ELSE coalesce(p_result->>'code','OUTPUT_INVALID') END); END IF;
  UPDATE workhub.ai_gateway_requests SET state=state,actual_micro_usd=cost,input_tokens=nin,output_tokens=nout,provider_message_id=mid,
    finish_sha256=sh,receipt=receipt,observed_usage=observed,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=g.id RETURNING * INTO g;
  IF observed IS NOT NULL OR cost>g.reserved_micro_usd THEN UPDATE workhub.ai_school_controls SET overage_blocked=true,updated_at=clock_timestamp() WHERE school_id=g.school_id; END IF;
  RETURN workhub_private.p10_ok(g.school_id,p_actor_user_id,p_feature,p_request_key,CASE WHEN access_ok THEN receipt ELSE jsonb_build_object('state','failed','code','FORBIDDEN') END);
EXCEPTION WHEN raise_exception THEN IF workhub_private.p10_business(SQLERRM) THEN RETURN workhub_private.p10_err(g.school_id,p_actor_user_id,p_feature,p_request_key,SQLERRM); END IF; RAISE;
END $$;

-- 적용 전 이미 시작된 P6 요청은 기존 끝 처리로 정산할 수 있다. 비용 원장 반영도 같은 학교 잠금 안이다.
CREATE FUNCTION workhub_private.p10_bridge_p6() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE g workhub.ai_gateway_requests; state text;
BEGIN
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE assistant_request_id=NEW.id AND origin='legacy_p6';
  IF g.id IS NULL OR g.state IN('closed','failed') THEN RETURN NEW; END IF;
  state:=CASE NEW.state WHEN 'claimed' THEN 'prepared' WHEN 'provider_unknown' THEN 'unknown' ELSE NEW.state END;
  UPDATE workhub.ai_gateway_requests SET state=state,started_at=NEW.started_at,actual_micro_usd=NEW.actual_micro_usd,input_tokens=NEW.input_tokens,output_tokens=NEW.output_tokens,
    provider_message_id=NEW.provider_message_id,finish_sha256=NEW.finish_sha256,receipt=CASE WHEN state='unknown' THEN jsonb_build_object('state','pending','reason','provider_unknown') WHEN state IN('resolved','rejected') THEN jsonb_build_object('state','failed','code',coalesce(NEW.result->>'code','PROVIDER_REJECTED')) ELSE NEW.result END,updated_at=NEW.updated_at,
    finished_at=CASE WHEN NEW.finish_sha256 IS NOT NULL THEN NEW.updated_at END WHERE id=g.id;
  IF NEW.actual_micro_usd>NEW.reserved_micro_usd THEN UPDATE workhub.ai_school_controls SET overage_blocked=true WHERE school_id=NEW.school_id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_gateway_p6_bridge AFTER UPDATE ON workhub.assistant_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.p10_bridge_p6();

CREATE OR REPLACE FUNCTION public.workhub_ai_finish(p_actor_user_id uuid,p_member_id text,p_request_key text,p_lease_token text,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g workhub.ai_gateway_requests; ctx workhub_private.actor_context;
BEGIN
  PERFORM workhub_private.p10_service();
  SELECT * INTO g FROM workhub.ai_gateway_requests WHERE actor_user_id=p_actor_user_id AND member_id=p_member_id AND feature='assistant' AND request_key=p_request_key AND origin='legacy_p6';
  IF g.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  BEGIN ctx:=workhub_private.p6_service_member(p_actor_user_id,p_member_id); EXCEPTION WHEN others THEN NULL; END;
  PERFORM workhub_private.p10_lock(g.school_id);
  RETURN workhub_private.p10_legacy_finish(p_actor_user_id,p_member_id,p_request_key,p_lease_token,p_result);
END $$;

CREATE FUNCTION public.workhub_ai_policy_threads_list(p_member_id text,p_mode text,p_cursor text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.workhub_ai_threads_list(p_member_id,p_mode,p_cursor) $$;
CREATE FUNCTION public.workhub_ai_policy_thread_get(p_member_id text,p_thread_id text,p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; v jsonb;
BEGIN
  ctx:=workhub_private.member_actor(p_member_id,false);
  v:=public.workhub_ai_thread_get(p_member_id,p_thread_id,p_cursor);
  IF v ? 'data' THEN v:=jsonb_set(v,'{data}',workhub_private.p10_decorate(v->'data',ctx.school_id,ctx.auth_user_id)); END IF;
  RETURN v;
END $$;

DO $$ DECLARE f text; BEGIN
  FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 'p10\_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f); END LOOP;
  FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'workhub_ai_gateway_%' OR proname LIKE 'workhub_ai_policy_%' OR proname='workhub_ai_finish') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
    IF f LIKE 'workhub_ai_policy_%' OR f LIKE 'public.workhub_ai_policy_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
    ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f); END IF;
  END LOOP;
END $$;
-- 기존 준비·시작 경로의 예산 우회를 막는다. 기존 끝 처리·읽기 권한은 보존한다.
REVOKE EXECUTE ON FUNCTION public.workhub_ai_prepare(uuid,text,jsonb,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.workhub_ai_start(uuid,text,text,text) FROM service_role;
INSERT INTO workhub_private.p10_ai_installs VALUES('P10-AI-02','2026-10-21.1',clock_timestamp());
COMMIT;
