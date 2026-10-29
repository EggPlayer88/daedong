-- AF1-02: 교환 후보 순서와 새 인계 알림 연결. 기존 알림과 요청 기록은 수정하지 않는다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM workhub_private.af1_installs WHERE batch='AF1-01') OR EXISTS(SELECT 1 FROM workhub_private.af1_installs WHERE batch='AF1-02') THEN RAISE EXCEPTION 'AF1 설치 순서를 확인하세요.';END IF;END $$;
DO $af$ DECLARE f regprocedure:='workhub_private.t2_recommend(workhub_private.actor_context,jsonb,text)'::regprocedure; b text; d text; BEGIN SELECT replace(prosrc,chr(13),''),replace(pg_get_functiondef(oid),chr(13),'') INTO b,d FROM pg_proc WHERE oid=f; IF md5(b)<>'5822d1ae11358c2f564e493f5a9bdfef' THEN RAISE EXCEPTION 'AF1: t2_recommend 원문 불일치'; END IF; EXECUTE replace(d,b,$body$
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
  -- 같은 학급 맞교환을 먼저 찾는다. 전체 40개 상한과 기존 충돌 판정은 유지한다.
  FOR opt IN
    SELECT 1 AS ord, (t ->> 'startsAt')::timestamptz AS s, jsonb_build_object('kind', 'move', 'lessonId', a.id, 'expectedVersion', a.version, 'target', t,
             'reason', i -> 'reason') AS inp, NULL::text AS other_label
      FROM jsonb_array_elements(va -> 'allowedTargets') t
     WHERE t <> va -> 'time' AND (t ->> 'startsAt')::timestamptz > v_now
       AND workhub_private.t2_in((t ->> 'startsAt')::timestamptz, (t ->> 'endsAt')::timestamptz, v_range, v_tz)
    UNION ALL
    SELECT CASE WHEN (SELECT array_agg(g->>'id' ORDER BY g->>'id') FROM jsonb_array_elements(a.groups) g) = (SELECT array_agg(g->>'id' ORDER BY g->>'id') FROM jsonb_array_elements(o.groups) g) THEN 0 ELSE 2 END, o.starts_at, jsonb_build_object('kind', 'swap', 'lessonId', a.id, 'expectedVersion', a.version, 'otherLessonId', o.id,
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
END $body$);END $af$;
DO $af$ DECLARE f regprocedure:='workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)'::regprocedure; b text; d text; nb text; v_op1 boolean := false;
BEGIN
 -- 이미 적용한 OP1 참여 제한을 새 인계 알림 함수에도 그대로 보존한다.
 IF to_regclass('workhub_private.op1_installs') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM workhub_private.op1_installs WHERE batch=''OP1-01'')' INTO v_op1;
  IF NOT v_op1 THEN RAISE EXCEPTION 'AF1: OP1 설치 기록을 확인하세요'; END IF;
 END IF;
 IF v_op1 IS DISTINCT FROM (to_regprocedure('workhub_private.op1_reachable_transitions(text,text)') IS NOT NULL) THEN
  RAISE EXCEPTION 'AF1: OP1 설치와 인계 참여 함수가 일치하지 않습니다';
 END IF;
 SELECT replace(prosrc,chr(13),''),replace(pg_get_functiondef(oid),chr(13),'') INTO b,d FROM pg_proc WHERE oid=f;
 IF md5(b)<>(CASE WHEN v_op1 THEN '390c1fa721426116119dc19c4ba96078' ELSE '7920e6628ffce39ceefab33e01d84898' END) THEN
  RAISE EXCEPTION 'AF1: p7_tr_mutate 원문 불일치';
 END IF;
 nb := $body$
DECLARE
  q workhub.operation_requests; t workhub.transition_records; e jsonb; y workhub.academic_years; v_hash text; v_kind text;
  v_bucket bigint := workhub_private.p7_bucket(clock_timestamp()); v_now timestamptz := clock_timestamp(); v_resp jsonb;
  v_state text; v_plan jsonb; v_ord integer := 0; it jsonb; v_rev bigint; v_from text; v_duty boolean; v_tstate jsonb;
  v_notify text[] := ARRAY[]::text[]; v_title text[] := ARRAY[]::text[]; k integer;
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
    PERFORM workhub_private.p7_plan_check(v_plan);
    v_duty := workhub_private.p8_plan_has_duty(v_plan);
    IF v_duty AND NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    e := workhub_private.p7_plan_eval(p_ctx, v_plan);
    v_tstate := workhub_private.p8_tr_state(e -> 'state', v_plan, p_ctx.school_id);
    -- 미리보기 뒤 상태 · 정책이 바뀌었거나 지문이 만료(10~20분)되면 CONFLICT → 다시 미리보기
    IF (p_cmd ->> 'fingerprint') NOT IN (workhub_private.p7_fingerprint(p_ctx, v_plan, v_tstate, v_bucket),
                                         workhub_private.p7_fingerprint(p_ctx, v_plan, v_tstate, v_bucket - 1)) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    IF v_plan ->> 'kind' = 'handover' THEN
      INSERT INTO workhub.transition_records (school_id, kind, title, requester_membership_id, requester_account_id, recipient_membership_id,
          recipient_account_id, state, version, note, plan, summary)
      VALUES (p_ctx.school_id, 'handover', e ->> 'title', p_ctx.membership_id, p_ctx.account_id, e ->> 'recipient', e ->> 'recipientAccount',
              CASE WHEN v_duty THEN 'awaiting_admin' ELSE 'pending' END, 1, v_plan ->> 'note', v_plan,
              (e -> 'summary') || (e -> 'excluded')
              || CASE WHEN v_duty THEN jsonb_build_array('공식 담당이 들어 있어 학교 관리자가 먼저 확인합니다. 확인 뒤에 받는 사람이 수락할 수 있습니다.')
                      ELSE '[]'::jsonb END
              || jsonb_build_array('메모: ' || left(v_plan ->> 'note', 990)))
      RETURNING * INTO t;
      FOR it IN SELECT x FROM jsonb_array_elements(e -> 'items') x LOOP
        v_ord := v_ord + 1;
        INSERT INTO workhub.transition_items (record_id, school_id, ordinal, kind, resource_id, resource_version, label)
        VALUES (t.id, t.school_id, v_ord, it ->> 'kind', it ->> 'id', (it ->> 'version')::integer, it ->> 'label');
      END LOOP;
      -- 관리자 확인 전에는 받는 사람에게 알리지 않는다(아직 수락할 수 없으므로)
      IF NOT v_duty THEN v_notify := ARRAY[t.recipient_membership_id]; v_title := ARRAY['업무 인계 요청이 왔습니다']; END IF;
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

  ELSIF v_kind IN ('admin_confirm','admin_reject') THEN
    IF NOT workhub_private.p2_exact(p_cmd, ARRAY['kind','recordId','expectedVersion','reason']) OR NOT workhub_private.p7_id(p_cmd -> 'recordId')
       OR NOT workhub_private.p7_pos(p_cmd -> 'expectedVersion') OR NOT workhub_private.p7_text(p_cmd -> 'reason', 1000) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO t FROM workhub.transition_records WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'recordId' FOR UPDATE;
    v_duty := t.id IS NOT NULL AND EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty');
    -- 관리자가 볼 수 있는 기록(공식 담당이 든 인계)이 아니면, 당사자에게는 FORBIDDEN · 그 밖에는 NOT_FOUND(있는지 알리지 않는다)
    IF NOT v_duty OR NOT workhub_private.p7_can_manage_year(p_ctx) THEN
      IF t.id IS NOT NULL AND ((t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)
                               OR (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id)) THEN
        RAISE EXCEPTION 'FORBIDDEN';
      END IF;
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    -- 자기 확인 금지: 요청자 · 받는 사람(같은 계정의 다른 소속 포함)은 관리자 자격으로 확인 · 반려하지 않는다
    IF t.requester_membership_id = p_ctx.membership_id OR t.requester_account_id = p_ctx.account_id
       OR t.recipient_membership_id = p_ctx.membership_id OR t.recipient_account_id = p_ctx.account_id THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF t.version <> (p_cmd ->> 'expectedVersion')::integer OR t.state <> 'awaiting_admin' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_kind = 'admin_confirm' THEN
      PERFORM workhub_private.p8_handover_recheck(p_ctx, t);
      v_from := t.state;
      UPDATE workhub.transition_records SET state = 'pending', version = 2 WHERE id = t.id RETURNING * INTO t;
      v_notify := ARRAY[t.recipient_membership_id, t.requester_membership_id];
      v_title := ARRAY['업무 인계 요청이 왔습니다', '업무 인계를 학교 관리자가 확인했습니다'];
    ELSE
      UPDATE workhub.transition_records SET state = 'rejected', version = 2 WHERE id = t.id RETURNING * INTO t;
      v_notify := ARRAY[t.requester_membership_id];
      v_title := ARRAY['업무 인계가 학교 관리자 확인에서 반려되었습니다'];
    END IF;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, reason, request_key)
    VALUES (t.id, t.school_id, 2, v_kind, p_ctx.membership_id, p_ctx.account_id, p_cmd ->> 'reason', p_key);

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
    -- 수락 · 거절은 pending(관리자 확인 대기 중에는 받는 사람이 처리할 수 없다), 취소는 pending · awaiting_admin
    IF t.version <> (p_cmd ->> 'expectedVersion')::integer
       OR (v_kind IN ('accept','reject') AND t.state <> 'pending') OR (v_kind = 'cancel' AND t.state NOT IN ('pending','awaiting_admin')) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    v_duty := EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty');
    -- 공식 담당 수락은 관리자 확인 계약이 켜져 있을 때만(관리자 확인 기록이 있는 pending 2 — 판 규칙이 보장)
    IF v_kind = 'accept' AND v_duty AND NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    -- 수락하는 사람은 지금도 받을 수 있는 사람이어야 한다(업무실 사용자 범위 · 오늘 유효)
    IF v_kind = 'accept' AND NOT workhub_private.p2_member_reachable(p_ctx.school_id, p_ctx.membership_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF v_kind = 'accept' THEN PERFORM workhub_private.p7_accept_items(p_ctx, t, p_key); END IF;
    v_from := t.state;
    v_state := CASE v_kind WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END;
    UPDATE workhub.transition_records SET state = v_state, version = t.version + 1 WHERE id = t.id RETURNING * INTO t;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, reason, request_key)
    VALUES (t.id, t.school_id, t.version, v_kind, p_ctx.membership_id, p_ctx.account_id, p_cmd ->> 'reason', p_key);
    IF v_kind = 'cancel' THEN
      -- 관리자 확인 전에 철회하면 받는 사람은 요청을 받은 적이 없으므로 알리지 않는다
      IF v_from = 'pending' THEN v_notify := ARRAY[t.recipient_membership_id]; v_title := ARRAY['업무 인계 요청이 취소되었습니다']; END IF;
    ELSE
      v_notify := ARRAY[t.requester_membership_id];
      v_title := ARRAY[CASE v_kind WHEN 'accept' THEN '업무 인계가 수락되었습니다' ELSE '업무 인계가 거절되었습니다' END];
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- 사이트 알림(메신저가 준비된 학교만, 실패하면 명령 전체를 되돌린다). 중복 방지 키 = 기록 · 판(받는 사람마다 1건)
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) = 'ready' THEN
    FOR k IN 1 .. COALESCE(array_length(v_notify, 1), 0) LOOP
      PERFORM workhub_private.p3_notify(t.school_id, v_notify[k], v_title[k], t.title, 'transitions', t.id, 'p7:transition:' || t.id || ':' || t.version);
    END LOOP;
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'transitions.' || CASE WHEN v_kind = 'apply' THEN 'apply_' || t.kind ELSE v_kind END,
    'transition', t.id, t.version, 'school', p_key,
    jsonb_build_object('kind', t.kind, 'state', t.state, 'items', (SELECT count(*) FROM workhub.transition_items WHERE record_id = t.id),
                       'year_id', t.result_year_id));
  v_resp := jsonb_build_object('requestKey', p_key, 'recordId', t.id, 'version', t.version, 'state', t.state, 'recordedAt', workhub_private.p2_ts(v_now));
  PERFORM workhub_private.p7_record(p_ctx, 'transitions', p_key, v_hash, t.id, v_resp);
  RETURN v_resp;
END $body$;
 IF v_op1 THEN nb:=replace(nb,'workhub_private.p2_member_reachable(','workhub_private.op1_reachable_transitions('); END IF;
 EXECUTE replace(d,b,nb);
END $af$;
DO $af$ DECLARE v text;BEGIN SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint WHERE conrelid='workhub.notifications'::regclass AND conname='notifications_source_check';IF md5(v)<>'d8bc24335b1b2e7e5b399390d10ca054' THEN RAISE EXCEPTION 'AF1: 알림 출처 제약 불일치';END IF;END $af$;
ALTER TABLE workhub.notifications DROP CONSTRAINT notifications_source_check;
ALTER TABLE workhub.notifications ADD CONSTRAINT notifications_source_check CHECK ((((source_module IS NULL) = (source_id IS NULL)) AND ((source_module IS NULL) OR (source_module = ANY (ARRAY['calendar'::text, 'tasks'::text, 'collections'::text, 'messages'::text, 'students'::text, 'knowledge'::text, 'cooperation'::text, 'timetable'::text, 'transitions'::text]))) AND ((source_id IS NULL) OR (source_id ~ '^[a-zA-Z0-9_-]{1,100}$'::text))));
INSERT INTO workhub_private.af1_installs(batch) VALUES('AF1-02');
COMMIT;
