-- ============================================================================
-- P5-02  수업 · 학생 · 관찰 · 상담 · 평가 · 활동 CSV — 공개 함수 7개 · 명령 10종 · 문서함 학생 근거 확인 (비활성 설치)
--
-- ▣ 하는 일
--   authenticated(앱) 7개: workhub_teaching_catalog · _course · _student · _counseling · _activity · _rubric_revision · _mutate
--   명령(_mutate) 10종: course_create · roster_import · observation_save · counseling_save · record_withdraw · rubric_save
--                       assessment_save · activity_import · activity_review · activity_correct
--   문서함(P4)이 부르는 내부 확인 함수 workhub_private.p5_document_student_check — P4 가 있으면 학생 기록 초안 근거를 실제 판으로 대조한다.
-- ▣ 하지 않는 일
--   - 어느 학교도 켜지 않는다(P5-04). 이 파일만으로는 모든 함수가 UNAVAILABLE 이다.
--   - R0 · R1 · R1S · P1~P4 의 표 · 함수 · 정책을 바꾸지 않는다. 시간표를 읽지 않는다.
--   - 학생을 지우거나 기록을 물리 삭제하지 않는다(철회는 새 판).
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션. 마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: P5-01 (판 2026-10-16.1)
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p5_installs') IS NULL THEN
    RAISE EXCEPTION 'P5 중단: P5-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p5_installs WHERE batch = 'P5-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P5 중단: P5-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p5_installs WHERE batch = 'P5-02') THEN
    RAISE EXCEPTION 'P5 중단: P5-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'workhub\_teaching\_%' OR proname = 'p5_document_student_check') THEN
    RAISE EXCEPTION 'P5 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 조회 공통 — 수업 찾기 · DTO
-- ----------------------------------------------------------------------------
-- 볼 수 있는 수업(관리자 또는 그 수업을 맡은 적이 있는 본인). 없거나 볼 수 없으면 NOT_FOUND(존재를 알리지 않는다).
CREATE FUNCTION workhub_private.p5_course_get(p_ctx workhub_private.actor_context, p_course text, p_lock text DEFAULT 'none')
RETURNS workhub.courses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.courses;
BEGIN
  IF p_course IS NULL OR NOT workhub_private.p5_key(p_course) OR NOT workhub_private.p5_course_visible(p_ctx, p_course) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF p_lock = 'update' THEN
    SELECT * INTO c FROM workhub.courses WHERE school_id = p_ctx.school_id AND id = p_course FOR UPDATE;
  ELSIF p_lock = 'share' THEN
    SELECT * INTO c FROM workhub.courses WHERE school_id = p_ctx.school_id AND id = p_course FOR SHARE;
  ELSE
    SELECT * INTO c FROM workhub.courses WHERE school_id = p_ctx.school_id AND id = p_course;
  END IF;
  IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN c;
END $$;

-- 앱 Course. canRecord = 오늘 유효한 본인 담당 · canCounsel = 정책 + 현재 담당 · canManageRoster = 관리자 또는 현재 담당
CREATE FUNCTION workhub_private.p5_course_dto(p_ctx workhub_private.actor_context, c workhub.courses) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'schoolId', c.school_id, 'version', c.version, 'label', c.label, 'termId', c.term_id,
           'subjectId', c.subject_id, 'assignmentId', to_jsonb(x.a), 'validFrom', workhub_private.p5_day(c.valid_from),
           'validThrough', workhub_private.p5_last(c.valid_to), 'canRecord', x.a IS NOT NULL,
           'canCounsel', workhub_private.p5_can_counsel(p_ctx, c.id),
           'canManageRoster', workhub_private.p5_manager(p_ctx) OR x.a IS NOT NULL)
    FROM (SELECT workhub_private.p5_current_assignment(p_ctx, c.id) AS a) x
$$;

CREATE FUNCTION workhub_private.p5_student_dto(s workhub.students, e workhub.student_enrollments, m workhub.course_memberships) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', s.id, 'schoolId', s.school_id, 'version', s.version, 'schoolStudentKey', s.school_student_key,
           'name', s.name, 'grade', e.grade, 'classLabel', e.class_label, 'seatNumber', e.seat_number, 'enrollmentId', e.id,
           'courseMembershipId', m.id, 'validFrom', workhub_private.p5_day(m.valid_from), 'validThrough', workhub_private.p5_last(m.valid_to))
$$;

-- 작성자 Auth UID(앱 ownerUserId). 이 배치의 개인 자료는 언제나 호출자 본인 것만 돌려주므로 호출자 UID 와 같다.
CREATE FUNCTION workhub_private.p5_uid(p_account text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth_user_id::text FROM workhub.accounts WHERE id = p_account
$$;

CREATE FUNCTION workhub_private.p5_rubric_dto(r workhub.rubrics, v workhub.rubric_revisions) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', r.id, 'schoolId', r.school_id, 'version', v.version, 'courseId', r.course_id,
           'ownerUserId', workhub_private.p5_uid(r.owner_account_id), 'label', v.label, 'revisionId', v.id, 'criteria', v.criteria,
           'archived', r.archived)
$$;

CREATE FUNCTION workhub_private.p5_import_summary(i workhub.activity_imports) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', i.id, 'schoolId', i.school_id, 'version', i.version, 'state', i.state,
           'supersededByImportId', to_jsonb(i.superseded_by_import_id), 'courseId', i.course_id,
           'ownerUserId', workhub_private.p5_uid(i.owner_account_id), 'label', i.label, 'occurredOn', workhub_private.p5_day(i.occurred_on),
           'fileHash', i.file_hash,
           'adopted', (SELECT count(*) FROM workhub.activity_items t WHERE t.import_id = i.id AND t.disposition = 'adopt'),
           'held', (SELECT count(*) FROM workhub.activity_items t WHERE t.import_id = i.id AND t.disposition = 'hold'),
           'excluded', (SELECT count(*) FROM workhub.activity_items t WHERE t.import_id = i.id AND t.disposition = 'exclude'))
$$;

CREATE FUNCTION workhub_private.p5_record_dto(r workhub.teaching_records, v workhub.teaching_record_revisions) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', r.id, 'schoolId', r.school_id, 'version', r.version, 'ownerUserId', workhub_private.p5_uid(r.owner_account_id),
           'courseId', r.course_id, 'studentId', r.student_id, 'courseMembershipId', r.course_membership_id, 'assignmentId', r.assignment_id,
           'revisionId', v.id, 'occurredOn', workhub_private.p5_day(v.occurred_on), 'text', v.body, 'state', r.state,
           'contentHash', v.content_hash, 'epoch', r.epoch, 'kind', r.kind)
      || CASE WHEN r.kind = 'observation' THEN jsonb_build_object('sourceReviewRequired', r.source_review_required)
              ELSE jsonb_build_object('followUpOn', COALESCE(workhub_private.p5_day(v.follow_up_on), '')) END
$$;

-- 평가는 활동 원천에 연결되지 않는다(명령에 출처가 없다) → sourceReviewRequired 는 언제나 false(D-P5-6)
CREATE FUNCTION workhub_private.p5_assessment_dto(a workhub.assessments, v workhub.assessment_revisions) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', a.id, 'schoolId', a.school_id, 'version', a.version, 'ownerUserId', workhub_private.p5_uid(a.owner_account_id),
           'courseId', a.course_id, 'studentId', a.student_id, 'courseMembershipId', a.course_membership_id, 'assignmentId', a.assignment_id,
           'revisionId', v.id, 'rubricId', a.rubric_id, 'rubricRevisionId', a.rubric_revision_id,
           'occurredOn', workhub_private.p5_day(v.occurred_on), 'comment', v.comment, 'scores', v.scores, 'confirmed', v.confirmed,
           'state', a.state, 'total', to_jsonb(v.total), 'contentHash', v.content_hash, 'epoch', a.epoch, 'sourceReviewRequired', false)
$$;

-- 판 내용 지문(앱 contentHash = 생기부 근거 sourceHash). 상태까지 넣어 철회판과 원래 판을 구별한다.
CREATE FUNCTION workhub_private.p5_record_hash(p_kind text, p_on date, p_body text, p_follow date, p_state text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p5_content_hash(jsonb_build_object('kind', p_kind, 'occurredOn', workhub_private.p5_day(p_on), 'text', p_body,
           'followUpOn', COALESCE(workhub_private.p5_day(p_follow), ''), 'state', p_state))
$$;
CREATE FUNCTION workhub_private.p5_assessment_hash(p_rev text, p_on date, p_comment text, p_scores jsonb, p_confirmed boolean, p_total numeric,
  p_state text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p5_content_hash(jsonb_build_object('rubricRevisionId', p_rev, 'occurredOn', workhub_private.p5_day(p_on),
           'comment', p_comment, 'scores', p_scores, 'confirmed', p_confirmed, 'total', to_jsonb(p_total), 'state', p_state))
$$;

-- ----------------------------------------------------------------------------
-- 2. 조회 함수
-- ----------------------------------------------------------------------------
-- 카탈로그: 볼 수 있는 수업 · 학교 학기 · 교과(살아 있는 것 + 보이는 수업이 쓰는 것) · 담당 지정 가능한 교사(관리자에게만)
CREATE FUNCTION workhub_private.p5_catalog(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_m boolean := workhub_private.p5_manager(p_ctx); v_courses jsonb; v_terms jsonb; v_subjects jsonb; v_teachers jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(workhub_private.p5_course_dto(p_ctx, c) ORDER BY c.valid_from DESC, c.label, c.id), '[]'::jsonb) INTO v_courses
    FROM workhub.courses c
   WHERE c.school_id = p_ctx.school_id
     AND (v_m OR EXISTS (SELECT 1 FROM workhub.course_assignments a WHERE a.school_id = c.school_id AND a.course_id = c.id
                           AND a.membership_id = p_ctx.membership_id AND a.account_id = p_ctx.account_id));
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

-- 수업 상세: 명부(학교 명부 권한) · 내 평가 기준 · 내 활동 원문판
CREATE FUNCTION workhub_private.p5_course_snapshot(p_ctx workhub_private.actor_context, p_course text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.courses; v_students jsonb; v_rubrics jsonb; v_imports jsonb;
BEGIN
  c := workhub_private.p5_course_get(p_ctx, p_course);
  SELECT COALESCE(jsonb_agg(workhub_private.p5_student_dto(s, e, m) ORDER BY e.grade, e.class_label, e.seat_number, s.id), '[]'::jsonb)
    INTO v_students
    FROM workhub.course_memberships m
    JOIN workhub.students s ON s.school_id = m.school_id AND s.id = m.student_id
    JOIN workhub.student_enrollments e ON e.school_id = m.school_id AND e.student_id = m.student_id AND e.id = m.enrollment_id
   WHERE m.school_id = c.school_id AND m.course_id = c.id;
  SELECT COALESCE(jsonb_agg(workhub_private.p5_rubric_dto(r, v) ORDER BY r.created_at, r.id), '[]'::jsonb) INTO v_rubrics
    FROM workhub.rubrics r JOIN workhub.rubric_revisions v ON v.rubric_id = r.id AND v.id = r.current_revision_id
   WHERE r.school_id = c.school_id AND r.course_id = c.id AND r.owner_account_id = p_ctx.account_id;
  SELECT COALESCE(jsonb_agg(workhub_private.p5_import_summary(i) ORDER BY i.created_at DESC, i.id), '[]'::jsonb) INTO v_imports
    FROM workhub.activity_imports i
   WHERE i.school_id = c.school_id AND i.course_id = c.id AND i.owner_account_id = p_ctx.account_id;
  IF jsonb_array_length(v_students) > 1000 OR jsonb_array_length(v_rubrics) > 300 OR jsonb_array_length(v_imports) > 100 THEN
    RAISE EXCEPTION 'QUERY_FAILED';
  END IF;
  RETURN jsonb_build_object('course', workhub_private.p5_course_dto(p_ctx, c), 'students', v_students, 'rubrics', v_rubrics, 'imports', v_imports);
END $$;

-- 이 수업의 수강 학생인가(아니면 NOT_FOUND)
CREATE FUNCTION workhub_private.p5_student_in_course(p_ctx workhub_private.actor_context, p_course text, p_student text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_student IS NULL OR NOT workhub_private.p5_key(p_student)
     OR NOT EXISTS (SELECT 1 FROM workhub.course_memberships m WHERE m.school_id = p_ctx.school_id AND m.course_id = p_course AND m.student_id = p_student) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
END $$;

-- 커서 범위 지문: 학교 · 계정 · 소속 · 수업 · 학생 · 목록 종류
CREATE FUNCTION workhub_private.p5_scope(p_ctx workhub_private.actor_context, p_list text, p_course text, p_student text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_sha(jsonb_build_array(p_list, p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, p_course, p_student))
$$;

-- 한 쪽 목록(최신순, 같은 시각은 ID 역순). p_pos = NULL(처음) · {"t","i"}(그 뒤부터). 101건을 읽어 다음 위치를 정한다.
CREATE FUNCTION workhub_private.p5_page_records(p_ctx workhub_private.actor_context, p_kind text, p_course text, p_student text, p_pos jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows jsonb; v_last jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x.dto ORDER BY x.created_at DESC, x.id COLLATE "C" DESC), '[]'::jsonb),
         (array_agg(jsonb_build_object('t', to_jsonb(x.created_at), 'i', x.id) ORDER BY x.created_at DESC, x.id COLLATE "C" DESC))[100]
    INTO v_rows, v_last
    FROM (SELECT r.created_at, r.id, workhub_private.p5_record_dto(r, v) AS dto
            FROM workhub.teaching_records r JOIN workhub.teaching_record_revisions v ON v.record_id = r.id AND v.id = r.current_revision_id
           WHERE r.school_id = p_ctx.school_id AND r.owner_account_id = p_ctx.account_id AND r.course_id = p_course
             AND r.student_id = p_student AND r.kind = p_kind
             AND (p_pos IS NULL OR (r.created_at, r.id COLLATE "C") < ((p_pos ->> 't')::timestamptz, (p_pos ->> 'i') COLLATE "C"))
           ORDER BY r.created_at DESC, r.id COLLATE "C" DESC LIMIT 101) x;
  IF jsonb_array_length(v_rows) > 100 THEN
    RETURN jsonb_build_object('rows', v_rows - 100, 'next', v_last);
  END IF;
  RETURN jsonb_build_object('rows', v_rows, 'next', '"done"'::jsonb);
END $$;

CREATE FUNCTION workhub_private.p5_page_assessments(p_ctx workhub_private.actor_context, p_course text, p_student text, p_pos jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows jsonb; v_last jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x.dto ORDER BY x.created_at DESC, x.id COLLATE "C" DESC), '[]'::jsonb),
         (array_agg(jsonb_build_object('t', to_jsonb(x.created_at), 'i', x.id) ORDER BY x.created_at DESC, x.id COLLATE "C" DESC))[100]
    INTO v_rows, v_last
    FROM (SELECT a.created_at, a.id, workhub_private.p5_assessment_dto(a, v) AS dto
            FROM workhub.assessments a JOIN workhub.assessment_revisions v ON v.assessment_id = a.id AND v.id = a.current_revision_id
           WHERE a.school_id = p_ctx.school_id AND a.owner_account_id = p_ctx.account_id AND a.course_id = p_course AND a.student_id = p_student
             AND (p_pos IS NULL OR (a.created_at, a.id COLLATE "C") < ((p_pos ->> 't')::timestamptz, (p_pos ->> 'i') COLLATE "C"))
           ORDER BY a.created_at DESC, a.id COLLATE "C" DESC LIMIT 101) x;
  IF jsonb_array_length(v_rows) > 100 THEN
    RETURN jsonb_build_object('rows', v_rows - 100, 'next', v_last);
  END IF;
  RETURN jsonb_build_object('rows', v_rows, 'next', '"done"'::jsonb);
END $$;

-- 학생 기록(관찰 · 평가): 본인 기록만. 커서 하나에 두 목록의 위치를 함께 담는다.
CREATE FUNCTION workhub_private.p5_student_snapshot(p_ctx workhub_private.actor_context, p_course text, p_student text, p_cursor text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.courses; v_scope text; cur jsonb; o jsonb; a jsonb;
BEGIN
  c := workhub_private.p5_course_get(p_ctx, p_course);
  PERFORM workhub_private.p5_student_in_course(p_ctx, c.id, p_student);
  v_scope := workhub_private.p5_scope(p_ctx, 'student', c.id, p_student);
  cur := workhub_private.p5_cursor_in(p_cursor, v_scope);
  IF cur IS NOT NULL AND cur -> 'a' = '"done"'::jsonb THEN o := '{"rows":[],"next":"done"}'::jsonb;
  ELSE o := workhub_private.p5_page_records(p_ctx, 'observation', c.id, p_student, cur -> 'a');
  END IF;
  IF cur IS NOT NULL AND cur -> 'b' = '"done"'::jsonb THEN a := '{"rows":[],"next":"done"}'::jsonb;
  ELSE a := workhub_private.p5_page_assessments(p_ctx, c.id, p_student, cur -> 'b');
  END IF;
  RETURN jsonb_build_object('courseId', c.id, 'studentId', p_student, 'observations', o -> 'rows', 'assessments', a -> 'rows',
    'nextCursor', CASE WHEN o -> 'next' = '"done"'::jsonb AND a -> 'next' = '"done"'::jsonb THEN 'null'::jsonb
                       ELSE to_jsonb(workhub_private.p5_cursor_out(jsonb_build_object('f', v_scope, 'a', o -> 'next', 'b', a -> 'next'))) END);
END $$;

-- 상담: 정책이 course_teachers 이고 그 수업을 맡은 적이 있는 본인만, 본인 상담만. 관리자 역할로 열리지 않는다.
CREATE FUNCTION workhub_private.p5_counseling_snapshot(p_ctx workhub_private.actor_context, p_course text, p_student text, p_cursor text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.courses; v_scope text; cur jsonb; o jsonb;
BEGIN
  c := workhub_private.p5_course_get(p_ctx, p_course);
  IF NOT workhub_private.p5_can_read_counsel(p_ctx, c.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM workhub_private.p5_student_in_course(p_ctx, c.id, p_student);
  v_scope := workhub_private.p5_scope(p_ctx, 'counseling', c.id, p_student);
  cur := workhub_private.p5_cursor_in(p_cursor, v_scope);
  IF cur IS NOT NULL AND (cur -> 'a' IS NULL OR cur -> 'a' = '"done"'::jsonb OR cur -> 'b' IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  o := workhub_private.p5_page_records(p_ctx, 'counseling', c.id, p_student, cur -> 'a');
  RETURN jsonb_build_object('courseId', c.id, 'studentId', p_student, 'records', o -> 'rows',
    'nextCursor', CASE WHEN o -> 'next' = '"done"'::jsonb THEN 'null'::jsonb
                       ELSE to_jsonb(workhub_private.p5_cursor_out(jsonb_build_object('f', v_scope, 'a', o -> 'next'))) END);
END $$;

-- 활동 원문판 상세: 본인 원문판만(정정 전 판도 읽기 전용으로)
CREATE FUNCTION workhub_private.p5_activity_snapshot(p_ctx workhub_private.actor_context, p_course text, p_import text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.courses; i workhub.activity_imports; v_items jsonb;
BEGIN
  c := workhub_private.p5_course_get(p_ctx, p_course);
  SELECT * INTO i FROM workhub.activity_imports
   WHERE school_id = c.school_id AND course_id = c.id AND owner_account_id = p_ctx.account_id AND id = p_import;
  IF i.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'schoolId', t.school_id, 'version', t.version,
             'ownerUserId', workhub_private.p5_uid(t.owner_account_id), 'courseId', t.course_id, 'importId', t.import_id,
             'rowNumber', t.row_number, 'alias', t.alias, 'values', t.row_values, 'disposition', t.disposition,
             'studentId', to_jsonb(t.student_id), 'courseMembershipId', to_jsonb(t.course_membership_id), 'reason', t.reason,
             'revisionId', t.current_revision_id, 'mappingVersion', t.mapping_version) ORDER BY t.row_number), '[]'::jsonb)
    INTO v_items
    FROM workhub.activity_items t WHERE t.import_id = i.id;
  RETURN jsonb_build_object('courseId', c.id, 'importId', i.id, 'version', i.version, 'state', i.state,
    'supersedesImportId', to_jsonb(i.supersedes_import_id), 'supersededByImportId', to_jsonb(i.superseded_by_import_id),
    'label', i.label, 'occurredOn', workhub_private.p5_day(i.occurred_on), 'questionVersion', i.question_version,
    'questionSnapshot', i.question_snapshot, 'kind', i.kind, 'fileHash', i.file_hash, 'headers', i.headers, 'items', v_items);
END $$;

-- 과거 평가 기준판: 본인 기준의 정확한 판(사용 종료 판 포함)
CREATE FUNCTION workhub_private.p5_rubric_revision(p_ctx workhub_private.actor_context, p_course text, p_rubric text, p_revision text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.courses; r workhub.rubrics; v workhub.rubric_revisions;
BEGIN
  c := workhub_private.p5_course_get(p_ctx, p_course);
  SELECT * INTO r FROM workhub.rubrics WHERE school_id = c.school_id AND course_id = c.id AND owner_account_id = p_ctx.account_id AND id = p_rubric;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO v FROM workhub.rubric_revisions WHERE rubric_id = r.id AND id = p_revision;
  IF v.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('rubric', workhub_private.p5_rubric_dto(r, v));
END $$;

-- ----------------------------------------------------------------------------
-- 3. 명령 모양 검사 — 앱 teaching/commands.ts · assessment.ts · correction.ts 와 같은 규칙(키 정확히 · 값 범위)
--    학교·권한·현재 판 대조는 각 명령 함수가 한다. CSV 원문 대조는 p5_activity_check.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_criteria_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) BETWEEN 1 AND 30
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) c
                      WHERE NOT workhub_private.p2_exact(c, ARRAY['key','label','maximum'])
                         OR jsonb_typeof(c -> 'key') IS DISTINCT FROM 'string' OR (c ->> 'key') !~ '^criterion-[1-9][0-9]*$'
                         OR NOT workhub_private.p5_text(c -> 'label', 120)
                         OR NOT workhub_private.p5_cents(c -> 'maximum', 0, 10000, true))
     AND (SELECT count(DISTINCT c ->> 'key') FROM jsonb_array_elements(p) c) = jsonb_array_length(p)
$$;

-- 점수 상태: scored 만 0 이상 소수 둘째 자리 점수, 결시·미제출·미확인은 null(0점으로 바꾸지 않는다)
CREATE FUNCTION workhub_private.p5_scores_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) BETWEEN 1 AND 30
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) s
                      WHERE NOT workhub_private.p2_exact(s, ARRAY['criterionKey','state','points'])
                         OR jsonb_typeof(s -> 'criterionKey') IS DISTINCT FROM 'string' OR (s ->> 'criterionKey') !~ '^criterion-[1-9][0-9]*$'
                         OR jsonb_typeof(s -> 'state') IS DISTINCT FROM 'string' OR s ->> 'state' NOT IN ('scored','absent','missing','unconfirmed')
                         OR (s ->> 'state' = 'scored' AND NOT workhub_private.p5_cents(s -> 'points', 0, 10000))
                         OR (s ->> 'state' <> 'scored' AND s -> 'points' <> 'null'::jsonb))
     AND (SELECT count(DISTINCT s ->> 'criterionKey') FROM jsonb_array_elements(p) s) = jsonb_array_length(p)
$$;

-- 점수가 그 기준판의 항목과 정확히 맞는가(누락·중복·다른 판 항목·만점 초과 거부)
CREATE FUNCTION workhub_private.p5_scores_fit(p_scores jsonb, p_criteria jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_array_length(p_scores) = jsonb_array_length(p_criteria)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scores) s
                      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_criteria) c
                                         WHERE c ->> 'key' = s ->> 'criterionKey'
                                           AND (s -> 'points' = 'null'::jsonb OR (s ->> 'points')::numeric <= (c ->> 'maximum')::numeric)))
$$;

-- 합계: 모든 항목이 채점일 때만 정수 센트 합 / 100, 아니면 NULL(앱 assessmentTotal 과 같은 값)
CREATE FUNCTION workhub_private.p5_total(p_scores jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_array_length(p_scores) > 0
                   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_scores) s WHERE s ->> 'state' <> 'scored' OR s -> 'points' = 'null'::jsonb)
              THEN round((SELECT sum(round((s ->> 'points')::numeric * 100)) FROM jsonb_array_elements(p_scores) s) / 100, 2) END
$$;

-- 새 기록이면 recordId=null · expectedVersion=0 · 사유 빈칸 허용, 정정이면 양수 판 · 사유 필수
CREATE FUNCTION workhub_private.p5_head_ok(p jsonb, p_id text, p_reason jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p -> p_id = 'null'::jsonb
              THEN p -> 'expectedVersion' = '0'::jsonb AND (p_reason IS NULL OR workhub_private.p5_text(p_reason, 2000, true))
              ELSE workhub_private.p5_id(p -> p_id) AND workhub_private.p2_int(p -> 'expectedVersion', 1)
                   AND (p_reason IS NULL OR workhub_private.p5_text(p_reason, 2000)) END
$$;

CREATE FUNCTION workhub_private.p5_cmd_ok(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE k text; i jsonb; ok boolean;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  k := p ->> 'kind'; i := p -> 'input';
  IF k = 'course_create' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','input'])
      AND workhub_private.p2_exact(i, ARRAY['label','termId','subjectId','teacherMemberIds','validFrom','validThrough'])
      AND workhub_private.p5_text(i -> 'label', 120) AND workhub_private.p5_id(i -> 'termId') AND workhub_private.p5_id(i -> 'subjectId')
      AND workhub_private.p5_date(i -> 'validFrom') AND workhub_private.p5_date(i -> 'validThrough') AND i ->> 'validFrom' <= i ->> 'validThrough'
      AND jsonb_typeof(i -> 'teacherMemberIds') = 'array' AND jsonb_array_length(i -> 'teacherMemberIds') BETWEEN 1 AND 300
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i -> 'teacherMemberIds') t WHERE NOT workhub_private.p5_id(t))
      AND (SELECT count(DISTINCT t) FROM jsonb_array_elements(i -> 'teacherMemberIds') t) = jsonb_array_length(i -> 'teacherMemberIds');
  ELSIF k = 'roster_import' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','courseId','expectedVersion','rows','validFrom','validThrough'])
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p2_int(p -> 'expectedVersion', 1)
      AND workhub_private.p5_date(p -> 'validFrom') AND workhub_private.p5_date(p -> 'validThrough') AND p ->> 'validFrom' <= p ->> 'validThrough'
      AND jsonb_typeof(p -> 'rows') = 'array' AND jsonb_array_length(p -> 'rows') BETWEEN 1 AND 500
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'rows') r
                       WHERE NOT workhub_private.p2_exact(r, ARRAY['schoolStudentKey','name','grade','classLabel','seatNumber'])
                          OR NOT workhub_private.p5_text(r -> 'schoolStudentKey', 120) OR NOT workhub_private.p5_text(r -> 'name', 120)
                          OR NOT workhub_private.p2_int(r -> 'grade', 1, 20) OR NOT workhub_private.p5_text(r -> 'classLabel', 40)
                          OR NOT workhub_private.p2_int(r -> 'seatNumber', 1, 999))
      AND (SELECT count(DISTINCT r ->> 'schoolStudentKey') FROM jsonb_array_elements(p -> 'rows') r) = jsonb_array_length(p -> 'rows')
      AND (SELECT count(DISTINCT jsonb_build_array(r -> 'grade', r -> 'classLabel', r -> 'seatNumber')) FROM jsonb_array_elements(p -> 'rows') r)
          = jsonb_array_length(p -> 'rows');
  ELSIF k IN ('observation_save','counseling_save') THEN
    ok := (workhub_private.p2_exact(p, ARRAY['kind','courseId','studentId','courseMembershipId','assignmentId','recordId','expectedVersion','input'])
           OR (k = 'observation_save'
               AND workhub_private.p2_exact(p, ARRAY['kind','courseId','studentId','courseMembershipId','assignmentId','recordId','expectedVersion','input','sourceActivity'])
               AND p -> 'recordId' = 'null'::jsonb
               AND workhub_private.p2_exact(p -> 'sourceActivity', ARRAY['itemId','itemVersion'])
               AND workhub_private.p5_id(p #> '{sourceActivity,itemId}') AND workhub_private.p2_int(p #> '{sourceActivity,itemVersion}', 1)))
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_id(p -> 'studentId')
      AND workhub_private.p5_id(p -> 'courseMembershipId') AND workhub_private.p5_id(p -> 'assignmentId')
      AND workhub_private.p2_exact(i, ARRAY['occurredOn','text','followUpOn','reason'])
      AND workhub_private.p5_head_ok(p, 'recordId', i -> 'reason')
      AND workhub_private.p5_date(i -> 'occurredOn') AND workhub_private.p5_text(i -> 'text', 10000)
      AND jsonb_typeof(i -> 'followUpOn') = 'string'
      AND (i ->> 'followUpOn' = '' OR (k = 'counseling_save' AND workhub_private.p5_date(i -> 'followUpOn')));
  ELSIF k = 'record_withdraw' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','recordKind','courseId','studentId','recordId','expectedVersion','reason'])
      AND jsonb_typeof(p -> 'recordKind') = 'string' AND p ->> 'recordKind' IN ('observation','counseling','assessment')
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_id(p -> 'studentId') AND workhub_private.p5_id(p -> 'recordId')
      AND workhub_private.p2_int(p -> 'expectedVersion', 1) AND workhub_private.p5_text(p -> 'reason', 2000);
  ELSIF k = 'rubric_save' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','courseId','rubricId','expectedVersion','label','criteria'])
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_head_ok(p, 'rubricId', NULL)
      AND workhub_private.p5_text(p -> 'label', 120) AND workhub_private.p5_criteria_ok(p -> 'criteria');
  ELSIF k = 'assessment_save' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','courseId','studentId','courseMembershipId','assignmentId','recordId','expectedVersion',
                                            'rubricId','rubricRevisionId','occurredOn','comment','scores','confirmed','reason'])
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_id(p -> 'studentId')
      AND workhub_private.p5_id(p -> 'courseMembershipId') AND workhub_private.p5_id(p -> 'assignmentId')
      AND workhub_private.p5_head_ok(p, 'recordId', p -> 'reason')
      AND workhub_private.p5_id(p -> 'rubricId') AND workhub_private.p5_id(p -> 'rubricRevisionId')
      AND workhub_private.p5_date(p -> 'occurredOn') AND workhub_private.p5_text(p -> 'comment', 10000, true)
      AND workhub_private.p5_scores_ok(p -> 'scores') AND jsonb_typeof(p -> 'confirmed') = 'boolean'
      AND NOT ((p -> 'confirmed')::boolean AND jsonb_path_exists(p -> 'scores', '$[*] ? (@.state == "unconfirmed")'));
  ELSIF k = 'activity_review' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','courseId','importId','itemId','expectedVersion','disposition','studentId','courseMembershipId','reason'])
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_id(p -> 'importId') AND workhub_private.p5_id(p -> 'itemId')
      AND workhub_private.p2_int(p -> 'expectedVersion', 1) AND workhub_private.p5_text(p -> 'reason', 2000)
      AND jsonb_typeof(p -> 'disposition') = 'string' AND p ->> 'disposition' IN ('hold','adopt','exclude','withdraw')
      AND CASE WHEN p ->> 'disposition' = 'adopt' THEN workhub_private.p5_id(p -> 'studentId') AND workhub_private.p5_id(p -> 'courseMembershipId')
               ELSE p -> 'studentId' = 'null'::jsonb AND p -> 'courseMembershipId' = 'null'::jsonb END;
  ELSIF k = 'activity_import' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','courseId','assignmentId','expectedVersion','input'])
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_id(p -> 'assignmentId')
      AND workhub_private.p2_int(p -> 'expectedVersion', 1) AND jsonb_typeof(i) = 'object';
  ELSIF k = 'activity_correct' THEN
    ok := workhub_private.p2_exact(p, ARRAY['kind','courseId','assignmentId','previousImportId','expectedVersion','expectedFileHash','input','correspondence'])
      AND workhub_private.p5_id(p -> 'courseId') AND workhub_private.p5_id(p -> 'assignmentId') AND workhub_private.p5_id(p -> 'previousImportId')
      AND workhub_private.p2_int(p -> 'expectedVersion', 1) AND workhub_private.p5_hash(p -> 'expectedFileHash')
      AND jsonb_typeof(i) = 'object' AND jsonb_typeof(p -> 'correspondence') = 'object';
  ELSE
    ok := false;
  END IF;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN k;
END $$;

-- ----------------------------------------------------------------------------
-- 4. 쓰기 공통
-- ----------------------------------------------------------------------------
-- 쓰기는 오늘 유효한 본인 담당이 있어야 한다. 명령의 assignmentId 가 현재 담당과 다르면 CONFLICT(최신 자료를 다시 보게).
CREATE FUNCTION workhub_private.p5_writer(p_ctx workhub_private.actor_context, p_course text, p_assignment text)
RETURNS workhub.course_assignments
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a workhub.course_assignments;
BEGIN
  SELECT * INTO a FROM workhub.course_assignments WHERE id = workhub_private.p5_current_assignment(p_ctx, p_course);
  IF a.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_assignment IS NOT NULL AND p_assignment <> a.id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN a;
END $$;

-- 이 수업 · 이 학생의 그 수강(아니면 NOT_FOUND)
CREATE FUNCTION workhub_private.p5_membership(p_ctx workhub_private.actor_context, p_course text, p_student text, p_member text)
RETURNS workhub.course_memberships
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m workhub.course_memberships;
BEGIN
  SELECT * INTO m FROM workhub.course_memberships
   WHERE school_id = p_ctx.school_id AND course_id = p_course AND student_id = p_student AND id = p_member;
  IF m.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN m;
END $$;

-- 원천 활동을 쓴 관찰을 재검토 상태로: epoch 를 올리고 AI 근거에서 빠지게 한다(본문은 그대로)
CREATE FUNCTION workhub_private.p5_stale(p_items text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  UPDATE workhub.teaching_records SET source_review_required = true, epoch = epoch + 1, updated_at = clock_timestamp()
   WHERE source_item_id = ANY (p_items) AND state = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 명령 — 수업 · 명부
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_course_create(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i jsonb := c -> 'input'; t workhub.terms; v_from date; v_to date; v_id text; x text; v_account text;
BEGIN
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO t FROM workhub.terms WHERE school_id = p_ctx.school_id AND id = i ->> 'termId' FOR SHARE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_from := (i ->> 'validFrom')::date; v_to := (i ->> 'validThrough')::date + 1;
  IF v_from < t.starts_on OR v_to > t.ends_on THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub.year_subjects WHERE school_id = p_ctx.school_id AND academic_year_id = t.academic_year_id
                   AND id = i ->> 'subjectId' AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  INSERT INTO workhub.courses (school_id, academic_year_id, term_id, subject_id, label, valid_from, valid_to, created_by_membership_id)
  VALUES (p_ctx.school_id, t.academic_year_id, t.id, i ->> 'subjectId', i ->> 'label', v_from, v_to, p_ctx.membership_id)
  RETURNING id INTO v_id;
  FOR x IN SELECT jsonb_array_elements_text(i -> 'teacherMemberIds') LOOP
    IF NOT workhub_private.p2_member_reachable(p_ctx.school_id, x) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT account_id INTO v_account FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = x FOR SHARE;
    INSERT INTO workhub.course_assignments (school_id, course_id, membership_id, account_id, valid_from, valid_to, created_by_membership_id)
    VALUES (p_ctx.school_id, v_id, x, v_account, v_from, v_to, p_ctx.membership_id);
  END LOOP;
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.course_create', 'course', v_id, 1, 'school', p_key,
    jsonb_build_object('teachers', jsonb_array_length(i -> 'teacherMemberIds')));
  RETURN jsonb_build_object('entityId', v_id, 'version', 1);
END $$;

-- 명부: 학교 안 안정 학생키로만 대조. 같은 키에 다른 이름 · 같은 학년도에 다른 학적 · 다른 수강 기간은 CONFLICT(자동 덮어쓰기 없음).
-- 파일에 없는 학생은 지우지 않는다. 전부 반영되거나 전부 안 된다.
CREATE FUNCTION workhub_private.p5_roster_import(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
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
-- 6. 명령 — 관찰 · 상담 · 철회
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_record_save(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := CASE c ->> 'kind' WHEN 'observation_save' THEN 'observation' ELSE 'counseling' END;
        i jsonb := c -> 'input'; co workhub.courses; a workhub.course_assignments; m workhub.course_memberships;
        r workhub.teaching_records; t workhub.activity_items; imp workhub.activity_imports;
        v_on date; v_follow date; v_rev text := gen_random_uuid()::text; v_id text; v_ver integer;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId');
  a := workhub_private.p5_writer(p_ctx, co.id, c ->> 'assignmentId');
  IF v_kind = 'counseling' AND NOT workhub_private.p5_can_counsel(p_ctx, co.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  m := workhub_private.p5_membership(p_ctx, co.id, c ->> 'studentId', c ->> 'courseMembershipId');
  v_on := (i ->> 'occurredOn')::date; v_follow := NULLIF(i ->> 'followUpOn', '')::date;
  -- 기록 날짜는 그 학생의 수강 기간과 이 교사의 담당 기간 안
  IF v_on < m.valid_from OR v_on >= m.valid_to OR v_on < a.valid_from OR v_on >= a.valid_to THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF c -> 'recordId' = 'null'::jsonb THEN
    IF c ? 'sourceActivity' THEN
      -- 활동 채택 근거: 본인 원문판의 현재 행 · 채택 · 같은 학생/수강 · 정정 전 판 아님 · 활동일 이후
      SELECT * INTO t FROM workhub.activity_items
       WHERE school_id = p_ctx.school_id AND course_id = co.id AND owner_account_id = p_ctx.account_id AND id = c #>> '{sourceActivity,itemId}'
       FOR SHARE;
      IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      SELECT * INTO imp FROM workhub.activity_imports WHERE id = t.import_id FOR SHARE;
      IF t.version <> (c #>> '{sourceActivity,itemVersion}')::integer OR t.disposition <> 'adopt' OR t.student_id IS DISTINCT FROM m.student_id
         OR t.course_membership_id IS DISTINCT FROM m.id OR imp.state <> 'active' THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      IF v_on < imp.occurred_on THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    END IF;
    INSERT INTO workhub.teaching_records (school_id, kind, owner_account_id, owner_membership_id, course_id, student_id, course_membership_id,
                                          assignment_id, current_revision_id, source_item_id, source_item_version)
    VALUES (p_ctx.school_id, v_kind, p_ctx.account_id, p_ctx.membership_id, co.id, m.student_id, m.id, a.id, v_rev, t.id, t.version)
    RETURNING id, version INTO v_id, v_ver;
  ELSE
    SELECT * INTO r FROM workhub.teaching_records
     WHERE school_id = p_ctx.school_id AND kind = v_kind AND owner_account_id = p_ctx.account_id AND id = c ->> 'recordId' FOR UPDATE;
    IF r.id IS NULL OR r.course_id <> co.id OR r.student_id <> m.student_id OR r.course_membership_id <> m.id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF r.state <> 'active' OR r.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    UPDATE workhub.teaching_records SET version = version + 1, epoch = epoch + 1, current_revision_id = v_rev, updated_at = clock_timestamp()
     WHERE id = r.id RETURNING id, version INTO v_id, v_ver;
  END IF;
  INSERT INTO workhub.teaching_record_revisions (id, school_id, record_id, version, occurred_on, body, follow_up_on, reason, state, content_hash,
                                                 recorded_by_membership_id)
  VALUES (v_rev, p_ctx.school_id, v_id, v_ver, v_on, i ->> 'text', v_follow, i ->> 'reason', 'active',
          workhub_private.p5_record_hash(v_kind, v_on, i ->> 'text', v_follow, 'active'), p_ctx.membership_id);
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.' || v_kind || '_save', CASE v_kind WHEN 'observation' THEN 'observation' ELSE 'counselling_record' END,
    v_id, v_ver, 'owner_only', p_key, jsonb_build_object('fromActivity', t.id IS NOT NULL));
  RETURN jsonb_build_object('entityId', v_id, 'version', v_ver);
END $$;

-- 철회: 물리 삭제 없이 철회판을 하나 더 쌓는다. 다시 살리는 명령은 없다.
CREATE FUNCTION workhub_private.p5_withdraw(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := c ->> 'recordKind'; co workhub.courses; r workhub.teaching_records; v workhub.teaching_record_revisions;
        x workhub.assessments; xv workhub.assessment_revisions; v_rev text := gen_random_uuid()::text;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId');
  PERFORM workhub_private.p5_writer(p_ctx, co.id, NULL);
  IF v_kind = 'counseling' AND NOT workhub_private.p5_can_counsel(p_ctx, co.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF v_kind = 'assessment' THEN
    SELECT * INTO x FROM workhub.assessments WHERE school_id = p_ctx.school_id AND owner_account_id = p_ctx.account_id AND id = c ->> 'recordId' FOR UPDATE;
    IF x.id IS NULL OR x.course_id <> co.id OR x.student_id <> c ->> 'studentId' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF x.state <> 'active' OR x.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    SELECT * INTO xv FROM workhub.assessment_revisions WHERE id = x.current_revision_id;
    INSERT INTO workhub.assessment_revisions (id, school_id, assessment_id, version, occurred_on, comment, scores, confirmed, total, reason, state,
                                              content_hash, recorded_by_membership_id)
    VALUES (v_rev, p_ctx.school_id, x.id, x.version + 1, xv.occurred_on, xv.comment, xv.scores, xv.confirmed, xv.total, c ->> 'reason', 'withdrawn',
            workhub_private.p5_assessment_hash(x.rubric_revision_id, xv.occurred_on, xv.comment, xv.scores, xv.confirmed, xv.total, 'withdrawn'),
            p_ctx.membership_id);
    UPDATE workhub.assessments SET version = version + 1, epoch = epoch + 1, state = 'withdrawn', current_revision_id = v_rev,
           updated_at = clock_timestamp() WHERE id = x.id;
    PERFORM workhub_private.write_audit(p_ctx, 'teaching.assessment_withdraw', 'assessment', x.id, x.version + 1, 'owner_only', p_key, '{}'::jsonb);
    RETURN jsonb_build_object('entityId', x.id, 'version', x.version + 1);
  END IF;
  SELECT * INTO r FROM workhub.teaching_records
   WHERE school_id = p_ctx.school_id AND kind = v_kind AND owner_account_id = p_ctx.account_id AND id = c ->> 'recordId' FOR UPDATE;
  IF r.id IS NULL OR r.course_id <> co.id OR r.student_id <> c ->> 'studentId' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.state <> 'active' OR r.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO v FROM workhub.teaching_record_revisions WHERE id = r.current_revision_id;
  INSERT INTO workhub.teaching_record_revisions (id, school_id, record_id, version, occurred_on, body, follow_up_on, reason, state, content_hash,
                                                 recorded_by_membership_id)
  VALUES (v_rev, p_ctx.school_id, r.id, r.version + 1, v.occurred_on, v.body, v.follow_up_on, c ->> 'reason', 'withdrawn',
          workhub_private.p5_record_hash(v_kind, v.occurred_on, v.body, v.follow_up_on, 'withdrawn'), p_ctx.membership_id);
  UPDATE workhub.teaching_records SET version = version + 1, epoch = epoch + 1, state = 'withdrawn', current_revision_id = v_rev,
         updated_at = clock_timestamp() WHERE id = r.id;
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.' || v_kind || '_withdraw', CASE v_kind WHEN 'observation' THEN 'observation' ELSE 'counselling_record' END,
    r.id, r.version + 1, 'owner_only', p_key, '{}'::jsonb);
  RETURN jsonb_build_object('entityId', r.id, 'version', r.version + 1);
END $$;

-- ----------------------------------------------------------------------------
-- 7. 명령 — 평가 기준 · 평가
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_rubric_save(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; r workhub.rubrics; v_rev text := gen_random_uuid()::text; v_id text; v_ver integer;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId');
  PERFORM workhub_private.p5_writer(p_ctx, co.id, NULL);
  IF c -> 'rubricId' = 'null'::jsonb THEN
    INSERT INTO workhub.rubrics (school_id, course_id, owner_account_id, owner_membership_id, current_revision_id)
    VALUES (p_ctx.school_id, co.id, p_ctx.account_id, p_ctx.membership_id, v_rev) RETURNING id, version INTO v_id, v_ver;
  ELSE
    SELECT * INTO r FROM workhub.rubrics
     WHERE school_id = p_ctx.school_id AND course_id = co.id AND owner_account_id = p_ctx.account_id AND id = c ->> 'rubricId' FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF r.archived OR r.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    UPDATE workhub.rubrics SET version = version + 1, current_revision_id = v_rev, updated_at = clock_timestamp()
     WHERE id = r.id RETURNING id, version INTO v_id, v_ver;
  END IF;
  INSERT INTO workhub.rubric_revisions (id, school_id, rubric_id, version, label, criteria, recorded_by_membership_id)
  VALUES (v_rev, p_ctx.school_id, v_id, v_ver, c ->> 'label', c -> 'criteria', p_ctx.membership_id);
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.rubric_save', 'rubric', v_id, v_ver, 'owner_only', p_key,
    jsonb_build_object('criteria', jsonb_array_length(c -> 'criteria')));
  RETURN jsonb_build_object('entityId', v_id, 'version', v_ver);
END $$;

-- 평가: 새 평가는 기준의 현재 판으로만, 정정은 처음 판 그대로(다른 판으로 바꿔 덮어쓰지 않는다)
CREATE FUNCTION workhub_private.p5_assessment_save(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; a workhub.course_assignments; m workhub.course_memberships; r workhub.rubrics; rv workhub.rubric_revisions;
        x workhub.assessments; v_on date := (c ->> 'occurredOn')::date; v_total numeric; v_rev text := gen_random_uuid()::text;
        v_id text; v_ver integer;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId');
  a := workhub_private.p5_writer(p_ctx, co.id, c ->> 'assignmentId');
  m := workhub_private.p5_membership(p_ctx, co.id, c ->> 'studentId', c ->> 'courseMembershipId');
  IF v_on < m.valid_from OR v_on >= m.valid_to OR v_on < a.valid_from OR v_on >= a.valid_to THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO r FROM workhub.rubrics
   WHERE school_id = p_ctx.school_id AND course_id = co.id AND owner_account_id = p_ctx.account_id AND id = c ->> 'rubricId' FOR SHARE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO rv FROM workhub.rubric_revisions WHERE rubric_id = r.id AND id = c ->> 'rubricRevisionId';
  IF rv.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p5_scores_fit(c -> 'scores', rv.criteria) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_total := workhub_private.p5_total(c -> 'scores');
  IF c -> 'recordId' = 'null'::jsonb THEN
    IF r.archived OR r.current_revision_id <> rv.id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    INSERT INTO workhub.assessments (school_id, owner_account_id, owner_membership_id, course_id, student_id, course_membership_id, assignment_id,
                                     rubric_id, rubric_revision_id, current_revision_id)
    VALUES (p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, co.id, m.student_id, m.id, a.id, r.id, rv.id, v_rev)
    RETURNING id, version INTO v_id, v_ver;
  ELSE
    SELECT * INTO x FROM workhub.assessments WHERE school_id = p_ctx.school_id AND owner_account_id = p_ctx.account_id AND id = c ->> 'recordId' FOR UPDATE;
    IF x.id IS NULL OR x.course_id <> co.id OR x.student_id <> m.student_id OR x.course_membership_id <> m.id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF x.state <> 'active' OR x.version <> (c ->> 'expectedVersion')::integer OR x.rubric_id <> r.id OR x.rubric_revision_id <> rv.id THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    UPDATE workhub.assessments SET version = version + 1, epoch = epoch + 1, current_revision_id = v_rev, updated_at = clock_timestamp()
     WHERE id = x.id RETURNING id, version INTO v_id, v_ver;
  END IF;
  INSERT INTO workhub.assessment_revisions (id, school_id, assessment_id, version, occurred_on, comment, scores, confirmed, total, reason, state,
                                            content_hash, recorded_by_membership_id)
  VALUES (v_rev, p_ctx.school_id, v_id, v_ver, v_on, c ->> 'comment', c -> 'scores', (c -> 'confirmed')::boolean, v_total, c ->> 'reason', 'active',
          workhub_private.p5_assessment_hash(rv.id, v_on, c ->> 'comment', c -> 'scores', (c -> 'confirmed')::boolean, v_total, 'active'),
          p_ctx.membership_id);
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.assessment_save', 'assessment', v_id, v_ver, 'owner_only', p_key,
    jsonb_build_object('confirmed', (c -> 'confirmed')::boolean));
  RETURN jsonb_build_object('entityId', v_id, 'version', v_ver);
END $$;

-- ----------------------------------------------------------------------------
-- 8. 명령 — 활동 CSV
-- ----------------------------------------------------------------------------
-- 원문 확인: 서버가 원문 바이트 지문을 다시 계산하고 직접 파싱해, 확인 목록(rows)이 원문과 한 칸도 다르지 않은지 본다.
-- 앱 validateActivityInput 과 같은 규칙 + 서버만 아는 것(실제 수강 · 수강 기간 · 수업 기간). 해석한 행 배열을 돌려준다.
CREATE FUNCTION workhub_private.p5_activity_check(p_ctx workhub_private.actor_context, co workhub.courses, i jsonb, p_supersedes text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows jsonb; v_n integer; r jsonb; v_on date; k integer;
BEGIN
  IF NOT workhub_private.p2_exact(i, ARRAY['label','occurredOn','questionVersion','questionSnapshot','kind','parserVersion','rawCsv','fileHash',
                                           'headers','rows','supersedesImportId'])
     OR NOT workhub_private.p5_text(i -> 'label', 120) OR NOT workhub_private.p5_date(i -> 'occurredOn')
     OR NOT workhub_private.p5_text(i -> 'questionVersion', 120) OR NOT workhub_private.p5_text(i -> 'questionSnapshot', 10000)
     OR jsonb_typeof(i -> 'kind') IS DISTINCT FROM 'string' OR i ->> 'kind' NOT IN ('dilemmas','grading')
     OR i -> 'parserVersion' IS DISTINCT FROM '"digital-ethics.csv.v1"'::jsonb
     OR jsonb_typeof(i -> 'rawCsv') IS DISTINCT FROM 'string' OR NOT workhub_private.p5_hash(i -> 'fileHash')
     OR jsonb_typeof(i -> 'headers') IS DISTINCT FROM 'array' OR jsonb_typeof(i -> 'rows') IS DISTINCT FROM 'array'
     OR i -> 'supersedesImportId' IS DISTINCT FROM COALESCE(to_jsonb(p_supersedes), 'null'::jsonb) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 지문은 BOM 을 포함한 원문 UTF-8 바이트 기준(앱 csvHash 와 같다)
  IF encode(sha256(convert_to(i ->> 'rawCsv', 'UTF8')), 'hex') <> i ->> 'fileHash' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_rows := workhub_private.p5_csv(i ->> 'rawCsv');
  IF v_rows -> 0 <> workhub_private.p5_profile(i ->> 'kind') OR i -> 'headers' <> workhub_private.p5_profile(i ->> 'kind') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_n := jsonb_array_length(v_rows) - 1;
  IF v_n < 1 OR jsonb_array_length(i -> 'rows') <> v_n THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_on := (i ->> 'occurredOn')::date;
  IF v_on < co.valid_from OR v_on >= co.valid_to THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR k IN 0 .. v_n - 1 LOOP
    r := i -> 'rows' -> k;
    IF NOT workhub_private.p2_exact(r, ARRAY['rowNumber','alias','values','disposition','studentId','courseMembershipId','reason'])
       OR r -> 'rowNumber' IS DISTINCT FROM to_jsonb(k + 2) OR r -> 'alias' IS DISTINCT FROM v_rows -> (k + 1) -> 0
       OR r -> 'values' IS DISTINCT FROM v_rows -> (k + 1)
       OR jsonb_typeof(r -> 'disposition') IS DISTINCT FROM 'string' OR r ->> 'disposition' NOT IN ('hold','adopt','exclude')
       OR jsonb_typeof(r -> 'reason') IS DISTINCT FROM 'string' OR workhub_private.p5_u16(r ->> 'reason') > 2000 THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF r ->> 'disposition' = 'adopt' THEN
      -- 학생은 교사가 직접 고른 이 수업의 실제 수강생이고, 활동일이 수강 기간 안이어야 한다(별명으로 맞추지 않는다)
      IF NOT workhub_private.p5_id(r -> 'studentId') OR NOT workhub_private.p5_id(r -> 'courseMembershipId')
         OR NOT EXISTS (SELECT 1 FROM workhub.course_memberships m WHERE m.school_id = co.school_id AND m.course_id = co.id
                          AND m.student_id = r ->> 'studentId' AND m.id = r ->> 'courseMembershipId'
                          AND v_on >= m.valid_from AND v_on < m.valid_to) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
    ELSIF r -> 'studentId' <> 'null'::jsonb OR r -> 'courseMembershipId' <> 'null'::jsonb
          OR (r ->> 'disposition' = 'exclude' AND workhub_private.js_trim(r ->> 'reason') = '') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END LOOP;
  -- 같은 학생에게 여러 행을 연결하면 그 행마다 확인 사유가 있어야 한다
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(i -> 'rows') r2 WHERE r2 ->> 'disposition' = 'adopt'
              GROUP BY r2 ->> 'studentId' HAVING count(*) > 1 AND bool_or(workhub_private.js_trim(r2 ->> 'reason') = '')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN v_rows;
END $$;

-- 원문판 + 행 + 행 연결판 1을 만든다. p_map = 정정판의 행 대응 {"<행번호>": {"previousItemId","reason"}} (일반 가져오기는 NULL)
CREATE FUNCTION workhub_private.p5_insert_import(p_ctx workhub_private.actor_context, co workhub.courses, a workhub.course_assignments, i jsonb,
  p_rows jsonb, p_id text, p_supersedes text, p_reason text, p_map jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k integer; r jsonb; v_item text; v_rev text; mp jsonb;
BEGIN
  INSERT INTO workhub.activity_imports (id, school_id, course_id, owner_account_id, owner_membership_id, assignment_id, label, occurred_on,
      question_version, question_snapshot, question_sha256, kind, parser_version, raw_csv, file_hash, headers, supersedes_import_id, correction_reason)
  VALUES (p_id, p_ctx.school_id, co.id, p_ctx.account_id, p_ctx.membership_id, a.id, i ->> 'label', (i ->> 'occurredOn')::date,
      i ->> 'questionVersion', i ->> 'questionSnapshot', encode(sha256(convert_to(i ->> 'questionSnapshot', 'UTF8')), 'hex'), i ->> 'kind',
      i ->> 'parserVersion', i ->> 'rawCsv', i ->> 'fileHash', i -> 'headers', p_supersedes, p_reason);
  FOR k IN 0 .. jsonb_array_length(i -> 'rows') - 1 LOOP
    r := i -> 'rows' -> k; mp := p_map -> (k + 2)::text;
    v_item := gen_random_uuid()::text; v_rev := gen_random_uuid()::text;
    INSERT INTO workhub.activity_items (id, school_id, course_id, owner_account_id, import_id, row_number, alias, row_values, current_revision_id,
        disposition, student_id, course_membership_id, reason, previous_item_id, correspondence_reason)
    VALUES (v_item, p_ctx.school_id, co.id, p_ctx.account_id, p_id, k + 2, p_rows -> (k + 1) ->> 0, p_rows -> (k + 1), v_rev,
        r ->> 'disposition', r ->> 'studentId', r ->> 'courseMembershipId', r ->> 'reason',
        NULLIF(mp ->> 'previousItemId', ''), mp ->> 'reason');
    INSERT INTO workhub.activity_item_revisions (id, school_id, item_id, mapping_version, disposition, student_id, course_membership_id, reason,
        recorded_by_membership_id)
    VALUES (v_rev, p_ctx.school_id, v_item, 1, r ->> 'disposition', r ->> 'studentId', r ->> 'courseMembershipId', r ->> 'reason', p_ctx.membership_id);
  END LOOP;
END $$;

-- 최초 가져오기: expectedVersion = 현재 수업판(명부 기준). 같은 활동 회차(수업·작성자·날짜·이름)의 현재판이 있으면 CONFLICT.
CREATE FUNCTION workhub_private.p5_activity_import(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; a workhub.course_assignments; v_rows jsonb; v_id text := gen_random_uuid()::text;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId', 'share');
  a := workhub_private.p5_writer(p_ctx, co.id, c ->> 'assignmentId');
  IF co.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_rows := workhub_private.p5_activity_check(p_ctx, co, c -> 'input', NULL);
  IF EXISTS (SELECT 1 FROM workhub.activity_imports WHERE school_id = co.school_id AND course_id = co.id AND owner_account_id = p_ctx.account_id
               AND occurred_on = (c #>> '{input,occurredOn}')::date AND label = c #>> '{input,label}' AND state = 'active') THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  PERFORM workhub_private.p5_insert_import(p_ctx, co, a, c -> 'input', v_rows, v_id, NULL, NULL, NULL);
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.activity_import', 'activity_import', v_id, 1, 'owner_only', p_key,
    jsonb_build_object('rows', jsonb_array_length(v_rows) - 1, 'kind', c #>> '{input,kind}'));
  RETURN jsonb_build_object('entityId', v_id, 'version', 1);
END $$;

-- 행 연결·처리 변경: 원문은 그대로, 새 연결판. 행과 원문판의 판을 함께 올리고, 이 행을 쓴 관찰을 재검토 상태로.
CREATE FUNCTION workhub_private.p5_activity_review(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; imp workhub.activity_imports; t workhub.activity_items; v_rev text := gen_random_uuid()::text; v_d text := c ->> 'disposition';
        v_stale integer;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId');
  PERFORM workhub_private.p5_writer(p_ctx, co.id, NULL);
  SELECT * INTO imp FROM workhub.activity_imports
   WHERE school_id = co.school_id AND course_id = co.id AND owner_account_id = p_ctx.account_id AND id = c ->> 'importId' FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO t FROM workhub.activity_items WHERE import_id = imp.id AND id = c ->> 'itemId' FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- 정정 전 원문판은 읽기 전용
  IF imp.state <> 'active' OR t.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF v_d = 'withdraw' AND t.disposition <> 'adopt' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF v_d = 'adopt' AND NOT EXISTS (SELECT 1 FROM workhub.course_memberships m WHERE m.school_id = co.school_id AND m.course_id = co.id
                                     AND m.student_id = c ->> 'studentId' AND m.id = c ->> 'courseMembershipId'
                                     AND imp.occurred_on >= m.valid_from AND imp.occurred_on < m.valid_to) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  INSERT INTO workhub.activity_item_revisions (id, school_id, item_id, mapping_version, disposition, student_id, course_membership_id, reason,
      recorded_by_membership_id)
  VALUES (v_rev, p_ctx.school_id, t.id, t.mapping_version + 1, v_d, c ->> 'studentId', c ->> 'courseMembershipId', c ->> 'reason', p_ctx.membership_id);
  UPDATE workhub.activity_items SET version = version + 1, mapping_version = mapping_version + 1, current_revision_id = v_rev, disposition = v_d,
         student_id = c ->> 'studentId', course_membership_id = c ->> 'courseMembershipId', reason = c ->> 'reason', updated_at = clock_timestamp()
   WHERE id = t.id;
  UPDATE workhub.activity_imports SET version = version + 1, updated_at = clock_timestamp() WHERE id = imp.id;
  v_stale := workhub_private.p5_stale(ARRAY[t.id]);
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.activity_review', 'activity_item', t.id, t.version + 1, 'owner_only', p_key,
    jsonb_build_object('disposition', v_d, 'staleRecords', v_stale));
  RETURN jsonb_build_object('entityId', t.id, 'version', t.version + 1);
END $$;

-- 원문 정정판: 이전 판의 모든 행을 새 행 하나에 대응시키거나 제외 사유를 적어야 한다(정확한 분할). 새 원문판을 만들고 이전 판은 superseded.
CREATE FUNCTION workhub_private.p5_activity_correct(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE co workhub.courses; a workhub.course_assignments; prev workhub.activity_imports; i jsonb := c -> 'input'; mp jsonb := c -> 'correspondence';
        v_rows jsonb; v_new text := gen_random_uuid()::text; v_items text[]; v_map jsonb; v_stale integer; v_n integer;
BEGIN
  co := workhub_private.p5_course_get(p_ctx, c ->> 'courseId');
  a := workhub_private.p5_writer(p_ctx, co.id, c ->> 'assignmentId');
  SELECT * INTO prev FROM workhub.activity_imports
   WHERE school_id = co.school_id AND course_id = co.id AND owner_account_id = p_ctx.account_id AND id = c ->> 'previousImportId' FOR UPDATE;
  IF prev.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF prev.state <> 'active' OR prev.version <> (c ->> 'expectedVersion')::integer OR prev.file_hash <> c ->> 'expectedFileHash' THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  PERFORM 1 FROM workhub.activity_items WHERE import_id = prev.id ORDER BY id FOR UPDATE;
  SELECT array_agg(id ORDER BY id) INTO v_items FROM workhub.activity_items WHERE import_id = prev.id;
  -- 같은 원문은 정정이 아니다(학생 연결만 고칠 때는 activity_review). CSV 형식은 바꿀 수 없다.
  IF i ->> 'fileHash' IS NOT DISTINCT FROM c ->> 'expectedFileHash' OR i ->> 'kind' IS DISTINCT FROM prev.kind THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_rows := workhub_private.p5_activity_check(p_ctx, co, i, prev.id);
  v_n := jsonb_array_length(v_rows) - 1;
  -- 대응 표 모양(앱 validateActivityCorrection 과 같은 규칙)
  IF NOT workhub_private.p2_exact(mp, ARRAY['reason','previousRows','rows','omitted']) OR NOT workhub_private.p5_text(mp -> 'reason', 2000)
     OR jsonb_typeof(mp -> 'previousRows') IS DISTINCT FROM 'array' OR jsonb_array_length(mp -> 'previousRows') NOT BETWEEN 1 AND 500
     OR jsonb_typeof(mp -> 'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(mp -> 'rows') > 500
     OR jsonb_typeof(mp -> 'omitted') IS DISTINCT FROM 'array' OR jsonb_array_length(mp -> 'omitted') > 500
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'previousRows') o
                 WHERE NOT workhub_private.p2_exact(o, ARRAY['itemId','itemVersion']) OR NOT workhub_private.p5_id(o -> 'itemId')
                    OR NOT workhub_private.p2_int(o -> 'itemVersion', 1))
     OR (SELECT count(DISTINCT o ->> 'itemId') FROM jsonb_array_elements(mp -> 'previousRows') o) <> jsonb_array_length(mp -> 'previousRows')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'rows') r
                 WHERE NOT workhub_private.p2_exact(r, ARRAY['rowNumber','previousItemId','reason']) OR NOT workhub_private.p2_int(r -> 'rowNumber', 2, 501)
                    OR NOT (r -> 'previousItemId' = 'null'::jsonb OR workhub_private.p5_id(r -> 'previousItemId'))
                    OR NOT workhub_private.p5_text(r -> 'reason', 2000, r -> 'previousItemId' <> 'null'::jsonb)
                    OR (r -> 'previousItemId' <> 'null'::jsonb
                        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'previousRows') o WHERE o ->> 'itemId' = r ->> 'previousItemId')))
     OR (SELECT count(DISTINCT r -> 'rowNumber') FROM jsonb_array_elements(mp -> 'rows') r) <> jsonb_array_length(mp -> 'rows')
     OR (SELECT count(r ->> 'previousItemId') - count(DISTINCT r ->> 'previousItemId') FROM jsonb_array_elements(mp -> 'rows') r) <> 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'omitted') o
                 WHERE NOT workhub_private.p2_exact(o, ARRAY['itemId','reason']) OR NOT workhub_private.p5_id(o -> 'itemId')
                    OR NOT workhub_private.p5_text(o -> 'reason', 2000)
                    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'previousRows') p WHERE p ->> 'itemId' = o ->> 'itemId'))
     OR (SELECT count(DISTINCT o ->> 'itemId') FROM jsonb_array_elements(mp -> 'omitted') o) <> jsonb_array_length(mp -> 'omitted') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 새 판의 모든 행이 대응 표에 정확히 한 번
  IF jsonb_array_length(mp -> 'rows') <> v_n
     OR EXISTS (SELECT 1 FROM generate_series(2, v_n + 1) g
                 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'rows') r WHERE (r ->> 'rowNumber')::integer = g)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 이전 판의 행 집합이 정확히 같아야 하고(다른 판·다른 교사 행 주입 거부), 각 행은 대응 하나 또는 제외 하나
  IF (SELECT array_agg(o ->> 'itemId' ORDER BY o ->> 'itemId') FROM jsonb_array_elements(mp -> 'previousRows') o) IS DISTINCT FROM v_items
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'previousRows') o
                 WHERE (SELECT count(*) FROM jsonb_array_elements(mp -> 'rows') r WHERE r ->> 'previousItemId' = o ->> 'itemId')
                     + (SELECT count(*) FROM jsonb_array_elements(mp -> 'omitted') x WHERE x ->> 'itemId' = o ->> 'itemId') <> 1) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 정정 준비 뒤 학생 연결이 바뀌었으면 CONFLICT
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(mp -> 'previousRows') o JOIN workhub.activity_items t ON t.id = o ->> 'itemId'
              WHERE t.version <> (o ->> 'itemVersion')::integer) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  SELECT jsonb_object_agg(r ->> 'rowNumber', jsonb_build_object('previousItemId', r -> 'previousItemId', 'reason', r -> 'reason')) INTO v_map
    FROM jsonb_array_elements(mp -> 'rows') r;
  -- 이전 판을 먼저 superseded 로(같은 활동 회차의 현재판은 하나), 후속판 FK 는 커밋 전에 확인된다
  UPDATE workhub.activity_imports SET state = 'superseded', superseded_by_import_id = v_new, version = version + 1, updated_at = clock_timestamp()
   WHERE id = prev.id;
  PERFORM workhub_private.p5_insert_import(p_ctx, co, a, i, v_rows, v_new, prev.id, mp ->> 'reason', v_map);
  INSERT INTO workhub.activity_item_omissions (school_id, import_id, item_id, reason)
  SELECT p_ctx.school_id, v_new, o ->> 'itemId', o ->> 'reason' FROM jsonb_array_elements(mp -> 'omitted') o;
  v_stale := workhub_private.p5_stale(v_items);
  PERFORM workhub_private.write_audit(p_ctx, 'teaching.activity_correct', 'activity_import', v_new, 1, 'owner_only', p_key,
    jsonb_build_object('previousImportId', prev.id, 'rows', v_n, 'omitted', jsonb_array_length(mp -> 'omitted'), 'staleRecords', v_stale));
  RETURN jsonb_build_object('entityId', v_new, 'version', 1);
END $$;

-- ----------------------------------------------------------------------------
-- 9. 변경 진입점 — 요청 원장(같은 키 + 같은 내용 = 처음 접수증, 다른 내용 = IDEMPOTENCY_CONFLICT)
--    원장 재생은 준비 상태·권한 재확인보다 먼저: 이미 반영된 요청을 나중의 권한 회수로 실패로 바꾸지 않는다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_receipt(q workhub.teaching_requests, p_outcome text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('requestKey', q.request_key, 'commandKind', q.command_kind, 'entityId', q.entity_id, 'version', q.entity_version,
                            'outcome', p_outcome, 'appliedAt', workhub_private.p5_ts(q.applied_at))
$$;

CREATE FUNCTION workhub_private.p5_mutate(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.teaching_requests; v_hash text := workhub_private.p2_sha(c); v_kind text; r jsonb;
BEGIN
  IF NOT workhub_private.p5_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p5_lock(p_ctx, p_key);
  SELECT * INTO q FROM workhub.teaching_requests WHERE school_id = p_ctx.school_id AND owner_account_id = p_ctx.account_id AND request_key = p_key;
  IF q.request_key IS NOT NULL THEN
    IF q.payload_sha256 <> v_hash OR q.command_kind IS DISTINCT FROM c ->> 'kind' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN workhub_private.p5_receipt(q, 'replayed');
  END IF;
  IF NOT workhub_private.p5_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
  v_kind := workhub_private.p5_cmd_ok(c);
  r := CASE v_kind
    WHEN 'course_create' THEN workhub_private.p5_course_create(p_ctx, c, p_key)
    WHEN 'roster_import' THEN workhub_private.p5_roster_import(p_ctx, c, p_key)
    WHEN 'observation_save' THEN workhub_private.p5_record_save(p_ctx, c, p_key)
    WHEN 'counseling_save' THEN workhub_private.p5_record_save(p_ctx, c, p_key)
    WHEN 'record_withdraw' THEN workhub_private.p5_withdraw(p_ctx, c, p_key)
    WHEN 'rubric_save' THEN workhub_private.p5_rubric_save(p_ctx, c, p_key)
    WHEN 'assessment_save' THEN workhub_private.p5_assessment_save(p_ctx, c, p_key)
    WHEN 'activity_import' THEN workhub_private.p5_activity_import(p_ctx, c, p_key)
    WHEN 'activity_review' THEN workhub_private.p5_activity_review(p_ctx, c, p_key)
    WHEN 'activity_correct' THEN workhub_private.p5_activity_correct(p_ctx, c, p_key)
  END;
  INSERT INTO workhub.teaching_requests (school_id, owner_account_id, request_key, membership_id, command_kind, payload_sha256, entity_id, entity_version)
  VALUES (p_ctx.school_id, p_ctx.account_id, p_key, p_ctx.membership_id, v_kind, v_hash, r ->> 'entityId', (r ->> 'version')::integer)
  RETURNING * INTO q;
  RETURN workhub_private.p5_receipt(q, 'applied');
END $$;

-- 업무 거절은 봉투 + code 로, 동시 생성 경합(유일·겹침 제약)은 CONFLICT 로. 지연 FK 는 함수 안에서 확인해 커밋 때 뒤늦게 터지지 않게 한다.
CREATE FUNCTION workhub_private.p5_run(p_ctx workhub_private.actor_context, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT workhub_private.p5_installed() THEN RETURN workhub_private.p5_err(p_ctx, 'UNAVAILABLE'); END IF;
  BEGIN
    IF p_op <> 'mutate' AND NOT workhub_private.p5_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
    IF p_op = 'catalog' THEN v := workhub_private.p5_catalog(p_ctx);
    ELSIF p_op = 'course' THEN v := workhub_private.p5_course_snapshot(p_ctx, a ->> 'course');
    ELSIF p_op = 'student' THEN v := workhub_private.p5_student_snapshot(p_ctx, a ->> 'course', a ->> 'student', a ->> 'cursor');
    ELSIF p_op = 'counseling' THEN v := workhub_private.p5_counseling_snapshot(p_ctx, a ->> 'course', a ->> 'student', a ->> 'cursor');
    ELSIF p_op = 'activity' THEN v := workhub_private.p5_activity_snapshot(p_ctx, a ->> 'course', a ->> 'import');
    ELSIF p_op = 'rubric_revision' THEN v := workhub_private.p5_rubric_revision(p_ctx, a ->> 'course', a ->> 'rubric', a ->> 'revision');
    ELSIF p_op = 'mutate' THEN
      v := workhub_private.p5_mutate(p_ctx, a -> 'command', a ->> 'key');
      SET CONSTRAINTS ALL IMMEDIATE;
    ELSE RAISE EXCEPTION 'P5_UNKNOWN_OPERATION';
    END IF;
    RETURN workhub_private.p5_ok(p_ctx, v);
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p5_business(SQLERRM) THEN RETURN workhub_private.p5_err(p_ctx, SQLERRM); END IF;
      RAISE;
    WHEN unique_violation OR exclusion_violation THEN
      RETURN workhub_private.p5_err(p_ctx, 'CONFLICT');
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 10. 문서함(P4) 학생 기록 초안 근거 확인 — P4 의 p4_doc_student 가 부른다.
--     모든 근거가 지금 호출자 본인의 현재 판이어야 한다: 관찰 = active · 재검토 아님 · 상담 아님, 평가 = active · 확정 · 의견 있음.
--     판 ID · 내용 지문 · epoch 가 다르거나 구간이 본문 밖이면 CONFLICT. 못 보는 수업·학생·기록은 NOT_FOUND. 수업 모듈이 꺼져 있으면 NOT_READY.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p5_document_student_check(p_ctx workhub_private.actor_context, p_context jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; r workhub.teaching_records; v workhub.teaching_record_revisions; x workhub.assessments; xv workhub.assessment_revisions;
        v_course text := p_context ->> 'courseId'; v_student text := p_context ->> 'studentId';
BEGIN
  IF NOT workhub_private.p5_installed() OR NOT workhub_private.p5_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF v_course IS NULL OR NOT workhub_private.p5_course_visible(p_ctx, v_course)
     OR NOT EXISTS (SELECT 1 FROM workhub.course_memberships m WHERE m.school_id = p_ctx.school_id AND m.course_id = v_course AND m.student_id = v_student) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  FOR e IN SELECT y FROM jsonb_array_elements(p_context -> 'evidence') y LOOP
    IF e ->> 'kind' = 'observation' THEN
      SELECT * INTO r FROM workhub.teaching_records
       WHERE school_id = p_ctx.school_id AND owner_account_id = p_ctx.account_id AND kind = 'observation' AND id = e ->> 'id'
         AND course_id = v_course AND student_id = v_student FOR SHARE;
      IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      SELECT * INTO v FROM workhub.teaching_record_revisions WHERE id = r.current_revision_id;
      IF r.state <> 'active' OR r.source_review_required OR v.id <> e ->> 'revisionId' OR v.content_hash <> e ->> 'sourceHash'
         OR r.epoch <> (e ->> 'epoch')::integer OR (e ->> 'end')::integer > length(v.body) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
    ELSIF e ->> 'kind' = 'assessment' THEN
      SELECT * INTO x FROM workhub.assessments
       WHERE school_id = p_ctx.school_id AND owner_account_id = p_ctx.account_id AND id = e ->> 'id'
         AND course_id = v_course AND student_id = v_student FOR SHARE;
      IF x.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      SELECT * INTO xv FROM workhub.assessment_revisions WHERE id = x.current_revision_id;
      IF x.state <> 'active' OR NOT xv.confirmed OR workhub_private.js_trim(xv.comment) = '' OR xv.id <> e ->> 'revisionId'
         OR xv.content_hash <> e ->> 'sourceHash' OR x.epoch <> (e ->> 'epoch')::integer OR (e ->> 'end')::integer > length(xv.comment) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
    ELSE
      -- 상담 · 그 밖의 근거 종류는 받지 않는다
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 11. 공개 함수 7개 (authenticated). p_member_id 는 요청 범위일 뿐이고, 실제 주체는 JWT 다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_teaching_catalog(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p5_run(ctx, 'catalog', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_teaching_course(p_member_id text, p_course_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p5_run(ctx, 'course', jsonb_build_object('course', p_course_id));
END $$;

CREATE FUNCTION public.workhub_teaching_student(p_member_id text, p_course_id text, p_student_id text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p5_run(ctx, 'student', jsonb_build_object('course', p_course_id, 'student', p_student_id, 'cursor', p_cursor));
END $$;

CREATE FUNCTION public.workhub_teaching_counseling(p_member_id text, p_course_id text, p_student_id text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p5_run(ctx, 'counseling', jsonb_build_object('course', p_course_id, 'student', p_student_id, 'cursor', p_cursor));
END $$;

CREATE FUNCTION public.workhub_teaching_activity(p_member_id text, p_course_id text, p_import_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p5_run(ctx, 'activity', jsonb_build_object('course', p_course_id, 'import', p_import_id));
END $$;

CREATE FUNCTION public.workhub_teaching_rubric_revision(p_member_id text, p_course_id text, p_rubric_id text, p_revision_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p5_run(ctx, 'rubric_revision', jsonb_build_object('course', p_course_id, 'rubric', p_rubric_id, 'revision', p_revision_id));
END $$;

CREATE FUNCTION public.workhub_teaching_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p5_run(ctx, 'mutate', jsonb_build_object('command', p_command, 'key', p_request_key));
END $$;

-- ----------------------------------------------------------------------------
-- 12. 권한 — 공개 함수 7개만 authenticated 에. 내부 함수는 API 역할이 실행할 수 없다.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p5\_%')
               OR (p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_teaching\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.workhub_teaching_catalog(text), public.workhub_teaching_course(text, text),
  public.workhub_teaching_student(text, text, text, text), public.workhub_teaching_counseling(text, text, text, text),
  public.workhub_teaching_activity(text, text, text), public.workhub_teaching_rubric_revision(text, text, text, text),
  public.workhub_teaching_mutate(text, jsonb, text) TO authenticated;

INSERT INTO workhub_private.p5_installs (batch, release) VALUES ('P5-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 13. 검증 — 모든 행의 status 가 ok 여야 한다. P5-02-3 은 "아직 켜지 않음"이 정상이다(P5-04 전).
-- ----------------------------------------------------------------------------
WITH app(f) AS (VALUES ('public.workhub_teaching_catalog(text)'),('public.workhub_teaching_course(text,text)'),
  ('public.workhub_teaching_student(text,text,text,text)'),('public.workhub_teaching_counseling(text,text,text,text)'),
  ('public.workhub_teaching_activity(text,text,text)'),('public.workhub_teaching_rubric_revision(text,text,text,text)'),
  ('public.workhub_teaching_mutate(text,jsonb,text)'))
SELECT 'P5-02-1' AS no, '앱 함수 7개: authenticated 만 실행(anon·service_role 불가), SECURITY DEFINER·search_path 고정' AS item,
       CASE WHEN count(*) = 7 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM app JOIN pg_proc p ON p.oid = to_regprocedure(app.f)
UNION ALL
SELECT 'P5-02-2', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p5\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P5-02-3', '아직 어느 학교도 켜지 않음(수업 모듈 활성화 0, 정책 0)',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'teaching') = 0
             AND (SELECT count(*) FROM workhub.teaching_policies) = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P5-02-4', '문서함 학생 근거 확인 함수(P4 가 있으면 학생 기록 초안이 이 함수로 대조됨)',
       CASE WHEN to_regprocedure('workhub_private.p5_document_student_check(workhub_private.actor_context,jsonb)') IS NOT NULL THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN to_regprocedure('workhub_private.p4_doc_student(workhub_private.actor_context,jsonb)') IS NOT NULL THEN 'P4 있음' ELSE 'P4 없음' END
UNION ALL
SELECT 'P5-02-5', '적용 기록 P5-01·02', CASE WHEN workhub_private.p5_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
