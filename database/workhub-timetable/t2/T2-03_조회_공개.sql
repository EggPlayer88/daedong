-- ============================================================================
-- T2-03  시간표 2단계 — 공통 · 조회 · 공개(확정) (비활성 설치)
--
-- ▣ 공개 함수(authenticated 만, 첫 인자 p_member_id). 봉투 {contract, schoolId, memberId, data | error:{code}}
--     timetable-operations.v1       workhub_timetable_operations_readiness · _get · _publish_preview · _execute(publish · submit · action)
--     timetable-operations.next.v1  workhub_timetable_operations_references · _publish_manifest · _publish_page
--     timetable-publication.v1      workhub_timetable_publication_execute
--   교환 미리보기 · 추천(T2-04), 학사 변경(T2-05), 실시 기록(T2-06)은 뒤 파일. _execute 의 submit · action 은 T2-04 함수를 부른다.
-- ▣ 켜는 조건: T2-01 · 03 · 04 · 05 · 06 이 모두 적용 + 시간표(T1, timetable) 준비 + 모듈 timetable_operations 켜짐(T2-08).
--   그 전에는 readiness = not_installed, 나머지는 NOT_READY(요청 원장 복구 조회만 예외 — 원장을 먼저 읽는다).
-- ▣ 권한: 조회 = 학교의 모든 활성 소속(교사 공개). 공개(확정) · 학사 변경 = year.manage(T1 과 같은 기준). 새 권한을 만들지 않는다.
-- ▣ 전제: T2-01(2026-10-20.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t2_installs') IS NULL THEN RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-01' AND release = '2026-10-20.1') THEN
    RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-03') THEN RAISE EXCEPTION 'T2 중단: T2-03 이 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND (proname LIKE 'workhub\_timetable\_operations\_%' OR proname LIKE 'workhub\_timetable\_publication\_%')) THEN
    RAISE EXCEPTION 'T2 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 공통 — 준비 상태 · 시각 · 요청 원장
-- ----------------------------------------------------------------------------
-- 알림 출처(T2-02)는 따로 승인하므로 준비 조건에 넣지 않는다(없으면 알림만 보내지 않는다).
CREATE FUNCTION workhub_private.t2_installed_all() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM workhub_private.t2_installs WHERE batch IN ('T2-01','T2-03','T2-04','T2-05','T2-06') AND release = '2026-10-20.1') = 5
$$;
CREATE FUNCTION workhub_private.t2_ready(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.t2_installed_all() AND workhub_private.t1_ready(p_school) AND workhub_private.p2_module_active(p_school, 'timetable_operations')
$$;
-- 응답 시각은 밀리초까지(앱 timestamp). 수업 시각은 정수 초.
CREATE FUNCTION workhub_private.t2_now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT date_trunc('milliseconds', clock_timestamp())
$$;

-- 요청 번호 하나의 원장 행을 잠그고 읽는다. 같은 (학교, 소속, 종류, 요청 번호)는 트랜잭션 끝까지 한 줄로 선다.
CREATE FUNCTION workhub_private.t2_req_row(p_ctx workhub_private.actor_context, p_op text, p_key text, p_hash text) RETURNS workhub.timetable_operation_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_operation_requests;
BEGIN
  IF NOT workhub_private.p7_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('t2req' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.membership_id || chr(31) || p_op
                                                 || chr(31) || p_key, 0));
  SELECT * INTO r FROM workhub.timetable_operation_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND op = p_op AND request_key = p_key;
  IF r.request_key IS NOT NULL AND (r.command_hash <> p_hash OR r.account_id <> p_ctx.account_id) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN r;
END $$;
-- 이미 반영된 요청이면 그 접수증을 그대로 돌려준다(내용이 다르면 IDEMPOTENCY_CONFLICT). 사용자가 포기한 번호면 CONFLICT —
--   늦게 도착한 최초 요청 · 재전송 · 복구 조회 모두 반영하지 않는다. 준비 상태 · 권한 · 미리보기 만료보다 먼저 본다(handoff 조건 1 · 2 · 6).
CREATE FUNCTION workhub_private.t2_claim(p_ctx workhub_private.actor_context, p_op text, p_key text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_operation_requests := workhub_private.t2_req_row(p_ctx, p_op, p_key, p_hash);
BEGIN
  IF r.request_key IS NULL THEN RETURN NULL; END IF;
  IF r.outcome = 'abandoned' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN r.response;
END $$;
-- 요청 번호 포기(취소 기록). 결과를 모르는 요청(응답 유실 → 복구 NOT_FOUND → 재전송도 거절)에서 화면이 안전하게 빠져나오는 길.
--   같은 번호 잠금 안에서: 이미 반영됐으면 그 접수증(outcome applied — 포기하지 않음), 아니면 취소 기록을 남긴다(outcome abandoned).
--   취소 기록 뒤에는 그 번호로 무엇이 와도 반영하지 않으므로, 앱은 새 번호로 새 명령을 만들어도 두 번 반영되지 않는다.
--   준비 상태 · 권한을 보지 않는다(복구 조회와 같다 — 모듈을 꺼도 빠져나올 수 있어야 함). 명령은 원래 보낸 그대로(지문 대조).
CREATE FUNCTION workhub_private.t2_abandon(p_ctx workhub_private.actor_context, p_kind text, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_operation_requests; v_hash text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('operations','publication','school_day','execution') OR c IS NULL OR jsonb_typeof(c) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_hash := workhub_private.p2_sha(c);
  r := workhub_private.t2_req_row(p_ctx, p_kind, p_key, v_hash);
  IF r.request_key IS NULL THEN
    INSERT INTO workhub.timetable_operation_requests (school_id, membership_id, account_id, op, request_key, command_hash, outcome, response, recorded_at)
    VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_kind, p_key, v_hash, 'abandoned', '{}'::jsonb, workhub_private.t2_now())
    RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('kind', p_kind, 'requestKey', p_key, 'commandHash', v_hash, 'outcome', r.outcome,
                            'receipt', CASE WHEN r.outcome = 'applied' THEN r.response END, 'decidedAt', workhub_private.t2_ts(r.recorded_at));
END $$;
CREATE FUNCTION workhub_private.t2_record(p_ctx workhub_private.actor_context, p_op text, p_key text, p_hash text, p_response jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.timetable_operation_requests (school_id, membership_id, account_id, op, request_key, command_hash, response)
  VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_op, p_key, p_hash, p_response)
$$;

-- 날짜 범위(앱 range: YYYY-MM-DD, 1 ~ p_max 일). 아니면 INVALID_INPUT.
CREATE FUNCTION workhub_private.t2_range(p_from text, p_until text, p_max integer) RETURNS daterange
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE f date := workhub_private.t2_parse_date(to_jsonb(p_from)); u date := workhub_private.t2_parse_date(to_jsonb(p_until));
BEGIN
  IF f IS NULL OR u IS NULL OR u - f < 1 OR u - f > p_max THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN daterange(f, u, '[)');
END $$;
-- 수업이 날짜 범위 안인가(앱: 시작한 날 >= from, 끝나기 1ms 전 날 < until)
CREATE FUNCTION workhub_private.t2_in(p_s timestamptz, p_e timestamptz, p_range daterange, p_tz text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.t2_day(p_s, p_tz) >= lower(p_range) AND workhub_private.t2_day(p_e - interval '1 millisecond', p_tz) < upper(p_range)
$$;

-- 보는 사람에게 맞춘 수업(앱 OperationLesson). 요청 가능 = 예정 · 학사 변경으로 옮긴 수업이 아님 · 이 소속이 담당 · 아직 시작 전 · 진행 중 요청 없음.
--   학사 변경으로 바뀐 수업과 취소 수업은 옮길 시각이 없다(학사 변경 미리보기의 after 와 같은 값).
CREATE FUNCTION workhub_private.t2_vlesson(l workhub.timetable_lessons, p_ctx workhub_private.actor_context, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.t2_lesson(l,
    l.state = 'scheduled' AND l.changed_by <> 'school_day' AND p_ctx.membership_id = ANY (l.teacher_ids) AND l.starts_at > p_at
      AND NOT workhub_private.t2_lesson_busy(l.school_id, l.id, p_at),
    CASE WHEN l.state = 'scheduled' AND l.changed_by <> 'school_day' THEN workhub_private.t2_targets(l, p_ctx.school_timezone) ELSE '[]'::jsonb END)
$$;

-- 교환 요청 → 앱 ExchangeRequestView. 화면 상태: 기한 지남 = expired, 묶은 수업 판이 바뀜 = stale(진행 중 요청만).
CREATE FUNCTION workhub_private.t2_req_view(r workhub.timetable_exchange_requests, p_ctx workhub_private.actor_context, p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text; v_parts jsonb; v_all boolean; v_viewer boolean := r.requester_account_id = p_ctx.account_id; v_actions jsonb := '[]'::jsonb;
BEGIN
  v_state := CASE WHEN r.state NOT IN ('awaiting_consent','awaiting_approval') THEN r.state WHEN r.expires_at <= p_at THEN 'expired'
                  WHEN workhub_private.t2_req_stale(r.id) THEN 'stale' ELSE r.state END;
  SELECT jsonb_agg(jsonb_build_object('id', p.membership_id, 'name', p.name, 'response', p.response,
                                      'respondedAt', CASE WHEN p.responded_at IS NULL THEN 'null'::jsonb ELSE to_jsonb(workhub_private.t2_ts(p.responded_at)) END)
                   ORDER BY p.membership_id), bool_and(p.response = 'accepted')
    INTO v_parts, v_all FROM workhub.timetable_exchange_participants p WHERE p.request_id = r.id;
  IF v_state = 'awaiting_consent' AND EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants p
                                              WHERE p.request_id = r.id AND p.membership_id = p_ctx.membership_id AND p.response = 'pending') THEN
    v_actions := v_actions || '["accept","reject"]'::jsonb;
  END IF;
  IF v_state IN ('awaiting_consent','awaiting_approval') AND v_viewer THEN v_actions := v_actions || '["withdraw"]'::jsonb; END IF;
  IF v_state = 'awaiting_approval' AND v_all AND NOT v_viewer AND workhub_private.p5_manager(p_ctx) THEN
    v_actions := v_actions || '["approve","rejectApproval"]'::jsonb;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'version', r.version, 'proposalHash', r.proposal_hash, 'state', v_state, 'kind', r.kind,
    'requester', jsonb_build_object('id', r.requester_membership_id, 'name', r.requester_name), 'requesterIsViewer', v_viewer,
    'createdAt', workhub_private.t2_ts(r.created_at), 'expiresAt', workhub_private.t2_ts(r.expires_at), 'reason', r.reason,
    'changes', r.changes, 'participants', COALESCE(v_parts, '[]'::jsonb), 'actions', v_actions);
END $$;

-- 이 소속이 볼 수 있는 요청인가(요청자 계정 · 참여 교사 · 승인 담당)
CREATE FUNCTION workhub_private.t2_req_visible(r workhub.timetable_exchange_requests, p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.school_id = p_ctx.school_id AND (r.requester_account_id = p_ctx.account_id
    OR EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants p WHERE p.request_id = r.id AND p.membership_id = p_ctx.membership_id)
    OR workhub_private.p5_manager(p_ctx))
$$;

-- 조회 시각(asOf) 뒤에 범위 안의 수업 · 요청이 바뀌지 않았는가(학급 참조 · 추천 · 학사 변경이 화면이 본 값 그대로 계산하는지)
CREATE FUNCTION workhub_private.t2_unchanged(p_school text, p_as_of timestamptz, p_range daterange, p_tz text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM workhub.timetable_lessons l
                      WHERE l.school_id = p_school AND greatest(l.changed_at, l.created_at) > p_as_of
                        AND ((l.starts_at >= (lower(p_range)::timestamp AT TIME ZONE p_tz) - interval '1 day'
                              AND l.starts_at < (upper(p_range)::timestamp AT TIME ZONE p_tz) + interval '1 day')
                             OR l.occurrence_date BETWEEN lower(p_range) - 7 AND upper(p_range) + 7))
     AND NOT EXISTS (SELECT 1 FROM workhub.timetable_exchange_requests r
                      WHERE r.school_id = p_school AND r.updated_at > p_as_of AND r.first_day < upper(p_range) + 7 AND r.last_day >= lower(p_range) - 7)
$$;

-- ----------------------------------------------------------------------------
-- 2. 조회 — readiness · get · references
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_readiness(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RETURN jsonb_build_object('available', false, 'reason', 'not_installed'); END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub.timetable_publications WHERE school_id = p_ctx.school_id)
     AND NOT (workhub_private.p5_manager(p_ctx) AND EXISTS (SELECT 1 FROM workhub.terms t WHERE t.school_id = p_ctx.school_id AND t.state <> 'closed'
                                                             AND t.ends_on > p_ctx.school_today AND t.current_timetable_basis_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'basis_missing');
  END IF;
  RETURN jsonb_build_object('available', true);
END $$;

CREATE FUNCTION workhub_private.t2_get(p_ctx workhub_private.actor_context, p_from text, p_until text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_range daterange; v_at timestamptz := date_trunc('milliseconds', clock_timestamp()); v_tz text := p_ctx.school_timezone;
        v_mgr boolean; v_lessons jsonb; v_reqs jsonb; n integer;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_range := workhub_private.t2_range(p_from, p_until, workhub_private.t2_limit('listDays'));
  v_mgr := workhub_private.p5_manager(p_ctx);
  -- 잘라서 보내지 않는다: 한도를 넘으면 QUERY_FAILED(앱이 기간을 줄여 다시 묻는다)
  SELECT count(*), jsonb_agg(workhub_private.t2_vlesson(l, p_ctx, v_at) ORDER BY l.starts_at, l.id) INTO n, v_lessons
    FROM workhub.timetable_lessons l
   WHERE l.school_id = p_ctx.school_id
     AND l.starts_at >= (lower(v_range)::timestamp AT TIME ZONE v_tz) - interval '1 day' AND l.starts_at < (upper(v_range)::timestamp AT TIME ZONE v_tz)
     AND workhub_private.t2_in(l.starts_at, l.ends_at, v_range, v_tz);
  IF n > workhub_private.t2_limit('lessons') THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  SELECT count(*), jsonb_agg(workhub_private.t2_req_view(r, p_ctx, v_at) ORDER BY r.created_at DESC, r.id) INTO n, v_reqs
    FROM workhub.timetable_exchange_requests r
   WHERE r.school_id = p_ctx.school_id AND r.first_day < upper(v_range) AND r.last_day >= lower(v_range) AND r.created_at <= v_at
     AND workhub_private.t2_req_visible(r, p_ctx);
  IF n > workhub_private.t2_limit('requests') THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  RETURN jsonb_build_object('asOf', workhub_private.t2_ts(v_at), 'timeZone', v_tz, 'from', p_from, 'until', p_until,
    'canPublish', v_mgr, 'canRequest', true,
    'drafts', CASE WHEN NOT v_mgr THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'version', 1, 'title', x.title) ORDER BY x.created_at DESC, x.id)
        FROM (SELECT d.* FROM workhub.timetable_drafts d JOIN workhub.terms t ON t.school_id = d.school_id AND t.id = d.term_id
               WHERE d.school_id = p_ctx.school_id AND t.state <> 'closed' AND t.ends_on > p_ctx.school_today AND d.basis_id = t.current_timetable_basis_id
               ORDER BY d.created_at DESC, d.id LIMIT workhub_private.t2_limit('drafts')) x), '[]'::jsonb) END,
    'lessons', COALESCE(v_lessons, '[]'::jsonb), 'requests', COALESCE(v_reqs, '[]'::jsonb),
    'publications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'version', 1, 'title', x.title, 'from', to_char(x.from_date, 'YYYY-MM-DD'),
                                          'until', to_char(x.until_date, 'YYYY-MM-DD'), 'publishedAt', workhub_private.t2_ts(x.published_at))
                       ORDER BY x.published_at DESC, x.id)
        FROM (SELECT * FROM workhub.timetable_publications p WHERE p.school_id = p_ctx.school_id AND p.from_date < upper(v_range)
                AND p.until_date > lower(v_range) AND p.published_at <= v_at
               ORDER BY p.published_at DESC, p.id LIMIT workhub_private.t2_limit('publications')) x), '[]'::jsonb));
END $$;

-- 학급 · 공간 참조(next.v1 references): 화면이 본 수업(asOf · 기간 그대로)마다 학급 · 수강집단 · 공간의 ID 와 이름
CREATE FUNCTION workhub_private.t2_references(p_ctx workhub_private.actor_context, p_as_of text, p_from text, p_until text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_range daterange; v_at timestamptz := workhub_private.t2_parse_ts(to_jsonb(p_as_of), false); v_tz text := p_ctx.school_timezone; n integer; v jsonb;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_range := workhub_private.t2_range(p_from, p_until, workhub_private.t2_limit('listDays'));
  IF v_at IS NULL OR v_at > clock_timestamp() + interval '30 seconds' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.t2_unchanged(p_ctx.school_id, v_at, v_range, v_tz) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT count(*), jsonb_agg(jsonb_build_object('lessonId', l.id, 'version', l.version, 'groups', l.groups, 'rooms', l.rooms) ORDER BY l.starts_at, l.id)
    INTO n, v
    FROM workhub.timetable_lessons l
   WHERE l.school_id = p_ctx.school_id
     AND l.starts_at >= (lower(v_range)::timestamp AT TIME ZONE v_tz) - interval '1 day' AND l.starts_at < (upper(v_range)::timestamp AT TIME ZONE v_tz)
     AND workhub_private.t2_in(l.starts_at, l.ends_at, v_range, v_tz);
  IF n > workhub_private.t2_limit('lessons') THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  RETURN jsonb_build_object('asOf', p_as_of, 'from', p_from, 'until', p_until, 'lessons', COALESCE(v, '[]'::jsonb));
END $$;

-- ----------------------------------------------------------------------------
-- 3. 공개(확정) 계획 — 편성 초안의 주간 배치를 기간의 날짜마다 펼치고, 지금 수업과 맞춰 바뀌는 것만 고른다
-- ----------------------------------------------------------------------------
-- 미리보기 · 확정 명세의 수업(요청 버튼 · 옮길 시각 없음)
CREATE FUNCTION workhub_private.t2_plesson(p_id text, p_version integer, p_label text, p_s timestamptz, p_e timestamptz, p_teachers text[],
                                           p_groups jsonb, p_rooms jsonb, p_state text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_id, 'version', p_version, 'label', p_label, 'time', workhub_private.t2_time(p_s, p_e),
    'teachers', workhub_private.t2_teachers(p_teachers),
    'groupNames', COALESCE((SELECT jsonb_agg(g -> 'name' ORDER BY o) FROM jsonb_array_elements(p_groups) WITH ORDINALITY z(g, o)), '[]'::jsonb),
    'roomNames', COALESCE((SELECT jsonb_agg(g -> 'name' ORDER BY o) FROM jsonb_array_elements(p_rooms) WITH ORDINALITY z(g, o)), '[]'::jsonb),
    'state', p_state, 'canRequest', false, 'allowedTargets', '[]'::jsonb)
$$;

-- 앱 PublishInput {draftId, draftVersion, from, until} — 아니면 INVALID_INPUT
CREATE FUNCTION workhub_private.t2_publish_input(i jsonb) RETURNS daterange
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT workhub_private.p2_exact(i, ARRAY['draftId','draftVersion','from','until']) OR NOT workhub_private.p7_id(i -> 'draftId')
     OR NOT workhub_private.p7_pos(i -> 'draftVersion') OR jsonb_typeof(i -> 'from') <> 'string' OR jsonb_typeof(i -> 'until') <> 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN workhub_private.t2_range(i ->> 'from', i ->> 'until', workhub_private.t2_limit('publishDays'));
END $$;

-- 계획: p_cutoff(미리보기 시각) 이전에 시작하는 수업은 건드리지 않는다(지난 기록 보존). 교환 · 학사 변경으로 옮긴 수업(pinned)은 그대로 둔다.
-- 학사 변경(휴업)으로 취소한 수업도 pinned 로 보고 되살리지 않는다(Codex #73 P1).
-- 새로 만들 수업의 날짜에 휴업 기록이 있으면 그 학교 · 날짜의 모든 휴업 기록 학급을 합쳐 본다(Codex #73 P1 2차):
--   수업의 학급이 전부 휴업이면 만들지 않고, 일부만 휴업이면(합반) PARTIAL_GROUP_SCOPE 로 공개 전체를 막는다.
--   기존 수업을 바꾸는 update 도 바뀐 뒤 학급으로 같은 검사를 한다(Codex #73 P1 3차): 일부만 휴업 → PARTIAL_GROUP_SCOPE,
--   전부 휴업 → SCHOOL_CLOSED 로 막는다(건너뛰면 옛 학급 수업이 남고, 자동 취소는 공개가 학사 변경을 대신하게 되므로 하지 않는다).
--   돌려주는 값: rows(바뀌는 수업 — k new · update · cancel, 앱 change 와 반영용 값), blockers, excludedDays, existingChanges, 고정 값들.
--   미리보기 · 확정 명세 · 확정이 모두 같은 (미리보기 ID, 시각)으로 이 함수를 불러 같은 결과를 얻는다(지문 비교).
CREATE FUNCTION workhub_private.t2_publish_plan(p_ctx workhub_private.actor_context, i jsonb, p_preview text, p_cutoff timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_range daterange := workhub_private.t2_publish_input(i); v_tz text := p_ctx.school_timezone; d workhub.timetable_drafts; t workhub.terms;
        b workhub.timetable_basis_revisions; v_excluded jsonb; v_rows jsonb; v_blockers jsonb := '[]'::jsonb; v_missing integer; v_busy jsonb; v_conf text[];
        v_partial jsonb; v_closed jsonb;
BEGIN
  SELECT * INTO d FROM workhub.timetable_drafts WHERE school_id = p_ctx.school_id AND id = i ->> 'draftId';
  IF d.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF (i -> 'draftVersion') <> '1'::jsonb THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO t FROM workhub.terms WHERE school_id = d.school_id AND id = d.term_id;
  IF t.state = 'closed' OR t.ends_on <= p_ctx.school_today THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 공개 기간은 그 편성 초안의 학기 안이어야 한다(학기 밖 날짜에 이 학기 배치를 펼치지 않는다)
  IF lower(v_range) < t.starts_on OR upper(v_range) > t.ends_on THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO b FROM workhub.timetable_basis_revisions WHERE school_id = d.school_id AND id = d.basis_id;
  v_excluded := workhub_private.t2_closed_days(p_ctx.school_id, lower(v_range), upper(v_range));

  WITH res AS (
    SELECT r ->> 'id' AS id, r ->> 'kind' AS kind, r ->> 'label' AS label, COALESCE((r ->> 'capacity')::integer, 1) AS cap FROM jsonb_array_elements(b.basis -> 'resources') r
  ), bl AS (
    SELECT l ->> 'id' AS act, l ->> 'courseId' AS course, l ->> 'label' AS label,
           ARRAY(SELECT x FROM jsonb_array_elements_text(l -> 'allowedSlotIds') x) AS allowed,
           ARRAY(SELECT rid FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o) JOIN res ON res.id = z.rid AND res.kind = 'teacher' ORDER BY z.o) AS teachers,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', res.id, 'name', res.label) ORDER BY z.o) FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o)
                      JOIN res ON res.id = z.rid AND res.kind IN ('class','student_group')), '[]'::jsonb) AS groups,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', res.id, 'name', res.label) ORDER BY z.o) FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o)
                      JOIN res ON res.id = z.rid AND res.kind = 'room'), '[]'::jsonb) AS rooms,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', res.id, 'kind', res.kind, 'capacity', res.cap) ORDER BY z.o) FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o)
                      JOIN res ON res.id = z.rid), '[]'::jsonb) AS uses
      FROM jsonb_array_elements(b.basis -> 'lessons') l
  ), pl AS (   -- 기간의 날짜마다 펼친 배치(휴업일 제외)
    SELECT bl.*, dd::date AS occ, workhub_private.t2_at(dd::date, (s ->> 'startMinute')::integer, v_tz) AS s, workhub_private.t2_at(dd::date, (s ->> 'endMinute')::integer, v_tz) AS e
      FROM generate_series(lower(v_range)::timestamp, (upper(v_range) - 1)::timestamp, interval '1 day') dd
      CROSS JOIN jsonb_array_elements(d.placements) p
      JOIN bl ON bl.act = p ->> 'lessonId'
      JOIN jsonb_array_elements(b.basis -> 'slots') s ON s ->> 'id' = p ->> 'slotId' AND (s ->> 'day')::integer = extract(isodow FROM dd)::integer
     WHERE NOT (v_excluded @> jsonb_build_array(jsonb_build_object('date', to_char(dd::date, 'YYYY-MM-DD'))))
  ), ex AS (   -- 지금 살아 있는 수업 + 학사 변경으로 취소한 수업(이 학기 · 기간의 원래 날짜)
    -- 학사 변경(휴업)으로 취소한 occurrence 는 pinned 로 남아 재공개에서도 되살리지 않는다. 일반 재공개 취소 이력(changed_by='publish')은
    -- 넣지 않으므로 다시 배치하면 새로 만든다. 한 occurrence 에 행이 여럿이면 살아 있는 행 → 가장 최근 학사 변경 취소 하나만 맞춘다.
    SELECT DISTINCT ON (l.activity_id, l.occurrence_date) l AS r, l.activity_id AS act, l.occurrence_date AS occ FROM workhub.timetable_lessons l
     WHERE l.school_id = d.school_id AND l.term_id = d.term_id AND l.occurrence_date >= lower(v_range) AND l.occurrence_date < upper(v_range)
       AND (l.state <> 'cancelled' OR (l.pinned AND l.changed_by = 'school_day'))
     ORDER BY l.activity_id, l.occurrence_date, (l.state = 'cancelled'), l.changed_at DESC, l.id COLLATE "C"
  ), cl AS (   -- 그 학교 · 날짜의 휴업 학급(휴업 기록 여러 건의 합집합)
    SELECT (c.input ->> 'date')::date AS day, array_agg(DISTINCT g.v) AS gids
      FROM workhub.timetable_school_day_changes c CROSS JOIN jsonb_array_elements_text(c.input -> 'groupIds') g(v)
     WHERE c.school_id = d.school_id AND c.input ->> 'kind' = 'closure'
       AND (c.input ->> 'date')::date >= lower(v_range) AND (c.input ->> 'date')::date < upper(v_range)
     GROUP BY 1
  ), j AS (
    SELECT pl.act AS p_act, pl.course AS p_course, pl.label AS p_label, pl.allowed AS p_allowed, pl.teachers AS p_teachers, pl.groups AS p_groups, pl.rooms AS p_rooms,
           pl.uses AS p_uses, pl.occ AS p_occ, pl.s AS p_s, pl.e AS p_e, ex.r AS e_row,
           (SELECT count(*) FROM jsonb_array_elements(pl.groups) g JOIN cl ON cl.day = pl.occ AND (g ->> 'id') = ANY (cl.gids)) AS p_closed
      FROM pl FULL JOIN ex ON ex.act = pl.act AND ex.occ = pl.occ
  ), k AS (
    SELECT j.*, CASE
        WHEN (e_row).id IS NOT NULL AND (e_row).starts_at <= p_cutoff THEN NULL          -- 이미 시작한 수업: 그대로(지난 기록)
        WHEN p_act IS NOT NULL AND p_s <= p_cutoff THEN NULL                               -- 계획 시각이 이미 지남: 그대로
        WHEN (e_row).id IS NOT NULL AND (e_row).pinned THEN NULL                           -- 교환 · 학사 변경(휴업 취소 포함) 수업: 그대로(retained)
        WHEN (e_row).id IS NULL AND p_act IS NOT NULL AND jsonb_array_length(p_groups) > 0
             AND p_closed = jsonb_array_length(p_groups) THEN NULL                          -- 학급이 전부 휴업인 날: 새로 만들지 않음
        WHEN p_act IS NOT NULL AND cardinality(p_teachers) = 0 THEN 'skip'                 -- 담당 교사 없는 수업: 공개하지 않음(차단)
        WHEN (e_row).id IS NULL THEN 'new'
        WHEN p_act IS NULL THEN 'cancel'
        WHEN (e_row).label = p_label AND (e_row).starts_at = p_s AND (e_row).ends_at = p_e AND (e_row).teacher_ids = p_teachers AND (e_row).groups = p_groups
             AND (e_row).rooms = p_rooms AND (e_row).uses = p_uses AND (e_row).allowed_slot_ids = p_allowed AND (e_row).course_id = p_course THEN NULL
        ELSE 'update' END AS kind
      FROM j
  )
  SELECT (SELECT count(*) FROM k WHERE kind = 'skip'),
         COALESCE(jsonb_agg(CASE kind
           WHEN 'new' THEN jsonb_build_object('k', 'new', 'id', workhub_private.t2_new_id(p_preview, p_act, p_occ), 'version', 1, 'act', p_act, 'course', p_course,
             'occ', p_occ, 'label', p_label, 's', p_s, 'e', p_e, 'teachers', to_jsonb(p_teachers), 'groups', p_groups, 'rooms', p_rooms, 'uses', p_uses,
             'allowed', to_jsonb(p_allowed), 'before', NULL,
             'after', workhub_private.t2_plesson(workhub_private.t2_new_id(p_preview, p_act, p_occ), 1, p_label, p_s, p_e, p_teachers, p_groups, p_rooms, 'scheduled'))
           WHEN 'update' THEN jsonb_build_object('k', 'update', 'id', (e_row).id, 'version', (e_row).version + 1, 'act', p_act, 'course', p_course, 'occ', p_occ,
             'label', p_label, 's', p_s, 'e', p_e, 'teachers', to_jsonb(p_teachers), 'groups', p_groups, 'rooms', p_rooms, 'uses', p_uses, 'allowed', to_jsonb(p_allowed),
             'before', workhub_private.t2_lesson(e_row, false, '[]'::jsonb),
             'after', workhub_private.t2_plesson((e_row).id, (e_row).version + 1, p_label, p_s, p_e, p_teachers, p_groups, p_rooms, 'scheduled'))
           ELSE jsonb_build_object('k', 'cancel', 'id', (e_row).id, 'version', (e_row).version + 1, 's', (e_row).starts_at, 'e', (e_row).ends_at,
             'before', workhub_private.t2_lesson(e_row, false, '[]'::jsonb),
             'after', workhub_private.t2_plesson((e_row).id, (e_row).version + 1, (e_row).label, (e_row).starts_at, (e_row).ends_at, (e_row).teacher_ids,
                                                 (e_row).groups, (e_row).rooms, 'cancelled')) END
           ORDER BY CASE WHEN kind = 'cancel' THEN (e_row).starts_at ELSE p_s END,
                    CASE WHEN kind = 'new' THEN workhub_private.t2_new_id(p_preview, p_act, p_occ) ELSE (e_row).id END)
           FILTER (WHERE kind IN ('new','update','cancel')), '[]'::jsonb),
         jsonb_agg(CASE WHEN kind = 'new' THEN workhub_private.t2_new_id(p_preview, p_act, p_occ) ELSE (e_row).id END
                   ORDER BY CASE WHEN kind = 'new' THEN workhub_private.t2_new_id(p_preview, p_act, p_occ) ELSE (e_row).id END)
           FILTER (WHERE kind IN ('new','update') AND p_closed > 0 AND p_closed < jsonb_array_length(p_groups)),   -- 일부 학급만 휴업(합반)
         jsonb_agg((e_row).id ORDER BY (e_row).id)
           FILTER (WHERE kind = 'update' AND p_closed > 0 AND p_closed = jsonb_array_length(p_groups))             -- 바뀐 뒤 학급이 전부 휴업
    INTO v_missing, v_rows, v_partial, v_closed FROM k;

  -- 차단 사유(앱 blocker: code · message · lessonIds ⊆ 바뀌는 수업)
  IF d.basis_id IS DISTINCT FROM t.current_timetable_basis_id THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'BASIS_OUTDATED',
      'message', '이 편성 초안의 기준판이 학기의 현재 기준판이 아닙니다. 현재 기준판으로 편성 초안을 다시 저장해 주세요.', 'lessonIds', '[]'::jsonb));
  END IF;
  IF v_missing > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'TEACHER_MISSING',
      'message', format('담당 교사가 없는 수업 %s건은 공개할 수 없습니다. 수업 담당을 지정한 뒤 기준판을 다시 확정해 주세요.', v_missing), 'lessonIds', '[]'::jsonb));
  END IF;
  IF v_partial IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PARTIAL_GROUP_SCOPE',
      'message', '휴업한 학급과 수업하는 학급이 섞인 합반 수업이 있습니다. 휴업 범위나 배치를 먼저 정리해 주세요.', 'lessonIds', v_partial));
  END IF;
  IF v_closed IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'SCHOOL_CLOSED',
      'message', '휴업한 학급의 수업으로 바뀌는 수업이 있습니다. 그날 수업은 학사 변경에서 정리하거나 배치를 바꿔 주세요.', 'lessonIds', v_closed));
  END IF;
  SELECT jsonb_agg(x ->> 'id' ORDER BY x ->> 'id') INTO v_busy FROM jsonb_array_elements(v_rows) x
   WHERE x ->> 'k' <> 'new' AND workhub_private.t2_lesson_busy(p_ctx.school_id, x ->> 'id', p_cutoff);
  IF v_busy IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'EXISTING_REQUEST',
      'message', '진행 중인 교환 요청이 걸린 수업이 바뀝니다. 요청을 마무리(승인 · 거절 · 철회)한 뒤 다시 확인해 주세요.', 'lessonIds', v_busy));
  END IF;
  v_conf := workhub_private.t2_conflicts(p_ctx.school_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x ->> 'id', 's', x -> 's', 'e', x -> 'e', 'uses', x -> 'uses')) FROM jsonb_array_elements(v_rows) x
               WHERE x ->> 'k' <> 'cancel'), '[]'::jsonb),
    COALESCE(ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(v_rows) x WHERE x ->> 'k' = 'cancel'), ARRAY[]::text[]));
  IF cardinality(v_conf) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_CONFLICT',
      'message', '같은 시간에 교사 · 학급 · 공간이 겹치는 수업이 있습니다(교환 · 학사 변경으로 옮긴 수업이나 다른 공개 시간표와 겹침).', 'lessonIds', to_jsonb(v_conf)));
  END IF;
  IF jsonb_array_length(v_rows) = 0 AND jsonb_array_length(v_blockers) = 0 THEN
    v_blockers := jsonb_build_array(jsonb_build_object('code', 'NO_CHANGES', 'message', '이 기간에 새로 공개할 변경이 없습니다.', 'lessonIds', '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('rows', v_rows, 'blockers', v_blockers, 'excludedDays', v_excluded,
    'existingChanges', CASE WHEN v_busy IS NULL THEN 'retained' ELSE 'blocked' END,
    'termId', d.term_id, 'basisId', d.basis_id, 'draftId', d.id, 'unavailable', COALESCE(d.conditions -> 'unavailable', '[]'::jsonb),
    'title', d.title, 'from', lower(v_range), 'until', upper(v_range),
    'basisFingerprint', workhub_private.p2_sha(jsonb_build_object('basisId', b.id, 'basisRevision', b.revision, 'sourceFingerprint', b.source_fingerprint, 'draftId', d.id)));
END $$;

-- 계획 → 앱 changes · participants · 미리보기 지문
CREATE FUNCTION workhub_private.t2_plan_changes(p_plan jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('before', x -> 'before', 'after', x -> 'after') ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(p_plan -> 'rows') WITH ORDINALITY z(x, o)
$$;
-- 관련 교사(바뀌는 수업의 전후 교사 합집합, ID 순) — 이름은 수업과 같은 함수(t2_teachers)로
CREATE FUNCTION workhub_private.t2_participants(p_changes jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(t ORDER BY t ->> 'id'), '[]'::jsonb) FROM (
    SELECT DISTINCT ON (t ->> 'id') t FROM jsonb_array_elements(p_changes) c
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c #> '{before,teachers}', '[]'::jsonb) || (c #> '{after,teachers}')) t
     ORDER BY t ->> 'id') z
$$;

CREATE FUNCTION workhub_private.t2_publish_body(i jsonb, p_plan jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('input', i, 'complete', true, 'changes', c, 'participants', workhub_private.t2_participants(c), 'blockers', p_plan -> 'blockers',
    'preserved', jsonb_build_object('outsideRange', true, 'pastRecords', true, 'existingChanges', p_plan -> 'existingChanges'),
    'excludedDays', p_plan -> 'excludedDays')
    FROM (SELECT workhub_private.t2_plan_changes(p_plan) AS c) z
$$;

-- 미리보기 행 만들기(같은 학교 · 소속의 만료된 확정 명세 쪽은 지운다 — 쪽은 다시 쓸 일이 없다)
CREATE FUNCTION workhub_private.t2_preview_row(p_ctx workhub_private.actor_context, p_kind text, i jsonb, p_as_of timestamptz) RETURNS workhub.timetable_previews
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_previews; v_at timestamptz := workhub_private.t2_now();
BEGIN
  DELETE FROM workhub.timetable_preview_pages WHERE preview_id IN (
    SELECT id FROM workhub.timetable_previews WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND expires_at <= v_at);
  r.id := gen_random_uuid()::text; r.school_id := p_ctx.school_id; r.membership_id := p_ctx.membership_id; r.account_id := p_ctx.account_id;
  r.kind := p_kind; r.input := i; r.source_as_of := p_as_of; r.created_at := v_at;
  r.expires_at := v_at + make_interval(secs => workhub_private.t2_limit('previewLifetimeMs') / 1000.0);
  RETURN r;
END $$;

-- ----------------------------------------------------------------------------
-- 4. 공개 미리보기(v1 — 12,000건까지 한 번에) · 확정 명세(next — 200건씩 쪽)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_publish_preview(p_ctx workhub_private.actor_context, i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_previews; v_plan jsonb; v_body jsonb;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.t2_publish_input(i);
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  r := workhub_private.t2_preview_row(p_ctx, 'publish', i, NULL);
  v_plan := workhub_private.t2_publish_plan(p_ctx, i, r.id, r.created_at);
  IF jsonb_array_length(v_plan -> 'rows') > workhub_private.t2_limit('changes') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_body := workhub_private.t2_publish_body(i, v_plan);
  IF jsonb_array_length(v_body -> 'participants') > workhub_private.t2_limit('teachers') THEN RAISE EXCEPTION 'QUERY_FAILED'; END IF;
  r.preview_hash := workhub_private.p2_sha(v_body); r.total_changes := jsonb_array_length(v_plan -> 'rows'); r.blocker_count := jsonb_array_length(v_plan -> 'blockers');
  INSERT INTO workhub.timetable_previews SELECT r.*;
  RETURN v_body || jsonb_build_object('previewId', r.id, 'previewHash', r.preview_hash, 'createdAt', workhub_private.t2_ts(r.created_at),
                                      'expiresAt', workhub_private.t2_ts(r.expires_at));
END $$;

-- 확정 명세(앱 PublicationManifest). manifestHash = 명세에서 manifestHash 를 뺀 나머지의 지문, 쪽 지문 = 쪽 changes 의 지문.
CREATE FUNCTION workhub_private.t2_manifest_of(r workhub.timetable_previews, p_tz text, p_plan jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT workhub_private.t2_plan_changes(p_plan) AS ch),
       pg AS (SELECT n, workhub_private.p2_sha(COALESCE((SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(c.ch) WITH ORDINALITY z(x, o)
                                                          WHERE o > n * 200 AND o <= (n + 1) * 200), '[]'::jsonb)) AS h
                FROM c, generate_series(0, ceil(jsonb_array_length(c.ch) / 200.0)::integer - 1) n),
       m AS (SELECT jsonb_build_object('previewId', r.id, 'previewHash', r.preview_hash, 'input', r.input, 'timeZone', p_tz,
                    'createdAt', workhub_private.t2_ts(r.created_at), 'expiresAt', workhub_private.t2_ts(r.expires_at),
                    'basisFingerprint', p_plan ->> 'basisFingerprint', 'totalChanges', jsonb_array_length(p_plan -> 'rows'), 'pageSize', 200,
                    'pageHashes', COALESCE((SELECT jsonb_agg(h ORDER BY n) FROM pg), '[]'::jsonb), 'blockerCount', jsonb_array_length(p_plan -> 'blockers'),
                    'complete', true,
                    'preserved', jsonb_build_object('pastRecords', true, 'outsideRange', true, 'existingChanges', p_plan -> 'existingChanges')) AS v)
  SELECT m.v || jsonb_build_object('manifestHash', workhub_private.p2_sha(m.v)) FROM m
$$;

CREATE FUNCTION workhub_private.t2_publish_manifest(p_ctx workhub_private.actor_context, i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_previews; v_plan jsonb; v_ch jsonb; v_m jsonb;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.t2_publish_input(i);
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  r := workhub_private.t2_preview_row(p_ctx, 'manifest', i, NULL);
  v_plan := workhub_private.t2_publish_plan(p_ctx, i, r.id, r.created_at);
  IF jsonb_array_length(v_plan -> 'rows') > workhub_private.t2_limit('manifestChanges') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_ch := workhub_private.t2_plan_changes(v_plan);
  -- 미리보기 지문 = 공개 본문(v1 과 같은 정의)의 지문. 확정 때 다시 계산해 비교한다.
  r.preview_hash := workhub_private.p2_sha(workhub_private.t2_publish_body(i, v_plan));
  r.total_changes := jsonb_array_length(v_ch); r.blocker_count := jsonb_array_length(v_plan -> 'blockers');
  v_m := workhub_private.t2_manifest_of(r, p_ctx.school_timezone, v_plan);
  r.manifest_hash := v_m ->> 'manifestHash';
  INSERT INTO workhub.timetable_previews SELECT r.*;
  INSERT INTO workhub.timetable_preview_pages (preview_id, idx, page_hash, changes)
  SELECT r.id, n, v_m -> 'pageHashes' ->> n,
         COALESCE((SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(v_ch) WITH ORDINALITY z(x, o) WHERE o > n * 200 AND o <= (n + 1) * 200), '[]'::jsonb)
    FROM generate_series(0, jsonb_array_length(v_m -> 'pageHashes') - 1) n;
  RETURN v_m;
END $$;

CREATE FUNCTION workhub_private.t2_publish_page(p_ctx workhub_private.actor_context, p_preview text, p_hash text, p_index integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_previews; g workhub.timetable_preview_pages;
BEGIN
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p7_id(to_jsonb(p_preview)) OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_index IS NULL OR p_index < 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO r FROM workhub.timetable_previews WHERE id = p_preview AND school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id
     AND account_id = p_ctx.account_id AND kind = 'manifest';
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF r.manifest_hash <> p_hash OR r.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF p_index >= ceil(r.total_changes / 200.0) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO g FROM workhub.timetable_preview_pages WHERE preview_id = r.id AND idx = p_index;
  IF g.preview_id IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN jsonb_build_object('previewId', r.id, 'manifestHash', r.manifest_hash, 'index', p_index, 'pageHash', g.page_hash, 'changes', g.changes);
END $$;

-- ----------------------------------------------------------------------------
-- 5. 공개 확정 — 같은 미리보기 ID · 시각으로 다시 계산해 지문이 같아야 반영한다(한 트랜잭션: 공개판 · 수업 · 판 이력 · 감사 · 원장)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_publish_apply(p_ctx workhub_private.actor_context, p_plan jsonb, p_preview text, p_key text, p_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pub text;
BEGIN
  INSERT INTO workhub.timetable_publications (school_id, term_id, basis_id, draft_id, title, from_date, until_date, excluded_days, unavailable, changed_count,
                                              preview_id, published_by_membership_id, request_key, published_at)
  VALUES (p_ctx.school_id, p_plan ->> 'termId', p_plan ->> 'basisId', p_plan ->> 'draftId', workhub_private.t1_label(p_plan ->> 'title', 200, '시간표'),
          (p_plan ->> 'from')::date, (p_plan ->> 'until')::date, p_plan -> 'excludedDays', p_plan -> 'unavailable', jsonb_array_length(p_plan -> 'rows'),
          p_preview, p_ctx.membership_id, p_key, p_at)
  RETURNING id INTO v_pub;
  UPDATE workhub.timetable_lessons l SET state = 'cancelled', version = (x ->> 'version')::integer, publication_id = v_pub, changed_by = 'publish', changed_at = p_at
    FROM jsonb_array_elements(p_plan -> 'rows') x WHERE x ->> 'k' = 'cancel' AND l.school_id = p_ctx.school_id AND l.id = x ->> 'id';
  UPDATE workhub.timetable_lessons l SET version = (x ->> 'version')::integer, publication_id = v_pub, course_id = x ->> 'course', label = x ->> 'label',
         starts_at = (x ->> 's')::timestamptz, ends_at = (x ->> 'e')::timestamptz, teacher_ids = ARRAY(SELECT jsonb_array_elements_text(x -> 'teachers')),
         groups = x -> 'groups', rooms = x -> 'rooms', uses = x -> 'uses', allowed_slot_ids = ARRAY(SELECT jsonb_array_elements_text(x -> 'allowed')),
         changed_by = 'publish', changed_at = p_at
    FROM jsonb_array_elements(p_plan -> 'rows') x WHERE x ->> 'k' = 'update' AND l.school_id = p_ctx.school_id AND l.id = x ->> 'id';
  INSERT INTO workhub.timetable_lessons (id, school_id, term_id, publication_id, basis_id, activity_id, course_id, occurrence_date, label, starts_at, ends_at,
                                         teacher_ids, groups, rooms, uses, allowed_slot_ids, changed_by, changed_at, created_at)
  SELECT x ->> 'id', p_ctx.school_id, p_plan ->> 'termId', v_pub, p_plan ->> 'basisId', x ->> 'act', x ->> 'course', (x ->> 'occ')::date, x ->> 'label',
         (x ->> 's')::timestamptz, (x ->> 'e')::timestamptz, ARRAY(SELECT jsonb_array_elements_text(x -> 'teachers')), x -> 'groups', x -> 'rooms', x -> 'uses',
         ARRAY(SELECT jsonb_array_elements_text(x -> 'allowed')), 'publish', p_at, p_at
    FROM jsonb_array_elements(p_plan -> 'rows') x WHERE x ->> 'k' = 'new';
  INSERT INTO workhub.timetable_lesson_versions (school_id, lesson_id, version, change_kind, source_id, snapshot)
  SELECT l.school_id, l.id, l.version, 'publish', v_pub, to_jsonb(l) - 'school_id'
    FROM workhub.timetable_lessons l JOIN jsonb_array_elements(p_plan -> 'rows') x ON x ->> 'id' = l.id WHERE l.school_id = p_ctx.school_id;
  RETURN v_pub;
END $$;

-- 공개 확정 공통: 미리보기 행 확인 → 만료 → 잠금 → 다시 계산 → 지문 · 차단 · 시작 시각 확인 → 반영. 지문이 다르면 CONFLICT.
CREATE FUNCTION workhub_private.t2_publish_commit(p_ctx workhub_private.actor_context, p_kind text, p_preview text, p_preview_hash text, p_expires jsonb,
                                                  i jsonb, p_manifest_hash text, p_basis_fp text, p_total jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_previews; v_plan jsonb; v_at timestamptz; v_m jsonb; v_pub text;
BEGIN
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM workhub.timetable_previews WHERE id = p_preview AND school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id
     AND account_id = p_ctx.account_id AND kind = p_kind;
  IF r.id IS NULL OR r.preview_hash <> p_preview_hash OR to_jsonb(workhub_private.t2_ts(r.expires_at)) <> p_expires OR r.input <> i
     OR (p_kind = 'manifest' AND (r.manifest_hash <> p_manifest_hash OR to_jsonb(r.total_changes) <> p_total)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF r.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  v_plan := workhub_private.t2_publish_plan(p_ctx, i, r.id, r.created_at);
  IF workhub_private.p2_sha(workhub_private.t2_publish_body(i, v_plan)) <> r.preview_hash THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF p_kind = 'manifest' THEN
    v_m := workhub_private.t2_manifest_of(r, p_ctx.school_timezone, v_plan);
    IF v_m ->> 'manifestHash' <> r.manifest_hash OR v_m ->> 'basisFingerprint' <> p_basis_fp THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  END IF;
  IF jsonb_array_length(v_plan -> 'blockers') > 0 OR jsonb_array_length(v_plan -> 'rows') = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_at := workhub_private.t2_now();
  -- 미리보기 뒤 시작해 버린 수업이 바뀌면(이미 지난 수업) 반영하지 않는다
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan -> 'rows') x
              WHERE (x ->> 's')::timestamptz <= v_at OR (x #>> '{before,time,startsAt}')::timestamptz <= v_at) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  v_pub := workhub_private.t2_publish_apply(p_ctx, v_plan, r.id, p_key, v_at);
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.publish', 'timetable_publication', v_pub, 1, 'school', p_key,
    jsonb_build_object('draftId', v_plan ->> 'draftId', 'from', v_plan ->> 'from', 'until', v_plan ->> 'until', 'changes', jsonb_array_length(v_plan -> 'rows'),
                       'previewId', r.id));
  RETURN jsonb_build_object('publicationId', v_pub, 'recordedAt', v_at, 'plan', v_plan, 'manifest', v_m);
END $$;

-- timetable-operations.v1 execute — publish 은 여기, submit · action 은 T2-04(t2_submit · t2_action)
CREATE FUNCTION workhub_private.t2_ops_execute(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(c); v jsonb; x jsonb;
BEGIN
  v := workhub_private.t2_claim(p_ctx, 'operations', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF c IS NULL OR jsonb_typeof(c) <> 'object' OR jsonb_typeof(c -> 'kind') <> 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF c ->> 'kind' = 'action' THEN
    v := workhub_private.t2_action(p_ctx, c, p_key, v_hash);
  ELSIF c ->> 'kind' IN ('publish','submit') THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','preview']) OR NOT workhub_private.p2_exact(c -> 'preview', ARRAY['previewId','previewHash','expiresAt','input'])
       OR NOT workhub_private.p7_id(c #> '{preview,previewId}') OR NOT workhub_private.p5_hash(c #> '{preview,previewHash}')
       OR workhub_private.t2_parse_ts(c #> '{preview,expiresAt}', false) IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF c ->> 'kind' = 'submit' THEN
      v := workhub_private.t2_submit(p_ctx, c, p_key, v_hash);
    ELSE
      PERFORM workhub_private.t2_publish_input(c #> '{preview,input}');
      x := workhub_private.t2_publish_commit(p_ctx, 'publish', c #>> '{preview,previewId}', c #>> '{preview,previewHash}', c #> '{preview,expiresAt}',
                                             c #> '{preview,input}', NULL, NULL, NULL, p_key);
      v := jsonb_build_object('requestKey', p_key, 'commandHash', v_hash, 'kind', 'publish', 'entityId', x ->> 'publicationId', 'version', 1,
                              'status', 'published', 'recordedAt', workhub_private.t2_ts((x ->> 'recordedAt')::timestamptz),
                              'changedLessons', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r ->> 'id', 'version', (r -> 'version')) ORDER BY o)
                                                          FROM jsonb_array_elements(x #> '{plan,rows}') WITH ORDINALITY z(r, o)), '[]'::jsonb));
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.t2_record(p_ctx, 'operations', p_key, v_hash, v);
  RETURN v;
END $$;

-- timetable-publication.v1 execute(확정 명세 참조) — 앱 PublicationCommitReference
CREATE FUNCTION workhub_private.t2_publication_execute(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(c); v jsonb; x jsonb;
BEGIN
  v := workhub_private.t2_claim(p_ctx, 'publication', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t2_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p2_exact(c, ARRAY['kind','previewId','previewHash','manifestHash','basisFingerprint','input','expiresAt','totalChanges'])
     OR c ->> 'kind' IS DISTINCT FROM 'publish_manifest' OR jsonb_typeof(c -> 'kind') <> 'string' OR NOT workhub_private.p7_id(c -> 'previewId')
     OR NOT workhub_private.p5_hash(c -> 'previewHash') OR NOT workhub_private.p5_hash(c -> 'manifestHash') OR NOT workhub_private.p5_hash(c -> 'basisFingerprint')
     OR workhub_private.t2_parse_ts(c -> 'expiresAt', false) IS NULL OR NOT workhub_private.p2_int(c -> 'totalChanges', 1, 100000) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.t2_publish_input(c -> 'input');
  x := workhub_private.t2_publish_commit(p_ctx, 'manifest', c ->> 'previewId', c ->> 'previewHash', c -> 'expiresAt', c -> 'input',
                                         c ->> 'manifestHash', c ->> 'basisFingerprint', c -> 'totalChanges', p_key);
  v := jsonb_build_object('requestKey', p_key, 'commandHash', v_hash, 'kind', 'publish_manifest', 'entityId', x ->> 'publicationId', 'version', 1,
                          'status', 'published', 'recordedAt', workhub_private.t2_ts((x ->> 'recordedAt')::timestamptz),
                          'manifestHash', c ->> 'manifestHash', 'basisFingerprint', c ->> 'basisFingerprint', 'changedCount', jsonb_array_length(x #> '{plan,rows}'));
  PERFORM workhub_private.t2_record(p_ctx, 'publication', p_key, v_hash, v);
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 6. 봉투 — 업무 코드는 {error:{code}}, 동시 실행 경합(유일 · 배제 · 교착 · 직렬화 · 참조)은 CONFLICT
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t2_run(p_ctx workhub_private.actor_context, p_contract text, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT workhub_private.t2_installed_all() THEN RETURN workhub_private.p7_err(p_ctx, p_contract, 'NOT_READY'); END IF;
  BEGIN
    v := CASE p_op
      WHEN 'readiness' THEN workhub_private.t2_readiness(p_ctx)
      WHEN 'get' THEN workhub_private.t2_get(p_ctx, a ->> 'from', a ->> 'until')
      WHEN 'references' THEN workhub_private.t2_references(p_ctx, a ->> 'asOf', a ->> 'from', a ->> 'until')
      WHEN 'publish_preview' THEN workhub_private.t2_publish_preview(p_ctx, a -> 'input')
      WHEN 'publish_manifest' THEN workhub_private.t2_publish_manifest(p_ctx, a -> 'input')
      WHEN 'publish_page' THEN workhub_private.t2_publish_page(p_ctx, a ->> 'previewId', a ->> 'hash', (a ->> 'index')::integer)
      WHEN 'ops_execute' THEN workhub_private.t2_ops_execute(p_ctx, a -> 'command', a ->> 'key', (a ->> 'recover')::boolean)
      WHEN 'publication_execute' THEN workhub_private.t2_publication_execute(p_ctx, a -> 'command', a ->> 'key', (a ->> 'recover')::boolean)
      WHEN 'exchange_preview' THEN workhub_private.t2_exchange_preview(p_ctx, a -> 'input')
      WHEN 'recommend' THEN workhub_private.t2_recommend(p_ctx, a -> 'input', a ->> 'asOf')
      WHEN 'school_day_preview' THEN workhub_private.t2_school_day_preview(p_ctx, a -> 'input', a ->> 'asOf', a ->> 'from', a ->> 'until')
      WHEN 'school_day_execute' THEN workhub_private.t2_school_day_execute(p_ctx, a -> 'command', a ->> 'key', (a ->> 'recover')::boolean)
      WHEN 'execution_get' THEN workhub_private.t2_exec_get(p_ctx, a ->> 'lessonId')
      WHEN 'execution_history' THEN workhub_private.t2_exec_history(p_ctx, a ->> 'lessonId', (a ->> 'anchor')::integer, a ->> 'cursor', (a ->> 'size')::integer)
      WHEN 'execution_record' THEN workhub_private.t2_exec_record(p_ctx, a -> 'command', a ->> 'key', (a ->> 'recover')::boolean)
      WHEN 'abandon' THEN workhub_private.t2_abandon(p_ctx, a ->> 'kind', a -> 'command', a ->> 'key')
    END;
    IF v IS NULL THEN RAISE EXCEPTION 'T2_UNKNOWN_OPERATION'; END IF;
    RETURN workhub_private.p7_ok(p_ctx, p_contract, v);
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p7_business(SQLERRM) THEN RETURN workhub_private.p7_err(p_ctx, p_contract, SQLERRM); END IF;
      RAISE;
    WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure OR foreign_key_violation THEN
      RETURN workhub_private.p7_err(p_ctx, p_contract, 'CONFLICT');
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 7. 공개 함수(이 파일 9개)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_timetable_operations_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.v1', 'readiness', '{}'::jsonb);
END $$;
CREATE FUNCTION public.workhub_timetable_operations_get(p_member_id text, p_from text, p_until text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.v1', 'get', jsonb_build_object('from', p_from, 'until', p_until));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_publish_preview(p_member_id text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.v1', 'publish_preview', jsonb_build_object('input', p_input));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_execute(p_member_id text, p_command jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.v1', 'ops_execute', jsonb_build_object('command', p_command, 'key', p_request_key, 'recover', p_recover_only));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_references(p_member_id text, p_source_as_of text, p_from text, p_until text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.next.v1', 'references', jsonb_build_object('asOf', p_source_as_of, 'from', p_from, 'until', p_until));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_publish_manifest(p_member_id text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.next.v1', 'publish_manifest', jsonb_build_object('input', p_input));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_publish_page(p_member_id text, p_preview_id text, p_manifest_hash text, p_index integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.next.v1', 'publish_page', jsonb_build_object('previewId', p_preview_id, 'hash', p_manifest_hash, 'index', p_index));
END $$;
CREATE FUNCTION public.workhub_timetable_publication_execute(p_member_id text, p_command jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t2_run(ctx, 'timetable-publication.v1', 'publication_execute', jsonb_build_object('command', p_command, 'key', p_request_key, 'recover', p_recover_only));
END $$;
CREATE FUNCTION public.workhub_timetable_operations_abandon(p_member_id text, p_kind text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t2_run(ctx, 'timetable-operations.abandon.v1', 'abandon', jsonb_build_object('kind', p_kind, 'command', p_command, 'key', p_request_key));
END $$;

COMMENT ON FUNCTION public.workhub_timetable_operations_readiness(text) IS '업무실 T2 시간표 운영: 공개 시간표를 볼 수 있는가(not_installed · basis_missing).';
COMMENT ON FUNCTION public.workhub_timetable_operations_get(text, text, text) IS '업무실 T2 시간표 운영: 기간(31일까지)의 날짜별 수업 · 교환 요청 · 공개 이력 · 공개할 편성 초안.';
COMMENT ON FUNCTION public.workhub_timetable_operations_publish_preview(text, jsonb) IS '업무실 T2 시간표 운영: 편성 초안 공개 미리보기(바뀌는 수업 · 휴업일 · 차단 사유, 15분).';
COMMENT ON FUNCTION public.workhub_timetable_operations_execute(text, jsonb, text, boolean) IS '업무실 T2 시간표 운영: 공개 확정 · 교환 요청 제출 · 동의/승인/철회(요청 번호 · 복구 조회).';
COMMENT ON FUNCTION public.workhub_timetable_operations_references(text, text, text, text) IS '업무실 T2 시간표 운영: 조회한 수업마다 학급 · 수강집단 · 공간 ID 와 이름.';
COMMENT ON FUNCTION public.workhub_timetable_operations_publish_manifest(text, jsonb) IS '업무실 T2 시간표 운영: 큰 공개의 확정 명세(200건씩 쪽 지문).';
COMMENT ON FUNCTION public.workhub_timetable_operations_publish_page(text, text, text, integer) IS '업무실 T2 시간표 운영: 확정 명세의 쪽 하나.';
COMMENT ON FUNCTION public.workhub_timetable_publication_execute(text, jsonb, text, boolean) IS '업무실 T2 시간표 운영: 확정 명세 참조로 공개 확정(요청 번호 · 복구 조회).';
COMMENT ON FUNCTION public.workhub_timetable_operations_abandon(text, text, jsonb, text) IS '업무실 T2 시간표 운영: 결과를 모르는 요청 번호 포기(이미 반영됐으면 접수증, 아니면 취소 기록 — 그 번호는 다시 반영되지 않음).';

-- ----------------------------------------------------------------------------
-- 8. 권한 — 이 파일의 공개 함수 9개만 authenticated 에. 새 내부 함수는 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND p.proname LIKE 't2\_%')
               OR (n.nspname = 'public' AND (p.proname LIKE 'workhub\_timetable\_operations\_%' OR p.proname LIKE 'workhub\_timetable\_publication\_%')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_timetable_operations_readiness(text), public.workhub_timetable_operations_get(text, text, text),
    public.workhub_timetable_operations_publish_preview(text, jsonb), public.workhub_timetable_operations_execute(text, jsonb, text, boolean),
    public.workhub_timetable_operations_references(text, text, text, text), public.workhub_timetable_operations_publish_manifest(text, jsonb),
    public.workhub_timetable_operations_publish_page(text, text, text, integer), public.workhub_timetable_publication_execute(text, jsonb, text, boolean),
    public.workhub_timetable_operations_abandon(text, text, jsonb, text)
    TO authenticated;
END $$;

INSERT INTO workhub_private.t2_installs (batch, release) VALUES ('T2-03', '2026-10-20.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 9. 검증 — 모든 행의 status 가 ok 여야 한다. T2-03-3 은 "아직 켜지 않음"이 정상이다(T2-08 전).
-- ----------------------------------------------------------------------------
SELECT 'T2-03-1' AS no, '공개 함수 9개 authenticated 만(anon · service_role 불가)' AS item,
       CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                   AND (proname LIKE 'workhub\_timetable\_operations\_%' OR proname LIKE 'workhub\_timetable\_publication\_%')) = 9
             AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                               AND (p.proname LIKE 'workhub\_timetable\_operations\_%' OR p.proname LIKE 'workhub\_timetable\_publication\_%')
                               AND (NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T2-03-2', '내부 함수 t2_* API 역할 실행 불가',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't2\_%'
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T2-03-3', '아직 어느 학교도 켜지 않음 · 공개 0 · 원장 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'timetable_operations') = 0
             AND (SELECT count(*) FROM workhub.timetable_publications) = 0 AND (SELECT count(*) FROM workhub.timetable_operation_requests) = 0
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T2-03-4', '적용 기록 T2-03', CASE WHEN workhub_private.t2_installed('T2-03') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
