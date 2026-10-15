-- ============================================================================
-- R1-03  수합 공개 함수 9개 · 검증 작업자 함수 8개 · 비공개 버킷 · Storage 정책 2개
--
-- 요청서: docs/workhub/32-collection-server-sql-request.md (PR #34) §3~§6·§8
-- 입출력·오류 대응: R1_호환함수_입출력.md · 설계 근거: R1_설계결정.md
--
-- ▣ 지키는 것
--   - 기존 Storage 버킷·파일·정책을 바꾸지 않는다. 새 비공개 버킷 1개와 새 버킷에만 걸리는 정책 2개(INSERT·SELECT)를 더한다.
--     UPDATE·DELETE 정책은 만들지 않는다(덮어쓰기·브라우저 삭제 불가).
--   - 기존 공개 함수(R0 7개 포함)를 교체하지 않는다. 새 함수 이름은 모두 새것이다.
--   - 준비 상태(readiness)는 고정값이 아니다. 검증 작업자·승인된 정책이 없으면 false 다.
--     이 파일을 적용해도 작업자(R1-05)·정책(R1-06) 전에는 수합을 쓸 수 없다.
--
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
--   마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: R1-01 · R1-02 (같은 판).
-- ============================================================================
BEGIN;

DO $$
DECLARE v_owner oid;
BEGIN
  IF to_regclass('workhub_private.batch_installs') IS NULL THEN
    RAISE EXCEPTION 'R1 중단: R1-02(2026-10-15.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.batch_installs WHERE batch = 'R1-02' AND release = '2026-10-15.1') THEN
    RAISE EXCEPTION 'R1 중단: R1-02(2026-10-15.1)가 적용되어 있지 않습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.batch_installs WHERE batch = 'R1-03')
     OR to_regprocedure('public.workhub_collection_readiness(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'R1 중단: R1-03 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'R1 중단: storage.objects 의 RLS 가 꺼져 있습니다. Storage 설정을 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-collection-files' OR name = 'workhub-collection-files')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'workhub\_%') THEN
    RAISE EXCEPTION 'R1 중단: workhub 버킷 또는 workhub_ 이름의 Storage 정책이 이미 있습니다.';
  END IF;
  -- 정책 생성 가능 여부는 실제로 만들어 보고(하위 트랜잭션) 되돌려서 판단한다.
  -- Supabase 의 storage.objects 주인은 Storage 전용 역할이고, postgres 는 주인 권한을 물려받지 않은 채
  -- 별도 허용(supautils 의 정책 허용 설정)으로 정책을 만든다. 그래서 "주인 역할의 권한이 있나"로 보면
  -- 실제로는 만들 수 있는데도 멈춘다(2026-10-15 운영 적용에서 확인). 시험 정책은 이 블록과 함께 사라진다.
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'storage.objects'::regclass;
  BEGIN
    CREATE POLICY workhub_r1_probe ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (false);
    RAISE EXCEPTION USING ERRCODE = 'R1PRB', MESSAGE = 'R1-03 정책 생성 시험(되돌림)';
  EXCEPTION
    WHEN SQLSTATE 'R1PRB' THEN NULL;
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'R1 중단: 현재 역할(%)이 storage.objects 에 정책을 만들 수 없습니다(%).', current_user, SQLERRM;
  END;
  IF NOT (has_table_privilege(current_user, 'storage.objects', 'SELECT')
          AND ((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) OR pg_has_role(current_user, v_owner, 'USAGE'))) THEN
    RAISE EXCEPTION 'R1 중단: 현재 역할(%)이 storage.objects 를 RLS 없이 읽을 수 없습니다.', current_user;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'objects'
        AND column_name IN ('id','bucket_id','name','owner','owner_id')) <> 5 THEN
    RAISE EXCEPTION 'R1 중단: storage.objects 에 id·bucket_id·name·owner·owner_id 열이 모두 있어야 합니다(Storage 판 확인).';
  END IF;
  -- 서명 URL 발급을 정책에서 막으려면 Storage 가 요청 종류를 storage.operation 설정으로 알려 주는 판이어야 한다.
  -- storage.operation() 함수가 그 판의 표식이다(Supabase Storage tenant migration 0024).
  IF to_regprocedure('storage.operation()') IS NULL THEN
    RAISE EXCEPTION 'R1 중단: storage.operation() 이 없습니다. 서명 URL 차단을 판정할 수 없는 Storage 판입니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'workhub_storage') THEN
    RAISE EXCEPTION 'R1 중단: workhub_storage schema 가 이미 있습니다.';
  END IF;
END $$;

-- Storage 정책이 부르는 판정 함수 전용 schema. API 에 노출하지 않는다(PostgREST db-schemas 에 넣지 않는다).
CREATE SCHEMA workhub_storage;

-- ----------------------------------------------------------------------------
-- 1. 설치 비밀값(cursor 서명)·Storage 정책 지문
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.r1_secrets (
  singleton  boolean NOT NULL DEFAULT true,
  k_ipad     bytea NOT NULL,
  k_opad     bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT r1_secrets_pkey PRIMARY KEY (singleton),
  CONSTRAINT r1_secrets_singleton_check CHECK (singleton),
  CONSTRAINT r1_secrets_length_check CHECK (length(k_ipad) = 64 AND length(k_opad) = 64)
);
-- HMAC-SHA256 키: 강한 난수(gen_random_uuid 2개, 244 bit)를 64 byte 로 늘려 ipad/opad 를 미리 계산해 둔다.
DO $$
DECLARE k bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) || '\x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'::bytea;
  i integer; vi bytea; vo bytea;
BEGIN
  k := substring(k FROM 1 FOR 64); vi := k; vo := k;
  FOR i IN 0..63 LOOP
    vi := set_byte(vi, i, get_byte(k, i) # 54);
    vo := set_byte(vo, i, get_byte(k, i) # 92);
  END LOOP;
  INSERT INTO workhub_private.r1_secrets (k_ipad, k_opad) VALUES (vi, vo);
END $$;
CREATE TRIGGER r1_secrets_immutable BEFORE UPDATE OR DELETE ON workhub_private.r1_secrets
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 이 파일이 만든 Storage 정책의 정확한 식. 준비 상태 판정이 현재 정책과 대조한다(누가 고치면 storage_missing).
CREATE TABLE workhub_private.r1_storage_policies (
  policy_name name NOT NULL,
  cmd         "char" NOT NULL,
  expr_md5    text NOT NULL,
  CONSTRAINT r1_storage_policies_pkey PRIMARY KEY (policy_name)
);
CREATE TRIGGER r1_storage_policies_immutable BEFORE UPDATE OR DELETE ON workhub_private.r1_storage_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 입력 판정 — 앱 validation.ts 와 같은 규칙(JS 문자열 길이·제어문자·trim)
-- ----------------------------------------------------------------------------
-- JS String.length(UTF-16 단위) = 코드포인트 수 + BMP 밖 문자 수
CREATE FUNCTION workhub_private.js_length(p text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT length(p) + regexp_count(p, '[\U00010000-\U0010FFFF]')
$$;

CREATE FUNCTION workhub_private.c_text(v jsonb, p_max integer, p_required boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE t text;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  t := v #>> '{}';
  IF workhub_private.js_length(t) > p_max OR t ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]'
     OR (p_required AND workhub_private.js_trim(t) = '') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN t;
END $$;

CREATE FUNCTION workhub_private.c_id(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v #>> '{}';
END $$;

-- 정수(문자열 숫자·소수·음수 거부)
CREATE FUNCTION workhub_private.c_int(v jsonb, p_min integer) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'number' OR v::text !~ '^(0|[1-9][0-9]{0,8})$' OR v::text::integer < p_min THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN v::text::integer;
END $$;

CREATE FUNCTION workhub_private.c_bool(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v::text::boolean;
END $$;

-- 실제 날짜 'YYYY-MM-DD'. p_empty_ok 이면 '' → NULL
CREATE FUNCTION workhub_private.c_date(v jsonb, p_empty_ok boolean) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s text; d date;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  s := v #>> '{}';
  IF p_empty_ok AND s = '' THEN RETURN NULL; END IF;
  IF s !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN d := s::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_INPUT'; END;
  IF to_char(d, 'YYYY-MM-DD') <> s THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN d;
END $$;

-- 정확한 키 집합(필수 전부 + 선택 일부, 그 밖의 키 없음)
CREATE FUNCTION workhub_private.c_keys(v jsonb, p_required text[], p_optional text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'object'
     OR EXISTS (SELECT 1 FROM unnest(p_required) k WHERE NOT (v ? k))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE NOT (k = ANY (p_required) OR k = ANY (COALESCE(p_optional, ARRAY[]::text[])))) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 숫자 응답: null 또는 JS 에서 유한한 수(0 은 유효)
CREATE FUNCTION workhub_private.c_number(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF v IS NULL OR jsonb_typeof(v) NOT IN ('number','null') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_typeof(v) = 'number' AND abs(v::text::numeric) > 1.7976931348623157e308 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v;
END $$;

-- 파일 이름 → 확장자(앱 files/validation.ts fileExtension 과 같은 규칙). 맞지 않으면 NULL
CREATE FUNCTION workhub_private.c_file_ext(p_name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_ext text; v_stem text;
BEGIN
  IF p_name IS NULL OR p_name = '' OR p_name <> workhub_private.js_trim(p_name) OR right(p_name, 1) = '.'
     OR p_name ~ '[\u0001-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩]'
     OR octet_length(p_name) > 240 OR lower(p_name) ~ '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)' THEN
    RETURN NULL;
  END IF;
  v_ext := lower(substring(p_name FROM '\.([A-Za-z0-9]+)$'));
  IF v_ext IS NULL THEN RETURN NULL; END IF;
  v_stem := left(p_name, length(p_name) - length(v_ext) - 1);
  IF workhub_private.js_trim(replace(v_stem, '.', '')) = '' THEN RETURN NULL; END IF;
  RETURN v_ext;
END $$;

CREATE FUNCTION workhub_private.c_iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- 파일 참조 목록(FileReference[]) — 정확한 키, 이름·확장자·크기·해시, 정책 한도, 중복(ID·NFC 소문자 이름·해시) 거부
CREATE FUNCTION workhub_private.c_file_refs(p jsonb, p_policy jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE e jsonb; v_ids text[] := '{}'; v_names text[] := '{}'; v_hashes text[] := '{}'; v_name text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > (p_policy ->> 'maxFiles')::integer THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) x LOOP
    PERFORM workhub_private.c_keys(e, ARRAY['id','name','extension','bytes','sha256'], NULL);
    PERFORM workhub_private.c_id(e -> 'id');
    IF jsonb_typeof(e -> 'name') <> 'string' OR jsonb_typeof(e -> 'extension') <> 'string' OR jsonb_typeof(e -> 'sha256') <> 'string'
       OR (e ->> 'sha256') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(e -> 'bytes') <> 'number' OR (e -> 'bytes')::text !~ '^[1-9][0-9]{0,15}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_name := e ->> 'name';
    IF workhub_private.c_file_ext(v_name) IS DISTINCT FROM (e ->> 'extension') OR NOT ((p_policy -> 'extensions') ? (e ->> 'extension'))
       OR (e ->> 'bytes')::bigint > (p_policy ->> 'maxFileBytes')::bigint THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF (e ->> 'id') = ANY (v_ids) OR lower(normalize(v_name, NFC)) = ANY (v_names) OR (e ->> 'sha256') = ANY (v_hashes) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_ids := v_ids || (e ->> 'id'); v_names := v_names || lower(normalize(v_name, NFC)); v_hashes := v_hashes || (e ->> 'sha256');
  END LOOP;
  RETURN p;
END $$;

-- 앱 FilePolicy {extensions, maxFileBytes, maxFiles}
CREATE FUNCTION workhub_private.c_file_policy(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  PERFORM workhub_private.c_keys(p, ARRAY['extensions','maxFileBytes','maxFiles'], NULL);
  IF NOT workhub_private.policy_value_valid('file.safety', p || '{"allowUnscanned":false}'::jsonb) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN p;
END $$;

-- CollectionInput → 정규화(제목·문항명·단위명은 JS trim). 참조한 소속 ID 목록은 별도 함수가 뽑는다.
CREATE FUNCTION workhub_private.c_norm_input(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_units jsonb := '[]'; u jsonb; v_resp text; v_contrib jsonb; v_labels text[] := '{}'; v_label text;
  v_text_label text; v_number_label text; v_mode text; v_reviewer text; v_fc jsonb := NULL; v_policy jsonb; c jsonb;
BEGIN
  PERFORM workhub_private.c_keys(p, ARRAY['title','instructions','dueDate','reviewMode','reviewerMemberId','textLabel','textRequired',
    'numberLabel','numberRequired','units'], ARRAY['fileCollection']);
  IF jsonb_typeof(p -> 'reviewMode') <> 'string' OR (p ->> 'reviewMode') NOT IN ('none','required') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_mode := p ->> 'reviewMode';
  IF jsonb_typeof(p -> 'reviewerMemberId') <> 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_reviewer := CASE WHEN p ->> 'reviewerMemberId' = '' THEN '' ELSE workhub_private.c_id(p -> 'reviewerMemberId') END;
  IF v_mode = 'required' AND v_reviewer = '' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_mode = 'none' THEN v_reviewer := ''; END IF;
  v_text_label := workhub_private.c_text(p -> 'textLabel', 120, false);
  v_number_label := workhub_private.c_text(p -> 'numberLabel', 120, false);
  -- 공백뿐인 문항명은 이름으로 보지 않는다(앱은 통과시키지만 서버는 거부: 빈 문항이 생기지 않게)
  IF (v_text_label <> '' AND workhub_private.js_trim(v_text_label) = '') OR (v_number_label <> '' AND workhub_private.js_trim(v_number_label) = '') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_text_label := workhub_private.js_trim(v_text_label); v_number_label := workhub_private.js_trim(v_number_label);
  IF (workhub_private.c_bool(p -> 'textRequired') AND v_text_label = '') OR (workhub_private.c_bool(p -> 'numberRequired') AND v_number_label = '') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF jsonb_typeof(p -> 'units') <> 'array' OR jsonb_array_length(p -> 'units') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR u IN SELECT x FROM jsonb_array_elements(p -> 'units') x LOOP
    PERFORM workhub_private.c_keys(u, ARRAY['label','responsibleMemberId','contributorMemberIds'], NULL);
    v_label := workhub_private.js_trim(workhub_private.c_text(u -> 'label', 100, true));
    v_resp := workhub_private.c_id(u -> 'responsibleMemberId');
    v_contrib := u -> 'contributorMemberIds';
    IF jsonb_typeof(v_contrib) <> 'array' OR jsonb_array_length(v_contrib) > 99
       OR (SELECT count(DISTINCT workhub_private.c_id(x)) FROM jsonb_array_elements(v_contrib) x) <> jsonb_array_length(v_contrib)
       OR v_contrib ? v_resp OR v_label = ANY (v_labels) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_labels := v_labels || v_label;
    v_units := v_units || jsonb_build_array(jsonb_build_object('label', v_label, 'responsibleMemberId', v_resp, 'contributorMemberIds', v_contrib));
  END LOOP;
  IF p ? 'fileCollection' THEN
    c := p -> 'fileCollection';
    PERFORM workhub_private.c_keys(c, ARRAY['policy','required','templates'], NULL);
    v_policy := workhub_private.c_file_policy(c -> 'policy');
    v_fc := jsonb_build_object('policy', v_policy, 'required', workhub_private.c_bool(c -> 'required'),
                               'templates', workhub_private.c_file_refs(c -> 'templates', v_policy));
  END IF;
  IF v_text_label = '' AND v_number_label = '' AND v_fc IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN jsonb_build_object(
    'title', workhub_private.js_trim(workhub_private.c_text(p -> 'title', 120, true)),
    'instructions', workhub_private.c_text(p -> 'instructions', 3000, false),
    'dueDate', to_char(workhub_private.c_date(p -> 'dueDate', false), 'YYYY-MM-DD'),
    'reviewMode', v_mode, 'reviewerMemberId', v_reviewer,
    'textLabel', v_text_label, 'textRequired', (p -> 'textRequired')::text::boolean,
    'numberLabel', v_number_label, 'numberRequired', (p -> 'numberRequired')::text::boolean,
    'units', v_units, 'fileCollection', COALESCE(v_fc, 'null'::jsonb));
END $$;

-- AnswerInput {text, number, files?}
CREATE FUNCTION workhub_private.c_norm_answer(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  PERFORM workhub_private.c_keys(p, ARRAY['text','number'], ARRAY['files']);
  RETURN jsonb_build_object('text', workhub_private.c_text(p -> 'text', 5000, false), 'number', workhub_private.c_number(p -> 'number'),
    'files', CASE WHEN p ? 'files' THEN workhub_private.c_file_refs(p -> 'files',
               '{"extensions":["pdf","hwp","hwpx","docx","xlsx","pptx"],"maxFileBytes":104857600,"maxFiles":512}'::jsonb) ELSE 'null'::jsonb END);
END $$;

-- 명령(CollectionCommand) 모양 검사 → 정규화 입력을 붙여 돌려준다
CREATE FUNCTION workhub_private.c_norm_command(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_kind text; r jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 262144 OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_kind := p ->> 'kind';
  CASE v_kind
    WHEN 'create' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','input'], NULL);
      RETURN jsonb_build_object('kind', v_kind, 'input', workhub_private.c_norm_input(p -> 'input'));
    WHEN 'update' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','expectedVersion','input'], NULL);
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'),
        'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 1), 'input', workhub_private.c_norm_input(p -> 'input'));
    WHEN 'publish' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','expectedVersion'], NULL);
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'),
        'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 1));
    WHEN 'save_draft' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','expectedVersion','input'], NULL);
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
        'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 0), 'input', workhub_private.c_norm_answer(p -> 'input'));
    WHEN 'submit' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','draftId','expectedDraftVersion','expectedVersion','reason'], ARRAY['correctionRequestId']);
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
        'draftId', workhub_private.c_id(p -> 'draftId'), 'expectedDraftVersion', workhub_private.c_int(p -> 'expectedDraftVersion', 1),
        'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 1), 'reason', workhub_private.c_text(p -> 'reason', 1000, false),
        'correctionRequestId', CASE WHEN p ? 'correctionRequestId' THEN to_jsonb(workhub_private.c_id(p -> 'correctionRequestId')) ELSE 'null'::jsonb END);
    WHEN 'review' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','submissionId','expectedVersion','decision','note','dueDate'], NULL);
      IF jsonb_typeof(p -> 'decision') <> 'string' OR (p ->> 'decision') NOT IN ('accepted','changes_requested') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
        'submissionId', workhub_private.c_id(p -> 'submissionId'), 'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 1),
        'decision', p ->> 'decision', 'note', workhub_private.c_text(p -> 'note', 1000, p ->> 'decision' = 'changes_requested'),
        'dueDate', to_jsonb(workhub_private.c_date(p -> 'dueDate', p ->> 'decision' = 'accepted')));
    WHEN 'withdraw' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','submissionId','expectedVersion','reason'], NULL);
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
        'submissionId', workhub_private.c_id(p -> 'submissionId'), 'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 1),
        'reason', workhub_private.c_text(p -> 'reason', 1000, true));
    WHEN 'open_correction' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','expectedVersion','dueDate','reason'], NULL);
      RETURN jsonb_build_object('kind', v_kind, 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
        'expectedVersion', workhub_private.c_int(p -> 'expectedVersion', 1), 'dueDate', to_jsonb(workhub_private.c_date(p -> 'dueDate', false)),
        'reason', workhub_private.c_text(p -> 'reason', 1000, true));
    ELSE
      RAISE EXCEPTION 'INVALID_INPUT';
  END CASE;
END $$;

-- 요청 번호: 8~200자, 공백뿐 아님, 제어문자 없음
CREATE FUNCTION workhub_private.c_request_key(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR workhub_private.js_length(p) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.c_text(to_jsonb(p), 200, true);
  RETURN p;
END $$;

-- ----------------------------------------------------------------------------
-- 3. 정책·준비 상태
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_switch() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT state FROM workhub_private.r1_switch), 'all_stopped')
$$;

-- 학교의 오늘 유효한 정책 3종과 사용 가능한 파일 정책(학교 ∩ 공통). 하나라도 없거나 교집합이 비면 NULL.
CREATE FUNCTION workhub_private.c_effective(p_school text, p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u workhub.policy_versions; c workhub.policy_versions; s workhub.policy_versions; v_ext text[];
BEGIN
  SELECT * INTO u FROM workhub.policy_versions WHERE scope_key = 's:' || p_school AND policy_key = 'collection.file_upload'
     AND state = 'published' AND p_date <@ daterange(effective_from, effective_to, '[)');
  SELECT * INTO c FROM workhub.policy_versions WHERE scope_key = 'c' AND policy_key = 'file.safety'
     AND state = 'published' AND p_date <@ daterange(effective_from, effective_to, '[)');
  SELECT * INTO s FROM workhub.policy_versions WHERE scope_key = 's:' || p_school AND policy_key = 'collection.submission'
     AND state = 'published' AND p_date <@ daterange(effective_from, effective_to, '[)');
  IF u.id IS NULL OR c.id IS NULL OR s.id IS NULL THEN RETURN NULL; END IF;
  v_ext := ARRAY(SELECT e FROM unnest(ARRAY['pdf','hwp','hwpx','docx','xlsx','pptx']) WITH ORDINALITY x(e, o)
                 WHERE (u.value -> 'extensions') ? e AND (c.value -> 'extensions') ? e ORDER BY o);
  IF cardinality(v_ext) = 0 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'uploadPolicyId', u.id, 'commonPolicyId', c.id, 'submissionPolicyId', s.id,
    'file', jsonb_build_object('extensions', to_jsonb(v_ext),
       'maxFileBytes', least((u.value ->> 'maxFileBytes')::bigint, (c.value ->> 'maxFileBytes')::bigint),
       'maxFiles', least((u.value ->> 'maxFiles')::integer, (c.value ->> 'maxFiles')::integer)),
    'allowUnscanned', (u.value ->> 'allowUnscanned')::boolean AND (c.value ->> 'allowUnscanned')::boolean,
    'uploadTtlMinutes', (u.value ->> 'uploadTtlMinutes')::integer,
    'allowWithdrawal', (s.value ->> 'allowWithdrawal')::boolean,
    'allowCorrectionWindow', (s.value ->> 'allowCorrectionWindow')::boolean,
    'maxCorrectionDays', (s.value ->> 'maxCorrectionDays')::integer,
    'unattachedRetentionDays', (s.value ->> 'unattachedRetentionDays')::integer);
END $$;

-- 다른 버킷으로 한정된 정책식인가: 식 전체가 (bucket_id = '다른버킷') 이거나, 최상위 AND 의 첫 항이 그것.
-- 판정할 수 없는 모양은 안전하지 않은 것으로 본다(준비 상태를 닫는 쪽으로 실패).
CREATE FUNCTION workhub_private.c_other_bucket(p_expr text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_expr IS NOT NULL
     AND (p_expr ~ '^\(bucket_id = ''[^'']*''::text\)$' OR p_expr ~ '^\(\(bucket_id = ''[^'']*''::text\) AND ')
     AND substring(p_expr FROM '^\(+bucket_id = ''([^'']*)''::text\)') <> 'workhub-collection-files'
$$;

-- Storage 준비: 비공개 버킷 · RLS 켜짐 · 이 파일의 정책 2개가 그대로 · 다른 permissive 정책이 새 버킷까지 열지 않음
CREATE FUNCTION workhub_private.c_storage_ok() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rel oid := to_regclass('storage.objects'); p record; v_api oid[];
BEGIN
  IF v_rel IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-collection-files' AND name = 'workhub-collection-files' AND public IS FALSE) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolbypassrls OR rolsuper)) THEN RETURN false; END IF;
  v_api := ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'));
  IF (SELECT count(*) FROM pg_policy pol JOIN workhub_private.r1_storage_policies e ON e.policy_name = pol.polname
       WHERE pol.polrelid = v_rel AND pol.polcmd = e.cmd AND pol.polpermissive
         AND pol.polroles = ARRAY(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
         AND md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = e.expr_md5) <> 2 THEN
    RETURN false;
  END IF;
  FOR p IN SELECT pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
             FROM pg_policy pol
            WHERE pol.polrelid = v_rel AND pol.polpermissive
              AND pol.polname NOT IN (SELECT policy_name FROM workhub_private.r1_storage_policies)
              AND (0::oid = ANY (pol.polroles) OR pol.polroles && v_api) LOOP
    IF (p.polcmd IN ('r','w','d','*') AND NOT workhub_private.c_other_bucket(p.q))
       OR (p.polcmd IN ('a','*') AND p.w IS NOT NULL AND NOT workhub_private.c_other_bucket(p.w))
       OR (p.polcmd = 'a' AND NOT workhub_private.c_other_bucket(p.w))
       OR (p.polcmd = 'w' AND p.w IS NOT NULL AND NOT workhub_private.c_other_bucket(p.w)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 검증 작업자 준비: 만료 전 heartbeat · 활성 주체 · file.verify · 이 학교 범위 승인 · 실행 경로 연결 · 필수 검사 능력
CREATE FUNCTION workhub_private.c_verifier_ok(p_school text, p_need_malware boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM workhub.file_verifier_heartbeats h
      JOIN workhub.service_principals p ON p.id = h.service_principal_id
     WHERE h.expires_at > clock_timestamp() AND h.reported_at <= clock_timestamp()
       AND p.active AND 'file.verify' = ANY (p.allowed_actions)
       AND EXISTS (SELECT 1 FROM workhub.service_principal_scopes s
                    WHERE s.service_principal_id = p.id AND s.scope_key = 's:' || p_school AND s.revoked_at IS NULL
                      AND s.valid_from <= clock_timestamp() AND (s.valid_to IS NULL OR clock_timestamp() < s.valid_to))
       AND (EXISTS (SELECT 1 FROM workhub_private.api_role_principals a WHERE a.service_principal_id = p.id AND a.revoked_at IS NULL)
            OR EXISTS (SELECT 1 FROM workhub_private.db_identity_principals d WHERE d.service_principal_id = p.id))
       AND (h.capability -> 'checks') @> '["size","sha256","signature","container","encryption"]'::jsonb
       AND (NOT p_need_malware OR (h.capability -> 'checks') @> '["malware"]'::jsonb))
$$;

CREATE FUNCTION workhub_private.c_db_ok() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.batch_installs WHERE batch IN ('R1-01','R1-02','R1-03') AND release = '2026-10-15.1') = 3
$$;

-- CollectionReadiness {available, reason, policy}. 순서: DB(중지 포함) → Storage → 검증기 → 정책
CREATE FUNCTION workhub_private.c_readiness(p_school text, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE eff jsonb;
BEGIN
  IF NOT workhub_private.c_db_ok() OR workhub_private.c_switch() <> 'open' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'database_missing', 'policy', NULL);
  END IF;
  IF NOT workhub_private.c_storage_ok() THEN
    RETURN jsonb_build_object('available', false, 'reason', 'storage_missing', 'policy', NULL);
  END IF;
  IF NOT workhub_private.c_verifier_ok(p_school, false) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'verification_missing', 'policy', NULL);
  END IF;
  eff := workhub_private.c_effective(p_school, p_today);
  IF eff IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'policy_missing', 'policy', NULL);
  END IF;
  -- 미검사 파일을 허용하지 않는 정책이면 악성 검사를 하는 작업자가 있어야 파일이 ready 가 될 수 있다
  IF NOT (eff ->> 'allowUnscanned')::boolean AND NOT workhub_private.c_verifier_ok(p_school, true) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'verification_missing', 'policy', NULL);
  END IF;
  RETURN jsonb_build_object('available', true, 'reason', 'ready', 'policy', eff -> 'file');
END $$;

-- 단계별 요구: write = 완전 준비, read = DB 와 전체 중지 아님, access = 읽기 + Storage + 정책(검증기 중단은 내려받기를 막지 않는다)
CREATE FUNCTION workhub_private.c_require(p_ctx workhub_private.actor_context, p_level text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; eff jsonb;
BEGIN
  IF p_level = 'write' THEN
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

-- ----------------------------------------------------------------------------
-- 4. 읽기 권한(현재 기준) — 관리자·지정 검토자·단위 구성원. 같은 학교라는 사실만으로는 읽지 못한다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_is_manager(p_ctx workhub_private.actor_context, p_collection text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.collections c WHERE c.school_id = (p_ctx).school_id AND c.id = p_collection
                    AND c.owner_membership_id = (p_ctx).membership_id AND c.owner_account_id = (p_ctx).account_id)
$$;
CREATE FUNCTION workhub_private.c_is_reviewer(p_ctx workhub_private.actor_context, p_collection text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.collections c JOIN workhub.collection_reviewers r ON r.school_id = c.school_id AND r.collection_id = c.id
                  WHERE c.school_id = (p_ctx).school_id AND c.id = p_collection AND c.state = 'published' AND c.review_mode = 'required'
                    AND r.removed_at IS NULL AND r.membership_id = (p_ctx).membership_id AND r.account_id = (p_ctx).account_id)
$$;
CREATE FUNCTION workhub_private.c_is_unit_member(p_ctx workhub_private.actor_context, p_unit text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.collection_unit_members m
                  WHERE m.school_id = (p_ctx).school_id AND m.unit_id = p_unit AND m.removed_at IS NULL
                    AND m.membership_id = (p_ctx).membership_id AND m.account_id = (p_ctx).account_id)
$$;
CREATE FUNCTION workhub_private.c_reads(p_ctx workhub_private.actor_context, p_collection text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.c_is_manager(p_ctx, p_collection) OR workhub_private.c_is_reviewer(p_ctx, p_collection)
      OR EXISTS (SELECT 1 FROM workhub.collections c JOIN workhub.collection_unit_members m ON m.school_id = c.school_id AND m.collection_id = c.id
                  WHERE c.school_id = (p_ctx).school_id AND c.id = p_collection AND c.state = 'published' AND m.removed_at IS NULL
                    AND m.membership_id = (p_ctx).membership_id AND m.account_id = (p_ctx).account_id)
$$;
-- 단위를 볼 수 있는가: 관리자·검토자는 모든 단위, 그 밖에는 자기 단위만
CREATE FUNCTION workhub_private.c_sees_unit(p_ctx workhub_private.actor_context, p_collection text, p_unit text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.collection_units u WHERE u.school_id = (p_ctx).school_id AND u.collection_id = p_collection AND u.id = p_unit)
     AND (workhub_private.c_is_manager(p_ctx, p_collection) OR workhub_private.c_is_reviewer(p_ctx, p_collection)
          OR workhub_private.c_is_unit_member(p_ctx, p_unit))
$$;

-- ----------------------------------------------------------------------------
-- 5. 응답 DTO — 상세는 STABLE 함수 한 문장으로 만들어 하나의 snapshot 을 읽는다
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_file_ref(p_school text, p_file text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', f.id, 'name', f.original_name, 'extension', f.extension, 'bytes', f.size_bytes, 'sha256', f.sha256)
    FROM workhub.file_objects f WHERE f.school_id = p_school AND f.id = p_file
$$;

CREATE FUNCTION workhub_private.c_request_dto(p_school text, p_collection text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
      'title', c.title, 'instructions', c.purpose, 'dueDate', to_char(c.due_on, 'YYYY-MM-DD'), 'reviewMode', c.review_mode,
      'reviewerMemberId', CASE WHEN c.review_mode = 'required' THEN COALESCE((SELECT r.membership_id FROM workhub.collection_reviewers r
                            WHERE r.school_id = c.school_id AND r.collection_id = c.id AND r.removed_at IS NULL), '') ELSE '' END,
      'textLabel', COALESCE(ft.label, ''), 'textRequired', COALESCE(ft.required, false),
      'numberLabel', COALESCE(fn.label, ''), 'numberRequired', COALESCE(fn.required, false),
      'units', COALESCE((SELECT jsonb_agg(jsonb_build_object('label', pu.label, 'responsibleMemberId', pu.responsible_membership_id,
                  'contributorMemberIds', COALESCE((SELECT jsonb_agg(pm.membership_id ORDER BY pm.ordinal) FROM workhub.collection_plan_unit_members pm
                                                    WHERE pm.school_id = pu.school_id AND pm.plan_unit_id = pu.id), '[]'::jsonb)) ORDER BY pu.ordinal)
                  FROM workhub.collection_plan_units pu WHERE pu.school_id = c.school_id AND pu.collection_id = c.id), '[]'::jsonb),
      'id', c.id, 'schoolId', c.school_id, 'managerMemberId', c.owner_membership_id, 'status', c.state, 'version', c.version,
      'publishedAt', CASE WHEN c.published_at IS NULL THEN NULL ELSE workhub_private.c_iso(c.published_at) END)
    || CASE WHEN s.file_policy IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('fileCollection', jsonb_build_object(
         'policy', s.file_policy, 'required', s.file_required,
         'templates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.original_name, 'extension', f.extension,
                                  'bytes', f.size_bytes, 'sha256', f.sha256) ORDER BY t.ordinal)
                                FROM workhub.collection_template_files t JOIN workhub.file_objects f ON f.school_id = t.school_id AND f.id = t.file_id
                               WHERE t.school_id = c.school_id AND t.collection_id = c.id AND t.unlinked_at IS NULL), '[]'::jsonb))) END
  FROM workhub.collections c
  JOIN workhub.collection_schemas s ON s.school_id = c.school_id AND s.id = c.current_schema_id
  LEFT JOIN workhub.collection_fields ft ON ft.school_id = s.school_id AND ft.schema_id = s.id AND ft.field_key = 'text'
  LEFT JOIN workhub.collection_fields fn ON fn.school_id = s.school_id AND fn.schema_id = s.id AND fn.field_key = 'number'
  WHERE c.school_id = p_school AND c.id = p_collection
$$;

-- CollectionDetail. 초안은 담지 않는다. 한도(제출판 1,000) 초과면 NULL → 호출부가 NOT_READY 로 닫는다.
CREATE FUNCTION workhub_private.c_detail(p_ctx workhub_private.actor_context, p_collection text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (
    SELECT c.*, s.file_policy IS NOT NULL AS has_files,
           workhub_private.c_is_manager(p_ctx, c.id) OR workhub_private.c_is_reviewer(p_ctx, c.id) AS sees_all
      FROM workhub.collections c JOIN workhub.collection_schemas s ON s.school_id = c.school_id AND s.id = c.current_schema_id
     WHERE c.school_id = (p_ctx).school_id AND c.id = p_collection
  ), u AS (
    SELECT un.* FROM workhub.collection_units un, c
     WHERE un.school_id = c.school_id AND un.collection_id = c.id
       AND (c.sees_all OR workhub_private.c_is_unit_member(p_ctx, un.id))
  ), sv AS (
    SELECT s.*, u.first_submission_late AS unit_first_late, u.ordinal AS unit_ordinal
      FROM workhub.submission_versions s JOIN u ON u.school_id = s.school_id AND u.id = s.unit_id
  )
  SELECT CASE WHEN (SELECT count(*) FROM sv) > 1000 OR (SELECT count(*) FROM u) > 100 THEN NULL ELSE jsonb_build_object(
    'request', workhub_private.c_request_dto((p_ctx).school_id, p_collection),
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'requestId', u.collection_id, 'schoolId', u.school_id, 'label', u.label, 'responsibleMemberId', u.responsible_membership_id,
        'members', (SELECT jsonb_agg(jsonb_build_object('id', m.membership_id, 'userId', a.auth_user_id::text, 'name', a.display_name) ORDER BY m.ordinal)
                      FROM workhub.collection_unit_members m JOIN workhub.accounts a ON a.id = m.account_id
                     WHERE m.school_id = u.school_id AND m.unit_id = u.id AND m.removed_at IS NULL),
        'version', u.version, 'currentSubmissionId', u.current_submission_id, 'effectiveSubmissionId', u.effective_submission_id,
        'withdrawnSubmissionIds', COALESCE((SELECT jsonb_agg(w.submission_id ORDER BY w.recorded_at, w.id) FROM workhub.submission_withdrawals w
                                            WHERE w.school_id = u.school_id AND w.unit_id = u.id), '[]'::jsonb),
        'correctionUntil', COALESCE((SELECT to_char(cw.until_on, 'YYYY-MM-DD') FROM workhub.correction_windows cw
                                     WHERE cw.school_id = u.school_id AND cw.unit_id = u.id ORDER BY cw.created_at DESC, cw.id DESC LIMIT 1), ''),
        'correctionReason', COALESCE((SELECT cw.reason FROM workhub.correction_windows cw
                                      WHERE cw.school_id = u.school_id AND cw.unit_id = u.id ORDER BY cw.created_at DESC, cw.id DESC LIMIT 1), ''))
        ORDER BY u.ordinal) FROM u), '[]'::jsonb),
    'submissions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', sv.id, 'unitId', sv.unit_id, 'revision', sv.version_no, 'submittedBy', sv.submitted_by_membership_id,
        'receiptAt', workhub_private.c_iso(sv.receipt_at), 'receiptDate', to_char(sv.receipt_date, 'YYYY-MM-DD'),
        'dueSnapshot', to_char(sv.due_on_snapshot, 'YYYY-MM-DD'), 'initiallyLate', sv.unit_first_late,
        'correctionReason', sv.correction_reason, 'previousSubmissionId', sv.previous_submission_id, 'reviewMode', sv.review_mode,
        'requestKey', sv.request_id, 'text', sv.answers -> 'text', 'number', sv.answers -> 'number')
        || CASE WHEN (SELECT has_files FROM c) THEN jsonb_build_object('files', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.original_name, 'extension', f.extension, 'bytes', sf.size_bytes, 'sha256', sf.sha256) ORDER BY sf.ordinal)
               FROM workhub.submission_files sf JOIN workhub.file_objects f ON f.school_id = sf.school_id AND f.id = sf.file_id
              WHERE sf.school_id = sv.school_id AND sf.submission_id = sv.id), '[]'::jsonb)) ELSE '{}'::jsonb END
        ORDER BY sv.unit_ordinal, sv.version_no) FROM sv), '[]'::jsonb),
    'reviews', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'unitId', r.unit_id, 'submissionId', r.submission_id,
        'reviewerMemberId', r.reviewer_membership_id, 'decision', r.decision, 'note', r.note, 'recordedAt', workhub_private.c_iso(r.recorded_at))
        ORDER BY r.recorded_at, r.id) FROM workhub.submission_reviews r JOIN u ON u.school_id = r.school_id AND u.id = r.unit_id), '[]'::jsonb),
    'supplements', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cr.id, 'unitId', cr.unit_id, 'submissionId', cr.submission_id,
        'dueDate', to_char(cr.due_on, 'YYYY-MM-DD'), 'fulfilledSubmissionId', ff.submission_id,
        'fulfilledAt', CASE WHEN ff.id IS NULL THEN NULL ELSE workhub_private.c_iso(ff.fulfilled_at) END) ORDER BY cr.created_at, cr.id)
        FROM workhub.correction_requests cr JOIN u ON u.school_id = cr.school_id AND u.id = cr.unit_id
        LEFT JOIN workhub.collection_correction_fulfillments ff ON ff.school_id = cr.school_id AND ff.correction_request_id = cr.id AND ff.invalidated_at IS NULL), '[]'::jsonb),
    'withdrawals', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'unitId', w.unit_id, 'submissionId', w.submission_id,
        'actorMemberId', w.actor_membership_id, 'reason', w.reason, 'recordedAt', workhub_private.c_iso(w.recorded_at)) ORDER BY w.recorded_at, w.id)
        FROM workhub.submission_withdrawals w JOIN u ON u.school_id = w.school_id AND u.id = w.unit_id), '[]'::jsonb)) END
$$;

CREATE FUNCTION workhub_private.c_draft_dto(p_school text, p_draft text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', d.id, 'unitId', d.unit_id, 'lastEditorMemberId', d.updated_by_membership_id, 'version', d.version,
           'text', d.answers -> 'text', 'number', d.answers -> 'number')
      || CASE WHEN s.file_policy IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('files', COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'id', f.id, 'name', f.original_name, 'extension', f.extension, 'bytes', f.size_bytes, 'sha256', f.sha256) ORDER BY df.ordinal)
           FROM workhub.unit_draft_files df JOIN workhub.file_objects f ON f.school_id = df.school_id AND f.id = df.file_id
          WHERE df.school_id = d.school_id AND df.draft_id = d.id AND df.unlinked_at IS NULL), '[]'::jsonb)) END
    FROM workhub.unit_drafts d JOIN workhub.collection_schemas s ON s.school_id = d.school_id AND s.id = d.schema_id
   WHERE d.school_id = p_school AND d.id = p_draft
$$;

-- 봉투
CREATE FUNCTION workhub_private.c_ok(p_ctx workhub_private.actor_context, p_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contractVersion', 1, 'schoolId', (p_ctx).school_id, 'memberId', (p_ctx).membership_id, 'data', p_data)
$$;
CREATE FUNCTION workhub_private.c_err(p_ctx workhub_private.actor_context, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contractVersion', 1, 'schoolId', (p_ctx).school_id, 'memberId', (p_ctx).membership_id, 'error', jsonb_build_object('code', p_code))
$$;
-- 봉투로 돌려줄 업무 오류 코드(그 밖의 오류는 그대로 올려 보낸다 → 앱은 결과 불명확으로 처리)
CREATE FUNCTION workhub_private.c_business(p_message text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_message IN ('NOT_READY','INVALID_INPUT','FORBIDDEN','INACTIVE_MEMBERSHIP','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','FILE_NOT_READY','FILE_FAILED')
$$;

-- ----------------------------------------------------------------------------
-- 6. 명령 공통 — 대상 소속 검사·파일 사용 가능 판정·파일 연결
-- ----------------------------------------------------------------------------
-- 대상 소속: 같은 학교·활성·오늘 유효·계정 활성(승인 연결). 잠금은 ID 순 FOR SHARE.
CREATE FUNCTION workhub_private.c_check_members(p_ctx workhub_private.actor_context, p_ids text[]) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_ids text[] := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL AND x <> '' ORDER BY 1);
BEGIN
  PERFORM 1 FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = ANY (v_ids) ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
       WHERE m.school_id = p_ctx.school_id AND m.id = ANY (v_ids) AND m.status = 'active'
         AND p_ctx.school_today <@ daterange(m.valid_from, m.valid_to, '[)')
         AND a.status = 'active' AND a.legacy_approval_state = 'approved') <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 입력의 대상(책임자·공동 작성자)과 검토자를 검사한다. 검토자 계정이 어느 단위의 책임자 계정이면 자기검토가 되므로 거부.
CREATE FUNCTION workhub_private.c_validate_targets(p_ctx workhub_private.actor_context, p_input jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_ids text[]; v_reviewer text := p_input ->> 'reviewerMemberId';
BEGIN
  v_ids := ARRAY(SELECT u ->> 'responsibleMemberId' FROM jsonb_array_elements(p_input -> 'units') u
                 UNION SELECT c FROM jsonb_array_elements(p_input -> 'units') u, jsonb_array_elements_text(u -> 'contributorMemberIds') c);
  IF v_reviewer <> '' THEN v_ids := v_ids || v_reviewer; END IF;
  PERFORM workhub_private.c_check_members(p_ctx, v_ids);
  IF v_reviewer <> '' AND EXISTS (
       SELECT 1 FROM workhub.memberships r, jsonb_array_elements(p_input -> 'units') u, workhub.memberships m
        WHERE r.school_id = p_ctx.school_id AND r.id = v_reviewer
          AND m.school_id = p_ctx.school_id AND m.id = u ->> 'responsibleMemberId' AND m.account_id = r.account_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
END $$;

-- 요청 파일 정책이 학교 사용 가능 정책 안에 있는가
CREATE FUNCTION workhub_private.c_policy_within(p_req jsonb, p_eff_file jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_req IS NULL OR jsonb_typeof(p_req) = 'null' THEN RETURN; END IF;
  IF NOT ((p_eff_file -> 'extensions') @> (p_req -> 'extensions'))
     OR (p_req ->> 'maxFileBytes')::bigint > (p_eff_file ->> 'maxFileBytes')::bigint
     OR (p_req ->> 'maxFiles')::integer > (p_eff_file ->> 'maxFiles')::integer THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 파일을 지금 쓸 수 있는가. NULL = 사용 가능. 검사 중이면 FILE_NOT_READY, 실패·정리 대상·정책 밖이면 FILE_FAILED.
-- 사용 시점에는 파일의 당시 정책판, 현재 학교∩공통 정책, 요청의 파일 정책을 모두 만족해야 한다.
CREATE FUNCTION workhub_private.c_file_problem(f workhub.file_objects, p_eff jsonb, p_req_policy jsonb) RETURNS text
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
  IF f.scan_state = 'not_scanned' AND NOT ((p_eff ->> 'allowUnscanned')::boolean
       AND COALESCE((SELECT (v.value ->> 'allowUnscanned')::boolean FROM workhub.policy_versions v
                      WHERE v.scope_key = f.safety_policy_scope_key AND v.id = f.safety_policy_version_id), false)
       AND COALESCE((SELECT (v.value ->> 'allowUnscanned')::boolean FROM workhub.policy_versions v
                      WHERE v.scope_key = f.common_safety_policy_scope_key AND v.id = f.common_safety_policy_version_id), false)) THEN
    RETURN 'FILE_FAILED';
  END IF;
  RETURN NULL;
END $$;

-- 배부 파일(template) 또는 공동 초안(draft) 첨부를 입력 목록으로 맞춘다.
-- 새로 붙는 파일은 같은 학교·같은 수합(초안이면 같은 단위)·같은 목적으로 prepare 한 것이어야 한다.
-- 목록(순서 포함)이 그대로면 연결 이력을 건드리지 않고, 다르면 현재 연결을 모두 해제하고 새 판으로 다시 연결한다.
CREATE FUNCTION workhub_private.c_link_files(p_ctx workhub_private.actor_context, p_kind text, p_collection text, p_unit text, p_draft text,
  p_refs jsonb, p_new_version integer, p_expected integer, p_eff jsonb, p_req_policy jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_new text[]; v_cur text[]; e jsonb; f workhub.file_objects; i workhub.collection_file_intents; v_code text;
BEGIN
  v_new := ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(COALESCE(p_refs, '[]'::jsonb)) WITH ORDINALITY t(x, o) ORDER BY o);
  IF p_kind = 'template' THEN
    v_cur := ARRAY(SELECT file_id FROM workhub.collection_template_files
                    WHERE school_id = p_ctx.school_id AND collection_id = p_collection AND unlinked_at IS NULL ORDER BY ordinal);
  ELSE
    v_cur := ARRAY(SELECT file_id FROM workhub.unit_draft_files
                    WHERE school_id = p_ctx.school_id AND draft_id = p_draft AND unlinked_at IS NULL ORDER BY ordinal);
  END IF;
  -- 개수 상한은 요청 정책(c_file_refs 가 이미 검사)과 오늘 유효한 정책(공통 ∩ 학교) 중 작은 값. 정책이 줄었으면 새 저장부터 따른다.
  IF cardinality(v_new) > (p_eff -> 'file' ->> 'maxFiles')::integer THEN RAISE EXCEPTION 'FILE_FAILED'; END IF;
  -- 파일 잠금은 ID 순(정리 작업·검증 봉인과 같은 순서). GC 판단과 첨부 확정이 같은 행에서 경쟁한다.
  PERFORM 1 FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = ANY (v_new) ORDER BY id FOR UPDATE;
  FOR e IN SELECT x FROM jsonb_array_elements(COALESCE(p_refs, '[]'::jsonb)) x LOOP
    SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = e ->> 'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF NOT (f.id = ANY (v_cur)) THEN
      SELECT * INTO i FROM workhub.collection_file_intents WHERE school_id = p_ctx.school_id AND file_id = f.id;
      IF i.file_id IS NULL OR i.purpose <> p_kind OR i.collection_id <> p_collection OR i.unit_id IS DISTINCT FROM p_unit
         OR (p_kind = 'template' AND i.uploader_account_id <> p_ctx.account_id)
         OR (p_kind = 'draft' AND NOT EXISTS (SELECT 1 FROM workhub.collection_unit_members m
                                               WHERE m.school_id = p_ctx.school_id AND m.unit_id = p_unit AND m.removed_at IS NULL
                                                 AND m.account_id = i.uploader_account_id)) THEN
        RAISE EXCEPTION 'FORBIDDEN';
      END IF;
      -- 업로드 뒤 부모가 더 새 판이 된 것은 같은 부모라 허용한다. 미래 판으로 발급된 목적은 있을 수 없으므로 충돌.
      IF i.expected_version > p_expected THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    END IF;
    v_code := workhub_private.c_file_problem(f, p_eff, p_req_policy);
    IF v_code IS NOT NULL THEN RAISE EXCEPTION '%', v_code; END IF;
    IF workhub_private.c_file_ref(p_ctx.school_id, f.id) IS DISTINCT FROM e THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END LOOP;
  IF v_new IS NOT DISTINCT FROM v_cur THEN RETURN; END IF;
  IF p_kind = 'template' THEN
    UPDATE workhub.collection_template_files SET unlinked_in_version = p_new_version, unlinked_at = clock_timestamp()
     WHERE school_id = p_ctx.school_id AND collection_id = p_collection AND unlinked_at IS NULL;
    INSERT INTO workhub.collection_template_files (school_id, collection_id, file_id, ordinal, linked_in_version)
    SELECT p_ctx.school_id, p_collection, x, o, p_new_version FROM unnest(v_new) WITH ORDINALITY t(x, o);
  ELSE
    UPDATE workhub.unit_draft_files SET unlinked_in_version = p_new_version, unlinked_at = clock_timestamp()
     WHERE school_id = p_ctx.school_id AND draft_id = p_draft AND unlinked_at IS NULL;
    INSERT INTO workhub.unit_draft_files (school_id, draft_id, file_id, ordinal, linked_in_version)
    SELECT p_ctx.school_id, p_draft, x, o, p_new_version FROM unnest(v_new) WITH ORDINALITY t(x, o);
  END IF;
  UPDATE workhub.file_objects SET first_linked_at = clock_timestamp()
   WHERE school_id = p_ctx.school_id AND id = ANY (v_new) AND first_linked_at IS NULL;
END $$;

-- 요청 본문(제목·안내·마감·문항·검토자·대상 명단)을 정규화 입력으로 덮어쓴다. 수합이 draft 일 때만 부른다.
CREATE FUNCTION workhub_private.c_write_body(p_ctx workhub_private.actor_context, p_collection text, p_schema text, p_input jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE fc jsonb := NULLIF(p_input -> 'fileCollection', 'null'::jsonb); v_reviewer text := NULLIF(p_input ->> 'reviewerMemberId', '');
  v_current text; u jsonb; o integer; v_plan text;
BEGIN
  UPDATE workhub.collections SET title = p_input ->> 'title', purpose = p_input ->> 'instructions', review_mode = p_input ->> 'reviewMode',
         due_on = (p_input ->> 'dueDate')::date,
         due_at = (((p_input ->> 'dueDate')::date + 1)::timestamp AT TIME ZONE p_ctx.school_timezone)
   WHERE school_id = p_ctx.school_id AND id = p_collection;
  UPDATE workhub.collection_schemas SET title = p_input ->> 'title', instructions = p_input ->> 'instructions', review_mode = p_input ->> 'reviewMode',
         file_policy = fc -> 'policy', file_required = COALESCE((fc ->> 'required')::boolean, false)
   WHERE school_id = p_ctx.school_id AND id = p_schema;
  DELETE FROM workhub.collection_fields WHERE school_id = p_ctx.school_id AND schema_id = p_schema;
  IF p_input ->> 'textLabel' <> '' THEN
    INSERT INTO workhub.collection_fields (school_id, collection_id, schema_id, field_key, label, kind, required, max_length, sort_order)
    VALUES (p_ctx.school_id, p_collection, p_schema, 'text', p_input ->> 'textLabel', 'long_text', (p_input ->> 'textRequired')::boolean, 5000, 1);
  END IF;
  IF p_input ->> 'numberLabel' <> '' THEN
    INSERT INTO workhub.collection_fields (school_id, collection_id, schema_id, field_key, label, kind, required, sort_order)
    VALUES (p_ctx.school_id, p_collection, p_schema, 'number', p_input ->> 'numberLabel', 'number', (p_input ->> 'numberRequired')::boolean, 2);
  END IF;
  IF fc IS NOT NULL THEN
    INSERT INTO workhub.collection_fields (school_id, collection_id, schema_id, field_key, label, kind, required,
        file_accept, file_max_bytes, file_max_count, sort_order)
    VALUES (p_ctx.school_id, p_collection, p_schema, 'files', '첨부 파일', 'file', (fc ->> 'required')::boolean,
        ARRAY(SELECT jsonb_array_elements_text(fc -> 'policy' -> 'extensions')), (fc -> 'policy' ->> 'maxFileBytes')::bigint,
        (fc -> 'policy' ->> 'maxFiles')::integer, 3);
  END IF;
  -- 검토자: 바뀔 때만 이전 행을 닫고 새 행을 넣는다(검토 방식 none 이면 검토자 없음)
  SELECT membership_id INTO v_current FROM workhub.collection_reviewers
   WHERE school_id = p_ctx.school_id AND collection_id = p_collection AND removed_at IS NULL;
  IF v_current IS DISTINCT FROM v_reviewer THEN
    UPDATE workhub.collection_reviewers SET removed_at = clock_timestamp()
     WHERE school_id = p_ctx.school_id AND collection_id = p_collection AND removed_at IS NULL;
    IF v_reviewer IS NOT NULL THEN
      INSERT INTO workhub.collection_reviewers (school_id, collection_id, membership_id, account_id, added_by_membership_id)
      SELECT p_ctx.school_id, p_collection, m.id, m.account_id, p_ctx.membership_id
        FROM workhub.memberships m WHERE m.school_id = p_ctx.school_id AND m.id = v_reviewer;
    END IF;
  END IF;
  -- 게시 전 대상 명단은 통째로 다시 쓴다(게시 때 이 명단으로 단위를 한 번 만든다)
  DELETE FROM workhub.collection_plan_unit_members WHERE school_id = p_ctx.school_id AND collection_id = p_collection;
  DELETE FROM workhub.collection_plan_units WHERE school_id = p_ctx.school_id AND collection_id = p_collection;
  FOR u, o IN SELECT x, n FROM jsonb_array_elements(p_input -> 'units') WITH ORDINALITY t(x, n) LOOP
    INSERT INTO workhub.collection_plan_units (school_id, collection_id, ordinal, label, responsible_membership_id)
    VALUES (p_ctx.school_id, p_collection, o, u ->> 'label', u ->> 'responsibleMemberId') RETURNING id INTO v_plan;
    INSERT INTO workhub.collection_plan_unit_members (school_id, collection_id, plan_unit_id, membership_id, ordinal)
    SELECT p_ctx.school_id, p_collection, v_plan, c, k FROM jsonb_array_elements_text(u -> 'contributorMemberIds') WITH ORDINALITY t(c, k);
  END LOOP;
END $$;

-- 수합 읽기 + 단위 잠금 공통: 볼 수 없으면 NOT_FOUND, 게시 전이면 NOT_FOUND(단위가 없다)
CREATE FUNCTION workhub_private.c_lock_unit(p_ctx workhub_private.actor_context, p_collection text, p_unit text) RETURNS workhub.collection_units
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE u workhub.collection_units;
BEGIN
  IF NOT workhub_private.c_reads(p_ctx, p_collection)
     OR NOT EXISTS (SELECT 1 FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = p_collection AND state = 'published') THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  SELECT * INTO u FROM workhub.collection_units WHERE school_id = p_ctx.school_id AND collection_id = p_collection AND id = p_unit FOR UPDATE;
  IF NOT FOUND OR NOT workhub_private.c_sees_unit(p_ctx, p_collection, p_unit) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN u;
END $$;

-- 마감 뒤 정정창: 가장 최근 창이 오늘까지 열려 있고 해당 조작을 허용하면 그 ID
CREATE FUNCTION workhub_private.c_open_window(p_ctx workhub_private.actor_context, p_unit text, p_action text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT w.id FROM (SELECT * FROM workhub.correction_windows cw WHERE cw.school_id = (p_ctx).school_id AND cw.unit_id = p_unit
                     ORDER BY cw.created_at DESC, cw.id DESC LIMIT 1) w
   WHERE w.until_on >= (p_ctx).school_today AND w.allows IN (p_action, 'both')
$$;

-- ----------------------------------------------------------------------------
-- 7. 명령 8종. 각 함수는 {type,id,version,requestId} 를 돌려준다. 오류는 코드 문자열 예외(호출부가 전부 되돌린다).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_cmd_create(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE inp jsonb := p_cmd -> 'input'; v_year text; v_count integer; c workhub.collections; v_schema text;
BEGIN
  -- 배부 파일은 저장된 수합 초안에 올린다(새 요청은 먼저 저장한 뒤 양식을 올린다)
  IF inp -> 'fileCollection' <> 'null'::jsonb AND jsonb_array_length(inp -> 'fileCollection' -> 'templates') > 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.c_policy_within(inp -> 'fileCollection' -> 'policy', p_eff -> 'file');
  PERFORM workhub_private.c_validate_targets(p_ctx, inp);
  SELECT count(*), min(y.id) INTO v_count, v_year FROM workhub.academic_years y
   WHERE y.school_id = p_ctx.school_id AND p_ctx.school_today <@ daterange(y.starts_on, y.ends_on, '[)');
  IF v_count <> 1 THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  INSERT INTO workhub.collections (school_id, title, purpose, owner_membership_id, owner_account_id, academic_year_id, review_mode, due_on, due_at)
  VALUES (p_ctx.school_id, inp ->> 'title', inp ->> 'instructions', p_ctx.membership_id, p_ctx.account_id, v_year, inp ->> 'reviewMode',
          (inp ->> 'dueDate')::date, (((inp ->> 'dueDate')::date + 1)::timestamp AT TIME ZONE p_ctx.school_timezone))
  RETURNING * INTO c;
  INSERT INTO workhub.collection_schemas (school_id, collection_id, review_mode, title, instructions, created_by_membership_id)
  VALUES (p_ctx.school_id, c.id, c.review_mode, c.title, c.purpose, p_ctx.membership_id) RETURNING id INTO v_schema;
  UPDATE workhub.collections SET current_schema_id = v_schema WHERE id = c.id;
  PERFORM workhub_private.c_write_body(p_ctx, c.id, v_schema, inp);
  RETURN jsonb_build_object('type', 'collection', 'id', c.id, 'version', 1, 'requestId', c.id);
END $$;

-- update·publish 공통 앞부분: 읽기(없으면 NOT_FOUND) → 관리자(FORBIDDEN) → 기대판(CONFLICT) → 게시 전(FORBIDDEN)
CREATE FUNCTION workhub_private.c_lock_own_draft(p_ctx workhub_private.actor_context, p_cmd jsonb) RETURNS workhub.collections
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c workhub.collections;
BEGIN
  IF NOT workhub_private.c_reads(p_ctx, p_cmd ->> 'requestId') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'requestId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.c_is_manager(p_ctx, c.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c.version <> (p_cmd ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF c.state <> 'draft' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN c;
END $$;

CREATE FUNCTION workhub_private.c_cmd_update(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c workhub.collections; inp jsonb := p_cmd -> 'input'; fc jsonb := NULLIF(p_cmd -> 'input' -> 'fileCollection', 'null'::jsonb);
BEGIN
  c := workhub_private.c_lock_own_draft(p_ctx, p_cmd);
  PERFORM workhub_private.c_policy_within(fc -> 'policy', p_eff -> 'file');
  PERFORM workhub_private.c_validate_targets(p_ctx, inp);
  PERFORM workhub_private.c_write_body(p_ctx, c.id, c.current_schema_id, inp);
  PERFORM workhub_private.c_link_files(p_ctx, 'template', c.id, NULL, NULL, COALESCE(fc -> 'templates', '[]'::jsonb),
    c.version + 1, c.version, p_eff, fc -> 'policy');
  UPDATE workhub.collections SET version = c.version + 1 WHERE id = c.id;
  RETURN jsonb_build_object('type', 'collection', 'id', c.id, 'version', c.version + 1, 'requestId', c.id);
END $$;

CREATE FUNCTION workhub_private.c_cmd_publish(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c workhub.collections; s workhub.collection_schemas; dto jsonb; f workhub.file_objects; v_code text; p record; v_unit text;
BEGIN
  c := workhub_private.c_lock_own_draft(p_ctx, p_cmd);
  SELECT * INTO s FROM workhub.collection_schemas WHERE school_id = p_ctx.school_id AND id = c.current_schema_id FOR UPDATE;
  dto := workhub_private.c_request_dto(p_ctx.school_id, c.id);
  -- 게시 시점에 대상·검토자·정책·배부 파일을 다시 검사한다(저장 뒤 소속 종료·정책 변경 반영)
  PERFORM workhub_private.c_validate_targets(p_ctx, dto);
  PERFORM workhub_private.c_policy_within(s.file_policy, p_eff -> 'file');
  PERFORM 1 FROM workhub.file_objects f2 JOIN workhub.collection_template_files t ON t.school_id = f2.school_id AND t.file_id = f2.id
   WHERE t.school_id = p_ctx.school_id AND t.collection_id = c.id AND t.unlinked_at IS NULL ORDER BY f2.id FOR UPDATE OF f2;
  FOR f IN SELECT f2.* FROM workhub.file_objects f2 JOIN workhub.collection_template_files t ON t.school_id = f2.school_id AND t.file_id = f2.id
            WHERE t.school_id = p_ctx.school_id AND t.collection_id = c.id AND t.unlinked_at IS NULL ORDER BY t.ordinal LOOP
    v_code := workhub_private.c_file_problem(f, p_eff, s.file_policy);
    IF v_code IS NOT NULL THEN RAISE EXCEPTION '%', v_code; END IF;
  END LOOP;
  UPDATE workhub.collection_schemas SET state = 'published', published_at = clock_timestamp(),
         definition_sha256 = workhub_private.request_sha256(dto - ARRAY['id','version','status','publishedAt']),
         submission_policy_scope_key = 's:' || p_ctx.school_id, submission_policy_version_id = p_eff ->> 'submissionPolicyId',
         policy_scope_key = CASE WHEN s.file_policy IS NULL THEN NULL ELSE 's:' || p_ctx.school_id END,
         policy_version_id = CASE WHEN s.file_policy IS NULL THEN NULL ELSE p_eff ->> 'uploadPolicyId' END,
         common_policy_scope_key = CASE WHEN s.file_policy IS NULL THEN NULL ELSE 'c' END,
         common_policy_version_id = CASE WHEN s.file_policy IS NULL THEN NULL ELSE p_eff ->> 'commonPolicyId' END
   WHERE id = s.id;
  FOR p IN SELECT pu.*, m.account_id FROM workhub.collection_plan_units pu
             JOIN workhub.memberships m ON m.school_id = pu.school_id AND m.id = pu.responsible_membership_id
            WHERE pu.school_id = p_ctx.school_id AND pu.collection_id = c.id ORDER BY pu.ordinal LOOP
    INSERT INTO workhub.collection_units (school_id, collection_id, unit_key, ordinal, label, responsible_membership_id, responsible_account_id, active_schema_id)
    VALUES (p_ctx.school_id, c.id, 'u' || lpad(p.ordinal::text, 3, '0'), p.ordinal, p.label, p.responsible_membership_id, p.account_id, s.id)
    RETURNING id INTO v_unit;
    INSERT INTO workhub.collection_unit_members (school_id, collection_id, unit_id, membership_id, account_id, role, ordinal)
    VALUES (p_ctx.school_id, c.id, v_unit, p.responsible_membership_id, p.account_id, 'responsible', 0);
    INSERT INTO workhub.collection_unit_members (school_id, collection_id, unit_id, membership_id, account_id, role, ordinal)
    SELECT p_ctx.school_id, c.id, v_unit, pm.membership_id, m.account_id, 'coauthor', pm.ordinal
      FROM workhub.collection_plan_unit_members pm JOIN workhub.memberships m ON m.school_id = pm.school_id AND m.id = pm.membership_id
     WHERE pm.school_id = p_ctx.school_id AND pm.plan_unit_id = p.id;
  END LOOP;
  UPDATE workhub.collections SET state = 'published', published_at = clock_timestamp(), version = c.version + 1 WHERE id = c.id;
  RETURN jsonb_build_object('type', 'collection', 'id', c.id, 'version', c.version + 1, 'requestId', c.id);
END $$;

CREATE FUNCTION workhub_private.c_cmd_save_draft(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE u workhub.collection_units; s workhub.collection_schemas; d workhub.unit_drafts; inp jsonb := p_cmd -> 'input';
  v_expected integer := (p_cmd ->> 'expectedVersion')::integer; v_answers jsonb;
BEGIN
  u := workhub_private.c_lock_unit(p_ctx, p_cmd ->> 'requestId', p_cmd ->> 'unitId');
  IF NOT workhub_private.c_is_unit_member(p_ctx, u.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO s FROM workhub.collection_schemas WHERE school_id = p_ctx.school_id AND id = u.active_schema_id;
  SELECT * INTO d FROM workhub.unit_drafts WHERE school_id = p_ctx.school_id AND unit_id = u.id AND schema_id = s.id FOR UPDATE;
  IF COALESCE(d.version, 0) <> v_expected THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 없는 문항에 값을 보내면 거부(빈 값은 허용)
  IF (inp ->> 'text' <> '' AND NOT EXISTS (SELECT 1 FROM workhub.collection_fields WHERE school_id = s.school_id AND schema_id = s.id AND field_key = 'text'))
     OR (inp -> 'number' <> 'null'::jsonb AND NOT EXISTS (SELECT 1 FROM workhub.collection_fields WHERE school_id = s.school_id AND schema_id = s.id AND field_key = 'number'))
     OR (s.file_policy IS NULL AND inp -> 'files' <> 'null'::jsonb AND jsonb_array_length(inp -> 'files') > 0) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF s.file_policy IS NOT NULL AND inp -> 'files' <> 'null'::jsonb THEN
    PERFORM workhub_private.c_file_refs(inp -> 'files', s.file_policy);
  END IF;
  v_answers := jsonb_build_object('text', inp -> 'text', 'number', inp -> 'number');
  IF d.id IS NULL THEN
    INSERT INTO workhub.unit_drafts (school_id, collection_id, unit_id, schema_id, answers, updated_by_account_id, updated_by_membership_id)
    VALUES (p_ctx.school_id, u.collection_id, u.id, s.id, v_answers, p_ctx.account_id, p_ctx.membership_id) RETURNING * INTO d;
  ELSE
    UPDATE workhub.unit_drafts SET answers = v_answers, updated_by_account_id = p_ctx.account_id, updated_by_membership_id = p_ctx.membership_id,
           version = d.version + 1
     WHERE id = d.id RETURNING * INTO d;
  END IF;
  IF s.file_policy IS NOT NULL THEN
    -- files 키를 생략하면 빈 목록으로 본다(앱 AnswerInput 의 files? 생략 = 첨부 없음)
    PERFORM workhub_private.c_link_files(p_ctx, 'draft', u.collection_id, u.id, d.id,
      CASE WHEN inp -> 'files' = 'null'::jsonb THEN '[]'::jsonb ELSE inp -> 'files' END, d.version, v_expected, p_eff, s.file_policy);
  END IF;
  RETURN jsonb_build_object('type', 'unit_draft', 'id', d.id, 'version', d.version, 'requestId', u.collection_id);
END $$;

CREATE FUNCTION workhub_private.c_cmd_submit(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c workhub.collections; u workhub.collection_units; s workhub.collection_schemas; d workhub.unit_drafts; cr workhub.correction_requests;
  sv workhub.submission_versions; f workhub.file_objects; v_code text; v_now timestamptz := clock_timestamp(); v_prior boolean;
  v_window text; v_cr_id text := p_cmd ->> 'correctionRequestId'; v_files text[]; v_count integer;
BEGIN
  u := workhub_private.c_lock_unit(p_ctx, p_cmd ->> 'requestId', p_cmd ->> 'unitId');
  IF NOT (u.responsible_membership_id = p_ctx.membership_id AND u.responsible_account_id = p_ctx.account_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF u.version <> (p_cmd ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = u.collection_id;
  SELECT * INTO s FROM workhub.collection_schemas WHERE school_id = p_ctx.school_id AND id = u.active_schema_id;
  SELECT * INTO d FROM workhub.unit_drafts WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'draftId' AND unit_id = u.id AND schema_id = s.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF d.version <> (p_cmd ->> 'expectedDraftVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 상세 1회 응답 한도(제출판 1,000)를 넘기면 이력이 잘린다 → 더 받지 않는다.
  -- 단위 잠금만으로는 다른 단위의 동시 제출을 막지 못하므로, 세기 전에 수합 단위 잠금을 잡는다(트랜잭션 끝에 풀림).
  -- 잠금 순서는 항상 단위 행 → 이 잠금이고, 이 잠금을 잡은 뒤 다른 단위 행을 잠그지 않으므로 순환 대기가 없다.
  PERFORM pg_advisory_xact_lock(hashtextextended('workhub.collection.submit:' || c.school_id || chr(31) || c.id, 0));
  IF (SELECT count(*) FROM workhub.submission_versions WHERE school_id = c.school_id AND collection_id = c.id) >= 1000 THEN
    RAISE EXCEPTION 'NOT_READY';
  END IF;
  v_prior := EXISTS (SELECT 1 FROM workhub.submission_versions WHERE school_id = u.school_id AND unit_id = u.id);
  IF v_prior AND workhub_private.js_trim(p_cmd ->> 'reason') = '' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_cr_id IS NOT NULL THEN
    SELECT * INTO cr FROM workhub.correction_requests WHERE school_id = u.school_id AND unit_id = u.id AND id = v_cr_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF cr.state <> 'open' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  END IF;
  -- 마감(학교 시간대 다음 날 00:00) 뒤 재제출은 열린 보완 요청 또는 정정창이 있어야 한다. 최초 지연 제출은 받는다.
  IF v_prior AND v_now >= c.due_at AND v_cr_id IS NULL THEN
    v_window := workhub_private.c_open_window(p_ctx, u.id, 'submit');
    IF v_window IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  END IF;
  -- 필수 응답은 제출 때 검사한다
  IF EXISTS (SELECT 1 FROM workhub.collection_fields fl WHERE fl.school_id = s.school_id AND fl.schema_id = s.id AND fl.required AND (
        (fl.field_key = 'text' AND workhub_private.js_trim(d.answers ->> 'text') = '')
     OR (fl.field_key = 'number' AND d.answers -> 'number' = 'null'::jsonb)
     OR (fl.field_key = 'files' AND NOT EXISTS (SELECT 1 FROM workhub.unit_draft_files df WHERE df.school_id = d.school_id AND df.draft_id = d.id AND df.unlinked_at IS NULL)))) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_files := ARRAY(SELECT df.file_id FROM workhub.unit_draft_files df WHERE df.school_id = d.school_id AND df.draft_id = d.id AND df.unlinked_at IS NULL ORDER BY df.file_id);
  PERFORM 1 FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = ANY (v_files) ORDER BY id FOR UPDATE;
  -- 첨부 개수: 저장 당시가 아니라 제출 시점의 요청 정책 ∩ 오늘 유효한 정책으로 다시 본다(이미 받은 과거 제출판은 그대로).
  IF cardinality(v_files) > 0 AND (s.file_policy IS NULL
       OR cardinality(v_files) > least((s.file_policy ->> 'maxFiles')::integer, (p_eff -> 'file' ->> 'maxFiles')::integer)) THEN
    RAISE EXCEPTION 'FILE_FAILED';
  END IF;
  FOR f IN SELECT * FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = ANY (v_files) LOOP
    v_code := workhub_private.c_file_problem(f, p_eff, s.file_policy);
    IF v_code IS NOT NULL THEN RAISE EXCEPTION '%', v_code; END IF;
  END LOOP;
  SELECT COALESCE(max(version_no), 0) + 1 INTO v_count FROM workhub.submission_versions WHERE school_id = u.school_id AND unit_id = u.id;
  INSERT INTO workhub.submission_versions (school_id, collection_id, unit_id, schema_id, version_no, previous_submission_id,
      submitted_by_account_id, submitted_by_membership_id, responsible_account_id, source_draft_id, source_draft_version, answers, review_mode,
      receipt_at, receipt_date, due_on_snapshot, due_snapshot, due_change_revision, is_late, correction_reason, correction_request_id,
      correction_window_id, request_id)
  VALUES (u.school_id, u.collection_id, u.id, s.id, v_count, u.current_submission_id,
      p_ctx.account_id, p_ctx.membership_id, u.responsible_account_id, d.id, d.version, d.answers, c.review_mode,
      v_now, (v_now AT TIME ZONE p_ctx.school_timezone)::date, c.due_on, c.due_at, c.due_change_revision, v_now >= c.due_at,
      p_cmd ->> 'reason', v_cr_id, v_window, p_cmd ->> 'requestKey')
  RETURNING * INTO sv;
  INSERT INTO workhub.submission_files (school_id, submission_id, file_id, ordinal, sha256, size_bytes,
      safety_policy_scope_key, safety_policy_version_id, common_safety_policy_scope_key, common_safety_policy_version_id)
  SELECT sv.school_id, sv.id, fo.id, df.ordinal, fo.sha256, fo.size_bytes,
         fo.safety_policy_scope_key, fo.safety_policy_version_id, fo.common_safety_policy_scope_key, fo.common_safety_policy_version_id
    FROM workhub.unit_draft_files df JOIN workhub.file_objects fo ON fo.school_id = df.school_id AND fo.id = df.file_id
   WHERE df.school_id = d.school_id AND df.draft_id = d.id AND df.unlinked_at IS NULL;
  IF v_cr_id IS NOT NULL THEN
    INSERT INTO workhub.collection_correction_fulfillments (school_id, unit_id, correction_request_id, submission_id)
    VALUES (u.school_id, u.id, cr.id, sv.id);
    UPDATE workhub.correction_requests SET state = 'fulfilled' WHERE id = cr.id;
  END IF;
  UPDATE workhub.collection_units SET current_submission_id = sv.id,
         effective_submission_id = CASE WHEN c.review_mode = 'none' THEN sv.id ELSE effective_submission_id END,
         first_submission_id = COALESCE(first_submission_id, sv.id),
         first_valid_submitted_at = COALESCE(first_valid_submitted_at, sv.receipt_at),
         first_submission_late = COALESCE(first_submission_late, sv.is_late),
         version = u.version + 1
   WHERE id = u.id;
  RETURN jsonb_build_object('type', 'submission', 'id', sv.id, 'version', sv.version_no, 'requestId', u.collection_id);
END $$;

CREATE FUNCTION workhub_private.c_cmd_review(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE u workhub.collection_units; sv workhub.submission_versions; v_review text; v_due date := (p_cmd ->> 'dueDate')::date;
BEGIN
  u := workhub_private.c_lock_unit(p_ctx, p_cmd ->> 'requestId', p_cmd ->> 'unitId');
  IF NOT workhub_private.c_is_reviewer(p_ctx, u.collection_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF u.version <> (p_cmd ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO sv FROM workhub.submission_versions WHERE school_id = u.school_id AND unit_id = u.id AND id = p_cmd ->> 'submissionId';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF u.current_submission_id IS DISTINCT FROM sv.id
     OR EXISTS (SELECT 1 FROM workhub.submission_withdrawals w WHERE w.school_id = sv.school_id AND w.submission_id = sv.id)
     OR EXISTS (SELECT 1 FROM workhub.submission_reviews r WHERE r.school_id = sv.school_id AND r.submission_id = sv.id) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 자기검토 금지(계정 기준): 실제 제출자·당시 책임자·현재 책임자
  IF p_ctx.account_id IN (sv.submitted_by_account_id, sv.responsible_account_id, u.responsible_account_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_cmd ->> 'decision' = 'changes_requested' AND v_due < p_ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO workhub.submission_reviews (school_id, unit_id, submission_id, reviewer_account_id, reviewer_membership_id, decision, note)
  VALUES (u.school_id, u.id, sv.id, p_ctx.account_id, p_ctx.membership_id, p_cmd ->> 'decision', p_cmd ->> 'note') RETURNING id INTO v_review;
  IF p_cmd ->> 'decision' = 'changes_requested' THEN
    INSERT INTO workhub.correction_requests (school_id, unit_id, submission_id, review_id, due_on, reason)
    VALUES (u.school_id, u.id, sv.id, v_review, v_due, p_cmd ->> 'note');
    UPDATE workhub.collection_units SET version = u.version + 1 WHERE id = u.id;
  ELSE
    UPDATE workhub.collection_units SET effective_submission_id = sv.id, version = u.version + 1 WHERE id = u.id;
  END IF;
  RETURN jsonb_build_object('type', 'collection_unit', 'id', u.id, 'version', u.version + 1, 'requestId', u.collection_id);
END $$;

CREATE FUNCTION workhub_private.c_cmd_withdraw(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c workhub.collections; u workhub.collection_units; sv workhub.submission_versions; v_window text; v_withdrawal text;
BEGIN
  u := workhub_private.c_lock_unit(p_ctx, p_cmd ->> 'requestId', p_cmd ->> 'unitId');
  IF NOT (u.responsible_membership_id = p_ctx.membership_id AND u.responsible_account_id = p_ctx.account_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- 직접 철회는 승인된 학교 제출 정책이 허용할 때만
  IF NOT (p_eff ->> 'allowWithdrawal')::boolean THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF u.version <> (p_cmd ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO sv FROM workhub.submission_versions WHERE school_id = u.school_id AND unit_id = u.id AND id = p_cmd ->> 'submissionId';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF u.current_submission_id IS DISTINCT FROM sv.id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 승인 완료판은 직접 철회하지 않는다
  IF EXISTS (SELECT 1 FROM workhub.submission_reviews r WHERE r.school_id = sv.school_id AND r.submission_id = sv.id AND r.decision = 'accepted') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  SELECT * INTO c FROM workhub.collections WHERE school_id = u.school_id AND id = u.collection_id;
  IF clock_timestamp() >= c.due_at THEN
    v_window := workhub_private.c_open_window(p_ctx, u.id, 'withdraw');
    IF v_window IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  END IF;
  INSERT INTO workhub.submission_withdrawals (school_id, unit_id, submission_id, actor_account_id, actor_membership_id, reason, correction_window_id)
  VALUES (u.school_id, u.id, sv.id, p_ctx.account_id, p_ctx.membership_id, p_cmd ->> 'reason', v_window) RETURNING id INTO v_withdrawal;
  -- 이 판이 충족한 보완은 무효로 표시하고 보완 의무를 다시 연다
  UPDATE workhub.correction_requests SET state = 'open'
   WHERE school_id = u.school_id AND id IN (SELECT correction_request_id FROM workhub.collection_correction_fulfillments
                                             WHERE school_id = u.school_id AND submission_id = sv.id AND invalidated_at IS NULL);
  UPDATE workhub.collection_correction_fulfillments SET invalidated_at = clock_timestamp(), invalidated_by_withdrawal_id = v_withdrawal
   WHERE school_id = u.school_id AND submission_id = sv.id AND invalidated_at IS NULL;
  -- 무검토형: 현재판·완료본을 모두 비운다(이전판 자동 부활 없음). 검토형: 현재판을 완료본으로 되돌린다.
  UPDATE workhub.collection_units SET
         current_submission_id = CASE WHEN c.review_mode = 'none' THEN NULL ELSE effective_submission_id END,
         effective_submission_id = CASE WHEN c.review_mode = 'none' THEN NULL ELSE effective_submission_id END,
         version = u.version + 1
   WHERE id = u.id;
  RETURN jsonb_build_object('type', 'collection_unit', 'id', u.id, 'version', u.version + 1, 'requestId', u.collection_id);
END $$;

CREATE FUNCTION workhub_private.c_cmd_open_correction(p_ctx workhub_private.actor_context, p_cmd jsonb, p_eff jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE u workhub.collection_units; v_due date := (p_cmd ->> 'dueDate')::date;
BEGIN
  u := workhub_private.c_lock_unit(p_ctx, p_cmd ->> 'requestId', p_cmd ->> 'unitId');
  IF NOT workhub_private.c_is_manager(p_ctx, u.collection_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT (p_eff ->> 'allowCorrectionWindow')::boolean THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF u.version <> (p_cmd ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF v_due < p_ctx.school_today OR v_due > p_ctx.school_today + (p_eff ->> 'maxCorrectionDays')::integer THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO workhub.correction_windows (school_id, collection_id, unit_id, allows, until_on, reason, opened_by_account_id, opened_by_membership_id,
      submission_policy_scope_key, submission_policy_version_id)
  VALUES (u.school_id, u.collection_id, u.id, 'both', v_due, p_cmd ->> 'reason', p_ctx.account_id, p_ctx.membership_id,
      's:' || u.school_id, p_eff ->> 'submissionPolicyId');
  UPDATE workhub.collection_units SET version = u.version + 1 WHERE id = u.id;
  RETURN jsonb_build_object('type', 'collection_unit', 'id', u.id, 'version', u.version + 1, 'requestId', u.collection_id);
END $$;

-- 접수증 DTO(최초 접수의 ID·판·시각을 그대로)
CREATE FUNCTION workhub_private.c_receipt_dto(r workhub.idempotency_receipts, p_request_id text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('requestId', p_request_id, 'resourceId', r.resource_id, 'resourceVersion', r.resource_version,
                            'recordedAt', r.result ->> 'recorded_at', 'requestKey', r.idem_key)
$$;

-- 명령 전체: 정규화 → 같은 키 직렬화·재전송 판정 → 쓰기 준비 → 처리 → 접수증·감사·outbox (한 트랜잭션)
CREATE FUNCTION workhub_private.c_mutate(p_ctx workhub_private.actor_context, p_command jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_key text; cmd jsonb; v_sha text; r workhub.idempotency_receipts; eff jsonb; res jsonb; v_request text;
BEGIN
  v_key := workhub_private.c_request_key(p_key);
  cmd := workhub_private.c_norm_command(p_command);
  v_sha := workhub_private.request_sha256(cmd);
  r := workhub_private.claim_receipt(p_ctx, 'collection.mutate', v_key, v_sha);
  IF r.idem_key IS NOT NULL THEN
    -- 재전송: 현재 읽기 권한을 다시 보고 최초 접수증을 돌려준다(준비 상태가 닫혀도 같은 명령이 두 번 접수되지 않게)
    v_request := COALESCE(cmd ->> 'requestId', r.resource_id);
    IF NOT workhub_private.c_reads(p_ctx, v_request) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN workhub_private.c_receipt_dto(r, v_request);
  END IF;
  eff := workhub_private.c_require(p_ctx, 'write');
  cmd := cmd || jsonb_build_object('requestKey', v_key);
  res := CASE cmd ->> 'kind'
    WHEN 'create' THEN workhub_private.c_cmd_create(p_ctx, cmd, eff)
    WHEN 'update' THEN workhub_private.c_cmd_update(p_ctx, cmd, eff)
    WHEN 'publish' THEN workhub_private.c_cmd_publish(p_ctx, cmd, eff)
    WHEN 'save_draft' THEN workhub_private.c_cmd_save_draft(p_ctx, cmd, eff)
    WHEN 'submit' THEN workhub_private.c_cmd_submit(p_ctx, cmd, eff)
    WHEN 'review' THEN workhub_private.c_cmd_review(p_ctx, cmd, eff)
    WHEN 'withdraw' THEN workhub_private.c_cmd_withdraw(p_ctx, cmd, eff)
    WHEN 'open_correction' THEN workhub_private.c_cmd_open_correction(p_ctx, cmd, eff) END;
  PERFORM workhub_private.store_receipt(p_ctx, 'collection.mutate', v_key, v_sha, res ->> 'type', res ->> 'id', (res ->> 'version')::integer);
  PERFORM workhub_private.write_audit(p_ctx, 'collection.' || (cmd ->> 'kind'), res ->> 'type', res ->> 'id', (res ->> 'version')::integer,
    'school', v_key, jsonb_build_object('request_id', res ->> 'requestId', 'unit_id', cmd ->> 'unitId'));
  PERFORM workhub_private.emit_outbox(p_ctx, 'collection.' || (cmd ->> 'kind'), res ->> 'type', res ->> 'id', (res ->> 'version')::integer,
    jsonb_build_object('request_id', res ->> 'requestId', 'resource_id', res ->> 'id', 'version', (res ->> 'version')::integer));
  r := workhub_private.claim_receipt(p_ctx, 'collection.mutate', v_key, v_sha);
  RETURN workhub_private.c_receipt_dto(r, res ->> 'requestId');
END $$;

-- ----------------------------------------------------------------------------
-- 8. 조회 — 목록(cursor 서명)·상세·초안
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_b64url(p bytea) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT translate(encode(p, 'base64'), '+/' || chr(10), '-_')
$$;
CREATE FUNCTION workhub_private.c_unb64url(p text) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN decode(translate(p, '-_', '+/'), 'base64');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_INPUT';
END $$;
-- HMAC-SHA256(설치 비밀값). cursor 를 학교·소속·계정에 묶어 위조·다른 사람 cursor 재사용을 막는다.
CREATE FUNCTION workhub_private.c_hmac(p_msg text) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT sha256(s.k_opad || sha256(s.k_ipad || convert_to(p_msg, 'UTF8'))) FROM workhub_private.r1_secrets s
$$;
CREATE FUNCTION workhub_private.c_cursor_make(p_ctx workhub_private.actor_context, p_created timestamptz, p_id text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_payload text := 'v1|' || workhub_private.c_iso(p_created) || '|' || p_id;
BEGIN
  RETURN workhub_private.c_b64url(convert_to(v_payload, 'UTF8'))
      || rtrim(workhub_private.c_b64url(workhub_private.c_hmac('workhub.collection.list|' || p_ctx.school_id || '|' || p_ctx.membership_id
                                                                 || '|' || p_ctx.account_id || '|' || v_payload)), '=');
END $$;
-- 반환: {t, i}. 형식·서명이 틀리면 INVALID_INPUT
CREATE FUNCTION workhub_private.c_cursor_read(p_ctx workhub_private.actor_context, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_payload text; v_parts text[];
BEGIN
  IF p_cursor IS NULL OR length(p_cursor) > 2048 OR p_cursor !~ '^[A-Za-z0-9_=-]+$' OR length(p_cursor) <= 43 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN
    v_payload := convert_from(workhub_private.c_unb64url(left(p_cursor, -43)), 'UTF8');
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF right(p_cursor, 43) <> rtrim(workhub_private.c_b64url(workhub_private.c_hmac('workhub.collection.list|' || p_ctx.school_id || '|'
       || p_ctx.membership_id || '|' || p_ctx.account_id || '|' || v_payload)), '=') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_parts := string_to_array(v_payload, '|');
  IF cardinality(v_parts) <> 3 OR v_parts[1] <> 'v1' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN jsonb_build_object('t', v_parts[2], 'i', v_parts[3]);
END $$;

CREATE FUNCTION workhub_private.c_list(p_ctx workhub_private.actor_context, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE cur jsonb; v_t timestamptz; v_i text; v_ids text[]; v_ts timestamptz[]; v_items jsonb;
BEGIN
  PERFORM workhub_private.c_require(p_ctx, 'read');
  IF p_cursor IS NOT NULL THEN
    cur := workhub_private.c_cursor_read(p_ctx, p_cursor);
    v_t := (cur ->> 't')::timestamptz; v_i := cur ->> 'i';
  END IF;
  SELECT array_agg(x.id ORDER BY x.created_at DESC, x.id DESC), array_agg(x.created_at ORDER BY x.created_at DESC, x.id DESC)
    INTO v_ids, v_ts
    FROM (SELECT c.id, c.created_at FROM workhub.collections c
           WHERE c.school_id = p_ctx.school_id AND workhub_private.c_reads(p_ctx, c.id)
             AND (v_t IS NULL OR (c.created_at, c.id) < (v_t, v_i))
           ORDER BY c.created_at DESC, c.id DESC LIMIT 51) x;
  v_items := COALESCE((SELECT jsonb_agg(workhub_private.c_request_dto(p_ctx.school_id, x) ORDER BY o)
                         FROM unnest(v_ids[1:50]) WITH ORDINALITY t(x, o)), '[]'::jsonb);
  RETURN jsonb_build_object('items', v_items,
    'nextCursor', CASE WHEN cardinality(v_ids) > 50 THEN to_jsonb(workhub_private.c_cursor_make(p_ctx, v_ts[50], v_ids[50])) ELSE 'null'::jsonb END);
END $$;

CREATE FUNCTION workhub_private.c_get(p_ctx workhub_private.actor_context, p_request_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_id text := workhub_private.c_id(to_jsonb(p_request_id)); d jsonb;
BEGIN
  PERFORM workhub_private.c_require(p_ctx, 'read');
  IF NOT workhub_private.c_reads(p_ctx, v_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  d := workhub_private.c_detail(p_ctx, v_id);
  IF d IS NULL THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  RETURN d;
END $$;

-- 초안은 현재 공동 구성원만 읽는다. 관리자·검토자에게는 존재 여부도 알려 주지 않는다(FORBIDDEN 으로 닫음).
CREATE FUNCTION workhub_private.c_draft_get(p_ctx workhub_private.actor_context, p_request_id text, p_unit_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_req text := workhub_private.c_id(to_jsonb(p_request_id)); v_unit text := workhub_private.c_id(to_jsonb(p_unit_id)); v_draft text;
BEGIN
  PERFORM workhub_private.c_require(p_ctx, 'read');
  IF NOT workhub_private.c_reads(p_ctx, v_req)
     OR NOT EXISTS (SELECT 1 FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = v_req AND state = 'published')
     OR NOT workhub_private.c_sees_unit(p_ctx, v_req, v_unit) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF NOT workhub_private.c_is_unit_member(p_ctx, v_unit) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT d.id INTO v_draft FROM workhub.unit_drafts d JOIN workhub.collection_units u ON u.school_id = d.school_id AND u.id = d.unit_id AND u.active_schema_id = d.schema_id
   WHERE d.school_id = p_ctx.school_id AND d.unit_id = v_unit;
  RETURN CASE WHEN v_draft IS NULL THEN 'null'::jsonb ELSE workhub_private.c_draft_dto(p_ctx.school_id, v_draft) END;
END $$;

-- ----------------------------------------------------------------------------
-- 9. 파일 — 부모 해석·업로드 준비·업로드 확인·상태·내려받기 허가
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.c_parent(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  CASE p ->> 'kind'
    WHEN 'template' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','version'], NULL);
      RETURN jsonb_build_object('kind', 'template', 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', NULL, 'submissionId', NULL,
                                'version', workhub_private.c_int(p -> 'version', 1));
    WHEN 'draft' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','version'], NULL);
      RETURN jsonb_build_object('kind', 'draft', 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
                                'submissionId', NULL, 'version', workhub_private.c_int(p -> 'version', 0));
    WHEN 'submission' THEN
      PERFORM workhub_private.c_keys(p, ARRAY['kind','requestId','unitId','submissionId'], NULL);
      RETURN jsonb_build_object('kind', 'submission', 'requestId', workhub_private.c_id(p -> 'requestId'), 'unitId', workhub_private.c_id(p -> 'unitId'),
                                'submissionId', workhub_private.c_id(p -> 'submissionId'), 'version', NULL);
    ELSE RAISE EXCEPTION 'INVALID_INPUT';
  END CASE;
END $$;

-- 내려받기 원본 해석(access RPC 와 Storage SELECT 정책이 같은 함수를 쓴다).
-- 반환 {code, resourceType, resourceId, version, collectionId, unitId}. code 가 null 이면 허용.
CREATE FUNCTION workhub_private.c_parent_resolve(p_ctx workhub_private.actor_context, p_parent jsonb, p_file text, p_eff jsonb) RETURNS jsonb
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
  v_code := workhub_private.c_file_problem(f, p_eff, s.file_policy);
  RETURN r || jsonb_build_object('code', v_code);
END $$;

-- 업로드 목적의 부모에 지금도 접근할 수 있는가(complete·status 용)
CREATE FUNCTION workhub_private.c_intent_ok(p_ctx workhub_private.actor_context, p_file text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.collection_file_intents i
                  WHERE i.school_id = (p_ctx).school_id AND i.file_id = p_file AND i.uploader_account_id = (p_ctx).account_id
                    AND CASE i.purpose WHEN 'template' THEN workhub_private.c_is_manager(p_ctx, i.collection_id)
                                       ELSE workhub_private.c_is_unit_member(p_ctx, i.unit_id) END)
$$;

CREATE FUNCTION workhub_private.c_object_owner(p_bucket text, p_name text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', o.id, 'owner', COALESCE(o.owner_id, o.owner::text))
    FROM storage.objects o WHERE o.bucket_id = p_bucket AND o.name = p_name
$$;

-- 앱 상태: uploading → awaiting_upload(만료됐고 실물이 없으면 rejected), uploaded·verifying → pending_verification,
-- ready → ready(정리 원장에 오르면 rejected), 그 밖 → rejected
CREATE FUNCTION workhub_private.c_file_state(f workhub.file_objects) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id) THEN 'rejected'
    WHEN f.state = 'uploading' AND f.upload_expires_at <= clock_timestamp()
         AND workhub_private.c_object_owner(f.bucket, f.storage_key) IS NULL THEN 'rejected'
    WHEN f.state = 'uploading' THEN 'awaiting_upload'
    WHEN f.state IN ('uploaded','verifying') THEN 'pending_verification'
    WHEN f.state = 'ready' THEN 'ready'
    ELSE 'rejected' END
$$;
CREATE FUNCTION workhub_private.c_status_dto(f workhub.file_objects) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('fileId', f.id, 'state', workhub_private.c_file_state(f),
    'file', CASE WHEN workhub_private.c_file_state(f) = 'ready' THEN workhub_private.c_file_ref(f.school_id, f.id) ELSE NULL END)
$$;
CREATE FUNCTION workhub_private.c_upload_dto(f workhub.file_objects) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('fileId', f.id, 'bucket', f.bucket, 'path', f.storage_key, 'expiresAt', workhub_private.c_iso(f.upload_expires_at),
                            'state', workhub_private.c_file_state(f))
$$;

CREATE FUNCTION workhub_private.c_prepare(p_ctx workhub_private.actor_context, p_parent jsonb, p_file jsonb, p_key text) RETURNS jsonb
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
  INSERT INTO workhub.collection_file_intents (file_id, school_id, purpose, collection_id, unit_id, expected_version, uploader_account_id, uploader_membership_id)
  VALUES (f.id, f.school_id, par ->> 'kind', par ->> 'requestId', par ->> 'unitId', (par ->> 'version')::integer, p_ctx.account_id, p_ctx.membership_id);
  PERFORM workhub_private.store_receipt(p_ctx, 'file.prepare', v_key, v_req_sha, 'file_object', f.id, f.version);
  PERFORM workhub_private.write_audit(p_ctx, 'file.prepare', 'file_object', f.id, f.version, 'school', v_key,
    jsonb_build_object('purpose', par ->> 'kind', 'request_id', par ->> 'requestId', 'unit_id', par ->> 'unitId'));
  PERFORM workhub_private.emit_outbox(p_ctx, 'file.prepared', 'file_object', f.id, f.version, jsonb_build_object('file_id', f.id));
  RETURN workhub_private.c_upload_dto(f);
END $$;

-- 업로드 확인. 같은 키 재시도도 매번 현재 상태를 다시 평가한다(이전 awaiting 결과를 고정하지 않음).
CREATE FUNCTION workhub_private.c_complete(p_ctx workhub_private.actor_context, p_file_id text, p_key text) RETURNS jsonb
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
        INSERT INTO workhub.file_verification_jobs (school_id, file_id) VALUES (f.school_id, f.id) ON CONFLICT (file_id) DO NOTHING;
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

CREATE FUNCTION workhub_private.c_status(p_ctx workhub_private.actor_context, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE f workhub.file_objects; v_id text := workhub_private.c_id(to_jsonb(p_file_id));
BEGIN
  PERFORM workhub_private.c_require(p_ctx, 'read');
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = v_id;
  IF f.id IS NULL OR f.owner_account_id <> p_ctx.account_id OR NOT workhub_private.c_intent_ok(p_ctx, f.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN workhub_private.c_status_dto(f);
END $$;

-- 내려받기 허가: 원본을 해석해 5분짜리 접근 기록을 남기고 {file,bucket,path} 를 돌려준다(URL 발급 없음).
-- 실제 Storage 요청 때 SELECT 정책이 같은 해석을 다시 한다.
CREATE FUNCTION workhub_private.c_access(p_ctx workhub_private.actor_context, p_parent jsonb, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE par jsonb := workhub_private.c_parent(p_parent); v_id text := workhub_private.c_id(to_jsonb(p_file_id)); eff jsonb; res jsonb; f workhub.file_objects;
BEGIN
  eff := workhub_private.c_require(p_ctx, 'access');
  res := workhub_private.c_parent_resolve(p_ctx, par, v_id, eff);
  IF res ->> 'code' IS NOT NULL THEN RAISE EXCEPTION '%', res ->> 'code'; END IF;
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = p_ctx.school_id AND id = v_id;
  INSERT INTO workhub.file_access_grants (school_id, file_id, granted_to_account_id, granted_membership_id, resource_type, resource_id,
      resource_version, collection_id, unit_id, expires_at)
  VALUES (p_ctx.school_id, f.id, p_ctx.account_id, p_ctx.membership_id, res ->> 'resourceType', res ->> 'resourceId',
      (res ->> 'version')::integer, res ->> 'collectionId', res ->> 'unitId', clock_timestamp() + interval '5 minutes');
  PERFORM workhub_private.write_audit(p_ctx, 'file.access', 'file_object', f.id, f.version, 'school', NULL,
    jsonb_build_object('resource_type', res ->> 'resourceType', 'resource_id', res ->> 'resourceId'));
  RETURN jsonb_build_object('file', workhub_private.c_file_ref(f.school_id, f.id), 'bucket', f.bucket, 'path', f.storage_key);
END $$;

-- ----------------------------------------------------------------------------
-- 10. Storage 정책 판정 — 실제 업로드·내려받기 요청 시점에 Storage 가 부른다
-- ----------------------------------------------------------------------------
-- Storage 가 요청마다 넣는 요청 종류(storage.operation, 예: 'storage.object.upload'). 'storage.' 접두어는 떼고 비교한다.
-- 허용 목록 방식: 로그인 사용자의 직접 업로드(object.upload)·직접 내려받기(object.get_authenticated)만 통과한다.
-- 서명 URL 발급(object.sign·sign_many·sign_upload_url)·목록·이동·복사·TUS·S3 등은 모두 거부된다.
--   서명 내려받기 URL 은 이후 접근 기록 회수·소속 종료를 다시 보지 않고, 서명 업로드 URL 은 검증 뒤 덮어쓰기 길을 연다.
-- 값이 없으면(NULL) 거부한다 — 판정할 수 없으면 닫는 쪽.
CREATE FUNCTION workhub_private.c_storage_op() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN v LIKE 'storage.%' THEN substr(v, 9) ELSE v END FROM (SELECT NULLIF(current_setting('storage.operation', true), '') AS v) x
$$;

-- 업로드: 이 JWT 가 소유한 만료 전 예약(uploading)의 정확한 경로만, 직접 업로드 요청일 때만. 소속·승인 gate 를 다시 통과해야 한다.
CREATE FUNCTION workhub_storage.object_insertable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.file_objects; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR workhub_private.c_switch() <> 'open' OR workhub_private.c_storage_op() IS DISTINCT FROM 'object.upload' THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.file_objects WHERE bucket = 'workhub-collection-files' AND storage_key = p_name;
  IF f.id IS NULL OR f.state <> 'uploading' OR f.upload_expires_at <= clock_timestamp()
     OR NOT EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = f.owner_account_id AND a.auth_user_id = v_uid)
     OR EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = f.school_id AND d.resource_id = f.id) THEN
    RETURN false;
  END IF;
  BEGIN
    ctx := workhub_private.member_actor(f.owner_membership_id, false);
  EXCEPTION WHEN raise_exception THEN RETURN false;
  END;
  RETURN ctx.account_id = f.owner_account_id AND workhub_private.c_intent_ok(ctx, f.id);
END $$;

-- 읽기: (1) 업로드 요청 안에서 업로더 본인의 되읽기(INSERT ... RETURNING 이 SELECT 정책을 거치는 경우)
--       (2) 직접 내려받기 요청에서, ready 파일에 대해 이 계정의 만료 전·미회수 접근 기록이 있고 그 소속으로 원본 해석을 지금 다시 통과
--       서명 URL 발급·목록 조회 등 다른 요청 종류는 거부(c_storage_op 설명).
CREATE FUNCTION workhub_storage.object_readable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.file_objects; g record; ctx workhub_private.actor_context; res jsonb; v_op text := workhub_private.c_storage_op();
BEGIN
  IF v_uid IS NULL OR workhub_private.c_switch() = 'all_stopped' OR v_op IS NULL OR v_op NOT IN ('object.upload', 'object.get_authenticated') THEN
    RETURN false;
  END IF;
  SELECT * INTO f FROM workhub.file_objects WHERE bucket = 'workhub-collection-files' AND storage_key = p_name;
  IF f.id IS NULL THEN RETURN false; END IF;
  IF f.state = 'uploading' THEN
    RETURN workhub_storage.object_insertable(p_name);
  END IF;
  IF f.state <> 'ready' OR v_op <> 'object.get_authenticated' THEN RETURN false; END IF;
  FOR g IN SELECT ag.* FROM workhub.file_access_grants ag JOIN workhub.accounts a ON a.id = ag.granted_to_account_id
            WHERE ag.school_id = f.school_id AND ag.file_id = f.id AND a.auth_user_id = v_uid
              AND ag.revoked_at IS NULL AND ag.expires_at > clock_timestamp()
            ORDER BY ag.issued_at DESC LIMIT 5 LOOP
    BEGIN
      ctx := workhub_private.member_actor(g.granted_membership_id, false);
    EXCEPTION WHEN raise_exception THEN CONTINUE;
    END;
    res := workhub_private.c_parent_resolve(ctx,
      jsonb_build_object('kind', CASE g.resource_type WHEN 'collection_template' THEN 'template' WHEN 'unit_draft' THEN 'draft' ELSE 'submission' END,
                         'requestId', g.collection_id, 'unitId', g.unit_id,
                         'submissionId', CASE WHEN g.resource_type = 'submission' THEN g.resource_id END,
                         'version', CASE WHEN g.resource_type = 'submission' THEN NULL ELSE g.resource_version END),
      f.id, workhub_private.c_effective(ctx.school_id, ctx.school_today));
    IF res ->> 'code' IS NULL AND workhub_private.c_storage_ok() THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

-- ----------------------------------------------------------------------------
-- 11. 검증 작업자(서버 전용) — service_role 경로는 승인된 api_role_principals 1행, 직접 DB 경로는 R0 session_user 매핑
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.worker_actor(p_action text, p_school text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_principal text; s workhub.schools;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '로그인한 사용자 요청은 작업자로 실행할 수 없습니다.'; END IF;
  IF p_school IS NULL OR p_school !~ '^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO s FROM workhub.schools WHERE id = p_school AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF current_setting('role', true) = 'service_role' THEN
    -- PostgREST(authenticator → service_role): session_user 가 authenticator 라 R0 매핑을 쓸 수 없다.
    -- 운영자가 승인 근거와 함께 등록한 service_role ↔ 주체 1행으로만 해석한다(호출자가 주체 ID 를 고르지 못함).
    SELECT p.id INTO v_principal FROM workhub_private.api_role_principals a JOIN workhub.service_principals p ON p.id = a.service_principal_id
     WHERE a.api_role = 'service_role' AND a.revoked_at IS NULL AND p.active AND p_action = ANY (p.allowed_actions)
     FOR SHARE OF p;
    IF v_principal IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = format('service_role 에 연결된 %s 작업 주체가 없습니다.', p_action); END IF;
    PERFORM 1 FROM workhub.service_principal_scopes sc
     WHERE sc.service_principal_id = v_principal AND sc.scope_key = 's:' || p_school AND sc.revoked_at IS NULL
       AND sc.valid_from <= clock_timestamp() AND (sc.valid_to IS NULL OR clock_timestamp() < sc.valid_to) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '이 학교 범위 승인이 없습니다.'; END IF;
    ctx.actor_kind := 'service'; ctx.service_principal_id := v_principal; ctx.scope_key := 's:' || p_school; ctx.school_id := p_school;
  ELSE
    ctx := workhub_private.resolve_service_actor(p_action, 's:' || p_school);
  END IF;
  ctx.school_today := workhub_private.today_in(s.timezone);
  ctx.school_timezone := s.timezone;
  RETURN ctx;
END $$;

CREATE FUNCTION public.workhub_file_worker_heartbeat(p_school_id text, p_worker_id text, p_capability jsonb, p_ttl_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_exp timestamptz;
BEGIN
  ctx := workhub_private.worker_actor('file.verify', p_school_id);
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9_.:-]{1,100}$' OR p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 60 AND 1800 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.c_keys(p_capability, ARRAY['checks','release'], NULL);
  IF jsonb_typeof(p_capability -> 'checks') <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_capability -> 'checks') e
                 WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' NOT IN ('size','sha256','signature','container','encryption','malware'))
     OR jsonb_typeof(p_capability -> 'release') <> 'string' OR (p_capability ->> 'release') !~ '^[A-Za-z0-9_.:+-]{1,50}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_exp := clock_timestamp() + make_interval(secs => p_ttl_seconds);
  INSERT INTO workhub.file_verifier_heartbeats (service_principal_id, worker_id, capability, reported_at, expires_at)
  VALUES (ctx.service_principal_id, p_worker_id, p_capability, clock_timestamp(), v_exp);
  RETURN jsonb_build_object('servicePrincipalId', ctx.service_principal_id, 'expiresAt', workhub_private.c_iso(v_exp));
END $$;

-- 작업의 검사 기준: 예약 당시 고정한 정책판(학교·공통) ∩ 오늘 유효한 정책(있으면). 검사 도중 정책이 줄었으면 더 엄격한 쪽.
-- 압축 해제 한도(항목 수·확장 크기·압축률·XML 크기)는 아직 승인 정책 항목이 아니다 → 작업자의 기술 상한을 쓴다(후속 명세 3절).
CREATE FUNCTION workhub_private.c_job_policy(f workhub.file_objects, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u jsonb; c jsonb; eff jsonb := workhub_private.c_effective(f.school_id, p_today); v_ext text[]; v_max bigint;
BEGIN
  SELECT value INTO u FROM workhub.policy_versions WHERE scope_key = f.safety_policy_scope_key AND id = f.safety_policy_version_id;
  SELECT value INTO c FROM workhub.policy_versions WHERE scope_key = f.common_safety_policy_scope_key AND id = f.common_safety_policy_version_id;
  v_ext := ARRAY(SELECT e FROM unnest(ARRAY['pdf','hwp','hwpx','docx','xlsx','pptx']) WITH ORDINALITY x(e, o)
                 WHERE (u -> 'extensions') ? e AND (c -> 'extensions') ? e
                   AND (eff IS NULL OR (eff -> 'file' -> 'extensions') ? e) ORDER BY o);
  v_max := least((u ->> 'maxFileBytes')::bigint, (c ->> 'maxFileBytes')::bigint, (eff -> 'file' ->> 'maxFileBytes')::bigint);
  RETURN jsonb_build_object('uploadPolicyId', f.safety_policy_version_id, 'commonPolicyId', f.common_safety_policy_version_id,
    'currentUploadPolicyId', eff ->> 'uploadPolicyId', 'currentCommonPolicyId', eff ->> 'commonPolicyId',
    'extensions', to_jsonb(v_ext), 'maxFileBytes', v_max,
    'allowUnscanned', COALESCE((u ->> 'allowUnscanned')::boolean AND (c ->> 'allowUnscanned')::boolean
                               AND (eff IS NULL OR (eff ->> 'allowUnscanned')::boolean), false));
END $$;

-- 검증 작업을 끝내지 못하고 닫을 때(시도 초과·실물 없음/바뀜·파일 상태): 작업 failed, 파일 rejected, 감사·outbox 를 한 트랜잭션에.
-- 같은 작업은 failed 가 된 뒤 다시 고르지 않으므로 기록이 중복되지 않는다. 기록이 실패하면 호출 전체가 되돌아간다.
CREATE FUNCTION workhub_private.c_job_close(p_ctx workhub_private.actor_context, j workhub.file_verification_jobs, f workhub.file_objects,
  p_code text, p_worker text) RETURNS workhub.file_objects
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE workhub.file_verification_jobs SET state = 'failed', finished_at = clock_timestamp(), lease_owner = NULL, lease_expires_at = NULL,
         leased_by_service_id = NULL, last_error_code = p_code
   WHERE id = j.id;
  IF f.state IN ('uploaded','verifying') THEN
    UPDATE workhub.file_objects SET state = 'rejected', reject_reason = p_code, version = f.version + 1 WHERE id = f.id RETURNING * INTO f;
    PERFORM workhub_private.emit_outbox(p_ctx, 'file.verified', 'file_object', f.id, f.version, jsonb_build_object('file_id', f.id, 'state', f.state));
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'file.verify_fail', 'file_object', f.id, f.version, 'school', NULL,
    jsonb_build_object('job_id', j.id, 'error_code', p_code, 'final', true, 'worker_id', p_worker));
  RETURN f;
END $$;

CREATE FUNCTION public.workhub_file_worker_claim(p_school_id text, p_worker_id text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; j workhub.file_verification_jobs; f workhub.file_objects; o jsonb; v_out jsonb := '[]'::jsonb; v_code text;
  v_policy jsonb;
BEGIN
  ctx := workhub_private.worker_actor('file.verify', p_school_id);
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9_.:-]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF workhub_private.c_switch() <> 'open' THEN RETURN v_out; END IF;
  FOR j IN SELECT * FROM workhub.file_verification_jobs
            WHERE school_id = p_school_id AND ((state = 'queued' AND next_attempt_at <= clock_timestamp())
                                               OR (state = 'leased' AND lease_expires_at <= clock_timestamp()))
            ORDER BY next_attempt_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO f FROM workhub.file_objects WHERE school_id = j.school_id AND id = j.file_id FOR UPDATE;
    o := workhub_private.c_object_owner(f.bucket, f.storage_key);
    v_code := CASE WHEN f.state NOT IN ('uploaded','verifying') THEN 'file_state'
                   WHEN j.attempts >= j.max_attempts THEN 'verification_exhausted'
                   WHEN o IS NULL THEN 'object_missing'
                   WHEN (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id THEN 'object_changed' END;
    IF v_code IS NOT NULL THEN
      PERFORM workhub_private.c_job_close(ctx, j, f, v_code, p_worker_id);
      CONTINUE;
    END IF;
    UPDATE workhub.file_verification_jobs SET state = 'leased', attempts = j.attempts + 1, lease_owner = p_worker_id, lease_token = j.lease_token + 1,
           lease_expires_at = clock_timestamp() + interval '5 minutes', leased_by_service_id = ctx.service_principal_id
     WHERE id = j.id RETURNING * INTO j;
    IF f.state = 'uploaded' THEN UPDATE workhub.file_objects SET state = 'verifying', version = f.version + 1 WHERE id = f.id; END IF;
    v_policy := workhub_private.c_job_policy(f, ctx.school_today);
    v_out := v_out || jsonb_build_array(jsonb_build_object('jobId', j.id, 'leaseToken', j.lease_token, 'leaseExpiresAt', workhub_private.c_iso(j.lease_expires_at),
      'fileId', f.id, 'bucket', f.bucket, 'path', f.storage_key, 'storageObjectId', f.storage_object_id, 'extension', f.extension,
      'claimedBytes', f.claimed_bytes, 'claimedSha256', f.claimed_sha256, 'maxFileBytes', v_policy -> 'maxFileBytes', 'policy', v_policy));
  END LOOP;
  RETURN v_out;
END $$;

-- 검증 작업 lease 확인(읽기 전용): 작업자가 내려받기·검사 전후, 봉인 직전에 자기 lease 가 아직 유효한지와 현재 검사 기준을 본다.
-- 끝난 작업이면 결과(outcome)와 파일 상태를 돌려준다 — 봉인 응답을 잃었을 때 복구용. 다른 주체의 작업은 NOT_FOUND.
CREATE FUNCTION public.workhub_file_worker_job_inspect(p_job_id text, p_lease_token bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; j workhub.file_verification_jobs; f workhub.file_objects; o jsonb;
BEGIN
  IF p_job_id IS NULL OR p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO j FROM workhub.file_verification_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ctx := workhub_private.worker_actor('file.verify', j.school_id);
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = j.school_id AND id = j.file_id;
  o := workhub_private.c_object_owner(f.bucket, f.storage_key);
  RETURN jsonb_build_object('jobId', j.id, 'fileId', f.id, 'state', j.state, 'outcome', j.outcome, 'lastErrorCode', j.last_error_code,
    'leaseValid', j.state = 'leased' AND j.lease_token = p_lease_token AND j.leased_by_service_id IS NOT DISTINCT FROM ctx.service_principal_id
                  AND j.lease_expires_at > clock_timestamp() AND workhub_private.c_switch() <> 'all_stopped',
    'leaseExpiresAt', workhub_private.c_iso(j.lease_expires_at), 'fileState', f.state,
    'bucket', f.bucket, 'path', f.storage_key, 'storageObjectId', f.storage_object_id,
    'objectMatches', o IS NOT NULL AND (o ->> 'id')::uuid IS NOT DISTINCT FROM f.storage_object_id,
    'policy', workhub_private.c_job_policy(f, ctx.school_today));
END $$;

-- 봉인: lease·주체·만료·경로·실물 정체성·결과 모양을 모두 대조한다(NULL 인자는 INVALID_INPUT, 비교는 NULL 안전).
-- 같은 인자·같은 결과의 재봉인은 같은 응답(멱등). 전체 중지(all_stopped) 중에는 새 봉인을 받지 않는다(NOT_READY).
CREATE FUNCTION public.workhub_file_worker_seal(p_job_id text, p_lease_token bigint, p_file_id text, p_path text, p_storage_object_id uuid, p_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; j workhub.file_verification_jobs; f workhub.file_objects; o jsonb; v_sha text; v_outcome text; v_checks jsonb;
  v_worker text;
BEGIN
  IF p_job_id IS NULL OR p_lease_token IS NULL OR p_file_id IS NULL OR p_path IS NULL OR p_storage_object_id IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  SELECT * INTO j FROM workhub.file_verification_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ctx := workhub_private.worker_actor('file.verify', j.school_id);
  IF jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 4096 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_sha := workhub_private.request_sha256(jsonb_build_object('job', p_job_id, 'token', p_lease_token, 'file', p_file_id, 'path', p_path,
                                                              'object', p_storage_object_id, 'result', p_result));
  IF j.state = 'done' THEN
    IF j.result_sha256 IS NOT DISTINCT FROM v_sha THEN
      SELECT * INTO f FROM workhub.file_objects WHERE school_id = j.school_id AND id = j.file_id;
      RETURN jsonb_build_object('fileId', f.id, 'state', f.state, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF workhub_private.c_switch() = 'all_stopped' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF j.state IS DISTINCT FROM 'leased' OR j.lease_token IS DISTINCT FROM p_lease_token
     OR j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp()
     OR j.leased_by_service_id IS DISTINCT FROM ctx.service_principal_id OR j.file_id IS DISTINCT FROM p_file_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = j.school_id AND id = j.file_id FOR UPDATE;
  o := workhub_private.c_object_owner(f.bucket, f.storage_key);
  IF f.state IS DISTINCT FROM 'verifying' OR f.storage_key IS DISTINCT FROM p_path OR f.storage_object_id IS DISTINCT FROM p_storage_object_id
     OR o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM p_storage_object_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  PERFORM workhub_private.c_keys(p_result, ARRAY['outcome','sizeBytes','sha256','detectedMime','expandedBytes','scanState','rejectReason','checks'], NULL);
  v_outcome := p_result ->> 'outcome';
  v_checks := p_result -> 'checks';
  IF v_outcome NOT IN ('ready','rejected','quarantined')
     OR jsonb_typeof(p_result -> 'sizeBytes') <> 'number' OR (p_result ->> 'sizeBytes') !~ '^(0|[1-9][0-9]{0,11})$'
     OR jsonb_typeof(p_result -> 'sha256') <> 'string' OR (p_result ->> 'sha256') !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_result -> 'detectedMime') <> 'string' OR (p_result ->> 'detectedMime') !~ '^[a-z0-9.+-]{1,60}/[a-z0-9.+-]{1,100}$'
     OR NOT (jsonb_typeof(p_result -> 'expandedBytes') = 'null' OR (p_result ->> 'expandedBytes') ~ '^(0|[1-9][0-9]{0,14})$')
     OR (p_result ->> 'scanState') NOT IN ('clean','rejected','error','not_scanned')
     OR NOT (jsonb_typeof(p_result -> 'rejectReason') = 'null' OR (p_result ->> 'rejectReason') ~ '^[a-z_]{2,40}$')
     OR jsonb_typeof(v_checks) <> 'object' OR octet_length(v_checks::text) > 2048
     OR EXISTS (SELECT 1 FROM jsonb_each(v_checks) e WHERE e.key NOT IN ('size','sha256','signature','container','encryption','malware')
                                                        OR jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_outcome = 'ready' AND NOT (
       (p_result ->> 'sizeBytes')::bigint = f.claimed_bytes AND p_result ->> 'sha256' = f.claimed_sha256
       AND p_result ->> 'scanState' IN ('clean','not_scanned') AND jsonb_typeof(p_result -> 'rejectReason') = 'null'
       AND v_checks @> '{"size":true,"sha256":true,"signature":true,"container":true,"encryption":true}'::jsonb
       AND (p_result ->> 'scanState' <> 'clean' OR v_checks @> '{"malware":true}'::jsonb)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_outcome <> 'ready' AND jsonb_typeof(p_result -> 'rejectReason') = 'null' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_outcome = 'quarantined' AND p_result ->> 'scanState' <> 'rejected' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  UPDATE workhub.file_objects SET state = v_outcome, size_bytes = (p_result ->> 'sizeBytes')::bigint, sha256 = p_result ->> 'sha256',
         detected_mime = p_result ->> 'detectedMime', expanded_bytes = (p_result ->> 'expandedBytes')::bigint, verification = v_checks,
         scan_state = p_result ->> 'scanState', reject_reason = p_result ->> 'rejectReason', verified_at = clock_timestamp(),
         verified_by_service_id = ctx.service_principal_id, version = f.version + 1
   WHERE id = f.id RETURNING * INTO f;
  UPDATE workhub.file_verification_jobs SET state = 'done', outcome = v_outcome, finished_at = clock_timestamp(), result_sha256 = v_sha,
         lease_owner = NULL, lease_expires_at = NULL, leased_by_service_id = NULL
   WHERE id = j.id;
  PERFORM workhub_private.write_audit(ctx, 'file.verify', 'file_object', f.id, f.version, 'school', NULL,
    jsonb_build_object('job_id', j.id, 'worker_id', j.lease_owner, 'outcome', v_outcome, 'scan_state', f.scan_state));
  PERFORM workhub_private.emit_outbox(ctx, 'file.verified', 'file_object', f.id, f.version, jsonb_build_object('file_id', f.id, 'state', f.state));
  RETURN jsonb_build_object('fileId', f.id, 'state', f.state, 'replayed', false);
END $$;

-- 일시 실패: 다시 대기열로. 시도 횟수를 다 썼으면 파일을 rejected 로 닫고 감사·outbox 를 같이 남긴다.
-- lease 대조는 봉인과 같다(NULL 안전, 만료된 lease·다른 주체·옛 token 은 CONFLICT). 중지 중에도 받는다(작업을 되돌려 놓을 뿐).
CREATE FUNCTION public.workhub_file_worker_fail(p_job_id text, p_lease_token bigint, p_error_code text, p_retry_after_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; j workhub.file_verification_jobs; f workhub.file_objects; v_final boolean;
BEGIN
  IF p_job_id IS NULL OR p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO j FROM workhub.file_verification_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ctx := workhub_private.worker_actor('file.verify', j.school_id);
  IF p_error_code IS NULL OR p_error_code !~ '^[a-z_]{2,40}$' OR p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 10 AND 3600 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF j.state IS DISTINCT FROM 'leased' OR j.lease_token IS DISTINCT FROM p_lease_token
     OR j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp()
     OR j.leased_by_service_id IS DISTINCT FROM ctx.service_principal_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = j.school_id AND id = j.file_id FOR UPDATE;
  v_final := j.attempts >= j.max_attempts;
  IF v_final THEN
    f := workhub_private.c_job_close(ctx, j, f, 'verification_exhausted', j.lease_owner);
    RETURN jsonb_build_object('fileId', f.id, 'state', f.state, 'final', true);
  END IF;
  UPDATE workhub.file_verification_jobs SET state = 'queued', next_attempt_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
         lease_owner = NULL, lease_expires_at = NULL, leased_by_service_id = NULL, last_error_code = p_error_code
   WHERE id = j.id;
  IF f.state = 'verifying' THEN
    UPDATE workhub.file_objects SET state = 'uploaded', version = f.version + 1 WHERE id = f.id RETURNING * INTO f;
  END IF;
  PERFORM workhub_private.write_audit(ctx, 'file.verify_fail', 'file_object', f.id, f.version, 'school', NULL,
    jsonb_build_object('job_id', j.id, 'error_code', p_error_code, 'final', false));
  RETURN jsonb_build_object('fileId', f.id, 'state', f.state, 'final', false);
END $$;

-- 정리 대상 인수: 어디에도 연결된 적 없는(first_linked_at IS NULL) 파일 중 보존 기간이 지난 것만.
-- 파일 행을 잠근 뒤(SKIP LOCKED) 정리 원장에 blocked 로 올린다 → 그 뒤로는 첨부·업로드 확인이 거부된다.
CREATE FUNCTION public.workhub_file_worker_cleanup_claim(p_school_id text, p_worker_id text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; eff jsonb; v_days integer; f workhub.file_objects; l workhub.deletion_ledger; v_reason text; v_out jsonb := '[]'::jsonb;
        o jsonb; v_obj uuid;
BEGIN
  ctx := workhub_private.worker_actor('file.cleanup', p_school_id);
  IF p_worker_id IS NULL OR p_worker_id !~ '^[A-Za-z0-9_.:-]{1,100}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF workhub_private.c_switch() <> 'open' THEN RETURN v_out; END IF;
  eff := workhub_private.c_effective(p_school_id, ctx.school_today);
  IF eff IS NULL THEN RETURN v_out; END IF;   -- 승인된 보존 정책 없이는 아무것도 지우지 않는다
  v_days := (eff ->> 'unattachedRetentionDays')::integer;
  -- 이전 인수의 lease 가 끝난 blocked 행을 다시 인수
  FOR l IN SELECT * FROM workhub.deletion_ledger WHERE school_id = p_school_id AND state = 'blocked' AND lease_expires_at <= clock_timestamp()
            ORDER BY seq LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    UPDATE workhub.deletion_ledger SET lease_token = l.lease_token + 1, lease_expires_at = clock_timestamp() + interval '10 minutes',
           leased_by_service_id = ctx.service_principal_id
     WHERE id = l.id RETURNING * INTO l;
    SELECT * INTO f FROM workhub.file_objects WHERE school_id = l.school_id AND id = l.resource_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('ledgerId', l.id, 'leaseToken', l.lease_token, 'fileId', f.id, 'bucket', f.bucket,
      'path', f.storage_key, 'storageObjectId', l.storage_object_id, 'reason', l.reason));
  END LOOP;
  FOR f IN SELECT fo.* FROM workhub.file_objects fo
            WHERE fo.school_id = p_school_id AND fo.first_linked_at IS NULL AND fo.state IN ('uploading','ready','rejected','quarantined')
              AND NOT EXISTS (SELECT 1 FROM workhub.deletion_ledger d WHERE d.school_id = fo.school_id AND d.resource_id = fo.id)
              AND NOT EXISTS (SELECT 1 FROM workhub.file_verification_jobs vj WHERE vj.file_id = fo.id AND vj.state = 'leased')
              AND ((fo.state = 'uploading' AND fo.upload_expires_at < clock_timestamp() - interval '1 day')
                OR (fo.state IN ('rejected','quarantined') AND fo.updated_at < clock_timestamp() - make_interval(days => v_days))
                OR (fo.state = 'ready' AND fo.created_at < clock_timestamp() - make_interval(days => v_days)))
            ORDER BY fo.id LIMIT greatest(p_limit - jsonb_array_length(v_out), 0) FOR UPDATE SKIP LOCKED LOOP
    -- 잠근 뒤 다시 확인(그 사이 첨부됐으면 건너뜀)
    CONTINUE WHEN f.first_linked_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM workhub.unit_draft_files x WHERE x.school_id = f.school_id AND x.file_id = f.id)
      OR EXISTS (SELECT 1 FROM workhub.collection_template_files x WHERE x.school_id = f.school_id AND x.file_id = f.id)
      OR EXISTS (SELECT 1 FROM workhub.submission_files x WHERE x.school_id = f.school_id AND x.file_id = f.id);
    v_reason := CASE f.state WHEN 'uploading' THEN 'upload_expired' WHEN 'ready' THEN 'unattached_retention' ELSE 'rejected_file' END;
    -- 원장에 고정할 객체 정체성(K28). 업로드 확인(complete)을 거친 파일은 그때 기록한 ID 를 그대로 쓴다 — 실물이 그사이 바뀌었으면
    -- inspect 가 objectMatches=false 로 잡는다. complete 가 오지 않은 업로드(uploading)는 파일 행에 ID 가 없으므로, 이 경로의 실물을
    -- 지금 읽어 고정한다. 이 시점은 예약 만료 1일 뒤이고 원장 행이 생기면 같은 경로 업로드가 영구히 거부되므로, 고정 뒤 바뀔 길이 없다.
    -- 실물이 없으면 NULL 로 남는다(= 지울 실물 없음. NULL 을 '일치' 로 보지 않는다).
    o := workhub_private.c_object_owner(f.bucket, f.storage_key);
    v_obj := CASE WHEN f.storage_object_id IS NOT NULL THEN f.storage_object_id ELSE (o ->> 'id')::uuid END;
    INSERT INTO workhub.deletion_ledger (school_id, resource_id, file_sha256, storage_object_id, reason, retention_policy_scope_key,
        retention_policy_version_id, requested_by_service_id, lease_token, lease_expires_at, leased_by_service_id, manifest_sha256)
    VALUES (f.school_id, f.id, f.sha256, v_obj, v_reason, 's:' || f.school_id, eff ->> 'submissionPolicyId', ctx.service_principal_id,
        1, clock_timestamp() + interval '10 minutes', ctx.service_principal_id,
        workhub_private.request_sha256(jsonb_build_object('file', f.id, 'path', f.storage_key, 'object', v_obj, 'sha256', f.sha256, 'reason', v_reason)))
    RETURNING * INTO l;
    PERFORM workhub_private.write_audit(ctx, 'file.cleanup_block', 'file_object', f.id, f.version, 'school', NULL,
      jsonb_build_object('ledger_id', l.id, 'reason', v_reason, 'worker_id', p_worker_id,
        'object_source', CASE WHEN f.storage_object_id IS NOT NULL THEN 'file' WHEN v_obj IS NOT NULL THEN 'storage' ELSE 'absent' END));
    v_out := v_out || jsonb_build_array(jsonb_build_object('ledgerId', l.id, 'leaseToken', l.lease_token, 'fileId', f.id, 'bucket', f.bucket,
      'path', f.storage_key, 'storageObjectId', l.storage_object_id, 'reason', v_reason));
  END LOOP;
  RETURN v_out;
END $$;

-- 정리 원장 lease 확인(읽기 전용): Storage 삭제 직전에 원장이 아직 blocked·같은 lease·같은 주체인지, 파일이 어디에도 연결되지 않았는지,
-- 실물이 원장에 적힌 그 객체인지를 본다. 끝난 행이면 결과(deleted/retained)를 돌려준다 — 확정 응답을 잃었을 때 복구용.
-- objectMatches 는 실물이 있고 그 ID 가 원장 고정값과 같을 때만 true(원장이 NULL 이면 항상 false). 작업자 판단:
-- 실물 없음 → 지울 것 없이 deleted 확정 / 실물 있음 + 일치 → Storage 삭제 후 deleted / 실물 있음 + 불일치 → 지우지 않음(retained 또는 다음 실행).
CREATE FUNCTION public.workhub_file_worker_cleanup_inspect(p_ledger_id text, p_lease_token bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; l workhub.deletion_ledger; f workhub.file_objects; o jsonb;
BEGIN
  IF p_ledger_id IS NULL OR p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO l FROM workhub.deletion_ledger WHERE id = p_ledger_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ctx := workhub_private.worker_actor('file.cleanup', l.school_id);
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = l.school_id AND id = l.resource_id;
  o := workhub_private.c_object_owner(f.bucket, f.storage_key);
  RETURN jsonb_build_object('ledgerId', l.id, 'fileId', f.id, 'state', l.state,
    'outcome', CASE l.state WHEN 'completed' THEN 'deleted' WHEN 'retained' THEN 'retained' END, 'retainedReason', l.retained_reason,
    'leaseValid', l.state = 'blocked' AND l.lease_token = p_lease_token AND l.leased_by_service_id = ctx.service_principal_id
                  AND l.lease_expires_at > clock_timestamp() AND workhub_private.c_switch() <> 'all_stopped',
    'leaseExpiresAt', workhub_private.c_iso(l.lease_expires_at),
    'linked', f.first_linked_at IS NOT NULL
              OR EXISTS (SELECT 1 FROM workhub.unit_draft_files x WHERE x.school_id = f.school_id AND x.file_id = f.id)
              OR EXISTS (SELECT 1 FROM workhub.collection_template_files x WHERE x.school_id = f.school_id AND x.file_id = f.id)
              OR EXISTS (SELECT 1 FROM workhub.submission_files x WHERE x.school_id = f.school_id AND x.file_id = f.id),
    'verifying', f.state = 'verifying' OR EXISTS (SELECT 1 FROM workhub.file_verification_jobs vj WHERE vj.file_id = f.id AND vj.state = 'leased'),
    'bucket', f.bucket, 'path', f.storage_key, 'storageObjectId', l.storage_object_id,
    'objectPresent', o IS NOT NULL,
    'objectMatches', o IS NOT NULL AND (o ->> 'id')::uuid IS NOT DISTINCT FROM l.storage_object_id);
END $$;

-- 정리 확정: deleted 는 Storage API 로 실물을 지운 뒤에만(실물 행이 남아 있으면 거부). retained 는 지우지 않고 사유를 남긴다.
-- lease 대조는 NULL 안전(만료·다른 주체·옛 token 은 CONFLICT). 같은 token·같은 결과로 다시 보내면 같은 응답(replayed=true),
-- 다른 결과면 CONFLICT. 전체 중지(all_stopped) 중에는 새 확정을 받지 않는다(NOT_READY) — 원장은 blocked 로 남아 파일은 계속 막힌다.
CREATE FUNCTION public.workhub_file_worker_cleanup_done(p_ledger_id text, p_lease_token bigint, p_outcome text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; l workhub.deletion_ledger; f workhub.file_objects;
BEGIN
  IF p_ledger_id IS NULL OR p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO l FROM workhub.deletion_ledger WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  ctx := workhub_private.worker_actor('file.cleanup', l.school_id);
  IF p_outcome IS NULL OR p_outcome NOT IN ('deleted','retained')
     OR (p_outcome = 'retained' AND (p_reason IS NULL OR p_reason !~ '^[a-z_]{2,40}$'))
     OR (p_outcome = 'deleted' AND p_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF l.state IN ('completed','retained') THEN
    -- 응답 유실 뒤 재전송: 마지막 lease 의 token·주체와 결과가 모두 같아야 한다
    IF l.lease_token = p_lease_token AND l.leased_by_service_id = ctx.service_principal_id
       AND ((l.state = 'completed' AND p_outcome = 'deleted') OR (l.state = 'retained' AND p_outcome = 'retained' AND l.retained_reason = p_reason)) THEN
      RETURN jsonb_build_object('fileId', l.resource_id, 'ledgerId', l.id, 'outcome', p_outcome, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF workhub_private.c_switch() = 'all_stopped' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF l.state IS DISTINCT FROM 'blocked' OR l.lease_token IS DISTINCT FROM p_lease_token
     OR l.lease_expires_at IS NULL OR l.lease_expires_at <= clock_timestamp()
     OR l.leased_by_service_id IS DISTINCT FROM ctx.service_principal_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  SELECT * INTO f FROM workhub.file_objects WHERE school_id = l.school_id AND id = l.resource_id FOR UPDATE;
  IF p_outcome = 'deleted' THEN
    IF workhub_private.c_object_owner(f.bucket, f.storage_key) IS NOT NULL OR f.state = 'verifying' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    UPDATE workhub.file_objects SET state = 'deleted', deleted_at = clock_timestamp(), version = f.version + 1 WHERE id = f.id RETURNING * INTO f;
    UPDATE workhub.deletion_ledger SET state = 'completed', completed_at = clock_timestamp() WHERE id = l.id;
  ELSE
    UPDATE workhub.deletion_ledger SET state = 'retained', completed_at = clock_timestamp(), retained_reason = p_reason WHERE id = l.id;
  END IF;
  PERFORM workhub_private.write_audit(ctx, 'file.cleanup', 'file_object', f.id, f.version, 'school', NULL,
    jsonb_build_object('ledger_id', l.id, 'outcome', p_outcome));
  RETURN jsonb_build_object('fileId', f.id, 'ledgerId', l.id, 'outcome', p_outcome, 'replayed', false);
END $$;

-- ----------------------------------------------------------------------------
-- 12. 앱 호환 함수 9개. 소속 gate 실패는 R0 와 같은 예외 경로(봉투 없음), 그 뒤 업무 오류는 봉투로.
--     안쪽 블록의 예외 처리 = 하위 트랜잭션: 업무 오류로 돌려줄 때 그 블록의 변경(원본·접수증·감사·outbox)은 전부 되돌아간다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_collection_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.c_ok(ctx, workhub_private.c_readiness(ctx.school_id, ctx.school_today));
END $$;

CREATE FUNCTION public.workhub_collection_list(p_member_id text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_list(ctx, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_collection_get(p_member_id text, p_request_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_get(ctx, p_request_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_collection_draft_get(p_member_id text, p_request_id text, p_unit_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_draft_get(ctx, p_request_id, p_unit_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_collection_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_mutate(ctx, p_command, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_file_prepare(p_member_id text, p_parent jsonb, p_file jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_prepare(ctx, p_parent, p_file, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_file_complete(p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_complete(ctx, p_file_id, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_file_status(p_member_id text, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_status(ctx, p_file_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_file_access(p_member_id text, p_parent jsonb, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.c_ok(ctx, workhub_private.c_access(ctx, p_parent, p_file_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.c_business(SQLERRM) THEN RETURN workhub_private.c_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 13. 비공개 버킷·Storage 정책 2개
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('workhub-collection-files', 'workhub-collection-files', false);
DO $$
BEGIN
  -- 버킷 크기 상한(기술 상한 100MiB). 열이 있는 Storage 판에서만 설정한다.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit = 104857600 WHERE id = ''workhub-collection-files''';
  END IF;
END $$;

CREATE POLICY workhub_collection_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workhub-collection-files' AND workhub_storage.object_insertable(name));
CREATE POLICY workhub_collection_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'workhub-collection-files' AND workhub_storage.object_readable(name));
INSERT INTO workhub_private.r1_storage_policies (policy_name, cmd, expr_md5)
SELECT pol.polname, pol.polcmd,
       md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
  FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname IN ('workhub_collection_insert','workhub_collection_select');

-- ----------------------------------------------------------------------------
-- 14. 권한 — 앱 함수 9개는 authenticated, 작업자 함수 8개는 service_role 만. 내부 함수는 API 역할에 0.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.workhub_collection_readiness(text), public.workhub_collection_list(text, text),
  public.workhub_collection_get(text, text), public.workhub_collection_draft_get(text, text, text),
  public.workhub_collection_mutate(text, jsonb, text), public.workhub_file_prepare(text, jsonb, jsonb, text),
  public.workhub_file_complete(text, text, text), public.workhub_file_status(text, text), public.workhub_file_access(text, jsonb, text),
  public.workhub_file_worker_heartbeat(text, text, jsonb, integer), public.workhub_file_worker_claim(text, text, integer),
  public.workhub_file_worker_seal(text, bigint, text, text, uuid, jsonb), public.workhub_file_worker_fail(text, bigint, text, integer),
  public.workhub_file_worker_cleanup_claim(text, text, integer), public.workhub_file_worker_cleanup_done(text, bigint, text, text),
  public.workhub_file_worker_job_inspect(text, bigint), public.workhub_file_worker_cleanup_inspect(text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_collection_readiness(text), public.workhub_collection_list(text, text),
  public.workhub_collection_get(text, text), public.workhub_collection_draft_get(text, text, text),
  public.workhub_collection_mutate(text, jsonb, text), public.workhub_file_prepare(text, jsonb, jsonb, text),
  public.workhub_file_complete(text, text, text), public.workhub_file_status(text, text), public.workhub_file_access(text, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_file_worker_heartbeat(text, text, jsonb, integer), public.workhub_file_worker_claim(text, text, integer),
  public.workhub_file_worker_seal(text, bigint, text, text, uuid, jsonb), public.workhub_file_worker_fail(text, bigint, text, integer),
  public.workhub_file_worker_cleanup_claim(text, text, integer), public.workhub_file_worker_cleanup_done(text, bigint, text, text),
  public.workhub_file_worker_job_inspect(text, bigint), public.workhub_file_worker_cleanup_inspect(text, bigint)
  TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private, workhub_storage FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA workhub_storage TO authenticated;
GRANT EXECUTE ON FUNCTION workhub_storage.object_insertable(text), workhub_storage.object_readable(text) TO authenticated;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('workhub','workhub_private') AND c.relkind = 'r' AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.workhub_collection_readiness(text) IS '업무실 R1 수합: 준비 상태(DB·Storage·검증기·승인 정책). 고정값 아님.';
COMMENT ON FUNCTION public.workhub_collection_list(text, text) IS '업무실 R1 수합: 읽을 수 있는 수합 목록(50개, 서명 cursor).';
COMMENT ON FUNCTION public.workhub_collection_get(text, text) IS '업무실 R1 수합: 상세(초안 제외, 한 snapshot).';
COMMENT ON FUNCTION public.workhub_collection_draft_get(text, text, text) IS '업무실 R1 수합: 현재 공동 초안(구성원만).';
COMMENT ON FUNCTION public.workhub_collection_mutate(text, jsonb, text) IS '업무실 R1 수합: 명령 8종(요청 번호·기대판·감사·outbox 한 트랜잭션).';
COMMENT ON FUNCTION public.workhub_file_prepare(text, jsonb, jsonb, text) IS '업무실 R1 파일: 업로드 예약(경로 1회 발급).';
COMMENT ON FUNCTION public.workhub_file_complete(text, text, text) IS '업무실 R1 파일: 업로드 확인·검증 대기열 접수(매번 재평가).';
COMMENT ON FUNCTION public.workhub_file_status(text, text) IS '업무실 R1 파일: 업로더의 현재 상태 조회.';
COMMENT ON FUNCTION public.workhub_file_access(text, jsonb, text) IS '업무실 R1 파일: 내려받기 허가(5분 접근 기록, URL 없음).';
COMMENT ON FUNCTION public.workhub_file_worker_seal(text, bigint, text, text, uuid, jsonb) IS '업무실 R1 검증 작업자 전용(service_role): 검증 결과 봉인.';

INSERT INTO workhub_private.batch_installs (batch, release) VALUES ('R1-03', '2026-10-15.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 15. 검증 — 모든 행의 status 가 ok 여야 한다. R1-03-6 은 "준비 안 됨"이 정상이다(검증기·정책 전).
-- ----------------------------------------------------------------------------
SELECT 'R1-03-1' AS no, '앱 함수 9개·작업자 함수 8개 존재(SECURITY DEFINER, search_path 고정)' AS item,
       CASE WHEN count(*) = 17 THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM pg_proc p WHERE p.oid IN (
  'public.workhub_collection_readiness(text)'::regprocedure, 'public.workhub_collection_list(text,text)'::regprocedure,
  'public.workhub_collection_get(text,text)'::regprocedure, 'public.workhub_collection_draft_get(text,text,text)'::regprocedure,
  'public.workhub_collection_mutate(text,jsonb,text)'::regprocedure, 'public.workhub_file_prepare(text,jsonb,jsonb,text)'::regprocedure,
  'public.workhub_file_complete(text,text,text)'::regprocedure, 'public.workhub_file_status(text,text)'::regprocedure,
  'public.workhub_file_access(text,jsonb,text)'::regprocedure, 'public.workhub_file_worker_heartbeat(text,text,jsonb,integer)'::regprocedure,
  'public.workhub_file_worker_claim(text,text,integer)'::regprocedure, 'public.workhub_file_worker_seal(text,bigint,text,text,uuid,jsonb)'::regprocedure,
  'public.workhub_file_worker_fail(text,bigint,text,integer)'::regprocedure, 'public.workhub_file_worker_cleanup_claim(text,text,integer)'::regprocedure,
  'public.workhub_file_worker_cleanup_done(text,bigint,text,text)'::regprocedure,
  'public.workhub_file_worker_job_inspect(text,bigint)'::regprocedure, 'public.workhub_file_worker_cleanup_inspect(text,bigint)'::regprocedure)
  AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
UNION ALL
SELECT 'R1-03-2', '작업자 함수는 anon·authenticated 가 실행할 수 없음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated']) r
WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_file\_worker\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'R1-03-3', '앱 함수는 anon 이 실행할 수 없고 authenticated 만 실행',
       CASE WHEN count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) = 0
             AND count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 9 THEN 'ok' ELSE 'FAIL' END, ''
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_collection\_%' OR p.proname IN ('workhub_file_prepare','workhub_file_complete','workhub_file_status','workhub_file_access'))
UNION ALL
SELECT 'R1-03-4', '내부 함수(workhub·workhub_private)는 API 역할 실행 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'R1-03-5', '비공개 버킷 + Storage 정책 2개가 설치 지문과 같음',
       CASE WHEN workhub_private.c_storage_ok() THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'R1-03-6', '활성 학교의 준비 상태 = 준비 안 됨(검증기·정책 전이 정상)',
       CASE WHEN bool_and(NOT (workhub_private.c_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'available')::boolean) THEN 'ok' ELSE 'FAIL' END,
       string_agg(workhub_private.c_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason', ',')
FROM workhub.schools s WHERE s.status = 'active'
ORDER BY 1;
