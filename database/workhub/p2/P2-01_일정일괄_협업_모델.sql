-- ============================================================================
-- P2-01  일정 일괄 가져오기 · 협업 요청 — 모델 (비활성 설치)
--
-- ▣ 통합 SQL 요청서 2단계. 앱 계약: docs/workhub/pilot-completion/calendar-batch-contract.md · cooperation-contract.md
--   앱 parser: apps/workhub/src/calendar/batch-adapter.ts · batch-domain.ts · cooperation/adapter.ts · cooperation/protocol.ts
-- ▣ 무엇을 만드나(기존 표·함수는 하나도 바꾸지 않는다)
--   공통(뒤 배치도 씀): 모듈 활성화(module_activations) · 요청 접수증(request_receipts) · JS 와 같은 canonical JSON·SHA-256
--   일정 일괄: 원본 묶음(calendar_import_sources·_source_editors) · 행 계보(calendar_import_rows) · 비교 결과(calendar_import_prepares)
--              · 적용 묶음(calendar_import_batches)
--   협업: 요청(cooperation_requests) · 상태 이력(cooperation_history) · 당사자별 본인 업무 연결(cooperation_task_links)
-- ▣ 이 파일을 실행해도 어느 학교·모듈도 켜지지 않는다(module_activations 0행 → 모든 함수 UNAVAILABLE).
-- ▣ 한 트랜잭션. 중간에 ERROR 가 나면 아무것도 남지 않는다. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p1_installs') IS NULL THEN
    RAISE EXCEPTION 'P2 중단: P1-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.p1_installs WHERE batch IN ('P1-01','P1-02') AND release = '2026-10-16.1') <> 2 THEN
    RAISE EXCEPTION 'P2 중단: P1-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'P2 중단: PostgreSQL 15 이상이 필요합니다(regexp_count).';
  END IF;
  IF to_regclass('workhub_private.p2_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P2 중단: P2-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.module_activations') IS NOT NULL OR to_regclass('workhub.request_receipts') IS NOT NULL
     OR to_regclass('workhub.calendar_import_sources') IS NOT NULL OR to_regclass('workhub.calendar_import_source_editors') IS NOT NULL
     OR to_regclass('workhub.calendar_import_rows') IS NOT NULL OR to_regclass('workhub.calendar_import_prepares') IS NOT NULL
     OR to_regclass('workhub.calendar_import_batches') IS NOT NULL OR to_regclass('workhub.cooperation_requests') IS NOT NULL
     OR to_regclass('workhub.cooperation_history') IS NOT NULL OR to_regclass('workhub.cooperation_task_links') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p2\_%' OR proname LIKE 'workhub\_calendar\_batch\_%' OR proname LIKE 'workhub\_cooperation\_%') THEN
    RAISE EXCEPTION 'P2 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p2_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p2_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p2_installs_batch_check CHECK (batch IN ('P2-01','P2-02')),
  CONSTRAINT p2_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p2_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p2_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 공통 — 모듈 활성화 (학교 × 모듈). 뒤 배치(3~7단계)도 같은 표에 모듈 이름만 더해 쓴다.
--    행이 없거나 stopped 면 그 모듈의 조회·새 변경은 UNAVAILABLE. 이미 받은 요청의 접수증 재조회는 된다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.module_activations (
  school_id                 text NOT NULL,
  module                    text NOT NULL,
  state                     text NOT NULL DEFAULT 'active',
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  activated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_changed_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_note                text,
  updated_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT module_activations_pkey PRIMARY KEY (school_id, module),
  CONSTRAINT module_activations_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT module_activations_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT module_activations_module_check CHECK (module ~ '^[a-z][a-z_]{2,39}$'),
  CONSTRAINT module_activations_state_check CHECK (state IN ('active','stopped')),
  CONSTRAINT module_activations_approval_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200),
  CONSTRAINT module_activations_note_check CHECK (state_note IS NULL OR length(state_note) <= 200)
);
CREATE TRIGGER module_activations_identity BEFORE UPDATE ON workhub.module_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('school_id','module','approved_by_membership_id','approval_ref','activated_at');

-- ----------------------------------------------------------------------------
-- 3. 공통 — 요청 접수증. 반영(applied)과 확정 거절(rejected)을 모두 남긴다(같은 키 재요청은 원래 결과를 돌려준다).
--    범위: (학교, 계정, 소속, 모듈, 요청 번호). command_hash = SHA-256(JS canonical(p_command)).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.request_receipts (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  school_id     text NOT NULL,
  account_id    text NOT NULL,
  membership_id text NOT NULL,
  module        text NOT NULL,
  request_key   text NOT NULL,
  command_hash  text NOT NULL,
  outcome       text NOT NULL,
  error_code    text,
  response      jsonb NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT request_receipts_pkey PRIMARY KEY (id),
  CONSTRAINT request_receipts_scope_key UNIQUE (school_id, account_id, membership_id, module, request_key),
  CONSTRAINT request_receipts_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT request_receipts_module_check CHECK (module ~ '^[a-z][a-z_]{2,39}$'),
  CONSTRAINT request_receipts_key_check CHECK (request_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'),
  CONSTRAINT request_receipts_hash_check CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT request_receipts_outcome_check CHECK (outcome IN ('applied','rejected')),
  CONSTRAINT request_receipts_code_check CHECK ((outcome = 'rejected') = (error_code IS NOT NULL)
    AND (error_code IS NULL OR error_code IN ('UNAVAILABLE','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT'))),
  CONSTRAINT request_receipts_response_check CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 65536)
);
CREATE TRIGGER request_receipts_immutable BEFORE UPDATE OR DELETE ON workhub.request_receipts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 4. 일정 일괄 가져오기
-- ----------------------------------------------------------------------------
-- 원본 묶음: 학교 안에서 source_key 로 하나. 만든 사람(계정)과 수정 담당자(editors)만 고칠 수 있다.
CREATE TABLE workhub.calendar_import_sources (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  source_key               text NOT NULL,
  label                    text NOT NULL,
  created_by_account_id    text NOT NULL,
  created_by_membership_id text NOT NULL,
  revision                 bigint NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT calendar_import_sources_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_import_sources_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT calendar_import_sources_key_key UNIQUE (school_id, source_key),
  CONSTRAINT calendar_import_sources_creator_fkey FOREIGN KEY (school_id, created_by_membership_id, created_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT calendar_import_sources_key_check CHECK (source_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'),
  CONSTRAINT calendar_import_sources_label_check CHECK (length(label) BETWEEN 1 AND 160),
  CONSTRAINT calendar_import_sources_revision_check CHECK (revision > 0)
);
CREATE TRIGGER calendar_import_sources_identity BEFORE UPDATE ON workhub.calendar_import_sources
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','source_key','created_by_account_id','created_by_membership_id','created_at');

-- 수정 담당자(계정 기준). 이번 단계에는 바꾸는 화면·함수가 없다(학교 관리 범위). 만든 사람은 따로 행이 없어도 담당자다.
CREATE TABLE workhub.calendar_import_source_editors (
  school_id           text NOT NULL,
  source_id           text NOT NULL,
  account_id          text NOT NULL,
  added_by_account_id text NOT NULL,
  added_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT calendar_import_source_editors_pkey PRIMARY KEY (source_id, account_id),
  CONSTRAINT calendar_import_source_editors_source_fkey FOREIGN KEY (school_id, source_id) REFERENCES workhub.calendar_import_sources(school_id, id),
  CONSTRAINT calendar_import_source_editors_account_fkey FOREIGN KEY (account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT calendar_import_source_editors_added_by_fkey FOREIGN KEY (added_by_account_id) REFERENCES workhub.accounts(id)
);

-- 행 계보: (원본 묶음, 행 sourceId) → 일정. 마지막으로 승인·적용한 원본 일정(baseline, 서버 정규화 형식)과 그 지문.
CREATE TABLE workhub.calendar_import_rows (
  id                    text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id             text NOT NULL,
  source_id             text NOT NULL,
  source_row_id         text NOT NULL,
  event_id              text NOT NULL,
  baseline              jsonb NOT NULL,
  source_hash           text NOT NULL,
  applied_event_version integer NOT NULL,
  last_batch_id         text NOT NULL,
  applied_by_account_id text NOT NULL,
  applied_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision              integer NOT NULL DEFAULT 1,
  CONSTRAINT calendar_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_import_rows_source_row_key UNIQUE (source_id, source_row_id),
  CONSTRAINT calendar_import_rows_event_key UNIQUE (event_id),
  CONSTRAINT calendar_import_rows_source_fkey FOREIGN KEY (school_id, source_id) REFERENCES workhub.calendar_import_sources(school_id, id),
  CONSTRAINT calendar_import_rows_event_fkey FOREIGN KEY (school_id, event_id) REFERENCES workhub.events(school_id, id),
  CONSTRAINT calendar_import_rows_account_fkey FOREIGN KEY (applied_by_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT calendar_import_rows_source_row_check CHECK (length(source_row_id) BETWEEN 1 AND 160 AND source_row_id !~ '[\x01-\x1f]'),
  CONSTRAINT calendar_import_rows_baseline_check CHECK (jsonb_typeof(baseline) = 'object'),
  CONSTRAINT calendar_import_rows_hash_check CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT calendar_import_rows_version_check CHECK (applied_event_version > 0 AND revision > 0)
);
CREATE TRIGGER calendar_import_rows_identity BEFORE UPDATE ON workhub.calendar_import_rows
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','source_id','source_row_id','event_id');

-- 비교 결과(서버가 만든 불변 미리보기). commit 은 이 행만 믿는다. 만료 뒤에도 지우지 않는다(자동 정리 없음).
CREATE TABLE workhub.calendar_import_prepares (
  id               text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id        text NOT NULL,
  account_id       text NOT NULL,
  membership_id    text NOT NULL,
  source_key       text NOT NULL,
  source_label     text NOT NULL,
  source_id        text,
  file_hash        text NOT NULL,
  omitted_columns  jsonb NOT NULL,
  rows             jsonb NOT NULL,
  preview_hash     text NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT calendar_import_prepares_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_import_prepares_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT calendar_import_prepares_source_fkey FOREIGN KEY (school_id, source_id) REFERENCES workhub.calendar_import_sources(school_id, id),
  CONSTRAINT calendar_import_prepares_hash_check CHECK (file_hash ~ '^[0-9a-f]{64}$' AND preview_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT calendar_import_prepares_rows_check CHECK (jsonb_typeof(rows) = 'array' AND jsonb_array_length(rows) BETWEEN 1 AND 50
                                                        AND jsonb_typeof(omitted_columns) = 'array')
);
CREATE TRIGGER calendar_import_prepares_immutable BEFORE UPDATE OR DELETE ON workhub.calendar_import_prepares
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 적용 묶음: 한 commit = 한 행. items = 선택행과 일대일인 결과(key·sourceId·eventId·version·sourceHash).
CREATE TABLE workhub.calendar_import_batches (
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id     text NOT NULL,
  source_id     text NOT NULL,
  prepare_id    text NOT NULL,
  account_id    text NOT NULL,
  membership_id text NOT NULL,
  request_key   text NOT NULL,
  items         jsonb NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT calendar_import_batches_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_import_batches_prepare_key UNIQUE (prepare_id),
  CONSTRAINT calendar_import_batches_source_fkey FOREIGN KEY (school_id, source_id) REFERENCES workhub.calendar_import_sources(school_id, id),
  CONSTRAINT calendar_import_batches_prepare_fkey FOREIGN KEY (prepare_id) REFERENCES workhub.calendar_import_prepares(id),
  CONSTRAINT calendar_import_batches_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT calendar_import_batches_items_check CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 50)
);
CREATE TRIGGER calendar_import_batches_immutable BEFORE UPDATE OR DELETE ON workhub.calendar_import_batches
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 5. 협업 요청
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.cooperation_requests (
  id                      text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id               text NOT NULL,
  sender_membership_id    text NOT NULL,
  sender_account_id       text NOT NULL,
  recipient_membership_id text NOT NULL,
  recipient_account_id    text NOT NULL,
  title                   text NOT NULL,
  description             text NOT NULL DEFAULT '',
  due_on                  date,
  status                  text NOT NULL DEFAULT 'requested',
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cooperation_requests_pkey PRIMARY KEY (id),
  CONSTRAINT cooperation_requests_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT cooperation_requests_sender_fkey FOREIGN KEY (school_id, sender_membership_id, sender_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT cooperation_requests_recipient_fkey FOREIGN KEY (school_id, recipient_membership_id, recipient_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT cooperation_requests_parties_check CHECK (sender_membership_id <> recipient_membership_id AND sender_account_id <> recipient_account_id),
  CONSTRAINT cooperation_requests_title_check CHECK (length(title) BETWEEN 1 AND 160),
  CONSTRAINT cooperation_requests_description_check CHECK (length(description) <= 8000),
  CONSTRAINT cooperation_requests_status_check CHECK (status IN ('requested','accepted','declined','completion_requested','completed','cancelled')),
  CONSTRAINT cooperation_requests_version_check CHECK (version BETWEEN 1 AND 1000)
);
CREATE INDEX cooperation_requests_recipient ON workhub.cooperation_requests (school_id, recipient_membership_id, created_at DESC, id DESC);
CREATE INDEX cooperation_requests_sender ON workhub.cooperation_requests (school_id, sender_membership_id, created_at DESC, id DESC);
CREATE TRIGGER cooperation_requests_identity BEFORE UPDATE ON workhub.cooperation_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','sender_membership_id','sender_account_id',
    'recipient_membership_id','recipient_account_id','title','description','due_on','created_at');

-- 상태 이력(불변). 첫 행 = version 1 · create · 발신자. 상태가 바뀔 때마다 version 과 함께 1행.
CREATE TABLE workhub.cooperation_history (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  request_id          text NOT NULL,
  version             integer NOT NULL,
  action              text NOT NULL,
  actor_membership_id text NOT NULL,
  actor_account_id    text NOT NULL,
  comment             text NOT NULL DEFAULT '',
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cooperation_history_pkey PRIMARY KEY (id),
  CONSTRAINT cooperation_history_version_key UNIQUE (request_id, version),
  CONSTRAINT cooperation_history_request_fkey FOREIGN KEY (school_id, request_id) REFERENCES workhub.cooperation_requests(school_id, id),
  CONSTRAINT cooperation_history_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT cooperation_history_action_check CHECK (action IN ('create','accept','decline','request_completion','confirm_completion','return_completion','retract_completion','cancel')),
  CONSTRAINT cooperation_history_comment_check CHECK (length(comment) <= 2000),
  CONSTRAINT cooperation_history_version_check CHECK (version BETWEEN 1 AND 1000 AND ((version = 1) = (action = 'create')))
);
CREATE TRIGGER cooperation_history_immutable BEFORE UPDATE OR DELETE ON workhub.cooperation_history
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 당사자별 본인 업무 연결(계정 기준). 상대의 업무는 보이지 않는다. 협업 완료가 업무를 바꾸지 않는다.
CREATE TABLE workhub.cooperation_task_links (
  school_id  text NOT NULL,
  request_id text NOT NULL,
  account_id text NOT NULL,
  task_id    text NOT NULL,
  linked_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cooperation_task_links_pkey PRIMARY KEY (request_id, account_id),
  CONSTRAINT cooperation_task_links_request_fkey FOREIGN KEY (school_id, request_id) REFERENCES workhub.cooperation_requests(school_id, id),
  CONSTRAINT cooperation_task_links_task_fkey FOREIGN KEY (school_id, task_id) REFERENCES workhub.tasks(school_id, id),
  CONSTRAINT cooperation_task_links_account_fkey FOREIGN KEY (account_id) REFERENCES workhub.accounts(id)
);
CREATE TRIGGER cooperation_task_links_immutable BEFORE UPDATE OR DELETE ON workhub.cooperation_task_links
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 공통 내부 함수
-- ----------------------------------------------------------------------------
-- 앱 cooperation/protocol.ts canonical() 과 같은 문자열: 객체 키를 코드 순서로 정렬, 배열 순서 유지, 공백 없음.
-- 문자열 escaping 은 jsonb 출력이 JS JSON.stringify 와 같다(" \ 와 U+0020 미만만 escape, 나머지 그대로).
-- 숫자는 정수만 쓰는 명령을 전제로 한다(jsonb 정수 출력 = JS 출력).
CREATE FUNCTION workhub_private.p2_canonical(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT CASE jsonb_typeof(p)
    WHEN 'object' THEN '{' || COALESCE((SELECT string_agg(to_jsonb(e.k)::text || ':' || workhub_private.p2_canonical(e.v), ',' ORDER BY e.k COLLATE "C")
                                        FROM jsonb_each(p) AS e(k, v)), '') || '}'
    WHEN 'array' THEN '[' || COALESCE((SELECT string_agg(workhub_private.p2_canonical(a.v), ',' ORDER BY a.o)
                                       FROM jsonb_array_elements(p) WITH ORDINALITY AS a(v, o)), '') || ']'
    ELSE p::text END
$$;

CREATE FUNCTION workhub_private.p2_sha(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(workhub_private.p2_canonical(COALESCE(p, 'null'::jsonb)), 'UTF8')), 'hex')
$$;

-- 앱 text(): 문자열 · UTF-16 길이 한도 · (empty 가 아니면) 공백뿐 아님 · 제어 문자(탭·줄바꿈·CR 제외) 없음
CREATE FUNCTION workhub_private.p2_text(p jsonb, p_max integer, p_empty boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(p #>> '{}') + regexp_count(p #>> '{}', '[\U00010000-\U0010FFFF]') <= p_max
     AND (p_empty OR workhub_private.js_trim(p #>> '{}') <> '')
     AND (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f]'
$$;

-- 앱 id(): 영문·숫자로 시작, 영문·숫자·_.:@/- 160자 이내
CREATE FUNCTION workhub_private.p2_id(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'
$$;

-- 앱 integer(): 안전한 정수, min 이상
CREATE FUNCTION workhub_private.p2_int(p jsonb, p_min bigint DEFAULT 1, p_max bigint DEFAULT 9007199254740991) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'number' AND p::text ~ '^-?[0-9]{1,16}$'
     AND (p::text)::numeric BETWEEN p_min AND p_max
$$;

CREATE FUNCTION workhub_private.p2_exact(p jsonb, p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'object'
     AND (SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[]) FROM jsonb_object_keys(p) k)
       = (SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[]) FROM unnest(p_keys) k)
$$;

CREATE FUNCTION workhub_private.p2_ts(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE FUNCTION workhub_private.p2_module_active(p_school_id text, p_module text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school_id AND module = p_module AND state = 'active')
$$;

-- 봉투: 성공 {ok:true, contractVersion, schoolId, memberId, ownerUserId, ...}
CREATE FUNCTION workhub_private.p2_ok(p_ctx workhub_private.actor_context, p_contract text, p_body jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', true, 'contractVersion', p_contract, 'schoolId', p_ctx.school_id,
                            'memberId', p_ctx.membership_id, 'ownerUserId', p_ctx.auth_user_id::text) || COALESCE(p_body, '{}'::jsonb)
$$;

-- 거절: {ok:false, ..., code} + 쓰기면 requestKey · commandHash · outcome:'rejected'
CREATE FUNCTION workhub_private.p2_fail(p_ctx workhub_private.actor_context, p_contract text, p_code text,
                                       p_key text DEFAULT NULL, p_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', false, 'contractVersion', p_contract, 'schoolId', p_ctx.school_id,
                            'memberId', p_ctx.membership_id, 'ownerUserId', p_ctx.auth_user_id::text, 'code', p_code)
      || CASE WHEN p_key IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('requestKey', p_key, 'commandHash', p_hash, 'outcome', 'rejected') END
$$;

-- 같은 (계정·학교·소속·모듈·요청 번호)는 직렬화한 뒤 접수증을 찾는다.
CREATE FUNCTION workhub_private.p2_receipt(p_ctx workhub_private.actor_context, p_module text, p_key text) RETURNS workhub.request_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.request_receipts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workhub.p2receipt:' || p_ctx.account_id || chr(31) || p_ctx.school_id || chr(31)
                                                 || p_ctx.membership_id || chr(31) || p_module || chr(31) || p_key, 0));
  SELECT * INTO r FROM workhub.request_receipts
   WHERE school_id = p_ctx.school_id AND account_id = p_ctx.account_id AND membership_id = p_ctx.membership_id
     AND module = p_module AND request_key = p_key;
  RETURN r;
END $$;

-- 저장된 접수증 → 응답. applied 는 outcome 을 replayed 로, rejected 는 원래 거절 그대로.
CREATE FUNCTION workhub_private.p2_replay(p_ctx workhub_private.actor_context, p_contract text, r workhub.request_receipts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN r.outcome = 'applied'
              THEN workhub_private.p2_ok(p_ctx, p_contract, r.response || jsonb_build_object('outcome', 'replayed'))
              ELSE workhub_private.p2_fail(p_ctx, p_contract, r.error_code, r.request_key, r.command_hash) END
$$;

CREATE FUNCTION workhub_private.p2_store(p_ctx workhub_private.actor_context, p_module text, p_key text, p_hash text,
                                        p_code text, p_response jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.request_receipts (school_id, account_id, membership_id, module, request_key, command_hash, outcome, error_code, response)
  VALUES (p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, p_module, p_key, p_hash,
          CASE WHEN p_code IS NULL THEN 'applied' ELSE 'rejected' END, p_code, COALESCE(p_response, '{}'::jsonb))
$$;

-- ----------------------------------------------------------------------------
-- 7. 일정 비교용 내부 함수
-- ----------------------------------------------------------------------------
-- 현재 일정 → 앱 EventDraft(10항목). event_dto 와 같은 값.
CREATE FUNCTION workhub_private.p2_event_draft(e workhub.events, p_timezone text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT workhub_private.event_dto(e, p_timezone) - 'id' - 'schoolId' - 'authorMemberId' - 'version' - 'updatedAt'
$$;

-- 이 소속이 수정할 수 있는 일정인가 (R0 workhub_calendar_save 와 같은 규칙 · 앱 canEdit)
CREATE FUNCTION workhub_private.p2_event_editable(e workhub.events, p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.school_id = p_ctx.school_id AND e.deleted_at IS NULL AND e.status = 'active' AND e.kind <> 'official'
     AND workhub_private.event_readable(e, p_ctx)
     AND (e.author_account_id = p_ctx.account_id
          OR (e.visibility <> 'private' AND workhub_private.member_has_perm(p_ctx, 'calendar.shared_manage')))
$$;

-- 작성자 계정이 p_author 인 일정이 draft 의 공개 범위였다면 이 소속이 읽을 수 있었는가 (과거 원본을 비교에 보여도 되는가)
CREATE FUNCTION workhub_private.p2_draft_readable(p_author_account text, d jsonb, p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_author_account = p_ctx.account_id
      OR d ->> 'visibility' = 'school'
      OR (d ->> 'visibility' = 'audience' AND workhub_private.audience_matches(d -> 'audience', p_ctx.membership_id,
            workhub_private.member_relations(p_ctx.school_id, p_ctx.membership_id)))
$$;

-- 원본 묶음 담당자인가(만든 계정 또는 editors)
CREATE FUNCTION workhub_private.p2_source_editor(s workhub.calendar_import_sources, p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.created_by_account_id = p_ctx.account_id
      OR EXISTS (SELECT 1 FROM workhub.calendar_import_source_editors x WHERE x.source_id = s.id AND x.account_id = p_ctx.account_id)
$$;

-- ----------------------------------------------------------------------------
-- 8. 협업용 내부 함수
-- ----------------------------------------------------------------------------
-- 지금 요청을 받을 수 있는 소속인가: 같은 학교 · 오늘 유효한 active 소속 · 계정 active · 가입 승인
CREATE FUNCTION workhub_private.p2_member_reachable(p_school_id text, p_membership_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id JOIN workhub.schools s ON s.id = m.school_id
     WHERE m.school_id = p_school_id AND m.id = p_membership_id AND m.status = 'active' AND s.status = 'active'
       AND workhub_private.today_in(s.timezone) <@ daterange(m.valid_from, m.valid_to, '[)')
       AND a.status = 'active' AND a.legacy_approval_state = 'approved')
$$;

-- 앱 CooperationRequest. taskLink 는 호출 계정 본인의 연결만.
CREATE FUNCTION workhub_private.p2_coop_dto(r workhub.cooperation_requests, p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'schoolId', r.school_id, 'version', r.version,
    'senderMemberId', r.sender_membership_id, 'recipientMemberId', r.recipient_membership_id,
    'senderName', (SELECT left(a.display_name, 120) FROM workhub.accounts a WHERE a.id = r.sender_account_id),
    'recipientName', (SELECT left(a.display_name, 120) FROM workhub.accounts a WHERE a.id = r.recipient_account_id),
    'title', r.title, 'description', r.description, 'dueDate', COALESCE(to_char(r.due_on, 'YYYY-MM-DD'), ''),
    'status', r.status, 'createdAt', workhub_private.p2_ts(r.created_at), 'updatedAt', workhub_private.p2_ts(r.updated_at),
    'taskLink', (SELECT jsonb_build_object('taskId', l.task_id, 'ownerUserId', p_ctx.auth_user_id::text)
                   FROM workhub.cooperation_task_links l
                  WHERE l.request_id = r.id AND l.account_id = p_ctx.account_id
                    AND EXISTS (SELECT 1 FROM workhub.tasks t WHERE t.id = l.task_id AND t.owner_account_id = p_ctx.account_id)))
$$;

-- 상태 전이 표(계약 표 그대로). 역할: 'sender' | 'recipient'
CREATE FUNCTION workhub_private.p2_coop_next(p_status text, p_role text, p_action text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_role = 'recipient' AND p_status = 'requested' AND p_action = 'accept' THEN 'accepted'
    WHEN p_role = 'recipient' AND p_status = 'requested' AND p_action = 'decline' THEN 'declined'
    WHEN p_role = 'recipient' AND p_status = 'accepted' AND p_action = 'request_completion' THEN 'completion_requested'
    WHEN p_role = 'sender' AND p_status = 'completion_requested' AND p_action = 'confirm_completion' THEN 'completed'
    WHEN p_role = 'sender' AND p_status = 'completion_requested' AND p_action = 'return_completion' THEN 'accepted'
    WHEN p_role = 'recipient' AND p_status = 'completion_requested' AND p_action = 'retract_completion' THEN 'accepted'
    WHEN p_role = 'sender' AND p_status IN ('requested','accepted','completion_requested') AND p_action = 'cancel' THEN 'cancelled'
  END
$$;

-- 이 역할이 (어떤 상태에서든) 할 수 있는 동작인가
CREATE FUNCTION workhub_private.p2_coop_role_action(p_role text, p_action text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (p_role = 'recipient' AND p_action IN ('accept','decline','request_completion','retract_completion'))
      OR (p_role = 'sender' AND p_action IN ('confirm_completion','return_completion','cancel'))
$$;

CREATE FUNCTION workhub_private.p2_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p2_installs WHERE batch IN ('P2-01','P2-02') AND release = '2026-10-16.1') = 2
$$;

-- ----------------------------------------------------------------------------
-- 9. 권한 — 새 표는 RLS 켜고 API 역할 권한 0. 새 내부 함수도 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p2_installs','workhub.module_activations','workhub.request_receipts',
      'workhub.calendar_import_sources','workhub.calendar_import_source_editors','workhub.calendar_import_rows',
      'workhub.calendar_import_prepares','workhub.calendar_import_batches','workhub.cooperation_requests',
      'workhub.cooperation_history','workhub.cooperation_task_links'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  FOR t IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p2\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE workhub.request_receipts_id_seq FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO workhub_private.p2_installs (batch, release) VALUES ('P2-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 10. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'P2-01-1' AS no, '새 표 10개 + RLS 켜짐 + API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 10 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM pg_class c
WHERE c.oid IN (to_regclass('workhub.module_activations'), to_regclass('workhub.request_receipts'), to_regclass('workhub.calendar_import_sources'),
                to_regclass('workhub.calendar_import_source_editors'), to_regclass('workhub.calendar_import_rows'),
                to_regclass('workhub.calendar_import_prepares'), to_regclass('workhub.calendar_import_batches'),
                to_regclass('workhub.cooperation_requests'), to_regclass('workhub.cooperation_history'), to_regclass('workhub.cooperation_task_links'))
UNION ALL
SELECT 'P2-01-2', '모듈 활성화 0개(어느 학교도 켜지 않음)', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text FROM workhub.module_activations
UNION ALL
SELECT 'P2-01-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P2-01-4', 'canonical JSON = 앱 canonical (키 정렬·배열 순서·escape)',
       CASE WHEN workhub_private.p2_canonical('{"b":[2,1,{"z":"\"줄\n","a":null}],"a":true,"A":"\u0001/"}'::jsonb)
                 = '{"A":"\u0001/","a":true,"b":[2,1,{"a":null,"z":"\"줄\n"}]}' THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P2-01-5', '적용 기록 P2-01',
       CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p2_installs WHERE batch = 'P2-01' AND release = '2026-10-16.1') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
