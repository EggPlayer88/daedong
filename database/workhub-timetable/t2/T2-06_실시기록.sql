-- ============================================================================
-- T2-06  시간표 2단계 — 수업 실시 기록(원장 · 정정 이력) (비활성 설치)
--
-- ▣ 공개 함수(timetable.execution-records.v1, PR #72 execution-records-api.md)
--     workhub_timetable_execution_get · workhub_timetable_execution_history · workhub_timetable_execution_record
-- ▣ 규칙
--   - 예정 수업과 실시 결과를 분리한다. 끝난 시각이 지났다고 자동 완료하지 않고, 수업 state · 판 · 담당 교사를 바꾸지 않는다.
--   - 읽기 = 그 수업 담당 교사 또는 담당자(year.manage). 그 밖의 교사는 FORBIDDEN(메모에 사유가 담길 수 있어 공유 시간표보다 좁힌다).
--   - 쓰기 = 그 수업 담당 교사 본인만(대리 기록 없음), 예정(scheduled) 수업이 끝난 뒤에만. 결과 3종 · 미실시/확인 필요는 메모 필수.
--   - 수업마다 원장 1개(ID 고정). 정정은 같은 원장의 판+1, 정정 사유 필수. 판마다 불변 이력(timetable_execution_record_versions).
--   - 기록은 끝난 수업에만 생기고, 공개 · 교환 · 학사 변경은 시작 전 수업만 바꾸므로 기록된 수업의 판은 다시 바뀌지 않는다.
--   - 이력 쪽 넘김 = 서버가 서명한 cursor(학교 · 소속 · 수업 · 원장 · anchor 판 · 다음 판에 묶음). 쪽 크기 20 고정.
-- ▣ 전제: T2-05(2026-10-20.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t2_installs') IS NULL THEN RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-05' AND release = '2026-10-20.1') THEN
    RAISE EXCEPTION 'T2 중단: T2-05(2026-10-20.1)를 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-06') THEN RAISE EXCEPTION 'T2 중단: T2-06 이 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_timetable\_execution\_%') THEN
    RAISE EXCEPTION 'T2 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 표시 형식
-- ----------------------------------------------------------------------------
-- 앱 ExecutionLesson — 학생 · 개인 사유 없음
CREATE FUNCTION workhub_private.t2_exec_lesson(l workhub.timetable_lessons) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', l.id, 'version', l.version, 'label', l.label, 'startsAt', workhub_private.t2_ts(l.starts_at),
                            'endsAt', workhub_private.t2_ts(l.ends_at), 'state', l.state, 'teacherIds', to_jsonb(l.teacher_ids))
$$;
-- 앱 ExecutionRecord — 그 판의 원문 그대로(이름 · 수업 판 · 기록시각은 그 판에 남긴 값)
CREATE FUNCTION workhub_private.t2_exec_row(v workhub.timetable_execution_record_versions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', v.record_id, 'version', v.version, 'lessonId', v.lesson_id, 'lessonVersion', v.lesson_version,
                            'outcome', v.outcome, 'note', v.note, 'correctionReason', v.correction_reason,
                            'recordedBy', jsonb_build_object('id', v.recorded_by_membership_id, 'name', v.recorded_by_name),
                            'recordedAt', workhub_private.t2_ts(v.recorded_at))
$$;
-- 판 p_from 부터 내림차순 최대 20개
CREATE FUNCTION workhub_private.t2_exec_page(p_record text, p_from integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(workhub_private.t2_exec_row(v) ORDER BY v.version DESC), '[]'::jsonb)
    FROM workhub.timetable_execution_record_versions v
   WHERE v.record_id = p_record AND v.version <= p_from AND v.version > p_from - 20
$$;
-- cursor = 'v<다음 판>_<서명 32자>'. 서명은 학교 · 소속 · 수업 · 원장 · anchor · 다음 판을 묶는다(다른 범위에 쓰면 맞지 않는다).
CREATE FUNCTION workhub_private.t2_exec_cursor(p_ctx workhub_private.actor_context, p_lesson text, p_record text, p_anchor integer, p_next integer) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_next < 1 THEN NULL ELSE 'v' || p_next || '_' || left(encode(sha256(convert_to(concat_ws(chr(31), 't2exec', p_ctx.school_id,
           p_ctx.membership_id, p_ctx.account_id, p_lesson, p_record, p_anchor::text, p_next::text), 'UTF8')), 'hex'), 32) END
$$;

-- ----------------------------------------------------------------------------
-- 2. 조회 — 수업과 읽을 권한을 함께 확인한다(없는 수업 · 다른 학교 = NOT_FOUND, 읽을 수 없음 = FORBIDDEN)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_exec_source(p_ctx workhub_private.actor_context, p_lesson text) RETURNS workhub.timetable_lessons
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE l workhub.timetable_lessons;
BEGIN
  IF NOT workhub_private.p7_id(to_jsonb(p_lesson)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO l FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = p_lesson;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT (p_ctx.membership_id = ANY (l.teacher_ids) OR workhub_private.p5_manager(p_ctx)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- 앱이 받지 못하는 수업(4시간 초과 · 교사 없음)은 조회 오류로(추정해 고치지 않는다)
  IF l.ends_at - l.starts_at > interval '14400 seconds' OR cardinality(l.teacher_ids) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  RETURN l;
END $$;

CREATE FUNCTION workhub_private.t2_exec_get(p_ctx workhub_private.actor_context, p_lesson text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l workhub.timetable_lessons; r workhub.timetable_execution_records; v_at timestamptz := workhub_private.t2_now(); v_hist jsonb;
BEGIN
  l := workhub_private.t2_exec_source(p_ctx, p_lesson);
  SELECT * INTO r FROM workhub.timetable_execution_records WHERE school_id = p_ctx.school_id AND lesson_id = l.id;
  v_hist := CASE WHEN r.id IS NULL THEN '[]'::jsonb ELSE workhub_private.t2_exec_page(r.id, r.version) END;
  RETURN jsonb_build_object('asOf', workhub_private.t2_ts(v_at), 'timeZone', p_ctx.school_timezone, 'lesson', workhub_private.t2_exec_lesson(l),
    'allowedOutcomes', CASE WHEN p_ctx.membership_id = ANY (l.teacher_ids) AND l.state = 'scheduled' AND l.ends_at <= v_at
                              AND COALESCE(r.version, 0) < 2147483647
                            THEN '["completed","not_performed","needs_review"]'::jsonb ELSE '[]'::jsonb END,
    'current', CASE WHEN r.id IS NULL THEN 'null'::jsonb ELSE v_hist -> 0 END,
    'history', v_hist,
    'nextCursor', to_jsonb(CASE WHEN r.id IS NULL THEN NULL ELSE workhub_private.t2_exec_cursor(p_ctx, l.id, r.id, r.version, r.version - 20) END));
END $$;

-- 처음 get 에서 본 anchor 판 아래의 불변 이력을 이어 읽는다(그 사이 정정이 생겨도 같은 쪽). 권한은 매번 다시 본다.
CREATE FUNCTION workhub_private.t2_exec_history(p_ctx workhub_private.actor_context, p_lesson text, p_anchor integer, p_cursor text, p_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l workhub.timetable_lessons; r workhub.timetable_execution_records; v_next integer;
BEGIN
  IF p_size IS DISTINCT FROM 20 OR p_anchor IS NULL OR p_anchor < 1 OR p_cursor IS NULL OR p_cursor !~ '^v[1-9][0-9]{0,9}_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  l := workhub_private.t2_exec_source(p_ctx, p_lesson);
  SELECT * INTO r FROM workhub.timetable_execution_records WHERE school_id = p_ctx.school_id AND lesson_id = l.id;
  IF r.id IS NULL OR r.version < p_anchor THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_next := substring(p_cursor FROM '^v([0-9]+)_')::bigint;
  IF v_next >= p_anchor OR p_cursor IS DISTINCT FROM workhub_private.t2_exec_cursor(p_ctx, l.id, r.id, p_anchor, v_next) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  RETURN jsonb_build_object('lessonId', l.id, 'anchorRecordVersion', p_anchor, 'history', workhub_private.t2_exec_page(r.id, v_next),
                            'nextCursor', to_jsonb(workhub_private.t2_exec_cursor(p_ctx, l.id, r.id, p_anchor, v_next - 20)));
END $$;

-- ----------------------------------------------------------------------------
-- 3. 기록 · 정정 — 원장(접수증)을 먼저, 그다음 준비 · 입력 · 권한 · 판을 잠금 안에서
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_exec_command(c jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_first boolean;
BEGIN
  IF NOT workhub_private.p2_exact(c, ARRAY['lessonId','expectedLessonVersion','expectedRecordVersion','expectedRecordId','outcome','note','correctionReason'])
     OR NOT workhub_private.p7_id(c -> 'lessonId') OR NOT workhub_private.p2_int(c -> 'expectedLessonVersion', 1, 2147483647)
     OR NOT workhub_private.p2_int(c -> 'expectedRecordVersion', 0, 2147483646)
     OR jsonb_typeof(c -> 'outcome') IS DISTINCT FROM 'string' OR c ->> 'outcome' NOT IN ('completed','not_performed','needs_review')
     OR NOT workhub_private.p7_text(c -> 'note', 1000, c ->> 'outcome' <> 'completed') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_first := (c ->> 'expectedRecordVersion')::integer = 0;
  IF v_first <> (jsonb_typeof(c -> 'expectedRecordId') = 'null') OR v_first <> (jsonb_typeof(c -> 'correctionReason') = 'null')
     OR (NOT v_first AND (NOT workhub_private.p7_id(c -> 'expectedRecordId') OR NOT workhub_private.p7_text(c -> 'correctionReason', 500, true))) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

CREATE FUNCTION workhub_private.t2_exec_record(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(c); v jsonb; l workhub.timetable_lessons; r workhub.timetable_execution_records;
        v_at timestamptz; v_ver integer; n workhub.timetable_execution_record_versions;
BEGIN
  v := workhub_private.t2_claim(p_ctx, 'execution', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.t2_exec_command(c);
  -- 공개 · 교환 · 학사 변경과 같은 학교 잠금(수업 판이 그 사이 바뀌지 않게)
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  SELECT * INTO l FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = c ->> 'lessonId' FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT p_ctx.membership_id = ANY (l.teacher_ids) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_at := workhub_private.t2_now();
  IF l.ends_at > v_at THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF l.state <> 'scheduled' OR l.version <> (c ->> 'expectedLessonVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO r FROM workhub.timetable_execution_records WHERE school_id = p_ctx.school_id AND lesson_id = l.id FOR UPDATE;
  IF COALESCE(r.version, 0) <> (c ->> 'expectedRecordVersion')::integer OR r.id IS DISTINCT FROM (c ->> 'expectedRecordId') THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF r.id IS NULL THEN
    INSERT INTO workhub.timetable_execution_records (school_id, lesson_id, version, updated_at) VALUES (p_ctx.school_id, l.id, 1, v_at) RETURNING * INTO r;
  ELSE
    UPDATE workhub.timetable_execution_records SET version = version + 1, updated_at = v_at WHERE id = r.id RETURNING * INTO r;
  END IF;
  INSERT INTO workhub.timetable_execution_record_versions (school_id, record_id, version, lesson_id, lesson_version, outcome, note, correction_reason,
                                                          recorded_by_membership_id, recorded_by_name, request_key, recorded_at)
  VALUES (p_ctx.school_id, r.id, r.version, l.id, l.version, c ->> 'outcome', c ->> 'note', c ->> 'correctionReason',
          p_ctx.membership_id, workhub_private.t2_member_name(p_ctx.membership_id), p_key, v_at)
  RETURNING * INTO n;
  -- 감사에는 메모 · 사유 원문을 넣지 않는다(결과와 판만)
  PERFORM workhub_private.write_audit(p_ctx, CASE WHEN r.version = 1 THEN 'timetable.execution_record' ELSE 'timetable.execution_correct' END,
    'timetable_execution_record', r.id, r.version, 'school', p_key,
    jsonb_build_object('lessonId', l.id, 'lessonVersion', l.version, 'outcome', c ->> 'outcome'));
  v := jsonb_build_object('requestKey', p_key, 'commandHash', v_hash, 'record', workhub_private.t2_exec_row(n));
  PERFORM workhub_private.t2_record(p_ctx, 'execution', p_key, v_hash, v);
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 4. 공개 함수(이 파일 3개)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_timetable_execution_get(p_member_id text, p_lesson_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable.execution-records.v1', 'execution_get', jsonb_build_object('lessonId', p_lesson_id));
END $$;
CREATE FUNCTION public.workhub_timetable_execution_history(p_member_id text, p_lesson_id text, p_anchor_version integer, p_cursor text, p_page_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable.execution-records.v1', 'execution_history',
                                jsonb_build_object('lessonId', p_lesson_id, 'anchor', p_anchor_version, 'cursor', p_cursor, 'size', p_page_size));
END $$;
CREATE FUNCTION public.workhub_timetable_execution_record(p_member_id text, p_command jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t2_run(ctx, 'timetable.execution-records.v1', 'execution_record',
                                jsonb_build_object('command', p_command, 'key', p_request_key, 'recover', p_recover_only));
END $$;
COMMENT ON FUNCTION public.workhub_timetable_execution_get(text, text) IS '업무실 T2 시간표 운영: 수업 하나의 실시 기록(현재 판 · 이력 첫 쪽 · 기록할 수 있는 결과).';
COMMENT ON FUNCTION public.workhub_timetable_execution_history(text, text, integer, text, integer) IS '업무실 T2 시간표 운영: 실시 기록 이력 다음 쪽(20개, 서버 서명 cursor).';
COMMENT ON FUNCTION public.workhub_timetable_execution_record(text, jsonb, text, boolean) IS '업무실 T2 시간표 운영: 실시 기록 · 정정(담당 교사, 끝난 수업, 요청 번호 · 복구 조회).';

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND p.proname LIKE 't2\_%') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_timetable\_execution\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_timetable_execution_get(text, text), public.workhub_timetable_execution_history(text, text, integer, text, integer),
    public.workhub_timetable_execution_record(text, jsonb, text, boolean) TO authenticated;
END $$;

INSERT INTO workhub_private.t2_installs (batch, release) VALUES ('T2-06', '2026-10-20.1');
COMMIT;

SELECT 'T2-06-1' AS no, '공개 함수 3개 authenticated 만' AS item,
       CASE WHEN (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_execution\_%'
                   AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) = 3 THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T2-06-2', '적용 기록 T2-06 · T2 다섯 묶음 모두 적용', CASE WHEN workhub_private.t2_installed('T2-06') AND workhub_private.t2_installed_all() THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T2-06-3', '아직 켜지 않음(모듈 timetable_operations 꺼짐 — T2-08 전 정상)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM workhub.module_activations WHERE module = 'timetable_operations' AND state = 'active') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
