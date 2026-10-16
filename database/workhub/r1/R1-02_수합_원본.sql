-- ============================================================================
-- R1-02  문서 수합 원본 — 요청·문항판·대상·단위·공동 초안·제출판·검토·보완·철회·정정창
--
-- 요청서: docs/workhub/32-collection-server-sql-request.md (PR #34) §4·§7
-- 설계 근거: R1_설계결정.md · R1_제약처분표.md
--
-- ▣ 지키는 것
--   - 표·제약·트리거만 만든다. 자료를 넣지 않고, R0 표와 기존 public·auth 를 건드리지 않는다.
--   - 게시된 문항판·대상 명단·제출판·검토·철회·정정창은 기록 뒤 고치지 않는다(트리거로 막는다).
--   - 단위의 현재판/완료본 포인터는 같은 단위의 제출판만 가리킨다(복합 FK).
--
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
--   마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: R1-01 (같은 판).
-- ============================================================================
BEGIN;

DO $$
BEGIN
  -- 표가 없을 때 아래 질의가 계획 단계에서 실패하지 않도록 존재 확인을 먼저 따로 한다
  IF to_regclass('workhub_private.batch_installs') IS NULL THEN
    RAISE EXCEPTION 'R1 중단: R1-01(2026-10-15.1)이 적용되어 있지 않습니다. R1-00 으로 상태를 확인해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.batch_installs WHERE batch = 'R1-01' AND release = '2026-10-15.1') THEN
    RAISE EXCEPTION 'R1 중단: R1-01(2026-10-15.1)이 적용되어 있지 않습니다. R1-00 으로 상태를 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.batch_installs WHERE batch = 'R1-02') OR to_regclass('workhub.collections') IS NOT NULL THEN
    RAISE EXCEPTION 'R1 중단: R1-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
END $$;

-- CHECK 에서 쓰는 키 집합 비교(CHECK 는 하위 질의를 쓸 수 없다). p_keys 는 정렬된 목록.
CREATE FUNCTION workhub_private.json_keys_are(v jsonb, p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(v) = 'object' AND ARRAY(SELECT k FROM jsonb_object_keys(v) k ORDER BY k) = p_keys
$$;

-- 게시 전(draft)에만 고칠 수 있는 하위 행: 부모 수합이 draft 인지 확인한다.
CREATE FUNCTION workhub_private.collection_draft_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_state text; v_school text; v_collection text;
BEGIN
  v_school := CASE WHEN TG_OP = 'DELETE' THEN OLD.school_id ELSE NEW.school_id END;
  v_collection := CASE WHEN TG_OP = 'DELETE' THEN OLD.collection_id ELSE NEW.collection_id END;
  IF TG_OP = 'UPDATE' AND (NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.collection_id IS DISTINCT FROM OLD.collection_id) THEN
    RAISE EXCEPTION 'IMMUTABLE_IDENTITY' USING DETAIL = format('%s 의 수합 연결은 바꿀 수 없습니다.', TG_TABLE_NAME);
  END IF;
  SELECT state INTO v_state FROM workhub.collections WHERE school_id = v_school AND id = v_collection;
  IF v_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = format('게시된 수합의 %s 는 바꿀 수 없습니다.', TG_TABLE_NAME);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 수합 요청
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.collections (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  scope_key           text NOT NULL GENERATED ALWAYS AS ('s:' || school_id) STORED,
  title               text NOT NULL,
  purpose             text NOT NULL DEFAULT '',
  owner_membership_id text NOT NULL,
  owner_account_id    text NOT NULL,
  academic_year_id    text NOT NULL,
  unit_kind           text NOT NULL DEFAULT 'custom',
  review_mode         text NOT NULL,
  self_review         text NOT NULL DEFAULT 'forbid',
  schema_version      integer NOT NULL DEFAULT 1,
  due_on              date NOT NULL,
  due_at              timestamptz NOT NULL,
  due_change_revision integer NOT NULL DEFAULT 1,
  state               text NOT NULL DEFAULT 'draft',
  published_at        timestamptz,
  current_schema_id   text,
  request_visibility  text NOT NULL DEFAULT 'participants',
  result_visibility   text NOT NULL DEFAULT 'participants',
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT collections_pkey PRIMARY KEY (id),
  CONSTRAINT collections_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT collections_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT collections_owner_fkey FOREIGN KEY (school_id, owner_membership_id, owner_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT collections_school_id_academic_year_id_fkey FOREIGN KEY (school_id, academic_year_id)
    REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT collections_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT collections_title_check CHECK (length(title) BETWEEN 1 AND 120),
  CONSTRAINT collections_purpose_check CHECK (length(purpose) <= 3000),
  -- R1 은 직접 지정한 제출 단위만. 부서·학년 단위, 결과 공개는 해당 배치에서 연다.
  CONSTRAINT collections_unit_kind_pending CHECK (unit_kind = 'custom'),
  CONSTRAINT collections_review_mode_check CHECK (review_mode IN ('none','required')),
  -- 자기검토 금지는 기본이며 R1 에서 완화하지 않는다.
  CONSTRAINT collections_self_review_check CHECK (self_review = 'forbid'),
  CONSTRAINT collections_schema_version_check CHECK (schema_version = 1),
  CONSTRAINT collections_due_change_pending CHECK (due_change_revision = 1),
  CONSTRAINT collections_state_check CHECK (state IN ('draft','published')),
  CONSTRAINT collections_published_check CHECK ((state = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT collections_schema_check CHECK (state = 'draft' OR current_schema_id IS NOT NULL),
  CONSTRAINT collections_visibility_pending CHECK (request_visibility = 'participants' AND result_visibility = 'participants'),
  CONSTRAINT collections_version_check CHECK (version > 0)
);
CREATE INDEX collections_school_list ON workhub.collections (school_id, created_at DESC, id DESC);
CREATE INDEX collections_owner ON workhub.collections (school_id, owner_membership_id, state);

CREATE FUNCTION workhub_private.collections_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '수합은 지우지 않습니다.'; END IF;
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '게시된 수합 요청은 바꿀 수 없습니다(R1 에는 게시 후 변경 명령이 없습니다).';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER collections_identity BEFORE UPDATE ON workhub.collections
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','owner_membership_id','owner_account_id',
    'academic_year_id','unit_kind','self_review','created_at');
CREATE TRIGGER collections_guard BEFORE UPDATE OR DELETE ON workhub.collections
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collections_guard();

-- 검토자(R1 은 수합당 현재 검토자 최대 1명). 교체는 이전 행에 removed_at 을 남기고 새 행을 넣는다.
CREATE TABLE workhub.collection_reviewers (
  school_id              text NOT NULL,
  collection_id          text NOT NULL,
  membership_id          text NOT NULL,
  account_id             text NOT NULL,
  added_by_membership_id text NOT NULL,
  added_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at             timestamptz,
  CONSTRAINT collection_reviewers_pkey PRIMARY KEY (collection_id, membership_id, added_at),
  CONSTRAINT collection_reviewers_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_reviewers_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT collection_reviewers_added_by_fkey FOREIGN KEY (school_id, added_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT collection_reviewers_removed_check CHECK (removed_at IS NULL OR removed_at >= added_at)
);
CREATE UNIQUE INDEX collection_reviewers_one_current ON workhub.collection_reviewers (collection_id) WHERE removed_at IS NULL;
CREATE INDEX collection_reviewers_member ON workhub.collection_reviewers (school_id, membership_id) WHERE removed_at IS NULL;
CREATE TRIGGER collection_reviewers_identity BEFORE UPDATE ON workhub.collection_reviewers
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('school_id','collection_id','membership_id','account_id','added_by_membership_id','added_at');
CREATE TRIGGER collection_reviewers_draft_only BEFORE INSERT OR UPDATE OR DELETE ON workhub.collection_reviewers
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_draft_only();

-- ----------------------------------------------------------------------------
-- 2. 문항판 — R1 은 수합당 한 판(schema_version 1). 게시 전에는 고치고 게시 후에는 불변.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.collection_schemas (
  id                              text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                       text NOT NULL,
  collection_id                   text NOT NULL,
  schema_version                  integer NOT NULL DEFAULT 1,
  state                           text NOT NULL DEFAULT 'draft',
  review_mode                     text NOT NULL,
  self_review                     text NOT NULL DEFAULT 'forbid',
  title                           text NOT NULL,
  instructions                    text NOT NULL DEFAULT '',
  file_policy                     jsonb,
  file_required                   boolean NOT NULL DEFAULT false,
  definition_sha256               text,
  created_by_membership_id        text NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at                    timestamptz,
  -- 게시 때 고정하는 정책판: 학교 업로드 정책·공통 안전 하한·학교 제출 정책
  policy_scope_key                text,
  policy_version_id               text,
  common_policy_scope_key         text,
  common_policy_version_id        text,
  submission_policy_scope_key     text,
  submission_policy_version_id    text,
  CONSTRAINT collection_schemas_pkey PRIMARY KEY (id),
  CONSTRAINT collection_schemas_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT collection_schemas_collection_version_key UNIQUE (school_id, collection_id, schema_version),
  CONSTRAINT collection_schemas_collection_id_key UNIQUE (school_id, collection_id, id),
  CONSTRAINT collection_schemas_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_schemas_created_by_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT collection_schemas_policy_fkey FOREIGN KEY (policy_scope_key, policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT collection_schemas_common_policy_fkey FOREIGN KEY (common_policy_scope_key, common_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT collection_schemas_submission_policy_fkey FOREIGN KEY (submission_policy_scope_key, submission_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT collection_schemas_version_check CHECK (schema_version = 1),
  CONSTRAINT collection_schemas_state_check CHECK (state IN ('draft','published')),
  CONSTRAINT collection_schemas_review_mode_check CHECK (review_mode IN ('none','required')),
  CONSTRAINT collection_schemas_self_review_check CHECK (self_review = 'forbid'),
  CONSTRAINT collection_schemas_title_check CHECK (length(title) BETWEEN 1 AND 120 AND length(instructions) <= 3000),
  CONSTRAINT collection_schemas_policy_scope_check CHECK ((policy_scope_key IS NULL OR policy_scope_key = 's:' || school_id)
    AND (common_policy_scope_key IS NULL OR common_policy_scope_key = 'c')
    AND (submission_policy_scope_key IS NULL OR submission_policy_scope_key = 's:' || school_id)),
  -- 파일 정책은 앱 FilePolicy 와 같은 모양(정책판 검사 함수 재사용)
  CONSTRAINT collection_schemas_file_policy_check CHECK (file_policy IS NULL OR (
    workhub_private.policy_value_valid('file.safety', file_policy || '{"allowUnscanned":false}'::jsonb)
    AND workhub_private.json_keys_are(file_policy, ARRAY['extensions','maxFileBytes','maxFiles']))),
  CONSTRAINT collection_schemas_file_required_check CHECK (file_policy IS NOT NULL OR NOT file_required),
  -- 게시된 판은 지문·게시 시각·정책판(파일 문항이 있으면 업로드 정책까지)을 가진다
  CONSTRAINT collection_schemas_published_check CHECK (state = 'draft' OR (definition_sha256 ~ '^[0-9a-f]{64}$'
    AND published_at IS NOT NULL AND submission_policy_version_id IS NOT NULL
    AND (file_policy IS NULL OR (policy_version_id IS NOT NULL AND common_policy_version_id IS NOT NULL)))),
  CONSTRAINT collection_schemas_draft_check CHECK (state = 'published' OR (published_at IS NULL AND definition_sha256 IS NULL))
);
CREATE UNIQUE INDEX collection_schemas_one_per_collection ON workhub.collection_schemas (school_id, collection_id);
CREATE FUNCTION workhub_private.collection_schemas_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '문항판은 지우지 않습니다.'; END IF;
  IF OLD.state = 'published' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '게시된 문항판은 바꿀 수 없습니다.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER collection_schemas_identity BEFORE UPDATE ON workhub.collection_schemas
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','collection_id','schema_version','created_by_membership_id','created_at');
CREATE TRIGGER collection_schemas_guard BEFORE UPDATE OR DELETE ON workhub.collection_schemas
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_schemas_guard();
ALTER TABLE workhub.collections ADD CONSTRAINT collections_current_schema_fkey
  FOREIGN KEY (school_id, id, current_schema_id) REFERENCES workhub.collection_schemas(school_id, collection_id, id);

-- 문항: R1 은 글 1개(text)·숫자 1개(number)·파일 묶음 1개(files). 이름이 있는 문항만 행이 있다.
CREATE TABLE workhub.collection_fields (
  id             text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id      text NOT NULL,
  collection_id  text NOT NULL,
  schema_id      text NOT NULL,
  field_key      text NOT NULL,
  label          text NOT NULL,
  kind           text NOT NULL,
  required       boolean NOT NULL,
  max_length     integer,
  file_accept    text[],
  file_max_bytes bigint,
  file_max_count integer,
  sort_order     smallint NOT NULL,
  field_role     text NOT NULL DEFAULT 'input',
  CONSTRAINT collection_fields_pkey PRIMARY KEY (id),
  CONSTRAINT collection_fields_schema_key UNIQUE (school_id, schema_id, field_key),
  CONSTRAINT collection_fields_schema_id_key UNIQUE (school_id, schema_id, id),
  CONSTRAINT collection_fields_schema_fkey FOREIGN KEY (school_id, collection_id, schema_id)
    REFERENCES workhub.collection_schemas(school_id, collection_id, id),
  CONSTRAINT collection_fields_key_kind_check CHECK ((field_key, kind) IN (('text','long_text'), ('number','number'), ('files','file'))),
  CONSTRAINT collection_fields_label_check CHECK (length(label) BETWEEN 1 AND 120),
  CONSTRAINT collection_fields_role_check CHECK (field_role = 'input'),
  CONSTRAINT collection_fields_limits_check CHECK (CASE kind
    WHEN 'long_text' THEN max_length = 5000 AND file_accept IS NULL AND file_max_bytes IS NULL AND file_max_count IS NULL
    WHEN 'number' THEN max_length IS NULL AND file_accept IS NULL AND file_max_bytes IS NULL AND file_max_count IS NULL
    ELSE max_length IS NULL AND cardinality(file_accept) > 0 AND file_accept <@ ARRAY['pdf','hwp','hwpx','docx','xlsx','pptx']::text[]
      AND file_max_bytes BETWEEN 1 AND 104857600 AND file_max_count BETWEEN 1 AND 512 END)
);
CREATE TRIGGER collection_fields_draft_only BEFORE INSERT OR UPDATE OR DELETE ON workhub.collection_fields
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_draft_only();

-- ----------------------------------------------------------------------------
-- 3. 게시 전 대상 명단(계획) — 게시 때 이 명단으로 단위·구성원을 한 번 만든다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.collection_plan_units (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                 text NOT NULL,
  collection_id             text NOT NULL,
  ordinal                   smallint NOT NULL,
  label                     text NOT NULL,
  responsible_membership_id text NOT NULL,
  CONSTRAINT collection_plan_units_pkey PRIMARY KEY (id),
  CONSTRAINT collection_plan_units_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT collection_plan_units_ordinal_key UNIQUE (collection_id, ordinal),
  CONSTRAINT collection_plan_units_label_key UNIQUE (collection_id, label),
  CONSTRAINT collection_plan_units_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_plan_units_responsible_fkey FOREIGN KEY (school_id, responsible_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT collection_plan_units_ordinal_check CHECK (ordinal BETWEEN 1 AND 100),
  CONSTRAINT collection_plan_units_label_check CHECK (length(label) BETWEEN 1 AND 100)
);
CREATE TRIGGER collection_plan_units_draft_only BEFORE INSERT OR UPDATE OR DELETE ON workhub.collection_plan_units
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_draft_only();

CREATE TABLE workhub.collection_plan_unit_members (
  school_id     text NOT NULL,
  collection_id text NOT NULL,
  plan_unit_id  text NOT NULL,
  membership_id text NOT NULL,
  ordinal       smallint NOT NULL,
  CONSTRAINT collection_plan_unit_members_pkey PRIMARY KEY (plan_unit_id, membership_id),
  CONSTRAINT collection_plan_unit_members_ordinal_key UNIQUE (plan_unit_id, ordinal),
  CONSTRAINT collection_plan_unit_members_unit_fkey FOREIGN KEY (school_id, plan_unit_id) REFERENCES workhub.collection_plan_units(school_id, id),
  CONSTRAINT collection_plan_unit_members_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_plan_unit_members_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT collection_plan_unit_members_ordinal_check CHECK (ordinal BETWEEN 1 AND 99)
);
CREATE TRIGGER collection_plan_unit_members_draft_only BEFORE INSERT OR UPDATE OR DELETE ON workhub.collection_plan_unit_members
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_draft_only();

-- ----------------------------------------------------------------------------
-- 4. 업로드 목적(intent) — prepare 가 고정한 학교·업로더·typed 부모·기대판. 기록 뒤 불변.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.collection_file_intents (
  file_id                text NOT NULL,
  school_id              text NOT NULL,
  purpose                text NOT NULL,
  collection_id          text NOT NULL,
  unit_id                text,
  expected_version       integer NOT NULL,
  field_key              text NOT NULL DEFAULT 'files',
  uploader_account_id    text NOT NULL,
  uploader_membership_id text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_file_intents_pkey PRIMARY KEY (file_id),
  CONSTRAINT collection_file_intents_school_file_key UNIQUE (school_id, file_id),
  CONSTRAINT collection_file_intents_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT collection_file_intents_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_file_intents_uploader_fkey FOREIGN KEY (school_id, uploader_membership_id, uploader_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  -- 제출판 부모로는 새 업로드를 받지 않는다(불변 제출판)
  CONSTRAINT collection_file_intents_purpose_check CHECK ((purpose = 'template' AND unit_id IS NULL AND expected_version >= 1)
    OR (purpose = 'draft' AND unit_id IS NOT NULL AND expected_version >= 0)),
  -- R1 은 파일 문항 하나(files)만 지원한다. 다중 파일 문항은 이 CHECK 를 바꾸는 배치에서 연다.
  CONSTRAINT collection_file_intents_field_pending CHECK (field_key = 'files')
);
CREATE INDEX collection_file_intents_parent ON workhub.collection_file_intents (school_id, collection_id, unit_id);
CREATE TRIGGER collection_file_intents_immutable BEFORE UPDATE OR DELETE ON workhub.collection_file_intents
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 배부 파일(양식). 요청판 기준으로 연결·해제 이력을 남긴다. 게시 후 불변.
CREATE TABLE workhub.collection_template_files (
  school_id           text NOT NULL,
  collection_id       text NOT NULL,
  file_id             text NOT NULL,
  ordinal             smallint NOT NULL,
  linked_in_version   integer NOT NULL,
  unlinked_in_version integer,
  linked_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  unlinked_at         timestamptz,
  CONSTRAINT collection_template_files_pkey PRIMARY KEY (collection_id, file_id, linked_in_version),
  CONSTRAINT collection_template_files_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_template_files_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT collection_template_files_intent_fkey FOREIGN KEY (file_id) REFERENCES workhub.collection_file_intents(file_id),
  CONSTRAINT collection_template_files_ordinal_check CHECK (ordinal BETWEEN 1 AND 512),
  CONSTRAINT collection_template_files_versions_check CHECK (linked_in_version >= 2
    AND (unlinked_in_version IS NULL OR unlinked_in_version > linked_in_version)),
  CONSTRAINT collection_template_files_unlink_check CHECK ((unlinked_in_version IS NULL) = (unlinked_at IS NULL))
);
CREATE UNIQUE INDEX collection_template_files_active ON workhub.collection_template_files (collection_id, file_id) WHERE unlinked_at IS NULL;
CREATE TRIGGER collection_template_files_identity BEFORE UPDATE ON workhub.collection_template_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('school_id','collection_id','file_id','ordinal','linked_in_version','linked_at');
CREATE TRIGGER collection_template_files_draft_only BEFORE INSERT OR UPDATE OR DELETE ON workhub.collection_template_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_draft_only();

-- ----------------------------------------------------------------------------
-- 5. 제출 단위·구성원 — 게시 때 한 번 만든다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.collection_units (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                 text NOT NULL,
  collection_id             text NOT NULL,
  unit_key                  text NOT NULL,
  ordinal                   smallint NOT NULL,
  label                     text NOT NULL,
  responsible_membership_id text NOT NULL,
  responsible_account_id    text NOT NULL,
  obligation_state          text NOT NULL DEFAULT 'assigned',
  active_schema_id          text NOT NULL,
  current_submission_id     text,
  effective_submission_id   text,
  first_submission_id       text,
  first_valid_submitted_at  timestamptz,
  first_submission_late     boolean,
  needs_owner               boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT collection_units_pkey PRIMARY KEY (id),
  CONSTRAINT collection_units_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT collection_units_school_collection_id_key UNIQUE (school_id, collection_id, id),
  CONSTRAINT collection_units_unit_key_key UNIQUE (collection_id, unit_key),
  CONSTRAINT collection_units_ordinal_key UNIQUE (collection_id, ordinal),
  CONSTRAINT collection_units_collection_fkey FOREIGN KEY (school_id, collection_id) REFERENCES workhub.collections(school_id, id),
  CONSTRAINT collection_units_schema_fkey FOREIGN KEY (school_id, collection_id, active_schema_id)
    REFERENCES workhub.collection_schemas(school_id, collection_id, id),
  CONSTRAINT collection_units_responsible_fkey FOREIGN KEY (school_id, responsible_membership_id, responsible_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT collection_units_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT collection_units_unit_key_check CHECK (unit_key ~ '^u[0-9]{3}$'),
  CONSTRAINT collection_units_ordinal_check CHECK (ordinal BETWEEN 1 AND 100),
  CONSTRAINT collection_units_label_check CHECK (length(label) BETWEEN 1 AND 100),
  -- R1 은 면제·책임자 공석을 다루지 않는다
  CONSTRAINT collection_units_obligation_pending CHECK (obligation_state = 'assigned' AND NOT needs_owner),
  CONSTRAINT collection_units_first_check CHECK ((first_submission_id IS NULL) = (first_valid_submitted_at IS NULL)
    AND (first_valid_submitted_at IS NULL) = (first_submission_late IS NULL)),
  CONSTRAINT collection_units_version_check CHECK (version > 0)
);
CREATE INDEX collection_units_collection ON workhub.collection_units (school_id, collection_id, ordinal);
CREATE INDEX collection_units_responsible ON workhub.collection_units (school_id, responsible_membership_id);

CREATE TABLE workhub.collection_unit_members (
  school_id     text NOT NULL,
  collection_id text NOT NULL,
  unit_id       text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  role          text NOT NULL,
  ordinal       smallint NOT NULL,
  valid_from    timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT collection_unit_members_pkey PRIMARY KEY (unit_id, membership_id),
  CONSTRAINT collection_unit_members_ordinal_key UNIQUE (unit_id, ordinal),
  CONSTRAINT collection_unit_members_unit_fkey FOREIGN KEY (school_id, collection_id, unit_id)
    REFERENCES workhub.collection_units(school_id, collection_id, id),
  CONSTRAINT collection_unit_members_member_fkey FOREIGN KEY (school_id, membership_id, account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT collection_unit_members_role_check CHECK (role IN ('responsible','coauthor')),
  CONSTRAINT collection_unit_members_ordinal_check CHECK (ordinal BETWEEN 0 AND 99 AND ((role = 'responsible') = (ordinal = 0))),
  -- R1 은 게시 후 구성원 변경 명령이 없다(구성원 교체는 후속 배치)
  CONSTRAINT collection_unit_members_removed_pending CHECK (removed_at IS NULL)
);
CREATE UNIQUE INDEX collection_unit_members_one_responsible ON workhub.collection_unit_members (unit_id) WHERE role = 'responsible';
CREATE INDEX collection_unit_members_member ON workhub.collection_unit_members (school_id, membership_id, collection_id);
CREATE TRIGGER collection_unit_members_immutable BEFORE UPDATE OR DELETE ON workhub.collection_unit_members
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 공동 초안 — 현재 문항판의 shared 초안 하나
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.unit_drafts (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                 text NOT NULL,
  collection_id             text NOT NULL,
  unit_id                   text NOT NULL,
  schema_id                 text NOT NULL,
  draft_kind                text NOT NULL DEFAULT 'shared',
  owner_account_id          text,
  answers                   jsonb NOT NULL,
  updated_by_account_id     text NOT NULL,
  updated_by_membership_id  text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT unit_drafts_pkey PRIMARY KEY (id),
  CONSTRAINT unit_drafts_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT unit_drafts_exact_key UNIQUE (school_id, id, unit_id, schema_id),
  CONSTRAINT unit_drafts_unit_fkey FOREIGN KEY (school_id, collection_id, unit_id) REFERENCES workhub.collection_units(school_id, collection_id, id),
  CONSTRAINT unit_drafts_schema_fkey FOREIGN KEY (school_id, collection_id, schema_id) REFERENCES workhub.collection_schemas(school_id, collection_id, id),
  CONSTRAINT unit_drafts_updated_by_fkey FOREIGN KEY (school_id, updated_by_membership_id, updated_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT unit_drafts_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  -- R1 은 공동(shared) 초안만. 개인 초안은 후속 배치에서 연다.
  CONSTRAINT unit_drafts_kind_pending CHECK (draft_kind = 'shared' AND owner_account_id IS NULL),
  CONSTRAINT unit_drafts_answers_check CHECK (jsonb_typeof(answers) = 'object'
    AND workhub_private.json_keys_are(answers, ARRAY['number','text'])
    AND jsonb_typeof(answers -> 'text') = 'string' AND jsonb_typeof(answers -> 'number') IN ('number','null')),
  CONSTRAINT unit_drafts_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX unit_drafts_one_shared ON workhub.unit_drafts (unit_id, schema_id) WHERE draft_kind = 'shared';
CREATE INDEX unit_drafts_unit ON workhub.unit_drafts (school_id, unit_id, schema_id);
CREATE FUNCTION workhub_private.unit_drafts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '초안은 지우지 않습니다.'; END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '초안 판은 하나씩만 올라갑니다.'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER unit_drafts_identity BEFORE UPDATE ON workhub.unit_drafts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','collection_id','unit_id','schema_id','draft_kind','owner_account_id','created_at');
CREATE TRIGGER unit_drafts_guard BEFORE UPDATE OR DELETE ON workhub.unit_drafts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.unit_drafts_guard();

-- 초안 첨부(typed). 초안 판 기준으로 연결·해제 이력을 남긴다.
CREATE TABLE workhub.unit_draft_files (
  school_id           text NOT NULL,
  draft_id            text NOT NULL,
  file_id             text NOT NULL,
  ordinal             smallint NOT NULL,
  linked_in_version   integer NOT NULL,
  unlinked_in_version integer,
  linked_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  unlinked_at         timestamptz,
  CONSTRAINT unit_draft_files_pkey PRIMARY KEY (draft_id, file_id, linked_in_version),
  CONSTRAINT unit_draft_files_draft_fkey FOREIGN KEY (school_id, draft_id) REFERENCES workhub.unit_drafts(school_id, id),
  CONSTRAINT unit_draft_files_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT unit_draft_files_intent_fkey FOREIGN KEY (file_id) REFERENCES workhub.collection_file_intents(file_id),
  CONSTRAINT unit_draft_files_ordinal_check CHECK (ordinal BETWEEN 1 AND 512),
  CONSTRAINT unit_draft_files_versions_check CHECK (linked_in_version >= 1
    AND (unlinked_in_version IS NULL OR unlinked_in_version > linked_in_version)),
  CONSTRAINT unit_draft_files_unlink_check CHECK ((unlinked_in_version IS NULL) = (unlinked_at IS NULL))
);
CREATE UNIQUE INDEX unit_draft_files_active ON workhub.unit_draft_files (draft_id, file_id) WHERE unlinked_at IS NULL;
CREATE INDEX unit_draft_files_file ON workhub.unit_draft_files (school_id, file_id);
CREATE FUNCTION workhub_private.link_unlink_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.unlinked_at IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['unlinked_in_version','unlinked_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['unlinked_in_version','unlinked_at']) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = format('%s 는 연결 해제를 한 번만 기록합니다.', TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER unit_draft_files_unlink_once BEFORE UPDATE OR DELETE ON workhub.unit_draft_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.link_unlink_once();
CREATE TRIGGER collection_template_files_unlink_once BEFORE UPDATE OR DELETE ON workhub.collection_template_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.link_unlink_once();

-- ----------------------------------------------------------------------------
-- 7. 제출판 — 접수 때의 계정·책임자·마감·검토 방식을 그대로 고정한다. 기록 뒤 불변.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.submission_versions (
  id                          text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                   text NOT NULL,
  collection_id               text NOT NULL,
  unit_id                     text NOT NULL,
  schema_id                   text NOT NULL,
  version_no                  integer NOT NULL,
  previous_submission_id      text,
  submitted_by_account_id     text NOT NULL,
  submitted_by_membership_id  text NOT NULL,
  responsible_account_id      text NOT NULL,
  source_draft_id             text NOT NULL,
  source_draft_version        integer NOT NULL,
  answers                     jsonb NOT NULL,
  review_mode                 text NOT NULL,
  receipt_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),
  receipt_date                date NOT NULL,
  due_on_snapshot             date NOT NULL,
  due_snapshot                timestamptz NOT NULL,
  due_change_revision         integer NOT NULL,
  is_late                     boolean NOT NULL,
  correction_reason           text NOT NULL DEFAULT '',
  correction_request_id       text,
  correction_window_id        text,
  request_id                  text NOT NULL,
  CONSTRAINT submission_versions_pkey PRIMARY KEY (id),
  CONSTRAINT submission_versions_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT submission_versions_unit_id_key UNIQUE (school_id, unit_id, id),
  CONSTRAINT submission_versions_unit_version_key UNIQUE (unit_id, version_no),
  CONSTRAINT submission_versions_unit_fkey FOREIGN KEY (school_id, collection_id, unit_id) REFERENCES workhub.collection_units(school_id, collection_id, id),
  CONSTRAINT submission_versions_schema_fkey FOREIGN KEY (school_id, collection_id, schema_id) REFERENCES workhub.collection_schemas(school_id, collection_id, id),
  CONSTRAINT submission_versions_draft_fkey FOREIGN KEY (school_id, source_draft_id, unit_id, schema_id)
    REFERENCES workhub.unit_drafts(school_id, id, unit_id, schema_id),
  CONSTRAINT submission_versions_previous_fkey FOREIGN KEY (school_id, unit_id, previous_submission_id)
    REFERENCES workhub.submission_versions(school_id, unit_id, id),
  CONSTRAINT submission_versions_submitter_fkey FOREIGN KEY (school_id, submitted_by_membership_id, submitted_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT submission_versions_responsible_fkey FOREIGN KEY (responsible_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT submission_versions_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT submission_versions_version_check CHECK (version_no BETWEEN 1 AND 1000 AND source_draft_version >= 1),
  CONSTRAINT submission_versions_review_mode_check CHECK (review_mode IN ('none','required')),
  CONSTRAINT submission_versions_answers_check CHECK (jsonb_typeof(answers) = 'object'
    AND workhub_private.json_keys_are(answers, ARRAY['number','text'])
    AND jsonb_typeof(answers -> 'text') = 'string' AND jsonb_typeof(answers -> 'number') IN ('number','null')),
  -- 날짜 마감은 학교 시간대 다음 날 00:00 이 기준 시각이다. 그 시각과 같거나 늦으면 지연.
  CONSTRAINT submission_versions_late_check CHECK (is_late = (receipt_at >= due_snapshot)),
  CONSTRAINT submission_versions_reason_check CHECK (length(correction_reason) <= 1000),
  CONSTRAINT submission_versions_request_key_check CHECK (length(request_id) BETWEEN 8 AND 200),
  -- 첫 판 말고는 정정 사유가 있다
  CONSTRAINT submission_versions_correction_check CHECK (version_no = 1 OR length(btrim(correction_reason)) > 0),
  CONSTRAINT submission_versions_previous_check CHECK (previous_submission_id IS NULL OR previous_submission_id <> id)
);
CREATE INDEX submission_versions_collection ON workhub.submission_versions (school_id, collection_id, unit_id, version_no);
CREATE TRIGGER submission_versions_immutable BEFORE UPDATE OR DELETE ON workhub.submission_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 이전판은 같은 단위의 더 앞선 판이어야 한다
CREATE FUNCTION workhub_private.submission_previous_earlier() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.previous_submission_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM workhub.submission_versions p
        WHERE p.school_id = NEW.school_id AND p.unit_id = NEW.unit_id AND p.id = NEW.previous_submission_id
          AND p.version_no < NEW.version_no) THEN
    RAISE EXCEPTION 'SUBMISSION_PREVIOUS_ORDER' USING DETAIL = '이전 제출판은 같은 단위의 앞선 판이어야 합니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_versions_previous_earlier BEFORE INSERT ON workhub.submission_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.submission_previous_earlier();

ALTER TABLE workhub.collection_units
  ADD CONSTRAINT collection_units_current_fkey FOREIGN KEY (school_id, id, current_submission_id)
    REFERENCES workhub.submission_versions(school_id, unit_id, id),
  ADD CONSTRAINT collection_units_effective_fkey FOREIGN KEY (school_id, id, effective_submission_id)
    REFERENCES workhub.submission_versions(school_id, unit_id, id),
  ADD CONSTRAINT collection_units_first_fkey FOREIGN KEY (school_id, id, first_submission_id)
    REFERENCES workhub.submission_versions(school_id, unit_id, id);

CREATE TABLE workhub.submission_files (
  school_id                       text NOT NULL,
  submission_id                   text NOT NULL,
  file_id                         text NOT NULL,
  ordinal                         smallint NOT NULL,
  sha256                          text NOT NULL,
  size_bytes                      bigint NOT NULL,
  safety_policy_scope_key         text NOT NULL,
  safety_policy_version_id        text NOT NULL,
  common_safety_policy_scope_key  text NOT NULL,
  common_safety_policy_version_id text NOT NULL,
  CONSTRAINT submission_files_pkey PRIMARY KEY (submission_id, file_id),
  CONSTRAINT submission_files_ordinal_key UNIQUE (submission_id, ordinal),
  CONSTRAINT submission_files_submission_fkey FOREIGN KEY (school_id, submission_id) REFERENCES workhub.submission_versions(school_id, id),
  CONSTRAINT submission_files_file_fkey FOREIGN KEY (school_id, file_id) REFERENCES workhub.file_objects(school_id, id),
  CONSTRAINT submission_files_policy_fkey FOREIGN KEY (safety_policy_scope_key, safety_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT submission_files_common_policy_fkey FOREIGN KEY (common_safety_policy_scope_key, common_safety_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT submission_files_ordinal_check CHECK (ordinal BETWEEN 1 AND 512),
  CONSTRAINT submission_files_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$' AND size_bytes >= 1)
);
CREATE INDEX submission_files_file ON workhub.submission_files (school_id, file_id);
CREATE TRIGGER submission_files_immutable BEFORE UPDATE OR DELETE ON workhub.submission_files
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 8. 검토 · 보완 요청 · 보완 충족 · 철회 · 정정창
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.submission_reviews (
  id                     text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id              text NOT NULL,
  unit_id                text NOT NULL,
  submission_id          text NOT NULL,
  reviewer_account_id    text NOT NULL,
  reviewer_membership_id text NOT NULL,
  decision               text NOT NULL,
  note                   text NOT NULL,
  recorded_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT submission_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT submission_reviews_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT submission_reviews_unit_id_key UNIQUE (school_id, unit_id, submission_id, id),
  -- 정확한 pending 판 1회 검토
  CONSTRAINT submission_reviews_submission_key UNIQUE (submission_id),
  CONSTRAINT submission_reviews_submission_fkey FOREIGN KEY (school_id, unit_id, submission_id) REFERENCES workhub.submission_versions(school_id, unit_id, id),
  CONSTRAINT submission_reviews_reviewer_fkey FOREIGN KEY (school_id, reviewer_membership_id, reviewer_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT submission_reviews_decision_check CHECK (decision IN ('accepted','changes_requested')),
  CONSTRAINT submission_reviews_note_check CHECK (length(note) <= 1000 AND (decision = 'accepted' OR length(btrim(note)) > 0))
);
CREATE TRIGGER submission_reviews_immutable BEFORE UPDATE OR DELETE ON workhub.submission_reviews
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 자기검토 금지(계정 기준): 제출자·당시 책임자 계정과 검토자 계정이 같으면 거부
CREATE FUNCTION workhub_private.review_not_self() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workhub.submission_versions s
              JOIN workhub.collection_units u ON u.school_id = s.school_id AND u.id = s.unit_id
             WHERE s.school_id = NEW.school_id AND s.id = NEW.submission_id
               AND NEW.reviewer_account_id IN (s.submitted_by_account_id, s.responsible_account_id, u.responsible_account_id)) THEN
    RAISE EXCEPTION 'SELF_REVIEW' USING DETAIL = '자기 제출을 검토할 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_reviews_not_self BEFORE INSERT ON workhub.submission_reviews
  FOR EACH ROW EXECUTE FUNCTION workhub_private.review_not_self();

-- 보완 요청(changes_requested 검토 1건 = 보완 요청 1건). 상태는 open ↔ fulfilled 만 오간다.
CREATE TABLE workhub.correction_requests (
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id     text NOT NULL,
  unit_id       text NOT NULL,
  submission_id text NOT NULL,
  review_id     text NOT NULL,
  due_on        date NOT NULL,
  reason        text NOT NULL,
  state         text NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT correction_requests_pkey PRIMARY KEY (id),
  CONSTRAINT correction_requests_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT correction_requests_unit_id_key UNIQUE (school_id, unit_id, id),
  CONSTRAINT correction_requests_submission_key UNIQUE (submission_id),
  CONSTRAINT correction_requests_review_key UNIQUE (review_id),
  CONSTRAINT correction_requests_review_fkey FOREIGN KEY (school_id, unit_id, submission_id, review_id)
    REFERENCES workhub.submission_reviews(school_id, unit_id, submission_id, id),
  CONSTRAINT correction_requests_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT correction_requests_state_check CHECK (state IN ('open','fulfilled')),
  CONSTRAINT correction_requests_reason_check CHECK (length(reason) BETWEEN 1 AND 1000)
);
CREATE INDEX correction_requests_open ON workhub.correction_requests (school_id, unit_id) WHERE state = 'open';
CREATE FUNCTION workhub_private.correction_requests_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['state','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','updated_at']) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '보완 요청은 상태(open/fulfilled)만 바뀝니다.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER correction_requests_guard BEFORE UPDATE OR DELETE ON workhub.correction_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.correction_requests_guard();

CREATE TABLE workhub.submission_withdrawals (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  unit_id             text NOT NULL,
  submission_id       text NOT NULL,
  actor_account_id    text NOT NULL,
  actor_membership_id text NOT NULL,
  reason              text NOT NULL,
  correction_window_id text,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT submission_withdrawals_pkey PRIMARY KEY (id),
  CONSTRAINT submission_withdrawals_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT submission_withdrawals_submission_key UNIQUE (submission_id),
  CONSTRAINT submission_withdrawals_submission_fkey FOREIGN KEY (school_id, unit_id, submission_id) REFERENCES workhub.submission_versions(school_id, unit_id, id),
  CONSTRAINT submission_withdrawals_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT submission_withdrawals_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT submission_withdrawals_reason_check CHECK (length(reason) <= 1000 AND length(btrim(reason)) > 0)
);
CREATE TRIGGER submission_withdrawals_immutable BEFORE UPDATE OR DELETE ON workhub.submission_withdrawals
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 보완 충족: 보완 요청에 응답한 정확한 제출판. 그 판이 철회되면 무효 처리(지우지 않음)
CREATE TABLE workhub.collection_correction_fulfillments (
  id                           text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                    text NOT NULL,
  unit_id                      text NOT NULL,
  correction_request_id        text NOT NULL,
  submission_id                text NOT NULL,
  fulfilled_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  invalidated_at               timestamptz,
  invalidated_by_withdrawal_id text,
  CONSTRAINT collection_correction_fulfillments_pkey PRIMARY KEY (id),
  CONSTRAINT collection_correction_fulfillments_request_fkey FOREIGN KEY (school_id, unit_id, correction_request_id)
    REFERENCES workhub.correction_requests(school_id, unit_id, id),
  CONSTRAINT collection_correction_fulfillments_submission_fkey FOREIGN KEY (school_id, unit_id, submission_id)
    REFERENCES workhub.submission_versions(school_id, unit_id, id),
  CONSTRAINT collection_correction_fulfillments_withdrawal_fkey FOREIGN KEY (school_id, invalidated_by_withdrawal_id)
    REFERENCES workhub.submission_withdrawals(school_id, id),
  CONSTRAINT collection_correction_fulfillments_invalid_check CHECK ((invalidated_at IS NULL) = (invalidated_by_withdrawal_id IS NULL))
);
CREATE UNIQUE INDEX collection_correction_fulfillments_active ON workhub.collection_correction_fulfillments (correction_request_id) WHERE invalidated_at IS NULL;
CREATE INDEX collection_correction_fulfillments_submission ON workhub.collection_correction_fulfillments (school_id, submission_id) WHERE invalidated_at IS NULL;
CREATE FUNCTION workhub_private.fulfillment_invalidate_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.invalidated_at IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['invalidated_at','invalidated_by_withdrawal_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['invalidated_at','invalidated_by_withdrawal_id']) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '보완 충족은 무효 처리만 한 번 기록합니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER collection_correction_fulfillments_guard BEFORE UPDATE OR DELETE ON workhub.collection_correction_fulfillments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.fulfillment_invalidate_once();

-- 정정창: 요청 관리자가 단위 하나에 연 마감 후 정정·철회 허용 기간. 기록 뒤 불변(새 창이 이전 창을 대신한다)
CREATE TABLE workhub.correction_windows (
  id                           text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                    text NOT NULL,
  collection_id                text NOT NULL,
  unit_id                      text NOT NULL,
  allows                       text NOT NULL DEFAULT 'both',
  until_on                     date NOT NULL,
  reason                       text NOT NULL,
  opened_by_account_id         text NOT NULL,
  opened_by_membership_id      text NOT NULL,
  submission_policy_scope_key  text NOT NULL,
  submission_policy_version_id text NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT correction_windows_pkey PRIMARY KEY (id),
  CONSTRAINT correction_windows_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT correction_windows_unit_fkey FOREIGN KEY (school_id, collection_id, unit_id) REFERENCES workhub.collection_units(school_id, collection_id, id),
  CONSTRAINT correction_windows_opened_by_fkey FOREIGN KEY (school_id, opened_by_membership_id, opened_by_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT correction_windows_policy_fkey FOREIGN KEY (submission_policy_scope_key, submission_policy_version_id)
    REFERENCES workhub.policy_versions(scope_key, id) MATCH FULL,
  CONSTRAINT correction_windows_allows_check CHECK (allows IN ('submit','withdraw','both')),
  CONSTRAINT correction_windows_reason_check CHECK (length(reason) <= 1000 AND length(btrim(reason)) > 0)
);
CREATE INDEX correction_windows_unit ON workhub.correction_windows (school_id, unit_id, created_at DESC);
CREATE TRIGGER correction_windows_immutable BEFORE UPDATE OR DELETE ON workhub.correction_windows
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub.submission_versions
  ADD CONSTRAINT submission_versions_correction_request_fkey FOREIGN KEY (school_id, unit_id, correction_request_id)
    REFERENCES workhub.correction_requests(school_id, unit_id, id),
  ADD CONSTRAINT submission_versions_correction_window_fkey FOREIGN KEY (school_id, correction_window_id)
    REFERENCES workhub.correction_windows(school_id, id);
ALTER TABLE workhub.submission_withdrawals
  ADD CONSTRAINT submission_withdrawals_window_fkey FOREIGN KEY (school_id, correction_window_id)
    REFERENCES workhub.correction_windows(school_id, id);

-- 단위 포인터·판: 정체성은 고정, 첫 제출 기록은 한 번, 판은 하나씩. 지우지 않는다.
CREATE FUNCTION workhub_private.collection_units_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '제출 단위는 지우지 않습니다.'; END IF;
  IF (OLD.first_submission_id IS NOT NULL AND (NEW.first_submission_id IS DISTINCT FROM OLD.first_submission_id
        OR NEW.first_valid_submitted_at IS DISTINCT FROM OLD.first_valid_submitted_at OR NEW.first_submission_late IS DISTINCT FROM OLD.first_submission_late))
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '첫 제출 기록은 한 번만, 단위 판은 하나씩 올라갑니다.';
  END IF;
  -- 무검토형은 현재판 = 완료본
  IF NEW.effective_submission_id IS NOT NULL AND NEW.current_submission_id IS NULL THEN
    RAISE EXCEPTION 'UNIT_POINTER' USING DETAIL = '완료본이 있으면 현재판도 있어야 합니다.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER collection_units_identity BEFORE UPDATE ON workhub.collection_units
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','collection_id','unit_key','ordinal','label',
    'responsible_membership_id','responsible_account_id','active_schema_id','created_at');
CREATE TRIGGER collection_units_guard BEFORE UPDATE OR DELETE ON workhub.collection_units
  FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_units_guard();

-- 포인터 진리표(커밋 시점 검사): 현재판·완료본은 철회되지 않은 판, 검토형 완료본은 승인된 판, 무검토형은 현재 = 완료본
-- 지연 검사는 COMMIT 시점에 호출자 역할(authenticated)로 돈다 → SECURITY DEFINER 로 표를 읽는다(읽기만, 쓰지 않음).
CREATE FUNCTION workhub_private.collection_units_pointer_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u workhub.collection_units; v_mode text;
BEGIN
  SELECT * INTO u FROM workhub.collection_units WHERE id = NEW.id;
  SELECT review_mode INTO v_mode FROM workhub.collections WHERE school_id = u.school_id AND id = u.collection_id;
  IF (v_mode = 'none' AND u.current_submission_id IS DISTINCT FROM u.effective_submission_id)
     OR EXISTS (SELECT 1 FROM workhub.submission_withdrawals w
                 WHERE w.school_id = u.school_id AND w.submission_id IN (u.current_submission_id, u.effective_submission_id))
     OR (v_mode = 'required' AND u.effective_submission_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM workhub.submission_reviews r
            WHERE r.school_id = u.school_id AND r.submission_id = u.effective_submission_id AND r.decision = 'accepted')) THEN
    RAISE EXCEPTION 'UNIT_POINTER' USING DETAIL = '현재판·완료본 포인터가 검토 방식과 맞지 않습니다.';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER collection_units_pointer_check AFTER INSERT OR UPDATE ON workhub.collection_units
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workhub_private.collection_units_pointer_check();

-- ----------------------------------------------------------------------------
-- 9. 권한: 새 표 RLS 켜짐·정책 없음, API 역할 권한 0
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

INSERT INTO workhub_private.batch_installs (batch, release) VALUES ('R1-02', '2026-10-15.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 10. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'R1-02-1' AS no, 'R1-02 표 17개 + RLS 켜짐 + 행 0' AS item,
       CASE WHEN count(*) FILTER (WHERE c.relrowsecurity) = 17 THEN 'ok' ELSE 'FAIL' END AS status,
       count(*) FILTER (WHERE c.relrowsecurity)::text AS value
FROM unnest(ARRAY['workhub.collections','workhub.collection_reviewers','workhub.collection_schemas','workhub.collection_fields',
  'workhub.collection_plan_units','workhub.collection_plan_unit_members','workhub.collection_file_intents','workhub.collection_template_files',
  'workhub.collection_units','workhub.collection_unit_members','workhub.unit_drafts','workhub.unit_draft_files','workhub.submission_versions',
  'workhub.submission_files','workhub.submission_reviews','workhub.correction_requests','workhub.submission_withdrawals']) t
LEFT JOIN pg_class c ON c.oid = to_regclass(t)
UNION ALL
SELECT 'R1-02-2', '보완 충족·정정창 표 + RLS',
       CASE WHEN count(*) FILTER (WHERE c.relrowsecurity) = 2 THEN 'ok' ELSE 'FAIL' END, count(*) FILTER (WHERE c.relrowsecurity)::text
FROM unnest(ARRAY['workhub.collection_correction_fulfillments','workhub.correction_windows']) t LEFT JOIN pg_class c ON c.oid = to_regclass(t)
UNION ALL
SELECT 'R1-02-3', 'API 역할의 workhub 표 권한 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM information_schema.role_table_grants WHERE table_schema IN ('workhub','workhub_private') AND grantee IN ('PUBLIC','anon','authenticated','service_role')
UNION ALL
SELECT 'R1-02-4', '수합 자료 0건(표만 생성)',
       CASE WHEN (SELECT count(*) FROM workhub.collections) = 0 AND (SELECT count(*) FROM workhub.submission_versions) = 0 THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
