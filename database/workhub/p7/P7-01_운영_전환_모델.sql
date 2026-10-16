-- ============================================================================
-- P7-01  수합 운영 · 홈 요약 · 업무 인계 · 새 학년도 (표와 공통 내부 함수, 비활성 설치)
--
-- ▣ 전제: R0 · R1-01~03(2026-10-15.1) · P1-01·02 · P2-01·02 · P3-01·02 (판 2026-10-16.1). R1S · P4 · P5 · P6 은 있어도 없어도 된다.
--   홈 요약은 P5 가 있으면 "학생 후속(활동 근거가 바뀐 내 관찰)"을 세고, 없으면 그 칸을 unavailable 로 둔다.
-- ▣ 새 표 7개 + 적용 기록. 기존 표·함수·제약은 바꾸지 않는다(P2 의 module_activations 에 모듈 이름 3개를 더해 쓴다:
--   collection_ops · home · transitions). 학교별 활성화(P7-04) 전에는 모든 함수가 NOT_READY 다.
-- ▣ R1 수합의 마감 · 기한 변경 · 담당자 인계와 협업(P2) 받는 사람 인계는 R1 · P2 를 보강해야 하므로 이 파일에 넣지 않았다.
--   그 보강은 P7-05(별도 승인)이고, 적용 전에는 그 명령만 NOT_READY 다(화면만 막는 마감을 만들지 않는다).
-- ▣ 앱 계약: PR #48 apps/workhub/src/collections/operations.ts · home/overview.ts · administration/transitions.ts
--   (collection-operations.v1 · home.v1 · school-transitions.v1, 공통 봉투 services/scoped-rpc.ts).
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('workhub_private.batch_installs') IS NULL THEN
    RAISE EXCEPTION 'P7 중단: R1-01·02·03(2026-10-15.1)이 적용되어 있어야 합니다.';
  END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.batch_installs WHERE batch IN ('R1-01','R1-02','R1-03') AND release = '2026-10-15.1'$q$ INTO v_n;
  IF v_n <> 3 THEN RAISE EXCEPTION 'P7 중단: R1-01·02·03(2026-10-15.1)이 적용되어 있어야 합니다.'; END IF;
  IF to_regclass('workhub_private.p1_installs') IS NULL THEN RAISE EXCEPTION 'P7 중단: P1-01·02(2026-10-16.1, 학교 관리)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p1_installs WHERE batch IN ('P1-01','P1-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P7 중단: P1-01·02(2026-10-16.1, 학교 관리)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p2_installs') IS NULL THEN RAISE EXCEPTION 'P7 중단: P2-01·02(2026-10-16.1, 일정·협업)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p2_installs WHERE batch IN ('P2-01','P2-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P7 중단: P2-01·02(2026-10-16.1, 일정·협업)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p3_installs') IS NULL THEN RAISE EXCEPTION 'P7 중단: P3-01·02(2026-10-16.1, 메신저·알림)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p3_installs WHERE batch IN ('P3-01','P3-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P7 중단: P3-01·02(2026-10-16.1, 메신저·알림)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p7_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P7 중단: P7-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.operation_requests') IS NOT NULL OR to_regclass('workhub.collection_operations') IS NOT NULL
     OR to_regclass('workhub.collection_operation_history') IS NOT NULL OR to_regclass('workhub.collection_reminders') IS NOT NULL
     OR to_regclass('workhub.transition_records') IS NOT NULL OR to_regclass('workhub.transition_items') IS NOT NULL
     OR to_regclass('workhub.transition_history') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p7\_%' OR proname IN ('workhub_collection_operations_get','workhub_collection_operations_mutate',
                  'workhub_home_overview','workhub_school_transition_list','workhub_school_transition_preview','workhub_school_transition_mutate')) THEN
    RAISE EXCEPTION 'P7 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록 (P7-05 보강도 여기에 남는다)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p7_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p7_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p7_installs_batch_check CHECK (batch IN ('P7-01','P7-02','P7-05')),
  CONSTRAINT p7_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p7_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p7_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 요청 원장 — (학교, 소속, 모듈, 요청 번호) 하나에 반영된 명령 하나. 같은 번호 · 같은 내용은 처음 응답,
--    다른 내용(또는 다른 계정)은 IDEMPOTENCY_CONFLICT. 업무 거절은 남기지 않는다(같은 번호로 고쳐 다시 보낼 수 있다).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.operation_requests (
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  module        text NOT NULL,
  request_key   text NOT NULL,
  payload_hash  text NOT NULL,
  resource_id   text NOT NULL,
  response      jsonb NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operation_requests_pkey PRIMARY KEY (school_id, membership_id, module, request_key),
  CONSTRAINT operation_requests_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT operation_requests_module_check CHECK (module IN ('collection_ops','transitions')),
  CONSTRAINT operation_requests_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$'),
  CONSTRAINT operation_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operation_requests_response_check CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 8192)
);
CREATE TRIGGER operation_requests_immutable BEFORE UPDATE OR DELETE ON workhub.operation_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 수합 운영판 — 게시된 R1 수합마다 0~1행(첫 명령 때 만든다. 행이 없으면 open · 판 1).
--    R1 의 collections.state(draft/published)는 바꾸지 않는다. 기한의 원본은 R1 collections.due_on 하나다(여기 복사하지 않음).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.collection_operations (
  school_id     text NOT NULL,
  collection_id text NOT NULL,
  phase         text NOT NULL,
  version       integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_operations_pkey PRIMARY KEY (school_id, collection_id),
  CONSTRAINT collection_operations_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_operations_phase_check CHECK (phase IN ('open','closed','archived')),
  CONSTRAINT collection_operations_version_check CHECK (version >= 2)
);
CREATE FUNCTION workhub_private.p7_ops_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '수합 운영판은 지우지 않습니다.'; END IF;
  IF NEW.school_id <> OLD.school_id OR NEW.collection_id <> OLD.collection_id OR NEW.created_at <> OLD.created_at
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '수합 운영판은 판을 하나씩만 올립니다.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER collection_operations_guard BEFORE UPDATE OR DELETE ON workhub.collection_operations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_ops_guard();

-- 운영 이력(불변): 판마다 1행. 명령 · 전후 상태 · 전후 기한 · 사유 · 행위자 · 요청 번호.
CREATE TABLE workhub.collection_operation_history (
  id                  bigint GENERATED ALWAYS AS IDENTITY,
  school_id           text NOT NULL,
  collection_id       text NOT NULL,
  version             integer NOT NULL,
  kind                text NOT NULL,
  phase_before        text NOT NULL,
  phase_after         text NOT NULL,
  due_before          date NOT NULL,
  due_after           date NOT NULL,
  reason              text NOT NULL,
  actor_membership_id text NOT NULL,
  actor_account_id    text NOT NULL,
  request_key         text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_operation_history_pkey PRIMARY KEY (id),
  CONSTRAINT collection_operation_history_version_key UNIQUE (school_id, collection_id, version),
  CONSTRAINT collection_operation_history_ops_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collection_operations(school_id, collection_id),
  CONSTRAINT collection_operation_history_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT collection_operation_history_kind_check CHECK (kind IN ('close','archive','reopen','extend','remind','handover')),
  CONSTRAINT collection_operation_history_phase_check CHECK (phase_before IN ('open','closed','archived') AND phase_after IN ('open','closed','archived')),
  CONSTRAINT collection_operation_history_version_check CHECK (version >= 2),
  CONSTRAINT collection_operation_history_reason_check CHECK (length(reason) BETWEEN 1 AND 1000),
  CONSTRAINT collection_operation_history_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$')
);
CREATE TRIGGER collection_operation_history_immutable BEFORE UPDATE OR DELETE ON workhub.collection_operation_history
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 제출 알림(불변): 알림 명령 1건 × 단위 1개 = 1행. 사이트 알림(P3 notifications) 1건과 짝.
CREATE TABLE workhub.collection_reminders (
  history_id      bigint NOT NULL,
  school_id       text NOT NULL,
  collection_id   text NOT NULL,
  unit_id         text NOT NULL,
  unit_version    integer NOT NULL,
  membership_id   text NOT NULL,
  account_id      text NOT NULL,
  notification_id text NOT NULL,
  CONSTRAINT collection_reminders_pkey PRIMARY KEY (history_id, unit_id),
  CONSTRAINT collection_reminders_history_fkey FOREIGN KEY (history_id) REFERENCES workhub.collection_operation_history(id),
  CONSTRAINT collection_reminders_unit_fkey FOREIGN KEY (school_id, collection_id, unit_id) REFERENCES workhub.collection_units(school_id, collection_id, id),
  CONSTRAINT collection_reminders_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT collection_reminders_notification_fkey FOREIGN KEY (notification_id) REFERENCES workhub.notifications(id)
);
CREATE TRIGGER collection_reminders_immutable BEFORE UPDATE OR DELETE ON workhub.collection_reminders
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 4. 인계 · 새 학년도 기록 — 인계는 pending(판 1) → accepted/rejected/cancelled(판 2). 새 학년도는 completed(판 1) 하나.
--    인계를 신청해도 자원의 소유 · 열람 권한은 넘어가지 않는다. 받는 사람이 수락할 때 한 번에 넘긴다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.transition_records (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                 text NOT NULL,
  kind                      text NOT NULL,
  title                     text NOT NULL,
  requester_membership_id   text NOT NULL,
  requester_account_id      text NOT NULL,
  recipient_membership_id   text,
  recipient_account_id      text,
  state                     text NOT NULL,
  version                   integer NOT NULL DEFAULT 1,
  note                      text NOT NULL DEFAULT '',
  plan                      jsonb NOT NULL,
  summary                   jsonb NOT NULL,
  result_year_id            text,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT transition_records_pkey PRIMARY KEY (id),
  CONSTRAINT transition_records_school_id_key UNIQUE (school_id, id),
  CONSTRAINT transition_records_requester_fkey FOREIGN KEY (school_id, requester_membership_id, requester_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT transition_records_recipient_fkey FOREIGN KEY (school_id, recipient_membership_id, recipient_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT transition_records_year_fkey FOREIGN KEY (school_id, result_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT transition_records_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT transition_records_kind_check CHECK (kind IN ('handover','new_year')),
  CONSTRAINT transition_records_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT transition_records_shape_check CHECK (CASE kind
    WHEN 'handover' THEN recipient_membership_id IS NOT NULL AND recipient_account_id IS NOT NULL AND result_year_id IS NULL
                         AND recipient_account_id <> requester_account_id AND state IN ('pending','accepted','rejected','cancelled')
    WHEN 'new_year' THEN recipient_membership_id IS NULL AND recipient_account_id IS NULL AND result_year_id IS NOT NULL
                         AND state = 'completed' AND version = 1 END),
  CONSTRAINT transition_records_version_check CHECK (version IN (1, 2) AND ((version = 1) = (state IN ('pending','completed')))),
  CONSTRAINT transition_records_note_check CHECK (length(note) <= 2000),
  CONSTRAINT transition_records_json_check CHECK (jsonb_typeof(plan) = 'object' AND jsonb_typeof(summary) = 'array'
                                                  AND octet_length(plan::text) <= 65536 AND octet_length(summary::text) <= 65536)
);
CREATE INDEX transition_records_requester_idx ON workhub.transition_records (school_id, requester_membership_id, created_at DESC, id DESC);
CREATE INDEX transition_records_recipient_idx ON workhub.transition_records (school_id, recipient_membership_id, created_at DESC, id DESC);
CREATE FUNCTION workhub_private.p7_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '인계 · 학년도 기록은 지우지 않습니다.'; END IF;
  IF (to_jsonb(NEW) - ARRAY['state','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','version','updated_at'])
     OR OLD.state <> 'pending' OR NEW.version <> 2 OR NEW.state NOT IN ('accepted','rejected','cancelled') THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '대기 중인 인계만 한 번 수락 · 거절 · 취소됩니다.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER transition_records_guard BEFORE UPDATE OR DELETE ON workhub.transition_records
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_record_guard();

-- 인계 항목(불변): 신청할 때의 자원 종류 · ID · 판 · 이름
CREATE TABLE workhub.transition_items (
  record_id        text NOT NULL,
  school_id        text NOT NULL,
  ordinal          smallint NOT NULL,
  kind             text NOT NULL,
  resource_id      text NOT NULL,
  resource_version integer NOT NULL,
  label            text NOT NULL,
  CONSTRAINT transition_items_pkey PRIMARY KEY (record_id, ordinal),
  CONSTRAINT transition_items_resource_key UNIQUE (record_id, kind, resource_id),
  CONSTRAINT transition_items_record_fkey FOREIGN KEY (school_id, record_id) REFERENCES workhub.transition_records(school_id, id),
  CONSTRAINT transition_items_kind_check CHECK (kind IN ('duty','cooperation','collection')),
  CONSTRAINT transition_items_ordinal_check CHECK (ordinal BETWEEN 1 AND 200),
  CONSTRAINT transition_items_version_check CHECK (resource_version >= 1),
  CONSTRAINT transition_items_label_check CHECK (length(label) BETWEEN 1 AND 200)
);
CREATE INDEX transition_items_resource_idx ON workhub.transition_items (school_id, kind, resource_id);
CREATE TRIGGER transition_items_immutable BEFORE UPDATE OR DELETE ON workhub.transition_items
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 인계 · 학년도 이력(불변)
CREATE TABLE workhub.transition_history (
  record_id           text NOT NULL,
  school_id           text NOT NULL,
  version             integer NOT NULL,
  action              text NOT NULL,
  actor_membership_id text NOT NULL,
  actor_account_id    text NOT NULL,
  reason              text NOT NULL DEFAULT '',
  request_key         text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT transition_history_pkey PRIMARY KEY (record_id, version),
  CONSTRAINT transition_history_record_fkey FOREIGN KEY (school_id, record_id) REFERENCES workhub.transition_records(school_id, id),
  CONSTRAINT transition_history_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT transition_history_action_check CHECK (action IN ('apply','accept','reject','cancel') AND ((version = 1) = (action = 'apply'))),
  CONSTRAINT transition_history_reason_check CHECK (length(reason) <= 1000),
  CONSTRAINT transition_history_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$')
);
CREATE TRIGGER transition_history_immutable BEFORE UPDATE OR DELETE ON workhub.transition_history
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 5. 공통 내부 함수 — 봉투 · 입력 판정 (앱 services/scoped-rpc.ts 와 같은 규칙)
-- ----------------------------------------------------------------------------
-- 성공 {contract, schoolId, memberId, data} · 업무 거절 {contract, schoolId, memberId, error:{code}} (정확히 이 키만)
CREATE FUNCTION workhub_private.p7_ok(p_ctx workhub_private.actor_context, p_contract text, p_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', p_contract, 'schoolId', p_ctx.school_id, 'memberId', p_ctx.membership_id, 'data', p_data)
$$;
CREATE FUNCTION workhub_private.p7_err(p_ctx workhub_private.actor_context, p_contract text, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', p_contract, 'schoolId', p_ctx.school_id, 'memberId', p_ctx.membership_id,
                            'error', jsonb_build_object('code', p_code))
$$;
-- 봉투로 돌려줄 업무 코드(앱 ServiceCode 중 서버가 내는 것)
CREATE FUNCTION workhub_private.p7_business(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_code IN ('NOT_READY','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','QUERY_FAILED')
$$;
-- 앱 text(): 문자열 · 코드포인트 길이(Array.from) · required 면 공백뿐 아님 · 제어문자(탭·줄바꿈·CR 제외)와 DEL 없음
CREATE FUNCTION workhub_private.p7_text(p jsonb, p_max integer, p_required boolean DEFAULT true) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(p #>> '{}') <= p_max
     AND (NOT p_required OR workhub_private.js_trim(p #>> '{}') <> '')
     AND (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
$$;
-- 앱 identifier(): 영문·숫자·_- 1~100자
CREATE FUNCTION workhub_private.p7_id(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[a-zA-Z0-9_-]{1,100}$'
$$;
-- 요청 번호: 앱은 8자 이상('종류-uuid'). 서버는 영문·숫자·_- 8~200자만 받는다(P4 와 같은 규칙).
CREATE FUNCTION workhub_private.p7_key(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND p ~ '^[A-Za-z0-9_-]{8,200}$'
$$;
-- 앱 version(): 안전한 양의 정수(DB 는 integer 범위)
CREATE FUNCTION workhub_private.p7_pos(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_int(p, 1, 2147483647)
$$;
-- 앱 isoDate(): YYYY-MM-DD 이고 실제 날짜(윤년 포함)
CREATE FUNCTION workhub_private.p7_date(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'string' OR (p #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  BEGIN
    v := (p #>> '{}')::date;
  EXCEPTION WHEN others THEN RETURN false;
  END;
  RETURN to_char(v, 'YYYY-MM-DD') = (p #>> '{}');
END $$;
CREATE FUNCTION workhub_private.p7_day(p date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p, 'YYYY-MM-DD')
$$;
-- 같은 (학교, 소속, 모듈, 요청 번호)의 동시 실행을 한 줄로 세운다
CREATE FUNCTION workhub_private.p7_lock(p_ctx workhub_private.actor_context, p_module text, p_key text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('p7' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.membership_id
                                                || chr(31) || p_module || chr(31) || p_key, 0))
$$;
-- 위치 값: 서버가 만든 JSON 을 16진으로. 소속 지문을 넣어 다른 소속에서 쓰지 못하게 한다.
CREATE FUNCTION workhub_private.p7_cursor_out(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(convert_to(p::text, 'UTF8'), 'hex')
$$;
CREATE FUNCTION workhub_private.p7_cursor_in(p text, p_owner text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF length(p) > 1000 OR p !~ '^[0-9a-f]+$' OR length(p) % 2 <> 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN
    v := convert_from(decode(p, 'hex'), 'UTF8')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF jsonb_typeof(v) <> 'object' OR v ->> 'o' IS DISTINCT FROM p_owner
     OR jsonb_typeof(v -> 't') IS DISTINCT FROM 'string' OR jsonb_typeof(v -> 'i') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  BEGIN
    PERFORM (v ->> 't')::timestamptz;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  RETURN v;
END $$;

-- 요청 원장: 같은 (학교·소속·모듈·번호). 다른 내용 · 다른 계정이면 IDEMPOTENCY_CONFLICT. 없으면 빈 행.
CREATE FUNCTION workhub_private.p7_ledger(p_ctx workhub_private.actor_context, p_module text, p_key text, p_hash text)
RETURNS workhub.operation_requests
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.operation_requests;
BEGIN
  SELECT * INTO q FROM workhub.operation_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND module = p_module AND request_key = p_key;
  IF q.request_key IS NOT NULL AND (q.payload_hash <> p_hash OR q.account_id <> p_ctx.account_id) THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN q;
END $$;
CREATE FUNCTION workhub_private.p7_record(p_ctx workhub_private.actor_context, p_module text, p_key text, p_hash text,
  p_resource text, p_response jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.operation_requests (school_id, membership_id, account_id, module, request_key, payload_hash, resource_id, response)
  VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_module, p_key, p_hash, p_resource, p_response)
$$;

-- ----------------------------------------------------------------------------
-- 6. 준비 상태
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p7_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p7_installs WHERE batch IN ('P7-01','P7-02') AND release = '2026-10-16.1') = 2
$$;
-- P7-05(R1 · P2 보강)가 적용되었는가. 없으면 마감 · 기한 변경 · 보관 · 재개와 수합 · 협업 인계는 NOT_READY.
CREATE FUNCTION workhub_private.p7_bridge() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub_private.p7_installs WHERE batch = 'P7-05' AND release = '2026-10-16.1')
$$;
-- 모듈 준비 사유: ready · database_missing · disabled(중지) · policy_missing(활성화 없음)
CREATE FUNCTION workhub_private.p7_reason(p_school text, p_module text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT workhub_private.p7_installed() THEN 'database_missing'
    WHEN EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = p_module AND state = 'stopped') THEN 'disabled'
    WHEN NOT EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = p_module AND state = 'active') THEN 'policy_missing'
    ELSE 'ready' END
$$;
CREATE FUNCTION workhub_private.p7_ready(p_school text, p_module text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p7_reason(p_school, p_module) = 'ready'
$$;

-- ----------------------------------------------------------------------------
-- 7. 수합 운영 공통
-- ----------------------------------------------------------------------------
-- 운영 상태(행이 없으면 open). 보강(P7-05)의 R1 쓰기 게이트도 이 함수로 판정한다.
CREATE FUNCTION workhub_private.p7_phase(p_school text, p_collection text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT phase FROM workhub.collection_operations WHERE school_id = p_school AND collection_id = p_collection), 'open')
$$;
CREATE FUNCTION workhub_private.p7_ops_version(p_school text, p_collection text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT version FROM workhub.collection_operations WHERE school_id = p_school AND collection_id = p_collection), 1)
$$;
-- 제출 단위 상태(R1 원본에서 계산):
--   보완 요청이 열려 있음 → changes_requested · 유효 제출판 없음 → missing
--   검토가 필요한 수합에서 유효 제출판이 accepted 로 검토됨 → accepted · 그 밖(검토 대기 · 검토 없는 수합) → submitted
CREATE FUNCTION workhub_private.p7_unit_state(p_school text, p_unit text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM workhub.correction_requests cr WHERE cr.school_id = u.school_id AND cr.unit_id = u.id AND cr.state = 'open') THEN 'changes_requested'
    WHEN u.current_submission_id IS NULL THEN 'missing'
    -- 검토형: 현재판이 승인되어 완료본이 된 경우만 accepted. 무검토형은 제출이 곧 완료라 submitted 로 센다(승인 단계가 없다).
    WHEN c.review_mode = 'required' AND u.effective_submission_id = u.current_submission_id
         AND EXISTS (SELECT 1 FROM workhub.submission_reviews r WHERE r.school_id = u.school_id AND r.unit_id = u.id
                       AND r.submission_id = u.current_submission_id AND r.decision = 'accepted') THEN 'accepted'
    ELSE 'submitted' END
  FROM workhub.collection_units u JOIN workhub.collections c ON c.school_id = u.school_id AND c.id = u.collection_id
  WHERE u.school_id = p_school AND u.id = p_unit
$$;

-- 보강이 R1 · P2 행을 바꿀 때 켜는 표시(이 트랜잭션 안에서만). 보강 트리거는 이 표시가 있을 때만 허락된 칸의 변경을 받는다.
CREATE FUNCTION workhub_private.p7_change_on() RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT set_config('workhub.p7_change', 'on', true)
$$;
CREATE FUNCTION workhub_private.p7_change_off() RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT set_config('workhub.p7_change', '', true)
$$;

-- ----------------------------------------------------------------------------
-- 8. 인계 공통
-- ----------------------------------------------------------------------------
-- 받을 수 있는 사람: 같은 학교 · 오늘 유효한 소속 · 업무실 사용자(P2 받는 사람 규칙 = 계란님 결정 "좁히기")
CREATE FUNCTION workhub_private.p7_recipient_ok(p_ctx workhub_private.actor_context, p_member text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_member IS NOT NULL AND p_member <> p_ctx.membership_id
     AND workhub_private.p2_member_reachable(p_ctx.school_id, p_member)
     AND NOT EXISTS (SELECT 1 FROM workhub.memberships m WHERE m.school_id = p_ctx.school_id AND m.id = p_member AND m.account_id = p_ctx.account_id)
$$;
-- 학교 관리(P1)가 켜져 있는가(공식 담당 변경 · 새 학년도는 학교 관리 판과 변경 원장에 같이 남긴다)
CREATE FUNCTION workhub_private.p7_admin_active(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.school_admin_activations WHERE school_id = p_school AND state = 'active')
$$;

-- 미리보기 지문의 시간 칸: 10분 단위. 미리보기 시각의 칸과 그다음 칸까지(10~20분) 같은 지문으로 적용할 수 있다.
CREATE FUNCTION workhub_private.p7_bucket(p timestamptz) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT floor(extract(epoch FROM p) / 600)::bigint
$$;

-- ----------------------------------------------------------------------------
-- 9. 권한 — 새 표는 RLS 켜고 API 역할 권한 0. 새 내부 함수도 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p7_installs','workhub.operation_requests','workhub.collection_operations',
      'workhub.collection_operation_history','workhub.collection_reminders','workhub.transition_records','workhub.transition_items',
      'workhub.transition_history'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p7\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

INSERT INTO workhub_private.p7_installs (batch, release) VALUES ('P7-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 10. 검증 — 모든 행의 status 가 ok 여야 한다.
-- ----------------------------------------------------------------------------
WITH t(n) AS (VALUES ('workhub_private.p7_installs'),('workhub.operation_requests'),('workhub.collection_operations'),
                     ('workhub.collection_operation_history'),('workhub.collection_reminders'),('workhub.transition_records'),
                     ('workhub.transition_items'),('workhub.transition_history'))
SELECT 'P7-01-1' AS no, '새 표 7개 + 적용 기록 · RLS 켜짐 · API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 8 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM t JOIN pg_class c ON c.oid = to_regclass(t.n)
UNION ALL
SELECT 'P7-01-2', '수합 운영 · 홈 · 인계 모듈 활성화 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module IN ('collection_ops','home','transitions')) = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P7-01-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p7\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P7-01-4', '적용 기록 P7-01', CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p7_installs WHERE batch = 'P7-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
