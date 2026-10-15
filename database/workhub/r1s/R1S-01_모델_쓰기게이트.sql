-- ============================================================================
-- R1S-01  HWPX 기본 확인 프로필 — 모델 · 쓰기 게이트 · 파일 사용 판정 (비활성 설치)
--
-- 요청서: docs/workhub/42-hwpx-basic-collection-request.md (PR #45) · 설계 근거: R1S_설계결정.md
--
-- ▣ 하는 일
--   - 최소 확인 프로필 hwpx_basic_v1 의 목록(1행)과, 학교별 활성화·파일별 확인 기록·확인 임대 표를 만든다.
--   - 기존 R1-03 함수 5개를 교체한다(쓰기 게이트·파일 판정·내려받기 원본 해석·업로드 예약·업로드 확인).
--     교체본은 R1-03 원문에서 "R1S:" 주석을 단 부분만 다르다(test/r1s_replaced.py 가 기계로 대조).
--   - 서비스 주체 작업 목록 CHECK 에 file.basic_check 를 더한다(주체 행은 만들지 않는다 — R1S-04).
-- ▣ 하지 않는 일
--   - 프로필을 켜지 않는다. 활성화 행 0개 → 모든 학교의 쓰기 게이트·준비 상태는 R1-03 과 똑같이 동작한다.
--   - 정책을 게시하지 않고, allowUnscanned 값을 바꾸지 않는다. 회원·로그인·R0·R1 자료·Storage 를 쓰지 않는다.
--   - R1-01~03 을 다시 실행하거나 고치지 않는다. R1-05·06 을 실행하지 않는다.
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
--   마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: R1-01·02·03 (판 2026-10-15.1). 교체할 함수 5개가 R1-03 원문과 같아야 한다(다르면 시작 전에 멈춤).
-- ============================================================================
BEGIN;

DO $$
DECLARE v_bad text;
BEGIN
  IF to_regclass('workhub_private.batch_installs') IS NULL THEN
    RAISE EXCEPTION 'R1S 중단: R1-01·02·03(2026-10-15.1)이 모두 적용되어 있지 않습니다.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.batch_installs WHERE batch IN ('R1-01','R1-02','R1-03') AND release = '2026-10-15.1') <> 3 THEN
    RAISE EXCEPTION 'R1S 중단: R1-01·02·03(2026-10-15.1)이 모두 적용되어 있지 않습니다.';
  END IF;
  IF to_regclass('workhub_private.r1s_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'R1S 중단: R1S-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.file_check_profiles') IS NOT NULL OR to_regclass('workhub.basic_profile_activations') IS NOT NULL
     OR to_regclass('workhub.file_basic_checks') IS NOT NULL OR to_regclass('workhub.file_basic_leases') IS NOT NULL
     OR to_regprocedure('public.workhub_collection_basic_readiness(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'R1S 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  -- 교체 대상이 R1-03 원문 그대로여야 한다(다른 배치·수작업이 바꿨으면 덮어쓰지 않는다). 줄바꿈(CRLF) 차이는 무시한다.
  SELECT string_agg(x.fn, ', ' ORDER BY x.fn) INTO v_bad
    FROM (VALUES ('c_require', '37dfb2107998536798fd43e062bbacd2'), ('c_file_problem', '597290578af959aad58320da540b1148'),
                 ('c_parent_resolve', '8a3154bd345a29fd5112861f8a26ca39'), ('c_prepare', '5b90d273c1c8f56874abb6b6ece4faa6'),
                 ('c_complete', '15216adbb3dc7bcd9125698e5c2a21c1')) x(fn, h)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname = x.fn
            AND md5(replace(p.prosrc, chr(13), '')) = x.h) <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'R1S 중단: 교체할 R1-03 함수가 원문과 다릅니다(%). 결과를 알려 주세요.', v_bad;
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'workhub.service_principals'::regclass AND conname = 'service_principals_action_registry')
     IS DISTINCT FROM 'CHECK ((allowed_actions <@ ARRAY[''school.bootstrap''::text, ''file.verify''::text, ''file.cleanup''::text]))' THEN
    RAISE EXCEPTION 'R1S 중단: service_principals 작업 목록 CHECK 가 R1-01 판과 다릅니다.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록 — R1 의 batch_installs 는 이름 규칙(R숫자-두자리)이 달라 따로 둔다(R1 표를 바꾸지 않기 위해)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.r1s_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT r1s_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT r1s_installs_batch_check CHECK (batch IN ('R1S-01','R1S-02')),
  CONSTRAINT r1s_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER r1s_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.r1s_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 서비스 주체 작업 목록 — 기본 확인(file.basic_check)을 더한다. 정리(file.cleanup)·검증(file.verify)과는 다른 작업이다.
-- ----------------------------------------------------------------------------
ALTER TABLE workhub.service_principals DROP CONSTRAINT service_principals_action_registry;
ALTER TABLE workhub.service_principals ADD CONSTRAINT service_principals_action_registry
  CHECK (allowed_actions <@ ARRAY['school.bootstrap','file.verify','file.cleanup','file.basic_check']::text[]);

-- ----------------------------------------------------------------------------
-- 3. 확인 프로필 목록 — 무엇을 확인하고 무엇을 확인하지 않는지를 행으로 고정한다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.file_check_profiles (
  profile            text NOT NULL,
  label              text NOT NULL,
  description        text NOT NULL,
  extensions         text[] NOT NULL,
  max_file_bytes     bigint NOT NULL,
  checks             text[] NOT NULL,
  malware_scan       boolean NOT NULL DEFAULT false,
  content_validation boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT file_check_profiles_pkey PRIMARY KEY (profile),
  CONSTRAINT file_check_profiles_profile_check CHECK (profile ~ '^[a-z0-9_]{3,40}$'),
  CONSTRAINT file_check_profiles_extensions_check CHECK (cardinality(extensions) > 0 AND extensions <@ ARRAY['pdf','hwp','hwpx','docx','xlsx','pptx']::text[]),
  CONSTRAINT file_check_profiles_max_check CHECK (max_file_bytes BETWEEN 1 AND 104857600),
  CONSTRAINT file_check_profiles_checks_check CHECK (cardinality(checks) > 0 AND checks <@ ARRAY['size','sha256','hwpx']::text[]),
  -- 이 표의 프로필은 악성코드 검사·내용 검증을 하지 않는다. 그런 프로필은 이 표에 넣을 수 없다(위장 방지).
  CONSTRAINT file_check_profiles_no_malware CHECK (NOT malware_scan AND NOT content_validation)
);
CREATE TRIGGER file_check_profiles_immutable BEFORE UPDATE OR DELETE ON workhub.file_check_profiles
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 30 MiB 는 API 의 기술 한도(apps/main/api/collections/_assets/hwpx-basic.json)와 같다. 학교 정책이 아니다.
-- 실제 상한 = 이 값 · 학교 정책 · 공통 하한 · 수합 정책 · 예약 당시 정책 중 가장 작은 값.
INSERT INTO workhub.file_check_profiles (profile, label, description, extensions, max_file_bytes, checks) VALUES
  ('hwpx_basic_v1', 'HWPX 기본 확인',
   '원문 크기·SHA-256 이 예약값과 같은지, HWPX ZIP 기본 구조·필수 항목·mimetype 을 확인한다. 악성코드 검사·문서 내용 검증·렌더링은 하지 않는다.',
   ARRAY['hwpx'], 31457280, ARRAY['size','sha256','hwpx']);

-- ----------------------------------------------------------------------------
-- 4. 학교별 활성화 — 승인 근거 · 승인자 · 확인 서버 주체 · 배포 확인값. 기본은 0행(= 비활성).
--    켜고 끄기는 state 만 바꾼다(R1S-80/81). 승인·배포 확인값은 바꿀 수 없다(새로 승인하려면 별도 SQL).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.basic_profile_activations (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                 text NOT NULL,
  profile                   text NOT NULL,
  service_principal_id      text NOT NULL,
  approval_ref              text NOT NULL,
  approved_by_account_id    text NOT NULL,
  approved_by_membership_id text NOT NULL,
  approved_at               timestamptz NOT NULL,
  deployment_ref            text NOT NULL,
  deployment_checked_on     date NOT NULL,
  state                     text NOT NULL,
  state_reason              text NOT NULL,
  state_changed_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_changed_by          name NOT NULL DEFAULT session_user,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT basic_profile_activations_pkey PRIMARY KEY (id),
  CONSTRAINT basic_profile_activations_school_profile_key UNIQUE (school_id, profile),
  CONSTRAINT basic_profile_activations_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT basic_profile_activations_profile_fkey FOREIGN KEY (profile) REFERENCES workhub.file_check_profiles(profile),
  CONSTRAINT basic_profile_activations_principal_fkey FOREIGN KEY (service_principal_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT basic_profile_activations_approved_by_fkey FOREIGN KEY (approved_by_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT basic_profile_activations_member_fkey FOREIGN KEY (school_id, approved_by_membership_id, approved_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT basic_profile_activations_state_check CHECK (state IN ('active','stopped')),
  CONSTRAINT basic_profile_activations_text_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200
    AND length(btrim(deployment_ref)) BETWEEN 1 AND 200 AND length(btrim(state_reason)) BETWEEN 1 AND 200)
);
CREATE TRIGGER basic_profile_activations_identity BEFORE UPDATE ON workhub.basic_profile_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','profile','service_principal_id','approval_ref',
    'approved_by_account_id','approved_by_membership_id','approved_at','deployment_ref','deployment_checked_on','created_at');
CREATE TRIGGER basic_profile_activations_no_delete BEFORE DELETE ON workhub.basic_profile_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.basic_profile_activation_log (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  activation_id text NOT NULL,
  old_state     text,
  new_state     text NOT NULL,
  reason        text NOT NULL,
  changed_at    timestamptz NOT NULL,
  changed_by    name NOT NULL,
  CONSTRAINT basic_profile_activation_log_pkey PRIMARY KEY (id),
  CONSTRAINT basic_profile_activation_log_activation_fkey FOREIGN KEY (activation_id) REFERENCES workhub.basic_profile_activations(id)
);
CREATE TRIGGER basic_profile_activation_log_immutable BEFORE UPDATE OR DELETE ON workhub.basic_profile_activation_log
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 상태 변경 시각·실행자는 DB 가 적고(입력값 무시), 변경마다 기록 1행을 남긴다(행이 생긴 뒤라 AFTER).
CREATE FUNCTION workhub_private.basic_activation_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.state_changed_at := clock_timestamp();
  NEW.state_changed_by := session_user;
  RETURN NEW;
END $$;
CREATE TRIGGER basic_profile_activations_stamp BEFORE INSERT OR UPDATE ON workhub.basic_profile_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.basic_activation_stamp();
CREATE FUNCTION workhub_private.basic_activation_logged() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO workhub.basic_profile_activation_log (activation_id, old_state, new_state, reason, changed_at, changed_by)
  VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.state END, NEW.state, NEW.state_reason, NEW.state_changed_at, NEW.state_changed_by);
  RETURN NULL;
END $$;
CREATE TRIGGER basic_profile_activations_logged AFTER INSERT OR UPDATE ON workhub.basic_profile_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.basic_activation_logged();

-- ----------------------------------------------------------------------------
-- 5. 파일별 기본 확인 기록 — 예약(prepare) 때 만들고, 확정(finish) 때 결과를 한 번만 적는다
--    이 행이 있는 파일 = 기본 확인 경로 파일. 검증 작업자 대기열과는 서로 배타적이다(아래 트리거).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.file_basic_checks (
  file_id                text NOT NULL,
  school_id              text NOT NULL,
  profile                text NOT NULL,
  activation_id          text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome                text,
  reject_code            text,
  close_reason           text,
  result                 jsonb,
  result_sha256          text,
  finished_at            timestamptz,
  finished_by_service_id text,
  finished_lease_id      text,
  CONSTRAINT file_basic_checks_pkey PRIMARY KEY (file_id),
  CONSTRAINT file_basic_checks_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT file_basic_checks_profile_fkey FOREIGN KEY (profile) REFERENCES workhub.file_check_profiles(profile),
  CONSTRAINT file_basic_checks_activation_fkey FOREIGN KEY (activation_id) REFERENCES workhub.basic_profile_activations(id),
  CONSTRAINT file_basic_checks_finished_by_fkey FOREIGN KEY (finished_by_service_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT file_basic_checks_outcome_check CHECK (outcome IN ('ready','rejected')),
  -- API 의 고정 거절 코드만 받는다(원문 파일명·외부 오류 문구 금지). DB 의 reject_reason 에는 소문자로 옮긴다.
  CONSTRAINT file_basic_checks_reject_code_check CHECK (reject_code IN ('FILE_SIZE_LIMIT','FILE_SIZE_MISMATCH','FILE_HASH_MISMATCH',
    'FILE_SIGNATURE_MISMATCH','FILE_STRUCTURE_LIMIT','FILE_STRUCTURE_INVALID','FILE_ENCRYPTED','FILE_STRUCTURE_UNSUPPORTED','FILE_HWPX_REQUIRED_PART')),
  -- 실물 없음·바뀜처럼 API 결과 없이 DB 가 닫은 경우의 사유
  CONSTRAINT file_basic_checks_close_reason_check CHECK (close_reason IN ('object_missing','object_changed')),
  CONSTRAINT file_basic_checks_result_check CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 2048)),
  CONSTRAINT file_basic_checks_sha_check CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT file_basic_checks_finished_check CHECK ((outcome IS NULL) = (finished_at IS NULL)
    AND (outcome IS NULL) = (finished_by_service_id IS NULL)),
  CONSTRAINT file_basic_checks_ready_check CHECK (outcome IS DISTINCT FROM 'ready' OR (reject_code IS NULL AND close_reason IS NULL
    AND result IS NOT NULL AND result_sha256 IS NOT NULL AND finished_lease_id IS NOT NULL)),
  CONSTRAINT file_basic_checks_rejected_check CHECK (outcome IS DISTINCT FROM 'rejected' OR (num_nonnulls(reject_code, close_reason) = 1
    AND (reject_code IS NULL OR (result IS NOT NULL AND result_sha256 IS NOT NULL AND finished_lease_id IS NOT NULL)))),
  CONSTRAINT file_basic_checks_open_check CHECK (outcome IS NOT NULL OR (reject_code IS NULL AND close_reason IS NULL AND result IS NULL
    AND result_sha256 IS NULL AND finished_lease_id IS NULL))
);
CREATE INDEX file_basic_checks_school ON workhub.file_basic_checks (school_id, created_at);
CREATE FUNCTION workhub_private.file_basic_checks_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE f workhub.file_objects; v_max bigint; v_ext text[];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '기본 확인 기록은 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- 검증 작업자 대기열에 이미 오른 파일은 기본 확인 경로가 될 수 없다(같은 파일을 두 경로가 확정하지 않게)
    IF EXISTS (SELECT 1 FROM workhub.file_verification_jobs j WHERE j.file_id = NEW.file_id) THEN
      RAISE EXCEPTION 'BASIC_PROFILE_CONFLICT' USING DETAIL = '검증 작업자 대기열에 있는 파일입니다.';
    END IF;
    SELECT * INTO f FROM workhub.file_objects WHERE school_id = NEW.school_id AND id = NEW.file_id;
    SELECT max_file_bytes, extensions INTO v_max, v_ext FROM workhub.file_check_profiles WHERE profile = NEW.profile;
    IF f.state IS DISTINCT FROM 'uploading' OR NOT (f.extension = ANY (v_ext)) OR f.claimed_bytes > v_max THEN
      RAISE EXCEPTION 'BASIC_PROFILE_CONFLICT' USING DETAIL = '프로필의 형식·크기 밖이거나 예약 직후가 아닌 파일입니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['outcome','reject_code','close_reason','result','result_sha256','finished_at','finished_by_service_id','finished_lease_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['outcome','reject_code','close_reason','result','result_sha256','finished_at','finished_by_service_id','finished_lease_id'])
     OR OLD.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '기본 확인 기록의 대상은 바꿀 수 없고, 결과는 한 번만 적습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_basic_checks_guard BEFORE INSERT OR UPDATE OR DELETE ON workhub.file_basic_checks
  FOR EACH ROW EXECUTE FUNCTION workhub_private.file_basic_checks_guard();

-- 반대 방향: 기본 확인 경로 파일은 검증 작업자 대기열에 오를 수 없다(R1 표에 트리거 1개 추가 — 의도한 변경)
CREATE FUNCTION workhub_private.file_job_not_basic() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workhub.file_basic_checks b WHERE b.file_id = NEW.file_id) THEN
    RAISE EXCEPTION 'BASIC_PROFILE_CONFLICT' USING DETAIL = '기본 확인 경로 파일은 검증 작업자가 다루지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_verification_jobs_not_basic BEFORE INSERT ON workhub.file_verification_jobs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.file_job_not_basic();

-- ----------------------------------------------------------------------------
-- 6. 확인 임대(lease) — 파일당 유효 임대 1개. token 은 해시만 저장한다(원문은 발급 응답에만).
--    상태: issued → finished(확정) 또는 expired(만료 뒤 다음 인수가 닫음). 행은 지우지 않는다(횟수 제한의 근거).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.file_basic_leases (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  file_id              text NOT NULL,
  token_sha256         text NOT NULL,
  request_key          text NOT NULL,
  account_id           text NOT NULL,
  membership_id        text NOT NULL,
  service_principal_id text NOT NULL,
  activation_id        text NOT NULL,
  issued_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at           timestamptz NOT NULL,
  state                text NOT NULL DEFAULT 'issued',
  closed_at            timestamptz,
  CONSTRAINT file_basic_leases_pkey PRIMARY KEY (id),
  CONSTRAINT file_basic_leases_check_fkey FOREIGN KEY (file_id) REFERENCES workhub.file_basic_checks(file_id),
  CONSTRAINT file_basic_leases_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT file_basic_leases_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT file_basic_leases_principal_fkey FOREIGN KEY (service_principal_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT file_basic_leases_activation_fkey FOREIGN KEY (activation_id) REFERENCES workhub.basic_profile_activations(id),
  CONSTRAINT file_basic_leases_token_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT file_basic_leases_key_check CHECK (length(request_key) BETWEEN 8 AND 200),
  CONSTRAINT file_basic_leases_period_check CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
  CONSTRAINT file_basic_leases_state_check CHECK (state IN ('issued','finished','expired') AND (state = 'issued') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX file_basic_leases_one_open ON workhub.file_basic_leases (file_id) WHERE state = 'issued';
CREATE INDEX file_basic_leases_file_time ON workhub.file_basic_leases (file_id, issued_at);
CREATE INDEX file_basic_leases_account_time ON workhub.file_basic_leases (account_id, issued_at);
CREATE FUNCTION workhub_private.file_basic_leases_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'issued' OR NEW.state = 'issued'
     OR (to_jsonb(NEW) - ARRAY['state','closed_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','closed_at']) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '확인 임대는 issued → finished/expired 로 한 번만 닫고 지우지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_basic_leases_guard BEFORE UPDATE OR DELETE ON workhub.file_basic_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.file_basic_leases_guard();

-- ----------------------------------------------------------------------------
-- 7. 판정 함수 — 기본 확인 준비 상태 · 쓰기 정책 · 확정 근거 · 읽기 판정
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_r1s_ok() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.r1s_installs WHERE batch IN ('R1S-01','R1S-02') AND release = '2026-10-16.1') = 2
$$;

-- 확인 서버 주체가 지금 이 학교에서 유효한가: 활성 · 작업 목록이 정확히 file.basic_check 하나(정리·검증 권한 없음) · 학교 범위 승인
CREATE FUNCTION workhub_private.c_basic_principal_ok(p_principal text, p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.service_principals p
                  WHERE p.id = p_principal AND p.active AND p.allowed_actions = ARRAY['file.basic_check']::text[]
                    AND EXISTS (SELECT 1 FROM workhub.service_principal_scopes s
                                 WHERE s.service_principal_id = p.id AND s.scope_key = 's:' || p_school AND s.revoked_at IS NULL
                                   AND s.valid_from <= clock_timestamp() AND (s.valid_to IS NULL OR clock_timestamp() < s.valid_to)))
$$;

-- 학교가 기본 확인 프로필을 켰는가(유효성과 무관하게 켜 둔 행이 있는가). 쓰기 게이트 분기에 쓴다.
CREATE FUNCTION workhub_private.c_basic_mode(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.basic_profile_activations a WHERE a.school_id = p_school AND a.state = 'active')
$$;

-- 지금 유효한 활성화 1행(켜져 있고, 확인 서버 주체가 유효함). 없으면 NULL.
CREATE FUNCTION workhub_private.c_basic_activation(p_school text) RETURNS workhub.basic_profile_activations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.* FROM workhub.basic_profile_activations a
   WHERE a.school_id = p_school AND a.profile = 'hwpx_basic_v1' AND a.state = 'active'
     AND workhub_private.c_basic_principal_ok(a.service_principal_id, p_school)
$$;

-- 기본 확인 프로필의 쓰기 정책: 승인된 정책 3종(c_effective) 중 HWPX 만, 상한은 프로필 기술 한도와 정책 중 작은 값.
-- allowUnscanned 는 항상 false 로 둔다 — 기본 확인 파일은 프로필 근거로만 쓰고, 일반 미검사 파일을 열지 않는다.
CREATE FUNCTION workhub_private.c_basic_effective(p_school text, p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a workhub.basic_profile_activations; eff jsonb; v_max bigint;
BEGIN
  a := workhub_private.c_basic_activation(p_school);
  IF a.id IS NULL THEN RETURN NULL; END IF;
  eff := workhub_private.c_effective(p_school, p_date);
  IF eff IS NULL OR NOT ((eff -> 'file' -> 'extensions') ? 'hwpx') THEN RETURN NULL; END IF;
  SELECT max_file_bytes INTO v_max FROM workhub.file_check_profiles WHERE profile = a.profile;
  RETURN eff || jsonb_build_object(
    'file', jsonb_build_object('extensions', '["hwpx"]'::jsonb,
                               'maxFileBytes', least((eff -> 'file' ->> 'maxFileBytes')::bigint, v_max),
                               'maxFiles', (eff -> 'file' ->> 'maxFiles')::integer),
    'allowUnscanned', false, 'basicProfile', a.profile, 'basicActivationId', a.id, 'basicPrincipalId', a.service_principal_id);
END $$;

-- 기본 확인 준비 상태 {available, reason, policy}. 순서는 R1 과 같다: DB(중지 포함) → Storage → 확인 경로 → 정책.
-- 검증 작업자 heartbeat 를 보지 않는 대신, 학교별 활성화·확인 서버 주체·배포 확인값(활성화 행의 필수 칸)을 본다.
CREATE FUNCTION workhub_private.c_basic_readiness(p_school text, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE eff jsonb;
BEGIN
  IF NOT workhub_private.c_db_ok() OR NOT workhub_private.c_r1s_ok() OR workhub_private.c_switch() <> 'open' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'database_missing', 'policy', NULL);
  END IF;
  IF NOT workhub_private.c_storage_ok() THEN
    RETURN jsonb_build_object('available', false, 'reason', 'storage_missing', 'policy', NULL);
  END IF;
  IF (workhub_private.c_basic_activation(p_school)).id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'verification_missing', 'policy', NULL);
  END IF;
  eff := workhub_private.c_basic_effective(p_school, p_today);
  IF eff IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'policy_missing', 'policy', NULL);
  END IF;
  RETURN jsonb_build_object('available', true, 'reason', 'ready', 'policy', eff -> 'file');
END $$;

-- 기본 확인으로 ready 가 된 근거가 있는가: 확인 기록 ready · 같은 확인 주체 · 프로필 형식 · 파일 행의 프로필 표시.
-- (파일 행의 결과는 ready 이후 불변 — R1 file_objects_guard. 확인 기록도 결과를 한 번만 적는다.)
CREATE FUNCTION workhub_private.c_basic_evidence_ok(f workhub.file_objects) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.state = 'ready' AND f.scan_state = 'not_scanned' AND EXISTS (
    SELECT 1 FROM workhub.file_basic_checks b JOIN workhub.file_check_profiles p ON p.profile = b.profile
     WHERE b.school_id = f.school_id AND b.file_id = f.id AND b.outcome = 'ready'
       AND b.finished_by_service_id = f.verified_by_service_id AND f.extension = ANY (p.extensions)
       AND f.verification ->> 'profile' = b.profile AND f.size_bytes <= p.max_file_bytes)
$$;

-- 읽기 판정(내려받기 원본 해석 c_parent_resolve 전용). 쓰기 판정(c_file_problem)과 다른 점:
--   - 지금 학교∩공통 정책의 형식·크기로 과거 파일을 막지 않는다(HWPX 전용으로 줄어도 과거 PDF 를 계속 읽는다).
--   - 기본 확인 근거가 있는 파일은 프로필이 지금 꺼져 있어도 읽는다(끈 뒤에도 확정 자료 열람 유지).
--   같은 점: 검사 중·실패·정리 원장·정책 없음(p_eff NULL)·요청(수합)의 파일 정책 밖·일반 미검사 파일의 allowUnscanned 규칙.
CREATE FUNCTION workhub_private.c_file_read_problem(f workhub.file_objects, p_eff jsonb, p_req_policy jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF f.state IN ('uploading','uploaded','verifying') THEN RETURN 'FILE_NOT_READY'; END IF;
  IF f.state <> 'ready' OR p_eff IS NULL
     OR EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id)
     OR (p_req_policy IS NOT NULL AND jsonb_typeof(p_req_policy) = 'object'
         AND (NOT ((p_req_policy -> 'extensions') ? f.extension) OR f.size_bytes > (p_req_policy ->> 'maxFileBytes')::bigint)) THEN
    RETURN 'FILE_FAILED';
  END IF;
  IF f.scan_state = 'not_scanned' AND NOT workhub_private.c_basic_evidence_ok(f)
     AND NOT (COALESCE((p_eff ->> 'allowUnscanned')::boolean, false)
       AND COALESCE((SELECT (v.value ->> 'allowUnscanned')::boolean FROM workhub.policy_versions v
                      WHERE v.scope_key = f.safety_policy_scope_key AND v.id = f.safety_policy_version_id), false)
       AND COALESCE((SELECT (v.value ->> 'allowUnscanned')::boolean FROM workhub.policy_versions v
                      WHERE v.scope_key = f.common_safety_policy_scope_key AND v.id = f.common_safety_policy_version_id), false)) THEN
    RETURN 'FILE_FAILED';
  END IF;
  RETURN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 8. 기존 R1-03 함수 교체 (같은 이름·인자·반환형, 권한·설정 그대로)
-- ----------------------------------------------------------------------------
-- >>> R1-03 함수 교체 묶음 시작 (자동 생성: test/r1s_replaced.py — R1-03 원문에서 아래 표시한 R1S 부분만 다르다)
CREATE OR REPLACE FUNCTION workhub_private.c_require(p_ctx workhub_private.actor_context, p_level text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; eff jsonb;
BEGIN
  IF p_level = 'write' THEN
    -- R1S: 기본 확인 프로필을 켠 학교는 그 프로필의 준비 상태로 쓰기를 판정한다(검증 작업자 heartbeat 를 보지 않는다).
    --      켠 학교에서 프로필 조건이 깨지면 기존 작업자 경로로 넘어가지 않고 닫는다(NOT_READY).
    IF workhub_private.c_basic_mode(p_ctx.school_id) THEN
      r := workhub_private.c_basic_readiness(p_ctx.school_id, p_ctx.school_today);
      IF NOT (r ->> 'available')::boolean THEN RAISE EXCEPTION 'NOT_READY'; END IF;
      RETURN workhub_private.c_basic_effective(p_ctx.school_id, p_ctx.school_today);
    END IF;
    r := workhub_private.c_readiness(p_ctx.school_id, p_ctx.school_today);
    IF NOT (r ->> 'available')::boolean THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    RETURN workhub_private.c_effective(p_ctx.school_id, p_ctx.school_today);
  END IF;
  IF NOT workhub_private.c_db_ok() OR workhub_private.c_switch() = 'all_stopped' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF p_level = 'read' THEN RETURN NULL; END IF;
  eff := workhub_private.c_effective(p_ctx.school_id, p_ctx.school_today);
  IF NOT workhub_private.c_storage_ok() OR eff IS NULL THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  RETURN eff;
END $$;

CREATE OR REPLACE FUNCTION workhub_private.c_file_problem(f workhub.file_objects, p_eff jsonb, p_req_policy jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF f.state IN ('uploading','uploaded','verifying') THEN RETURN 'FILE_NOT_READY'; END IF;
  IF f.state <> 'ready' OR p_eff IS NULL
     OR EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id)
     OR NOT ((p_eff -> 'file' -> 'extensions') ? f.extension)
     OR f.size_bytes > (p_eff -> 'file' ->> 'maxFileBytes')::bigint
     OR (p_req_policy IS NOT NULL AND jsonb_typeof(p_req_policy) = 'object'
         AND (NOT ((p_req_policy -> 'extensions') ? f.extension) OR f.size_bytes > (p_req_policy ->> 'maxFileBytes')::bigint)) THEN
    RETURN 'FILE_FAILED';
  END IF;
  -- R1S: 기본 확인(hwpx_basic_v1)으로 확정된 파일은 그 프로필이 지금 쓰기 정책일 때만 새로 붙일 수 있다.
  --      allowUnscanned 와는 별개 경로이고, 악성 검사를 한 것으로 보지 않는다(scan_state 는 not_scanned 그대로).
  IF f.scan_state = 'not_scanned'
     AND NOT (p_eff ->> 'basicProfile' IS NOT NULL AND f.verification ->> 'profile' = p_eff ->> 'basicProfile'
              AND workhub_private.c_basic_evidence_ok(f))
     AND NOT ((p_eff ->> 'allowUnscanned')::boolean
       AND COALESCE((SELECT (v.value ->> 'allowUnscanned')::boolean FROM workhub.policy_versions v
                      WHERE v.scope_key = f.safety_policy_scope_key AND v.id = f.safety_policy_version_id), false)
       AND COALESCE((SELECT (v.value ->> 'allowUnscanned')::boolean FROM workhub.policy_versions v
                      WHERE v.scope_key = f.common_safety_policy_scope_key AND v.id = f.common_safety_policy_version_id), false)) THEN
    RETURN 'FILE_FAILED';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION workhub_private.c_parent_resolve(p_ctx workhub_private.actor_context, p_parent jsonb, p_file text, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_req text := p_parent ->> 'requestId'; v_unit text := p_parent ->> 'unitId'; c workhub.collections; s workhub.collection_schemas;
  f workhub.file_objects; v_draft workhub.unit_drafts; sv workhub.submission_versions; v_code text; r jsonb;
BEGIN
  IF NOT workhub_private.c_reads(p_ctx, v_req) THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = v_req;
  SELECT * INTO s FROM workhub.collection_schemas WHERE school_id = c.school_id AND id = c.current_schema_id;
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = p_file;
  IF f.id IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF p_parent ->> 'kind' = 'template' THEN
    IF c.version <> (p_parent ->> 'version')::integer THEN RETURN jsonb_build_object('code', 'CONFLICT'); END IF;
    IF NOT EXISTS (SELECT 1 FROM workhub.collection_template_files t WHERE t.school_id = c.school_id AND t.collection_id = c.id
                     AND t.file_id = f.id AND t.unlinked_at IS NULL) THEN
      RETURN jsonb_build_object('code', 'NOT_FOUND');
    END IF;
    r := jsonb_build_object('resourceType', 'collection_template', 'resourceId', c.id, 'version', c.version, 'collectionId', c.id, 'unitId', NULL);
  ELSE
    IF c.state <> 'published' OR NOT workhub_private.c_sees_unit(p_ctx, c.id, v_unit) THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
    IF p_parent ->> 'kind' = 'draft' THEN
      IF NOT workhub_private.c_is_unit_member(p_ctx, v_unit) THEN RETURN jsonb_build_object('code', 'FORBIDDEN'); END IF;
      SELECT d.* INTO v_draft FROM workhub.unit_drafts d JOIN workhub.collection_units u ON u.school_id = d.school_id AND u.id = d.unit_id AND u.active_schema_id = d.schema_id
       WHERE d.school_id = p_ctx.school_id AND d.unit_id = v_unit;
      IF COALESCE(v_draft.version, 0) <> (p_parent ->> 'version')::integer THEN RETURN jsonb_build_object('code', 'CONFLICT'); END IF;
      IF NOT EXISTS (SELECT 1 FROM workhub.unit_draft_files df WHERE df.school_id = p_ctx.school_id AND df.draft_id = v_draft.id
                       AND df.file_id = f.id AND df.unlinked_at IS NULL) THEN
        RETURN jsonb_build_object('code', 'NOT_FOUND');
      END IF;
      r := jsonb_build_object('resourceType', 'unit_draft', 'resourceId', v_draft.id, 'version', v_draft.version, 'collectionId', c.id, 'unitId', v_unit);
    ELSE
      SELECT * INTO sv FROM workhub.submission_versions WHERE school_id = p_ctx.school_id AND unit_id = v_unit AND id = p_parent ->> 'submissionId';
      IF sv.id IS NULL THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
      -- 철회된 제출판의 파일은 내려받지 않는다(화면도 제공하지 않음)
      IF EXISTS (SELECT 1 FROM workhub.submission_withdrawals w WHERE w.school_id = sv.school_id AND w.submission_id = sv.id) THEN
        RETURN jsonb_build_object('code', 'FORBIDDEN');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM workhub.submission_files sf WHERE sf.school_id = sv.school_id AND sf.submission_id = sv.id AND sf.file_id = f.id) THEN
        RETURN jsonb_build_object('code', 'NOT_FOUND');
      END IF;
      r := jsonb_build_object('resourceType', 'submission', 'resourceId', sv.id, 'version', sv.version_no, 'collectionId', c.id, 'unitId', v_unit);
    END IF;
  END IF;
  -- R1S: 읽기(목록 파일 내려받기·ZIP·Storage 읽기)는 쓰기와 다른 판정을 쓴다. 지금 쓰기 정책이 HWPX 로 줄어도
  --      이미 받은 PDF 등 과거 파일을 막지 않는다(요청서 42 '보존 1'). 상태·정리 원장·요청 정책·미검사 판정은 그대로.
  v_code := workhub_private.c_file_read_problem(f, p_eff, s.file_policy);
  RETURN r || jsonb_build_object('code', v_code);
END $$;

CREATE OR REPLACE FUNCTION workhub_private.c_prepare(p_ctx workhub_private.actor_context, p_parent jsonb, p_file jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_key text; par jsonb; v_name text; v_ext text; v_bytes integer; v_sha text; v_req_sha text; r workhub.idempotency_receipts;
  eff jsonb; c workhub.collections; u workhub.collection_units; s workhub.collection_schemas; v_ver integer; f workhub.file_objects; v_id text;
BEGIN
  v_key := workhub_private.c_request_key(p_key);
  par := workhub_private.c_parent(p_parent);
  -- 불변 제출판을 부모로 새 업로드를 받지 않는다
  IF par ->> 'kind' = 'submission' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.c_keys(p_file, ARRAY['name','extension','claimedBytes','claimedSha256'], NULL);
  v_name := workhub_private.c_text(p_file -> 'name', 255, true);
  IF jsonb_typeof(p_file -> 'extension') <> 'string' OR workhub_private.c_file_ext(v_name) IS DISTINCT FROM (p_file ->> 'extension') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_ext := p_file ->> 'extension';
  v_bytes := workhub_private.c_int(p_file -> 'claimedBytes', 1);
  IF v_bytes > 104857600 OR jsonb_typeof(p_file -> 'claimedSha256') <> 'string' OR (p_file ->> 'claimedSha256') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_sha := p_file ->> 'claimedSha256';
  v_req_sha := workhub_private.request_sha256(jsonb_build_object('parent', par, 'file', p_file));
  r := workhub_private.claim_receipt(p_ctx, 'file.prepare', v_key, v_req_sha);
  IF r.idem_key IS NOT NULL THEN
    -- 같은 요청 재시도: 같은 fileId·경로를 돌려준다(현재 부모 접근권은 다시 확인)
    SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = r.resource_id;
    IF f.id IS NULL OR NOT workhub_private.c_intent_ok(p_ctx, f.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN workhub_private.c_upload_dto(f);
  END IF;
  eff := workhub_private.c_require(p_ctx, 'write');
  IF par ->> 'kind' = 'template' THEN
    IF NOT workhub_private.c_reads(p_ctx, par ->> 'requestId') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = par ->> 'requestId' FOR SHARE;
    IF NOT workhub_private.c_is_manager(p_ctx, c.id) OR c.state <> 'draft' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF c.version <> (par ->> 'version')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    SELECT * INTO s FROM workhub.collection_schemas WHERE school_id = c.school_id AND id = c.current_schema_id;
  ELSE
    u := workhub_private.c_lock_unit(p_ctx, par ->> 'requestId', par ->> 'unitId');
    IF NOT workhub_private.c_is_unit_member(p_ctx, u.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT d.version INTO v_ver FROM workhub.unit_drafts d WHERE d.school_id = u.school_id AND d.unit_id = u.id AND d.schema_id = u.active_schema_id;
    IF COALESCE(v_ver, 0) <> (par ->> 'version')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    SELECT * INTO s FROM workhub.collection_schemas WHERE school_id = u.school_id AND id = u.active_schema_id;
  END IF;
  IF s.file_policy IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- 현재 학교∩공통 정책과 요청 정책을 모두 만족해야 예약을 낸다
  IF NOT ((eff -> 'file' -> 'extensions') ? v_ext) OR NOT ((s.file_policy -> 'extensions') ? v_ext)
     OR v_bytes > (eff -> 'file' ->> 'maxFileBytes')::bigint OR v_bytes > (s.file_policy ->> 'maxFileBytes')::bigint THEN
    RAISE EXCEPTION 'FILE_FAILED';
  END IF;
  -- 계정당 열린 업로드 예약 100개 상한(경로 대량 발급 방지)
  IF (SELECT count(*) FROM workhub.file_objects WHERE owner_account_id = p_ctx.account_id AND state = 'uploading'
        AND upload_expires_at > clock_timestamp()) >= 100 THEN
    RAISE EXCEPTION 'NOT_READY';
  END IF;
  v_id := gen_random_uuid()::text;
  INSERT INTO workhub.file_objects (id, school_id, owner_account_id, owner_membership_id, storage_key, original_name, extension,
      claimed_bytes, claimed_sha256, upload_expires_at, safety_policy_scope_key, safety_policy_version_id, common_safety_policy_version_id)
  VALUES (v_id, p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id,
      p_ctx.school_id || '/' || v_id || '/' || replace(gen_random_uuid()::text, '-', ''), v_name, v_ext, v_bytes, v_sha,
      clock_timestamp() + make_interval(mins => (eff ->> 'uploadTtlMinutes')::integer),
      's:' || p_ctx.school_id, eff ->> 'uploadPolicyId', eff ->> 'commonPolicyId')
  RETURNING * INTO f;
  -- R1S: 기본 확인 프로필로 받은 예약이면 그 사실을 같은 트랜잭션에 고정한다(검증 작업 대기열에 넣지 않는 근거).
  IF eff ->> 'basicProfile' IS NOT NULL THEN
    INSERT INTO workhub.file_basic_checks (file_id, school_id, profile, activation_id)
    VALUES (f.id, f.school_id, eff ->> 'basicProfile', eff ->> 'basicActivationId');
  END IF;
  INSERT INTO workhub.collection_file_intents (file_id, school_id, purpose, collection_id, unit_id, expected_version, uploader_account_id, uploader_membership_id)
  VALUES (f.id, f.school_id, par ->> 'kind', par ->> 'requestId', par ->> 'unitId', (par ->> 'version')::integer, p_ctx.account_id, p_ctx.membership_id);
  PERFORM workhub_private.store_receipt(p_ctx, 'file.prepare', v_key, v_req_sha, 'file_object', f.id, f.version);
  PERFORM workhub_private.write_audit(p_ctx, 'file.prepare', 'file_object', f.id, f.version, 'school', v_key,
    jsonb_build_object('purpose', par ->> 'kind', 'request_id', par ->> 'requestId', 'unit_id', par ->> 'unitId'));
  PERFORM workhub_private.emit_outbox(p_ctx, 'file.prepared', 'file_object', f.id, f.version, jsonb_build_object('file_id', f.id));
  RETURN workhub_private.c_upload_dto(f);
END $$;

CREATE OR REPLACE FUNCTION workhub_private.c_complete(p_ctx workhub_private.actor_context, p_file_id text, p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_key text; v_id text; v_sha text; r workhub.idempotency_receipts; f workhub.file_objects; o jsonb;
BEGIN
  v_key := workhub_private.c_request_key(p_key);
  v_id := workhub_private.c_id(to_jsonb(p_file_id));
  v_sha := workhub_private.request_sha256(jsonb_build_object('fileId', v_id));
  r := workhub_private.claim_receipt(p_ctx, 'file.complete', v_key, v_sha);
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = v_id FOR UPDATE;
  IF f.id IS NULL OR f.owner_account_id <> p_ctx.account_id OR NOT workhub_private.c_intent_ok(p_ctx, f.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF f.state = 'uploading' AND NOT EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id) THEN
    o := workhub_private.c_object_owner(f.bucket, f.storage_key);
    IF o IS NOT NULL THEN
      PERFORM workhub_private.c_require(p_ctx, 'write');
      IF o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN
        UPDATE workhub.file_objects SET state = 'rejected', reject_reason = 'owner_mismatch', version = f.version + 1 WHERE id = f.id RETURNING * INTO f;
      ELSE
        UPDATE workhub.file_objects SET state = 'uploaded', storage_object_id = (o ->> 'id')::uuid, uploaded_at = clock_timestamp(), version = f.version + 1
         WHERE id = f.id RETURNING * INTO f;
        -- R1S: 기본 확인 프로필 파일은 검증 작업자 대기열에 넣지 않는다(서버 API 의 claim/finish 가 확인한다).
        IF NOT EXISTS (SELECT 1 FROM workhub.file_basic_checks b WHERE b.file_id = f.id) THEN
          INSERT INTO workhub.file_verification_jobs (school_id, file_id) VALUES (f.school_id, f.id) ON CONFLICT (file_id) DO NOTHING;
        END IF;
        PERFORM workhub_private.emit_outbox(p_ctx, 'file.uploaded', 'file_object', f.id, f.version, jsonb_build_object('file_id', f.id));
      END IF;
      PERFORM workhub_private.write_audit(p_ctx, 'file.upload_confirm', 'file_object', f.id, f.version, 'school', v_key,
        jsonb_build_object('state', f.state));
    END IF;
  END IF;
  IF r.idem_key IS NULL THEN
    PERFORM workhub_private.store_receipt(p_ctx, 'file.complete', v_key, v_sha, 'file_object', f.id, f.version);
  END IF;
  RETURN workhub_private.c_status_dto(f);
END $$;

-- <<< R1-03 함수 교체 묶음 끝

-- ----------------------------------------------------------------------------
-- 9. 권한 · RLS — 새 표·함수는 API 역할(anon·authenticated·service_role)에 0. 공개 함수는 R1S-02 가 만든다.
--    R1-03 이 이미 0 으로 만든 상태를 그대로 다시 적용하는 것이라 기존 권한은 바뀌지 않는다(workhub_storage 는 건드리지 않음).
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('workhub','workhub_private') AND c.relkind = 'r' AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
  END LOOP;
END $$;

INSERT INTO workhub_private.r1s_installs (batch, release) VALUES ('R1S-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 10. 검증 — 모든 행의 status 가 ok 여야 한다. R1S-02 전이라 기본 확인은 아직 쓸 수 없다(정상).
-- ----------------------------------------------------------------------------
SELECT 'R1S-01-1' AS no, '새 표 6개 존재 · RLS 켜짐 · API 역할 권한 0' AS item,
       CASE WHEN count(DISTINCT c.oid) = 6 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status, count(DISTINCT c.oid)::text AS value
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.oid IN ('workhub_private.r1s_installs'::regclass, 'workhub.file_check_profiles'::regclass, 'workhub.basic_profile_activations'::regclass,
                'workhub.basic_profile_activation_log'::regclass, 'workhub.file_basic_checks'::regclass, 'workhub.file_basic_leases'::regclass)
UNION ALL
SELECT 'R1S-01-2', '프로필 hwpx_basic_v1 1행(HWPX·30MiB·악성 검사 없음)',
       CASE WHEN count(*) = 1 AND bool_and(extensions = ARRAY['hwpx'] AND max_file_bytes = 31457280 AND NOT malware_scan AND NOT content_validation)
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.file_check_profiles
UNION ALL
SELECT 'R1S-01-3', '활성화 0행(기본값 = 꺼짐)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text FROM workhub.basic_profile_activations
UNION ALL
SELECT 'R1S-01-4', '내부 함수(workhub·workhub_private)는 API 역할 실행 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'R1S-01-5', '활성 학교의 준비 상태는 R1 과 같은 판정(활성화 없음 → 기존 경로)',
       CASE WHEN bool_and(NOT workhub_private.c_basic_mode(s.id)) THEN 'ok' ELSE 'FAIL' END,
       string_agg(workhub_private.c_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason', ',')
FROM workhub.schools s WHERE s.status = 'active'
ORDER BY 1;
