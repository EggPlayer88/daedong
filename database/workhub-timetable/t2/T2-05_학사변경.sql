-- ============================================================================
-- T2-05  시간표 2단계 — 학사 변경(휴업 · 특별 일과) 미리보기 · 반영 (비활성 설치)
--
-- ▣ 공개 함수(timetable-school-day.v1): workhub_timetable_school_day_preview · workhub_timetable_school_day_execute
-- ▣ 규칙(앱 school-day-execution-server.ts 와 같은 계산)
--   - 담당자(year.manage)만. 화면이 본 조회(asOf · 기간)를 그대로 기준으로 계산하고, 그 뒤 범위 안 수업 · 요청이 바뀌었으면 CONFLICT.
--   - 대상 = 그날 걸친 예정 수업 중 고른 학급 · 수강집단이 들어간 수업. 고르지 않은 집단과 함께 듣는 수업 · 이미 시작한 수업 ·
--     날짜를 넘기는 수업 · 진행 중이거나 반영된 교환 요청이 걸린 수업이 있으면 차단(부분 반영하지 않는다).
--   - 휴업 = 수업 취소, 특별 일과 = 지금 수업 시각 → 새 시각(교시 ID 추정 없음). 반영한 수업은 다시 공개해도 유지(pinned).
--   - 알림은 보내지 않는다(설계 문서 결정 대기 — 교사는 시간표 화면에서 바뀐 수업을 본다).
-- ▣ 전제: T2-04(2026-10-20.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t2_installs') IS NULL THEN RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-04' AND release = '2026-10-20.1') THEN
    RAISE EXCEPTION 'T2 중단: T2-04(2026-10-20.1)를 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-05') THEN RAISE EXCEPTION 'T2 중단: T2-05 가 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_timetable\_school\_day\_%') THEN
    RAISE EXCEPTION 'T2 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- 앱 SchoolDayExecutionInput — 학급 ID 는 정렬 · 중복 없음, 종은 변경 전 시각 순(앱이 정렬해 보낸 값 그대로여야 한다)
CREATE FUNCTION workhub_private.t2_school_day_input(i jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT workhub_private.p2_exact(i, ARRAY['kind','date','groupIds','reason','bells']) OR jsonb_typeof(i -> 'kind') <> 'string'
     OR i ->> 'kind' NOT IN ('closure','special_bells') OR workhub_private.t2_parse_date(i -> 'date') IS NULL
     OR NOT workhub_private.p7_text(i -> 'reason', workhub_private.t2_limit('reason'), true)
     OR jsonb_typeof(i -> 'groupIds') <> 'array' OR jsonb_array_length(i -> 'groupIds') NOT BETWEEN 1 AND workhub_private.t2_limit('groups')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(i -> 'groupIds') g WHERE NOT workhub_private.p7_id(g))
     OR (SELECT array_agg(g ORDER BY o) FROM jsonb_array_elements_text(i -> 'groupIds') WITH ORDINALITY z(g, o))
        IS DISTINCT FROM (SELECT array_agg(DISTINCT g COLLATE "C" ORDER BY g COLLATE "C") FROM jsonb_array_elements_text(i -> 'groupIds') g)
     OR jsonb_typeof(i -> 'bells') <> 'array' OR jsonb_array_length(i -> 'bells') > workhub_private.t2_limit('specialBells')
     OR (i ->> 'kind' = 'closure') <> (jsonb_array_length(i -> 'bells') = 0)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(i -> 'bells') b WHERE NOT workhub_private.p2_exact(b, ARRAY['before','after'])
                  OR NOT workhub_private.t2_time_ok(b -> 'before') OR NOT workhub_private.t2_time_ok(b -> 'after'))
     OR (SELECT count(DISTINCT b -> 'before') FROM jsonb_array_elements(i -> 'bells') b) <> jsonb_array_length(i -> 'bells')
     OR (SELECT array_agg(b -> 'before' ORDER BY o) FROM jsonb_array_elements(i -> 'bells') WITH ORDINALITY z(b, o))
        IS DISTINCT FROM (SELECT array_agg(b -> 'before' ORDER BY b #>> '{before,startsAt}', b #>> '{before,endsAt}') FROM jsonb_array_elements(i -> 'bells') b) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 미리보기 계산(앱 parseSchoolDayExecutionPreview 와 같은 값). 미리보기 ID · 시각을 받아 같은 값을 다시 만든다(확정 때 지문 비교).
CREATE FUNCTION workhub_private.t2_school_day_calc(p_ctx workhub_private.actor_context, i jsonb, p_as_of timestamptz, p_range daterange,
                                                   p_id text, p_created timestamptz, p_expires timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tz text := p_ctx.school_timezone; v_date date := (i ->> 'date')::date; v_groups text[] := ARRAY(SELECT jsonb_array_elements_text(i -> 'groupIds'));
        v_src jsonb; v_changes jsonb; v_effects jsonb; v_blockers jsonb := '[]'::jsonb; v_flags jsonb; v_conf boolean; v_body jsonb; v_lost bigint; v_cnt integer;
BEGIN
  IF v_date < lower(p_range) OR v_date >= upper(p_range) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.t2_unchanged(p_ctx.school_id, p_as_of, p_range, v_tz) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 화면이 본 수업(기간 · asOf)
  WITH vl AS (
    SELECT l.*, workhub_private.t2_vlesson(l, p_ctx, p_as_of) AS v FROM workhub.timetable_lessons l
     WHERE l.school_id = p_ctx.school_id
       AND l.starts_at >= (lower(p_range)::timestamp AT TIME ZONE v_tz) - interval '1 day' AND l.starts_at < (upper(p_range)::timestamp AT TIME ZONE v_tz)
       AND workhub_private.t2_in(l.starts_at, l.ends_at, p_range, v_tz)
  )
  SELECT (SELECT count(*) FROM vl),
         jsonb_build_object(
           'unknownGroup', EXISTS (SELECT 1 FROM unnest(v_groups) g WHERE NOT EXISTS (SELECT 1 FROM vl CROSS JOIN jsonb_array_elements(vl.groups) x WHERE x ->> 'id' = g)),
           'src', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vl.id, 'version', vl.version, 'v', vl.v, 's', vl.starts_at, 'e', vl.ends_at,
                                       'teachers', to_jsonb(vl.teacher_ids), 'groups', vl.groups,
                                       'joint', EXISTS (SELECT 1 FROM jsonb_array_elements(vl.groups) x WHERE NOT (x ->> 'id' = ANY (v_groups))),
                                       'past', vl.starts_at <= p_created,
                                       'crossing', workhub_private.t2_day(vl.starts_at, v_tz) <> v_date OR workhub_private.t2_day(vl.ends_at - interval '1 millisecond', v_tz) <> v_date)
                                     ORDER BY vl.id COLLATE "C")
                              FROM vl WHERE vl.state = 'scheduled' AND workhub_private.t2_day(vl.starts_at, v_tz) <= v_date
                               AND workhub_private.t2_day(vl.ends_at - interval '1 millisecond', v_tz) >= v_date
                               AND EXISTS (SELECT 1 FROM jsonb_array_elements(vl.groups) x WHERE x ->> 'id' = ANY (v_groups))), '[]'::jsonb),
           'others', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vl.id, 's', vl.starts_at, 'e', vl.ends_at, 'teachers', to_jsonb(vl.teacher_ids), 'groups', vl.groups))
                                 FROM vl WHERE vl.state = 'scheduled' AND workhub_private.t2_day(vl.starts_at, v_tz) <= v_date
                                  AND workhub_private.t2_day(vl.ends_at - interval '1 millisecond', v_tz) >= v_date), '[]'::jsonb))
    INTO v_cnt, v_flags;
  IF v_cnt > workhub_private.t2_limit('lessons') THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  IF (v_flags ->> 'unknownGroup')::boolean THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_src := v_flags -> 'src';
  -- 종: 새 시각은 그날 안(그대로 둔 자정 경계 수업만 예외) · 특별 일과의 변경 전 시각 = 대상 수업 시각 전부
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(i -> 'bells') b
              WHERE NOT (workhub_private.t2_day((b #>> '{after,startsAt}')::timestamptz, v_tz) = v_date
                         AND workhub_private.t2_day((b #>> '{after,endsAt}')::timestamptz - interval '1 millisecond', v_tz) = v_date)
                AND NOT (b -> 'before' = b -> 'after' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_src) x WHERE x #> '{v,time}' = b -> 'before')))
     OR (i ->> 'kind' = 'special_bells'
         AND (SELECT COALESCE(array_agg(DISTINCT x #>> '{v,time}' ORDER BY x #>> '{v,time}'), ARRAY[]::text[]) FROM jsonb_array_elements(v_src) x)
             IS DISTINCT FROM (SELECT COALESCE(array_agg(DISTINCT (b -> 'before')::text ORDER BY (b -> 'before')::text), ARRAY[]::text[]) FROM jsonb_array_elements(i -> 'bells') b)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 바뀌는 수업(대상 중 차단 사유가 없는 것). 특별 일과에서 시각이 그대로인 수업은 바꾸지 않는다.
  SELECT COALESCE(jsonb_agg(ch ORDER BY ch #>> '{after,id}' COLLATE "C"), '[]'::jsonb) INTO v_changes FROM (
    SELECT jsonb_build_object('before', x -> 'v', 'after', CASE WHEN i ->> 'kind' = 'closure'
             THEN (x -> 'v') || jsonb_build_object('version', (x ->> 'version')::integer + 1, 'state', 'cancelled', 'canRequest', false, 'allowedTargets', '[]'::jsonb)
             ELSE (x -> 'v') || jsonb_build_object('version', (x ->> 'version')::integer + 1, 'time', b -> 'after', 'allowedTargets', '[]'::jsonb, 'canRequest', false) END) AS ch
      FROM jsonb_array_elements(v_src) x
      LEFT JOIN LATERAL (SELECT b FROM jsonb_array_elements(i -> 'bells') b WHERE b -> 'before' = x #> '{v,time}') bb ON true
     WHERE NOT (x ->> 'joint')::boolean AND NOT (x ->> 'past')::boolean AND NOT (x ->> 'crossing')::boolean
       AND NOT (i ->> 'kind' = 'special_bells' AND bb.b -> 'after' = x #> '{v,time}')) z;
  -- 걸린 교환 요청(화면이 본 요청 중 진행 중 · 반영된 것)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('requestId', q.v ->> 'id', 'version', (q.v -> 'version'), 'state', q.v ->> 'state', 'handling', 'blocked')
                            ORDER BY q.v ->> 'id' COLLATE "C"), '[]'::jsonb) INTO v_effects
    FROM (SELECT workhub_private.t2_req_view(r, p_ctx, p_as_of) AS v FROM workhub.timetable_exchange_requests r
           WHERE r.school_id = p_ctx.school_id AND r.first_day < upper(p_range) AND r.last_day >= lower(p_range) AND r.created_at <= p_as_of
             AND workhub_private.t2_req_visible(r, p_ctx)) q
   WHERE q.v ->> 'state' IN ('awaiting_consent','awaiting_approval','applied')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.v -> 'changes') c JOIN jsonb_array_elements(v_src) x ON x ->> 'id' = c #>> '{after,id}');
  -- 차단 사유(앱이 요구하는 코드 그대로, 코드마다 1개)
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_src) x WHERE (x ->> 'joint')::boolean) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PARTIAL_GROUP_SCOPE', 'message', '고르지 않은 학급 · 수강집단과 함께 듣는 수업이 있습니다. 함께 듣는 집단을 모두 고르거나 따로 조정해 주세요.'));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_src) x WHERE (x ->> 'past')::boolean) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PAST_RECORD', 'message', '이미 시작한 수업이 있습니다. 지난 기록은 바꾸지 않습니다.'));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_src) x WHERE (x ->> 'crossing')::boolean) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'CROSS_DAY_LESSON', 'message', '날짜를 넘기는 수업은 이 화면에서 바꾸지 않습니다.'));
  END IF;
  IF jsonb_array_length(v_src) = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'NO_LESSONS', 'message', '그날 고른 학급 · 수강집단의 예정 수업이 없습니다.'));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_changes) c WHERE c #>> '{after,state}' <> 'cancelled' AND (c #>> '{after,time,startsAt}')::timestamptz <= p_created) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PAST_TARGET', 'message', '새 시각이 이미 지났습니다.'));
  END IF;
  IF jsonb_array_length(v_effects) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'EXISTING_EXCHANGE', 'message', '진행 중이거나 반영된 교환 요청이 걸린 수업이 있습니다. 요청을 먼저 정리해 주세요.'));
  END IF;
  -- 겹침: 바뀐 뒤 그날 수업끼리 교사 · 학급(수강집단)이 겹치는가(앱과 같은 검사) + 공간 정원(서버 추가 검사)
  WITH fin AS (
    SELECT o ->> 'id' AS id, COALESCE((c #>> '{after,time,startsAt}')::timestamptz, (o ->> 's')::timestamptz) AS s,
           COALESCE((c #>> '{after,time,endsAt}')::timestamptz, (o ->> 'e')::timestamptz) AS e, o -> 'teachers' AS t, o -> 'groups' AS g, c IS NOT NULL AS changed
      FROM jsonb_array_elements(v_flags -> 'others') o LEFT JOIN jsonb_array_elements(v_changes) c ON c #>> '{after,id}' = o ->> 'id'
     WHERE c IS NULL OR c #>> '{after,state}' <> 'cancelled'
  )
  SELECT EXISTS (SELECT 1 FROM fin a JOIN fin b ON a.id < b.id AND (a.changed OR b.changed) AND a.s < b.e AND b.s < a.e
                  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.t) x JOIN jsonb_array_elements_text(b.t) y ON x = y)
                     OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.g) x JOIN jsonb_array_elements(b.g) y ON x ->> 'id' = y ->> 'id'))
      OR cardinality(workhub_private.t2_conflicts(p_ctx.school_id,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 's', c #>> '{after,time,startsAt}', 'e', c #>> '{after,time,endsAt}', 'uses', l.uses))
                       FROM jsonb_array_elements(v_changes) c JOIN workhub.timetable_lessons l ON l.school_id = p_ctx.school_id AND l.id = c #>> '{after,id}'
                      WHERE c #>> '{after,state}' <> 'cancelled'), '[]'::jsonb),
           ARRAY(SELECT c #>> '{after,id}' FROM jsonb_array_elements(v_changes) c WHERE c #>> '{after,state}' = 'cancelled'))) > 0
    INTO v_conf;
  IF v_conf THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_CONFLICT', 'message', '바뀐 시각에 같은 교사 · 학급 · 공간을 쓰는 수업이 겹칩니다.'));
  END IF;
  SELECT count(*) FILTER (WHERE c #>> '{after,state}' = 'cancelled'),
         COALESCE(sum(greatest(0, extract(epoch FROM ((c #>> '{before,time,endsAt}')::timestamptz - (c #>> '{before,time,startsAt}')::timestamptz))
                               - CASE WHEN c #>> '{after,state}' = 'cancelled' THEN 0
                                      ELSE extract(epoch FROM ((c #>> '{after,time,endsAt}')::timestamptz - (c #>> '{after,time,startsAt}')::timestamptz)) END)), 0)::bigint
    INTO v_cnt, v_lost FROM jsonb_array_elements(v_changes) c;
  v_body := jsonb_build_object('input', i, 'sourceAsOf', workhub_private.t2_ts(p_as_of), 'previewId', p_id,
    'createdAt', workhub_private.t2_ts(p_created), 'expiresAt', workhub_private.t2_ts(p_expires), 'complete', true,
    'coverage', jsonb_build_object('date', i -> 'date', 'groupIds', i -> 'groupIds', 'complete', true, 'existingRequests', 'complete'),
    'affectedLessons', COALESCE((SELECT jsonb_agg(jsonb_build_object('lessonId', x ->> 'id', 'version', x -> 'version') ORDER BY x ->> 'id' COLLATE "C")
                                   FROM jsonb_array_elements(v_src) x), '[]'::jsonb),
    'changes', v_changes, 'requestEffects', v_effects, 'blockers', v_blockers,
    'preserved', jsonb_build_object('pastRecords', true, 'outsideTarget', true, 'existingChanges', CASE WHEN jsonb_array_length(v_effects) > 0 THEN 'blocked' ELSE 'retained' END),
    'lostLessonCount', v_cnt, 'lostSeconds', v_lost, 'changesActualSchedule', false);
  RETURN v_body || jsonb_build_object('previewHash', workhub_private.p2_sha(v_body));
END $$;

CREATE FUNCTION workhub_private.t2_school_day_preview(p_ctx workhub_private.actor_context, i jsonb, p_as_of text, p_from text, p_until text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_at timestamptz := workhub_private.t2_parse_ts(to_jsonb(p_as_of), false); v_range daterange; r workhub.timetable_previews; v jsonb;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.t2_school_day_input(i);
  v_range := workhub_private.t2_range(p_from, p_until, workhub_private.t2_limit('listDays'));
  IF v_at IS NULL OR v_at > clock_timestamp() + interval '30 seconds' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  r := workhub_private.t2_preview_row(p_ctx, 'school_day', jsonb_build_object('input', i, 'from', p_from, 'until', p_until), v_at);
  IF r.created_at < v_at THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v := workhub_private.t2_school_day_calc(p_ctx, i, v_at, v_range, r.id, r.created_at, r.expires_at);
  r.preview_hash := v ->> 'previewHash'; r.total_changes := jsonb_array_length(v -> 'changes'); r.blocker_count := jsonb_array_length(v -> 'blockers');
  INSERT INTO workhub.timetable_previews SELECT r.*;
  RETURN v;
END $$;

-- 반영: {kind:'school_day', preview:{previewId, previewHash, expiresAt}} — 같은 미리보기를 다시 계산해 지문이 같아야 한다
CREATE FUNCTION workhub_private.t2_school_day_execute(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(c); v jsonb; p workhub.timetable_previews; x jsonb; v_at timestamptz; v_id text; v_ids jsonb;
BEGIN
  v := workhub_private.t2_claim(p_ctx, 'school_day', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p2_exact(c, ARRAY['kind','preview']) OR c ->> 'kind' IS DISTINCT FROM 'school_day' OR jsonb_typeof(c -> 'kind') <> 'string'
     OR NOT workhub_private.p2_exact(c -> 'preview', ARRAY['previewId','previewHash','expiresAt']) OR NOT workhub_private.p7_id(c #> '{preview,previewId}')
     OR NOT workhub_private.p5_hash(c #> '{preview,previewHash}') OR workhub_private.t2_parse_ts(c #> '{preview,expiresAt}', false) IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO p FROM workhub.timetable_previews WHERE id = c #>> '{preview,previewId}' AND school_id = p_ctx.school_id
     AND membership_id = p_ctx.membership_id AND account_id = p_ctx.account_id AND kind = 'school_day';
  IF p.id IS NULL OR p.preview_hash <> c #>> '{preview,previewHash}' OR to_jsonb(workhub_private.t2_ts(p.expires_at)) <> c #> '{preview,expiresAt}' THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF p.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  x := workhub_private.t2_school_day_calc(p_ctx, p.input -> 'input', p.source_as_of,
         workhub_private.t2_range(p.input ->> 'from', p.input ->> 'until', workhub_private.t2_limit('listDays')), p.id, p.created_at, p.expires_at);
  IF x ->> 'previewHash' <> p.preview_hash THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF jsonb_array_length(x -> 'blockers') > 0 OR jsonb_array_length(x -> 'changes') = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_at := workhub_private.t2_now();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(x -> 'changes') ch WHERE (ch #>> '{before,time,startsAt}')::timestamptz <= v_at
               OR (ch #>> '{after,state}' <> 'cancelled' AND (ch #>> '{after,time,startsAt}')::timestamptz <= v_at)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  v_ids := (SELECT jsonb_agg(jsonb_build_object('id', ch #>> '{after,id}', 'version', ch #> '{after,version}') ORDER BY ch #>> '{after,id}' COLLATE "C")
              FROM jsonb_array_elements(x -> 'changes') ch);
  INSERT INTO workhub.timetable_school_day_changes (school_id, preview_id, input, changed_lessons, lost_lesson_count, membership_id, request_key, recorded_at)
  VALUES (p_ctx.school_id, p.id, p.input -> 'input', v_ids, (x -> 'lostLessonCount')::integer, p_ctx.membership_id, p_key, v_at)
  RETURNING id INTO v_id;
  UPDATE workhub.timetable_lessons l SET state = ch #>> '{after,state}', starts_at = (ch #>> '{after,time,startsAt}')::timestamptz,
         ends_at = (ch #>> '{after,time,endsAt}')::timestamptz, version = (ch #>> '{after,version}')::integer, pinned = true,
         changed_by = 'school_day', changed_at = v_at
    FROM jsonb_array_elements(x -> 'changes') ch WHERE l.school_id = p_ctx.school_id AND l.id = ch #>> '{after,id}';
  INSERT INTO workhub.timetable_lesson_versions (school_id, lesson_id, version, change_kind, source_id, snapshot)
  SELECT l.school_id, l.id, l.version, 'school_day', v_id, to_jsonb(l) - 'school_id'
    FROM workhub.timetable_lessons l JOIN jsonb_array_elements(x -> 'changes') ch ON ch #>> '{after,id}' = l.id WHERE l.school_id = p_ctx.school_id;
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.school_day', 'timetable_school_day_change', v_id, 1, 'school', p_key,
    jsonb_build_object('kind', p.input #>> '{input,kind}', 'date', p.input #>> '{input,date}', 'changes', jsonb_array_length(v_ids),
                       'lostLessonCount', x -> 'lostLessonCount'));
  v := jsonb_build_object('requestKey', p_key, 'commandHash', v_hash, 'kind', 'school_day', 'entityId', v_id, 'version', 1, 'status', 'applied',
                          'recordedAt', workhub_private.t2_ts(v_at), 'changedLessonCount', jsonb_array_length(v_ids), 'changesHash', workhub_private.p2_sha(v_ids),
                          'lostLessonCount', x -> 'lostLessonCount');
  PERFORM workhub_private.t2_record(p_ctx, 'school_day', p_key, v_hash, v);
  RETURN v;
END $$;

CREATE FUNCTION public.workhub_timetable_school_day_preview(p_member_id text, p_input jsonb, p_source_as_of text, p_from text, p_until text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-school-day.v1', 'school_day_preview',
                                jsonb_build_object('input', p_input, 'asOf', p_source_as_of, 'from', p_from, 'until', p_until));
END $$;
CREATE FUNCTION public.workhub_timetable_school_day_execute(p_member_id text, p_command jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t2_run(ctx, 'timetable-school-day.v1', 'school_day_execute', jsonb_build_object('command', p_command, 'key', p_request_key, 'recover', p_recover_only));
END $$;
COMMENT ON FUNCTION public.workhub_timetable_school_day_preview(text, jsonb, text, text, text) IS '업무실 T2 시간표 운영: 휴업 · 특별 일과 영향 미리보기(담당자, 15분).';
COMMENT ON FUNCTION public.workhub_timetable_school_day_execute(text, jsonb, text, boolean) IS '업무실 T2 시간표 운영: 휴업 · 특별 일과 반영(요청 번호 · 복구 조회).';

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND p.proname LIKE 't2\_%') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_timetable\_school\_day\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_timetable_school_day_preview(text, jsonb, text, text, text),
    public.workhub_timetable_school_day_execute(text, jsonb, text, boolean) TO authenticated;
END $$;

INSERT INTO workhub_private.t2_installs (batch, release) VALUES ('T2-05', '2026-10-20.1');
COMMIT;

SELECT 'T2-05-1' AS no, '공개 함수 2개 authenticated 만' AS item,
       CASE WHEN (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_school\_day\_%'
                   AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) = 2 THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T2-05-2', '적용 기록 T2-05', CASE WHEN workhub_private.t2_installed('T2-05') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
