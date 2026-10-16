-- ============================================================================
-- P1-01  학교 관리 — 학년도별 구성 · 공식 담당 · 학교 관리 판 · 변경 원장 (비활성 설치)
--
-- 요청서: docs/workhub/pilot-completion/school-admin-contract.md · sql-handoff.md 2절 1번
-- 설계 근거: P1_설계결정.md   앱 계약 원본: apps/workhub/src/setup/school-admin-contract.ts
--
-- ▣ 하는 일
--   - 학년도별 부서·학급·교과 정의(year_departments · year_classes · year_subjects)와 공식 담당(staff_assignments),
--     학교별 학교 관리 활성화·단일 판(school_admin_activations), 변경 전후 원장(school_admin_changes)을 만든다.
--   - R0 제약 3개를 앱 계약에 맞춰 넓힌다(줄이지 않는다): 학년 수 1~6 → 1~20, 학기 이름 30 → 50자,
--     학기 기간 중첩 금지를 "트랜잭션 끝 검사 가능(DEFERRABLE)"으로. 기존 행은 모두 그대로 통과한다.
--   - R0 함수 2개를 교체한다: member_relations(공식 담당에서 부서·학년·교과 관계 계산),
--     workhub_context(현재 학년도의 부서·교과 이름 표시). 교체본은 원문에서 "P1:" 주석을 단 부분만 다르다.
-- ▣ 하지 않는 일
--   - 어떤 학교도 켜지 않는다(활성화 행 0개 → 준비 상태 not_configured). 켜는 것은 P1-04, 별도 승인.
--   - 회원·로그인·가입 승인·역할(membership_roles)·R0/R1 자료를 바꾸지 않는다. R0·R1 을 다시 실행하지 않는다.
--   - 공개 함수를 만들지 않는다(P1-02).
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
--   마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: R0-01~03 · R1-01~03(2026-10-15.1). R1S 는 있어도 없어도 된다.
--   교체할 함수 2개와 넓힐 제약 3개가 R0 원문과 같아야 한다(다르면 시작 전에 멈춤).
-- ============================================================================
BEGIN;

DO $$
DECLARE v_bad text;
BEGIN
  -- 표가 없을 때 다음 조건을 계산하면 '없는 표' 오류가 먼저 나므로 단계를 나눈다(안내 문구가 그대로 보이게).
  IF to_regclass('workhub.schools') IS NULL OR to_regclass('workhub_private.batch_installs') IS NULL THEN
    RAISE EXCEPTION 'P1 중단: R0 과 R1-01·02·03(2026-10-15.1)이 모두 적용되어 있지 않습니다.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.batch_installs WHERE batch IN ('R1-01','R1-02','R1-03') AND release = '2026-10-15.1') <> 3 THEN
    RAISE EXCEPTION 'P1 중단: R0 과 R1-01·02·03(2026-10-15.1)이 모두 적용되어 있지 않습니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub.schools) THEN
    RAISE EXCEPTION 'P1 중단: 학교가 없습니다(R0-03 학교 초기 설정 전).';
  END IF;
  IF to_regclass('workhub_private.p1_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P1 중단: P1-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regclass('workhub.school_admin_activations') IS NOT NULL OR to_regclass('workhub.year_departments') IS NOT NULL
     OR to_regclass('workhub.year_classes') IS NOT NULL OR to_regclass('workhub.year_subjects') IS NOT NULL
     OR to_regclass('workhub.staff_assignments') IS NOT NULL OR to_regclass('workhub.school_admin_changes') IS NOT NULL
     OR to_regprocedure('public.workhub_school_admin_readiness(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'P1 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  -- 교체 대상이 R0-02 원문 그대로여야 한다(다른 배치·수작업이 바꿨으면 덮어쓰지 않는다). 줄바꿈(CRLF) 차이는 무시한다.
  SELECT string_agg(x.fn, ', ' ORDER BY x.fn) INTO v_bad
    FROM (VALUES ('workhub_private', 'member_relations', '076c9721322e989ec1ecd1573d80053b'),
                 ('public', 'workhub_context', '05f07d50000f55bc26a982df8088d0ff')) x(ns, fn, h)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = x.ns::regnamespace AND p.proname = x.fn
            AND md5(replace(p.prosrc, chr(13), '')) = x.h) <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P1 중단: 교체할 R0 함수가 원문과 다릅니다(%). 결과를 알려 주세요.', v_bad;
  END IF;
  SELECT string_agg(x.c, ', ' ORDER BY x.c) INTO v_bad
    FROM (VALUES ('workhub.schools', 'schools_grade_count_check', 'CHECK (((grade_count >= 1) AND (grade_count <= 6)))'),
                 ('workhub.terms', 'terms_label_check', 'CHECK (((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 30)))'),
                 ('workhub.terms', 'terms_no_overlap', 'EXCLUDE USING gist (school_id WITH =, daterange(starts_on, ends_on, ''[)''::text) WITH &&)')) x(t, c, def)
   WHERE (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = x.t::regclass AND k.conname = x.c) IS DISTINCT FROM x.def;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P1 중단: 넓힐 R0 제약이 원문과 다릅니다(%).', v_bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p1_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p1_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p1_installs_batch_check CHECK (batch IN ('P1-01','P1-02')),
  CONSTRAINT p1_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p1_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p1_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. R0 제약 넓히기 — 앱 계약(setup/assets/school-admin.json · contract.ts SETUP_LIMITS)과 맞춘다
-- ----------------------------------------------------------------------------
-- 특수·기타 학교급의 기술 한도 20. 학교급별 실제 범위(초 6 · 중고 3)는 함수가 앱과 같은 표로 검사한다.
ALTER TABLE workhub.schools DROP CONSTRAINT schools_grade_count_check;
ALTER TABLE workhub.schools ADD CONSTRAINT schools_grade_count_check CHECK (grade_count BETWEEN 1 AND 20);
-- 앱의 학기 이름 한도 50자.
ALTER TABLE workhub.terms DROP CONSTRAINT terms_label_check;
ALTER TABLE workhub.terms ADD CONSTRAINT terms_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 50);
-- 학기 날짜를 한 번에 옮길 때(1학기 끝을 늦추고 2학기 시작을 늦춤) 중간 상태의 일시 겹침으로 실패하지 않도록,
-- 같은 규칙을 트랜잭션 안에서 끝에 검사할 수 있게 한다. 기본은 지금처럼 즉시 검사(INITIALLY IMMEDIATE).
ALTER TABLE workhub.terms DROP CONSTRAINT terms_no_overlap;
ALTER TABLE workhub.terms ADD CONSTRAINT terms_no_overlap
  EXCLUDE USING gist (school_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&) DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------------------------------------------------------
-- 3. 학교 관리 활성화 · 단일 판
--    revision = 학교 관리 전체(어느 학년도의 구성·소속·담당이든) 판. 바뀔 때마다 1씩 오른다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.school_admin_activations (
  school_id                 text NOT NULL,
  state                     text NOT NULL DEFAULT 'active',
  revision                  bigint NOT NULL DEFAULT 1,
  approved_by_membership_id text NOT NULL,
  approval_ref              text NOT NULL,
  activated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_changed_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_note                text,
  updated_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT school_admin_activations_pkey PRIMARY KEY (school_id),
  CONSTRAINT school_admin_activations_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT school_admin_activations_approver_fkey FOREIGN KEY (school_id, approved_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT school_admin_activations_state_check CHECK (state IN ('active','stopped')),
  CONSTRAINT school_admin_activations_revision_check CHECK (revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT school_admin_activations_approval_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200),
  CONSTRAINT school_admin_activations_note_check CHECK (state_note IS NULL OR length(state_note) <= 200)
);
CREATE TRIGGER school_admin_activations_identity BEFORE UPDATE ON workhub.school_admin_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('school_id','approved_by_membership_id','approval_ref','activated_at');
-- 판은 내려가지 않는다.
CREATE FUNCTION workhub_private.p1_revision_forward() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.revision < OLD.revision THEN RAISE EXCEPTION 'REVISION_BACKWARD'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER school_admin_activations_forward BEFORE UPDATE ON workhub.school_admin_activations
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p1_revision_forward();

-- ----------------------------------------------------------------------------
-- 4. 학년도별 구성 정의 — 같은 이름이라도 학년도가 다르면 다른 행이다(자동 병합하지 않음).
--    빠진 행은 지우지 않고 removed_at 으로 닫는다(참조가 있으면 함수가 거부한다). 판·이름 이력은 school_admin_changes.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.year_departments (
  id               text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id        text NOT NULL,
  academic_year_id text NOT NULL,
  name             text NOT NULL,
  sort_order       integer NOT NULL,
  removed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT year_departments_pkey PRIMARY KEY (id),
  CONSTRAINT year_departments_scope_key UNIQUE (school_id, academic_year_id, id),
  CONSTRAINT year_departments_year_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT year_departments_id_check CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  CONSTRAINT year_departments_name_check CHECK (length(name) BETWEEN 1 AND 50 AND name = btrim(name)),
  CONSTRAINT year_departments_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX year_departments_name_live ON workhub.year_departments (academic_year_id, name) WHERE removed_at IS NULL;

CREATE TABLE workhub.year_classes (
  id               text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id        text NOT NULL,
  academic_year_id text NOT NULL,
  grade            smallint NOT NULL,
  class_no         smallint,
  name             text NOT NULL,
  kind             text NOT NULL,
  sort_order       integer NOT NULL,
  removed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT year_classes_pkey PRIMARY KEY (id),
  CONSTRAINT year_classes_scope_key UNIQUE (school_id, academic_year_id, id),
  CONSTRAINT year_classes_year_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT year_classes_id_check CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  CONSTRAINT year_classes_grade_check CHECK (grade BETWEEN 1 AND 20),
  CONSTRAINT year_classes_class_no_check CHECK (class_no IS NULL OR class_no BETWEEN 1 AND 99),
  CONSTRAINT year_classes_name_check CHECK (length(name) BETWEEN 1 AND 30 AND name = btrim(name)),
  CONSTRAINT year_classes_kind_check CHECK (kind IN ('regular','special','multigrade','other')),
  CONSTRAINT year_classes_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX year_classes_name_live ON workhub.year_classes (academic_year_id, name) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX year_classes_number_live ON workhub.year_classes (academic_year_id, grade, class_no)
  WHERE removed_at IS NULL AND class_no IS NOT NULL;

CREATE TABLE workhub.year_subjects (
  id               text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id        text NOT NULL,
  academic_year_id text NOT NULL,
  name             text NOT NULL,
  sort_order       integer NOT NULL,
  removed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT year_subjects_pkey PRIMARY KEY (id),
  CONSTRAINT year_subjects_scope_key UNIQUE (school_id, academic_year_id, id),
  CONSTRAINT year_subjects_year_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT year_subjects_id_check CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  CONSTRAINT year_subjects_name_check CHECK (length(name) BETWEEN 1 AND 50 AND name = btrim(name)),
  CONSTRAINT year_subjects_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX year_subjects_name_live ON workhub.year_subjects (academic_year_id, name) WHERE removed_at IS NULL;

CREATE TRIGGER year_departments_identity BEFORE UPDATE ON workhub.year_departments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','created_at');
CREATE TRIGGER year_classes_identity BEFORE UPDATE ON workhub.year_classes
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','created_at');
CREATE TRIGGER year_subjects_identity BEFORE UPDATE ON workhub.year_subjects
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','created_at');

-- ----------------------------------------------------------------------------
-- 5. 공식 담당 — [valid_from, valid_to) 시작 포함·종료 제외. 앱의 마지막 날(포함) = valid_to - 1.
--    시간표 생성·교시 배치가 아니다(시간표 보류 유지).
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.staff_assignments (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  academic_year_id         text NOT NULL,
  membership_id            text NOT NULL,
  kind                     text NOT NULL,
  class_id                 text,
  department_id            text,
  subject_id               text,
  label                    text NOT NULL,
  valid_from               date NOT NULL,
  valid_to                 date NOT NULL,
  status                   text NOT NULL DEFAULT 'active',
  assigned_by_membership_id text NOT NULL,
  ended_by_membership_id   text,
  ended_at                 timestamptz,
  created_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  version                  integer NOT NULL DEFAULT 1,
  CONSTRAINT staff_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT staff_assignments_scope_key UNIQUE (school_id, academic_year_id, id),
  CONSTRAINT staff_assignments_year_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT staff_assignments_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT staff_assignments_assigned_by_fkey FOREIGN KEY (school_id, assigned_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT staff_assignments_ended_by_fkey FOREIGN KEY (school_id, ended_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  -- 대상은 같은 학교·같은 학년도의 정의만(복합 FK)
  CONSTRAINT staff_assignments_class_fkey FOREIGN KEY (school_id, academic_year_id, class_id) REFERENCES workhub.year_classes(school_id, academic_year_id, id),
  CONSTRAINT staff_assignments_department_fkey FOREIGN KEY (school_id, academic_year_id, department_id) REFERENCES workhub.year_departments(school_id, academic_year_id, id),
  CONSTRAINT staff_assignments_subject_fkey FOREIGN KEY (school_id, academic_year_id, subject_id) REFERENCES workhub.year_subjects(school_id, academic_year_id, id),
  CONSTRAINT staff_assignments_id_check CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  CONSTRAINT staff_assignments_kind_check CHECK (kind IN ('homeroom','department','subject','duty')),
  CONSTRAINT staff_assignments_target_check CHECK (CASE kind
    WHEN 'homeroom'   THEN class_id IS NOT NULL AND department_id IS NULL AND subject_id IS NULL
    WHEN 'department' THEN department_id IS NOT NULL AND class_id IS NULL AND subject_id IS NULL
    WHEN 'subject'    THEN subject_id IS NOT NULL AND class_id IS NULL AND department_id IS NULL
    WHEN 'duty'       THEN class_id IS NULL AND department_id IS NULL AND subject_id IS NULL END),
  CONSTRAINT staff_assignments_label_check CHECK (length(label) BETWEEN 1 AND 100 AND label = btrim(label)),
  CONSTRAINT staff_assignments_period_check CHECK (valid_to > valid_from),
  CONSTRAINT staff_assignments_status_check CHECK (status IN ('active','ended')),
  CONSTRAINT staff_assignments_ended_check CHECK ((status = 'ended') = (ended_at IS NOT NULL) AND (status = 'ended') = (ended_by_membership_id IS NOT NULL)),
  CONSTRAINT staff_assignments_version_check CHECK (version > 0),
  -- 1차 계약: 한 학급의 주담임은 기간마다 한 명(공동담임은 계약 확장 때)
  CONSTRAINT staff_assignments_one_homeroom EXCLUDE USING gist (
    class_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&) WHERE (kind = 'homeroom'),
  -- 같은 교사의 같은 대상(일반 업무는 같은 이름) 기간 중복 금지
  CONSTRAINT staff_assignments_no_duplicate EXCLUDE USING gist (
    membership_id WITH =, kind WITH =, (COALESCE(class_id, department_id, subject_id, 'duty:' || label)) WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&)
);
CREATE INDEX staff_assignments_member ON workhub.staff_assignments (school_id, membership_id, valid_from, valid_to);
CREATE INDEX staff_assignments_year ON workhub.staff_assignments (school_id, academic_year_id);
CREATE INDEX staff_assignments_class ON workhub.staff_assignments (class_id) WHERE class_id IS NOT NULL;
CREATE INDEX staff_assignments_department ON workhub.staff_assignments (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX staff_assignments_subject ON workhub.staff_assignments (subject_id) WHERE subject_id IS NOT NULL;
CREATE TRIGGER staff_assignments_identity BEFORE UPDATE ON workhub.staff_assignments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','membership_id','kind',
    'class_id','department_id','subject_id','label','valid_from','assigned_by_membership_id','created_at');

-- ----------------------------------------------------------------------------
-- 6. 변경 원장 — 명령·대상·변경 전/후·사유·학교 시간·행위자·요청 번호·결과 판. 기록 뒤 고치지 않는다.
--    (audit_events.details 는 4KB 한도라 구성 전체 전후를 담지 못한다. 감사 사건에는 이 행의 id 만 남긴다)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.school_admin_changes (
  id                  bigint GENERATED ALWAYS AS IDENTITY,
  school_id           text NOT NULL,
  revision            bigint NOT NULL,
  command_kind        text NOT NULL,
  school_year         smallint NOT NULL,
  target_type         text NOT NULL,
  target_id           text NOT NULL,
  actor_account_id    text NOT NULL,
  actor_membership_id text NOT NULL,
  request_key         text NOT NULL,
  reason              text NOT NULL,
  before_state        jsonb,
  after_state         jsonb NOT NULL,
  school_date         date NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT school_admin_changes_pkey PRIMARY KEY (id),
  CONSTRAINT school_admin_changes_revision_key UNIQUE (school_id, revision),
  CONSTRAINT school_admin_changes_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.school_admin_activations(school_id),
  CONSTRAINT school_admin_changes_actor_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT school_admin_changes_kind_check CHECK (command_kind IN ('save_configuration','assign_duty','end_assignment','review_membership')),
  CONSTRAINT school_admin_changes_target_check CHECK (target_type IN ('academic_year','staff_assignment','membership')),
  CONSTRAINT school_admin_changes_reason_check CHECK (length(reason) BETWEEN 1 AND 1000),
  CONSTRAINT school_admin_changes_state_check CHECK (jsonb_typeof(after_state) = 'object' AND (before_state IS NULL OR jsonb_typeof(before_state) = 'object'))
);
CREATE TRIGGER school_admin_changes_immutable BEFORE UPDATE OR DELETE ON workhub.school_admin_changes
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. 내부 판정 함수
-- ----------------------------------------------------------------------------
-- 앱 school-admin.json 의 학교급별 학년 수(일반 학교급 운영 범위 + 특수·기타 기술 한도 20)
CREATE FUNCTION workhub_private.p1_grade_limit(p_level text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_level WHEN 'elementary' THEN 6 WHEN 'middle' THEN 3 WHEN 'high' THEN 3 ELSE 20 END
$$;

-- 앱 isSetupDate 와 같은 날짜 판정(YYYY-MM-DD, 실제 있는 날, 0000 년 아님). 아니면 NULL.
CREATE FUNCTION workhub_private.p1_date(p text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE d date;
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p LIKE '0000%' THEN RETURN NULL; END IF;
  BEGIN d := p::date; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF to_char(d, 'YYYY-MM-DD') <> p THEN RETURN NULL; END IF;
  RETURN d;
END $$;

-- 앱 text(): 문자열 · 비어 있지 않음(앞뒤 공백 제외) · 코드포인트 한도 · 제어 문자 없음(여러 줄이면 탭·줄바꿈만 허용)
CREATE FUNCTION workhub_private.p1_text_ok(p jsonb, p_max integer, p_multiline boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND length(workhub_private.js_trim(p #>> '{}')) > 0 AND length(p #>> '{}') <= p_max
     AND CASE WHEN p_multiline THEN (p #>> '{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
              ELSE (p #>> '{}') !~ '[\x01-\x1f\x7f]' END
$$;

CREATE FUNCTION workhub_private.p1_id_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
$$;

-- 객체의 키가 정확히 이 목록인지
CREATE FUNCTION workhub_private.p1_exact(p jsonb, p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(p)) = cardinality(p_keys)
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT (k = ANY (p_keys)))
$$;

-- 앱 안전 정수(Number.isSafeInteger) 범위의 양의 정수 JSON 숫자
CREATE FUNCTION workhub_private.p1_int(p jsonb, p_min bigint, p_max bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p IS NOT NULL AND jsonb_typeof(p) = 'number' AND p::text ~ '^-?[0-9]{1,16}$'
                   AND p::text::numeric BETWEEN p_min AND p_max THEN p::text::bigint END
$$;

-- 소속 행의 앱 형식 기간: 시작 = valid_from(대기·반려로 비어 있으면 신청일), 마지막 날 = valid_to - 1(무기한 9999-12-31)
CREATE FUNCTION workhub_private.p1_member_dto(m workhub.memberships, p_name text, p_timezone text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'name', p_name,
    'status', CASE m.status WHEN 'left' THEN 'ended' ELSE m.status END,
    'startsOn', to_char(COALESCE(m.valid_from, (m.requested_at AT TIME ZONE p_timezone)::date), 'YYYY-MM-DD'),
    'lastDay', COALESCE(to_char(m.valid_to - 1, 'YYYY-MM-DD'), '9999-12-31'),
    'version', m.version)
$$;

CREATE FUNCTION workhub_private.p1_assignment_dto(x workhub.staff_assignments) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', x.id, 'memberId', x.membership_id, 'kind', x.kind,
    'targetId', COALESCE(x.class_id, x.department_id, x.subject_id), 'label', x.label,
    'startsOn', to_char(x.valid_from, 'YYYY-MM-DD'), 'lastDay', to_char(x.valid_to - 1, 'YYYY-MM-DD'),
    'status', x.status, 'version', x.version)
$$;

-- 한 학년도의 구성(앱 SetupDraft 키 그대로, 숫자도 문자열)과 교과 목록
CREATE FUNCTION workhub_private.p1_configuration(p_school_id text, p_year_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'configuration', jsonb_build_object(
      'draftId', y.id, 'schoolName', s.name, 'schoolCode', s.code, 'schoolType', s.school_level,
      'gradeCount', s.grade_count::text, 'schoolYear', y.school_year::text,
      'startsOn', to_char(y.starts_on, 'YYYY-MM-DD'), 'lastDay', to_char(y.ends_on - 1, 'YYYY-MM-DD'),
      'terms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'termNo', t.term_no::text, 'name', t.label,
                   'startsOn', to_char(t.starts_on, 'YYYY-MM-DD'), 'lastDay', to_char(t.ends_on - 1, 'YYYY-MM-DD')) ORDER BY t.term_no)
                 FROM workhub.terms t WHERE t.school_id = y.school_id AND t.academic_year_id = y.id), '[]'::jsonb),
      'departments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.sort_order, d.id)
                 FROM workhub.year_departments d WHERE d.school_id = y.school_id AND d.academic_year_id = y.id AND d.removed_at IS NULL), '[]'::jsonb),
      'classes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'grade', c.grade::text, 'classNo', COALESCE(c.class_no::text, ''),
                   'name', c.name, 'kind', c.kind) ORDER BY c.sort_order, c.id)
                 FROM workhub.year_classes c WHERE c.school_id = y.school_id AND c.academic_year_id = y.id AND c.removed_at IS NULL), '[]'::jsonb)),
    'subjects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name) ORDER BY j.sort_order, j.id)
                 FROM workhub.year_subjects j WHERE j.school_id = y.school_id AND j.academic_year_id = y.id AND j.removed_at IS NULL), '[]'::jsonb))
  FROM workhub.academic_years y JOIN workhub.schools s ON s.id = y.school_id
  WHERE y.school_id = p_school_id AND y.id = p_year_id
$$;

-- 소속의 현재 학교 권한 3종(앱 capabilities). 학교 범위 역할만, 오늘 유효한 것만(R0 member_has_perm).
CREATE FUNCTION workhub_private.p1_capabilities(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'configuration', workhub_private.member_has_perm(p_ctx, 'year.manage'),
    'memberships',   workhub_private.member_has_perm(p_ctx, 'membership.approve'),
    'assignments',   workhub_private.member_has_perm(p_ctx, 'role.grant'))
$$;

CREATE FUNCTION workhub_private.p1_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.p1_installs WHERE batch IN ('P1-01','P1-02') AND release = '2026-10-16.1') = 2
$$;

-- 응답 봉투(앱 schoolAdminEnvelope): data 또는 error 하나만
CREATE FUNCTION workhub_private.p1_envelope(p_ctx workhub_private.actor_context, p_member_id text, p_data jsonb, p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('kind', 'workhub-school-admin', 'schemaVersion', 1, 'schoolId', p_ctx.school_id, 'memberId', p_member_id)
      || CASE WHEN p_error IS NULL THEN jsonb_build_object('data', p_data) ELSE jsonb_build_object('error', jsonb_build_object('code', p_error)) END
$$;

-- ----------------------------------------------------------------------------
-- 8. R0 함수 교체 2개 — 공식 담당을 업무실 관계(부서·학년·교과)로 잇는다
-- ----------------------------------------------------------------------------
-- P1: 오늘(학교 시간대) 유효한 공식 담당에서 계산한다. 학년 = 담임 학급의 학년. 담당이 없으면 R0 와 같이 빈 목록.
CREATE OR REPLACE FUNCTION workhub_private.member_relations(p_school_id text, p_membership_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH today AS (
    SELECT workhub_private.today_in(s.timezone) AS d FROM workhub.schools s WHERE s.id = p_school_id
  ), live AS (
    SELECT a.* FROM workhub.staff_assignments a, today
    WHERE a.school_id = p_school_id AND a.membership_id = p_membership_id
      AND today.d <@ daterange(a.valid_from, a.valid_to, '[)')
  )
  SELECT jsonb_build_object(
    'departmentIds', COALESCE((SELECT jsonb_agg(DISTINCT l.department_id ORDER BY l.department_id) FROM live l WHERE l.kind = 'department'), '[]'::jsonb),
    'gradeIds',      COALESCE((SELECT jsonb_agg(DISTINCT c.grade::text ORDER BY c.grade::text) FROM live l
                                JOIN workhub.year_classes c ON c.id = l.class_id WHERE l.kind = 'homeroom'), '[]'::jsonb),
    'subjectIds',    COALESCE((SELECT jsonb_agg(DISTINCT l.subject_id ORDER BY l.subject_id) FROM live l WHERE l.kind = 'subject'), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.workhub_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; a workhub.accounts; v_basis date;
BEGIN
  v_uid := workhub_private.legacy_gate(false);
  a := workhub_private.caller_account(v_uid, false);
  -- 아직 연결되지 않은 승인 superadmin: 소속 없음으로 응답(앱은 '학교 연결 없음'으로 안내)
  IF a.id IS NULL THEN
    RETURN jsonb_build_object('basisDate', to_char((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD'),
      'schools', '[]'::jsonb, 'memberships', '[]'::jsonb, 'schoolLabels', '{}'::jsonb);
  END IF;
  RETURN (
    WITH my_schools AS (
      SELECT s.* FROM workhub.schools s
      WHERE s.status = 'active' AND EXISTS (
        SELECT 1 FROM workhub.memberships m
        WHERE m.school_id = s.id AND m.account_id = a.id AND m.status = 'active'
          AND workhub_private.today_in(s.timezone) <@ daterange(m.valid_from, m.valid_to, '[)'))
    ), members AS (
      SELECT m.*, s.timezone, ac.display_name, ac.auth_user_id, ac.status AS account_status
      FROM workhub.memberships m JOIN my_schools s ON s.id = m.school_id JOIN workhub.accounts ac ON ac.id = m.account_id
      WHERE m.status IN ('active','suspended','left') AND m.valid_from IS NOT NULL
    )
    SELECT jsonb_build_object(
      -- 기준일: 학교 시간대의 오늘. 연결된 학교가 없을 때만 기본 시간대를 쓴다.
      'basisDate', to_char(COALESCE((SELECT min(workhub_private.today_in(timezone)) FROM my_schools),
                                    (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD'),
      'schools', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name, s.id) FROM my_schools s), '[]'::jsonb),
      'memberships', COALESCE((SELECT jsonb_agg(
          jsonb_build_object('id', x.id, 'schoolId', x.school_id, 'userId', x.auth_user_id::text, 'name', x.display_name,
            'role', CASE WHEN workhub_private.member_has_perm(ROW('member', x.account_id, x.id, NULL, x.school_id, 's:' || x.school_id,
                                  x.auth_user_id, workhub_private.today_in(x.timezone), x.timezone)::workhub_private.actor_context,
                                  'calendar.shared_manage') THEN 'calendar_manager' ELSE 'teacher' END,
            'active', x.status = 'active' AND x.account_status = 'active',
            'validFrom', to_char(x.valid_from, 'YYYY-MM-DD'),
            -- 통합 설계의 종료 제외(valid_to)를 앱의 마지막 유효일(포함)로 바꾼다. 무기한은 9999-12-31.
            'validThrough', COALESCE(to_char(x.valid_to - 1, 'YYYY-MM-DD'), '9999-12-31'))
          || workhub_private.member_relations(x.school_id, x.id)
          ORDER BY x.school_id, x.id) FROM members x), '[]'::jsonb),
      'schoolLabels', COALESCE((SELECT jsonb_object_agg(s.id, jsonb_build_object(
          -- P1: R0 부서 + 오늘이 든 학년도의 학교 관리 부서(공식 담당 대상)
          'departmentIds', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.o1, d.o2, d.name, d.id)
                                     FROM (SELECT d0.id, d0.name, 0 AS o1, d0.sort_order::integer AS o2 FROM workhub.departments d0
                                            WHERE d0.school_id = s.id AND workhub_private.today_in(s.timezone) <@ daterange(d0.active_from, d0.active_to, '[)')
                                           UNION ALL
                                           SELECT d1.id, d1.name, 1, d1.sort_order FROM workhub.year_departments d1
                                             JOIN workhub.academic_years y ON y.school_id = d1.school_id AND y.id = d1.academic_year_id
                                            WHERE d1.school_id = s.id AND d1.removed_at IS NULL
                                              AND workhub_private.today_in(s.timezone) <@ daterange(y.starts_on, y.ends_on, '[)')) d), '[]'::jsonb),
          'gradeIds', (SELECT jsonb_agg(jsonb_build_object('id', g::text, 'name', g::text || '학년') ORDER BY g) FROM generate_series(1, s.grade_count) g),
          -- P1: 오늘이 든 학년도의 교과
          'subjectIds', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name) ORDER BY j.sort_order, j.id)
                                  FROM workhub.year_subjects j
                                  JOIN workhub.academic_years y ON y.school_id = j.school_id AND y.id = j.academic_year_id
                                 WHERE j.school_id = s.id AND j.removed_at IS NULL
                                   AND workhub_private.today_in(s.timezone) <@ daterange(y.starts_on, y.ends_on, '[)')), '[]'::jsonb)))
          FROM my_schools s), '{}'::jsonb))
  );
END $$;

-- ----------------------------------------------------------------------------
-- 9. 권한 — 새 표·내부 함수는 아무 API 역할에도 주지 않는다. workhub_context 는 R0 와 같이 authenticated 만.
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
REVOKE ALL ON FUNCTION public.workhub_context() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_context() TO authenticated;

INSERT INTO workhub_private.p1_installs (batch, release) VALUES ('P1-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 10. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'P1-01-1' AS no, '새 표 6개 + RLS 켜짐 + API 역할 표 권한 0' AS item,
       CASE WHEN count(*) = 6 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM pg_class c
WHERE c.oid IN (to_regclass('workhub.school_admin_activations'), to_regclass('workhub.year_departments'), to_regclass('workhub.year_classes'),
                to_regclass('workhub.year_subjects'), to_regclass('workhub.staff_assignments'), to_regclass('workhub.school_admin_changes'))
UNION ALL
SELECT 'P1-01-2', '활성화 0개(어느 학교도 켜지 않음)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text FROM workhub.school_admin_activations
UNION ALL
SELECT 'P1-01-3', 'R0 제약 넓힘(학년 20 · 학기 이름 50 · 학기 중첩 DEFERRABLE)',
       CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'schools_grade_count_check' AND conrelid = 'workhub.schools'::regclass) LIKE '%<= 20%'
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'terms_label_check' AND conrelid = 'workhub.terms'::regclass) LIKE '%<= 50%'
             AND (SELECT condeferrable AND NOT condeferred FROM pg_constraint WHERE conname = 'terms_no_overlap' AND conrelid = 'workhub.terms'::regclass)
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P1-01-4', '내부 함수 EXECUTE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P1-01-5', 'workhub_context: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
             AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] THEN 'ok' ELSE 'FAIL' END, ''
FROM pg_proc p WHERE p.oid = 'public.workhub_context()'::regprocedure
UNION ALL
SELECT 'P1-01-6', '적용 기록 P1-01',
       CASE WHEN EXISTS (SELECT 1 FROM workhub_private.p1_installs WHERE batch = 'P1-01' AND release = '2026-10-16.1') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
