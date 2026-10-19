-- ============================================================================
-- T2-01  시간표 2단계 — 공개 시간표 · 날짜별 수업 · 교환 요청 · 학사 변경 · 실시 기록 모델 (비활성 설치)
--
-- ▣ 앱 계약: PR #72 (a5ff182) — apps/workhub/src/timetable/
--     operations-server.ts(timetable-operations.v1) · operations-next-server.ts(timetable-operations.next.v1)
--     publication-execution-server.ts(timetable-publication.v1) · school-day-execution-server.ts(timetable-school-day.v1)
--     execution-records.ts(timetable.execution-records.v1). 설계 · 판단은 t2/T2_설계_계약.md.
-- ▣ 새로 만드는 것: 표 13개(RLS 켜고 정책 없음 — API 직접 접근 0) · 내부 함수 t2_*(계산 도구).
--   공개 함수는 T2-03~06. 알림 출처 넓히기는 T2-02(따로 승인). 켜기는 T2-08(따로 승인).
--   이 파일은 기존 표 · 함수 · 제약을 바꾸지 않는다(기존 표에 행도 쓰지 않는다).
-- ▣ 전제: T1-01 · T1-02 · T1-03(2026-10-18.1) · T1-07(2026-10-19.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t1_installs') IS NULL THEN
    RAISE EXCEPTION 'T2 중단: T1-01 · T1-02 · T1-03(2026-10-18.1)과 T1-07(2026-10-19.1)을 먼저 적용해 주세요.';
  END IF;
  -- 표가 없을 때 아래 식을 준비하지 않도록 위와 나눈다
  IF (SELECT count(*) FROM workhub_private.t1_installs WHERE batch IN ('T1-01','T1-02','T1-03') AND release = '2026-10-18.1') <> 3
     OR NOT EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = 'T1-07' AND release = '2026-10-19.1') THEN
    RAISE EXCEPTION 'T2 중단: T1-01 · T1-02 · T1-03(2026-10-18.1)과 T1-07(2026-10-19.1)을 먼저 적용해 주세요.';
  END IF;
  IF to_regclass('workhub_private.t2_installs') IS NOT NULL THEN RAISE EXCEPTION 'T2 중단: T2-01 이 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'workhub' AND c.relname IN ('timetable_publications','timetable_lessons','timetable_lesson_versions','timetable_previews',
                'timetable_preview_pages','timetable_exchange_requests','timetable_exchange_lessons','timetable_exchange_participants',
                'timetable_school_day_changes','timetable_operation_requests','timetable_execution_records','timetable_execution_record_versions'))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 't2\_%' OR proname LIKE 'workhub\_timetable\_operations\_%' OR proname LIKE 'workhub\_timetable\_publication\_%'
                   OR proname LIKE 'workhub\_timetable\_school\_day\_%' OR proname LIKE 'workhub\_timetable\_execution\_%') THEN
    RAISE EXCEPTION 'T2 중단: 같은 이름의 표 · 함수(T2 표 · t2_* · workhub_timetable_operations/publication/school_day/execution_*)가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.t2_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT t2_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT t2_installs_batch_check CHECK (batch IN ('T2-01','T2-02','T2-03','T2-04','T2-05','T2-06')),
  CONSTRAINT t2_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER t2_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.t2_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub_private.t2_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workhub_private.t2_installs FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION workhub_private.t2_installed(p_batch text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = p_batch AND release = '2026-10-20.1')
$$;

-- ----------------------------------------------------------------------------
-- 2. 공개 시간표 · 날짜별 수업
-- ----------------------------------------------------------------------------
-- 공개(확정) 한 번 = 1행(고칠 수 없음, 앱 version 1). 그때의 휴업일 · 불가 조건을 함께 고정한다(옮길 수 있는 시각 계산의 근거).
CREATE TABLE workhub.timetable_publications (
  id                          text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                   text NOT NULL,
  term_id                     text NOT NULL,
  basis_id                    text NOT NULL,
  draft_id                    text NOT NULL,
  title                       text NOT NULL,
  from_date                   date NOT NULL,
  until_date                  date NOT NULL,
  excluded_days               jsonb NOT NULL,
  unavailable                 jsonb NOT NULL,
  changed_count               integer NOT NULL,
  preview_id                  text NOT NULL,
  published_by_membership_id  text NOT NULL,
  request_key                 text NOT NULL,
  published_at                timestamptz NOT NULL,
  CONSTRAINT timetable_publications_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_publications_scope_key UNIQUE (school_id, id),
  CONSTRAINT timetable_publications_preview_key UNIQUE (preview_id),
  CONSTRAINT timetable_publications_basis_fkey FOREIGN KEY (school_id, basis_id, term_id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id),
  CONSTRAINT timetable_publications_draft_fkey FOREIGN KEY (draft_id) REFERENCES workhub.timetable_drafts(id),
  CONSTRAINT timetable_publications_member_fkey FOREIGN KEY (school_id, published_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_publications_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_publications_range_check CHECK (until_date > from_date AND until_date - from_date <= 366),
  CONSTRAINT timetable_publications_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT timetable_publications_shape_check CHECK (jsonb_typeof(excluded_days) = 'array' AND jsonb_typeof(unavailable) = 'array'),
  CONSTRAINT timetable_publications_count_check CHECK (changed_count > 0)
);
CREATE INDEX timetable_publications_range_idx ON workhub.timetable_publications (school_id, from_date, until_date);
CREATE TRIGGER timetable_publications_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_publications
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 날짜별 수업(현재 판). 같은 (학기, 활동, 원래 날짜)의 살아 있는 수업은 하나. 지우지 않고 cancelled 로 남긴다.
--   teacher_ids = 소속 ID(K-4). 교사 이름은 조회할 때 현재 이름으로(같은 교사가 이름 두 개로 보이지 않게).
--   groups · rooms = {id, name} 표시용(기준판 자원 이름). uses = 충돌 검사용 자원 [{id, kind, capacity}].
--   pinned = 교환 · 학사 변경으로 옮긴 수업. 다시 공개해도 그대로 둔다(existingChanges: retained).
CREATE TABLE workhub.timetable_lessons (
  id               text NOT NULL,
  school_id        text NOT NULL,
  term_id          text NOT NULL,
  publication_id   text NOT NULL,
  basis_id         text NOT NULL,
  activity_id      text NOT NULL,
  course_id        text NOT NULL,
  occurrence_date  date NOT NULL,
  label            text NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  state            text NOT NULL DEFAULT 'scheduled',
  version          integer NOT NULL DEFAULT 1,
  teacher_ids      text[] NOT NULL,
  groups           jsonb NOT NULL,
  rooms            jsonb NOT NULL,
  uses             jsonb NOT NULL,
  allowed_slot_ids text[] NOT NULL,
  pinned           boolean NOT NULL DEFAULT false,
  changed_by       text NOT NULL,
  changed_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_lessons_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_lessons_scope_key UNIQUE (school_id, id),
  CONSTRAINT timetable_lessons_pub_fkey FOREIGN KEY (school_id, publication_id) REFERENCES workhub.timetable_publications(school_id, id),
  CONSTRAINT timetable_lessons_basis_fkey FOREIGN KEY (school_id, basis_id, term_id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id),
  CONSTRAINT timetable_lessons_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$' AND activity_id ~ '^[A-Za-z0-9_-]{1,100}$' AND course_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_lessons_state_check CHECK (state IN ('scheduled','performed','cancelled')),
  CONSTRAINT timetable_lessons_version_check CHECK (version > 0),
  -- 수업 시각은 정수 초 · 하루(1440분) 이내(앱 time())
  CONSTRAINT timetable_lessons_time_check CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '1440 minutes'
    AND starts_at = date_trunc('second', starts_at) AND ends_at = date_trunc('second', ends_at)),
  CONSTRAINT timetable_lessons_people_check CHECK (cardinality(teacher_ids) BETWEEN 1 AND 100 AND jsonb_typeof(groups) = 'array'
    AND jsonb_array_length(groups) BETWEEN 1 AND 100 AND jsonb_typeof(rooms) = 'array' AND jsonb_array_length(rooms) <= 100 AND jsonb_typeof(uses) = 'array'),
  CONSTRAINT timetable_lessons_label_check CHECK (length(label) BETWEEN 1 AND 200),
  CONSTRAINT timetable_lessons_changed_by_check CHECK (changed_by IN ('publish','exchange','school_day'))
);
CREATE UNIQUE INDEX timetable_lessons_occurrence_key ON workhub.timetable_lessons (school_id, term_id, activity_id, occurrence_date) WHERE state <> 'cancelled';
CREATE INDEX timetable_lessons_time_idx ON workhub.timetable_lessons (school_id, starts_at, id);
CREATE INDEX timetable_lessons_occ_idx ON workhub.timetable_lessons (school_id, term_id, occurrence_date);
CREATE INDEX timetable_lessons_teacher_idx ON workhub.timetable_lessons USING gin (teacher_ids);

-- 수업 판 이력(고칠 수 없음): 판마다 그때의 값 그대로
CREATE TABLE workhub.timetable_lesson_versions (
  school_id   text NOT NULL,
  lesson_id   text NOT NULL,
  version     integer NOT NULL,
  change_kind text NOT NULL,
  source_id   text NOT NULL,
  snapshot    jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_lesson_versions_pkey PRIMARY KEY (lesson_id, version),
  CONSTRAINT timetable_lesson_versions_lesson_fkey FOREIGN KEY (school_id, lesson_id) REFERENCES workhub.timetable_lessons(school_id, id),
  CONSTRAINT timetable_lesson_versions_kind_check CHECK (change_kind IN ('publish','exchange','school_day')),
  CONSTRAINT timetable_lesson_versions_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);
CREATE TRIGGER timetable_lesson_versions_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_lesson_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 미리보기(15분) — 확정 · 제출 때 같은 ID · 시각으로 다시 계산해 지문이 같아야 반영한다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.timetable_previews (
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  kind          text NOT NULL,
  input         jsonb NOT NULL,
  source_as_of  timestamptz,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  preview_hash  text NOT NULL,
  manifest_hash text,
  total_changes integer NOT NULL,
  blocker_count integer NOT NULL,
  CONSTRAINT timetable_previews_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_previews_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT timetable_previews_kind_check CHECK (kind IN ('publish','manifest','exchange','school_day')),
  CONSTRAINT timetable_previews_time_check CHECK (expires_at > created_at AND expires_at - created_at <= interval '15 minutes'),
  CONSTRAINT timetable_previews_hash_check CHECK (preview_hash ~ '^[0-9a-f]{64}$' AND (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT timetable_previews_count_check CHECK (total_changes >= 0 AND blocker_count >= 0)
);
CREATE INDEX timetable_previews_member_idx ON workhub.timetable_previews (school_id, membership_id, created_at);
-- 확정 명세의 쪽(200개씩). 쪽 지문 = 앱 parsePublicationPage 의 digest(changes)
CREATE TABLE workhub.timetable_preview_pages (
  preview_id text NOT NULL,
  idx        integer NOT NULL,
  page_hash  text NOT NULL,
  changes    jsonb NOT NULL,
  CONSTRAINT timetable_preview_pages_pkey PRIMARY KEY (preview_id, idx),
  CONSTRAINT timetable_preview_pages_preview_fkey FOREIGN KEY (preview_id) REFERENCES workhub.timetable_previews(id) ON DELETE CASCADE,
  CONSTRAINT timetable_preview_pages_idx_check CHECK (idx BETWEEN 0 AND 499),
  CONSTRAINT timetable_preview_pages_shape_check CHECK (jsonb_typeof(changes) = 'array' AND page_hash ~ '^[0-9a-f]{64}$')
);

-- ----------------------------------------------------------------------------
-- 4. 교환 요청(이동 · 두 수업 교환) — 동의 · 승인 · 반영
-- ----------------------------------------------------------------------------
-- state 는 저장 상태. 화면 상태의 expired(기한 지남) · stale(수업 판이 바뀜)은 조회할 때 계산한다.
-- changes = 제출 때 확정한 전후 수업 값(앱 OperationLessonChange 그대로, canRequest=false). 동의는 이 값(proposal_hash)에 묶인다.
CREATE TABLE workhub.timetable_exchange_requests (
  id                         text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                  text NOT NULL,
  kind                       text NOT NULL,
  requester_membership_id    text NOT NULL,
  requester_account_id       text NOT NULL,
  requester_name             text NOT NULL,
  reason                     text NOT NULL,
  proposal_hash              text NOT NULL,
  changes                    jsonb NOT NULL,
  first_day                  date NOT NULL,
  last_day                   date NOT NULL,
  state                      text NOT NULL,
  version                    integer NOT NULL DEFAULT 1,
  preview_id                 text NOT NULL,
  created_at                 timestamptz NOT NULL,
  expires_at                 timestamptz NOT NULL,
  updated_at                 timestamptz NOT NULL,
  decided_by_membership_id   text,
  CONSTRAINT timetable_exchange_requests_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_exchange_requests_scope_key UNIQUE (school_id, id),
  CONSTRAINT timetable_exchange_requests_preview_key UNIQUE (preview_id),
  CONSTRAINT timetable_exchange_requests_requester_fkey FOREIGN KEY (school_id, requester_membership_id, requester_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT timetable_exchange_requests_decider_fkey FOREIGN KEY (school_id, decided_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_exchange_requests_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_exchange_requests_kind_check CHECK (kind IN ('move','swap')),
  CONSTRAINT timetable_exchange_requests_state_check CHECK (state IN ('awaiting_consent','awaiting_approval','applied','rejected','withdrawn')),
  CONSTRAINT timetable_exchange_requests_version_check CHECK (version > 0),
  CONSTRAINT timetable_exchange_requests_time_check CHECK (expires_at > created_at AND updated_at >= created_at AND last_day >= first_day),
  CONSTRAINT timetable_exchange_requests_shape_check CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) BETWEEN 1 AND 2
    AND proposal_hash ~ '^[0-9a-f]{64}$' AND length(reason) <= 500 AND length(requester_name) BETWEEN 1 AND 200)
);
CREATE INDEX timetable_exchange_requests_range_idx ON workhub.timetable_exchange_requests (school_id, first_day, last_day);
-- 요청이 묶은 수업과 그때의 판(판이 달라지면 stale)
CREATE TABLE workhub.timetable_exchange_lessons (
  school_id      text NOT NULL,
  request_id     text NOT NULL,
  lesson_id      text NOT NULL,
  before_version integer NOT NULL,
  CONSTRAINT timetable_exchange_lessons_pkey PRIMARY KEY (request_id, lesson_id),
  CONSTRAINT timetable_exchange_lessons_request_fkey FOREIGN KEY (school_id, request_id) REFERENCES workhub.timetable_exchange_requests(school_id, id),
  CONSTRAINT timetable_exchange_lessons_lesson_fkey FOREIGN KEY (school_id, lesson_id) REFERENCES workhub.timetable_lessons(school_id, id)
);
CREATE INDEX timetable_exchange_lessons_lesson_idx ON workhub.timetable_exchange_lessons (school_id, lesson_id);
CREATE TRIGGER timetable_exchange_lessons_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_exchange_lessons
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 참여 교사(변경 전후 교사 합집합)와 응답. 요청자는 제출할 때 accepted.
CREATE TABLE workhub.timetable_exchange_participants (
  school_id     text NOT NULL,
  request_id    text NOT NULL,
  membership_id text NOT NULL,
  name          text NOT NULL,
  response      text NOT NULL DEFAULT 'pending',
  responded_at  timestamptz,
  CONSTRAINT timetable_exchange_participants_pkey PRIMARY KEY (request_id, membership_id),
  CONSTRAINT timetable_exchange_participants_request_fkey FOREIGN KEY (school_id, request_id) REFERENCES workhub.timetable_exchange_requests(school_id, id),
  CONSTRAINT timetable_exchange_participants_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_exchange_participants_response_check CHECK (response IN ('pending','accepted','rejected')
    AND (response = 'pending') = (responded_at IS NULL))
);

-- ----------------------------------------------------------------------------
-- 5. 학사 변경(휴업 · 특별 일과) — 반영 1건 = 1행(고칠 수 없음)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.timetable_school_day_changes (
  id                text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id         text NOT NULL,
  preview_id        text NOT NULL,
  input             jsonb NOT NULL,
  changed_lessons   jsonb NOT NULL,
  lost_lesson_count integer NOT NULL,
  membership_id     text NOT NULL,
  request_key       text NOT NULL,
  recorded_at       timestamptz NOT NULL,
  CONSTRAINT timetable_school_day_changes_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_school_day_changes_preview_key UNIQUE (preview_id),
  CONSTRAINT timetable_school_day_changes_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_school_day_changes_shape_check CHECK (jsonb_typeof(input) = 'object' AND jsonb_typeof(changed_lessons) = 'array'
    AND jsonb_array_length(changed_lessons) > 0 AND lost_lesson_count >= 0)
);
CREATE TRIGGER timetable_school_day_changes_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_school_day_changes
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 요청 원장(T2 쓰기 4종) — 반영된 쓰기만. 접수증 그대로(복구 · 재전송이 같은 값을 받는다)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.timetable_operation_requests (
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  op            text NOT NULL,
  request_key   text NOT NULL,
  command_hash  text NOT NULL,
  response      jsonb NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_operation_requests_pkey PRIMARY KEY (school_id, membership_id, op, request_key),
  CONSTRAINT timetable_operation_requests_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT timetable_operation_requests_op_check CHECK (op IN ('operations','publication','school_day','execution')),
  CONSTRAINT timetable_operation_requests_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$'),
  CONSTRAINT timetable_operation_requests_hash_check CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT timetable_operation_requests_response_check CHECK (jsonb_typeof(response) = 'object')
);
CREATE TRIGGER timetable_operation_requests_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_operation_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. 실시 기록 — 수업마다 원장 1개(ID 고정), 판마다 불변 이력. 예정 수업의 state 는 바꾸지 않는다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.timetable_execution_records (
  id         text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id  text NOT NULL,
  lesson_id  text NOT NULL,
  version    integer NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT timetable_execution_records_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_execution_records_scope_key UNIQUE (school_id, id),
  CONSTRAINT timetable_execution_records_lesson_key UNIQUE (school_id, lesson_id),
  CONSTRAINT timetable_execution_records_lesson_fkey FOREIGN KEY (school_id, lesson_id) REFERENCES workhub.timetable_lessons(school_id, id),
  CONSTRAINT timetable_execution_records_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_execution_records_version_check CHECK (version BETWEEN 1 AND 2147483647)
);
CREATE TABLE workhub.timetable_execution_record_versions (
  school_id                 text NOT NULL,
  record_id                 text NOT NULL,
  version                   integer NOT NULL,
  lesson_id                 text NOT NULL,
  lesson_version            integer NOT NULL,
  outcome                   text NOT NULL,
  note                      text NOT NULL,
  correction_reason         text,
  recorded_by_membership_id text NOT NULL,
  recorded_by_name          text NOT NULL,
  request_key               text NOT NULL,
  recorded_at               timestamptz NOT NULL,
  CONSTRAINT timetable_execution_record_versions_pkey PRIMARY KEY (record_id, version),
  CONSTRAINT timetable_execution_record_versions_record_fkey FOREIGN KEY (school_id, record_id) REFERENCES workhub.timetable_execution_records(school_id, id),
  CONSTRAINT timetable_execution_record_versions_member_fkey FOREIGN KEY (school_id, recorded_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_execution_record_versions_outcome_check CHECK (outcome IN ('completed','not_performed','needs_review')),
  CONSTRAINT timetable_execution_record_versions_text_check CHECK (length(note) <= 1000 AND (correction_reason IS NULL OR length(correction_reason) <= 500)
    AND (version = 1) = (correction_reason IS NULL) AND length(recorded_by_name) BETWEEN 1 AND 200),
  CONSTRAINT timetable_execution_record_versions_version_check CHECK (version > 0 AND lesson_version > 0)
);
CREATE TRIGGER timetable_execution_record_versions_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_execution_record_versions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub.timetable_publications','workhub.timetable_lessons','workhub.timetable_lesson_versions','workhub.timetable_previews',
    'workhub.timetable_preview_pages','workhub.timetable_exchange_requests','workhub.timetable_exchange_lessons','workhub.timetable_exchange_participants',
    'workhub.timetable_school_day_changes','workhub.timetable_operation_requests','workhub.timetable_execution_records',
    'workhub.timetable_execution_record_versions'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. 공통 계산 도구
-- ----------------------------------------------------------------------------
-- 한도 원본 = PR #72 operations-api-limits.json · operations-next-limits.json · execution-records-policy.json (시험이 같은지 대조한다)
CREATE FUNCTION workhub_private.t2_limit(p_name text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_name WHEN 'listDays' THEN 31 WHEN 'publishDays' THEN 366 WHEN 'lessons' THEN 3000 WHEN 'changes' THEN 12000
    WHEN 'requests' THEN 300 WHEN 'drafts' THEN 100 WHEN 'publications' THEN 100 WHEN 'teachers' THEN 1000 WHEN 'targets' THEN 400
    WHEN 'blockers' THEN 100 WHEN 'title' THEN 200 WHEN 'reason' THEN 500 WHEN 'message' THEN 1000 WHEN 'previewLifetimeMs' THEN 900000
    WHEN 'manifestChanges' THEN 100000 WHEN 'pageSize' THEN 200 WHEN 'pages' THEN 500 WHEN 'specialBells' THEN 30 WHEN 'groups' THEN 1000
    WHEN 'recommendations' THEN 3 WHEN 'referencesPerLesson' THEN 100 WHEN 'explanations' THEN 12
    WHEN 'note' THEN 1000 WHEN 'correctionReason' THEN 500 WHEN 'recordTeachers' THEN 100 WHEN 'recordPage' THEN 20 WHEN 'maxLessonSeconds' THEN 14400 END
$$;

-- 메타 시각(밀리초 보존) · 수업 시각(정수 초)은 모두 YYYY-MM-DDTHH:mm:ss.sssZ
CREATE FUNCTION workhub_private.t2_ts(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
-- 앱이 보낸 시각 문자열(정확한 UTC 형식만). 아니면 NULL.
CREATE FUNCTION workhub_private.t2_parse_ts(p jsonb, p_whole_second boolean) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v timestamptz;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'string' OR (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
     OR (p_whole_second AND (p #>> '{}') !~ '\.000Z$') THEN RETURN NULL; END IF;
  BEGIN v := (p #>> '{}')::timestamptz; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF workhub_private.t2_ts(v) <> (p #>> '{}') THEN RETURN NULL; END IF;
  RETURN v;
END $$;
CREATE FUNCTION workhub_private.t2_parse_date(p jsonb) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'string' OR (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  BEGIN v := (p #>> '{}')::date; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF to_char(v, 'YYYY-MM-DD') <> (p #>> '{}') THEN RETURN NULL; END IF;
  RETURN v;
END $$;
-- 학교 날짜 + 분 → 실제 시각(시간대 반영)
CREATE FUNCTION workhub_private.t2_at(p_date date, p_minute integer, p_tz text) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (p_date + make_interval(mins => p_minute)) AT TIME ZONE p_tz
$$;
CREATE FUNCTION workhub_private.t2_day(p timestamptz, p_tz text) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (p AT TIME ZONE p_tz)::date
$$;
CREATE FUNCTION workhub_private.t2_time(p_s timestamptz, p_e timestamptz) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('startsAt', workhub_private.t2_ts(p_s), 'endsAt', workhub_private.t2_ts(p_e))
$$;
-- 결정적 수업 ID(미리보기 ID + 활동 + 날짜) — 확정 때 다시 계산해도 같은 ID
CREATE FUNCTION workhub_private.t2_new_id(p_preview text, p_activity text, p_date date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'l' || left(encode(sha256(convert_to(p_preview || chr(31) || p_activity || chr(31) || p_date::text, 'UTF8')), 'hex'), 32)
$$;
-- 교사 이름(현재 이름, 소속 순서 그대로) — 같은 교사가 두 이름으로 보이지 않게 한 곳에서 만든다
CREATE FUNCTION workhub_private.t2_teachers(p_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', COALESCE(workhub_private.t1_label(a.display_name, 200, '교사'), '교사')) ORDER BY i.o), '[]'::jsonb)
    FROM unnest(p_ids) WITH ORDINALITY i(id, o)
    LEFT JOIN workhub.memberships m ON m.id = i.id
    LEFT JOIN workhub.accounts a ON a.id = m.account_id
$$;
CREATE FUNCTION workhub_private.t2_member_name(p_member text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT workhub_private.t1_label(a.display_name, 200, '교사') FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
                    WHERE m.id = p_member), '교사')
$$;
-- 휴업일(학교 전체 공식 · 확정 · 활성 일정의 holiday · discretionary_holiday · vacation). 날짜마다 첫 일정 제목을 사유로.
CREATE FUNCTION workhub_private.t2_closed_days(p_school text, p_from date, p_until date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', to_char(x.d, 'YYYY-MM-DD'), 'reason', x.reason) ORDER BY x.d), '[]'::jsonb)
    FROM (SELECT d::date AS d,
                 (SELECT workhub_private.t1_label(e.title, 1000, '휴업일') FROM workhub.events e
                   WHERE e.school_id = p_school AND e.scope = 'school' AND e.kind = 'official' AND e.official_state = 'confirmed'
                     AND e.status = 'active' AND e.deleted_at IS NULL AND e.visibility = 'school'
                     AND e.category IN ('holiday','discretionary_holiday','vacation') AND d::date BETWEEN e.start_date AND e.end_date
                   ORDER BY e.start_date, e.id LIMIT 1) AS reason
            FROM generate_series(p_from::timestamp, (p_until - 1)::timestamp, interval '1 day') d) x
   WHERE x.reason IS NOT NULL
$$;

-- 수업 → 앱 OperationLesson. 표시 이름 배열 · 교사 이름은 여기서 한 번에.
CREATE FUNCTION workhub_private.t2_lesson(l workhub.timetable_lessons, p_can boolean, p_targets jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', l.id, 'version', l.version, 'label', l.label, 'time', workhub_private.t2_time(l.starts_at, l.ends_at),
    'teachers', workhub_private.t2_teachers(l.teacher_ids),
    'groupNames', COALESCE((SELECT jsonb_agg(g -> 'name' ORDER BY o) FROM jsonb_array_elements(l.groups) WITH ORDINALITY z(g, o)), '[]'::jsonb),
    'roomNames', COALESCE((SELECT jsonb_agg(g -> 'name' ORDER BY o) FROM jsonb_array_elements(l.rooms) WITH ORDINALITY z(g, o)), '[]'::jsonb),
    'state', l.state, 'canRequest', p_can, 'allowedTargets', p_targets)
$$;

-- 옮길 수 있는 시각(allowedTargets): 그 수업의 원래 주(월~일) 안에서, 수업을 만든 공개판의 기간 · 휴업일을 지키고,
-- 기준판에서 이 활동이 허용된 시간대 중 길이가 같은 것. 지금 시각과 무관하다(조회 · 미리보기 · 요청에서 같은 값). 400개까지.
CREATE FUNCTION workhub_private.t2_targets(l workhub.timetable_lessons, p_tz text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(workhub_private.t2_time(x.s, x.e) ORDER BY x.s, x.e), '[]'::jsonb)
    FROM (SELECT DISTINCT y.s, y.e FROM (
            SELECT workhub_private.t2_at(d::date, (sl ->> 'startMinute')::integer, p_tz) AS s,
                   workhub_private.t2_at(d::date, (sl ->> 'endMinute')::integer, p_tz) AS e
              FROM workhub.timetable_publications p
              JOIN workhub.timetable_basis_revisions b ON b.school_id = l.school_id AND b.id = l.basis_id
              CROSS JOIN generate_series((l.occurrence_date - (extract(isodow FROM l.occurrence_date)::integer - 1))::timestamp,
                                         (l.occurrence_date + (7 - extract(isodow FROM l.occurrence_date)::integer))::timestamp, interval '1 day') d
              CROSS JOIN jsonb_array_elements(b.basis -> 'slots') sl
             WHERE p.school_id = l.school_id AND p.id = l.publication_id
               AND d::date >= p.from_date AND d::date < p.until_date
               AND NOT (p.excluded_days @> jsonb_build_array(jsonb_build_object('date', to_char(d::date, 'YYYY-MM-DD'))))
               AND (sl ->> 'day')::integer = extract(isodow FROM d)::integer
               AND (sl ->> 'id') = ANY (l.allowed_slot_ids)) y
           WHERE y.e - y.s = l.ends_at - l.starts_at
           ORDER BY y.s, y.e LIMIT 400) x
$$;

-- 자원 충돌: 후보(최종 상태 [{id, s, e, uses}])를 넣었을 때 어떤 자원이 같은 순간 정원보다 많이 쓰이는가(교사 · 학급 · 수강집단 정원 1, 공간은 기준판 정원).
--   자원마다 시작(+1) · 끝(-1)을 시각 순으로 세고(같은 시각이면 끝을 먼저 — 붙어 있는 수업은 겹치지 않음), 넘친 순간에 걸린 후보 ID 를 돌려준다.
--   취소 수업 · p_skip(이번에 취소하는 수업)은 빼고, 후보와 같은 ID 의 기존 수업은 후보 값으로 바꿔 본다. 학기 전체 공개(수만 건)도 한 번 정렬로 끝난다.
CREATE FUNCTION workhub_private.t2_conflicts(p_school text, p_cands jsonb, p_skip text[]) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (
    SELECT x ->> 'id' AS id, (x ->> 's')::timestamptz AS s, (x ->> 'e')::timestamptz AS e, x -> 'uses' AS uses FROM jsonb_array_elements(p_cands) x
  ), cu AS (
    SELECT c.id, c.s, c.e, u ->> 'id' AS rid, COALESCE((u ->> 'capacity')::integer, 1) AS cap FROM c CROSS JOIN jsonb_array_elements(c.uses) u
  ), caps AS (
    SELECT rid, min(cap) AS cap FROM cu GROUP BY rid
  ), w AS (
    SELECT min(s) AS lo, max(e) AS hi FROM c
  ), a AS (
    SELECT l.id, l.starts_at AS s, l.ends_at AS e, u ->> 'id' AS rid
      FROM workhub.timetable_lessons l CROSS JOIN w CROSS JOIN LATERAL jsonb_array_elements(l.uses) u
     WHERE l.school_id = p_school AND l.state <> 'cancelled' AND l.starts_at < w.hi AND l.ends_at > w.lo
       AND NOT (l.id = ANY (p_skip)) AND NOT EXISTS (SELECT 1 FROM c WHERE c.id = l.id) AND (u ->> 'id') IN (SELECT rid FROM caps)
    UNION ALL SELECT id, s, e, rid FROM cu
  ), ev AS (
    SELECT rid, s AS t, 1 AS d FROM a UNION ALL SELECT rid, e, -1 FROM a
  ), run AS (
    SELECT rid, t, d, sum(d) OVER (PARTITION BY rid ORDER BY t, d ROWS UNBOUNDED PRECEDING) AS n FROM ev
  ), hot AS (
    SELECT DISTINCT run.rid, run.t FROM run JOIN caps ON caps.rid = run.rid WHERE run.d = 1 AND run.n > caps.cap
  )
  SELECT COALESCE(array_agg(DISTINCT cu.id ORDER BY cu.id), ARRAY[]::text[]) FROM cu JOIN hot ON hot.rid = cu.rid AND cu.s <= hot.t AND hot.t < cu.e
$$;

-- 공개판 불가 조건(주간 · 자원 · 요일 · 분)에 걸리는가
CREATE FUNCTION workhub_private.t2_unavailable(p_pub text, p_uses jsonb, p_s timestamptz, p_e timestamptz, p_tz text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM workhub.timetable_publications p CROSS JOIN jsonb_array_elements(p.unavailable) u
     WHERE p.id = p_pub AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_uses) x WHERE x ->> 'id' = u ->> 'resourceId')
       AND (u ->> 'day')::integer = extract(isodow FROM (p_s AT TIME ZONE p_tz))::integer
       AND (u ->> 'startMinute')::integer < extract(epoch FROM ((p_e AT TIME ZONE p_tz) - date_trunc('day', p_s AT TIME ZONE p_tz))) / 60
       AND extract(epoch FROM ((p_s AT TIME ZONE p_tz) - date_trunc('day', p_s AT TIME ZONE p_tz))) / 60 < (u ->> 'endMinute')::integer)
$$;

-- 진행 중 요청이 살아 있는가(저장 상태가 진행 중 · 기한 전 · 묶은 수업 판이 그대로)
CREATE FUNCTION workhub_private.t2_req_stale(p_request text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.timetable_exchange_lessons x JOIN workhub.timetable_lessons l ON l.id = x.lesson_id
                  WHERE x.request_id = p_request AND (l.version <> x.before_version OR l.state <> 'scheduled'))
$$;
CREATE FUNCTION workhub_private.t2_req_live(r workhub.timetable_exchange_requests, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.state IN ('awaiting_consent','awaiting_approval') AND r.expires_at > p_at AND NOT workhub_private.t2_req_stale(r.id)
$$;
-- 이 수업에 살아 있는 요청이 있는가
CREATE FUNCTION workhub_private.t2_lesson_busy(p_school text, p_lesson text, p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.timetable_exchange_lessons x JOIN workhub.timetable_exchange_requests r ON r.id = x.request_id
                  WHERE x.school_id = p_school AND x.lesson_id = p_lesson AND workhub_private.t2_req_live(r, p_at))
$$;

-- 승인 담당(year.manage) 소속 — 알림 대상
CREATE FUNCTION workhub_private.t2_approvers(p_school text, p_today date) RETURNS TABLE (membership_id text, account_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT m.id, m.account_id FROM workhub.memberships m
    JOIN workhub.membership_roles r ON r.school_id = m.school_id AND r.membership_id = m.id
    JOIN workhub.role_permissions rp ON rp.role_code = r.role_code
   WHERE m.school_id = p_school AND m.status = 'active' AND p_today <@ daterange(m.valid_from, m.valid_to, '[)')
     AND r.revoked_at IS NULL AND r.scope_type = 'school' AND rp.permission = 'year.manage' AND p_today <@ daterange(r.valid_from, r.valid_to, '[)')
$$;

-- 시간표 쓰기 순서: 학교 시간표 잠금(T1 과 같은 잠금 — 기준판 확정 · 공개 · 교환 · 학사 변경 · 실시 기록이 한 줄로)
CREATE FUNCTION workhub_private.t2_lock(p_school text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT workhub_private.t1_lock(p_school)
$$;

-- 내부 함수는 API 역할이 실행할 수 없다
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't2\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

INSERT INTO workhub_private.t2_installs (batch, release) VALUES ('T2-01', '2026-10-20.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 9. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'T2-01-1' AS no, '새 표 12개 RLS 켜짐 · API 역할 · PUBLIC 권한 0' AS item,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'workhub' AND c.relkind = 'r' AND c.relrowsecurity AND c.relname IN ('timetable_publications','timetable_lessons',
                     'timetable_lesson_versions','timetable_previews','timetable_preview_pages','timetable_exchange_requests','timetable_exchange_lessons',
                     'timetable_exchange_participants','timetable_school_day_changes','timetable_operation_requests','timetable_execution_records',
                     'timetable_execution_record_versions')) = 12
             AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
                              WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%' AND c.relkind = 'r'
                                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))))
            THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T2-01-2', '내부 함수 t2_* API 역할 실행 불가',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't2\_%'
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't2\_%')
UNION ALL
SELECT 'T2-01-3', '적용 기록 T2-01', CASE WHEN workhub_private.t2_installed('T2-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
