-- ============================================================================
-- P7-02  수합 운영 · 홈 요약 · 업무 인계 · 새 학년도 — 공개 함수 6개 (비활성 설치)
--
-- ▣ 전제: P7-01(2026-10-16.1). 학교별 활성화(P7-04) 전에는 모든 함수가 NOT_READY 다.
-- ▣ 공개 함수(authenticated 만, 첫 인자 p_member_id):
--     workhub_collection_operations_get · workhub_collection_operations_mutate   (collection-operations.v1)
--     workhub_home_overview                                                     (home.v1)
--     workhub_school_transition_list · _preview · _mutate                      (school-transitions.v1)
-- ▣ 마감 · 보관 · 재개 · 기한 연장과 수합 · 협업 인계는 P7-05(R1 · P2 보강, 별도 승인) 전에는 NOT_READY 다.
--   공식 담당(P1) 인계는 학교가 duty_handover 모듈을 따로 켜야 열린다(교사끼리 공식 담당을 넘기는 것은 학교 결정).
-- ▣ 한 트랜잭션. 중간에 ERROR 가 나면 아무것도 남지 않는다. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p7_installs') IS NULL THEN
    RAISE EXCEPTION 'P7 중단: P7-01(2026-10-16.1)을 먼저 적용해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p7_installs WHERE batch = 'P7-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P7 중단: P7-01(2026-10-16.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p7_installs WHERE batch = 'P7-02') THEN
    RAISE EXCEPTION 'P7 중단: P7-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('workhub_collection_operations_get',
               'workhub_collection_operations_mutate','workhub_home_overview','workhub_school_transition_list',
               'workhub_school_transition_preview','workhub_school_transition_mutate')) THEN
    RAISE EXCEPTION 'P7 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 수합 운영 — 읽기
-- ----------------------------------------------------------------------------
-- R1 수합 원본을 읽을 수 있는 상태인가(R1 DB 적용 + 전체 중지 아님). 파일 검사기 준비와는 별개(읽기만).
CREATE FUNCTION workhub_private.p7_r1_readable() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.c_db_ok() AND workhub_private.c_switch() <> 'all_stopped'
$$;

CREATE FUNCTION workhub_private.p7_ops_get(p_ctx workhub_private.actor_context, p_request_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c workhub.collections; v_manage boolean; v_units jsonb;
BEGIN
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'collection_ops') OR NOT workhub_private.p7_r1_readable() THEN
    RAISE EXCEPTION 'NOT_READY';
  END IF;
  IF NOT workhub_private.p7_id(to_jsonb(p_request_id)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = p_request_id AND state = 'published';
  IF NOT FOUND OR NOT workhub_private.c_reads(p_ctx, c.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_manage := workhub_private.c_is_manager(p_ctx, c.id);
  -- 관리자는 모든 단위, 그 밖(검토자 · 단위 구성원)은 볼 수 있는 단위의 합계만(목록은 비움 — 앱 계약)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'label', u.label, 'responsibleMemberId', u.responsible_membership_id,
                                               'version', u.version, 'state', workhub_private.p7_unit_state(u.school_id, u.id))
                            ORDER BY u.ordinal), '[]'::jsonb)
    INTO v_units
    FROM workhub.collection_units u
   WHERE u.school_id = c.school_id AND u.collection_id = c.id
     AND (v_manage OR workhub_private.c_sees_unit(p_ctx, c.id, u.id));
  RETURN jsonb_build_object(
    'requestId', c.id,
    'version', workhub_private.p7_ops_version(c.school_id, c.id),
    'phase', workhub_private.p7_phase(c.school_id, c.id),
    'dueDate', workhub_private.p7_day(c.due_on),
    'canManage', v_manage,
    'totals', jsonb_build_object(
      'total', jsonb_array_length(v_units),
      'missing', (SELECT count(*) FROM jsonb_array_elements(v_units) x WHERE x ->> 'state' = 'missing'),
      'submitted', (SELECT count(*) FROM jsonb_array_elements(v_units) x WHERE x ->> 'state' = 'submitted'),
      'accepted', (SELECT count(*) FROM jsonb_array_elements(v_units) x WHERE x ->> 'state' = 'accepted'),
      'changesRequested', (SELECT count(*) FROM jsonb_array_elements(v_units) x WHERE x ->> 'state' = 'changes_requested')),
    'units', CASE WHEN v_manage THEN v_units ELSE '[]'::jsonb END);
END $$;

-- ----------------------------------------------------------------------------
-- 2. 수합 운영 — 명령 (앱 operation() 과 같은 모양 검사)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p7_ops_check(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_kind text; r jsonb; v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 200000 OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_kind := p ->> 'kind';
  IF NOT (CASE v_kind
       WHEN 'close' THEN workhub_private.p2_exact(p, ARRAY['kind','requestId','expectedVersion','reason'])
       WHEN 'archive' THEN workhub_private.p2_exact(p, ARRAY['kind','requestId','expectedVersion','reason'])
       WHEN 'reopen' THEN workhub_private.p2_exact(p, ARRAY['kind','requestId','expectedVersion','reason','dueDate']) AND workhub_private.p7_date(p -> 'dueDate')
       WHEN 'extend' THEN workhub_private.p2_exact(p, ARRAY['kind','requestId','expectedVersion','reason','dueDate']) AND workhub_private.p7_date(p -> 'dueDate')
       WHEN 'remind' THEN workhub_private.p2_exact(p, ARRAY['kind','requestId','expectedVersion','reason','recipients'])
                          AND jsonb_typeof(p -> 'recipients') = 'array' AND jsonb_array_length(p -> 'recipients') BETWEEN 1 AND 500
       ELSE false END)
     OR NOT workhub_private.p7_id(p -> 'requestId') OR NOT workhub_private.p7_pos(p -> 'expectedVersion')
     OR NOT workhub_private.p7_text(p -> 'reason', 1000) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_kind = 'remind' THEN
    FOR r IN SELECT x FROM jsonb_array_elements(p -> 'recipients') x LOOP
      IF NOT workhub_private.p2_exact(r, ARRAY['unitId','memberId','expectedVersion']) OR NOT workhub_private.p7_id(r -> 'unitId')
         OR NOT workhub_private.p7_id(r -> 'memberId') OR NOT workhub_private.p7_pos(r -> 'expectedVersion')
         OR (r ->> 'unitId') = ANY (v_seen) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
      v_seen := v_seen || (r ->> 'unitId');
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION workhub_private.p7_ops_mutate(p_ctx workhub_private.actor_context, p_cmd jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q workhub.operation_requests; c workhub.collections; o workhub.collection_operations; u workhub.collection_units; r jsonb;
  v_hash text; v_kind text; v_phase text; v_ver integer; v_next text; v_due date; v_new_due date; v_hist bigint;
  v_note text; v_resp jsonb; v_now timestamptz := clock_timestamp(); v_count integer := 0;
BEGIN
  IF NOT workhub_private.p7_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_hash := workhub_private.p2_sha(p_cmd);
  PERFORM workhub_private.p7_lock(p_ctx, 'collection_ops', p_key);
  -- 같은 번호 · 같은 내용 → 처음 결과(쓰기 없이). 다른 내용 → IDEMPOTENCY_CONFLICT
  q := workhub_private.p7_ledger(p_ctx, 'collection_ops', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;

  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'collection_ops') OR NOT workhub_private.p7_r1_readable() THEN
    RAISE EXCEPTION 'NOT_READY';
  END IF;
  PERFORM workhub_private.p7_ops_check(p_cmd);
  v_kind := p_cmd ->> 'kind';
  -- 마감 · 보관 · 재개 · 연장은 R1 쓰기 게이트와 기한 변경이 있어야 실제로 막고 바꿀 수 있다(P7-05).
  IF v_kind <> 'remind' AND NOT workhub_private.p7_bridge() THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF v_kind = 'remind' AND workhub_private.p3_messaging_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;

  IF NOT EXISTS (SELECT 1 FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'requestId' AND state = 'published')
     OR NOT workhub_private.c_reads(p_ctx, p_cmd ->> 'requestId') THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF NOT workhub_private.c_is_manager(p_ctx, p_cmd ->> 'requestId') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- 잠금: 상태를 바꾸는 명령은 수합 행 FOR UPDATE(R1 쓰기 게이트의 FOR SHARE 와 줄을 세운다).
  -- 알림은 제출 단위를 잠그므로 수합 행은 FOR SHARE 만(제출의 "단위 → 수합" 잠금 순서와 교착하지 않게).
  IF v_kind = 'remind' THEN
    SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'requestId' FOR SHARE;
  ELSE
    SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'requestId' FOR UPDATE;
  END IF;
  IF c.owner_membership_id <> p_ctx.membership_id OR c.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO o FROM workhub.collection_operations WHERE school_id = c.school_id AND collection_id = c.id FOR UPDATE;
  v_phase := COALESCE(o.phase, 'open');
  v_ver := COALESCE(o.version, 1);
  IF (p_cmd ->> 'expectedVersion')::integer <> v_ver THEN RAISE EXCEPTION 'CONFLICT'; END IF;

  v_due := c.due_on;
  v_new_due := c.due_on;
  v_next := CASE
    WHEN v_kind = 'close'   AND v_phase = 'open'                  THEN 'closed'
    WHEN v_kind = 'archive' AND v_phase = 'closed'                THEN 'archived'
    WHEN v_kind = 'reopen'  AND v_phase IN ('closed','archived')  THEN 'open'
    WHEN v_kind = 'extend'  AND v_phase = 'open'                  THEN 'open'
    WHEN v_kind = 'remind'  AND v_phase = 'open'                  THEN 'open' END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF v_kind IN ('reopen','extend') THEN
    v_new_due := (p_cmd ->> 'dueDate')::date;
    -- 다시 여는 기한은 오늘 이후, 연장은 지금 기한보다 뒤(오늘 이후)
    IF v_new_due < p_ctx.school_today OR (v_kind = 'extend' AND v_new_due <= v_due) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;

  IF o.collection_id IS NULL THEN
    INSERT INTO workhub.collection_operations (school_id, collection_id, phase, version) VALUES (c.school_id, c.id, v_next, 2) RETURNING * INTO o;
  ELSE
    UPDATE workhub.collection_operations SET phase = v_next, version = version + 1
     WHERE school_id = c.school_id AND collection_id = c.id RETURNING * INTO o;
  END IF;
  v_note := workhub_private.js_trim(p_cmd ->> 'reason');
  IF v_note = '' THEN v_note := p_cmd ->> 'reason'; END IF;
  INSERT INTO workhub.collection_operation_history (school_id, collection_id, version, kind, phase_before, phase_after, due_before, due_after,
      reason, actor_membership_id, actor_account_id, request_key)
  VALUES (c.school_id, c.id, o.version, v_kind, v_phase, v_next, v_due, v_new_due, p_cmd ->> 'reason', p_ctx.membership_id, p_ctx.account_id, p_key)
  RETURNING id INTO v_hist;

  -- R1 기한 변경(보강이 연 칸만, 이 트랜잭션 안에서만)
  IF v_new_due <> v_due THEN
    PERFORM workhub_private.p7_change_on();
    UPDATE workhub.collections
       SET due_on = v_new_due, due_at = ((v_new_due + 1)::timestamp AT TIME ZONE p_ctx.school_timezone),
           due_change_revision = due_change_revision + 1, version = version + 1
     WHERE school_id = c.school_id AND id = c.id;
    PERFORM workhub_private.p7_change_off();
  END IF;

  IF v_kind = 'remind' THEN
    -- 단위 ID 순으로 잠그고 하나라도 맞지 않으면 명령 전체 CONFLICT(일부만 보내지 않는다)
    FOR r IN SELECT x FROM jsonb_array_elements(p_cmd -> 'recipients') x ORDER BY x ->> 'unitId' LOOP
      SELECT * INTO u FROM workhub.collection_units WHERE school_id = c.school_id AND collection_id = c.id AND id = r ->> 'unitId' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF u.responsible_membership_id <> r ->> 'memberId' OR u.version <> (r ->> 'expectedVersion')::integer
         OR workhub_private.p7_unit_state(u.school_id, u.id) NOT IN ('missing','changes_requested')
         OR NOT EXISTS (SELECT 1 FROM workhub.memberships m JOIN workhub.schools s ON s.id = m.school_id
                         WHERE m.school_id = u.school_id AND m.id = u.responsible_membership_id AND m.account_id = u.responsible_account_id
                           AND m.status = 'active' AND workhub_private.today_in(s.timezone) <@ daterange(m.valid_from, m.valid_to, '[)')) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      INSERT INTO workhub.collection_reminders (history_id, school_id, collection_id, unit_id, unit_version, membership_id, account_id, notification_id)
      VALUES (v_hist, u.school_id, c.id, u.id, u.version, u.responsible_membership_id, u.responsible_account_id,
              workhub_private.p3_notify(u.school_id, u.responsible_membership_id, '제출 요청: ' || left(c.title, 120),
                                        left(p_cmd ->> 'reason', 1000), 'collections', c.id, 'p7:remind:' || v_hist || ':' || u.id));
      v_count := v_count + 1;
    END LOOP;
  END IF;

  PERFORM workhub_private.write_audit(p_ctx, 'collection_ops.' || v_kind, 'collection', c.id, o.version, 'school', p_key,
    jsonb_build_object('phase_before', v_phase, 'phase_after', v_next, 'due_before', workhub_private.p7_day(v_due),
                       'due_after', workhub_private.p7_day(v_new_due), 'history_id', v_hist, 'reminders', v_count));
  v_resp := jsonb_build_object('requestKey', p_key, 'requestId', c.id, 'version', o.version, 'recordedAt', workhub_private.p2_ts(v_now));
  PERFORM workhub_private.p7_record(p_ctx, 'collection_ops', p_key, v_hash, c.id, v_resp);
  RETURN v_resp;
END $$;

-- ----------------------------------------------------------------------------
-- 3. 홈 요약 — 할 일 5종의 개수와 급한 순 8건. 준비되지 않은 종류는 개수 null + unavailable.
-- ----------------------------------------------------------------------------
-- 항목 ID: 종류 + 원본 ID 의 해시(같은 원본은 같은 ID, 앱 identifier 규칙 안)
CREATE FUNCTION workhub_private.p7_home_id(p_kind text, p_source text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'h_' || p_kind || '_' || md5(p_kind || chr(31) || p_source)
$$;

CREATE FUNCTION workhub_private.p7_home(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_unavailable text[] := ARRAY[]::text[]; v_counts jsonb := '{}'::jsonb; v_rows jsonb := '[]'::jsonb; v_part jsonb;
  v_k text; v_today date := p_ctx.school_today;
BEGIN
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'home') THEN RAISE EXCEPTION 'NOT_READY'; END IF;

  -- 수합 · 보완: 내가 구성원인 제출 단위(게시 · 운영 open). 수합 하나에 항목 하나.
  IF workhub_private.p7_r1_readable() THEN
    WITH mine AS (
      SELECT c.id, c.title, c.due_on, c.created_at, workhub_private.p7_unit_state(u.school_id, u.id) AS st,
             (SELECT min(cr.due_on) FROM workhub.correction_requests cr WHERE cr.school_id = u.school_id AND cr.unit_id = u.id AND cr.state = 'open') AS fix_due
        FROM workhub.collection_unit_members m
        JOIN workhub.collection_units u ON u.school_id = m.school_id AND u.id = m.unit_id
        JOIN workhub.collections c ON c.school_id = u.school_id AND c.id = u.collection_id
       WHERE m.school_id = p_ctx.school_id AND m.membership_id = p_ctx.membership_id AND m.account_id = p_ctx.account_id
         AND m.removed_at IS NULL AND c.state = 'published' AND workhub_private.p7_phase(c.school_id, c.id) = 'open'),
    agg AS (
      SELECT 'collection' AS kind, id, min(title) AS title, min(due_on) AS due, min(created_at) AS created, count(*) AS n
        FROM mine WHERE st = 'missing' GROUP BY id
      UNION ALL
      SELECT 'supplement', id, min(title), min(fix_due), min(created_at), count(*)
        FROM mine WHERE st = 'changes_requested' GROUP BY id)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'source', id, 'title', title, 'due', due, 'created', created,
                       'label', CASE WHEN kind = 'collection' THEN CASE WHEN n > 1 THEN '미제출 ' || n || '건' ELSE '미제출' END
                                     ELSE CASE WHEN n > 1 THEN '보완 요청 ' || n || '건' ELSE '보완 요청' END END)), '[]'::jsonb)
      INTO v_part FROM agg;
    v_rows := v_rows || v_part;
    v_counts := v_counts || jsonb_build_object(
      'collection', (SELECT count(*) FROM jsonb_array_elements(v_part) x WHERE x ->> 'kind' = 'collection'),
      'supplement', (SELECT count(*) FROM jsonb_array_elements(v_part) x WHERE x ->> 'kind' = 'supplement'));
  ELSE
    v_unavailable := v_unavailable || ARRAY['collection','supplement'];
  END IF;

  -- 메시지: 안 읽은 대화방
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) = 'ready' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'message', 'source', t.id,
             'title', CASE WHEN t.kind = 'group' THEN left(regexp_replace(t.title, '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', 'g'), 200)
                           ELSE '1:1 메시지' END,
             'due', NULL, 'created', t.updated_at, 'label', '안 읽은 메시지 ' || x.n || '개')), '[]'::jsonb)
      INTO v_part
      FROM workhub.message_thread_members tm JOIN workhub.message_threads t ON t.school_id = tm.school_id AND t.id = tm.thread_id
      -- P3 의 '안 읽음' 과 같은 기준: 읽은 순번 뒤의, 다른 사람이 보낸 메시지
      CROSS JOIN LATERAL (SELECT count(*) AS n FROM workhub.messages m WHERE m.thread_id = t.id AND m.sequence > tm.read_sequence
                            AND m.sequence <= t.latest_sequence AND m.sender_membership_id <> p_ctx.membership_id) x
     WHERE tm.school_id = p_ctx.school_id AND tm.membership_id = p_ctx.membership_id AND tm.account_id = p_ctx.account_id
       AND x.n > 0 AND t.id ~ '^[a-zA-Z0-9_-]{1,100}$';
    v_rows := v_rows || v_part;
    v_counts := v_counts || jsonb_build_object('message', jsonb_array_length(v_part));
  ELSE
    v_unavailable := v_unavailable || 'message'::text;
  END IF;

  -- 학생 후속: 활동 근거가 바뀌어 다시 볼 내 관찰 기록(P5). 수업 하나에 항목 하나. P5 가 없으면 unavailable.
  -- P5 는 선택 단계라 함수 이름을 직접 쓰지 않는다(없으면 이 함수가 만들어지지 않으므로). 준비 여부를 jsonb 로 받는다.
  IF to_regprocedure('workhub_private.p5_ready(text)') IS NOT NULL THEN
    EXECUTE 'SELECT to_jsonb(workhub_private.p5_ready($1))' INTO STRICT v_part USING p_ctx.school_id;
  ELSE
    v_part := 'false'::jsonb;
  END IF;
  IF v_part = 'true'::jsonb THEN
    EXECUTE $q$
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'student_followup', 'source', x.course_id,
               'title', '학생 기록 근거 확인: ' || x.label, 'due', NULL, 'created', x.created,
               'label', '근거 변경 ' || x.n || '건')), '[]'::jsonb)
        FROM (SELECT r.course_id, min(co.label) AS label, min(r.updated_at) AS created, count(*) AS n
                FROM workhub.teaching_records r JOIN workhub.courses co ON co.school_id = r.school_id AND co.id = r.course_id
               WHERE r.school_id = $1 AND r.owner_account_id = $2 AND r.owner_membership_id = $3
                 AND r.kind = 'observation' AND r.state = 'active' AND r.source_review_required
                 AND r.course_id ~ '^[a-zA-Z0-9_-]{1,100}$'
               GROUP BY r.course_id) x $q$
      INTO v_part USING p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id;
    v_rows := v_rows || v_part;
    v_counts := v_counts || jsonb_build_object('student_followup', jsonb_array_length(v_part));
  ELSE
    v_unavailable := v_unavailable || 'student_followup'::text;
  END IF;

  -- 협업: 내가 받은 요청(요청됨 · 진행 중) + 내가 보낸 요청 중 완료 확인을 기다리는 것
  IF workhub_private.p2_installed() AND workhub_private.p2_module_active(p_ctx.school_id, 'cooperation') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'cooperation', 'source', r.id, 'title', r.title, 'due', r.due_on, 'created', r.created_at,
             'label', CASE r.status WHEN 'requested' THEN '협업 요청 받음' WHEN 'accepted' THEN '협업 진행 중' ELSE '완료 확인 요청' END)), '[]'::jsonb)
      INTO v_part
      FROM workhub.cooperation_requests r
     WHERE r.school_id = p_ctx.school_id AND r.id ~ '^[a-zA-Z0-9_-]{1,100}$'
       AND ((r.recipient_membership_id = p_ctx.membership_id AND r.recipient_account_id = p_ctx.account_id AND r.status IN ('requested','accepted'))
         OR (r.sender_membership_id = p_ctx.membership_id AND r.sender_account_id = p_ctx.account_id AND r.status = 'completion_requested'));
    v_rows := v_rows || v_part;
    v_counts := v_counts || jsonb_build_object('cooperation', jsonb_array_length(v_part));
  ELSE
    v_unavailable := v_unavailable || 'cooperation'::text;
  END IF;

  FOREACH v_k IN ARRAY v_unavailable LOOP
    v_counts := v_counts || jsonb_build_object(v_k, NULL);
  END LOOP;

  -- 급함 = 기한이 내일까지(지난 것 포함). 급한 것 → 기한 이른 순(없으면 뒤) → 만든 순 → ID
  RETURN jsonb_build_object(
    'asOf', workhub_private.p2_ts(clock_timestamp()),
    'items', COALESCE((
      SELECT jsonb_agg(item ORDER BY urgent DESC, due NULLS LAST, created, id)
        FROM (SELECT jsonb_build_object('id', workhub_private.p7_home_id(x ->> 'kind', x ->> 'source'), 'kind', x ->> 'kind',
                       'title', x ->> 'title', 'dueDate', x -> 'due', 'sourceId', x ->> 'source',
                       'priority', CASE WHEN (x ->> 'due')::date <= v_today + 1 THEN 'urgent' ELSE 'normal' END,
                       'label', x ->> 'label') AS item,
                     COALESCE((x ->> 'due')::date <= v_today + 1, false) AS urgent, (x ->> 'due')::date AS due,
                     (x ->> 'created')::timestamptz AS created, workhub_private.p7_home_id(x ->> 'kind', x ->> 'source') AS id
                FROM jsonb_array_elements(v_rows) x
               ORDER BY 2 DESC, 3 NULLS LAST, 4, 5
               LIMIT 8) s), '[]'::jsonb),
    'counts', v_counts,
    'unavailable', to_jsonb(v_unavailable));
END $$;

-- ----------------------------------------------------------------------------
-- 4. 인계 · 새 학년도 — 공통
-- ----------------------------------------------------------------------------
-- 인계할 수 있는 내 자원(요청한 사람 기준). 다른 대기 인계에 들어 있는 것은 뺀다.
--   duty        : 오늘 진행 중인 내 공식 담당(일반 업무) — duty_handover 모듈 + 학교 관리 활성
--   cooperation : 내가 받는 사람인 진행 중 협업 — P7-05 + 협업 모듈
--   collection  : 내가 만든 게시된 수합(보관 전) — P7-05 + R1 읽기
CREATE FUNCTION workhub_private.p7_resources(p_school text, p_membership text, p_account text, p_today date, p_except_record text DEFAULT NULL)
RETURNS TABLE (kind text, id text, version integer, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.kind, x.id, x.version, x.label FROM (
    SELECT 'duty'::text AS kind, a.id, a.version, left('공식 담당: ' || a.label, 200) AS label, 1 AS ord, a.created_at AS created
      FROM workhub.staff_assignments a
     WHERE workhub_private.p7_ready(p_school, 'duty_handover') AND workhub_private.p7_admin_active(p_school)
       AND a.school_id = p_school AND a.membership_id = p_membership AND a.kind = 'duty' AND a.status = 'active'
       AND a.valid_from < p_today AND p_today < a.valid_to
    UNION ALL
    SELECT 'cooperation', r.id, r.version, left('협업: ' || r.title, 200), 2, r.created_at
      FROM workhub.cooperation_requests r
     WHERE workhub_private.p7_bridge() AND workhub_private.p2_module_active(p_school, 'cooperation')
       AND r.school_id = p_school AND r.recipient_membership_id = p_membership AND r.recipient_account_id = p_account
       AND r.status IN ('requested','accepted','completion_requested') AND r.id ~ '^[a-zA-Z0-9_-]{1,100}$'
    UNION ALL
    SELECT 'collection', c.id, workhub_private.p7_ops_version(c.school_id, c.id), left('수합: ' || c.title, 200), 3, c.created_at
      FROM workhub.collections c
     WHERE workhub_private.p7_bridge() AND workhub_private.p7_r1_readable()
       AND c.school_id = p_school AND c.owner_membership_id = p_membership AND c.owner_account_id = p_account
       AND c.state = 'published' AND workhub_private.p7_phase(c.school_id, c.id) <> 'archived') x
  WHERE NOT EXISTS (SELECT 1 FROM workhub.transition_items i JOIN workhub.transition_records t ON t.id = i.record_id
                     WHERE i.school_id = p_school AND i.kind = x.kind AND i.resource_id = x.id AND t.state = 'pending'
                       AND t.id IS DISTINCT FROM p_except_record)
  ORDER BY x.ord, x.created, x.id
$$;

-- 앱 transitionPlan() 과 같은 모양 검사
CREATE FUNCTION workhub_private.p7_plan_check(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE r jsonb; v_seen text[] := ARRAY[]::text[]; d date[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR octet_length(p::text) > 200000 OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p ->> 'kind' = 'handover' THEN
    IF NOT workhub_private.p2_exact(p, ARRAY['kind','recipientMemberId','recipientVersion','resources','note'])
       OR NOT workhub_private.p7_id(p -> 'recipientMemberId') OR NOT workhub_private.p7_pos(p -> 'recipientVersion')
       OR NOT workhub_private.p7_text(p -> 'note', 2000)
       OR jsonb_typeof(p -> 'resources') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'resources') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    FOR r IN SELECT x FROM jsonb_array_elements(p -> 'resources') x LOOP
      IF NOT workhub_private.p2_exact(r, ARRAY['kind','id','version','label']) OR jsonb_typeof(r -> 'kind') IS DISTINCT FROM 'string'
         OR r ->> 'kind' NOT IN ('duty','cooperation','collection') OR NOT workhub_private.p7_id(r -> 'id')
         OR NOT workhub_private.p7_pos(r -> 'version') OR NOT workhub_private.p7_text(r -> 'label', 200)
         OR (r ->> 'kind') || ':' || (r ->> 'id') = ANY (v_seen) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
      v_seen := v_seen || ((r ->> 'kind') || ':' || (r ->> 'id'));
    END LOOP;
  ELSIF p ->> 'kind' = 'new_year' THEN
    IF NOT workhub_private.p2_exact(p, ARRAY['kind','sourceYearId','targetYear','firstDay','lastDay','term1First','term1Last','term2First','term2Last','copyStructure'])
       OR NOT workhub_private.p7_id(p -> 'sourceYearId') OR NOT workhub_private.p2_int(p -> 'targetYear', 2020, 2100)
       OR jsonb_typeof(p -> 'copyStructure') IS DISTINCT FROM 'boolean'
       OR NOT (workhub_private.p7_date(p -> 'firstDay') AND workhub_private.p7_date(p -> 'lastDay') AND workhub_private.p7_date(p -> 'term1First')
               AND workhub_private.p7_date(p -> 'term1Last') AND workhub_private.p7_date(p -> 'term2First') AND workhub_private.p7_date(p -> 'term2Last')) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    d := ARRAY[(p ->> 'firstDay')::date, (p ->> 'term1First')::date, (p ->> 'term1Last')::date, (p ->> 'term2First')::date,
               (p ->> 'term2Last')::date, (p ->> 'lastDay')::date];
    IF d[2] < d[1] OR d[3] < d[2] OR d[4] <= d[3] OR d[5] < d[4] OR d[6] < d[5] OR d[1] = d[6] THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 연도 관리 권한: year.manage + 학교 관리(P1) 활성
CREATE FUNCTION workhub_private.p7_can_manage_year(p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.member_has_perm(p_ctx, 'year.manage') AND workhub_private.p7_admin_active(p_ctx.school_id)
$$;

-- 계획 판정: 미리보기와 적용이 같은 함수를 쓴다. {state(지문 재료), summary, excluded, affectedCount, title, items, recipient}
-- 오류는 코드 예외(INVALID_INPUT · NOT_FOUND · FORBIDDEN · CONFLICT · NOT_READY)
CREATE FUNCTION workhub_private.p7_plan_eval(p_ctx workhub_private.actor_context, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m workhub.memberships; v_name text; r jsonb; x record; y workhub.academic_years;
  v_items jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb; v_excl jsonb := '[]'::jsonb; v_state jsonb;
  v_first date; v_last date; v_dep integer := 0; v_cls integer := 0; v_sub integer := 0; v_rev bigint;
BEGIN
  PERFORM workhub_private.p7_plan_check(p);
  IF p ->> 'kind' = 'handover' THEN
    -- 받는 사람: 같은 학교 · 오늘 유효 · 업무실 사용자(P2 규칙), 나 · 같은 계정의 다른 소속 아님
    SELECT * INTO m FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = p ->> 'recipientMemberId';
    IF NOT FOUND OR NOT workhub_private.p7_recipient_ok(p_ctx, m.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF m.version <> (p ->> 'recipientVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    SELECT left(a.display_name, 100) INTO v_name FROM workhub.accounts a WHERE a.id = m.account_id;
    -- 종류별 준비: 꺼진 종류가 하나라도 있으면 NOT_READY(조용히 빼지 않는다)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'duty')
       AND NOT (workhub_private.p7_ready(p_ctx.school_id, 'duty_handover') AND workhub_private.p7_admin_active(p_ctx.school_id)) THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' IN ('cooperation','collection'))
       AND NOT workhub_private.p7_bridge() THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'cooperation')
       AND NOT workhub_private.p2_module_active(p_ctx.school_id, 'cooperation') THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'collection')
       AND NOT workhub_private.p7_r1_readable() THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    v_lines := v_lines || to_jsonb('받는 사람: ' || v_name);
    FOR r IN SELECT e FROM jsonb_array_elements(p -> 'resources') e ORDER BY CASE e ->> 'kind' WHEN 'duty' THEN 1 WHEN 'cooperation' THEN 2 ELSE 3 END, e ->> 'id' LOOP
      SELECT * INTO x FROM workhub_private.p7_resources(p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_ctx.school_today) s
       WHERE s.kind = r ->> 'kind' AND s.id = r ->> 'id';
      IF NOT FOUND THEN
        -- 다른 대기 인계에 이미 들어 있으면 CONFLICT, 그 밖(남의 자원 · 끝난 자원 · 없는 자원)은 NOT_FOUND
        IF EXISTS (SELECT 1 FROM workhub.transition_items i JOIN workhub.transition_records t ON t.id = i.record_id
                    WHERE i.school_id = p_ctx.school_id AND i.kind = r ->> 'kind' AND i.resource_id = r ->> 'id' AND t.state = 'pending'
                      AND t.requester_membership_id = p_ctx.membership_id) THEN
          RAISE EXCEPTION 'CONFLICT';
        END IF;
        RAISE EXCEPTION 'NOT_FOUND';
      END IF;
      IF x.version <> (r ->> 'version')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      -- 협업 요청을 그 요청을 보낸 사람에게 넘길 수는 없다(P2: 보낸 사람 ≠ 받는 사람). 수락 때 막히기 전에 미리보기에서 알린다.
      IF x.kind = 'cooperation' AND EXISTS (SELECT 1 FROM workhub.cooperation_requests cr WHERE cr.school_id = p_ctx.school_id AND cr.id = x.id
                                              AND (cr.sender_membership_id = m.id OR cr.sender_account_id = m.account_id)) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
      v_items := v_items || jsonb_build_object('kind', x.kind, 'id', x.id, 'version', x.version, 'label', x.label);
      v_lines := v_lines || to_jsonb(x.label);
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'kind' = 'duty') THEN
      v_excl := v_excl || to_jsonb('공식 담당은 수락한 날부터 받는 사람에게 넘어가고, 내 담당은 그 전날까지로 끝납니다.'::text);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'kind' = 'collection') THEN
      v_excl := v_excl || to_jsonb('수합의 제출 단위 담당 교사와 이미 받은 제출물은 그대로입니다(수합 관리자만 바뀝니다).'::text);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'kind' = 'cooperation') THEN
      v_excl := v_excl || to_jsonb('협업에 연결해 둔 내 개인 업무(할 일)는 넘어가지 않습니다.'::text);
    END IF;
    v_excl := v_excl || to_jsonb('받는 사람이 수락하기 전까지는 아무것도 넘어가지 않습니다.'::text);
    v_state := jsonb_build_object('recipient', m.id, 'recipientVersion', m.version, 'items', v_items);
    RETURN jsonb_build_object('state', v_state, 'summary', v_lines, 'excluded', v_excl, 'affectedCount', jsonb_array_length(v_items),
      'title', left('업무 인계: ' || v_name || ' (' || jsonb_array_length(v_items) || '건)', 200), 'items', v_items,
      'recipient', m.id, 'recipientAccount', m.account_id);
  END IF;

  -- 새 학년도
  IF NOT workhub_private.p7_admin_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.member_has_perm(p_ctx, 'year.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND id = p ->> 'sourceYearId';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND school_year = (p ->> 'targetYear')::smallint) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  v_first := (p ->> 'firstDay')::date;
  v_last := (p ->> 'lastDay')::date;
  IF EXISTS (SELECT 1 FROM workhub.academic_years WHERE school_id = p_ctx.school_id
               AND daterange(starts_on, ends_on, '[)') && daterange(v_first, v_last + 1, '[)'))
     OR EXISTS (SELECT 1 FROM workhub.terms WHERE school_id = p_ctx.school_id
               AND daterange(starts_on, ends_on, '[)') && daterange(v_first, v_last + 1, '[)')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF (p -> 'copyStructure')::boolean THEN
    SELECT count(*) INTO v_dep FROM workhub.year_departments WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL;
    SELECT count(*) INTO v_cls FROM workhub.year_classes WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL;
    SELECT count(*) INTO v_sub FROM workhub.year_subjects WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL;
  END IF;
  SELECT revision INTO v_rev FROM workhub.school_admin_activations WHERE school_id = p_ctx.school_id;
  v_lines := jsonb_build_array(
    (p ->> 'targetYear') || '학년도: ' || (p ->> 'firstDay') || ' ~ ' || (p ->> 'lastDay'),
    '1학기: ' || (p ->> 'term1First') || ' ~ ' || (p ->> 'term1Last'),
    '2학기: ' || (p ->> 'term2First') || ' ~ ' || (p ->> 'term2Last'),
    CASE WHEN (p -> 'copyStructure')::boolean
         THEN y.school_year || '학년도 구성 복사: 부서 ' || v_dep || '개 · 학급 ' || v_cls || '개 · 교과 ' || v_sub || '개'
         ELSE '구성(부서 · 학급 · 교과)은 복사하지 않습니다.' END);
  v_excl := jsonb_build_array('공식 담당 · 소속 · 수업 · 학생 명단은 복사하지 않습니다.',
                              '새 학년도는 준비 상태로 만들며, 현재 학년도는 바꾸지 않습니다.');
  -- 지문 재료: 원본 학년도의 판과 살아 있는 구성(ID · 판), 학교 관리 판
  v_state := jsonb_build_object('revision', v_rev, 'sourceVersion', y.version,
    'structure', CASE WHEN (p -> 'copyStructure')::boolean THEN jsonb_build_array(
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, version) ORDER BY id), '[]'::jsonb) FROM workhub.year_departments WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL),
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, version) ORDER BY id), '[]'::jsonb) FROM workhub.year_classes WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL),
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, version) ORDER BY id), '[]'::jsonb) FROM workhub.year_subjects WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL))
       ELSE '[]'::jsonb END);
  RETURN jsonb_build_object('state', v_state, 'summary', v_lines, 'excluded', v_excl, 'affectedCount', 3 + v_dep + v_cls + v_sub,
    'title', (p ->> 'targetYear') || '학년도 만들기', 'items', '[]'::jsonb, 'recipient', NULL, 'recipientAccount', NULL);
END $$;

-- 지문: 계획(정규화) + 행위자 + 판정 상태 + 10분 칸
CREATE FUNCTION workhub_private.p7_fingerprint(p_ctx workhub_private.actor_context, p jsonb, p_state jsonb, p_bucket bigint) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_sha(jsonb_build_object('v', 'p7-transition-1', 'school', p_ctx.school_id, 'member', p_ctx.membership_id,
                                                   'account', p_ctx.account_id, 'plan', p, 'state', p_state, 'bucket', p_bucket))
$$;

CREATE FUNCTION workhub_private.p7_tr_preview(p_ctx workhub_private.actor_context, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; v_bucket bigint := workhub_private.p7_bucket(clock_timestamp());
BEGIN
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'transitions') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  e := workhub_private.p7_plan_eval(p_ctx, p);
  RETURN jsonb_build_object('fingerprint', workhub_private.p7_fingerprint(p_ctx, p, e -> 'state', v_bucket),
    'expiresAt', workhub_private.p2_ts(to_timestamp((v_bucket + 2) * 600)),
    'summary', e -> 'summary', 'excluded', e -> 'excluded', 'affectedCount', e -> 'affectedCount');
END $$;

-- 기록 DTO
CREATE FUNCTION workhub_private.p7_record_dto(t workhub.transition_records, p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'version', t.version, 'state', t.state,
    'canAccept', t.state = 'pending' AND t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id,
    'canCancel', t.state = 'pending' AND t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id,
    'summary', t.summary)
$$;

CREATE FUNCTION workhub_private.p7_tr_list(p_ctx workhub_private.actor_context, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cur jsonb; v_manage boolean; v_page jsonb; v_records jsonb; v_next text;
BEGIN
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'transitions') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_cur := workhub_private.p7_cursor_in(p_cursor, p_ctx.membership_id);
  v_manage := workhub_private.p7_can_manage_year(p_ctx);
  -- 내가 요청했거나 받는 기록 + (연도 관리자면) 새 학년도 기록. 새 것부터 50건씩(51번째가 있으면 다음 위치).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                                               'i', s.id, 'dto', s.dto) ORDER BY s.created_at DESC, s.id DESC), '[]'::jsonb)
    INTO v_page
    FROM (SELECT t.created_at, t.id, workhub_private.p7_record_dto(t, p_ctx) AS dto
            FROM workhub.transition_records t
           WHERE t.school_id = p_ctx.school_id
             AND ((t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)
               OR (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id)
               OR (t.kind = 'new_year' AND v_manage))
             AND (v_cur IS NULL OR (t.created_at, t.id) < ((v_cur ->> 't')::timestamptz, v_cur ->> 'i'))
           ORDER BY t.created_at DESC, t.id DESC
           LIMIT 51) s;
  SELECT COALESCE(jsonb_agg(x -> 'dto' ORDER BY n), '[]'::jsonb) INTO v_records
    FROM jsonb_array_elements(v_page) WITH ORDINALITY e(x, n) WHERE n <= 50;
  IF jsonb_array_length(v_page) > 50 THEN
    v_next := workhub_private.p7_cursor_out(jsonb_build_object('o', p_ctx.membership_id, 't', v_page -> 49 ->> 't', 'i', v_page -> 49 ->> 'i'));
  END IF;
  RETURN jsonb_build_object(
    'canManageYear', v_manage,
    'years', CASE WHEN v_manage THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', y.id, 'label', y.school_year || '학년도', 'year', y.school_year)
                                                           ORDER BY y.school_year DESC), '[]'::jsonb)
                                        FROM (SELECT * FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND id ~ '^[a-zA-Z0-9_-]{1,100}$'
                                               ORDER BY school_year DESC LIMIT 100) y)
                  ELSE '[]'::jsonb END,
    'recipients', (SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId', z.id, 'name', z.name, 'version', z.version) ORDER BY z.name, z.id), '[]'::jsonb)
                     FROM (SELECT m.id, left(a.display_name, 100) AS name, m.version
                             FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
                            WHERE m.school_id = p_ctx.school_id AND m.id ~ '^[a-zA-Z0-9_-]{1,100}$'
                              AND workhub_private.p7_recipient_ok(p_ctx, m.id)
                            ORDER BY left(a.display_name, 100), m.id LIMIT 500) z),
    'resources', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.kind, 'id', s.id, 'version', s.version, 'label', s.label)), '[]'::jsonb)
                    FROM (SELECT * FROM workhub_private.p7_resources(p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_ctx.school_today) LIMIT 200) s),
    'records', v_records,
    'nextCursor', v_next);
END $$;

-- ----------------------------------------------------------------------------
-- 5. 인계 · 새 학년도 — 명령
-- ----------------------------------------------------------------------------
-- 학교 관리 판을 하나 올리고 변경 원장 · 감사 · outbox 를 남긴다(P1 mutate 와 같은 기록 모양)
CREATE FUNCTION workhub_private.p7_admin_change(p_ctx workhub_private.actor_context, p_kind text, p_school_year smallint, p_target_type text,
  p_target text, p_key text, p_reason text, p_before jsonb, p_after jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rev bigint; v_change bigint;
BEGIN
  UPDATE workhub.school_admin_activations SET revision = revision + 1, updated_at = clock_timestamp()
   WHERE school_id = p_ctx.school_id AND state = 'active' RETURNING revision INTO v_rev;
  IF v_rev IS NULL THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  INSERT INTO workhub.school_admin_changes (school_id, revision, command_kind, school_year, target_type, target_id,
      actor_account_id, actor_membership_id, request_key, reason, before_state, after_state, school_date)
  VALUES (p_ctx.school_id, v_rev, p_kind, p_school_year, p_target_type, p_target, p_ctx.account_id, p_ctx.membership_id, p_key,
          p_reason, p_before, p_after, p_ctx.school_today)
  RETURNING id INTO v_change;
  PERFORM workhub_private.write_audit(p_ctx, 'school_admin.' || p_kind, 'school_admin', p_ctx.school_id, v_rev::integer, 'school', p_key,
    jsonb_build_object('school_year', p_school_year, 'change_id', v_change, 'source', 'transitions'));
  PERFORM workhub_private.emit_outbox(p_ctx, 'school_admin.changed', 'school_admin', p_ctx.school_id, v_rev::integer,
    jsonb_build_object('school_id', p_ctx.school_id, 'revision', v_rev, 'kind', p_kind));
  RETURN v_rev;
END $$;

-- 수락: 신청 때의 자원 판과 지금이 모두 같아야 한 번에 넘긴다(하나라도 다르면 전체 CONFLICT)
CREATE FUNCTION workhub_private.p7_accept_items(p_ctx workhub_private.actor_context, t workhub.transition_records, p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i workhub.transition_items; a workhub.staff_assignments; n workhub.staff_assignments; r workhub.cooperation_requests;
  c workhub.collections; o workhub.collection_operations; me workhub.memberships; v_to date; v_year smallint; v_before jsonb;
BEGIN
  SELECT * INTO me FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = p_ctx.membership_id;
  FOR i IN SELECT * FROM workhub.transition_items WHERE record_id = t.id
            ORDER BY CASE kind WHEN 'collection' THEN 1 WHEN 'cooperation' THEN 2 ELSE 3 END, resource_id LOOP
    IF i.kind = 'duty' THEN
      IF NOT (workhub_private.p7_ready(p_ctx.school_id, 'duty_handover') AND workhub_private.p7_admin_active(p_ctx.school_id)) THEN
        RAISE EXCEPTION 'NOT_READY';
      END IF;
      SELECT * INTO a FROM workhub.staff_assignments WHERE school_id = p_ctx.school_id AND id = i.resource_id FOR UPDATE;
      IF NOT FOUND OR a.membership_id <> t.requester_membership_id OR a.kind <> 'duty' OR a.status <> 'active' OR a.version <> i.resource_version
         OR NOT (a.valid_from < p_ctx.school_today AND p_ctx.school_today < a.valid_to) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      -- 받는 사람의 담당은 오늘부터 원래 마지막 날까지(내 소속이 그 전에 끝나면 소속 끝까지)
      v_to := LEAST(a.valid_to, COALESCE(me.valid_to, a.valid_to));
      IF v_to <= p_ctx.school_today THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      SELECT school_year INTO v_year FROM workhub.academic_years WHERE school_id = a.school_id AND id = a.academic_year_id;
      v_before := workhub_private.p1_assignment_dto(a);
      UPDATE workhub.staff_assignments SET valid_to = p_ctx.school_today, status = 'ended', ended_at = clock_timestamp(),
             ended_by_membership_id = p_ctx.membership_id, version = version + 1, updated_at = clock_timestamp()
       WHERE id = a.id RETURNING * INTO a;
      PERFORM workhub_private.p7_admin_change(p_ctx, 'end_assignment', v_year, 'staff_assignment', a.id, p_key,
        '업무 인계 수락(' || t.id || ')', v_before, workhub_private.p1_assignment_dto(a));
      INSERT INTO workhub.staff_assignments (school_id, academic_year_id, membership_id, kind, label, valid_from, valid_to, assigned_by_membership_id)
      VALUES (a.school_id, a.academic_year_id, p_ctx.membership_id, 'duty', a.label, p_ctx.school_today, v_to, p_ctx.membership_id)
      RETURNING * INTO n;
      PERFORM workhub_private.p7_admin_change(p_ctx, 'assign_duty', v_year, 'staff_assignment', n.id, p_key,
        '업무 인계 수락(' || t.id || ')', NULL, workhub_private.p1_assignment_dto(n));
    ELSIF i.kind = 'cooperation' THEN
      IF NOT workhub_private.p7_bridge() OR NOT workhub_private.p2_module_active(p_ctx.school_id, 'cooperation') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
      SELECT * INTO r FROM workhub.cooperation_requests WHERE school_id = p_ctx.school_id AND id = i.resource_id FOR UPDATE;
      IF NOT FOUND OR r.recipient_membership_id <> t.requester_membership_id OR r.recipient_account_id <> t.requester_account_id
         OR r.version <> i.resource_version OR r.status NOT IN ('requested','accepted','completion_requested')
         OR r.sender_account_id = p_ctx.account_id OR r.sender_membership_id = p_ctx.membership_id THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      PERFORM workhub_private.p7_change_on();
      UPDATE workhub.cooperation_requests SET recipient_membership_id = p_ctx.membership_id, recipient_account_id = p_ctx.account_id,
             version = version + 1, updated_at = clock_timestamp()
       WHERE id = r.id RETURNING * INTO r;
      PERFORM workhub_private.p7_change_off();
      INSERT INTO workhub.cooperation_history (school_id, request_id, version, action, actor_membership_id, actor_account_id, comment)
      VALUES (r.school_id, r.id, r.version, 'handover', p_ctx.membership_id, p_ctx.account_id, left('업무 인계 수락(' || t.id || ')', 2000));
    ELSE
      IF NOT workhub_private.p7_bridge() OR NOT workhub_private.p7_r1_readable() THEN RAISE EXCEPTION 'NOT_READY'; END IF;
      SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = i.resource_id FOR UPDATE;
      SELECT * INTO o FROM workhub.collection_operations WHERE school_id = p_ctx.school_id AND collection_id = i.resource_id FOR UPDATE;
      IF c.id IS NULL OR c.owner_membership_id <> t.requester_membership_id OR c.owner_account_id <> t.requester_account_id
         OR c.state <> 'published' OR COALESCE(o.phase, 'open') = 'archived' OR COALESCE(o.version, 1) <> i.resource_version THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      PERFORM workhub_private.p7_change_on();
      UPDATE workhub.collections SET owner_membership_id = p_ctx.membership_id, owner_account_id = p_ctx.account_id, version = version + 1
       WHERE school_id = c.school_id AND id = c.id;
      PERFORM workhub_private.p7_change_off();
      IF o.collection_id IS NULL THEN
        INSERT INTO workhub.collection_operations (school_id, collection_id, phase, version) VALUES (c.school_id, c.id, 'open', 2) RETURNING * INTO o;
      ELSE
        UPDATE workhub.collection_operations SET version = version + 1 WHERE school_id = c.school_id AND collection_id = c.id RETURNING * INTO o;
      END IF;
      INSERT INTO workhub.collection_operation_history (school_id, collection_id, version, kind, phase_before, phase_after, due_before, due_after,
          reason, actor_membership_id, actor_account_id, request_key)
      VALUES (c.school_id, c.id, o.version, 'handover', o.phase, o.phase, c.due_on, c.due_on, left('업무 인계 수락(' || t.id || ')', 1000),
              p_ctx.membership_id, p_ctx.account_id, p_key);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION workhub_private.p7_tr_mutate(p_ctx workhub_private.actor_context, p_cmd jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q workhub.operation_requests; t workhub.transition_records; e jsonb; y workhub.academic_years; v_hash text; v_kind text;
  v_bucket bigint := workhub_private.p7_bucket(clock_timestamp()); v_now timestamptz := clock_timestamp(); v_resp jsonb;
  v_state text; v_plan jsonb; v_ord integer := 0; it jsonb; v_rev bigint; v_target text; v_notify text;
BEGIN
  IF NOT workhub_private.p7_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_hash := workhub_private.p2_sha(p_cmd);
  PERFORM workhub_private.p7_lock(p_ctx, 'transitions', p_key);
  q := workhub_private.p7_ledger(p_ctx, 'transitions', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'transitions') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF p_cmd IS NULL OR jsonb_typeof(p_cmd) <> 'object' OR jsonb_typeof(p_cmd -> 'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_kind := p_cmd ->> 'kind';

  IF v_kind = 'apply' THEN
    IF NOT workhub_private.p2_exact(p_cmd, ARRAY['kind','plan','fingerprint']) OR jsonb_typeof(p_cmd -> 'fingerprint') IS DISTINCT FROM 'string'
       OR (p_cmd ->> 'fingerprint') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_plan := p_cmd -> 'plan';
    e := workhub_private.p7_plan_eval(p_ctx, v_plan);
    -- 미리보기 뒤 상태가 바뀌었거나 지문이 만료(10~20분)되면 CONFLICT → 다시 미리보기
    IF (p_cmd ->> 'fingerprint') NOT IN (workhub_private.p7_fingerprint(p_ctx, v_plan, e -> 'state', v_bucket),
                                         workhub_private.p7_fingerprint(p_ctx, v_plan, e -> 'state', v_bucket - 1)) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    IF v_plan ->> 'kind' = 'handover' THEN
      INSERT INTO workhub.transition_records (school_id, kind, title, requester_membership_id, requester_account_id, recipient_membership_id,
          recipient_account_id, state, version, note, plan, summary)
      VALUES (p_ctx.school_id, 'handover', e ->> 'title', p_ctx.membership_id, p_ctx.account_id, e ->> 'recipient', e ->> 'recipientAccount',
              'pending', 1, v_plan ->> 'note', v_plan, (e -> 'summary') || (e -> 'excluded') || jsonb_build_array('메모: ' || left(v_plan ->> 'note', 990)))
      RETURNING * INTO t;
      FOR it IN SELECT x FROM jsonb_array_elements(e -> 'items') x LOOP
        v_ord := v_ord + 1;
        INSERT INTO workhub.transition_items (record_id, school_id, ordinal, kind, resource_id, resource_version, label)
        VALUES (t.id, t.school_id, v_ord, it ->> 'kind', it ->> 'id', (it ->> 'version')::integer, it ->> 'label');
      END LOOP;
      v_notify := t.recipient_membership_id;
    ELSE
      INSERT INTO workhub.academic_years (school_id, school_year, starts_on, ends_on, state)
      VALUES (p_ctx.school_id, (v_plan ->> 'targetYear')::smallint, (v_plan ->> 'firstDay')::date, (v_plan ->> 'lastDay')::date + 1, 'planning')
      RETURNING * INTO y;
      INSERT INTO workhub.terms (school_id, academic_year_id, term_no, label, starts_on, ends_on)
      VALUES (y.school_id, y.id, 1, '1학기', (v_plan ->> 'term1First')::date, (v_plan ->> 'term1Last')::date + 1),
             (y.school_id, y.id, 2, '2학기', (v_plan ->> 'term2First')::date, (v_plan ->> 'term2Last')::date + 1);
      IF (v_plan -> 'copyStructure')::boolean THEN
        INSERT INTO workhub.year_departments (school_id, academic_year_id, name, sort_order)
        SELECT school_id, y.id, name, sort_order FROM workhub.year_departments
         WHERE school_id = y.school_id AND academic_year_id = v_plan ->> 'sourceYearId' AND removed_at IS NULL ORDER BY sort_order, id;
        INSERT INTO workhub.year_classes (school_id, academic_year_id, grade, class_no, name, kind, sort_order)
        SELECT school_id, y.id, grade, class_no, name, kind, sort_order FROM workhub.year_classes
         WHERE school_id = y.school_id AND academic_year_id = v_plan ->> 'sourceYearId' AND removed_at IS NULL ORDER BY sort_order, id;
        INSERT INTO workhub.year_subjects (school_id, academic_year_id, name, sort_order)
        SELECT school_id, y.id, name, sort_order FROM workhub.year_subjects
         WHERE school_id = y.school_id AND academic_year_id = v_plan ->> 'sourceYearId' AND removed_at IS NULL ORDER BY sort_order, id;
      END IF;
      v_rev := workhub_private.p7_admin_change(p_ctx, 'save_configuration', y.school_year, 'academic_year', y.id, p_key,
        '새 학년도 만들기(업무 전환)', NULL,
        jsonb_build_object('year_id', y.id, 'school_year', y.school_year, 'starts_on', y.starts_on, 'ends_on', y.ends_on, 'state', y.state,
                           'copied_from', v_plan ->> 'sourceYearId', 'copy_structure', (v_plan -> 'copyStructure')::boolean,
                           'affected', (e -> 'affectedCount')::integer));
      INSERT INTO workhub.transition_records (school_id, kind, title, requester_membership_id, requester_account_id, state, version, plan, summary, result_year_id)
      VALUES (p_ctx.school_id, 'new_year', e ->> 'title', p_ctx.membership_id, p_ctx.account_id, 'completed', 1, v_plan,
              (e -> 'summary') || (e -> 'excluded'), y.id)
      RETURNING * INTO t;
    END IF;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, request_key)
    VALUES (t.id, t.school_id, 1, 'apply', p_ctx.membership_id, p_ctx.account_id, p_key);
  ELSIF v_kind IN ('accept','reject','cancel') THEN
    IF NOT workhub_private.p2_exact(p_cmd, ARRAY['kind','recordId','expectedVersion','reason']) OR NOT workhub_private.p7_id(p_cmd -> 'recordId')
       OR NOT workhub_private.p7_pos(p_cmd -> 'expectedVersion') OR NOT workhub_private.p7_text(p_cmd -> 'reason', 1000) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO t FROM workhub.transition_records WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'recordId' FOR UPDATE;
    IF NOT FOUND OR NOT ((t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)
                         OR (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id)) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    -- 수락 · 거절은 받는 사람, 취소는 요청한 사람
    IF (v_kind IN ('accept','reject') AND NOT (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id))
       OR (v_kind = 'cancel' AND NOT (t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF t.version <> (p_cmd ->> 'expectedVersion')::integer OR t.state <> 'pending' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    -- 수락하는 사람은 지금도 받을 수 있는 사람이어야 한다(업무실 사용자 범위 · 오늘 유효)
    IF v_kind = 'accept' AND NOT workhub_private.p2_member_reachable(p_ctx.school_id, p_ctx.membership_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF v_kind = 'accept' THEN PERFORM workhub_private.p7_accept_items(p_ctx, t, p_key); END IF;
    v_state := CASE v_kind WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END;
    UPDATE workhub.transition_records SET state = v_state, version = 2 WHERE id = t.id RETURNING * INTO t;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, reason, request_key)
    VALUES (t.id, t.school_id, 2, v_kind, p_ctx.membership_id, p_ctx.account_id, p_cmd ->> 'reason', p_key);
    v_notify := CASE WHEN v_kind = 'cancel' THEN t.recipient_membership_id ELSE t.requester_membership_id END;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- 상대에게 사이트 알림(메신저가 준비된 학교만, 실패해도 명령 전체를 되돌린다)
  IF v_notify IS NOT NULL AND workhub_private.p3_messaging_reason(p_ctx.school_id) = 'ready' THEN
    PERFORM workhub_private.p3_notify(t.school_id, v_notify,
      CASE t.state WHEN 'pending' THEN '업무 인계 요청이 왔습니다' WHEN 'accepted' THEN '업무 인계가 수락되었습니다'
                   WHEN 'rejected' THEN '업무 인계가 거절되었습니다' ELSE '업무 인계 요청이 취소되었습니다' END,
      t.title, NULL, NULL, 'p7:transition:' || t.id || ':' || t.version);
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'transitions.' || CASE WHEN v_kind = 'apply' THEN 'apply_' || t.kind ELSE v_kind END,
    'transition', t.id, t.version, 'school', p_key,
    jsonb_build_object('kind', t.kind, 'state', t.state, 'items', (SELECT count(*) FROM workhub.transition_items WHERE record_id = t.id),
                       'year_id', t.result_year_id));
  v_resp := jsonb_build_object('requestKey', p_key, 'recordId', t.id, 'version', t.version, 'state', t.state, 'recordedAt', workhub_private.p2_ts(v_now));
  PERFORM workhub_private.p7_record(p_ctx, 'transitions', p_key, v_hash, t.id, v_resp);
  RETURN v_resp;
END $$;

-- ----------------------------------------------------------------------------
-- 6. 공통 실행 — 업무 오류는 봉투로, 그 밖은 그대로 올린다(앱: 읽기 QUERY_FAILED · 쓰기 RESULT_UNKNOWN)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p7_run(p_ctx workhub_private.actor_context, p_contract text, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT workhub_private.p7_installed() THEN RETURN workhub_private.p7_err(p_ctx, p_contract, 'NOT_READY'); END IF;
  BEGIN
    IF p_op = 'ops_get' THEN v := workhub_private.p7_ops_get(p_ctx, a ->> 'id');
    ELSIF p_op = 'ops_mutate' THEN v := workhub_private.p7_ops_mutate(p_ctx, a -> 'command', a ->> 'key');
    ELSIF p_op = 'home' THEN v := workhub_private.p7_home(p_ctx);
    ELSIF p_op = 'tr_list' THEN v := workhub_private.p7_tr_list(p_ctx, a ->> 'cursor');
    ELSIF p_op = 'tr_preview' THEN v := workhub_private.p7_tr_preview(p_ctx, a -> 'plan');
    ELSIF p_op = 'tr_mutate' THEN v := workhub_private.p7_tr_mutate(p_ctx, a -> 'command', a ->> 'key');
    ELSE RAISE EXCEPTION 'P7_UNKNOWN_OPERATION';
    END IF;
    RETURN workhub_private.p7_ok(p_ctx, p_contract, v);
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p7_business(SQLERRM) THEN RETURN workhub_private.p7_err(p_ctx, p_contract, SQLERRM); END IF;
      RAISE;
    -- 동시 실행 경합(같은 수합의 첫 운영판 · 같은 학년도 · 공식 담당 기간 중복)은 제약이 한 줄로 세운다 → 확정 거절
    WHEN unique_violation OR exclusion_violation THEN
      RETURN workhub_private.p7_err(p_ctx, p_contract, 'CONFLICT');
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 7. 공개 함수 6개
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_collection_operations_get(p_member_id text, p_request_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p7_run(ctx, 'collection-operations.v1', 'ops_get', jsonb_build_object('id', p_request_id));
END $$;

CREATE FUNCTION public.workhub_collection_operations_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p7_run(ctx, 'collection-operations.v1', 'ops_mutate', jsonb_build_object('command', p_command, 'key', p_request_key));
END $$;

CREATE FUNCTION public.workhub_home_overview(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p7_run(ctx, 'home.v1', 'home', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_school_transition_list(p_member_id text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p7_run(ctx, 'school-transitions.v1', 'tr_list', jsonb_build_object('cursor', p_cursor));
END $$;

CREATE FUNCTION public.workhub_school_transition_preview(p_member_id text, p_plan jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p7_run(ctx, 'school-transitions.v1', 'tr_preview', jsonb_build_object('plan', p_plan));
END $$;

CREATE FUNCTION public.workhub_school_transition_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_school text;
BEGIN
  -- 학교 관리(P1) 판을 바꿀 수 있으므로 P1 mutate 와 같은 학교 잠금을 소속 잠금보다 먼저 잡는다(교착 방지).
  -- 같은 학교의 인계 · 학년도 명령도 이 잠금으로 한 줄로 선다(같은 자원을 두 인계에 동시에 넣지 못함).
  SELECT school_id INTO v_school FROM workhub.memberships WHERE id = p_member_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:' || COALESCE(v_school, '-'), 0));
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p7_run(ctx, 'school-transitions.v1', 'tr_mutate', jsonb_build_object('command', p_command, 'key', p_request_key));
END $$;

COMMENT ON FUNCTION public.workhub_collection_operations_get(text, text) IS '업무실 P7 수합 운영: 단계 · 기한 · 제출 단위 상태 합계(관리자는 단위 목록).';
COMMENT ON FUNCTION public.workhub_collection_operations_mutate(text, jsonb, text) IS '업무실 P7 수합 운영: 마감 · 보관 · 재개 · 기한 연장(P7-05 필요) · 제출 알림.';
COMMENT ON FUNCTION public.workhub_home_overview(text) IS '업무실 P7 홈 요약: 수합 · 보완 · 메시지 · 학생 후속 · 협업 할 일.';
COMMENT ON FUNCTION public.workhub_school_transition_list(text, text) IS '업무실 P7 업무 전환: 받을 사람 · 인계할 자원 · 기록 목록.';
COMMENT ON FUNCTION public.workhub_school_transition_preview(text, jsonb) IS '업무실 P7 업무 전환: 인계 · 새 학년도 미리보기와 지문.';
COMMENT ON FUNCTION public.workhub_school_transition_mutate(text, jsonb, text) IS '업무실 P7 업무 전환: 적용 · 수락 · 거절 · 취소(요청 번호 · 지문 · 판).';

-- ----------------------------------------------------------------------------
-- 8. 권한 — 공개 함수 6개만 authenticated 에. 새 내부 함수는 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p7\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.workhub_collection_operations_get(text, text), public.workhub_collection_operations_mutate(text, jsonb, text),
  public.workhub_home_overview(text), public.workhub_school_transition_list(text, text), public.workhub_school_transition_preview(text, jsonb),
  public.workhub_school_transition_mutate(text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_collection_operations_get(text, text), public.workhub_collection_operations_mutate(text, jsonb, text),
  public.workhub_home_overview(text), public.workhub_school_transition_list(text, text), public.workhub_school_transition_preview(text, jsonb),
  public.workhub_school_transition_mutate(text, jsonb, text) TO authenticated;

INSERT INTO workhub_private.p7_installs (batch, release) VALUES ('P7-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 9. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
WITH expected(name, args) AS (VALUES
  ('workhub_collection_operations_get', 'p_member_id text, p_request_id text'),
  ('workhub_collection_operations_mutate', 'p_member_id text, p_command jsonb, p_request_key text'),
  ('workhub_home_overview', 'p_member_id text'),
  ('workhub_school_transition_list', 'p_member_id text, p_cursor text'),
  ('workhub_school_transition_preview', 'p_member_id text, p_plan jsonb'),
  ('workhub_school_transition_mutate', 'p_member_id text, p_command jsonb, p_request_key text')),
fn AS (
  SELECT e.name, p.oid, pg_get_function_arguments(p.oid) AS args, e.args AS want, p.prosecdef, p.proconfig
  FROM expected e LEFT JOIN pg_proc p ON p.proname = e.name AND p.pronamespace = 'public'::regnamespace)
SELECT 'P7-02-1' AS no, '공개 함수 6개 · 인자 일치 · 오버로드 없음' AS item,
       CASE WHEN count(*) = 6 AND count(*) FILTER (WHERE args = want) = 6 THEN 'ok' ELSE 'FAIL' END AS status,
       count(*) FILTER (WHERE args = want)::text AS value
FROM fn
UNION ALL
SELECT 'P7-02-2', '6개 모두 SECURITY DEFINER + search_path 고정',
       CASE WHEN count(*) = 6 AND bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM fn WHERE oid IS NOT NULL
UNION ALL
SELECT 'P7-02-3', 'authenticated 만 실행(anon · service_role · PUBLIC 없음)',
       CASE WHEN bool_and(has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                          AND NOT has_function_privilege('service_role', oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, ''
FROM fn WHERE oid IS NOT NULL
UNION ALL
SELECT 'P7-02-4', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p7\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P7-02-5', '수합 운영 · 홈 · 인계 · 공식 담당 인계 활성화 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module IN ('collection_ops','home','transitions','duty_handover')) = 0
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P7-02-6', '적용 기록 P7-01 · P7-02', CASE WHEN workhub_private.p7_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
