-- ============================================================================
-- P4-02  학교 자료 · HWPX 원문 가져오기 · 문서함 · 질문형 양식 — 공개 함수 29개 · 전용 버킷 2개 · Storage 정책 4개 · 권한 (비활성 설치)
--
-- ▣ 하는 일
--   authenticated(앱) 23개
--     학교 자료  : workhub_knowledge_list · workhub_knowledge_mutate
--     원문 가져오기: workhub_knowledge_import_readiness · workhub_knowledge_file_prepare · workhub_knowledge_file_prepare_get
--                  workhub_knowledge_file_extract_get · workhub_knowledge_import_commit · workhub_knowledge_import_request_get
--                  workhub_knowledge_original_access
--     문서함     : workhub_document_list · workhub_document_get · workhub_document_history · workhub_document_mutate · workhub_document_request_get
--     질문형 양식: workhub_template_list · workhub_template_get · workhub_template_collection_targets · workhub_template_prepare
--                  workhub_template_prepare_get · workhub_template_mutate · workhub_template_request_get · workhub_template_operation_get
--                  workhub_document_artifact_access
--   service_role 만(서버 API /api/workhub-documents/extract-knowledge · /guided) 6개
--     workhub_knowledge_file_extract_claim · _finish · workhub_template_inspect_claim · _finish · workhub_template_render_claim · _finish
--   비공개 버킷 workhub-knowledge-files · workhub-document-files(각 30MiB) 와 각 버킷에만 걸리는 INSERT·SELECT 정책 2개씩.
--   UPDATE·DELETE 정책은 만들지 않는다(덮어쓰기·사용자 삭제 불가). 생성 파일 업로드는 서버(service_role)만 한다.
-- ▣ 하지 않는 일
--   - 어느 학교도 켜지 않는다(P4-04 · P4-05). 이 파일만으로는 네 모듈 모두 준비 안 됨이다.
--   - 수합·메시지 버킷, R0·R1·R1S·P1~P3 함수·정책을 바꾸지 않는다.
--   - 학생 기록 검토 초안(student_record)은 5단계(P5)가 학생 근거 확인 함수를 넣기 전까지 NOT_READY 로 막는다.
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션. 마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: P4-01 (판 2026-10-16.1)
-- ============================================================================
BEGIN;

DO $$
DECLARE v_owner oid;
BEGIN
  IF to_regclass('workhub_private.p4_installs') IS NULL THEN
    RAISE EXCEPTION 'P4 중단: P4-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p4_installs WHERE batch = 'P4-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P4 중단: P4-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p4_installs WHERE batch = 'P4-02') THEN
    RAISE EXCEPTION 'P4 중단: P4-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'workhub\_knowledge\_%' OR proname LIKE 'workhub\_document\_%'
               OR proname LIKE 'workhub\_template\_%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'workhub_storage'::regnamespace
                  AND proname IN ('knowledge_insertable','knowledge_readable','document_insertable','document_readable')) THEN
    RAISE EXCEPTION 'P4 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'P4 중단: storage.objects 의 RLS 가 꺼져 있습니다. Storage 설정을 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('workhub-knowledge-files','workhub-document-files')
               OR name IN ('workhub-knowledge-files','workhub-document-files'))
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
                  AND (polname LIKE 'workhub\_knowledge%' OR polname LIKE 'workhub\_document%')) THEN
    RAISE EXCEPTION 'P4 중단: 같은 이름의 버킷 또는 Storage 정책이 이미 있습니다.';
  END IF;
  -- 정책 생성 가능 여부는 실제로 만들어 보고 되돌려 판단한다(R1-03 · P3-02 와 같은 방법).
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'storage.objects'::regclass;
  BEGIN
    CREATE POLICY workhub_p4_probe ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (false);
    RAISE EXCEPTION USING ERRCODE = 'P4PRB', MESSAGE = 'P4-02 정책 생성 시험(되돌림)';
  EXCEPTION
    WHEN SQLSTATE 'P4PRB' THEN NULL;
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'P4 중단: 현재 역할(%)이 storage.objects 에 정책을 만들 수 없습니다(%).', current_user, SQLERRM;
  END;
  IF NOT (has_table_privilege(current_user, 'storage.objects', 'SELECT')
          AND ((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) OR pg_has_role(current_user, v_owner, 'USAGE'))) THEN
    RAISE EXCEPTION 'P4 중단: 현재 역할(%)이 storage.objects 를 RLS 없이 읽을 수 없습니다.', current_user;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 공통 — 요청 원장 · 실물 확인
-- ----------------------------------------------------------------------------
-- 같은 (학교, 소속, 모듈, 동작, 요청 번호) 의 원장. 다른 내용(또는 다른 계정)이면 IDEMPOTENCY_CONFLICT. 없으면 빈 행.
CREATE FUNCTION workhub_private.p4_ledger(p_ctx workhub_private.actor_context, p_module text, p_action text, p_key text, p_hash text)
RETURNS workhub.content_requests
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.content_requests;
BEGIN
  SELECT * INTO q FROM workhub.content_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND module = p_module AND action = p_action AND request_key = p_key;
  IF q.request_key IS NOT NULL AND (q.payload_hash <> p_hash OR q.account_id <> p_ctx.account_id) THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN q;
END $$;

CREATE FUNCTION workhub_private.p4_record(p_ctx workhub_private.actor_context, p_module text, p_action text, p_key text, p_hash text,
  p_result text, p_response jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.content_requests (school_id, membership_id, account_id, module, action, request_key, payload_hash, result_id, response)
  VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_module, p_action, p_key, p_hash, p_result, p_response)
$$;

-- 순수 조회의 줄 세우기: 같은 키를 지금 처리 중이면 RESULT_UNKNOWN(아무것도 쓰지 않는다)
CREATE FUNCTION workhub_private.p4_replay_gate(p_ctx workhub_private.actor_context, p_kind text, p_key text, p_replay boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_replay THEN
    IF NOT workhub_private.p4_idle(p_ctx, p_kind, p_key) THEN RAISE EXCEPTION 'RESULT_UNKNOWN'; END IF;
  ELSE
    PERFORM workhub_private.p4_lock(p_ctx, p_kind, p_key);
  END IF;
END $$;

-- 실물 크기(Storage 가 기록한 값, 없으면 NULL)
CREATE FUNCTION workhub_private.p4_object_size(p_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN s.metadata ->> 'size' ~ '^[0-9]{1,18}$' THEN (s.metadata ->> 'size')::bigint END
    FROM storage.objects s WHERE s.id = p_id
$$;

-- 이 계정이 올린 그 경로의 실물인가(크기까지). 맞으면 실물 id, 아니면 NULL.
CREATE FUNCTION workhub_private.p4_owned_object(p_bucket text, p_path text, p_account text, p_bytes bigint) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o jsonb := workhub_private.c_object_owner(p_bucket, p_path); v_size bigint;
BEGIN
  IF o IS NULL OR NOT EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = p_account AND a.auth_user_id::text = o ->> 'owner') THEN
    RETURN NULL;
  END IF;
  v_size := workhub_private.p4_object_size((o ->> 'id')::uuid);
  IF v_size IS NOT NULL AND v_size <> p_bytes THEN RETURN NULL; END IF;
  RETURN (o ->> 'id')::uuid;
END $$;

-- ----------------------------------------------------------------------------
-- 2. 학교 자료(knowledge.v1)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p4_kn_dto(s workhub.knowledge_sources) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', s.id, 'schoolId', s.school_id, 'authorMemberId', s.author_membership_id, 'version', s.version,
    'status', s.status, 'updatedAt', workhub_private.p4_ts(s.updated_at), 'title', s.title, 'kind', s.kind, 'body', s.body,
    'locator', s.locator, 'effectiveFrom', workhub_private.p4_day(s.effective_from),
    'effectiveThrough', COALESCE(workhub_private.p4_day(s.effective_through), ''))
$$;

-- 작성자(소속 기준)인가
CREATE FUNCTION workhub_private.p4_kn_author(p_ctx workhub_private.actor_context, s workhub.knowledge_sources) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT s.author_membership_id = p_ctx.membership_id AND s.author_account_id = p_ctx.account_id
$$;

-- 판 열람: 게시·종료 판은 학교 구성원 모두, 초안 판은 작성자와 지식 관리자만
CREATE FUNCTION workhub_private.p4_kn_rev_sees(p_ctx workhub_private.actor_context, s workhub.knowledge_sources, p_status text, p_manager boolean)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT s.school_id = p_ctx.school_id AND (p_status <> 'draft' OR p_manager OR workhub_private.p4_kn_author(p_ctx, s))
$$;

-- 앱 sourceInput() 과 같은 판정·정규화(제목·근거 위치는 앞뒤 공백 제거)
CREATE FUNCTION workhub_private.p4_source_input(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['title','kind','body','locator','effectiveFrom','effectiveThrough'])
     OR NOT workhub_private.p4_text(p -> 'title', 200, true) OR NOT workhub_private.p4_text(p -> 'body', 100000, true)
     OR NOT workhub_private.p4_text(p -> 'locator', 500, true)
     OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' OR p ->> 'kind' NOT IN ('regulation','annual_plan','school_guide','other')
     OR NOT workhub_private.p4_date(p -> 'effectiveFrom')
     OR NOT (p -> 'effectiveThrough' = '""'::jsonb OR workhub_private.p4_date(p -> 'effectiveThrough')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p ->> 'effectiveThrough' <> '' AND p ->> 'effectiveThrough' < p ->> 'effectiveFrom' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN jsonb_build_object('title', workhub_private.js_trim(p ->> 'title'), 'kind', p ->> 'kind', 'body', p ->> 'body',
    'locator', workhub_private.js_trim(p ->> 'locator'), 'effectiveFrom', p ->> 'effectiveFrom', 'effectiveThrough', p ->> 'effectiveThrough');
END $$;

-- 목록: 게시·종료 자료 + (관리자면 모든 초안, 아니면 내 초안). 제목·본문·근거 위치를 서버 전체에서 찾는다. 최근 수정 순 50개.
CREATE FUNCTION workhub_private.p4_kn_list(p_ctx workhub_private.actor_context, p_query text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_q text; v_f text; cur jsonb; c_at timestamptz; c_id text; v_ids text[]; v_last workhub.knowledge_sources;
  v_m boolean := workhub_private.p4_knowledge_manager(p_ctx);
BEGIN
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p4_text(to_jsonb(p_query), 200) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_q := workhub_private.js_trim(p_query);
  v_f := md5('knowledge' || chr(31) || p_ctx.membership_id || chr(31) || v_q);
  cur := workhub_private.p4_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN c_at := (cur ->> 't')::timestamptz; c_id := cur ->> 'i'; END IF;
  SELECT array_agg(x.id ORDER BY x.updated_at DESC, x.id COLLATE "C" DESC) INTO v_ids FROM (
    SELECT s.id, s.updated_at FROM workhub.knowledge_sources s
     WHERE s.school_id = p_ctx.school_id
       AND workhub_private.p4_kn_rev_sees(p_ctx, s, s.status, v_m)
       AND (v_q = '' OR s.title ILIKE workhub_private.p4_like(v_q) OR s.body ILIKE workhub_private.p4_like(v_q)
            OR s.locator ILIKE workhub_private.p4_like(v_q))
       AND (c_id IS NULL OR (s.updated_at, s.id COLLATE "C") < (c_at, c_id COLLATE "C"))
     ORDER BY s.updated_at DESC, s.id COLLATE "C" DESC LIMIT 51) x;
  IF COALESCE(array_length(v_ids, 1), 0) > 50 THEN
    SELECT * INTO v_last FROM workhub.knowledge_sources WHERE id = v_ids[50];
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p4_kn_dto(s) ORDER BY u.o)
                         FROM unnest(v_ids[1:50]) WITH ORDINALITY u(id, o) JOIN workhub.knowledge_sources s ON s.id = u.id), '[]'::jsonb),
    'nextCursor', CASE WHEN v_last.id IS NULL THEN NULL
                       ELSE workhub_private.p4_cursor_out(jsonb_build_object('f', v_f, 't', v_last.updated_at::text, 'i', v_last.id)) END,
    'canManage', v_m);
END $$;

-- 판 기록 1행(원본 파일 연결은 직전 판 값을 그대로 이어 간다 — 직접 고쳐도 어느 원본에서 왔는지 남는다)
CREATE FUNCTION workhub_private.p4_kn_revision(p_ctx workhub_private.actor_context, s workhub.knowledge_sources, p_action text,
  p_reason text, p_file text, p_file_version integer, p_extraction text, p_key text, p_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.knowledge_source_revisions (source_id, version, school_id, status, title, kind, body, locator, effective_from,
      effective_through, action, reason, file_id, file_version, extraction_sha256, actor_membership_id, actor_account_id, request_key, recorded_at)
  VALUES (s.id, s.version, s.school_id, s.status, s.title, s.kind, s.body, s.locator, s.effective_from, s.effective_through,
      p_action, p_reason, p_file, p_file_version, p_extraction, p_ctx.membership_id, p_ctx.account_id, p_key, p_at)
$$;

CREATE FUNCTION workhub_private.p4_kn_apply(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_m boolean := workhub_private.p4_knowledge_manager(p_ctx); i jsonb;
  s workhub.knowledge_sources; r workhub.knowledge_source_revisions; v_kind text := c ->> 'kind'; v_reason text;
BEGIN
  IF v_kind = 'create' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','input']) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    i := workhub_private.p4_source_input(c -> 'input');
    INSERT INTO workhub.knowledge_sources (school_id, author_membership_id, author_account_id, title, kind, body, locator,
        effective_from, effective_through, created_at, updated_at)
    VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, i ->> 'title', i ->> 'kind', i ->> 'body', i ->> 'locator',
        (i ->> 'effectiveFrom')::date, NULLIF(i ->> 'effectiveThrough', '')::date, v_now, v_now)
    RETURNING * INTO s;
    PERFORM workhub_private.p4_kn_revision(p_ctx, s, 'create', NULL, NULL, NULL, NULL, p_key, v_now);
  ELSIF v_kind IN ('update','publish','retire') THEN
    IF v_kind = 'update' THEN
      IF NOT workhub_private.p2_exact(c, ARRAY['kind','id','expectedVersion','input']) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      i := workhub_private.p4_source_input(c -> 'input');
    ELSE
      IF NOT workhub_private.p2_exact(c, ARRAY['kind','id','expectedVersion','reason']) OR NOT workhub_private.p4_text(c -> 'reason', 1000, true) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
      v_reason := workhub_private.js_trim(c ->> 'reason');
    END IF;
    IF NOT workhub_private.p4_id(c -> 'id') OR NOT workhub_private.p4_pos(c -> 'expectedVersion') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO s FROM workhub.knowledge_sources WHERE school_id = p_ctx.school_id AND id = c ->> 'id' FOR UPDATE;
    IF s.id IS NULL OR NOT workhub_private.p4_kn_rev_sees(p_ctx, s, s.status, v_m) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF NOT (v_m OR (v_kind = 'update' AND workhub_private.p4_kn_author(p_ctx, s))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF s.version <> (c ->> 'expectedVersion')::integer
       OR s.status <> (CASE v_kind WHEN 'retire' THEN 'published' ELSE 'draft' END) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    SELECT * INTO r FROM workhub.knowledge_source_revisions WHERE source_id = s.id AND version = s.version;
    IF v_kind = 'update' THEN
      UPDATE workhub.knowledge_sources SET title = i ->> 'title', kind = i ->> 'kind', body = i ->> 'body', locator = i ->> 'locator',
             effective_from = (i ->> 'effectiveFrom')::date, effective_through = NULLIF(i ->> 'effectiveThrough', '')::date,
             version = version + 1, updated_at = v_now
       WHERE id = s.id RETURNING * INTO s;
    ELSE
      UPDATE workhub.knowledge_sources SET status = CASE v_kind WHEN 'publish' THEN 'published' ELSE 'retired' END,
             version = version + 1, updated_at = v_now
       WHERE id = s.id RETURNING * INTO s;
      -- AI 근거 색인 갱신 사건을 같은 트랜잭션에 남긴다(색인 작업자는 뒤 배치). 본문은 싣지 않는다.
      PERFORM workhub_private.emit_outbox(p_ctx, 'knowledge.' || CASE v_kind WHEN 'publish' THEN 'published' ELSE 'retired' END,
        'knowledge_source', s.id, s.version, jsonb_build_object('source_id', s.id, 'version', s.version,
          'effective_from', workhub_private.p4_day(s.effective_from), 'effective_through', workhub_private.p4_day(s.effective_through)));
    END IF;
    PERFORM workhub_private.p4_kn_revision(p_ctx, s, v_kind, v_reason, r.file_id, r.file_version, r.extraction_sha256, p_key, v_now);
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'knowledge.' || v_kind, 'knowledge_source', s.id, s.version,
    CASE WHEN s.status = 'draft' THEN 'owner_only' ELSE 'school' END, p_key, jsonb_build_object('status', s.status));
  RETURN jsonb_build_object('id', s.id, 'version', s.version, 'requestKey', p_key, 'recordedAt', workhub_private.p4_ts(v_now));
END $$;

-- 쓰기: 원장 확인(같은 키·같은 내용 = 처음 접수증, 다른 내용 = IDEMPOTENCY_CONFLICT) → 준비 상태 → 판 검증·원자 변경 + 원장
CREATE FUNCTION workhub_private.p4_kn_mutate(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; v_data jsonb;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR c IS NULL OR jsonb_typeof(c) <> 'object' OR octet_length(c::text) > 600000
     OR jsonb_typeof(c -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_hash := workhub_private.p2_sha(c);
  PERFORM workhub_private.p4_lock(p_ctx, 'knowledge:mutate', p_key);
  q := workhub_private.p4_ledger(p_ctx, 'knowledge', 'mutate', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_data := workhub_private.p4_kn_apply(p_ctx, c, p_key);
  PERFORM workhub_private.p4_record(p_ctx, 'knowledge', 'mutate', p_key, v_hash, v_data ->> 'id', v_data);
  RETURN v_data;
END $$;

-- ----------------------------------------------------------------------------
-- 3. HWPX 원문 가져오기(knowledge-import.v1)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p4_kfile_intent(f workhub.knowledge_files) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('fileId', f.id, 'fileVersion', f.version, 'bucket', 'workhub-knowledge-files', 'path', f.storage_path,
    'bytes', f.bytes, 'sha256', f.sha256,
    'uploaded', f.storage_object_id IS NOT NULL OR workhub_private.c_object_owner('workhub-knowledge-files', f.storage_path) IS NOT NULL)
$$;

-- 파일 신고값 {name, bytes, sha256} — 앱 prepare 와 같은 모양. bytes·sha256 은 형식 검사일 뿐 실측이 아니다.
CREATE FUNCTION workhub_private.p4_file_claim_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_exact(p, ARRAY['name','bytes','sha256']) AND workhub_private.p4_file_name(p -> 'name')
     AND workhub_private.p2_int(p -> 'bytes', 1, 31457280) AND workhub_private.p4_sha(p -> 'sha256')
$$;

-- 업로드 예약(prepare)·예약 읽기(prepare_get = p_replay). 같은 번호·같은 신고값이면 같은 예약.
CREATE FUNCTION workhub_private.p4_kprepare(p_ctx workhub_private.actor_context, p_file jsonb, p_key text, p_replay boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; f workhub.knowledge_files; v_id text := gen_random_uuid()::text; v_max bigint;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR NOT workhub_private.p4_file_claim_ok(p_file) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_hash := workhub_private.p2_sha(p_file);
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'kimport:prepare', p_key, p_replay);
  q := workhub_private.p4_ledger(p_ctx, 'knowledge_import', 'prepare', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN
    SELECT * INTO f FROM workhub.knowledge_files WHERE school_id = p_ctx.school_id AND id = q.result_id;
    -- 기한 안에 올리지 못한 예약은 쓸 수 없다(같은 경로를 다시 열지 않는다) → 새 요청 번호로 다시 예약
    IF f.storage_object_id IS NULL AND f.upload_expires_at <= clock_timestamp()
       AND workhub_private.c_object_owner('workhub-knowledge-files', f.storage_path) IS NULL THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    RETURN workhub_private.p4_kfile_intent(f);
  END IF;
  IF p_replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge_import') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT max_file_bytes INTO v_max FROM workhub.knowledge_import_policies WHERE school_id = p_ctx.school_id;
  IF (p_file ->> 'bytes')::bigint > v_max THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO workhub.knowledge_files (id, school_id, owner_membership_id, owner_account_id, name, bytes, sha256, storage_path, upload_expires_at)
  VALUES (v_id, p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_file ->> 'name', (p_file ->> 'bytes')::bigint, p_file ->> 'sha256',
          p_ctx.school_id || '/' || p_ctx.membership_id || '/' || v_id || '/original.hwpx', clock_timestamp() + interval '30 minutes')
  RETURNING * INTO f;
  PERFORM workhub_private.p4_record(p_ctx, 'knowledge_import', 'prepare', p_key, v_hash, f.id, NULL);
  PERFORM workhub_private.write_audit(p_ctx, 'knowledge_file.prepare', 'knowledge_file', f.id, f.version, 'owner_only', p_key, '{}'::jsonb);
  RETURN workhub_private.p4_kfile_intent(f);
END $$;

-- 추출 결과 읽기(extract_get): 원래 요청이 확정한 추출문만. 새 임대·파싱을 하지 않는다.
CREATE FUNCTION workhub_private.p4_kextract_get(p_ctx workhub_private.actor_context, p_file text, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.content_requests; x workhub.knowledge_extractions;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR NOT workhub_private.p4_id(to_jsonb(p_file)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'kimport:extract', p_key, true);
  q := workhub_private.p4_ledger(p_ctx, 'knowledge_import', 'extract', p_key, workhub_private.p2_sha(jsonb_build_object('fileId', p_file)));
  IF q.request_key IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO x FROM workhub.knowledge_extractions WHERE file_id = p_file AND school_id = p_ctx.school_id;
  IF x.file_id IS NULL THEN RAISE EXCEPTION 'RESULT_UNKNOWN'; END IF;
  RETURN x.result;
END $$;

-- 서버 API 의 추출 결과(ImportResult)가 이 파일의 것인지 · 앱 extraction() 과 같은 모양·한도인지 · 추출 hash 가 맞는지
CREATE FUNCTION workhub_private.p4_kresult_ok(p jsonb, f workhub.knowledge_files) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE e jsonb := p -> 'extraction'; b jsonb; v_n integer;
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['fileId','fileVersion','name','extraction']) OR octet_length(p::text) > 2097152
     OR p -> 'fileId' IS DISTINCT FROM to_jsonb(f.id) OR p -> 'fileVersion' IS DISTINCT FROM to_jsonb(f.version)
     OR p -> 'name' IS DISTINCT FROM to_jsonb(f.name)
     OR NOT workhub_private.p2_exact(e, ARRAY['profile','fileSha256','extractionSha256','blocks','omittedObjects'])
     OR e -> 'profile' IS DISTINCT FROM '"hwpx_text_v1"'::jsonb OR e -> 'fileSha256' IS DISTINCT FROM to_jsonb(f.sha256)
     OR NOT workhub_private.p4_sha(e -> 'extractionSha256') OR NOT workhub_private.p2_int(e -> 'omittedObjects', 0, 2147483647)
     OR jsonb_typeof(e -> 'blocks') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  v_n := jsonb_array_length(e -> 'blocks');
  IF v_n NOT BETWEEN 1 AND 1500 THEN RETURN false; END IF;
  FOR b IN SELECT v FROM jsonb_array_elements(e -> 'blocks') v LOOP
    IF NOT workhub_private.p2_exact(b, ARRAY['id','locator','text']) OR NOT workhub_private.p4_text(b -> 'id', 120, true)
       OR (b ->> 'id') !~ '^Contents/section[0-9]+\.xml:p[0-9]{6,}$'
       OR NOT workhub_private.p4_text(b -> 'locator', 200, true) OR NOT workhub_private.p4_text(b -> 'text', 100000, true) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT v ->> 'id') FROM jsonb_array_elements(e -> 'blocks') v) <> v_n
     OR (SELECT sum(length(v ->> 'text')) FROM jsonb_array_elements(e -> 'blocks') v) + 2 * (v_n - 1) > 100000 THEN
    RETURN false;
  END IF;
  -- Python json.dumps(blocks, ensure_ascii=False, sort_keys=True, separators=(',',':')) 와 같은 표준형의 SHA-256
  RETURN e ->> 'extractionSha256' = encode(sha256(convert_to(workhub_private.p2_canonical(e -> 'blocks'), 'UTF8')), 'hex');
END $$;

-- 추출 인수(claim): data = {state:'pending'} · {state:'completed',result} · 새 임대
CREATE FUNCTION workhub_private.p4_kclaim(p_ctx workhub_private.actor_context, p_file text, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; f workhub.knowledge_files; x workhub.knowledge_extractions; l workhub.knowledge_file_leases;
  v_obj uuid; v_token text;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR NOT workhub_private.p4_id(to_jsonb(p_file)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p4_lock(p_ctx, 'kimport:extract', p_key);
  v_hash := workhub_private.p2_sha(jsonb_build_object('fileId', p_file));
  q := workhub_private.p4_ledger(p_ctx, 'knowledge_import', 'extract', p_key, v_hash);
  SELECT * INTO f FROM workhub.knowledge_files WHERE school_id = p_ctx.school_id AND id = p_file FOR UPDATE;
  IF f.id IS NULL OR f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF q.request_key IS NULL THEN
    PERFORM workhub_private.p4_record(p_ctx, 'knowledge_import', 'extract', p_key, v_hash, f.id, NULL);
  END IF;
  SELECT * INTO x FROM workhub.knowledge_extractions WHERE file_id = f.id;
  IF x.file_id IS NOT NULL THEN RETURN jsonb_build_object('state', 'completed', 'result', x.result); END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge_import') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  -- 실물 정체성: 예약한 사람이 올린 그 경로의 실물, 신고 크기와 같은 크기. 한 번 고정한 실물 id 는 바뀌면 안 된다.
  v_obj := workhub_private.p4_owned_object('workhub-knowledge-files', f.storage_path, f.owner_account_id, f.bytes);
  IF v_obj IS NULL OR (f.storage_object_id IS NOT NULL AND v_obj <> f.storage_object_id) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF f.storage_object_id IS NULL THEN
    UPDATE workhub.knowledge_files SET storage_object_id = v_obj, updated_at = clock_timestamp() WHERE id = f.id RETURNING * INTO f;
  END IF;
  SELECT * INTO l FROM workhub.knowledge_file_leases WHERE file_id = f.id AND state = 'issued' FOR UPDATE;
  IF l.id IS NOT NULL AND l.expires_at > clock_timestamp() THEN RETURN jsonb_build_object('state', 'pending'); END IF;
  IF l.id IS NOT NULL THEN
    UPDATE workhub.knowledge_file_leases SET state = 'expired', closed_at = clock_timestamp() WHERE id = l.id;
  END IF;
  -- 반복 호출 상한(실물 내려받기 증폭 방지): 파일당 10분 6번, 계정당 10분 60번
  IF (SELECT count(*) FROM workhub.knowledge_file_leases WHERE file_id = f.id AND issued_at > clock_timestamp() - interval '10 minutes') >= 6
     OR (SELECT count(*) FROM workhub.knowledge_file_leases WHERE account_id = p_ctx.account_id AND issued_at > clock_timestamp() - interval '10 minutes') >= 60 THEN
    RETURN jsonb_build_object('state', 'pending');
  END IF;
  v_token := workhub_private.p4_token();
  INSERT INTO workhub.knowledge_file_leases (school_id, file_id, account_id, membership_id, token_sha256, request_key, storage_object_id, expires_at)
  VALUES (f.school_id, f.id, p_ctx.account_id, p_ctx.membership_id, workhub_private.p4_token_hash(v_token), p_key, f.storage_object_id,
          clock_timestamp() + interval '120 seconds')
  RETURNING * INTO l;
  PERFORM workhub_private.write_audit(p_ctx, 'knowledge_file.extract_claim', 'knowledge_file', f.id, f.version, 'owner_only', p_key,
    jsonb_build_object('lease_id', l.id));
  RETURN jsonb_build_object('state', 'leased', 'leaseToken', v_token, 'leaseExpiresAt', workhub_private.p4_ts(l.expires_at),
    'bucket', 'workhub-knowledge-files', 'path', f.storage_path, 'fileVersion', f.version, 'name', f.name, 'bytes', f.bytes,
    'sha256', f.sha256, 'storageObjectId', f.storage_object_id::text);
END $$;

-- 추출 확정(finish): 임대·실물·결과를 대조하고 추출문을 불변 원장에 한 번만 남긴다. 같은 결과 재전송은 같은 결과.
CREATE FUNCTION workhub_private.p4_kfinish(p_ctx workhub_private.actor_context, p_file text, p_key text, p_token text, p_object uuid,
  p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.content_requests; f workhub.knowledge_files; x workhub.knowledge_extractions; l workhub.knowledge_file_leases;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR NOT workhub_private.p4_id(to_jsonb(p_file)) OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$'
     OR p_object IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.p4_lock(p_ctx, 'kimport:extract', p_key);
  q := workhub_private.p4_ledger(p_ctx, 'knowledge_import', 'extract', p_key, workhub_private.p2_sha(jsonb_build_object('fileId', p_file)));
  IF q.request_key IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO f FROM workhub.knowledge_files WHERE school_id = p_ctx.school_id AND id = p_file FOR UPDATE;
  IF f.id IS NULL OR f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p4_kresult_ok(p_result, f) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO x FROM workhub.knowledge_extractions WHERE file_id = f.id;
  IF x.file_id IS NOT NULL THEN
    IF x.result = p_result THEN RETURN x.result; END IF;
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge_import') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO l FROM workhub.knowledge_file_leases
   WHERE file_id = f.id AND state = 'issued' AND token_sha256 = workhub_private.p4_token_hash(p_token) FOR UPDATE;
  IF l.id IS NULL OR l.expires_at <= clock_timestamp() OR l.account_id <> p_ctx.account_id OR l.storage_object_id <> f.storage_object_id
     OR p_object IS DISTINCT FROM f.storage_object_id
     OR workhub_private.p4_owned_object('workhub-knowledge-files', f.storage_path, f.owner_account_id, f.bytes) IS DISTINCT FROM f.storage_object_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  INSERT INTO workhub.knowledge_extractions (file_id, school_id, file_version, profile, file_sha256, extraction_sha256, block_count,
      omitted_objects, result, storage_object_id, lease_id, request_key)
  VALUES (f.id, f.school_id, f.version, 'hwpx_text_v1', f.sha256, p_result #>> '{extraction,extractionSha256}',
      jsonb_array_length(p_result #> '{extraction,blocks}'), (p_result #>> '{extraction,omittedObjects}')::integer, p_result,
      f.storage_object_id, l.id, p_key)
  RETURNING * INTO x;
  UPDATE workhub.knowledge_files SET state = 'extracted', updated_at = clock_timestamp() WHERE id = f.id;
  UPDATE workhub.knowledge_file_leases SET state = 'finished', closed_at = clock_timestamp() WHERE id = l.id;
  PERFORM workhub_private.write_audit(p_ctx, 'knowledge_file.extract', 'knowledge_file', f.id, f.version, 'owner_only', p_key,
    jsonb_build_object('lease_id', l.id, 'blocks', x.block_count, 'omitted', x.omitted_objects));
  RETURN x.result;
END $$;

-- 초안 만들기(import_commit)·접수증 읽기(import_request_get = p_replay)
CREATE FUNCTION workhub_private.p4_kcommit(p_ctx workhub_private.actor_context, p jsonb, p_key text, p_replay boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; i jsonb; f workhub.knowledge_files; x workhub.knowledge_extractions;
  s workhub.knowledge_sources; v_now timestamptz := clock_timestamp(); v_data jsonb;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR NOT workhub_private.p2_exact(p, ARRAY['fileId','fileVersion','extractionSha256','input'])
     OR NOT workhub_private.p4_id(p -> 'fileId') OR NOT workhub_private.p4_pos(p -> 'fileVersion')
     OR NOT workhub_private.p4_sha(p -> 'extractionSha256') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  i := workhub_private.p4_source_input(p -> 'input');
  v_hash := workhub_private.p2_sha(p);
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'kimport:commit', p_key, p_replay);
  q := workhub_private.p4_ledger(p_ctx, 'knowledge_import', 'commit', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
  IF p_replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge_import') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO f FROM workhub.knowledge_files WHERE school_id = p_ctx.school_id AND id = p ->> 'fileId' FOR UPDATE;
  IF f.id IS NULL OR f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO x FROM workhub.knowledge_extractions WHERE file_id = f.id;
  IF f.version <> (p ->> 'fileVersion')::integer OR x.file_id IS NULL OR x.extraction_sha256 <> p ->> 'extractionSha256'
     OR EXISTS (SELECT 1 FROM workhub.knowledge_sources WHERE origin_file_id = f.id) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  INSERT INTO workhub.knowledge_sources (school_id, author_membership_id, author_account_id, title, kind, body, locator,
      effective_from, effective_through, origin_file_id, created_at, updated_at)
  VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, i ->> 'title', i ->> 'kind', i ->> 'body', i ->> 'locator',
      (i ->> 'effectiveFrom')::date, NULLIF(i ->> 'effectiveThrough', '')::date, f.id, v_now, v_now)
  RETURNING * INTO s;
  PERFORM workhub_private.p4_kn_revision(p_ctx, s, 'import', NULL, f.id, f.version, x.extraction_sha256, p_key, v_now);
  PERFORM workhub_private.write_audit(p_ctx, 'knowledge.import', 'knowledge_source', s.id, s.version, 'owner_only', p_key,
    jsonb_build_object('file_id', f.id, 'extraction_sha256', x.extraction_sha256));
  v_data := jsonb_build_object('id', s.id, 'version', s.version, 'requestKey', p_key, 'recordedAt', workhub_private.p4_ts(v_now));
  PERFORM workhub_private.p4_record(p_ctx, 'knowledge_import', 'commit', p_key, v_hash, s.id, v_data);
  RETURN v_data;
END $$;

-- 자료판에 이어진 원본 위치. 원본 없는 판은 {available:false}. 볼 수 없는 판은 NOT_FOUND(있는지도 알리지 않는다).
CREATE FUNCTION workhub_private.p4_koriginal(p_ctx workhub_private.actor_context, p_source text, p_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s workhub.knowledge_sources; r workhub.knowledge_source_revisions; f workhub.knowledge_files; o jsonb;
BEGIN
  IF NOT workhub_private.p4_id(to_jsonb(p_source)) OR p_version IS NULL OR p_version < 1 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO s FROM workhub.knowledge_sources WHERE school_id = p_ctx.school_id AND id = p_source;
  SELECT * INTO r FROM workhub.knowledge_source_revisions WHERE source_id = s.id AND version = p_version;
  IF s.id IS NULL OR r.source_id IS NULL
     OR NOT workhub_private.p4_kn_rev_sees(p_ctx, s, r.status, workhub_private.p4_knowledge_manager(p_ctx)) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF r.file_id IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'knowledge_import') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO f FROM workhub.knowledge_files WHERE school_id = p_ctx.school_id AND id = r.file_id;
  o := workhub_private.c_object_owner('workhub-knowledge-files', f.storage_path);
  IF f.storage_object_id IS NULL OR o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN jsonb_build_object('available', true, 'sourceId', s.id, 'sourceVersion', r.version, 'fileId', f.id, 'fileVersion', r.file_version,
    'ownerMemberId', f.owner_membership_id, 'bucket', 'workhub-knowledge-files', 'path', f.storage_path, 'name', f.name,
    'bytes', f.bytes, 'sha256', f.sha256, 'extractionSha256', r.extraction_sha256);
END $$;

-- ----------------------------------------------------------------------------
-- 4. 문서함(documents.v1)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p4_doc_owner(p_ctx workhub_private.actor_context, d workhub.documents) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT d.school_id = p_ctx.school_id AND d.owner_membership_id = p_ctx.membership_id AND d.owner_account_id = p_ctx.account_id
$$;
-- 판 열람: 소유자는 모든 판. 다른 사람은 문서가 지금 학교 공유이고 그 판도 학교 공유였을 때만. 관리자라도 개인 문서는 못 본다.
CREATE FUNCTION workhub_private.p4_doc_sees(p_ctx workhub_private.actor_context, d workhub.documents, p_visibility text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT d.school_id = p_ctx.school_id
     AND (workhub_private.p4_doc_owner(p_ctx, d) OR (d.visibility = 'school' AND p_visibility = 'school'))
$$;

CREATE FUNCTION workhub_private.p4_doc_dto(p_ctx workhub_private.actor_context, d workhub.documents, v workhub.document_versions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', d.id, 'schoolId', d.school_id, 'ownerMemberId', d.owner_membership_id, 'version', v.version,
    'latestVersion', d.latest_version, 'status', v.status, 'updatedAt', workhub_private.p4_ts(v.recorded_at),
    'canEdit', workhub_private.p4_doc_owner(p_ctx, d) AND v.version = d.latest_version AND d.status <> 'archived',
    'origin', CASE WHEN d.origin_document_id IS NULL THEN NULL
                   ELSE jsonb_build_object('documentId', d.origin_document_id, 'version', d.origin_version) END,
    'title', v.title, 'kind', v.kind, 'body', v.body, 'visibility', v.visibility, 'sources', v.sources,
    'basisDate', workhub_private.p4_day(v.basis_date), 'studentContext', v.student_context)
$$;

-- 앱 documentInput() 과 같은 판정·정규화(제목만 앞뒤 공백 제거). 학생 맥락은 모양만 보고, 내용 확인은 P5 함수가 한다.
CREATE FUNCTION workhub_private.p4_doc_input(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE x jsonb; sc jsonb := p -> 'studentContext';
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['title','kind','body','visibility','sources','basisDate','studentContext'])
     OR jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string'
     OR p ->> 'kind' NOT IN ('parent_letter','event_plan','event_report','rubric','general','student_record')
     OR jsonb_typeof(p -> 'visibility') IS DISTINCT FROM 'string' OR p ->> 'visibility' NOT IN ('private','school')
     OR jsonb_typeof(p -> 'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'sources') > 100
     OR NOT workhub_private.p4_text(p -> 'title', 200, true) OR NOT workhub_private.p4_text(p -> 'body', 100000, true)
     OR NOT workhub_private.p4_date(p -> 'basisDate') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  FOR x IN SELECT v FROM jsonb_array_elements(p -> 'sources') v LOOP
    IF NOT workhub_private.p2_exact(x, ARRAY['kind','sourceId','sourceVersion','locator','quote'])
       OR jsonb_typeof(x -> 'kind') IS DISTINCT FROM 'string' OR x ->> 'kind' NOT IN ('knowledge','document','collection','calendar','task')
       OR NOT workhub_private.p4_id(x -> 'sourceId') OR NOT workhub_private.p4_pos(x -> 'sourceVersion')
       OR NOT workhub_private.p4_text(x -> 'locator', 500, true) OR NOT workhub_private.p4_text(x -> 'quote', 2000) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT jsonb_build_array(v -> 'kind', v -> 'sourceId', v -> 'sourceVersion', v -> 'locator'))
        FROM jsonb_array_elements(p -> 'sources') v) <> jsonb_array_length(p -> 'sources') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF sc <> 'null'::jsonb AND (NOT workhub_private.p2_exact(sc, ARRAY['studentId','courseId','evidence'])
       OR NOT workhub_private.p4_id(sc -> 'studentId') OR NOT workhub_private.p4_id(sc -> 'courseId')
       OR jsonb_typeof(sc -> 'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(sc -> 'evidence') NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 근거 한 줄 = 앱 assistantReference 의 관찰·평가 모양(판 번호 없는 원문 구간). 실제 존재 확인은 5단계 몫이다.
  IF sc <> 'null'::jsonb AND (EXISTS (SELECT 1 FROM jsonb_array_elements(sc -> 'evidence') e
        WHERE NOT workhub_private.p2_exact(e, ARRAY['kind','id','revisionId','sourceHash','epoch','start','end'])
           OR e ->> 'kind' NOT IN ('observation','assessment') OR NOT workhub_private.p4_id(e -> 'id') OR NOT workhub_private.p4_id(e -> 'revisionId')
           OR jsonb_typeof(e -> 'sourceHash') IS DISTINCT FROM 'string' OR (e ->> 'sourceHash') !~ '^[0-9a-f]{64}$'
           OR NOT workhub_private.p2_int(e -> 'epoch', 0) OR NOT workhub_private.p2_int(e -> 'start', 0)
           OR NOT workhub_private.p2_int(e -> 'end', 1) OR (e ->> 'start')::numeric >= (e ->> 'end')::numeric)
     OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(sc -> 'evidence') e) <> jsonb_array_length(sc -> 'evidence')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 학생 기록 초안 ⇔ 학생 맥락, 그리고 언제나 나만 보기
  IF (p ->> 'kind' = 'student_record') <> (sc <> 'null'::jsonb) OR (sc <> 'null'::jsonb AND p ->> 'visibility' <> 'private') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN jsonb_set(p, '{title}', to_jsonb(workhub_private.js_trim(p ->> 'title')));
END $$;

-- 학생 기록 근거 확인: 5단계(P5)가 workhub_private.p5_document_student_check(ctx, studentContext) 를 넣기 전까지 NOT_READY.
-- 이 배치는 학생·수업·관찰 원장을 모르므로 확인한 척하지 않는다.
CREATE FUNCTION workhub_private.p4_doc_student(p_ctx workhub_private.actor_context, p_context jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF to_regprocedure('workhub_private.p5_document_student_check(workhub_private.actor_context,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'NOT_READY';
  END IF;
  EXECUTE 'SELECT workhub_private.p5_document_student_check($1, $2)' USING p_ctx, p_context;
END $$;

-- 근거 확인: 모든 근거가 지금 내가 열람할 수 있는 실제 판이어야 한다(모델의 주장만으로 통과시키지 않는다).
CREATE FUNCTION workhub_private.p4_doc_sources_ok(p_ctx workhub_private.actor_context, p_sources jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE x jsonb; v_id text; v_ver integer; v_ok boolean; v_m boolean := workhub_private.p4_knowledge_manager(p_ctx);
BEGIN
  FOR x IN SELECT v FROM jsonb_array_elements(p_sources) v LOOP
    v_id := x ->> 'sourceId'; v_ver := (x ->> 'sourceVersion')::integer;
    v_ok := CASE x ->> 'kind'
      WHEN 'knowledge' THEN EXISTS (SELECT 1 FROM workhub.knowledge_sources s JOIN workhub.knowledge_source_revisions r ON r.source_id = s.id
                                    WHERE s.school_id = p_ctx.school_id AND s.id = v_id AND r.version = v_ver
                                      AND workhub_private.p4_kn_rev_sees(p_ctx, s, r.status, v_m))
      WHEN 'document' THEN EXISTS (SELECT 1 FROM workhub.documents d JOIN workhub.document_versions dv ON dv.document_id = d.id
                                   WHERE d.school_id = p_ctx.school_id AND d.id = v_id AND dv.version = v_ver
                                     AND workhub_private.p4_doc_sees(p_ctx, d, dv.visibility))
      WHEN 'calendar' THEN EXISTS (SELECT 1 FROM workhub.events e JOIN workhub.event_revisions er ON er.event_id = e.id
                                   WHERE e.school_id = p_ctx.school_id AND e.id = v_id AND er.event_version = v_ver
                                     AND workhub_private.event_readable(e, p_ctx))
      WHEN 'collection' THEN EXISTS (SELECT 1 FROM workhub.collections c WHERE c.school_id = p_ctx.school_id AND c.id = v_id
                                       AND v_ver <= c.version AND workhub_private.c_reads(p_ctx, c.id))
      WHEN 'task' THEN EXISTS (SELECT 1 FROM workhub.tasks t WHERE t.school_id = p_ctx.school_id AND t.id = v_id
                                 AND t.owner_account_id = p_ctx.account_id AND v_ver <= t.version)
      ELSE false END;
    IF NOT v_ok THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END LOOP;
END $$;

CREATE FUNCTION workhub_private.p4_doc_list(p_ctx workhub_private.actor_context, p_query text, p_archived boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_q text; v_f text; cur jsonb; c_at timestamptz; c_id text; v_ids text[]; v_last workhub.documents;
BEGIN
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'documents') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p4_text(to_jsonb(p_query), 200) OR p_archived IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_q := workhub_private.js_trim(p_query);
  v_f := md5('documents' || chr(31) || p_ctx.membership_id || chr(31) || v_q || chr(31) || p_archived::text);
  cur := workhub_private.p4_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN c_at := (cur ->> 't')::timestamptz; c_id := cur ->> 'i'; END IF;
  SELECT array_agg(x.id ORDER BY x.updated_at DESC, x.id COLLATE "C" DESC) INTO v_ids FROM (
    SELECT d.id, d.updated_at FROM workhub.documents d
      JOIN workhub.document_versions v ON v.document_id = d.id AND v.version = d.latest_version
     WHERE d.school_id = p_ctx.school_id AND workhub_private.p4_doc_sees(p_ctx, d, v.visibility)
       AND (d.status = 'archived') = p_archived
       AND (v_q = '' OR v.title ILIKE workhub_private.p4_like(v_q) OR v.body ILIKE workhub_private.p4_like(v_q))
       AND (c_id IS NULL OR (d.updated_at, d.id COLLATE "C") < (c_at, c_id COLLATE "C"))
     ORDER BY d.updated_at DESC, d.id COLLATE "C" DESC LIMIT 51) x;
  IF COALESCE(array_length(v_ids, 1), 0) > 50 THEN
    SELECT * INTO v_last FROM workhub.documents WHERE id = v_ids[50];
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p4_doc_dto(p_ctx, d, v) ORDER BY u.o)
                         FROM unnest(v_ids[1:50]) WITH ORDINALITY u(id, o) JOIN workhub.documents d ON d.id = u.id
                         JOIN workhub.document_versions v ON v.document_id = d.id AND v.version = d.latest_version), '[]'::jsonb),
    'nextCursor', CASE WHEN v_last.id IS NULL THEN NULL
                       ELSE workhub_private.p4_cursor_out(jsonb_build_object('f', v_f, 't', v_last.updated_at::text, 'i', v_last.id)) END,
    'canShare', workhub_private.p4_can_share(p_ctx));
END $$;

CREATE FUNCTION workhub_private.p4_doc_get(p_ctx workhub_private.actor_context, p_doc text, p_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d workhub.documents; v workhub.document_versions;
BEGIN
  IF NOT workhub_private.p4_id(to_jsonb(p_doc)) OR (p_version IS NOT NULL AND p_version < 1) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'documents') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO d FROM workhub.documents WHERE school_id = p_ctx.school_id AND id = p_doc;
  SELECT * INTO v FROM workhub.document_versions WHERE document_id = d.id AND version = COALESCE(p_version, d.latest_version);
  IF d.id IS NULL OR v.document_id IS NULL OR NOT workhub_private.p4_doc_sees(p_ctx, d, v.visibility) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN workhub_private.p4_doc_dto(p_ctx, d, v);
END $$;

CREATE FUNCTION workhub_private.p4_doc_history(p_ctx workhub_private.actor_context, p_doc text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d workhub.documents; v workhub.document_versions;
BEGIN
  IF NOT workhub_private.p4_id(to_jsonb(p_doc)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'documents') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO d FROM workhub.documents WHERE school_id = p_ctx.school_id AND id = p_doc;
  SELECT * INTO v FROM workhub.document_versions WHERE document_id = d.id AND version = d.latest_version;
  IF d.id IS NULL OR NOT workhub_private.p4_doc_sees(p_ctx, d, v.visibility) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('documentId', d.id, 'versions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('version', x.version, 'recordedAt', workhub_private.p4_ts(x.recorded_at), 'status', x.status)
                     ORDER BY x.version DESC)
      FROM (SELECT * FROM workhub.document_versions dv WHERE dv.document_id = d.id
              AND workhub_private.p4_doc_sees(p_ctx, d, dv.visibility) ORDER BY dv.version DESC LIMIT 500) x), '[]'::jsonb));
END $$;

CREATE FUNCTION workhub_private.p4_doc_version(p_ctx workhub_private.actor_context, d workhub.documents, i jsonb, p_status text,
  p_action text, p_key text, p_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.document_versions (document_id, version, school_id, status, visibility, title, kind, body, sources, basis_date,
      student_context, action, actor_membership_id, actor_account_id, request_key, recorded_at)
  VALUES (d.id, d.latest_version, d.school_id, p_status, i ->> 'visibility', i ->> 'title', i ->> 'kind', i ->> 'body', i -> 'sources',
      (i ->> 'basisDate')::date, NULLIF(i -> 'studentContext', 'null'::jsonb), p_action, p_ctx.membership_id, p_ctx.account_id, p_key, p_at)
$$;

CREATE FUNCTION workhub_private.p4_doc_apply(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now timestamptz := clock_timestamp(); v_kind text := c ->> 'kind'; i jsonb; d workhub.documents; od workhub.documents;
  pv workhub.document_versions; ov workhub.document_versions; v_status text;
BEGIN
  IF v_kind = 'create' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','input','origin']) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    i := workhub_private.p4_doc_input(c -> 'input');
    IF c -> 'origin' <> 'null'::jsonb AND (NOT workhub_private.p2_exact(c -> 'origin', ARRAY['documentId','version'])
         OR NOT workhub_private.p4_id(c #> '{origin,documentId}') OR NOT workhub_private.p4_pos(c #> '{origin,version}')) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF c -> 'origin' <> 'null'::jsonb THEN
      -- 사본: 원본의 그 판을 지금 읽을 수 있어야 한다
      SELECT * INTO od FROM workhub.documents WHERE school_id = p_ctx.school_id AND id = c #>> '{origin,documentId}';
      SELECT * INTO ov FROM workhub.document_versions WHERE document_id = od.id AND version = (c #>> '{origin,version}')::integer;
      IF od.id IS NULL OR ov.document_id IS NULL OR NOT workhub_private.p4_doc_sees(p_ctx, od, ov.visibility) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    END IF;
    IF i ->> 'visibility' = 'school' AND NOT workhub_private.p4_can_share(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF i -> 'studentContext' <> 'null'::jsonb THEN PERFORM workhub_private.p4_doc_student(p_ctx, i -> 'studentContext'); END IF;
    PERFORM workhub_private.p4_doc_sources_ok(p_ctx, i -> 'sources');
    INSERT INTO workhub.documents (school_id, owner_membership_id, owner_account_id, visibility, origin_document_id, origin_version, created_at, updated_at)
    VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, i ->> 'visibility', od.id, ov.version, v_now, v_now)
    RETURNING * INTO d;
    PERFORM workhub_private.p4_doc_version(p_ctx, d, i, 'draft', 'create', p_key, v_now);
  ELSIF v_kind IN ('update','confirm','archive') THEN
    IF v_kind = 'update' THEN
      IF NOT workhub_private.p2_exact(c, ARRAY['kind','documentId','expectedVersion','input']) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      i := workhub_private.p4_doc_input(c -> 'input');
    ELSIF NOT workhub_private.p2_exact(c, ARRAY['kind','documentId','expectedVersion']) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF NOT workhub_private.p4_id(c -> 'documentId') OR NOT workhub_private.p4_pos(c -> 'expectedVersion') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO d FROM workhub.documents WHERE school_id = p_ctx.school_id AND id = c ->> 'documentId' FOR UPDATE;
    SELECT * INTO pv FROM workhub.document_versions WHERE document_id = d.id AND version = d.latest_version;
    IF d.id IS NULL OR NOT workhub_private.p4_doc_sees(p_ctx, d, pv.visibility) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    -- 편집은 소유자만(학교 공유 문서도 다른 사람은 읽기만)
    IF NOT workhub_private.p4_doc_owner(p_ctx, d) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF d.latest_version <> (c ->> 'expectedVersion')::integer OR d.status = 'archived'
       OR (v_kind = 'confirm' AND d.status <> 'draft') THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    IF v_kind = 'update' THEN
      -- 학생 기록 ↔ 일반 문서로 종류를 바꿔 우회하지 못한다. 학생·과목 맥락 변경은 새 초안으로.
      IF (pv.kind = 'student_record') <> (i ->> 'kind' = 'student_record') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      IF pv.kind = 'student_record' AND (pv.student_context ->> 'studentId' IS DISTINCT FROM i #>> '{studentContext,studentId}'
           OR pv.student_context ->> 'courseId' IS DISTINCT FROM i #>> '{studentContext,courseId}') THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      IF i ->> 'visibility' = 'school' AND NOT workhub_private.p4_can_share(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      v_status := 'draft';
    ELSE
      i := jsonb_build_object('title', pv.title, 'kind', pv.kind, 'body', pv.body, 'visibility', pv.visibility, 'sources', pv.sources,
             'basisDate', workhub_private.p4_day(pv.basis_date), 'studentContext', COALESCE(pv.student_context, 'null'::jsonb));
      v_status := CASE v_kind WHEN 'confirm' THEN 'confirmed' ELSE 'archived' END;
    END IF;
    IF v_kind IN ('update','confirm') THEN
      IF i -> 'studentContext' <> 'null'::jsonb THEN PERFORM workhub_private.p4_doc_student(p_ctx, i -> 'studentContext'); END IF;
      PERFORM workhub_private.p4_doc_sources_ok(p_ctx, i -> 'sources');
    END IF;
    UPDATE workhub.documents SET latest_version = latest_version + 1, status = v_status, visibility = i ->> 'visibility', updated_at = v_now
     WHERE id = d.id RETURNING * INTO d;
    PERFORM workhub_private.p4_doc_version(p_ctx, d, i, v_status, v_kind, p_key, v_now);
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'document.' || v_kind, 'document', d.id, d.latest_version,
    CASE WHEN d.visibility = 'school' THEN 'school' ELSE 'owner_only' END, p_key, jsonb_build_object('status', d.status, 'visibility', d.visibility));
  RETURN jsonb_build_object('documentId', d.id, 'version', d.latest_version, 'requestKey', p_key, 'recordedAt', workhub_private.p4_ts(v_now));
END $$;

-- 쓰기(mutate)·접수증 읽기(request_get = p_replay)
CREATE FUNCTION workhub_private.p4_doc_mutate(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_replay boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; v_data jsonb;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR c IS NULL OR jsonb_typeof(c) <> 'object' OR octet_length(c::text) > 2000000
     OR jsonb_typeof(c -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_hash := workhub_private.p2_sha(c);
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'documents:mutate', p_key, p_replay);
  q := workhub_private.p4_ledger(p_ctx, 'documents', 'mutate', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
  IF p_replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'documents') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_data := workhub_private.p4_doc_apply(p_ctx, c, p_key);
  PERFORM workhub_private.p4_record(p_ctx, 'documents', 'mutate', p_key, v_hash, v_data ->> 'documentId', v_data);
  RETURN v_data;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 질문형 양식(guided.v1)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p4_tpl_owner(p_ctx workhub_private.actor_context, t workhub.guided_templates) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT t.school_id = p_ctx.school_id AND t.owner_membership_id = p_ctx.membership_id AND t.owner_account_id = p_ctx.account_id
$$;
-- 게시된 양식의 대상 교사: 연결한 수합(게시됨)의 제출 단위 구성원(제외되지 않음)
CREATE FUNCTION workhub_private.p4_tpl_target(p_ctx workhub_private.actor_context, t workhub.guided_templates) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.school_id = p_ctx.school_id AND t.state = 'published' AND EXISTS (
    SELECT 1 FROM workhub.collections c JOIN workhub.collection_unit_members m ON m.school_id = c.school_id AND m.collection_id = c.id
     WHERE c.school_id = t.school_id AND c.id = t.collection_id AND c.state = 'published' AND m.removed_at IS NULL
       AND m.membership_id = p_ctx.membership_id AND m.account_id = p_ctx.account_id)
$$;
-- 열람: 초안은 담당자만, 게시판은 담당자와 대상 교사
CREATE FUNCTION workhub_private.p4_tpl_sees(p_ctx workhub_private.actor_context, t workhub.guided_templates) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id IS NOT NULL AND (workhub_private.p4_tpl_owner(p_ctx, t) OR workhub_private.p4_tpl_target(p_ctx, t))
$$;

CREATE FUNCTION workhub_private.p4_tpl_dto(p_ctx workhub_private.actor_context, t workhub.guided_templates) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', t.id, 'schoolId', t.school_id, 'ownerMemberId', t.owner_membership_id, 'title', t.title,
    'version', t.version, 'state', t.state, 'inspection', t.inspection, 'mapping', t.mapping, 'collectionRequestId', t.collection_id,
    'canManage', workhub_private.p4_tpl_owner(p_ctx, t))
$$;

CREATE FUNCTION workhub_private.p4_artifact_dto(a workhub.guided_artifacts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('artifactId', a.id, 'templateId', a.template_id, 'templateVersion', a.template_version,
    'responseId', a.response_id, 'responseVersion', a.response_version, 'bytes', a.bytes, 'sha256', a.sha256)
$$;

-- 서버 분석 결과(Inspection) — 앱 inspection() · Python inspect_template 과 같은 모양·한도, 원본 SHA 일치
CREATE FUNCTION workhub_private.p4_inspection_ok(p jsonb, p_sha text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE a jsonb; v_n integer;
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['profile','templateSha256','anchors','unsupportedParagraphs'])
     OR p -> 'profile' IS DISTINCT FROM '"explicit_paragraph_v1"'::jsonb OR p -> 'templateSha256' IS DISTINCT FROM to_jsonb(p_sha)
     OR NOT workhub_private.p2_int(p -> 'unsupportedParagraphs', 0, 2147483647) OR jsonb_typeof(p -> 'anchors') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  v_n := jsonb_array_length(p -> 'anchors');
  IF v_n NOT BETWEEN 1 AND 300 THEN RETURN false; END IF;
  FOR a IN SELECT v FROM jsonb_array_elements(p -> 'anchors') v LOOP
    IF NOT workhub_private.p2_exact(a, ARRAY['id','section','paragraph','sourceText','sourceHash','cell'])
       OR NOT workhub_private.p4_text(a -> 'section', 100, true) OR (a ->> 'section') !~ '^Contents/section[0-9]+\.xml$'
       OR NOT workhub_private.p2_int(a -> 'paragraph', 0, 2147483647) OR NOT workhub_private.p4_text(a -> 'id', 120, true)
       OR a ->> 'id' <> (a ->> 'section') || ':p' || (CASE WHEN length(a ->> 'paragraph') < 6 THEN lpad(a ->> 'paragraph', 6, '0') ELSE a ->> 'paragraph' END)
       OR NOT workhub_private.p4_text(a -> 'sourceText', 10000)
       OR a -> 'sourceHash' IS DISTINCT FROM to_jsonb(encode(sha256(convert_to(a ->> 'sourceText', 'UTF8')), 'hex'))
       OR NOT (a -> 'cell' = 'null'::jsonb OR (workhub_private.p2_exact(a -> 'cell', ARRAY['row','column'])
               AND workhub_private.p4_text(a #> '{cell,row}', 10) AND (a #>> '{cell,row}') ~ '^[0-9]*$'
               AND workhub_private.p4_text(a #> '{cell,column}', 10) AND (a #>> '{cell,column}') ~ '^[0-9]*$')) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN (SELECT count(DISTINCT v ->> 'id') FROM jsonb_array_elements(p -> 'anchors') v) = v_n;
END $$;

-- 질문 매핑 — 앱 mapping(raw, inspection) · Python validate_mapping 과 같은 규칙. 분석에 없는 칸·다른 원문은 CONFLICT.
CREATE FUNCTION workhub_private.p4_mapping(p jsonb, p_inspection jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE q jsonb; o jsonb; v_n integer;
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['profile','templateSha256','questions'])
     OR p -> 'profile' IS DISTINCT FROM '"explicit_paragraph_v1"'::jsonb OR NOT workhub_private.p4_sha(p -> 'templateSha256')
     OR jsonb_typeof(p -> 'questions') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'questions') NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_n := jsonb_array_length(p -> 'questions');
  FOR q IN SELECT v FROM jsonb_array_elements(p -> 'questions') v LOOP
    IF NOT workhub_private.p2_exact(q, ARRAY['id','label','kind','required','maxLength','options','anchorId','sourceText','sourceHash'])
       OR NOT workhub_private.p4_id(q -> 'id') OR NOT workhub_private.p4_text(q -> 'label', 200, true)
       OR jsonb_typeof(q -> 'kind') IS DISTINCT FROM 'string' OR q ->> 'kind' NOT IN ('text','longtext','number','date','select')
       OR jsonb_typeof(q -> 'required') IS DISTINCT FROM 'boolean' OR NOT workhub_private.p2_int(q -> 'maxLength', 1, 10000)
       OR jsonb_typeof(q -> 'options') IS DISTINCT FROM 'array' OR jsonb_array_length(q -> 'options') > 50
       OR NOT workhub_private.p4_text(q -> 'anchorId', 120, true) OR NOT workhub_private.p4_text(q -> 'sourceText', 10000)
       OR NOT workhub_private.p4_sha(q -> 'sourceHash')
       OR (q ->> 'kind' = 'select') <> (jsonb_array_length(q -> 'options') > 0) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    FOR o IN SELECT v FROM jsonb_array_elements(q -> 'options') v LOOP
      IF NOT workhub_private.p4_text(o, 200, true) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    END LOOP;
    IF (SELECT count(DISTINCT v) FROM jsonb_array_elements(q -> 'options') v) <> jsonb_array_length(q -> 'options') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT v ->> 'id') FROM jsonb_array_elements(p -> 'questions') v) <> v_n
     OR (SELECT count(DISTINCT v ->> 'anchorId') FROM jsonb_array_elements(p -> 'questions') v) <> v_n THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p -> 'templateSha256' IS DISTINCT FROM p_inspection -> 'templateSha256'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'questions') qv
                 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_inspection -> 'anchors') av
                                    WHERE av -> 'id' = qv -> 'anchorId' AND av -> 'sourceText' = qv -> 'sourceText'
                                      AND av -> 'sourceHash' = qv -> 'sourceHash')) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  RETURN p;
END $$;

-- 답변 — 앱 answers(map, raw, complete) · Python validate_answers 와 같은 규칙. complete=false 는 임시 저장(필수 빈칸 허용).
CREATE FUNCTION workhub_private.p4_answers_ok(p_map jsonb, p jsonb, p_complete boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE q jsonb; v jsonb; s text; v_total integer := 0;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k
                 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_map -> 'questions') qv WHERE qv ->> 'id' = k)) THEN
    RETURN false;
  END IF;
  FOR q IN SELECT x FROM jsonb_array_elements(p_map -> 'questions') x LOOP
    v := COALESCE(p -> (q ->> 'id'), '""'::jsonb);
    IF NOT workhub_private.p4_text(v, (q ->> 'maxLength')::integer, p_complete AND (q ->> 'required')::boolean) THEN RETURN false; END IF;
    s := v #>> '{}';
    IF s <> '' THEN
      IF (q ->> 'kind' = 'number' AND s !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$')
         OR (q ->> 'kind' = 'select' AND NOT (q -> 'options') @> jsonb_build_array(s))
         OR (q ->> 'kind' <> 'longtext' AND s ~ '[\r\n]')
         OR (q ->> 'kind' = 'date' AND NOT workhub_private.p4_date(v)) THEN
        RETURN false;
      END IF;
    END IF;
    v_total := v_total + length(s);
  END LOOP;
  RETURN v_total <= 100000;
END $$;

-- 게시할 수 있는 수합: 내가 담당하는 게시된 수합 중 현재 양식에 HWPX 파일 칸이 있고 아직 게시 양식이 이어지지 않은 것
CREATE FUNCTION workhub_private.p4_tpl_target_ok(p_ctx workhub_private.actor_context, c workhub.collections) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.school_id = p_ctx.school_id AND c.state = 'published' AND workhub_private.c_is_manager(p_ctx, c.id)
     AND EXISTS (SELECT 1 FROM workhub.collection_fields f WHERE f.school_id = c.school_id AND f.collection_id = c.id
                   AND f.schema_id = c.current_schema_id AND f.kind = 'file' AND 'hwpx' = ANY (f.file_accept))
     AND NOT EXISTS (SELECT 1 FROM workhub.guided_templates t WHERE t.collection_id = c.id AND t.state = 'published')
$$;

CREATE FUNCTION workhub_private.p4_tpl_list(p_ctx workhub_private.actor_context, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_f text; cur jsonb; c_at timestamptz; c_id text; v_ids text[]; v_last workhub.guided_templates;
BEGIN
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_f := md5('templates' || chr(31) || p_ctx.membership_id);
  cur := workhub_private.p4_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN c_at := (cur ->> 't')::timestamptz; c_id := cur ->> 'i'; END IF;
  SELECT array_agg(x.id ORDER BY x.updated_at DESC, x.id COLLATE "C" DESC) INTO v_ids FROM (
    SELECT t.id, t.updated_at FROM workhub.guided_templates t
     WHERE t.school_id = p_ctx.school_id AND workhub_private.p4_tpl_sees(p_ctx, t)
       AND (c_id IS NULL OR (t.updated_at, t.id COLLATE "C") < (c_at, c_id COLLATE "C"))
     ORDER BY t.updated_at DESC, t.id COLLATE "C" DESC LIMIT 51) x;
  IF COALESCE(array_length(v_ids, 1), 0) > 50 THEN
    SELECT * INTO v_last FROM workhub.guided_templates WHERE id = v_ids[50];
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p4_tpl_dto(p_ctx, t) ORDER BY u.o)
                         FROM unnest(v_ids[1:50]) WITH ORDINALITY u(id, o) JOIN workhub.guided_templates t ON t.id = u.id), '[]'::jsonb),
    'nextCursor', CASE WHEN v_last.id IS NULL THEN NULL
                       ELSE workhub_private.p4_cursor_out(jsonb_build_object('f', v_f, 't', v_last.updated_at::text, 'i', v_last.id)) END,
    'canCreate', true);
END $$;

CREATE FUNCTION workhub_private.p4_tpl_get(p_ctx workhub_private.actor_context, p_template text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t workhub.guided_templates; r workhub.guided_responses; a workhub.guided_artifacts;
BEGIN
  IF NOT workhub_private.p4_id(to_jsonb(p_template)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO t FROM workhub.guided_templates WHERE school_id = p_ctx.school_id AND id = p_template;
  IF NOT workhub_private.p4_tpl_sees(p_ctx, t) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO r FROM workhub.guided_responses
   WHERE template_id = t.id AND template_version = t.version AND owner_membership_id = p_ctx.membership_id AND owner_account_id = p_ctx.account_id;
  IF r.id IS NOT NULL THEN
    SELECT * INTO a FROM workhub.guided_artifacts
     WHERE response_id = r.id AND response_version = r.version AND owner_membership_id = p_ctx.membership_id
     ORDER BY created_at DESC, id LIMIT 1;
  END IF;
  RETURN jsonb_build_object('template', workhub_private.p4_tpl_dto(p_ctx, t), 'response', CASE WHEN r.id IS NULL THEN NULL ELSE
    jsonb_build_object('id', r.id, 'templateId', r.template_id, 'templateVersion', r.template_version, 'schoolId', r.school_id,
      'ownerMemberId', r.owner_membership_id, 'version', r.version, 'answers', r.answers, 'preview', r.preview,
      'artifact', CASE WHEN a.id IS NULL THEN NULL ELSE workhub_private.p4_artifact_dto(a) END) END);
END $$;

CREATE FUNCTION workhub_private.p4_tpl_targets(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  RETURN jsonb_build_object('items', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('requestId', x.id, 'title', x.title, 'version', x.version) ORDER BY x.updated_at DESC, x.id COLLATE "C")
      FROM (SELECT c.* FROM workhub.collections c
             WHERE c.school_id = p_ctx.school_id AND c.owner_membership_id = p_ctx.membership_id AND workhub_private.p4_tpl_target_ok(p_ctx, c)
             ORDER BY c.updated_at DESC, c.id COLLATE "C" LIMIT 200) x), '[]'::jsonb));
END $$;

CREATE FUNCTION workhub_private.p4_tpl_intent(t workhub.guided_templates) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('templateId', t.id, 'templateVersion', 1, 'bucket', 'workhub-document-files', 'path', t.source_path,
    'bytes', t.source_bytes, 'sha256', t.source_sha256,
    'uploaded', t.source_object_id IS NOT NULL OR workhub_private.c_object_owner('workhub-document-files', t.source_path) IS NOT NULL)
$$;

-- 원본 업로드 예약(prepare)·예약 읽기(prepare_get = p_replay)
CREATE FUNCTION workhub_private.p4_tpl_prepare(p_ctx workhub_private.actor_context, p_file jsonb, p_title text, p_key text, p_replay boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; t workhub.guided_templates; v_id text := gen_random_uuid()::text; v_max bigint;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR NOT workhub_private.p4_file_claim_ok(p_file) OR NOT workhub_private.p4_text(to_jsonb(p_title), 200, true) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_hash := workhub_private.p2_sha(jsonb_build_object('file', p_file, 'title', p_title));
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'guided:prepare', p_key, p_replay);
  q := workhub_private.p4_ledger(p_ctx, 'guided', 'prepare', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN
    SELECT * INTO t FROM workhub.guided_templates WHERE school_id = p_ctx.school_id AND id = q.result_id;
    IF t.source_object_id IS NULL AND t.upload_expires_at <= clock_timestamp()
       AND workhub_private.c_object_owner('workhub-document-files', t.source_path) IS NULL THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    RETURN workhub_private.p4_tpl_intent(t);
  END IF;
  IF p_replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT max_file_bytes INTO v_max FROM workhub.guided_policies WHERE school_id = p_ctx.school_id;
  IF (p_file ->> 'bytes')::bigint > v_max THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO workhub.guided_templates (id, school_id, owner_membership_id, owner_account_id, title, source_name, source_bytes, source_sha256,
      source_path, upload_expires_at)
  VALUES (v_id, p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_title, p_file ->> 'name', (p_file ->> 'bytes')::bigint,
      p_file ->> 'sha256', p_ctx.school_id || '/' || p_ctx.membership_id || '/' || v_id || '/source.hwpx', clock_timestamp() + interval '30 minutes')
  RETURNING * INTO t;
  INSERT INTO workhub.guided_template_versions (template_id, version, school_id, state, title, action, actor_membership_id, actor_account_id, request_key)
  VALUES (t.id, t.version, t.school_id, t.state, t.title, 'create', p_ctx.membership_id, p_ctx.account_id, p_key);
  PERFORM workhub_private.p4_record(p_ctx, 'guided', 'prepare', p_key, v_hash, t.id, NULL);
  PERFORM workhub_private.write_audit(p_ctx, 'guided_template.prepare', 'guided_template', t.id, t.version, 'owner_only', p_key, '{}'::jsonb);
  RETURN workhub_private.p4_tpl_intent(t);
END $$;

CREATE FUNCTION workhub_private.p4_tpl_apply(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_kind text := c ->> 'kind'; t workhub.guided_templates; r workhub.guided_responses; a workhub.guided_artifacts;
  col workhub.collections; ar workhub.guided_responses; v_map jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  IF v_kind IN ('save_mapping','publish') THEN
    IF (v_kind = 'save_mapping' AND (NOT workhub_private.p2_exact(c, ARRAY['kind','templateId','expectedVersion','title','mapping'])
                                     OR NOT workhub_private.p4_text(c -> 'title', 200, true)))
       OR (v_kind = 'publish' AND (NOT workhub_private.p2_exact(c, ARRAY['kind','templateId','expectedVersion','previewArtifactId','collectionRequestId','collectionVersion'])
                                   OR NOT workhub_private.p4_id(c -> 'previewArtifactId') OR NOT workhub_private.p4_id(c -> 'collectionRequestId')
                                   OR NOT workhub_private.p4_pos(c -> 'collectionVersion')))
       OR NOT workhub_private.p4_id(c -> 'templateId') OR NOT workhub_private.p4_pos(c -> 'expectedVersion') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO t FROM workhub.guided_templates WHERE school_id = p_ctx.school_id AND id = c ->> 'templateId' FOR UPDATE;
    IF NOT workhub_private.p4_tpl_sees(p_ctx, t) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF NOT workhub_private.p4_tpl_owner(p_ctx, t) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF t.state <> 'draft' OR t.version <> (c ->> 'expectedVersion')::integer OR t.inspection IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_kind = 'save_mapping' THEN
      v_map := workhub_private.p4_mapping(c -> 'mapping', t.inspection);
      UPDATE workhub.guided_templates SET title = c ->> 'title', mapping = v_map, version = version + 1, updated_at = v_now
       WHERE id = t.id RETURNING * INTO t;
    ELSE
      IF t.mapping IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      -- 게시 조건: 같은 담당자·현재 양식판·현재 시험 답변판으로 만든 생성 파일
      SELECT * INTO a FROM workhub.guided_artifacts WHERE school_id = p_ctx.school_id AND id = c ->> 'previewArtifactId';
      SELECT * INTO ar FROM workhub.guided_responses WHERE id = a.response_id;
      IF a.id IS NULL OR a.owner_membership_id <> p_ctx.membership_id OR a.template_id <> t.id OR a.template_version <> t.version
         OR ar.id IS NULL OR NOT ar.preview OR ar.version <> a.response_version THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      SELECT * INTO col FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = c ->> 'collectionRequestId' FOR SHARE;
      IF col.id IS NULL OR NOT workhub_private.c_is_manager(p_ctx, col.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF col.version <> (c ->> 'collectionVersion')::integer OR NOT workhub_private.p4_tpl_target_ok(p_ctx, col) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      UPDATE workhub.guided_templates SET state = 'published', published_at = v_now, collection_id = col.id, collection_version = col.version,
             version = version + 1, updated_at = v_now
       WHERE id = t.id RETURNING * INTO t;
    END IF;
    INSERT INTO workhub.guided_template_versions (template_id, version, school_id, state, title, mapping, collection_id, collection_version,
        action, actor_membership_id, actor_account_id, request_key, recorded_at)
    VALUES (t.id, t.version, t.school_id, t.state, t.title, t.mapping, t.collection_id, t.collection_version, v_kind,
        p_ctx.membership_id, p_ctx.account_id, p_key, v_now);
    PERFORM workhub_private.write_audit(p_ctx, 'guided_template.' || v_kind, 'guided_template', t.id, t.version,
      CASE WHEN t.state = 'published' THEN 'school' ELSE 'owner_only' END, p_key, jsonb_build_object('collection_id', t.collection_id));
    RETURN jsonb_build_object('requestKey', p_key, 'templateId', t.id, 'templateVersion', t.version, 'responseId', NULL, 'responseVersion', NULL);
  ELSIF v_kind = 'save_answers' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','templateId','templateVersion','responseId','expectedVersion','answers','preview'])
       OR NOT workhub_private.p4_id(c -> 'templateId') OR NOT workhub_private.p4_pos(c -> 'templateVersion')
       OR NOT (c -> 'responseId' = 'null'::jsonb OR workhub_private.p4_id(c -> 'responseId'))
       OR NOT workhub_private.p2_int(c -> 'expectedVersion', 0, 2147483647)
       OR (c -> 'responseId' = 'null'::jsonb) <> ((c ->> 'expectedVersion')::integer = 0)
       OR jsonb_typeof(c -> 'preview') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c -> 'answers') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO t FROM workhub.guided_templates WHERE school_id = p_ctx.school_id AND id = c ->> 'templateId' FOR SHARE;
    IF NOT workhub_private.p4_tpl_sees(p_ctx, t) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF t.version <> (c ->> 'templateVersion')::integer OR t.mapping IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    -- 초안 양식: 담당자의 시험 답변(preview)만 · 게시판: 대상 교사의 실제 답변만
    IF t.state = 'draft' THEN
      IF NOT (c -> 'preview')::text::boolean THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    ELSE
      IF NOT workhub_private.p4_tpl_target(p_ctx, t) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      IF (c -> 'preview')::text::boolean THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    END IF;
    IF NOT workhub_private.p4_answers_ok(t.mapping, c -> 'answers', false) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF c -> 'responseId' = 'null'::jsonb THEN
      IF EXISTS (SELECT 1 FROM workhub.guided_responses WHERE template_id = t.id AND template_version = t.version
                   AND owner_membership_id = p_ctx.membership_id) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      INSERT INTO workhub.guided_responses (school_id, template_id, template_version, owner_membership_id, owner_account_id, answers, preview,
          created_at, updated_at)
      VALUES (p_ctx.school_id, t.id, t.version, p_ctx.membership_id, p_ctx.account_id, c -> 'answers', t.state = 'draft', v_now, v_now)
      RETURNING * INTO r;
    ELSE
      SELECT * INTO r FROM workhub.guided_responses WHERE school_id = p_ctx.school_id AND id = c ->> 'responseId' FOR UPDATE;
      IF r.id IS NULL OR r.owner_membership_id <> p_ctx.membership_id OR r.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF r.template_id <> t.id OR r.template_version <> t.version OR r.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      UPDATE workhub.guided_responses SET answers = c -> 'answers', version = version + 1, updated_at = v_now WHERE id = r.id RETURNING * INTO r;
    END IF;
    INSERT INTO workhub.guided_response_versions (response_id, version, school_id, answers, request_key, recorded_at)
    VALUES (r.id, r.version, r.school_id, r.answers, p_key, v_now);
    PERFORM workhub_private.write_audit(p_ctx, 'guided_response.save', 'guided_response', r.id, r.version, 'owner_only', p_key,
      jsonb_build_object('template_id', t.id, 'template_version', t.version, 'preview', r.preview));
    RETURN jsonb_build_object('requestKey', p_key, 'templateId', t.id, 'templateVersion', t.version, 'responseId', r.id, 'responseVersion', r.version);
  END IF;
  RAISE EXCEPTION 'INVALID_INPUT';
END $$;

CREATE FUNCTION workhub_private.p4_tpl_mutate(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_replay boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.content_requests; v_data jsonb;
BEGIN
  IF NOT workhub_private.p4_key(p_key) OR c IS NULL OR jsonb_typeof(c) <> 'object' OR octet_length(c::text) > 2000000
     OR jsonb_typeof(c -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_hash := workhub_private.p2_sha(c);
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'guided:mutate', p_key, p_replay);
  q := workhub_private.p4_ledger(p_ctx, 'guided', 'mutate', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
  IF p_replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_data := workhub_private.p4_tpl_apply(p_ctx, c, p_key);
  PERFORM workhub_private.p4_record(p_ctx, 'guided', 'mutate', p_key, v_hash, COALESCE(v_data ->> 'responseId', v_data ->> 'templateId'), v_data);
  RETURN v_data;
END $$;

-- 서버 작업 인수 확인(HTTP 요청과 같은 7칸). inspect 의 응답 칸은 null, render 는 저장한 응답 id·양의 판.
CREATE FUNCTION workhub_private.p4_op_args_ok(p_action text, p_template text, p_tver integer, p_response text, p_rver integer, p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_action IN ('inspect','render') AND workhub_private.p4_id(to_jsonb(p_template)) AND p_tver IS NOT NULL AND p_tver >= 1
     AND workhub_private.p4_key(p_key)
     AND CASE p_action WHEN 'inspect' THEN p_response IS NULL AND p_rver IS NULL
                       ELSE workhub_private.p4_id(to_jsonb(p_response)) AND p_rver IS NOT NULL AND p_rver >= 1 END
$$;

-- 작업 결과 읽기(operation_get): 원래 작업이 확정한 결과만. 처리 중·미확정은 RESULT_UNKNOWN, 원장이 없으면 NOT_FOUND.
CREATE FUNCTION workhub_private.p4_op_get(p_ctx workhub_private.actor_context, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o workhub.guided_operations; v_rver integer;
BEGIN
  IF NOT workhub_private.p2_exact(p, ARRAY['action','templateId','templateVersion','responseId','responseVersion','requestKey'])
     OR jsonb_typeof(p -> 'action') IS DISTINCT FROM 'string' OR jsonb_typeof(p -> 'requestKey') IS DISTINCT FROM 'string'
     OR NOT workhub_private.p4_pos(p -> 'templateVersion')
     OR NOT (p -> 'responseVersion' = 'null'::jsonb OR workhub_private.p4_pos(p -> 'responseVersion'))
     OR NOT (p -> 'responseId' = 'null'::jsonb OR jsonb_typeof(p -> 'responseId') = 'string') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_rver := CASE WHEN p -> 'responseVersion' = 'null'::jsonb THEN NULL ELSE (p ->> 'responseVersion')::integer END;
  IF NOT workhub_private.p4_op_args_ok(p ->> 'action', p ->> 'templateId', (p ->> 'templateVersion')::integer, p ->> 'responseId', v_rver, p ->> 'requestKey') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.p4_replay_gate(p_ctx, 'guided:' || (p ->> 'action'), p ->> 'requestKey', true);
  SELECT * INTO o FROM workhub.guided_operations
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND action = p ->> 'action' AND request_key = p ->> 'requestKey';
  IF o.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF o.account_id <> p_ctx.account_id OR o.template_id <> p ->> 'templateId' OR o.template_version <> (p ->> 'templateVersion')::integer
     OR o.response_id IS DISTINCT FROM p ->> 'responseId' OR o.response_version IS DISTINCT FROM v_rver THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  IF o.state <> 'completed' THEN RAISE EXCEPTION 'RESULT_UNKNOWN'; END IF;
  RETURN o.result;
END $$;

-- 서버 작업 인수(claim): 같은 (소속, 동작, 요청 번호) 는 같은 작업. 원본 실물 id · 출력 위치는 처음 인수 때 고정한다.
CREATE FUNCTION workhub_private.p4_op_claim(p_ctx workhub_private.actor_context, p_action text, p_template text, p_tver integer,
  p_response text, p_rver integer, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o workhub.guided_operations; t workhub.guided_templates; r workhub.guided_responses; l workhub.guided_leases;
  v_obj uuid; v_token text; v_artifact text; v_result jsonb;
BEGIN
  IF NOT workhub_private.p4_op_args_ok(p_action, p_template, p_tver, p_response, p_rver, p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p4_lock(p_ctx, 'guided:' || p_action, p_key);
  SELECT * INTO o FROM workhub.guided_operations
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND action = p_action AND request_key = p_key FOR UPDATE;
  IF o.id IS NOT NULL AND (o.account_id <> p_ctx.account_id OR o.template_id <> p_template OR o.template_version <> p_tver
       OR o.response_id IS DISTINCT FROM p_response OR o.response_version IS DISTINCT FROM p_rver) THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  IF o.state = 'completed' THEN RETURN jsonb_build_object('state', 'completed', 'result', o.result); END IF;
  SELECT * INTO t FROM workhub.guided_templates WHERE school_id = p_ctx.school_id AND id = p_template FOR UPDATE;
  IF p_action = 'inspect' THEN
    -- 분석은 원본을 올린 담당자만
    IF t.id IS NULL OR NOT workhub_private.p4_tpl_owner(p_ctx, t) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF t.version <> p_tver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF t.inspection IS NOT NULL THEN
      -- 이미 분석한 양식: 확정된 분석을 그대로(다시 분석하지 않는다)
      v_result := jsonb_build_object('templateId', t.id, 'templateVersion', p_tver, 'inspection', t.inspection);
      IF o.id IS NULL THEN
        INSERT INTO workhub.guided_operations (school_id, membership_id, account_id, action, request_key, template_id, template_version,
            source_object_id, state, result, completed_at)
        VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, 'inspect', p_key, t.id, p_tver, t.source_object_id, 'completed',
            v_result, clock_timestamp());
      ELSE
        UPDATE workhub.guided_operations SET state = 'completed', result = v_result, completed_at = clock_timestamp() WHERE id = o.id;
        UPDATE workhub.guided_leases SET state = 'expired', closed_at = clock_timestamp() WHERE operation_id = o.id AND state = 'issued';
      END IF;
      RETURN jsonb_build_object('state', 'completed', 'result', v_result);
    END IF;
  ELSE
    IF NOT workhub_private.p4_tpl_sees(p_ctx, t) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF t.version <> p_tver OR t.mapping IS NULL OR t.source_object_id IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    SELECT * INTO r FROM workhub.guided_responses WHERE school_id = p_ctx.school_id AND id = p_response FOR SHARE;
    IF r.id IS NULL OR r.owner_membership_id <> p_ctx.membership_id OR r.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF r.template_id <> t.id OR r.template_version <> t.version OR r.version <> p_rver THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF (t.state = 'draft' AND NOT (r.preview AND workhub_private.p4_tpl_owner(p_ctx, t)))
       OR (t.state = 'published' AND (r.preview OR NOT workhub_private.p4_tpl_target(p_ctx, t))) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    -- 생성은 필수·날짜·숫자·선택·길이 전체 검사(임시 저장과 다르다)
    IF NOT workhub_private.p4_answers_ok(t.mapping, r.answers, true) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  -- 원본 실물: 담당자가 올린 그 경로의 실물, 신고 크기. 처음 분석 때 고정한 id 와 같아야 한다.
  v_obj := workhub_private.p4_owned_object('workhub-document-files', t.source_path, t.owner_account_id, t.source_bytes);
  IF v_obj IS NULL OR (t.source_object_id IS NOT NULL AND v_obj <> t.source_object_id) OR (o.id IS NOT NULL AND o.source_object_id <> v_obj) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF t.source_object_id IS NULL THEN
    UPDATE workhub.guided_templates SET source_object_id = v_obj, updated_at = clock_timestamp() WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF o.id IS NULL THEN
    v_artifact := CASE WHEN p_action = 'render' THEN gen_random_uuid()::text END;
    INSERT INTO workhub.guided_operations (school_id, membership_id, account_id, action, request_key, template_id, template_version,
        response_id, response_version, source_object_id, artifact_id, artifact_path)
    VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_action, p_key, t.id, p_tver, p_response, p_rver, v_obj, v_artifact,
        CASE WHEN p_action = 'render' THEN p_ctx.school_id || '/' || p_ctx.membership_id || '/' || v_artifact || '/output.hwpx' END)
    RETURNING * INTO o;
  END IF;
  SELECT * INTO l FROM workhub.guided_leases WHERE operation_id = o.id AND state = 'issued' FOR UPDATE;
  IF l.id IS NOT NULL AND l.expires_at > clock_timestamp() THEN RETURN jsonb_build_object('state', 'pending'); END IF;
  IF l.id IS NOT NULL THEN
    UPDATE workhub.guided_leases SET state = 'expired', closed_at = clock_timestamp() WHERE id = l.id;
  END IF;
  IF (SELECT count(*) FROM workhub.guided_leases WHERE operation_id = o.id AND issued_at > clock_timestamp() - interval '10 minutes') >= 6
     OR (SELECT count(*) FROM workhub.guided_leases WHERE account_id = p_ctx.account_id AND issued_at > clock_timestamp() - interval '10 minutes') >= 60 THEN
    RETURN jsonb_build_object('state', 'pending');
  END IF;
  v_token := workhub_private.p4_token();
  INSERT INTO workhub.guided_leases (school_id, operation_id, account_id, token_sha256, expires_at)
  VALUES (p_ctx.school_id, o.id, p_ctx.account_id, workhub_private.p4_token_hash(v_token), clock_timestamp() + interval '120 seconds')
  RETURNING * INTO l;
  PERFORM workhub_private.write_audit(p_ctx, 'guided_operation.claim', 'guided_operation', o.id, NULL, 'owner_only', p_key,
    jsonb_build_object('action', p_action, 'lease_id', l.id));
  RETURN jsonb_build_object('state', 'leased', 'leaseToken', v_token, 'leaseExpiresAt', workhub_private.p4_ts(l.expires_at),
    'source', jsonb_build_object('bucket', 'workhub-document-files', 'ownerMemberId', t.owner_membership_id, 'path', t.source_path,
                                 'bytes', t.source_bytes, 'sha256', t.source_sha256, 'storageObjectId', v_obj::text),
    'mapping', CASE WHEN p_action = 'render' THEN t.mapping END,
    'answers', CASE WHEN p_action = 'render' THEN r.answers END,
    'target', CASE WHEN p_action = 'render' THEN jsonb_build_object('artifactId', o.artifact_id, 'bucket', 'workhub-document-files',
                                                                     'path', o.artifact_path) END);
END $$;

-- 서버 작업 확정(finish): 임대·원본 실물·(render) 출력 실물을 대조하고 결과를 한 번만 고정한다. 같은 결과 재전송은 같은 결과.
CREATE FUNCTION workhub_private.p4_op_finish(p_ctx workhub_private.actor_context, p_action text, p_template text, p_tver integer,
  p_response text, p_rver integer, p_key text, p_token text, p_object uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o workhub.guided_operations; t workhub.guided_templates; l workhub.guided_leases; out jsonb; v_size bigint;
BEGIN
  IF NOT workhub_private.p4_op_args_ok(p_action, p_template, p_tver, p_response, p_rver, p_key)
     OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR p_object IS NULL OR p_result IS NULL OR octet_length(p_result::text) > 4194304 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.p4_lock(p_ctx, 'guided:' || p_action, p_key);
  SELECT * INTO o FROM workhub.guided_operations
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND action = p_action AND request_key = p_key FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF o.account_id <> p_ctx.account_id OR o.template_id <> p_template OR o.template_version <> p_tver
     OR o.response_id IS DISTINCT FROM p_response OR o.response_version IS DISTINCT FROM p_rver THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  SELECT * INTO t FROM workhub.guided_templates WHERE school_id = p_ctx.school_id AND id = p_template FOR UPDATE;
  IF p_action = 'inspect' THEN
    IF NOT workhub_private.p2_exact(p_result, ARRAY['templateId','templateVersion','inspection'])
       OR p_result -> 'templateId' IS DISTINCT FROM to_jsonb(p_template) OR p_result -> 'templateVersion' IS DISTINCT FROM to_jsonb(p_tver)
       OR NOT workhub_private.p4_inspection_ok(p_result -> 'inspection', t.source_sha256) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSIF NOT workhub_private.p2_exact(p_result, ARRAY['artifactId','templateId','templateVersion','responseId','responseVersion','bytes','sha256'])
     OR p_result -> 'artifactId' IS DISTINCT FROM to_jsonb(o.artifact_id) OR p_result -> 'templateId' IS DISTINCT FROM to_jsonb(p_template)
     OR p_result -> 'templateVersion' IS DISTINCT FROM to_jsonb(p_tver) OR p_result -> 'responseId' IS DISTINCT FROM to_jsonb(p_response)
     OR p_result -> 'responseVersion' IS DISTINCT FROM to_jsonb(p_rver) OR NOT workhub_private.p2_int(p_result -> 'bytes', 1, 31457280)
     OR NOT workhub_private.p4_sha(p_result -> 'sha256') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF o.state = 'completed' THEN
    IF o.result = p_result THEN RETURN o.result; END IF;
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO l FROM workhub.guided_leases
   WHERE operation_id = o.id AND state = 'issued' AND token_sha256 = workhub_private.p4_token_hash(p_token) FOR UPDATE;
  IF l.id IS NULL OR l.expires_at <= clock_timestamp() OR l.account_id <> p_ctx.account_id
     OR p_object IS DISTINCT FROM o.source_object_id OR t.source_object_id IS DISTINCT FROM o.source_object_id
     OR workhub_private.p4_owned_object('workhub-document-files', t.source_path, t.owner_account_id, t.source_bytes) IS DISTINCT FROM o.source_object_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF p_action = 'inspect' THEN
    IF t.inspection IS NOT NULL AND t.inspection IS DISTINCT FROM p_result -> 'inspection' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF t.inspection IS NULL THEN
      UPDATE workhub.guided_templates SET inspection = p_result -> 'inspection', updated_at = clock_timestamp() WHERE id = t.id;
    END IF;
  ELSE
    -- 출력 실물: DB 가 정한 위치에 서버가 올린 실물이 있어야 하고, Storage 크기가 결과와 같아야 한다
    out := workhub_private.c_object_owner('workhub-document-files', o.artifact_path);
    IF out IS NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_size := workhub_private.p4_object_size((out ->> 'id')::uuid);
    IF v_size IS NOT NULL AND v_size <> (p_result ->> 'bytes')::bigint THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    INSERT INTO workhub.guided_artifacts (id, school_id, owner_membership_id, owner_account_id, template_id, template_version, response_id,
        response_version, operation_id, storage_path, storage_object_id, bytes, sha256)
    VALUES (o.artifact_id, o.school_id, o.membership_id, o.account_id, o.template_id, o.template_version, o.response_id, o.response_version,
        o.id, o.artifact_path, (out ->> 'id')::uuid, (p_result ->> 'bytes')::bigint, p_result ->> 'sha256');
  END IF;
  UPDATE workhub.guided_operations SET state = 'completed', result = p_result, completed_at = clock_timestamp() WHERE id = o.id;
  UPDATE workhub.guided_leases SET state = 'finished', closed_at = clock_timestamp() WHERE id = l.id;
  PERFORM workhub_private.write_audit(p_ctx, 'guided_operation.finish', 'guided_operation', o.id, NULL, 'owner_only', p_key,
    jsonb_build_object('action', p_action, 'lease_id', l.id));
  RETURN p_result;
END $$;

-- 생성 파일 내려받기 위치: 본인이 만든 생성 파일만(P4_설계결정 D-P4-7). URL 을 만들지 않는다(앱이 SDK 로 받는다).
CREATE FUNCTION workhub_private.p4_artifact_access(p_ctx workhub_private.actor_context, p_artifact text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a workhub.guided_artifacts; o jsonb;
BEGIN
  IF NOT workhub_private.p4_id(to_jsonb(p_artifact)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.p4_ready(p_ctx.school_id, 'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO a FROM workhub.guided_artifacts WHERE school_id = p_ctx.school_id AND id = p_artifact;
  IF a.id IS NULL OR a.owner_membership_id <> p_ctx.membership_id OR a.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  o := workhub_private.c_object_owner('workhub-document-files', a.storage_path);
  IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM a.storage_object_id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN jsonb_build_object('artifact', workhub_private.p4_artifact_dto(a), 'bucket', 'workhub-document-files', 'path', a.storage_path,
    'ownerMemberId', a.owner_membership_id);
END $$;

-- ----------------------------------------------------------------------------
-- 6. 공통 실행기 — 업무 오류는 봉투로(하위 트랜잭션 → 그 호출의 변경 전부 되돌림). 소속 gate 실패는 R0 와 같이 예외(봉투 없음).
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p4_run(p_ctx workhub_private.actor_context, p_contract text, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT workhub_private.p4_installed() THEN RETURN workhub_private.p4_err(p_ctx, p_contract, 'NOT_READY'); END IF;
  BEGIN
    IF p_op = 'knowledge_list' THEN v := workhub_private.p4_kn_list(p_ctx, a ->> 'query', a ->> 'cursor');
    ELSIF p_op = 'knowledge_mutate' THEN v := workhub_private.p4_kn_mutate(p_ctx, a -> 'command', a ->> 'key');
    ELSIF p_op = 'kprepare' THEN v := workhub_private.p4_kprepare(p_ctx, a -> 'file', a ->> 'key', (a ->> 'replay')::boolean);
    ELSIF p_op = 'kextract_get' THEN v := workhub_private.p4_kextract_get(p_ctx, a ->> 'file', a ->> 'key');
    ELSIF p_op = 'kclaim' THEN v := workhub_private.p4_kclaim(p_ctx, a ->> 'file', a ->> 'key');
    ELSIF p_op = 'kfinish' THEN v := workhub_private.p4_kfinish(p_ctx, a ->> 'file', a ->> 'key', a ->> 'token', (a ->> 'object')::uuid, a -> 'result');
    ELSIF p_op = 'kcommit' THEN v := workhub_private.p4_kcommit(p_ctx, a -> 'import', a ->> 'key', (a ->> 'replay')::boolean);
    ELSIF p_op = 'koriginal' THEN v := workhub_private.p4_koriginal(p_ctx, a ->> 'source', (a ->> 'version')::integer);
    ELSIF p_op = 'doc_list' THEN v := workhub_private.p4_doc_list(p_ctx, a ->> 'query', (a ->> 'archived')::boolean, a ->> 'cursor');
    ELSIF p_op = 'doc_get' THEN v := workhub_private.p4_doc_get(p_ctx, a ->> 'document', (a ->> 'version')::integer);
    ELSIF p_op = 'doc_history' THEN v := workhub_private.p4_doc_history(p_ctx, a ->> 'document');
    ELSIF p_op = 'doc_mutate' THEN v := workhub_private.p4_doc_mutate(p_ctx, a -> 'command', a ->> 'key', (a ->> 'replay')::boolean);
    ELSIF p_op = 'tpl_list' THEN v := workhub_private.p4_tpl_list(p_ctx, a ->> 'cursor');
    ELSIF p_op = 'tpl_get' THEN v := workhub_private.p4_tpl_get(p_ctx, a ->> 'template');
    ELSIF p_op = 'tpl_targets' THEN v := workhub_private.p4_tpl_targets(p_ctx);
    ELSIF p_op = 'tpl_prepare' THEN v := workhub_private.p4_tpl_prepare(p_ctx, a -> 'file', a ->> 'title', a ->> 'key', (a ->> 'replay')::boolean);
    ELSIF p_op = 'tpl_mutate' THEN v := workhub_private.p4_tpl_mutate(p_ctx, a -> 'command', a ->> 'key', (a ->> 'replay')::boolean);
    ELSIF p_op = 'op_get' THEN v := workhub_private.p4_op_get(p_ctx, a -> 'operation');
    ELSIF p_op = 'op_claim' THEN
      v := workhub_private.p4_op_claim(p_ctx, a ->> 'action', a ->> 'template', (a ->> 'tver')::integer, a ->> 'response', (a ->> 'rver')::integer, a ->> 'key');
    ELSIF p_op = 'op_finish' THEN
      v := workhub_private.p4_op_finish(p_ctx, a ->> 'action', a ->> 'template', (a ->> 'tver')::integer, a ->> 'response', (a ->> 'rver')::integer,
             a ->> 'key', a ->> 'token', (a ->> 'object')::uuid, a -> 'result');
    ELSIF p_op = 'artifact_access' THEN v := workhub_private.p4_artifact_access(p_ctx, a ->> 'artifact');
    ELSE RAISE EXCEPTION 'P4_UNKNOWN_OPERATION';
    END IF;
    RETURN workhub_private.p4_ok(p_ctx, p_contract, v);
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p4_business(SQLERRM) THEN RETURN workhub_private.p4_err(p_ctx, p_contract, SQLERRM); END IF;
      RAISE;
    -- 동시 생성 경합(같은 원본으로 두 초안 · 같은 양식판의 두 번째 답변 · 같은 수합에 두 번째 게시)은 유일 제약이 한 줄로 세운다
    WHEN unique_violation THEN
      RETURN workhub_private.p4_err(p_ctx, p_contract, 'CONFLICT');
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Storage 정책 판정(전용 버킷 2개)
-- ----------------------------------------------------------------------------
-- 원문 가져오기 업로드: 이 JWT 가 소유한 만료 전 예약의 정확한 경로만, 직접 업로드 요청일 때만, 원문 가져오기가 켜진 학교만.
CREATE FUNCTION workhub_storage.knowledge_insertable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.knowledge_files; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p4_installed() OR workhub_private.c_storage_op() IS DISTINCT FROM 'object.upload' THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.knowledge_files WHERE storage_path = p_name;
  IF f.id IS NULL OR f.state <> 'reserved' OR f.storage_object_id IS NOT NULL OR f.upload_expires_at <= clock_timestamp()
     OR NOT EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = f.owner_account_id AND a.auth_user_id = v_uid)
     OR NOT workhub_private.p4_ready(f.school_id, 'knowledge_import') THEN
    RETURN false;
  END IF;
  BEGIN
    ctx := workhub_private.member_actor(f.owner_membership_id, false);
  EXCEPTION WHEN raise_exception THEN RETURN false;
  END;
  RETURN ctx.account_id = f.owner_account_id;
END $$;

-- 원본 읽기: (1) 업로드 요청 안의 올린 사람 되읽기 (2) 직접 내려받기 — 고정한 실물 id 와 같고,
--   올린 사람 본인이거나, 이 파일이 이어진 자료판을 지금 열람할 수 있는(게시·종료판, 또는 작성자·지식 관리자) 유효 소속일 때만.
CREATE FUNCTION workhub_storage.knowledge_readable(p_name text, p_object uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.knowledge_files; v_op text := workhub_private.c_storage_op(); v_m text; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p4_installed() OR v_op IS NULL OR v_op NOT IN ('object.upload','object.get_authenticated') THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.knowledge_files WHERE storage_path = p_name;
  IF f.id IS NULL THEN RETURN false; END IF;
  IF f.storage_object_id IS NULL THEN RETURN workhub_storage.knowledge_insertable(p_name); END IF;
  IF v_op <> 'object.get_authenticated' OR p_object IS DISTINCT FROM f.storage_object_id
     OR NOT workhub_private.p4_ready(f.school_id, 'knowledge_import') THEN
    RETURN false;
  END IF;
  FOR v_m IN SELECT m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
              WHERE m.school_id = f.school_id AND a.auth_user_id = v_uid LOOP
    BEGIN
      ctx := workhub_private.member_actor(v_m, false);
    EXCEPTION WHEN raise_exception THEN CONTINUE;
    END;
    IF ctx.school_id = f.school_id AND (
         (ctx.membership_id = f.owner_membership_id AND ctx.account_id = f.owner_account_id)
         OR EXISTS (SELECT 1 FROM workhub.knowledge_source_revisions r JOIN workhub.knowledge_sources s ON s.id = r.source_id
                     WHERE r.file_id = f.id AND r.school_id = f.school_id
                       AND workhub_private.p4_kn_rev_sees(ctx, s, r.status, workhub_private.p4_knowledge_manager(ctx)))) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END $$;

-- 질문형 양식 원본 업로드: 이 JWT 가 소유한 만료 전 양식 예약(source.hwpx)의 정확한 경로만. 생성 파일 경로(output.hwpx)는 열지 않는다.
CREATE FUNCTION workhub_storage.document_insertable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); t workhub.guided_templates; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p4_installed() OR workhub_private.c_storage_op() IS DISTINCT FROM 'object.upload' THEN RETURN false; END IF;
  SELECT * INTO t FROM workhub.guided_templates WHERE source_path = p_name;
  IF t.id IS NULL OR t.source_object_id IS NOT NULL OR t.upload_expires_at <= clock_timestamp()
     OR NOT EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = t.owner_account_id AND a.auth_user_id = v_uid)
     OR NOT workhub_private.p4_ready(t.school_id, 'guided') THEN
    RETURN false;
  END IF;
  BEGIN
    ctx := workhub_private.member_actor(t.owner_membership_id, false);
  EXCEPTION WHEN raise_exception THEN RETURN false;
  END;
  RETURN ctx.account_id = t.owner_account_id;
END $$;

-- 읽기: (1) 원본 업로드 요청 안의 되읽기 (2) 생성 파일 직접 내려받기 — 본인이 만든 것, 고정한 실물 id, 유효 소속일 때만.
--   양식 원본은 브라우저로 내려주지 않는다(서버 API 가 service_role 로만 읽는다).
CREATE FUNCTION workhub_storage.document_readable(p_name text, p_object uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_op text := workhub_private.c_storage_op(); t workhub.guided_templates; a workhub.guided_artifacts;
  ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p4_installed() OR v_op IS NULL OR v_op NOT IN ('object.upload','object.get_authenticated') THEN RETURN false; END IF;
  SELECT * INTO t FROM workhub.guided_templates WHERE source_path = p_name;
  IF t.id IS NOT NULL THEN
    RETURN t.source_object_id IS NULL AND workhub_storage.document_insertable(p_name);
  END IF;
  SELECT * INTO a FROM workhub.guided_artifacts WHERE storage_path = p_name;
  IF a.id IS NULL OR v_op <> 'object.get_authenticated' OR p_object IS DISTINCT FROM a.storage_object_id
     OR NOT workhub_private.p4_ready(a.school_id, 'guided')
     OR NOT EXISTS (SELECT 1 FROM workhub.accounts x WHERE x.id = a.owner_account_id AND x.auth_user_id = v_uid) THEN
    RETURN false;
  END IF;
  BEGIN
    ctx := workhub_private.member_actor(a.owner_membership_id, false);
  EXCEPTION WHEN raise_exception THEN RETURN false;
  END;
  RETURN ctx.account_id = a.owner_account_id AND ctx.school_id = a.school_id;
END $$;

-- ----------------------------------------------------------------------------
-- 8. 공개 함수 29개
-- ----------------------------------------------------------------------------
-- 학교 자료
CREATE FUNCTION public.workhub_knowledge_list(p_member_id text, p_query text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'knowledge.v1', 'knowledge_list', jsonb_build_object('query', p_query, 'cursor', p_cursor));
END $$;

CREATE FUNCTION public.workhub_knowledge_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p4_run(ctx, 'knowledge.v1', 'knowledge_mutate', jsonb_build_object('command', p_command, 'key', p_request_key));
END $$;

-- 원문 가져오기
CREATE FUNCTION public.workhub_knowledge_import_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_ok(ctx, 'knowledge-import.v1',
    jsonb_build_object('available', workhub_private.p4_installed() AND workhub_private.p4_ready(ctx.school_id, 'knowledge_import')));
END $$;

CREATE FUNCTION public.workhub_knowledge_file_prepare(p_member_id text, p_file jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kprepare', jsonb_build_object('file', p_file, 'key', p_request_key, 'replay', false));
END $$;

CREATE FUNCTION public.workhub_knowledge_file_prepare_get(p_member_id text, p_file jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kprepare', jsonb_build_object('file', p_file, 'key', p_request_key, 'replay', true));
END $$;

CREATE FUNCTION public.workhub_knowledge_file_extract_get(p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kextract_get', jsonb_build_object('file', p_file_id, 'key', p_request_key));
END $$;

CREATE FUNCTION public.workhub_knowledge_import_commit(p_member_id text, p_import jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kcommit', jsonb_build_object('import', p_import, 'key', p_request_key, 'replay', false));
END $$;

CREATE FUNCTION public.workhub_knowledge_import_request_get(p_member_id text, p_import jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kcommit', jsonb_build_object('import', p_import, 'key', p_request_key, 'replay', true));
END $$;

CREATE FUNCTION public.workhub_knowledge_original_access(p_member_id text, p_source_id text, p_source_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'koriginal', jsonb_build_object('source', p_source_id, 'version', p_source_version));
END $$;

CREATE FUNCTION public.workhub_knowledge_file_extract_claim(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p4_service_member(p_actor_user_id, p_member_id);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kclaim', jsonb_build_object('file', p_file_id, 'key', p_request_key));
END $$;

CREATE FUNCTION public.workhub_knowledge_file_extract_finish(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text,
  p_lease_token text, p_storage_object_id uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p4_service_member(p_actor_user_id, p_member_id);
  RETURN workhub_private.p4_run(ctx, 'knowledge-import.v1', 'kfinish', jsonb_build_object('file', p_file_id, 'key', p_request_key,
    'token', p_lease_token, 'object', p_storage_object_id, 'result', p_result));
END $$;

-- 문서함
CREATE FUNCTION public.workhub_document_list(p_member_id text, p_query text, p_archived boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'documents.v1', 'doc_list', jsonb_build_object('query', p_query, 'archived', p_archived, 'cursor', p_cursor));
END $$;

CREATE FUNCTION public.workhub_document_get(p_member_id text, p_document_id text, p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'documents.v1', 'doc_get', jsonb_build_object('document', p_document_id, 'version', p_version));
END $$;

CREATE FUNCTION public.workhub_document_history(p_member_id text, p_document_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'documents.v1', 'doc_history', jsonb_build_object('document', p_document_id));
END $$;

CREATE FUNCTION public.workhub_document_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p4_run(ctx, 'documents.v1', 'doc_mutate', jsonb_build_object('command', p_command, 'key', p_request_key, 'replay', false));
END $$;

CREATE FUNCTION public.workhub_document_request_get(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'documents.v1', 'doc_mutate', jsonb_build_object('command', p_command, 'key', p_request_key, 'replay', true));
END $$;

-- 질문형 양식
CREATE FUNCTION public.workhub_template_list(p_member_id text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_list', jsonb_build_object('cursor', p_cursor));
END $$;

CREATE FUNCTION public.workhub_template_get(p_member_id text, p_template_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_get', jsonb_build_object('template', p_template_id));
END $$;

CREATE FUNCTION public.workhub_template_collection_targets(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_targets', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_template_prepare(p_member_id text, p_file jsonb, p_title text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_prepare',
    jsonb_build_object('file', p_file, 'title', p_title, 'key', p_request_key, 'replay', false));
END $$;

CREATE FUNCTION public.workhub_template_prepare_get(p_member_id text, p_file jsonb, p_title text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_prepare',
    jsonb_build_object('file', p_file, 'title', p_title, 'key', p_request_key, 'replay', true));
END $$;

CREATE FUNCTION public.workhub_template_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_mutate', jsonb_build_object('command', p_command, 'key', p_request_key, 'replay', false));
END $$;

CREATE FUNCTION public.workhub_template_request_get(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'tpl_mutate', jsonb_build_object('command', p_command, 'key', p_request_key, 'replay', true));
END $$;

CREATE FUNCTION public.workhub_template_operation_get(p_member_id text, p_operation jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'op_get', jsonb_build_object('operation', p_operation));
END $$;

CREATE FUNCTION public.workhub_document_artifact_access(p_member_id text, p_artifact_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'artifact_access', jsonb_build_object('artifact', p_artifact_id));
END $$;

CREATE FUNCTION public.workhub_template_inspect_claim(p_actor_user_id uuid, p_member_id text, p_template_id text, p_template_version integer,
  p_response_id text, p_response_version integer, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p4_service_member(p_actor_user_id, p_member_id);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'op_claim', jsonb_build_object('action', 'inspect', 'template', p_template_id,
    'tver', p_template_version, 'response', p_response_id, 'rver', p_response_version, 'key', p_request_key));
END $$;

CREATE FUNCTION public.workhub_template_inspect_finish(p_actor_user_id uuid, p_member_id text, p_template_id text, p_template_version integer,
  p_response_id text, p_response_version integer, p_request_key text, p_lease_token text, p_source_object_id uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p4_service_member(p_actor_user_id, p_member_id);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'op_finish', jsonb_build_object('action', 'inspect', 'template', p_template_id,
    'tver', p_template_version, 'response', p_response_id, 'rver', p_response_version, 'key', p_request_key,
    'token', p_lease_token, 'object', p_source_object_id, 'result', p_result));
END $$;

CREATE FUNCTION public.workhub_template_render_claim(p_actor_user_id uuid, p_member_id text, p_template_id text, p_template_version integer,
  p_response_id text, p_response_version integer, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p4_service_member(p_actor_user_id, p_member_id);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'op_claim', jsonb_build_object('action', 'render', 'template', p_template_id,
    'tver', p_template_version, 'response', p_response_id, 'rver', p_response_version, 'key', p_request_key));
END $$;

CREATE FUNCTION public.workhub_template_render_finish(p_actor_user_id uuid, p_member_id text, p_template_id text, p_template_version integer,
  p_response_id text, p_response_version integer, p_request_key text, p_lease_token text, p_source_object_id uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p4_service_member(p_actor_user_id, p_member_id);
  RETURN workhub_private.p4_run(ctx, 'guided.v1', 'op_finish', jsonb_build_object('action', 'render', 'template', p_template_id,
    'tver', p_template_version, 'response', p_response_id, 'rver', p_response_version, 'key', p_request_key,
    'token', p_lease_token, 'object', p_source_object_id, 'result', p_result));
END $$;

COMMENT ON FUNCTION public.workhub_knowledge_mutate(text, jsonb, text) IS '업무실 P4 학교 자료: create·update·publish·retire(요청 번호 원장·판 기록·한 트랜잭션).';
COMMENT ON FUNCTION public.workhub_document_mutate(text, jsonb, text) IS '업무실 P4 문서함: create·update·confirm·archive(내용 확인은 결재·제출이 아님).';
COMMENT ON FUNCTION public.workhub_template_mutate(text, jsonb, text) IS '업무실 P4 질문형 양식: save_mapping·publish·save_answers.';
COMMENT ON FUNCTION public.workhub_knowledge_file_extract_claim(uuid, text, text, text) IS '업무실 P4 서버 API 전용(service_role): HWPX 원문 추출 임대.';
COMMENT ON FUNCTION public.workhub_template_render_claim(uuid, text, text, integer, text, integer, text) IS '업무실 P4 서버 API 전용(service_role): 질문형 양식 생성 임대.';

-- ----------------------------------------------------------------------------
-- 9. 비공개 버킷 2개 · Storage 정책 4개(각 버킷에만). UPDATE·DELETE 정책 없음 → 덮어쓰기·사용자 삭제 불가.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('workhub-knowledge-files', 'workhub-knowledge-files', false),
  ('workhub-document-files', 'workhub-document-files', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit = 31457280 WHERE id IN (''workhub-knowledge-files'',''workhub-document-files'')';
  END IF;
END $$;
CREATE POLICY workhub_knowledge_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workhub-knowledge-files' AND workhub_storage.knowledge_insertable(name));
CREATE POLICY workhub_knowledge_files_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'workhub-knowledge-files' AND workhub_storage.knowledge_readable(name, id));
CREATE POLICY workhub_document_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workhub-document-files' AND workhub_storage.document_insertable(name));
CREATE POLICY workhub_document_files_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'workhub-document-files' AND workhub_storage.document_readable(name, id));
INSERT INTO workhub_private.p4_storage_policies (policy_name, bucket, cmd, expr_md5)
SELECT pol.polname, CASE WHEN pol.polname LIKE 'workhub\_knowledge%' THEN 'workhub-knowledge-files' ELSE 'workhub-document-files' END, pol.polcmd,
       md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
  FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass
   AND pol.polname IN ('workhub_knowledge_files_insert','workhub_knowledge_files_select','workhub_document_files_insert','workhub_document_files_select');

-- ----------------------------------------------------------------------------
-- 10. 권한 — 앱 함수 23개 authenticated, 서버 API 함수 6개 service_role 만. 새 내부 함수는 API 역할에 0.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
            WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p4\_%')
               OR (p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_knowledge\_%' OR p.proname LIKE 'workhub\_document\_%'
                                                               OR p.proname LIKE 'workhub\_template\_%'))
               OR (p.pronamespace = 'workhub_storage'::regnamespace AND p.proname IN ('knowledge_insertable','knowledge_readable','document_insertable','document_readable')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.workhub_knowledge_list(text, text, text), public.workhub_knowledge_mutate(text, jsonb, text),
  public.workhub_knowledge_import_readiness(text), public.workhub_knowledge_file_prepare(text, jsonb, text),
  public.workhub_knowledge_file_prepare_get(text, jsonb, text), public.workhub_knowledge_file_extract_get(text, text, text),
  public.workhub_knowledge_import_commit(text, jsonb, text), public.workhub_knowledge_import_request_get(text, jsonb, text),
  public.workhub_knowledge_original_access(text, text, integer),
  public.workhub_document_list(text, text, boolean, text), public.workhub_document_get(text, text, integer),
  public.workhub_document_history(text, text), public.workhub_document_mutate(text, jsonb, text), public.workhub_document_request_get(text, jsonb, text),
  public.workhub_template_list(text, text), public.workhub_template_get(text, text), public.workhub_template_collection_targets(text),
  public.workhub_template_prepare(text, jsonb, text, text), public.workhub_template_prepare_get(text, jsonb, text, text),
  public.workhub_template_mutate(text, jsonb, text), public.workhub_template_request_get(text, jsonb, text),
  public.workhub_template_operation_get(text, jsonb), public.workhub_document_artifact_access(text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_knowledge_file_extract_claim(uuid, text, text, text),
  public.workhub_knowledge_file_extract_finish(uuid, text, text, text, text, uuid, jsonb),
  public.workhub_template_inspect_claim(uuid, text, text, integer, text, integer, text),
  public.workhub_template_inspect_finish(uuid, text, text, integer, text, integer, text, text, uuid, jsonb),
  public.workhub_template_render_claim(uuid, text, text, integer, text, integer, text),
  public.workhub_template_render_finish(uuid, text, text, integer, text, integer, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION workhub_storage.knowledge_insertable(text), workhub_storage.knowledge_readable(text, uuid),
  workhub_storage.document_insertable(text), workhub_storage.document_readable(text, uuid) TO authenticated;

INSERT INTO workhub_private.p4_installs (batch, release) VALUES ('P4-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 11. 검증 — 모든 행의 status 가 ok 여야 한다. P4-02-5 는 "아직 켜지 않음"이 정상이다(P4-04·05 전).
-- ----------------------------------------------------------------------------
WITH app(f) AS (VALUES ('public.workhub_knowledge_list(text,text,text)'),('public.workhub_knowledge_mutate(text,jsonb,text)'),
  ('public.workhub_knowledge_import_readiness(text)'),('public.workhub_knowledge_file_prepare(text,jsonb,text)'),
  ('public.workhub_knowledge_file_prepare_get(text,jsonb,text)'),('public.workhub_knowledge_file_extract_get(text,text,text)'),
  ('public.workhub_knowledge_import_commit(text,jsonb,text)'),('public.workhub_knowledge_import_request_get(text,jsonb,text)'),
  ('public.workhub_knowledge_original_access(text,text,integer)'),('public.workhub_document_list(text,text,boolean,text)'),
  ('public.workhub_document_get(text,text,integer)'),('public.workhub_document_history(text,text)'),('public.workhub_document_mutate(text,jsonb,text)'),
  ('public.workhub_document_request_get(text,jsonb,text)'),('public.workhub_template_list(text,text)'),('public.workhub_template_get(text,text)'),
  ('public.workhub_template_collection_targets(text)'),('public.workhub_template_prepare(text,jsonb,text,text)'),
  ('public.workhub_template_prepare_get(text,jsonb,text,text)'),('public.workhub_template_mutate(text,jsonb,text)'),
  ('public.workhub_template_request_get(text,jsonb,text)'),('public.workhub_template_operation_get(text,jsonb)'),
  ('public.workhub_document_artifact_access(text,text)')),
svc(f) AS (VALUES ('public.workhub_knowledge_file_extract_claim(uuid,text,text,text)'),
  ('public.workhub_knowledge_file_extract_finish(uuid,text,text,text,text,uuid,jsonb)'),
  ('public.workhub_template_inspect_claim(uuid,text,text,integer,text,integer,text)'),
  ('public.workhub_template_inspect_finish(uuid,text,text,integer,text,integer,text,text,uuid,jsonb)'),
  ('public.workhub_template_render_claim(uuid,text,text,integer,text,integer,text)'),
  ('public.workhub_template_render_finish(uuid,text,text,integer,text,integer,text,text,uuid,jsonb)'))
SELECT 'P4-02-1' AS no, '앱 함수 23개: authenticated 만 실행(anon·service_role 불가), SECURITY DEFINER·search_path 고정' AS item,
       CASE WHEN count(*) = 23 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM app JOIN pg_proc p ON p.oid = to_regprocedure(app.f)
UNION ALL
SELECT 'P4-02-2', '서버 API 함수 6개: service_role 만 실행(authenticated·anon 불가)',
       CASE WHEN count(*) = 6 AND bool_and(p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END,
       count(*)::text
FROM svc JOIN pg_proc p ON p.oid = to_regprocedure(svc.f)
UNION ALL
SELECT 'P4-02-3', '비공개 버킷 2개 · 정책 4개(버킷마다 INSERT·SELECT, 그 버킷 한정)',
       CASE WHEN (SELECT count(*) FROM storage.buckets WHERE id IN ('workhub-knowledge-files','workhub-document-files') AND public IS FALSE) = 2
             AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
                   AND (polname LIKE 'workhub\_knowledge%' OR polname LIKE 'workhub\_document%')) = 4
             AND (SELECT count(*) FROM workhub_private.p4_storage_policies) = 4 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P4-02-4', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p4\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P4-02-5', '아직 어느 학교도 켜지 않음(네 모듈 활성화 0, 정책 0)',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module IN ('knowledge','knowledge_import','documents','guided')) = 0
             AND (SELECT count(*) FROM workhub.document_policies) = 0 AND (SELECT count(*) FROM workhub.knowledge_import_policies) = 0
             AND (SELECT count(*) FROM workhub.guided_policies) = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P4-02-6', 'Storage 준비 판정(두 버킷 모두 이 배치가 만든 그대로)',
       CASE WHEN workhub_private.p4_storage_ok('workhub-knowledge-files') AND workhub_private.p4_storage_ok('workhub-document-files') THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P4-02-7', '적용 기록 P4-01·02', CASE WHEN workhub_private.p4_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
