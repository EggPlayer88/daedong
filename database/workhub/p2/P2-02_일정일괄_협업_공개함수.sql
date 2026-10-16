-- ============================================================================
-- P2-02  일정 일괄 가져오기 · 협업 요청 — 공개 함수 7개 (비활성 설치)
--
-- ▣ 일정 일괄(calendar-batch.v1): workhub_calendar_batch_prepare · workhub_calendar_batch_commit
--   협업(cooperation.v1):         workhub_cooperation_catalog · _list · _get · _mutate
-- ▣ 모두 authenticated 만 실행. 학교·계정은 p_member_id 와 auth.uid() 로 서버가 정한다(R0 member_actor).
-- ▣ 응답: 성공 {ok:true, contractVersion, schoolId, memberId, ownerUserId, ...}
--         업무 거절 {ok:false, ..., code} — 쓰기 거절은 requestKey · commandHash · outcome:'rejected' 를 더하고, DB 변경 0.
--         로그인·소속 확인 실패(FORBIDDEN · INACTIVE_MEMBERSHIP)와 예상 밖 오류는 봉투 없는 예외(앱: CANCELLED · SAVE_UNCERTAIN · QUERY_FAILED).
-- ▣ 같은 요청 번호는 원래 결과(반영 또는 확정 거절)를 돌려준다. 모듈을 중지해도 재조회는 된다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p2_installs') IS NULL THEN
    RAISE EXCEPTION 'P2 중단: P2-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p2_installs WHERE batch = 'P2-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P2 중단: P2-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p2_installs WHERE batch = 'P2-02') THEN
    RAISE EXCEPTION 'P2 중단: P2-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'workhub\_calendar\_batch\_%' OR proname LIKE 'workhub\_cooperation\_%'
             OR proname IN ('p2_batch_apply','p2_coop_apply')) THEN
    RAISE EXCEPTION 'P2 중단: 같은 이름의 공개 함수가 이미 있습니다.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 일정 일괄 — 입력 검사 (앱 validateBatchInput · validateBatchCommit 과 같은 규칙)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p2_batch_draft_shape(d jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_exact(d, ARRAY['title','description','location','startDate','endDate','allDay','startTime','endTime','visibility','audience'])
     AND workhub_private.p2_exact(d -> 'audience', ARRAY['all','groups','includeMemberIds','excludeMemberIds'])
     AND jsonb_typeof(d -> 'audience' -> 'groups') = 'array' AND jsonb_array_length(d -> 'audience' -> 'groups') <= 100
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d -> 'audience' -> 'groups') g
                      WHERE NOT workhub_private.p2_exact(g, ARRAY['departmentIds','gradeIds','subjectIds']))
$$;

-- ----------------------------------------------------------------------------
-- 2. workhub_calendar_batch_prepare — 서버 비교(불변 미리보기). 일정을 쓰지 않는다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_calendar_batch_prepare(p_member_id text, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  C constant text := 'calendar-batch.v1';
  ctx workhub_private.actor_context; src workhub.calendar_import_sources; v_owned boolean := true;
  r jsonb; d jsonb; v_apply jsonb; led workhub.calendar_import_rows; e workhub.events; v_cur jsonb;
  v_state text; v_reason text; v_out jsonb := '[]'::jsonb; v_store jsonb := '[]'::jsonb; row_out jsonb;
  v_id text := gen_random_uuid()::text; v_exp timestamptz; v_hash text; v_body jsonb;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  IF NOT workhub_private.p2_installed() OR NOT workhub_private.p2_module_active(ctx.school_id, 'calendar_batch') THEN
    RETURN workhub_private.p2_fail(ctx, C, 'UNAVAILABLE');
  END IF;
  BEGIN
    IF NOT workhub_private.p2_exact(p_input, ARRAY['sourceKey','sourceLabel','fileHash','omittedColumns','rows'])
       OR NOT workhub_private.p2_id(p_input -> 'sourceKey') OR NOT workhub_private.p2_text(p_input -> 'sourceLabel', 160)
       OR jsonb_typeof(p_input -> 'fileHash') IS DISTINCT FROM 'string' OR p_input ->> 'fileHash' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(p_input -> 'omittedColumns') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input -> 'omittedColumns') > 30
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_input -> 'omittedColumns') x WHERE NOT workhub_private.p2_text(x, 500, true))
       OR jsonb_typeof(p_input -> 'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input -> 'rows') NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_input -> 'rows') x
                WHERE NOT workhub_private.p2_exact(x, ARRAY['key','line','sourceId','sourceHash','draft'])
                   OR NOT workhub_private.p2_id(x -> 'key') OR NOT workhub_private.p2_int(x -> 'line', 2, 1000)
                   OR NOT workhub_private.p2_text(x -> 'sourceId', 160) OR (x ->> 'sourceId') ~ '[\x01-\x1f]'
                   OR jsonb_typeof(x -> 'sourceHash') IS DISTINCT FROM 'string' OR x ->> 'sourceHash' !~ '^[a-f0-9]{64}$'
                   OR NOT workhub_private.p2_batch_draft_shape(x -> 'draft')
                   OR workhub_private.p2_sha(x -> 'draft') <> x ->> 'sourceHash')
       OR (SELECT count(DISTINCT x ->> 'key') <> count(*) OR count(DISTINCT x ->> 'sourceId') <> count(*) FROM jsonb_array_elements(p_input -> 'rows') x) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;

    SELECT * INTO src FROM workhub.calendar_import_sources WHERE school_id = ctx.school_id AND source_key = p_input ->> 'sourceKey';
    IF FOUND THEN v_owned := workhub_private.p2_source_editor(src, ctx); END IF;

    FOR r IN SELECT x FROM jsonb_array_elements(p_input -> 'rows') WITH ORDINALITY AS t(x, o) ORDER BY o LOOP
      d := r -> 'draft';
      v_apply := workhub_private.normalize_event_draft(d, ctx);   -- R0 일정 저장 규칙(어긋나면 INVALID_INPUT)
      v_state := NULL; v_reason := ''; v_cur := NULL; led := NULL; e := NULL;
      IF src.id IS NOT NULL AND NOT v_owned THEN
        v_state := 'held'; v_reason := '다른 교사가 관리하는 원본 묶음입니다. 원본 묶음 이름을 바꾸거나 담당자에게 요청해 주세요.';
      ELSE
        IF src.id IS NOT NULL THEN
          -- 비교 결과는 commit 이 계보 판(revision)·일정 판(version)으로 다시 확인하므로, 여기서는 잠그지 않는다.
          SELECT * INTO led FROM workhub.calendar_import_rows l WHERE l.source_id = src.id AND l.source_row_id = r ->> 'sourceId';
          IF led.id IS NOT NULL THEN SELECT * INTO e FROM workhub.events WHERE id = led.event_id AND school_id = ctx.school_id; END IF;
        END IF;
        IF led.id IS NULL THEN
          v_state := 'new';
        ELSIF e.id IS NULL OR e.deleted_at IS NOT NULL OR e.status <> 'active' THEN
          v_state := 'held'; v_reason := '사이트에서 삭제되었거나 취소된 일정입니다. 새로 만들지 않고 보류합니다.';
        ELSIF NOT workhub_private.p2_event_editable(e, ctx)
              OR NOT workhub_private.p2_draft_readable(e.author_account_id, led.baseline, ctx) THEN
          v_state := 'held'; v_reason := '이 계정으로 비교하거나 수정할 수 없는 일정입니다.';
        ELSIF e.author_account_id <> ctx.account_id AND v_apply ->> 'visibility' = 'private' THEN
          v_state := 'held'; v_reason := '다른 교사의 일정을 나만 보기로 바꿀 수 없습니다.';
        ELSE
          v_cur := workhub_private.p2_event_draft(e, ctx.school_timezone);
          IF v_cur = led.baseline THEN
            IF d = led.baseline THEN v_state := 'duplicate'; v_reason := '';
            ELSE v_state := 'changed'; v_reason := ''; END IF;
          ELSE
            v_state := 'conflict'; v_reason := '마지막 가져오기 뒤 사이트에서 바뀐 일정입니다. 전체 항목을 비교해 교체 여부를 정해 주세요.';
          END IF;
        END IF;
      END IF;
      row_out := jsonb_build_object('key', r -> 'key', 'line', r -> 'line', 'sourceId', r -> 'sourceId', 'sourceHash', r -> 'sourceHash',
        'state', v_state, 'reason', v_reason, 'incoming', d,
        'eventId', CASE WHEN v_state IN ('new','held') THEN NULL ELSE to_jsonb(e.id) END,
        'expectedVersion', CASE WHEN v_state IN ('new','held') THEN NULL ELSE to_jsonb(e.version) END,
        'baseline', CASE WHEN v_state IN ('new','held') THEN NULL ELSE led.baseline END,
        'current', CASE WHEN v_state IN ('new','held') THEN NULL ELSE workhub_private.event_dto(e, ctx.school_timezone) END);
      v_out := v_out || jsonb_build_array(row_out);
      v_store := v_store || jsonb_build_array(jsonb_build_object('key', r ->> 'key', 'sourceId', r ->> 'sourceId', 'sourceHash', r ->> 'sourceHash',
        'state', v_state, 'eventId', row_out -> 'eventId', 'expectedVersion', row_out -> 'expectedVersion',
        'ledgerRevision', CASE WHEN v_state IN ('new','held') THEN NULL ELSE to_jsonb(led.revision) END, 'apply', v_apply));
    END LOOP;

    v_exp := date_trunc('milliseconds', clock_timestamp()) + interval '30 minutes';
    v_body := jsonb_build_object('prepareId', v_id, 'sourceKey', p_input -> 'sourceKey', 'fileHash', p_input -> 'fileHash',
                                 'expiresAt', workhub_private.p2_ts(v_exp), 'rows', v_out);
    v_hash := workhub_private.p2_sha(v_body);
    INSERT INTO workhub.calendar_import_prepares (id, school_id, account_id, membership_id, source_key, source_label, source_id,
        file_hash, omitted_columns, rows, preview_hash, expires_at)
    VALUES (v_id, ctx.school_id, ctx.account_id, ctx.membership_id, p_input ->> 'sourceKey', p_input ->> 'sourceLabel', src.id,
        p_input ->> 'fileHash', p_input -> 'omittedColumns', v_store, v_hash, v_exp);
    RETURN workhub_private.p2_ok(ctx, C, v_body || jsonb_build_object('previewHash', v_hash));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IN ('INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT') THEN RETURN workhub_private.p2_fail(ctx, C, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 3. 일정 일괄 commit 본체 — 선택한 모든 행을 한 트랜잭션에서. 하나라도 어긋나면 전체 미적용(예외).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p2_batch_apply(ctx workhub_private.actor_context, cmd jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p workhub.calendar_import_prepares; src workhub.calendar_import_sources; led workhub.calendar_import_rows; e workhub.events;
  s jsonb; pr jsonb; d jsonb; v_batch text := gen_random_uuid()::text; v_items jsonb := '[]'::jsonb; v_audit jsonb := '[]'::jsonb;
  v_starts timestamptz; v_ends timestamptz; v_set text; v_kind text; v_at timestamptz := clock_timestamp();
BEGIN
  IF NOT workhub_private.p2_module_active(ctx.school_id, 'calendar_batch') THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
  IF NOT workhub_private.p2_exact(cmd, ARRAY['kind','prepareId','previewHash','selections']) OR cmd ->> 'kind' IS DISTINCT FROM 'calendar_batch_commit'
     OR jsonb_typeof(cmd -> 'kind') <> 'string' OR NOT workhub_private.p2_id(cmd -> 'prepareId')
     OR jsonb_typeof(cmd -> 'previewHash') IS DISTINCT FROM 'string' OR cmd ->> 'previewHash' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(cmd -> 'selections') IS DISTINCT FROM 'array' OR jsonb_array_length(cmd -> 'selections') NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(cmd -> 'selections') x
              WHERE NOT workhub_private.p2_exact(x, ARRAY['key','sourceId','sourceHash','eventId','expectedVersion','decision'])
                 OR NOT workhub_private.p2_id(x -> 'key') OR NOT workhub_private.p2_text(x -> 'sourceId', 160)
                 OR jsonb_typeof(x -> 'sourceHash') IS DISTINCT FROM 'string' OR x ->> 'sourceHash' !~ '^[a-f0-9]{64}$'
                 OR NOT CASE x ->> 'decision'
                          WHEN 'create' THEN x -> 'eventId' = 'null'::jsonb AND x -> 'expectedVersion' = 'null'::jsonb
                          WHEN 'update' THEN workhub_private.p2_id(x -> 'eventId') AND workhub_private.p2_int(x -> 'expectedVersion')
                          WHEN 'replace_conflict' THEN workhub_private.p2_id(x -> 'eventId') AND workhub_private.p2_int(x -> 'expectedVersion')
                          ELSE false END)
     OR (SELECT count(DISTINCT x ->> 'key') <> count(*) OR count(DISTINCT x ->> 'sourceId') <> count(*) FROM jsonb_array_elements(cmd -> 'selections') x) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  SELECT * INTO p FROM workhub.calendar_import_prepares
   WHERE id = cmd ->> 'prepareId' AND school_id = ctx.school_id AND account_id = ctx.account_id AND membership_id = ctx.membership_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p.preview_hash <> cmd ->> 'previewHash' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- 선택은 서버 미리보기의 행과 정확히 맞아야 한다(토큰에 없던 원본·일정·판·지문을 받지 않는다).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(cmd -> 'selections') x
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.rows) y
                                 WHERE y -> 'key' = x -> 'key' AND y -> 'sourceId' = x -> 'sourceId' AND y -> 'sourceHash' = x -> 'sourceHash'
                                   AND y -> 'eventId' = x -> 'eventId' AND y -> 'expectedVersion' = x -> 'expectedVersion'
                                   AND y ->> 'state' = CASE x ->> 'decision' WHEN 'create' THEN 'new' WHEN 'update' THEN 'changed' ELSE 'conflict' END)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF clock_timestamp() > p.expires_at THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL = '비교 결과가 만료되었습니다. 다시 비교해 주세요.'; END IF;

  -- 원본 묶음: 잠그고 담당자 확인. 비교 때 없던 묶음은 지금 만든다(그사이 남이 같은 key 를 만들었으면 충돌).
  SELECT * INTO src FROM workhub.calendar_import_sources WHERE school_id = ctx.school_id AND source_key = p.source_key FOR UPDATE;
  IF p.source_id IS NULL THEN
    IF FOUND THEN
      IF NOT workhub_private.p2_source_editor(src, ctx) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    ELSE
      INSERT INTO workhub.calendar_import_sources (school_id, source_key, label, created_by_account_id, created_by_membership_id)
      VALUES (ctx.school_id, p.source_key, p.source_label, ctx.account_id, ctx.membership_id) RETURNING * INTO src;
    END IF;
  ELSE
    IF NOT FOUND OR src.id <> p.source_id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF NOT workhub_private.p2_source_editor(src, ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.calendar_import_batches WHERE prepare_id = p.id) THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '이 비교 결과는 이미 다른 요청으로 적용되었습니다.';
  END IF;

  -- 잠금 순서 고정: 행 계보(sourceId 순) → 일정(id 순)
  PERFORM 1 FROM workhub.calendar_import_rows
   WHERE source_id = src.id AND source_row_id IN (SELECT x ->> 'sourceId' FROM jsonb_array_elements(cmd -> 'selections') x)
   ORDER BY source_row_id COLLATE "C" FOR UPDATE;
  PERFORM 1 FROM workhub.events
   WHERE school_id = ctx.school_id AND id IN (SELECT x ->> 'eventId' FROM jsonb_array_elements(cmd -> 'selections') x WHERE x ->> 'eventId' IS NOT NULL)
   ORDER BY id COLLATE "C" FOR UPDATE;

  FOR s IN SELECT x FROM jsonb_array_elements(cmd -> 'selections') WITH ORDINALITY AS t(x, o) ORDER BY o LOOP
    SELECT y INTO pr FROM jsonb_array_elements(p.rows) y WHERE y -> 'key' = s -> 'key';
    d := pr -> 'apply';
    led := NULL; e := NULL;
    SELECT * INTO led FROM workhub.calendar_import_rows WHERE source_id = src.id AND source_row_id = s ->> 'sourceId';
    IF s ->> 'decision' = 'create' THEN
      IF led.id IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL = '다른 가져오기가 이 원본 행을 먼저 연결했습니다.'; END IF;
    ELSE
      IF led.id IS NULL OR to_jsonb(led.revision) IS DISTINCT FROM pr -> 'ledgerRevision' OR led.event_id <> s ->> 'eventId' THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      SELECT * INTO e FROM workhub.events WHERE id = s ->> 'eventId' AND school_id = ctx.school_id;
      IF NOT FOUND OR e.deleted_at IS NOT NULL OR e.status <> 'active' OR to_jsonb(e.version) <> s -> 'expectedVersion' THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      IF NOT workhub_private.p2_event_editable(e, ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      IF e.author_account_id <> ctx.account_id AND d ->> 'visibility' = 'private' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    END IF;
    -- 저장(R0 workhub_calendar_save 와 같은 방식). 작성자는 바꾸지 않는다.
    v_kind := CASE WHEN d ->> 'visibility' = 'private' THEN 'personal' ELSE 'shared' END;
    IF (d ->> 'allDay')::boolean THEN v_starts := NULL; v_ends := NULL;
    ELSE
      v_starts := ((d ->> 'startDate') || ' ' || (d ->> 'startTime'))::timestamp AT TIME ZONE ctx.school_timezone;
      v_ends   := ((d ->> 'endDate')   || ' ' || (d ->> 'endTime'))::timestamp   AT TIME ZONE ctx.school_timezone;
    END IF;
    v_set := workhub_private.store_audience(ctx, d -> 'audience');
    IF s ->> 'decision' = 'create' THEN
      INSERT INTO workhub.events (scope, school_id, kind, visibility, title, description, location, all_day,
          start_date, end_date, starts_at, ends_at, audience_set_id, author_account_id, author_membership_id)
      VALUES ('school', ctx.school_id, v_kind, d ->> 'visibility', d ->> 'title', d ->> 'description', d ->> 'location',
          (d ->> 'allDay')::boolean, (d ->> 'startDate')::date, (d ->> 'endDate')::date, v_starts, v_ends, v_set,
          ctx.account_id, ctx.membership_id)
      RETURNING * INTO e;
      INSERT INTO workhub.calendar_import_rows (school_id, source_id, source_row_id, event_id, baseline, source_hash,
          applied_event_version, last_batch_id, applied_by_account_id, applied_at)
      VALUES (ctx.school_id, src.id, s ->> 'sourceId', e.id, d, s ->> 'sourceHash', e.version, v_batch, ctx.account_id, v_at);
    ELSE
      UPDATE workhub.events SET kind = v_kind, visibility = d ->> 'visibility', title = d ->> 'title',
          description = d ->> 'description', location = d ->> 'location', all_day = (d ->> 'allDay')::boolean,
          start_date = (d ->> 'startDate')::date, end_date = (d ->> 'endDate')::date, starts_at = v_starts, ends_at = v_ends,
          audience_set_id = v_set, current_revision_no = current_revision_no + 1, version = version + 1, updated_at = clock_timestamp()
       WHERE id = e.id RETURNING * INTO e;
      UPDATE workhub.calendar_import_rows SET baseline = d, source_hash = s ->> 'sourceHash', applied_event_version = e.version,
          last_batch_id = v_batch, applied_by_account_id = ctx.account_id, applied_at = v_at, revision = revision + 1
       WHERE id = led.id;
    END IF;
    INSERT INTO workhub.event_revisions (event_id, revision_no, scope_key, school_id, event_version, snapshot, change_kind, changed_by_account_id)
    VALUES (e.id, e.current_revision_no, e.scope_key, e.school_id, e.version, d, 'import_apply', ctx.account_id);
    PERFORM workhub_private.write_audit(ctx, 'event.import_apply', 'event', e.id, e.version,
      CASE WHEN e.visibility = 'private' THEN 'owner_only' ELSE 'school' END, p_key,
      jsonb_build_object('batch_id', v_batch, 'decision', s ->> 'decision'));
    PERFORM workhub_private.emit_outbox(ctx, 'event.saved', 'event', e.id, e.version, jsonb_build_object('event_id', e.id, 'version', e.version));
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', s -> 'key', 'sourceId', s -> 'sourceId', 'eventId', e.id, 'version', e.version));
    v_audit := v_audit || jsonb_build_array(jsonb_build_object('key', s -> 'key', 'sourceId', s -> 'sourceId', 'eventId', e.id,
                                                               'version', e.version, 'sourceHash', s -> 'sourceHash'));
  END LOOP;
  UPDATE workhub.calendar_import_sources SET revision = revision + 1, updated_at = v_at WHERE id = src.id;
  INSERT INTO workhub.calendar_import_batches (id, school_id, source_id, prepare_id, account_id, membership_id, request_key, items, applied_at)
  VALUES (v_batch, ctx.school_id, src.id, p.id, ctx.account_id, ctx.membership_id, p_key, v_audit, v_at);
  PERFORM workhub_private.write_audit(ctx, 'calendar.batch_commit', 'calendar_import_batch', v_batch, NULL, 'school', p_key,
    jsonb_build_object('source_id', src.id, 'prepare_id', p.id, 'items', jsonb_array_length(v_items)));
  RETURN jsonb_build_object('requestKey', p_key, 'prepareId', p.id, 'previewHash', p.preview_hash,
                            'appliedAt', workhub_private.p2_ts(v_at), 'items', v_items);
END $$;

-- ----------------------------------------------------------------------------
-- 4. 협업 변경 본체
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p2_coop_apply(ctx workhub_private.actor_context, cmd jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r workhub.cooperation_requests; t workhub.tasks; rm workhub.memberships; v_role text; v_next text; v_at timestamptz := clock_timestamp();
  v_due date; v_action text;
BEGIN
  IF NOT workhub_private.p2_module_active(ctx.school_id, 'cooperation') THEN RAISE EXCEPTION 'UNAVAILABLE'; END IF;
  IF cmd IS NULL OR jsonb_typeof(cmd) <> 'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF cmd ->> 'kind' = 'create' AND jsonb_typeof(cmd -> 'kind') = 'string' THEN
    IF NOT workhub_private.p2_exact(cmd, ARRAY['kind','recipientMemberId','title','description','dueDate','sourceTask'])
       OR NOT workhub_private.p2_id(cmd -> 'recipientMemberId') OR NOT workhub_private.p2_text(cmd -> 'title', 160)
       OR NOT workhub_private.p2_text(cmd -> 'description', 8000, true)
       OR jsonb_typeof(cmd -> 'dueDate') IS DISTINCT FROM 'string'
       OR (cmd ->> 'dueDate' <> '' AND workhub_private.p1_date(cmd ->> 'dueDate') IS NULL)
       OR NOT (cmd -> 'sourceTask' = 'null'::jsonb
               OR (workhub_private.p2_exact(cmd -> 'sourceTask', ARRAY['id','expectedVersion'])
                   AND workhub_private.p2_id(cmd -> 'sourceTask' -> 'id') AND workhub_private.p2_int(cmd -> 'sourceTask' -> 'expectedVersion'))) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF cmd ->> 'recipientMemberId' = ctx.membership_id THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_due := CASE WHEN cmd ->> 'dueDate' = '' THEN NULL ELSE workhub_private.p1_date(cmd ->> 'dueDate') END;
    -- 받는 사람: 같은 학교 · 지금 유효한 소속 · 활성 · 가입 승인. 상태 변경과 직렬화(FOR SHARE).
    SELECT * INTO rm FROM workhub.memberships WHERE school_id = ctx.school_id AND id = cmd ->> 'recipientMemberId' FOR SHARE;
    IF NOT FOUND OR NOT workhub_private.p2_member_reachable(ctx.school_id, rm.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF rm.account_id = ctx.account_id THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF cmd -> 'sourceTask' <> 'null'::jsonb THEN
      SELECT * INTO t FROM workhub.tasks
       WHERE id = cmd -> 'sourceTask' ->> 'id' AND school_id = ctx.school_id AND owner_account_id = ctx.account_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF to_jsonb(t.version) <> cmd -> 'sourceTask' -> 'expectedVersion' OR t.status NOT IN ('todo','doing','waiting') THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
    END IF;
    INSERT INTO workhub.cooperation_requests (school_id, sender_membership_id, sender_account_id, recipient_membership_id, recipient_account_id,
        title, description, due_on, status, version, created_at, updated_at)
    VALUES (ctx.school_id, ctx.membership_id, ctx.account_id, rm.id, rm.account_id,
        workhub_private.js_trim(cmd ->> 'title'), workhub_private.js_trim(cmd ->> 'description'), v_due, 'requested', 1, v_at, v_at)
    RETURNING * INTO r;
    INSERT INTO workhub.cooperation_history (school_id, request_id, version, action, actor_membership_id, actor_account_id, comment, recorded_at)
    VALUES (ctx.school_id, r.id, 1, 'create', ctx.membership_id, ctx.account_id, '', v_at);
    IF t.id IS NOT NULL THEN
      INSERT INTO workhub.cooperation_task_links (school_id, request_id, account_id, task_id, linked_at) VALUES (ctx.school_id, r.id, ctx.account_id, t.id, v_at);
    END IF;
    v_action := 'create';
  ELSIF cmd ->> 'kind' = 'transition' AND jsonb_typeof(cmd -> 'kind') = 'string' THEN
    IF NOT workhub_private.p2_exact(cmd, ARRAY['kind','requestId','expectedVersion','action','comment'])
       OR NOT workhub_private.p2_id(cmd -> 'requestId') OR NOT workhub_private.p2_int(cmd -> 'expectedVersion')
       OR jsonb_typeof(cmd -> 'action') IS DISTINCT FROM 'string'
       OR cmd ->> 'action' NOT IN ('accept','decline','request_completion','confirm_completion','return_completion','retract_completion','cancel')
       OR NOT workhub_private.p2_text(cmd -> 'comment', 2000, cmd ->> 'action' IN ('accept','confirm_completion')) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_action := cmd ->> 'action';
    SELECT * INTO r FROM workhub.cooperation_requests WHERE id = cmd ->> 'requestId' AND school_id = ctx.school_id FOR UPDATE;
    IF NOT FOUND OR ctx.membership_id NOT IN (r.sender_membership_id, r.recipient_membership_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    v_role := CASE WHEN ctx.membership_id = r.sender_membership_id THEN 'sender' ELSE 'recipient' END;
    IF NOT workhub_private.p2_coop_role_action(v_role, v_action) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF to_jsonb(r.version) <> cmd -> 'expectedVersion' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_next := workhub_private.p2_coop_next(r.status, v_role, v_action);
    IF v_next IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    UPDATE workhub.cooperation_requests SET status = v_next, version = version + 1, updated_at = v_at WHERE id = r.id RETURNING * INTO r;
    INSERT INTO workhub.cooperation_history (school_id, request_id, version, action, actor_membership_id, actor_account_id, comment, recorded_at)
    VALUES (ctx.school_id, r.id, r.version, v_action, ctx.membership_id, ctx.account_id, workhub_private.js_trim(cmd ->> 'comment'), v_at);
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.write_audit(ctx, 'cooperation.' || v_action, 'cooperation_request', r.id, r.version, 'owner_only', p_key, '{}'::jsonb);
  PERFORM workhub_private.emit_outbox(ctx, 'cooperation.' || CASE v_action WHEN 'create' THEN 'requested' ELSE v_action END,
    'cooperation_request', r.id, r.version,
    jsonb_build_object('request_id', r.id, 'version', r.version, 'status', r.status,
                       'notify_membership_id', CASE WHEN ctx.membership_id = r.sender_membership_id THEN r.recipient_membership_id ELSE r.sender_membership_id END));
  RETURN jsonb_build_object('requestKey', p_key, 'commandKind', cmd ->> 'kind', 'entityId', r.id, 'version', r.version,
                            'appliedAt', workhub_private.p2_ts(v_at));
END $$;

-- ----------------------------------------------------------------------------
-- 5. 쓰기 공통 틀: 접수증 재조회 → 본체(하위 블록) → 반영/확정 거절 기록
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p2_write(p_ctx workhub_private.actor_context, p_contract text, p_module text,
                                        p_command jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(p_command); rc workhub.request_receipts; v_out jsonb; v_code text;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$' THEN
    -- 기록할 수 없는 요청 번호: 남기지 않고 거절만 한다.
    RETURN workhub_private.p2_fail(p_ctx, p_contract, 'INVALID_INPUT', COALESCE(p_key, ''), v_hash);
  END IF;
  rc := workhub_private.p2_receipt(p_ctx, p_module, p_key);
  IF rc.id IS NOT NULL THEN
    IF rc.command_hash <> v_hash THEN RETURN workhub_private.p2_fail(p_ctx, p_contract, 'IDEMPOTENCY_CONFLICT', p_key, v_hash); END IF;
    RETURN workhub_private.p2_replay(p_ctx, p_contract, rc);
  END IF;
  BEGIN
    v_out := CASE p_module WHEN 'calendar_batch' THEN workhub_private.p2_batch_apply(p_ctx, p_command, p_key)
                           WHEN 'cooperation' THEN workhub_private.p2_coop_apply(p_ctx, p_command, p_key) END;
    PERFORM workhub_private.p2_store(p_ctx, p_module, p_key, v_hash, NULL, v_out);
    RETURN workhub_private.p2_ok(p_ctx, p_contract, v_out || jsonb_build_object('outcome', 'applied'));
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT IN ('UNAVAILABLE','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT') THEN RAISE; END IF;
      v_code := SQLERRM;
    WHEN unique_violation OR exclusion_violation OR foreign_key_violation THEN
      v_code := 'CONFLICT';
  END;
  PERFORM workhub_private.p2_store(p_ctx, p_module, p_key, v_hash, v_code, jsonb_build_object('code', v_code));
  RETURN workhub_private.p2_fail(p_ctx, p_contract, v_code, p_key, v_hash);
END $$;

CREATE FUNCTION public.workhub_calendar_batch_commit(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  IF NOT workhub_private.p2_installed() THEN RETURN workhub_private.p2_fail(ctx, 'calendar-batch.v1', 'UNAVAILABLE'); END IF;
  RETURN workhub_private.p2_write(ctx, 'calendar-batch.v1', 'calendar_batch', p_command, p_request_key);
END $$;

-- ----------------------------------------------------------------------------
-- 6. 협업 조회
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_cooperation_catalog(p_member_id text, p_task_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  C constant text := 'cooperation.v1'; ctx workhub_private.actor_context; cur jsonb; v_n integer; v_tasks jsonb; v_next text;
  c_null boolean; c_due date; c_title text; c_id text;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  IF NOT workhub_private.p2_installed() OR NOT workhub_private.p2_module_active(ctx.school_id, 'cooperation') THEN
    RETURN workhub_private.p2_fail(ctx, C, 'UNAVAILABLE');
  END IF;
  IF p_task_cursor IS NOT NULL THEN
    BEGIN
      IF length(p_task_cursor) > 1024 OR p_task_cursor !~ '^[0-9a-f]+$' THEN RAISE EXCEPTION 'bad'; END IF;
      cur := convert_from(decode(p_task_cursor, 'hex'), 'UTF8')::jsonb;
      IF NOT workhub_private.p2_exact(cur, ARRAY['m','n','d','t','i']) OR cur ->> 'm' <> ctx.membership_id THEN RAISE EXCEPTION 'bad'; END IF;
      c_null := (cur ->> 'n')::boolean; c_due := (cur ->> 'd')::date; c_title := cur ->> 't'; c_id := cur ->> 'i';
    EXCEPTION WHEN others THEN
      RETURN workhub_private.p2_fail(ctx, C, 'INVALID_INPUT');
    END;
  END IF;
  -- 받을 수 있는 교사 500명 초과는 조용히 자르지 않는다(봉투 없는 예외 → 앱 QUERY_FAILED).
  SELECT count(*) INTO v_n FROM workhub.memberships m
   WHERE m.school_id = ctx.school_id AND m.id <> ctx.membership_id AND m.account_id <> ctx.account_id
     AND workhub_private.p2_member_reachable(ctx.school_id, m.id);
  IF v_n > 500 THEN RAISE EXCEPTION 'COOPERATION_LIMIT' USING DETAIL = '받는 사람 후보가 500명을 넘습니다. 검색 API 가 필요합니다.'; END IF;
  WITH tk AS (
    SELECT t.* FROM workhub.tasks t
     WHERE t.scope = 'school' AND t.school_id = ctx.school_id AND t.owner_account_id = ctx.account_id AND t.status IN ('todo','doing','waiting')
       AND (p_task_cursor IS NULL OR ROW(t.due_on IS NULL, COALESCE(t.due_on, 'infinity'::date), t.title COLLATE "C", t.id COLLATE "C")
                                      > ROW(c_null, COALESCE(c_due, 'infinity'::date), c_title COLLATE "C", c_id COLLATE "C"))
     ORDER BY t.due_on IS NULL, COALESCE(t.due_on, 'infinity'::date), t.title COLLATE "C", t.id COLLATE "C"
     LIMIT 41
  ), numbered AS (SELECT tk.*, row_number() OVER (ORDER BY tk.due_on IS NULL, COALESCE(tk.due_on, 'infinity'::date), tk.title COLLATE "C", tk.id COLLATE "C") AS n FROM tk)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'version', x.version) ORDER BY x.n) FILTER (WHERE x.n <= 40), '[]'::jsonb),
         CASE WHEN count(*) > 40 THEN
           encode(convert_to(jsonb_build_object('m', ctx.membership_id,
             'n', (SELECT y.due_on IS NULL FROM numbered y WHERE y.n = 40), 'd', (SELECT to_char(y.due_on, 'YYYY-MM-DD') FROM numbered y WHERE y.n = 40),
             't', (SELECT y.title FROM numbered y WHERE y.n = 40), 'i', (SELECT y.id FROM numbered y WHERE y.n = 40))::text, 'UTF8'), 'hex') END
    INTO v_tasks, v_next FROM numbered x;
  IF v_next IS NOT NULL AND length(v_next) > 1024 THEN RAISE EXCEPTION 'COOPERATION_LIMIT' USING DETAIL = '업무 목록 위치 값이 너무 깁니다.'; END IF;
  RETURN workhub_private.p2_ok(ctx, C, jsonb_build_object(
    'recipients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('memberId', m.id, 'name', left(a.display_name, 120),
               'description', COALESCE(left((SELECT string_agg(sa.label, ', ' ORDER BY sa.kind, sa.label)
                                             FROM workhub.staff_assignments sa
                                            WHERE sa.school_id = m.school_id AND sa.membership_id = m.id AND sa.status = 'active'
                                              AND ctx.school_today <@ daterange(sa.valid_from, sa.valid_to, '[)')), 160), ''))
             ORDER BY a.display_name, m.id)
        FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
       WHERE m.school_id = ctx.school_id AND m.id <> ctx.membership_id AND m.account_id <> ctx.account_id
         AND workhub_private.p2_member_reachable(ctx.school_id, m.id)), '[]'::jsonb),
    'sourceTasks', v_tasks, 'nextTaskCursor', to_jsonb(v_next)));
END $$;

CREATE FUNCTION public.workhub_cooperation_list(p_member_id text, p_filter jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  C constant text := 'cooperation.v1'; ctx workhub_private.actor_context; cur jsonb; v_fhash text; c_ts timestamptz; c_id text;
  v_q text; v_items jsonb; v_next text;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  IF NOT workhub_private.p2_installed() OR NOT workhub_private.p2_module_active(ctx.school_id, 'cooperation') THEN
    RETURN workhub_private.p2_fail(ctx, C, 'UNAVAILABLE');
  END IF;
  IF NOT workhub_private.p2_exact(p_filter, ARRAY['box','status','query','cursor'])
     OR jsonb_typeof(p_filter -> 'box') IS DISTINCT FROM 'string' OR p_filter ->> 'box' NOT IN ('received','sent')
     OR jsonb_typeof(p_filter -> 'status') IS DISTINCT FROM 'string'
     OR p_filter ->> 'status' NOT IN ('all','requested','accepted','declined','completion_requested','completed','cancelled')
     OR NOT workhub_private.p2_text(p_filter -> 'query', 200, true)
     OR NOT (p_filter -> 'cursor' = 'null'::jsonb OR workhub_private.p2_text(p_filter -> 'cursor', 1024)) THEN
    RETURN workhub_private.p2_fail(ctx, C, 'INVALID_INPUT');
  END IF;
  -- 위치 값은 이 소속·이 필터에만 맞는다(다른 필터의 위치로 건너뛰지 않게)
  v_fhash := workhub_private.p2_sha(jsonb_build_object('m', ctx.membership_id, 'b', p_filter -> 'box', 's', p_filter -> 'status', 'q', p_filter -> 'query'));
  IF p_filter -> 'cursor' <> 'null'::jsonb THEN
    BEGIN
      IF p_filter ->> 'cursor' !~ '^[0-9a-f]+$' THEN RAISE EXCEPTION 'bad'; END IF;
      cur := convert_from(decode(p_filter ->> 'cursor', 'hex'), 'UTF8')::jsonb;
      IF NOT workhub_private.p2_exact(cur, ARRAY['f','c','i']) OR cur ->> 'f' <> v_fhash THEN RAISE EXCEPTION 'bad'; END IF;
      c_ts := (cur ->> 'c')::timestamp AT TIME ZONE 'UTC'; c_id := cur ->> 'i';
    EXCEPTION WHEN others THEN
      RETURN workhub_private.p2_fail(ctx, C, 'INVALID_INPUT');
    END;
  END IF;
  v_q := lower(workhub_private.js_trim(p_filter ->> 'query'));
  WITH hit AS (
    SELECT r AS req, r.created_at, r.id FROM workhub.cooperation_requests r
     WHERE r.school_id = ctx.school_id
       AND CASE p_filter ->> 'box' WHEN 'received' THEN r.recipient_membership_id ELSE r.sender_membership_id END = ctx.membership_id
       AND (p_filter ->> 'status' = 'all' OR r.status = p_filter ->> 'status')
       AND (v_q = '' OR strpos(lower(r.title || chr(10) || r.description), v_q) > 0)
       AND (c_ts IS NULL OR ROW(r.created_at, r.id COLLATE "C") < ROW(c_ts, c_id COLLATE "C"))
     ORDER BY r.created_at DESC, r.id COLLATE "C" DESC
     LIMIT 41
  ), numbered AS (SELECT hit.*, row_number() OVER (ORDER BY hit.created_at DESC, hit.id COLLATE "C" DESC) AS n FROM hit)
  SELECT COALESCE(jsonb_agg(workhub_private.p2_coop_dto(x.req, ctx) ORDER BY x.n) FILTER (WHERE x.n <= 40), '[]'::jsonb),
         CASE WHEN count(*) > 40 THEN encode(convert_to(jsonb_build_object('f', v_fhash,
             'c', (SELECT to_char(y.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') FROM numbered y WHERE y.n = 40),
             'i', (SELECT y.id FROM numbered y WHERE y.n = 40))::text, 'UTF8'), 'hex') END
    INTO v_items, v_next FROM numbered x;
  RETURN workhub_private.p2_ok(ctx, C, jsonb_build_object('items', v_items, 'nextCursor', to_jsonb(v_next)));
END $$;

CREATE FUNCTION public.workhub_cooperation_get(p_member_id text, p_request_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE C constant text := 'cooperation.v1'; ctx workhub_private.actor_context; r workhub.cooperation_requests;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  IF NOT workhub_private.p2_installed() OR NOT workhub_private.p2_module_active(ctx.school_id, 'cooperation') THEN
    RETURN workhub_private.p2_fail(ctx, C, 'UNAVAILABLE');
  END IF;
  IF p_request_id IS NULL OR NOT workhub_private.p2_id(to_jsonb(p_request_id)) THEN RETURN workhub_private.p2_fail(ctx, C, 'INVALID_INPUT'); END IF;
  SELECT * INTO r FROM workhub.cooperation_requests WHERE id = p_request_id AND school_id = ctx.school_id;
  IF NOT FOUND OR ctx.membership_id NOT IN (r.sender_membership_id, r.recipient_membership_id) THEN
    RETURN workhub_private.p2_fail(ctx, C, 'NOT_FOUND');
  END IF;
  RETURN workhub_private.p2_ok(ctx, C, jsonb_build_object('request', workhub_private.p2_coop_dto(r, ctx),
    -- 이력의 actor 는 그때 처리한 사람 그대로다. 받는 사람이 바뀐 요청(P7 인계)에서도 앱이 행마다 당사자를 다시 맞춰 볼 수 있게
    --   recipientMemberId = 이 행이 적용된 뒤의 받는 사람(다음 인계 행의 이전 받는 사람, 없으면 지금 받는 사람)
    --   previousRecipientMemberId = 인계 행에서만 넘겨준 사람, 그 밖에는 null
    --   actorName = 처리한 사람 이름(이전 받는 사람은 요청 본문의 이름과 다르다)
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'actorMemberId', h.actor_membership_id,
                          'actorName', (SELECT left(a.display_name, 120) FROM workhub.accounts a WHERE a.id = h.actor_account_id),
                          'recipientMemberId', COALESCE((SELECT n.previous_recipient_membership_id FROM workhub.cooperation_history n
                                                          WHERE n.request_id = r.id AND n.action = 'handover' AND n.version > h.version
                                                          ORDER BY n.version LIMIT 1), r.recipient_membership_id),
                          'previousRecipientMemberId', h.previous_recipient_membership_id,
                          'comment', h.comment, 'recordedAt', workhub_private.p2_ts(h.recorded_at), 'version', h.version) ORDER BY h.version)
                         FROM workhub.cooperation_history h WHERE h.request_id = r.id), '[]'::jsonb)));
END $$;

CREATE FUNCTION public.workhub_cooperation_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  IF NOT workhub_private.p2_installed() THEN RETURN workhub_private.p2_fail(ctx, 'cooperation.v1', 'UNAVAILABLE'); END IF;
  RETURN workhub_private.p2_write(ctx, 'cooperation.v1', 'cooperation', p_command, p_request_key);
END $$;

COMMENT ON FUNCTION public.workhub_calendar_batch_prepare(text, jsonb) IS '업무실 P2 일정 일괄: 원본 행을 이전 가져오기·현재 일정과 비교(불변 미리보기, 일정 쓰기 없음).';
COMMENT ON FUNCTION public.workhub_calendar_batch_commit(text, jsonb, text) IS '업무실 P2 일정 일괄: 선택 행 전체를 한 트랜잭션으로 적용(요청 번호·계보·감사).';
COMMENT ON FUNCTION public.workhub_cooperation_catalog(text, text) IS '업무실 P2 협업: 받는 사람 후보와 내 원본 업무.';
COMMENT ON FUNCTION public.workhub_cooperation_list(text, jsonb) IS '업무실 P2 협업: 받은/보낸 요청 목록(서버 검색·페이지).';
COMMENT ON FUNCTION public.workhub_cooperation_get(text, text) IS '업무실 P2 협업: 요청과 상태 이력.';
COMMENT ON FUNCTION public.workhub_cooperation_mutate(text, jsonb, text) IS '업무실 P2 협업: 요청 만들기·상태 바꾸기(요청 번호·이력·알림 사건 한 트랜잭션).';

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
            WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p2\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.workhub_calendar_batch_prepare(text, jsonb), public.workhub_calendar_batch_commit(text, jsonb, text),
  public.workhub_cooperation_catalog(text, text), public.workhub_cooperation_list(text, jsonb), public.workhub_cooperation_get(text, text),
  public.workhub_cooperation_mutate(text, jsonb, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_calendar_batch_prepare(text, jsonb), public.workhub_calendar_batch_commit(text, jsonb, text),
  public.workhub_cooperation_catalog(text, text), public.workhub_cooperation_list(text, jsonb), public.workhub_cooperation_get(text, text),
  public.workhub_cooperation_mutate(text, jsonb, text) TO authenticated;

INSERT INTO workhub_private.p2_installs (batch, release) VALUES ('P2-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 7. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
WITH f(sig) AS (VALUES ('public.workhub_calendar_batch_prepare(text, jsonb)'), ('public.workhub_calendar_batch_commit(text, jsonb, text)'),
  ('public.workhub_cooperation_catalog(text, text)'), ('public.workhub_cooperation_list(text, jsonb)'),
  ('public.workhub_cooperation_get(text, text)'), ('public.workhub_cooperation_mutate(text, jsonb, text)'))
SELECT 'P2-02-1' AS no, '공개 함수 6개 · 인자 일치 · 오버로드 없음' AS item,
       CASE WHEN (SELECT count(*) FROM f WHERE to_regprocedure(sig) IS NOT NULL) = 6
             AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                    AND (proname LIKE 'workhub\_calendar\_batch\_%' OR proname LIKE 'workhub\_cooperation\_%')) = 6 THEN 'ok' ELSE 'FAIL' END AS status,
       (SELECT count(*) FROM f WHERE to_regprocedure(sig) IS NOT NULL)::text AS value
UNION ALL
SELECT 'P2-02-2', '6개 모두 SECURITY DEFINER + search_path 고정 · authenticated 만 실행',
       CASE WHEN bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM f JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
UNION ALL
SELECT 'P2-02-3', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P2-02-4', '모듈 활성화 0개 — 모든 학교 UNAVAILABLE', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text FROM workhub.module_activations
UNION ALL
SELECT 'P2-02-5', '적용 기록 P2-01·02', CASE WHEN workhub_private.p2_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
