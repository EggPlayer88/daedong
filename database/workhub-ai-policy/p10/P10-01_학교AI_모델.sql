-- P10 학교별 AI 키·공통 예산. 신규 증분만 설치하며 정책/키/학교 연결/활성화는 만들지 않는다.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('workhub_private.p6_installed()') IS NULL THEN RAISE EXCEPTION 'P6 먼저 설치'; END IF;
  IF NOT workhub_private.p6_installed() THEN RAISE EXCEPTION 'P6 설치 미완료'; END IF;
  IF to_regclass('workhub_private.p10_ai_installs') IS NOT NULL THEN RAISE EXCEPTION 'P10 AI 이미 설치'; END IF;
END $$;
CREATE TABLE workhub_private.p10_ai_installs(batch text PRIMARY KEY, release text NOT NULL, installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER p10_ai_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p10_ai_installs FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.ai_school_policies(
  school_id text NOT NULL REFERENCES workhub.schools(id), version integer NOT NULL CHECK(version>0),
  quick_policy_version integer NOT NULL, review_policy_version integer NOT NULL,
  monthly_limit_micro_usd bigint NOT NULL CHECK(monthly_limit_micro_usd=100000000),
  approved_by_membership_id text NOT NULL, approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(school_id,version),
  FOREIGN KEY(school_id,quick_policy_version) REFERENCES workhub.assistant_policies(school_id,version),
  FOREIGN KEY(school_id,review_policy_version) REFERENCES workhub.assistant_policies(school_id,version),
  FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TRIGGER ai_school_policies_immutable BEFORE UPDATE OR DELETE ON workhub.ai_school_policies FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TABLE workhub.ai_school_controls(
  school_id text PRIMARY KEY REFERENCES workhub.schools(id), enabled boolean NOT NULL DEFAULT false,
  overage_blocked boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE workhub.ai_credentials(
  school_id text NOT NULL REFERENCES workhub.schools(id), version integer NOT NULL CHECK(version>0),
  envelope jsonb NOT NULL, masked_suffix text NOT NULL CHECK(masked_suffix ~ '^[A-Za-z0-9_-]{4}$'),
  created_by_membership_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(school_id,version), FOREIGN KEY(school_id,created_by_membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TRIGGER ai_credentials_immutable BEFORE UPDATE OR DELETE ON workhub.ai_credentials FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 명시 승인 연결만 허용한다. auth·legacy 회원·업무실 소속/역할은 만들거나 바꾸지 않는다.
CREATE TABLE workhub.ai_legacy_school_links(
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text, school_id text NOT NULL REFERENCES workhub.schools(id),
  auth_user_id uuid NOT NULL, approved_by_membership_id text NOT NULL, approval_ref text NOT NULL,
  valid_from date NOT NULL, valid_to date, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(valid_to IS NULL OR valid_to>valid_from), CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
  FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE UNIQUE INDEX ai_legacy_school_links_current ON workhub.ai_legacy_school_links(auth_user_id) WHERE revoked_at IS NULL;
CREATE FUNCTION workhub_private.p10_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
     OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_legacy_school_links_guard BEFORE UPDATE OR DELETE ON workhub.ai_legacy_school_links FOR EACH ROW EXECUTE FUNCTION workhub_private.p10_link_guard();

CREATE TABLE workhub.ai_gateway_requests(
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text, school_id text NOT NULL REFERENCES workhub.schools(id),
  actor_user_id uuid NOT NULL, feature text NOT NULL CHECK(feature IN('assistant','evaluation')), member_id text,
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{8,100}$'), payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  requested_quality text NOT NULL CHECK(requested_quality IN('quick','review','legacy')), quality text NOT NULL CHECK(quality IN('quick','review','legacy')),
  review_of jsonb, policy_version integer, assistant_policy_version integer NOT NULL,
  credential_version integer, assistant_request_id text UNIQUE REFERENCES workhub.assistant_requests(id),
  origin text NOT NULL DEFAULT 'native' CHECK(origin IN('native','legacy_p6')),
  lease_token text NOT NULL CHECK(lease_token ~ '^[0-9a-f]{64}$'), lease_until timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','started','completed','rejected','unknown','failed','closed','resolved')),
  budget_day date NOT NULL, budget_month date NOT NULL, reserved_micro_usd bigint NOT NULL CHECK(reserved_micro_usd>0),
  actual_micro_usd bigint CHECK(actual_micro_usd>=0), input_tokens integer CHECK(input_tokens>=0), output_tokens integer CHECK(output_tokens>=0),
  counted_input_tokens integer CHECK(counted_input_tokens>=0), provider_body_sha256 text CHECK(provider_body_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz, finished_at timestamptz, provider_message_id text, finish_sha256 text, receipt jsonb, observed_usage jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(school_id,actor_user_id,feature,request_key), FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id),
  FOREIGN KEY(school_id,policy_version) REFERENCES workhub.ai_school_policies(school_id,version),
  FOREIGN KEY(school_id,assistant_policy_version) REFERENCES workhub.assistant_policies(school_id,version),
  FOREIGN KEY(school_id,credential_version) REFERENCES workhub.ai_credentials(school_id,version),
  CHECK((input_tokens IS NULL)=(output_tokens IS NULL)), CHECK((state='prepared') OR started_at IS NOT NULL OR state IN('failed','closed')),
  CHECK(origin='legacy_p6' OR policy_version IS NOT NULL AND credential_version IS NOT NULL),
  CHECK(feature<>'assistant' OR member_id IS NOT NULL)
);
CREATE UNIQUE INDEX ai_gateway_provider_id ON workhub.ai_gateway_requests(school_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX ai_gateway_budget ON workhub.ai_gateway_requests(school_id,budget_month);
CREATE FUNCTION workhub_private.p10_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
  IF (NEW.id,NEW.school_id,NEW.actor_user_id,NEW.feature,NEW.member_id,NEW.request_key,NEW.payload_sha256,NEW.requested_quality,NEW.quality,NEW.review_of,
      NEW.policy_version,NEW.assistant_policy_version,NEW.credential_version,NEW.origin,NEW.lease_token,NEW.lease_until,NEW.budget_day,NEW.budget_month,NEW.reserved_micro_usd,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.actor_user_id,OLD.feature,OLD.member_id,OLD.request_key,OLD.payload_sha256,OLD.requested_quality,OLD.quality,OLD.review_of,
      OLD.policy_version,OLD.assistant_policy_version,OLD.credential_version,OLD.origin,OLD.lease_token,OLD.lease_until,OLD.budget_day,OLD.budget_month,OLD.reserved_micro_usd,OLD.created_at)
    THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
  IF OLD.assistant_request_id IS NOT NULL AND NEW.assistant_request_id IS DISTINCT FROM OLD.assistant_request_id THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
  IF OLD.started_at IS NOT NULL AND (NEW.started_at,NEW.counted_input_tokens,NEW.provider_body_sha256) IS DISTINCT FROM (OLD.started_at,OLD.counted_input_tokens,OLD.provider_body_sha256) THEN RAISE EXCEPTION 'STARTED_IMMUTABLE'; END IF;
  IF OLD.state IN('completed','failed','closed','resolved') OR OLD.state='rejected' AND OLD.actual_micro_usd IS NOT NULL THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'FINISHED_IMMUTABLE'; END IF;
  END IF;
  IF OLD.observed_usage IS NOT NULL AND NEW.observed_usage IS DISTINCT FROM OLD.observed_usage THEN RAISE EXCEPTION 'FINISHED_IMMUTABLE'; END IF;
  IF OLD.state='prepared' AND NEW.state NOT IN('prepared','started','failed','closed')
    OR OLD.state='started' AND NEW.state NOT IN('started','completed','rejected','unknown','resolved')
    OR OLD.state='rejected' AND NEW.state NOT IN('rejected','resolved') THEN RAISE EXCEPTION 'INVALID_STATE_TRANSITION'; END IF;
  IF OLD.finish_sha256 IS NOT NULL AND NEW.finish_sha256 IS DISTINCT FROM OLD.finish_sha256 THEN RAISE EXCEPTION 'FINISHED_IMMUTABLE'; END IF;
  IF OLD.state='unknown' AND NEW.state NOT IN('unknown','resolved') THEN RAISE EXCEPTION 'FINISHED_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_gateway_requests_guard BEFORE UPDATE OR DELETE ON workhub.ai_gateway_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.p10_request_guard();
CREATE TABLE workhub.ai_gateway_closed_keys(
  school_id text NOT NULL REFERENCES workhub.schools(id), actor_user_id uuid NOT NULL,
  feature text NOT NULL CHECK(feature IN('assistant','evaluation')), member_id text, request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  closed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(school_id,actor_user_id,feature,request_key)
);
CREATE TRIGGER ai_gateway_closed_keys_immutable BEFORE UPDATE OR DELETE ON workhub.ai_gateway_closed_keys FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TABLE workhub.ai_admin_requests(
  school_id text NOT NULL, member_id text NOT NULL, request_key text NOT NULL, payload_sha256 text NOT NULL,
  receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(school_id,member_id,request_key),
  FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TRIGGER ai_admin_requests_immutable BEFORE UPDATE OR DELETE ON workhub.ai_admin_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 기존 P6 비용을 같은 원장에 한 번 이관한다. 원본·대화·근거 행은 변경하지 않는다.
INSERT INTO workhub.ai_gateway_requests(school_id,actor_user_id,feature,member_id,request_key,payload_sha256,requested_quality,quality,
  assistant_policy_version,assistant_request_id,origin,lease_token,lease_until,state,budget_day,budget_month,reserved_micro_usd,
  actual_micro_usd,input_tokens,output_tokens,started_at,finished_at,provider_message_id,finish_sha256,receipt,created_at,updated_at)
SELECT school_id,owner_auth_user_id,'assistant',owner_membership_id,request_key,input_sha256,'legacy','legacy',policy_version,id,'legacy_p6',lease_token,lease_until,
  CASE state WHEN 'claimed' THEN 'prepared' WHEN 'provider_unknown' THEN 'unknown' ELSE state END,budget_day,budget_month,reserved_micro_usd,
  actual_micro_usd,input_tokens,output_tokens,started_at,CASE WHEN finish_sha256 IS NOT NULL THEN updated_at END,provider_message_id,finish_sha256,result,created_at,updated_at
FROM workhub.assistant_requests;

CREATE FUNCTION workhub_private.p10_lock(p_school text) RETURNS void LANGUAGE sql SET search_path='' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('p10-ai-school'||chr(31)||p_school,0))
$$;
CREATE FUNCTION workhub_private.p10_service() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END $$;
CREATE FUNCTION workhub_private.p10_actor(p_uid uuid,p_feature text,p_member text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; s workhub.schools; l workhub.ai_legacy_school_links; active boolean;
BEGIN
  PERFORM workhub_private.p10_service();
  IF p_uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_feature='assistant' THEN RETURN workhub_private.p6_service_member(p_uid,p_member); END IF;
  IF p_feature IS DISTINCT FROM 'evaluation' OR p_member IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT is_active INTO active FROM public.users WHERE id=p_uid::text FOR SHARE;
  IF active IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO l FROM workhub.ai_legacy_school_links WHERE auth_user_id=p_uid AND revoked_at IS NULL FOR SHARE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'SCHOOL_NOT_LINKED'; END IF;
  SELECT * INTO s FROM workhub.schools WHERE id=l.school_id FOR SHARE;
  IF s.status IS DISTINCT FROM 'active' OR NOT(workhub_private.today_in(s.timezone)<@daterange(l.valid_from,l.valid_to,'[)')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  ctx.actor_kind:='member'; ctx.auth_user_id:=p_uid; ctx.school_id:=s.id; ctx.scope_key:='s:'||s.id;
  ctx.school_today:=workhub_private.today_in(s.timezone); ctx.school_timezone:=s.timezone;
  RETURN ctx;
END $$;
CREATE FUNCTION workhub_private.p10_ok(p_school text,p_uid uuid,p_feature text,p_key text,p_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('contract','ai-gateway.v1','schoolId',p_school,'actorUserId',p_uid,'feature',p_feature,'requestKey',p_key,'data',p_data)
$$;
CREATE FUNCTION workhub_private.p10_err(p_school text,p_uid uuid,p_feature text,p_key text,p_code text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('contract','ai-gateway.v1','schoolId',p_school,'actorUserId',p_uid,'feature',p_feature,'requestKey',p_key,'error',jsonb_build_object('code',p_code))
$$;
CREATE FUNCTION workhub_private.p10_charge(r workhub.ai_gateway_requests) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN r.actual_micro_usd IS NOT NULL THEN r.actual_micro_usd WHEN r.state IN('closed','failed') THEN 0 ELSE r.reserved_micro_usd END
$$;
CREATE FUNCTION workhub_private.p10_total(p_school text,p_month date) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(sum(workhub_private.p10_charge(r)),0)::bigint FROM workhub.ai_gateway_requests r WHERE r.school_id=p_school AND r.budget_month=p_month
$$;
CREATE FUNCTION workhub_private.p10_execution(r workhub.ai_gateway_requests) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('quality',r.quality,'model',p.model,'reviewOf',r.review_of) FROM workhub.assistant_policies p WHERE p.school_id=r.school_id AND p.version=r.assistant_policy_version
$$;
CREATE FUNCTION workhub_private.p10_decorate(p_data jsonb,p_school text,p_uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb; t jsonb; e jsonb; v jsonb; arr jsonb:='[]'::jsonb;
BEGIN
  j:=p_data; t:=CASE WHEN j ? 'thread' THEN j->'thread' ELSE j END;
  IF jsonb_typeof(t->'exchanges') IS DISTINCT FROM 'array' THEN RETURN j; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(t->'exchanges') LOOP
    SELECT workhub_private.p10_execution(g) INTO v FROM workhub.ai_gateway_requests g JOIN workhub.assistant_requests a ON a.id=g.assistant_request_id
    WHERE g.school_id=p_school AND g.actor_user_id=p_uid AND a.exchange_id=e->>'id' AND g.origin='native';
    arr:=arr||jsonb_build_array(CASE WHEN v IS NULL THEN e ELSE e||jsonb_build_object('execution',v) END);
  END LOOP;
  t:=jsonb_set(t,'{exchanges}',arr); RETURN CASE WHEN j ? 'thread' THEN jsonb_set(j,'{thread}',t) ELSE t END;
END $$;
CREATE FUNCTION workhub_private.p10_public(r workhub.ai_gateway_requests,p_ctx workhub_private.actor_context) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a workhub.assistant_requests; response jsonb;
BEGIN
  IF r.state='completed' AND r.feature='assistant' THEN
    SELECT * INTO a FROM workhub.assistant_requests WHERE id=r.assistant_request_id;
    response:=workhub_private.p10_decorate(workhub_private.p6_public(p_ctx,a),r.school_id,r.actor_user_id);
    RETURN jsonb_build_object('state','completed','response',response,'quality',r.quality,'model',(workhub_private.p10_execution(r))->'model',
      'usage',jsonb_build_object('inputTokens',r.input_tokens,'outputTokens',r.output_tokens));
  END IF;
  IF r.state IN('prepared','started') THEN RETURN jsonb_build_object('state','pending','reason','in_progress'); END IF;
  IF r.state='unknown' THEN RETURN jsonb_build_object('state','pending','reason','provider_unknown'); END IF;
  RETURN r.receipt;
END $$;

DO $$ DECLARE t text; f text; BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p10_ai_installs','workhub.ai_school_policies','workhub.ai_school_controls','workhub.ai_credentials','workhub.ai_legacy_school_links','workhub.ai_gateway_requests','workhub.ai_gateway_closed_keys','workhub.ai_admin_requests'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated,service_role',t);
  END LOOP;
  FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 'p10\_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f); END LOOP;
END $$;
INSERT INTO workhub_private.p10_ai_installs VALUES('P10-AI-01','2026-10-21.1',clock_timestamp());
COMMIT;
