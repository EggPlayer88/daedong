-- ============================================================================
-- P5-01  수업 · 학생 · 관찰 · 상담 · 평가 · 활동 CSV — 표와 공통 내부 함수 (비활성 설치)
--
-- ▣ 전제: R0 · R1-01~03 · P1-01·02 · P2-01·02 (판 2026-10-16.1). R1S · P3 · P4 는 있어도 없어도 된다.
-- ▣ 새 표 17개 + 적용 기록. 기존 표·함수·제약은 바꾸지 않는다(P2 의 module_activations 에 모듈 이름 teaching 만 더해 쓴다).
-- ▣ 학교별 활성화(P5-04) 전에는 모든 함수가 UNAVAILABLE 이다. 이 파일만으로 켜지는 것은 없다.
-- ▣ 앱 계약: PR #48 apps/workhub/src/teaching/*.ts (teaching.v1). 기간 DTO 는 양 끝 포함, DB 는 [시작, 종료 제외).
-- ▣ 시간표(편성·시수)와 독립이다. 담당은 수업 담당(course_assignments)만 근거로 쓰고 시간표에서 추측하지 않는다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p2_installs') IS NULL THEN
    RAISE EXCEPTION 'P5 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.p2_installs WHERE batch IN ('P2-01','P2-02') AND release = '2026-10-16.1') <> 2 THEN
    RAISE EXCEPTION 'P5 중단: P2-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF to_regclass('workhub.year_subjects') IS NULL OR to_regclass('workhub.terms') IS NULL
     OR to_regprocedure('workhub_private.p1_grade_limit(text)') IS NULL THEN
    RAISE EXCEPTION 'P5 중단: P1-01·02(학교 구성)가 적용되어 있어야 합니다.';
  END IF;
  IF to_regclass('workhub_private.p5_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P5 중단: P5-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.courses') IS NOT NULL OR to_regclass('workhub.students') IS NOT NULL
     OR to_regclass('workhub.teaching_records') IS NOT NULL OR to_regclass('workhub.activity_imports') IS NOT NULL
     OR to_regclass('workhub.teaching_requests') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p5\_%' OR proname LIKE 'workhub\_teaching\_%') THEN
    RAISE EXCEPTION 'P5 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p5_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p5_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p5_installs_batch_check CHECK (batch IN ('P5-01','P5-02')),
  CONSTRAINT p5_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p5_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p5_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 학교 정책 — P5-04 가 계란님 입력값으로 1행 쓴다(예시값을 심지 않는다). 고칠 수 없다.
--    상담: off = 아무도 상담 기록을 쓰거나 열지 못함 · course_teachers = 그 수업의 현재 담당 교사가 자기 상담만.
--    관리자 역할은 상담 권한을 주지 않는다(관찰 권한·관리자 역할로 대체하지 않음).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.teaching_policies (
  school_id                 text NOT NULL,
  counseling_scope          text NOT NULL,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT teaching_policies_pkey PRIMARY KEY (school_id),
  CONSTRAINT teaching_policies_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT teaching_policies_scope_check CHECK (counseling_scope IN ('off','course_teachers')),
  CONSTRAINT teaching_policies_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200)
);
CREATE TRIGGER teaching_policies_immutable BEFORE UPDATE OR DELETE ON workhub.teaching_policies
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. 요청 원장 — (학교, 실제 소유 계정, 요청 번호). 반영된 요청만 남긴다. 학생 본문은 복사하지 않는다(명령 해시만).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.teaching_requests (
  school_id        text NOT NULL,
  owner_account_id text NOT NULL,
  request_key      text NOT NULL,
  membership_id    text NOT NULL,
  command_kind     text NOT NULL,
  payload_sha256   text NOT NULL,
  entity_id        text NOT NULL,
  entity_version   integer NOT NULL,
  applied_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT teaching_requests_pkey PRIMARY KEY (school_id, owner_account_id, request_key),
  CONSTRAINT teaching_requests_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT teaching_requests_account_fkey FOREIGN KEY (owner_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT teaching_requests_key_check CHECK (request_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'),
  CONSTRAINT teaching_requests_kind_check CHECK (command_kind IN ('course_create','roster_import','observation_save','counseling_save','record_withdraw',
                                                                  'rubric_save','assessment_save','activity_import','activity_review','activity_correct')),
  CONSTRAINT teaching_requests_sha_check CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT teaching_requests_version_check CHECK (entity_version > 0)
);
CREATE TRIGGER teaching_requests_immutable BEFORE UPDATE OR DELETE ON workhub.teaching_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 4. 수업 · 담당 — 학기(R0 terms) · 교과(P1 year_subjects) 에 묶는다. 기간은 [valid_from, valid_to)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.courses (
  id                     text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id              text NOT NULL,
  academic_year_id       text NOT NULL,
  term_id                text NOT NULL,
  subject_id             text NOT NULL,
  label                  text NOT NULL,
  valid_from             date NOT NULL,
  valid_to               date NOT NULL,
  version                integer NOT NULL DEFAULT 1,
  created_by_membership_id text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT courses_pkey PRIMARY KEY (id),
  CONSTRAINT courses_scope_key UNIQUE (school_id, id),
  CONSTRAINT courses_term_fkey FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id),
  CONSTRAINT courses_subject_fkey FOREIGN KEY (school_id, academic_year_id, subject_id) REFERENCES workhub.year_subjects(school_id, academic_year_id, id),
  CONSTRAINT courses_creator_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT courses_label_check CHECK (length(label) BETWEEN 1 AND 120),
  CONSTRAINT courses_period_check CHECK (valid_to > valid_from),
  CONSTRAINT courses_version_check CHECK (version > 0)
);
CREATE TRIGGER courses_identity BEFORE UPDATE ON workhub.courses
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','term_id','subject_id','label',
                                                                      'valid_from','valid_to','created_by_membership_id','created_at');
CREATE TRIGGER courses_no_delete BEFORE DELETE ON workhub.courses FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.course_assignments (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  course_id                text NOT NULL,
  membership_id            text NOT NULL,
  account_id               text NOT NULL,
  valid_from               date NOT NULL,
  valid_to                 date NOT NULL,
  created_by_membership_id text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT course_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT course_assignments_scope_key UNIQUE (school_id, course_id, id),
  CONSTRAINT course_assignments_owner_key UNIQUE (school_id, course_id, account_id, id),
  CONSTRAINT course_assignments_course_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.courses(school_id, id),
  CONSTRAINT course_assignments_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT course_assignments_account_fkey FOREIGN KEY (account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT course_assignments_creator_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT course_assignments_period_check CHECK (valid_to > valid_from),
  -- 같은 교사의 같은 수업 담당은 기간이 겹치지 않는다
  CONSTRAINT course_assignments_no_overlap EXCLUDE USING gist (course_id WITH =, membership_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&)
);
CREATE TRIGGER course_assignments_immutable BEFORE UPDATE OR DELETE ON workhub.course_assignments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 5. 학생 · 학적(학년도별) · 수강 — 학교 안 안정 학생키만으로 대조한다(이름·학년반번호로 자동 병합하지 않음)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.students (
  id                 text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id          text NOT NULL,
  school_student_key text NOT NULL,
  name               text NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  created_by_membership_id text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT students_pkey PRIMARY KEY (id),
  CONSTRAINT students_scope_key UNIQUE (school_id, id),
  CONSTRAINT students_key_key UNIQUE (school_id, school_student_key),
  CONSTRAINT students_creator_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT students_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT students_key_check CHECK (length(school_student_key) BETWEEN 1 AND 120),
  CONSTRAINT students_name_check CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT students_version_check CHECK (version > 0)
);
-- 이 배치에는 학생 정보 정정 명령이 없다 → 행 전체를 고정(정정판은 뒤 배치에서 판 기록과 함께)
CREATE TRIGGER students_immutable BEFORE UPDATE OR DELETE ON workhub.students
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.student_enrollments (
  id               text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id        text NOT NULL,
  student_id       text NOT NULL,
  academic_year_id text NOT NULL,
  grade            smallint NOT NULL,
  class_label      text NOT NULL,
  seat_number      smallint NOT NULL,
  valid_from       date NOT NULL,
  valid_to         date NOT NULL,
  created_by_membership_id text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT student_enrollments_pkey PRIMARY KEY (id),
  CONSTRAINT student_enrollments_scope_key UNIQUE (school_id, student_id, id),
  CONSTRAINT student_enrollments_year_key UNIQUE (student_id, academic_year_id),
  CONSTRAINT student_enrollments_seat_key UNIQUE (school_id, academic_year_id, grade, class_label, seat_number),
  CONSTRAINT student_enrollments_student_fkey FOREIGN KEY (school_id, student_id) REFERENCES workhub.students(school_id, id),
  CONSTRAINT student_enrollments_year_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT student_enrollments_creator_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT student_enrollments_grade_check CHECK (grade BETWEEN 1 AND 20),
  CONSTRAINT student_enrollments_class_check CHECK (length(class_label) BETWEEN 1 AND 40),
  CONSTRAINT student_enrollments_seat_check CHECK (seat_number BETWEEN 1 AND 999),
  CONSTRAINT student_enrollments_period_check CHECK (valid_to > valid_from)
);
CREATE TRIGGER student_enrollments_immutable BEFORE UPDATE OR DELETE ON workhub.student_enrollments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.course_memberships (
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id     text NOT NULL,
  course_id     text NOT NULL,
  student_id    text NOT NULL,
  enrollment_id text NOT NULL,
  valid_from    date NOT NULL,
  valid_to      date NOT NULL,
  created_by_membership_id text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT course_memberships_pkey PRIMARY KEY (id),
  CONSTRAINT course_memberships_scope_key UNIQUE (school_id, course_id, student_id, id),
  CONSTRAINT course_memberships_one_key UNIQUE (course_id, student_id),
  CONSTRAINT course_memberships_course_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.courses(school_id, id),
  -- 학적은 같은 학생의 것만(복합 FK)
  CONSTRAINT course_memberships_enrollment_fkey FOREIGN KEY (school_id, student_id, enrollment_id) REFERENCES workhub.student_enrollments(school_id, student_id, id),
  CONSTRAINT course_memberships_creator_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT course_memberships_period_check CHECK (valid_to > valid_from)
);
CREATE TRIGGER course_memberships_immutable BEFORE UPDATE OR DELETE ON workhub.course_memberships
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 6. 활동 CSV — 원문판(import) · 행(item) · 행 연결판(item revision) · 정정 때 빠진 이전 행
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.activity_imports (
  id                      text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id               text NOT NULL,
  course_id               text NOT NULL,
  owner_account_id        text NOT NULL,
  owner_membership_id     text NOT NULL,
  assignment_id           text NOT NULL,
  label                   text NOT NULL,
  occurred_on             date NOT NULL,
  question_version        text NOT NULL,
  question_snapshot       text NOT NULL,
  question_sha256         text NOT NULL,
  kind                    text NOT NULL,
  parser_version          text NOT NULL,
  raw_csv                 text NOT NULL,
  file_hash               text NOT NULL,
  headers                 jsonb NOT NULL,
  state                   text NOT NULL DEFAULT 'active',
  version                 integer NOT NULL DEFAULT 1,
  supersedes_import_id    text,
  superseded_by_import_id text,
  correction_reason       text,
  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT activity_imports_pkey PRIMARY KEY (id),
  CONSTRAINT activity_imports_scope_key UNIQUE (school_id, course_id, owner_account_id, id),
  CONSTRAINT activity_imports_school_key UNIQUE (school_id, id),
  CONSTRAINT activity_imports_assignment_fkey FOREIGN KEY (school_id, course_id, owner_account_id, assignment_id)
    REFERENCES workhub.course_assignments(school_id, course_id, account_id, id),
  -- 정정판 계보: 같은 수업·같은 작성자 안에서만, 후속판은 하나, 자기 자신 금지
  CONSTRAINT activity_imports_supersedes_fkey FOREIGN KEY (school_id, course_id, owner_account_id, supersedes_import_id)
    REFERENCES workhub.activity_imports(school_id, course_id, owner_account_id, id),
  CONSTRAINT activity_imports_superseded_by_fkey FOREIGN KEY (school_id, course_id, owner_account_id, superseded_by_import_id)
    REFERENCES workhub.activity_imports(school_id, course_id, owner_account_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT activity_imports_one_successor UNIQUE (supersedes_import_id),
  CONSTRAINT activity_imports_not_self CHECK (supersedes_import_id IS DISTINCT FROM id AND superseded_by_import_id IS DISTINCT FROM id),
  CONSTRAINT activity_imports_state_check CHECK (state IN ('active','superseded')
                                                 AND (state = 'superseded') = (superseded_by_import_id IS NOT NULL)),
  CONSTRAINT activity_imports_kind_check CHECK (kind IN ('dilemmas','grading')),
  CONSTRAINT activity_imports_parser_check CHECK (parser_version = 'digital-ethics.csv.v1'),
  CONSTRAINT activity_imports_hash_check CHECK (file_hash ~ '^[0-9a-f]{64}$' AND question_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT activity_imports_label_check CHECK (length(label) BETWEEN 1 AND 120 AND length(question_version) BETWEEN 1 AND 120),
  CONSTRAINT activity_imports_correction_check CHECK ((supersedes_import_id IS NULL) = (correction_reason IS NULL)),
  CONSTRAINT activity_imports_version_check CHECK (version > 0)
);
-- 같은 활동 회차(수업·작성자·날짜·이름)는 현재판이 하나뿐
CREATE UNIQUE INDEX activity_imports_identity_key ON workhub.activity_imports (school_id, course_id, owner_account_id, occurred_on, label)
  WHERE state = 'active';
CREATE INDEX activity_imports_course_idx ON workhub.activity_imports (school_id, course_id, owner_account_id, created_at DESC, id);

-- 원문은 고정, 상태는 active → superseded 한 번만(후속판 ID 와 함께)
CREATE FUNCTION workhub_private.p5_import_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
  IF (to_jsonb(OLD) - ARRAY['state','version','superseded_by_import_id','updated_at'])
     IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['state','version','superseded_by_import_id','updated_at']) THEN
    RAISE EXCEPTION 'P5_IMPORT_IMMUTABLE';
  END IF;
  IF OLD.state = 'superseded' AND (NEW.state <> 'superseded' OR NEW.superseded_by_import_id IS DISTINCT FROM OLD.superseded_by_import_id) THEN
    RAISE EXCEPTION 'P5_IMPORT_IMMUTABLE';
  END IF;
  IF NEW.version < OLD.version THEN RAISE EXCEPTION 'P5_IMPORT_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_imports_guard BEFORE UPDATE OR DELETE ON workhub.activity_imports
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p5_import_guard();

CREATE TABLE workhub.activity_items (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  course_id            text NOT NULL,
  owner_account_id     text NOT NULL,
  import_id            text NOT NULL,
  row_number           integer NOT NULL,
  alias                text NOT NULL,
  row_values           jsonb NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  mapping_version      integer NOT NULL DEFAULT 1,
  current_revision_id  text,
  disposition          text NOT NULL,
  student_id           text,
  course_membership_id text,
  reason               text NOT NULL DEFAULT '',
  previous_item_id     text,
  correspondence_reason text,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT activity_items_pkey PRIMARY KEY (id),
  CONSTRAINT activity_items_scope_key UNIQUE (school_id, course_id, owner_account_id, id),
  CONSTRAINT activity_items_row_key UNIQUE (import_id, row_number),
  CONSTRAINT activity_items_import_fkey FOREIGN KEY (school_id, course_id, owner_account_id, import_id)
    REFERENCES workhub.activity_imports(school_id, course_id, owner_account_id, id),
  CONSTRAINT activity_items_membership_fkey FOREIGN KEY (school_id, course_id, student_id, course_membership_id)
    REFERENCES workhub.course_memberships(school_id, course_id, student_id, id),
  -- 정정판 행은 이전판의 행 하나에만 대응(같은 수업·작성자)
  CONSTRAINT activity_items_previous_fkey FOREIGN KEY (school_id, course_id, owner_account_id, previous_item_id)
    REFERENCES workhub.activity_items(school_id, course_id, owner_account_id, id),
  CONSTRAINT activity_items_previous_key UNIQUE (previous_item_id),
  CONSTRAINT activity_items_disposition_check CHECK (disposition IN ('hold','adopt','exclude','withdraw')
    AND (disposition = 'adopt') = (student_id IS NOT NULL) AND (student_id IS NULL) = (course_membership_id IS NULL)),
  CONSTRAINT activity_items_row_check CHECK (row_number BETWEEN 2 AND 501),
  CONSTRAINT activity_items_version_check CHECK (version > 0 AND mapping_version > 0)
);
CREATE TRIGGER activity_items_identity BEFORE UPDATE ON workhub.activity_items
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','course_id','owner_account_id','import_id','row_number',
                                                                      'alias','row_values','previous_item_id','correspondence_reason','created_at');
CREATE TRIGGER activity_items_no_delete BEFORE DELETE ON workhub.activity_items FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.activity_item_revisions (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  item_id              text NOT NULL,
  mapping_version      integer NOT NULL,
  disposition          text NOT NULL,
  student_id           text,
  course_membership_id text,
  reason               text NOT NULL,
  recorded_by_membership_id text NOT NULL,
  recorded_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT activity_item_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT activity_item_revisions_version_key UNIQUE (item_id, mapping_version),
  CONSTRAINT activity_item_revisions_item_fkey FOREIGN KEY (item_id) REFERENCES workhub.activity_items(id),
  CONSTRAINT activity_item_revisions_member_fkey FOREIGN KEY (school_id, recorded_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT activity_item_revisions_disposition_check CHECK (disposition IN ('hold','adopt','exclude','withdraw'))
);
CREATE TRIGGER activity_item_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.activity_item_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub.activity_items ADD CONSTRAINT activity_items_revision_fkey FOREIGN KEY (current_revision_id)
  REFERENCES workhub.activity_item_revisions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE workhub.activity_item_omissions (
  school_id     text NOT NULL,
  import_id     text NOT NULL,
  item_id       text NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT activity_item_omissions_pkey PRIMARY KEY (item_id),
  CONSTRAINT activity_item_omissions_import_fkey FOREIGN KEY (school_id, import_id) REFERENCES workhub.activity_imports(school_id, id),
  CONSTRAINT activity_item_omissions_item_fkey FOREIGN KEY (item_id) REFERENCES workhub.activity_items(id),
  CONSTRAINT activity_item_omissions_reason_check CHECK (length(reason) BETWEEN 1 AND 2000)
);
CREATE TRIGGER activity_item_omissions_immutable BEFORE UPDATE OR DELETE ON workhub.activity_item_omissions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. 관찰 · 상담 — 머리(현재 판 포인터·epoch) + 불변 판. 작성자는 서버 세션이 정하고 넘기지 않는다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.teaching_records (
  id                     text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id              text NOT NULL,
  kind                   text NOT NULL,
  owner_account_id       text NOT NULL,
  owner_membership_id    text NOT NULL,
  course_id              text NOT NULL,
  student_id             text NOT NULL,
  course_membership_id   text NOT NULL,
  assignment_id          text NOT NULL,
  version                integer NOT NULL DEFAULT 1,
  epoch                  integer NOT NULL DEFAULT 0,
  state                  text NOT NULL DEFAULT 'active',
  current_revision_id    text,
  source_item_id         text,
  source_item_version    integer,
  source_review_required boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT teaching_records_pkey PRIMARY KEY (id),
  CONSTRAINT teaching_records_membership_fkey FOREIGN KEY (school_id, course_id, student_id, course_membership_id)
    REFERENCES workhub.course_memberships(school_id, course_id, student_id, id),
  CONSTRAINT teaching_records_assignment_fkey FOREIGN KEY (school_id, course_id, owner_account_id, assignment_id)
    REFERENCES workhub.course_assignments(school_id, course_id, account_id, id),
  CONSTRAINT teaching_records_source_fkey FOREIGN KEY (school_id, course_id, owner_account_id, source_item_id)
    REFERENCES workhub.activity_items(school_id, course_id, owner_account_id, id),
  CONSTRAINT teaching_records_kind_check CHECK (kind IN ('observation','counseling')),
  -- 상담은 활동 근거와 섞지 않는다
  CONSTRAINT teaching_records_source_check CHECK ((source_item_id IS NULL) = (source_item_version IS NULL)
                                                  AND (kind = 'observation' OR source_item_id IS NULL)
                                                  AND (source_item_id IS NOT NULL OR NOT source_review_required)),
  CONSTRAINT teaching_records_state_check CHECK (state IN ('active','withdrawn')),
  CONSTRAINT teaching_records_version_check CHECK (version > 0 AND epoch >= 0)
);
CREATE INDEX teaching_records_page_idx ON workhub.teaching_records (school_id, owner_account_id, course_id, student_id, kind, created_at DESC, id DESC);
CREATE INDEX teaching_records_source_idx ON workhub.teaching_records (source_item_id) WHERE source_item_id IS NOT NULL;
CREATE TRIGGER teaching_records_identity BEFORE UPDATE ON workhub.teaching_records
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','kind','owner_account_id','owner_membership_id','course_id',
                                                                      'student_id','course_membership_id','assignment_id','source_item_id',
                                                                      'source_item_version','created_at');
CREATE TRIGGER teaching_records_no_delete BEFORE DELETE ON workhub.teaching_records FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.teaching_record_revisions (
  id           text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id    text NOT NULL,
  record_id    text NOT NULL,
  version      integer NOT NULL,
  occurred_on  date NOT NULL,
  body         text NOT NULL,
  follow_up_on date,
  reason       text NOT NULL,
  state        text NOT NULL,
  content_hash text NOT NULL,
  recorded_by_membership_id text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT teaching_record_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT teaching_record_revisions_version_key UNIQUE (record_id, version),
  CONSTRAINT teaching_record_revisions_record_fkey FOREIGN KEY (record_id) REFERENCES workhub.teaching_records(id),
  CONSTRAINT teaching_record_revisions_member_fkey FOREIGN KEY (school_id, recorded_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT teaching_record_revisions_state_check CHECK (state IN ('active','withdrawn')),
  CONSTRAINT teaching_record_revisions_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER teaching_record_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.teaching_record_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub.teaching_records ADD CONSTRAINT teaching_records_revision_fkey FOREIGN KEY (current_revision_id)
  REFERENCES workhub.teaching_record_revisions(id) DEFERRABLE INITIALLY DEFERRED;

-- ----------------------------------------------------------------------------
-- 8. 평가 기준(루브릭) · 평가 — 예전 평가가 가리킨 기준판은 고치지 않는다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.rubrics (
  id                  text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id           text NOT NULL,
  course_id           text NOT NULL,
  owner_account_id    text NOT NULL,
  owner_membership_id text NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  current_revision_id text,
  archived            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rubrics_pkey PRIMARY KEY (id),
  CONSTRAINT rubrics_scope_key UNIQUE (school_id, course_id, owner_account_id, id),
  CONSTRAINT rubrics_course_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.courses(school_id, id),
  CONSTRAINT rubrics_account_fkey FOREIGN KEY (owner_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT rubrics_version_check CHECK (version > 0)
);
CREATE TRIGGER rubrics_identity BEFORE UPDATE ON workhub.rubrics
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','course_id','owner_account_id','owner_membership_id','created_at');
CREATE TRIGGER rubrics_no_delete BEFORE DELETE ON workhub.rubrics FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.rubric_revisions (
  id          text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id   text NOT NULL,
  rubric_id   text NOT NULL,
  version     integer NOT NULL,
  label       text NOT NULL,
  criteria    jsonb NOT NULL,
  recorded_by_membership_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rubric_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT rubric_revisions_scope_key UNIQUE (rubric_id, id),
  CONSTRAINT rubric_revisions_version_key UNIQUE (rubric_id, version),
  CONSTRAINT rubric_revisions_rubric_fkey FOREIGN KEY (rubric_id) REFERENCES workhub.rubrics(id),
  CONSTRAINT rubric_revisions_member_fkey FOREIGN KEY (school_id, recorded_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT rubric_revisions_criteria_check CHECK (jsonb_typeof(criteria) = 'array')
);
CREATE TRIGGER rubric_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.rubric_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub.rubrics ADD CONSTRAINT rubrics_revision_fkey FOREIGN KEY (id, current_revision_id)
  REFERENCES workhub.rubric_revisions(rubric_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE workhub.assessments (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  owner_account_id     text NOT NULL,
  owner_membership_id  text NOT NULL,
  course_id            text NOT NULL,
  student_id           text NOT NULL,
  course_membership_id text NOT NULL,
  assignment_id        text NOT NULL,
  rubric_id            text NOT NULL,
  rubric_revision_id   text NOT NULL,
  version              integer NOT NULL DEFAULT 1,
  epoch                integer NOT NULL DEFAULT 0,
  state                text NOT NULL DEFAULT 'active',
  current_revision_id  text,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assessments_pkey PRIMARY KEY (id),
  CONSTRAINT assessments_membership_fkey FOREIGN KEY (school_id, course_id, student_id, course_membership_id)
    REFERENCES workhub.course_memberships(school_id, course_id, student_id, id),
  CONSTRAINT assessments_assignment_fkey FOREIGN KEY (school_id, course_id, owner_account_id, assignment_id)
    REFERENCES workhub.course_assignments(school_id, course_id, account_id, id),
  -- 기준은 같은 수업·같은 작성자의 것, 기준판은 그 기준의 판
  CONSTRAINT assessments_rubric_fkey FOREIGN KEY (school_id, course_id, owner_account_id, rubric_id)
    REFERENCES workhub.rubrics(school_id, course_id, owner_account_id, id),
  CONSTRAINT assessments_rubric_revision_fkey FOREIGN KEY (rubric_id, rubric_revision_id) REFERENCES workhub.rubric_revisions(rubric_id, id),
  CONSTRAINT assessments_state_check CHECK (state IN ('active','withdrawn')),
  CONSTRAINT assessments_version_check CHECK (version > 0 AND epoch >= 0)
);
CREATE INDEX assessments_page_idx ON workhub.assessments (school_id, owner_account_id, course_id, student_id, created_at DESC, id DESC);
CREATE TRIGGER assessments_identity BEFORE UPDATE ON workhub.assessments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','owner_account_id','owner_membership_id','course_id','student_id',
                                                                      'course_membership_id','assignment_id','rubric_id','rubric_revision_id','created_at');
CREATE TRIGGER assessments_no_delete BEFORE DELETE ON workhub.assessments FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.assessment_revisions (
  id            text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id     text NOT NULL,
  assessment_id text NOT NULL,
  version       integer NOT NULL,
  occurred_on   date NOT NULL,
  comment       text NOT NULL,
  scores        jsonb NOT NULL,
  confirmed     boolean NOT NULL,
  total         numeric,
  reason        text NOT NULL,
  state         text NOT NULL,
  content_hash  text NOT NULL,
  recorded_by_membership_id text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assessment_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT assessment_revisions_version_key UNIQUE (assessment_id, version),
  CONSTRAINT assessment_revisions_assessment_fkey FOREIGN KEY (assessment_id) REFERENCES workhub.assessments(id),
  CONSTRAINT assessment_revisions_member_fkey FOREIGN KEY (school_id, recorded_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT assessment_revisions_state_check CHECK (state IN ('active','withdrawn')),
  CONSTRAINT assessment_revisions_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  -- 미확인 항목이 있으면 확정할 수 없다(점수 상태 검사는 함수가 루브릭판과 함께 한다)
  CONSTRAINT assessment_revisions_confirm_check CHECK (NOT confirmed OR NOT jsonb_path_exists(scores, '$[*] ? (@.state == "unconfirmed")'))
);
CREATE TRIGGER assessment_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub.assessments ADD CONSTRAINT assessments_revision_fkey FOREIGN KEY (current_revision_id)
  REFERENCES workhub.assessment_revisions(id) DEFERRABLE INITIALLY DEFERRED;

-- ----------------------------------------------------------------------------
-- 9. RLS — 모든 새 표는 RLS 켜고 정책 없음(직접 접근 0). 접근은 SECURITY DEFINER 함수로만.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub_private.p5_installs','workhub.teaching_policies','workhub.teaching_requests','workhub.courses',
    'workhub.course_assignments','workhub.students','workhub.student_enrollments','workhub.course_memberships','workhub.activity_imports',
    'workhub.activity_items','workhub.activity_item_revisions','workhub.activity_item_omissions','workhub.teaching_records',
    'workhub.teaching_record_revisions','workhub.rubrics','workhub.rubric_revisions','workhub.assessments','workhub.assessment_revisions'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 10. 공통 내부 함수 — 봉투 · 입력 판정 (앱 teaching/validation.ts 와 같은 규칙)
-- ----------------------------------------------------------------------------
-- 성공 {ok:true, contractVersion:'teaching.v1', schoolId, memberId, ownerUserId, ...DTO} · 업무 거절 같은 봉투 + {ok:false, code}
CREATE FUNCTION workhub_private.p5_ok(p_ctx workhub_private.actor_context, p_body jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', true, 'contractVersion', 'teaching.v1', 'schoolId', p_ctx.school_id,
                            'memberId', p_ctx.membership_id, 'ownerUserId', p_ctx.auth_user_id::text) || COALESCE(p_body, '{}'::jsonb)
$$;
CREATE FUNCTION workhub_private.p5_err(p_ctx workhub_private.actor_context, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', false, 'contractVersion', 'teaching.v1', 'schoolId', p_ctx.school_id,
                            'memberId', p_ctx.membership_id, 'ownerUserId', p_ctx.auth_user_id::text, 'code', p_code)
$$;
-- 봉투로 돌려줄 업무 코드(앱 TeachingFailure 중 서버가 확정하는 것)
CREATE FUNCTION workhub_private.p5_business(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_code IN ('UNAVAILABLE','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT','QUERY_FAILED')
$$;

-- 앱 문자열 길이(String.length = UTF-16 단위). 보충 평면 글자(이모지 등)는 2로 센다.
CREATE FUNCTION workhub_private.p5_u16(p text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT length(p) + regexp_count(p, '[\U00010000-\U0010FFFF]')
$$;
-- 앱 text(value, max, allowEmpty): 문자열 · UTF-16 길이 · (allowEmpty 아니면) 공백뿐 아님 · 제어문자(탭·줄바꿈·CR 제외) 없음
CREATE FUNCTION workhub_private.p5_text(p jsonb, p_max integer DEFAULT 120, p_allow_empty boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND workhub_private.p5_u16(p #>> '{}') <= p_max
     AND (p_allow_empty OR workhub_private.js_trim(p #>> '{}') <> '')
     AND (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f]'
$$;
-- 앱 identifier(): 영문·숫자로 시작, 영문·숫자·_ . : @ / - 1~160자
CREATE FUNCTION workhub_private.p5_id(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'
$$;
CREATE FUNCTION workhub_private.p5_key(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND p ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'
$$;
CREATE FUNCTION workhub_private.p5_hash(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[a-f0-9]{64}$'
$$;
-- 앱 date(): YYYY-MM-DD 이고 실제 날짜
CREATE FUNCTION workhub_private.p5_date(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'string' OR (p #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  BEGIN v := (p #>> '{}')::date; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN to_char(v, 'YYYY-MM-DD') = (p #>> '{}');
END $$;
-- 앱 점수·만점: 유한한 수, 소수 둘째 자리까지
CREATE FUNCTION workhub_private.p5_cents(p jsonb, p_min numeric, p_max numeric, p_min_exclusive boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'number'
     AND (p::text)::numeric <= p_max
     AND CASE WHEN p_min_exclusive THEN (p::text)::numeric > p_min ELSE (p::text)::numeric >= p_min END
     AND (p::text)::numeric * 100 = trunc((p::text)::numeric * 100)
$$;
CREATE FUNCTION workhub_private.p5_ts(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION workhub_private.p5_day(p date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p, 'YYYY-MM-DD')
$$;
-- DB 기간 [시작, 종료 제외) → 앱 양 끝 포함의 마지막 날
CREATE FUNCTION workhub_private.p5_last(p_valid_to date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(p_valid_to - 1, 'YYYY-MM-DD')
$$;
-- 내용 지문(앱 contentHash·sourceHash): 판 내용의 표준 JSON 의 SHA-256
CREATE FUNCTION workhub_private.p5_content_hash(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_sha(p)
$$;

-- 같은 (학교, 계정, 요청 번호) 의 동시 실행을 한 줄로 세운다
CREATE FUNCTION workhub_private.p5_lock(p_ctx workhub_private.actor_context, p_key text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('p5' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.account_id || chr(31) || p_key, 0))
$$;

-- 위치 값: 서버가 만든 JSON 을 16진으로. 범위 지문(학교·계정·소속·수업·학생·종류)을 넣어 다른 범위에 쓰지 못하게 한다.
CREATE FUNCTION workhub_private.p5_cursor_out(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(convert_to(p::text, 'UTF8'), 'hex')
$$;
CREATE FUNCTION workhub_private.p5_cursor_in(p text, p_scope text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v jsonb; k text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF length(p) > 1024 OR p !~ '^[0-9a-f]+$' OR length(p) % 2 <> 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN
    v := convert_from(decode(p, 'hex'), 'UTF8')::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF jsonb_typeof(v) <> 'object' OR v ->> 'f' IS DISTINCT FROM p_scope THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH k IN ARRAY ARRAY['a','b'] LOOP
    IF v -> k IS NULL THEN CONTINUE; END IF;
    IF v -> k = '"done"'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(v -> k) <> 'object' OR jsonb_typeof(v -> k -> 't') IS DISTINCT FROM 'string' OR jsonb_typeof(v -> k -> 'i') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    BEGIN PERFORM (v -> k ->> 't')::timestamptz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT'; END;
  END LOOP;
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 11. 준비 상태 · 권한
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p5_installs WHERE batch IN ('P5-01','P5-02') AND release = '2026-10-16.1') = 2
$$;
-- 준비 사유: ready · database_missing · disabled(중지) · policy_missing(활성화·정책 없음)
CREATE FUNCTION workhub_private.p5_reason(p_school text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  IF NOT workhub_private.p5_installed() THEN RETURN 'database_missing'; END IF;
  SELECT state INTO v_state FROM workhub.module_activations WHERE school_id = p_school AND module = 'teaching';
  IF v_state = 'stopped' THEN RETURN 'disabled'; END IF;
  IF v_state IS DISTINCT FROM 'active' OR NOT EXISTS (SELECT 1 FROM workhub.teaching_policies WHERE school_id = p_school) THEN
    RETURN 'policy_missing';
  END IF;
  RETURN 'ready';
END $$;
CREATE FUNCTION workhub_private.p5_ready(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p5_reason(p_school) = 'ready'
$$;

-- 수업 만들기·담당 지정 = 학교 관리자(R0 의 year.manage). 새 권한을 만들지 않았다(P5_설계결정 D-P5-1).
CREATE FUNCTION workhub_private.p5_manager(p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.member_has_perm(p_ctx, 'year.manage')
$$;
-- 이 소속의 그 수업 담당 중 오늘 유효한 것(없으면 NULL)
CREATE FUNCTION workhub_private.p5_current_assignment(p_ctx workhub_private.actor_context, p_course text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id FROM workhub.course_assignments a
   WHERE a.school_id = p_ctx.school_id AND a.course_id = p_course AND a.membership_id = p_ctx.membership_id
     AND a.account_id = p_ctx.account_id AND p_ctx.school_today <@ daterange(a.valid_from, a.valid_to, '[)')
   ORDER BY a.valid_from DESC, a.id LIMIT 1
$$;
-- 수업을 볼 수 있는가: 관리자 · 그 수업의 담당(지난 담당 포함, 자기 기록 열람용)
CREATE FUNCTION workhub_private.p5_course_visible(p_ctx workhub_private.actor_context, p_course text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.courses c WHERE c.school_id = p_ctx.school_id AND c.id = p_course)
     AND (workhub_private.p5_manager(p_ctx)
          OR EXISTS (SELECT 1 FROM workhub.course_assignments a WHERE a.school_id = p_ctx.school_id AND a.course_id = p_course
                       AND a.membership_id = p_ctx.membership_id AND a.account_id = p_ctx.account_id))
$$;
-- 상담 권한: 학교 정책이 course_teachers 이고 이 수업의 현재 담당일 때만(관리자 역할로 대신하지 않는다)
CREATE FUNCTION workhub_private.p5_can_counsel(p_ctx workhub_private.actor_context, p_course text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.teaching_policies p WHERE p.school_id = p_ctx.school_id AND p.counseling_scope = 'course_teachers')
     AND workhub_private.p5_current_assignment(p_ctx, p_course) IS NOT NULL
$$;
-- 지난 상담 열람: 정책이 course_teachers 이고 그 수업을 맡은 적이 있는 본인(자기 기록만 돌려준다)
CREATE FUNCTION workhub_private.p5_can_read_counsel(p_ctx workhub_private.actor_context, p_course text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.teaching_policies p WHERE p.school_id = p_ctx.school_id AND p.counseling_scope = 'course_teachers')
     AND EXISTS (SELECT 1 FROM workhub.course_assignments a WHERE a.school_id = p_ctx.school_id AND a.course_id = p_course
                   AND a.membership_id = p_ctx.membership_id AND a.account_id = p_ctx.account_id)
$$;

-- ----------------------------------------------------------------------------
-- 12. CSV 읽기 — 앱 teaching/csv.ts parseCsv 와 같은 규칙(RFC 4180, BOM 제거, 셀 안 줄바꿈, 따옴표 "" ).
--     원문은 바꾸지 않고 해석한 칸만 돌려준다. 형식 오류는 INVALID_INPUT.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_csv(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  chars text[]; n integer; i integer := 1; ch text; st text := 'start';
  cell text[] := '{}'; cell16 integer := 0; rowv text[] := '{}'; rows jsonb := '[]'::jsonb; nrows integer := 0;
  inp text; first jsonb; w integer;
BEGIN
  IF p_raw IS NULL OR octet_length(convert_to(p_raw, 'UTF8')) > 2097152 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  inp := CASE WHEN left(p_raw, 1) = U&'\FEFF' THEN substr(p_raw, 2) ELSE p_raw END;
  chars := regexp_split_to_array(inp, '');
  IF inp = '' THEN chars := '{}'; END IF;
  n := COALESCE(array_length(chars, 1), 0);
  WHILE i <= n LOOP
    ch := chars[i];
    IF st = 'quoted' THEN
      IF ch = '"' THEN
        IF i < n AND chars[i + 1] = '"' THEN cell := cell || '"'::text; cell16 := cell16 + 1; i := i + 1;
        ELSE st := 'closed';
        END IF;
      ELSE
        cell := cell || ch; cell16 := cell16 + CASE WHEN ascii(ch) > 65535 THEN 2 ELSE 1 END;
      END IF;
      i := i + 1; CONTINUE;
    END IF;
    IF ch = ',' OR ch = E'\r' OR ch = E'\n' THEN
      -- finishCell
      IF cell16 > 20000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      rowv := rowv || array_to_string(cell, ''); cell := '{}'; cell16 := 0; st := 'start';
      IF array_length(rowv, 1) > 100 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      IF ch <> ',' THEN
        IF ch = E'\r' AND i < n AND chars[i + 1] = E'\n' THEN i := i + 1; END IF;
        rows := rows || jsonb_build_array(to_jsonb(rowv)); rowv := '{}'; nrows := nrows + 1;
        IF nrows > 501 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      END IF;
      i := i + 1; CONTINUE;
    END IF;
    IF st = 'closed' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF ch = '"' THEN
      IF st <> 'start' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      st := 'quoted'; i := i + 1; CONTINUE;
    END IF;
    cell := cell || ch; cell16 := cell16 + CASE WHEN ascii(ch) > 65535 THEN 2 ELSE 1 END; st := 'plain';
    IF cell16 > 20000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    i := i + 1;
  END LOOP;
  IF st = 'quoted' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF array_length(cell, 1) IS NOT NULL OR array_length(rowv, 1) IS NOT NULL OR st = 'closed' OR right(inp, 1) = ',' THEN
    IF cell16 > 20000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    rowv := rowv || array_to_string(cell, '');
    IF array_length(rowv, 1) > 100 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    rows := rows || jsonb_build_array(to_jsonb(rowv)); nrows := nrows + 1;
    IF nrows > 501 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  IF nrows = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  first := rows -> 0;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(first) h WHERE h <> '') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(first) h WHERE h = '')
     OR (SELECT count(DISTINCT h) FROM jsonb_array_elements_text(first) h) <> jsonb_array_length(first) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  w := jsonb_array_length(first);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(rows) r WHERE jsonb_array_length(r) <> w) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN rows;
END $$;

-- 확인된 디지털윤리 CSV 형식(앱 policy.json activityProfiles 와 같은 머리글·순서)
CREATE FUNCTION workhub_private.p5_profile(p_kind text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'dilemmas' THEN '["자리번호·별명","현재 단계","성찰 완료","첫 입장","첫 입장의 이유","판단 기준","자율주행 첫 선택","자율주행 첫 이유","자율주행 재선택","자율주행 재선택 이유","의료 AI 첫 선택","의료 AI 첫 이유","의료 AI 재선택","의료 AI 재선택 이유","맡길 수 있는 범위","사람이 개입할 조건","판단을 받아들일 조건","최종 입장","최종 입장 이유","생각에 영향을 준 정보"]'::jsonb
    WHEN 'grading' THEN '["자리번호·별명","현재 단계","제출 여부","나의 결정","직접 제안","선택한 근거","근거를 고른 이유","다른 사람","영향","필요한 조건","심화 (평가 제외)"]'::jsonb
  END
$$;

INSERT INTO workhub_private.p5_installs (batch, release) VALUES ('P5-01', '2026-10-16.1');

-- 내부 함수는 API 역할이 실행할 수 없다(P5-02 가 공개 함수만 연다)
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub_private FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

-- ----------------------------------------------------------------------------
-- 확인
-- ----------------------------------------------------------------------------
SELECT 'P5-01-1' AS no, '새 표 17개 + 적용 기록 · RLS 켜짐 · API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 18 AND bool_and(c.relrowsecurity)
                 AND NOT bool_or(has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                                 OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                                 OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
  FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p5_installs'), to_regclass('workhub.teaching_policies'), to_regclass('workhub.teaching_requests'),
    to_regclass('workhub.courses'), to_regclass('workhub.course_assignments'), to_regclass('workhub.students'), to_regclass('workhub.student_enrollments'),
    to_regclass('workhub.course_memberships'), to_regclass('workhub.activity_imports'), to_regclass('workhub.activity_items'),
    to_regclass('workhub.activity_item_revisions'), to_regclass('workhub.activity_item_omissions'), to_regclass('workhub.teaching_records'),
    to_regclass('workhub.teaching_record_revisions'), to_regclass('workhub.rubrics'), to_regclass('workhub.rubric_revisions'),
    to_regclass('workhub.assessments'), to_regclass('workhub.assessment_revisions'))
UNION ALL
SELECT 'P5-01-2', '수업 모듈 활성화 0개', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM workhub.module_activations WHERE module = 'teaching'
UNION ALL
SELECT 'P5-01-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p5\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P5-01-4', '적용 기록 P5-01', CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p5_installs WHERE batch = 'P5-01') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
