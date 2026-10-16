-- ============================================================================
-- P6-01  Claude 비서 — 대화 · 요청 원장 · 근거 snapshot · 비용 예약/정산 · 할 일 제안 (표와 공통 내부 함수, 비활성 설치)
--
-- ▣ 전제: R0 · R1-01~03 · P1-01·02 · P2-01·02 · P4-01·02 · P5-01·02 (판 2026-10-16.1). R1S · P3 은 있어도 없어도 된다.
--   비서는 학교 자료·문서함(P4)과 학생 근거(P5)를 읽기 때문에 두 단계의 설치가 필요하다(켜져 있을 필요는 없다).
-- ▣ 새 표 7개 + 적용 기록. 기존 표·함수·제약은 바꾸지 않는다(P2 의 module_activations 에 모듈 이름 assistant 만 더해 쓴다).
-- ▣ 학교별 활성화(P6-04) 전에는 모든 함수가 NOT_READY 이고 외부 호출은 0회다. 이 파일만으로 켜지는 것은 없다.
-- ▣ 앱 계약: PR #48 apps/workhub/src/assistant/contracts.ts · apps/main/api/workhub-ai/_assistant.py (assistant.v1).
-- ▣ 모델 · 가격 · 토큰 상한 · 일/월 예산은 P6-04 입력 칸이다. 이 파일에 값을 넣지 않았다.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('workhub_private.p2_installs') IS NULL THEN RAISE EXCEPTION 'P6 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.'; END IF;
  -- 표가 없으면 아래 문장은 계획 단계에서 오류가 나므로 EXECUTE 로 따로 센다
  EXECUTE $q$SELECT count(*) FROM workhub_private.p2_installs WHERE batch IN ('P2-01','P2-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P6 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.'; END IF;
  IF to_regprocedure('workhub_private.p1_grade_limit(text)') IS NULL THEN
    RAISE EXCEPTION 'P6 중단: P1-01·02(학교 구성)가 적용되어 있어야 합니다.';
  END IF;
  IF to_regclass('workhub_private.p4_installs') IS NULL THEN RAISE EXCEPTION 'P6 중단: P4-01·02(2026-10-16.1, 학교 자료·문서함)를 먼저 적용해 주세요.'; END IF;
  -- 표가 없으면 아래 문장은 계획 단계에서 오류가 나므로 EXECUTE 로 따로 센다
  EXECUTE $q$SELECT count(*) FROM workhub_private.p4_installs WHERE batch IN ('P4-01','P4-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P6 중단: P4-01·02(2026-10-16.1, 학교 자료·문서함)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p5_installs') IS NULL THEN RAISE EXCEPTION 'P6 중단: P5-01·02(2026-10-16.1, 수업·학생)를 먼저 적용해 주세요.'; END IF;
  -- 표가 없으면 아래 문장은 계획 단계에서 오류가 나므로 EXECUTE 로 따로 센다
  EXECUTE $q$SELECT count(*) FROM workhub_private.p5_installs WHERE batch IN ('P5-01','P5-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P6 중단: P5-01·02(2026-10-16.1, 수업·학생)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p6_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P6 중단: P6-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.assistant_policies') IS NOT NULL OR to_regclass('workhub.assistant_threads') IS NOT NULL
     OR to_regclass('workhub.assistant_requests') IS NOT NULL OR to_regclass('workhub.assistant_exchanges') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p6\_%' OR proname LIKE 'workhub\_ai\_%') THEN
    RAISE EXCEPTION 'P6 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p6_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p6_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p6_installs_batch_check CHECK (batch IN ('P6-01','P6-02')),
  CONSTRAINT p6_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p6_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p6_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 이용 설정 판 — P6-04 가 계란님 입력값으로 1행씩 쌓는다(예시값을 심지 않는다). 고칠 수 없고, 바꾸려면 새 판.
--    금액은 정수 micro USD. 가격은 100만 토큰당 micro USD(승인 가격표 기준판 price_table_ref).
--    1회 예약액 = ceil((입력 상한 × 입력 가격 + 출력 상한 × 출력 가격) / 1,000,000). 입력 토큰도 유료라 입력 상한까지 예약한다.
--    예산 구간(일·월)은 학교 시간대(schools.timezone)로 자른다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_policies (
  school_id                       text NOT NULL,
  version                         integer NOT NULL,
  approved_by_membership_id       text NOT NULL,
  approval_ref                    text NOT NULL,
  verification_ref                text NOT NULL,
  allowed_members                 text NOT NULL,
  model                           text NOT NULL,
  price_table_ref                 text NOT NULL,
  input_price_micro_usd_per_mtok  bigint NOT NULL,
  output_price_micro_usd_per_mtok bigint NOT NULL,
  max_input_tokens                integer NOT NULL,
  max_output_tokens               integer NOT NULL,
  reserve_micro_usd               bigint NOT NULL,
  member_daily_micro_usd          bigint NOT NULL,
  member_monthly_micro_usd        bigint NOT NULL,
  school_daily_micro_usd          bigint NOT NULL,
  school_monthly_micro_usd        bigint NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_policies_pkey PRIMARY KEY (school_id, version),
  CONSTRAINT assistant_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT assistant_policies_version_check CHECK (version > 0),
  CONSTRAINT assistant_policies_refs_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200 AND length(btrim(verification_ref)) BETWEEN 1 AND 200
                                                  AND length(btrim(price_table_ref)) BETWEEN 1 AND 200),
  CONSTRAINT assistant_policies_members_check CHECK (allowed_members IN ('all_members','school_admin')),
  CONSTRAINT assistant_policies_model_check CHECK (model ~ '^[A-Za-z0-9_.-]{1,150}$'),
  CONSTRAINT assistant_policies_numbers_check CHECK (input_price_micro_usd_per_mtok > 0 AND output_price_micro_usd_per_mtok > 0
                                                     AND max_input_tokens > 0 AND max_output_tokens > 0),
  CONSTRAINT assistant_policies_reserve_check CHECK (reserve_micro_usd =
      ceil((max_input_tokens::numeric * input_price_micro_usd_per_mtok + max_output_tokens::numeric * output_price_micro_usd_per_mtok) / 1000000)),
  CONSTRAINT assistant_policies_budget_check CHECK (0 < reserve_micro_usd AND reserve_micro_usd <= member_daily_micro_usd
                                                    AND member_daily_micro_usd <= member_monthly_micro_usd
                                                    AND member_daily_micro_usd <= school_daily_micro_usd
                                                    AND member_monthly_micro_usd <= school_monthly_micro_usd
                                                    AND school_daily_micro_usd <= school_monthly_micro_usd
                                                    AND school_monthly_micro_usd <= 9007199254740991)
);
CREATE TRIGGER assistant_policies_immutable BEFORE UPDATE OR DELETE ON workhub.assistant_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 대화 머리 — 사용자 · 학교 · 모드에 묶인다. 판은 교환이 붙거나 제안이 확정될 때 +1.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_threads (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  owner_account_id    text NOT NULL,
  owner_membership_id text NOT NULL,
  mode                text NOT NULL,
  title               text NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_threads_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_threads_school_id_key UNIQUE (school_id, id),
  CONSTRAINT assistant_threads_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT assistant_threads_mode_check CHECK (mode IN ('school','personal')),
  CONSTRAINT assistant_threads_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT assistant_threads_version_check CHECK (version > 0)
);
CREATE INDEX assistant_threads_owner_idx ON workhub.assistant_threads (school_id, owner_account_id, mode, updated_at DESC, id DESC);
CREATE TRIGGER assistant_threads_identity BEFORE UPDATE ON workhub.assistant_threads
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','owner_account_id','owner_membership_id','mode','created_at');
CREATE TRIGGER assistant_threads_no_delete BEFORE DELETE ON workhub.assistant_threads
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 4. 이용 요청 원장 — (학교, 실제 소유 계정, 요청 번호) 하나에 요청 하나. 원 입력·지문은 바뀌지 않는다.
--    state: claimed(호출 준비, 임대 중) → started(외부 호출권 사용, 되돌릴 수 없음) → completed · rejected · provider_unknown
--           provider_unknown → resolved(관리 절차 P6-05 로만)
--    cost_state: reserved(예약) · settled(실사용 정산) · unknown(청구 미확인 — 예약액으로 셈) · resolved(관리 절차로 확정)
--    시작 전 임대가 끝난 claimed 예약은 외부 호출이 없었음이 확실하므로 예산에 세지 않는다(같은 키로 다시 인수할 때 다시 예약).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_requests (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  owner_account_id    text NOT NULL,
  owner_membership_id text NOT NULL,
  owner_auth_user_id  uuid NOT NULL,
  request_key         text NOT NULL,
  input               jsonb NOT NULL,
  input_sha256        text NOT NULL,
  mode                text NOT NULL,
  intent              text NOT NULL,
  thread_id           text,
  expected_version    integer NOT NULL,
  state               text NOT NULL DEFAULT 'claimed',
  lease_token         text NOT NULL,
  lease_until         timestamptz NOT NULL,
  claims              integer NOT NULL DEFAULT 1,
  started_at          timestamptz,
  started_lease       text,
  policy_version      integer NOT NULL,
  reserved_micro_usd  bigint NOT NULL,
  budget_day          date NOT NULL,
  budget_month        date NOT NULL,
  cost_state          text NOT NULL DEFAULT 'reserved',
  actual_micro_usd    bigint,
  input_tokens        integer,
  output_tokens       integer,
  provider_message_id text,
  finish_sha256       text,
  reject_code         text,
  withheld_reason     text,
  exchange_id         text,
  result              jsonb,
  resolution          jsonb,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_requests_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_requests_school_id_key UNIQUE (school_id, id),
  CONSTRAINT assistant_requests_key_key UNIQUE (school_id, owner_account_id, request_key),
  CONSTRAINT assistant_requests_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT assistant_requests_thread_fkey FOREIGN KEY (school_id, thread_id) REFERENCES workhub.assistant_threads(school_id, id),
  CONSTRAINT assistant_requests_policy_fkey FOREIGN KEY (school_id, policy_version) REFERENCES workhub.assistant_policies(school_id, version),
  CONSTRAINT assistant_requests_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  CONSTRAINT assistant_requests_sha_check CHECK (input_sha256 ~ '^[0-9a-f]{64}$' AND (finish_sha256 IS NULL OR finish_sha256 ~ '^[0-9a-f]{64}$')),
  CONSTRAINT assistant_requests_mode_check CHECK (mode IN ('school','personal')),
  CONSTRAINT assistant_requests_intent_check CHECK (intent IN ('school_advice','personal_assistant','document_draft','student_record_draft','guided_collection')),
  CONSTRAINT assistant_requests_thread_check CHECK ((thread_id IS NULL) = (expected_version = 0) AND expected_version >= 0),
  CONSTRAINT assistant_requests_state_check CHECK (state IN ('claimed','started','completed','rejected','provider_unknown','resolved')),
  CONSTRAINT assistant_requests_started_check CHECK ((state = 'claimed') = (started_at IS NULL) AND (started_at IS NULL) = (started_lease IS NULL)),
  CONSTRAINT assistant_requests_lease_check CHECK (lease_token ~ '^[0-9a-f]{64}$' AND claims > 0),
  CONSTRAINT assistant_requests_cost_check CHECK (cost_state IN ('reserved','settled','unknown','resolved') AND reserved_micro_usd > 0
                                                  AND (actual_micro_usd IS NULL OR actual_micro_usd >= 0)
                                                  AND (cost_state IN ('settled','resolved')) = (actual_micro_usd IS NOT NULL)),
  CONSTRAINT assistant_requests_usage_check CHECK ((input_tokens IS NULL) = (output_tokens IS NULL) AND (input_tokens IS NULL OR (input_tokens >= 0 AND output_tokens >= 0))),
  CONSTRAINT assistant_requests_finished_check CHECK ((state IN ('completed','rejected','provider_unknown','resolved')) = (result IS NOT NULL)
                                                      AND (state IN ('completed','rejected','provider_unknown','resolved')) = (finish_sha256 IS NOT NULL)),
  CONSTRAINT assistant_requests_reject_check CHECK (reject_code IS NULL OR reject_code IN ('OUTPUT_INVALID','PROVIDER_REJECTED','TRUNCATED')),
  CONSTRAINT assistant_requests_resolved_check CHECK ((resolution IS NOT NULL) = (state = 'resolved' OR cost_state = 'resolved')
                                                      AND (state <> 'resolved' OR cost_state = 'resolved'))
);
CREATE UNIQUE INDEX assistant_requests_provider_message ON workhub.assistant_requests (school_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX assistant_requests_budget_idx ON workhub.assistant_requests (school_id, budget_month, budget_day, owner_account_id);
CREATE INDEX assistant_requests_thread_idx ON workhub.assistant_requests (school_id, thread_id) WHERE thread_id IS NOT NULL AND state IN ('claimed','started');

-- 원 입력·소유·시작 기록은 되돌리지 않는다. 끝난 요청은 관리 절차(provider_unknown → resolved, 청구 미확인 → 확정)만 바꿀 수 있다.
CREATE FUNCTION workhub_private.p6_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
  IF (NEW.id, NEW.school_id, NEW.owner_account_id, NEW.owner_membership_id, NEW.owner_auth_user_id, NEW.request_key, NEW.input, NEW.input_sha256,
      NEW.mode, NEW.intent, NEW.thread_id, NEW.expected_version, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.school_id, OLD.owner_account_id, OLD.owner_membership_id, OLD.owner_auth_user_id, OLD.request_key, OLD.input, OLD.input_sha256,
      OLD.mode, OLD.intent, OLD.thread_id, OLD.expected_version, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW';
  END IF;
  IF OLD.started_at IS NOT NULL AND (NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.started_lease IS DISTINCT FROM OLD.started_lease
       OR NEW.lease_token IS DISTINCT FROM OLD.lease_token OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
       OR NEW.reserved_micro_usd IS DISTINCT FROM OLD.reserved_micro_usd OR NEW.budget_day IS DISTINCT FROM OLD.budget_day) THEN
    RAISE EXCEPTION 'P6_STARTED_IMMUTABLE';
  END IF;
  IF OLD.finish_sha256 IS NOT NULL AND (NEW.finish_sha256 IS DISTINCT FROM OLD.finish_sha256 OR NEW.exchange_id IS DISTINCT FROM OLD.exchange_id
       OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
       OR NEW.input_tokens IS DISTINCT FROM OLD.input_tokens AND OLD.input_tokens IS NOT NULL) THEN
    RAISE EXCEPTION 'P6_FINISHED_IMMUTABLE';
  END IF;
  IF OLD.state IN ('completed','rejected','resolved') AND NEW.state IS DISTINCT FROM OLD.state THEN RAISE EXCEPTION 'P6_FINISHED_IMMUTABLE'; END IF;
  IF OLD.state = 'provider_unknown' AND NEW.state NOT IN ('provider_unknown','resolved') THEN RAISE EXCEPTION 'P6_FINISHED_IMMUTABLE'; END IF;
  IF OLD.cost_state IN ('settled','resolved') AND (NEW.cost_state IS DISTINCT FROM OLD.cost_state OR NEW.actual_micro_usd IS DISTINCT FROM OLD.actual_micro_usd) THEN
    RAISE EXCEPTION 'P6_FINISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_requests_guard BEFORE UPDATE OR DELETE ON workhub.assistant_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p6_request_guard();

-- ----------------------------------------------------------------------------
-- 5. 근거 snapshot — 요청(그 임대)마다 모델에 보낸 출처의 정확한 ID · 판 · 학생 판/지문/세대/구간 · 제목 · 위치.
--    본문은 남기지 않는다(필요하면 원본 판에서 다시 읽는다). 승인 당시의 snapshot 은 현재 권한 검사를 대신하지 않는다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_request_sources (
  request_id     text NOT NULL,
  lease_token    text NOT NULL,
  source_key     text NOT NULL,
  school_id      text NOT NULL,
  kind           text NOT NULL,
  reference      jsonb NOT NULL,
  title          text NOT NULL,
  locator        text NOT NULL,
  classification text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_request_sources_pkey PRIMARY KEY (request_id, lease_token, source_key),
  CONSTRAINT assistant_request_sources_request_fkey FOREIGN KEY (school_id, request_id) REFERENCES workhub.assistant_requests(school_id, id),
  CONSTRAINT assistant_request_sources_kind_check CHECK (kind IN ('knowledge','calendar','task','collection','document','observation','assessment')),
  CONSTRAINT assistant_request_sources_class_check CHECK (classification IN ('school_public','owner_private','student_learning')
                                                          AND (classification = 'student_learning') = (kind IN ('observation','assessment'))
                                                          AND (kind <> 'task' OR classification = 'owner_private'))
);
CREATE TRIGGER assistant_request_sources_immutable BEFORE UPDATE OR DELETE ON workhub.assistant_request_sources
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 교환 — 대화에 붙은 답변(불변). 요청 하나에 교환 하나.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_exchanges (
  id              text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id       text NOT NULL,
  thread_id       text NOT NULL,
  request_id      text NOT NULL,
  seq             integer NOT NULL,
  request_key     text NOT NULL,
  intent          text NOT NULL,
  prompt          text NOT NULL,
  segments        jsonb NOT NULL,
  student_context jsonb,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_exchanges_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_exchanges_school_id_key UNIQUE (school_id, id),
  CONSTRAINT assistant_exchanges_request_key UNIQUE (request_id),
  CONSTRAINT assistant_exchanges_seq_key UNIQUE (thread_id, seq),
  CONSTRAINT assistant_exchanges_thread_fkey FOREIGN KEY (school_id, thread_id) REFERENCES workhub.assistant_threads(school_id, id),
  CONSTRAINT assistant_exchanges_request_fkey FOREIGN KEY (school_id, request_id) REFERENCES workhub.assistant_requests(school_id, id),
  CONSTRAINT assistant_exchanges_seq_check CHECK (seq > 0),
  CONSTRAINT assistant_exchanges_segments_check CHECK (jsonb_typeof(segments) = 'array' AND jsonb_array_length(segments) BETWEEN 1 AND 60)
);
CREATE TRIGGER assistant_exchanges_immutable BEFORE UPDATE OR DELETE ON workhub.assistant_exchanges
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. 개인 할 일 제안 — 모델의 초안은 그대로 두고, 교사가 확인한 내용으로 할 일 하나만 만든다(제안 1 : 할 일 1).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_proposals (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  thread_id           text NOT NULL,
  exchange_id         text NOT NULL,
  owner_account_id    text NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  draft               jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  task_id             text,
  applied_input       jsonb,
  applied_request_key text,
  applied_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_proposals_pkey PRIMARY KEY (id),
  CONSTRAINT assistant_proposals_exchange_key UNIQUE (exchange_id),
  CONSTRAINT assistant_proposals_task_key UNIQUE (task_id),
  CONSTRAINT assistant_proposals_exchange_fkey FOREIGN KEY (school_id, exchange_id) REFERENCES workhub.assistant_exchanges(school_id, id),
  CONSTRAINT assistant_proposals_thread_fkey FOREIGN KEY (school_id, thread_id) REFERENCES workhub.assistant_threads(school_id, id),
  CONSTRAINT assistant_proposals_task_fkey FOREIGN KEY (school_id, task_id) REFERENCES workhub.tasks(school_id, id),
  CONSTRAINT assistant_proposals_status_check CHECK (status IN ('pending','applied')
                                                     AND (status = 'applied') = (task_id IS NOT NULL)
                                                     AND (status = 'applied') = (applied_input IS NOT NULL)
                                                     AND (status = 'applied') = (applied_at IS NOT NULL)
                                                     AND (status = 'applied') = (applied_request_key IS NOT NULL)
                                                     AND version = CASE status WHEN 'pending' THEN 1 ELSE 2 END)
);
CREATE FUNCTION workhub_private.p6_proposal_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'applied'
     OR (NEW.id, NEW.school_id, NEW.thread_id, NEW.exchange_id, NEW.owner_account_id, NEW.draft, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.school_id, OLD.thread_id, OLD.exchange_id, OLD.owner_account_id, OLD.draft, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_proposals_guard BEFORE UPDATE OR DELETE ON workhub.assistant_proposals
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p6_proposal_guard();

-- ----------------------------------------------------------------------------
-- 8. 제안 확정 요청 원장 — (학교, 계정, 요청 번호). 반영된 요청만 남긴다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.assistant_task_requests (
  school_id        text NOT NULL,
  owner_account_id text NOT NULL,
  request_key      text NOT NULL,
  membership_id    text NOT NULL,
  payload_sha256   text NOT NULL,
  receipt          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assistant_task_requests_pkey PRIMARY KEY (school_id, owner_account_id, request_key),
  CONSTRAINT assistant_task_requests_member_fkey FOREIGN KEY (school_id, membership_id, owner_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT assistant_task_requests_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,100}$' AND payload_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER assistant_task_requests_immutable BEFORE UPDATE OR DELETE ON workhub.assistant_task_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 9. 공통 내부 함수 — 봉투 · 입력 판정 (앱 assistant/contracts.ts · 서버 _assistant.py 와 같은 규칙)
-- ----------------------------------------------------------------------------
-- 성공 {contract:'assistant.v1', schoolId, memberId, data} · 업무 거절 {contract, schoolId, memberId, error:{code}}
CREATE FUNCTION workhub_private.p6_ok(p_school text, p_member text, p_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', 'assistant.v1', 'schoolId', p_school, 'memberId', p_member, 'data', p_data)
$$;
CREATE FUNCTION workhub_private.p6_err(p_school text, p_member text, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', 'assistant.v1', 'schoolId', p_school, 'memberId', p_member, 'error', jsonb_build_object('code', p_code))
$$;
CREATE FUNCTION workhub_private.p6_business(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_code IN ('NOT_READY','FORBIDDEN','INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','BUDGET_EXCEEDED')
$$;
-- 앱 txt(): 문자열 · 코드포인트 길이 · (required 면) 공백뿐 아님 · 제어문자(탭·줄바꿈·CR 제외)와 DEL 없음
CREATE FUNCTION workhub_private.p6_text(p jsonb, p_max integer, p_required boolean DEFAULT true) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(p #>> '{}') <= p_max
     AND (NOT p_required OR workhub_private.js_trim(p #>> '{}') <> '')
     AND (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
$$;
-- 식별자 [A-Za-z0-9_-]{1,100}
CREATE FUNCTION workhub_private.p6_id(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[A-Za-z0-9_-]{1,100}$'
$$;
CREATE FUNCTION workhub_private.p6_key(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND p ~ '^[A-Za-z0-9_-]{8,100}$'
$$;
-- JavaScript 안전 정수(min 이상)
CREATE FUNCTION workhub_private.p6_int(p jsonb, p_min bigint DEFAULT 0) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'number' AND (p::text) ~ '^-?[0-9]{1,16}$'
     AND (p::text)::numeric BETWEEN p_min AND 9007199254740991
$$;
CREATE FUNCTION workhub_private.p6_date(p jsonb, p_empty boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v date;
BEGIN
  IF p_empty AND p = '""'::jsonb THEN RETURN true; END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'string' OR (p #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  BEGIN v := (p #>> '{}')::date; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN to_char(v, 'YYYY-MM-DD') = (p #>> '{}');
END $$;
CREATE FUNCTION workhub_private.p6_ts(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
-- 서버가 만드는 무작위 토큰(64자 16진)
CREATE FUNCTION workhub_private.p6_token() RETURNS text
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;
-- 출처 본문에서 제어문자를 공백으로(길이 유지 — 학생 구간 길이 = end - start 가 그대로)
CREATE FUNCTION workhub_private.p6_clean(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT regexp_replace(COALESCE(p, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', 'g')
$$;
-- 같은 키 동시 실행을 한 줄로
CREATE FUNCTION workhub_private.p6_lock(p_parts text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('p6' || chr(31) || p_parts, 0))
$$;
-- 위치 값: 서버가 만든 JSON 을 16진으로(2,000자 이내). 범위 지문 f 가 다르면 INVALID_INPUT.
CREATE FUNCTION workhub_private.p6_cursor_out(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(convert_to(p::text, 'UTF8'), 'hex')
$$;
CREATE FUNCTION workhub_private.p6_cursor_in(p text, p_scope text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF length(p) > 2000 OR p !~ '^[0-9a-f]+$' OR length(p) % 2 <> 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN
    v := convert_from(decode(p, 'hex'), 'UTF8')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF jsonb_typeof(v) <> 'object' OR v ->> 'f' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 10. 준비 상태 · 정책 · 예산
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p6_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p6_installs WHERE batch IN ('P6-01','P6-02') AND release = '2026-10-16.1') = 2
$$;
-- 지금 쓰는 설정 판(가장 큰 판)
CREATE FUNCTION workhub_private.p6_policy(p_school text) RETURNS workhub.assistant_policies
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM workhub.assistant_policies WHERE school_id = p_school ORDER BY version DESC LIMIT 1
$$;
-- 준비 사유: ready · database_missing · disabled(중지) · policy_missing(활성화·설정 없음)
CREATE FUNCTION workhub_private.p6_reason(p_school text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  IF NOT workhub_private.p6_installed() THEN RETURN 'database_missing'; END IF;
  SELECT state INTO v_state FROM workhub.module_activations WHERE school_id = p_school AND module = 'assistant';
  IF v_state = 'stopped' THEN RETURN 'disabled'; END IF;
  IF v_state IS DISTINCT FROM 'active' OR NOT EXISTS (SELECT 1 FROM workhub.assistant_policies WHERE school_id = p_school) THEN
    RETURN 'policy_missing';
  END IF;
  RETURN 'ready';
END $$;
CREATE FUNCTION workhub_private.p6_ready(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p6_reason(p_school) = 'ready'
$$;
-- 설정이 허락한 사람인가: all_members = 업무실 사용자 모두(현재 superadmin 만) · school_admin = 학교 관리자(year.manage)
CREATE FUNCTION workhub_private.p6_allowed(p_ctx workhub_private.actor_context, p workhub.assistant_policies) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.allowed_members = 'all_members' OR (p.allowed_members = 'school_admin' AND workhub_private.member_has_perm(p_ctx, 'year.manage'))
$$;
-- 예산에 세는 금액: 정산 = 실사용 · 청구 미확인 = 예약액 · 예약 = 시작했거나 임대 중이면 예약액(시작 전 임대가 끝났으면 0)
CREATE FUNCTION workhub_private.p6_charge(r workhub.assistant_requests) RETURNS bigint
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE r.cost_state
           WHEN 'settled' THEN r.actual_micro_usd
           WHEN 'resolved' THEN r.actual_micro_usd
           WHEN 'unknown' THEN r.reserved_micro_usd
           ELSE CASE WHEN r.started_at IS NOT NULL OR r.lease_until > clock_timestamp() THEN r.reserved_micro_usd ELSE 0 END
         END
$$;
-- 학교 오늘·이번 달(학교 시간대). [일, 월 첫날]
CREATE FUNCTION workhub_private.p6_window(p_school text) RETURNS date[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY[d, date_trunc('month', d)::date]
    FROM (SELECT workhub_private.today_in(s.timezone) AS d FROM workhub.schools s WHERE s.id = p_school) x
$$;
-- 남은 예산으로 1회 예약을 더 받을 수 있는가(학교·사용자 × 일·월). p_except 는 다시 인수하는 그 요청(이중으로 세지 않음).
CREATE FUNCTION workhub_private.p6_budget_ok(p_school text, p_account text, p workhub.assistant_policies, p_except text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w date[] := workhub_private.p6_window(p_school); sd bigint; sm bigint; md bigint; mm bigint;
BEGIN
  SELECT COALESCE(sum(workhub_private.p6_charge(r)) FILTER (WHERE r.budget_day = w[1]), 0),
         COALESCE(sum(workhub_private.p6_charge(r)), 0),
         COALESCE(sum(workhub_private.p6_charge(r)) FILTER (WHERE r.budget_day = w[1] AND r.owner_account_id = p_account), 0),
         COALESCE(sum(workhub_private.p6_charge(r)) FILTER (WHERE r.owner_account_id = p_account), 0)
    INTO sd, sm, md, mm
    FROM workhub.assistant_requests r
   WHERE r.school_id = p_school AND r.budget_month = w[2] AND r.id IS DISTINCT FROM p_except;
  RETURN sd + p.reserve_micro_usd <= p.school_daily_micro_usd AND sm + p.reserve_micro_usd <= p.school_monthly_micro_usd
     AND md + p.reserve_micro_usd <= p.member_daily_micro_usd AND mm + p.reserve_micro_usd <= p.member_monthly_micro_usd;
END $$;
-- 실사용 금액(정수 micro USD, 올림)
CREATE FUNCTION workhub_private.p6_cost(p workhub.assistant_policies, p_in bigint, p_out bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ceil((p_in::numeric * p.input_price_micro_usd_per_mtok + p_out::numeric * p.output_price_micro_usd_per_mtok) / 1000000)::bigint
$$;

-- 서버 API(service_role)가 /auth/v1/user 로 확인한 UID 로 사람 주체를 세운다. 사람 JWT 를 실은 호출은 거부.
-- 기존 승인 gate·소속 확인(member_actor)을 그대로 쓰고, 끝나면 요청 주체를 되돌린다.
CREATE FUNCTION workhub_private.p6_service_member(p_actor uuid, p_member text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '서버 API(service_role, 사람 JWT 없음)만 부를 수 있습니다.';
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

-- ----------------------------------------------------------------------------
-- 11. 권한 — 새 표는 RLS 켜고 API 역할 권한 0. 새 내부 함수도 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p6_installs','workhub.assistant_policies','workhub.assistant_threads','workhub.assistant_requests',
      'workhub.assistant_request_sources','workhub.assistant_exchanges','workhub.assistant_proposals','workhub.assistant_task_requests'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p6\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

INSERT INTO workhub_private.p6_installs (batch, release) VALUES ('P6-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 12. 검증 — 모든 행의 status 가 ok 여야 한다.
-- ----------------------------------------------------------------------------
WITH t(n) AS (VALUES ('workhub_private.p6_installs'),('workhub.assistant_policies'),('workhub.assistant_threads'),('workhub.assistant_requests'),
                     ('workhub.assistant_request_sources'),('workhub.assistant_exchanges'),('workhub.assistant_proposals'),('workhub.assistant_task_requests'))
SELECT 'P6-01-1' AS no, '새 표 7개 + 적용 기록 · RLS 켜짐 · API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 8 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM t JOIN pg_class c ON c.oid = to_regclass(t.n)
UNION ALL
SELECT 'P6-01-2', '비서 모듈 활성화 0 · 설정 판 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'assistant') = 0
             AND (SELECT count(*) FROM workhub.assistant_policies) = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P6-01-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p6\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P6-01-4', '적용 기록 P6-01', CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p6_installs WHERE batch = 'P6-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
