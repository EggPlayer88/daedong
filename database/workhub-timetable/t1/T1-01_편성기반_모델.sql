-- ============================================================================
-- T1-01  시간표 1단계 — 편성 준비 자료 · 기준판 모델 (비활성 설치)
--
-- ▣ 앱 계약: PR #65·#66 (f244f6a) timetable.preparation.v1 · timetable.v1(readiness · get · save_draft)
--   docs/workhub/timetable/preparation-api.md · apps/workhub/src/timetable/{preparation,server,contracts}.ts
--   새 계약 timetable.setup.v1 (공간 정원 · 수업↔학급 연결 입력) — t1/T1_설계_계약.md 3절
-- ▣ 확정 정책(2026-10-18 계란님)
--   1. 주당 시수는 담당자가 준비 초안에 입력하고 기준판에 고정한다. 추정하지 않는다(requiredPeriods 는 항상 null).
--   2. 공간 capacity = 동시에 열 수 있는 수업 수(좌석 수 아님). 담당자가 입력하고, 없으면 1 로 채우지 않는다.
--   3. 수업 ↔ 공식 학급 · 수강집단 연결은 담당자가 ID 로 직접 고른다. 이름 · 학생 반 문자열로 자동 연결하지 않는다.
--   4. 담당자 · 확정 권한 = 기존 year.manage(P5 와 같은 기준). 권한을 새로 넓히지 않는다.
--   5. 확정본 SQL 은 고치지 않는다. R0 의 terms 제약 교체는 별도 파일(T1-02)로 분리한다.
-- ▣ 새로 만드는 것: 표 11개(RLS 켜고 정책 없음 — API 직접 접근 0) · 내부 함수 t1_*
--   이 파일은 기존 표 · 함수 · 제약을 바꾸지 않는다(기존 표에 행도 쓰지 않는다).
-- ▣ 전제: P1 · P2 · P5 · P7 (2026-10-16.1) · P8-01 · P8-04 (2026-10-16.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint; v_stage text;
BEGIN
  FOR v_stage IN SELECT unnest(ARRAY['p1','p2','p5','p7']) LOOP
    IF to_regclass(format('workhub_private.%s_installs', v_stage)) IS NULL THEN
      RAISE EXCEPTION 'T1 중단: %-01·02(2026-10-16.1)를 먼저 적용해 주세요.', upper(v_stage);
    END IF;
    EXECUTE format('SELECT count(*) FROM workhub_private.%s_installs WHERE batch IN (%L, %L) AND release = %L',
                   v_stage, upper(v_stage) || '-01', upper(v_stage) || '-02', '2026-10-16.1') INTO v_n;
    IF v_n <> 2 THEN RAISE EXCEPTION 'T1 중단: %-01·02(2026-10-16.1)를 먼저 적용해 주세요.', upper(v_stage); END IF;
  END LOOP;
  IF to_regclass('workhub_private.p8_installs') IS NULL THEN RAISE EXCEPTION 'T1 중단: P8-01 · P8-04(2026-10-16.1)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch IN ('P8-01','P8-04') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T1 중단: P8-01 · P8-04(2026-10-16.1)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.t1_installs') IS NOT NULL THEN RAISE EXCEPTION 'T1 중단: T1-01 이 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 't1\_%' OR proname LIKE 'workhub\_timetable\_%') THEN
    RAISE EXCEPTION 'T1 중단: 같은 이름의 표 · 함수(timetable_* · t1_* · workhub_timetable_*)가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.t1_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT t1_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT t1_installs_batch_check CHECK (batch IN ('T1-01','T1-02','T1-03')),
  CONSTRAINT t1_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER t1_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.t1_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub_private.t1_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workhub_private.t1_installs FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION workhub_private.t1_installed(p_batch text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = p_batch AND release = '2026-10-18.1')
$$;

-- ----------------------------------------------------------------------------
-- 2. 담당자 입력 자료 — 공간(정원) · 수업 연결(정책 2 · 3)
-- ----------------------------------------------------------------------------
-- 공간 · 장비. capacity = 동시에 열 수 있는 수업 수. NULL = 아직 입력하지 않음(시간표 자료에 넣지 않고 미완성으로 알린다).
CREATE TABLE workhub.timetable_spaces (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  kind                     text NOT NULL,
  label                    text NOT NULL,
  capacity                 integer,
  version                  integer NOT NULL DEFAULT 1,
  removed_at               timestamptz,
  created_by_membership_id text NOT NULL,
  updated_by_membership_id text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_spaces_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_spaces_scope_key UNIQUE (school_id, id),
  CONSTRAINT timetable_spaces_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT timetable_spaces_creator_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_spaces_updater_fkey FOREIGN KEY (school_id, updated_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_spaces_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_spaces_kind_check CHECK (kind IN ('room','equipment')),
  -- 시간표 이름 규칙(제어 문자 없음 · 앞뒤 공백 없음 · 100자 이내)
  CONSTRAINT timetable_spaces_label_check CHECK (length(label) BETWEEN 1 AND 100 AND label !~ '[\x01-\x1f\x7f]'),
  CONSTRAINT timetable_spaces_capacity_check CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 1000),
  CONSTRAINT timetable_spaces_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX timetable_spaces_label_key ON workhub.timetable_spaces (school_id, kind, label) WHERE removed_at IS NULL;

-- 수업 연결(현재 판). 학급과 수강집단은 함께 쓰지 않는다(같은 학생을 두 자원으로 세지 않게).
CREATE TABLE workhub.timetable_course_links (
  school_id                text NOT NULL,
  course_id                text NOT NULL,
  academic_year_id         text NOT NULL,
  student_group            boolean NOT NULL,
  version                  integer NOT NULL DEFAULT 1,
  updated_by_membership_id text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_course_links_pkey PRIMARY KEY (school_id, course_id),
  CONSTRAINT timetable_course_links_course_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.courses(school_id, id),
  CONSTRAINT timetable_course_links_year_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT timetable_course_links_updater_fkey FOREIGN KEY (school_id, updated_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_course_links_version_check CHECK (version > 0)
);
-- 연결한 공식 학급: 같은 학년도의 P1 학급만(복합 FK). 학급이 나중에 빠지면(removed_at) 미완성으로 알린다.
CREATE TABLE workhub.timetable_course_link_classes (
  school_id        text NOT NULL,
  course_id        text NOT NULL,
  academic_year_id text NOT NULL,
  class_id         text NOT NULL,
  CONSTRAINT timetable_course_link_classes_pkey PRIMARY KEY (school_id, course_id, class_id),
  CONSTRAINT timetable_course_link_classes_link_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.timetable_course_links(school_id, course_id),
  CONSTRAINT timetable_course_link_classes_class_fkey FOREIGN KEY (school_id, academic_year_id, class_id)
    REFERENCES workhub.year_classes(school_id, academic_year_id, id)
);
CREATE TABLE workhub.timetable_course_link_spaces (
  school_id text NOT NULL,
  course_id text NOT NULL,
  space_id  text NOT NULL,
  CONSTRAINT timetable_course_link_spaces_pkey PRIMARY KEY (school_id, course_id, space_id),
  CONSTRAINT timetable_course_link_spaces_link_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.timetable_course_links(school_id, course_id),
  CONSTRAINT timetable_course_link_spaces_space_fkey FOREIGN KEY (school_id, space_id) REFERENCES workhub.timetable_spaces(school_id, id)
);
-- 입력 이력(고칠 수 없음): 판마다 담당자가 확정한 값 그대로. 기준판이 어떤 입력으로 만들어졌는지 되짚는 근거.
CREATE TABLE workhub.timetable_setup_history (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  school_id     text NOT NULL,
  target_kind   text NOT NULL,
  target_id     text NOT NULL,
  version       integer NOT NULL,
  state         jsonb NOT NULL,
  membership_id text NOT NULL,
  request_key   text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_setup_history_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_setup_history_version_key UNIQUE (school_id, target_kind, target_id, version),
  CONSTRAINT timetable_setup_history_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_setup_history_kind_check CHECK (target_kind IN ('space','course_link')),
  CONSTRAINT timetable_setup_history_state_check CHECK (jsonb_typeof(state) = 'object')
);
CREATE TRIGGER timetable_setup_history_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_setup_history
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 원본 판 · 준비 초안 · 기준판 · 편성 초안 · 요청 원장
-- ----------------------------------------------------------------------------
-- 원본 판: 학기별로 지문이 바뀔 때마다 판 +1(되돌아가도 새 판). 조회 · 확정이 같은 판인지 비교하는 데만 쓴다.
CREATE TABLE workhub.timetable_source_marks (
  school_id   text NOT NULL,
  term_id     text NOT NULL,
  revision    integer NOT NULL,
  fingerprint text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_source_marks_pkey PRIMARY KEY (school_id, term_id, revision),
  CONSTRAINT timetable_source_marks_term_fkey FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id),
  CONSTRAINT timetable_source_marks_revision_check CHECK (revision > 0),
  CONSTRAINT timetable_source_marks_fp_check CHECK (fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER timetable_source_marks_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_source_marks
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 준비 초안: 학교 · 학기마다 1개(현재 판). 판이 오를 때마다 아래 이력에 그대로 남긴다.
CREATE TABLE workhub.timetable_prep_drafts (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  term_id                  text NOT NULL,
  revision                 integer NOT NULL,
  source_fingerprint       text NOT NULL,
  draft                    jsonb NOT NULL,
  updated_by_membership_id text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_prep_drafts_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_prep_drafts_scope_key UNIQUE (school_id, id),
  CONSTRAINT timetable_prep_drafts_term_key UNIQUE (school_id, term_id),
  CONSTRAINT timetable_prep_drafts_term_fkey FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id),
  CONSTRAINT timetable_prep_drafts_member_fkey FOREIGN KEY (school_id, updated_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_prep_drafts_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_prep_drafts_revision_check CHECK (revision > 0),
  CONSTRAINT timetable_prep_drafts_fp_check CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT timetable_prep_drafts_draft_check CHECK (jsonb_typeof(draft) = 'object')
);
CREATE TABLE workhub.timetable_prep_draft_revisions (
  school_id          text NOT NULL,
  draft_id           text NOT NULL,
  revision           integer NOT NULL,
  kind               text NOT NULL,
  source_fingerprint text NOT NULL,
  draft              jsonb NOT NULL,
  membership_id      text NOT NULL,
  request_key        text NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_prep_draft_revisions_pkey PRIMARY KEY (draft_id, revision),
  CONSTRAINT timetable_prep_draft_revisions_draft_fkey FOREIGN KEY (school_id, draft_id) REFERENCES workhub.timetable_prep_drafts(school_id, id),
  CONSTRAINT timetable_prep_draft_revisions_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_prep_draft_revisions_kind_check CHECK (kind IN ('save','confirm'))
);
CREATE TRIGGER timetable_prep_draft_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_prep_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 기준판(고칠 수 없음). R0 의 terms.current_timetable_basis_id 가 (school_id, id, term_id) 로 가리킨다(T1-02).
-- basis = 앱 TimetableBasis 그대로(배열 순서 포함, K-3). 학기 안에서 판 번호는 1부터.
CREATE TABLE workhub.timetable_basis_revisions (
  id                       text NOT NULL,
  school_id                text NOT NULL,
  term_id                  text NOT NULL,
  revision                 integer NOT NULL,
  source_fingerprint       text NOT NULL,
  basis                    jsonb NOT NULL,
  prep_draft_id            text NOT NULL,
  prep_draft_revision      integer NOT NULL,
  created_by_membership_id text NOT NULL,
  request_key              text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_basis_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_basis_revisions_scope_key UNIQUE (school_id, id, term_id),
  CONSTRAINT timetable_basis_revisions_revision_key UNIQUE (school_id, term_id, revision),
  CONSTRAINT timetable_basis_revisions_term_fkey FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id),
  CONSTRAINT timetable_basis_revisions_prep_fkey FOREIGN KEY (prep_draft_id, prep_draft_revision)
    REFERENCES workhub.timetable_prep_draft_revisions(draft_id, revision),
  CONSTRAINT timetable_basis_revisions_member_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_basis_revisions_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_basis_revisions_revision_check CHECK (revision > 0),
  -- 기준판 본문의 식별 칸이 행과 같아야 한다(다른 학교 · 학기 · 판으로 읽히지 않게)
  CONSTRAINT timetable_basis_revisions_body_check CHECK (jsonb_typeof(basis) = 'object' AND basis ->> 'id' = id AND basis ->> 'schoolId' = school_id
    AND basis ->> 'termId' = term_id AND basis -> 'revision' = to_jsonb(revision) AND basis ->> 'sourceFingerprint' = source_fingerprint
    AND source_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER timetable_basis_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_basis_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 편성 초안(save_draft). 덮어쓰지 않고 새 행(앱 receipt version = 1).
CREATE TABLE workhub.timetable_drafts (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  term_id                  text NOT NULL,
  basis_id                 text NOT NULL,
  basis_revision           integer NOT NULL,
  source_fingerprint       text NOT NULL,
  title                    text NOT NULL,
  conditions               jsonb NOT NULL,
  placements               jsonb NOT NULL,
  created_by_membership_id text NOT NULL,
  request_key              text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_drafts_pkey PRIMARY KEY (id),
  CONSTRAINT timetable_drafts_basis_fkey FOREIGN KEY (school_id, basis_id, term_id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id),
  CONSTRAINT timetable_drafts_member_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_drafts_id_check CHECK (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT timetable_drafts_title_check CHECK (length(title) BETWEEN 1 AND 100),
  CONSTRAINT timetable_drafts_shape_check CHECK (jsonb_typeof(conditions) = 'object' AND jsonb_typeof(placements) = 'array')
);
CREATE INDEX timetable_drafts_basis_idx ON workhub.timetable_drafts (school_id, basis_id, created_at DESC, id);
CREATE TRIGGER timetable_drafts_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_drafts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 요청 원장: 반영된 쓰기만(거절은 남기지 않는다). (학교, 소속, 종류, 요청 번호). response = 앱 접수증(기준판은 ID 로만 — 다시 읽어 붙인다).
CREATE TABLE workhub.timetable_requests (
  school_id     text NOT NULL,
  membership_id text NOT NULL,
  account_id    text NOT NULL,
  op            text NOT NULL,
  request_key   text NOT NULL,
  command_hash  text NOT NULL,
  response      jsonb NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_requests_pkey PRIMARY KEY (school_id, membership_id, op, request_key),
  CONSTRAINT timetable_requests_member_fkey FOREIGN KEY (school_id, membership_id, account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT timetable_requests_op_check CHECK (op IN ('preparation','save_draft','setup')),
  CONSTRAINT timetable_requests_key_check CHECK (request_key ~ '^[A-Za-z0-9_-]{8,200}$'),
  CONSTRAINT timetable_requests_hash_check CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT timetable_requests_response_check CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 8192)
);
CREATE TRIGGER timetable_requests_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub.timetable_spaces','workhub.timetable_course_links','workhub.timetable_course_link_classes',
    'workhub.timetable_course_link_spaces','workhub.timetable_setup_history','workhub.timetable_source_marks','workhub.timetable_prep_drafts',
    'workhub.timetable_prep_draft_revisions','workhub.timetable_basis_revisions','workhub.timetable_drafts','workhub.timetable_requests'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. 공통 — 상수 · 이름 · 학교급 · 대상 학기
-- ----------------------------------------------------------------------------
-- 한도 원본 = packages/timetable/_assets/browser-policy.json (시험이 같은지 대조한다)
CREATE FUNCTION workhub_private.t1_limit(p_name text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_name WHEN 'maxLessons' THEN 1000 WHEN 'maxResources' THEN 3000 WHEN 'maxSlots' THEN 3000 WHEN 'maxDomainEntries' THEN 300000
    WHEN 'maxConditions' THEN 20000 WHEN 'maxCapacity' THEN 1000 WHEN 'maxPeriods' THEN 16 WHEN 'maxCoursePeriods' THEN 1000
    WHEN 'maxWeight' THEN 1000000 WHEN 'maxUnsupported' THEN 100 WHEN 'drafts' THEN 40 END
$$;

-- 시간표 이름: 제어 문자(U+0000~001F · DEL) → 공백, UTF-16 길이 p_max 이내로 자름(보충 평면 글자를 쪼개지 않음),
-- 앱 validateBasis 기준으로 비어 있으면(JS 공백 · U+0085 뿐) 대체 문구. 원본 이름은 바꾸지 않고 내보내는 값만 정리한다.
CREATE FUNCTION workhub_private.t1_label(p text, p_max integer, p_fallback text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN regexp_replace(x, '[\t\n\v\f\r\x20\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g') = '' THEN p_fallback ELSE x END
    FROM (SELECT left(y, p_max - regexp_count(left(y, p_max), '[\U00010000-\U0010FFFF]')) AS x
            FROM (SELECT regexp_replace(COALESCE(p, ''), '[\x01-\x1f\x7f]', ' ', 'g') AS y) a) b
$$;

-- 앱 validateBasis text(): 문자열 · UTF-16 길이 ≤ max · U+0000~001F 없음 · JS 공백(\s 와 같은 목록)과 U+0085 만으로 된 값 아님
CREATE FUNCTION workhub_private.t1_btext(p jsonb, p_max integer DEFAULT 200) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(p #>> '{}') + regexp_count(p #>> '{}', '[\U00010000-\U0010FFFF]') <= p_max
     AND (p #>> '{}') !~ '[\x01-\x1f]'
     AND regexp_replace(p #>> '{}', '[\t\n\v\f\r\x20\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g') <> ''
$$;

-- R0 학교급 → 앱 schoolLevel (elementary → primary, special · other → other)
CREATE FUNCTION workhub_private.t1_level(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p WHEN 'elementary' THEN 'primary' WHEN 'middle' THEN 'middle' WHEN 'high' THEN 'high' ELSE 'other' END
$$;

-- 학교의 시간표 쓰기 잠금(준비 · 입력 · 편성 초안 · 원본 판을 한 줄로)
CREATE FUNCTION workhub_private.t1_lock(p_school text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('workhub.timetable:' || p_school, 0))
$$;

-- 대상 학기: 닫히지 않았고 아직 끝나지 않은 학기 중 오늘이 든 학기, 없으면 가장 먼저 시작하는 다음 학기.
CREATE FUNCTION workhub_private.t1_term(p_school text, p_today date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id FROM workhub.terms t
   WHERE t.school_id = p_school AND t.state <> 'closed' AND t.ends_on > p_today
   ORDER BY (t.starts_on <= p_today) DESC, t.starts_on, t.id LIMIT 1
$$;

-- ----------------------------------------------------------------------------
-- 5. 원본 자료 만들기 — 공식 자료(P1 · P5 · P8) + 담당자 입력(공간 · 연결)
--    결과: core(지문 대상 = 앱 PreparationSource 의 원본 부분) · findings(입력 화면용 미완성 목록) · setup(수업별 입력 상태)
--    기준일 ref = max(학기 시작일, 오늘). 원본에 넣는 담당 · 수강은 그날 유효한 것(P8 종료 사건 반영)이고,
--    남은 학기([ref, 학기 끝)) 안의 변화(담당 교체 · 교사 재직 종료 · 수강 겹침)는 기간 교집합으로 찾아 표현 불가로 알린다.
--    표현할 수 없는 것은 빼고 지나가지 않고 unsupportedFeatures 로 알린다(앱이 확정을 막는다).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_build(p_school text, p_term_id text, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t workhub.terms; y workhub.academic_years; s workhub.schools; v_ref date;
        v_cs jsonb; v_res jsonb; v_courses jsonb; v_find jsonb; v_uns jsonb; v_core jsonb; v_overlap jsonb;
BEGIN
  SELECT * INTO t FROM workhub.terms WHERE school_id = p_school AND id = p_term_id;
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_school AND id = t.academic_year_id;
  SELECT * INTO s FROM workhub.schools WHERE id = p_school;
  v_ref := greatest(t.starts_on, p_today);

  -- 수업별 상태(학기 수업 전부 — 입력 화면은 전부 보여 주고, 원본에는 ref 에 유효한 것만 넣는다)
  WITH co AS (
    SELECT c.id, c.label, c.valid_from, c.valid_to,
           (c.valid_from <= v_ref AND v_ref < c.valid_to) AS active,
           (c.valid_from > v_ref AND c.valid_from < t.ends_on) AS starts_late,
           (c.valid_from <= v_ref AND v_ref < c.valid_to AND c.valid_to < t.ends_on) AS ends_early,
           c.id ~ '^[A-Za-z0-9_-]{1,100}$' AS id_ok
      FROM workhub.courses c WHERE c.school_id = p_school AND c.term_id = t.id
  ), te AS (
    SELECT a.course_id, a.membership_id AS id, workhub_private.t1_label(ac.display_name, 200, '교사') AS label
      FROM workhub.course_assignments a
      JOIN co ON co.id = a.course_id
      JOIN workhub.memberships m ON m.school_id = a.school_id AND m.id = a.membership_id
      JOIN workhub.accounts ac ON ac.id = a.account_id
     WHERE a.school_id = p_school AND a.valid_from <= v_ref
       AND v_ref < workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to)
       AND m.status = 'active' AND v_ref <@ daterange(m.valid_from, m.valid_to, '[)')
  ), tchange AS (   -- 학기 안에서 담당이 바뀌는 수업(새 담당 시작 · 담당 종료) — 주간 기준판 하나로 표현할 수 없다
    SELECT DISTINCT a.course_id FROM workhub.course_assignments a JOIN co ON co.id = a.course_id
     WHERE a.school_id = p_school
       AND ((a.valid_from > v_ref AND a.valid_from < t.ends_on
             AND a.valid_from < workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to))
         OR (a.valid_from <= v_ref AND v_ref < workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to)
             AND workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to) < t.ends_on))
  ), ta AS (       -- 담당마다 남은 학기 구간 A = 담당 실효 기간 ∩ [기준일, 학기 끝), 그중 교사가 재직(소속 active · 소속 기간 안)인 구간 U
    SELECT a.course_id, x.a_from, x.a_to,
           CASE WHEN m.status = 'active' AND m.valid_from IS NOT NULL THEN greatest(x.a_from, m.valid_from) END AS u_from,
           CASE WHEN m.status = 'active' AND m.valid_from IS NOT NULL THEN least(x.a_to, COALESCE(m.valid_to, 'infinity'::date)) END AS u_to
      FROM workhub.course_assignments a JOIN co ON co.id = a.course_id
      JOIN workhub.memberships m ON m.school_id = a.school_id AND m.id = a.membership_id
     CROSS JOIN LATERAL (SELECT greatest(a.valid_from, v_ref) AS a_from,
                                least(workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to), t.ends_on) AS a_to) x
     WHERE a.school_id = p_school
  ), mchange AS (   -- [F2] 남은 학기에 담당이 있는데 교사의 재직 기간이 그 구간을 다 덮지 못함(중도 종료 · 늦은 시작 · 재직 중 아님)
    SELECT DISTINCT ta.course_id FROM ta
     WHERE ta.a_from < ta.a_to
       AND (ta.u_from IS NULL OR ta.u_from >= ta.u_to OR ta.u_from <> ta.a_from OR ta.u_to <> ta.a_to)
  ), cl AS (
    SELECT lc.course_id, yc.id, yc.name, yc.sort_order, yc.removed_at IS NOT NULL AS removed
      FROM workhub.timetable_course_link_classes lc JOIN co ON co.id = lc.course_id
      JOIN workhub.year_classes yc ON yc.school_id = lc.school_id AND yc.academic_year_id = lc.academic_year_id AND yc.id = lc.class_id
     WHERE lc.school_id = p_school
  ), sp AS (
    SELECT ls.course_id, x.id, x.kind, x.label, x.capacity, x.removed_at IS NOT NULL AS removed, x.version
      FROM workhub.timetable_course_link_spaces ls JOIN co ON co.id = ls.course_id
      JOIN workhub.timetable_spaces x ON x.school_id = ls.school_id AND x.id = ls.space_id
     WHERE ls.school_id = p_school
  ), st AS (
    SELECT cm.course_id, count(*) AS n FROM workhub.course_memberships cm JOIN co ON co.id = cm.course_id
     WHERE cm.school_id = p_school AND cm.valid_from <= v_ref
       AND v_ref < workhub_private.p8_eff_to('course_membership', cm.id, cm.valid_from, cm.valid_to)
     GROUP BY cm.course_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', co.id, 'rawLabel', co.label, 'label', workhub_private.t1_label(co.label, 160, '수업'),
           'short', workhub_private.t1_label(co.label, 40, '수업'),
           'active', co.active, 'startsLate', co.starts_late, 'endsEarly', co.ends_early, 'idOk', co.id_ok,
           'teacherChange', EXISTS (SELECT 1 FROM tchange WHERE tchange.course_id = co.id),
           'teacherLeaves', EXISTS (SELECT 1 FROM mchange WHERE mchange.course_id = co.id),
           'teachers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', te.id, 'label', te.label) ORDER BY te.label COLLATE "C", te.id)
                                   FROM (SELECT DISTINCT ON (id) id, label FROM te WHERE te.course_id = co.id ORDER BY id) te), '[]'),
           'link', (SELECT jsonb_build_object('version', l.version, 'studentGroup', l.student_group) FROM workhub.timetable_course_links l
                     WHERE l.school_id = p_school AND l.course_id = co.id),
           'classes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cl.id, 'label', workhub_private.t1_label(cl.name, 200, '학급'), 'removed', cl.removed,
                                                                    'idOk', cl.id ~ '^[A-Za-z0-9_-]{1,100}$') ORDER BY cl.sort_order, cl.id)
                                  FROM cl WHERE cl.course_id = co.id), '[]'),
           'spaces', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sp.id, 'kind', sp.kind, 'label', workhub_private.t1_label(sp.label, 200, '공간'),
                                                                   'capacity', sp.capacity, 'removed', sp.removed) ORDER BY sp.kind, sp.label COLLATE "C", sp.id)
                                 FROM sp WHERE sp.course_id = co.id), '[]'),
           'students', COALESCE((SELECT st.n FROM st WHERE st.course_id = co.id), 0))
         ORDER BY co.label COLLATE "C", co.id), '[]')
    INTO v_cs FROM co;

  -- 수강 학생이 겹치는데 같은 학급 · 수강집단 자원으로 묶이지 않은 수업 쌍(엔진이 충돌을 모른다 → 표현 불가)
  WITH sr AS (   -- 수업마다 학생 쪽 자원(쓸 수 있는 학급 + 수강집단)
    SELECT c ->> 'id' AS course_id, c ->> 'short' AS short,
           ARRAY(SELECT k ->> 'id' FROM jsonb_array_elements(c -> 'classes') k WHERE NOT (k ->> 'removed')::boolean AND (k ->> 'idOk')::boolean)
           || CASE WHEN (c #>> '{link,studentGroup}')::boolean THEN ARRAY['sg_' || (c ->> 'id')] ELSE ARRAY[]::text[] END AS rids
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND (c ->> 'idOk')::boolean
  ), mem AS (   -- [F1] 수강마다 남은 학기 구간(수강 실효 기간 ∩ [기준일, 학기 끝), P8 종료 반영). 기준일 하루만 보지 않는다.
    SELECT cm.course_id, cm.student_id, daterange(x.f, x.t, '[)') AS r
      FROM workhub.course_memberships cm JOIN sr ON sr.course_id = cm.course_id
     CROSS JOIN LATERAL (SELECT greatest(cm.valid_from, v_ref) AS f,
                                least(workhub_private.p8_eff_to('course_membership', cm.id, cm.valid_from, cm.valid_to), t.ends_on) AS t) x
     WHERE cm.school_id = p_school AND x.f < x.t
  ), pairs AS (  -- 같은 학생의 두 수강 구간이 실제로 겹치는 수업 쌍만(앞 수업이 끝난 날 다음 수업이 시작하는 이동은 겹치지 않음)
    SELECT DISTINCT a.course_id AS a_id, b.course_id AS b_id FROM mem a JOIN mem b ON a.student_id = b.student_id AND a.course_id < b.course_id AND a.r && b.r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('a', sa.course_id, 'b', sb.course_id, 'aLabel', sa.short, 'bLabel', sb.short)
                            ORDER BY sa.short COLLATE "C", sb.short COLLATE "C", sa.course_id, sb.course_id), '[]')
    INTO v_overlap
    FROM pairs p JOIN sr sa ON sa.course_id = p.a_id JOIN sr sb ON sb.course_id = p.b_id
   WHERE cardinality(sa.rids) > 0 AND cardinality(sb.rids) > 0 AND NOT (sa.rids && sb.rids);

  -- 미완성 · 표현 불가 목록. blocking = 원본에 unsupportedFeatures 로 넣는 것(앱 확정 차단).
  --   담당 교사 없음 · 학생 연결 없음은 앱 확정 검사가 MISSING_TEACHER · MISSING_STUDENTS 로 막으므로 unsupported 로 겹치지 않는다.
  WITH f AS (
    SELECT 1 AS rk, 'COURSE_ID_UNSUPPORTED' AS code, c ->> 'id' AS target, true AS blocking,
           format('시간표가 다룰 수 없는 수업 ID 형식: %s', c ->> 'short') AS message
      FROM jsonb_array_elements(v_cs) c WHERE NOT (c ->> 'idOk')::boolean AND ((c ->> 'active')::boolean OR (c ->> 'startsLate')::boolean)
    UNION ALL
    SELECT 2, 'COURSE_STARTS_LATER', c ->> 'id', true, format('학기 중에 시작하는 수업: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'startsLate')::boolean
    UNION ALL
    SELECT 3, 'COURSE_ENDS_EARLY', c ->> 'id', true, format('학기 중에 끝나는 수업: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND (c ->> 'endsEarly')::boolean
    UNION ALL
    SELECT 4, 'TEACHER_CHANGES_IN_TERM', c ->> 'id', true, format('학기 중 담당 교사가 바뀌는 수업: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND (c ->> 'teacherChange')::boolean
    UNION ALL
    SELECT 4, 'TEACHER_LEAVES_IN_TERM', c ->> 'id', true, format('담당 교사의 재직 기간이 학기 중에 끝나거나 재직 중이 아닌 수업: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND (c ->> 'teacherLeaves')::boolean
    UNION ALL
    SELECT 5, 'LINK_CLASS_REMOVED', c ->> 'id', true, format('연결한 학급이 학교 구성에서 빠짐: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'classes') k WHERE (k ->> 'removed')::boolean OR NOT (k ->> 'idOk')::boolean)
    UNION ALL
    SELECT 6, 'LINK_SPACE_REMOVED', c ->> 'id', true, format('연결한 공간이 삭제됨: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'spaces') k WHERE (k ->> 'removed')::boolean)
    UNION ALL
    SELECT 7, 'SPACE_CAPACITY_MISSING', k ->> 'id', true, format('동시 수업 수가 입력되지 않은 공간: %s', workhub_private.t1_label(k ->> 'label', 40, '공간'))
      FROM (SELECT DISTINCT k FROM jsonb_array_elements(v_cs) c, jsonb_array_elements(c -> 'spaces') k
             WHERE (c ->> 'active')::boolean AND NOT (k ->> 'removed')::boolean AND k -> 'capacity' = 'null'::jsonb) z
    UNION ALL
    SELECT 8, 'STUDENT_OVERLAP', (o ->> 'a') || '/' || (o ->> 'b'), true,
           format('수강 학생이 겹치지만 같은 학급·수강집단으로 묶이지 않은 수업: %s · %s', o ->> 'aLabel', o ->> 'bLabel')
      FROM jsonb_array_elements(v_overlap) o
    UNION ALL
    SELECT 20, 'COURSE_TEACHER_MISSING', c ->> 'id', false, format('담당 교사가 없는 수업: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND jsonb_array_length(c -> 'teachers') = 0
    UNION ALL
    SELECT 21, 'COURSE_LINK_MISSING', c ->> 'id', false, format('학급 또는 수강집단을 연결하지 않은 수업: %s', c ->> 'short')
      FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND NOT COALESCE((c #>> '{link,studentGroup}')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'classes') k WHERE NOT (k ->> 'removed')::boolean AND (k ->> 'idOk')::boolean)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'targetId', target, 'blocking', blocking,
                                               'message', workhub_private.t1_label(message, 200, code))
                            ORDER BY rk, message COLLATE "C", target), '[]')
    INTO v_find FROM f;

  -- unsupportedFeatures: blocking 문구(같은 문구는 하나로) · 최대 100개(넘으면 99개 + 남은 수)
  WITH u AS (SELECT x ->> 'message' AS m, min(o) AS o FROM jsonb_array_elements(v_find) WITH ORDINALITY z(x, o)
              WHERE (x ->> 'blocking')::boolean GROUP BY 1),
       n AS (SELECT count(*) AS c FROM u)
  SELECT CASE WHEN (SELECT c FROM n) <= 100 THEN COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY o) FROM u), '[]')
              ELSE (SELECT jsonb_agg(to_jsonb(m) ORDER BY o) FROM (SELECT m, o FROM u ORDER BY o LIMIT 99) z)
                   || jsonb_build_array(format('그 밖에 표현할 수 없는 조건 %s건(시간표 준비 자료 입력 화면에서 확인)', (SELECT c FROM n) - 99)) END
    INTO v_uns;

  -- 자원: 교사 → 학급 → 수강집단 → 공간(정원 입력된 것만). 같은 종류 안에서는 이름(C 정렬) · ID 순. ID 형식이 맞지 않으면 빼고 위에서 알렸다.
  WITH ac AS (SELECT c FROM jsonb_array_elements(v_cs) c WHERE (c ->> 'active')::boolean AND (c ->> 'idOk')::boolean),
  r AS (
    SELECT 1 AS rk, k ->> 'id' AS id, 'teacher' AS kind, k ->> 'label' AS label, 1 AS capacity, 0 AS so
      FROM ac, jsonb_array_elements(ac.c -> 'teachers') k WHERE k ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$'
    UNION
    SELECT 2, k ->> 'id', 'class', k ->> 'label', 1, 0
      FROM ac, jsonb_array_elements(ac.c -> 'classes') k WHERE NOT (k ->> 'removed')::boolean AND (k ->> 'idOk')::boolean
    UNION
    SELECT 3, 'sg_' || (ac.c ->> 'id'), 'student_group', workhub_private.t1_label((ac.c ->> 'rawLabel') || ' 수강집단', 200, '수강집단'), 1, 0
      FROM ac WHERE (ac.c #>> '{link,studentGroup}')::boolean AND length(ac.c ->> 'id') <= 97
    UNION
    SELECT 4, k ->> 'id', k ->> 'kind', k ->> 'label', (k ->> 'capacity')::integer, 0
      FROM ac, jsonb_array_elements(ac.c -> 'spaces') k WHERE NOT (k ->> 'removed')::boolean AND k -> 'capacity' <> 'null'::jsonb
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label, 'capacity', r.capacity)
                            ORDER BY r.rk, r.kind, r.label COLLATE "C", r.id), '[]')
    INTO v_res FROM r;
  -- 수업: ref 에 유효한 것. resourceIds = 교사 · 학급 · 수강집단 · 공간(자원 목록에 실제로 든 것만, 같은 순서 규칙)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c ->> 'id', 'label', c ->> 'label', 'requiredPeriods', NULL,
           'resourceIds', COALESCE((SELECT jsonb_agg(to_jsonb(x.id) ORDER BY x.o)
                                      FROM (SELECT r ->> 'id' AS id, o FROM jsonb_array_elements(v_res) WITH ORDINALITY q(r, o)
                                             WHERE r ->> 'id' IN (SELECT k ->> 'id' FROM jsonb_array_elements(c -> 'teachers') k
                                                                  UNION ALL SELECT k ->> 'id' FROM jsonb_array_elements(c -> 'classes') k
                                                                             WHERE NOT (k ->> 'removed')::boolean
                                                                  UNION ALL SELECT 'sg_' || (c ->> 'id') WHERE (c #>> '{link,studentGroup}')::boolean
                                                                  UNION ALL SELECT k ->> 'id' FROM jsonb_array_elements(c -> 'spaces') k
                                                                             WHERE NOT (k ->> 'removed')::boolean)) x), '[]'))
         ORDER BY ord), '[]')
    INTO v_courses
    FROM jsonb_array_elements(v_cs) WITH ORDINALITY z(c, ord) WHERE (c ->> 'active')::boolean AND (c ->> 'idOk')::boolean;

  v_core := jsonb_build_object('schoolId', p_school, 'schoolLevel', workhub_private.t1_level(s.school_level), 'termId', t.id,
    'termLabel', workhub_private.t1_label(y.school_year || '학년도 ' || t.label, 120, '학기'),
    'firstDay', to_char(t.starts_on, 'YYYY-MM-DD'), 'lastDay', to_char(t.ends_on - 1, 'YYYY-MM-DD'),
    'resources', v_res, 'courses', v_courses, 'unsupportedFeatures', v_uns);
  RETURN jsonb_build_object('core', v_core, 'fingerprint', workhub_private.p2_sha(v_core), 'findings', v_find, 'courses', v_cs,
                            'refDay', to_char(v_ref, 'YYYY-MM-DD'), 'academicYearId', t.academic_year_id);
END $$;

-- 원본 판: 지문이 마지막 판과 다르면 새 판(학교 잠금 안에서)
CREATE FUNCTION workhub_private.t1_mark(p_school text, p_term text, p_fp text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_source_marks;
BEGIN
  PERFORM workhub_private.t1_lock(p_school);
  SELECT * INTO r FROM workhub.timetable_source_marks WHERE school_id = p_school AND term_id = p_term ORDER BY revision DESC LIMIT 1;
  IF r.revision IS NOT NULL AND r.fingerprint = p_fp THEN RETURN r.revision; END IF;
  INSERT INTO workhub.timetable_source_marks (school_id, term_id, revision, fingerprint)
  VALUES (p_school, p_term, COALESCE(r.revision, 0) + 1, p_fp) RETURNING * INTO r;
  RETURN r.revision;
END $$;

-- ----------------------------------------------------------------------------
-- 6. 앱 검사 이식 — validateBasis · validatePlacements · reviewTimetableFoundation · preparationDraft · compilePreparation
--    (packages/timetable/src/validate.ts · apps/workhub/src/timetable/{foundation,preparation}.ts f244f6a)
--    결과는 문제 코드 배열(빈 배열 = 통과). 첫 구조 오류에서 멈춘다 — 통과/거절은 앱과 같고 코드 목록은 진단용이다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_ids(p jsonb, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- 식별자 배열: 배열 · 개수 한도 · 모두 앱 identifier · 중복 없음
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= p_max
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) x WHERE NOT workhub_private.p7_id(x))
     AND (SELECT count(DISTINCT x) FROM jsonb_array_elements(p) x) = jsonb_array_length(p)
$$;

CREATE FUNCTION workhub_private.t1_basis_issues(b jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_n bigint;
BEGIN
  IF NOT workhub_private.p2_exact(b, ARRAY['schemaVersion','id','revision','schoolId','termId','sourceFingerprint','schoolLevel','unsupportedFeatures',
                                           'resources','slots','lessons','courseLoads','fixed','unavailable','preferences']) THEN RETURN ARRAY['INVALID_OBJECT']; END IF;
  IF b -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RETURN ARRAY['UNSUPPORTED_VERSION']; END IF;
  IF NOT (workhub_private.p7_id(b -> 'id') AND workhub_private.p7_id(b -> 'schoolId') AND workhub_private.p7_id(b -> 'termId')) THEN RETURN ARRAY['INVALID_ID']; END IF;
  IF NOT workhub_private.p2_int(b -> 'revision', 1, 9007199254740991) THEN RETURN ARRAY['INVALID_NUMBER']; END IF;
  IF NOT workhub_private.p5_hash(b -> 'sourceFingerprint') THEN RETURN ARRAY['INVALID_FINGERPRINT']; END IF;
  IF jsonb_typeof(b -> 'schoolLevel') IS DISTINCT FROM 'string' OR b ->> 'schoolLevel' NOT IN ('primary','middle','high','other') THEN RETURN ARRAY['INVALID_SCHOOL_LEVEL']; END IF;
  -- 지원 불가 목록
  IF jsonb_typeof(b -> 'unsupportedFeatures') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'unsupportedFeatures') > 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'unsupportedFeatures') x WHERE NOT workhub_private.t1_btext(x))
     OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(b -> 'unsupportedFeatures') x) <> jsonb_array_length(b -> 'unsupportedFeatures') THEN
    RETURN ARRAY['INVALID_UNSUPPORTED'];
  END IF;
  -- 자원
  IF jsonb_typeof(b -> 'resources') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'resources') > workhub_private.t1_limit('maxResources') THEN RETURN ARRAY['INVALID_ARRAY']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'resources') r
              WHERE NOT workhub_private.p2_exact(r, ARRAY['id','kind','label','capacity']) OR NOT workhub_private.p7_id(r -> 'id')
                 OR NOT workhub_private.t1_btext(r -> 'label') OR jsonb_typeof(r -> 'kind') IS DISTINCT FROM 'string'
                 OR r ->> 'kind' NOT IN ('teacher','class','student_group','room','equipment')
                 OR NOT workhub_private.p2_int(r -> 'capacity', 1, workhub_private.t1_limit('maxCapacity'))
                 OR (r ->> 'kind' IN ('teacher','class','student_group') AND r -> 'capacity' <> '1'::jsonb)) THEN
    RETURN ARRAY['INVALID_RESOURCE'];
  END IF;
  IF (SELECT count(DISTINCT r ->> 'id') FROM jsonb_array_elements(b -> 'resources') r) <> jsonb_array_length(b -> 'resources') THEN RETURN ARRAY['DUPLICATE_ID']; END IF;
  -- 시간대
  IF jsonb_typeof(b -> 'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'slots') > workhub_private.t1_limit('maxSlots') THEN RETURN ARRAY['INVALID_ARRAY']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'slots') r
              WHERE NOT workhub_private.p2_exact(r, ARRAY['id','day','label','startMinute','endMinute','periods']) OR NOT workhub_private.p7_id(r -> 'id')
                 OR NOT workhub_private.t1_btext(r -> 'label') OR NOT workhub_private.p2_int(r -> 'day', 1, 7)
                 OR NOT workhub_private.p2_int(r -> 'startMinute', 0, 1439) OR NOT workhub_private.p2_int(r -> 'endMinute', 1, 1440)
                 OR NOT workhub_private.p2_int(r -> 'periods', 1, workhub_private.t1_limit('maxPeriods'))
                 OR (r ->> 'startMinute')::integer >= (r ->> 'endMinute')::integer) THEN
    RETURN ARRAY['INVALID_SLOT'];
  END IF;
  IF (SELECT count(DISTINCT r ->> 'id') FROM jsonb_array_elements(b -> 'slots') r) <> jsonb_array_length(b -> 'slots') THEN RETURN ARRAY['DUPLICATE_ID']; END IF;
  -- 수업 활동
  IF jsonb_typeof(b -> 'lessons') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'lessons') > workhub_private.t1_limit('maxLessons') THEN RETURN ARRAY['INVALID_ARRAY']; END IF;
  IF jsonb_array_length(b -> 'lessons') = 0 THEN RETURN ARRAY['EMPTY_LESSONS']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') r
              WHERE NOT workhub_private.p2_exact(r, ARRAY['id','courseId','label','periods','resourceIds','allowedSlotIds']) OR NOT workhub_private.p7_id(r -> 'id')
                 OR NOT workhub_private.t1_btext(r -> 'label') OR NOT workhub_private.p7_id(r -> 'courseId')
                 OR NOT workhub_private.p2_int(r -> 'periods', 1, workhub_private.t1_limit('maxPeriods'))
                 OR NOT workhub_private.t1_ids(r -> 'resourceIds', workhub_private.t1_limit('maxResources'))
                 OR NOT workhub_private.t1_ids(r -> 'allowedSlotIds', workhub_private.t1_limit('maxSlots'))) THEN
    RETURN ARRAY['INVALID_LESSON'];
  END IF;
  IF (SELECT count(DISTINCT r ->> 'id') FROM jsonb_array_elements(b -> 'lessons') r) <> jsonb_array_length(b -> 'lessons') THEN RETURN ARRAY['DUPLICATE_ID']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') r WHERE jsonb_array_length(r -> 'resourceIds') = 0) THEN RETURN ARRAY['EMPTY_RESOURCES']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') r WHERE jsonb_array_length(r -> 'allowedSlotIds') = 0) THEN RETURN ARRAY['EMPTY_ALLOWED_SLOTS']; END IF;
  SELECT sum(jsonb_array_length(r -> 'allowedSlotIds')) INTO v_n FROM jsonb_array_elements(b -> 'lessons') r;
  IF v_n > workhub_private.t1_limit('maxDomainEntries') THEN RETURN ARRAY['INPUT_LIMIT']; END IF;
  -- 참조: 자원 존재 · 교사 · 학생 쪽 자원 · 시간대 존재와 차시 일치
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l, jsonb_array_elements_text(l -> 'resourceIds') x
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'resources') r WHERE r ->> 'id' = x)) THEN RETURN ARRAY['UNKNOWN_RESOURCE']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(l -> 'resourceIds') x JOIN jsonb_array_elements(b -> 'resources') r ON r ->> 'id' = x
                                 WHERE r ->> 'kind' = 'teacher')) THEN RETURN ARRAY['MISSING_TEACHER']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(l -> 'resourceIds') x JOIN jsonb_array_elements(b -> 'resources') r ON r ->> 'id' = x
                                 WHERE r ->> 'kind' IN ('class','student_group'))) THEN RETURN ARRAY['MISSING_STUDENTS']; END IF;
  IF EXISTS (WITH s AS (SELECT r ->> 'id' AS id, (r ->> 'periods')::integer AS periods FROM jsonb_array_elements(b -> 'slots') r)
             SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l CROSS JOIN LATERAL jsonb_array_elements_text(l -> 'allowedSlotIds') x
               LEFT JOIN s ON s.id = x WHERE s.id IS NULL OR s.periods <> (l ->> 'periods')::integer) THEN
    RETURN ARRAY['UNKNOWN_OR_MISMATCHED_SLOT'];
  END IF;
  -- 수업별 기준 시수
  IF jsonb_typeof(b -> 'courseLoads') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'courseLoads') > workhub_private.t1_limit('maxLessons') THEN RETURN ARRAY['INVALID_ARRAY']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'courseLoads') r
              WHERE NOT workhub_private.p2_exact(r, ARRAY['courseId','periods']) OR NOT workhub_private.p7_id(r -> 'courseId')
                 OR NOT workhub_private.p2_int(r -> 'periods', 1, workhub_private.t1_limit('maxCoursePeriods'))) THEN RETURN ARRAY['INVALID_COURSE_LOAD']; END IF;
  IF (SELECT count(DISTINCT r ->> 'courseId') FROM jsonb_array_elements(b -> 'courseLoads') r) <> jsonb_array_length(b -> 'courseLoads') THEN RETURN ARRAY['DUPLICATE_COURSE']; END IF;
  IF EXISTS (WITH sums AS (SELECT l ->> 'courseId' AS c, sum((l ->> 'periods')::integer) AS n FROM jsonb_array_elements(b -> 'lessons') l GROUP BY 1)
             SELECT 1 FROM jsonb_array_elements(b -> 'courseLoads') r LEFT JOIN sums ON sums.c = r ->> 'courseId'
              WHERE sums.n IS DISTINCT FROM (r ->> 'periods')::bigint) THEN RETURN ARRAY['COURSE_LOAD_MISMATCH']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'courseLoads') r WHERE r ->> 'courseId' = l ->> 'courseId')) THEN
    RETURN ARRAY['MISSING_COURSE_LOAD'];
  END IF;
  -- 고정 · 선호(수업 · 시간대 존재, 허용 시간대 안)
  IF jsonb_typeof(b -> 'fixed') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'fixed') > workhub_private.t1_limit('maxLessons')
     OR jsonb_typeof(b -> 'preferences') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'preferences') > workhub_private.t1_limit('maxConditions')
     OR jsonb_typeof(b -> 'unavailable') IS DISTINCT FROM 'array' OR jsonb_array_length(b -> 'unavailable') > workhub_private.t1_limit('maxConditions') THEN
    RETURN ARRAY['INVALID_ARRAY'];
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'fixed') r WHERE NOT workhub_private.p2_exact(r, ARRAY['lessonId','slotId'])
                OR NOT workhub_private.p7_id(r -> 'lessonId') OR NOT workhub_private.p7_id(r -> 'slotId'))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'preferences') r WHERE NOT workhub_private.p2_exact(r, ARRAY['lessonId','slotId','weight'])
                OR NOT workhub_private.p7_id(r -> 'lessonId') OR NOT workhub_private.p7_id(r -> 'slotId')
                OR NOT workhub_private.p2_int(r -> 'weight', 0, workhub_private.t1_limit('maxWeight'))) THEN
    RETURN ARRAY['INVALID_CONDITION'];
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT r FROM jsonb_array_elements(b -> 'fixed') r UNION ALL SELECT r FROM jsonb_array_elements(b -> 'preferences') r) q
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l WHERE l ->> 'id' = q.r ->> 'lessonId')
                 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'slots') s WHERE s ->> 'id' = q.r ->> 'slotId')
                 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l WHERE l ->> 'id' = q.r ->> 'lessonId'
                                   AND l -> 'allowedSlotIds' @> jsonb_build_array(q.r ->> 'slotId'))) THEN
    RETURN ARRAY['UNKNOWN_OR_NOT_ALLOWED'];
  END IF;
  IF (SELECT count(DISTINCT r ->> 'lessonId') FROM jsonb_array_elements(b -> 'fixed') r) <> jsonb_array_length(b -> 'fixed') THEN RETURN ARRAY['DUPLICATE_FIXED']; END IF;
  IF (SELECT count(DISTINCT (r ->> 'lessonId', r ->> 'slotId')) FROM jsonb_array_elements(b -> 'preferences') r) <> jsonb_array_length(b -> 'preferences') THEN
    RETURN ARRAY['DUPLICATE_PREFERENCE'];
  END IF;
  -- 사용 불가 시간
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'unavailable') r
              WHERE NOT workhub_private.p2_exact(r, ARRAY['resourceId','day','startMinute','endMinute']) OR NOT workhub_private.p7_id(r -> 'resourceId')
                 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'resources') x WHERE x ->> 'id' = r ->> 'resourceId')
                 OR NOT workhub_private.p2_int(r -> 'day', 1, 7) OR NOT workhub_private.p2_int(r -> 'startMinute', 0, 1439)
                 OR NOT workhub_private.p2_int(r -> 'endMinute', 1, 1440) OR (r ->> 'startMinute')::integer >= (r ->> 'endMinute')::integer) THEN
    RETURN ARRAY['INVALID_UNAVAILABLE'];
  END IF;
  RETURN ARRAY[]::text[];
END $$;

-- 앱 intervalPeriodCapacity: 겹치지 않게 고를 수 있는 시간대들의 최대 차시 합(가중 구간 스케줄링)
CREATE FUNCTION workhub_private.t1_interval_capacity(p_starts integer[], p_ends integer[], p_periods integer[]) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s integer[]; e integer[]; w integer[]; best integer[] := ARRAY[0]; n integer; i integer; lo integer; hi integer; mid integer;
BEGIN
  SELECT array_agg(a ORDER BY b, a, o), array_agg(b ORDER BY b, a, o), array_agg(c ORDER BY b, a, o)
    INTO s, e, w FROM unnest(p_starts, p_ends, p_periods) WITH ORDINALITY u(a, b, c, o);
  n := COALESCE(cardinality(s), 0);
  FOR i IN 1..n LOOP
    lo := 0; hi := i - 1;
    WHILE lo < hi LOOP
      mid := (lo + hi + 1) / 2;
      IF e[mid] <= s[i] THEN lo := mid; ELSE hi := mid - 1; END IF;
    END LOOP;
    best := best || greatest(best[i], w[i] + best[lo + 1]);
  END LOOP;
  RETURN best[n + 1];
END $$;

-- 앱 reviewTimetableFoundation 의 준비 완료 판정(b 는 t1_basis_issues 를 통과한 기준판)
--   교사 · 학급 · 수강집단마다: 그 자원의 활동이 쓸 수 있는 시간대(사용 불가와 겹치는 것 제외)로 날마다 넣을 수 있는 최대 차시 합 ≥ 배정 차시.
--   지원 불가 조건이 하나라도 있으면 준비 완료가 아니다.
CREATE FUNCTION workhub_private.t1_foundation_ready(b jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE r record; v_cap integer; v_day integer;
BEGIN
  IF jsonb_array_length(b -> 'unsupportedFeatures') > 0 THEN RETURN false; END IF;
  FOR r IN SELECT x ->> 'id' AS id FROM jsonb_array_elements(b -> 'resources') x WHERE x ->> 'kind' IN ('teacher','class','student_group') LOOP
    v_cap := 0;
    FOR v_day IN SELECT DISTINCT (s ->> 'day')::integer FROM jsonb_array_elements(b -> 'slots') s LOOP
      v_cap := v_cap + COALESCE((
        SELECT workhub_private.t1_interval_capacity(array_agg((s ->> 'startMinute')::integer), array_agg((s ->> 'endMinute')::integer),
                                                    array_agg((s ->> 'periods')::integer))
          FROM jsonb_array_elements(b -> 'slots') s
         WHERE (s ->> 'day')::integer = v_day
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l
                        WHERE l -> 'resourceIds' @> jsonb_build_array(r.id) AND l -> 'allowedSlotIds' @> jsonb_build_array(s ->> 'id'))
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'unavailable') u
                            WHERE u ->> 'resourceId' = r.id AND (u ->> 'day')::integer = v_day
                              AND (u ->> 'startMinute')::integer < (s ->> 'endMinute')::integer
                              AND (s ->> 'startMinute')::integer < (u ->> 'endMinute')::integer)), 0);
    END LOOP;
    IF (SELECT COALESCE(sum((l ->> 'periods')::integer), 0) FROM jsonb_array_elements(b -> 'lessons') l
         WHERE l -> 'resourceIds' @> jsonb_build_array(r.id)) > v_cap THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 앱 validatePlacements(b 는 통과한 기준판 + 조건). 문제 코드 배열.
CREATE FUNCTION workhub_private.t1_placement_issues(b jsonb, p jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE c text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_array_length(b -> 'unsupportedFeatures') > 0 THEN RETURN ARRAY['UNSUPPORTED_FEATURE']; END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > workhub_private.t1_limit('maxLessons') THEN RETURN ARRAY['INVALID_PLACEMENTS']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p) x WHERE NOT workhub_private.p2_exact(x, ARRAY['lessonId','slotId'])
                OR jsonb_typeof(x -> 'lessonId') <> 'string' OR jsonb_typeof(x -> 'slotId') <> 'string') THEN RETURN ARRAY['INVALID_PLACEMENT']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p) x
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l WHERE l ->> 'id' = x ->> 'lessonId')
                 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'slots') s WHERE s ->> 'id' = x ->> 'slotId')) THEN RETURN ARRAY['UNKNOWN_PLACEMENT']; END IF;
  IF (SELECT count(DISTINCT x ->> 'lessonId') FROM jsonb_array_elements(p) x) <> jsonb_array_length(p) THEN c := array_append(c, 'DUPLICATE_LESSON'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p) x JOIN jsonb_array_elements(b -> 'lessons') l ON l ->> 'id' = x ->> 'lessonId'
               JOIN jsonb_array_elements(b -> 'slots') s ON s ->> 'id' = x ->> 'slotId'
              WHERE NOT (l -> 'allowedSlotIds' @> jsonb_build_array(x ->> 'slotId')) OR s -> 'periods' <> l -> 'periods') THEN c := array_append(c, 'ILLEGAL_SLOT'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p) x JOIN jsonb_array_elements(b -> 'fixed') f ON f ->> 'lessonId' = x ->> 'lessonId'
              WHERE f ->> 'slotId' <> x ->> 'slotId') THEN c := array_append(c, 'FIXED_VIOLATION'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p) x JOIN jsonb_array_elements(b -> 'lessons') l ON l ->> 'id' = x ->> 'lessonId'
               JOIN jsonb_array_elements(b -> 'slots') s ON s ->> 'id' = x ->> 'slotId'
               CROSS JOIN LATERAL jsonb_array_elements_text(l -> 'resourceIds') rid
               JOIN jsonb_array_elements(b -> 'unavailable') u ON u ->> 'resourceId' = rid
              WHERE (u ->> 'day')::integer = (s ->> 'day')::integer AND (s ->> 'startMinute')::integer < (u ->> 'endMinute')::integer
                AND (u ->> 'startMinute')::integer < (s ->> 'endMinute')::integer) THEN c := array_append(c, 'UNAVAILABLE'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'lessons') l
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) x WHERE x ->> 'lessonId' = l ->> 'id')) THEN c := array_append(c, 'MISSING_LESSON'); END IF;
  IF EXISTS (WITH a AS (SELECT l ->> 'courseId' AS cid, sum((l ->> 'periods')::integer) AS n
                          FROM jsonb_array_elements(p) x JOIN jsonb_array_elements(b -> 'lessons') l ON l ->> 'id' = x ->> 'lessonId' GROUP BY 1)
             SELECT 1 FROM jsonb_array_elements(b -> 'courseLoads') r LEFT JOIN a ON a.cid = r ->> 'courseId'
              WHERE a.n IS DISTINCT FROM (r ->> 'periods')::bigint) THEN c := array_append(c, 'COURSE_LOAD_MISMATCH'); END IF;
  -- 자원별 실제 시각 겹침: 끝(-1)을 같은 시각의 시작(+1)보다 먼저 센다(앱 정렬 day · time · delta)
  IF EXISTS (WITH ev AS (
               SELECT rid, (s ->> 'day')::integer AS day, (s ->> 'startMinute')::integer AS tm, 1 AS delta
                 FROM jsonb_array_elements(p) x JOIN jsonb_array_elements(b -> 'lessons') l ON l ->> 'id' = x ->> 'lessonId'
                 JOIN jsonb_array_elements(b -> 'slots') s ON s ->> 'id' = x ->> 'slotId' CROSS JOIN LATERAL jsonb_array_elements_text(l -> 'resourceIds') rid
               UNION ALL
               SELECT rid, (s ->> 'day')::integer, (s ->> 'endMinute')::integer, -1
                 FROM jsonb_array_elements(p) x JOIN jsonb_array_elements(b -> 'lessons') l ON l ->> 'id' = x ->> 'lessonId'
                 JOIN jsonb_array_elements(b -> 'slots') s ON s ->> 'id' = x ->> 'slotId' CROSS JOIN LATERAL jsonb_array_elements_text(l -> 'resourceIds') rid),
             run AS (SELECT rid, sum(delta) OVER (PARTITION BY rid, day ORDER BY tm, delta ROWS UNBOUNDED PRECEDING) AS cnt FROM ev)
             SELECT 1 FROM run JOIN jsonb_array_elements(b -> 'resources') r ON r ->> 'id' = run.rid
              WHERE run.cnt > (r ->> 'capacity')::integer) THEN c := array_append(c, 'RESOURCE_COLLISION'); END IF;
  RETURN c;
END $$;

-- 앱 preparationDraft(d, source): 미완성 초안도 저장 가능, 구조 · 참조는 검사. p_src NULL 이면 원본 대조 없이(복구 확인용).
CREATE FUNCTION workhub_private.t1_draft_ok(d jsonb, p_src jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT workhub_private.p2_exact(d, ARRAY['title','slots','plans']) OR NOT workhub_private.p7_text(d -> 'title', 120, true) THEN RETURN false; END IF;
  IF jsonb_typeof(d -> 'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(d -> 'slots') > workhub_private.t1_limit('maxSlots')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'slots') x
                 WHERE NOT workhub_private.p2_exact(x, ARRAY['id','day','label','startMinute','endMinute','periods']) OR NOT workhub_private.p7_id(x -> 'id')
                    OR NOT workhub_private.p7_text(x -> 'label', 100, true) OR NOT workhub_private.p2_int(x -> 'day', 1, 7)
                    OR NOT workhub_private.p2_int(x -> 'startMinute', 0, 1439) OR NOT workhub_private.p2_int(x -> 'endMinute', 1, 1440)
                    OR NOT workhub_private.p2_int(x -> 'periods', 1, workhub_private.t1_limit('maxPeriods'))
                    OR (x ->> 'startMinute')::integer >= (x ->> 'endMinute')::integer)
     OR (SELECT count(DISTINCT x ->> 'id') FROM jsonb_array_elements(d -> 'slots') x) <> jsonb_array_length(d -> 'slots') THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(d -> 'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(d -> 'plans') > workhub_private.t1_limit('maxLessons')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'plans') x
                 WHERE NOT workhub_private.p2_exact(x, ARRAY['courseId','weeklyPeriods','blocks']) OR NOT workhub_private.p7_id(x -> 'courseId')
                    OR NOT workhub_private.p2_int(x -> 'weeklyPeriods', 0, workhub_private.t1_limit('maxCoursePeriods'))
                    OR jsonb_typeof(x -> 'blocks') IS DISTINCT FROM 'array' OR jsonb_array_length(x -> 'blocks') > workhub_private.t1_limit('maxCoursePeriods'))
     OR (SELECT count(DISTINCT x ->> 'courseId') FROM jsonb_array_elements(d -> 'plans') x) <> jsonb_array_length(d -> 'plans') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'plans') x, jsonb_array_elements(x -> 'blocks') k
              WHERE NOT workhub_private.p2_exact(k, ARRAY['id','periods','allowedSlotIds']) OR NOT workhub_private.p7_id(k -> 'id')
                 OR NOT workhub_private.p2_int(k -> 'periods', 1, workhub_private.t1_limit('maxPeriods'))
                 OR NOT workhub_private.t1_ids(k -> 'allowedSlotIds', workhub_private.t1_limit('maxSlots'))) THEN
    RETURN false;
  END IF;
  -- 활동 ID 전체 중복 없음 · 개수 한도 · 허용 시간대는 있는 시간대이고 차시가 같음
  IF (SELECT count(*) FROM jsonb_array_elements(d -> 'plans') x, jsonb_array_elements(x -> 'blocks') k) > workhub_private.t1_limit('maxLessons')
     OR (SELECT count(DISTINCT k ->> 'id') FROM jsonb_array_elements(d -> 'plans') x, jsonb_array_elements(x -> 'blocks') k)
        <> (SELECT count(*) FROM jsonb_array_elements(d -> 'plans') x, jsonb_array_elements(x -> 'blocks') k)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'plans') x, jsonb_array_elements(x -> 'blocks') k, jsonb_array_elements_text(k -> 'allowedSlotIds') a
                 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'slots') s WHERE s ->> 'id' = a AND s -> 'periods' = k -> 'periods')) THEN
    RETURN false;
  END IF;
  -- 원본 대조: 원본 수업마다 정확히 하나의 plan · 공식 시수가 있으면 같은 값(이 단계에서는 항상 null)
  IF p_src IS NOT NULL AND (
       jsonb_array_length(d -> 'plans') <> jsonb_array_length(p_src -> 'courses')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'plans') x
                   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_src -> 'courses') c WHERE c ->> 'id' = x ->> 'courseId'
                                        AND (c -> 'requiredPeriods' = 'null'::jsonb OR c -> 'requiredPeriods' = x -> 'weeklyPeriods')))) THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

-- 앱 compilePreparation(source, draft, basisId, revision). 통과하면 기준판, 아니면 NULL. d 는 t1_draft_ok(d, src) 를 통과한 초안.
--   배열 순서(K-3): resources · unsupportedFeatures = 원본 순서, slots = 초안 순서, courseLoads · lessons = plans 순서(활동은 blocks 순서),
--   활동 이름 = 원본 수업 이름 + ' ' + plan 안 순번 + '회'. 다시 정렬하지 않는다(WITH ORDINALITY).
CREATE FUNCTION workhub_private.t1_compile(p_src jsonb, d jsonb, p_basis_id text, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_basis jsonb;
BEGIN
  -- 수업별: 주간 시수 0 이 아니고 활동 차시 합과 같음 · 담당 교사 · 학급 또는 수강집단
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'plans') x
              WHERE (x ->> 'weeklyPeriods')::integer = 0
                 OR (SELECT COALESCE(sum((k ->> 'periods')::integer), 0) FROM jsonb_array_elements(x -> 'blocks') k) <> (x ->> 'weeklyPeriods')::integer) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_src -> 'courses') c
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(c -> 'resourceIds') i JOIN jsonb_array_elements(p_src -> 'resources') r ON r ->> 'id' = i
                                 WHERE r ->> 'kind' = 'teacher')
                 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(c -> 'resourceIds') i JOIN jsonb_array_elements(p_src -> 'resources') r ON r ->> 'id' = i
                                 WHERE r ->> 'kind' IN ('class','student_group'))) THEN
    RETURN NULL;
  END IF;
  v_basis := jsonb_build_object(
    'schemaVersion', 1, 'id', p_basis_id, 'revision', p_revision, 'schoolId', p_src -> 'schoolId', 'termId', p_src -> 'termId',
    'sourceFingerprint', p_src -> 'sourceFingerprint', 'schoolLevel', p_src -> 'schoolLevel', 'unsupportedFeatures', p_src -> 'unsupportedFeatures',
    'resources', p_src -> 'resources', 'slots', d -> 'slots',
    'courseLoads', COALESCE((SELECT jsonb_agg(jsonb_build_object('courseId', x -> 'courseId', 'periods', x -> 'weeklyPeriods') ORDER BY o)
                               FROM jsonb_array_elements(d -> 'plans') WITH ORDINALITY z(x, o)), '[]'),
    'lessons', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k -> 'id', 'courseId', x -> 'courseId', 'label', (c ->> 'label') || ' ' || ko || '회',
                                                            'periods', k -> 'periods', 'resourceIds', c -> 'resourceIds', 'allowedSlotIds', k -> 'allowedSlotIds')
                                          ORDER BY xo, ko)
                           FROM jsonb_array_elements(d -> 'plans') WITH ORDINALITY px(x, xo)
                           CROSS JOIN LATERAL (SELECT c FROM jsonb_array_elements(p_src -> 'courses') c WHERE c ->> 'id' = x ->> 'courseId') cc
                           CROSS JOIN LATERAL jsonb_array_elements(x -> 'blocks') WITH ORDINALITY kx(k, ko)), '[]'),
    'fixed', '[]'::jsonb, 'unavailable', '[]'::jsonb, 'preferences', '[]'::jsonb);
  IF cardinality(workhub_private.t1_basis_issues(v_basis)) > 0 OR NOT workhub_private.t1_foundation_ready(v_basis) THEN RETURN NULL; END IF;
  RETURN v_basis;
END $$;

-- 내부 함수는 API 역할이 실행할 수 없다
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

INSERT INTO workhub_private.t1_installs (batch, release) VALUES ('T1-01', '2026-10-18.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 7. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'T1-01-1' AS no, '새 표 11개 RLS 켜짐 · API 역할 · PUBLIC 권한 0(모든 종류 — 자세한 대조는 T1-04-02)' AS item,
       CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%' AND c.relkind = 'r' AND c.relrowsecurity) = 11
             AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['anon','authenticated','service_role']) r
                              WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%' AND c.relkind = 'r'
                                AND (has_table_privilege(r, c.oid, 'SELECT') OR has_table_privilege(r, c.oid, 'INSERT')
                                     OR has_table_privilege(r, c.oid, 'UPDATE') OR has_table_privilege(r, c.oid, 'DELETE')
                                     OR has_table_privilege(r, c.oid, 'TRUNCATE') OR has_table_privilege(r, c.oid, 'REFERENCES')
                                     OR has_table_privilege(r, c.oid, 'TRIGGER')))
             AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
                              WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%' AND c.relkind = 'r'
                                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))) THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T1-01-2', '내부 함수 t1_* API 역할 실행 불가',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%'
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%')
UNION ALL
SELECT 'T1-01-3', 'R0 학기 제약은 아직 그대로(교체는 T1-02)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass AND conname = 'terms_timetable_basis_pending') THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T1-01-4', '적용 기록 T1-01', CASE WHEN workhub_private.t1_installed('T1-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
