-- ============================================================================
-- P8-04  정책 보강 4 — 수업 담당 교체 · 담당 종료 · 수강 종료 · 전출(학적 종료) (비활성 설치)
--
-- ▣ 확정 정책(2026-10-16 계란님): 담당 교체·종료, 수강 종료·전출을 지원한다. 앱 계약 = PR #60 teaching-relations.v1
--   (docs/workhub/pilot-completion/teaching-relations-contract.md · apps/workhub/src/teaching/relations-*.ts).
-- ▣ 증분만: P5 의 담당(course_assignments) · 학적(student_enrollments) · 수강(course_memberships) 행은 UPDATE/DELETE 하지 않는다.
--   종료는 새 표 workhub.teaching_relation_ends 에 "종료 사건"으로 쌓고, 실제 유효 기간은 원래 기간과 마지막 종료 사건으로 계산한다.
--     유효 끝(제외) = 사건 없음 → 원래 valid_to · 마지막 사건 last_day 있음 → last_day + 1 · last_day 없음(시작 전 취소) → valid_from(빈 기간)
--   관계 판(DTO version) = 1 + 그 관계의 종료 사건 수. 학생 원본 판 · 수업 판과 섞지 않는다.
-- ▣ 새로 만드는 것
--   표 3개: teaching_relation_ends(종료 사건, 고칠 수 없음) · teaching_relation_previews(10분 미리보기, 한 번만 사용 처리)
--           · teaching_relation_commits(확정 접수 원장, 고칠 수 없음). RLS 켜고 정책 없음(API 직접 접근 0).
--   공개 함수 3개(authenticated): workhub_teaching_relations(p_member_id, p_course_id)
--                                 workhub_teaching_relation_preview(p_member_id, p_intent)
--                                 workhub_teaching_relation_commit(p_member_id, p_command, p_request_key)
--   트리거 5개(종료 뒤 새 기록 차단): 관찰·상담 판 · 평가 판 · 활동 행 채택 · 활동 원문판 · 새 수강(학적 종료 뒤)
-- ▣ 바꾸는 P5 함수 4개(CREATE OR REPLACE — 이름 · 인자 · 권한 그대로, 종료 사건이 없으면 결과가 원본과 같다)
--     p5_current_assignment  "오늘 유효한 담당"을 유효 기간으로(종료 뒤에는 쓰기·상담·명부 권한이 없다)
--     p5_course_visible · p5_catalog  시작 전에 취소된 담당만으로는 수업이 보이지 않는다(지난 담당은 계속 보인다 — 자기 기록 열람)
--     p5_roster_import       종료된 수강·학적을 명부 재업로드로 "같음" 처리하지 않고 CONFLICT
--   그 밖의 P5 함수 · 표 · 정책은 바꾸지 않는다. p5_document_student_check(P4 근거 확인)는 그대로다 — 종료일 뒤 기록이 있으면
--   확정을 거절하고(아래) 종료 뒤 새 기록은 트리거가 막으므로, 남아 있는 근거는 모두 유효 기간 안의 기록이다.
-- ▣ 켜는 조건: 학교에 수업(P5, teaching) 이 준비(ready)이고 teaching_relations 모듈이 켜져 있을 때만(P8-06). 꺼져 있으면 세 함수 모두
--   UNAVAILABLE 이고, 종료 사건이 0건이므로 P5 기존 화면 · 명령의 결과는 설치 전과 같다.
-- ▣ 전제: P8-01 · P5-01 · P5-02(2026-10-16.1). 바꿀 P5 함수가 원본 판이 아니면 멈춘다. 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('workhub_private.p8_installs') IS NULL THEN RAISE EXCEPTION 'P8 중단: P8-01(2026-10-16.1)을 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch = 'P8-01' AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 1 THEN RAISE EXCEPTION 'P8 중단: P8-01(2026-10-16.1)을 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch = 'P8-04'$q$ INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'P8 중단: P8-04 가 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF to_regclass('workhub_private.p5_installs') IS NULL THEN RAISE EXCEPTION 'P8 중단: P5-01·02(2026-10-16.1, 수업·학생)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p5_installs WHERE batch IN ('P5-01','P5-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P8 중단: P5-01·02(2026-10-16.1, 수업·학생)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub.teaching_relation_ends') IS NOT NULL OR to_regclass('workhub.teaching_relation_previews') IS NOT NULL
     OR to_regclass('workhub.teaching_relation_commits') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p8\_rel%' OR proname = 'p8_eff_to' OR proname LIKE 'workhub\_teaching\_relation%') THEN
    RAISE EXCEPTION 'P8 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  -- 바꿀 P5 함수가 원본 판인가(본문 md5 — INT-03 의 P5 기대값과 같다)
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'workhub_private.p5_current_assignment(workhub_private.actor_context,text)'::regprocedure)
       IS DISTINCT FROM 'b63862e27ab0f96ad3dbefc40f955a0b'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'workhub_private.p5_course_visible(workhub_private.actor_context,text)'::regprocedure)
       IS DISTINCT FROM '35e2b05d42be699a268271208ac76a6a'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'workhub_private.p5_catalog(workhub_private.actor_context)'::regprocedure)
       IS DISTINCT FROM '860a344da1281d56f0db538f71d3205e'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'workhub_private.p5_roster_import(workhub_private.actor_context,jsonb,text)'::regprocedure)
       IS DISTINCT FROM '27a2adb5c5d7b78f23249d78fe02d1ca' THEN
    RAISE EXCEPTION 'P8 중단: 바꿀 P5 함수(p5_current_assignment · p5_course_visible · p5_catalog · p5_roster_import)가 원본 판(2026-10-16.1)이 아닙니다. 누가 고쳤는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 표 — 종료 사건 · 미리보기 · 확정 원장
-- ----------------------------------------------------------------------------
-- 종료 사건. kind = 앱 RelationKind. last_day NULL = 시작 전 취소(유효한 날 없음). 관계 판 = 1 + 사건 수 → 사건의 version 은 2부터.
CREATE TABLE workhub.teaching_relation_ends (
  id                        bigint GENERATED ALWAYS AS IDENTITY,
  school_id                 text NOT NULL,
  kind                      text NOT NULL,
  relation_id               text NOT NULL,
  version                   integer NOT NULL,
  last_day                  date,
  reason                    text NOT NULL,
  request_key               text NOT NULL,
  recorded_by_membership_id text NOT NULL,
  recorded_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT teaching_relation_ends_pkey PRIMARY KEY (id),
  CONSTRAINT teaching_relation_ends_version_key UNIQUE (kind, relation_id, version),
  CONSTRAINT teaching_relation_ends_member_fkey FOREIGN KEY (school_id, recorded_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT teaching_relation_ends_kind_check CHECK (kind IN ('assignment','course_membership','enrollment')),
  CONSTRAINT teaching_relation_ends_version_check CHECK (version >= 2),
  CONSTRAINT teaching_relation_ends_reason_check CHECK (length(reason) BETWEEN 1 AND 2000),
  CONSTRAINT teaching_relation_ends_key_check CHECK (request_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$')
);
CREATE TRIGGER teaching_relation_ends_immutable BEFORE UPDATE OR DELETE ON workhub.teaching_relation_ends
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 미리보기: 의도 · 영향 상태(판 · 기간 — 학생 이름 · 본문 없음) · 지문. 10분. 사용 처리(consumed)만 한 번 바뀐다.
CREATE TABLE workhub.teaching_relation_previews (
  id                   text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id            text NOT NULL,
  account_id           text NOT NULL,
  membership_id        text NOT NULL,
  course_id            text NOT NULL,
  intent               jsonb NOT NULL,
  state                jsonb NOT NULL,
  fingerprint          text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  consumed_request_key text,
  CONSTRAINT teaching_relation_previews_pkey PRIMARY KEY (id),
  CONSTRAINT teaching_relation_previews_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT teaching_relation_previews_account_fkey FOREIGN KEY (account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT teaching_relation_previews_course_fkey FOREIGN KEY (school_id, course_id) REFERENCES workhub.courses(school_id, id),
  CONSTRAINT teaching_relation_previews_fp_check CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT teaching_relation_previews_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT teaching_relation_previews_consumed_check CHECK ((consumed_at IS NULL) = (consumed_request_key IS NULL))
);
CREATE FUNCTION workhub_private.p8_rel_preview_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
     OR (to_jsonb(OLD) - ARRAY['consumed_at','consumed_request_key']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['consumed_at','consumed_request_key']) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_relation_previews_guard BEFORE UPDATE OR DELETE ON workhub.teaching_relation_previews
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_preview_guard();

-- 확정 접수 원장: 반영된 요청만. (학교, 계정, 요청 번호). changes = 반영 뒤 관계 판 {kind,id,version}.
CREATE TABLE workhub.teaching_relation_commits (
  school_id                 text NOT NULL,
  account_id                text NOT NULL,
  request_key               text NOT NULL,
  membership_id             text NOT NULL,
  command_hash              text NOT NULL,
  preview_id                text NOT NULL,
  preview_fingerprint       text NOT NULL,
  intent_kind               text NOT NULL,
  changes                   jsonb NOT NULL,
  replacement_assignment_id text,
  applied_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT teaching_relation_commits_pkey PRIMARY KEY (school_id, account_id, request_key),
  CONSTRAINT teaching_relation_commits_preview_key UNIQUE (preview_id),
  CONSTRAINT teaching_relation_commits_preview_fkey FOREIGN KEY (preview_id) REFERENCES workhub.teaching_relation_previews(id),
  CONSTRAINT teaching_relation_commits_member_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT teaching_relation_commits_account_fkey FOREIGN KEY (account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT teaching_relation_commits_replacement_fkey FOREIGN KEY (replacement_assignment_id) REFERENCES workhub.course_assignments(id),
  CONSTRAINT teaching_relation_commits_key_check CHECK (request_key ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$'),
  CONSTRAINT teaching_relation_commits_hash_check CHECK (command_hash ~ '^[0-9a-f]{64}$' AND preview_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT teaching_relation_commits_kind_check CHECK (intent_kind IN ('assignment_end','assignment_replace','membership_end','student_transfer_out')
                                                        AND (intent_kind = 'assignment_replace') = (replacement_assignment_id IS NOT NULL)),
  CONSTRAINT teaching_relation_commits_changes_check CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) >= 1)
);
CREATE TRIGGER teaching_relation_commits_immutable BEFORE UPDATE OR DELETE ON workhub.teaching_relation_commits
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workhub.teaching_relation_ends','workhub.teaching_relation_previews','workhub.teaching_relation_commits'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. 유효 기간 · 관계 판
-- ----------------------------------------------------------------------------
-- 유효 끝(제외). 사건이 없으면 원래 valid_to.
CREATE FUNCTION workhub_private.p8_eff_to(p_kind text, p_id text, p_from date, p_to date) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT CASE WHEN e.last_day IS NULL THEN p_from ELSE e.last_day + 1 END
                     FROM workhub.teaching_relation_ends e WHERE e.kind = p_kind AND e.relation_id = p_id
                    ORDER BY e.version DESC LIMIT 1), p_to)
$$;
CREATE FUNCTION workhub_private.p8_rel_version(p_kind text, p_id text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 1 + count(*)::integer FROM workhub.teaching_relation_ends e WHERE e.kind = p_kind AND e.relation_id = p_id
$$;

-- 종료 사건 자체의 규칙(함수가 이미 확인한 것을 표에서 한 번 더): 같은 학교의 실제 관계 · 다음 판 · 기간을 줄이기만
CREATE FUNCTION workhub_private.p8_rel_end_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_school text; v_from date; v_to date; v_eff date;
BEGIN
  IF NEW.kind = 'assignment' THEN
    SELECT school_id, valid_from, valid_to INTO v_school, v_from, v_to FROM workhub.course_assignments WHERE id = NEW.relation_id;
  ELSIF NEW.kind = 'course_membership' THEN
    SELECT school_id, valid_from, valid_to INTO v_school, v_from, v_to FROM workhub.course_memberships WHERE id = NEW.relation_id;
  ELSE
    SELECT school_id, valid_from, valid_to INTO v_school, v_from, v_to FROM workhub.student_enrollments WHERE id = NEW.relation_id;
  END IF;
  v_eff := workhub_private.p8_eff_to(NEW.kind, NEW.relation_id, v_from, v_to);
  IF v_school IS DISTINCT FROM NEW.school_id OR NEW.version <> workhub_private.p8_rel_version(NEW.kind, NEW.relation_id) + 1
     OR v_eff <= v_from
     OR (NEW.last_day IS NOT NULL AND (NEW.last_day < v_from OR NEW.last_day + 1 >= v_eff)) THEN
    RAISE EXCEPTION 'P8_RELATION_END_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teaching_relation_ends_guard BEFORE INSERT ON workhub.teaching_relation_ends
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_end_guard();

-- ----------------------------------------------------------------------------
-- 3. P5 함수 4개 보강 (원본과의 차이는 [P8-04] 표시 줄뿐 — 시험 P8-B 가 원본과 비교한다)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workhub_private.p5_current_assignment(p_ctx workhub_private.actor_context, p_course text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id FROM workhub.course_assignments a
   WHERE a.school_id = p_ctx.school_id AND a.course_id = p_course AND a.membership_id = p_ctx.membership_id
     AND a.account_id = p_ctx.account_id AND p_ctx.school_today <@ daterange(a.valid_from, workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to), '[)')  -- [P8-04] 종료 사건 반영 유효 끝
   ORDER BY a.valid_from DESC, a.id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION workhub_private.p5_course_visible(p_ctx workhub_private.actor_context, p_course text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.courses c WHERE c.school_id = p_ctx.school_id AND c.id = p_course)
     AND (workhub_private.p5_manager(p_ctx)
          OR EXISTS (SELECT 1 FROM workhub.course_assignments a WHERE a.school_id = p_ctx.school_id AND a.course_id = p_course
                       AND a.membership_id = p_ctx.membership_id AND a.account_id = p_ctx.account_id
                       AND workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to) > a.valid_from))  -- [P8-04] 종료 사건 반영 유효 끝
$$;

CREATE OR REPLACE FUNCTION workhub_private.p5_catalog(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_m boolean := workhub_private.p5_manager(p_ctx); v_courses jsonb; v_terms jsonb; v_subjects jsonb; v_teachers jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(workhub_private.p5_course_dto(p_ctx, c) ORDER BY c.valid_from DESC, c.label, c.id), '[]'::jsonb) INTO v_courses
    FROM workhub.courses c
   WHERE c.school_id = p_ctx.school_id
     AND (v_m OR EXISTS (SELECT 1 FROM workhub.course_assignments a WHERE a.school_id = c.school_id AND a.course_id = c.id
                           AND a.membership_id = p_ctx.membership_id AND a.account_id = p_ctx.account_id
                           AND workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to) > a.valid_from));  -- [P8-04] 종료 사건 반영 유효 끝
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'schoolId', t.school_id, 'version', t.version, 'label', t.label,
                    'firstDay', workhub_private.p5_day(t.starts_on), 'lastDay', workhub_private.p5_last(t.ends_on))
                  ORDER BY t.starts_on, t.id), '[]'::jsonb) INTO v_terms
    FROM workhub.terms t WHERE t.school_id = p_ctx.school_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', y.id, 'label', y.name) ORDER BY y.sort_order, y.id), '[]'::jsonb) INTO v_subjects
    FROM workhub.year_subjects y
   WHERE y.school_id = p_ctx.school_id
     AND (y.removed_at IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_courses) c WHERE c ->> 'subjectId' = y.id));
  IF v_m THEN
    -- 수신 범위 결정(2026-10-16 "좁히기")과 같은 기준: 학교에서 지금 업무실을 쓸 수 있는 회원만
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'label', left(a.display_name, 120)) ORDER BY a.display_name, m.id), '[]'::jsonb)
      INTO v_teachers
      FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
     WHERE m.school_id = p_ctx.school_id AND workhub_private.p2_member_reachable(m.school_id, m.id);
  ELSE
    v_teachers := '[]'::jsonb;
  END IF;
  -- 한도를 넘으면 잘라서 전체처럼 보이지 않는다
  IF jsonb_array_length(v_courses) > 300 OR jsonb_array_length(v_terms) > 300 OR jsonb_array_length(v_subjects) > 300
     OR jsonb_array_length(v_teachers) > 300 THEN
    RAISE EXCEPTION 'QUERY_FAILED';
  END IF;
  RETURN jsonb_build_object('courses', v_courses, 'terms', v_terms, 'subjects', v_subjects, 'approvedTeachers', v_teachers,
                            'canManageCourses', v_m);
END $$;

CREATE OR REPLACE FUNCTION workhub_private.p5_roster_import(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; y workhub.academic_years; v_grades smallint; v_from date; v_to date; r jsonb;
        s workhub.students; e workhub.student_enrollments; m workhub.course_memberships; v_added integer := 0; v_same integer := 0;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId', 'update');
  IF NOT (workhub_private.p5_manager(p_ctx) OR workhub_private.p5_current_assignment(p_ctx, co.id) IS NOT NULL) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF co.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_from := (c ->> 'validFrom')::date; v_to := (c ->> 'validThrough')::date + 1;
  IF v_from < co.valid_from OR v_to > co.valid_to THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT grade_count INTO v_grades FROM workhub.schools WHERE id = p_ctx.school_id;
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND id = co.academic_year_id;
  FOR r IN SELECT x FROM jsonb_array_elements(c -> 'rows') x LOOP
    IF (r ->> 'grade')::integer > v_grades THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO s FROM workhub.students WHERE school_id = p_ctx.school_id AND school_student_key = r ->> 'schoolStudentKey' FOR SHARE;
    IF s.id IS NULL THEN
      INSERT INTO workhub.students (school_id, school_student_key, name, created_by_membership_id)
      VALUES (p_ctx.school_id, r ->> 'schoolStudentKey', r ->> 'name', p_ctx.membership_id) RETURNING * INTO s;
    ELSIF s.name <> r ->> 'name' THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    SELECT * INTO e FROM workhub.student_enrollments WHERE student_id = s.id AND academic_year_id = y.id FOR SHARE;
    IF e.id IS NULL THEN
      INSERT INTO workhub.student_enrollments (school_id, student_id, academic_year_id, grade, class_label, seat_number, valid_from, valid_to,
                                               created_by_membership_id)
      VALUES (p_ctx.school_id, s.id, y.id, (r ->> 'grade')::smallint, r ->> 'classLabel', (r ->> 'seatNumber')::smallint, y.starts_on, y.ends_on,
              p_ctx.membership_id) RETURNING * INTO e;
    ELSIF (e.grade, e.class_label, e.seat_number) IS DISTINCT FROM ((r ->> 'grade')::smallint, r ->> 'classLabel', (r ->> 'seatNumber')::smallint) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    SELECT * INTO m FROM workhub.course_memberships WHERE course_id = co.id AND student_id = s.id;
    IF m.id IS NULL THEN
      INSERT INTO workhub.course_memberships (school_id, course_id, student_id, enrollment_id, valid_from, valid_to, created_by_membership_id)
      VALUES (p_ctx.school_id, co.id, s.id, e.id, v_from, v_to, p_ctx.membership_id);
      v_added := v_added + 1;
    ELSIF (m.valid_from, m.valid_to, m.enrollment_id) IS DISTINCT FROM (v_from, v_to, e.id) THEN
      RAISE EXCEPTION 'CONFLICT';
    ELSIF EXISTS (SELECT 1 FROM workhub.teaching_relation_ends x
                   WHERE (x.kind = 'course_membership' AND x.relation_id = m.id) OR (x.kind = 'enrollment' AND x.relation_id = e.id)) THEN
      -- [P8-04] 종료된 수강·학적은 명부를 다시 올려도 되살리지 않는다(종료 취소·재등록은 별도 계약). 조용히 "같음"으로 세지 않는다.
      RAISE EXCEPTION 'CONFLICT';
    ELSE
      v_same := v_same + 1;
    END IF;
  END LOOP;
  UPDATE workhub.courses SET version = version + 1, updated_at = clock_timestamp() WHERE id = co.id;
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.roster_import', 'course', co.id, co.version + 1, 'school', p_key,
    jsonb_build_object('rows', jsonb_array_length(c -> 'rows'), 'added', v_added, 'unchanged', v_same));
  RETURN jsonb_build_object('entityId', co.id, 'version', co.version + 1);
END $$;

-- ----------------------------------------------------------------------------
-- 4. 종료 뒤 새 기록 차단 트리거. 관계 행을 FOR SHARE 로 잠가 확정(FOR UPDATE)과 줄을 세운다 — 확정이 먼저면 새 사건을 보고 거절하고,
--    기록이 먼저면 확정이 그 기록을 보고 CONFLICT 로 거절한다. 종료 사건이 없으면 P5 원래 검사와 결과가 같다.
-- ----------------------------------------------------------------------------
-- 관찰·상담 판 · 평가 판: 기록 날짜 < 수강 유효 끝 · 담당 유효 끝 (철회판은 원래 날짜를 그대로 옮기므로 보지 않는다)
CREATE FUNCTION workhub_private.p8_rel_record_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_m text; v_a text; m workhub.course_memberships; a workhub.course_assignments;
BEGIN
  IF NEW.state <> 'active' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'teaching_record_revisions' THEN
    SELECT course_membership_id, assignment_id INTO v_m, v_a FROM workhub.teaching_records WHERE id = NEW.record_id;
  ELSE
    SELECT course_membership_id, assignment_id INTO v_m, v_a FROM workhub.assessments WHERE id = NEW.assessment_id;
  END IF;
  SELECT * INTO m FROM workhub.course_memberships WHERE id = v_m FOR SHARE;
  SELECT * INTO a FROM workhub.course_assignments WHERE id = v_a FOR SHARE;
  IF NEW.occurred_on >= workhub_private.p8_eff_to('course_membership', m.id, m.valid_from, m.valid_to)
     OR NEW.occurred_on >= workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER p8_rel_record_guard BEFORE INSERT ON workhub.teaching_record_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_record_guard();
CREATE TRIGGER p8_rel_record_guard BEFORE INSERT ON workhub.assessment_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_record_guard();

-- 활동 행 채택: 활동일 < 수강 유효 끝
CREATE FUNCTION workhub_private.p8_rel_adopt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m workhub.course_memberships; v_on date;
BEGIN
  IF NEW.disposition <> 'adopt' OR NEW.course_membership_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.occurred_on INTO v_on FROM workhub.activity_items i JOIN workhub.activity_imports p ON p.id = i.import_id WHERE i.id = NEW.item_id;
  SELECT * INTO m FROM workhub.course_memberships WHERE id = NEW.course_membership_id FOR SHARE;
  IF v_on >= workhub_private.p8_eff_to('course_membership', m.id, m.valid_from, m.valid_to) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER p8_rel_adopt_guard BEFORE INSERT ON workhub.activity_item_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_adopt_guard();

-- 활동 원문판: 담당이 종료됐으면 활동일 < 담당 유효 끝 (P5 는 담당 원래 기간으로 활동일을 보지 않았으므로 사건이 있을 때만)
CREATE FUNCTION workhub_private.p8_rel_import_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a workhub.course_assignments; v_eff date;
BEGIN
  SELECT * INTO a FROM workhub.course_assignments WHERE id = NEW.assignment_id FOR SHARE;
  v_eff := workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to);
  IF v_eff <> a.valid_to AND NEW.occurred_on >= v_eff THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER p8_rel_import_guard BEFORE INSERT ON workhub.activity_imports
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_import_guard();

-- 새 수강: 학적이 종료됐으면 수강 끝 ≤ 학적 유효 끝 (전출 학생을 명부 재업로드로 다른 수업에 새로 넣지 않는다)
CREATE FUNCTION workhub_private.p8_rel_membership_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e workhub.student_enrollments; v_eff date;
BEGIN
  SELECT * INTO e FROM workhub.student_enrollments WHERE id = NEW.enrollment_id FOR SHARE;
  v_eff := workhub_private.p8_eff_to('enrollment', e.id, e.valid_from, e.valid_to);
  IF v_eff <> e.valid_to AND NEW.valid_to > v_eff THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER p8_rel_membership_guard BEFORE INSERT ON workhub.course_memberships
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_rel_membership_guard();

-- ----------------------------------------------------------------------------
-- 5. 준비 · 봉투 · DTO
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p8_rel_ready(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p8_installed('P8-04') AND workhub_private.p5_ready(p_school)
     AND workhub_private.p2_module_active(p_school, 'teaching_relations')
$$;
-- 성공 봉투(앱 RelationsSnapshot 등의 TeachingScope). ok:true 는 넣지 않는다(계약 원형).
CREATE FUNCTION workhub_private.p8_rel_env(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contractVersion', 'teaching-relations.v1', 'schoolId', p_ctx.school_id,
                            'memberId', p_ctx.membership_id, 'ownerUserId', p_ctx.auth_user_id::text)
$$;
-- 거절: 봉투 + ok:false, code. 확정(commit)은 + requestKey, commandHash(= SHA-256(앱 relationCanonical(p_command)) = p2_sha).
CREATE FUNCTION workhub_private.p8_rel_fail(p_ctx workhub_private.actor_context, p_code text, p_key text, p_hash text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p8_rel_env(p_ctx) || jsonb_build_object('ok', false, 'code', p_code)
      || CASE WHEN p_key IS NULL OR p_hash IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('requestKey', p_key, 'commandHash', p_hash) END
$$;

-- 앱 TeachingRelation(정확한 13키). 유효 끝 = 시작이면 effectiveThrough null(시작 전 취소).
CREATE FUNCTION workhub_private.p8_rel_dto(p_kind text, p_id text, p_school text, p_course text, p_course_label text, p_member text,
  p_student text, p_enrollment text, p_label text, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_id, 'schoolId', p_school, 'version', workhub_private.p8_rel_version(p_kind, p_id), 'kind', p_kind,
           'courseId', p_course, 'courseLabel', p_course_label, 'memberId', p_member, 'studentId', p_student, 'enrollmentId', p_enrollment,
           'label', p_label, 'validFrom', workhub_private.p5_day(p_from), 'validThrough', workhub_private.p5_last(p_to),
           'effectiveThrough', CASE WHEN x.eff <= p_from THEN NULL ELSE workhub_private.p5_last(x.eff) END)
    FROM (SELECT workhub_private.p8_eff_to(p_kind, p_id, p_from, p_to) AS eff) x
$$;
CREATE FUNCTION workhub_private.p8_rel_assignment(a workhub.course_assignments, co workhub.courses) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p8_rel_dto('assignment', a.id, a.school_id, a.course_id, workhub_private.p8_label(co.label, 120, '수업'), a.membership_id,
           NULL, NULL, (SELECT workhub_private.p8_label(x.display_name, 120, '교사') FROM workhub.accounts x WHERE x.id = a.account_id),
           a.valid_from, a.valid_to)
$$;
-- 수강의 화면 이름 = 수업 이름(전출 미리보기에서 어느 수업인지 보이게)
CREATE FUNCTION workhub_private.p8_rel_membership(m workhub.course_memberships, co workhub.courses) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p8_rel_dto('course_membership', m.id, m.school_id, m.course_id, workhub_private.p8_label(co.label, 120, '수업'), NULL,
           m.student_id, m.enrollment_id, workhub_private.p8_label(co.label, 120, '수업'), m.valid_from, m.valid_to)
$$;
-- 학적의 화면 이름 = 학년 · 반 · 번호
CREATE FUNCTION workhub_private.p8_rel_enrollment(e workhub.student_enrollments) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p8_rel_dto('enrollment', e.id, e.school_id, NULL, NULL, NULL, e.student_id, e.id,
           workhub_private.p8_label(e.grade || '학년 ' || CASE WHEN e.class_label ~ '반$' THEN e.class_label ELSE e.class_label || '반' END
                                    || ' ' || e.seat_number || '번', 120, '학적'),
           e.valid_from, e.valid_to)
$$;

-- ----------------------------------------------------------------------------
-- 6. 관계 목록 (workhub_teaching_relations)
--    볼 수 있는 수업(P5 와 같은 규칙: 관리자 · 그 수업을 맡은 적 있는 본인) · 담당 ≤300 · 수강 학생 ≤1000 · 승인 교사 ≤300(관리자에게만).
--    권한: 담당 교체·종료 = 전출 = 학교 관리자(year.manage, P5 와 같은 기준) · 수강 종료 = 관리자 또는 오늘 유효한 담당(P5 명부 권한).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p8_rel_snapshot(p_ctx workhub_private.actor_context, p_course text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; v_m boolean := workhub_private.p5_manager(p_ctx); v_cur boolean; v_a jsonb; v_s jsonb; v_t jsonb;
BEGIN
  IF p_course IS NULL OR NOT workhub_private.p5_key(p_course) OR NOT workhub_private.p5_course_visible(p_ctx, p_course) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  SELECT * INTO co FROM workhub.courses WHERE school_id = p_ctx.school_id AND id = p_course;
  v_cur := workhub_private.p5_current_assignment(p_ctx, co.id) IS NOT NULL;
  SELECT COALESCE(jsonb_agg(workhub_private.p8_rel_assignment(a, co) ORDER BY a.valid_from, a.id), '[]'::jsonb) INTO v_a
    FROM workhub.course_assignments a WHERE a.school_id = co.school_id AND a.course_id = co.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('studentId', s.id, 'name', workhub_private.p8_label(s.name, 120, '학생'),
                    'membership', workhub_private.p8_rel_membership(m, co), 'enrollment', workhub_private.p8_rel_enrollment(e))
                  ORDER BY e.grade, e.class_label, e.seat_number, s.id), '[]'::jsonb) INTO v_s
    FROM workhub.course_memberships m
    JOIN workhub.students s ON s.school_id = m.school_id AND s.id = m.student_id
    JOIN workhub.student_enrollments e ON e.school_id = m.school_id AND e.student_id = m.student_id AND e.id = m.enrollment_id
   WHERE m.school_id = co.school_id AND m.course_id = co.id;
  IF v_m THEN
    -- 협업 수신 범위와 같은 기준("좁히기"): 지금 업무실을 쓸 수 있는 회원. 기간은 수업 기간 안으로 잘라 보여 준다.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId', x.id, 'label', x.label, 'validFrom', workhub_private.p5_day(x.f),
                      'validThrough', workhub_private.p5_last(x.t)) ORDER BY x.label, x.id), '[]'::jsonb) INTO v_t
      FROM (SELECT m.id, workhub_private.p8_label(a.display_name, 120, '교사') AS label,
                   greatest(m.valid_from, co.valid_from) AS f, least(COALESCE(m.valid_to, 'infinity'::date), co.valid_to) AS t
              FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
             WHERE m.school_id = co.school_id AND workhub_private.p2_member_reachable(m.school_id, m.id)) x
     WHERE x.f < x.t;
  ELSE
    v_t := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_a) > 300 OR jsonb_array_length(v_s) > 1000 OR jsonb_array_length(v_t) > 300 THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  RETURN jsonb_build_object('courseId', co.id, 'courseVersion', co.version, 'courseLabel', workhub_private.p8_label(co.label, 120, '수업'),
           'basisDate', workhub_private.p5_day(p_ctx.school_today),
           'capabilities', jsonb_build_object('manageAssignments', v_m, 'endMemberships', v_m OR v_cur, 'transferStudents', v_m),
           'assignments', v_a, 'students', v_s, 'approvedTeachers', v_t);
END $$;

-- ----------------------------------------------------------------------------
-- 7. 의도 확인 · 영향 계산 (미리보기와 확정이 같은 함수를 쓴다)
-- ----------------------------------------------------------------------------
-- 앱 validateRelationIntent 와 같은 모양 규칙
CREATE FUNCTION workhub_private.p8_rel_intent_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(workhub_private.p2_exact(p, ARRAY['kind','courseId','expectedCourseVersion','relationId','expectedRelationVersion','studentId',
                                                    'enrollmentId','lastDay','replacementMemberId','reason'])
     AND jsonb_typeof(p -> 'kind') = 'string'
     AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p2_int(p -> 'expectedCourseVersion')
     AND workhub_private.p5_id(p -> 'relationId') AND workhub_private.p2_int(p -> 'expectedRelationVersion')
     AND workhub_private.p5_date(p -> 'lastDay') AND workhub_private.p5_text(p -> 'reason', 2000)
     AND CASE p ->> 'kind'
           WHEN 'assignment_end' THEN p -> 'studentId' = 'null'::jsonb AND p -> 'enrollmentId' = 'null'::jsonb AND p -> 'replacementMemberId' = 'null'::jsonb
           WHEN 'assignment_replace' THEN p -> 'studentId' = 'null'::jsonb AND p -> 'enrollmentId' = 'null'::jsonb AND workhub_private.p5_id(p -> 'replacementMemberId')
           WHEN 'membership_end' THEN workhub_private.p5_id(p -> 'studentId') AND workhub_private.p5_id(p -> 'enrollmentId') AND p -> 'replacementMemberId' = 'null'::jsonb
           WHEN 'student_transfer_out' THEN workhub_private.p5_id(p -> 'studentId') AND workhub_private.p5_id(p -> 'enrollmentId')
                                            AND p -> 'replacementMemberId' = 'null'::jsonb AND p -> 'relationId' = p -> 'enrollmentId'
           ELSE false END, false)
$$;

-- 영향 계산. 돌려주는 것: changes(앱 RelationChange — 변경 전 판) · replacement · state(지문과 확정 재확인에 쓰는 판·기간 — 이름 없음)
--   · courses(판을 올릴 수업). 업무 거절은 예외(코드)로.
CREATE FUNCTION workhub_private.p8_rel_eval(p_ctx workhub_private.actor_context, i jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; a workhub.course_assignments; m workhub.course_memberships; e workhub.student_enrollments; nm workhub.memberships;
        v_kind text := i ->> 'kind'; v_last date; v_from date; v_eff date; v_changes jsonb; v_state jsonb; v_rows jsonb;
        v_repl jsonb := 'null'::jsonb; v_repl_state jsonb := 'null'::jsonb; v_mids text[] := ARRAY[]::text[]; v_aids text[] := ARRAY[]::text[];
        v_courses text[]; v_allowed boolean;
BEGIN
  IF NOT workhub_private.p8_rel_intent_ok(i) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_last := (i ->> 'lastDay')::date;
  IF NOT workhub_private.p5_course_visible(p_ctx, i ->> 'courseId') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO co FROM workhub.courses WHERE school_id = p_ctx.school_id AND id = i ->> 'courseId';
  -- 권한: 담당 · 전출 = 학교 관리자, 수강 종료 = 관리자 또는 오늘 유효한 담당
  v_allowed := workhub_private.p5_manager(p_ctx)
               OR (v_kind = 'membership_end' AND workhub_private.p5_current_assignment(p_ctx, co.id) IS NOT NULL);
  IF NOT v_allowed THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF co.version <> (i ->> 'expectedCourseVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 앞으로의 변경만(소급 종료 없음)
  IF v_last < p_ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  -- 대상
  IF v_kind LIKE 'assignment\_%' THEN
    SELECT * INTO a FROM workhub.course_assignments WHERE school_id = co.school_id AND course_id = co.id AND id = i ->> 'relationId';
    IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF workhub_private.p8_rel_version('assignment', a.id) <> (i ->> 'expectedRelationVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_from := a.valid_from; v_eff := workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to);
  ELSIF v_kind = 'membership_end' THEN
    SELECT * INTO m FROM workhub.course_memberships
     WHERE school_id = co.school_id AND course_id = co.id AND id = i ->> 'relationId' AND student_id = i ->> 'studentId' AND enrollment_id = i ->> 'enrollmentId';
    IF m.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF workhub_private.p8_rel_version('course_membership', m.id) <> (i ->> 'expectedRelationVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_from := m.valid_from; v_eff := workhub_private.p8_eff_to('course_membership', m.id, m.valid_from, m.valid_to);
  ELSE
    -- 전출: 이 수업에 그 학적으로 수강한 학생의 그 학적만(다른 학년도 학적 · 다른 학생은 건드리지 않는다)
    SELECT * INTO e FROM workhub.student_enrollments WHERE school_id = co.school_id AND id = i ->> 'enrollmentId' AND student_id = i ->> 'studentId';
    IF e.id IS NULL OR NOT EXISTS (SELECT 1 FROM workhub.course_memberships x WHERE x.school_id = co.school_id AND x.course_id = co.id
                                     AND x.student_id = e.student_id AND x.enrollment_id = e.id) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF workhub_private.p8_rel_version('enrollment', e.id) <> (i ->> 'expectedRelationVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_from := e.valid_from; v_eff := workhub_private.p8_eff_to('enrollment', e.id, e.valid_from, e.valid_to);
  END IF;
  -- 마지막 유효일: 시작일 이상 · 현재 유효 마지막 날보다 앞(이미 취소된 관계는 바꿀 수 없음)
  IF v_eff <= v_from OR v_last < v_from OR v_last + 1 >= v_eff THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  -- 영향 집합
  IF v_kind LIKE 'assignment\_%' THEN
    v_rows := jsonb_build_array(workhub_private.p8_rel_assignment(a, co));
    v_aids := ARRAY[a.id];
    v_courses := ARRAY[co.id];
  ELSIF v_kind = 'membership_end' THEN
    v_rows := jsonb_build_array(workhub_private.p8_rel_membership(m, co));
    v_mids := ARRAY[m.id];
    v_courses := ARRAY[co.id];
  ELSE
    -- 학적 + 그 학적의 수강 중 lastDay 뒤까지 유효한 것(이미 끝난 · 취소된 수강은 넣지 않는다). 다른 수업도 포함.
    SELECT jsonb_build_array(workhub_private.p8_rel_enrollment(e))
           || COALESCE(jsonb_agg(workhub_private.p8_rel_membership(x, c2) ORDER BY x.id), '[]'::jsonb),
           COALESCE(array_agg(x.id ORDER BY x.id), ARRAY[]::text[]),
           COALESCE(array_agg(DISTINCT x.course_id), ARRAY[]::text[])
      INTO v_rows, v_mids, v_courses
      FROM workhub.course_memberships x JOIN workhub.courses c2 ON c2.school_id = x.school_id AND c2.id = x.course_id
     WHERE x.school_id = e.school_id AND x.enrollment_id = e.id
       AND workhub_private.p8_eff_to('course_membership', x.id, x.valid_from, x.valid_to) > greatest(x.valid_from, v_last + 1);
    v_courses := ARRAY(SELECT DISTINCT y FROM unnest(v_courses || co.id) y ORDER BY y);
  END IF;
  IF jsonb_array_length(v_rows) > 1001 THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  -- 변경 전 판 + 처리 후 마지막 날 · 효과
  SELECT jsonb_agg(r || jsonb_build_object('afterThrough', CASE WHEN (r ->> 'validFrom')::date > v_last THEN NULL ELSE to_jsonb(i ->> 'lastDay') END,
                                           'effect', CASE WHEN (r ->> 'validFrom')::date > v_last THEN 'cancel_before_start' ELSE 'end' END)
                   ORDER BY CASE r ->> 'kind' WHEN 'enrollment' THEN 0 ELSE 1 END, r ->> 'id')
    INTO v_changes FROM jsonb_array_elements(v_rows) r;

  -- 종료일 뒤 날짜의 기록이 이미 있으면 전부 거절(원문을 고치거나 철회하지 않는다). 철회된 기록 · 정정 전 원문판은 보지 않는다.
  IF EXISTS (SELECT 1 FROM workhub.teaching_records r JOIN workhub.teaching_record_revisions v ON v.id = r.current_revision_id
              WHERE r.state = 'active' AND v.occurred_on > v_last AND (r.course_membership_id = ANY (v_mids) OR r.assignment_id = ANY (v_aids)))
     OR EXISTS (SELECT 1 FROM workhub.assessments x JOIN workhub.assessment_revisions v ON v.id = x.current_revision_id
              WHERE x.state = 'active' AND v.occurred_on > v_last AND (x.course_membership_id = ANY (v_mids) OR x.assignment_id = ANY (v_aids)))
     OR EXISTS (SELECT 1 FROM workhub.activity_items t JOIN workhub.activity_imports p ON p.id = t.import_id
              WHERE t.disposition = 'adopt' AND p.state = 'active' AND p.occurred_on > v_last AND t.course_membership_id = ANY (v_mids))
     OR EXISTS (SELECT 1 FROM workhub.activity_imports p WHERE p.state = 'active' AND p.occurred_on > v_last AND p.assignment_id = ANY (v_aids)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;

  -- 담당 교체: 다른 교사 · 지금 업무실을 쓸 수 있는 회원 · 다음날~기존 유효 끝까지 소속 유효 · 그 기간 같은 수업 담당과 원래 기간이 겹치지 않음
  --   (담당 겹침 금지 제약이 원래 기간으로 걸려 있으므로, 이미 끝낸 예전 담당이라도 원래 기간이 겹치면 거절한다)
  IF v_kind = 'assignment_replace' THEN
    SELECT * INTO nm FROM workhub.memberships WHERE school_id = co.school_id AND id = i ->> 'replacementMemberId';
    IF nm.id IS NULL OR NOT workhub_private.p2_member_reachable(co.school_id, nm.id) OR nm.id = a.membership_id OR nm.account_id = a.account_id
       OR nm.valid_from > v_last + 1 OR COALESCE(nm.valid_to, 'infinity'::date) < v_eff
       OR EXISTS (SELECT 1 FROM workhub.course_assignments y WHERE y.course_id = co.id AND y.membership_id = nm.id
                    AND daterange(y.valid_from, y.valid_to, '[)') && daterange(v_last + 1, v_eff, '[)')) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_repl := jsonb_build_object('memberId', nm.id,
                'label', (SELECT workhub_private.p8_label(x.display_name, 120, '교사') FROM workhub.accounts x WHERE x.id = nm.account_id),
                'validFrom', workhub_private.p5_day(v_last + 1), 'validThrough', workhub_private.p5_last(v_eff));
    v_repl_state := jsonb_build_object('memberId', nm.id, 'accountId', nm.account_id, 'membershipVersion', nm.version,
                                       'permissionVersion', nm.permission_version, 'validFrom', v_last + 1, 'validTo', v_eff);
  END IF;

  -- 지문 · 확정 재확인용 상태: 수업 판 · 영향 관계 판 · 기간 · 새 교사 소속 판 · 학교 수업 정책
  v_state := jsonb_build_object(
    'courses', (SELECT jsonb_object_agg(c.id, c.version) FROM workhub.courses c WHERE c.school_id = co.school_id AND c.id = ANY (v_courses)),
    'changes', (SELECT jsonb_agg(jsonb_build_object('kind', r ->> 'kind', 'id', r ->> 'id', 'version', (r ->> 'version')::integer,
                                                    'effectiveThrough', r -> 'effectiveThrough', 'afterThrough', r -> 'afterThrough')
                                 ORDER BY r ->> 'kind', r ->> 'id') FROM jsonb_array_elements(v_changes) r),
    'replacement', v_repl_state,
    'policy', (SELECT jsonb_build_object('counselingScope', p.counseling_scope, 'createdAt', workhub_private.p2_ts(p.created_at))
                 FROM workhub.teaching_policies p WHERE p.school_id = co.school_id));
  RETURN jsonb_build_object('courseId', co.id, 'changes', v_changes, 'replacement', v_repl, 'state', v_state,
                            'courses', to_jsonb(v_courses), 'lastDay', i ->> 'lastDay', 'validTo', v_eff);
END $$;

-- ----------------------------------------------------------------------------
-- 8. 미리보기 (workhub_teaching_relation_preview) — 관계를 바꾸지 않는다. 10분짜리 미리보기 원장 1행만 남긴다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p8_rel_preview(p_ctx workhub_private.actor_context, i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb := workhub_private.p8_rel_eval(p_ctx, i); v_id text := gen_random_uuid()::text;
        v_exp timestamptz := date_trunc('milliseconds', clock_timestamp()) + interval '10 minutes'; v_fp text;
BEGIN
  v_fp := workhub_private.p2_sha(jsonb_build_object('previewId', v_id, 'schoolId', p_ctx.school_id, 'accountId', p_ctx.account_id,
            'membershipId', p_ctx.membership_id, 'intent', i, 'state', v -> 'state', 'expiresAt', workhub_private.p5_ts(v_exp)));
  INSERT INTO workhub.teaching_relation_previews (id, school_id, account_id, membership_id, course_id, intent, state, fingerprint, expires_at)
  VALUES (v_id, p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, v ->> 'courseId', i, v -> 'state', v_fp, v_exp);
  RETURN jsonb_build_object('courseId', v ->> 'courseId', 'previewId', v_id, 'fingerprint', v_fp, 'expiresAt', workhub_private.p5_ts(v_exp),
           'intent', i, 'changes', v -> 'changes', 'replacement', v -> 'replacement', 'recordsPreserved', true, 'historyNotTransferred', true);
END $$;

-- ----------------------------------------------------------------------------
-- 9. 확정 (workhub_teaching_relation_commit)
--    순서: 요청 번호 직렬화 → 원장(같은 번호 · 같은 명령이면 원래 접수증 재생 — 준비 상태 · 권한 · 미리보기 만료보다 먼저)
--          → 준비 → 모양 → 미리보기(소유자 · 지문 · 의도 · 미사용 · 만료) → 잠금(수업 → 학적 → 수강 → 담당, 각각 ID 순)
--          → 영향 재계산이 미리보기와 같은지 → 종료 사건 · 새 담당 · 수업 판 · 미리보기 사용 · 감사 · 원장을 한 번에.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p8_rel_receipt(q workhub.teaching_relation_commits, p_outcome text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('previewId', q.preview_id, 'previewFingerprint', q.preview_fingerprint, 'requestKey', q.request_key,
           'intentKind', q.intent_kind, 'changes', q.changes, 'replacementAssignmentId', q.replacement_assignment_id,
           'outcome', p_outcome, 'appliedAt', workhub_private.p5_ts(q.applied_at))
$$;

CREATE FUNCTION workhub_private.p8_rel_commit(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.teaching_relation_commits; pv workhub.teaching_relation_previews; v jsonb; x jsonb; i jsonb; v_new text; v_n integer;
        v_changes jsonb; v_course_ver integer;
BEGIN
  IF NOT workhub_private.p5_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('p8rel' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.account_id || chr(31) || p_key, 0));
  SELECT * INTO q FROM workhub.teaching_relation_commits WHERE school_id = p_ctx.school_id AND account_id = p_ctx.account_id AND request_key = p_key;
  IF q.request_key IS NOT NULL THEN
    IF q.command_hash <> p_hash OR q.membership_id <> p_ctx.membership_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN workhub_private.p8_rel_receipt(q, 'replayed');
  END IF;
  IF NOT workhub_private.p8_rel_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
  -- 모양: 앱 validateRelationCommit 과 같은 규칙
  IF NOT workhub_private.p2_exact(c, ARRAY['previewId','previewFingerprint','intent','expectedChanges'])
     OR NOT workhub_private.p5_id(c -> 'previewId') OR NOT workhub_private.p5_hash(c -> 'previewFingerprint')
     OR NOT workhub_private.p8_rel_intent_ok(c -> 'intent') OR jsonb_typeof(c -> 'expectedChanges') IS DISTINCT FROM 'array'
     OR jsonb_array_length(c -> 'expectedChanges') NOT BETWEEN 1 AND 1001
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'expectedChanges') y
                 WHERE NOT workhub_private.p2_exact(y, ARRAY['kind','id','version']) OR NOT workhub_private.p5_id(y -> 'id')
                    OR NOT workhub_private.p2_int(y -> 'version') OR jsonb_typeof(y -> 'kind') IS DISTINCT FROM 'string'
                    OR y ->> 'kind' NOT IN ('assignment','course_membership','enrollment'))
     OR (SELECT count(DISTINCT (y ->> 'kind', y ->> 'id')) FROM jsonb_array_elements(c -> 'expectedChanges') y) <> jsonb_array_length(c -> 'expectedChanges') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  i := c -> 'intent';
  -- 미리보기: 같은 학교 · 계정 · 소속이 만든 것, 지문 · 의도 그대로, 아직 쓰지 않음, 만료 전
  SELECT * INTO pv FROM workhub.teaching_relation_previews WHERE id = c ->> 'previewId' FOR UPDATE;
  IF pv.id IS NULL OR pv.school_id <> p_ctx.school_id OR pv.account_id <> p_ctx.account_id OR pv.membership_id <> p_ctx.membership_id
     OR pv.fingerprint <> c ->> 'previewFingerprint' OR workhub_private.p2_canonical(pv.intent) <> workhub_private.p2_canonical(i)
     OR pv.consumed_at IS NOT NULL OR pv.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 앱이 본 변경 전 판 목록 = 미리보기의 영향 집합
  IF (SELECT jsonb_agg(jsonb_build_object('kind', y ->> 'kind', 'id', y ->> 'id', 'version', (y ->> 'version')::integer) ORDER BY y ->> 'kind', y ->> 'id')
        FROM jsonb_array_elements(c -> 'expectedChanges') y)
     IS DISTINCT FROM
     (SELECT jsonb_agg(jsonb_build_object('kind', y ->> 'kind', 'id', y ->> 'id', 'version', (y ->> 'version')::integer) ORDER BY y ->> 'kind', y ->> 'id')
        FROM jsonb_array_elements(pv.state -> 'changes') y) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 잠금: 수업(새 명부 · 다른 확정과 줄 세우기) → 학적(다른 수업의 새 수강 막기) → 수강 → 담당 → 새 교사 소속. 모두 ID 순.
  PERFORM 1 FROM workhub.courses WHERE school_id = p_ctx.school_id
     AND id IN (SELECT pv.course_id UNION SELECT jsonb_object_keys(pv.state -> 'courses')) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM workhub.student_enrollments WHERE id IN (SELECT y ->> 'id' FROM jsonb_array_elements(pv.state -> 'changes') y WHERE y ->> 'kind' = 'enrollment')
    ORDER BY id FOR UPDATE;
  PERFORM 1 FROM workhub.course_memberships WHERE id IN (SELECT y ->> 'id' FROM jsonb_array_elements(pv.state -> 'changes') y WHERE y ->> 'kind' = 'course_membership')
    ORDER BY id FOR UPDATE;
  PERFORM 1 FROM workhub.course_assignments WHERE id IN (SELECT y ->> 'id' FROM jsonb_array_elements(pv.state -> 'changes') y WHERE y ->> 'kind' = 'assignment')
    ORDER BY id FOR UPDATE;
  PERFORM 1 FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = pv.state #>> '{replacement,memberId}' FOR SHARE;
  -- 현재 권한 · 날짜 · 판 · 영향 집합 · 기록을 다시 계산해 미리보기 상태와 같아야 한다
  v := workhub_private.p8_rel_eval(p_ctx, i);
  IF v -> 'state' IS DISTINCT FROM pv.state THEN RAISE EXCEPTION 'CONFLICT'; END IF;

  FOR x IN SELECT y FROM jsonb_array_elements(v -> 'changes') y LOOP
    INSERT INTO workhub.teaching_relation_ends (school_id, kind, relation_id, version, last_day, reason, request_key, recorded_by_membership_id)
    VALUES (p_ctx.school_id, x ->> 'kind', x ->> 'id', (x ->> 'version')::integer + 1, (x ->> 'afterThrough')::date, i ->> 'reason', p_key,
            p_ctx.membership_id);
  END LOOP;
  IF i ->> 'kind' = 'assignment_replace' THEN
    INSERT INTO workhub.course_assignments (school_id, course_id, membership_id, account_id, valid_from, valid_to, created_by_membership_id)
    VALUES (p_ctx.school_id, pv.course_id, pv.state #>> '{replacement,memberId}', pv.state #>> '{replacement,accountId}',
            (i ->> 'lastDay')::date + 1, (v ->> 'validTo')::date, p_ctx.membership_id)
    RETURNING id INTO v_new;
  END IF;
  UPDATE workhub.courses SET version = version + 1, updated_at = clock_timestamp()
   WHERE school_id = p_ctx.school_id AND id IN (SELECT jsonb_array_elements_text(v -> 'courses'));
  UPDATE workhub.teaching_relation_previews SET consumed_at = clock_timestamp(), consumed_request_key = p_key WHERE id = pv.id;
  SELECT version INTO v_course_ver FROM workhub.courses WHERE id = pv.course_id;
  v_n := jsonb_array_length(v -> 'changes');
  -- 감사: 건수만(학생 이름 · 사유 본문 없음)
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.relation_change', 'course', pv.course_id, v_course_ver, 'school', p_key,
    jsonb_build_object('intentKind', i ->> 'kind', 'changes', v_n, 'courses', jsonb_array_length(v -> 'courses'), 'replacement', v_new IS NOT NULL));
  SELECT jsonb_agg(jsonb_build_object('kind', y ->> 'kind', 'id', y ->> 'id', 'version', (y ->> 'version')::integer + 1) ORDER BY y ->> 'kind', y ->> 'id')
    INTO v_changes FROM jsonb_array_elements(v -> 'changes') y;
  INSERT INTO workhub.teaching_relation_commits (school_id, account_id, request_key, membership_id, command_hash, preview_id, preview_fingerprint,
                                                 intent_kind, changes, replacement_assignment_id)
  VALUES (p_ctx.school_id, p_ctx.account_id, p_key, p_ctx.membership_id, p_hash, pv.id, pv.fingerprint, i ->> 'kind', v_changes, v_new)
  RETURNING * INTO q;
  RETURN workhub_private.p8_rel_receipt(q, 'applied');
END $$;

-- 실행 틀: 업무 거절 → 봉투 + code(확정은 + requestKey · commandHash). 동시 생성 경합 · 교착 · 직렬화 실패 → CONFLICT(전부 미적용).
--   권한 없는 소속 · 로그인 문제(member_actor 의 INACTIVE_MEMBERSHIP 등)는 P5 와 같이 예외 그대로(앱: 취소/결과 미상).
CREATE FUNCTION workhub_private.p8_rel_run(p_ctx workhub_private.actor_context, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; v_key text; v_hash text;
BEGIN
  IF p_op = 'commit' THEN v_key := a ->> 'key'; v_hash := workhub_private.p2_sha(a -> 'command'); END IF;
  BEGIN
    IF p_op = 'snapshot' THEN
      IF NOT workhub_private.p8_rel_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
      v := workhub_private.p8_rel_snapshot(p_ctx, a ->> 'course');
    ELSIF p_op = 'preview' THEN
      IF NOT workhub_private.p8_rel_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
      v := workhub_private.p8_rel_preview(p_ctx, a -> 'intent');
    ELSIF p_op = 'commit' THEN
      v := workhub_private.p8_rel_commit(p_ctx, a -> 'command', v_key, v_hash);
      SET CONSTRAINTS ALL IMMEDIATE;
    ELSE RAISE EXCEPTION 'P8_UNKNOWN_OPERATION';
    END IF;
    RETURN workhub_private.p8_rel_env(p_ctx) || v;
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p5_business(SQLERRM) THEN RETURN workhub_private.p8_rel_fail(p_ctx, SQLERRM, v_key, v_hash); END IF;
      RAISE;
    WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure THEN
      RETURN workhub_private.p8_rel_fail(p_ctx, 'CONFLICT', v_key, v_hash);
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 10. 공개 함수 3개 (authenticated). p_member_id 는 범위 선택일 뿐이고 실제 주체는 JWT 다(P5 와 같은 경로).
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_teaching_relations(p_member_id text, p_course_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p8_rel_run(ctx, 'snapshot', jsonb_build_object('course', p_course_id));
END $$;

CREATE FUNCTION public.workhub_teaching_relation_preview(p_member_id text, p_intent jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p8_rel_run(ctx, 'preview', jsonb_build_object('intent', p_intent));
END $$;

CREATE FUNCTION public.workhub_teaching_relation_commit(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p8_rel_run(ctx, 'commit', jsonb_build_object('command', p_command, 'key', p_request_key));
END $$;

-- ----------------------------------------------------------------------------
-- 11. 권한 — 공개 함수 3개만 authenticated 에. 새 내부 함수는 API 역할이 실행할 수 없다.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND (p.proname LIKE 'p8\_rel%' OR p.proname = 'p8_eff_to'))
               OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_teaching\_relation%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_teaching_relations(text, text), public.workhub_teaching_relation_preview(text, jsonb),
    public.workhub_teaching_relation_commit(text, jsonb, text) TO authenticated;
END $$;

INSERT INTO workhub_private.p8_installs (batch, release) VALUES ('P8-04', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 12. 검증 — 모든 행의 status 가 ok 여야 한다. P8-04-4 는 "아직 켜지 않음"이 정상이다(P8-06 전).
-- ----------------------------------------------------------------------------
SELECT 'P8-04-1' AS no, '새 표 3개 RLS 켜짐 · API 역할 직접 접근 0' AS item,
       CASE WHEN (SELECT count(*) FROM pg_class c WHERE c.oid IN ('workhub.teaching_relation_ends'::regclass, 'workhub.teaching_relation_previews'::regclass,
                                                                  'workhub.teaching_relation_commits'::regclass) AND c.relrowsecurity) = 3
             AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r,
                                    unnest(ARRAY['workhub.teaching_relation_ends','workhub.teaching_relation_previews','workhub.teaching_relation_commits']) t
                              WHERE has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT')
                                 OR has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE')) THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P8-04-2', '공개 함수 3개 authenticated 만 · 내부 함수 API 역할 실행 불가',
       CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_teaching\_relation%') = 3
             AND has_function_privilege('authenticated', 'public.workhub_teaching_relation_commit(text,jsonb,text)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.workhub_teaching_relation_commit(text,jsonb,text)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.workhub_teaching_relations(text,text)', 'EXECUTE')
             AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace
                               AND (p.proname LIKE 'p8\_rel%' OR p.proname = 'p8_eff_to')
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-04-3', '종료 뒤 기록 차단 트리거 5개 · 종료 사건 규칙 트리거',
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN ('p8_rel_record_guard','p8_rel_adopt_guard','p8_rel_import_guard','p8_rel_membership_guard')) = 5
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'teaching_relation_ends_guard') THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'p8\_rel%')
UNION ALL
SELECT 'P8-04-4', '아직 어느 학교도 켜지 않음 · 종료 사건 0 · 미리보기 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'teaching_relations') = 0
             AND (SELECT count(*) FROM workhub.teaching_relation_ends) = 0 AND (SELECT count(*) FROM workhub.teaching_relation_previews) = 0
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-04-5', '적용 기록 P8-04', CASE WHEN workhub_private.p8_installed('P8-04') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
