-- 관리자 운영 메타데이터만 조회한다. 질문·답변·사용자 UID·키·근거를 반환하거나 원장을 변경하지 않는다.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM workhub_private.p10_ai_installs WHERE batch='P10-AI-03') THEN RAISE EXCEPTION 'P10 AI 먼저 설치'; END IF;
END $$;

CREATE FUNCTION workhub_private.p10_operations_counts(p_states text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_object_agg(s,(SELECT count(*) FROM unnest(p_states) AS x(v) WHERE v=s))
 FROM unnest(ARRAY['prepared','started','completed','rejected','unknown','failed','closed','resolved']) AS st(s)
$$;

CREATE FUNCTION public.workhub_ai_school_operations(p_actor_user_id uuid,p_member_id text,p_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; checked timestamptz; cutoff timestamptz; mon date; anchor timestamptz; anchor_id text; result jsonb;
BEGIN
  ctx:=workhub_private.p10_admin(p_actor_user_id,p_member_id);
  -- 앞선 예약 트랜잭션이 끝난 뒤 상한을 잡는다. 아직 미커밋인 이전 시각 행이 다음 페이지에 끼어드는 것을 막는다.
  PERFORM workhub_private.p10_lock(ctx.school_id);
  checked:=date_trunc('milliseconds',clock_timestamp());
  IF p_cursor IS NULL OR p_cursor='null'::jsonb THEN
    cutoff:=checked; mon:=date_trunc('month',cutoff AT TIME ZONE ctx.school_timezone)::date;
  ELSE
    IF NOT workhub_private.p2_exact(p_cursor,ARRAY['month','asOf','afterId'])
      OR jsonb_typeof(p_cursor->'month') IS DISTINCT FROM 'string' OR p_cursor->>'month' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      OR jsonb_typeof(p_cursor->'asOf') IS DISTINCT FROM 'string' OR p_cursor->>'asOf' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      OR NOT workhub_private.p6_id(p_cursor->'afterId') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    BEGIN
      cutoff:=(p_cursor->>'asOf')::timestamptz; mon:=((p_cursor->>'month')||'-01')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_INPUT'; END;
    IF cutoff>checked OR workhub_private.p2_ts(cutoff)<>p_cursor->>'asOf'
      OR to_char(cutoff AT TIME ZONE ctx.school_timezone,'YYYY-MM')<>p_cursor->>'month' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    anchor_id:=p_cursor->>'afterId';
    SELECT created_at INTO anchor FROM workhub.ai_gateway_requests
      WHERE school_id=ctx.school_id AND budget_month=mon AND id=anchor_id AND created_at<=cutoff;
    IF anchor IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  -- 같은 SQL 스냅샷에서 집계와 목록을 만든다. 페이지 집합은 고정하고 상태·비용은 현재 값으로 읽는다.
  WITH school_rows AS MATERIALIZED (
    SELECT g.id,g.school_id,g.request_key,g.feature,g.quality,g.state,g.budget_month,g.created_at,g.updated_at,g.assistant_policy_version,
      g.actual_micro_usd,g.input_tokens,g.output_tokens,(g.observed_usage IS NOT NULL) AS observed_overage,g.receipt->>'code' AS error_code,
      CASE WHEN g.actual_micro_usd IS NULL AND g.state NOT IN('closed','failed') THEN g.reserved_micro_usd ELSE 0 END AS effective_reserved
    FROM workhub.ai_gateway_requests g WHERE school_id=ctx.school_id
  ), month_rows AS MATERIALIZED (
    SELECT * FROM school_rows WHERE budget_month=mon AND created_at<=cutoff
  ), groups AS (
    SELECT f.feature,q.quality,count(r.id) AS requests,coalesce(sum(r.actual_micro_usd),0) AS settled,
      coalesce(sum(r.effective_reserved),0) AS reserved,workhub_private.p10_operations_counts(array_agg(r.state)) AS states,f.ord AS fo,q.ord AS qo
    FROM (VALUES('assistant',1),('evaluation',2)) AS f(feature,ord)
    CROSS JOIN (VALUES('quick',1),('review',2),('legacy',3)) AS q(quality,ord)
    LEFT JOIN month_rows r ON r.feature=f.feature AND r.quality=q.quality GROUP BY f.feature,q.quality,f.ord,q.ord
  ), page_plus AS MATERIALIZED (
    SELECT * FROM month_rows WHERE anchor IS NULL OR (created_at,id)<(anchor,anchor_id)
    ORDER BY created_at DESC,id DESC LIMIT 26
  ), page AS MATERIALIZED (
    SELECT * FROM page_plus ORDER BY created_at DESC,id DESC LIMIT 25
  ), unresolved AS (
    SELECT * FROM school_rows WHERE actual_micro_usd IS NULL AND state IN('prepared','started','unknown','rejected')
  )
  SELECT jsonb_build_object('contract','assistant.operations.v1','schoolId',ctx.school_id,'memberId',p_member_id,
    'checkedAt',workhub_private.p2_ts(checked),'month',to_char(mon,'YYYY-MM'),'timeZone',ctx.school_timezone,'asOf',workhub_private.p2_ts(cutoff),
    'totals',(SELECT jsonb_build_object('requests',count(*),'settledMicroUsd',coalesce(sum(actual_micro_usd),0),
      'reservedMicroUsd',coalesce(sum(effective_reserved),0),'states',workhub_private.p10_operations_counts(array_agg(state))) FROM month_rows),
    'groups',(SELECT jsonb_agg(jsonb_build_object('feature',feature,'quality',quality,'requests',requests,
      'settledMicroUsd',settled,'reservedMicroUsd',reserved,'states',states) ORDER BY fo,qo) FROM groups),
    'unresolved',(SELECT jsonb_build_object('requests',count(*),'reservedMicroUsd',coalesce(sum(effective_reserved),0),
      'previousMonthRequests',count(*) FILTER(WHERE budget_month<mon),'previousMonthReservedMicroUsd',coalesce(sum(effective_reserved) FILTER(WHERE budget_month<mon),0),
      'oldestCreatedAt',workhub_private.p2_ts(min(created_at)),'observedOverageRequests',count(*) FILTER(WHERE observed_overage)) FROM unresolved),
    'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'requestKey',r.request_key,'feature',r.feature,'quality',r.quality,'state',r.state,
      'createdAt',workhub_private.p2_ts(r.created_at),'updatedAt',workhub_private.p2_ts(r.updated_at),'model',p.model,
      'reservedMicroUsd',r.effective_reserved,'settledMicroUsd',r.actual_micro_usd,
      'usage',CASE WHEN r.input_tokens IS NULL THEN NULL ELSE jsonb_build_object('inputTokens',r.input_tokens,'outputTokens',r.output_tokens) END,
      'errorCode',CASE WHEN r.state='unknown' THEN 'PROVIDER_UNKNOWN' WHEN r.error_code=ANY(ARRAY[
        'FORBIDDEN','INACTIVE_MEMBERSHIP','INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','BUDGET_EXCEEDED','NOT_READY',
        'SCHOOL_NOT_LINKED','KEY_MISSING','POLICY_MISSING','DISABLED','OVER_RESERVATION','OUTPUT_INVALID','PROVIDER_REJECTED','TRUNCATED',
        'COUNT_FAILED','INPUT_TOO_LARGE','CANCELLED','PROVIDER_UNKNOWN']) THEN r.error_code ELSE NULL END,
      'observedOverage',r.observed_overage) ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb)
      FROM page r JOIN workhub.assistant_policies p ON p.school_id=r.school_id AND p.version=r.assistant_policy_version),
    'nextCursor',CASE WHEN (SELECT count(*) FROM page_plus)>25 THEN jsonb_build_object('month',to_char(mon,'YYYY-MM'),'asOf',workhub_private.p2_ts(cutoff),
      'afterId',(SELECT id FROM page ORDER BY created_at,id LIMIT 1)) ELSE NULL END) INTO result;
  RETURN jsonb_set(result,'{checkedAt}',to_jsonb(workhub_private.p2_ts(clock_timestamp())));
EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p10_business(SQLERRM) THEN RETURN jsonb_build_object('error',jsonb_build_object('code',SQLERRM)); END IF; RAISE;
END $$;

CREATE INDEX ai_gateway_operations_page ON workhub.ai_gateway_requests(school_id,budget_month,created_at DESC,id DESC);
REVOKE ALL ON FUNCTION workhub_private.p10_operations_counts(text[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_ai_school_operations(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_ai_school_operations(uuid,text,jsonb) TO service_role;
INSERT INTO workhub_private.p10_ai_installs VALUES('P10-AI-09','2026-10-21.2',clock_timestamp());
COMMIT;
