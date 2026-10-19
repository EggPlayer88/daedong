-- ============================================================================
-- T2-04  시간표 2단계 — 날짜별 수업 이동 · 교환 요청(미리보기 · 추천 · 제출 · 동의 · 승인 · 철회) · 요청 알림 (비활성 설치)
--
-- ▣ 공개 함수: timetable-operations.v1 workhub_timetable_operations_exchange_preview
--              timetable-operations.next.v1 workhub_timetable_operations_recommend
--   제출(submit) · 응답(action)은 T2-03 의 workhub_timetable_operations_execute 가 이 파일의 t2_submit · t2_action 을 부른다.
-- ▣ 규칙(K-4 · 정책 4)
--   - 요청 = 그 수업의 담당 교사만. 옮길 곳 = 그 수업의 같은 주 공식 시간대(길이 같음). 교환 = 두 수업이 서로의 시각으로 갈 수 있을 때.
--   - 관련 교사(전후 담당 합집합)가 모두 동의 → 승인 담당(year.manage, 요청자와 다른 계정)이 승인하면 반영(수업 판 +1, 다시 공개해도 유지).
--   - 기한 = 관련 수업 중 가장 이른 시작. 기한이 지나거나 수업 판이 바뀌면 화면 상태 expired · stale 이고 응답할 수 없다.
--   - 알림은 T2-02(알림 출처 timetable)가 적용되고 메시지가 준비된 학교에서만 같은 트랜잭션으로 만든다(없으면 요청은 그대로 진행).
-- ▣ 전제: T2-03(2026-10-20.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t2_installs') IS NULL THEN RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-03' AND release = '2026-10-20.1') THEN
    RAISE EXCEPTION 'T2 중단: T2-03(2026-10-20.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-04') THEN RAISE EXCEPTION 'T2 중단: T2-04 가 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 입력 · 계산
-- ----------------------------------------------------------------------------
-- 앱 OperationTime(수업 시각): 정수 초 · 시작 < 끝 · 1440분 이내
CREATE FUNCTION workhub_private.t2_time_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_exact(p, ARRAY['startsAt','endsAt']) AND workhub_private.t2_parse_ts(p -> 'startsAt', true) IS NOT NULL
     AND workhub_private.t2_parse_ts(p -> 'endsAt', true) IS NOT NULL
     AND workhub_private.t2_parse_ts(p -> 'startsAt', true) < workhub_private.t2_parse_ts(p -> 'endsAt', true)
     AND workhub_private.t2_parse_ts(p -> 'endsAt', true) - workhub_private.t2_parse_ts(p -> 'startsAt', true) <= interval '1440 minutes'
$$;
-- 앱 ExchangeInput(move · swap)
CREATE FUNCTION workhub_private.t2_exchange_input(i jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF i IS NULL OR jsonb_typeof(i) <> 'object' OR jsonb_typeof(i -> 'kind') <> 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF i ->> 'kind' = 'move' THEN
    IF NOT workhub_private.p2_exact(i, ARRAY['kind','lessonId','expectedVersion','target','reason']) OR NOT workhub_private.t2_time_ok(i -> 'target') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSIF i ->> 'kind' = 'swap' THEN
    IF NOT workhub_private.p2_exact(i, ARRAY['kind','lessonId','expectedVersion','otherLessonId','otherExpectedVersion','reason'])
       OR NOT workhub_private.p7_id(i -> 'otherLessonId') OR NOT workhub_private.p7_pos(i -> 'otherExpectedVersion') OR i -> 'lessonId' = i -> 'otherLessonId' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF NOT workhub_private.p7_id(i -> 'lessonId') OR NOT workhub_private.p7_pos(i -> 'expectedVersion')
     OR NOT workhub_private.p7_text(i -> 'reason', workhub_private.t2_limit('reason'), false) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 이동 · 교환 계산(p_at 기준). 돌려주는 값 {changes, blockers, participants}. 앱 canExchange 와 같은 순서로 거절한다.
--   before = 보는 사람의 수업 값(get 과 같음), after = 시각과 판만 다르다.
CREATE FUNCTION workhub_private.t2_exchange_calc(p_ctx workhub_private.actor_context, i jsonb, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a workhub.timetable_lessons; o workhub.timetable_lessons; va jsonb; vo jsonb; v_changes jsonb; v_blockers jsonb := '[]'::jsonb; v_ids text[]; v_c text[];
        v_bad jsonb; v_closed jsonb; v_tz text := p_ctx.school_timezone;
BEGIN
  PERFORM workhub_private.t2_exchange_input(i);
  SELECT * INTO a FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = i ->> 'lessonId';
  IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT (p_ctx.membership_id = ANY (a.teacher_ids)) OR a.changed_by = 'school_day' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF to_jsonb(a.version) <> i -> 'expectedVersion' OR a.state <> 'scheduled' OR a.starts_at <= p_at THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  va := workhub_private.t2_vlesson(a, p_ctx, p_at);
  IF i ->> 'kind' = 'move' THEN
    IF NOT ((va -> 'allowedTargets') @> jsonb_build_array(i -> 'target')) OR i -> 'target' = va -> 'time'
       OR workhub_private.t2_parse_ts(i #> '{target,startsAt}', true) <= p_at THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_changes := jsonb_build_array(jsonb_build_object('before', va, 'after', va || jsonb_build_object('version', a.version + 1, 'time', i -> 'target')));
  ELSE
    SELECT * INTO o FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = i ->> 'otherLessonId';
    IF o.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF to_jsonb(o.version) <> i -> 'otherExpectedVersion' OR o.state <> 'scheduled' OR o.starts_at <= p_at THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    vo := workhub_private.t2_vlesson(o, p_ctx, p_at);
    IF NOT ((va -> 'allowedTargets') @> jsonb_build_array(vo -> 'time')) OR NOT ((vo -> 'allowedTargets') @> jsonb_build_array(va -> 'time'))
       OR va -> 'time' = vo -> 'time' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_changes := jsonb_build_array(jsonb_build_object('before', va, 'after', va || jsonb_build_object('version', a.version + 1, 'time', vo -> 'time')),
                                   jsonb_build_object('before', vo, 'after', vo || jsonb_build_object('version', o.version + 1, 'time', va -> 'time')));
  END IF;
  v_ids := ARRAY(SELECT c #>> '{after,id}' FROM jsonb_array_elements(v_changes) c);
  -- 내가 담당한 수업에 그 사이 다른 요청이 걸렸으면 화면이 본 수업(요청 가능)과 달라졌다 → CONFLICT(앱이 다시 조회).
  --   앱은 before 가 화면의 수업과 같아야 받으므로, 차단 사유로 돌려주면 응답 오류(INVALID_RESPONSE)로 보인다.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_changes) c
              WHERE c #> '{before,teachers}' @> jsonb_build_array(jsonb_build_object('id', p_ctx.membership_id))
                AND workhub_private.t2_lesson_busy(p_ctx.school_id, c #>> '{after,id}', p_at)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 차단: 진행 중 요청(상대 수업) · 자원 겹침 · 공개판 불가 조건 · 휴업일
  v_bad := (SELECT jsonb_agg(x ORDER BY x) FROM unnest(v_ids) x WHERE workhub_private.t2_lesson_busy(p_ctx.school_id, x, p_at));
  IF v_bad IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PENDING_REQUEST',
      'message', '이 수업에 진행 중인 다른 교환 요청이 있습니다. 그 요청이 끝난 뒤 다시 확인해 주세요.', 'lessonIds', v_bad));
  END IF;
  v_c := workhub_private.t2_conflicts(p_ctx.school_id, (
    SELECT jsonb_agg(jsonb_build_object('id', l.id, 's', c #>> '{after,time,startsAt}', 'e', c #>> '{after,time,endsAt}', 'uses', l.uses))
      FROM jsonb_array_elements(v_changes) c JOIN workhub.timetable_lessons l ON l.school_id = p_ctx.school_id AND l.id = c #>> '{after,id}'), ARRAY[]::text[]);
  IF cardinality(v_c) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_CONFLICT',
      'message', '옮길 시간에 같은 교사 · 학급 · 공간을 쓰는 다른 수업이 있습니다.', 'lessonIds', to_jsonb(v_c)));
  END IF;
  v_bad := (SELECT jsonb_agg(l.id ORDER BY l.id) FROM jsonb_array_elements(v_changes) c JOIN workhub.timetable_lessons l ON l.school_id = p_ctx.school_id AND l.id = c #>> '{after,id}'
             WHERE workhub_private.t2_unavailable(l.publication_id, l.uses, (c #>> '{after,time,startsAt}')::timestamptz, (c #>> '{after,time,endsAt}')::timestamptz, v_tz));
  IF v_bad IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_UNAVAILABLE',
      'message', '옮길 시간은 교사 · 공간의 수업 불가 시간입니다.', 'lessonIds', v_bad));
  END IF;
  v_bad := (SELECT jsonb_agg(c #>> '{after,id}' ORDER BY c #>> '{after,id}') FROM jsonb_array_elements(v_changes) c
             WHERE jsonb_array_length(workhub_private.t2_closed_days(p_ctx.school_id, workhub_private.t2_day((c #>> '{after,time,startsAt}')::timestamptz, v_tz),
                                                                     workhub_private.t2_day((c #>> '{after,time,startsAt}')::timestamptz, v_tz) + 1)) > 0);
  IF v_bad IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'SCHOOL_CLOSED', 'message', '옮길 날짜가 휴업일입니다.', 'lessonIds', v_bad));
  END IF;
  RETURN jsonb_build_object('changes', v_changes, 'blockers', v_blockers, 'participants', workhub_private.t2_participants(v_changes));
END $$;

CREATE FUNCTION workhub_private.t2_exchange_body(i jsonb, x jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('input', i, 'complete', true, 'changes', x -> 'changes', 'participants', x -> 'participants', 'blockers', x -> 'blockers')
$$;

-- 미리보기 행을 저장하고 앱 ExchangePreview 를 돌려준다(추천 후보도 같은 함수 — 그대로 제출할 수 있다)
CREATE FUNCTION workhub_private.t2_exchange_store(p_ctx workhub_private.actor_context, i jsonb, x jsonb, r workhub.timetable_previews) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_body jsonb := workhub_private.t2_exchange_body(i, x);
BEGIN
  r.preview_hash := workhub_private.p2_sha(v_body); r.total_changes := jsonb_array_length(x -> 'changes'); r.blocker_count := jsonb_array_length(x -> 'blockers');
  INSERT INTO workhub.timetable_previews SELECT r.*;
  RETURN v_body || jsonb_build_object('previewId', r.id, 'previewHash', r.preview_hash, 'createdAt', workhub_private.t2_ts(r.created_at),
                                      'expiresAt', workhub_private.t2_ts(r.expires_at));
END $$;

CREATE FUNCTION workhub_private.t2_exchange_preview(p_ctx workhub_private.actor_context, i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_previews;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.t2_exchange_input(i);
  r := workhub_private.t2_preview_row(p_ctx, 'exchange', i, NULL);
  RETURN workhub_private.t2_exchange_store(p_ctx, i, workhub_private.t2_exchange_calc(p_ctx, i, r.created_at), r);
END $$;

-- ----------------------------------------------------------------------------
-- 2. 추천(next.v1 recommend) — 같은 주의 빈 시간으로 옮기기 · 맞바꿀 수 있는 수업. 막히는 후보는 내지 않는다. 최대 3개.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_recommend(p_ctx workhub_private.actor_context, i jsonb, p_as_of text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_at timestamptz := workhub_private.t2_parse_ts(to_jsonb(p_as_of), false); v_range daterange; a workhub.timetable_lessons; va jsonb; v_now timestamptz;
        v_tz text := p_ctx.school_timezone; opt record; cand jsonb; x jsonb; r workhub.timetable_previews; v_cands jsonb := '[]'::jsonb; n integer := 0;
        v_limited boolean := false; v_label text;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p2_exact(i, ARRAY['lessonId','expectedVersion','reason','from','until']) OR NOT workhub_private.p7_id(i -> 'lessonId')
     OR NOT workhub_private.p7_pos(i -> 'expectedVersion') OR NOT workhub_private.p7_text(i -> 'reason', workhub_private.t2_limit('reason'), true)
     OR jsonb_typeof(i -> 'from') <> 'string' OR jsonb_typeof(i -> 'until') <> 'string' OR v_at IS NULL OR v_at > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_range := workhub_private.t2_range(i ->> 'from', i ->> 'until', workhub_private.t2_limit('listDays'));
  IF NOT workhub_private.t2_unchanged(p_ctx.school_id, v_at, v_range, v_tz) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_now := workhub_private.t2_now();
  SELECT * INTO a FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = i ->> 'lessonId';
  IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT (p_ctx.membership_id = ANY (a.teacher_ids)) OR a.changed_by = 'school_day' OR workhub_private.t2_lesson_busy(a.school_id, a.id, v_now) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF to_jsonb(a.version) <> i -> 'expectedVersion' OR a.state <> 'scheduled' OR a.starts_at <= v_now THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  va := workhub_private.t2_vlesson(a, p_ctx, v_now);
  -- 후보 순서: 빈 시간으로 옮기기(시각 순) → 맞바꾸기(시각 순). 40개까지 살펴본다.
  FOR opt IN
    SELECT 1 AS ord, (t ->> 'startsAt')::timestamptz AS s, jsonb_build_object('kind', 'move', 'lessonId', a.id, 'expectedVersion', a.version, 'target', t,
             'reason', i -> 'reason') AS inp, NULL::text AS other_label
      FROM jsonb_array_elements(va -> 'allowedTargets') t
     WHERE t <> va -> 'time' AND (t ->> 'startsAt')::timestamptz > v_now
       AND workhub_private.t2_in((t ->> 'startsAt')::timestamptz, (t ->> 'endsAt')::timestamptz, v_range, v_tz)
    UNION ALL
    SELECT 2, o.starts_at, jsonb_build_object('kind', 'swap', 'lessonId', a.id, 'expectedVersion', a.version, 'otherLessonId', o.id,
             'otherExpectedVersion', o.version, 'reason', i -> 'reason'), o.label
      FROM workhub.timetable_lessons o
     WHERE o.school_id = a.school_id AND o.id <> a.id AND o.state = 'scheduled' AND o.changed_by <> 'school_day' AND o.starts_at > v_now
       AND (va -> 'allowedTargets') @> jsonb_build_array(workhub_private.t2_time(o.starts_at, o.ends_at))
       AND workhub_private.t2_in(o.starts_at, o.ends_at, v_range, v_tz) AND workhub_private.t2_in(a.starts_at, a.ends_at, v_range, v_tz)
       AND workhub_private.t2_targets(o, v_tz) @> jsonb_build_array(va -> 'time')
    ORDER BY 1, 2, 3
  LOOP
    IF n >= 40 THEN v_limited := true; EXIT; END IF;
    n := n + 1;
    BEGIN
      x := workhub_private.t2_exchange_calc(p_ctx, opt.inp, v_now);
    EXCEPTION WHEN raise_exception THEN
      IF workhub_private.p7_business(SQLERRM) THEN CONTINUE; END IF;
      RAISE;
    END;
    IF jsonb_array_length(x -> 'blockers') > 0 THEN CONTINUE; END IF;
    r := workhub_private.t2_preview_row(p_ctx, 'exchange', opt.inp, NULL);
    r.created_at := v_now; r.expires_at := v_now + make_interval(secs => workhub_private.t2_limit('previewLifetimeMs') / 1000.0);
    cand := workhub_private.t2_exchange_store(p_ctx, opt.inp, x, r);
    v_label := to_char((x #>> '{changes,0,after,time,startsAt}')::timestamptz AT TIME ZONE v_tz, 'MM/DD HH24:MI');
    v_cands := v_cands || jsonb_build_array(jsonb_build_object('id', 'c' || (jsonb_array_length(v_cands) + 1), 'input', opt.inp, 'preview', cand,
      'explanation', CASE WHEN opt.ord = 1 THEN format('같은 주의 빈 시간(%s)으로 옮깁니다.', v_label)
                          ELSE format('%s 수업과 시간을 맞바꿉니다(%s).', workhub_private.t1_label(opt.other_label, 200, '다른'), v_label) END));
    IF jsonb_array_length(v_cands) >= workhub_private.t2_limit('recommendations') THEN EXIT; END IF;
  END LOOP;
  RETURN jsonb_build_object('input', i, 'sourceAsOf', p_as_of,
    'coverage', jsonb_build_object('from', i -> 'from', 'until', i -> 'until', 'complete', true),
    'status', CASE WHEN jsonb_array_length(v_cands) > 0 THEN 'candidates' WHEN v_limited THEN 'search_limited' ELSE 'none_found' END,
    'explanations', CASE WHEN jsonb_array_length(v_cands) > 0 THEN jsonb_build_array('같은 주 안에서 이 수업이 들어갈 수 있는 공식 시간대만 찾았습니다. 제출 전 관련 교사 동의와 승인이 필요합니다.')
                         WHEN v_limited THEN jsonb_build_array('살펴본 시간대 40개 안에서는 막히지 않는 후보를 찾지 못했습니다. 직접 시간을 골라 확인해 주세요.')
                         ELSE jsonb_build_array('같은 주 안에서 겹치지 않고 옮기거나 맞바꿀 수 있는 시간을 찾지 못했습니다.') END,
    'candidates', v_cands);
END $$;

-- ----------------------------------------------------------------------------
-- 3. 알림(T2-02 가 적용되고 메시지가 준비된 학교만). 같은 (받는 사람, 요청, 판, 사건)은 한 번만.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_notify(r workhub.timetable_exchange_requests, p_members text[], p_event text, p_title text, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m text;
BEGIN
  IF NOT workhub_private.t2_installed('T2-02') OR workhub_private.p3_messaging_reason(r.school_id) <> 'ready' THEN RETURN; END IF;
  FOREACH m IN ARRAY COALESCE(p_members, ARRAY[]::text[]) LOOP
    PERFORM workhub_private.p3_notify(r.school_id, m, p_title, p_body, 'timetable', r.id, 't2:ex:' || r.id || ':' || r.version || ':' || p_event);
  END LOOP;
END $$;
-- 알림 본문: 누가 · 어떤 수업 · 언제(학교 시간)
CREATE FUNCTION workhub_private.t2_req_summary(r workhub.timetable_exchange_requests, p_tz text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT format('%s 선생님의 %s 요청 — %s', r.requester_name, CASE r.kind WHEN 'move' THEN '수업 이동' ELSE '수업 교환' END,
    (SELECT string_agg(format('%s %s → %s', c #>> '{before,label}', to_char((c #>> '{before,time,startsAt}')::timestamptz AT TIME ZONE p_tz, 'MM/DD HH24:MI'),
                              to_char((c #>> '{after,time,startsAt}')::timestamptz AT TIME ZONE p_tz, 'MM/DD HH24:MI')), ', ' ORDER BY o)
       FROM jsonb_array_elements(r.changes) WITH ORDINALITY z(c, o)))
$$;
-- 승인 요청 받을 사람: 승인 담당 중 요청자와 다른 계정
CREATE FUNCTION workhub_private.t2_approver_ids(r workhub.timetable_exchange_requests, p_today date) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(membership_id ORDER BY membership_id), ARRAY[]::text[]) FROM workhub_private.t2_approvers(r.school_id, p_today)
   WHERE account_id <> r.requester_account_id
$$;

-- ----------------------------------------------------------------------------
-- 4. 제출(submit) — 같은 미리보기 ID · 시각으로 다시 계산해 지문이 같아야 요청을 만든다
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_submit(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p workhub.timetable_previews; x jsonb; v_at timestamptz; rq workhub.timetable_exchange_requests; v_changes jsonb; v_all text[]; v_tz text := p_ctx.school_timezone;
BEGIN
  PERFORM workhub_private.t2_exchange_input(c #> '{preview,input}');
  SELECT * INTO p FROM workhub.timetable_previews WHERE id = c #>> '{preview,previewId}' AND school_id = p_ctx.school_id
     AND membership_id = p_ctx.membership_id AND account_id = p_ctx.account_id AND kind = 'exchange';
  IF p.id IS NULL OR p.preview_hash <> c #>> '{preview,previewHash}' OR to_jsonb(workhub_private.t2_ts(p.expires_at)) <> c #> '{preview,expiresAt}'
     OR p.input <> c #> '{preview,input}' THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF p.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  x := workhub_private.t2_exchange_calc(p_ctx, p.input, p.created_at);
  IF workhub_private.p2_sha(workhub_private.t2_exchange_body(p.input, x)) <> p.preview_hash THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF jsonb_array_length(x -> 'blockers') > 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_at := workhub_private.t2_now();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(x -> 'changes') ch WHERE (ch #>> '{before,time,startsAt}')::timestamptz <= v_at
                                                                     OR (ch #>> '{after,time,startsAt}')::timestamptz <= v_at)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(x -> 'changes') ch WHERE workhub_private.t2_lesson_busy(p_ctx.school_id, ch #>> '{after,id}', v_at)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 요청에 고정하는 값: 요청 버튼은 끈다(전후 같은 값). 동의는 이 값의 지문(proposalHash)에 묶인다.
  v_changes := (SELECT jsonb_agg(jsonb_build_object('before', ch -> 'before' || '{"canRequest":false}'::jsonb,
                                                    'after', ch -> 'after' || '{"canRequest":false}'::jsonb) ORDER BY o)
                  FROM jsonb_array_elements(x -> 'changes') WITH ORDINALITY z(ch, o));
  v_all := ARRAY(SELECT t ->> 'id' FROM jsonb_array_elements(x -> 'participants') t);
  rq.id := gen_random_uuid()::text; rq.school_id := p_ctx.school_id; rq.kind := p.input ->> 'kind';
  rq.requester_membership_id := p_ctx.membership_id; rq.requester_account_id := p_ctx.account_id;
  rq.requester_name := (SELECT t ->> 'name' FROM jsonb_array_elements(x -> 'participants') t WHERE t ->> 'id' = p_ctx.membership_id);
  rq.reason := p.input ->> 'reason'; rq.changes := v_changes;
  rq.proposal_hash := workhub_private.p2_sha(jsonb_build_object('kind', rq.kind, 'reason', rq.reason, 'changes', v_changes));
  SELECT min(workhub_private.t2_day(t, v_tz)), max(workhub_private.t2_day(t, v_tz)), min(t) INTO rq.first_day, rq.last_day, rq.expires_at
    FROM (SELECT (ch #>> '{before,time,startsAt}')::timestamptz AS t FROM jsonb_array_elements(v_changes) ch
          UNION ALL SELECT (ch #>> '{after,time,startsAt}')::timestamptz FROM jsonb_array_elements(v_changes) ch) z;
  rq.state := CASE WHEN v_all <@ ARRAY[p_ctx.membership_id] THEN 'awaiting_approval' ELSE 'awaiting_consent' END;
  rq.version := 1; rq.preview_id := p.id; rq.created_at := v_at; rq.updated_at := v_at;
  INSERT INTO workhub.timetable_exchange_requests SELECT rq.*;
  INSERT INTO workhub.timetable_exchange_lessons (school_id, request_id, lesson_id, before_version)
  SELECT p_ctx.school_id, rq.id, ch #>> '{before,id}', (ch #>> '{before,version}')::integer FROM jsonb_array_elements(v_changes) ch;
  INSERT INTO workhub.timetable_exchange_participants (school_id, request_id, membership_id, name, response, responded_at)
  SELECT p_ctx.school_id, rq.id, t ->> 'id', t ->> 'name', CASE WHEN t ->> 'id' = p_ctx.membership_id THEN 'accepted' ELSE 'pending' END,
         CASE WHEN t ->> 'id' = p_ctx.membership_id THEN v_at END
    FROM jsonb_array_elements(x -> 'participants') t;
  IF rq.state = 'awaiting_consent' THEN
    PERFORM workhub_private.t2_notify(rq, array_remove(v_all, p_ctx.membership_id), 'consent', '시간표 변경 동의 요청',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 동의 또는 거절해 주세요.');
  ELSE
    PERFORM workhub_private.t2_notify(rq, workhub_private.t2_approver_ids(rq, p_ctx.school_today), 'approval', '시간표 변경 승인 요청',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 승인 또는 반려해 주세요.');
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.exchange_submit', 'timetable_exchange_request', rq.id, 1, 'school', p_key,
    jsonb_build_object('kind', rq.kind, 'lessons', (SELECT jsonb_agg(ch #>> '{before,id}') FROM jsonb_array_elements(v_changes) ch), 'state', rq.state));
  RETURN jsonb_build_object('requestKey', p_key, 'commandHash', p_hash, 'kind', 'submit', 'entityId', rq.id, 'version', 1, 'status', rq.state,
                            'recordedAt', workhub_private.t2_ts(v_at), 'changedLessons', '[]'::jsonb);
END $$;

-- ----------------------------------------------------------------------------
-- 5. 응답(action) — accept · reject(관련 교사) · withdraw(요청자) · approve · rejectApproval(승인 담당, 요청자와 다른 계정)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_action(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rq workhub.timetable_exchange_requests; v_at timestamptz; v_act text := c ->> 'action'; v_status text; v_changed jsonb := '[]'::jsonb; v_c text[];
        v_tz text := p_ctx.school_timezone; v_others text[];
BEGIN
  IF NOT workhub_private.p2_exact(c, ARRAY['kind','requestId','expectedVersion','proposalHash','action']) OR NOT workhub_private.p7_id(c -> 'requestId')
     OR NOT workhub_private.p7_pos(c -> 'expectedVersion') OR NOT workhub_private.p5_hash(c -> 'proposalHash') OR jsonb_typeof(c -> 'action') <> 'string'
     OR v_act NOT IN ('accept','reject','withdraw','approve','rejectApproval') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  SELECT * INTO rq FROM workhub.timetable_exchange_requests WHERE school_id = p_ctx.school_id AND id = c ->> 'requestId' FOR UPDATE;
  IF rq.id IS NULL OR NOT workhub_private.t2_req_visible(rq, p_ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF to_jsonb(rq.version) <> c -> 'expectedVersion' OR rq.proposal_hash <> c ->> 'proposalHash' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_at := workhub_private.t2_now();
  -- 끝났거나 · 기한이 지났거나 · 수업 판이 바뀐 요청은 응답할 수 없다
  IF rq.state NOT IN ('awaiting_consent','awaiting_approval') OR rq.expires_at <= v_at OR workhub_private.t2_req_stale(rq.id) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_others := ARRAY(SELECT membership_id FROM workhub.timetable_exchange_participants WHERE request_id = rq.id AND membership_id <> rq.requester_membership_id
                     ORDER BY membership_id);
  IF v_act IN ('accept','reject') THEN
    IF rq.state <> 'awaiting_consent' OR NOT EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants
                                                     WHERE request_id = rq.id AND membership_id = p_ctx.membership_id AND response = 'pending') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    UPDATE workhub.timetable_exchange_participants SET response = CASE WHEN v_act = 'accept' THEN 'accepted' ELSE 'rejected' END, responded_at = v_at
     WHERE request_id = rq.id AND membership_id = p_ctx.membership_id;
    IF v_act = 'reject' THEN v_status := 'rejected';
    ELSIF NOT EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants WHERE request_id = rq.id AND response <> 'accepted') THEN v_status := 'awaiting_approval';
    ELSE v_status := 'awaiting_consent'; END IF;
  ELSIF v_act = 'withdraw' THEN
    IF rq.requester_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    v_status := 'withdrawn';
  ELSE
    IF rq.state <> 'awaiting_approval' OR NOT workhub_private.p5_manager(p_ctx) OR rq.requester_account_id = p_ctx.account_id
       OR EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants WHERE request_id = rq.id AND response <> 'accepted') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_act = 'rejectApproval' THEN
      v_status := 'rejected';
    ELSE
      -- 반영 직전 다시 확인: 시작 전 · 자원 겹침 · 불가 조건 · 휴업일
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(rq.changes) ch WHERE (ch #>> '{before,time,startsAt}')::timestamptz <= v_at
                                                                     OR (ch #>> '{after,time,startsAt}')::timestamptz <= v_at) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      v_c := workhub_private.t2_conflicts(p_ctx.school_id, (
        SELECT jsonb_agg(jsonb_build_object('id', l.id, 's', ch #>> '{after,time,startsAt}', 'e', ch #>> '{after,time,endsAt}', 'uses', l.uses))
          FROM jsonb_array_elements(rq.changes) ch JOIN workhub.timetable_lessons l ON l.school_id = rq.school_id AND l.id = ch #>> '{after,id}'), ARRAY[]::text[]);
      IF cardinality(v_c) > 0 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(rq.changes) ch JOIN workhub.timetable_lessons l ON l.school_id = rq.school_id AND l.id = ch #>> '{after,id}'
            WHERE workhub_private.t2_unavailable(l.publication_id, l.uses, (ch #>> '{after,time,startsAt}')::timestamptz, (ch #>> '{after,time,endsAt}')::timestamptz, v_tz)
               OR jsonb_array_length(workhub_private.t2_closed_days(rq.school_id, workhub_private.t2_day((ch #>> '{after,time,startsAt}')::timestamptz, v_tz),
                                                                    workhub_private.t2_day((ch #>> '{after,time,startsAt}')::timestamptz, v_tz) + 1)) > 0) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      UPDATE workhub.timetable_lessons l SET starts_at = (ch #>> '{after,time,startsAt}')::timestamptz, ends_at = (ch #>> '{after,time,endsAt}')::timestamptz,
             version = (ch #>> '{after,version}')::integer, pinned = true, changed_by = 'exchange', changed_at = v_at
        FROM jsonb_array_elements(rq.changes) ch WHERE l.school_id = rq.school_id AND l.id = ch #>> '{after,id}';
      INSERT INTO workhub.timetable_lesson_versions (school_id, lesson_id, version, change_kind, source_id, snapshot)
      SELECT l.school_id, l.id, l.version, 'exchange', rq.id, to_jsonb(l) - 'school_id'
        FROM workhub.timetable_lessons l JOIN jsonb_array_elements(rq.changes) ch ON ch #>> '{after,id}' = l.id WHERE l.school_id = rq.school_id;
      v_changed := (SELECT jsonb_agg(jsonb_build_object('id', ch #>> '{after,id}', 'version', ch #> '{after,version}') ORDER BY o)
                      FROM jsonb_array_elements(rq.changes) WITH ORDINALITY z(ch, o));
      v_status := 'applied';
    END IF;
  END IF;
  UPDATE workhub.timetable_exchange_requests SET state = v_status, version = version + 1, updated_at = v_at,
         decided_by_membership_id = CASE WHEN v_act IN ('approve','rejectApproval') THEN p_ctx.membership_id ELSE decided_by_membership_id END
   WHERE id = rq.id RETURNING * INTO rq;
  -- 알림(같은 트랜잭션)
  IF v_act = 'accept' AND v_status = 'awaiting_approval' THEN
    PERFORM workhub_private.t2_notify(rq, workhub_private.t2_approver_ids(rq, p_ctx.school_today), 'approval', '시간표 변경 승인 요청',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 관련 교사가 모두 동의했습니다. 승인 또는 반려해 주세요.');
  ELSIF v_status = 'rejected' THEN
    PERFORM workhub_private.t2_notify(rq, ARRAY[rq.requester_membership_id], 'rejected', '시간표 변경 요청이 거절되었습니다',
                                      workhub_private.t2_req_summary(rq, v_tz) || CASE WHEN v_act = 'reject' THEN '. 관련 교사가 거절했습니다.' ELSE '. 승인 담당이 반려했습니다.' END);
  ELSIF v_status = 'withdrawn' THEN
    PERFORM workhub_private.t2_notify(rq, v_others, 'withdrawn', '시간표 변경 요청이 철회되었습니다', workhub_private.t2_req_summary(rq, v_tz) || '. 요청한 선생님이 철회했습니다.');
  ELSIF v_status = 'applied' THEN
    PERFORM workhub_private.t2_notify(rq, ARRAY[rq.requester_membership_id] || v_others, 'applied', '시간표 변경이 반영되었습니다',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 공개 시간표에 반영했습니다.');
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.exchange_' || lower(v_act), 'timetable_exchange_request', rq.id, rq.version, 'school', p_key,
    jsonb_build_object('state', v_status));
  RETURN jsonb_build_object('requestKey', p_key, 'commandHash', p_hash, 'kind', 'action', 'entityId', rq.id, 'version', rq.version, 'status', v_status,
                            'recordedAt', workhub_private.t2_ts(v_at), 'changedLessons', v_changed);
END $$;

-- ----------------------------------------------------------------------------
-- 6. 공개 함수(이 파일 2개)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_timetable_operations_exchange_preview(p_member_id text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.v1', 'exchange_preview', jsonb_build_object('input', p_input));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_recommend(p_member_id text, p_input jsonb, p_source_as_of text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.next.v1', 'recommend', jsonb_build_object('input', p_input, 'asOf', p_source_as_of));
END $$;
COMMENT ON FUNCTION public.workhub_timetable_operations_exchange_preview(text, jsonb) IS '업무실 T2 시간표 운영: 내 수업 이동 · 교환 미리보기(관련 교사 · 차단 사유, 15분).';
COMMENT ON FUNCTION public.workhub_timetable_operations_recommend(text, jsonb, text) IS '업무실 T2 시간표 운영: 막히지 않는 이동 · 교환 후보 3개까지(바로 제출할 수 있는 미리보기 포함).';

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND p.proname LIKE 't2\_%')
               OR (n.nspname = 'public' AND p.proname IN ('workhub_timetable_operations_exchange_preview','workhub_timetable_operations_recommend')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_timetable_operations_exchange_preview(text, jsonb), public.workhub_timetable_operations_recommend(text, jsonb, text) TO authenticated;
END $$;

INSERT INTO workhub_private.t2_installs (batch, release) VALUES ('T2-04', '2026-10-20.1');
COMMIT;

SELECT 'T2-04-1' AS no, '공개 함수 2개 authenticated 만' AS item,
       CASE WHEN (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                   AND p.proname IN ('workhub_timetable_operations_exchange_preview','workhub_timetable_operations_recommend')
                   AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) = 2 THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T2-04-2', '내부 함수 t2_* API 역할 실행 불가',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't2\_%'
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T2-04-3', '적용 기록 T2-04', CASE WHEN workhub_private.t2_installed('T2-04') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
