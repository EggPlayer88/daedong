-- ============================================================================
-- P6-02  Claude 비서 — 서버 API 함수 4개(service_role) · 앱 함수 3개(authenticated)
--
-- ▣ 전제: P6-01 (판 2026-10-16.1).
-- ▣ 서버 API(PR #48 apps/main/api/workhub-ai/_assistant.py)가 부르는 함수: 사람 JWT 없이 service_role 로, 서버가 /auth/v1/user 로 확인한 UID 를 넘긴다.
--     workhub_ai_server_readiness · workhub_ai_prepare · workhub_ai_start · workhub_ai_finish
-- ▣ 앱(PR #48 apps/workhub/src/assistant/server.ts)이 부르는 함수: 로그인한 사람의 JWT 로.
--     workhub_ai_threads_list · workhub_ai_thread_get · workhub_ai_confirm_task
-- ▣ 외부 호출은 서버가 한다. DB 는 "누가 · 무엇을 근거로 · 얼마까지" 한 번 호출할 수 있는지를 정하고, 결과를 검사해 남긴다.
--   start 가 true 를 돌려준 요청만 외부 호출권을 가진다(같은 요청 번호로 두 번 받을 수 없다).
-- ▣ 이 파일만으로 켜지는 것은 없다(활성화 P6-04 전에는 NOT_READY).
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p6_installs') IS NULL THEN
    RAISE EXCEPTION 'P6 중단: P6-01(2026-10-16.1)을 먼저 적용해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p6_installs WHERE batch = 'P6-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P6 중단: P6-01(2026-10-16.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p6_installs WHERE batch = 'P6-02') THEN
    RAISE EXCEPTION 'P6 중단: P6-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'workhub\_ai\_%') THEN
    RAISE EXCEPTION 'P6 중단: 같은 이름의 함수(workhub_ai_*)가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 기술 상수 (정책값이 아니다)
--    임대 90초: prepare 와 start 사이의 간격만 덮는다(서버는 prepare 직후 start 를 부른다). 시작한 뒤에는 임대와 무관.
--    시작 뒤 10분: 그보다 오래 끝나지 않은 요청은 같은 대화의 다음 요청을 막지 않는다(결과는 계속 기다린다. 늦게 끝나면 보류).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p6_lease() RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT interval '90 seconds' $$;
CREATE FUNCTION workhub_private.p6_stale() RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT interval '10 minutes' $$;

-- ----------------------------------------------------------------------------
-- 2. 입력 판정 — 서버 request_input() · 앱 assistantInput() 과 같은 규칙. 어기면 INVALID_INPUT.
-- ----------------------------------------------------------------------------
-- 근거 한 줄(관찰·평가 원문 구간) 모양
CREATE FUNCTION workhub_private.p6_evidence_shape(e jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_exact(e, ARRAY['kind','id','revisionId','sourceHash','epoch','start','end'])
     AND jsonb_typeof(e -> 'kind') = 'string' AND e ->> 'kind' IN ('observation','assessment')
     AND workhub_private.p6_id(e -> 'id') AND workhub_private.p6_id(e -> 'revisionId')
     AND jsonb_typeof(e -> 'sourceHash') = 'string' AND (e ->> 'sourceHash') ~ '^[0-9a-f]{64}$'
     AND workhub_private.p6_int(e -> 'epoch', 0) AND workhub_private.p6_int(e -> 'start', 0) AND workhub_private.p6_int(e -> 'end', 1)
     AND (e ->> 'start')::numeric < (e ->> 'end')::numeric
$$;
CREATE FUNCTION workhub_private.p6_input(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE x jsonb; sc jsonb;
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['mode','intent','prompt','threadId','expectedVersion','references','studentContext'])
     OR jsonb_typeof(p -> 'mode') IS DISTINCT FROM 'string' OR p ->> 'mode' NOT IN ('school','personal')
     OR jsonb_typeof(p -> 'intent') IS DISTINCT FROM 'string'
     OR p ->> 'intent' NOT IN ('school_advice','personal_assistant','document_draft','student_record_draft','guided_collection')
     OR NOT workhub_private.p6_text(p -> 'prompt', 4000)
     OR NOT workhub_private.p6_int(p -> 'expectedVersion', 0)
     OR jsonb_typeof(p -> 'references') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'references') > 20 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p -> 'threadId' = 'null'::jsonb THEN
    IF (p ->> 'expectedVersion')::integer <> 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  ELSIF NOT workhub_private.p6_id(p -> 'threadId') OR (p ->> 'expectedVersion')::numeric < 1 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  FOR x IN SELECT v FROM jsonb_array_elements(p -> 'references') v LOOP
    IF NOT workhub_private.p2_exact(x, ARRAY['kind','id','version']) OR jsonb_typeof(x -> 'kind') IS DISTINCT FROM 'string'
       OR x ->> 'kind' NOT IN ('knowledge','calendar','task','collection','document')
       OR NOT workhub_private.p6_id(x -> 'id') OR NOT workhub_private.p6_int(x -> 'version', 1) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT v) FROM jsonb_array_elements(p -> 'references') v) <> jsonb_array_length(p -> 'references') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  sc := p -> 'studentContext';
  IF sc <> 'null'::jsonb THEN
    IF NOT workhub_private.p2_exact(sc, ARRAY['studentId','courseId','evidence'])
       OR NOT workhub_private.p6_id(sc -> 'studentId') OR NOT workhub_private.p6_id(sc -> 'courseId')
       OR jsonb_typeof(sc -> 'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(sc -> 'evidence') NOT BETWEEN 1 AND 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(sc -> 'evidence') e WHERE NOT workhub_private.p6_evidence_shape(e))
       OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(sc -> 'evidence') e) <> jsonb_array_length(sc -> 'evidence')
       OR p ->> 'intent' <> 'student_record_draft' OR p ->> 'mode' <> 'personal' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSIF p ->> 'intent' = 'student_record_draft' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p ->> 'intent' = 'personal_assistant' AND p ->> 'mode' <> 'personal' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
END $$;

-- 할 일 초안(앱 taskDraft): 제목 1~200 · 메모 0~4000 · 마감 '' 또는 날짜
CREATE FUNCTION workhub_private.p6_task_draft(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_exact(p, ARRAY['title','notes','dueDate'])
     AND workhub_private.p6_text(p -> 'title', 200) AND workhub_private.p6_text(p -> 'notes', 4000, false)
     AND workhub_private.p6_date(p -> 'dueDate', true)
$$;

-- ----------------------------------------------------------------------------
-- 3. 학생 근거가 지금도 유효한가 — P5 의 확인 함수를 그대로 쓴다(판·지문·세대·구간·철회·재검토·담당 범위).
--    예외를 삼켜 true/false 로만 돌려준다(이 블록 안의 잠금·쓰기는 없다).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p6_evidence_live(p_ctx workhub_private.actor_context, p_context jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_context IS NULL OR p_context = 'null'::jsonb THEN RETURN true; END IF;
  PERFORM workhub_private.p5_document_student_check(p_ctx, p_context);
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END $$;

-- 대화에 진행 중인 요청이 있는가(임대 중인 준비 · 시작한 지 10분 안의 호출)
CREATE FUNCTION workhub_private.p6_inflight(p_school text, p_thread text, p_except text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.assistant_requests r
                  WHERE r.school_id = p_school AND r.thread_id = p_thread AND r.id IS DISTINCT FROM p_except
                    AND ((r.state = 'claimed' AND r.lease_until > clock_timestamp())
                      OR (r.state = 'started' AND r.started_at > clock_timestamp() - workhub_private.p6_stale())))
$$;

-- ----------------------------------------------------------------------------
-- 4. 대화 응답 모양 (앱 assistantThread · 서버 public_thread)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p6_exchange_json(x workhub.assistant_exchanges) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', x.id, 'requestKey', x.request_key, 'intent', x.intent, 'prompt', x.prompt, 'segments', x.segments,
    'proposal', (SELECT jsonb_build_object('id', p.id, 'version', p.version, 'kind', 'create_personal_task',
                                           'input', COALESCE(p.applied_input, p.draft), 'status', p.status, 'resourceId', p.task_id)
                   FROM workhub.assistant_proposals p WHERE p.exchange_id = x.id),
    'createdAt', workhub_private.p2_ts(x.created_at), 'studentContext', COALESCE(x.student_context, 'null'::jsonb))
$$;

-- 대화 한 쪽: 아직 유효한 교환 중 최근 50개(응답 900,000바이트 이내), 오래된 것 → 새것 순. 그보다 오래된 것은 nextCursor.
--   p_upto  : 이 순번까지만(요청 결과를 그 시점 대화로 돌려줄 때)
--   p_before: 이 순번보다 앞(쪽 넘김)
--   학생 근거가 바뀐(정정·철회·담당 종료 등) 교환은 보여 주지 않는다.
CREATE FUNCTION workhub_private.p6_page(p_ctx workhub_private.actor_context, p_thread text, p_upto integer, p_before integer, p_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t workhub.assistant_threads; x workhub.assistant_exchanges; j jsonb; v_rows jsonb := '[]'::jsonb; v_n integer := 0;
        v_bytes bigint := 0; v_min integer; v_more boolean := false;
BEGIN
  SELECT * INTO t FROM workhub.assistant_threads WHERE school_id = p_ctx.school_id AND id = p_thread;
  FOR x IN SELECT * FROM workhub.assistant_exchanges e
            WHERE e.school_id = p_ctx.school_id AND e.thread_id = p_thread
              AND (p_upto IS NULL OR e.seq <= p_upto) AND (p_before IS NULL OR e.seq < p_before)
            ORDER BY e.seq DESC LOOP
    IF x.student_context IS NOT NULL AND NOT workhub_private.p6_evidence_live(p_ctx, x.student_context) THEN CONTINUE; END IF;
    j := workhub_private.p6_exchange_json(x);
    IF v_n >= 50 OR (v_n > 0 AND v_bytes + octet_length(j::text) > 900000) THEN v_more := true; EXIT; END IF;
    v_rows := jsonb_build_array(j) || v_rows; v_n := v_n + 1; v_bytes := v_bytes + octet_length(j::text); v_min := x.seq;
  END LOOP;
  RETURN jsonb_build_object('id', t.id, 'mode', t.mode, 'version', p_version, 'title', t.title, 'exchanges', v_rows,
    'nextCursor', CASE WHEN v_more THEN workhub_private.p6_cursor_out(jsonb_build_object('f', 'tg:' || p_ctx.membership_id || ':' || t.id,
                                                                                          'v', t.version, 's', v_min)) END);
END $$;

-- 요청의 공개 결과(재조회·완료 공통). completed 는 그 요청이 붙인 교환까지의 대화, 판은 기대 판 + 1.
CREATE FUNCTION workhub_private.p6_public(p_ctx workhub_private.actor_context, r workhub.assistant_requests) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x workhub.assistant_exchanges;
BEGIN
  IF r.state = 'completed' THEN
    SELECT * INTO x FROM workhub.assistant_exchanges WHERE id = r.exchange_id;
    IF x.student_context IS NOT NULL AND NOT workhub_private.p6_evidence_live(p_ctx, x.student_context) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    RETURN jsonb_build_object('state', 'completed', 'requestKey', r.request_key,
                              'thread', workhub_private.p6_page(p_ctx, x.thread_id, x.seq, NULL, r.expected_version + 1));
  ELSIF r.state = 'provider_unknown' THEN
    RETURN jsonb_build_object('state', 'pending', 'requestKey', r.request_key, 'reason', 'provider_unknown');
  ELSIF r.state IN ('rejected','resolved') THEN
    RETURN jsonb_build_object('state', 'rejected', 'requestKey', r.request_key, 'code', r.result ->> 'code');
  END IF;
  RETURN jsonb_build_object('state', 'pending', 'requestKey', r.request_key, 'reason', 'in_progress');
END $$;

-- ----------------------------------------------------------------------------
-- 5. 근거 모으기 — 요청 시점에 지금 열람할 수 있는 실제 판만. 모델에 보낼 본문을 만들고, snapshot(본문 제외)을 남긴다.
--    분류: school_public(학교 공개) · owner_private(나만/일부 대상) · student_learning(학생 근거).
--    학교 모드에는 school_public 만. 할 일은 언제나 owner_private.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p6_body(p text, p_fallback text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN workhub_private.js_trim(b) = '' THEN left(workhub_private.p6_clean(p_fallback), 16000) ELSE b END
    FROM (SELECT left(workhub_private.p6_clean(p), 16000) AS b) x
$$;
CREATE FUNCTION workhub_private.p6_label(p text, p_max integer, p_fallback text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN workhub_private.js_trim(b) = '' THEN p_fallback ELSE b END
    FROM (SELECT left(regexp_replace(COALESCE(p, ''), '[\x01-\x1f\x7f]', ' ', 'g'), p_max) AS b) x
$$;

CREATE FUNCTION workhub_private.p6_sources(p_ctx workhub_private.actor_context, r workhub.assistant_requests) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_in jsonb := r.input; x jsonb; e jsonb; v_out jsonb := '[]'::jsonb; v_n integer := 0; v_kind text; v_id text; v_ver integer;
        v_class text; v_title text; v_loc text; v_body text; v_ref jsonb; v_full text;
        ks workhub.knowledge_sources; d workhub.documents; dv workhub.document_versions; ev workhub.events; t workhub.tasks;
        c workhub.collections; tr workhub.teaching_records; trv workhub.teaching_record_revisions;
        a workhub.assessments; av workhub.assessment_revisions; sc jsonb := NULLIF(v_in -> 'studentContext', 'null'::jsonb);
        v_words text[]; v_need integer;
BEGIN
  IF jsonb_array_length(v_in -> 'references') + COALESCE(jsonb_array_length(sc -> 'evidence'), 0) > 30 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- (1) 사용자가 고른 자료
  FOR x IN SELECT v FROM jsonb_array_elements(v_in -> 'references') v LOOP
    v_kind := x ->> 'kind'; v_id := x ->> 'id'; v_ver := (x ->> 'version')::integer;
    IF v_kind = 'knowledge' THEN
      SELECT * INTO ks FROM workhub.knowledge_sources WHERE school_id = p_ctx.school_id AND id = v_id;
      IF ks.id IS NULL OR ks.status <> 'published' OR NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF ks.version <> v_ver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      v_class := 'school_public'; v_title := ks.title; v_loc := ks.locator; v_full := ks.body;
    ELSIF v_kind = 'document' THEN
      SELECT * INTO d FROM workhub.documents WHERE school_id = p_ctx.school_id AND id = v_id;
      SELECT * INTO dv FROM workhub.document_versions WHERE document_id = d.id AND version = d.latest_version;
      IF d.id IS NULL OR NOT workhub_private.p4_ready(p_ctx.school_id, 'documents') OR NOT workhub_private.p4_doc_sees(p_ctx, d, dv.visibility) THEN
        RAISE EXCEPTION 'NOT_FOUND';
      END IF;
      IF d.latest_version <> v_ver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      -- 학생 기록 초안 문서는 일반 자료로 넘기지 않는다(학생 근거는 studentContext 로만)
      IF dv.student_context IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      v_class := CASE WHEN dv.visibility = 'school' THEN 'school_public' ELSE 'owner_private' END;
      v_title := dv.title; v_loc := '문서함 ' || v_ver || '판'; v_full := dv.body;
    ELSIF v_kind = 'calendar' THEN
      SELECT * INTO ev FROM workhub.events WHERE school_id = p_ctx.school_id AND id = v_id;
      IF ev.id IS NULL OR NOT workhub_private.event_readable(ev, p_ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF ev.version <> v_ver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      v_class := CASE WHEN ev.visibility = 'school' THEN 'school_public' ELSE 'owner_private' END;
      v_title := ev.title;
      v_loc := '일정 ' || to_char(ev.start_date, 'YYYY-MM-DD') || CASE WHEN ev.end_date <> ev.start_date THEN '~' || to_char(ev.end_date, 'YYYY-MM-DD') ELSE '' END;
      v_full := concat_ws(E'\n', '제목: ' || ev.title, '기간: ' || to_char(ev.start_date, 'YYYY-MM-DD') || ' ~ ' || to_char(ev.end_date, 'YYYY-MM-DD'),
                          '장소: ' || NULLIF(ev.location, ''), '상태: ' || ev.status, NULLIF(ev.description, ''));
    ELSIF v_kind = 'task' THEN
      SELECT * INTO t FROM workhub.tasks WHERE scope = 'school' AND school_id = p_ctx.school_id AND id = v_id AND owner_account_id = p_ctx.account_id;
      IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF t.version <> v_ver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      v_class := 'owner_private'; v_title := t.title; v_loc := '내 할 일';
      v_full := concat_ws(E'\n', '제목: ' || t.title, '상태: ' || t.status, '마감: ' || to_char(t.due_on, 'YYYY-MM-DD'), NULLIF(t.note, ''));
    ELSE -- collection
      SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = v_id;
      IF c.id IS NULL OR NOT workhub_private.c_reads(p_ctx, c.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF c.version <> v_ver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      -- 수합은 참여자에게만 보이는 자료라 학교 공개로 보지 않는다
      v_class := 'owner_private'; v_title := c.title; v_loc := '수합 마감 ' || to_char(c.due_on, 'YYYY-MM-DD');
      v_full := concat_ws(E'\n', '제목: ' || c.title, '마감: ' || to_char(c.due_on, 'YYYY-MM-DD'), '상태: ' || c.state, NULLIF(c.purpose, ''));
    END IF;
    IF v_in ->> 'mode' = 'school' AND v_class <> 'school_public' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_n := v_n + 1;
    v_ref := jsonb_build_object('kind', v_kind, 'id', v_id, 'version', v_ver);
    v_title := workhub_private.p6_label(v_title, 200, '(제목 없음)');
    v_loc := workhub_private.p6_label(v_loc, 500, '위치 없음');
    v_body := workhub_private.p6_body(v_full, v_title);
    IF length(workhub_private.p6_clean(v_full)) > 16000 THEN
      v_loc := workhub_private.p6_label(v_loc || ' (앞 16,000자)', 500, '위치 없음');
    END IF;
    INSERT INTO workhub.assistant_request_sources (request_id, lease_token, source_key, school_id, kind, reference, title, locator, classification)
    VALUES (r.id, r.lease_token, 's' || v_n, r.school_id, v_kind, v_ref, v_title, v_loc, v_class);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 's' || v_n, 'reference', v_ref, 'title', v_title, 'locator', v_loc,
                                                           'classification', v_class, 'body', v_body));
  END LOOP;

  -- (2) 학생 근거: P5 확인을 통과한 현재 판의 정확한 구간만
  IF sc IS NOT NULL THEN
    PERFORM workhub_private.p5_document_student_check(p_ctx, sc);
    FOR e IN SELECT v FROM jsonb_array_elements(sc -> 'evidence') v LOOP
      IF (e ->> 'end')::integer - (e ->> 'start')::integer > 16000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      IF e ->> 'kind' = 'observation' THEN
        SELECT * INTO tr FROM workhub.teaching_records WHERE school_id = p_ctx.school_id AND id = e ->> 'id';
        SELECT * INTO trv FROM workhub.teaching_record_revisions WHERE id = tr.current_revision_id;
        v_full := trv.body; v_title := '관찰 기록 ' || to_char(trv.occurred_on, 'YYYY-MM-DD');
      ELSE
        SELECT * INTO a FROM workhub.assessments WHERE school_id = p_ctx.school_id AND id = e ->> 'id';
        SELECT * INTO av FROM workhub.assessment_revisions WHERE id = a.current_revision_id;
        v_full := av.comment; v_title := '평가 의견';
      END IF;
      v_body := workhub_private.p6_clean(substr(v_full, (e ->> 'start')::integer + 1, (e ->> 'end')::integer - (e ->> 'start')::integer));
      IF workhub_private.js_trim(v_body) = '' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      v_n := v_n + 1;
      v_loc := (e ->> 'start') || '~' || (e ->> 'end') || '자';
      INSERT INTO workhub.assistant_request_sources (request_id, lease_token, source_key, school_id, kind, reference, title, locator, classification)
      VALUES (r.id, r.lease_token, 's' || v_n, r.school_id, e ->> 'kind', e, v_title, v_loc, 'student_learning');
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', 's' || v_n, 'reference', e, 'title', v_title, 'locator', v_loc,
                                                             'classification', 'student_learning', 'body', v_body));
    END LOOP;
  END IF;

  -- (3) 학교 자료 찾아 붙이기: 학생 기록 초안이 아니면, 질문 낱말이 제목·본문에 든 게시 자료를 최대 5건(사용자가 고른 것 제외)
  v_need := LEAST(5, 30 - v_n);
  IF v_in ->> 'intent' <> 'student_record_draft' AND v_need > 0 AND workhub_private.p4_ready(p_ctx.school_id, 'knowledge') THEN
    SELECT array_agg(w) INTO v_words FROM (
      SELECT w, min(o) AS o FROM regexp_split_to_table(lower(v_in ->> 'prompt'), '[\s[:punct:]]+') WITH ORDINALITY s(w, o)
       WHERE length(w) >= 2 GROUP BY w ORDER BY 2 LIMIT 8) q;
    IF v_words IS NOT NULL THEN
      FOR ks IN SELECT s.* FROM workhub.knowledge_sources s
                 WHERE s.school_id = p_ctx.school_id AND s.status = 'published'
                   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_in -> 'references') rr WHERE rr ->> 'kind' = 'knowledge' AND rr ->> 'id' = s.id)
                   AND EXISTS (SELECT 1 FROM unnest(v_words) w WHERE s.title ILIKE workhub_private.p4_like(w) OR s.body ILIKE workhub_private.p4_like(w))
                 ORDER BY (SELECT count(*) FROM unnest(v_words) w WHERE s.title ILIKE workhub_private.p4_like(w)) * 2
                        + (SELECT count(*) FROM unnest(v_words) w WHERE s.body ILIKE workhub_private.p4_like(w)) DESC,
                          s.updated_at DESC, s.id COLLATE "C"
                 LIMIT v_need LOOP
        v_n := v_n + 1;
        v_ref := jsonb_build_object('kind', 'knowledge', 'id', ks.id, 'version', ks.version);
        v_title := workhub_private.p6_label(ks.title, 200, '(제목 없음)');
        v_loc := workhub_private.p6_label(ks.locator || CASE WHEN length(ks.body) > 16000 THEN ' (앞 16,000자)' ELSE '' END, 500, '위치 없음');
        v_body := workhub_private.p6_body(ks.body, v_title);
        INSERT INTO workhub.assistant_request_sources (request_id, lease_token, source_key, school_id, kind, reference, title, locator, classification)
        VALUES (r.id, r.lease_token, 's' || v_n, r.school_id, 'knowledge', v_ref, v_title, v_loc, 'school_public');
        v_out := v_out || jsonb_build_array(jsonb_build_object('key', 's' || v_n, 'reference', v_ref, 'title', v_title, 'locator', v_loc,
                                                               'classification', 'school_public', 'body', v_body));
      END LOOP;
    END IF;
  END IF;

  IF v_in ->> 'intent' = 'student_record_draft' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) s WHERE s ->> 'classification' = 'student_learning') THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  RETURN v_out;
END $$;

-- 이전 대화(같은 대화 · 아직 유효한 교환 · 학생 문맥이 있는 교환은 같은 학생 문맥일 때만) 최근 16교환 = 32메시지, 한 메시지 8,000자 이내
CREATE FUNCTION workhub_private.p6_history(p_ctx workhub_private.actor_context, p_thread text, p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x workhub.assistant_exchanges; v_ans text; v_out jsonb := '[]'::jsonb; v_n integer := 0;
BEGIN
  IF p_thread IS NULL THEN RETURN v_out; END IF;
  FOR x IN SELECT * FROM workhub.assistant_exchanges WHERE school_id = p_ctx.school_id AND thread_id = p_thread ORDER BY seq DESC LOOP
    EXIT WHEN v_n >= 16;
    IF x.student_context IS NOT NULL AND (x.student_context IS DISTINCT FROM NULLIF(p_context, 'null'::jsonb)
                                          OR NOT workhub_private.p6_evidence_live(p_ctx, x.student_context)) THEN
      CONTINUE;
    END IF;
    SELECT string_agg(s ->> 'text', E'\n\n' ORDER BY o) INTO v_ans FROM jsonb_array_elements(x.segments) WITH ORDINALITY q(s, o);
    IF length(v_ans) > 8000 THEN CONTINUE; END IF;
    v_out := jsonb_build_array(jsonb_build_object('role', 'user', 'content', x.prompt), jsonb_build_object('role', 'assistant', 'content', v_ans)) || v_out;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_out;
END $$;

-- ----------------------------------------------------------------------------
-- 6. 서버 API 함수 (service_role 전용)
-- ----------------------------------------------------------------------------
-- 준비 상태: 서버가 키 · 모델 설정과 함께 보는 DB 쪽 조건
CREATE FUNCTION public.workhub_ai_server_readiness(p_actor_user_id uuid, p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; pol workhub.assistant_policies;
BEGIN
  ctx := workhub_private.p6_service_member(p_actor_user_id, p_member_id);
  IF NOT workhub_private.p6_ready(ctx.school_id) THEN
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object('available', false, 'reason', 'not_configured'));
  END IF;
  pol := workhub_private.p6_policy(ctx.school_id);
  IF NOT workhub_private.p6_allowed(ctx, pol) THEN
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object('available', false, 'reason', 'not_allowed'));
  END IF;
  IF NOT workhub_private.p6_budget_ok(ctx.school_id, ctx.account_id, pol) THEN
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object('available', false, 'reason', 'budget_exhausted'));
  END IF;
  RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object('available', true));
END $$;

-- 준비(내부): 새 요청 또는 시작 전 임대가 끝난 요청을 다시 인수. 모든 확인을 처음부터 다시 한다.
CREATE FUNCTION workhub_private.p6_claim(p_ctx workhub_private.actor_context, p_input jsonb, p_key text, p_sha text, p_old workhub.assistant_requests)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pol workhub.assistant_policies; t workhub.assistant_threads; w date[]; r workhub.assistant_requests; v_src jsonb; v_thread text;
BEGIN
  IF NOT workhub_private.p6_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  pol := workhub_private.p6_policy(p_ctx.school_id);
  IF NOT workhub_private.p6_allowed(p_ctx, pol) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_thread := p_input ->> 'threadId';
  IF v_thread IS NOT NULL THEN
    SELECT * INTO t FROM workhub.assistant_threads
     WHERE school_id = p_ctx.school_id AND id = v_thread AND owner_account_id = p_ctx.account_id FOR UPDATE;
    IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF t.mode <> p_input ->> 'mode' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF t.version <> (p_input ->> 'expectedVersion')::integer OR workhub_private.p6_inflight(p_ctx.school_id, t.id, p_old.id) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
  END IF;
  -- 예산 확인과 예약은 학교 단위로 한 줄씩
  PERFORM workhub_private.p6_lock('budget' || chr(31) || p_ctx.school_id);
  IF NOT workhub_private.p6_budget_ok(p_ctx.school_id, p_ctx.account_id, pol, p_old.id) THEN RAISE EXCEPTION 'BUDGET_EXCEEDED'; END IF;
  w := workhub_private.p6_window(p_ctx.school_id);
  IF p_old.id IS NULL THEN
    INSERT INTO workhub.assistant_requests (school_id, owner_account_id, owner_membership_id, owner_auth_user_id, request_key, input, input_sha256,
        mode, intent, thread_id, expected_version, lease_token, lease_until, policy_version, reserved_micro_usd, budget_day, budget_month)
    VALUES (p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, p_ctx.auth_user_id, p_key, p_input, p_sha,
        p_input ->> 'mode', p_input ->> 'intent', v_thread, (p_input ->> 'expectedVersion')::integer,
        workhub_private.p6_token(), clock_timestamp() + workhub_private.p6_lease(), pol.version, pol.reserve_micro_usd, w[1], w[2])
    RETURNING * INTO r;
  ELSE
    UPDATE workhub.assistant_requests SET lease_token = workhub_private.p6_token(), lease_until = clock_timestamp() + workhub_private.p6_lease(),
           claims = claims + 1, policy_version = pol.version, reserved_micro_usd = pol.reserve_micro_usd, budget_day = w[1], budget_month = w[2],
           updated_at = clock_timestamp()
     WHERE id = p_old.id RETURNING * INTO r;
  END IF;
  v_src := workhub_private.p6_sources(p_ctx, r);
  RETURN jsonb_build_object('state', 'claimed', 'requestKey', p_key, 'leaseToken', r.lease_token, 'input', r.input,
    'history', workhub_private.p6_history(p_ctx, v_thread, p_input -> 'studentContext'),
    'sources', v_src,
    'policy', jsonb_build_object('approved', true, 'configVersion', pol.version, 'model', pol.model, 'maxTokens', pol.max_output_tokens,
      'budget', jsonb_build_object('reservationId', r.id, 'policyVersion', pol.version, 'currency', 'USD', 'reservedMicroUsd', pol.reserve_micro_usd,
                                   'dailyLimitMicroUsd', pol.member_daily_micro_usd, 'monthlyLimitMicroUsd', pol.member_monthly_micro_usd)));
END $$;

-- 준비: 같은 요청 번호면 원래 요청을 돌려준다(준비 상태보다 먼저 — 중지 중에도 응답 유실을 복구할 수 있게).
CREATE FUNCTION public.workhub_ai_prepare(p_actor_user_id uuid, p_member_id text, p_input jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; r workhub.assistant_requests; v_sha text;
BEGIN
  ctx := workhub_private.p6_service_member(p_actor_user_id, p_member_id);
  BEGIN
    IF NOT workhub_private.p6_key(p_request_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    PERFORM workhub_private.p6_input(p_input);
    v_sha := workhub_private.p2_sha(p_input);
    PERFORM workhub_private.p6_lock('req' || chr(31) || ctx.school_id || chr(31) || ctx.account_id || chr(31) || p_request_key);
    SELECT * INTO r FROM workhub.assistant_requests
     WHERE school_id = ctx.school_id AND owner_account_id = ctx.account_id AND request_key = p_request_key FOR UPDATE;
    IF r.id IS NOT NULL THEN
      IF r.input_sha256 <> v_sha OR r.owner_membership_id <> ctx.membership_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
      IF NOT (r.state = 'claimed' AND r.lease_until <= clock_timestamp()) THEN
        RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, workhub_private.p6_public(ctx, r));
      END IF;
    END IF;
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, workhub_private.p6_claim(ctx, p_input, p_request_key, v_sha, r));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(ctx.school_id, ctx.membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- 시작: 이 임대가 첫 외부 호출권을 확정한다. 이미 시작했거나 임대가 끝났으면 false(서버는 호출하지 않는다).
CREATE FUNCTION public.workhub_ai_start(p_actor_user_id uuid, p_member_id text, p_request_key text, p_lease_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; r workhub.assistant_requests;
BEGIN
  ctx := workhub_private.p6_service_member(p_actor_user_id, p_member_id);
  BEGIN
    IF NOT workhub_private.p6_key(p_request_key) OR p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    PERFORM workhub_private.p6_lock('req' || chr(31) || ctx.school_id || chr(31) || ctx.account_id || chr(31) || p_request_key);
    SELECT * INTO r FROM workhub.assistant_requests
     WHERE school_id = ctx.school_id AND owner_account_id = ctx.account_id AND owner_membership_id = ctx.membership_id
       AND request_key = p_request_key FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF r.state <> 'claimed' OR r.lease_token <> p_lease_token OR r.lease_until <= clock_timestamp() THEN
      RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object('started', false));
    END IF;
    -- 준비와 시작 사이에 중지(P2-80) · 설정 변경으로 허용 범위가 줄었으면 호출하지 않는다
    IF NOT workhub_private.p6_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    IF NOT workhub_private.p6_allowed(ctx, workhub_private.p6_policy(ctx.school_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    UPDATE workhub.assistant_requests SET state = 'started', started_at = clock_timestamp(), started_lease = p_lease_token, updated_at = clock_timestamp()
     WHERE id = r.id;
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object('started', true));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(ctx.school_id, ctx.membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- 끝 결과 모양 확인(서버 checked_output 의 세 모양). 어기면 INVALID_INPUT(아무것도 쓰지 않음).
CREATE FUNCTION workhub_private.p6_finish_shape(p jsonb, r workhub.assistant_requests) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; c jsonb; v_total integer := 0; v_state text := p ->> 'state';
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p -> 'state') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_state = 'provider_unknown' THEN
    IF NOT workhub_private.p2_exact(p, ARRAY['state','usage','providerMessageId']) OR p -> 'usage' <> 'null'::jsonb
       OR p -> 'providerMessageId' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    RETURN;
  END IF;
  IF v_state = 'rejected' THEN
    IF NOT workhub_private.p2_exact(p, ARRAY['state','code','usage','providerMessageId'])
       OR jsonb_typeof(p -> 'code') IS DISTINCT FROM 'string' OR p ->> 'code' NOT IN ('OUTPUT_INVALID','PROVIDER_REJECTED','TRUNCATED') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSIF v_state = 'completed' THEN
    IF NOT workhub_private.p2_exact(p, ARRAY['state','usage','providerMessageId','segments','taskDraft'])
       OR jsonb_typeof(p -> 'segments') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'segments') NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    FOR s IN SELECT v FROM jsonb_array_elements(p -> 'segments') v LOOP
      IF NOT workhub_private.p2_exact(s, ARRAY['text','citations']) OR NOT workhub_private.p6_text(s -> 'text', 4000)
         OR jsonb_typeof(s -> 'citations') IS DISTINCT FROM 'array' OR jsonb_array_length(s -> 'citations') > 30
         OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(s -> 'citations') v) <> jsonb_array_length(s -> 'citations') THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
      v_total := v_total + length(s ->> 'text');
      -- 인용은 이 임대의 근거 snapshot 과 정확히 같아야 한다(모델이 근거를 지어낼 수 없게)
      FOR c IN SELECT v FROM jsonb_array_elements(s -> 'citations') v LOOP
        IF NOT EXISTS (SELECT 1 FROM workhub.assistant_request_sources rs
                        WHERE rs.request_id = r.id AND rs.lease_token = r.started_lease
                          AND jsonb_build_object('reference', rs.reference, 'title', rs.title, 'locator', rs.locator) = c) THEN
          RAISE EXCEPTION 'INVALID_INPUT';
        END IF;
      END LOOP;
      IF r.intent = 'student_record_draft' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'citations') v
                                                            WHERE v #>> '{reference,kind}' IN ('observation','assessment')) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
    END LOOP;
    IF v_total > 40000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF p -> 'taskDraft' <> 'null'::jsonb AND (r.mode <> 'personal' OR r.intent <> 'personal_assistant' OR NOT workhub_private.p6_task_draft(p -> 'taskDraft')) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 사용량·응답 ID: 완료는 반드시, 거절은 있거나 없거나(둘 다 있거나 둘 다 null)
  IF v_state = 'completed' AND (p -> 'usage' = 'null'::jsonb OR p -> 'providerMessageId' = 'null'::jsonb) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p -> 'usage' <> 'null'::jsonb AND (NOT workhub_private.p2_exact(p -> 'usage', ARRAY['inputTokens','outputTokens'])
       OR NOT workhub_private.p6_int(p #> '{usage,inputTokens}', 0) OR NOT workhub_private.p6_int(p #> '{usage,outputTokens}', 0)
       OR (p #>> '{usage,inputTokens}')::numeric > 2147483647 OR (p #>> '{usage,outputTokens}')::numeric > 2147483647) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p -> 'providerMessageId' <> 'null'::jsonb AND NOT workhub_private.p6_id(p -> 'providerMessageId') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF (p -> 'usage' = 'null'::jsonb) <> (p -> 'providerMessageId' = 'null'::jsonb) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p -> 'providerMessageId' <> 'null'::jsonb AND EXISTS (SELECT 1 FROM workhub.assistant_requests o WHERE o.school_id = r.school_id
                                                             AND o.provider_message_id = p ->> 'providerMessageId' AND o.id <> r.id) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
END $$;

-- 끝: 외부 호출 결과를 남긴다. 사람의 접근이 그사이 끊겨도 사용량은 남긴다(답은 보류).
CREATE FUNCTION public.workhub_ai_finish(p_actor_user_id uuid, p_member_id text, p_request_key text, p_lease_token text, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.assistant_requests; ctx workhub_private.actor_context; actx workhub_private.actor_context; pol workhub.assistant_policies;
        t workhub.assistant_threads; x workhub.assistant_exchanges; v_sha text; v_withheld text; v_state text; v_seq integer;
        v_title text; v_in bigint; v_out bigint; v_cost bigint; v_access boolean := true;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '서버 API(service_role, 사람 JWT 없음)만 부를 수 있습니다.';
  END IF;
  IF p_actor_user_id IS NULL OR p_member_id IS NULL OR NOT workhub_private.p6_key(p_request_key) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청을 확인하지 못했습니다.';
  END IF;
  -- 사람의 소속이 끊겨도 기록할 수 있게, 요청 원장의 소유(인증 UID · 소속 · 요청 번호)로 찾는다
  SELECT * INTO r FROM workhub.assistant_requests WHERE owner_auth_user_id = p_actor_user_id AND owner_membership_id = p_member_id
     AND request_key = p_request_key;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청을 확인하지 못했습니다.'; END IF;
  PERFORM workhub_private.p6_lock('req' || chr(31) || r.school_id || chr(31) || r.owner_account_id || chr(31) || p_request_key);
  SELECT * INTO r FROM workhub.assistant_requests WHERE id = r.id FOR UPDATE;
  ctx.actor_kind := 'member'; ctx.account_id := r.owner_account_id; ctx.membership_id := r.owner_membership_id; ctx.school_id := r.school_id;
  ctx.scope_key := 's:' || r.school_id; ctx.auth_user_id := r.owner_auth_user_id;
  BEGIN
    actx := workhub_private.p6_service_member(p_actor_user_id, p_member_id);
  EXCEPTION WHEN others THEN
    v_access := false;
  END;
  IF v_access THEN ctx := actx; END IF;
  BEGIN
    IF r.started_lease IS DISTINCT FROM p_lease_token THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_sha := workhub_private.p2_sha(p_result);
    IF r.finish_sha256 IS NOT NULL THEN
      IF r.finish_sha256 <> v_sha THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
      IF NOT v_access THEN RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id,
                                 jsonb_build_object('state', 'rejected', 'requestKey', r.request_key, 'code', 'OUTPUT_INVALID')); END IF;
      RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, workhub_private.p6_public(ctx, r));
    END IF;
    IF r.state <> 'started' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    PERFORM workhub_private.p6_finish_shape(p_result, r);
    SELECT * INTO pol FROM workhub.assistant_policies WHERE school_id = r.school_id AND version = r.policy_version;
    v_state := p_result ->> 'state';
    IF p_result -> 'usage' <> 'null'::jsonb THEN
      v_in := (p_result #>> '{usage,inputTokens}')::bigint; v_out := (p_result #>> '{usage,outputTokens}')::bigint;
      v_cost := workhub_private.p6_cost(pol, v_in, v_out);
    END IF;

    IF v_state = 'completed' THEN
      -- 답을 붙이기 전 다시 확인: 사람의 접근 · 학생 근거 · 대화 판(늦게 끝난 요청)
      IF NOT v_access THEN v_withheld := 'access_lost';
      ELSIF NOT workhub_private.p6_evidence_live(ctx, NULLIF(r.input -> 'studentContext', 'null'::jsonb)) THEN v_withheld := 'evidence_changed';
      ELSIF r.thread_id IS NOT NULL THEN
        SELECT * INTO t FROM workhub.assistant_threads WHERE school_id = r.school_id AND id = r.thread_id FOR UPDATE;
        IF t.version <> r.expected_version THEN v_withheld := 'thread_changed'; END IF;
      END IF;
    END IF;

    IF v_state = 'completed' AND v_withheld IS NULL THEN
      IF r.thread_id IS NULL THEN
        v_title := workhub_private.p6_label(workhub_private.js_trim(
                     (SELECT l FROM regexp_split_to_table(r.input ->> 'prompt', E'\n') WITH ORDINALITY q(l, o)
                       WHERE workhub_private.js_trim(l) <> '' ORDER BY o LIMIT 1)), 100, '새 대화');
        INSERT INTO workhub.assistant_threads (school_id, owner_account_id, owner_membership_id, mode, title)
        VALUES (r.school_id, r.owner_account_id, r.owner_membership_id, r.mode, v_title) RETURNING * INTO t;
      ELSE
        UPDATE workhub.assistant_threads SET version = version + 1, updated_at = clock_timestamp() WHERE id = t.id RETURNING * INTO t;
      END IF;
      SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM workhub.assistant_exchanges WHERE thread_id = t.id;
      INSERT INTO workhub.assistant_exchanges (school_id, thread_id, request_id, seq, request_key, intent, prompt, segments, student_context)
      VALUES (r.school_id, t.id, r.id, v_seq, r.request_key, r.intent, r.input ->> 'prompt', p_result -> 'segments',
              NULLIF(r.input -> 'studentContext', 'null'::jsonb))
      RETURNING * INTO x;
      IF p_result -> 'taskDraft' <> 'null'::jsonb THEN
        INSERT INTO workhub.assistant_proposals (school_id, thread_id, exchange_id, owner_account_id, draft)
        VALUES (r.school_id, t.id, x.id, r.owner_account_id, p_result -> 'taskDraft');
      END IF;
      UPDATE workhub.assistant_requests SET state = 'completed', cost_state = 'settled', actual_micro_usd = v_cost, input_tokens = v_in,
             output_tokens = v_out, provider_message_id = p_result ->> 'providerMessageId', finish_sha256 = v_sha, exchange_id = x.id,
             result = jsonb_build_object('state', 'completed'), updated_at = clock_timestamp()
       WHERE id = r.id RETURNING * INTO r;
      PERFORM workhub_private.write_audit(ctx, 'assistant.answer', 'ai_run', r.id, t.version, 'owner_only', r.request_key,
        jsonb_build_object('threadId', t.id, 'intent', r.intent, 'mode', r.mode, 'policyVersion', r.policy_version,
                           'sources', (SELECT count(*) FROM workhub.assistant_request_sources WHERE request_id = r.id AND lease_token = r.started_lease),
                           'costMicroUsd', v_cost));
      RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, workhub_private.p6_public(ctx, r));
    END IF;

    -- 거절 · 보류 · 결과 불명: 답은 붙이지 않는다. 사용량이 없으면 청구 미확인(예약액으로 셈 — P6-05 로 확정)
    UPDATE workhub.assistant_requests SET
           state = CASE WHEN v_state = 'provider_unknown' THEN 'provider_unknown' ELSE 'rejected' END,
           cost_state = CASE WHEN v_cost IS NULL THEN 'unknown' ELSE 'settled' END, actual_micro_usd = v_cost,
           input_tokens = v_in, output_tokens = v_out, provider_message_id = p_result ->> 'providerMessageId', finish_sha256 = v_sha,
           reject_code = CASE WHEN v_state = 'completed' THEN 'OUTPUT_INVALID' WHEN v_state = 'rejected' THEN p_result ->> 'code' END,
           withheld_reason = v_withheld,
           result = CASE WHEN v_state = 'provider_unknown' THEN jsonb_build_object('state', 'pending', 'reason', 'provider_unknown')
                         ELSE jsonb_build_object('state', 'rejected', 'code', CASE WHEN v_state = 'completed' THEN 'OUTPUT_INVALID' ELSE p_result ->> 'code' END) END,
           updated_at = clock_timestamp()
     WHERE id = r.id RETURNING * INTO r;
    PERFORM workhub_private.write_audit(ctx, 'assistant.' || r.state, 'ai_run', r.id, NULL, 'owner_only', r.request_key,
      jsonb_build_object('intent', r.intent, 'mode', r.mode, 'policyVersion', r.policy_version, 'code', r.reject_code,
                         'withheld', v_withheld, 'costState', r.cost_state, 'costMicroUsd', v_cost));
    IF NOT v_access THEN
      RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, jsonb_build_object('state', 'rejected', 'requestKey', r.request_key, 'code', 'OUTPUT_INVALID'));
    END IF;
    RETURN workhub_private.p6_ok(r.school_id, r.owner_membership_id, workhub_private.p6_public(ctx, r));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(r.school_id, r.owner_membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 7. 앱 함수 (authenticated). p_member_id 는 요청 범위일 뿐이고, 실제 주체는 JWT 다. 내 대화만 보인다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_ai_threads_list(p_member_id text, p_mode text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; cur jsonb; v_f text; c_at timestamptz; c_id text; v_rows jsonb; v_more boolean;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    IF NOT workhub_private.p6_installed() OR NOT workhub_private.p6_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    IF p_mode IS NULL OR p_mode NOT IN ('school','personal') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_f := 'tl:' || ctx.membership_id || ':' || p_mode;
    cur := workhub_private.p6_cursor_in(p_cursor, v_f);
    IF cur IS NOT NULL THEN c_at := (cur ->> 't')::timestamptz; c_id := cur ->> 'i'; END IF;
    WITH page AS (
      SELECT t.* FROM workhub.assistant_threads t
       WHERE t.school_id = ctx.school_id AND t.owner_account_id = ctx.account_id AND t.mode = p_mode
         AND (c_id IS NULL OR (t.updated_at, t.id COLLATE "C") < (c_at, c_id COLLATE "C"))
       ORDER BY t.updated_at DESC, t.id COLLATE "C" DESC LIMIT 51)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'mode', p.mode, 'version', p.version, 'title', p.title,
                                                 'updatedAt', workhub_private.p2_ts(p.updated_at), '_t', p.updated_at::text)
                              ORDER BY p.updated_at DESC, p.id COLLATE "C" DESC), '[]'::jsonb)
      INTO v_rows FROM page p;
    v_more := jsonb_array_length(v_rows) > 50;
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, jsonb_build_object(
      'items', COALESCE((SELECT jsonb_agg(e - '_t' ORDER BY o) FROM jsonb_array_elements(v_rows) WITH ORDINALITY q(e, o) WHERE o <= 50), '[]'::jsonb),
      'nextCursor', CASE WHEN v_more THEN workhub_private.p6_cursor_out(jsonb_build_object('f', v_f, 't', v_rows #>> '{49,_t}', 'i', v_rows #>> '{49,id}')) END));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(ctx.school_id, ctx.membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_ai_thread_get(p_member_id text, p_thread_id text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; t workhub.assistant_threads; cur jsonb;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    IF NOT workhub_private.p6_installed() OR NOT workhub_private.p6_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    IF NOT workhub_private.p6_id(to_jsonb(p_thread_id)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO t FROM workhub.assistant_threads WHERE school_id = ctx.school_id AND id = p_thread_id AND owner_account_id = ctx.account_id;
    IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    cur := workhub_private.p6_cursor_in(p_cursor, 'tg:' || ctx.membership_id || ':' || t.id);
    IF cur IS NOT NULL AND (cur ->> 'v')::integer <> t.version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id,
                                 workhub_private.p6_page(ctx, t.id, NULL, (cur ->> 's')::integer, t.version));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(ctx.school_id, ctx.membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- 할 일 제안 확정: 교사가 확인한 내용으로 내 할 일 1개(R0 업무와 같은 규칙 · 감사 · outbox). 같은 요청 번호는 처음 접수증.
CREATE FUNCTION public.workhub_ai_confirm_task(p_member_id text, p_input jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; q workhub.assistant_task_requests; t workhub.assistant_threads; p workhub.assistant_proposals;
        tk workhub.tasks; v_sha text; v_task jsonb; v_year text; v_receipt jsonb;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    IF NOT workhub_private.p6_key(p_request_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF NOT workhub_private.p2_exact(p_input, ARRAY['threadId','proposalId','expectedVersion','input'])
       OR NOT workhub_private.p6_id(p_input -> 'threadId') OR NOT workhub_private.p6_id(p_input -> 'proposalId')
       OR NOT workhub_private.p6_int(p_input -> 'expectedVersion', 1) OR NOT workhub_private.p6_task_draft(p_input -> 'input') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_sha := workhub_private.p2_sha(p_input);
    PERFORM workhub_private.p6_lock('task' || chr(31) || ctx.school_id || chr(31) || ctx.account_id || chr(31) || p_request_key);
    SELECT * INTO q FROM workhub.assistant_task_requests WHERE school_id = ctx.school_id AND owner_account_id = ctx.account_id AND request_key = p_request_key;
    IF q.request_key IS NOT NULL THEN
      IF q.payload_sha256 <> v_sha OR q.membership_id <> ctx.membership_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
      RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, q.receipt);
    END IF;
    IF NOT workhub_private.p6_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    -- R0 업무 규칙(제목 120자 · 메모 2,000자). 앱 초안 한도(200 · 4,000)보다 좁다 — 넘으면 INVALID_INPUT
    v_task := workhub_private.normalize_task_input(p_input -> 'input');
    SELECT * INTO t FROM workhub.assistant_threads
     WHERE school_id = ctx.school_id AND id = p_input ->> 'threadId' AND owner_account_id = ctx.account_id FOR UPDATE;
    IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT * INTO p FROM workhub.assistant_proposals
     WHERE school_id = ctx.school_id AND id = p_input ->> 'proposalId' AND thread_id = t.id AND owner_account_id = ctx.account_id FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p.status <> 'pending' OR p.version <> (p_input ->> 'expectedVersion')::integer OR workhub_private.p6_inflight(ctx.school_id, t.id) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    SELECT y.id INTO v_year FROM workhub.academic_years y
     WHERE y.school_id = ctx.school_id AND ctx.school_today <@ daterange(y.starts_on, y.ends_on, '[)');
    INSERT INTO workhub.tasks (scope, school_id, owner_account_id, title, note, due_on, academic_year_id)
    VALUES ('school', ctx.school_id, ctx.account_id, v_task ->> 'title', v_task ->> 'notes', NULLIF(v_task ->> 'dueDate', '')::date, v_year)
    RETURNING * INTO tk;
    PERFORM workhub_private.write_audit(ctx, 'task.create', 'task', tk.id, tk.version, 'owner_only', p_request_key, jsonb_build_object('proposalId', p.id));
    PERFORM workhub_private.emit_outbox(ctx, 'task.saved', 'task', tk.id, tk.version, jsonb_build_object('task_id', tk.id, 'version', tk.version));
    UPDATE workhub.assistant_proposals SET status = 'applied', version = 2, task_id = tk.id, applied_input = v_task,
           applied_request_key = p_request_key, applied_at = clock_timestamp()
     WHERE id = p.id RETURNING * INTO p;
    UPDATE workhub.assistant_threads SET version = version + 1, updated_at = clock_timestamp() WHERE id = t.id RETURNING * INTO t;
    PERFORM workhub_private.write_audit(ctx, 'assistant.task_confirm', 'tool_proposal', p.id, p.version, 'owner_only', p_request_key,
                                        jsonb_build_object('threadId', t.id, 'taskId', tk.id));
    v_receipt := jsonb_build_object('requestKey', p_request_key, 'proposalId', p.id, 'proposalVersion', p.version,
                                    'taskId', tk.id, 'taskVersion', tk.version, 'threadVersion', t.version);
    INSERT INTO workhub.assistant_task_requests (school_id, owner_account_id, request_key, membership_id, payload_sha256, receipt)
    VALUES (ctx.school_id, ctx.account_id, p_request_key, ctx.membership_id, v_sha, v_receipt);
    RETURN workhub_private.p6_ok(ctx.school_id, ctx.membership_id, v_receipt);
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p6_business(SQLERRM) THEN RETURN workhub_private.p6_err(ctx.school_id, ctx.membership_id, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 8. 권한 — 서버 API 함수는 service_role 만, 앱 함수는 authenticated 만. 새 내부 함수는 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
            WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p6\_%')
               OR (p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_ai\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.workhub_ai_server_readiness(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workhub_ai_prepare(uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workhub_ai_start(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workhub_ai_finish(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.workhub_ai_threads_list(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_ai_thread_get(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_ai_confirm_task(text, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.workhub_ai_server_readiness(uuid, text) IS '업무실 P6: 비서 준비 상태(서버 API · service_role).';
COMMENT ON FUNCTION public.workhub_ai_prepare(uuid, text, jsonb, text) IS '업무실 P6: 요청 원장 · 근거 snapshot · 비용 예약(서버 API).';
COMMENT ON FUNCTION public.workhub_ai_start(uuid, text, text, text) IS '업무실 P6: 첫 외부 호출권 확정(서버 API).';
COMMENT ON FUNCTION public.workhub_ai_finish(uuid, text, text, text, jsonb) IS '업무실 P6: 결과 검사 · 정산 · 대화 기록(서버 API).';
COMMENT ON FUNCTION public.workhub_ai_threads_list(text, text, text) IS '업무실 P6: 내 비서 대화 목록.';
COMMENT ON FUNCTION public.workhub_ai_thread_get(text, text, text) IS '업무실 P6: 내 비서 대화 한 쪽.';
COMMENT ON FUNCTION public.workhub_ai_confirm_task(text, jsonb, text) IS '업무실 P6: 할 일 제안 확정(내 할 일 1개).';

INSERT INTO workhub_private.p6_installs (batch, release) VALUES ('P6-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 9. 검증 — 모든 행의 status 가 ok 여야 한다.
-- ----------------------------------------------------------------------------
SELECT 'P6-02-1' AS no, '공개 함수 7개(서버 4 · 앱 3)' AS item,
       CASE WHEN count(*) = 7 THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_ai\_%'
UNION ALL
SELECT 'P6-02-2', '서버 API 함수는 service_role 만 실행',
       CASE WHEN bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('workhub_ai_server_readiness','workhub_ai_prepare','workhub_ai_start','workhub_ai_finish')
UNION ALL
SELECT 'P6-02-3', '앱 함수는 authenticated 만 실행',
       CASE WHEN bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('workhub_ai_threads_list','workhub_ai_thread_get','workhub_ai_confirm_task')
UNION ALL
SELECT 'P6-02-4', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p6\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P6-02-5', '적용 기록 P6-01 · P6-02', CASE WHEN workhub_private.p6_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
