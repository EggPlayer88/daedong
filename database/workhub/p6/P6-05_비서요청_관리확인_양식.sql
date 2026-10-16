-- ============================================================================
-- P6-05  비서 요청 관리 확인 — 결과를 모르는 외부 호출 1건의 청구 여부를 확정한다(요청 1건만).
--
-- ▣ 대상(셋 중 하나):
--   (1) 결과 불명(provider_unknown): 서버가 호출은 했지만 응답을 확인하지 못함 → 사용자에게 "확인 중"으로 보임
--   (2) 청구 미확인(rejected 이면서 사용량 없음): 모델 회사가 거절했지만 사용량이 오지 않음
--   (3) 시작한 지 10분이 넘도록 끝나지 않은 호출(started): 서버가 중간에 멈춘 경우
--   (1)·(3) 은 예약액만큼, (2) 는 예약액만큼 예산에 잡혀 있다. 이 양식으로 실제 청구를 확정하면 그 금액으로 바뀐다.
-- ▣ 먼저 모델 회사 사용량 화면(콘솔)에서 그 시각·요청의 청구를 확인한다. 확인하지 못했으면 실행하지 않는다(그대로 두면 예약액으로 계속 셈).
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 예시값을 넣어 두지 않았다.
--   request_key      : 요청 번호(P6-03-10 · 아래 확인 쿼리로 찾는다)
--   owner_user_id    : 요청한 사람의 회원 id(Auth UID)
--   resolution       : charged(청구됨) · not_charged(청구 없음)
--   input_tokens · output_tokens : charged 면 콘솔에서 확인한 토큰 수(정수, 따옴표 없이). not_charged 면 0
--   provider_message_id : 콘솔에서 확인한 응답 ID. 모르면 빈 문자열 ""
--   evidence_ref     : 확인 근거 1~200자(누가 · 언제 · 어느 화면에서)
--   resolver_user_id : 확인한 학교 관리자(school_admin)의 회원 id(Auth UID). 요청과 같은 학교의 현재 관리자여야 한다
-- ▣ 쓰는 것: 그 요청 1행(상태 · 정산 · 확인 기록) + 감사 1건. 시작 기록(started_at)은 지우지 않는다.
--   (1)·(3) 은 사용자에게 "제공자 거절"(PROVIDER_REJECTED)로 끝난 것으로 보인다(답은 붙이지 않는다). 같은 요청에 두 번 실행할 수 없다.
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "request_key": "<요청 번호>",
  "owner_user_id": "<요청한 사람 회원 id>",
  "resolution": "<charged · not_charged 중 하나>",
  "input_tokens": "<정수>",
  "output_tokens": "<정수>",
  "provider_message_id": "<응답 ID 또는 빈 문자열>",
  "evidence_ref": "<확인 근거>",
  "resolver_user_id": "<확인한 관리자 회원 id>"
}
$json$::jsonb;
  r record; pol record;  -- 설치 전에도 이 양식이 '설치 안 됨'으로 멈추도록 표 행 타입을 쓰지 않는다
  ra workhub.accounts; rm workhub.memberships; v_kind text; v_cost bigint;
  v_in bigint; v_out bigint; v_res jsonb;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P6-05 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regprocedure('workhub_private.p6_installed()') IS NULL THEN
    RAISE EXCEPTION 'P6-05 중단: P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p6_installed() THEN
    RAISE EXCEPTION 'P6-05 중단: P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p2_exact(p, ARRAY['request_key','owner_user_id','resolution','input_tokens','output_tokens','provider_message_id','evidence_ref','resolver_user_id']) THEN
    RAISE EXCEPTION 'P6-05 중단: 칸 이름이 양식과 다릅니다.';
  END IF;
  IF jsonb_typeof(p -> 'resolution') IS DISTINCT FROM 'string' OR p ->> 'resolution' NOT IN ('charged','not_charged') THEN
    RAISE EXCEPTION 'P6-05 중단: resolution 은 charged · not_charged 중 하나입니다.';
  END IF;
  IF NOT workhub_private.p6_int(p -> 'input_tokens', 0) OR NOT workhub_private.p6_int(p -> 'output_tokens', 0)
     OR (p ->> 'input_tokens')::numeric > 2147483647 OR (p ->> 'output_tokens')::numeric > 2147483647 THEN
    RAISE EXCEPTION 'P6-05 중단: 토큰 수는 0 이상의 정수입니다(따옴표 없이).';
  END IF;
  v_in := (p ->> 'input_tokens')::bigint; v_out := (p ->> 'output_tokens')::bigint;
  IF p ->> 'resolution' = 'charged' AND v_in + v_out = 0 THEN RAISE EXCEPTION 'P6-05 중단: charged 면 토큰 수를 적어 주세요.'; END IF;
  IF p ->> 'resolution' = 'not_charged' AND v_in + v_out <> 0 THEN RAISE EXCEPTION 'P6-05 중단: not_charged 면 토큰 수는 0 입니다.'; END IF;
  IF jsonb_typeof(p -> 'provider_message_id') IS DISTINCT FROM 'string'
     OR (p ->> 'provider_message_id' <> '' AND p ->> 'provider_message_id' !~ '^[A-Za-z0-9_-]{1,100}$') THEN
    RAISE EXCEPTION 'P6-05 중단: provider_message_id 는 영문·숫자·_- 1~100자 또는 빈 문자열입니다.';
  END IF;
  IF jsonb_typeof(p -> 'evidence_ref') IS DISTINCT FROM 'string' OR length(btrim(p ->> 'evidence_ref')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'P6-05 중단: evidence_ref 는 1~200자입니다.';
  END IF;
  SELECT * INTO r FROM workhub.assistant_requests WHERE owner_auth_user_id::text = p ->> 'owner_user_id' AND request_key = p ->> 'request_key' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P6-05 중단: 그 사람 · 요청 번호의 요청이 없습니다.'; END IF;
  IF (SELECT count(*) FROM workhub.assistant_requests WHERE owner_auth_user_id::text = p ->> 'owner_user_id' AND request_key = p ->> 'request_key') > 1 THEN
    RAISE EXCEPTION 'P6-05 중단: 같은 사람 · 요청 번호가 여러 학교에 있습니다. 먼저 알려 주세요.';
  END IF;
  v_kind := CASE WHEN r.state = 'provider_unknown' THEN 'provider_unknown'
                 WHEN r.state = 'rejected' AND r.cost_state = 'unknown' THEN 'cost_unknown'
                 WHEN r.state = 'started' AND r.started_at < clock_timestamp() - interval '10 minutes' THEN 'stuck' END;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'P6-05 중단: 관리 확인 대상이 아닙니다(상태 %, 정산 %). 아무것도 쓰지 않았습니다.', r.state, r.cost_state;
  END IF;
  IF p ->> 'provider_message_id' <> '' AND EXISTS (SELECT 1 FROM workhub.assistant_requests o WHERE o.school_id = r.school_id
       AND o.id <> r.id AND (o.provider_message_id = p ->> 'provider_message_id' OR o.resolution ->> 'providerMessageId' = p ->> 'provider_message_id')) THEN
    RAISE EXCEPTION 'P6-05 중단: 그 응답 ID 는 다른 요청에 이미 기록되어 있습니다.';
  END IF;
  SELECT * INTO ra FROM workhub.accounts WHERE auth_user_id::text = p ->> 'resolver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P6-05 중단: 확인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT m2.* INTO rm FROM workhub.memberships m2 JOIN workhub.membership_roles x ON x.membership_id = m2.id AND x.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = ra.id AND m2.school_id = r.school_id AND m2.status = 'active' AND x.role_code = 'school_admin' AND x.revoked_at IS NULL
     AND x.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(x.valid_from, x.valid_to, '[)')
   LIMIT 1;
  IF rm.id IS NULL THEN RAISE EXCEPTION 'P6-05 중단: 확인자가 요청한 학교의 현재 학교 관리자(school_admin)가 아닙니다.'; END IF;
  SELECT * INTO pol FROM workhub.assistant_policies WHERE school_id = r.school_id AND version = r.policy_version;
  v_cost := CASE WHEN p ->> 'resolution' = 'charged' THEN ceil((v_in::numeric * pol.input_price_micro_usd_per_mtok + v_out::numeric * pol.output_price_micro_usd_per_mtok) / 1000000)::bigint ELSE 0 END;
  v_res := jsonb_build_object('kind', v_kind, 'resolution', p ->> 'resolution', 'inputTokens', v_in, 'outputTokens', v_out,
                              'providerMessageId', NULLIF(p ->> 'provider_message_id', ''), 'evidenceRef', btrim(p ->> 'evidence_ref'),
                              'resolverMembershipId', rm.id, 'by', session_user, 'at', workhub_private.p2_ts(clock_timestamp()));
  UPDATE workhub.assistant_requests SET
         state = CASE WHEN v_kind = 'cost_unknown' THEN state ELSE 'resolved' END,
         cost_state = 'resolved', actual_micro_usd = v_cost,
         input_tokens = CASE WHEN input_tokens IS NULL AND p ->> 'resolution' = 'charged' THEN v_in::integer ELSE input_tokens END,
         output_tokens = CASE WHEN output_tokens IS NULL AND p ->> 'resolution' = 'charged' THEN v_out::integer ELSE output_tokens END,
         finish_sha256 = COALESCE(finish_sha256, workhub_private.p2_sha(v_res)),
         reject_code = CASE WHEN v_kind = 'cost_unknown' THEN reject_code ELSE 'PROVIDER_REJECTED' END,
         result = CASE WHEN v_kind = 'cost_unknown' THEN result ELSE jsonb_build_object('state', 'rejected', 'code', 'PROVIDER_REJECTED') END,
         resolution = v_res, updated_at = clock_timestamp()
   WHERE id = r.id;
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      sensitivity, details, scope_key)
  VALUES (r.school_id, ra.id, rm.id, 'assistant.resolve', 'ai_run', r.id, 'operator_only',
      jsonb_build_object('kind', v_kind, 'resolution', p ->> 'resolution', 'costMicroUsd', v_cost, 'evidence_ref', left(btrim(p ->> 'evidence_ref'), 200),
                         'by', session_user), 's:' || r.school_id);
  RAISE NOTICE 'P6-05: 요청 % 을(를) % 로 확정했습니다(% micro USD).', r.request_key, p ->> 'resolution', v_cost;
END $do$;

-- 확인(읽기 전용): 관리 확인이 필요한 요청 목록(본문 없음)
SELECT s.code, r.request_key, r.owner_auth_user_id, r.state, r.cost_state, r.reserved_micro_usd, r.started_at, r.reject_code, r.resolution ->> 'resolution' AS resolved
  FROM workhub.assistant_requests r JOIN workhub.schools s ON s.id = r.school_id
 WHERE r.state IN ('provider_unknown','started') OR r.cost_state IN ('unknown','resolved')
 ORDER BY r.created_at DESC LIMIT 50;
