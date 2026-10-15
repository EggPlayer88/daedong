-- ============================================================================
-- R1-01  정책판 · 파일 실물 · 검증 작업 · 접근 기록 · 정리 원장
--
-- 파일형 문서 수합(R1)의 바탕. 수합 원본(R1-02)과 공개 함수(R1-03)보다 먼저 만든다.
-- 요청서: docs/workhub/32-collection-server-sql-request.md (PR #34)
-- 설계 근거: R1_설계결정.md · R1_제약처분표.md
--
-- ▣ 지키는 것
--   - 기존 public·auth 표·함수·정책, R0 표의 자료를 바꾸지 않는다.
--   - R0 에서 한 곳만 바꾼다: service_principals 의 작업 목록 CHECK(service_principals_action_registry).
--     R0 가 "새 작업 종류는 그 작업을 여는 배치가 교체한다" 고 남긴 확장 지점이다.
--     서비스 주체 행은 만들지 않는다(검증 작업자 연결은 R1-05, 별도 승인).
--   - 정책값은 넣지 않는다. 표와 검사만 만든다(정책 게시는 R1-06, 별도 승인).
--
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
--   마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: R0-01·R0-02·R0-03 (적용됨). R0 를 다시 실행하지 않는다.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 0. 선행 확인 — 하나라도 어긋나면 아무것도 만들지 않고 멈춘다
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('workhub.audit_events') IS NULL OR to_regclass('workhub.tasks') IS NULL
     OR to_regprocedure('workhub_private.member_actor(text,boolean)') IS NULL
     OR to_regprocedure('workhub_private.claim_receipt(workhub_private.actor_context,text,text,text)') IS NULL
     OR to_regprocedure('public.workhub_task_mutate(text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'R1 중단: R0(R0-01·R0-02)가 적용되어 있지 않습니다. R0 를 먼저 확인해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub.schools WHERE status = 'active') THEN
    RAISE EXCEPTION 'R1 중단: 활성 학교가 없습니다. R0-03 초기 설정을 먼저 확인해 주세요.';
  END IF;
  IF to_regclass('workhub_private.batch_installs') IS NOT NULL OR to_regclass('workhub.file_objects') IS NOT NULL
     OR to_regclass('workhub.policy_versions') IS NOT NULL THEN
    RAISE EXCEPTION 'R1 중단: R1 표가 이미 있습니다. 이미 실행했는지 R1-00 으로 확인해 주세요.';
  END IF;
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'R1 중단: Supabase Storage 표(storage.objects·buckets)를 찾지 못했습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-collection-files' OR name = 'workhub-collection-files') THEN
    RAISE EXCEPTION 'R1 중단: workhub-collection-files 버킷이 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  -- R0 작업 목록 CHECK 가 R0 원문 그대로여야 교체한다(다른 배치가 이미 바꿨으면 덮어쓰지 않는다)
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'workhub.service_principals'::regclass AND conname = 'service_principals_action_registry')
     IS DISTINCT FROM 'CHECK ((allowed_actions <@ ARRAY[''school.bootstrap''::text]))' THEN
    RAISE EXCEPTION 'R1 중단: service_principals 작업 목록 CHECK 가 R0 원문과 다릅니다. 다른 배치가 바꿨는지 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 배치 적용 기록·중지 스위치
-- ----------------------------------------------------------------------------
-- 어떤 R1 파일이 어떤 판으로 적용됐는지. 다른 판이 이미 있으면 각 파일이 시작 전에 멈춘다.
CREATE TABLE workhub_private.batch_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT batch_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT batch_installs_batch_check CHECK (batch ~ '^R[0-9]+-[0-9]{2}$'),
  CONSTRAINT batch_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER batch_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.batch_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 비파괴 중지 스위치(한 행). open = 정상, writes_stopped = 쓰기·업로드 중지(읽기·내려받기 유지),
-- all_stopped = 내려받기까지 중지. 자료는 지우지 않는다. 바꾸는 방법은 R1_실행안내.md 의 '중지·재개'.
CREATE TABLE workhub_private.r1_switch (
  singleton  boolean NOT NULL DEFAULT true,
  state      text NOT NULL DEFAULT 'open',
  reason     text NOT NULL DEFAULT 'R1 설치',
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT r1_switch_pkey PRIMARY KEY (singleton),
  CONSTRAINT r1_switch_singleton_check CHECK (singleton),
  CONSTRAINT r1_switch_state_check CHECK (state IN ('open','writes_stopped','all_stopped')),
  CONSTRAINT r1_switch_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 200)
);
INSERT INTO workhub_private.r1_switch DEFAULT VALUES;
CREATE TRIGGER r1_switch_no_delete BEFORE DELETE ON workhub_private.r1_switch
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 중지 스위치의 변경 기록(누가·언제·왜). 스위치는 SQL Editor 에서만 바꾼다.
CREATE TABLE workhub_private.r1_switch_log (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  old_state  text NOT NULL,
  new_state  text NOT NULL,
  reason     text NOT NULL,
  changed_at timestamptz NOT NULL,
  changed_by name NOT NULL,
  CONSTRAINT r1_switch_log_pkey PRIMARY KEY (id)
);
CREATE TRIGGER r1_switch_log_immutable BEFORE UPDATE OR DELETE ON workhub_private.r1_switch_log
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE FUNCTION workhub_private.r1_switch_logged() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.changed_at := clock_timestamp();
  NEW.changed_by := session_user;
  INSERT INTO workhub_private.r1_switch_log (old_state, new_state, reason, changed_at, changed_by)
  VALUES (OLD.state, NEW.state, NEW.reason, NEW.changed_at, NEW.changed_by);
  RETURN NEW;
END $$;
CREATE TRIGGER r1_switch_logged BEFORE UPDATE ON workhub_private.r1_switch
  FOR EACH ROW EXECUTE FUNCTION workhub_private.r1_switch_logged();

-- ----------------------------------------------------------------------------
-- 2. 서비스 주체 — 작업 목록에 파일 검증·정리를 더한다(R0 확장 지점). 주체 행은 만들지 않는다.
-- ----------------------------------------------------------------------------
ALTER TABLE workhub.service_principals DROP CONSTRAINT service_principals_action_registry;
ALTER TABLE workhub.service_principals ADD CONSTRAINT service_principals_action_registry
  CHECK (allowed_actions <@ ARRAY['school.bootstrap','file.verify','file.cleanup']::text[]);

-- PostgREST(authenticator → service_role) 경로로 부르는 작업자의 주체 연결.
-- R0 의 db_identity_principals 는 API 역할을 금지하므로(브라우저 경로 차단) 별도 표로 둔다.
-- 여기에 행이 있어야만 service_role 호출이 서비스 주체로 해석된다. 행은 R1-05(별도 승인)에서 넣는다.
CREATE TABLE workhub_private.api_role_principals (
  api_role             name NOT NULL,
  service_principal_id text NOT NULL,
  approval_ref         text NOT NULL,
  approved_by_account_id text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at           timestamptz,
  CONSTRAINT api_role_principals_pkey PRIMARY KEY (api_role, service_principal_id),
  CONSTRAINT api_role_principals_role_check CHECK (api_role = 'service_role'),
  CONSTRAINT api_role_principals_principal_fkey FOREIGN KEY (service_principal_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT api_role_principals_approved_by_fkey FOREIGN KEY (approved_by_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT api_role_principals_approval_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
-- service_role 하나가 두 주체로 해석되면 감사 주체가 모호해진다 → 활성 연결은 하나
CREATE UNIQUE INDEX api_role_principals_one_active ON workhub_private.api_role_principals (api_role) WHERE revoked_at IS NULL;
CREATE TRIGGER api_role_principals_identity BEFORE UPDATE ON workhub_private.api_role_principals
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('api_role','service_principal_id','approval_ref','approved_by_account_id','created_at');

-- ----------------------------------------------------------------------------
-- 3. 정책 목록·정책판
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.policy_catalog (
  policy_key              text NOT NULL,
  label                   text NOT NULL,
  description             text NOT NULL,
  default_value           jsonb NOT NULL,
  default_approval_ref    text,
  default_approved_at     timestamptz,
  allowed_values          jsonb,
  basis                   text NOT NULL,
  value_schema            jsonb,
  allowed_override_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  CONSTRAINT policy_catalog_pkey PRIMARY KEY (policy_key),
  CONSTRAINT policy_catalog_policy_key_check CHECK (policy_key ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT policy_catalog_check CHECK ((default_approval_ref IS NULL) = (default_approved_at IS NULL)),
  CONSTRAINT policy_catalog_override_check CHECK (allowed_override_scopes <@ ARRAY['school']::text[])
);
-- 추천 기본값을 두지 않는다(default_value = null, 승인 없음). 운영값은 승인 후 정책판으로만.
INSERT INTO workhub.policy_catalog (policy_key, label, description, default_value, basis, value_schema, allowed_override_scopes) VALUES
  ('file.safety', '파일 공통 안전 하한', '모든 학교에 공통인 허용 형식·크기·개수 상한과 미검사 파일 사용 허용 여부',
   'null', '운영자 승인', '{"keys":["extensions","maxFileBytes","maxFiles","allowUnscanned"]}', ARRAY[]::text[]),
  ('collection.file_upload', '수합 파일 업로드 정책', '학교의 수합 파일 허용 형식·크기·개수, 미검사 허용, 업로드 예약 유효 시간',
   'null', '학교 승인', '{"keys":["extensions","maxFileBytes","maxFiles","allowUnscanned","uploadTtlMinutes"]}', ARRAY['school']),
  ('collection.submission', '수합 제출 정책', '직접 철회 허용, 정정 기간 허용·최대 일수, 연결되지 않은 파일 보관 일수',
   'null', '학교 승인', '{"keys":["allowWithdrawal","allowCorrectionWindow","maxCorrectionDays","unattachedRetentionDays"]}', ARRAY['school']);
CREATE TRIGGER policy_catalog_immutable BEFORE UPDATE OR DELETE ON workhub.policy_catalog
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 정책값 모양 검사(정확한 키·타입·범위). CHECK 에서 부른다.
CREATE FUNCTION workhub_private.policy_value_valid(p_key text, v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE keys text[];
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN RETURN false; END IF;
  keys := CASE p_key
    WHEN 'file.safety' THEN ARRAY['allowUnscanned','extensions','maxFileBytes','maxFiles']
    WHEN 'collection.file_upload' THEN ARRAY['allowUnscanned','extensions','maxFileBytes','maxFiles','uploadTtlMinutes']
    WHEN 'collection.submission' THEN ARRAY['allowCorrectionWindow','allowWithdrawal','maxCorrectionDays','unattachedRetentionDays'] END;
  IF keys IS NULL OR ARRAY(SELECT k FROM jsonb_object_keys(v) k ORDER BY k) <> keys THEN RETURN false; END IF;
  IF p_key IN ('file.safety','collection.file_upload') THEN
    -- 앱 FilePolicy 와 같은 범위: 형식 6종 안에서 중복 없이 1개 이상, 1 B~100 MiB, 1~512개
    IF jsonb_typeof(v -> 'extensions') <> 'array' OR jsonb_array_length(v -> 'extensions') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'extensions') e
                  WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' NOT IN ('pdf','hwp','hwpx','docx','xlsx','pptx'))
       OR (SELECT count(DISTINCT e) FROM jsonb_array_elements_text(v -> 'extensions') e) <> jsonb_array_length(v -> 'extensions')
       OR jsonb_typeof(v -> 'maxFileBytes') <> 'number' OR (v ->> 'maxFileBytes') !~ '^[1-9][0-9]{0,8}$'
       OR (v ->> 'maxFileBytes')::bigint > 104857600
       OR jsonb_typeof(v -> 'maxFiles') <> 'number' OR (v ->> 'maxFiles') !~ '^[1-9][0-9]{0,2}$' OR (v ->> 'maxFiles')::int > 512
       OR jsonb_typeof(v -> 'allowUnscanned') <> 'boolean' THEN
      RETURN false;
    END IF;
    IF p_key = 'collection.file_upload' AND (jsonb_typeof(v -> 'uploadTtlMinutes') <> 'number'
       OR (v ->> 'uploadTtlMinutes') !~ '^[1-9][0-9]{0,3}$' OR (v ->> 'uploadTtlMinutes')::int NOT BETWEEN 5 AND 1440) THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;
  RETURN jsonb_typeof(v -> 'allowWithdrawal') = 'boolean' AND jsonb_typeof(v -> 'allowCorrectionWindow') = 'boolean'
     AND jsonb_typeof(v -> 'maxCorrectionDays') = 'number' AND (v ->> 'maxCorrectionDays') ~ '^[1-9][0-9]{0,2}$'
     AND (v ->> 'maxCorrectionDays')::int <= 365
     AND jsonb_typeof(v -> 'unattachedRetentionDays') = 'number' AND (v ->> 'unattachedRetentionDays') ~ '^[1-9][0-9]{0,2}$'
     AND (v ->> 'unattachedRetentionDays')::int <= 365;
END $$;

CREATE TABLE workhub.policy_versions (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  scope                     text NOT NULL,
  school_id                 text,
  scope_key                 text NOT NULL GENERATED ALWAYS AS (CASE scope WHEN 'school' THEN 's:' || school_id ELSE 'c' END) STORED,
  policy_key                text NOT NULL,
  policy_version            integer NOT NULL,
  applies_to_scopes         text[] NOT NULL,
  value                     jsonb NOT NULL,
  state                     text NOT NULL DEFAULT 'draft',
  effective_from            date NOT NULL,
  effective_to              date,
  approved_by_account_id    text,
  approved_by_membership_id text,
  approved_at               timestamptz,
  approval_ref              text,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT policy_versions_pkey PRIMARY KEY (id),
  CONSTRAINT policy_versions_scope_key_id_key UNIQUE (scope_key, id),
  CONSTRAINT policy_versions_key_version_key UNIQUE (scope_key, policy_key, policy_version),
  CONSTRAINT policy_versions_policy_key_fkey FOREIGN KEY (policy_key) REFERENCES workhub.policy_catalog(policy_key),
  CONSTRAINT policy_versions_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT policy_versions_approved_by_account_fkey FOREIGN KEY (approved_by_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT policy_versions_approved_member_fkey FOREIGN KEY (school_id, approved_by_membership_id, approved_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT policy_versions_scope_check CHECK (scope IN ('common','school') AND ((scope = 'school') = (school_id IS NOT NULL))),
  CONSTRAINT policy_versions_applies_check CHECK (cardinality(applies_to_scopes) > 0
    AND applies_to_scopes <@ ARRAY['school','account_private','common','service']::text[]
    AND (scope <> 'school' OR applies_to_scopes = ARRAY['school']::text[])),
  -- 정책 종류마다 정해진 범위에서만 게시한다(공통 하한은 공통, 수합 정책은 학교)
  CONSTRAINT policy_versions_key_scope_check CHECK (CASE policy_key WHEN 'file.safety' THEN scope = 'common' ELSE scope = 'school' END),
  CONSTRAINT policy_versions_state_check CHECK (state IN ('draft','published','retired') AND policy_version > 0),
  CONSTRAINT policy_versions_period_check CHECK (effective_to IS NULL OR effective_from < effective_to),
  CONSTRAINT policy_versions_approval_check CHECK (state = 'draft' OR (approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL
    AND approval_ref IS NOT NULL AND length(btrim(approval_ref)) BETWEEN 1 AND 200
    AND (scope = 'common' OR approved_by_membership_id IS NOT NULL))),
  CONSTRAINT policy_versions_common_member_check CHECK (scope = 'school' OR approved_by_membership_id IS NULL),
  CONSTRAINT policy_versions_value_check CHECK (workhub_private.policy_value_valid(policy_key, value)),
  CONSTRAINT policy_versions_no_overlap EXCLUDE USING gist (scope_key WITH =, policy_key WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&) WHERE (state IN ('published','retired'))
);
CREATE INDEX policy_versions_lookup ON workhub.policy_versions (scope_key, policy_key, effective_from, effective_to)
  WHERE state IN ('published','retired');

-- 게시된 판은 내용·범위·시작일·승인 사실이 바뀌지 않는다. 허용되는 변경은 published → retired 와 종료일 지정뿐.
CREATE FUNCTION workhub_private.policy_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '게시된 정책판은 지울 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'draft' AND (
       -- scope_key 는 생성 열이라 BEFORE 트리거의 NEW 에서 NULL 이다 → 비교에서 뺀다(원천 열 scope·school_id 는 비교됨).
       (to_jsonb(NEW) - ARRAY['state','effective_to','scope_key']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','effective_to','scope_key'])
       OR NOT (NEW.state = OLD.state OR (OLD.state = 'published' AND NEW.state = 'retired'))
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '게시된 정책판은 은퇴(retired)와 종료일 지정만 할 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER policy_versions_guard BEFORE UPDATE OR DELETE ON workhub.policy_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.policy_versions_guard();

-- ----------------------------------------------------------------------------
-- 4. 파일 실물 — 업로드 예약(uploading)부터 검증 완료(ready)까지 한 행
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.file_objects (
  id                              text NOT NULL DEFAULT gen_random_uuid()::text,
  scope                           text NOT NULL DEFAULT 'school',
  school_id                       text NOT NULL,
  scope_key                       text NOT NULL GENERATED ALWAYS AS ('s:' || school_id) STORED,
  owner_account_id                text NOT NULL,
  owner_membership_id             text NOT NULL,
  bucket                          text NOT NULL DEFAULT 'workhub-collection-files',
  storage_key                     text NOT NULL,
  original_name                   text NOT NULL,
  extension                       text NOT NULL,
  claimed_bytes                   bigint NOT NULL,
  claimed_sha256                  text NOT NULL,
  declared_mime                   text,
  detected_mime                   text,
  size_bytes                      bigint,
  expanded_bytes                  bigint,
  sha256                          text,
  verification                    jsonb,
  scan_state                      text NOT NULL DEFAULT 'pending',
  state                           text NOT NULL DEFAULT 'uploading',
  reject_reason                   text,
  upload_expires_at               timestamptz NOT NULL,
  storage_object_id               uuid,
  uploaded_at                     timestamptz,
  verified_at                     timestamptz,
  verified_by_service_id          text,
  safety_policy_scope_key         text NOT NULL,
  safety_policy_version_id        text NOT NULL,
  common_safety_policy_scope_key  text NOT NULL DEFAULT 'c',
  common_safety_policy_version_id text NOT NULL,
  sensitivity                     text NOT NULL DEFAULT 'school_work',
  first_linked_at                 timestamptz,
  deleted_at                      timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at                      timestamptz NOT NULL DEFAULT clock_timestamp(),
  version                         integer NOT NULL DEFAULT 1,
  CONSTRAINT file_objects_pkey PRIMARY KEY (id),
  CONSTRAINT file_objects_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT file_objects_scope_key_id_key UNIQUE (scope_key, id),
  CONSTRAINT file_objects_storage_key_key UNIQUE (bucket, storage_key),
  CONSTRAINT file_objects_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT file_objects_owner_account_fkey FOREIGN KEY (owner_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT file_objects_owner_member_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT file_objects_verified_by_fkey FOREIGN KEY (verified_by_service_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT file_objects_safety_policy_fkey FOREIGN KEY (safety_policy_scope_key, safety_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT file_objects_common_policy_fkey FOREIGN KEY (common_safety_policy_scope_key, common_safety_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  -- R1 은 학교 업무 자료만 받는다. 개인·공통 파일, 학생·민감 자료는 해당 배치에서 연다.
  CONSTRAINT file_objects_scope_pending CHECK (scope = 'school'),
  CONSTRAINT file_objects_sensitivity_pending CHECK (sensitivity = 'school_work'),
  CONSTRAINT file_objects_safety_scope_check CHECK (safety_policy_scope_key = 's:' || school_id AND common_safety_policy_scope_key = 'c'),
  CONSTRAINT file_objects_bucket_check CHECK (bucket = 'workhub-collection-files'),
  -- 경로 = <학교ID>/<파일ID>/<서버가 만든 불투명 키>. 원래 이름·확장자를 경로에 쓰지 않는다.
  CONSTRAINT file_objects_storage_key_check CHECK (cardinality(string_to_array(storage_key, '/')) = 3
    AND split_part(storage_key, '/', 1) = school_id AND split_part(storage_key, '/', 2) = id
    AND split_part(storage_key, '/', 3) ~ '^[A-Za-z0-9_-]{16,100}$'),
  CONSTRAINT file_objects_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT file_objects_name_check CHECK (length(original_name) BETWEEN 1 AND 255 AND octet_length(original_name) <= 240),
  CONSTRAINT file_objects_extension_check CHECK (extension IN ('pdf','hwp','hwpx','docx','xlsx','pptx')),
  CONSTRAINT file_objects_claimed_check CHECK (claimed_bytes BETWEEN 1 AND 104857600 AND claimed_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT file_objects_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT file_objects_size_check CHECK (size_bytes >= 0 AND expanded_bytes >= 0),
  CONSTRAINT file_objects_scan_state_check CHECK (scan_state IN ('pending','clean','rejected','error','not_scanned')),
  CONSTRAINT file_objects_state_check CHECK (state IN ('uploading','uploaded','verifying','ready','rejected','quarantined','deleted')),
  -- 업로드 확인 뒤 단계는 Storage 실물의 정체성(object id)을 가진다
  CONSTRAINT file_objects_uploaded_check CHECK (state NOT IN ('uploaded','verifying','ready','quarantined')
    OR (storage_object_id IS NOT NULL AND uploaded_at IS NOT NULL)),
  -- ready 는 작업자가 실물을 읽어 신고값과 같음을 확인한 증거가 있어야 한다
  CONSTRAINT file_objects_ready_check CHECK (state <> 'ready' OR (sha256 IS NOT NULL AND size_bytes IS NOT NULL
    AND detected_mime IS NOT NULL AND verified_at IS NOT NULL AND verification IS NOT NULL AND verified_by_service_id IS NOT NULL
    AND scan_state IN ('clean','not_scanned') AND sha256 = claimed_sha256 AND size_bytes = claimed_bytes)),
  CONSTRAINT file_objects_reject_check CHECK (state NOT IN ('rejected','quarantined') OR reject_reason IS NOT NULL),
  CONSTRAINT file_objects_reject_reason_check CHECK (reject_reason ~ '^[a-z_]{2,40}$'),
  CONSTRAINT file_objects_deleted_check CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT file_objects_verification_check CHECK (verification IS NULL OR (jsonb_typeof(verification) = 'object' AND octet_length(verification::text) <= 4096)),
  CONSTRAINT file_objects_version_check CHECK (version > 0)
);
CREATE INDEX file_objects_owner ON workhub.file_objects (owner_account_id, created_at DESC);
CREATE INDEX file_objects_cleanup ON workhub.file_objects (upload_expires_at) WHERE first_linked_at IS NULL AND state <> 'deleted';
CREATE INDEX file_objects_school_state ON workhub.file_objects (school_id, sensitivity, state, id);
CREATE INDEX file_objects_safety_policy ON workhub.file_objects (safety_policy_scope_key, safety_policy_version_id);

-- 정체성·신고값·정책판은 처음 값 그대로. 실물 정체성은 한 번만 기록. 검증 결과는 ready 이후 불변.
-- 상태는 정해진 방향으로만 움직인다(되돌림·교체 없음).
CREATE FUNCTION workhub_private.file_objects_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE frozen text[] := ARRAY['id','scope','school_id','owner_account_id','owner_membership_id','bucket','storage_key',
  'original_name','extension','claimed_bytes','claimed_sha256','declared_mime','upload_expires_at','safety_policy_scope_key',
  'safety_policy_version_id','common_safety_policy_scope_key','common_safety_policy_version_id','sensitivity','created_at'];
  col text; o jsonb := to_jsonb(OLD); n jsonb := to_jsonb(NEW);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = 'file_objects 행은 지우지 않습니다(삭제는 deleted 상태와 정리 원장으로).';
  END IF;
  FOREACH col IN ARRAY frozen LOOP
    IF o -> col IS DISTINCT FROM n -> col THEN
      RAISE EXCEPTION 'IMMUTABLE_IDENTITY' USING DETAIL = format('file_objects.%s 는 바꿀 수 없습니다.', col);
    END IF;
  END LOOP;
  IF (OLD.storage_object_id IS NOT NULL AND NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id)
     OR (OLD.uploaded_at IS NOT NULL AND NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at)
     OR (OLD.first_linked_at IS NOT NULL AND NEW.first_linked_at IS DISTINCT FROM OLD.first_linked_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_IDENTITY' USING DETAIL = '실물 정체성·업로드 시각·첫 연결 시각은 한 번만 기록합니다.';
  END IF;
  IF OLD.state IN ('ready','quarantined','deleted') AND (
       NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
       OR NEW.detected_mime IS DISTINCT FROM OLD.detected_mime OR NEW.verification IS DISTINCT FROM OLD.verification
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by_service_id IS DISTINCT FROM OLD.verified_by_service_id
       OR NEW.scan_state IS DISTINCT FROM OLD.scan_state OR NEW.expanded_bytes IS DISTINCT FROM OLD.expanded_bytes) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '검증이 끝난 파일의 크기·해시·형식·검사 결과는 바꿀 수 없습니다. 수정본은 새 파일입니다.';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'uploading' AND NEW.state IN ('uploaded','rejected','deleted'))
    OR (OLD.state = 'uploaded'  AND NEW.state IN ('verifying','rejected','deleted'))
    OR (OLD.state = 'verifying' AND NEW.state IN ('uploaded','ready','rejected','quarantined'))
    OR (OLD.state = 'ready'     AND NEW.state IN ('quarantined','deleted'))
    OR (OLD.state IN ('rejected','quarantined') AND NEW.state = 'deleted')) THEN
    RAISE EXCEPTION 'FILE_STATE_TRANSITION' USING DETAIL = format('파일 상태를 %s 에서 %s 로 바꿀 수 없습니다.', OLD.state, NEW.state);
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER file_objects_guard BEFORE UPDATE OR DELETE ON workhub.file_objects
  FOR EACH ROW EXECUTE FUNCTION workhub_private.file_objects_guard();

-- ----------------------------------------------------------------------------
-- 5. 검증 작업(job/lease) · 작업자 준비 증거(heartbeat)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.file_verification_jobs (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  file_id              text NOT NULL,
  state                text NOT NULL DEFAULT 'queued',
  attempts             integer NOT NULL DEFAULT 0,
  max_attempts         integer NOT NULL DEFAULT 5,
  lease_owner          text,
  lease_token          bigint NOT NULL DEFAULT 0,
  lease_expires_at     timestamptz,
  leased_by_service_id text,
  queued_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at          timestamptz,
  outcome              text,
  last_error_code      text,
  result_sha256        text,
  CONSTRAINT file_verification_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT file_verification_jobs_school_id_id_key UNIQUE (school_id, id),
  -- 파일 하나에 작업 하나(같은 complete 재시도·동시 complete 가 작업을 늘리지 않는다)
  CONSTRAINT file_verification_jobs_file_key UNIQUE (file_id),
  CONSTRAINT file_verification_jobs_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT file_verification_jobs_leased_by_fkey FOREIGN KEY (leased_by_service_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT file_verification_jobs_state_check CHECK (state IN ('queued','leased','done','failed')),
  CONSTRAINT file_verification_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 20 AND attempts <= max_attempts),
  CONSTRAINT file_verification_jobs_lease_check CHECK ((state = 'leased') = (lease_expires_at IS NOT NULL AND lease_owner IS NOT NULL AND leased_by_service_id IS NOT NULL)),
  CONSTRAINT file_verification_jobs_lease_owner_check CHECK (lease_owner ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  CONSTRAINT file_verification_jobs_finished_check CHECK ((state IN ('done','failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT file_verification_jobs_outcome_check CHECK ((state = 'done') = (outcome IS NOT NULL) AND outcome IN ('ready','rejected','quarantined')),
  CONSTRAINT file_verification_jobs_error_check CHECK (last_error_code ~ '^[a-z_]{2,40}$'),
  CONSTRAINT file_verification_jobs_result_check CHECK (result_sha256 ~ '^[0-9a-f]{64}$' AND (state = 'done') = (result_sha256 IS NOT NULL) OR (state <> 'done' AND result_sha256 IS NULL))
);
CREATE INDEX file_verification_jobs_ready ON workhub.file_verification_jobs (next_attempt_at, id) WHERE state = 'queued';
CREATE INDEX file_verification_jobs_leased ON workhub.file_verification_jobs (lease_expires_at) WHERE state = 'leased';
CREATE TRIGGER file_verification_jobs_identity BEFORE UPDATE ON workhub.file_verification_jobs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','file_id','queued_at','max_attempts');
CREATE TRIGGER file_verification_jobs_no_delete BEFORE DELETE ON workhub.file_verification_jobs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 작업자가 "지금 실제로 돌고 있고 이런 검사를 한다" 고 주기적으로 남기는 기록. 준비 상태 판정의 근거.
-- 만료된 기록은 근거가 아니다(작업자가 멈추면 준비 상태가 스스로 false 로 돌아간다).
CREATE TABLE workhub.file_verifier_heartbeats (
  id                   bigint GENERATED ALWAYS AS IDENTITY,
  service_principal_id text NOT NULL,
  worker_id            text NOT NULL,
  capability           jsonb NOT NULL,
  reported_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at           timestamptz NOT NULL,
  CONSTRAINT file_verifier_heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT file_verifier_heartbeats_principal_fkey FOREIGN KEY (service_principal_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT file_verifier_heartbeats_worker_check CHECK (worker_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  CONSTRAINT file_verifier_heartbeats_capability_check CHECK (jsonb_typeof(capability) = 'object' AND octet_length(capability::text) <= 2048),
  CONSTRAINT file_verifier_heartbeats_expiry_check CHECK (expires_at > reported_at AND expires_at <= reported_at + interval '30 minutes')
);
CREATE INDEX file_verifier_heartbeats_current ON workhub.file_verifier_heartbeats (service_principal_id, expires_at DESC);
CREATE TRIGGER file_verifier_heartbeats_immutable BEFORE UPDATE OR DELETE ON workhub.file_verifier_heartbeats
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 파일 접근 기록(grant) — 내려받기 직전에 짧게 기록하고, Storage 읽기 정책이 다시 판정한다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.file_access_grants (
  id                    text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id             text NOT NULL,
  scope_key             text NOT NULL GENERATED ALWAYS AS ('s:' || school_id) STORED,
  file_id               text NOT NULL,
  granted_to_account_id text NOT NULL,
  granted_membership_id text NOT NULL,
  method                text NOT NULL DEFAULT 'storage_rls',
  resource_type         text NOT NULL,
  resource_id           text NOT NULL,
  resource_version      integer,
  collection_id         text NOT NULL,
  unit_id               text,
  issued_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at            timestamptz NOT NULL,
  revoked_at            timestamptz,
  revoke_reason         text,
  CONSTRAINT file_access_grants_pkey PRIMARY KEY (id),
  CONSTRAINT file_access_grants_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT file_access_grants_account_fkey FOREIGN KEY (granted_to_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT file_access_grants_member_fkey FOREIGN KEY (school_id, granted_membership_id, granted_to_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  -- 서명 URL·공개 URL 을 발급하지 않는다. 실제 읽기는 Storage RLS 가 현재 권한으로 다시 판정한다.
  CONSTRAINT file_access_grants_method_check CHECK (method = 'storage_rls'),
  CONSTRAINT file_access_grants_resource_check CHECK (
    (resource_type = 'collection_template' AND unit_id IS NULL AND resource_version IS NOT NULL)
    OR (resource_type = 'unit_draft' AND unit_id IS NOT NULL AND resource_version IS NOT NULL)
    OR (resource_type = 'submission' AND unit_id IS NOT NULL)),
  CONSTRAINT file_access_grants_period_check CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '10 minutes'),
  CONSTRAINT file_access_grants_revoke_check CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT file_access_grants_revoke_reason_check CHECK (revoke_reason ~ '^[a-z_]{2,40}$')
);
CREATE INDEX file_access_grants_lookup ON workhub.file_access_grants (file_id, granted_to_account_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX file_access_grants_resource ON workhub.file_access_grants (school_id, resource_type, resource_id) WHERE revoked_at IS NULL;
CREATE TRIGGER file_access_grants_identity BEFORE UPDATE ON workhub.file_access_grants
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','file_id','granted_to_account_id',
    'granted_membership_id','method','resource_type','resource_id','resource_version','collection_id','unit_id','issued_at','expires_at');
CREATE FUNCTION workhub_private.grant_revoke_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason)) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '접근 기록의 회수는 한 번만 기록하고 지우지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_access_grants_revoke_once BEFORE UPDATE OR DELETE ON workhub.file_access_grants
  FOR EACH ROW EXECUTE FUNCTION workhub_private.grant_revoke_once();

-- ----------------------------------------------------------------------------
-- 7. 정리(물리 삭제) 원장 — 차단 → 작업자가 Storage API 로 삭제 → 실물 없음 확인 후 완료
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.deletion_ledger (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  seq                       bigint GENERATED ALWAYS AS IDENTITY,
  school_id                 text NOT NULL,
  scope_key                 text NOT NULL GENERATED ALWAYS AS ('s:' || school_id) STORED,
  resource_type             text NOT NULL DEFAULT 'file_object',
  resource_id               text NOT NULL,
  file_sha256               text,
  storage_object_id         uuid,
  reason                    text NOT NULL,
  retention_policy_scope_key text NOT NULL,
  retention_policy_version_id text NOT NULL,
  requested_by_service_id   text NOT NULL,
  requested_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  state                     text NOT NULL DEFAULT 'blocked',
  blocked_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token               bigint NOT NULL,
  lease_expires_at          timestamptz NOT NULL,
  leased_by_service_id      text NOT NULL,
  completed_at              timestamptz,
  retained_reason           text,
  manifest_sha256           text NOT NULL,
  CONSTRAINT deletion_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT deletion_ledger_seq_key UNIQUE (seq),
  CONSTRAINT deletion_ledger_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT deletion_ledger_resource_key UNIQUE (scope_key, resource_type, resource_id),
  CONSTRAINT deletion_ledger_file_fkey FOREIGN KEY (school_id, resource_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT deletion_ledger_policy_fkey FOREIGN KEY (retention_policy_scope_key, retention_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT deletion_ledger_requested_by_fkey FOREIGN KEY (requested_by_service_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT deletion_ledger_leased_by_fkey FOREIGN KEY (leased_by_service_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT deletion_ledger_resource_type_check CHECK (resource_type = 'file_object'),
  CONSTRAINT deletion_ledger_reason_check CHECK (reason IN ('upload_expired','rejected_file','unattached_retention')),
  CONSTRAINT deletion_ledger_state_check CHECK (state IN ('blocked','completed','retained')),
  CONSTRAINT deletion_ledger_completed_check CHECK ((state IN ('completed','retained')) = (completed_at IS NOT NULL)),
  CONSTRAINT deletion_ledger_retained_check CHECK ((state = 'retained') = (retained_reason IS NOT NULL)),
  CONSTRAINT deletion_ledger_hash_check CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$' AND (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX deletion_ledger_open ON workhub.deletion_ledger (scope_key, state, requested_at) WHERE state = 'blocked';
CREATE FUNCTION workhub_private.deletion_ledger_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'blocked'
     -- scope_key 는 생성 열이라 BEFORE 트리거의 NEW 에서 NULL 이다 → 비교에서 뺀다(원천 열 school_id 는 비교됨).
     OR (to_jsonb(NEW) - ARRAY['state','completed_at','retained_reason','lease_token','lease_expires_at','leased_by_service_id','scope_key'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','completed_at','retained_reason','lease_token','lease_expires_at','leased_by_service_id','scope_key']) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '정리 원장은 대상·근거·지문을 바꿀 수 없고, 끝난 행은 고치지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_ledger_guard BEFORE UPDATE OR DELETE ON workhub.deletion_ledger
  FOR EACH ROW EXECUTE FUNCTION workhub_private.deletion_ledger_guard();

-- ----------------------------------------------------------------------------
-- 8. 권한: 새 표는 RLS 를 켜고 정책을 두지 않는다. API 역할 권한 0.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('workhub','workhub_private') AND c.relkind = 'r' AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO workhub_private.batch_installs (batch, release) VALUES ('R1-01', '2026-10-15.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 9. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'R1-01-1' AS no, 'R1-01 표 9개 + RLS 켜짐' AS item,
       CASE WHEN count(*) FILTER (WHERE c.relrowsecurity) = 9 THEN 'ok' ELSE 'FAIL' END AS status,
       count(*) FILTER (WHERE c.relrowsecurity)::text AS value
FROM unnest(ARRAY['workhub_private.batch_installs','workhub_private.r1_switch','workhub_private.api_role_principals',
  'workhub.policy_catalog','workhub.policy_versions','workhub.file_objects','workhub.file_verification_jobs',
  'workhub.file_access_grants','workhub.deletion_ledger']) t LEFT JOIN pg_class c ON c.oid = to_regclass(t)
UNION ALL
SELECT 'R1-01-2', 'API 역할의 workhub 표 권한 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM information_schema.role_table_grants WHERE table_schema IN ('workhub','workhub_private') AND grantee IN ('PUBLIC','anon','authenticated','service_role')
UNION ALL
SELECT 'R1-01-3', '정책판 0개(승인 전) · 정책 종류 3개',
       CASE WHEN (SELECT count(*) FROM workhub.policy_versions) = 0 AND (SELECT count(*) FROM workhub.policy_catalog) = 3 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'R1-01-4', '서비스 주체 작업 목록에 file.verify·file.cleanup 추가, 주체 행은 그대로',
       CASE WHEN pg_get_constraintdef(oid) LIKE '%file.verify%file.cleanup%'
             AND NOT EXISTS (SELECT 1 FROM workhub.service_principals WHERE 'file.verify' = ANY (allowed_actions)) THEN 'ok' ELSE 'FAIL' END, ''
FROM pg_constraint WHERE conrelid = 'workhub.service_principals'::regclass AND conname = 'service_principals_action_registry'
UNION ALL
SELECT 'R1-01-5', '중지 스위치 open',
       CASE WHEN (SELECT state FROM workhub_private.r1_switch) = 'open' THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
