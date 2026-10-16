-- ============================================================================
-- P3-01  메신저 · 업무 알림 · 메시지 HWPX 첨부 — 표와 내부 함수 (비활성 설치)
--
-- ▣ 전제: R0 · R1-01~03 · P1-01·02 · P2-01·02 (판 2026-10-16.1). R1S 는 있어도 없어도 된다.
-- ▣ 새 표 12개 + 적용 기록. 기존 표·함수·제약은 바꾸지 않는다(P2 의 module_activations 에 모듈 이름만 더해 쓴다).
-- ▣ 학교별 활성화 전에는 모든 함수가 NOT_READY(메시지) · verification_missing(첨부)이다.
-- ▣ 메시지 파일은 수합 파일 원장·버킷과 공유하지 않는다(전용 버킷은 P3-02 가 만든다).
-- ============================================================================
BEGIN;

DO $$
BEGIN
  -- 표가 없을 때 아래 SELECT 를 같은 조건식에 두면 계획 단계에서 relation 오류가 먼저 난다 → 따로 묻는다
  IF to_regclass('workhub_private.p2_installs') IS NULL THEN
    RAISE EXCEPTION 'P3 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.p2_installs WHERE batch IN ('P2-01','P2-02') AND release = '2026-10-16.1') <> 2 THEN
    RAISE EXCEPTION 'P3 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF to_regprocedure('workhub_private.c_storage_op()') IS NULL OR to_regprocedure('workhub_private.c_object_owner(text,text)') IS NULL
     OR to_regnamespace('workhub_storage') IS NULL THEN
    RAISE EXCEPTION 'P3 중단: R1-03 의 Storage 판정 함수가 없습니다(R1-03 적용 확인).';
  END IF;
  IF to_regclass('workhub_private.p3_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P3 중단: P3-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.message_threads') IS NOT NULL OR to_regclass('workhub.messages') IS NOT NULL
     OR to_regclass('workhub.message_files') IS NOT NULL OR to_regclass('workhub.notifications') IS NOT NULL
     OR to_regclass('workhub.messaging_policies') IS NOT NULL OR to_regclass('workhub.message_file_policies') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p3\_%' OR proname LIKE 'workhub\_messag%' OR proname = 'workhub_inbox_list') THEN
    RAISE EXCEPTION 'P3 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p3_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p3_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p3_installs_batch_check CHECK (batch IN ('P3-01','P3-02')),
  CONSTRAINT p3_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p3_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p3_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 학교 정책 — 화면이 그대로 적용하는 한도. P3-04 / P3-05 가 계란님 입력값으로 1행씩 쓴다(예시값을 심지 않는다).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.messaging_policies (
  school_id                 text NOT NULL,
  body_characters           integer NOT NULL,
  title_characters          integer NOT NULL,
  recipients                integer NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT messaging_policies_pkey PRIMARY KEY (school_id),
  CONSTRAINT messaging_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT messaging_policies_body_check CHECK (body_characters BETWEEN 1 AND 50000),
  CONSTRAINT messaging_policies_title_check CHECK (title_characters BETWEEN 1 AND 1000),
  CONSTRAINT messaging_policies_recipients_check CHECK (recipients BETWEEN 1 AND 500),
  CONSTRAINT messaging_policies_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
CREATE TRIGGER messaging_policies_immutable BEFORE UPDATE OR DELETE ON workhub.messaging_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 첨부: 기본 확인 API(/api/messages/check-hwpx) 배포 확인값(verification_ref)이 있어야 ready 가 될 수 있다.
CREATE TABLE workhub.message_file_policies (
  school_id                 text NOT NULL,
  max_file_bytes            bigint NOT NULL,
  max_files                 integer NOT NULL,
  verification_ref          text NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_file_policies_pkey PRIMARY KEY (school_id),
  CONSTRAINT message_file_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT message_file_policies_bytes_check CHECK (max_file_bytes BETWEEN 1 AND 31457280),
  CONSTRAINT message_file_policies_files_check CHECK (max_files BETWEEN 1 AND 20),
  CONSTRAINT message_file_policies_verification_check CHECK (length(btrim(verification_ref)) BETWEEN 1 AND 200),
  CONSTRAINT message_file_policies_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
CREATE TRIGGER message_file_policies_immutable BEFORE UPDATE OR DELETE ON workhub.message_file_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 대화 · 참여자 · 메시지
-- ----------------------------------------------------------------------------
-- 1:1 대화는 두 소속 조합으로 하나(direct_key = 작은 id | 큰 id). 단체 대화는 만들 때마다 새로.
CREATE TABLE workhub.message_threads (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  kind                     text NOT NULL,
  title                    text NOT NULL DEFAULT '',
  direct_key               text,
  version                  integer NOT NULL DEFAULT 1,
  latest_sequence          integer NOT NULL DEFAULT 0,
  created_by_membership_id text NOT NULL,
  created_by_account_id    text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_threads_pkey PRIMARY KEY (id),
  CONSTRAINT message_threads_school_id_key UNIQUE (school_id, id),
  CONSTRAINT message_threads_direct_key UNIQUE (school_id, direct_key),
  CONSTRAINT message_threads_creator_fkey FOREIGN KEY (school_id, created_by_membership_id, created_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT message_threads_kind_check CHECK (kind IN ('direct','group')),
  CONSTRAINT message_threads_direct_check CHECK ((kind = 'direct') = (direct_key IS NOT NULL) AND (kind = 'group' OR title = '')),
  CONSTRAINT message_threads_title_check CHECK (length(title) <= 1000 AND (kind = 'direct' OR btrim(title) <> '')),
  CONSTRAINT message_threads_version_check CHECK (version >= 1),
  CONSTRAINT message_threads_sequence_check CHECK (latest_sequence >= 0)
);
CREATE TRIGGER message_threads_identity BEFORE UPDATE ON workhub.message_threads
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','kind','title','direct_key','created_by_membership_id','created_by_account_id','created_at');
CREATE TRIGGER message_threads_no_delete BEFORE DELETE ON workhub.message_threads
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 참여자: 만든 뒤 바뀌지 않는다(이번 계약에 참여자 추가·나가기 명령이 없다). 읽은 순번만 오른다(단조 증가).
CREATE TABLE workhub.message_thread_members (
  school_id        text NOT NULL,
  thread_id        text NOT NULL,
  membership_id    text NOT NULL,
  account_id       text NOT NULL,
  joined_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_sequence    integer NOT NULL DEFAULT 0,
  read_updated_at  timestamptz,
  CONSTRAINT message_thread_members_pkey PRIMARY KEY (thread_id, membership_id),
  CONSTRAINT message_thread_members_thread_fkey FOREIGN KEY (school_id, thread_id) REFERENCES workhub.message_threads(school_id, id),
  CONSTRAINT message_thread_members_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT message_thread_members_read_check CHECK (read_sequence >= 0)
);
CREATE INDEX message_thread_members_member_idx ON workhub.message_thread_members (school_id, membership_id);
CREATE FUNCTION workhub_private.p3_read_monotonic() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.school_id <> OLD.school_id OR NEW.thread_id <> OLD.thread_id OR NEW.membership_id <> OLD.membership_id
     OR NEW.account_id <> OLD.account_id OR NEW.joined_at <> OLD.joined_at OR NEW.read_sequence < OLD.read_sequence THEN
    RAISE EXCEPTION 'P3_READ_MONOTONIC' USING DETAIL = '참여자 정체성은 바꿀 수 없고 읽은 순번은 내려가지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER message_thread_members_guard BEFORE UPDATE ON workhub.message_thread_members
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p3_read_monotonic();
CREATE TRIGGER message_thread_members_no_delete BEFORE DELETE ON workhub.message_thread_members
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 메시지: 불변. 대화 안 순번 유일(삭제·재정렬 없음). 작성자 이름은 당시 값을 보존한다.
CREATE TABLE workhub.messages (
  id                    text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id             text NOT NULL,
  thread_id             text NOT NULL,
  sequence              integer NOT NULL,
  sender_membership_id  text NOT NULL,
  sender_account_id     text NOT NULL,
  sender_name           text NOT NULL,
  body                  text NOT NULL,
  request_key           text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_school_id_key UNIQUE (school_id, id),
  CONSTRAINT messages_sequence_key UNIQUE (thread_id, sequence),
  CONSTRAINT messages_thread_fkey FOREIGN KEY (school_id, thread_id) REFERENCES workhub.message_threads(school_id, id),
  CONSTRAINT messages_sender_fkey FOREIGN KEY (thread_id, sender_membership_id) REFERENCES workhub.message_thread_members(thread_id, membership_id),
  CONSTRAINT messages_sequence_check CHECK (sequence >= 1),
  CONSTRAINT messages_body_check CHECK (length(body) <= 50000),
  CONSTRAINT messages_sender_name_check CHECK (length(sender_name) BETWEEN 1 AND 200)
);
CREATE TRIGGER messages_immutable BEFORE UPDATE OR DELETE ON workhub.messages
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 4. 메시지 첨부(HWPX) — 전용 원장. 경로 = 학교/올린 소속/파일/original.hwpx
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.message_files (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  owner_membership_id  text NOT NULL,
  owner_account_id     text NOT NULL,
  name                 text NOT NULL,
  claimed_bytes        bigint NOT NULL,
  claimed_sha256       text NOT NULL,
  state                text NOT NULL DEFAULT 'awaiting_upload',
  storage_path         text NOT NULL,
  upload_expires_at    timestamptz NOT NULL,
  storage_object_id    uuid,
  actual_bytes         bigint,
  actual_sha256        text,
  reject_code          text,
  result_sha256        text,
  attached_at          timestamptz,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_files_pkey PRIMARY KEY (id),
  CONSTRAINT message_files_school_id_key UNIQUE (school_id, id),
  CONSTRAINT message_files_path_key UNIQUE (storage_path),
  CONSTRAINT message_files_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT message_files_state_check CHECK (state IN ('awaiting_upload','pending_basic','ready','rejected')),
  CONSTRAINT message_files_name_check CHECK (length(name) BETWEEN 6 AND 240 AND lower(name) LIKE '%.hwpx'),
  CONSTRAINT message_files_bytes_check CHECK (claimed_bytes BETWEEN 1 AND 31457280),
  CONSTRAINT message_files_sha_check CHECK (claimed_sha256 ~ '^[0-9a-f]{64}$' AND (actual_sha256 IS NULL OR actual_sha256 ~ '^[0-9a-f]{64}$')),
  CONSTRAINT message_files_path_check CHECK (storage_path = school_id || '/' || owner_membership_id || '/' || id || '/original.hwpx'),
  CONSTRAINT message_files_object_check CHECK ((state IN ('pending_basic','ready')) <= (storage_object_id IS NOT NULL)),
  CONSTRAINT message_files_ready_check CHECK (state <> 'ready' OR (actual_bytes = claimed_bytes AND actual_sha256 = claimed_sha256 AND reject_code IS NULL)),
  CONSTRAINT message_files_reject_check CHECK ((state = 'rejected') = (reject_code IS NOT NULL)),
  CONSTRAINT message_files_attached_check CHECK (attached_at IS NULL OR state = 'ready'),
  CONSTRAINT message_files_version_check CHECK (version >= 1)
);
CREATE INDEX message_files_owner_idx ON workhub.message_files (school_id, owner_account_id, created_at);
-- 실물 정체성(경로·주인·올린 시각 뒤 object id)과 확인 결과는 한 번 정해지면 바뀌지 않는다.
CREATE FUNCTION workhub_private.p3_file_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.school_id <> OLD.school_id OR NEW.owner_membership_id <> OLD.owner_membership_id
     OR NEW.owner_account_id <> OLD.owner_account_id OR NEW.name <> OLD.name OR NEW.claimed_bytes <> OLD.claimed_bytes
     OR NEW.claimed_sha256 <> OLD.claimed_sha256 OR NEW.storage_path <> OLD.storage_path OR NEW.created_at <> OLD.created_at
     OR NEW.upload_expires_at <> OLD.upload_expires_at
     OR (OLD.storage_object_id IS NOT NULL AND NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id)
     OR (OLD.state IN ('ready','rejected') AND (NEW.state <> OLD.state OR NEW.actual_bytes IS DISTINCT FROM OLD.actual_bytes
         OR NEW.actual_sha256 IS DISTINCT FROM OLD.actual_sha256 OR NEW.reject_code IS DISTINCT FROM OLD.reject_code
         OR NEW.result_sha256 IS DISTINCT FROM OLD.result_sha256))
     OR (OLD.attached_at IS NOT NULL AND NEW.attached_at IS DISTINCT FROM OLD.attached_at)
     OR NOT ((OLD.state, NEW.state) IN (('awaiting_upload','awaiting_upload'),('awaiting_upload','pending_basic'),('awaiting_upload','rejected'),
             ('pending_basic','pending_basic'),('pending_basic','ready'),('pending_basic','rejected'),('ready','ready'),('rejected','rejected'))) THEN
    RAISE EXCEPTION 'P3_FILE_IMMUTABLE' USING DETAIL = '메시지 파일의 정체성·확인 결과는 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER message_files_guard BEFORE UPDATE ON workhub.message_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p3_file_guard();
CREATE TRIGGER message_files_no_delete BEFORE DELETE ON workhub.message_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 메시지 ↔ 파일. 개별 일괄 전송은 같은 파일을 받는 사람별 메시지에 각각 연결한다(그 메시지의 참여자만 받는다).
CREATE TABLE workhub.message_attachments (
  school_id  text NOT NULL,
  message_id text NOT NULL,
  file_id    text NOT NULL,
  position   smallint NOT NULL,
  CONSTRAINT message_attachments_pkey PRIMARY KEY (message_id, file_id),
  CONSTRAINT message_attachments_position_key UNIQUE (message_id, position),
  CONSTRAINT message_attachments_message_fkey FOREIGN KEY (school_id, message_id) REFERENCES workhub.messages(school_id, id),
  CONSTRAINT message_attachments_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.message_files(school_id, id),
  CONSTRAINT message_attachments_position_check CHECK (position BETWEEN 1 AND 20)
);
CREATE INDEX message_attachments_file_idx ON workhub.message_attachments (file_id);
CREATE TRIGGER message_attachments_immutable BEFORE UPDATE OR DELETE ON workhub.message_attachments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 기본 확인 임대: 1회용 token(해시만 저장) · 90초
CREATE TABLE workhub.message_file_leases (
  id                text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id         text NOT NULL,
  file_id           text NOT NULL,
  account_id        text NOT NULL,
  membership_id     text NOT NULL,
  token_sha256      text NOT NULL,
  request_key       text NOT NULL,
  state             text NOT NULL DEFAULT 'issued',
  issued_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at        timestamptz NOT NULL,
  closed_at         timestamptz,
  CONSTRAINT message_file_leases_pkey PRIMARY KEY (id),
  CONSTRAINT message_file_leases_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.message_files(school_id, id),
  CONSTRAINT message_file_leases_token_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT message_file_leases_state_check CHECK (state IN ('issued','expired','finished')),
  CONSTRAINT message_file_leases_closed_check CHECK ((state = 'issued') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX message_file_leases_one_issued ON workhub.message_file_leases (file_id) WHERE state = 'issued';
CREATE INDEX message_file_leases_account_idx ON workhub.message_file_leases (account_id, issued_at);
CREATE TRIGGER message_file_leases_identity BEFORE UPDATE ON workhub.message_file_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','file_id','account_id','membership_id','token_sha256','request_key','issued_at','expires_at');
CREATE TRIGGER message_file_leases_no_delete BEFORE DELETE ON workhub.message_file_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 5. 요청 원장 — 반영된 요청만 남긴다(확정 거절은 부작용이 없으므로 같은 키로 다시 판정해도 중복이 생기지 않는다)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.message_requests (
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  request_key   text NOT NULL,
  command_kind  text NOT NULL,
  payload_hash  text NOT NULL,
  response      jsonb NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_requests_pkey PRIMARY KEY (school_id, membership_id, request_key),
  CONSTRAINT message_requests_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT message_requests_key_check CHECK (request_key ~ '^[a-zA-Z0-9_-]{1,100}$'),
  CONSTRAINT message_requests_kind_check CHECK (command_kind IN ('start','reply','read_thread','read_notice')),
  CONSTRAINT message_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT message_requests_response_check CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 262144)
);
CREATE TRIGGER message_requests_immutable BEFORE UPDATE OR DELETE ON workhub.message_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 파일 단계별 요청 번호 ↔ 파일. prepare 는 같은 신고값이면 같은 예약을, complete·claim·finish 는 같은 파일에만 쓸 수 있다.
CREATE TABLE workhub.message_file_requests (
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  action        text NOT NULL,
  request_key   text NOT NULL,
  payload_hash  text NOT NULL,
  file_id       text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT message_file_requests_pkey PRIMARY KEY (school_id, membership_id, action, request_key),
  CONSTRAINT message_file_requests_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT message_file_requests_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.message_files(school_id, id),
  CONSTRAINT message_file_requests_action_check CHECK (action IN ('prepare','complete','claim','finish')),
  CONSTRAINT message_file_requests_key_check CHECK (request_key ~ '^[a-zA-Z0-9_-]{1,100}$'),
  CONSTRAINT message_file_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER message_file_requests_immutable BEFORE UPDATE OR DELETE ON workhub.message_file_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 업무 알림 — 받는 소속 1명당 1행. 원본 모듈이 자기 트랜잭션 안에서 p3_notify 로 만든다(같은 dedupe_key 는 한 번).
--    제목·본문에 학생·상담·메시지 본문을 복제하지 않는 것은 부르는 쪽 책임이고, 이번 배치는 만드는 쪽이 없다(7단계).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.notifications (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  owner_membership_id  text NOT NULL,
  owner_account_id     text NOT NULL,
  title                text NOT NULL,
  body                 text NOT NULL DEFAULT '',
  source_module        text,
  source_id            text,
  dedupe_key           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at              timestamptz,
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_dedupe_key UNIQUE (school_id, owner_membership_id, dedupe_key),
  CONSTRAINT notifications_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT notifications_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  CONSTRAINT notifications_body_check CHECK (length(body) <= 4000),
  CONSTRAINT notifications_source_check CHECK ((source_module IS NULL) = (source_id IS NULL)
    AND (source_module IS NULL OR source_module IN ('calendar','tasks','collections','messages','students','knowledge'))
    AND (source_id IS NULL OR source_id ~ '^[a-zA-Z0-9_-]{1,100}$')),
  CONSTRAINT notifications_dedupe_check CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT notifications_read_check CHECK ((read_at IS NULL) = (version = 1))
);
CREATE INDEX notifications_owner_idx ON workhub.notifications (school_id, owner_membership_id, created_at DESC, id DESC);
CREATE TRIGGER notifications_identity BEFORE UPDATE ON workhub.notifications
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','owner_membership_id','owner_account_id','title','body','source_module','source_id','dedupe_key','created_at');
CREATE TRIGGER notifications_no_delete BEFORE DELETE ON workhub.notifications
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 이 파일이 만든 Storage 정책의 정확한 식(P3-02 가 채운다). 준비 상태가 현재 정책과 대조한다.
CREATE TABLE workhub_private.p3_storage_policies (
  policy_name name NOT NULL,
  cmd         "char" NOT NULL,
  expr_md5    text NOT NULL,
  CONSTRAINT p3_storage_policies_pkey PRIMARY KEY (policy_name)
);
CREATE TRIGGER p3_storage_policies_immutable BEFORE UPDATE OR DELETE ON workhub_private.p3_storage_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. 내부 함수 — 봉투 · 입력 판정 (앱 messaging/validation.ts 와 같은 규칙)
-- ----------------------------------------------------------------------------
-- 성공 {contractVersion:1, schoolId, memberId, userId, ok:true, data} · 업무 거절 {..., ok:false, error:{code}}
CREATE FUNCTION workhub_private.p3_ok(p_ctx workhub_private.actor_context, p_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contractVersion', 1, 'schoolId', p_ctx.school_id, 'memberId', p_ctx.membership_id,
                            'userId', p_ctx.auth_user_id::text, 'ok', true, 'data', p_data)
$$;
CREATE FUNCTION workhub_private.p3_err(p_ctx workhub_private.actor_context, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contractVersion', 1, 'schoolId', p_ctx.school_id, 'memberId', p_ctx.membership_id,
                            'userId', p_ctx.auth_user_id::text, 'ok', false, 'error', jsonb_build_object('code', p_code))
$$;
CREATE FUNCTION workhub_private.p3_business(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_code IN ('NOT_READY','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT')
$$;

-- 앱 text(): 문자열 · UTF-16 길이 · (empty 아니면) 공백뿐 아님 · 제어문자(탭·줄바꿈·CR 제외)와 DEL 없음
CREATE FUNCTION workhub_private.p3_text(p jsonb, p_max integer, p_empty boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(p #>> '{}') + regexp_count(p #>> '{}', '[\U00010000-\U0010FFFF]') <= p_max
     AND (p_empty OR workhub_private.js_trim(p #>> '{}') <> '')
     AND (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
$$;
CREATE FUNCTION workhub_private.p3_len(p text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT length(p) + regexp_count(p, '[\U00010000-\U0010FFFF]')
$$;
-- 앱 identifier(): 영문·숫자·_- 1~100자
CREATE FUNCTION workhub_private.p3_id(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[a-zA-Z0-9_-]{1,100}$'
$$;
CREATE FUNCTION workhub_private.p3_key(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND p ~ '^[a-zA-Z0-9_-]{1,100}$'
$$;
-- 앱 timestamp() 형식(…Z, 밀리초)
CREATE FUNCTION workhub_private.p3_ts(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
-- 위치 값: 서버가 만든 JSON 을 16진으로. 소속·필터 지문을 넣어 다른 소속·다른 필터에서 쓰지 못하게 한다.
CREATE FUNCTION workhub_private.p3_cursor_out(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(convert_to(p::text, 'UTF8'), 'hex')
$$;
CREATE FUNCTION workhub_private.p3_cursor_in(p text, p_fhash text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF length(p) > 2048 OR p !~ '^[0-9a-f]+$' OR length(p) % 2 <> 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN
    v := convert_from(decode(p, 'hex'), 'UTF8')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF jsonb_typeof(v) <> 'object' OR v ->> 'f' IS DISTINCT FROM p_fhash THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 8. 내부 함수 — 준비 상태
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p3_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p3_installs WHERE batch IN ('P3-01','P3-02') AND release = '2026-10-16.1') = 2
$$;

-- 메시지: 활성화·정책 1행이 모두 있어야 ready. 중지 → disabled. 없음 → policy_missing.
CREATE FUNCTION workhub_private.p3_messaging_reason(p_school text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT workhub_private.p3_installed() THEN 'database_missing'
    WHEN EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = 'messaging' AND state = 'stopped') THEN 'disabled'
    WHEN NOT EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = 'messaging' AND state = 'active')
      OR NOT EXISTS (SELECT 1 FROM workhub.messaging_policies WHERE school_id = p_school) THEN 'policy_missing'
    ELSE 'ready' END
$$;

-- 다른 버킷으로 한정된 정책식인가(R1 c_other_bucket 과 같은 모양 판정, 대상 버킷만 다름). 판정 못 하면 안전하지 않은 것으로 본다.
CREATE FUNCTION workhub_private.p3_other_bucket(p_expr text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_expr IS NOT NULL
     AND (p_expr ~ '^\(bucket_id = ''[^'']*''::text\)$' OR p_expr ~ '^\(\(bucket_id = ''[^'']*''::text\) AND ')
     AND substring(p_expr FROM '^\(+bucket_id = ''([^'']*)''::text\)') <> 'workhub-message-files'
$$;

-- Storage 준비: 비공개 버킷 · RLS 켜짐 · 이 배치의 정책 2개가 그대로 · 다른 permissive 정책이 이 버킷을 열지 않음
CREATE FUNCTION workhub_private.p3_storage_ok() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rel oid := to_regclass('storage.objects'); p record; v_api oid[];
BEGIN
  IF v_rel IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-message-files' AND name = 'workhub-message-files' AND public IS FALSE) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolbypassrls OR rolsuper)) THEN RETURN false; END IF;
  v_api := ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'));
  IF (SELECT count(*) FROM pg_policy pol JOIN workhub_private.p3_storage_policies e ON e.policy_name = pol.polname
       WHERE pol.polrelid = v_rel AND pol.polcmd = e.cmd AND pol.polpermissive
         AND pol.polroles = ARRAY(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
         AND md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = e.expr_md5) <> 2 THEN
    RETURN false;
  END IF;
  FOR p IN SELECT pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
             FROM pg_policy pol
            WHERE pol.polrelid = v_rel AND pol.polpermissive
              AND pol.polname NOT IN (SELECT policy_name FROM workhub_private.p3_storage_policies)
              AND (0::oid = ANY (pol.polroles) OR pol.polroles && v_api) LOOP
    IF (p.polcmd IN ('r','w','d','*') AND NOT workhub_private.p3_other_bucket(p.q))
       OR (p.polcmd IN ('a','*') AND p.w IS NOT NULL AND NOT workhub_private.p3_other_bucket(p.w))
       OR (p.polcmd = 'a' AND NOT workhub_private.p3_other_bucket(p.w))
       OR (p.polcmd = 'w' AND p.w IS NOT NULL AND NOT workhub_private.p3_other_bucket(p.w)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 첨부: 중지 → disabled, Storage 이상 → storage_missing, 정책·확인 API 배포 확인값 없음 → verification_missing
CREATE FUNCTION workhub_private.p3_files_reason(p_school text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT workhub_private.p3_installed() THEN 'database_missing'
    WHEN EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = 'message_files' AND state = 'stopped') THEN 'disabled'
    WHEN NOT workhub_private.p3_storage_ok() THEN 'storage_missing'
    WHEN NOT EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = 'message_files' AND state = 'active')
      OR NOT EXISTS (SELECT 1 FROM workhub.message_file_policies WHERE school_id = p_school) THEN 'verification_missing'
    ELSE 'ready' END
$$;

CREATE FUNCTION workhub_private.p3_file_policy(p_school text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('extensions', jsonb_build_array('hwpx'), 'maxFileBytes', max_file_bytes, 'maxFiles', max_files)
    FROM workhub.message_file_policies WHERE school_id = p_school
$$;

-- ----------------------------------------------------------------------------
-- 9. 내부 함수 — 사람·대화 DTO
-- ----------------------------------------------------------------------------
-- 지금 메시지를 받을 수 있는 소속(P2 협업과 같은 기준)
CREATE FUNCTION workhub_private.p3_reachable(p_school text, p_membership text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p2_member_reachable(p_school, p_membership)
$$;

-- 표시용 부서: 오늘 유효한 공식 담당 이름(P1). P1 이 켜지기 전에는 빈 값.
CREATE FUNCTION workhub_private.p3_department(p_school text, p_membership text, p_today date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(left((SELECT string_agg(sa.label, ', ' ORDER BY sa.kind, sa.label) FROM workhub.staff_assignments sa
                         WHERE sa.school_id = p_school AND sa.membership_id = p_membership AND sa.status = 'active'
                           AND p_today <@ daterange(sa.valid_from, sa.valid_to, '[)')), 200), '')
$$;

CREATE FUNCTION workhub_private.p3_recipient(p_school text, p_membership text, p_today date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('memberId', m.id, 'schoolId', m.school_id, 'name', left(a.display_name, 200),
                            'department', workhub_private.p3_department(m.school_id, m.id, p_today), 'version', m.version)
    FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
   WHERE m.school_id = p_school AND m.id = p_membership
$$;

-- 대화 요약. participants 는 과거·현재 참여자 전부(작성자 확인용), canSend 는 다른 참여자가 모두 지금 받을 수 있을 때만.
CREATE FUNCTION workhub_private.p3_thread_dto(t workhub.message_threads, p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', t.id, 'schoolId', t.school_id, 'kind', t.kind, 'title', t.title,
    'participants', (SELECT jsonb_agg(workhub_private.p3_recipient(t.school_id, tm.membership_id, p_ctx.school_today) ORDER BY tm.membership_id COLLATE "C")
                       FROM workhub.message_thread_members tm WHERE tm.thread_id = t.id),
    'version', t.version, 'latestSequence', t.latest_sequence, 'readSequence', me.read_sequence,
    'unreadCount', (SELECT count(*) FROM workhub.messages x WHERE x.thread_id = t.id AND x.sequence > me.read_sequence
                      AND x.sequence <= t.latest_sequence AND x.sender_membership_id <> p_ctx.membership_id),
    'updatedAt', workhub_private.p3_ts(t.updated_at),
    'canSend', NOT EXISTS (SELECT 1 FROM workhub.message_thread_members o WHERE o.thread_id = t.id AND o.membership_id <> p_ctx.membership_id
                             AND NOT workhub_private.p3_reachable(t.school_id, o.membership_id)))
    FROM workhub.message_thread_members me WHERE me.thread_id = t.id AND me.membership_id = p_ctx.membership_id
$$;

CREATE FUNCTION workhub_private.p3_attachment(f workhub.message_files) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', f.id, 'name', f.name, 'bytes', f.actual_bytes, 'sha256', f.actual_sha256, 'profile', 'hwpx_basic_v1')
$$;

CREATE FUNCTION workhub_private.p3_message_dto(x workhub.messages) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', x.id, 'schoolId', x.school_id, 'threadId', x.thread_id, 'senderMemberId', x.sender_membership_id,
    'senderName', x.sender_name, 'sequence', x.sequence, 'body', x.body, 'createdAt', workhub_private.p3_ts(x.created_at),
    'attachments', COALESCE((SELECT jsonb_agg(workhub_private.p3_attachment(f) ORDER BY ma.position)
                               FROM workhub.message_attachments ma JOIN workhub.message_files f ON f.id = ma.file_id
                              WHERE ma.message_id = x.id), '[]'::jsonb))
$$;

CREATE FUNCTION workhub_private.p3_notice_dto(n workhub.notifications) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', n.id, 'schoolId', n.school_id, 'ownerMemberId', n.owner_membership_id, 'title', n.title, 'body', n.body,
    'createdAt', workhub_private.p3_ts(n.created_at), 'readAt', CASE WHEN n.read_at IS NULL THEN NULL ELSE to_jsonb(workhub_private.p3_ts(n.read_at)) END,
    'version', n.version,
    'source', CASE WHEN n.source_module IS NULL THEN NULL ELSE jsonb_build_object('module', n.source_module, 'id', n.source_id) END)
$$;

-- 파일 상태(앱 FileStatus). 업로드 기한이 지났고 실물이 없으면 rejected 로 보인다(다음 complete 가 그렇게 기록한다).
CREATE FUNCTION workhub_private.p3_file_status(f workhub.message_files) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('fileId', f.id,
    'state', CASE WHEN f.state = 'awaiting_upload' AND f.upload_expires_at <= clock_timestamp()
                       AND workhub_private.c_object_owner('workhub-message-files', f.storage_path) IS NULL THEN 'rejected' ELSE f.state END,
    'storageObjectId', CASE WHEN f.state IN ('pending_basic','ready','rejected') THEN to_jsonb(f.storage_object_id::text) ELSE 'null'::jsonb END,
    'file', CASE WHEN f.state = 'ready' THEN workhub_private.p3_attachment(f) ELSE NULL END)
$$;

-- ----------------------------------------------------------------------------
-- 10. 알림 만들기(뒤 배치·원본 모듈이 자기 트랜잭션 안에서 부른다). 같은 (받는 사람, dedupe_key) 는 한 번만.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p3_notify(p_school text, p_owner_membership text, p_title text, p_body text,
  p_source_module text, p_source_id text, p_dedupe_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m workhub.memberships; v_id text;
BEGIN
  SELECT * INTO m FROM workhub.memberships WHERE school_id = p_school AND id = p_owner_membership;
  IF NOT FOUND THEN RAISE EXCEPTION 'P3_NOTIFY_TARGET' USING DETAIL = '알림 받을 소속이 이 학교에 없습니다.'; END IF;
  INSERT INTO workhub.notifications (school_id, owner_membership_id, owner_account_id, title, body, source_module, source_id, dedupe_key)
  VALUES (p_school, m.id, m.account_id, btrim(p_title), COALESCE(p_body, ''), p_source_module, p_source_id, p_dedupe_key)
  ON CONFLICT (school_id, owner_membership_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ----------------------------------------------------------------------------
-- 11. 권한 — 새 표는 RLS 켜고 API 역할 권한 0. 새 내부 함수도 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p3_installs','workhub_private.p3_storage_policies','workhub.messaging_policies',
      'workhub.message_file_policies','workhub.message_threads','workhub.message_thread_members','workhub.messages','workhub.message_files',
      'workhub.message_attachments','workhub.message_file_leases','workhub.message_requests','workhub.message_file_requests','workhub.notifications'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p3\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

INSERT INTO workhub_private.p3_installs (batch, release) VALUES ('P3-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 12. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
WITH t(n) AS (VALUES ('workhub_private.p3_installs'),('workhub_private.p3_storage_policies'),('workhub.messaging_policies'),
  ('workhub.message_file_policies'),('workhub.message_threads'),('workhub.message_thread_members'),('workhub.messages'),('workhub.message_files'),
  ('workhub.message_attachments'),('workhub.message_file_leases'),('workhub.message_requests'),('workhub.message_file_requests'),('workhub.notifications'))
SELECT 'P3-01-1' AS no, '새 표 12개 + 적용 기록 · RLS 켜짐 · API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 13 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
                             OR has_table_privilege('service_role', c.oid, 'SELECT')) THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM t JOIN pg_class c ON c.oid = to_regclass(t.n)
UNION ALL
SELECT 'P3-01-2', '메시지·첨부 활성화 0개', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.module_activations WHERE module IN ('messaging','message_files')
UNION ALL
SELECT 'P3-01-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p3\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P3-01-4', '적용 기록 P3-01', CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p3_installs WHERE batch = 'P3-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
