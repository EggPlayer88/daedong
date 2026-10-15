-- ============================================================================
-- R1S-02  HWPX 기본 확인 — 공개 함수 3개 · 권한 (비활성 설치)
--
-- ▣ 하는 일
--   - public.workhub_collection_basic_readiness(p_member_id)                       → authenticated
--   - public.workhub_file_basic_claim(p_actor_user_id, p_member_id, p_file_id, p_request_key) → service_role 만
--   - public.workhub_file_basic_finish(... , p_lease_token, p_storage_object_id, p_result)    → service_role 만
--   claim/finish 는 서버 확인 API(PR #45 의 api/collections/check-hwpx.py)만 부른다. 그 API 는 사람 JWT 를
--   /auth/v1/user 로 확인한 UID 를 p_actor_user_id 로 넘긴다. DB 는 그 UID 로 기존 승인 gate·소속 확인을
--   그대로 다시 한다(같은 기존 함수 is_approved·get_my_role·member_actor) — R1S_설계결정.md 2절.
-- ▣ 하지 않는 일
--   - 프로필을 켜지 않는다(R1S-04). 이 파일만으로는 어떤 학교도 기본 확인을 쓸 수 없다.
--   - R1 공개 함수 17개의 권한·내용을 바꾸지 않는다. workhub_storage 권한을 건드리지 않는다.
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션. 마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: R1S-01 (판 2026-10-16.1)
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.r1s_installs') IS NULL THEN
    RAISE EXCEPTION 'R1S 중단: R1S-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.r1s_installs WHERE batch = 'R1S-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'R1S 중단: R1S-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.r1s_installs WHERE batch = 'R1S-02') THEN
    RAISE EXCEPTION 'R1S 중단: R1S-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regprocedure('public.workhub_collection_basic_readiness(text)') IS NOT NULL
     OR to_regprocedure('public.workhub_file_basic_claim(uuid,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.workhub_file_basic_finish(uuid,text,text,text,text,uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'R1S 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 서버 확인 API 의 사람 주체 확인
--    호출자: service_role 이고 사람 JWT(sub)가 실리지 않은 요청만(브라우저 토큰을 그대로 넘긴 요청 거부).
--    API 가 확인한 UID 로 이 트랜잭션 안에서만 요청 주체를 바꿔 기존 gate(legacy_gate → is_approved·get_my_role)와
--    소속 확인(member_actor, 잠금 포함)을 그대로 통과해야 한다. 끝나면 원래 값으로 되돌린다.
--    (실패하면 예외가 트랜잭션·하위 트랜잭션을 되돌리면서 설정값도 함께 되돌아간다.)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_basic_member(p_actor uuid, p_member text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '서버 확인 API(service_role, 사람 JWT 없음)만 부를 수 있습니다.';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '확인된 사용자 UID 가 없습니다.'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  IF auth.uid() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청 주체를 확인하지 못했습니다.'; END IF;
  ctx := workhub_private.member_actor(p_member, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청 주체를 되돌리지 못했습니다.'; END IF;
  RETURN ctx;
END $$;

-- 감사·outbox 의 행위자 = 확인 서버 주체(사람이 아니라 서버가 실물을 읽고 판정했다). 요청한 소속은 details 에 남긴다.
CREATE FUNCTION workhub_private.c_basic_svc(p_ctx workhub_private.actor_context, p_principal text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s workhub_private.actor_context;
BEGIN
  s.actor_kind := 'service'; s.service_principal_id := p_principal; s.school_id := p_ctx.school_id; s.scope_key := p_ctx.scope_key;
  s.school_today := p_ctx.school_today; s.school_timezone := p_ctx.school_timezone;
  RETURN s;
END $$;

-- 업로드 목적(배부 양식·단위 초안)의 요청 파일 정책. 단위 초안은 단위의 현재 문항판, 배부 양식은 요청의 현재 문항판.
CREATE FUNCTION workhub_private.c_basic_req_policy(f workhub.file_objects) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.file_policy
    FROM workhub.collection_file_intents i
    LEFT JOIN workhub.collection_units u ON u.school_id = i.school_id AND u.id = i.unit_id
    JOIN workhub.collections c ON c.school_id = i.school_id AND c.id = i.collection_id
    JOIN workhub.collection_schemas s ON s.school_id = i.school_id
         AND s.id = CASE i.purpose WHEN 'draft' THEN u.active_schema_id ELSE c.current_schema_id END
   WHERE i.school_id = f.school_id AND i.file_id = f.id
$$;

-- 이번 확인의 크기 상한 = 지금 쓰기 정책(프로필 기술 한도 포함) · 예약 때 고정한 학교·공통 정책판 · 요청 파일 정책 중 가장 작은 값
CREATE FUNCTION workhub_private.c_basic_max(f workhub.file_objects, p_eff jsonb) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT least((p_eff -> 'file' ->> 'maxFileBytes')::bigint,
    (SELECT (v.value ->> 'maxFileBytes')::bigint FROM workhub.policy_versions v WHERE v.scope_key = f.safety_policy_scope_key AND v.id = f.safety_policy_version_id),
    (SELECT (v.value ->> 'maxFileBytes')::bigint FROM workhub.policy_versions v WHERE v.scope_key = f.common_safety_policy_scope_key AND v.id = f.common_safety_policy_version_id),
    (workhub_private.c_basic_req_policy(f) ->> 'maxFileBytes')::bigint,
    (SELECT p.max_file_bytes FROM workhub.file_basic_checks b JOIN workhub.file_check_profiles p ON p.profile = b.profile WHERE b.file_id = f.id))
$$;

-- 확인 기록·파일을 API 결과 없이 닫는다(실물 없음·바뀜). 감사·outbox 를 같은 트랜잭션에.
CREATE FUNCTION workhub_private.c_basic_close(p_ctx workhub_private.actor_context, f workhub.file_objects, p_principal text, p_reason text)
RETURNS workhub.file_objects
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE svc workhub_private.actor_context := workhub_private.c_basic_svc(p_ctx, p_principal);
BEGIN
  UPDATE workhub.file_objects SET state = 'rejected', reject_reason = p_reason, version = f.version + 1 WHERE id = f.id RETURNING * INTO f;
  UPDATE workhub.file_basic_checks SET outcome = 'rejected', close_reason = p_reason, finished_at = clock_timestamp(), finished_by_service_id = p_principal
   WHERE file_id = f.id;
  PERFORM workhub_private.write_audit(svc, 'file.basic_check', 'file_object', f.id, f.version, 'school', NULL,
    jsonb_build_object('outcome', 'rejected', 'close_reason', p_reason, 'member_id', p_ctx.membership_id));
  PERFORM workhub_private.emit_outbox(svc, 'file.verified', 'file_object', f.id, f.version, jsonb_build_object('file_id', f.id, 'state', f.state));
  RETURN f;
END $$;

-- ----------------------------------------------------------------------------
-- 2. 확인 인수(claim) — 실물 위치·신고값·상한과 1회용 임대 token 을 발급한다
--    반환(data):
--      확정된 파일          → {fileId, state: ready|rejected|pending_verification, file}   (기존 FileUploadStatus 와 같음)
--      다른 확인이 진행 중  → {fileId, state: 'checking', leaseToken: null, leaseExpiresAt}
--      새 임대              → {fileId, state: 'checking', leaseToken, leaseExpiresAt, bucket, path, storageObjectId,
--                               extension, name, claimedBytes, claimedSha256, maxFileBytes}
--    같은 요청 번호는 같은 파일에만 쓸 수 있다(다른 파일 → IDEMPOTENCY_CONFLICT). 재시도는 매번 현재 상태를 다시 본다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_basic_claim(p_ctx workhub_private.actor_context, p_file_id text, p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_key text; v_id text; v_sha text; r workhub.idempotency_receipts; f workhub.file_objects; b workhub.file_basic_checks;
  l workhub.file_basic_leases; eff jsonb; o jsonb; v_principal text; v_token text; v_max bigint; v_size text;
BEGIN
  v_key := workhub_private.c_request_key(p_key);
  v_id := workhub_private.c_id(to_jsonb(p_file_id));
  v_sha := workhub_private.request_sha256(jsonb_build_object('fileId', v_id));
  r := workhub_private.claim_receipt(p_ctx, 'file.basic_claim', v_key, v_sha);
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = v_id FOR UPDATE;
  IF f.id IS NULL OR f.owner_account_id <> p_ctx.account_id OR NOT workhub_private.c_intent_ok(p_ctx, f.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO b FROM workhub.file_basic_checks WHERE file_id = f.id FOR UPDATE;
  -- 기본 확인 경로로 예약하지 않은 파일(검증 작업자 경로·기존 파일)은 이 함수의 대상이 아니다
  IF b.file_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.idem_key IS NULL THEN
    PERFORM workhub_private.store_receipt(p_ctx, 'file.basic_claim', v_key, v_sha, 'file_object', f.id, f.version);
  END IF;
  -- 이미 끝난 파일·정리 원장 파일은 현재 상태만 돌려준다(프로필을 꺼도 결과는 볼 수 있다)
  IF f.state NOT IN ('uploading','uploaded','verifying')
     OR EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id) THEN
    RETURN workhub_private.c_status_dto(f);
  END IF;
  IF f.state = 'uploading' THEN RAISE EXCEPTION 'FILE_NOT_READY'; END IF;
  eff := workhub_private.c_require(p_ctx, 'write');
  IF eff ->> 'basicProfile' IS DISTINCT FROM b.profile THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_principal := eff ->> 'basicPrincipalId';
  SELECT * INTO l FROM workhub.file_basic_leases WHERE file_id = f.id AND state = 'issued' FOR UPDATE;
  IF l.id IS NOT NULL AND l.expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('fileId', f.id, 'state', 'checking', 'leaseToken', NULL, 'leaseExpiresAt', workhub_private.c_iso(l.expires_at));
  END IF;
  IF l.id IS NOT NULL THEN
    UPDATE workhub.file_basic_leases SET state = 'expired', closed_at = clock_timestamp() WHERE id = l.id;
  END IF;
  -- 실물 정체성: 업로드 확인 때 기록한 object id · 업로더 소유가 그대로여야 한다(덮어쓰기·삭제 감지)
  o := workhub_private.c_object_owner(f.bucket, f.storage_key);
  IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id OR o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN
    f := workhub_private.c_basic_close(p_ctx, f, v_principal, CASE WHEN o IS NULL THEN 'object_missing' ELSE 'object_changed' END);
    RETURN workhub_private.c_status_dto(f);
  END IF;
  -- 실물 크기: Storage 가 기록한 객체 크기(metadata.size)가 업로드 신고값과 다르면 실물 자체가 다르다 → 내려받지 않고 거절.
  -- 이것이 "짧게 받은 것"(전송 중단)과 "실물이 짧은 것"(파일 결함)을 가르는 근거다. 크기가 같은데 API 가 짧게 받았다면
  -- 전송 중단이므로 API 는 확정하지 않고(RESULT_UNKNOWN), 임대가 끝난 뒤 다시 확인한다. metadata 에 크기가 없으면 판정하지 않는다.
  SELECT s.metadata ->> 'size' INTO v_size FROM storage.objects s WHERE s.id = f.storage_object_id;
  IF v_size ~ '^[0-9]{1,18}$' AND v_size::bigint <> f.claimed_bytes THEN
    f := workhub_private.c_basic_close(p_ctx, f, v_principal, 'object_size_mismatch');
    RETURN workhub_private.c_status_dto(f);
  END IF;
  -- 반복 호출 상한(실물 내려받기 증폭 방지): 파일당 10분에 6번, 계정당 10분에 60번
  IF (SELECT count(*) FROM workhub.file_basic_leases WHERE file_id = f.id AND issued_at > clock_timestamp() - interval '10 minutes') >= 6
     OR (SELECT count(*) FROM workhub.file_basic_leases WHERE account_id = p_ctx.account_id AND issued_at > clock_timestamp() - interval '10 minutes') >= 60 THEN
    RAISE EXCEPTION 'NOT_READY';
  END IF;
  v_max := workhub_private.c_basic_max(f, eff);
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO workhub.file_basic_leases (school_id, file_id, token_sha256, request_key, account_id, membership_id, service_principal_id,
      activation_id, expires_at)
  VALUES (f.school_id, f.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_key, p_ctx.account_id, p_ctx.membership_id, v_principal,
      eff ->> 'basicActivationId', clock_timestamp() + interval '90 seconds')
  RETURNING * INTO l;
  IF f.state = 'uploaded' THEN
    UPDATE workhub.file_objects SET state = 'verifying', version = f.version + 1 WHERE id = f.id RETURNING * INTO f;
  END IF;
  PERFORM workhub_private.write_audit(workhub_private.c_basic_svc(p_ctx, v_principal), 'file.basic_claim', 'file_object', f.id, f.version,
    'school', v_key, jsonb_build_object('lease_id', l.id, 'member_id', p_ctx.membership_id));
  RETURN jsonb_build_object('fileId', f.id, 'state', 'checking', 'leaseToken', v_token, 'leaseExpiresAt', workhub_private.c_iso(l.expires_at),
    'bucket', f.bucket, 'path', f.storage_key, 'storageObjectId', f.storage_object_id, 'extension', f.extension, 'name', f.original_name,
    'claimedBytes', f.claimed_bytes, 'claimedSha256', f.claimed_sha256, 'maxFileBytes', v_max);
END $$;

-- ----------------------------------------------------------------------------
-- 3. 확인 확정(finish) — 임대·실물·결과 모양을 모두 대조하고 파일을 ready/rejected 로 한 번만 확정한다
--    p_result = {profile, outcome, sizeBytes, sha256, rejectReason, checks: {size, sha256, hwpx}} (API 결과 그대로)
--    같은 인자 재전송 → 같은 상태(멱등). 이미 끝난 파일에 다른 결과 → CONFLICT. 같은 번호·다른 파일 → IDEMPOTENCY_CONFLICT.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_basic_finish(p_ctx workhub_private.actor_context, p_file_id text, p_key text, p_token text,
  p_object uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_key text; v_id text; v_sha text; v_full text; r workhub.idempotency_receipts; f workhub.file_objects; b workhub.file_basic_checks;
  l workhub.file_basic_leases; eff jsonb; o jsonb; v_principal text; v_max bigint; v_outcome text; v_code text; v_checks jsonb;
  v_size bigint; v_hash text; c_size boolean; c_sha boolean; c_hwpx boolean;
BEGIN
  v_key := workhub_private.c_request_key(p_key);
  v_id := workhub_private.c_id(to_jsonb(p_file_id));
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR p_object IS NULL OR p_result IS NULL
     OR jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 2048 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_sha := workhub_private.request_sha256(jsonb_build_object('fileId', v_id));
  v_full := workhub_private.request_sha256(jsonb_build_object('fileId', v_id, 'leaseToken', p_token, 'storageObjectId', p_object, 'result', p_result));
  r := workhub_private.claim_receipt(p_ctx, 'file.basic_finish', v_key, v_sha);
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = v_id FOR UPDATE;
  IF f.id IS NULL OR f.owner_account_id <> p_ctx.account_id OR NOT workhub_private.c_intent_ok(p_ctx, f.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO b FROM workhub.file_basic_checks WHERE file_id = f.id FOR UPDATE;
  IF b.file_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- 응답을 잃은 재전송: 같은 결과면 현재 상태(정리 원장에 오른 뒤라면 rejected)를 그대로 돌려준다
  IF b.outcome IS NOT NULL THEN
    IF b.result_sha256 IS NOT DISTINCT FROM v_full THEN
      IF r.idem_key IS NULL THEN
        PERFORM workhub_private.store_receipt(p_ctx, 'file.basic_finish', v_key, v_sha, 'file_object', f.id, f.version);
      END IF;
      RETURN workhub_private.c_status_dto(f);
    END IF;
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  eff := workhub_private.c_require(p_ctx, 'write');
  IF eff ->> 'basicProfile' IS DISTINCT FROM b.profile THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_principal := eff ->> 'basicPrincipalId';
  SELECT * INTO l FROM workhub.file_basic_leases
   WHERE file_id = f.id AND state = 'issued' AND token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE;
  IF f.state IS DISTINCT FROM 'verifying' OR l.id IS NULL OR l.expires_at <= clock_timestamp()
     OR l.service_principal_id IS DISTINCT FROM v_principal OR l.activation_id IS DISTINCT FROM eff ->> 'basicActivationId'
     OR l.account_id IS DISTINCT FROM p_ctx.account_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  o := workhub_private.c_object_owner(f.bucket, f.storage_key);
  IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id OR p_object IS DISTINCT FROM f.storage_object_id
     OR o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 결과 모양: 정확한 키 · 정해진 값만
  PERFORM workhub_private.c_keys(p_result, ARRAY['profile','outcome','sizeBytes','sha256','rejectReason','checks'], NULL);
  v_checks := p_result -> 'checks';
  PERFORM workhub_private.c_keys(v_checks, ARRAY['size','sha256','hwpx'], NULL);
  IF p_result ->> 'profile' IS DISTINCT FROM b.profile OR jsonb_typeof(p_result -> 'profile') <> 'string'
     OR jsonb_typeof(p_result -> 'outcome') <> 'string' OR p_result ->> 'outcome' NOT IN ('ready','rejected')
     OR NOT (jsonb_typeof(p_result -> 'sizeBytes') = 'null' OR (jsonb_typeof(p_result -> 'sizeBytes') = 'number' AND (p_result ->> 'sizeBytes') ~ '^(0|[1-9][0-9]{0,11})$'))
     OR NOT (jsonb_typeof(p_result -> 'sha256') = 'null' OR (jsonb_typeof(p_result -> 'sha256') = 'string' AND (p_result ->> 'sha256') ~ '^[0-9a-f]{64}$'))
     OR NOT (jsonb_typeof(p_result -> 'rejectReason') = 'null' OR (jsonb_typeof(p_result -> 'rejectReason') = 'string'
             AND (p_result ->> 'rejectReason') IN ('FILE_SIZE_LIMIT','FILE_SIZE_MISMATCH','FILE_HASH_MISMATCH','FILE_SIGNATURE_MISMATCH',
               'FILE_STRUCTURE_LIMIT','FILE_STRUCTURE_INVALID','FILE_ENCRYPTED','FILE_STRUCTURE_UNSUPPORTED','FILE_HWPX_REQUIRED_PART')))
     OR jsonb_typeof(v_checks -> 'size') <> 'boolean' OR jsonb_typeof(v_checks -> 'sha256') <> 'boolean' OR jsonb_typeof(v_checks -> 'hwpx') <> 'boolean' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_outcome := p_result ->> 'outcome'; v_code := p_result ->> 'rejectReason';
  v_size := (p_result ->> 'sizeBytes')::bigint; v_hash := p_result ->> 'sha256';
  c_size := (v_checks ->> 'size')::boolean; c_sha := (v_checks ->> 'sha256')::boolean; c_hwpx := (v_checks ->> 'hwpx')::boolean;
  -- 결과의 앞뒤가 맞아야 한다(API 의 확인 순서: 크기 상한 → 내려받기 → 크기 → 해시 → HWPX 구조)
  IF (v_outcome = 'ready') = (v_code IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_code = 'FILE_SIZE_LIMIT' THEN
    IF v_size IS NOT NULL OR v_hash IS NOT NULL OR c_size OR c_sha OR c_hwpx THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSE
    IF v_size IS NULL OR v_hash IS NULL OR c_size IS DISTINCT FROM (v_size = f.claimed_bytes) OR c_sha IS DISTINCT FROM (v_hash = f.claimed_sha256)
       OR (v_code = 'FILE_SIZE_MISMATCH' AND (c_size OR c_hwpx))
       OR (v_code = 'FILE_HASH_MISMATCH' AND (NOT c_size OR c_sha OR c_hwpx))
       OR (COALESCE(v_code, '') NOT IN ('FILE_SIZE_MISMATCH','FILE_HASH_MISMATCH') AND (NOT c_size OR NOT c_sha OR c_hwpx IS DISTINCT FROM (v_outcome = 'ready'))) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END IF;
  IF v_outcome = 'ready' THEN
    -- 확인하는 동안 정책이 줄었으면 확정하지 않는다(임대가 끝난 뒤 다시 인수하면 새 상한으로 확인)
    v_max := workhub_private.c_basic_max(f, eff);
    IF v_size > v_max OR NOT ((eff -> 'file' -> 'extensions') ? f.extension) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    UPDATE workhub.file_objects SET state = 'ready', size_bytes = v_size, sha256 = v_hash, detected_mime = 'application/hwp+zip', expanded_bytes = NULL,
           verification = jsonb_build_object('profile', b.profile, 'checks', v_checks, 'malwareScan', false, 'contentValidation', false),
           scan_state = 'not_scanned', reject_reason = NULL, verified_at = clock_timestamp(), verified_by_service_id = v_principal, version = f.version + 1
     WHERE id = f.id RETURNING * INTO f;
  ELSE
    UPDATE workhub.file_objects SET state = 'rejected', size_bytes = v_size, sha256 = v_hash,
           verification = jsonb_build_object('profile', b.profile, 'checks', v_checks, 'malwareScan', false, 'contentValidation', false),
           scan_state = 'not_scanned', reject_reason = lower(v_code), verified_at = clock_timestamp(), verified_by_service_id = v_principal,
           version = f.version + 1
     WHERE id = f.id RETURNING * INTO f;
  END IF;
  UPDATE workhub.file_basic_checks SET outcome = v_outcome, reject_code = v_code, result = p_result, result_sha256 = v_full,
         finished_at = clock_timestamp(), finished_by_service_id = v_principal, finished_lease_id = l.id
   WHERE file_id = f.id;
  UPDATE workhub.file_basic_leases SET state = 'finished', closed_at = clock_timestamp() WHERE id = l.id;
  IF r.idem_key IS NULL THEN
    PERFORM workhub_private.store_receipt(p_ctx, 'file.basic_finish', v_key, v_sha, 'file_object', f.id, f.version);
  END IF;
  PERFORM workhub_private.write_audit(workhub_private.c_basic_svc(p_ctx, v_principal), 'file.basic_check', 'file_object', f.id, f.version, 'school', v_key,
    jsonb_build_object('outcome', v_outcome, 'reject_code', v_code, 'lease_id', l.id, 'member_id', p_ctx.membership_id));
  PERFORM workhub_private.emit_outbox(workhub_private.c_basic_svc(p_ctx, v_principal), 'file.verified', 'file_object', f.id, f.version,
    jsonb_build_object('file_id', f.id, 'state', f.state));
  RETURN workhub_private.c_status_dto(f);
END $$;

-- ----------------------------------------------------------------------------
-- 4. 공개 함수 3개. 소속 gate 실패는 R1 과 같이 예외(봉투 없음), 그 뒤 업무 오류는 봉투로(하위 트랜잭션 → 변경 전부 되돌림).
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_collection_basic_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.c_ok(ctx, workhub_private.c_basic_readiness(ctx.school_id, ctx.school_today));
END $$;

CREATE FUNCTION public.workhub_file_basic_claim(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.c_basic_member(p_actor_user_id, p_member_id);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_basic_claim(ctx, p_file_id, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_file_basic_finish(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text,
  p_lease_token text, p_storage_object_id uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.c_basic_member(p_actor_user_id, p_member_id);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_basic_finish(ctx, p_file_id, p_request_key, p_lease_token, p_storage_object_id, p_result));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

COMMENT ON FUNCTION public.workhub_collection_basic_readiness(text) IS '업무실 R1S: HWPX 기본 확인 프로필 기준 쓰기 준비 상태. 고정값 아님.';
COMMENT ON FUNCTION public.workhub_file_basic_claim(uuid, text, text, text) IS '업무실 R1S 서버 확인 API 전용(service_role): 기본 확인 임대 발급.';
COMMENT ON FUNCTION public.workhub_file_basic_finish(uuid, text, text, text, text, uuid, jsonb) IS '업무실 R1S 서버 확인 API 전용(service_role): 기본 확인 결과 확정.';

-- ----------------------------------------------------------------------------
-- 5. 권한 — 준비 상태는 authenticated, 확인 2개는 service_role 만. 내부 함수는 API 역할에 0.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.workhub_collection_basic_readiness(text), public.workhub_file_basic_claim(uuid, text, text, text),
  public.workhub_file_basic_finish(uuid, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_collection_basic_readiness(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_file_basic_claim(uuid, text, text, text),
  public.workhub_file_basic_finish(uuid, text, text, text, text, uuid, jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO workhub_private.r1s_installs (batch, release) VALUES ('R1S-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 6. 검증 — 모든 행의 status 가 ok 여야 한다. R1S-02-4 는 "준비 안 됨(verification_missing)"이 정상이다(R1S-04 전).
-- ----------------------------------------------------------------------------
SELECT 'R1S-02-1' AS no, '공개 함수 3개 존재(SECURITY DEFINER, search_path 고정)' AS item,
       CASE WHEN count(*) = 3 THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM pg_proc p WHERE p.oid IN ('public.workhub_collection_basic_readiness(text)'::regprocedure,
  'public.workhub_file_basic_claim(uuid,text,text,text)'::regprocedure, 'public.workhub_file_basic_finish(uuid,text,text,text,text,uuid,jsonb)'::regprocedure)
  AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
UNION ALL
SELECT 'R1S-02-2', '준비 상태 = authenticated 만, 확인 2개 = service_role 만, anon 0',
       CASE WHEN has_function_privilege('authenticated', 'public.workhub_collection_basic_readiness(text)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.workhub_collection_basic_readiness(text)', 'EXECUTE')
             AND NOT has_function_privilege('service_role', 'public.workhub_collection_basic_readiness(text)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.workhub_file_basic_claim(uuid,text,text,text)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.workhub_file_basic_finish(uuid,text,text,text,text,uuid,jsonb)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.workhub_file_basic_claim(uuid,text,text,text)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.workhub_file_basic_finish(uuid,text,text,text,text,uuid,jsonb)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.workhub_file_basic_claim(uuid,text,text,text)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.workhub_file_basic_finish(uuid,text,text,text,text,uuid,jsonb)', 'EXECUTE')
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'R1S-02-3', '내부 함수(workhub·workhub_private)는 API 역할 실행 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'R1S-02-4', '활성 학교의 기본 확인 준비 상태 = 준비 안 됨(활성화 전이 정상)',
       CASE WHEN bool_and(NOT (workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'available')::boolean) THEN 'ok' ELSE 'FAIL' END,
       string_agg(workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason', ',')
FROM workhub.schools s WHERE s.status = 'active'
ORDER BY 1;
