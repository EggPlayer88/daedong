-- ============================================================================
-- P4-01  학교 자료(지식) · HWPX 원문 가져오기 · 문서함 · 질문형 양식 — 표와 공통 내부 함수 (비활성 설치)
--
-- ▣ 전제: R0 · R1-01~03 · P1-01·02 · P2-01·02 (판 2026-10-16.1). R1S · P3 는 있어도 없어도 된다.
-- ▣ 새 표 19개 + 적용 기록. 기존 표·함수·제약은 바꾸지 않는다(P2 의 module_activations 에 모듈 이름 4개만 더해 쓴다:
--   knowledge · knowledge_import · documents · guided).
-- ▣ 학교별 활성화(P4-04 · P4-05) 전에는 모든 함수가 NOT_READY 다. 이 파일만으로 켜지는 것은 없다.
-- ▣ 원본 파일은 수합·메시지 파일 원장·버킷과 공유하지 않는다(전용 버킷 2개는 P4-02 가 만든다).
-- ============================================================================
BEGIN;

DO $$
BEGIN
  -- 표가 없을 때 아래 SELECT 를 같은 조건식에 두면 계획 단계에서 relation 오류가 먼저 난다 → 따로 묻는다
  IF to_regclass('workhub_private.p2_installs') IS NULL THEN
    RAISE EXCEPTION 'P4 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.p2_installs WHERE batch IN ('P2-01','P2-02') AND release = '2026-10-16.1') <> 2 THEN
    RAISE EXCEPTION 'P4 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF to_regprocedure('workhub_private.c_storage_op()') IS NULL OR to_regprocedure('workhub_private.c_object_owner(text,text)') IS NULL
     OR to_regnamespace('workhub_storage') IS NULL OR to_regclass('workhub.collections') IS NULL THEN
    RAISE EXCEPTION 'P4 중단: R1-02·03 의 수합 표·Storage 판정 함수가 없습니다(R1 적용 확인).';
  END IF;
  IF to_regclass('workhub_private.p4_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P4 중단: P4-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.knowledge_sources') IS NOT NULL OR to_regclass('workhub.knowledge_files') IS NOT NULL
     OR to_regclass('workhub.documents') IS NOT NULL OR to_regclass('workhub.document_versions') IS NOT NULL
     OR to_regclass('workhub.guided_templates') IS NOT NULL OR to_regclass('workhub.content_requests') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p4\_%' OR proname LIKE 'workhub\_knowledge\_%'
                OR proname LIKE 'workhub\_document\_%' OR proname LIKE 'workhub\_template\_%') THEN
    RAISE EXCEPTION 'P4 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록 · Storage 정책 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p4_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p4_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p4_installs_batch_check CHECK (batch IN ('P4-01','P4-02')),
  CONSTRAINT p4_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p4_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p4_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 이 배치가 만든 Storage 정책의 정확한 식(P4-02 가 채운다). 준비 상태가 현재 정책과 대조한다.
CREATE TABLE workhub_private.p4_storage_policies (
  policy_name name NOT NULL,
  bucket      text NOT NULL,
  cmd         "char" NOT NULL,
  expr_md5    text NOT NULL,
  CONSTRAINT p4_storage_policies_pkey PRIMARY KEY (policy_name),
  CONSTRAINT p4_storage_policies_bucket_check CHECK (bucket IN ('workhub-knowledge-files','workhub-document-files'))
);
CREATE TRIGGER p4_storage_policies_immutable BEFORE UPDATE OR DELETE ON workhub_private.p4_storage_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 학교 정책 — P4-04 / P4-05 가 계란님 입력값으로 1행씩 쓴다(예시값을 심지 않는다). 고칠 수 없다.
-- ----------------------------------------------------------------------------
-- 문서함: 학교 공유를 누가 할 수 있는가. off = 아무도(개인 문서만) · school_admin = 학교 관리자만 · all_members = 업무실 사용자 모두
CREATE TABLE workhub.document_policies (
  school_id                 text NOT NULL,
  school_share              text NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT document_policies_pkey PRIMARY KEY (school_id),
  CONSTRAINT document_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT document_policies_share_check CHECK (school_share IN ('off','school_admin','all_members')),
  CONSTRAINT document_policies_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
CREATE TRIGGER document_policies_immutable BEFORE UPDATE OR DELETE ON workhub.document_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 원문 가져오기 · 질문형 양식: 서버 API(extract-knowledge · guided) 배포 확인 기록이 있어야 ready 가 될 수 있다.
CREATE TABLE workhub.knowledge_import_policies (
  school_id                 text NOT NULL,
  max_file_bytes            bigint NOT NULL,
  verification_ref          text NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_import_policies_pkey PRIMARY KEY (school_id),
  CONSTRAINT knowledge_import_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT knowledge_import_policies_bytes_check CHECK (max_file_bytes BETWEEN 1 AND 31457280),
  CONSTRAINT knowledge_import_policies_verification_check CHECK (length(btrim(verification_ref)) BETWEEN 1 AND 200),
  CONSTRAINT knowledge_import_policies_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
CREATE TRIGGER knowledge_import_policies_immutable BEFORE UPDATE OR DELETE ON workhub.knowledge_import_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.guided_policies (
  school_id                 text NOT NULL,
  max_file_bytes            bigint NOT NULL,
  verification_ref          text NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT guided_policies_pkey PRIMARY KEY (school_id),
  CONSTRAINT guided_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT guided_policies_bytes_check CHECK (max_file_bytes BETWEEN 1 AND 31457280),
  CONSTRAINT guided_policies_verification_check CHECK (length(btrim(verification_ref)) BETWEEN 1 AND 200),
  CONSTRAINT guided_policies_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
CREATE TRIGGER guided_policies_immutable BEFORE UPDATE OR DELETE ON workhub.guided_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 요청 원장 — 반영된 요청만 남긴다(확정 거절은 부작용이 없으므로 같은 키로 다시 판정해도 중복이 생기지 않는다)
--    범위 = (학교, 소속, 모듈, 동작, 요청 번호). payload_hash = SHA-256(앱 canonical(명령)).
--    prepare·extract 는 결과 id(result_id)만 묶고 응답은 그때의 원장으로 다시 만든다(uploaded 는 실제 상태).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.content_requests (
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  module        text NOT NULL,
  action        text NOT NULL,
  request_key   text NOT NULL,
  payload_hash  text NOT NULL,
  result_id     text NOT NULL,
  response      jsonb,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT content_requests_pkey PRIMARY KEY (school_id, membership_id, module, action, request_key),
  CONSTRAINT content_requests_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT content_requests_scope_check CHECK ((module, action) IN (('knowledge','mutate'),('knowledge_import','prepare'),('knowledge_import','extract'),
    ('knowledge_import','commit'),('documents','mutate'),('guided','prepare'),('guided','mutate'))),
  CONSTRAINT content_requests_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$'),
  CONSTRAINT content_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT content_requests_response_check CHECK ((action IN ('prepare','extract')) = (response IS NULL)
    AND (response IS NULL OR (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 8192)))
);
CREATE TRIGGER content_requests_immutable BEFORE UPDATE OR DELETE ON workhub.content_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 4. 학교 자료(지식) — 현재 상태 1행 + 판마다 불변 기록. 지우지 않는다(종료는 retired).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.knowledge_files (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  owner_membership_id  text NOT NULL,
  owner_account_id     text NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  name                 text NOT NULL,
  bytes                bigint NOT NULL,
  sha256               text NOT NULL,
  storage_path         text NOT NULL,
  upload_expires_at    timestamptz NOT NULL,
  storage_object_id    uuid,
  state                text NOT NULL DEFAULT 'reserved',
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_files_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_files_school_id_key UNIQUE (school_id, id),
  CONSTRAINT knowledge_files_path_key UNIQUE (storage_path),
  CONSTRAINT knowledge_files_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  -- 파일판은 1 하나다. 다른 원본은 새 fileId 로 올린다(원본판을 교체하지 않는다).
  CONSTRAINT knowledge_files_version_check CHECK (version = 1),
  CONSTRAINT knowledge_files_name_check CHECK (length(name) BETWEEN 6 AND 240 AND lower(name) LIKE '%.hwpx'),
  CONSTRAINT knowledge_files_bytes_check CHECK (bytes BETWEEN 1 AND 31457280),
  CONSTRAINT knowledge_files_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_files_path_check CHECK (storage_path = school_id || '/' || owner_membership_id || '/' || id || '/original.hwpx'),
  CONSTRAINT knowledge_files_state_check CHECK (state IN ('reserved','extracted')),
  CONSTRAINT knowledge_files_object_check CHECK (state = 'reserved' OR storage_object_id IS NOT NULL)
);
CREATE INDEX knowledge_files_owner_idx ON workhub.knowledge_files (school_id, owner_membership_id, created_at);
CREATE FUNCTION workhub_private.p4_knowledge_file_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.school_id <> OLD.school_id OR NEW.owner_membership_id <> OLD.owner_membership_id
     OR NEW.owner_account_id <> OLD.owner_account_id OR NEW.version <> OLD.version OR NEW.name <> OLD.name OR NEW.bytes <> OLD.bytes
     OR NEW.sha256 <> OLD.sha256 OR NEW.storage_path <> OLD.storage_path OR NEW.upload_expires_at <> OLD.upload_expires_at
     OR NEW.created_at <> OLD.created_at
     OR (OLD.storage_object_id IS NOT NULL AND NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id)
     OR (OLD.state = 'extracted' AND NEW.state <> 'extracted') THEN
    RAISE EXCEPTION 'P4_FILE_IMMUTABLE' USING DETAIL = '원본 파일의 정체성(경로·크기·해시·고정한 실물)은 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_files_guard BEFORE UPDATE ON workhub.knowledge_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p4_knowledge_file_guard();
CREATE TRIGGER knowledge_files_no_delete BEFORE DELETE ON workhub.knowledge_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 추출 임대: 1회용 token(해시만 저장) · 고정한 실물 id · 120초
CREATE TABLE workhub.knowledge_file_leases (
  id                text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id         text NOT NULL,
  file_id           text NOT NULL,
  account_id        text NOT NULL,
  membership_id     text NOT NULL,
  token_sha256      text NOT NULL,
  request_key       text NOT NULL,
  storage_object_id uuid NOT NULL,
  state             text NOT NULL DEFAULT 'issued',
  issued_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at        timestamptz NOT NULL,
  closed_at         timestamptz,
  CONSTRAINT knowledge_file_leases_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_file_leases_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.knowledge_files(school_id, id),
  CONSTRAINT knowledge_file_leases_token_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_file_leases_state_check CHECK (state IN ('issued','expired','finished')),
  CONSTRAINT knowledge_file_leases_closed_check CHECK ((state = 'issued') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX knowledge_file_leases_one_issued ON workhub.knowledge_file_leases (file_id) WHERE state = 'issued';
CREATE INDEX knowledge_file_leases_account_idx ON workhub.knowledge_file_leases (account_id, issued_at);
CREATE TRIGGER knowledge_file_leases_identity BEFORE UPDATE ON workhub.knowledge_file_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','file_id','account_id','membership_id','token_sha256','request_key','storage_object_id','issued_at','expires_at');
CREATE TRIGGER knowledge_file_leases_no_delete BEFORE DELETE ON workhub.knowledge_file_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 서버가 확정한 추출문(파일 1개당 1행, 불변). result = 서버 API 가 받은 ImportResult 그대로.
CREATE TABLE workhub.knowledge_extractions (
  file_id           text NOT NULL,
  school_id         text NOT NULL,
  file_version      integer NOT NULL,
  profile           text NOT NULL,
  file_sha256       text NOT NULL,
  extraction_sha256 text NOT NULL,
  block_count       integer NOT NULL,
  omitted_objects   integer NOT NULL,
  result            jsonb NOT NULL,
  storage_object_id uuid NOT NULL,
  lease_id          text NOT NULL,
  request_key       text NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_extractions_pkey PRIMARY KEY (file_id),
  CONSTRAINT knowledge_extractions_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.knowledge_files(school_id, id),
  CONSTRAINT knowledge_extractions_lease_fkey FOREIGN KEY (lease_id) REFERENCES workhub.knowledge_file_leases(id),
  CONSTRAINT knowledge_extractions_profile_check CHECK (profile = 'hwpx_text_v1'),
  CONSTRAINT knowledge_extractions_sha_check CHECK (file_sha256 ~ '^[0-9a-f]{64}$' AND extraction_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT knowledge_extractions_count_check CHECK (block_count BETWEEN 1 AND 1500 AND omitted_objects >= 0),
  CONSTRAINT knowledge_extractions_result_check CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 2097152)
);
CREATE TRIGGER knowledge_extractions_immutable BEFORE UPDATE OR DELETE ON workhub.knowledge_extractions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.knowledge_sources (
  id                    text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id             text NOT NULL,
  author_membership_id  text NOT NULL,
  author_account_id     text NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  status                text NOT NULL DEFAULT 'draft',
  title                 text NOT NULL,
  kind                  text NOT NULL,
  body                  text NOT NULL,
  locator               text NOT NULL,
  effective_from        date NOT NULL,
  effective_through     date,
  origin_file_id        text,
  created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_sources_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_sources_school_id_key UNIQUE (school_id, id),
  CONSTRAINT knowledge_sources_author_fkey FOREIGN KEY (school_id, author_membership_id, author_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT knowledge_sources_origin_fkey FOREIGN KEY (school_id, origin_file_id) REFERENCES workhub.knowledge_files(school_id, id),
  -- 원본 파일 1개는 학교 자료 하나에만 이어진다(같은 원본으로 초안이 여러 개 생기지 않게).
  CONSTRAINT knowledge_sources_origin_key UNIQUE (origin_file_id),
  CONSTRAINT knowledge_sources_status_check CHECK (status IN ('draft','published','retired')),
  CONSTRAINT knowledge_sources_kind_check CHECK (kind IN ('regulation','annual_plan','school_guide','other')),
  CONSTRAINT knowledge_sources_text_check CHECK (length(title) BETWEEN 1 AND 200 AND length(body) BETWEEN 1 AND 100000 AND length(locator) BETWEEN 1 AND 500),
  CONSTRAINT knowledge_sources_period_check CHECK (effective_through IS NULL OR effective_through >= effective_from),
  CONSTRAINT knowledge_sources_version_check CHECK (version >= 1)
);
CREATE INDEX knowledge_sources_list_idx ON workhub.knowledge_sources (school_id, updated_at DESC, id);
CREATE TRIGGER knowledge_sources_identity BEFORE UPDATE ON workhub.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','author_membership_id','author_account_id','origin_file_id','created_at');
CREATE TRIGGER knowledge_sources_no_delete BEFORE DELETE ON workhub.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 판 기록: 만들기·수정·게시·종료마다 1행. 원본 파일 연결(file_id·추출 hash)은 그 판 당시 값을 남긴다.
CREATE TABLE workhub.knowledge_source_revisions (
  source_id            text NOT NULL,
  version              integer NOT NULL,
  school_id            text NOT NULL,
  status               text NOT NULL,
  title                text NOT NULL,
  kind                 text NOT NULL,
  body                 text NOT NULL,
  locator              text NOT NULL,
  effective_from       date NOT NULL,
  effective_through    date,
  action               text NOT NULL,
  reason               text,
  file_id              text,
  file_version         integer,
  extraction_sha256    text,
  actor_membership_id  text NOT NULL,
  actor_account_id     text NOT NULL,
  request_key          text NOT NULL,
  recorded_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_source_revisions_pkey PRIMARY KEY (source_id, version),
  CONSTRAINT knowledge_source_revisions_source_fkey FOREIGN KEY (school_id, source_id) REFERENCES workhub.knowledge_sources(school_id, id),
  CONSTRAINT knowledge_source_revisions_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.knowledge_files(school_id, id),
  CONSTRAINT knowledge_source_revisions_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT knowledge_source_revisions_action_check CHECK (action IN ('create','import','update','publish','retire')),
  CONSTRAINT knowledge_source_revisions_status_check CHECK (status IN ('draft','published','retired')),
  CONSTRAINT knowledge_source_revisions_file_check CHECK ((file_id IS NULL) = (file_version IS NULL) AND (file_id IS NULL) = (extraction_sha256 IS NULL)),
  CONSTRAINT knowledge_source_revisions_reason_check CHECK ((action IN ('publish','retire')) = (reason IS NOT NULL) AND (reason IS NULL OR length(reason) BETWEEN 1 AND 1000))
);
CREATE TRIGGER knowledge_source_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.knowledge_source_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 5. 문서함 — 현재 상태 1행 + 판마다 불변 기록. 보관함 이동도 지우지 않는다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.documents (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  owner_membership_id text NOT NULL,
  owner_account_id    text NOT NULL,
  latest_version      integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'draft',
  visibility          text NOT NULL,
  origin_document_id  text,
  origin_version      integer,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_school_id_key UNIQUE (school_id, id),
  CONSTRAINT documents_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT documents_origin_fkey FOREIGN KEY (school_id, origin_document_id) REFERENCES workhub.documents(school_id, id),
  CONSTRAINT documents_status_check CHECK (status IN ('draft','confirmed','archived')),
  CONSTRAINT documents_visibility_check CHECK (visibility IN ('private','school')),
  CONSTRAINT documents_origin_check CHECK ((origin_document_id IS NULL) = (origin_version IS NULL) AND (origin_version IS NULL OR origin_version >= 1)),
  CONSTRAINT documents_version_check CHECK (latest_version >= 1)
);
CREATE INDEX documents_owner_idx ON workhub.documents (school_id, owner_membership_id, updated_at DESC, id);
CREATE INDEX documents_shared_idx ON workhub.documents (school_id, updated_at DESC, id) WHERE visibility = 'school';
CREATE TRIGGER documents_identity BEFORE UPDATE ON workhub.documents
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','owner_membership_id','owner_account_id','origin_document_id','origin_version','created_at');
CREATE TRIGGER documents_no_delete BEFORE DELETE ON workhub.documents
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.document_versions (
  document_id         text NOT NULL,
  version             integer NOT NULL,
  school_id           text NOT NULL,
  status              text NOT NULL,
  visibility          text NOT NULL,
  title               text NOT NULL,
  kind                text NOT NULL,
  body                text NOT NULL,
  sources             jsonb NOT NULL,
  basis_date          date NOT NULL,
  student_context     jsonb,
  action              text NOT NULL,
  actor_membership_id text NOT NULL,
  actor_account_id    text NOT NULL,
  request_key         text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT document_versions_pkey PRIMARY KEY (document_id, version),
  CONSTRAINT document_versions_document_fkey FOREIGN KEY (school_id, document_id) REFERENCES workhub.documents(school_id, id),
  CONSTRAINT document_versions_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT document_versions_status_check CHECK (status IN ('draft','confirmed','archived')),
  CONSTRAINT document_versions_visibility_check CHECK (visibility IN ('private','school')),
  CONSTRAINT document_versions_kind_check CHECK (kind IN ('parent_letter','event_plan','event_report','rubric','general','student_record')),
  CONSTRAINT document_versions_text_check CHECK (length(title) BETWEEN 1 AND 200 AND length(body) BETWEEN 1 AND 100000),
  CONSTRAINT document_versions_sources_check CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 100),
  -- 학생 기록 초안 ⇔ 학생 맥락, 그리고 언제나 나만 보기
  CONSTRAINT document_versions_student_check CHECK ((kind = 'student_record') = (student_context IS NOT NULL)
    AND (student_context IS NULL OR visibility = 'private')),
  CONSTRAINT document_versions_action_check CHECK (action IN ('create','update','confirm','archive'))
);
CREATE TRIGGER document_versions_immutable BEFORE UPDATE OR DELETE ON workhub.document_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 질문형 양식 — 원본 HWPX(전용 버킷) · 분석 결과 · 질문 매핑 · 답변 · 생성 파일
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.guided_templates (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  owner_membership_id  text NOT NULL,
  owner_account_id     text NOT NULL,
  title                text NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  state                text NOT NULL DEFAULT 'draft',
  source_name          text NOT NULL,
  source_bytes         bigint NOT NULL,
  source_sha256        text NOT NULL,
  source_path          text NOT NULL,
  upload_expires_at    timestamptz NOT NULL,
  source_object_id     uuid,
  inspection           jsonb,
  mapping              jsonb,
  collection_id        text,
  collection_version   integer,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at         timestamptz,
  CONSTRAINT guided_templates_pkey PRIMARY KEY (id),
  CONSTRAINT guided_templates_school_id_key UNIQUE (school_id, id),
  CONSTRAINT guided_templates_path_key UNIQUE (source_path),
  CONSTRAINT guided_templates_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT guided_templates_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT guided_templates_state_check CHECK (state IN ('draft','published')),
  CONSTRAINT guided_templates_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT guided_templates_name_check CHECK (length(source_name) BETWEEN 6 AND 240 AND lower(source_name) LIKE '%.hwpx'),
  CONSTRAINT guided_templates_bytes_check CHECK (source_bytes BETWEEN 1 AND 31457280),
  CONSTRAINT guided_templates_sha_check CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT guided_templates_path_check CHECK (source_path = school_id || '/' || owner_membership_id || '/' || id || '/source.hwpx'),
  CONSTRAINT guided_templates_mapping_check CHECK (mapping IS NULL OR inspection IS NOT NULL),
  CONSTRAINT guided_templates_published_check CHECK ((state = 'published') = (published_at IS NOT NULL)
    AND (state = 'draft' OR (mapping IS NOT NULL AND collection_id IS NOT NULL AND collection_version IS NOT NULL)))
);
-- 수합 1건에는 게시된 양식 하나만 잇는다(대상 교사가 어느 양식으로 낼지 헷갈리지 않게).
CREATE UNIQUE INDEX guided_templates_one_per_collection ON workhub.guided_templates (collection_id) WHERE state = 'published';
CREATE INDEX guided_templates_owner_idx ON workhub.guided_templates (school_id, owner_membership_id, updated_at DESC, id);
CREATE FUNCTION workhub_private.p4_template_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.school_id <> OLD.school_id OR NEW.owner_membership_id <> OLD.owner_membership_id
     OR NEW.owner_account_id <> OLD.owner_account_id OR NEW.source_name <> OLD.source_name OR NEW.source_bytes <> OLD.source_bytes
     OR NEW.source_sha256 <> OLD.source_sha256 OR NEW.source_path <> OLD.source_path OR NEW.upload_expires_at <> OLD.upload_expires_at
     OR NEW.created_at <> OLD.created_at
     OR (OLD.source_object_id IS NOT NULL AND NEW.source_object_id IS DISTINCT FROM OLD.source_object_id)
     OR (OLD.inspection IS NOT NULL AND NEW.inspection IS DISTINCT FROM OLD.inspection)
     OR NEW.version < OLD.version
     -- 게시판은 불변이다. 개정은 새 양식으로 만든다.
     OR (OLD.state = 'published' AND (NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'P4_TEMPLATE_IMMUTABLE' USING DETAIL = '양식 원본·분석 결과와 게시된 양식은 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guided_templates_guard BEFORE UPDATE ON workhub.guided_templates
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p4_template_guard();
CREATE TRIGGER guided_templates_no_delete BEFORE DELETE ON workhub.guided_templates
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 양식 판 기록(만들기·매핑 저장·게시). 게시판이 무엇이었는지 나중에도 보인다.
CREATE TABLE workhub.guided_template_versions (
  template_id         text NOT NULL,
  version             integer NOT NULL,
  school_id           text NOT NULL,
  state               text NOT NULL,
  title               text NOT NULL,
  mapping             jsonb,
  collection_id       text,
  collection_version  integer,
  action              text NOT NULL,
  actor_membership_id text NOT NULL,
  actor_account_id    text NOT NULL,
  request_key         text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT guided_template_versions_pkey PRIMARY KEY (template_id, version),
  CONSTRAINT guided_template_versions_template_fkey FOREIGN KEY (school_id, template_id) REFERENCES workhub.guided_templates(school_id, id),
  CONSTRAINT guided_template_versions_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT guided_template_versions_action_check CHECK (action IN ('create','save_mapping','publish')),
  CONSTRAINT guided_template_versions_state_check CHECK (state IN ('draft','published'))
);
CREATE TRIGGER guided_template_versions_immutable BEFORE UPDATE OR DELETE ON workhub.guided_template_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 답변: (양식, 양식판, 교사) 하나. 초안 양식판은 담당자의 시험 답변(preview)만, 게시판은 대상 교사의 실제 답변만.
CREATE TABLE workhub.guided_responses (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  template_id          text NOT NULL,
  template_version     integer NOT NULL,
  owner_membership_id  text NOT NULL,
  owner_account_id     text NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  answers              jsonb NOT NULL,
  preview              boolean NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT guided_responses_pkey PRIMARY KEY (id),
  CONSTRAINT guided_responses_school_id_key UNIQUE (school_id, id),
  CONSTRAINT guided_responses_one_key UNIQUE (template_id, template_version, owner_membership_id),
  CONSTRAINT guided_responses_template_fkey FOREIGN KEY (school_id, template_id) REFERENCES workhub.guided_templates(school_id, id),
  CONSTRAINT guided_responses_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT guided_responses_answers_check CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT guided_responses_version_check CHECK (version >= 1 AND template_version >= 1)
);
CREATE TRIGGER guided_responses_identity BEFORE UPDATE ON workhub.guided_responses
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','template_id','template_version','owner_membership_id','owner_account_id','preview','created_at');
CREATE TRIGGER guided_responses_no_delete BEFORE DELETE ON workhub.guided_responses
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.guided_response_versions (
  response_id  text NOT NULL,
  version      integer NOT NULL,
  school_id    text NOT NULL,
  answers      jsonb NOT NULL,
  request_key  text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT guided_response_versions_pkey PRIMARY KEY (response_id, version),
  CONSTRAINT guided_response_versions_response_fkey FOREIGN KEY (school_id, response_id) REFERENCES workhub.guided_responses(school_id, id)
);
CREATE TRIGGER guided_response_versions_immutable BEFORE UPDATE OR DELETE ON workhub.guided_response_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 서버 작업(분석 inspect · 생성 render) 원장: (학교, 소속, 동작, 요청 번호) 하나. 원본 실물·출력 위치를 처음에 고정한다.
CREATE TABLE workhub.guided_operations (
  id                 text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id          text NOT NULL,
  membership_id      text NOT NULL,
  account_id         text NOT NULL,
  action             text NOT NULL,
  request_key        text NOT NULL,
  template_id        text NOT NULL,
  template_version   integer NOT NULL,
  response_id        text,
  response_version   integer,
  source_object_id   uuid NOT NULL,
  artifact_id        text,
  artifact_path      text,
  state              text NOT NULL DEFAULT 'pending',
  result             jsonb,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at       timestamptz,
  CONSTRAINT guided_operations_pkey PRIMARY KEY (id),
  CONSTRAINT guided_operations_key UNIQUE (school_id, membership_id, action, request_key),
  CONSTRAINT guided_operations_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT guided_operations_template_fkey FOREIGN KEY (school_id, template_id) REFERENCES workhub.guided_templates(school_id, id),
  CONSTRAINT guided_operations_response_fkey FOREIGN KEY (school_id, response_id) REFERENCES workhub.guided_responses(school_id, id),
  CONSTRAINT guided_operations_action_check CHECK (action IN ('inspect','render')),
  CONSTRAINT guided_operations_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$'),
  CONSTRAINT guided_operations_shape_check CHECK (CASE action
    WHEN 'inspect' THEN response_id IS NULL AND response_version IS NULL AND artifact_id IS NULL AND artifact_path IS NULL
    ELSE response_id IS NOT NULL AND response_version >= 1 AND artifact_id IS NOT NULL
      AND artifact_path = school_id || '/' || membership_id || '/' || artifact_id || '/output.hwpx' END),
  CONSTRAINT guided_operations_state_check CHECK (state IN ('pending','completed') AND (state = 'completed') = (result IS NOT NULL)
    AND (state = 'completed') = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX guided_operations_artifact_key ON workhub.guided_operations (artifact_id) WHERE artifact_id IS NOT NULL;
CREATE FUNCTION workhub_private.p4_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (to_jsonb(NEW) - 'state' - 'result' - 'completed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'result' - 'completed_at')
     OR OLD.state = 'completed' THEN
    RAISE EXCEPTION 'P4_OPERATION_IMMUTABLE' USING DETAIL = '서버 작업의 원래 키·대상·확정 결과는 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guided_operations_guard BEFORE UPDATE ON workhub.guided_operations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p4_operation_guard();
CREATE TRIGGER guided_operations_no_delete BEFORE DELETE ON workhub.guided_operations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.guided_leases (
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id     text NOT NULL,
  operation_id  text NOT NULL,
  account_id    text NOT NULL,
  token_sha256  text NOT NULL,
  state         text NOT NULL DEFAULT 'issued',
  issued_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at    timestamptz NOT NULL,
  closed_at     timestamptz,
  CONSTRAINT guided_leases_pkey PRIMARY KEY (id),
  CONSTRAINT guided_leases_operation_fkey FOREIGN KEY (operation_id) REFERENCES workhub.guided_operations(id),
  CONSTRAINT guided_leases_token_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT guided_leases_state_check CHECK (state IN ('issued','expired','finished')),
  CONSTRAINT guided_leases_closed_check CHECK ((state = 'issued') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX guided_leases_one_issued ON workhub.guided_leases (operation_id) WHERE state = 'issued';
CREATE INDEX guided_leases_account_idx ON workhub.guided_leases (account_id, issued_at);
CREATE TRIGGER guided_leases_identity BEFORE UPDATE ON workhub.guided_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','operation_id','account_id','token_sha256','issued_at','expires_at');
CREATE TRIGGER guided_leases_no_delete BEFORE DELETE ON workhub.guided_leases
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 생성 파일: 서버가 전용 버킷에 올리고 finish 가 실물 id 와 함께 고정한다(불변).
CREATE TABLE workhub.guided_artifacts (
  id                   text NOT NULL,
  school_id            text NOT NULL,
  owner_membership_id  text NOT NULL,
  owner_account_id     text NOT NULL,
  template_id          text NOT NULL,
  template_version     integer NOT NULL,
  response_id          text NOT NULL,
  response_version     integer NOT NULL,
  operation_id         text NOT NULL,
  storage_path         text NOT NULL,
  storage_object_id    uuid NOT NULL,
  bytes                bigint NOT NULL,
  sha256               text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT guided_artifacts_pkey PRIMARY KEY (id),
  CONSTRAINT guided_artifacts_school_id_key UNIQUE (school_id, id),
  CONSTRAINT guided_artifacts_operation_key UNIQUE (operation_id),
  CONSTRAINT guided_artifacts_path_key UNIQUE (storage_path),
  CONSTRAINT guided_artifacts_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT guided_artifacts_response_fkey FOREIGN KEY (school_id, response_id) REFERENCES workhub.guided_responses(school_id, id),
  CONSTRAINT guided_artifacts_operation_fkey FOREIGN KEY (operation_id) REFERENCES workhub.guided_operations(id),
  CONSTRAINT guided_artifacts_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT guided_artifacts_path_check CHECK (storage_path = school_id || '/' || owner_membership_id || '/' || id || '/output.hwpx'),
  CONSTRAINT guided_artifacts_bytes_check CHECK (bytes BETWEEN 1 AND 31457280),
  CONSTRAINT guided_artifacts_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX guided_artifacts_response_idx ON workhub.guided_artifacts (response_id, response_version, created_at DESC);
CREATE TRIGGER guided_artifacts_immutable BEFORE UPDATE OR DELETE ON workhub.guided_artifacts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. 공통 내부 함수 — 봉투 · 입력 판정 (앱 services/scoped-rpc.ts 와 같은 규칙)
-- ----------------------------------------------------------------------------
-- 성공 {contract, schoolId, memberId, data} · 업무 거절 {contract, schoolId, memberId, error:{code}} (정확히 이 키만)
CREATE FUNCTION workhub_private.p4_ok(p_ctx workhub_private.actor_context, p_contract text, p_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', p_contract, 'schoolId', p_ctx.school_id, 'memberId', p_ctx.membership_id, 'data', p_data)
$$;
CREATE FUNCTION workhub_private.p4_err(p_ctx workhub_private.actor_context, p_contract text, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', p_contract, 'schoolId', p_ctx.school_id, 'memberId', p_ctx.membership_id,
                            'error', jsonb_build_object('code', p_code))
$$;
-- 봉투로 돌려줄 업무 코드. 서버 API 가 받는 claim·finish 에는 RESULT_UNKNOWN 을 쓰지 않는다(그쪽은 pending 상태로 답한다).
CREATE FUNCTION workhub_private.p4_business(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_code IN ('NOT_READY','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','RESULT_UNKNOWN')
$$;

-- 앱 text(): 문자열 · 코드포인트 길이(Array.from) · (required 면) 공백뿐 아님 · 제어문자(탭·줄바꿈·CR 제외)와 DEL 없음
CREATE FUNCTION workhub_private.p4_text(p jsonb, p_max integer, p_required boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(p #>> '{}') <= p_max
     AND (NOT p_required OR workhub_private.js_trim(p #>> '{}') <> '')
     AND (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
$$;
-- 앱 identifier(): 영문·숫자·_- 1~100자
CREATE FUNCTION workhub_private.p4_id(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[a-zA-Z0-9_-]{1,100}$'
$$;
-- 요청 번호: 앱은 쓰기 때 8자 이상을 요구하고 실제로는 '종류-uuid' 를 쓴다. 서버는 영문·숫자·_- 8~200자만 받는다.
CREATE FUNCTION workhub_private.p4_key(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND p ~ '^[A-Za-z0-9_-]{8,200}$'
$$;
CREATE FUNCTION workhub_private.p4_sha(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[0-9a-f]{64}$'
$$;
-- 앱 version(): 안전한 양의 정수(DB 는 integer 범위까지)
CREATE FUNCTION workhub_private.p4_pos(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_int(p, 1, 2147483647)
$$;
-- 앱 isoDate(): YYYY-MM-DD 이고 실제 날짜(윤년 포함)여야 한다
CREATE FUNCTION workhub_private.p4_date(p jsonb) RETURNS boolean
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
-- 앱 timestamp 형식(…Z, 밀리초)
CREATE FUNCTION workhub_private.p4_ts(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION workhub_private.p4_day(p date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p, 'YYYY-MM-DD')
$$;
-- ILIKE 용 검색어(%, _, \ 를 글자 그대로)
CREATE FUNCTION workhub_private.p4_like(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '%' || replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
-- 위치 값: 서버가 만든 JSON 을 16진으로. 소속·필터 지문을 넣어 다른 소속·다른 필터에서 쓰지 못하게 한다.
CREATE FUNCTION workhub_private.p4_cursor_out(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(convert_to(p::text, 'UTF8'), 'hex')
$$;
CREATE FUNCTION workhub_private.p4_cursor_in(p text, p_fhash text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF length(p) > 2000 OR p !~ '^[0-9a-f]+$' OR length(p) % 2 <> 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN
    v := convert_from(decode(p, 'hex'), 'UTF8')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF jsonb_typeof(v) <> 'object' OR v ->> 'f' IS DISTINCT FROM p_fhash
     OR jsonb_typeof(v -> 't') IS DISTINCT FROM 'string' OR jsonb_typeof(v -> 'i') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  BEGIN
    PERFORM (v ->> 't')::timestamptz;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  RETURN v;
END $$;
-- 앱 파일 이름 규칙(import-adapter·guided-adapter): .hwpx · 240자 이하 · 경로·제어 문자 없음. 서버는 앞뒤 공백·방향 제어·예약 이름도 막는다.
CREATE FUNCTION workhub_private.p4_file_name(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND workhub_private.js_trim(p #>> '{}') = (p #>> '{}')
     AND length(p #>> '{}') BETWEEN 6 AND 240
     AND (p #>> '{}') ~* '\.hwpx$'
     AND (p #>> '{}') !~ '[\x01-\x1f\x7f<>:"/\\|?*‪-‮⁦-⁩]'
     AND btrim(replace(left(p #>> '{}', -5), '.', '')) <> ''
     AND (p #>> '{}') !~* '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'
$$;
-- 같은 (학교, 소속, 종류, 요청 번호) 의 동시 실행을 한 줄로 세운다
CREATE FUNCTION workhub_private.p4_lock(p_ctx workhub_private.actor_context, p_kind text, p_key text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('p4' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.membership_id
                                                || chr(31) || p_kind || chr(31) || p_key, 0))
$$;
-- 순수 조회용: 같은 키를 지금 처리 중인 트랜잭션이 있으면 false(→ RESULT_UNKNOWN). 아무것도 쓰지 않는다.
CREATE FUNCTION workhub_private.p4_idle(p_ctx workhub_private.actor_context, p_kind text, p_key text) RETURNS boolean
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_try_advisory_xact_lock(hashtextextended('p4' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.membership_id
                                                    || chr(31) || p_kind || chr(31) || p_key, 0))
$$;
-- 1회용 임대 token(영문·숫자 64자). 원장에는 해시만 남긴다.
CREATE FUNCTION workhub_private.p4_token() RETURNS text
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;
CREATE FUNCTION workhub_private.p4_token_hash(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

-- ----------------------------------------------------------------------------
-- 8. 준비 상태
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p4_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p4_installs WHERE batch IN ('P4-01','P4-02') AND release = '2026-10-16.1') = 2
$$;

-- 다른 버킷으로 한정된 정책식인가(R1 c_other_bucket 과 같은 모양 판정, 대상 버킷만 다름). 판정 못 하면 안전하지 않은 것으로 본다.
CREATE FUNCTION workhub_private.p4_other_bucket(p_expr text, p_bucket text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_expr IS NOT NULL
     AND (p_expr ~ '^\(bucket_id = ''[^'']*''::text\)$' OR p_expr ~ '^\(\(bucket_id = ''[^'']*''::text\) AND ')
     AND substring(p_expr FROM '^\(+bucket_id = ''([^'']*)''::text\)') <> p_bucket
$$;

-- Storage 준비: 비공개 버킷 · RLS 켜짐 · 이 배치의 그 버킷 정책 2개가 그대로 · 다른 permissive 정책이 이 버킷을 열지 않음
CREATE FUNCTION workhub_private.p4_storage_ok(p_bucket text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rel oid := to_regclass('storage.objects'); p record; v_api oid[];
BEGIN
  IF v_rel IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND name = p_bucket AND public IS FALSE) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolbypassrls OR rolsuper)) THEN RETURN false; END IF;
  v_api := ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'));
  IF (SELECT count(*) FROM pg_policy pol JOIN workhub_private.p4_storage_policies e ON e.policy_name = pol.polname
       WHERE e.bucket = p_bucket AND pol.polrelid = v_rel AND pol.polcmd = e.cmd AND pol.polpermissive
         AND pol.polroles = ARRAY(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
         AND md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = e.expr_md5) <> 2 THEN
    RETURN false;
  END IF;
  FOR p IN SELECT pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
             FROM pg_policy pol
            WHERE pol.polrelid = v_rel AND pol.polpermissive
              AND pol.polname NOT IN (SELECT policy_name FROM workhub_private.p4_storage_policies WHERE bucket = p_bucket)
              AND (0::oid = ANY (pol.polroles) OR pol.polroles && v_api) LOOP
    IF (p.polcmd IN ('r','w','d','*') AND NOT workhub_private.p4_other_bucket(p.q, p_bucket))
       OR (p.polcmd IN ('a','*') AND p.w IS NOT NULL AND NOT workhub_private.p4_other_bucket(p.w, p_bucket))
       OR (p.polcmd = 'a' AND NOT workhub_private.p4_other_bucket(p.w, p_bucket))
       OR (p.polcmd = 'w' AND p.w IS NOT NULL AND NOT workhub_private.p4_other_bucket(p.w, p_bucket)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 모듈 준비 사유: ready · database_missing · disabled(중지) · storage_missing · policy_missing(활성화·정책 없음, 원문 가져오기는 학교 자료도 켜져야 함)
CREATE FUNCTION workhub_private.p4_reason(p_school text, p_module text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  IF NOT workhub_private.p4_installed() THEN RETURN 'database_missing'; END IF;
  SELECT state INTO v_state FROM workhub.module_activations WHERE school_id = p_school AND module = p_module;
  IF v_state = 'stopped' THEN RETURN 'disabled'; END IF;
  IF p_module = 'knowledge_import' AND NOT workhub_private.p4_storage_ok('workhub-knowledge-files') THEN RETURN 'storage_missing'; END IF;
  IF p_module = 'guided' AND NOT workhub_private.p4_storage_ok('workhub-document-files') THEN RETURN 'storage_missing'; END IF;
  IF v_state IS DISTINCT FROM 'active'
     OR (p_module = 'documents' AND NOT EXISTS (SELECT 1 FROM workhub.document_policies WHERE school_id = p_school))
     OR (p_module = 'knowledge_import' AND NOT EXISTS (SELECT 1 FROM workhub.knowledge_import_policies WHERE school_id = p_school))
     OR (p_module = 'guided' AND NOT EXISTS (SELECT 1 FROM workhub.guided_policies WHERE school_id = p_school)) THEN
    RETURN 'policy_missing';
  END IF;
  IF p_module = 'knowledge_import' AND workhub_private.p4_reason(p_school, 'knowledge') <> 'ready' THEN RETURN 'policy_missing'; END IF;
  RETURN 'ready';
END $$;
CREATE FUNCTION workhub_private.p4_ready(p_school text, p_module text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p4_reason(p_school, p_module) = 'ready'
$$;

-- 지식 관리 권한: 학교 관리자(R0 의 year.manage 를 가진 학교 범위 역할). 새 권한을 만들지 않았다(P4_설계결정 D-P4-1).
CREATE FUNCTION workhub_private.p4_knowledge_manager(p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.member_has_perm(p_ctx, 'year.manage')
$$;
-- 문서 학교 공유 권한: 문서함 정책(P4-04 입력)이 정한다
CREATE FUNCTION workhub_private.p4_can_share(p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT CASE dp.school_share WHEN 'all_members' THEN true
                                                WHEN 'school_admin' THEN workhub_private.member_has_perm(p_ctx, 'year.manage')
                                                ELSE false END
                     FROM workhub.document_policies dp WHERE dp.school_id = p_ctx.school_id), false)
$$;

-- 서버 API 의 사람 주체(P3 p3_service_member 와 같은 방법, P3 가 없어도 동작하도록 이 배치에 따로 둔다)
--   service_role 이고 사람 JWT 가 실리지 않은 요청만. API 가 확인한 UID 로 이 트랜잭션 안에서만 요청 주체를 바꿔
--   기존 승인 gate·소속 확인(member_actor, 잠금 포함)을 그대로 통과해야 한다. 끝나면 원래 값으로 되돌린다.
CREATE FUNCTION workhub_private.p4_service_member(p_actor uuid, p_member text) RETURNS workhub_private.actor_context
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
-- 9. 권한 — 새 표는 RLS 켜고 API 역할 권한 0. 새 내부 함수도 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p4_installs','workhub_private.p4_storage_policies','workhub.document_policies',
      'workhub.knowledge_import_policies','workhub.guided_policies','workhub.content_requests','workhub.knowledge_files',
      'workhub.knowledge_file_leases','workhub.knowledge_extractions','workhub.knowledge_sources','workhub.knowledge_source_revisions',
      'workhub.documents','workhub.document_versions','workhub.guided_templates','workhub.guided_template_versions','workhub.guided_responses',
      'workhub.guided_response_versions','workhub.guided_operations','workhub.guided_leases','workhub.guided_artifacts'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p4\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

INSERT INTO workhub_private.p4_installs (batch, release) VALUES ('P4-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 10. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
WITH t(n) AS (VALUES ('workhub_private.p4_installs'),('workhub_private.p4_storage_policies'),('workhub.document_policies'),
  ('workhub.knowledge_import_policies'),('workhub.guided_policies'),('workhub.content_requests'),('workhub.knowledge_files'),
  ('workhub.knowledge_file_leases'),('workhub.knowledge_extractions'),('workhub.knowledge_sources'),('workhub.knowledge_source_revisions'),
  ('workhub.documents'),('workhub.document_versions'),('workhub.guided_templates'),('workhub.guided_template_versions'),('workhub.guided_responses'),
  ('workhub.guided_response_versions'),('workhub.guided_operations'),('workhub.guided_leases'),('workhub.guided_artifacts'))
SELECT 'P4-01-1' AS no, '새 표 19개 + 적용 기록 · RLS 켜짐 · API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 20 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
                             OR has_table_privilege('service_role', c.oid, 'SELECT')) THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM t JOIN pg_class c ON c.oid = to_regclass(t.n)
UNION ALL
SELECT 'P4-01-2', '자료·문서·양식 활성화 0개', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.module_activations WHERE module IN ('knowledge','knowledge_import','documents','guided')
UNION ALL
SELECT 'P4-01-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p4\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P4-01-4', '적용 기록 P4-01', CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p4_installs WHERE batch = 'P4-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
